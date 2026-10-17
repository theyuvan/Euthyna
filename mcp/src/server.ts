import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { encodeFunctionData, encodePacked, getAddress, isAddress, keccak256, parseUnits, type Hex } from "viem";
import { z } from "zod";
import { api, addressUrl, txUrl } from "./api.js";
import { client, hashCanonical, vaultAbi } from "./chain.js";
import { config } from "./config.js";
import { CONTRACTS_DOC, HOW_IT_WORKS } from "./docs.js";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

const vaultArg = z
  .string()
  .optional()
  .describe(`Vault address (0x...). Defaults to the production vault ${config.defaultVault}.`);

function vaultOf(input?: string): `0x${string}` {
  const v = input?.trim() || config.defaultVault;
  if (!isAddress(v, { strict: false })) throw new Error(`"${v}" is not a valid address`);
  return getAddress(v.toLowerCase());
}

/** Tool result: a one-line summary for the model, then the data as JSON. */
function result(summary: string, data: unknown) {
  return { content: [{ type: "text" as const, text: `${summary}\n\n${JSON.stringify(data, null, 2)}` }] };
}

function failure(e: unknown) {
  return { isError: true, content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }] };
}

/** Wraps a tool handler so every failure comes back as a readable tool error. */
function safe<A>(fn: (args: A) => Promise<ReturnType<typeof result>>) {
  return async (args: A) => {
    try {
      return await fn(args);
    } catch (e) {
      return failure(e);
    }
  };
}

type Commitment = { chain_id: number; amount: string; t: string; settled: boolean; hit: boolean | null; credit: string | null; limit_after: string | null; decision_hash: string | null };

