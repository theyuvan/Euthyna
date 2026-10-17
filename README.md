# Euthyna

An AI treasurer on probation. Euthyna is a treasury agent for small businesses on Arc. Its spending limit
lives in a smart contract and moves only with its own verified track record: hits add to its score
linearly, a single miss halves it.

The agent pays bills, parks idle USDC in a reserve, and pulls it back when bills come due. Every time it
parks cash it commits on-chain to a falsifiable claim: *every bill due before T will be paid on time from
liquid cash.* After T anyone can call `settle()`, and the contract grades the claim from its own records.

Built for the Tameion Agents Hackathon (Canteen × Circle, on Arc).

**Live:**
- **App:** [euthynax.vercel.app](https://euthynax.vercel.app). The console is at
  [/console](https://euthynax.vercel.app/console), and the one settled hit at
  [/console/trust?vault=0x4a08…](https://euthynax.vercel.app/console/trust?vault=0x4a08A58be01B5311D36EF4b042AA83BF738cF2b5).
- **API:** [euthyna-np2i.onrender.com](https://euthyna-np2i.onrender.com/api/stats).
- **Try it:** [docs/onboarding.md](docs/onboarding.md) walks a new business through onboarding in 5 minutes.

## Project structure

```
euthyna/
├── frontend/        Landing page + operator console (Next.js 16)
├── backend/         Agent loop, settler, indexer, HTTP API (Node + TypeScript)
│   └── db/          Postgres schema (Supabase)
├── contract/        EuthynaVault + EuthynaFactory (Foundry)
├── docs/
│   ├── frontend.md  pages, wallets, running and deploying the console
│   ├── backend.md   agent loop, LLM providers, setup, API reference
│   ├── contract.md  mechanism, scoring, loophole audit, deployed addresses
│   ├── design.md    the UI design system
│   └── onboarding.md  5-minute guide for a new business
└── render.yaml      Render Blueprint for the backend
```

## How it works

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

The LLM proposes and explains; code computes every number that gates money; the contract has the final
word. The agent has no function that sends USDC to an address of its choosing.

- [docs/contract.md](docs/contract.md): scoring, the 22-attack loophole audit, deployed addresses.
- [docs/backend.md](docs/backend.md): how a decision is made and recorded.

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
- **Autonomous payments on real (non-test) vaults:** 8 bills, 49.10 USDC (as of 17 Oct), to 5 distinct payees, all sent by
  the agent's Circle wallet. The first was
  [`0x791f…0876`](https://testnet.arcscan.app/tx/0x791f71d1c955a8ca57c0b6c60692ae85dee09bf6f3cef135c96486283ba30876).
  - One of them, `DOMAIN-TEST-2` (0.10 USDC), was paid **about 33 hours late**: Arc retired its old RPC
    domain while it was due, and the agent couldn't reach the chain. No commitment covered it, so the score
    is unaffected, but it was a late payment.
- **Self-serve onboarding, end to end, from a real MetaMask:** a new owner created a vault, added a payee and
  registered a bill, signing each step. Once the vault was funded, the agent paid that bill
  ([`0x4df9…da0b`](https://testnet.arcscan.app/tx/0x4df93f2b6e5c24c37997bdaf2edfcd353f9b75802a3e0b13bc2b9fbb78a8da0b)).
  - It was **late**: the bill had been entered due 4 minutes after its payee was added, inside the vault's
    1-hour payee delay. The Onboard page now refuses due dates like that.
  - This vault (`0xB656…3C68`) is a test vault.
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
| Agent loop (snapshot → decide → policy → execute) | ✅ live, runs every 30 min and on demand; 12/12 policy tests pass |
| Payments through a real Circle SCA wallet | ✅ verified end to end on Arc testnet (Gas Station-sponsored, ERC-4337) |
| Decision hash + replay | ✅ live; the Replay page re-hashes the record **in the viewer's browser** and checks it against the stored, server-recomputed and on-chain hashes |
| Live reasoning stream (`/api/vaults/:id/live`, `/live.html`) | ✅ live over SSE |
| LLM | ✅ an automatic fallback chain of 8 free models (5 Gemini, 3 OpenRouter), each tested on a real decision; a failing or quota-exhausted model hands over to the next, and the record shows which model answered. Policy never trusts a number from the model. |
| Invoice OCR | ✅ vision extraction, exact payee matching and on-chain registration, verified live once ([`0x4d61…0462`](https://testnet.arcscan.app/tx/0x4d614e69748dfcf6d41578506af8f857230a2189ce41373004e7f9b43a360462)). The no-match path (owner alert, nothing on-chain) is code-reviewed but not live-tested. |
| Frontend | ✅ landing page and 7 console pages on live data, with MetaMask wallet connect |
| RPC resilience | ✅ moved to `rpc.testnet.arc.io` after the old domain was retired, with a Blockdaemon fallback and Multicall3-batched reads; outages surface as a clean 503 the frontend auto-retries |
| Recurring bills (`addRecurring` / `materializeRecurring`) | 🟨 contract and settler wired; no API route or UI to add one yet |
| Reserve yield (USYC) | ⬜ stubbed: internal bucket only, no yield; Circle allowlist ticket not filed |
| Hosted deployment | ✅ backend on Render ([`/health`](https://euthyna-np2i.onrender.com/health)), frontend on Vercel ([euthynax.vercel.app](https://euthynax.vercel.app)) |

## Quickstart

You'll need [Foundry](https://getfoundry.sh), Node 20+, a Supabase project, a Circle developer account
(testnet API key), and a key for one LLM provider.

```bash
git submodule update --init --recursive

cd contract && forge build && forge test                        # see docs/contract.md

# terminal 1 — backend (fill in .env first; see docs/backend.md)
cd backend && npm install && cp .env.example .env
npm run db:migrate
npm start                                                       # API on :8787 + agent loops

# terminal 2 — frontend (see docs/frontend.md)
cd frontend && npm install
NEXT_PUBLIC_API_URL=http://127.0.0.1:8787 npm run dev           # http://localhost:3000
```
