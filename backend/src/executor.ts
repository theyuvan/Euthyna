import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { BaseError, ContractFunctionRevertedError, createWalletClient, decodeErrorResult, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { vaultAbi } from "./abi.js";
import { arcTestnet, publicClient } from "./chain.js";
import { config } from "./config.js";

export interface SendRequest {
  to: Address;
  data: Hex;
  from: Address; // agent address, used for simulation
  walletId: string | null; // Circle wallet id (circle executor)
  idempotencyKey: string; // uuid
  refId?: string;
}

export interface SendResult {
  ok: boolean;
  circleTxId: string | null;
  txHash: Hex | null;
  error: string | null;
}

/** Decodes a revert into the vault's custom error name when possible ("OverLimit", "RefUsed", ...). */
export function describeRevert(e: unknown): string {
  if (e instanceof BaseError) {
    const reverted = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      return reverted.data?.errorName ?? reverted.reason ?? reverted.shortMessage;
    }
    const raw = (e.walk((x: any) => typeof x?.data === "string" && x.data.startsWith("0x")) as any)?.data as Hex | undefined;
    if (raw) {
      try {
        return decodeErrorResult({ abi: vaultAbi, data: raw }).errorName;
      } catch {
        /* not a vault error: the token reverted (e.g. blocklist) */
      }
    }
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}

/** eth_call from the agent's address: the contract itself is the final policy check before sending. */
export async function simulate(req: Pick<SendRequest, "to" | "data" | "from">): Promise<string | null> {
  try {
    await publicClient.call({ account: req.from, to: req.to, data: req.data });
    return null;
  } catch (e) {
    return describeRevert(e);
  }
}

// ------------------------------------------------------------------ circle

let circleClient: ReturnType<typeof initiateDeveloperControlledWalletsClient> | null = null;
export function circle() {
  if (!circleClient) {
    if (!config.CIRCLE_API_KEY || !config.CIRCLE_ENTITY_SECRET) throw new Error("Circle credentials missing");
    circleClient = initiateDeveloperControlledWalletsClient({
      apiKey: config.CIRCLE_API_KEY,
      entitySecret: config.CIRCLE_ENTITY_SECRET,
    });
  }
  return circleClient;
}

async function sendCircle(req: SendRequest): Promise<SendResult> {
  if (!req.walletId) return { ok: false, circleTxId: null, txHash: null, error: "vault has no Circle agent_wallet_id" };
  const c = circle();
  let id: string | undefined;
  try {
    const created = await c.createContractExecutionTransaction({
      walletId: req.walletId,
      contractAddress: req.to,
      callData: req.data,
      fee: { type: "level", config: { feeLevel: config.CIRCLE_FEE_LEVEL } },
      idempotencyKey: req.idempotencyKey,
      refId: req.refId,
    });
    id = created.data?.id;
    if (!id) return { ok: false, circleTxId: null, txHash: null, error: "Circle returned no transaction id" };
  } catch (e) {
    return { ok: false, circleTxId: null, txHash: null, error: `Circle create failed: ${errMsg(e)}` };
  }
  return waitCircle(id);
}

/** Waits for a Circle transaction to finish. Used after sending and to reconcile after a crash. */
export async function waitCircle(id: string): Promise<SendResult> {
  const c = circle();
  try {
    const res = await c.getTransaction({ id, waitForState: "COMPLETE", pollingInterval: 2000 } as any);
    const tx = (res as any).data?.transaction;
    return { ok: true, circleTxId: id, txHash: (tx?.txHash as Hex) ?? null, error: null };
  } catch (e) {
    // Terminal failure (FAILED, DENIED, CANCELLED, STUCK). Fetch once more for the hash and reason.
    try {
      const res = await c.getTransaction({ id });
      const tx = res.data?.transaction;
      return { ok: false, circleTxId: id, txHash: (tx?.txHash as Hex) ?? null, error: `${tx?.state}: ${tx?.errorReason ?? errMsg(e)}` };
    } catch {
      return { ok: false, circleTxId: id, txHash: null, error: errMsg(e) };
    }
  }
}

function errMsg(e: unknown): string {
  const anyE = e as any;
  return anyE?.response?.data?.message ?? anyE?.message ?? String(e);
}

// ------------------------------------------------------------------- local

const localAccount = config.AGENT_PRIVATE_KEY ? privateKeyToAccount(config.AGENT_PRIVATE_KEY as Hex) : null;
const localWallet = localAccount
  ? createWalletClient({ account: localAccount, chain: arcTestnet, transport: http(config.ARC_RPC_URL) })
  : null;
export const localAgentAddress = localAccount?.address ?? null;

async function sendLocal(req: SendRequest): Promise<SendResult> {
  if (!localWallet) return { ok: false, circleTxId: null, txHash: null, error: "AGENT_PRIVATE_KEY not set" };
  try {
    const hash = await localWallet.sendTransaction({ to: req.to, data: req.data, account: localAccount!, chain: arcTestnet });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
    return { ok: receipt.status === "success", circleTxId: null, txHash: hash, error: receipt.status === "success" ? null : "reverted" };
  } catch (e) {
    return { ok: false, circleTxId: null, txHash: null, error: describeRevert(e) };
  }
}

export function send(req: SendRequest): Promise<SendResult> {
  return config.EXECUTOR === "circle" ? sendCircle(req) : sendLocal(req);
}
