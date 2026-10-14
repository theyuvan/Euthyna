// End-to-end test of the whole backend against a local Anvil chain and a scratch Postgres.
// A mock USDC is placed at Arc's USDC address so every code path (indexer included) runs unchanged.
// The model is replaced by stub decisions (recorded as model "stub"); everything else is real:
// factory indexing, snapshot, policy, hashing, execution, settlement, API replay checks.
//
//   anvil --chain-id 5042002 --port 8546
//   DATABASE_URL=postgres://... npm run e2e:local
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestClient, createWalletClient, http, keccak256, parseEventLogs, stringToHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = process.env.E2E_RPC ?? "http://127.0.0.1:8546";
// Anvil's default dev keys (public, test only).
const KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
] as Hex[];
const [deployer, owner, agent, alice] = KEYS.map((k) => privateKeyToAccount(k));
const stubFile = join(mkdtempSync(join(tmpdir(), "euthyna-")), "decision.json");

Object.assign(process.env, {
  ARC_RPC_URL: RPC,
  EXECUTOR: "local",
  AGENT_PRIVATE_KEY: KEYS[2],
  LLM_STUB_FILE: stubFile,
  AUTO_PAY_WITHIN_HOURS: "2",
  ADMIN_TOKEN: "e2e-admin",
  PORT: "0",
});
delete process.env.ANTHROPIC_API_KEY;

const { arcTestnet, publicClient, USDC } = await import("../src/chain.js");
const { factoryAbi, factoryBytecode, vaultAbi } = await import("../src/abi.js");
const { parse } = await import("../src/units.js");

const test = createTestClient({ mode: "anvil", chain: arcTestnet, transport: http(RPC) });
const wallet = (acc: (typeof deployer)) => createWalletClient({ account: acc, chain: arcTestnet, transport: http(RPC) });
const wait = async (hash: Hex) => {
  const r = await publicClient.waitForTransactionReceipt({ hash });
  assert.equal(r.status, "success", `tx reverted ${hash}`);
  return r;
};
const warp = async (seconds: bigint) => {
  await test.increaseTime({ seconds: Number(seconds) });
  await test.mine({ blocks: 1 });
};
const stub = (actions: object[]) =>
  writeFileSync(stubFile, JSON.stringify({ actions, forecast: { lowPointUsdc: "0", lowPointAt: "", assumptions: [] }, confidence: 0.7 }));
const action = (a: object) => ({ obligationId: null, amountUsdc: null, horizonHours: null, claim: null, reason: "test", ...a });
const H = 3600n;
const step = (s: string) => console.log(`\n== ${s}`);

// 1. Mock USDC at the Arc USDC address, factory deployed.
step("chain setup");
const outDir = fileURLToPath(new URL("../../contracts/out/", import.meta.url));
const mock = JSON.parse(readFileSync(join(outDir, "MockUSDC.sol", "MockUSDC.json"), "utf8"));
await test.setCode({ address: USDC, bytecode: mock.deployedBytecode.object });
const mockAbi = mock.abi;
const params = { baseLimit: parse("25"), rateBps: 20000, ownerCeiling: parse("1000"), ownerDailyCeiling: parse("3000"), minLiquid: parse("50"), grace: H, payeeDelay: H };
const dep = await wait(await wallet(deployer).deployContract({ abi: factoryAbi, bytecode: factoryBytecode, args: [USDC, params] }));
const factory = dep.contractAddress!;
const { config } = await import("../src/config.js"); // already loaded by chain.ts: set directly
config.FACTORY_ADDRESS = factory;
config.FACTORY_START_BLOCK = dep.blockNumber;
console.log("factory", factory);

const { pool, q, one, activeVaults } = await import("../src/db.js");
const { indexAll } = await import("../src/indexer.js");
const { runVault } = await import("../src/agent.js");
const { settleVault } = await import("../src/settler.js");
const { createServer } = await import("../src/server.js");

step("schema");
await pool.query("drop schema public cascade; create schema public;");
await pool.query(readFileSync(fileURLToPath(new URL("../../db/schema.sql", import.meta.url)), "utf8"));

// 2. Owner creates a vault for the agent, funds it, adds a payee, registers real bills.
step("vault setup");
const created = await wait(await wallet(owner).writeContract({ address: factory, abi: factoryAbi, functionName: "createVault", args: [agent.address] }));
const vault = parseEventLogs({ abi: factoryAbi, logs: created.logs, eventName: "VaultCreated" })[0].args.vault;
await wait(await wallet(deployer).writeContract({ address: USDC, abi: mockAbi, functionName: "mint", args: [vault, parse("1000")] }));
await wait(await wallet(owner).writeContract({ address: vault, abi: vaultAbi, functionName: "addPayee", args: [alice.address, parse("100"), parse("300")] }));
await warp(H);
const now = async () => (await publicClient.getBlock()).timestamp;
const ownerBill = async (amount: string, dueIn: bigint, inv: string) => {
  const r = await wait(await wallet(owner).writeContract({
    address: vault, abi: vaultAbi, functionName: "registerObligation",
    args: [alice.address, parse(amount), (await now()) + dueIn, keccak256(stringToHex(`${alice.address}:${inv}`))],
  }));
  return parseEventLogs({ abi: vaultAbi, logs: r.logs, eventName: "ObligationRegistered" })[0].args.id;
};
const rent = await ownerBill("20", 12n * H, "rent-1");
const tea = await ownerBill("10", 90n * 60n, "tea-1");
const big = await ownerBill("80", 20n * H, "printer-1");
console.log("vault", vault, "bills", { rent, tea, big });

