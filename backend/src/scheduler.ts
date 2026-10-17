import { runVault } from "./agent.js";
import { config } from "./config.js";
import { activeVaults, type VaultRow } from "./db.js";
import { indexAll } from "./indexer.js";
import { settleVault } from "./settler.js";

const log = (tag: string, ...a: unknown[]) => console.log(new Date().toISOString(), `[${tag}]`, ...a);

// One queued run per vault; triggers that arrive while a run is going are coalesced into one follow-up.
const queued = new Map<string, { v: VaultRow; reasons: Set<string> }>();
const running = new Set<string>();

export function requestRun(v: VaultRow, reason: string) {
  const entry = queued.get(v.id) ?? { v, reasons: new Set<string>() };
  entry.reasons.add(reason);
  queued.set(v.id, entry);
  void drain(v.id);
}

async function drain(id: string) {
  if (running.has(id)) return;
  const entry = queued.get(id);
  if (!entry) return;
  queued.delete(id);
  running.add(id);
  const trigger = [...entry.reasons].sort().join("+");
  try {
    const r = await runVault(entry.v, trigger);
    if (r.skipped) log("agent", entry.v.address, "skipped:", r.skipped);
    else
      log("agent", entry.v.address, trigger, r.actions?.map((a) => `${a.type}:${a.status}`).join(", ") || "hold", r.llmError ? `(llm: ${r.llmError})` : "");
  } catch (e) {
    log("agent", entry.v.address, "error:", e instanceof Error ? e.stack : e);
  } finally {
    running.delete(id);
    if (queued.has(id)) void drain(id);
  }
}

/** Runs fn every `ms`, never overlapping itself. */
function every(name: string, ms: number, fn: () => Promise<void>) {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await fn();
    } catch (e) {
      log(name, "error:", e instanceof Error ? e.stack : e);
    } finally {
      busy = false;
    }
  };
  void tick();
  return setInterval(tick, ms);
}

let indexing: Promise<void> | null = null;
/** Index now (debounced), and wake vaults that saw a deposit, a new bill, an approval or a settlement. */
export function indexNow(): Promise<void> {
  indexing ??= (async () => {
    try {
      for (const v of await indexAll()) requestRun(v, "event");
    } finally {
      indexing = null;
    }
  })();
  return indexing;
}

export function startLoops() {
  every("indexer", config.INDEXER_INTERVAL_SEC * 1000, indexNow);

  every("settler", config.SETTLER_INTERVAL_MIN * 60_000, async () => {
    for (const v of await activeVaults()) {
      const r = await settleVault(v);
      if (r.settled.length || r.materialized.length) log("settler", v.address, `settled ${r.settled.join(",") || "-"}; materialized ${r.materialized.join(",") || "-"}`);
      if (r.errors.length) log("settler", v.address, "errors:", r.errors.join(" | "));
      if (r.settled.length || r.materialized.length) requestRun(v, "settlement");
    }
  });

  every("agent", config.AGENT_INTERVAL_MIN * 60_000, async () => {
    for (const v of await activeVaults()) requestRun(v, "schedule");
  });
}
