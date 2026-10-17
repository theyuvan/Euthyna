import { createPublicClient, fallback, http, type Chain } from "viem";

export const arcTestnet: Chain = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } },
  blockExplorers: { default: { name: "Arcscan", url: "https://testnet.arcscan.app" } },
};

// Both endpoints are official (viem's arcTestnet def) and allow browser CORS; the second takes over
// when the first rate-limits.
export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: fallback([http("https://rpc.testnet.arc.io"), http("https://rpc.blockdaemon.testnet.arc.io")]),
});
