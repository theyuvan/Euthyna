"use client";

import { useEffect, useMemo, useState } from "react";
import { getCommitments, getTrust, getVaults, ApiError, type Commitment, type Trust } from "@/lib/api";
import { useVault } from "@/lib/useVault";
import { StatTile, StatRow, Panel, EmptyState, ErrorState, RpcUnavailableState, StatusPill, HashText } from "@/components/primitives";

const W = 900;
const H = 280;
const PAD = { top: 20, right: 20, bottom: 30, left: 56 };

export default function TrustPage() {
  const [vault] = useVault();
  const [trust, setTrust] = useState<Trust | null>(null);
  const [commitments, setCommitments] = useState<Commitment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rpcDown, setRpcDown] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [isTest, setIsTest] = useState(false);

  // Each effect ignores responses from a superseded vault: the vault switches from the default to
  // the URL/wallet one right after mount, and a slow stale response must not overwrite the new one.
  useEffect(() => {
    let live = true;
    getVaults()
      .then((vs) => live && setIsTest(Boolean(vs.find((v) => v.address.toLowerCase() === vault.toLowerCase())?.is_test)))
      .catch(() => live && setIsTest(false));
    return () => {
      live = false;
    };
  }, [vault]);

  useEffect(() => {
    let live = true;
    setTrust(null);
    setError(null);
    setRpcDown(false);
    setHover(null);
    // commitments is DB-backed; trust needs a live baseLimit() read — fetched independently so
    // an RPC outage doesn't also blank the commitments table.
    getTrust(vault)
      .then((t) => live && setTrust(t))
      .catch((e) => live && (e instanceof ApiError && e.code === "RPC_UNAVAILABLE" ? setRpcDown(true) : setError(e.message)));
    getCommitments(vault)
      .then((c) => live && setCommitments(c))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [vault, reloadKey]);

  const chart = useMemo(() => {
    if (!trust) return null;
    // The API's start.at is the vault's created_block (a block number), not a timestamp — the
    // backend has no block-time lookup for it. Every hit/miss point below has a real block_time from
    // the Settled event, so only the chart's leftmost anchor is approximate, nothing else.
    const points = trust.points.map((p) => ({ at: new Date(p.at).getTime(), limit: Number(p.limit), hit: p.hit, credit: p.credit, cid: p.cid, score: p.score }));
    const startAt = points.length ? points[0].at - 1000 * 60 * 60 : Date.now() - 1000 * 60 * 60;
    const allX = [startAt, ...points.map((p) => p.at)];
    const allY = [Number(trust.start.limit), ...points.map((p) => p.limit)];
    const minX = Math.min(...allX);
    const maxX = Math.max(...allX, minX + 1);
    // Fit the axis to the data: credits are tiny (a hit moved 25 → 25.0167), so fixed ±2% padding
    // drew every step as a flat line. Labels carry enough decimals to show the true magnitude.
    const lo = Math.min(...allY);
    const hi = Math.max(...allY);
    const span = hi - lo;
    const pad = span > 0 ? span * 0.6 : Math.max(lo * 0.001, 0.01);
    const minY = lo - pad;
    const maxY = hi + pad;
    const decimals = maxY - minY < 0.1 ? 4 : 2;
    const x = (t: number) => PAD.left + ((t - minX) / (maxX - minX || 1)) * (W - PAD.left - PAD.right);
    const y = (v: number) => H - PAD.bottom - ((v - minY) / (maxY - minY || 1)) * (H - PAD.top - PAD.bottom);

    // step path: horizontal from each point to the next point's x, then vertical jump
    let d = `M ${x(startAt)} ${y(Number(trust.start.limit))}`;
    let prevLimit = Number(trust.start.limit);
    for (const p of points) {
      d += ` L ${x(p.at)} ${y(prevLimit)} L ${x(p.at)} ${y(p.limit)}`;
      prevLimit = p.limit;
    }
    d += ` L ${x(maxX)} ${y(prevLimit)}`;

    return { startAt, points, x, y, d, minY, maxY, decimals };
  }, [trust]);

  return (
    <div>
      <div className="px-8 pt-8 pb-6 border-b border-border">
        <h1 className="font-macro text-3xl tracking-tight uppercase">Trust</h1>
        <p className="text-xs text-ink-dim mt-2 max-w-2xl leading-relaxed">
          The autonomous limit over time. It only moves at a settlement — a hit steps it up, a miss halves the
          score. Nothing else can raise this number.
        </p>
      </div>

      <div className="p-8 space-y-8">
        {error && <ErrorState message={error} />}
        {rpcDown && <RpcUnavailableState onRetry={() => setReloadKey((k) => k + 1)} />}
        {isTest && (
          <div className="border border-border text-ink-dim text-xs font-data px-4 py-3">
            <span className="text-ink">[ TEST VAULT ]</span> Short parameters, used to demo the loop quickly — not an
            organic business outcome, and excluded from the public numbers.
          </div>
        )}

        {trust && (
          <StatRow>
            <StatTile label="Starting limit" value={trust.start.limit} unit="USDC" dim />
            <StatTile
              label="Current limit"
              value={trust.points.length ? trust.points[trust.points.length - 1].limit : trust.start.limit}
              unit="USDC"
            />
            <StatTile label="Hits" value={String(trust.points.filter((p) => p.hit).length)} />
            <StatTile label="Misses" value={String(trust.points.filter((p) => !p.hit).length)} />
          </StatRow>
        )}

        <Panel title="Limit over time">
          {!chart ? (
            <EmptyState>Loading…</EmptyState>
          ) : chart.points.length === 0 ? (
            <EmptyState>No commitments have settled yet on this vault. The line will step the moment one does.</EmptyState>
          ) : (
            <div className="p-4">
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Autonomous limit over time">
                {/* gridlines */}
                {[0, 0.25, 0.5, 0.75, 1].map((f) => {
                  const v = chart.minY + f * (chart.maxY - chart.minY);
                  return (
                    <g key={f}>
                      <line x1={PAD.left} x2={W - PAD.right} y1={chart.y(v)} y2={chart.y(v)} stroke="var(--border)" strokeWidth={1} />
                      <text x={PAD.left - 8} y={chart.y(v)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="var(--ink-dim)" fontFamily="var(--font-data)">
                        {v.toFixed(chart.decimals)}
                      </text>
                    </g>
                  );
                })}
                {/* step line */}
                <path d={chart.d} fill="none" stroke="var(--ink)" strokeWidth={2} />
                {/* start marker */}
                <circle cx={chart.x(chart.startAt)} cy={chart.y(Number(trust!.start.limit))} r={4} fill="var(--ink-dim)" />
                {/* hit/miss markers */}
                {chart.points.map((p, i) => (
                  <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ cursor: "pointer" }}>
                    <circle cx={chart.x(p.at)} cy={chart.y(p.limit)} r={hover === i ? 7 : 5} fill={p.hit ? "var(--good)" : "var(--accent)"} stroke="var(--bg)" strokeWidth={2} />
                  </g>
                ))}
              </svg>
              {hover !== null && chart.points[hover] && (
                <div className="mt-2 border border-border bg-surface px-3 py-2 text-xs font-data inline-block">
                  <StatusPill kind={chart.points[hover].hit ? "hit" : "miss"}>{chart.points[hover].hit ? "HIT" : "MISS"}</StatusPill>{" "}
                  commitment #{chart.points[hover].cid} · credit {chart.points[hover].credit} · score→{chart.points[hover].score} · limit→{chart.points[hover].limit} USDC
                  <br />
                  <span className="text-ink-dim">{new Date(chart.points[hover].at).toLocaleString()}</span>
                </div>
              )}
            </div>
          )}
        </Panel>

        <Panel title={`Commitments · ${(commitments ?? []).length}`}>
          {!commitments || commitments.length === 0 ? (
            <EmptyState>No commitments opened yet.</EmptyState>
          ) : (
            <table className="w-full text-xs font-data">
              <thead>
                <tr className="text-ink-dim text-left">
                  <th className="px-4 py-2 font-normal">ID</th>
                  <th className="px-4 py-2 font-normal">Amount</th>
                  <th className="px-4 py-2 font-normal">Opened</th>
                  <th className="px-4 py-2 font-normal">T</th>
                  <th className="px-4 py-2 font-normal">Capital·days</th>
                  <th className="px-4 py-2 font-normal">Status</th>
                  <th className="px-4 py-2 font-normal">Credit</th>
                  <th className="px-4 py-2 font-normal">decisionHash</th>
                </tr>
              </thead>
              <tbody>
                {commitments.map((c) => (
                  <tr key={c.chain_id} className="border-t border-border">
                    <td className="px-4 py-2.5">#{c.chain_id}</td>
                    <td className="px-4 py-2.5">{c.amount} USDC</td>
                    <td className="px-4 py-2.5 text-ink-dim">{new Date(c.opened_at).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-ink-dim">{new Date(c.t).toLocaleString()}</td>
                    <td className="px-4 py-2.5">{c.capital_usdc_days}</td>
                    <td className="px-4 py-2.5">
                      {!c.settled ? <StatusPill kind="pending">OPEN</StatusPill> : c.hit ? <StatusPill kind="hit">HIT</StatusPill> : <StatusPill kind="miss">MISS</StatusPill>}
                    </td>
                    <td className="px-4 py-2.5">{c.credit ?? "—"}</td>
                    <td className="px-4 py-2.5">{c.decision_hash ? <HashText hash={c.decision_hash} /> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  );
}
