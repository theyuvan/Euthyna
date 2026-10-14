import pg from "pg";
import { config } from "./config.js";

// numeric and int8 come back as strings: exact decimals, no float rounding.
export const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 10 });

export async function q<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query<T>(text, params as any[]);
  return res.rows;
}

export async function one<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []): Promise<T | undefined> {
  return (await q<T>(text, params))[0];
}

/**
 * Session-level advisory lock on the vault, so two runs never act on one vault at once.
 * Needs a session connection: on Supabase use the direct connection or the session pooler
 * (port 5432), not the transaction pooler (6543). Returns undefined if another run holds it.
 */
export async function withVaultLock<T>(vaultId: string, fn: () => Promise<T>): Promise<T | undefined> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query("select pg_try_advisory_lock(hashtextextended($1, 0)) as ok", [vaultId]);
    if (!rows[0].ok) return undefined;
    try {
      return await fn();
    } finally {
      await client.query("select pg_advisory_unlock(hashtextextended($1, 0))", [vaultId]);
    }
  } finally {
    client.release();
  }
}

export interface VaultRow {
  id: string;
  address: `0x${string}`;
  owner_address: string;
  agent_wallet_id: string | null;
  agent_address: `0x${string}`;
  created_block: string;
  last_indexed_block: string;
  active: boolean;
  is_test: boolean;
}

export const activeVaults = () => q<VaultRow>("select * from vaults where active order by created_at");
export const vaultByAddress = (address: string) =>
  one<VaultRow>("select * from vaults where address = $1", [address.toLowerCase()]);

export async function alertOwner(vaultId: string, kind: string, message: string, data?: unknown) {
  // One open alert per (vault, kind, message), so a repeating failure does not spam the owner.
  await q(
    `insert into owner_alerts (vault_id, kind, message, data)
     select $1, $2, $3, $4
     where not exists (
       select 1 from owner_alerts where vault_id = $1 and kind = $2 and message = $3 and resolved_at is null
     )`,
    [vaultId, kind, message, data === undefined ? null : JSON.stringify(data)],
  );
}
