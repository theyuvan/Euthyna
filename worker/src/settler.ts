import { randomUUID } from "node:crypto";
import { encodeFunctionData, getAddress } from "viem";
import { vaultAbi } from "./abi.js";
import { publicClient } from "./chain.js";
import { withVaultLock, type VaultRow } from "./db.js";
import { send, simulate } from "./executor.js";

const RECURRING_LOOKAHEAD = 7n * 24n * 3600n;

export interface SettleSummary {
  vault: string;
  settled: number[];
  materialized: number[];
  errors: string[];
  skipped?: string;
}

/**
 * Settles matured commitments and materializes due recurring bills. Both are permissionless on-chain,
 * so the result is the same whoever calls; we send from the vault's agent wallet for gas sponsorship.
 */
export async function settleVault(v: VaultRow): Promise<SettleSummary> {
  const res = await withVaultLock(v.id, () => settleLocked(v));
  return res ?? { vault: v.address, settled: [], materialized: [], errors: [], skipped: "vault locked" };
}

async function settleLocked(v: VaultRow): Promise<SettleSummary> {
  const vault = getAddress(v.address);
  const at = { address: vault, abi: vaultAbi } as const;
  const out: SettleSummary = { vault, settled: [], materialized: [], errors: [] };
  const [block, openIds, grace, recurringCount] = await Promise.all([
    publicClient.getBlock({ blockTag: "latest" }),
    publicClient.readContract({ ...at, functionName: "openCommitmentIds" }),
    publicClient.readContract({ ...at, functionName: "grace" }),
    publicClient.readContract({ ...at, functionName: "recurringCount" }),
  ]);
  const now = block.timestamp;

  const call = async (data: `0x${string}`, label: string) => {
    const simError = await simulate({ to: vault, data, from: v.agent_address });
    if (simError) {
      out.errors.push(`${label}: ${simError}`);
      return false;
    }
    const r = await send({ to: vault, data, from: v.agent_address, walletId: v.agent_wallet_id, idempotencyKey: randomUUID(), refId: label });
    if (!r.ok) out.errors.push(`${label}: ${r.error}`);
    return r.ok;
  };

  for (const cid of openIds) {
    const c = await publicClient.readContract({ ...at, functionName: "getCommitment", args: [cid] });
    if (now < c.T + grace) continue;
    const data = encodeFunctionData({ abi: vaultAbi, functionName: "settle", args: [cid] });
    if (await call(data, `settle:${cid}`)) out.settled.push(cid);
  }

  for (let rid = 1; rid <= recurringCount; rid++) {
    const r = await publicClient.readContract({ ...at, functionName: "getRecurring", args: [rid] });
    if (!r.active || r.nextDueAt > now + RECURRING_LOOKAHEAD) continue;
    const data = encodeFunctionData({ abi: vaultAbi, functionName: "materializeRecurring", args: [rid] });
    if (await call(data, `materialize:${rid}`)) out.materialized.push(rid);
  }
  return out;
}
