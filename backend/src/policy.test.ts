import { test } from "node:test";
import assert from "node:assert/strict";

// config.ts validates env at import time; give it a harmless local setup before loading modules.
process.env.DATABASE_URL ??= "postgres://unused";
process.env.EXECUTOR = "local";
process.env.AGENT_PRIVATE_KEY ??= "0x" + "01".repeat(32);
process.env.AUTO_PAY_WITHIN_HOURS = "2";

const { applyPolicy } = await import("./policy.js");
const { precompute } = await import("./precompute.js");
const { canonicalJson, hashCanonical } = await import("./canonical.js");
type Snapshot = import("./snapshot.js").Snapshot;
type LlmDecision = import("./llm.js").LlmDecision;

const U = 1_000_000n;
const NOW = 1_760_000_000n;
const H = 3600n;
const ALICE = "0x00000000000000000000000000000000000A11CE" as const;
const BOB = "0x0000000000000000000000000000000000000B0B" as const;

function snap(over: Partial<Snapshot["state"]> = {}, extra: Partial<Snapshot> = {}): Snapshot {
  return {
    vault: "0x0000000000000000000000000000000000000Fa1",
    block: 1n,
    now: NOW,
    state: {
      owner: ALICE, agent: BOB, paused: false,
      liquid: 1000n * U, reserve: 0n, score: 0n, autonomousLimit: 25n * U, dailyCap: 75n * U, dailySpent: 0n,
      cooldownUntil: 0n, minLiquid: 50n * U, grace: H, ownerCeiling: 1000n * U, ownerDailyCeiling: 3000n * U,
      obligationCount: 0, commitmentCount: 0, ...over,
    },
    openObligations: [],
    openCommitments: [],
    payees: [
      { address: ALICE, name: "Alice", allowed: true, activeAt: 0n, maxPerInvoice: 100n * U, maxPerMonth: 300n * U, monthSpent: 0n },
      { address: BOB, name: "Bob", allowed: false, activeAt: 0n, maxPerInvoice: 100n * U, maxPerMonth: 300n * U, monthSpent: 0n },
    ],
    recurring: [],
    expectedInflows: [],
    recentDecisions: [],
    recentSettlements: [],
    ...extra,
  };
}

const bill = (id: number, amount: bigint, dueIn: bigint, payee: `0x${string}` = ALICE) => ({
  id, payee, payeeName: null, amount, dueAt: NOW + dueIn, paidAt: 0n, ref: "0x", source: "OWNER" as const,
  status: "PENDING" as const, escalated: false, failedForLiquidity: false,
});

const decision = (actions: Partial<LlmDecision["actions"][number]>[]): LlmDecision => ({
  actions: actions.map((a) => ({ type: "hold", obligationId: null, amountUsdc: null, horizonHours: null, claim: null, reason: "r", ...a })) as LlmDecision["actions"],
  forecast: { lowPointUsdc: "0", lowPointAt: "", assumptions: [] },
  confidence: 0.5,
});

test("pay above the autonomous limit is converted to an escalation", () => {
  const s = snap({}, { openObligations: [bill(1, 80n * U, 24n * H)] });
  const r = applyPolicy(s, precompute(s), decision([{ type: "pay", obligationId: 1 }]));
  assert.deepEqual(r.actions.map((a) => a.type), ["escalate"]);
  assert.equal(r.log[0].verdict, "converted");
});

test("escalating a bill the agent could pay is rejected (no dodging the exam)", () => {
  const s = snap({}, { openObligations: [bill(1, 10n * U, 24n * H)] });
  const r = applyPolicy(s, precompute(s), decision([{ type: "escalate", obligationId: 1 }]));
  assert.equal(r.actions.length, 0);
  assert.equal(r.log[0].verdict, "rejected");
});

test("pay to a payee that is not allowlisted is rejected", () => {
  const s = snap({}, { openObligations: [bill(1, 10n * U, 24n * H, BOB)] });
  const r = applyPolicy(s, precompute(s), decision([{ type: "pay", obligationId: 1 }]));
  assert.equal(r.actions.length, 0);
  assert.match(r.log[0].note, /allowlist/);
});

test("pay of an unknown bill id is rejected", () => {
  const s = snap();
  const r = applyPolicy(s, precompute(s), decision([{ type: "pay", obligationId: 99 }]));
  assert.equal(r.actions.length, 0);
});

