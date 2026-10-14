import { getAddress, parseEventLogs, type Address, type Log } from "viem";
import { factoryAbi, vaultAbi } from "./abi.js";
import { USDC, publicClient, usdcAbi } from "./chain.js";
import { canonicalJson } from "./canonical.js";
import { config } from "./config.js";
import { activeVaults, one, q, type VaultRow } from "./db.js";
import { readObligation } from "./snapshot.js";
import { fmt } from "./units.js";

/** Mirrors on-chain events into Postgres. Returns the vaults that should get an agent run (deposit, settlement, new bill). */

const blockTimes = new Map<bigint, Date>();
async function blockTime(n: bigint): Promise<Date> {
  let t = blockTimes.get(n);
  if (!t) {
    const b = await publicClient.getBlock({ blockNumber: n });
    t = new Date(Number(b.timestamp) * 1000);
    blockTimes.set(n, t);
    if (blockTimes.size > 5000) blockTimes.clear();
  }
  return t;
}

const jsonArgs = (args: unknown) => JSON.parse(canonicalJson(args ?? {}));

async function saveEvent(vaultId: string | null, log: Log & { eventName: string; args: unknown }) {
  await q(
    `insert into chain_events (vault_id, address, tx_hash, log_index, block, name, args, block_time)
     values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (tx_hash, log_index) do nothing`,
    [vaultId, log.address.toLowerCase(), log.transactionHash, log.logIndex, log.blockNumber!.toString(), log.eventName, jsonArgs(log.args), await blockTime(log.blockNumber!)],
  );
}

async function upsertObligation(v: VaultRow, id: number) {
  const o = await readObligation(getAddress(v.address), id);
  await q(
    `insert into obligations (vault_id, chain_id, ref, payee, amount, due_at, source, status, escalated, failed_for_liquidity, paid_at, updated_at)
     values ($1,$2,$3,$4,$5,to_timestamp($6),$7,$8,$9,$10,case when $11::bigint > 0 then to_timestamp($11) end, now())
     on conflict (vault_id, chain_id) do update set status = excluded.status, escalated = excluded.escalated,
       failed_for_liquidity = excluded.failed_for_liquidity, paid_at = excluded.paid_at, updated_at = now()`,
    [v.id, id, o.ref, o.payee.toLowerCase(), fmt(o.amount), o.dueAt.toString(), o.source, o.status, o.escalated, o.failedForLiquidity, o.paidAt.toString()],
  );
}

async function upsertCommitment(v: VaultRow, cid: number, settled?: { newScore: bigint; newLimit: bigint; at: Date }) {
  const c = await publicClient.readContract({ address: getAddress(v.address), abi: vaultAbi, functionName: "getCommitment", args: [cid] });
  const decision = await one<{ id: string }>("select id from decisions where decision_hash = $1", [c.decisionHash]);
  const capitalSeconds = await publicClient.readContract({ address: getAddress(v.address), abi: vaultAbi, functionName: "pendingCapitalSeconds", args: [cid] });
  const capitalUsdcDays = fmt(capitalSeconds / 86_400n);
  await q(
    `insert into commitments (vault_id, chain_id, amount, remaining, opened_at, t, cover_to, limit_at_open, decision_hash, decision_id,
                              settled, hit, credit, score_after, limit_after, settled_at, capital_usdc_days, updated_at)
     values ($1,$2,$3,$4,to_timestamp($5),to_timestamp($6),$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, now())
     on conflict (vault_id, chain_id) do update set remaining = excluded.remaining, settled = excluded.settled, hit = excluded.hit,
       capital_usdc_days = excluded.capital_usdc_days,
       credit = excluded.credit, decision_id = coalesce(commitments.decision_id, excluded.decision_id),
       score_after = coalesce(excluded.score_after, commitments.score_after), limit_after = coalesce(excluded.limit_after, commitments.limit_after),
       settled_at = coalesce(excluded.settled_at, commitments.settled_at), updated_at = now()`,
    [
      v.id, cid, fmt(c.amount), fmt(c.remaining), c.openedAt.toString(), c.T.toString(), c.coverTo, fmt(c.limitAtOpen), c.decisionHash,
      decision?.id ?? null, c.settled, c.settled ? c.hit : null, c.settled ? fmt(c.credit) : null,
      settled ? fmt(settled.newScore) : null, settled ? fmt(settled.newLimit) : null, settled?.at ?? null, capitalUsdcDays,
    ],
  );
}

async function upsertPayee(v: VaultRow, payee: Address) {
  const p = await publicClient.readContract({ address: getAddress(v.address), abi: vaultAbi, functionName: "getPayee", args: [payee] });
  await q(
    `insert into payees (vault_id, address, max_per_invoice, max_per_month, active_at, allowed)
     values ($1,$2,$3,$4,to_timestamp($5),$6)
     on conflict (vault_id, address) do update set max_per_invoice = excluded.max_per_invoice, max_per_month = excluded.max_per_month,
       active_at = excluded.active_at, allowed = excluded.allowed`,
    [v.id, payee.toLowerCase(), fmt(p.maxPerInvoice), fmt(p.maxPerMonth), p.activeAt.toString(), p.allowed],
  );
}

