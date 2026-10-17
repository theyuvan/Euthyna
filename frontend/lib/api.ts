// Thin client over the real worker API. No mocking, no fallback data — every shape here matches
// what backend/src/server.ts actually returns, verified live against the real backend.

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8787";

// The vault the dashboard opens to by default. Overridable via the vault switcher in the sidebar
// (stored in localStorage — a per-viewer convenience, never trusted as the source of truth).
export const DEFAULT_VAULT = "0x0767f13610b794f1de85CEe78728114df1Ffa23d";

/** Thrown on a non-2xx response; carries the backend's `code` (e.g. "RPC_UNAVAILABLE") when it
 *  sent one, so the UI can show a targeted message instead of a raw error dump. */
export class ApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error ?? `${res.status} ${res.statusText}`, body.code);
  }
  return res.json();
}

/** Real owner auth, per the backend's requireOwner: a wallet signature over a fixed message,
 *  minted fresh by lib/wallet.ts's ownerAuthHeader() for each call (it's timestamp-bound, 10 min). */
export interface OwnerAuth {
  vault: string;
  action: string;
  from: string;
}

async function post<T>(path: string, body: unknown, auth?: OwnerAuth): Promise<T> {
  let headers: Record<string, string> = { "content-type": "application/json" };
  if (auth) {
    const { ownerAuthHeader } = await import("./wallet");
    headers["x-euthyna-auth"] = await ownerAuthHeader(auth.vault, auth.action, auth.from);
  }
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `${res.status} ${res.statusText}`);
  return json;
}

export interface Stats {
  businesses: string;
  independent_businesses?: string;
  vaults: string;
  bills_paid_autonomously: string;
  usdc_paid: string;
  distinct_payees_paid: string;
  commitments_opened: string;
  commitments_settled: string;
  hits: string;
  misses: string;
  capital_usdc_days: string;
  escalations: string;
  approvals: string;
  blocked_by_contract: string;
  blocked_or_clamped_by_policy: string;
}
export const getStats = () => get<Stats>("/api/stats");
/** Asks the backend to index the chain now (public, no-op beyond that), so a new tx shows up fast. */
export const nudgeIndexer = () => fetch(`${BASE}/webhooks/circle`, { method: "POST" }).catch(() => {});

/** One row per business (distinct owner wallet), active non-test vaults only. */
export interface Business {
  owner: string;
  builder: boolean;
  business: string | null;
  joined_at: string;
  vaults: string[];
  bills_paid_autonomously: number;
  usdc_paid: string;
  commitments_opened: number;
  hits: number;
  misses: number;
}
export const getBusinesses = () => get<Business[]>("/api/businesses");

export interface VaultSummary {
  id: string;
  address: string;
  owner_address: string;
  agent_address: string;
  active: boolean;
  is_test: boolean;
  created_at: string;
  business: string | null;
}
export const getVaults = (owner?: string) => get<VaultSummary[]>(`/api/vaults${owner ? `?owner=${owner}` : ""}`);

export interface VaultState {
  address: string;
  owner: string;
  agent: string;
  paused: boolean;
  liquid: string;
  reserve: string;
  score: string;
  autonomousLimit: string;
  dailyCap: string;
  dailySpent: string;
  floor: string;
  ownerCeiling: string;
  cooldownUntil: string | null;
  isTest: boolean;
  alerts: OwnerAlert[];
}
export interface OwnerAlert {
  id: string;
  vault_id: string;
  kind: string;
  message: string;
  data: unknown;
  resolved_at: string | null;
  created_at: string;
}
export const getVault = (vault: string) => get<VaultState>(`/api/vaults/${vault}`);

export interface Obligation {
  vault_id: string;
  chain_id: number;
  ref: string;
  payee: string;
  payee_name: string | null;
  amount: string;
  due_at: string;
  source: "OWNER" | "AGENT";
  status: "PENDING" | "ESCALATED" | "PAID" | "CANCELLED";
  escalated: boolean;
  failed_for_liquidity: boolean;
  paid_at: string | null;
  invoice_number: string | null;
  note: string | null;
  invoice_file_url: string | null;
  extracted_json: unknown;
  updated_at: string;
}
export const getObligations = (vault: string) => get<Obligation[]>(`/api/vaults/${vault}/obligations`);

export interface Payee {
  vault_id: string;
  address: string;
  display_name: string | null;
  aliases: string[];
  max_per_invoice: string | null;
  max_per_month: string | null;
  active_at: string | null;
  allowed: boolean;
}
export const getPayees = (vault: string) => get<Payee[]>(`/api/vaults/${vault}/payees`);

export interface Commitment {
  vault_id: string;
  chain_id: number;
  amount: string;
  remaining: string;
  opened_at: string;
  t: string;
  cover_to: number;
  limit_at_open: string;
  capital_usdc_days: string;
  decision_hash: string | null;
  decision_id: string | null;
  settled: boolean;
  hit: boolean | null;
  credit: string | null;
  score_after: string | null;
  limit_after: string | null;
  settled_at: string | null;
  updated_at: string;
}
export const getCommitments = (vault: string) => get<Commitment[]>(`/api/vaults/${vault}/commitments`);

