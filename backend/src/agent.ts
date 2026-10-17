import { randomUUID } from "node:crypto";
import { encodeFunctionData, getAddress, type Hex } from "viem";
import { v5 as uuidv5 } from "uuid";
import { vaultAbi } from "./abi.js";
import { publicClient } from "./chain.js";
import { canonicalJson, hashCanonical } from "./canonical.js";
import { config } from "./config.js";
import { alertOwner, q, withVaultLock, type VaultRow } from "./db.js";
import { emit } from "./events.js";
import { send, simulate, waitCircle } from "./executor.js";
import { decide, llmView } from "./llm.js";
import { applyPolicy, type FinalAction } from "./policy.js";
import { precompute } from "./precompute.js";
import { takeSnapshot } from "./snapshot.js";
import { fmt } from "./units.js";

// Fixed namespace so an action's idempotency key is derived from (decision id, index) and nothing else.
const ACTION_NS = "6f1c3c1e-5b0a-4f7e-9d0e-2a7d5e0b9c41";
export const actionKey = (decisionId: string, idx: number) => uuidv5(`${decisionId}:${idx}`, ACTION_NS);

export function encodeAction(a: FinalAction, decisionHash: Hex): Hex {
  switch (a.type) {
    case "pay":
      return encodeFunctionData({ abi: vaultAbi, functionName: "pay", args: [a.obligationId, decisionHash] });
    case "escalate":
      return encodeFunctionData({ abi: vaultAbi, functionName: "escalate", args: [a.obligationId, decisionHash] });
    case "redeem":
      return encodeFunctionData({ abi: vaultAbi, functionName: "redeem", args: [a.amount, decisionHash] });
    case "sweep":
      return encodeFunctionData({ abi: vaultAbi, functionName: "sweep", args: [a.amount, a.horizonSec, decisionHash] });
  }
}

export interface RunSummary {
  vault: string;
  skipped?: string;
  decisionId?: string;
  decisionHash?: Hex;
  actions?: { type: string; status: string; txHash: string | null; error: string | null }[];
  llmError?: string | null;
}

/**
 * Settles any action left SENT by a crashed run before a new decision is made.
 * Returns false if something is still genuinely in flight, in which case this run is skipped.
 */
async function reconcileInFlight(v: VaultRow): Promise<boolean> {
  const rows = await q<{ id: string; circle_tx_id: string | null; tx_hash: string | null; idempotency_key: string }>(
    `select a.id, a.circle_tx_id, a.tx_hash, a.idempotency_key from decision_actions a
     join decisions d on d.id = a.decision_id
     where d.vault_id = $1 and a.status in ('SENT', 'PENDING') and d.status = 'EXECUTING'`,
    [v.id],
  );
  for (const r of rows) {
    if (config.EXECUTOR === "circle" && r.circle_tx_id) {
      const res = await waitCircle(r.circle_tx_id);
      await q("update decision_actions set status = $2, tx_hash = $3, error = $4, updated_at = now() where id = $1", [
        r.id, res.ok ? "CONFIRMED" : "FAILED", res.txHash, res.error,
      ]);
    } else if (r.tx_hash) {
      const receipt = await publicClient.getTransactionReceipt({ hash: r.tx_hash as Hex }).catch(() => null);
      if (!receipt) return false;
      await q("update decision_actions set status = $2, updated_at = now() where id = $1", [r.id, receipt.status === "success" ? "CONFIRMED" : "FAILED"]);
    } else {
      // Never confirmed as sent. The state it was decided on is stale, so do not resend it.
      await q("update decision_actions set status = 'SKIPPED', error = 'interrupted before send; superseded', updated_at = now() where id = $1", [r.id]);
    }
  }
  await q(
    `update decisions d set status = case
        when not exists (select 1 from decision_actions a where a.decision_id = d.id and a.status <> 'CONFIRMED') then 'CONFIRMED'
        when exists (select 1 from decision_actions a where a.decision_id = d.id and a.status = 'CONFIRMED') then 'PARTIAL'
        else 'FAILED' end
     where d.vault_id = $1 and d.status = 'EXECUTING'`,
    [v.id],
  );
  return true;
}

export async function runVault(v: VaultRow, trigger: string): Promise<RunSummary> {
  const res = await withVaultLock(v.id, () => runLocked(v, trigger));
  return res ?? { vault: v.address, skipped: "another run holds the vault lock" };
}

