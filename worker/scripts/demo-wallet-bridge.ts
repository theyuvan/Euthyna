// Demo-only stand-in for MetaMask: holds OWNER_PRIVATE_KEY in Node and serves the handful of
// EIP-1193 methods the dashboard uses, so a headless browser can drive the real owner flows.
// Signatures and transactions are genuine (signed by the real owner key, broadcast to Arc).
// Binds to 127.0.0.1 only and accepts requests only from the local dashboard origin.
import "dotenv/config";
import express from "express";
import { createWalletClient, fallback, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "../src/chain.js";
import { config } from "../src/config.js";

const key = process.env.OWNER_PRIVATE_KEY as Hex | undefined;
if (!key) throw new Error("OWNER_PRIVATE_KEY not set");

const account = privateKeyToAccount(key);
// Fallbacks first: the primary is shared with the worker's indexer and rate-limits this IP under load.
const wallet = createWalletClient({
  account,
  chain: arcTestnet,
  transport: fallback([...config.ARC_RPC_FALLBACK_URLS, config.ARC_RPC_URL].map((u) => http(u))),
});
const CHAIN_ID = "0x" + config.ARC_CHAIN_ID.toString(16);
const ALLOWED_ORIGIN = "http://localhost:3000";
const PORT = 8788;

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  if (req.headers.origin && req.headers.origin !== ALLOWED_ORIGIN) return res.status(403).json({ error: "origin" });
  next();
});

app.post("/rpc", async (req, res) => {
  const { method, params = [] } = req.body as { method: string; params?: any[] };
  console.log(`[bridge] ${method}`);
  try {
    switch (method) {
      case "eth_requestAccounts":
      case "eth_accounts":
        return res.json({ result: [account.address] });
      case "eth_chainId":
        return res.json({ result: CHAIN_ID });
      case "wallet_switchEthereumChain":
      case "wallet_addEthereumChain":
        return res.json({ result: null });
      case "personal_sign": {
        const [message, from] = params as [string, string];
        if (from.toLowerCase() !== account.address.toLowerCase()) throw new Error("unknown signer");
        return res.json({ result: await account.signMessage({ message }) });
      }
      case "eth_sendTransaction": {
        const [tx] = params as [{ to: Hex; data: Hex; from: string; value?: Hex }];
        if (tx.from.toLowerCase() !== account.address.toLowerCase()) throw new Error("unknown sender");
        const hash = await wallet.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : undefined });
        console.log(`[bridge]   -> ${hash}`);
        return res.json({ result: hash });
      }
      default:
        return res.status(400).json({ error: { code: 4200, message: `unsupported method ${method}` } });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message.split("\n")[0] : String(e);
    console.error(`[bridge]   !! ${message}`);
    return res.status(500).json({ error: { code: -32000, message } });
  }
});

app.listen(PORT, "127.0.0.1", () => console.log(`demo wallet bridge on 127.0.0.1:${PORT} as ${account.address}`));