export interface TrustPoint {
  at: string;
  cid: number;
  hit: boolean;
  credit: string;
  score: string;
  limit: string;
}
export interface Trust {
  start: { at: string; limit: string; score: string };
  points: TrustPoint[];
}
export const getTrust = (vault: string) => get<Trust>(`/api/vaults/${vault}/trust`);

export interface DecisionRow {
  id: string;
  created_at: string;
  trigger: string;
  status: string;
  decision_hash: string;
  model: string;
  model_served: string | null;
  error: string | null;
  llm: { actions: DecisionAction[]; forecast: unknown; confidence: number } | null;
  policy_log: unknown[];
  actions: { type: string; status: string; tx_hash: string | null; error: string | null }[];
}
export interface DecisionAction {
  type: string;
  obligationId: number | null;
  amountUsdc: string | null;
  horizonHours: number | null;
  claim: string | null;
  reason: string;
}
export const getDecisions = (vault: string, limit = 50) => get<DecisionRow[]>(`/api/vaults/${vault}/decisions?limit=${limit}`);

export interface DecisionReplay {
  decision: Record<string, unknown> & { canonical_json: string; decision_hash: string };
  actions: { explorer: string | null }[];
  onchain: { explorer: string; name: string }[];
  verify: {
    storedHash: string;
    recomputedHash: string;
    hashMatches: boolean;
    columnsMatch: boolean;
    onchainMatches: boolean;
  };
}
export const getDecisionReplay = (id: string) => get<DecisionReplay>(`/api/decisions/${id}`);

export interface InflowRow {
  id: string;
  vault_id: string;
  from_name: string;
  amount: string;
  expected_at: string;
  confidence: string;
  received_at: string | null;
  created_at: string;
}
export const getInflows = (vault: string) => get<InflowRow[]>(`/api/vaults/${vault}/inflows`);

export interface AgentWallet {
  walletId: string | null;
  address: string;
  factory: string | null;
  note?: string;
}
/** Step 1 of onboarding: no auth needed, this is the public self-serve entry point. */
export const createAgentWallet = () => post<AgentWallet>("/api/agent-wallets", {});

export const explorerTx = (hash: string) => `https://testnet.arcscan.app/tx/${hash}`;
export const explorerAddress = (addr: string) => `https://testnet.arcscan.app/address/${addr}`;
export const short = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

// --- owner writes: real wallet-signature auth (see lib/wallet.ts ownerAuthHeader) ---
const ownerAuth = (vault: string, action: string, from: string): OwnerAuth => ({ vault, action, from });

export const resolveAlert = (vault: string, id: string, from: string) =>
  post(`/api/vaults/${vault}/alerts/${id}/resolve`, {}, ownerAuth(vault, "resolve-alert", from));
export const setBusinessName = (vault: string, name: string, from: string) =>
  post(`/api/vaults/${vault}/business`, { name }, ownerAuth(vault, "business", from));
export const runAgentNow = (vault: string, from: string) => post(`/api/vaults/${vault}/run`, {}, ownerAuth(vault, "run", from));
export const settleNow = (vault: string, from: string) => post(`/api/vaults/${vault}/settle`, {}, ownerAuth(vault, "settle", from));
export const addInflow = (
  vault: string,
  body: { fromName: string; amountUsdc: string; expectedAt: string; confidence: 0.5 | 0.8 | 0.95 },
  from: string,
) => post(`/api/vaults/${vault}/inflows`, body, ownerAuth(vault, "add-inflow", from));

export interface PrepareTx {
  to: string;
  data: string;
  functionName: string;
  args: Record<string, unknown>;
  ref?: string;
}
export const prepareAddPayee = (
  vault: string,
  body: { address: string; maxPerInvoiceUsdc: string; maxPerMonthUsdc: string; displayName?: string },
  from: string,
) => post<PrepareTx>(`/api/vaults/${vault}/onboard/payee`, body, ownerAuth(vault, "onboard-payee", from));
export const prepareRegisterObligation = (
  vault: string,
  body: { payee: string; amountUsdc: string; dueAt: string; invoiceNumber: string },
  from: string,
) => post<PrepareTx>(`/api/vaults/${vault}/onboard/obligation`, body, ownerAuth(vault, "onboard-obligation", from));
export const prepareCancelObligation = (vault: string, id: number, from: string) =>
  post<PrepareTx>(`/api/vaults/${vault}/onboard/obligations/${id}/cancel`, {}, ownerAuth(vault, "onboard-cancel", from));
export const prepareApproveEscalation = (vault: string, id: number, from: string) =>
  post<PrepareTx>(
    `/api/vaults/${vault}/onboard/obligations/${id}/approve-escalation`,
    {},
    ownerAuth(vault, "onboard-approve-escalation", from),
  );
