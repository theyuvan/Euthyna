// Where the server reads from. Every value has a working default, so `npx euthyna-mcp` just works.
export const config = {
  apiUrl: (process.env.EUTHYNA_API_URL ?? "https://euthyna-np2i.onrender.com").replace(/\/$/, ""),
  rpcUrl: process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.io",
  appUrl: "https://euthynax.vercel.app",
  explorer: "https://testnet.arcscan.app",
  chainId: 5042002,
  /** The production vault, used when a tool is called without a vault address. */
  defaultVault: (process.env.EUTHYNA_DEFAULT_VAULT ?? "0x0767f13610b794f1de85CEe78728114df1Ffa23d") as `0x${string}`,
  factory: "0xD6846FB7BAD7F8CDba6eE8fB4b42D4e16A30d658" as `0x${string}`,
  usdc: "0x3600000000000000000000000000000000000000" as `0x${string}`,
};
