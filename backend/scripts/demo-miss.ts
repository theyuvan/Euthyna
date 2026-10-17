// Engineered miss on a labeled TEST vault, to exercise the contract's miss path on-chain.
//
// This is a demonstration, not an organic outcome, and it is labeled that way everywhere:
//   setup  — the owner lowers the test vault's floor, registers a small bill, and the agent's
//            wallet sweeps reserve with a deadline just after that bill is due (scripted, not an
//            LLM decision). Nobody pays the bill: automatic agent runs skip test vaults.
//   settle — once the commitment matures, settle() grades it: a MISS (score halves, sweeps freeze
//            for 24h). The script then restores the floor.
//
// The sweep's decisionHash is keccak256 of the canonical record written to demo-miss-record.json,
// which states in plain words that this is an engineered test.
//
//   npx tsx scripts/demo-miss.ts setup
//   npx tsx scripts/demo-miss.ts settle
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createWalletClient, encodeFunctionData, http, parseEventLogs, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { vaultAbi } from "../src/abi.js";
import { arcTestnet, publicClient } from "../src/chain.js";
import { canonicalJson, hashCanonical } from "../src/canonical.js";
import { config } from "../src/config.js";
import { one } from "../src/db.js";
import { send, simulate } from "../src/executor.js";
import { obligationRef } from "../src/units.js";

const VAULT = "0x4a08A58be01B5311D36EF4b042AA83BF738cF2b5" as const; // labeled test vault
const PAYEE = "0x6b9d413446ca93bec8d3f78745b1140a92eac964" as const; // its existing, live payee
const BILL = 300_000n; // 0.30 USDC
const SWEEP = 400_000n; // 0.40 USDC
const DEMO_FLOOR = 500_000n; // 0.50 USDC while the demo runs
const NORMAL_FLOOR = 1_000_000n; // 1.00 USDC, the vault's usual floor
const RECORD_FILE = new URL("./demo-miss-record.json", import.meta.url);

const owner = privateKeyToAccount(process.env.OWNER_PRIVATE_KEY as Hex);
const wallet = createWalletClient({ account: owner, chain: arcTestnet, transport: http(config.ARC_RPC_URL) });
const read = <T>(functionName: string, args: unknown[] = []) =>
  publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: functionName as never, args: args as never }) as Promise<T>;

async function ownerTx(functionName: string, args: unknown[]) {
  const data = encodeFunctionData({ abi: vaultAbi, functionName: functionName as never, args: args as never });
  const hash = await wallet.sendTransaction({ account: owner, chain: arcTestnet, to: VAULT, data });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted: ${hash}`);
  console.log(`${functionName}: ${hash}`);
  return receipt;
}

async function setup() {
  const minHorizon = Number(await read<bigint>("minHorizon"));
  const grace = Number(await read<bigint>("grace"));

  await ownerTx("setFloor", [DEMO_FLOOR]);

  const now = Math.floor(Date.now() / 1000);
  const dueAt = now + 8 * 60; // bill due in 8 minutes
  const invoice = `DEMO-MISS-${now}`;
  const billReceipt = await ownerTx("registerObligation", [PAYEE, BILL, BigInt(dueAt), obligationRef(PAYEE, invoice)]);
  const [ev] = parseEventLogs({ abi: vaultAbi, logs: billReceipt.logs, eventName: "ObligationRegistered" });
  const obligationId = Number(ev.args.id);

  // Deadline 2 minutes after the bill is due, so the commitment covers it.
  const T = dueAt + 120;
  const horizon = Math.max(minHorizon, T - Math.floor(Date.now() / 1000));
  const record = {
    version: 1,
    kind: "engineered-miss-demo",
    vault: VAULT,
    note:
      "Engineered test on a labeled test vault, not an agent decision: the agent's wallet sweeps reserve " +
      "covering the bill below, and the bill is deliberately left unpaid so settle() grades a miss.",
    obligationId,
    billUsdc: "0.30",
    sweepUsdc: "0.40",
    billDueAt: new Date(dueAt * 1000).toISOString(),
    horizonSec: horizon,
    graceSec: grace,
    createdAt: new Date().toISOString(),
  };
  const canonical = canonicalJson(record);
  const decisionHash = hashCanonical(canonical);

  const v = await one<{ agent_wallet_id: string | null; agent_address: Hex }>("select agent_wallet_id, agent_address from vaults where lower(address) = lower($1)", [VAULT]);
  if (!v) throw new Error("test vault not found in DB");
  const data = encodeFunctionData({ abi: vaultAbi, functionName: "sweep", args: [SWEEP, BigInt(horizon), decisionHash] });
  const simError = await simulate({ to: VAULT, data, from: v.agent_address });
  if (simError) throw new Error(`sweep simulation failed: ${simError}`);
  const r = await send({ to: VAULT, data, from: v.agent_address, walletId: v.agent_wallet_id, idempotencyKey: randomUUID(), refId: `demo-miss:${obligationId}` });
  if (!r.ok || !r.txHash) throw new Error(`sweep failed: ${r.error}`);
  const sweepReceipt = await publicClient.getTransactionReceipt({ hash: r.txHash as Hex });
  const [sw] = parseEventLogs({ abi: vaultAbi, logs: sweepReceipt.logs, eventName: "Swept" });
  console.log(`sweep (agent wallet): ${r.txHash}`);

  writeFileSync(RECORD_FILE, JSON.stringify({ ...record, canonical, decisionHash, commitmentId: Number(sw.args.cid), T: new Date(Number(sw.args.T) * 1000).toISOString(), txs: { sweep: r.txHash } }, null, 2));
  console.log(`commitment #${sw.args.cid}, T = ${new Date(Number(sw.args.T) * 1000).toLocaleString()}, settleable after T + ${grace}s`);
}

async function settle() {
  const rec = JSON.parse(readFileSync(RECORD_FILE, "utf8"));
  const cid = rec.commitmentId as number;
  const c = await read<{ settled: boolean; hit: boolean }>("getCommitment", [cid]);
  let settleTx: string | null = null;
  if (!c.settled) {
    const receipt = await ownerTx("settle", [cid]);
    settleTx = receipt.transactionHash;
    const [ev] = parseEventLogs({ abi: vaultAbi, logs: receipt.logs, eventName: "Settled" });
    console.log(`settled #${cid}: ${ev.args.hit ? "HIT" : "MISS"} · new score ${ev.args.newScore} · new limit ${ev.args.newLimit}`);
  } else {
    console.log(`#${cid} was already settled (by the backend settler): ${c.hit ? "HIT" : "MISS"}`);
  }
  await ownerTx("setFloor", [NORMAL_FLOOR]);
  const score = await read<bigint>("score");
  const cooldownUntil = await read<bigint>("cooldownUntil");
  writeFileSync(RECORD_FILE, JSON.stringify({ ...rec, txs: { ...rec.txs, settle: settleTx }, after: { score: score.toString(), cooldownUntil: new Date(Number(cooldownUntil) * 1000).toISOString() } }, null, 2));
  console.log(`score now ${score} · sweeps frozen until ${new Date(Number(cooldownUntil) * 1000).toLocaleString()}`);
}

const cmd = process.argv[2];
if (cmd === "setup") await setup();
else if (cmd === "settle") await settle();
else throw new Error('usage: npx tsx scripts/demo-miss.ts <setup|settle>');
process.exit(0);
