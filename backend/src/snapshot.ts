import { getAddress, type Address } from "viem";
import { vaultAbi } from "./abi.js";
import { publicClient } from "./chain.js";
import { q, type VaultRow } from "./db.js";
import { parse } from "./units.js";

export const OSTATUS = ["PENDING", "ESCALATED", "PAID", "CANCELLED"] as const;
export const SOURCE = ["OWNER", "AGENT"] as const;

export interface ObligationView {
  id: number;
  payee: Address;
  payeeName: string | null;
  amount: bigint;
  dueAt: bigint;
  paidAt: bigint;
  ref: string;
  source: (typeof SOURCE)[number];
  status: (typeof OSTATUS)[number];
  escalated: boolean;
  failedForLiquidity: boolean;
}

export interface CommitmentView {
  id: number;
  amount: bigint;
  remaining: bigint;
  openedAt: bigint;
  T: bigint;
  coverTo: number;
  limitAtOpen: bigint;
  capitalSecondsNow: bigint;
  decisionHash: string;
}

export interface PayeeView {
  address: Address;
  name: string | null;
  allowed: boolean;
  activeAt: bigint;
  maxPerInvoice: bigint;
  maxPerMonth: bigint;
  monthSpent: bigint;
}

export interface RecurringView {
  id: number;
  payee: Address;
  amount: bigint;
  everySeconds: bigint;
  nextDueAt: bigint;
  active: boolean;
}

export interface InflowView {
  id: string;
  from: string;
  amount: bigint;
  expectedAt: bigint;
  confidence: number;
}

export interface Snapshot {
  vault: Address;
  block: bigint;
  now: bigint;
  state: {
    owner: Address;
    agent: Address;
    paused: boolean;
    liquid: bigint;
    reserve: bigint;
    score: bigint;
    autonomousLimit: bigint;
    dailyCap: bigint;
    dailySpent: bigint;
    cooldownUntil: bigint;
    minLiquid: bigint;
    grace: bigint;
    ownerCeiling: bigint;
    ownerDailyCeiling: bigint;
    obligationCount: number;
    commitmentCount: number;
  };
  openObligations: ObligationView[];
  openCommitments: CommitmentView[];
  payees: PayeeView[];
  recurring: RecurringView[];
  expectedInflows: InflowView[];
  recentDecisions: { at: string; status: string; actions: unknown }[];
  recentSettlements: { id: number; hit: boolean; credit: string; settledAt: string | null }[];
}

const SCAN_LAST_OBLIGATIONS = 300;

async function inBatches<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

export async function readObligation(vault: Address, id: number): Promise<ObligationView> {
  const o = await publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "getObligation", args: [id] });
  return {
    id,
    payee: o.payee,
    payeeName: null,
    amount: o.amount,
    dueAt: o.dueAt,
    paidAt: o.paidAt,
    ref: o.ref,
    source: SOURCE[o.source],
    status: OSTATUS[o.status],
    escalated: o.escalated,
    failedForLiquidity: o.failedForLiquidity,
  };
}

