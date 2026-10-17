import { createPublicClient, defineChain, http, keccak256, stringToHex, parseAbi, type Hex } from "viem";
import { config } from "./config.js";

export const arcTestnet = defineChain({
  id: config.chainId,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
  blockExplorers: { default: { name: "Arcscan", url: config.explorer } },
});

export const client = createPublicClient({ chain: arcTestnet, transport: http(config.rpcUrl, { retryCount: 2 }) });

// Only the parts of EuthynaVault this server reads or builds calldata for.
export const vaultAbi = parseAbi([
  "function grace() view returns (uint64)",
  "function getCommitment(uint32 cid) view returns ((uint128 amount, uint128 remaining, uint64 openedAt, uint64 T, uint64 lastUpdate, uint32 coverTo, uint128 limitAtOpen, uint256 capitalSeconds, bytes32 decisionHash, bool settled, bool hit, uint128 credit))",
  "function settle(uint32 cid)",
  "function addPayee(address p, uint128 maxPerInvoice, uint128 maxPerMonth)",
  "function registerObligation(address payee, uint128 amount, uint64 dueAt, bytes32 ref)",
]);

/** The same hashing the agent uses before acting: keccak256 over the canonical JSON bytes. */
export const hashCanonical = (json: string): Hex => keccak256(stringToHex(json));