export async function indexVault(v: VaultRow, head: bigint): Promise<{ wake: boolean }> {
  let from = BigInt(v.last_indexed_block) + 1n;
  if (from === 1n && BigInt(v.created_block) > 0n) from = BigInt(v.created_block);
  let wake = false;
  const vault = getAddress(v.address);

  while (from <= head) {
    const to = from + config.LOG_CHUNK_BLOCKS - 1n < head ? from + config.LOG_CHUNK_BLOCKS - 1n : head;
    const [vaultLogs, inLogs, outLogs] = await Promise.all([
      publicClient.getLogs({ address: vault, fromBlock: from, toBlock: to }),
      publicClient.getLogs({ address: USDC, event: usdcAbi[0], args: { to: vault }, fromBlock: from, toBlock: to }),
      publicClient.getLogs({ address: USDC, event: usdcAbi[0], args: { from: vault }, fromBlock: from, toBlock: to }),
    ]);

    const events = parseEventLogs({ abi: vaultAbi, logs: vaultLogs });
    const touchedObl = new Set<number>();
    const touchedCom = new Map<number, { newScore: bigint; newLimit: bigint; at: Date } | undefined>();
    let redeemed = false;

    for (const e of events) {
      await saveEvent(v.id, e as any);
      const args = e.args as any;
      switch (e.eventName) {
        case "ObligationRegistered":
          touchedObl.add(Number(args.id));
          wake = true;
          break;
        case "Paid":
        case "Escalated":
        case "ObligationCancelled":
          touchedObl.add(Number(args.id));
          break;
        case "EscalationApproved":
          touchedObl.add(Number(args.id));
          wake = true;
          break;
        case "Swept":
          touchedCom.set(Number(args.cid), undefined);
          break;
        case "Redeemed":
          redeemed = true;
          break;
        case "Settled":
          touchedCom.set(Number(args.cid), { newScore: args.newScore, newLimit: args.newLimit, at: await blockTime(e.blockNumber!) });
          wake = true;
          break;
        case "PayeeAdded":
        case "PayeeRemoved":
          await upsertPayee(v, args.payee);
          break;
        case "AgentChanged":
          if (args.agent.toLowerCase() !== v.agent_address.toLowerCase()) {
            await q("update vaults set active = false where id = $1", [v.id]);
          }
          break;
      }
    }

    for (const log of parseEventLogs({ abi: usdcAbi, logs: [...inLogs, ...outLogs] })) {
      await saveEvent(v.id, log as any);
      if (log.args.to.toLowerCase() === vault.toLowerCase()) wake = true; // deposit
    }

    for (const id of touchedObl) await upsertObligation(v, id);
    if (redeemed) {
      const open = await q<{ chain_id: number }>("select chain_id from commitments where vault_id = $1 and not settled", [v.id]);
      for (const c of open) if (!touchedCom.has(c.chain_id)) touchedCom.set(c.chain_id, undefined);
    }
    for (const [cid, s] of touchedCom) await upsertCommitment(v, cid, s);

    await q("update vaults set last_indexed_block = $2 where id = $1", [v.id, to.toString()]);
    from = to + 1n;
  }
  return { wake };
}

/** Picks up vaults created through the factory and binds them to the agent wallet we created for them. */
export async function indexFactory(head: bigint) {
  if (!config.FACTORY_ADDRESS) return;
  const factory = getAddress(config.FACTORY_ADDRESS);
  const state = await one<{ value: { block: string } }>("select value from worker_state where key = 'factory_block'");
  let from = state ? BigInt(state.value.block) + 1n : config.FACTORY_START_BLOCK;
  while (from <= head) {
    const to = from + config.LOG_CHUNK_BLOCKS - 1n < head ? from + config.LOG_CHUNK_BLOCKS - 1n : head;
    const logs = await publicClient.getLogs({ address: factory, fromBlock: from, toBlock: to });
    for (const e of parseEventLogs({ abi: factoryAbi, logs, eventName: "VaultCreated" })) {
      await saveEvent(null, e as any);
      const { owner, vault, agent } = e.args;
      const wallet = await one<{ wallet_id: string }>("select wallet_id from agent_wallets where address = $1", [agent.toLowerCase()]);
      const known = wallet || config.EXECUTOR === "local";
      const row = await one<{ id: string }>(
        `insert into vaults (address, owner_address, agent_wallet_id, agent_address, created_block, last_indexed_block, active)
         values ($1,$2,$3,$4,$5,$6,$7) on conflict (address) do nothing returning id`,
        [vault.toLowerCase(), owner.toLowerCase(), wallet?.wallet_id ?? null, agent.toLowerCase(), e.blockNumber!.toString(), (e.blockNumber! - 1n).toString(), Boolean(known)],
      );
      if (row && wallet) await q("update agent_wallets set vault_id = $2 where wallet_id = $1", [wallet.wallet_id, row.id]);
    }
    await q(
      `insert into worker_state (key, value) values ('factory_block', $1)
       on conflict (key) do update set value = excluded.value`,
      [{ block: to.toString() }],
    );
    from = to + 1n;
  }
}

export async function indexAll(): Promise<VaultRow[]> {
  const head = await publicClient.getBlockNumber({ cacheTime: 0 });
  await indexFactory(head);
  const wake: VaultRow[] = [];
  for (const v of await activeVaults()) {
    try {
      if ((await indexVault(v, head)).wake) wake.push(v);
    } catch (e) {
      console.error(`[indexer] ${v.address}:`, e instanceof Error ? e.message : e);
    }
  }
  return wake;
}
