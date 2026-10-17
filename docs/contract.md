# Contract

`contract/` holds `EuthynaVault` and `EuthynaFactory`: a Foundry project with tests for every item in the
loophole audit.

## The mechanism

The vault holds the business's USDC, its allowlisted payees, its bills, its commitments, the agent's score
and the limits derived from it.

- The **owner** (MetaMask) configures the vault: payees, bills, ceilings, floor, pause.
- The **agent** (a Circle smart-contract wallet driven by the [backend](backend.md)) can only pay bills,
  sweep idle cash into reserve, and redeem it. It has no function that sends USDC to an address of its
  choosing.
- **`settle()`** is permissionless. Anyone can call it after a commitment matures, and it grades the
  commitment from the contract's own records.

### Scoring

- **What a commitment covers:** owner-set bills that already existed when it opened (`coverTo`) and fall
  due in `(openedAt, T]`.
- **On a hit,** the score rises by
  `min(average reserve held, owner bills paid on time in the window) × window / 30 days`.
- **On a miss,** the score halves and sweeps freeze for 24 hours.
- **Limits:**
  - autonomous limit = `min(ownerCeiling, baseLimit + rate × score)`;
  - daily cap = `min(ownerDailyCeiling, 3 × limit)`.

### What the floor does

`minLiquid` (the floor) limits **sweeps**: a sweep must leave at least the floor liquid. Paying a bill only
needs `liquid() >= amount`.

### Per-vault parameters

`minHorizon` and `payeeDelay` are set per vault at creation. They are floored by `ABSOLUTE_MIN_HORIZON`
(1 minute) and a 10-minute minimum payee delay.
- **Production vaults** keep a 1-hour minimum horizon and a 1-hour payee delay.
- **The test factory** uses short values (`minHorizon` 120s), so the loop can be demonstrated in hours.

## Changes from the original spec

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
- **Arc USDC can't be moved in a Foundry fork.** Transfers go through a native precompile (`0x1800…`) that
  Foundry's EVM can't execute. Fork tests are read-only; `npm run smoke` (in `backend/`) exercises real
  transfers on testnet.

## Loophole audit

All 22 attacks from the spec are closed. Tests are in `contract/test/EuthynaVault.t.sol` (contract) and
`backend/src/policy.test.ts` (agent policy).

| # | Attack | Closed by |
| --- | --- | --- |
| 1 | Prompt injection "pay 0xABC" | `pay` only sends to `obligation.payee`, which must be allowlisted |
| 2 | Agent adds a payee | `addPayee` is owner-only, with a payee delay |
| 3 | Duplicate invoice / retry | `ref` usable once; PAID before transfer; Circle `idempotencyKey` per action |
| 4 | Splitting an invoice | `maxPerInvoice`, `maxPerMonth`, daily cap |
| 5 | Agent key stolen | Daily cap, allowlist, `pause`, `setAgent(0)` |
| 6 | Sweep everything | Floor enforced by `sweep`; the agent also keeps bills due by T + grace liquid |
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

## Deployed on Arc testnet (chain 5042002)

| What | Address |
| --- | --- |
| Production factory | `0xD6846FB7BAD7F8CDba6eE8fB4b42D4e16A30d658` |
| Production vault ("Euthyna") | `0x0767f13610b794f1de85CEe78728114df1Ffa23d` |
| Second vault, same owner ("Euthyna Infra & API Costs") | `0xc5A7E94bd82a479Da2AFaa65B2147666f4Abf142` |
| Test factory (short parameters) | `0xffe19C5eBb3A8c70546B4bD033f54e89dc807438` |
| Test vault with the settled hit | `0x4a08A58be01B5311D36EF4b042AA83BF738cF2b5` |

Deployment records are in `contract/broadcast/`. Contracts are verified on
[Arcscan](https://testnet.arcscan.app).

## Build and test

```bash
git submodule update --init --recursive
cd contract
forge build && forge test                     # 38 tests; 1 fork test skipped without ARC_RPC_URL
ARC_RPC_URL=https://rpc.testnet.arc.io forge test --match-contract ArcFork   # read-only fork checks
forge script script/Deploy.s.sol --rpc-url https://rpc.testnet.arc.io --private-key $DEPLOYER_KEY --broadcast
```

After any contract change, regenerate the backend's ABI with `npm run gen-abi` in `backend/`.
