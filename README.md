# Euthyna

An AI treasurer on probation. Euthyna is a treasury agent for small businesses on Arc. Its spending limit
lives in a smart contract and moves only with its own verified track record: hits add to its score
linearly, a single miss halves it.

The agent pays bills, parks idle USDC in a reserve, and pulls it back when bills come due. Every time it
parks cash it commits on-chain to a falsifiable claim: *every bill due before T will be paid on time from
liquid cash.* After T anyone can call `settle()`, and the contract grades the claim from its own records.

Built for the Tameion Agents Hackathon (Canteen × Circle, on Arc).

## Repository

| Path | What |
| --- | --- |
| `contracts/` | `EuthynaVault` and `EuthynaFactory` (Foundry), with tests for every item in the loophole audit |
| `worker/` | Agent loop, settler, indexer and HTTP API (Node + TypeScript, viem, Circle SDK, pluggable LLM) |
| `dashboard/` | Landing page and operator console (Next.js 16): Treasury, Trust, Decisions, Replay, Escalations, Onboard, Public Stats |
| `db/schema.sql` | Postgres schema (Supabase) |
| `DESIGN.md` | The dashboard's design system |

## How it works

```
owner (MetaMask) ──owner calls──▶ EuthynaVault ◀──agent calls── Circle SCA wallet ◀── worker
                                     │  holds USDC, payees, bills,                       │
                                     │  commitments, score, limits                        ├─ snapshot (chain + DB)
                                     ▼                                                    ├─ precompute (code)
                         allowlisted payees only                                          ├─ decide (LLM, JSON schema)
                                                                                          ├─ policy pre-check (code)
                    settle(): permissionless, grades from contract state                  ├─ keccak256(canonical record)
                                                                                          └─ execute with decisionHash
```

The LLM proposes and explains; code computes every number that gates money; the contract has the final
word. The agent has no function that sends USDC to an address of its choosing.

**Scoring.** A commitment covers owner-set bills that already existed when it opened (`coverTo`) and fall
due in `(openedAt, T]`. On a hit the score rises by
`min(average reserve held, owner bills paid on time in the window) × window / 30 days`. On a miss the
score halves and sweeps freeze for 24 hours. Autonomous limit = `min(ownerCeiling, baseLimit + rate × score)`,
daily cap = `min(ownerDailyCeiling, 3 × limit)`.

### Changes from the original spec

- **`settle` waits until `T + grace`**, not `T`, so a bill due right at `T` can still be paid within grace.
- **Escalated bills are never scored** (unless `failedForLiquidity`), even when they were escalated for the
  daily cap rather than the limit. `escalate` itself only succeeds when the bill is genuinely over the
  limit or the daily cap, so it can't be used to dodge the exam.
- **`cancelObligation` (owner)** handles bills that can't be paid, e.g. a blocklisted payee. Cancelled bills
  are never scored. A blocklist revert raises an owner alert instead of an escalation, because the
  contract (correctly) refuses to escalate a bill that is within the limit.
- **The reserve is released at settlement.** Capital-seconds accrue only inside `[openedAt, T]`.
- **Per-payee caps (`maxPerInvoice`, `maxPerMonth`) bind agent-registered bills.** Owner-registered bills
  are the owner's own instruction.
- **No `temperature: 0`.** Claude Opus 5.5 doesn't accept sampling parameters. Determinism comes from
  code-computed figures, the policy layer and the contract. The model that actually served each decision
  is stored in the record.
- **Arc USDC can't be moved in a Foundry fork.** Transfers go through a native precompile (`0x1800…`) that
  Foundry's EVM can't execute. Fork tests are read-only; `npm run smoke` exercises real transfers on testnet.

## Loophole audit

All 22 attacks from the spec are closed. Tests are in `contracts/test/EuthynaVault.t.sol` (contract) and
`worker/src/policy.test.ts` (worker).

