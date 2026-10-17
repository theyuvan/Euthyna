import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { encodeFunctionData, getAddress, isAddress, verifyMessage, type Hex } from "viem";
import { z } from "zod";
import { vaultAbi } from "./abi.js";
import { runVault } from "./agent.js";
import { publicClient, txUrl, withRpcErrorContext, RpcUnavailableError } from "./chain.js";
import { canonicalJson, hashCanonical } from "./canonical.js";
import { config } from "./config.js";
import { one, q, vaultByAddress, type VaultRow } from "./db.js";
import { subscribe } from "./events.js";
import { circle, localAgentAddress } from "./executor.js";
import { extractInvoice, matchPayee, registerExtractedObligation } from "./invoice.js";
import { indexNow, requestRun } from "./scheduler.js";
import { settleVault } from "./settler.js";
import { obligationRef, parse } from "./units.js";
import { fmt } from "./units.js";

/**
 * HTTP API for the dashboard. Reads are public (the chain is public anyway). Writes need either the
 * ADMIN_TOKEN or a signature from the vault's on-chain owner over:
 *   "Euthyna owner action\nvault: <vault lowercase>\naction: <action>\ntimestamp: <unix seconds>"
 * sent as header `x-euthyna-auth: <timestamp>.<signature>`. Valid for 10 minutes.
 */

export const ownerMessage = (vault: string, action: string, ts: number) =>
  `Euthyna owner action\nvault: ${vault.toLowerCase()}\naction: ${action}\ntimestamp: ${ts}`;

type VReq = Request & { vault: VaultRow };