export async function takeSnapshot(v: VaultRow): Promise<Snapshot> {
  const vault = getAddress(v.address);
  const block = await publicClient.getBlock({ blockTag: "latest" });
  const at = { address: vault, abi: vaultAbi, blockNumber: block.number } as const;

  const [
    owner, agent, paused, liquid, reserve, score, autonomousLimit, dailyCap, dailySpent,
    cooldownUntil, minLiquid, grace, ownerCeiling, ownerDailyCeiling, obligationCount, commitmentCount,
    openIds, recurringCount,
  ] = await Promise.all([
    publicClient.readContract({ ...at, functionName: "owner" }),
    publicClient.readContract({ ...at, functionName: "agent" }),
    publicClient.readContract({ ...at, functionName: "paused" }),
    publicClient.readContract({ ...at, functionName: "liquid" }),
    publicClient.readContract({ ...at, functionName: "reserve" }),
    publicClient.readContract({ ...at, functionName: "score" }),
    publicClient.readContract({ ...at, functionName: "autonomousLimit" }),
    publicClient.readContract({ ...at, functionName: "dailyCap" }),
    publicClient.readContract({ ...at, functionName: "currentDailySpent" }),
    publicClient.readContract({ ...at, functionName: "cooldownUntil" }),
    publicClient.readContract({ ...at, functionName: "minLiquid" }),
    publicClient.readContract({ ...at, functionName: "grace" }),
    publicClient.readContract({ ...at, functionName: "ownerCeiling" }),
    publicClient.readContract({ ...at, functionName: "ownerDailyCeiling" }),
    publicClient.readContract({ ...at, functionName: "obligationCount" }),
    publicClient.readContract({ ...at, functionName: "commitmentCount" }),
    publicClient.readContract({ ...at, functionName: "openCommitmentIds" }),
    publicClient.readContract({ ...at, functionName: "recurringCount" }),
  ]);

  // Obligations: scan the most recent ones and keep those still open.
  const firstId = Math.max(1, obligationCount - SCAN_LAST_OBLIGATIONS + 1);
  const ids = Array.from({ length: Math.max(0, obligationCount - firstId + 1) }, (_, i) => firstId + i);
  const allObl = await inBatches(ids, 25, (id) => readObligation(vault, id));
  const openObligations = allObl.filter((o) => o.status === "PENDING" || o.status === "ESCALATED");

  const openCommitments = await Promise.all(
    openIds.map(async (cid) => {
      const [c, cs] = await Promise.all([
        publicClient.readContract({ ...at, functionName: "getCommitment", args: [cid] }),
        publicClient.readContract({ ...at, functionName: "pendingCapitalSeconds", args: [cid] }),
      ]);
      return {
        id: cid,
        amount: c.amount,
        remaining: c.remaining,
        openedAt: c.openedAt,
        T: c.T,
        coverTo: c.coverTo,
        limitAtOpen: c.limitAtOpen,
        capitalSecondsNow: cs,
        decisionHash: c.decisionHash,
      } satisfies CommitmentView;
    }),
  );

  const recurring = await inBatches(
    Array.from({ length: recurringCount }, (_, i) => i + 1),
    25,
    async (rid) => {
      const r = await publicClient.readContract({ ...at, functionName: "getRecurring", args: [rid] });
      return { id: rid, payee: r.payee, amount: r.amount, everySeconds: r.everySeconds, nextDueAt: r.nextDueAt, active: r.active };
    },
  );

  // Payees: everyone the DB knows about plus anyone an open bill or schedule points at.
  const dbPayees = await q<{ address: string; display_name: string | null }>(
    "select address, display_name from payees where vault_id = $1",
    [v.id],
  );
  const names = new Map(dbPayees.map((p) => [p.address.toLowerCase(), p.display_name]));
  const payeeAddrs = new Set<string>([
    ...dbPayees.map((p) => p.address.toLowerCase()),
    ...openObligations.map((o) => o.payee.toLowerCase()),
    ...recurring.map((r) => r.payee.toLowerCase()),
  ]);
  const payees = await Promise.all(
    [...payeeAddrs].map(async (a) => {
      const addr = getAddress(a);
      const p = await publicClient.readContract({ ...at, functionName: "getPayee", args: [addr] });
      return {
        address: addr,
        name: names.get(a) ?? null,
        allowed: p.allowed,
        activeAt: p.activeAt,
        maxPerInvoice: p.maxPerInvoice,
        maxPerMonth: p.maxPerMonth,
        monthSpent: p.monthSpent,
      } satisfies PayeeView;
    }),
  );
  for (const o of openObligations) o.payeeName = names.get(o.payee.toLowerCase()) ?? null;

  const inflows = await q<{ id: string; from_name: string; amount: string; expected_at: Date; confidence: string }>(
    `select id, from_name, amount::text, expected_at, confidence::text from expected_inflows
     where vault_id = $1 and received_at is null and expected_at > now() - interval '3 days'
     order by expected_at`,
    [v.id],
  );
  const recentDecisions = await q<{ created_at: Date; status: string; actions: unknown }>(
    `select d.created_at, d.status,
            coalesce((select json_agg(json_build_object('type', a.type, 'params', a.params, 'status', a.status) order by a.idx)
                      from decision_actions a where a.decision_id = d.id), '[]'::json) as actions
     from decisions d where d.vault_id = $1 order by d.created_at desc limit 10`,
    [v.id],
  );
  const recentSettlements = await q<{ chain_id: number; hit: boolean; credit: string; settled_at: Date | null }>(
    `select chain_id, hit, credit::text, settled_at from commitments
     where vault_id = $1 and settled order by chain_id desc limit 5`,
    [v.id],
  );

  return {
    vault,
    block: block.number,
    now: block.timestamp,
    state: {
      owner, agent, paused, liquid, reserve, score, autonomousLimit, dailyCap, dailySpent, cooldownUntil,
      minLiquid, grace, ownerCeiling, ownerDailyCeiling, obligationCount, commitmentCount,
    },
    openObligations,
    openCommitments,
    payees,
    recurring,
    expectedInflows: inflows.map((i) => ({
      id: i.id,
      from: i.from_name,
      amount: parse(i.amount),
      expectedAt: BigInt(Math.floor(i.expected_at.getTime() / 1000)),
      confidence: Number(i.confidence),
    })),
    recentDecisions: recentDecisions.map((d) => ({ at: d.created_at.toISOString(), status: d.status, actions: d.actions })),
    recentSettlements: recentSettlements.map((s) => ({
      id: s.chain_id,
      hit: s.hit,
      credit: s.credit,
      settledAt: s.settled_at?.toISOString() ?? null,
    })),
  };
}