async function runLocked(v: VaultRow, trigger: string): Promise<RunSummary> {
  if (!(await reconcileInFlight(v))) return { vault: v.address, skipped: "a transaction is still in flight" };

  const snapshot = await takeSnapshot(v);
  if (snapshot.state.agent.toLowerCase() !== v.agent_address.toLowerCase()) {
    return { vault: v.address, skipped: `agent revoked or changed on-chain (now ${snapshot.state.agent})` };
  }
  await emit(v.id, "snapshot", {
    liquidUsdc: fmt(snapshot.state.liquid),
    autonomousLimitUsdc: fmt(snapshot.state.autonomousLimit),
    openBills: snapshot.openObligations.length,
  });

  const pre = precompute(snapshot);
  const view = llmView(snapshot, pre);
  await emit(v.id, "deciding", { trigger, payable: pre.payable.length, mustEscalate: pre.mustEscalate.length, canSweep: pre.canSweep });
  const llm = await decide(view);
  await emit(v.id, "proposed", llm.output ? { actions: llm.output.actions, confidence: llm.output.confidence } : { error: llm.error });

  const policy = applyPolicy(snapshot, pre, llm.output);
  await emit(v.id, "policy_check", { actions: policy.actions, log: policy.log });

  const record = {
    version: 1,
    vault: getAddress(v.address),
    chainId: config.ARC_CHAIN_ID,
    trigger,
    snapshot,
    precomputed: pre,
    llm: {
      modelRequested: llm.modelRequested,
      modelServed: llm.modelServed,
      promptVersion: config.PROMPT_VERSION,
      effort: config.LLM_EFFORT,
      stopReason: llm.stopReason,
      error: llm.error,
      output: llm.output,
      ...(llm.fallbacks?.length ? { fallbacks: llm.fallbacks } : {}),
    },
    policy,
  };
  const canonical = canonicalJson(record);
  const decisionHash = hashCanonical(canonical);
  const parsed = JSON.parse(canonical);
  const decisionId = randomUUID();

  await q(
    `insert into decisions (id, vault_id, trigger, snapshot, precomputed, llm_output, policy_result, model, model_served,
                            prompt_version, canonical_json, decision_hash, status, error)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      decisionId, v.id, trigger, parsed.snapshot, parsed.precomputed, parsed.llm, parsed.policy, llm.modelRequested,
      llm.modelServed, config.PROMPT_VERSION, canonical, decisionHash, policy.actions.length ? "EXECUTING" : "HOLD", llm.error,
    ],
  );
  for (const [idx, a] of policy.actions.entries()) {
    await q(
      `insert into decision_actions (decision_id, idx, type, params, idempotency_key) values ($1,$2,$3,$4,$5)`,
      [decisionId, idx, a.type, JSON.parse(canonicalJson(a)), actionKey(decisionId, idx)],
    );
  }

  const results: NonNullable<RunSummary["actions"]> = [];
  for (const [idx, a] of policy.actions.entries()) {
    const data = encodeAction(a, decisionHash);
    const key = actionKey(decisionId, idx);
    const simError = await simulate({ to: v.address, data, from: v.agent_address });
    if (simError) {
      await q("update decision_actions set status = 'SIMULATION_FAILED', error = $3, updated_at = now() where decision_id = $1 and idx = $2", [decisionId, idx, simError]);
      results.push({ type: a.type, status: "SIMULATION_FAILED", txHash: null, error: simError });
      if (a.type === "pay") {
        // A non-vault revert on pay means the USDC transfer itself failed (e.g. blocklisted payee).
        await alertOwner(v.id, "pay_failed", `Bill #${a.obligationId} (${fmt(a.amount)} USDC) cannot be paid: ${simError}. Cancel the bill or remove the payee.`, { obligationId: a.obligationId });
      }
      continue;
    }
    await q("update decision_actions set status = 'SENT', updated_at = now() where decision_id = $1 and idx = $2", [decisionId, idx]);
    await emit(v.id, "sending", { type: a.type, idx });
    const r = await send({ to: v.address, data, from: v.agent_address, walletId: v.agent_wallet_id, idempotencyKey: key, refId: `${a.type}:${decisionId}:${idx}` });
    await q(
      "update decision_actions set status = $3, circle_tx_id = $4, tx_hash = $5, error = $6, updated_at = now() where decision_id = $1 and idx = $2",
      [decisionId, idx, r.ok ? "CONFIRMED" : "FAILED", r.circleTxId, r.txHash, r.error],
    );
    await emit(v.id, r.ok ? "confirmed" : "failed", { type: a.type, idx, txHash: r.txHash, error: r.error });
    results.push({ type: a.type, status: r.ok ? "CONFIRMED" : "FAILED", txHash: r.txHash, error: r.error });
  }

  if (!policy.actions.length) await emit(v.id, "confirmed", { hold: true });

  if (policy.actions.length) {
    const ok = results.filter((r) => r.status === "CONFIRMED").length;
    const status = ok === results.length ? "CONFIRMED" : ok > 0 ? "PARTIAL" : "FAILED";
    await q("update decisions set status = $2 where id = $1", [decisionId, status]);
  }
  return { vault: v.address, decisionId, decisionHash, actions: results, llmError: llm.error };
}
