"use client";

import { useEffect, useMemo, useState } from "react";
import { encodeFunctionData, formatUnits, getAddress, parseEventLogs } from "viem";
import { getCommitments, getTrust, getVaults, nudgeIndexer, ApiError, type Commitment, type Trust } from "@/lib/api";
import { useVault } from "@/lib/useVault";
import { useWallet } from "@/lib/WalletContext";
import { publicClient } from "@/lib/chain";
import { sendPreparedTx } from "@/lib/wallet";
import { vaultAbi } from "@/lib/vault-abi";
import { StatTile, StatRow, Panel, EmptyState, ErrorState, RpcUnavailableState, StatusPill, HashText, HashLink } from "@/components/primitives";

type SettleResult = { cid: number; tx: string; hit: boolean; credit: string; score: string; limit: string };

/** seconds -> "1h 02m 05s" / "2m 05s" / "5s" */
function countdown(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}h ${p(m)}m ${p(s)}s` : m ? `${m}m ${p(s)}s` : `${s}s`;
}

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
  const wallet = useWallet();
  const [grace, setGrace] = useState<number | null>(null);
  const [now, setNow] = useState(0); // set after mount: Date.now() can't run during prerender
  const [settling, setSettling] = useState<number | null>(null);
  const [settleError, setSettleError] = useState<string | null>(null);
  const [settled, setSettled] = useState<SettleResult | null>(null);

  // settle() opens at T + grace; read grace from the vault and tick a clock for the countdown.
  useEffect(() => {
    let live = true;
    setGrace(null);
    publicClient
      .readContract({ address: getAddress(vault), abi: vaultAbi, functionName: "grace" })
      .then((g) => live && setGrace(Number(g)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [vault]);

  const hasOpen = Boolean(commitments?.some((c) => !c.settled));
  useEffect(() => {
    if (!hasOpen) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasOpen]);

  // Once an open commitment is settleable, poll quietly: if anyone else (e.g. the backend settler)
  // grades it first, the page flips to the result on its own instead of waiting for a reload.
  const matured = Boolean(
    grace !== null && now > 0 && commitments?.some((c) => !c.settled && new Date(c.t).getTime() + grace * 1000 <= now),
  );
  useEffect(() => {
    if (!matured) return;
    const id = setInterval(() => {
      getCommitments(vault)
        .then((cs) => {
          if (cs.some((c) => c.settled && commitments?.find((o) => o.chain_id === c.chain_id && !o.settled))) {
            setReloadKey((k) => k + 1);
          }
        })
        .catch(() => {});
    }, 10_000);
    return () => clearInterval(id);
  }, [matured, vault, commitments]);

  async function settle(cid: number) {
    setSettleError(null);
    const from = wallet.address;
    if (!from) {
      await wallet.connect();
      return; // the button stays; click again once connected
    }
    setSettling(cid);
    try {
      // Simulate first so a revert comes back as the contract's named error, not a wallet gas failure.
      await publicClient.simulateContract({ address: getAddress(vault), abi: vaultAbi, functionName: "settle", args: [cid], account: getAddress(from) });
      const data = encodeFunctionData({ abi: vaultAbi, functionName: "settle", args: [cid] });
      const tx = await sendPreparedTx(vault, data, from);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx as `0x${string}` });
      if (receipt.status !== "success") throw new Error("settle transaction reverted");
      const [ev] = parseEventLogs({ abi: vaultAbi, logs: receipt.logs, eventName: "Settled" });
      if (ev) {
        setSettled({
          cid,
          tx,
          hit: ev.args.hit,
          credit: formatUnits(ev.args.credit, 6),
          score: formatUnits(ev.args.newScore, 6),
          limit: formatUnits(ev.args.newLimit, 6),
        });
      }
      // Ask the backend to index it now, then refresh the chart and table once it has.
      await nudgeIndexer();
      setTimeout(() => setReloadKey((k) => k + 1), 4000);
      setTimeout(() => setReloadKey((k) => k + 1), 15000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSettleError(
        /AlreadySettled/.test(msg)
          ? "Already settled: someone graded it first. Refreshing…"
          : /NotMatured/.test(msg)
            ? "Not matured yet: settle() opens at T + grace."
            : msg.split("\n")[0],
      );
      setReloadKey((k) => k + 1);
    } finally {
      setSettling(null);
    }
  }

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

  // Status, countdown or Settle button for one commitment: shared by the table and the phone cards.
  const statusCell = (c: Commitment) => (
    !c.settled ? (
      <div className="flex items-center gap-2">
        <StatusPill kind="pending">OPEN</StatusPill>
        {grace !== null && now > 0 &&
          (() => {
            const left = Math.ceil((new Date(c.t).getTime() + grace * 1000 - now) / 1000);
            return left > 0 ? (
              <span className="text-ink-dim" title="settle() opens at T + grace">settle in {countdown(left)}</span>
            ) : (
              <button
                onClick={() => settle(c.chain_id)}
                disabled={settling !== null}
                title="Anyone can call settle(): the contract grades the commitment from its own records"
                className="border border-good text-good px-2 py-0.5 uppercase hover:bg-good hover:text-bg disabled:opacity-50"
              >
                {settling === c.chain_id ? "settling…" : wallet.address ? "settle" : "connect to settle"}
              </button>
            );
          })()}
      </div>
    ) : c.hit ? (
      <StatusPill kind="hit">HIT</StatusPill>
    ) : (
      <StatusPill kind="miss">MISS</StatusPill>
    )
  );

  return (
    <div>
      <div className="px-4 sm:px-8 pt-6 sm:pt-8 pb-5 sm:pb-6 border-b border-border">
        <h1 className="font-macro text-2xl sm:text-3xl tracking-tight uppercase">Trust</h1>
        <p className="text-xs text-ink-dim mt-2 max-w-2xl leading-relaxed">
          The autonomous limit over time. It only moves at a settlement — a hit steps it up, a miss halves the
          score. Nothing else can raise this number.
        </p>
      </div>

      <div className="p-4 sm:p-8 space-y-8">
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

        {settled && (
          <div className={`border ${settled.hit ? "border-good text-good" : "border-accent text-accent"} text-xs font-data px-4 py-3`}>
            [ {settled.hit ? "HIT" : "MISS"} ] Commitment #{settled.cid} graded by the contract. credit {settled.credit} · score → {settled.score} ·
            limit → {settled.limit} USDC · tx <HashLink hash={settled.tx} kind="tx" />
          </div>
        )}
        {settleError && <div className="border border-accent text-accent text-xs font-data px-4 py-2">[ SETTLE ] {settleError}</div>}

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
            <>
            <div className="sm:hidden divide-y divide-border">
              {commitments.map((c) => (
                <div key={c.chain_id} className="p-4 text-xs font-data space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-ink">#{c.chain_id} · {c.amount} USDC</span>
                    <span className="text-ink-dim">credit {c.credit ?? "—"}</span>
                  </div>
                  <div>{statusCell(c)}</div>
                  <dl className="grid grid-cols-[7rem_1fr] gap-y-1.5 text-ink-dim">
                    <dt>Opened</dt>
                    <dd>{new Date(c.opened_at).toLocaleString()}</dd>
                    <dt>T</dt>
                    <dd>{new Date(c.t).toLocaleString()}</dd>
                    <dt>Capital·days</dt>
                    <dd>{c.capital_usdc_days}</dd>
                    <dt>Decision</dt>
                    <dd>{c.decision_hash ? <HashText hash={c.decision_hash} /> : "—"}</dd>
                  </dl>
                </div>
              ))}
            </div>
            <table className="hidden sm:table w-full text-xs font-data">
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
                      {statusCell(c)}
                    </td>
                    <td className="px-4 py-2.5">{c.credit ?? "—"}</td>
                    <td className="px-4 py-2.5">{c.decision_hash ? <HashText hash={c.decision_hash} /> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}