export function createServer() {
  const server = new McpServer(
    { name: "euthyna", version: "0.1.0", title: "Euthyna: AI treasurer on probation" },
    {
      instructions:
        "Euthyna is an AI treasurer on Arc testnet. It pays a business's bills in USDC, and its spending limit lives in a smart " +
        "contract that only rises when the agent keeps on-chain promises (hit) and halves when it breaks one (miss). " +
        "Every tool here is read-only. Start with get_public_stats or get_vault. Use verify_decision to prove a decision was " +
        "not edited. The build_*_tx tools only return unsigned transactions for the user's own wallet to sign; this server " +
        "holds no keys and cannot move funds.",
    },
  );

  // ------------------------------------------------------------------ overview

  server.registerTool(
    "get_public_stats",
    {
      title: "Public stats",
      description: "Totals across all real (non-test) Euthyna vaults: bills paid by the agent, USDC paid, payees, commitments, hits, misses and policy interventions.",
      annotations: READ_ONLY,
    },
    safe(async () => {
      const s = await api<Record<string, string>>("/api/stats");
      return result(
        `Agent paid ${s.bills_paid_autonomously} bills (${Number(s.usdc_paid).toFixed(2)} USDC) to ${s.distinct_payees_paid} payees. ` +
          `Commitments: ${s.commitments_settled}/${s.commitments_opened} settled, ${s.hits} hit, ${s.misses} miss. Policy corrected the model ${s.blocked_or_clamped_by_policy} times.`,
        s,
      );
    }),
  );

  server.registerTool(
    "list_businesses",
    {
      title: "List businesses",
      description: "Every business (one owner wallet) behind the public numbers, with its vaults, bills paid, commitments and hit/miss record. Builder-owned businesses are flagged.",
      annotations: READ_ONLY,
    },
    safe(async () => {
      const b = await api<unknown[]>("/api/businesses");
      return result(`${b.length} business(es) on real vaults.`, b);
    }),
  );

  server.registerTool(
    "list_vaults",
    {
      title: "List vaults",
      description: "All Euthyna vaults, optionally filtered by owner wallet. Test vaults are labelled is_test.",
      inputSchema: { owner: z.string().optional().describe("Only vaults owned by this wallet address") },
      annotations: READ_ONLY,
    },
    safe(async ({ owner }: { owner?: string }) => {
      const v = await api<unknown[]>(`/api/vaults${owner ? `?owner=${encodeURIComponent(owner.toLowerCase())}` : ""}`);
      return result(`${v.length} vault(s).`, v);
    }),
  );

  // ------------------------------------------------------------------ one vault

  server.registerTool(
    "get_vault",
    {
      title: "Vault state",
      description: "Live on-chain state of a vault: liquid cash, reserve, floor, score, autonomous limit, daily cap, owner, agent, and open owner alerts.",
      inputSchema: { vault: vaultArg },
      annotations: READ_ONLY,
    },
    safe(async ({ vault }: { vault?: string }) => {
      const v = vaultOf(vault);
      const s = await api<Record<string, unknown>>(`/api/vaults/${v}`);
      return result(
        `Vault ${v}: liquid ${s.liquid} USDC, reserve ${s.reserve} USDC, score ${s.score}, autonomous limit ${s.autonomousLimit} USDC${s.isTest ? " (TEST vault)" : ""}. ${addressUrl(v)}`,
        s,
      );
    }),
  );

  server.registerTool(
    "list_bills",
    {
      title: "List bills",
      description: "Bills (obligations) registered on a vault, newest due date first, with status (PENDING, PAID, ESCALATED, CANCELLED) and who registered them.",
      inputSchema: {
        vault: vaultArg,
        status: z.enum(["PENDING", "PAID", "ESCALATED", "CANCELLED"]).optional().describe("Only bills with this status"),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ vault, status }: { vault?: string; status?: string }) => {
      const v = vaultOf(vault);
      const all = await api<{ status: string }[]>(`/api/vaults/${v}/obligations`);
      const bills = status ? all.filter((b) => b.status === status) : all;
      return result(`${bills.length} bill(s)${status ? ` with status ${status}` : ""} on ${v}.`, bills);
    }),
  );

  server.registerTool(
    "list_payees",
    {
      title: "List payees",
      description: "The vault's allowlist: the only addresses the agent can ever pay, with per-invoice and per-month caps and when each goes live.",
      inputSchema: { vault: vaultArg },
      annotations: READ_ONLY,
    },
    safe(async ({ vault }: { vault?: string }) => {
      const v = vaultOf(vault);
      const p = await api<unknown[]>(`/api/vaults/${v}/payees`);
      return result(`${p.length} approved payee(s) on ${v}.`, p);
    }),
  );

  server.registerTool(
    "list_commitments",
    {
      title: "List commitments",
      description:
        "The agent's on-chain promises on a vault (each sweep into reserve). Shows whether each is open, settled as a hit or a miss, and, for open ones, " +
        "exactly when settle() becomes possible (deadline T + the vault's grace period, read from the contract).",
      inputSchema: { vault: vaultArg },
      annotations: READ_ONLY,
    },
    safe(async ({ vault }: { vault?: string }) => {
      const v = vaultOf(vault);
      const [list, grace] = await Promise.all([
        api<Commitment[]>(`/api/vaults/${v}/commitments`),
        client.readContract({ address: v, abi: vaultAbi, functionName: "grace" }).catch(() => null),
      ]);
      const now = Date.now();
      const rows = list.map((c) => {
        const settleAfter = grace === null ? null : new Date(new Date(c.t).getTime() + Number(grace) * 1000);
        return {
          id: c.chain_id,
          amountUsdc: c.amount,
          deadline: c.t,
          status: c.settled ? (c.hit ? "HIT" : "MISS") : "OPEN",
          credit: c.credit,
          limitAfter: c.limit_after,
          settleableAt: c.settled ? null : settleAfter?.toISOString() ?? null,
          settleableNow: !c.settled && settleAfter !== null && settleAfter.getTime() <= now,
          decisionHash: c.decision_hash,
        };
      });
      const open = rows.filter((r) => r.status === "OPEN").length;
      return result(`${rows.length} commitment(s) on ${v}: ${open} open, ${rows.length - open} settled.`, rows);
    }),
  );

  server.registerTool(
    "get_trust_history",
    {
      title: "Trust history",
      description: "How the vault's autonomous limit has moved over time: the starting limit, then one point per settled commitment (hit or miss, credit, new score, new limit).",
      inputSchema: { vault: vaultArg },
      annotations: READ_ONLY,
    },
    safe(async ({ vault }: { vault?: string }) => {
      const v = vaultOf(vault);
      const t = await api<{ start: { limit: string }; points: { hit: boolean; limit: string }[] }>(`/api/vaults/${v}/trust`);
      const last = t.points.at(-1);
      const hits = t.points.filter((p) => p.hit).length;
      return result(
        `Limit started at ${t.start.limit} USDC${last ? ` and is now ${last.limit} USDC after ${t.points.length} settlement(s): ${hits} hit, ${t.points.length - hits} miss` : "; no commitment has settled yet"}.`,
        t,
      );
    }),
  );

  // ------------------------------------------------------------------ decisions

  server.registerTool(
    "list_decisions",
    {
      title: "List agent decisions",
      description: "The agent's most recent decisions on a vault: trigger, model that answered, status (HOLD, CONFIRMED, PARTIAL, FAILED), proposed actions with reasons, and decision hash.",
      inputSchema: {
        vault: vaultArg,
        limit: z.number().int().min(1).max(50).optional().describe("How many recent decisions to return (default 10)"),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ vault, limit }: { vault?: string; limit?: number }) => {
      const v = vaultOf(vault);
      const all = await api<Record<string, any>[]>(`/api/vaults/${v}/decisions?limit=${limit ?? 10}`);
      const rows = all.map((d) => ({
        id: d.id,
        at: d.created_at,
        trigger: d.trigger,
        status: d.status,
        model: d.model_served ?? d.model,
        actions: d.llm?.actions ?? d.llm_output?.output?.actions ?? [],
        error: d.error ?? null,
        decisionHash: d.decision_hash,
      }));
      return result(`${rows.length} most recent decision(s) on ${v}.`, rows);
    }),
  );

  server.registerTool(
    "get_decision",
    {
      title: "Decision detail",
      description: "Everything about one agent decision: what it saw, the model's proposal, every policy verdict (accepted, clamped, converted, rejected, added), the actions sent and their transactions.",
      inputSchema: { id: z.string().uuid().describe("Decision id (UUID), from list_decisions") },
      annotations: READ_ONLY,
    },
    safe(async ({ id }: { id: string }) => {
      const r = await api<Record<string, any>>(`/api/decisions/${id}`);
      const d = r.decision;
      const out = {
        id: d.id,
        at: d.created_at,
        trigger: d.trigger,
        status: d.status,
        model: d.model_served ?? d.model,
        proposal: d.llm_output?.output ?? null,
        policy: d.policy_result,
        actions: (r.actions ?? []).map((a: any) => ({ type: a.type, status: a.status, txHash: a.tx_hash, explorer: a.tx_hash ? txUrl(a.tx_hash) : null, error: a.error })),
        onchainEvents: (r.onchain ?? []).map((e: any) => ({ name: e.name, txHash: e.tx_hash, explorer: txUrl(e.tx_hash) })),
        decisionHash: d.decision_hash,
      };
      return result(`Decision ${id}: ${d.status}, model ${out.model}, ${out.actions.length} action(s).`, out);
    }),
  );

  server.registerTool(
    "verify_decision",
    {
      title: "Verify a decision",
      description:
        "Proves a decision record was not edited after the agent made it. Re-hashes the stored canonical record HERE (keccak256), " +
        "independently of the backend, and checks it against the stored hash and the decisionHash emitted on-chain with the agent's transactions.",
      inputSchema: { id: z.string().uuid().describe("Decision id (UUID), from list_decisions") },
      annotations: READ_ONLY,
    },
    safe(async ({ id }: { id: string }) => {
      const r = await api<Record<string, any>>(`/api/decisions/${id}`);
      const stored: string = r.decision.decision_hash;
      const local = hashCanonical(r.decision.canonical_json);
      const onchain: { name: string; tx_hash: string; args: { decisionHash?: string } }[] = r.onchain ?? [];
      const checks = {
        recomputedHere: local,
        storedHash: stored,
        hashMatches: local === stored,
        backendAgrees: r.verify?.recomputedHash === local,
        columnsMatchHashedBytes: Boolean(r.verify?.columnsMatch),
        onchainEvents: onchain.map((e) => ({ name: e.name, decisionHash: e.args?.decisionHash, matches: e.args?.decisionHash === local, explorer: txUrl(e.tx_hash) })),
      };
      const onchainOk = onchain.length === 0 || checks.onchainEvents.every((e) => e.matches);
      const verified = checks.hashMatches && checks.backendAgrees && onchainOk;
      const note = onchain.length === 0 ? " (a HOLD decision sends no transaction, so there is nothing on-chain to compare)" : "";
      return result(verified ? `VERIFIED: the record is unedited${note}.` : "MISMATCH: the record does not match its hash.", checks);
    }),
  );

  // ------------------------------------------------------------------ unsigned transaction builders

  server.registerTool(
    "build_settle_tx",
    {
      title: "Build a settle() transaction",
      description:
        "settle() is permissionless: anyone can ask the contract to grade a matured commitment. This checks the commitment on-chain and, if it can be " +
        "settled, returns an UNSIGNED transaction for the user's own wallet. Nothing is sent from here.",
      inputSchema: { vault: vaultArg, commitmentId: z.number().int().min(1).describe("Commitment id, from list_commitments") },
      annotations: READ_ONLY,
    },
    safe(async ({ vault, commitmentId }: { vault?: string; commitmentId: number }) => {
      const v = vaultOf(vault);
      const [c, grace] = await Promise.all([
        client.readContract({ address: v, abi: vaultAbi, functionName: "getCommitment", args: [commitmentId] }),
        client.readContract({ address: v, abi: vaultAbi, functionName: "grace" }),
      ]);
      if (c.openedAt === 0n) throw new Error(`commitment #${commitmentId} does not exist on ${v}`);
      if (c.settled) return result(`Commitment #${commitmentId} is already settled as a ${c.hit ? "HIT" : "MISS"}. Nothing to do.`, { settled: true, hit: c.hit });
      const at = Number(c.T + grace) * 1000;
      if (at > Date.now()) throw new Error(`not settleable until ${new Date(at).toISOString()} (deadline T + ${grace}s grace)`);
      const tx = { to: v, data: encodeFunctionData({ abi: vaultAbi, functionName: "settle", args: [commitmentId] }), value: "0", chainId: config.chainId };
      return result(`Unsigned settle(${commitmentId}) transaction, ready for any wallet on Arc Testnet to sign.`, tx);
    }),
  );

  server.registerTool(
    "build_add_payee_tx",
    {
      title: "Build an addPayee transaction",
      description:
        "Returns an UNSIGNED addPayee transaction for the vault OWNER's wallet to sign (only the owner can send it). The payee goes live after the vault's payee delay.",
      inputSchema: {
        vault: vaultArg,
        payee: z.string().describe("Payee wallet address"),
        maxPerInvoiceUsdc: z.string().describe('Cap per bill in USDC, e.g. "50"'),
        maxPerMonthUsdc: z.string().describe('Cap per month in USDC, e.g. "200"'),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ vault, payee, maxPerInvoiceUsdc, maxPerMonthUsdc }: { vault?: string; payee: string; maxPerInvoiceUsdc: string; maxPerMonthUsdc: string }) => {
      const v = vaultOf(vault);
      const p = vaultOf(payee);
      const data = encodeFunctionData({ abi: vaultAbi, functionName: "addPayee", args: [p, parseUnits(maxPerInvoiceUsdc, 6), parseUnits(maxPerMonthUsdc, 6)] });
      return result(`Unsigned addPayee(${p}) transaction for the owner of ${v} to sign.`, { to: v, data, value: "0", chainId: config.chainId });
    }),
  );

  server.registerTool(
    "build_register_bill_tx",
    {
      title: "Build a registerObligation transaction",
      description:
        "Returns an UNSIGNED registerObligation (new bill) transaction for the vault OWNER's wallet to sign. The payee must already be approved and live; the due date should be after the payee goes live.",
      inputSchema: {
        vault: vaultArg,
        payee: z.string().describe("Approved payee address"),
        amountUsdc: z.string().describe('Bill amount in USDC, e.g. "12.50"'),
        dueAt: z.string().describe("Due date, ISO 8601, e.g. 2026-10-20T12:00:00Z"),
        invoiceNumber: z.string().min(1).describe("Invoice number; with the payee it forms the bill's unique reference"),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ vault, payee, amountUsdc, dueAt, invoiceNumber }: { vault?: string; payee: string; amountUsdc: string; dueAt: string; invoiceNumber: string }) => {
      const v = vaultOf(vault);
      const p = vaultOf(payee);
      const due = Math.floor(new Date(dueAt).getTime() / 1000);
      if (!Number.isFinite(due)) throw new Error(`"${dueAt}" is not a valid date`);
      if (due * 1000 <= Date.now()) throw new Error("the due date must be in the future");
      const ref: Hex = keccak256(encodePacked(["address", "string"], [p, invoiceNumber]));
      const data = encodeFunctionData({ abi: vaultAbi, functionName: "registerObligation", args: [p, parseUnits(amountUsdc, 6), BigInt(due), ref] });
      return result(`Unsigned registerObligation transaction (${amountUsdc} USDC to ${p}, due ${new Date(due * 1000).toISOString()}) for the owner of ${v} to sign.`, {
        to: v,
        data,
        value: "0",
        chainId: config.chainId,
        ref,
      });
    }),
  );

  // ------------------------------------------------------------------ resources

  server.registerResource(
    "how-it-works",
    "euthyna://docs/how-it-works",
    { title: "How Euthyna works", description: "The mechanism: vault, agent loop, commitments, settlement and scoring", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: HOW_IT_WORKS }] }),
  );

  server.registerResource(
    "contracts",
    "euthyna://docs/contracts",
    { title: "Deployed contracts", description: "Arc testnet addresses for the factory, production vault and USDC", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: CONTRACTS_DOC }] }),
  );

  server.registerResource(
    "vault",
    new ResourceTemplate("euthyna://vault/{address}", { list: undefined }),
    { title: "Vault state", description: "Live state of any Euthyna vault, as JSON", mimeType: "application/json" },
    async (uri, { address }) => {
      const v = vaultOf(String(address));
      const s = await api(`/api/vaults/${v}`);
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(s, null, 2) }] };
    },
  );

  // ------------------------------------------------------------------ prompts

  server.registerPrompt(
    "treasury_report",
    {
      title: "Treasury report",
      description: "A plain-English report on a vault: cash, upcoming bills, what the agent did recently, and its trust record",
      argsSchema: { vault: z.string().optional().describe("Vault address (defaults to the production vault)") },
    },
    ({ vault }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Write a short treasury report for the Euthyna vault ${vault || config.defaultVault}. Use get_vault, list_bills (status PENDING), ` +
              `list_decisions (limit 5), list_commitments and get_trust_history. Cover: cash position, bills coming due, what the agent decided recently ` +
              `and why, and how its autonomous limit has moved. Quote real numbers and link transactions on Arcscan.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "audit_decision",
    {
      title: "Audit a decision",
      description: "Explain one agent decision and prove it was not edited",
      argsSchema: { decisionId: z.string().describe("Decision id (UUID)") },
    },
    ({ decisionId }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Audit Euthyna decision ${decisionId}. Call get_decision to explain what the agent saw, what the model proposed, and how the policy layer ` +
              `treated each proposal. Then call verify_decision and state clearly whether the record is VERIFIED unedited, including the on-chain match.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "explain_trust",
    {
      title: "Explain the agent's trust",
      description: "Why the agent's spending limit is what it is",
      argsSchema: { vault: z.string().optional().describe("Vault address (defaults to the production vault)") },
    },
    ({ vault }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Explain why the Euthyna agent on vault ${vault || config.defaultVault} has its current autonomous limit. Read the euthyna://docs/how-it-works ` +
              `resource, then use get_trust_history and list_commitments. Walk through each settled commitment (hit or miss) and how it moved the limit.`,
          },
        },
      ],
    }),
  );

  return server;
}
