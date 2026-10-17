// Onboarding CLI: calls the real onboard/* API to get unsigned calldata, then signs and sends it
// with OWNER_PRIVATE_KEY — a stand-in for the owner's own MetaMask until the dashboard exists. Any
// future frontend calls the same API and lets the owner's wallet sign instead of this script.
//
//   npm run onboard -- payee  <vault> <payeeAddress> <maxPerInvoiceUsdc> <maxPerMonthUsdc> [displayName]
//   npm run onboard -- bill   <vault> <payeeAddress> <amountUsdc> <dueAtISO> <invoiceNumber>
//   npm run onboard -- cancel <vault> <obligationId>
import "dotenv/config";
import { createWalletClient, http, parseEventLogs, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { vaultAbi } from "../src/abi.js";
import { arcTestnet, publicClient } from "../src/chain.js";
import { config } from "../src/config.js";

const [cmd, vault, ...rest] = process.argv.slice(2);
const key = process.env.OWNER_PRIVATE_KEY as Hex | undefined;
if (!key) throw new Error("OWNER_PRIVATE_KEY missing");
if (!vault) throw new Error("usage: npm run onboard -- <payee|bill|cancel> <vault> ...");

const account = privateKeyToAccount(key);
const wallet = createWalletClient({ account, chain: arcTestnet, transport: http(config.ARC_RPC_URL) });
const base = process.env.WORKER_API_URL ?? `http://127.0.0.1:${config.PORT}`;
const authHeaders: Record<string, string> = config.ADMIN_TOKEN ? { authorization: `Bearer ${config.ADMIN_TOKEN}` } : {};

async function prepare(path: string, body: unknown) {
  const res = await fetch(`${base}/api/vaults/${vault}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as any;
  if (!res.ok) throw new Error(`${path}: ${json.error ?? res.status}`);
  return json as { to: `0x${string}`; data: Hex };
}

async function signAndSend(to: `0x${string}`, data: Hex) {
  const hash = await wallet.sendTransaction({ account, chain: arcTestnet, to, data });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`tx ${hash}\nstatus ${receipt.status}`);
  return receipt;
}

switch (cmd) {
  case "payee": {
    const [address, maxPerInvoiceUsdc, maxPerMonthUsdc, displayName] = rest;
    const { to, data } = await prepare("onboard/payee", { address, maxPerInvoiceUsdc, maxPerMonthUsdc, displayName });
    await signAndSend(to, data);
    break;
  }
  case "bill": {
    const [payee, amountUsdc, dueAt, invoiceNumber] = rest;
    const { to, data } = await prepare("onboard/obligation", { payee, amountUsdc, dueAt, invoiceNumber });
    const receipt = await signAndSend(to, data);
    const [ev] = parseEventLogs({ abi: vaultAbi, logs: receipt.logs, eventName: "ObligationRegistered" });
    if (ev) {
      await fetch(`${base}/api/vaults/${vault}/obligations/${ev.args.id}/meta`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders },
        body: JSON.stringify({ invoiceNumber }),
      });
      console.log(`obligation id ${ev.args.id}`);
    }
    break;
  }
  case "cancel": {
    const [id] = rest;
    const { to, data } = await prepare(`onboard/obligations/${id}/cancel`, {});
    await signAndSend(to, data);
    break;
  }
  default:
    throw new Error(`unknown command "${cmd}" (want payee|bill|cancel)`);
}