const h =
  (fn: (req: any, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

function isAdmin(req: Request) {
  return Boolean(config.ADMIN_TOKEN) && req.header("authorization") === `Bearer ${config.ADMIN_TOKEN}`;
}

async function loadVault(req: Request, res: Response, next: NextFunction) {
  const addr = String(req.params.vault);
  if (!isAddress(addr)) return res.status(400).json({ error: "bad vault address" });
  const v = await vaultByAddress(addr);
  if (!v) return res.status(404).json({ error: "unknown vault" });
  (req as VReq).vault = v;
  next();
}

const requireOwner = (action: string) => (req: Request, res: Response, next: NextFunction) => {
  if (isAdmin(req)) return next();
  const vault = (req as VReq).vault;
  const [tsStr, sig] = (req.header("x-euthyna-auth") ?? "").split(".");
  const ts = Number(tsStr);
  if (!ts || !sig || Math.abs(Date.now() / 1000 - ts) > 600) {
    return void res.status(401).json({ error: "missing or expired owner signature" });
  }
  (async () => {
    const owner = await publicClient.readContract({ address: getAddress(vault.address), abi: vaultAbi, functionName: "owner" });
    const ok = await verifyMessage({ address: owner, message: ownerMessage(vault.address, action, ts), signature: sig as Hex }).catch(() => false);
    if (!ok) return void res.status(403).json({ error: "signature is not from the vault owner" });
    next();
  })().catch(next);
};

export function createServer() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use((req, res, next) => {
    res.setHeader("access-control-allow-origin", config.CORS_ORIGIN);
    res.setHeader("access-control-allow-headers", "content-type, authorization, x-euthyna-auth");
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  // Minimal static pages (currently just /live.html — the live reasoning stream). No build step.
  app.use(express.static(join(dirname(fileURLToPath(import.meta.url)), "..", "public")));

  app.get("/health", (_req, res) => res.json({ ok: true, executor: config.EXECUTOR, model: config.LLM_MODEL }));

  // ---------------------------------------------------------------- public stats

  app.get(
    "/api/stats",
    h(async (_req, res) => {
      const s = await one(
        `with live as (select * from vaults where active and not is_test),
         paid as (
           select e.* from chain_events e join live v on v.id = e.vault_id
           where e.name = 'Paid'
         )
         select
           (select count(distinct owner_address) from live) as businesses,
           (select count(distinct owner_address) from live where owner_address <> all($1::text[])) as independent_businesses,
           (select count(*) from live) as vaults,
           (select count(*) from paid p join live v on v.id = p.vault_id where lower(p.args->>'by') = v.agent_address) as bills_paid_autonomously,
           (select round(coalesce(sum((args->>'amount')::numeric), 0) / 1e6, 6) from paid) as usdc_paid,
           (select count(distinct lower(args->>'payee')) from paid) as distinct_payees_paid,
           (select count(*) from commitments c join live v on v.id = c.vault_id) as commitments_opened,
           (select count(*) from commitments c join live v on v.id = c.vault_id where settled) as commitments_settled,
           (select count(*) from commitments c join live v on v.id = c.vault_id where settled and hit) as hits,
           (select count(*) from commitments c join live v on v.id = c.vault_id where settled and not hit) as misses,
           (select coalesce(sum(capital_usdc_days), 0) from commitments c join live v on v.id = c.vault_id) as capital_usdc_days,
           (select count(*) from chain_events e join live v on v.id = e.vault_id where name = 'Escalated') as escalations,
           (select count(*) from chain_events e join live v on v.id = e.vault_id where name = 'EscalationApproved') as approvals,
           (select count(*) from decision_actions a join decisions d on d.id = a.decision_id join live v on v.id = d.vault_id
              where a.status = 'SIMULATION_FAILED') as blocked_by_contract,
           (select count(*) from decisions d join live v on v.id = d.vault_id,
              jsonb_array_elements(d.policy_result->'log') l where l->>'verdict' in ('rejected', 'clamped', 'converted')) as blocked_or_clamped_by_policy`,
        [config.BUILDER_ADDRESSES],
      );
      res.json(s);
    }),
  );

  // One row per business (distinct owner wallet) across its active, non-test vaults, so anyone can
  // see who is behind the public numbers. Builder-owned businesses are labeled, not hidden.
  app.get(
    "/api/businesses",
    h(async (_req, res) => {
      res.json(await q(
        `with live as (
           select v.*, b.name as business from vaults v left join businesses b on b.id = v.business_id
           where v.active and not v.is_test
         )
         select l.owner_address as owner,
           l.owner_address = any($1::text[]) as builder,
           (array_agg(l.business order by l.created_at) filter (where l.business is not null))[1] as business,
           min(l.created_at) as joined_at,
           json_agg(l.address order by l.created_at) as vaults,
           coalesce(sum(p.bills), 0)::int as bills_paid_autonomously,
           round(coalesce(sum(p.usdc), 0), 6) as usdc_paid,
           coalesce(sum(c.opened), 0)::int as commitments_opened,
           coalesce(sum(c.hits), 0)::int as hits,
           coalesce(sum(c.misses), 0)::int as misses
         from live l
         left join lateral (
           select count(*) as bills, coalesce(sum((e.args->>'amount')::numeric), 0) / 1e6 as usdc
           from chain_events e where e.vault_id = l.id and e.name = 'Paid' and lower(e.args->>'by') = l.agent_address
         ) p on true
         left join lateral (
           select count(*) as opened, count(*) filter (where settled and hit) as hits, count(*) filter (where settled and not hit) as misses
           from commitments where vault_id = l.id
         ) c on true
         group by l.owner_address
         order by joined_at`,
        [config.BUILDER_ADDRESSES],
      ));
    }),
  );

  // ---------------------------------------------------------------------- vaults

  app.get(
    "/api/vaults",
    h(async (req, res) => {
      const owner = typeof req.query.owner === "string" ? req.query.owner.toLowerCase() : null;
      res.json(await q(
        `select v.id, v.address, v.owner_address, v.agent_address, v.active, v.is_test, v.created_at, b.name as business
         from vaults v left join businesses b on b.id = v.business_id
         where ($1::text is null or v.owner_address = $1) order by v.created_at`,
        [owner],
      ));
    }),
  );

  app.get(
    "/api/vaults/:vault",
    loadVault,
    h(async (req: VReq, res) => {
      const at = { address: getAddress(req.vault.address), abi: vaultAbi } as const;
      const [liquid, reserve, score, limit, dailyCap, dailySpent, cooldownUntil, paused, minLiquid, ownerCeiling, owner, agent] = await withRpcErrorContext(() =>
        Promise.all([
          publicClient.readContract({ ...at, functionName: "liquid" }),
          publicClient.readContract({ ...at, functionName: "reserve" }),
          publicClient.readContract({ ...at, functionName: "score" }),
          publicClient.readContract({ ...at, functionName: "autonomousLimit" }),
          publicClient.readContract({ ...at, functionName: "dailyCap" }),
          publicClient.readContract({ ...at, functionName: "currentDailySpent" }),
          publicClient.readContract({ ...at, functionName: "cooldownUntil" }),
          publicClient.readContract({ ...at, functionName: "paused" }),
          publicClient.readContract({ ...at, functionName: "minLiquid" }),
          publicClient.readContract({ ...at, functionName: "ownerCeiling" }),
          publicClient.readContract({ ...at, functionName: "owner" }),
          publicClient.readContract({ ...at, functionName: "agent" }),
        ]),
      );
      const alerts = await q("select * from owner_alerts where vault_id = $1 and resolved_at is null order by created_at desc", [req.vault.id]);
      res.json({
        address: req.vault.address,
        owner,
        agent,
        paused,
        liquid: fmt(liquid),
        reserve: fmt(reserve),
        score: fmt(score),
        autonomousLimit: fmt(limit),
        dailyCap: fmt(dailyCap),
        dailySpent: fmt(dailySpent),
        floor: fmt(minLiquid),
        ownerCeiling: fmt(ownerCeiling),
        cooldownUntil: cooldownUntil > 0n ? new Date(Number(cooldownUntil) * 1000).toISOString() : null,
        isTest: req.vault.is_test,
        alerts,
      });
    }),
  );

  app.get(
    "/api/vaults/:vault/obligations",
    loadVault,
    h(async (req: VReq, res) => {
      res.json(await q(
        `select o.*, p.display_name as payee_name from obligations o
         left join payees p on p.vault_id = o.vault_id and p.address = o.payee
         where o.vault_id = $1 order by o.due_at desc limit 200`,
        [req.vault.id],
      ));
    }),
  );

  app.get("/api/vaults/:vault/payees", loadVault, h(async (req: VReq, res) => res.json(await q("select * from payees where vault_id = $1", [req.vault.id]))));

  app.get(
    "/api/vaults/:vault/commitments",
    loadVault,
    h(async (req: VReq, res) => res.json(await q("select * from commitments where vault_id = $1 order by chain_id desc", [req.vault.id]))),
  );

  /** The trust chart: limit over time, stepping at each settlement. */
  app.get(
    "/api/vaults/:vault/trust",
    loadVault,
    h(async (req: VReq, res) => {
      const base = await withRpcErrorContext(() =>
        publicClient.readContract({ address: getAddress(req.vault.address), abi: vaultAbi, functionName: "baseLimit" }),
      );
      const points = await q(
        `select block_time as at, (args->>'cid')::int as cid, (args->>'hit')::boolean as hit,
                round((args->>'credit')::numeric / 1e6, 6) as credit, round((args->>'newScore')::numeric / 1e6, 6) as score,
                round((args->>'newLimit')::numeric / 1e6, 6) as limit
         from chain_events where vault_id = $1 and name = 'Settled' order by block, log_index`,
        [req.vault.id],
      );
      res.json({ start: { at: req.vault.created_block, limit: fmt(base), score: "0" }, points });
    }),
  );

  /** Live reasoning stream: every stage of the agent loop as it happens (SSE). */
  app.get(
    "/api/vaults/:vault/live",
    loadVault,
    h(async (req: VReq, res) => {
      res.setHeader("content-type", "text/event-stream");
      res.setHeader("cache-control", "no-cache");
      res.setHeader("connection", "keep-alive");
      res.flushHeaders?.();

      // Catch the viewer up on recent history before streaming new events.
      const recent = await q(
        "select stage, detail, at from agent_events where vault_id = $1 order by at desc limit 50",
        [req.vault.id],
      );
      for (const e of recent.reverse()) res.write(`data: ${JSON.stringify(e)}\n\n`);

      const unsubscribe = subscribe(req.vault.id, res);
      req.on("close", unsubscribe);
    }),
  );

  app.get(
    "/api/vaults/:vault/decisions",
    loadVault,
    h(async (req: VReq, res) => {
      const limit = Math.min(200, Number(req.query.limit) || 50);
      res.json(await q(
        `select d.id, d.created_at, d.trigger, d.status, d.decision_hash, d.model, d.model_served, d.error,
                d.llm_output->'output' as llm, d.policy_result->'log' as policy_log,
                coalesce((select json_agg(a order by a.idx) from decision_actions a where a.decision_id = d.id), '[]') as actions
         from decisions d where d.vault_id = $1 order by d.created_at desc limit $2`,
        [req.vault.id, limit],
      ));
    }),
  );

  /** Replay: the stored record, the hash recomputed from it, and every on-chain event carrying that hash. */
  app.get(
    "/api/decisions/:id",
    h(async (req, res) => {
      if (!z.uuid().safeParse(req.params.id).success) return res.status(400).json({ error: "bad id" });
      const d = await one("select * from decisions where id = $1", [req.params.id]);
      if (!d) return res.status(404).json({ error: "not found" });
      const actions = await q("select * from decision_actions where decision_id = $1 order by idx", [d.id]);
      const onchain = await q(
        "select name, tx_hash, block, block_time, args from chain_events where args->>'decisionHash' = $1 order by block, log_index",
        [d.decision_hash],
      );
      const recomputed = hashCanonical(d.canonical_json);
      // Also check that the structured columns still match the hashed bytes (catches edits to either).
      const record = JSON.parse(d.canonical_json);
      const columnsMatch =
        canonicalJson(record.snapshot) === canonicalJson(d.snapshot) &&
        canonicalJson(record.policy) === canonicalJson(d.policy_result) &&
        canonicalJson(record.llm) === canonicalJson(d.llm_output);
      res.json({
        decision: d,
        actions: actions.map((a: any) => ({ ...a, explorer: a.tx_hash ? txUrl(a.tx_hash) : null })),
        onchain: onchain.map((e: any) => ({ ...e, explorer: txUrl(e.tx_hash) })),
        verify: {
          storedHash: d.decision_hash,
          recomputedHash: recomputed,
          hashMatches: recomputed === d.decision_hash,
          columnsMatch,
          onchainMatches: onchain.length > 0 && onchain.every((e: any) => e.args.decisionHash === recomputed),
        },
      });
    }),
  );

  app.get(
    "/api/vaults/:vault/inflows",
    loadVault,
    h(async (req: VReq, res) => res.json(await q("select * from expected_inflows where vault_id = $1 order by expected_at", [req.vault.id]))),
  );

  // ------------------------------------------------------------------ owner writes

  const Inflow = z.object({
    fromName: z.string().min(1).max(120),
    amountUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/),
    expectedAt: z.iso.datetime(),
    confidence: z.union([z.literal(0.5), z.literal(0.8), z.literal(0.95)]),
  });
  app.post(
    "/api/vaults/:vault/inflows",
    loadVault,
    requireOwner("add-inflow"),
    h(async (req: VReq, res) => {
      const b = Inflow.safeParse(req.body);
      if (!b.success) return res.status(400).json({ error: z.prettifyError(b.error) });
      const row = await one(
        "insert into expected_inflows (vault_id, from_name, amount, expected_at, confidence) values ($1,$2,$3,$4,$5) returning *",
        [req.vault.id, b.data.fromName, b.data.amountUsdc, b.data.expectedAt, b.data.confidence],
      );
      res.status(201).json(row);
    }),
  );

  app.post(
    "/api/vaults/:vault/inflows/:id/received",
    loadVault,
    requireOwner("inflow-received"),
    h(async (req: VReq, res) => {
      await q("update expected_inflows set received_at = now() where id = $1 and vault_id = $2", [req.params.id, req.vault.id]);
      res.json({ ok: true });
    }),
  );

  const PayeeMeta = z.object({ displayName: z.string().max(120).optional(), aliases: z.array(z.string().max(120)).max(20).optional() });
  app.post(
    "/api/vaults/:vault/payees/:payee",
    loadVault,
    requireOwner("payee-meta"),
    h(async (req: VReq, res) => {
      const b = PayeeMeta.safeParse(req.body);
      const payee = String(req.params.payee);
      if (!b.success || !isAddress(payee)) return res.status(400).json({ error: "bad request" });
      await q(
        `insert into payees (vault_id, address, display_name, aliases) values ($1,$2,$3,$4)
         on conflict (vault_id, address) do update set display_name = coalesce(excluded.display_name, payees.display_name),
           aliases = case when $5 then excluded.aliases else payees.aliases end`,
        [req.vault.id, payee.toLowerCase(), b.data.displayName ?? null, b.data.aliases ?? [], b.data.aliases !== undefined],
      );
      res.json({ ok: true });
    }),
  );

  // ----------------------------------------------------- onboarding: prepare owner transactions
  //
  // addPayee / registerObligation / cancelObligation are owner-only on the contract, so the owner's
  // own key has to sign them — the backend never holds a real owner's private key. These routes do
  // the validation and encoding, then hand back {to, data} for the owner to sign (MetaMask, once the
  // dashboard exists; `npm run onboard` with OWNER_PRIVATE_KEY in the meantime).

  const AddPayeeReq = z.object({
    address: z.string().refine(isAddress, "bad address"),
    maxPerInvoiceUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/),
    maxPerMonthUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/),
    displayName: z.string().max(120).optional(),
  });
  app.post(
    "/api/vaults/:vault/onboard/payee",
    loadVault,
    requireOwner("onboard-payee"),
    h(async (req: VReq, res) => {
      const b = AddPayeeReq.safeParse(req.body);
      if (!b.success) return res.status(400).json({ error: z.prettifyError(b.error) });
      const payee = getAddress(b.data.address);
      const data = encodeFunctionData({
        abi: vaultAbi,
        functionName: "addPayee",
        args: [payee, parse(b.data.maxPerInvoiceUsdc), parse(b.data.maxPerMonthUsdc)],
      });
      if (b.data.displayName) {
        await q(
          `insert into payees (vault_id, address, display_name) values ($1,$2,$3)
           on conflict (vault_id, address) do update set display_name = excluded.display_name`,
          [req.vault.id, payee.toLowerCase(), b.data.displayName],
        );
      }
      res.json({ to: getAddress(req.vault.address), data, functionName: "addPayee", args: { payee, maxPerInvoiceUsdc: b.data.maxPerInvoiceUsdc, maxPerMonthUsdc: b.data.maxPerMonthUsdc } });
    }),
  );

  const RegisterObligationReq = z.object({
    payee: z.string().refine(isAddress, "bad address"),
    amountUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/),
    dueAt: z.iso.datetime(),
    invoiceNumber: z.string().min(1).max(120),
    note: z.string().max(500).optional(),
  });
  app.post(
    "/api/vaults/:vault/onboard/obligation",
    loadVault,
    requireOwner("onboard-obligation"),
    h(async (req: VReq, res) => {
      const b = RegisterObligationReq.safeParse(req.body);
      if (!b.success) return res.status(400).json({ error: z.prettifyError(b.error) });
      const payee = getAddress(b.data.payee);
      const dueAtSec = BigInt(Math.floor(new Date(b.data.dueAt).getTime() / 1000));
      if (dueAtSec <= BigInt(Math.floor(Date.now() / 1000))) return res.status(400).json({ error: "dueAt must be in the future" });
      const ref = obligationRef(payee, b.data.invoiceNumber);
      const existing = await one("select 1 from obligations where vault_id = $1 and ref = $2", [req.vault.id, ref]);
      if (existing) return res.status(409).json({ error: "this payee + invoice number was already used" });
      const data = encodeFunctionData({
        abi: vaultAbi,
        functionName: "registerObligation",
        args: [payee, parse(b.data.amountUsdc), dueAtSec, ref],
      });
      res.json({ to: getAddress(req.vault.address), data, functionName: "registerObligation", ref, args: { payee, amountUsdc: b.data.amountUsdc, dueAt: b.data.dueAt, invoiceNumber: b.data.invoiceNumber } });
    }),
  );

  app.post(
    "/api/vaults/:vault/onboard/obligations/:id/cancel",
    loadVault,
    requireOwner("onboard-cancel"),
    h(async (req: VReq, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "bad id" });
      const data = encodeFunctionData({ abi: vaultAbi, functionName: "cancelObligation", args: [id] });
      res.json({ to: getAddress(req.vault.address), data, functionName: "cancelObligation", args: { id } });
    }),
  );

  app.post(
    "/api/vaults/:vault/onboard/obligations/:id/approve-escalation",
    loadVault,
    requireOwner("onboard-approve-escalation"),
    h(async (req: VReq, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "bad id" });
      const data = encodeFunctionData({ abi: vaultAbi, functionName: "approveEscalation", args: [id] });
      res.json({ to: getAddress(req.vault.address), data, functionName: "approveEscalation", args: { id } });
    }),
  );

  // --------------------------------------------------------------------- invoice intake (vision)

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
  app.post(
    "/api/vaults/:vault/invoices",
    loadVault,
    requireOwner("invoice-upload"),
    upload.single("invoice"),
    h(async (req: VReq, res) => {
      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file) return res.status(400).json({ error: "no file (field name must be 'invoice')" });
      if (!/^image\/(png|jpe?g|webp)$/.test(file.mimetype)) return res.status(400).json({ error: "only PNG/JPEG/WEBP are supported right now" });

      const extraction = await extractInvoice(file.buffer, file.mimetype);
      if (extraction.error || !extraction.data) {
        return res.status(502).json({ error: extraction.error ?? "extraction failed" });
      }

      const match = await matchPayee(req.vault.id, extraction.data.payeeName);
      if (!match) {
        await q(
          `insert into owner_alerts (vault_id, kind, message, data) values ($1,'invoice_no_match',$2,$3)`,
          [req.vault.id, `Invoice for "${extraction.data.payeeName}" doesn't match any saved payee alias. Add the alias, or enter the bill by hand.`, JSON.stringify(extraction.data)],
        );
        return res.json({ matched: false, extracted: extraction.data });
      }

      const result = await registerExtractedObligation(req.vault, match, extraction.data, file);
      res.json({ matched: true, payee: match.address, extracted: extraction.data, ...result });
    }),
  );

  const OblMeta = z.object({ invoiceNumber: z.string().max(120).optional(), note: z.string().max(500).optional() });
  app.post(
    "/api/vaults/:vault/obligations/:id/meta",
    loadVault,
    requireOwner("obligation-meta"),
    h(async (req: VReq, res) => {
      const b = OblMeta.safeParse(req.body);
      if (!b.success) return res.status(400).json({ error: "bad request" });
      await indexNow(); // the bill may have been registered seconds ago
      await q(
        "update obligations set invoice_number = coalesce($3, invoice_number), note = coalesce($4, note) where vault_id = $1 and chain_id = $2",
        [req.vault.id, Number(req.params.id), b.data.invoiceNumber ?? null, b.data.note ?? null],
      );
      res.json({ ok: true });
    }),
  );

  app.post(
    "/api/vaults/:vault/alerts/:id/resolve",
    loadVault,
    requireOwner("resolve-alert"),
    h(async (req: VReq, res) => {
      await q("update owner_alerts set resolved_at = now() where id = $1 and vault_id = $2", [req.params.id, req.vault.id]);
      res.json({ ok: true });
    }),
  );

  /** Run the agent now (owner or admin). Waits for the run and returns what happened. */
  app.post(
    "/api/vaults/:vault/run",
    loadVault,
    requireOwner("run"),
    h(async (req: VReq, res) => res.json(await runVault(req.vault, "manual"))),
  );

  app.post(
    "/api/vaults/:vault/settle",
    loadVault,
    requireOwner("settle"),
    h(async (req: VReq, res) => {
      const r = await settleVault(req.vault);
      if (r.settled.length || r.materialized.length) requestRun(req.vault, "settlement");
      res.json(r);
    }),
  );

  /** Business metadata for a vault (owner). */
  const Business = z.object({ name: z.string().min(1).max(120), contact: z.string().max(200).optional() });
  app.post(
    "/api/vaults/:vault/business",
    loadVault,
    requireOwner("business"),
    h(async (req: VReq, res) => {
      const b = Business.safeParse(req.body);
      if (!b.success) return res.status(400).json({ error: "bad request" });
      const row = await one<{ id: string }>(
        "insert into businesses (name, owner_address, contact) values ($1,$2,$3) returning id",
        [b.data.name, req.vault.owner_address, b.data.contact ?? null],
      );
      await q("update vaults set business_id = $2 where id = $1", [req.vault.id, row!.id]);
      res.json({ ok: true, businessId: row!.id });
    }),
  );

  // ------------------------------------------------------------------- onboarding

  /**
   * Step 1 of self-serve onboarding: create the agent's Circle SCA wallet. The owner then calls
   * factory.createVault(agentAddress) from their own wallet; the indexer binds the two.
   */
  const recent: number[] = [];
  app.post(
    "/api/agent-wallets",
    h(async (_req, res) => {
      if (config.EXECUTOR === "local") return res.json({ walletId: null, address: localAgentAddress, note: "local executor: shared test agent" });
      const now = Date.now();
      while (recent.length && now - recent[0] > 3_600_000) recent.shift();
      if (recent.length >= 30) return res.status(429).json({ error: "too many wallets created this hour" });
      if (!config.CIRCLE_WALLET_SET_ID) return res.status(500).json({ error: "CIRCLE_WALLET_SET_ID not set; run npm run setup:circle" });
      const r = await circle().createWallets({
        blockchains: ["ARC-TESTNET"],
        count: 1,
        walletSetId: config.CIRCLE_WALLET_SET_ID,
        accountType: "SCA",
      } as any);
      const w = r.data?.wallets?.[0];
      if (!w) return res.status(502).json({ error: "Circle returned no wallet" });
      recent.push(now);
      await q("insert into agent_wallets (wallet_id, address) values ($1,$2) on conflict do nothing", [w.id, w.address.toLowerCase()]);
      res.status(201).json({ walletId: w.id, address: getAddress(w.address), factory: config.FACTORY_ADDRESS ?? null });
    }),
  );

  /** Circle Contracts / wallet webhooks: we only use them as a nudge to index immediately. */
  app.post("/webhooks/circle", (_req, res) => {
    void indexNow();
    res.sendStatus(200);
  });
  app.head("/webhooks/circle", (_req, res) => res.sendStatus(200));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[api]", err);
    if (err instanceof RpcUnavailableError) {
      return res.status(503).json({ error: err.message, code: "RPC_UNAVAILABLE" });
    }
    res.status(500).json({ error: err instanceof Error ? err.message : "internal error" });
  });
  return app;
}
