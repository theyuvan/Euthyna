# Backend

`backend/` runs the agent loop, the settler, the indexer and the HTTP API (Node + TypeScript, viem,
Circle SDK, a pluggable LLM). `backend/db/schema.sql` is the Postgres schema (Supabase).

## The agent loop

```
owner (MetaMask) ──owner calls──▶ EuthynaVault ◀──agent calls── Circle SCA wallet ◀── backend
                                     │  holds USDC, payees, bills,                       │
                                     │  commitments, score, limits                        ├─ snapshot (chain + DB)
                                     ▼                                                    ├─ precompute (code)
                         allowlisted payees only                                          ├─ decide (LLM, JSON schema)
                                                                                          ├─ policy pre-check (code)
                    settle(): permissionless, grades from contract state                  ├─ keccak256(canonical record)
                                                                                          └─ execute with decisionHash
```

- **Roles.** The LLM proposes and explains. Code computes every number that gates money. The
  [contract](contract.md) has the final word.
- **Decision records.** Each decision is hashed before anything is sent, and the hash goes on-chain with
  the action, so the record can be replayed and checked later (`/api/decisions/:id`, and the Replay page in
  the [frontend](frontend.md)).

### Loops

| Loop | Interval | What it does |
| --- | --- | --- |
| Agent | every 30 min (`AGENT_INTERVAL_MIN`), on events, and on demand | snapshot → decide → policy → execute |
| Settler | every 10 min | settles matured commitments |
| Indexer | every few seconds | mirrors vault and factory events into Postgres; picks up new vaults automatically |

The loops need an always-on machine. On a laptop, sleep pauses them; they resume on the next tick once the
network is back. That's why the backend is meant to be hosted (see `render.yaml`).

## LLM providers

`LLM_PROVIDER` selects Anthropic, xAI, Gemini or OpenRouter; set the matching `*_API_KEY`. `LLM_MODEL`
defaults to a Claude model, so pick one for your provider.

- **Currently running:** OpenRouter's free `liquid/lfm-2.5-2.6b:free`, because Gemini's free-tier daily
  quota ran out. The policy layer never trusts a number from the model, so a small model can't move money
  wrongly. At worst its narrative text is weaker.
