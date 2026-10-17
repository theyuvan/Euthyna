// Creates one Circle SCA agent wallet on ARC-TESTNET and records it. Use its address as the vault agent.
import { getAddress } from "viem";
import { config } from "../src/config.js";
import { pool, q } from "../src/db.js";
import { circle } from "../src/executor.js";

if (!config.CIRCLE_WALLET_SET_ID) throw new Error("CIRCLE_WALLET_SET_ID missing; run npm run setup:circle");
const r = await circle().createWallets({
  blockchains: ["ARC-TESTNET"],
  count: 1,
  walletSetId: config.CIRCLE_WALLET_SET_ID,
  accountType: "SCA",
} as any);
const w = r.data?.wallets?.[0];
if (!w) throw new Error("Circle returned no wallet");
await q("insert into agent_wallets (wallet_id, address) values ($1,$2) on conflict do nothing", [w.id, w.address.toLowerCase()]);
console.log(`agent wallet ${w.id}\naddress ${getAddress(w.address)}`);
await pool.end();
