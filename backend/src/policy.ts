import { config } from "./config.js";
import type { LlmAction, LlmDecision } from "./llm.js";
import { sweepCaps, type Precomputed } from "./precompute.js";
import type { Snapshot } from "./snapshot.js";
import { HOUR, fmt, min, parse } from "./units.js";

export type FinalAction =
  | { type: "escalate"; obligationId: number; reason: string }
  | { type: "redeem"; amount: bigint; reason: string }
  | { type: "pay"; obligationId: number; amount: bigint; reason: string }
  | { type: "sweep"; amount: bigint; horizonSec: bigint; claim: string; reason: string };

export type Verdict = "accepted" | "clamped" | "converted" | "rejected" | "added";

export interface PolicyEntry {
  from: "llm" | "policy";
  proposed: LlmAction | null;
  verdict: Verdict;
  note: string;
  final: FinalAction | null;
}

export interface PolicyResult {
  actions: FinalAction[];
  log: PolicyEntry[];
}

const MIN_SWEEP = 1_000_000n; // 1 USDC
const MAX_HORIZON_H = 336;

function amountOf(a: LlmAction): bigint | null {
  if (!a.amountUsdc) return null;
  try {
    const v = parse(a.amountUsdc.trim());
    return v > 0n ? v : null;
  } catch {
    return null;
  }
}

/**
 * Mirrors every contract rule (so a doomed transaction is never sent), adds the soft sweep rules,
 * and a safety net: payable bills due very soon get paid and over-limit bills get escalated even if
 * the LLM forgot. Execution order is redeem -> pay -> escalate -> sweep.
 */
