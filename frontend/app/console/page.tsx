"use client";

import { useEffect, useState } from "react";
import {
  getInflows,
  getObligations,
  getVault,
  ApiError,
  type InflowRow,
  type Obligation,
  type VaultState,
} from "@/lib/api";
import { useVault } from "@/lib/useVault";
import { PageHeader, StatTile, StatRow, Panel, EmptyState, ErrorState, RpcUnavailableState, HashLink, StatusPill } from "@/components/primitives";

export default function TreasuryPage() {
  const [vault] = useVault();
  const [state, setState] = useState<VaultState | null>(null);
  const [obligations, setObligations] = useState<Obligation[] | null>(null);
  const [inflows, setInflows] = useState<InflowRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rpcDown, setRpcDown] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Date.now() can't be read inline during render (Next.js's prerender would bake in a stale
  // value) — deferred into state so it's only ever read client-side, after mount.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    // ignore responses from a superseded vault (it switches from the default right after mount)
    let live = true;
    setNow(Date.now());
    setError(null);
    setRpcDown(false);
    // Vault state needs a live on-chain read; obligations/inflows are DB-backed. Fetched
    // independently so an RPC outage doesn't also blank out the DB-backed tables.
    getVault(vault)
      .then((s) => live && setState(s))
      .catch((e) => live && (e instanceof ApiError && e.code === "RPC_UNAVAILABLE" ? setRpcDown(true) : setError(e.message)));
    Promise.all([getObligations(vault), getInflows(vault)])
      .then(([o, i]) => {
        if (!live) return;
        setObligations(o);
        setInflows(i);
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [vault, reloadKey]);

  const twoWeeks = (now ?? 0) + 14 * 24 * 3600 * 1000;
  const upcoming = now === null
    ? []
    : (obligations ?? [])
        .filter((o) => o.status !== "CANCELLED" && o.status !== "PAID")
        .filter((o) => new Date(o.due_at).getTime() <= twoWeeks)
        .sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime());

  return (
    <div>
      <div className="px-4 sm:px-8 pt-6 sm:pt-8 pb-5 sm:pb-6 border-b border-border">
        <h1 className="font-macro text-2xl sm:text-3xl tracking-tight uppercase">Treasury</h1>
        <p className="text-xs text-ink-dim mt-2 max-w-2xl leading-relaxed">
          Liquid vs. reserve, bills due in the next 14 days, and expected inflows. Every figure below is a live
          read from the real vault contract or its database mirror.
        </p>
      </div>

      <div className="p-4 sm:p-8 space-y-8">
        {error && <ErrorState message={error} />}
        {rpcDown && <RpcUnavailableState onRetry={() => setReloadKey((k) => k + 1)} />}

        {state && (
          <>
            {state.paused && (
              <div className="border border-accent text-accent text-xs font-data px-4 py-2">[ PAUSED ] This vault's agent is currently paused by the owner.</div>
            )}
            {state.alerts.length > 0 && (
              <div className="border border-accent text-accent text-xs font-data px-4 py-2 space-y-1">
                {state.alerts.map((a) => (
                  <div key={a.id}>[ ALERT · {a.kind.toUpperCase()} ] {a.message}</div>
                ))}
              </div>
            )}

            <StatRow>
              <StatTile label="Liquid" value={state.liquid} unit="USDC" />
              <StatTile label="Reserve" value={state.reserve} unit="USDC" />
              <StatTile label="Floor" value={state.floor} unit="USDC" dim />
              <StatTile label="Score" value={state.score} />
              <StatTile label="Autonomous limit" value={state.autonomousLimit} unit="USDC" />
              <StatTile label="Daily cap" value={state.dailyCap} unit="USDC" dim />
              <StatTile label="Daily spent" value={state.dailySpent} unit="USDC" dim />
              <StatTile label="Owner ceiling" value={state.ownerCeiling} unit="USDC" dim />
            </StatRow>
          </>
        )}

        {(obligations || inflows) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <Panel title={`Upcoming bills (14 days) · ${upcoming.length}`}>
              {upcoming.length === 0 ? (
                <EmptyState>Nothing due in the next 14 days.</EmptyState>
              ) : (
                <table className="w-full text-xs font-data">
                  <tbody>
                    {upcoming.map((o) => (
                      <tr key={o.chain_id} className="border-t border-border first:border-t-0">
                        <td className="px-4 py-2.5 text-ink-dim">#{o.chain_id}</td>
                        <td className="px-4 py-2.5">{o.payee_name ?? <HashLink hash={o.payee} kind="address" />}</td>
                        <td className="px-4 py-2.5 text-right">{o.amount} USDC</td>
                        <td className="px-4 py-2.5 text-ink-dim">{new Date(o.due_at).toLocaleString()}</td>
                        <td className="px-4 py-2.5">
                          <StatusPill kind={o.status === "ESCALATED" ? "escalated" : "pending"}>{o.status}</StatusPill>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>

            <Panel title={`Expected inflows · ${(inflows ?? []).length}`}>
              {!inflows || inflows.length === 0 ? (
                <EmptyState>No expected inflows entered yet.</EmptyState>
              ) : (
                <table className="w-full text-xs font-data">
                  <tbody>
                    {inflows.map((i) => (
                      <tr key={i.id} className="border-t border-border first:border-t-0">
                        <td className="px-4 py-2.5">{i.from_name}</td>
                        <td className="px-4 py-2.5 text-right">{i.amount} USDC</td>
                        <td className="px-4 py-2.5 text-ink-dim">{new Date(i.expected_at).toLocaleDateString()}</td>
                        <td className="px-4 py-2.5 text-ink-dim">conf {Number(i.confidence).toFixed(2)}</td>
                        <td className="px-4 py-2.5">
                          {i.received_at ? <StatusPill kind="paid">RECEIVED</StatusPill> : <StatusPill kind="pending">EXPECTED</StatusPill>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
          </div>
        )}

        {state && (
          <div className="text-[10px] text-ink-dim font-data">
            Owner: <HashLink hash={state.owner} kind="address" /> &nbsp;·&nbsp; Agent: <HashLink hash={state.agent} kind="address" /> &nbsp;·&nbsp;
            Vault: <HashLink hash={vault} kind="address" />
          </div>
        )}
      </div>
    </div>
  );
}
