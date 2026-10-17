import type { Snapshot, ObligationView } from "./snapshot.js";
import { HOUR, max, min } from "./units.js";

/** Everything here is computed in code from chain state. The LLM never produces a number that gates money. */

export const HORIZONS_H = [6, 24, 72, 168] as const;
const RECURRING_LOOKAHEAD = 7n * 24n * HOUR;
const MAX_OPEN_COMMITMENTS = 5;

export interface HorizonView {
  hours: number;
  dueTotal: bigint; // open bills (pending or escalated) due by now + h + grace, overdue included
  worstCaseLiquid: bigint; // liquid - dueTotal, with every inflow treated as zero
  weightedInflows: bigint; // sum(inflow x confidence) expected by now + h
  maxSweepWorstCase: bigint;
  maxSweepWithInflows: bigint;
}

export interface Precomputed {
  now: bigint;
  horizons: HorizonView[];
  maxSweepByFloor: bigint;
  canSweep: boolean;
  sweepBlockedReasons: string[];
  dailyRoom: bigint;
  payable: { id: number; amount: bigint; dueAt: bigint; source: string; hoursToDue: number }[];
  mustEscalate: { id: number; amount: bigint; dueAt: bigint; reason: string }[];
  blocked: { id: number; reason: string }[];
  materializable: number[];
}

/** Bills that will need liquid cash by time `by` (agent pays them, or the owner approves them). */
export function dueBy(s: Snapshot, by: bigint, exclude: Set<number> = new Set()): bigint {
  return s.openObligations
    .filter((o) => !exclude.has(o.id) && o.dueAt <= by)
    .reduce((a, o) => a + o.amount, 0n);
}

export function weightedInflowsBy(s: Snapshot, by: bigint): bigint {
  return s.expectedInflows
    .filter((i) => i.expectedAt <= by)
    .reduce((a, i) => a + (i.amount * BigInt(Math.round(i.confidence * 100))) / 100n, 0n);
}

/**
 * Largest sweep for a horizon. Worst case keeps every bill due by T (+ grace) in liquid, and never dips
 * below the floor. With inflows, the gap may be bridged by expected inflows x confidence, still never
 * below the floor (the contract enforces that part regardless).
 */
export function sweepCaps(s: Snapshot, horizonSec: bigint, liquid: bigint, paidIds: Set<number> = new Set()) {
  const T = s.now + horizonSec + s.state.grace;
  const due = dueBy(s, T, paidIds);
  const floor = s.state.minLiquid;
  const byFloor = max(0n, liquid - floor);
  const worstCase = min(byFloor, max(0n, liquid - max(floor, due)));
  const withInflows = min(byFloor, max(0n, liquid - max(floor, due - weightedInflowsBy(s, s.now + horizonSec))));
  return { due, worstCase, withInflows };
}

export function payeeProblem(s: Snapshot, o: ObligationView): string | null {
  const p = s.payees.find((x) => x.address.toLowerCase() === o.payee.toLowerCase());
  if (!p || !p.allowed) return "payee not on allowlist";
  if (p.activeAt > s.now) return `payee not live until ${new Date(Number(p.activeAt) * 1000).toISOString()}`;
  return null;
}

export function precompute(s: Snapshot): Precomputed {
  const st = s.state;
  const horizons = HORIZONS_H.map((h) => {
    const sec = BigInt(h) * HOUR;
    const caps = sweepCaps(s, sec, st.liquid);
    return {
      hours: h,
      dueTotal: caps.due,
      worstCaseLiquid: st.liquid - caps.due,
      weightedInflows: weightedInflowsBy(s, s.now + sec),
      maxSweepWorstCase: caps.worstCase,
      maxSweepWithInflows: caps.withInflows,
    };
  });

  const sweepBlockedReasons: string[] = [];
  if (st.paused) sweepBlockedReasons.push("vault paused");
  if (st.cooldownUntil > s.now) sweepBlockedReasons.push(`cooldown after a miss until ${new Date(Number(st.cooldownUntil) * 1000).toISOString()}`);
  if (s.openCommitments.length >= MAX_OPEN_COMMITMENTS) sweepBlockedReasons.push("5 unsettled commitments already open");
  if (st.liquid <= st.minLiquid) sweepBlockedReasons.push("liquid is at or below the floor");

  const dailyRoom = max(0n, st.dailyCap - st.dailySpent);
  const payable: Precomputed["payable"] = [];
  const mustEscalate: Precomputed["mustEscalate"] = [];
  const blocked: Precomputed["blocked"] = [];
  for (const o of s.openObligations) {
    if (o.status !== "PENDING") continue;
    const problem = payeeProblem(s, o);
    if (problem) {
      blocked.push({ id: o.id, reason: problem });
      continue;
    }
    if (o.amount > st.autonomousLimit) {
      mustEscalate.push({ id: o.id, amount: o.amount, dueAt: o.dueAt, reason: "above autonomous limit" });
    } else if (o.amount > dailyRoom) {
      mustEscalate.push({ id: o.id, amount: o.amount, dueAt: o.dueAt, reason: "would exceed today's daily cap" });
    } else {
      payable.push({
        id: o.id,
        amount: o.amount,
        dueAt: o.dueAt,
        source: o.source,
        hoursToDue: Math.round((Number(o.dueAt - s.now) / 3600) * 10) / 10,
      });
    }
  }
  payable.sort((a, b) => Number(a.dueAt - b.dueAt));

  const materializable = s.recurring.filter((r) => r.active && r.nextDueAt <= s.now + RECURRING_LOOKAHEAD).map((r) => r.id);

  return {
    now: s.now,
    horizons,
    maxSweepByFloor: max(0n, st.liquid - st.minLiquid),
    canSweep: sweepBlockedReasons.length === 0,
    sweepBlockedReasons,
    dailyRoom,
    payable,
    mustEscalate,
    blocked,
    materializable,
  };
}
