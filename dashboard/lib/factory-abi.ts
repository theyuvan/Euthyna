// Just the two pieces the dashboard's Onboard flow actually calls — not the whole factory ABI.
export const factoryAbi = [
  {
    type: "function",
    name: "createVault",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [{ name: "vault", type: "address" }],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "VaultCreated",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "vault", type: "address", indexed: true },
      { name: "agent", type: "address", indexed: true },
    ],
    anonymous: false,
  },
] as const;

export const FACTORY_ADDRESS = process.env.NEXT_PUBLIC_FACTORY_ADDRESS ?? "0xD6846FB7BAD7F8CDba6eE8fB4b42D4e16A30d658";
