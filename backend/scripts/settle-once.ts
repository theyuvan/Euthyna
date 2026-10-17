import { activeVaults, pool } from "../src/db.js";
import { settleVault } from "../src/settler.js";

for (const v of await activeVaults()) console.log(JSON.stringify(await settleVault(v)));
await pool.end();
