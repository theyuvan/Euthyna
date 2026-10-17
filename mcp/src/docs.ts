import { config } from "./config.js";

export const HOW_IT_WORKS = `# How Euthyna works

Euthyna is an AI treasurer for small businesses on Arc testnet. It pays bills in USDC, and its spending limit
lives in a smart contract that moves only with the agent's own on-chain track record.

## The vault
The owner keeps USDC, approved payees and bills in their own EuthynaVault contract. The agent acts only through
it, through a Circle developer-controlled smart-contract wallet. It has no function to send money anywhere except
an approved payee, and a new payee waits out a delay (1 hour on production vaults) before it can be paid.

## One agent run
1. Snapshot: liquid cash, reserve, floor, limits, bills, payees, commitments, expected inflows.
2. Code computes the numbers the model cannot override: payable bills, bills that must be escalated, safe sweep
   amounts per horizon, and whether a sweep is allowed.
3. The LLM proposes actions (pay, sweep, redeem, escalate, hold) as schema-checked JSON.
4. The policy layer checks every proposal against those numbers and the contract's rules: over-limit payments
   become escalations, sweeps are clamped, and bills due within 2 hours are paid even if the model forgot.
5. The full decision record is hashed (keccak256) before anything is sent.
6. Actions are simulated, then sent with the decision hash and an idempotency key.

## Commitments and scoring
- sweep() moves spare cash into reserve and opens a commitment: every owner bill due before time T will be paid
  on time from liquid cash.
- After T plus the vault's grace period, anyone can call settle(). The contract grades the commitment from its
  own records.
- Hit: score += min(average reserve held, owner bills paid on time in the window) x window / 30 days.
- Miss: score is halved and sweeps freeze for 24 hours.
- Autonomous limit = min(ownerCeiling, baseLimit + rate x score). Bills above it are escalated to the owner.

## Verifying a decision
Every decision's canonical JSON is hashed with keccak256, and the hash is emitted on-chain with the agent's
transactions. Re-hash the stored record and compare (the verify_decision tool does this).

App: ${config.appUrl}  ·  Code: https://github.com/theyuvan/Euthyna
`;

export const CONTRACTS_DOC = `# Euthyna contracts (Arc testnet, chain ${config.chainId})

| Contract | Address |
|---|---|
| Production factory | ${config.factory} |
| Production vault ("Euthyna") | ${config.defaultVault} |
| USDC (Arc native) | ${config.usdc} |

Explorer: ${config.explorer}
`;
