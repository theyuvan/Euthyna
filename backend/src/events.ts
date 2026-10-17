import type { Response } from "express";
import { q } from "./db.js";

// In-memory pub/sub for the live reasoning stream. One process is enough (per the spec): the worker
// and the API share a process, so every emit() during a run is visible to anyone subscribed to that
// vault's /live stream in the same moment. Restarting the process just drops subscribers; they
// reconnect and pick up new events from then on (past events are still in agent_events via the DB).
const subscribers = new Map<string, Set<Response>>();

export function subscribe(vaultId: string, res: Response) {
  let set = subscribers.get(vaultId);
  if (!set) subscribers.set(vaultId, (set = new Set()));
  set.add(res);
  return () => {
    set!.delete(res);
    if (set!.size === 0) subscribers.delete(vaultId);
  };
}

// FinalAction and similar payloads carry raw bigint fields (amount, horizonSec). JSON.stringify
// can't serialize those on its own, so every stringify here goes through this replacer.
const jsonSafe = (_key: string, value: unknown) => (typeof value === "bigint" ? value.toString() : value);

function publish(vaultId: string, stage: string, detail: unknown, at: string) {
  const set = subscribers.get(vaultId);
  if (!set || set.size === 0) return;
  try {
    const line = `data: ${JSON.stringify({ stage, detail, at }, jsonSafe)}\n\n`;
    for (const res of set) res.write(line);
  } catch (e) {
    // A bad payload must never take down the run that's emitting it.
    console.error("[events] failed to publish", vaultId, stage, e);
  }
}

/** Logs one stage of an agent run, for the audit trail and the live stream. Never throws. */
export async function emit(vaultId: string, stage: string, detail: unknown): Promise<void> {
  const at = new Date().toISOString();
  publish(vaultId, stage, detail, at);
  try {
    await q("insert into agent_events (vault_id, stage, detail) values ($1,$2,$3)", [vaultId, stage, JSON.stringify(detail ?? null, jsonSafe)]);
  } catch (e) {
    // Logging must never break the actual run.
    console.error("[events] failed to record", vaultId, stage, e);
  }
}