- **Avoid reasoning models** (e.g. `gemini-3.8-flash`, NVIDIA's free reasoning models) for this loop. They
  can spend their whole token budget on hidden thinking and return empty content.
- **No `temperature: 0`.** Claude Opus 5.5 doesn't accept sampling parameters. Determinism comes from
  code-computed figures, the policy layer and the contract. The model that actually served each decision is
  stored in the record.

## RPC

- `ARC_RPC_URL` defaults to `https://rpc.testnet.arc.io`. The old `rpc.testnet.arc.network` domain was
  retired.
- Reads fall back to `ARC_RPC_FALLBACK_URLS` (default Blockdaemon) when the primary errors or rate-limits.
  A fallback must accept the indexer's 5000-block `getLogs` ranges: dRPC caps at 100, and QuickNode 429s
  readily.
- Concurrent contract reads batch through Multicall3.
- When Arc's RPC is unreachable or throttling, vault and trust reads return
  `503 {code: "RPC_UNAVAILABLE"}`, which the frontend shows as a retrying banner.

## Setup

Prerequisites:
- Node 20+, a Supabase project, and a Circle developer account (testnet API key);
- a key for one LLM provider;
- the [contract](contract.md) deployed (or use the deployed factory).

```bash
cd backend
npm install
cp .env.example .env            # fill it in
npm run gen-abi                 # after any contract change (reads contract/out)
npm run db:migrate              # applies db/schema.sql
npm run setup:circle            # first run prints an entity secret to add to .env; second run registers it
npm run create-wallet           # agent SCA wallet; its address is the vault's agent
npm run create-vault -- 0xAgentAddress     # or let the owner do it from the frontend's Onboard page
npm start                       # API on :8787 + agent / settler / indexer loops
```

- `setup:circle` writes a Circle recovery file into `backend/`. It's a secret; `.gitignore` excludes it,
  so back it up somewhere safe.

### Scripts

| Script | What |
| --- | --- |
| `npm run agent:once -- 0xVault` | one agent run for a vault |
| `npm run settle:once` / `npm run index:once` | one settler / indexer pass |
| `npm run onboard -- payee\|bill\|cancel …` | owner actions from the CLI, signed with `OWNER_PRIVATE_KEY` |
| `npm run smoke` | live testnet transfers (no LLM or DB) |
| `npm test` | policy unit tests (12) |
| `npm run e2e:local` | whole backend against Anvil + Postgres, with the model stubbed |
| `npm run demo-wallet` | local stand-in wallet for automated browser runs (see [frontend](frontend.md)) |
| `npm run deploy-factory` | deploy a factory |

## Deploy

`render.yaml` at the repo root is a Render Blueprint for this service (`rootDir: backend`, health check
`/health`). Set the secrets marked `sync: false` in Render's dashboard from your `.env`. Set `CORS_ORIGIN`
to the deployed frontend's origin; it defaults to `*`, which is safe here because owner writes are
authorized by wallet signatures, not cookies.

## API

Reads are public. Writes need `Authorization: Bearer $ADMIN_TOKEN` or an owner signature: sign
`"Euthyna owner action\nvault: <vault lowercase>\naction: <action>\ntimestamp: <unix>"` and send
`x-euthyna-auth: <timestamp>.<signature>` (valid 10 minutes).

| Method | Path | |
| --- | --- | --- |
| GET | `/health` | Liveness, executor and model |
| GET | `/api/stats` | Public totals for judges (active, non-test vaults only) |
| GET | `/api/vaults?owner=0x…` | Vaults |
| GET | `/api/vaults/:vault` | Live state + open owner alerts |
| GET | `/api/vaults/:vault/{obligations,payees,commitments,inflows,decisions}` | Mirrors |
| GET | `/api/vaults/:vault/trust` | Limit-over-time series (the trust chart) |
| GET | `/api/vaults/:vault/live` | SSE: every stage of the agent loop as it happens (also at `/live.html?vault=…`) |
| GET | `/api/decisions/:id` | Replay: stored record, recomputed hash, on-chain events |
| POST | `/api/vaults/:vault/inflows` | `add-inflow`: expected inflow with confidence 0.5/0.8/0.95 |
| POST | `/api/vaults/:vault/inflows/:id/received` | `inflow-received`: mark an expected inflow as arrived |
| POST | `/api/vaults/:vault/onboard/payee` | `onboard-payee`: unsigned `addPayee` calldata for the owner's wallet |
| POST | `/api/vaults/:vault/onboard/obligation` | `onboard-obligation`: unsigned `registerObligation` calldata |
| POST | `/api/vaults/:vault/onboard/obligations/:id/cancel` | `onboard-cancel`: unsigned `cancelObligation` calldata |
| POST | `/api/vaults/:vault/onboard/obligations/:id/approve-escalation` | `onboard-approve-escalation`: unsigned `approveEscalation` calldata |
| POST | `/api/vaults/:vault/invoices` | `invoice-upload`: invoice image → extracted bill, registered by the agent if the payee matches exactly |
| POST | `/api/vaults/:vault/run` | `run`: run the agent now |
| POST | `/api/vaults/:vault/settle` | `settle`: settle matured commitments now |
| POST | `/api/vaults/:vault/payees/:payee` | `payee-meta`: display name, aliases |
| POST | `/api/vaults/:vault/obligations/:id/meta` | `obligation-meta`: invoice number, note |
| POST | `/api/vaults/:vault/business` | `business`: business name |
| POST | `/api/vaults/:vault/alerts/:id/resolve` | `resolve-alert` |
| POST | `/api/agent-wallets` | Onboarding: create an agent wallet, then the owner calls `factory.createVault(agent)` |
| POST | `/webhooks/circle` | Nudges the indexer |
