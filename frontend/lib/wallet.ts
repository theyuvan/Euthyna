"use client";

// Minimal EIP-1193 wallet integration — no wagmi/viem-in-browser needed for what this dashboard
// actually does (connect, maybe switch chain, send one prepared transaction). The owner's key never
// touches this app; MetaMask (or any injected wallet) signs locally.

const ARC_TESTNET = {
  chainId: "0x" + (5042002).toString(16), // 0x4cef52
  chainName: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: ["https://rpc.testnet.arc.io"],
  blockExplorerUrls: ["https://testnet.arcscan.app"],
};

interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

function provider(): Eip1193Provider {
  const eth = (globalThis as unknown as { ethereum?: Eip1193Provider }).ethereum;
  if (!eth) throw new Error("No wallet found — install MetaMask or another injected wallet");
  return eth;
}

export async function connectWallet(): Promise<string> {
  const accounts = (await provider().request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts?.[0]) throw new Error("No account returned by wallet");
  await ensureArcTestnet();
  return accounts[0];
}

async function ensureArcTestnet() {
  try {
    await provider().request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_TESTNET.chainId }] });
  } catch (e) {
    // 4902 = chain not added yet
    const code = (e as { code?: number })?.code;
    if (code === 4902) {
      await provider().request({ method: "wallet_addEthereumChain", params: [ARC_TESTNET] });
    } else {
      throw e;
    }
  }
}

/** Drops this site's account permission in wallets that support it (MetaMask does), so the next
 *  connect asks again. Wallets without the method just ignore it; the app forgets the account anyway. */
export async function revokeWallet(): Promise<void> {
  await provider()
    .request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] })
    .catch(() => {});
}

/** Calls back with the active account (or null) whenever the wallet switches or locks. */
export function onAccountsChanged(cb: (account: string | null) => void): () => void {
  const eth = (globalThis as unknown as { ethereum?: { on?: Function; removeListener?: Function } }).ethereum;
  if (!eth?.on) return () => {};
  const handler = (accounts: string[]) => cb(accounts?.[0] ?? null);
  eth.on("accountsChanged", handler);
  return () => eth.removeListener?.("accountsChanged", handler);
}

/** Sends a prepared {to, data} as the connected owner account. Returns the tx hash. */
export async function sendPreparedTx(to: string, data: string, from: string): Promise<string> {
  const hash = (await provider().request({
    method: "eth_sendTransaction",
    params: [{ to, data, from }],
  })) as string;
  return hash;
}

/**
 * The real owner-auth scheme the backend expects (server.ts requireOwner): sign
 *   "Euthyna owner action\nvault: <vault lowercase>\naction: <action>\ntimestamp: <unix>"
 * with the connected wallet, send as `x-euthyna-auth: <timestamp>.<signature>`. Valid 10 minutes.
 * This is the real production path — the owner proves control of their own key, no shared secret.
 */
export async function ownerAuthHeader(vault: string, action: string, from: string): Promise<string> {
  const ts = Math.floor(Date.now() / 1000);
  const message = `Euthyna owner action\nvault: ${vault.toLowerCase()}\naction: ${action}\ntimestamp: ${ts}`;
  const signature = (await provider().request({
    method: "personal_sign",
    params: [message, from],
  })) as string;
  return `${ts}.${signature}`;
}
