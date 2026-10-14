import { createPublicClient, defineChain, http, type Address } from "viem";
import { arcTestnet as viemArcTestnet } from "viem/chains";
import { config } from "./config.js";

export const USDC: Address = "0x3600000000000000000000000000000000000000";

export const arcTestnet = defineChain({
  ...viemArcTestnet,
  id: config.ARC_CHAIN_ID,
  rpcUrls: { default: { http: [config.ARC_RPC_URL] } },
});

export const publicClient = createPublicClient({ chain: arcTestnet, transport: http(config.ARC_RPC_URL) });

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
