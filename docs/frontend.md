# Frontend

`frontend/` is the public landing page and the operator console (Next.js 16, Tailwind v4). Every number
on screen comes from the [backend](backend.md) API or from on-chain reads; nothing is mocked. The visual
system is in [design.md](design.md).

## Pages

| Route | Page | Data |
| --- | --- | --- |
| `/` | Landing page, with the orbit hero, live stats, the **Live businesses** table (builder-owned rows labeled) and the one real settled hit | `/api/stats`, `/api/businesses` |
| `/console` | **Treasury**: liquid, reserve, floor, score, limits; upcoming bills; expected inflows | on-chain vault state + DB mirror |
| `/console/trust` | **Trust**: the autonomous limit as a step chart (it only moves at settlement) and the commitments table | `/trust`, `/commitments` |
| `/console/decisions` | **Decisions**: every agent run, with what it proposed and its decision hash | `/decisions` |
| `/console/replay` | **Replay**: re-hashes a decision record in the browser and compares it with the stored and on-chain hash | `/api/decisions/:id` |
| `/console/escalations` | **Escalations**: approve or cancel bills over the limit, signed by the owner's wallet | `/obligations` + owner routes |
| `/docs` | **Docs**: what Euthyna is, how it works, the 5-minute setup, console guide, safety rules, FAQ, developer links | static |
| `/console/onboard` | **Onboard**: create a vault (with an optional public business name), add a payee, register a first bill, all signed by your wallet. Guide: [onboarding.md](onboarding.md) | factory + owner routes |
| `/console/stats` | **Public Stats**: totals across real, non-test vaults | `/api/stats` |

### Which vault the console shows

In priority order:
1. An explicit `?vault=0x…` in the URL. The landing page's proof links to the test vault's Trust chart this
   way.
2. The connected wallet's own vault: the first active, non-test vault it owns.
3. Otherwise the production vault, so a visitor without a wallet still sees real data.

The Trust page labels test vaults with a `[ TEST VAULT ]` banner.

### Verifying a decision without trusting the server

Replay takes the stored `canonical_json` and hashes it with keccak256 **in the viewer's browser**, the same
way `backend/src/canonical.ts` does. It then compares that hash with the stored hash, the server's own
recomputation and the `decisionHash` emitted on-chain. Any edit to the record turns the check red.

## Wallets

- **Owner actions** are signed by the owner's own wallet (MetaMask, any EIP-1193 wallet):
  - adding payees, registering bills, approving or cancelling escalations, creating a vault.
- **The flow:** the backend only returns unsigned calldata, and the backend never holds the owner's key.
  Requests to owner routes carry a fresh wallet signature (see [backend](backend.md#api)).
- **Onboarding:** after adding a payee, the page waits for the transaction, reads the payee's real go-live
  time from the contract (`getPayee().activeAt`), and refuses due dates before it.

## Run it

```bash
cd frontend
npm install
NEXT_PUBLIC_API_URL=http://127.0.0.1:8787 npm run dev    # http://localhost:3000
```

| Variable | Default | |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `http://127.0.0.1:8787` | the backend's URL |
| `NEXT_PUBLIC_FACTORY_ADDRESS` | production factory | factory used by Onboard |

The browser's chain client reads Arc through `rpc.testnet.arc.io`, falling back to Blockdaemon. Both allow
browser CORS.

### Automated browser runs

`npm run demo-wallet` in `backend/` starts a stand-in wallet on `127.0.0.1:8788`. It signs with
`OWNER_PRIVATE_KEY`, its signatures and transactions are real, and it only accepts the local frontend
origin. Inject a `window.ethereum` that forwards to it, and a headless browser can drive the owner flows.

## Deploy

Any Next.js host works. On Vercel:
1. Import the repo and set **Root Directory** to `frontend`.
2. Set `NEXT_PUBLIC_API_URL` to the deployed backend's URL.
3. Set the backend's `CORS_ORIGIN` to the frontend's URL.