export function applyPolicy(s: Snapshot, p: Precomputed, d: LlmDecision | null): PolicyResult {
  const log: PolicyEntry[] = [];
  const llmActions = d?.actions ?? [];
  const payable = new Map(p.payable.map((b) => [b.id, b]));
  const mustEscalate = new Map(p.mustEscalate.map((b) => [b.id, b]));

  let liquid = s.state.liquid;
  let reserve = s.state.reserve;
  let dailyRoom = p.dailyRoom;
  const limit = s.state.autonomousLimit;

  const escalates: FinalAction[] = [];
  const redeems: FinalAction[] = [];
  const pays: FinalAction[] = [];
  let sweep: FinalAction | null = null;
  const paidIds = new Set<number>();
  const escalatedIds = new Set<number>();

  const reject = (a: LlmAction, note: string) => log.push({ from: "llm", proposed: a, verdict: "rejected", note, final: null });

  // 1. Redeems first: they only add liquid.
  for (const a of llmActions.filter((x) => x.type === "redeem")) {
    const amt = amountOf(a);
    if (amt === null) { reject(a, "missing or invalid amount"); continue; }
    if (reserve === 0n) { reject(a, "reserve is empty"); continue; }
    const take = min(amt, reserve);
    const f: FinalAction = { type: "redeem", amount: take, reason: a.reason };
    redeems.push(f);
    liquid += take;
    reserve -= take;
    log.push({ from: "llm", proposed: a, verdict: take < amt ? "clamped" : "accepted", note: take < amt ? `clamped to reserve ${fmt(take)}` : "", final: f });
  }

  // 2. Pays.
  const tryPay = (id: number, reason: string, proposed: LlmAction | null): boolean => {
    const from = proposed ? "llm" : "policy";
    const bill = s.openObligations.find((o) => o.id === id);
    if (!bill) { log.push({ from, proposed, verdict: "rejected", note: `bill ${id} is not open`, final: null }); return false; }
    if (paidIds.has(id)) { log.push({ from, proposed, verdict: "rejected", note: "duplicate pay in one decision", final: null }); return false; }
    if (mustEscalate.has(id) || bill.amount > limit || bill.amount > dailyRoom) {
      if (!escalatedIds.has(id) && bill.status === "PENDING") {
        const f: FinalAction = { type: "escalate", obligationId: id, reason: `converted from pay: ${bill.amount > limit ? "above autonomous limit" : "over daily cap"}` };
        escalates.push(f);
        escalatedIds.add(id);
        log.push({ from, proposed, verdict: "converted", note: "pay not allowed by limit/daily cap; escalated instead", final: f });
      }
      return false;
    }
    if (!payable.has(id)) {
      const blocked = p.blocked.find((b) => b.id === id);
      log.push({ from, proposed, verdict: "rejected", note: blocked ? blocked.reason : `bill ${id} is not payable (status ${bill.status})`, final: null });
      return false;
    }
    if (liquid < bill.amount) { log.push({ from, proposed, verdict: "rejected", note: `liquid ${fmt(liquid)} < ${fmt(bill.amount)}`, final: null }); return false; }
    const f: FinalAction = { type: "pay", obligationId: id, amount: bill.amount, reason };
    pays.push(f);
    paidIds.add(id);
    liquid -= bill.amount;
    dailyRoom -= bill.amount;
    log.push({ from, proposed, verdict: proposed ? "accepted" : "added", note: proposed ? "" : "safety net: due soon", final: f });
    return true;
  };

  for (const a of llmActions.filter((x) => x.type === "pay")) {
    if (a.obligationId === null) { reject(a, "missing obligationId"); continue; }
    tryPay(a.obligationId, a.reason, a);
  }

  // Safety net: anything payable and due within AUTO_PAY_WITHIN_HOURS gets paid, redeeming if needed.
  const soon = p.payable.filter((b) => !paidIds.has(b.id) && b.hoursToDue <= config.AUTO_PAY_WITHIN_HOURS);
  const soonTotal = soon.reduce((acc, b) => acc + b.amount, 0n);
  if (soonTotal > liquid && reserve > 0n) {
    const need = min(soonTotal - liquid, reserve);
    const f: FinalAction = { type: "redeem", amount: need, reason: "safety net: cash needed for bills due soon" };
    redeems.push(f);
    liquid += need;
    reserve -= need;
    log.push({ from: "policy", proposed: null, verdict: "added", note: "redeem to cover bills due soon", final: f });
  }
  for (const b of soon) tryPay(b.id, `due in ${b.hoursToDue}h`, null);

  // 3. Escalations: only bills the contract will accept as escalatable.
  for (const a of llmActions.filter((x) => x.type === "escalate")) {
    if (a.obligationId === null) { reject(a, "missing obligationId"); continue; }
    if (escalatedIds.has(a.obligationId)) continue;
    if (!mustEscalate.has(a.obligationId)) { reject(a, "bill is within the limit; the contract only accepts escalation above limit/daily cap"); continue; }
    const f: FinalAction = { type: "escalate", obligationId: a.obligationId, reason: a.reason };
    escalates.push(f);
    escalatedIds.add(a.obligationId);
    log.push({ from: "llm", proposed: a, verdict: "accepted", note: "", final: f });
  }
  for (const b of p.mustEscalate) {
    if (escalatedIds.has(b.id)) continue;
    const f: FinalAction = { type: "escalate", obligationId: b.id, reason: b.reason };
    escalates.push(f);
    escalatedIds.add(b.id);
    log.push({ from: "policy", proposed: null, verdict: "added", note: "safety net: owner must see this bill", final: f });
  }

  // 4. At most one sweep, sized against liquid after this decision's pays and redeems.
  const sweeps = llmActions.filter((x) => x.type === "sweep");
  sweeps.slice(1).forEach((a) => reject(a, "only one sweep per decision"));
  const a = sweeps[0];
  if (a) {
    const amt = amountOf(a);
    const llmRedeemed = redeems.length > 0;
    if (!p.canSweep) reject(a, `cannot sweep: ${p.sweepBlockedReasons.join("; ")}`);
    else if (llmRedeemed) reject(a, "redeem and sweep in one decision is churn");
    else if (amt === null) reject(a, "missing or invalid amount");
    else if (a.horizonHours === null) reject(a, "missing horizon");
    else if (!a.claim) reject(a, "missing claim");
    else {
      const hours = Math.min(MAX_HORIZON_H, Math.max(1, Math.round(a.horizonHours)));
      const horizonSec = BigInt(hours) * HOUR;
      const caps = sweepCaps(s, horizonSec, liquid, paidIds);
      const capped = min(amt, caps.withInflows);
      if (capped < MIN_SWEEP) {
        reject(a, `safe sweep for ${hours}h is ${fmt(caps.withInflows)} USDC (bills due ${fmt(caps.due)}, floor ${fmt(s.state.minLiquid)})`);
      } else {
        sweep = { type: "sweep", amount: capped, horizonSec, claim: a.claim, reason: a.reason };
        const notes: string[] = [];
        if (hours !== a.horizonHours) notes.push(`horizon clamped to ${hours}h`);
        if (capped < amt) notes.push(`amount clamped to ${fmt(capped)} (worst case ${fmt(caps.worstCase)}, with inflows x confidence ${fmt(caps.withInflows)})`);
        log.push({ from: "llm", proposed: a, verdict: notes.length ? "clamped" : "accepted", note: notes.join("; "), final: sweep });
      }
    }
  }

  for (const h of llmActions.filter((x) => x.type === "hold")) {
    log.push({ from: "llm", proposed: h, verdict: "accepted", note: "no-op", final: null });
  }

  // Escalations go after pays: an over-daily-cap escalation is only accepted once earlier pays used the room.
  return { actions: [...redeems, ...pays, ...escalates, ...(sweep ? [sweep] : [])], log };
}
