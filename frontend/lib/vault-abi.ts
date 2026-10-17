// Minimal EuthynaVault fragment — just what the dashboard reads directly from the chain.
export const vaultAbi = [
  {
    type: "function",
    name: "getPayee",
    stateMutability: "view",
    inputs: [{ name: "p", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "allowed", type: "bool" },
          { name: "activeAt", type: "uint64" },
          { name: "maxPerInvoice", type: "uint128" },
          { name: "maxPerMonth", type: "uint128" },
          { name: "monthSpent", type: "uint128" },
          { name: "monthStart", type: "uint64" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "grace",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
  // Permissionless: anyone can grade a matured commitment.
  {
    type: "function",
    name: "settle",
    stateMutability: "nonpayable",
    inputs: [{ name: "cid", type: "uint32" }],
    outputs: [],
  },
  {
    type: "event",
    name: "Settled",
    inputs: [
      { name: "cid", type: "uint32", indexed: true },
      { name: "hit", type: "bool", indexed: false },
      { name: "credit", type: "uint256", indexed: false },
      { name: "newScore", type: "uint256", indexed: false },
      { name: "newLimit", type: "uint256", indexed: false },
    ],
  },
  { type: "error", name: "NotMatured", inputs: [] },
  { type: "error", name: "AlreadySettled", inputs: [] },
] as const;