test("sweep is clamped so bills due in the window and the floor stay liquid", () => {
  // liquid 1000, floor 50, 300 due within 24h -> safe sweep 700
  const s = snap({}, { openObligations: [bill(1, 20n * U, 12n * H), { ...bill(2, 280n * U, 20n * H), status: "ESCALATED" as const }] });
  const r = applyPolicy(s, precompute(s), decision([{ type: "sweep", amountUsdc: "950", horizonHours: 24, claim: "c" }]));
  const sweep = r.actions.find((a) => a.type === "sweep");
  assert.ok(sweep && sweep.type === "sweep");
  assert.equal(sweep.amount, 700n * U);
  assert.equal(r.log.find((l) => l.final?.type === "sweep")?.verdict, "clamped");
});

test("expected inflows lift the sweep cap only by amount x confidence", () => {
  const s = snap({ liquid: 200n * U }, {
    openObligations: [bill(1, 20n * U, 12n * H)],
    expectedInflows: [{ id: "i", from: "Client A", amount: 100n * U, expectedAt: NOW + 6n * H, confidence: 0.8 }],
  });
  // worst case: 200 - max(50, 20) = 150. With inflows: due 20 - 80 < floor, still 150 (floor binds).
  const r = applyPolicy(s, precompute(s), decision([{ type: "sweep", amountUsdc: "190", horizonHours: 24, claim: "c" }]));
  const sweep = r.actions.find((a) => a.type === "sweep");
  assert.ok(sweep && sweep.type === "sweep");
  assert.equal(sweep.amount, 150n * U);
});

test("sweep during cooldown is rejected", () => {
  const s = snap({ cooldownUntil: NOW + H });
  const r = applyPolicy(s, precompute(s), decision([{ type: "sweep", amountUsdc: "100", horizonHours: 24, claim: "c" }]));
  assert.equal(r.actions.length, 0);
  assert.match(r.log[0].note, /cooldown/);
});

test("safety net pays a bill due soon even when the LLM is unavailable, redeeming if needed", () => {
  const s = snap({ liquid: 5n * U, reserve: 100n * U }, { openObligations: [bill(1, 20n * U, H)] });
  const r = applyPolicy(s, precompute(s), null);
  assert.deepEqual(r.actions.map((a) => a.type), ["redeem", "pay"]);
  const redeem = r.actions[0];
  assert.ok(redeem.type === "redeem" && redeem.amount === 15n * U);
});

test("safety net escalates over-limit bills the LLM ignored", () => {
  const s = snap({}, { openObligations: [bill(1, 80n * U, 48n * H)] });
  const r = applyPolicy(s, precompute(s), decision([{ type: "hold" }]));
  assert.deepEqual(r.actions.map((a) => a.type), ["escalate"]);
  assert.equal(r.log.find((l) => l.from === "policy")?.verdict, "added");
});

test("daily cap: second pay that would exceed it becomes an escalation", () => {
  const s = snap({ dailySpent: 60n * U }, { openObligations: [bill(1, 10n * U, 24n * H), bill(2, 10n * U, 24n * H)] });
  const r = applyPolicy(s, precompute(s), decision([{ type: "pay", obligationId: 1 }, { type: "pay", obligationId: 2 }]));
  assert.deepEqual(r.actions.map((a) => a.type), ["pay", "escalate"]);
});

test("bad amounts from the model are rejected, not guessed", () => {
  const s = snap({ reserve: 10n * U });
  const r = applyPolicy(s, precompute(s), decision([{ type: "redeem", amountUsdc: "lots" }, { type: "sweep", amountUsdc: "-5", horizonHours: 6, claim: "c" }]));
  assert.equal(r.actions.length, 0);
});

test("canonical JSON is key-order independent and hashes bigints as strings", () => {
  const a = canonicalJson({ b: 1n, a: { y: [1, undefined], x: "z" } });
  const b = canonicalJson({ a: { x: "z", y: [1, undefined] }, b: 1n });
  assert.equal(a, b);
  assert.equal(a, '{"a":{"x":"z","y":[1,null]},"b":"1"}');
  assert.equal(hashCanonical(a), hashCanonical(b));
});
