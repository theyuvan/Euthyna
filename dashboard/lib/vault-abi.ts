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
] as const;
