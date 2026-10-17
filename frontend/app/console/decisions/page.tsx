"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getDecisions, type DecisionRow } from "@/lib/api";
import { useVault } from "@/lib/useVault";
import { Panel, EmptyState, ErrorState, StatusPill, HashText } from "@/components/primitives";

function statusKind(status: string) {
  if (status === "CONFIRMED") return "hit" as const;
  if (status === "FAILED" || status === "PARTIAL") return "miss" as const;
  return "pending" as const;
}

export default function DecisionsPage() {
  const [vault] = useVault();
  const [decisions, setDecisions] = useState<DecisionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true; // ignore responses from a superseded vault
    setDecisions(null);
    setError(null);
    getDecisions(vault)
      .then((d) => live && setDecisions(d))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [vault]);

  return (
    <div>
      <div className="px-8 pt-8 pb-6 border-b border-border">
        <h1 className="font-macro text-3xl tracking-tight uppercase">Decisions</h1>
        <p className="text-xs text-ink-dim mt-2 max-w-2xl leading-relaxed">
          Every agent run, in order. Each one is hashed before anything is sent — click a row to replay and verify it.
        </p>
      </div>

      <div className="p-8">
        {error && <ErrorState message={error} />}
        <Panel title={`Decision feed · ${(decisions ?? []).length}`}>
          {!decisions ? (
            <EmptyState>Loading…</EmptyState>
          ) : decisions.length === 0 ? (
            <EmptyState>No decisions recorded for this vault yet.</EmptyState>
          ) : (
            <div className="divide-y divide-border">
              {decisions.map((d) => (
                <Link
                  key={d.id}
                  href={`/console/replay?id=${d.id}`}
                  className="block px-4 py-3 hover:bg-surface transition-colors"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <StatusPill kind={statusKind(d.status)}>{d.status}</StatusPill>
                      <span className="text-[10px] text-ink-dim font-data uppercase">{d.trigger}</span>
                      <span className="text-[10px] text-ink-dim font-data">{d.model_served ?? d.model}</span>
                    </div>
                    <span className="text-[10px] text-ink-dim font-data">{new Date(d.created_at).toLocaleString()}</span>
                  </div>
                  <div className="mt-2 space-y-1">
                    {d.llm?.actions?.length ? (
                      d.llm.actions.map((a, i) => (
                        <div key={i} className="text-xs font-data">
                          <span className="uppercase text-ink">{a.type}</span>
                          {a.amountUsdc && <span className="text-ink-dim"> · {a.amountUsdc} USDC</span>}
                          {a.horizonHours && <span className="text-ink-dim"> · {a.horizonHours}h</span>}
                          <span className="text-ink-dim"> — {a.reason}</span>
                        </div>
                      ))
                    ) : (
                      <div className="text-[10px] uppercase tracking-wide text-ink-dim font-data">{d.error ?? "no actions"}</div>
                    )}
                  </div>
                  <div className="mt-2 text-[10px] text-ink-dim font-data">
                    decisionHash: <HashText hash={d.decision_hash} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
