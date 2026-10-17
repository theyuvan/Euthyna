import { createPublicClient, defineChain, fallback, http, type Address } from "viem";
import { arcTestnet as viemArcTestnet } from "viem/chains";
import { config } from "./config.js";

export const USDC: Address = "0x3600000000000000000000000000000000000000";

export const arcTestnet = defineChain({
  ...viemArcTestnet,
  id: config.ARC_CHAIN_ID,
  rpcUrls: { default: { http: [config.ARC_RPC_URL] } },
});

// Public testnet RPCs go down and rate-limit (the old rpc.testnet.arc.network was retired outright).
// Primary + fallbacks, a couple of quick retries each (exponential backoff, ~1.2s total), and a 5s
// per-attempt cap so a real outage still surfaces fast.
const rpc = (url: string) => http(url, { retryCount: 2, retryDelay: 400, timeout: 5_000 });

export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: fallback([config.ARC_RPC_URL, ...config.ARC_RPC_FALLBACK_URLS].map(rpc)),
  // Collapses concurrent readContract calls (e.g. the 12 reads behind GET /api/vaults/:vault) into
  // one Multicall3 eth_call — deployed on Arc at the canonical address, listed in viem's chain def.
  batch: { multicall: true },
});

export class RpcUnavailableError extends Error {
  constructor(cause: unknown) {
    super("Arc testnet RPC is unreachable or rate-limiting right now (not a bug in this app) — try again shortly.");
    this.name = "RpcUnavailableError";
    this.cause = cause;
  }
}

/** Wrap an RPC call so a DNS/connect failure surfaces as a clear, distinguishable error instead
 *  of viem's raw multi-paragraph HttpRequestError dump. */
export async function withRpcErrorContext<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|dns error|EAI_AGAIN|rate limit|exceeds defined limit|429/i.test(msg)) {
      throw new RpcUnavailableError(e);
    }
    throw e;
  }
}

export const usdcAbi = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { indexed: true, name: "from", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: false, name: "value", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

/** Chain time, not wall-clock time: the contract judges deadlines by block.timestamp. */
export async function chainNow(): Promise<bigint> {
  const block = await publicClient.getBlock({ blockTag: "latest" });
  return block.timestamp;
}

export const txUrl = (hash: string) => `${config.EXPLORER_URL}/tx/${hash}`;