| # | Attack | Closed by |
| --- | --- | --- |
| 1 | Prompt injection "pay 0xABC" | `pay` only sends to `obligation.payee`, which must be allowlisted |
| 2 | Agent adds a payee | `addPayee` is owner-only, with a payee delay |
| 3 | Duplicate invoice / retry | `ref` usable once; PAID before transfer; Circle `idempotencyKey` per action |
| 4 | Splitting an invoice | `maxPerInvoice`, `maxPerMonth`, daily cap |
| 5 | Agent key stolen | Daily cap, allowlist, `pause`, `setAgent(0)` |
| 6 | Sweep everything | Floor enforced by `sweep`; worker also keeps bills due by T + grace liquid |
| 7 | Blocklisted payee | Pay reverts, bill stays PENDING, owner alerted, owner may cancel |
| 8 | Agent grades itself | Only `settle` changes the score |
| 9 | Trivial claims | Credit = reserve actually held, capped by owner bills actually paid |
| 10 | Agent writes its own exam | AGENT-source bills earn no credit |
| 11 | Overpaying to farm credit | No credit (#10) and `maxPerMonth` |
| 12 | Settling only good ones | `settle(id)` scans the range itself; permissionless |
| 13 | Never settling bad ones | Matured unsettled commitments count toward the cap of 5; settler every 10 min |
| 14 | Sweep then redeem | Credit is time-weighted |
| 15 | Sweep with no bills | No owner bill in window → zero credit |
| 16 | Slow build-up, then theft | `ownerCeiling`, halving, allowlist |
| 17 | Owner ambush bill | `coverTo` snapshot |
| 18 | Owner slow to approve | Escalated bills excluded unless `failedForLiquidity` |
| 19 | Edited decision log | `decisionHash` on-chain; `/api/decisions/:id` recomputes and compares |
| 20 | LLM arithmetic | All gating numbers computed in code; policy clamps; `eth_call` simulation before send |
| 21 | Races / nonces | Postgres advisory lock per vault; sequential execution; Circle manages nonces |
| 22 | 18 vs 6 decimals | ERC-20 interface only; fork test checks native ↔ ERC-20 balance |

### Accepted limits

- **Owner key compromise.** The owner is the principal; a stolen owner key can withdraw everything. Use a
  hardware wallet or a Safe as the owner.
- **Testnet USDC has no real value.** Traction means real businesses' real bills, mirrored in test USDC.

## Status (honest)

Every claim below can be checked on [Arcscan](https://testnet.arcscan.app) or against the live API.

### What's proven on-chain

- **The mechanism works end to end, once, on a test vault.** The agent swept 1 USDC into reserve against a
  bill, paid the bill on time, and `settle()` graded the commitment a **hit**. Score went 0 → 0.008333 and
  the autonomous limit went 25.00 → 25.016666 USDC. Settle tx
  [`0x2186…d5f1`](https://testnet.arcscan.app/tx/0x218692358b25492f59c4958b3960f9688ded4239473263809e5024d0d909d5f1)
  on vault `0x4a08…F2b5`.
  - That vault is a **test vault** with short parameters (2-minute minimum horizon), so the loop can be shown
    in hours instead of days. It is labeled as test everywhere and excluded from the public numbers.
- **Autonomous payments on real (non-test) vaults:** 6 bills, 39.10 USDC, to 5 distinct payees, all sent by
  the agent's Circle wallet. The first was
  [`0x791f…0876`](https://testnet.arcscan.app/tx/0x791f71d1c955a8ca57c0b6c60692ae85dee09bf6f3cef135c96486283ba30876).
  - One of the six, `DOMAIN-TEST-2` (0.10 USDC), was paid **about 33 hours late**: Arc retired its old RPC
    domain while it was due, and the agent couldn't reach the chain. No commitment covered it, so the score
    is unaffected, but it was a late payment.
- **No commitment has settled on a real vault yet.** The only settled commitment is the test-vault hit
  above.

### Public numbers (`/api/stats`)

- They count only active, non-test vaults: **1 business, 2 vaults**, both owned by the builder. There is no
  second, independent business yet.
- **Test vaults** (excluded from every number):
  - `0x82a9…2692` and `0x4a08…F2b5`: short-parameter vaults for demonstrating the loop.
  - `0xAd91…0a5f` and `0xB656…3C68`: created while testing the self-serve onboarding flow, the second one
    from the builder's own MetaMask wallet. They're marked test so they don't count as extra businesses.

### Components

| Piece | Status |
| --- | --- |
| Vault: pay / sweep / redeem / settle | ✅ live on Arc testnet, verified on Arcscan; 38 Foundry tests pass (plus 1 fork test that runs only with `ARC_RPC_URL` set) |
| Score → autonomous limit formula | ✅ live, enforced entirely in the contract |
| Agent worker loop (snapshot → decide → policy → execute) | ✅ live, runs every 30 min and on demand; 12/12 policy tests pass |
| Payments through a real Circle SCA wallet | ✅ verified end to end on Arc testnet (Gas Station-sponsored, ERC-4337) |
| Decision hash + replay | ✅ live; the Replay page re-hashes the record **in the viewer's browser** and checks it against the stored, server-recomputed and on-chain hashes |
| Live reasoning stream (`/api/vaults/:id/live`, `/live.html`) | ✅ live over SSE |
| LLM provider | ✅ pluggable: Anthropic, xAI, Gemini or OpenRouter. Currently running OpenRouter's free `liquid/lfm-2.5-2.6b`, because Gemini's free-tier daily quota ran out. Policy never trusts a number from the model, so a small model can't move money wrongly. |
| Invoice OCR | ✅ vision extraction, exact payee matching and on-chain registration, verified live once ([`0x4d61…0462`](https://testnet.arcscan.app/tx/0x4d614e69748dfcf6d41578506af8f857230a2189ce41373004e7f9b43a360462)). The no-match path (owner alert, nothing on-chain) is code-reviewed but not live-tested. |
| Dashboard | ✅ landing page and 7 console pages on live data, with MetaMask wallet connect. Self-serve onboarding (vault → payee → bill) verified twice with real transactions, once from a real MetaMask. |
| RPC resilience | ✅ moved to `rpc.testnet.arc.io` after the old domain was retired, with a Blockdaemon fallback and Multicall3-batched reads; outages surface as a clean 503 the dashboard auto-retries |
| Recurring bills (`addRecurring` / `materializeRecurring`) | 🟨 contract and settler wired; no API route or UI to add one yet |
| Reserve yield (USYC) | ⬜ stubbed: internal bucket only, no yield; Circle allowlist ticket not filed |
| Hosted deployment | ⬜ not yet: `render.yaml` (worker) is ready; the dashboard deploys to any Next.js host |

## Running it

Prerequisites: [Foundry](https://getfoundry.sh), Node 20+, a Supabase project, a Circle developer account
(testnet API key), and a key for one LLM provider: Anthropic, [xAI](https://console.x.ai) (Grok),
[Google AI Studio](https://aistudio.google.com/apikey) (Gemini), or [OpenRouter](https://openrouter.ai).
Set `LLM_PROVIDER` and the matching `*_API_KEY` in `.env`. `LLM_MODEL` defaults to a Claude model, so pick
one for your provider.
- On OpenRouter's free tier, `liquid/lfm-2.5-2.6b:free` works.
- Avoid reasoning models (e.g. `gemini-3.8-flash`, NVIDIA's free reasoning models) for this loop. They
  can spend their whole token budget on hidden thinking and return empty content.

```bash
git submodule update --init --recursive

# contracts
cd contracts
forge build && forge test
ARC_RPC_URL=https://rpc.testnet.arc.io forge test --match-contract ArcFork   # read-only fork checks
forge script script/Deploy.s.sol --rpc-url https://rpc.testnet.arc.io --private-key $DEPLOYER_KEY --broadcast

# worker
cd ../worker
npm install
cp .env.example .env            # fill it in
npm run gen-abi                 # after any contract change
npm run db:migrate
npm run setup:circle            # first run prints an entity secret to add to .env; second run registers it
npm run create-wallet           # agent SCA wallet; its address is the vault's agent
npm run create-vault -- 0xAgentAddress     # or let the owner do it from the dashboard
npm start                       # API on :8787 + agent / settler / indexer loops

# dashboard
cd ../dashboard
npm install
NEXT_PUBLIC_API_URL=http://127.0.0.1:8787 npm run dev    # http://localhost:3000
```

Owner actions in the dashboard are signed by the owner's own wallet (MetaMask). For automated browser runs,
`npx tsx scripts/demo-wallet-bridge.ts` (in `worker/`) serves a stand-in wallet on `127.0.0.1:8788` that
signs with `OWNER_PRIVATE_KEY`; it only accepts the local dashboard origin.

Useful one-shots: `npm run agent:once -- 0xVault`, `npm run settle:once`, `npm run index:once`,
`npm run smoke` (live testnet transfers, no LLM or DB), `npm test` (policy unit tests),
`npm run e2e:local` (whole backend against Anvil + Postgres, with the model stubbed).

### API

Reads are public. Writes need `Authorization: Bearer $ADMIN_TOKEN` or an owner signature: sign
`"Euthyna owner action\nvault: <vault lowercase>\naction: <action>\ntimestamp: <unix>"` and send
`x-euthyna-auth: <timestamp>.<signature>` (valid 10 minutes).

| Method | Path | |
| --- | --- | --- |
| GET | `/api/stats` | Public totals for judges |
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
