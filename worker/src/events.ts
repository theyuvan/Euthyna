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

function publish(vaultId: string, stage: string, detail: unknown, at: string) {
  const set = subscribers.get(vaultId);
  if (!set || set.size === 0) return;
  const line = `data: ${JSON.stringify({ stage, detail, at })}\n\n`;
  for (const res of set) res.write(line);
}

/** Logs one stage of an agent run, for the audit trail and the live stream. Never throws. */
export async function emit(vaultId: string, stage: string, detail: unknown): Promise<void> {
  const at = new Date().toISOString();
  publish(vaultId, stage, detail, at);
  try {
    await q("insert into agent_events (vault_id, stage, detail) values ($1,$2,$3)", [vaultId, stage, JSON.stringify(detail ?? null)]);
  } catch (e) {
    // Logging must never break the actual run.
    console.error("[events] failed to record", vaultId, stage, e);
  }
}
