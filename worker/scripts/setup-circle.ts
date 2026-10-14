// One-time Circle setup for dev-controlled wallets.
//  1. With no CIRCLE_ENTITY_SECRET: prints a fresh one to put in .env, then exits.
//  2. With one: registers its ciphertext (saves the recovery file) and creates a wallet set.
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { initiateDeveloperControlledWalletsClient, registerEntitySecretCiphertext } from "@circle-fin/developer-controlled-wallets";

const apiKey = process.env.CIRCLE_API_KEY;
const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
if (!apiKey) throw new Error("Set CIRCLE_API_KEY in worker/.env first (console.circle.com > API keys, testnet key)");

if (!entitySecret) {
  console.log("No CIRCLE_ENTITY_SECRET yet. Add this line to worker/.env, keep it secret, then rerun:\n");
  console.log(`CIRCLE_ENTITY_SECRET=${randomBytes(32).toString("hex")}`);
  process.exit(0);
}

const recoveryPath = "circle-recovery.dat";
if (!existsSync(recoveryPath)) {
  try {
    const r = await registerEntitySecretCiphertext({ apiKey, entitySecret });
    writeFileSync(recoveryPath, r.data?.recoveryFile ?? "");
    console.log(`entity secret registered; recovery file saved to worker/${recoveryPath} (back it up, never commit it)`);
  } catch (e: any) {
    console.log("register skipped:", e?.response?.data?.message ?? e?.message, "(fine if it was already registered)");
  }
}

const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
if (process.env.CIRCLE_WALLET_SET_ID) {
  console.log("CIRCLE_WALLET_SET_ID already set:", process.env.CIRCLE_WALLET_SET_ID);
} else {
  const ws = await client.createWalletSet({ name: "euthyna-agents" });
  console.log(`Add to worker/.env:\nCIRCLE_WALLET_SET_ID=${ws.data?.walletSet?.id}`);
}
