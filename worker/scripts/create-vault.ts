// Creates a vault owned by OWNER_PRIVATE_KEY, for your own business or a test vault.
// Owners normally do this from the dashboard with MetaMask; this is the CLI path.
//   npm run create-vault -- <agentAddress> [--test]
import "dotenv/config";
import { createWalletClient, getAddress, http, parseEventLogs, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { factoryAbi } from "../src/abi.js";
import { arcTestnet, publicClient } from "../src/chain.js";
import { config } from "../src/config.js";
import { one, pool, q } from "../src/db.js";

const agent = process.argv[2];
const isTest = process.argv.includes("--test");
if (!agent) throw new Error("usage: npm run create-vault -- <agentAddress> [--test]");
if (!config.FACTORY_ADDRESS) throw new Error("FACTORY_ADDRESS missing");
const key = process.env.OWNER_PRIVATE_KEY as Hex | undefined;
if (!key) throw new Error("OWNER_PRIVATE_KEY missing");

const account = privateKeyToAccount(key);
const wallet = createWalletClient({ account, chain: arcTestnet, transport: http(config.ARC_RPC_URL) });
const hash = await wallet.writeContract({
  address: getAddress(config.FACTORY_ADDRESS),
  abi: factoryAbi,
  functionName: "createVault",
  args: [getAddress(agent)],
});
const receipt = await publicClient.waitForTransactionReceipt({ hash });
const [ev] = parseEventLogs({ abi: factoryAbi, logs: receipt.logs, eventName: "VaultCreated" });
const vault = ev.args.vault;
const w = await one<{ wallet_id: string }>("select wallet_id from agent_wallets where address = $1", [agent.toLowerCase()]);
await q(
  `insert into vaults (address, owner_address, agent_wallet_id, agent_address, created_block, last_indexed_block, is_test)
   values ($1,$2,$3,$4,$5,$6,$7) on conflict (address) do update set is_test = excluded.is_test`,
  [vault.toLowerCase(), account.address.toLowerCase(), w?.wallet_id ?? null, agent.toLowerCase(), receipt.blockNumber.toString(), (receipt.blockNumber - 1n).toString(), isTest],
);
if (w) await q("update agent_wallets set vault_id = (select id from vaults where address = $2) where wallet_id = $1", [w.wallet_id, vault.toLowerCase()]);
console.log(`vault ${vault}\nowner ${account.address}\nagent ${agent}${isTest ? " (test vault)" : ""}\ntx ${hash}`);
await pool.end();
