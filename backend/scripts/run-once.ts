// Runs one agent decision for a vault (or every active vault) and prints the result.
//   npm run agent:once -- 0xVault
import { runVault } from "../src/agent.js";
import { activeVaults, pool, vaultByAddress } from "../src/db.js";

const addr = process.argv[2];
const vaults = addr ? [await vaultByAddress(addr)] : await activeVaults();
for (const v of vaults) {
  if (!v) throw new Error(`unknown vault ${addr}`);
  console.log(JSON.stringify(await runVault(v, "manual"), null, 2));
}
await pool.end();
