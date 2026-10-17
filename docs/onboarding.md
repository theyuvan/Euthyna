# Put your treasury on Euthyna (5 minutes)

Euthyna is an AI treasurer that pays your bills in USDC from a vault **you own**. Its spending limit
lives in a smart contract and only rises when it proves, on-chain, that it paid bills on time. It's on
Arc testnet, so everything uses free test USDC, but the bills you enter should be ones you actually have.

You keep control: your wallet signs every owner action, the agent can only pay addresses you've approved,
and only your wallet can cancel a bill or remove the agent.

**App:** [euthynax.vercel.app/console/onboard](https://euthynax.vercel.app/console/onboard)

## Before you start (2 minutes)

1. **Install [MetaMask](https://metamask.io)** in your browser, if you don't have it.
2. **Get test USDC for gas.** On Arc, USDC is the gas token. Open
   [faucet.circle.com](https://faucet.circle.com), choose **Arc Testnet**, and paste your MetaMask address.
3. **Pick one real bill.** Choose something you pay regularly: hosting, a subscription, rent share, a
   supplier, a freelancer. You'll mirror it in test USDC.
   - Keep it at **25 USDC or less**. That's a new vault's autonomous limit. Bigger bills go to you for
     approval instead of being paid automatically.

You also need the **payee's wallet address**, meaning whoever gets paid. If they don't have one, use a
second address of your own.

## Set up (3 minutes, 3 signatures)

Open the [Onboard page](https://euthynax.vercel.app/console/onboard) and click **Connect wallet**.
MetaMask adds Arc Testnet automatically.

1. **Create your vault.**
   - Type your business name (optional; it's shown publicly) and click **Create a real vault owned by me**.
   - Approve in MetaMask. You get your own vault and your own agent wallet.
2. **Add a payee.**
   - Paste the payee's address and a display name. Keep the default limits or lower them.
   - Approve in MetaMask.
   - The page then shows when the payee **goes live**, about 1 hour from now. That delay is a safety rule:
     nobody can add a payee and have it paid instantly.
3. **Register the bill.**
   - Enter the amount and an invoice number.
   - The due date defaults to 1 hour after the payee goes live. The page won't accept an earlier date,
     because the agent couldn't pay it in time.
   - Approve in MetaMask.

## Fund the vault

Send test USDC to your **vault address** (shown on the Onboard page after step 1). Send enough to cover the
bill, plus a little extra. Either:
- open [faucet.circle.com](https://faucet.circle.com), choose Arc Testnet, and paste the vault address; or
- send USDC from MetaMask to the vault address.

## What happens next

- **The agent checks your vault** every 30 minutes and whenever a new bill arrives. It pays the bill before
  it's due. If you have spare cash, it may move some into reserve and make an on-chain commitment that
  every upcoming bill will still be paid on time.
- **Every decision is recorded.** It's hashed before any money moves, and you can re-verify it yourself in
  the console:
  - **Overview**: balance, bills, limit;
  - **Decisions**: what the agent did and why;
  - **Replay**: re-check any decision's hash in your browser;
  - **Trust**: how its limit has moved.
- **Your business appears** in **Live businesses** on [euthynax.vercel.app](https://euthynax.vercel.app).

## Questions

- **Can the agent send my money anywhere?** No. It can pay only payees you added, only bills that exist, and
  only within limits the contract enforces.
- **What if I change my mind?** Only your wallet can cancel a bill (`cancelObligation`) or replace or remove
  the agent (`setAgent`).
  - The console's Escalations page has a Cancel button for bills sent to you for approval.
  - Anything else can be called on your vault's contract page on [Arcscan](https://testnet.arcscan.app).
- **Is this real money?** No. It's Arc testnet, and test USDC has no value. The bills, the decisions and the
  on-chain records are real.

Feedback is very welcome. Open an issue on [GitHub](https://github.com/theyuvan/tameion/issues) or reply
to whoever sent you this guide.