// 3. Indexer discovers the vault from the factory event.
step("index");
await indexAll();
const vaults = await activeVaults();
assert.equal(vaults.length, 1);
assert.equal(vaults[0].address, vault.toLowerCase());
const v = vaults[0];

// 4. Decision 1: the "model" pays rent and over-asks on the sweep.
step("decision 1: pay + sweep (+ safety net)");
stub([
  action({ type: "pay", obligationId: rent, reason: "rent due in 12h" }),
  action({ type: "sweep", amountUsdc: "900", horizonHours: 24, claim: "All owner bills due before T are paid on time" }),
]);
const r1 = await runVault(v, "e2e");
console.log(JSON.stringify(r1.actions));
assert.deepEqual(r1.actions!.map((a) => `${a.type}:${a.status}`), ["pay:CONFIRMED", "pay:CONFIRMED", "escalate:CONFIRMED", "sweep:CONFIRMED"]);
const reserve = await publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "reserve" });
// liquid 970 after pays; cash needed by T + grace: the escalated 80 (owner may approve it) -> 970 - 80 = 890
assert.equal(reserve, parse("890"), "sweep clamped to the safe amount");

await indexAll();
const d1 = await one("select * from decisions where id = $1", [r1.decisionId]);
assert.equal(d1.model, "stub");
const com = await one("select * from commitments where vault_id = $1 and chain_id = 1", [v.id]);
assert.equal(com.decision_id, r1.decisionId, "commitment linked to its decision via decisionHash");

// 5. API: replay verifies the hash against the chain.
step("api replay");
const server = createServer().listen(0);
await new Promise((res) => server.once("listening", res));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
const replay = await (await fetch(`${base}/api/decisions/${r1.decisionId}`)).json();
console.log(replay.verify);
assert.equal(replay.verify.hashMatches, true);
assert.equal(replay.verify.columnsMatch, true);
assert.equal(replay.verify.onchainMatches, true);
assert.equal(replay.onchain.length, 4);

// 6. Settle after T + grace: a hit, credit = min(890 avg, 30 paid) x 1 day / 30 days = 1 USDC.
step("settle hit");
await warp(26n * H);
const s1 = await settleVault(v);
console.log(s1);
assert.deepEqual(s1.settled, [1]);
await indexAll();
const settled = await one("select * from commitments where vault_id = $1 and chain_id = 1", [v.id]);
assert.equal(settled.hit, true);
assert.equal(settled.credit, "1.000000");
assert.equal(settled.limit_after, "27.000000");

// 7. A miss: owner bill due in 3h, the "model" sweeps and never pays; safety net is 2h so it skips it at decision time.
step("miss");
const late = await ownerBill("15", 3n * H, "helper-1");
stub([action({ type: "sweep", amountUsdc: "100", horizonHours: 6, claim: "All owner bills due before T are paid on time" })]);
const r2 = await runVault(v, "e2e");
assert.deepEqual(r2.actions!.map((a) => a.type), ["sweep"]);
await warp(8n * H);
const s2 = await settleVault(v);
assert.deepEqual(s2.settled, [2]);
await indexAll();
const missed = await one("select * from commitments where vault_id = $1 and chain_id = 2", [v.id]);
assert.equal(missed.hit, false);
assert.equal(missed.score_after, "0.500000");
console.log("late bill", late, "-> miss; score", missed.score_after, "limit", missed.limit_after);

// 8. Cooldown: next sweep is rejected by policy before it reaches the chain.
step("cooldown");
stub([action({ type: "sweep", amountUsdc: "50", horizonHours: 6, claim: "c" })]);
const r3 = await runVault(v, "e2e");
const d3 = await one("select policy_result from decisions where id = $1", [r3.decisionId]);
assert.match(JSON.stringify(d3.policy_result.log), /cooldown/);

// 9. Trust chart + stats.
step("trust + stats");
const trust = await (await fetch(`${base}/api/vaults/${vault}/trust`)).json();
console.log(trust.points.map((p: any) => `${p.hit ? "hit" : "miss"} limit=${p.limit}`));
assert.equal(trust.points.length, 2);
const stats = await (await fetch(`${base}/api/stats`)).json();
console.log(stats);
assert.equal(Number(stats.hits), 1);
assert.equal(Number(stats.misses), 1);

// 10. Tampering with a stored record is detected.
step("tamper");
await q("update decisions set canonical_json = replace(canonical_json, '\"rent due in 12h\"', '\"edited\"') where id = $1", [r1.decisionId]);
const tampered = await (await fetch(`${base}/api/decisions/${r1.decisionId}`)).json();
assert.equal(tampered.verify.hashMatches, false);
console.log("tampered record:", tampered.verify);

// 11. Owner-signed write: expected inflow.
step("owner auth");
const ts = Math.floor(Date.now() / 1000);
const { ownerMessage } = await import("../src/server.js");
const sig = await wallet(owner).signMessage({ message: ownerMessage(vault, "add-inflow", ts) });
const body = JSON.stringify({ fromName: "Client A", amountUsdc: "120", expectedAt: new Date(Date.now() + 86400e3).toISOString(), confidence: 0.8 });
const okRes = await fetch(`${base}/api/vaults/${vault}/inflows`, { method: "POST", headers: { "content-type": "application/json", "x-euthyna-auth": `${ts}.${sig}` }, body });
assert.equal(okRes.status, 201);
const badSig = await wallet(alice).signMessage({ message: ownerMessage(vault, "add-inflow", ts) });
const badRes = await fetch(`${base}/api/vaults/${vault}/inflows`, { method: "POST", headers: { "content-type": "application/json", "x-euthyna-auth": `${ts}.${badSig}` }, body });
assert.equal(badRes.status, 403);

server.close();
await pool.end();
console.log("\nE2E OK");
process.exit(0);
