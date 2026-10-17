# Euthyna MCP server

Connect any AI assistant (Claude Code, Claude Desktop, Cursor, or any [Model Context Protocol](https://modelcontextprotocol.io)
client) to [Euthyna](https://euthynax.vercel.app), the AI treasurer on probation on Arc. Ask about a vault's
cash, the agent's decisions and its trust record in plain English, and verify any decision's hash yourself.

**Read-only by design.** The server holds no keys and cannot move funds. The `build_*_tx` tools only return
unsigned transactions for your own wallet to sign.

## Quick start

```bash
cd mcp
npm install          # also builds dist/
npm run smoke        # optional: calls every tool against the live API
```

### Claude Code

```bash
claude mcp add euthyna -- node /absolute/path/to/euthyna/mcp/dist/index.js
```

### Claude Desktop

Add to `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "euthyna": {
      "command": "node",
      "args": ["/absolute/path/to/euthyna/mcp/dist/index.js"]
    }
  }
}
```

### Cursor

Add the same `mcpServers` block to `.cursor/mcp.json` in your project, or to `~/.cursor/mcp.json`.

### Over HTTP (Streamable HTTP)

```bash
npm start -- --http 3333      # endpoint: http://localhost:3333/mcp, health check: /health
claude mcp add --transport http euthyna http://localhost:3333/mcp
```

## What you can ask

- "What's the state of the Euthyna production vault?"
- "What did the agent decide in its last 5 runs, and why?"
- "Has the agent kept its promises? Show its trust history."
- "Verify decision f30f2177-a816-48b1-a1af-1597c3303c2e."
- "Can any commitment be settled right now? If so, build the transaction."

## Tools

All tools are read-only (`readOnlyHint: true`). Any tool that takes a vault defaults to the production vault.

| Tool | What it returns |
|---|---|
| `get_public_stats` | Totals across real vaults: bills paid by the agent, USDC paid, commitments, hits, misses, policy interventions |
| `list_businesses` | Every business behind the numbers, with its vaults and hit/miss record; builder-owned ones flagged |
| `list_vaults` | All vaults, optionally by owner; test vaults labelled |
| `get_vault` | Live on-chain state: liquid, reserve, floor, score, autonomous limit, daily cap, alerts |
| `list_bills` | Bills on a vault, optionally filtered by status |
| `list_payees` | The allowlist: the only addresses the agent can pay, with caps and go-live times |
| `list_commitments` | The agent's on-chain promises: open, hit or miss, and exactly when an open one can be settled |
| `get_trust_history` | The autonomous limit over time, one point per settlement |
| `list_decisions` | Recent agent decisions: trigger, model, status, actions and reasons |
| `get_decision` | One decision in full: proposal, every policy verdict, actions and transactions |
| `verify_decision` | Re-hashes the decision record **in this server** (keccak256) and checks it against the stored and on-chain hashes |
| `build_settle_tx` | Unsigned `settle()` transaction, after checking on-chain that the commitment has matured (anyone may settle) |
| `build_add_payee_tx` | Unsigned `addPayee` transaction for the vault owner's wallet |
| `build_register_bill_tx` | Unsigned `registerObligation` transaction for the vault owner's wallet |

## Resources

| URI | Contents |
|---|---|
| `euthyna://docs/how-it-works` | The mechanism: vault, agent loop, commitments, settlement and scoring |
| `euthyna://docs/contracts` | Deployed contract addresses on Arc testnet |
| `euthyna://vault/{address}` | Live state of any vault, as JSON |

## Prompts

| Prompt | What it does |
|---|---|
| `treasury_report` | A plain-English report on a vault: cash, bills due, recent decisions, trust record |
| `audit_decision` | Explains one decision and proves it wasn't edited |
| `explain_trust` | Walks through every settled commitment and how it moved the agent's limit |

## Configuration

| Variable | Default |
|---|---|
| `EUTHYNA_API_URL` | `https://euthyna-np2i.onrender.com` (the public Euthyna API) |
| `ARC_RPC_URL` | `https://rpc.testnet.arc.io` |
| `EUTHYNA_DEFAULT_VAULT` | the production vault `0x0767f13610b794f1de85CEe78728114df1Ffa23d` |

## How it works

- Reads come from the public Euthyna API and from Arc directly (commitment and grace reads use the chain, so
  "can this be settled now?" is answered from the contract itself).
- `verify_decision` does not trust the backend: it recomputes the keccak256 of the stored canonical record
  locally, then compares it with the stored hash and with the `decisionHash` the agent emitted on-chain.
- Built with the official [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
  and [viem](https://viem.sh). Source: [`src/server.ts`](src/server.ts).
