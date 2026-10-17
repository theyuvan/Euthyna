import { pool } from "../src/db.js";
import { indexAll } from "../src/indexer.js";

const wake = await indexAll();
console.log("indexed; vaults with new activity:", wake.map((v) => v.address));
await pool.end();
