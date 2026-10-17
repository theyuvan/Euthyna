"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getBusinesses, getStats, type Business, type Stats } from "@/lib/api";
import { StatTile, StatRow, HashLink } from "@/components/primitives";
import { Orbit } from "@/components/orbit";

const REAL_HIT_TX = "0x218692358b25492f59c4958b3960f9688ded4239473263809e5024d0d909d5f1";
const REAL_HIT_VAULT = "0x4a08A58be01B5311D36EF4b042AA83BF738cF2b5";
const MISS_TX = "0xe474bc08c6dfaff1267eeecb7580b41035d86b8742a36aee1a0c93910365b3e2";

export default function LandingPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [businesses, setBusinesses] = useState<Business[] | null>(null);

  const [offline, setOffline] = useState(false);

  // The hosted backend can take ~a minute to wake after idling, so retry for a while before
  // saying it's unreachable, instead of showing "Loading" forever.
  useEffect(() => {
    let live = true;
    const load = async (attempt: number): Promise<void> => {
      try {
        const [s, b] = await Promise.all([getStats(), getBusinesses()]);
        if (!live) return;
        setStats(s);
        setBusinesses(b);
        setOffline(false);
      } catch {
        if (!live) return;
        if (attempt >= 2) setOffline(true);
        if (attempt < 12) setTimeout(() => load(attempt + 1), 5000);
      }
    };
    load(0);
    return () => {
      live = false;
    };
  }, []);

  const independent = businesses?.filter((b) => !b.builder).length ?? 0;

  return (
    <div className="min-h-full">
      {/* top bar */}
      <div className="border-b border-border px-4 sm:px-8 py-5 flex items-center justify-between max-w-[1280px] mx-auto">
        <div className="font-macro text-base tracking-tight">EUTHYNA</div>
        <nav className="flex items-center gap-4 sm:gap-6 text-xs font-data text-ink-dim">
          <Link href="/pitch" className="hover:text-ink">
            PITCH
          </Link>
          <Link href="/docs" className="hover:text-ink">
            DOCS
          </Link>
          <Link href="/console" className="border border-good text-good px-2.5 sm:px-3 py-1.5 hover:bg-good hover:text-bg whitespace-nowrap">
            <span className="hidden sm:inline">LAUNCH </span>CONSOLE
          </Link>
        </nav>
      </div>

      {/* hero */}
      <section className="max-w-[1280px] mx-auto px-4 sm:px-8 pt-10 sm:pt-16 pb-12 sm:pb-16 border-b border-border grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-10 items-center overflow-hidden">
        <div>
        <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-6">[ AI TREASURY · ARC TESTNET ]</div>
        <h1
          className="font-macro uppercase leading-[0.9] tracking-tight"
          style={{ fontSize: "clamp(2.5rem, 5vw, 4.75rem)" }}
        >
          An AI treasurer
          <br />
          on probation.
        </h1>
        <p className="text-sm text-ink-dim max-w-xl mt-8 leading-relaxed">
          Euthyna&apos;s spending limit lives in a smart contract, not a config file. Every time it commits to
          paying a bill on time, the outcome is settled on-chain — a hit raises its limit, a miss halves it. No
          self-reported metrics. No trust required, only verification.
        </p>
        <div className="flex flex-wrap items-center gap-3 sm:gap-4 mt-8 sm:mt-10">
          <Link href="/console" className="border border-good text-good px-5 py-3 text-xs font-data uppercase hover:bg-good hover:text-bg">
            Launch operator console
          </Link>
          <Link href="/console/trust" className="border border-border text-ink-dim px-5 py-3 text-xs font-data uppercase hover:border-ink hover:text-ink">
            View trust ledger
          </Link>
        </div>
        </div>
        <div className="px-6 sm:px-0">
          <Orbit />
        </div>
      </section>

      {/* stats */}
      <section className="max-w-[1280px] mx-auto px-4 sm:px-8 py-12 sm:py-16 border-b border-border">
        <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-6">[ LIVE, REAL NUMBERS — NO TEST VAULTS ]</div>
        {!stats ? (
          <LoadingLine offline={offline} />
        ) : (
          <StatRow>
            <StatTile label="Bills paid autonomously" value={stats.bills_paid_autonomously} />
            <StatTile label="USDC paid" value={Number(stats.usdc_paid).toFixed(2)} unit="USDC" />
            <StatTile label="Distinct payees" value={stats.distinct_payees_paid} />
            <StatTile label="Businesses live" value={stats.businesses} />
          </StatRow>
        )}
      </section>

      {/* businesses */}
      <section id="businesses" className="max-w-[1280px] mx-auto px-4 sm:px-8 py-12 sm:py-16 border-b border-border">
        <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-2">[ WHO IS BEHIND THE NUMBERS ]</div>
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <h2 className="font-macro uppercase text-2xl tracking-tight">Live businesses</h2>
          {businesses && (
            <div className="font-data text-xs text-ink-dim">
              {independent} independent · {businesses.length - independent} run by the builder
            </div>
          )}
        </div>
        {!businesses ? (
          <LoadingLine offline={offline} />
        ) : (
          <>
          {/* phones: one card per business */}
          <div className="sm:hidden hairline-grid grid grid-cols-1 border border-border">
            {businesses.map((b) => (
              <div key={b.owner} className="bg-bg p-4 text-xs font-data">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <span className="text-ink text-sm">{b.business ?? "Unnamed"}</span>
                  {b.builder && <span className="border border-border px-1.5 py-0.5 text-[10px] text-ink-dim uppercase">builder</span>}
                </div>
                <dl className="grid grid-cols-2 gap-y-2 gap-x-4">
                  <dt className="text-ink-dim">Owner</dt>
                  <dd className="text-right"><HashLink hash={b.owner} kind="address" /></dd>
                  <dt className="text-ink-dim">Bills paid by agent</dt>
                  <dd className="text-right">{b.bills_paid_autonomously}</dd>
                  <dt className="text-ink-dim">USDC</dt>
                  <dd className="text-right">{Number(b.usdc_paid).toFixed(2)}</dd>
                  <dt className="text-ink-dim">Commitments</dt>
                  <dd className="text-right">{b.commitments_opened}</dd>
                  <dt className="text-ink-dim">Hit / miss</dt>
                  <dd className="text-right"><span className="text-good">{b.hits}</span> / <span className={b.misses ? "text-accent" : ""}>{b.misses}</span></dd>
                </dl>
                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
                  {b.vaults.map((v) => (
                    <Link key={v} href={`/console?vault=${v}`} className="text-ink-dim hover:text-good underline decoration-border underline-offset-2">
                      vault {v.slice(0, 6)}…{v.slice(-4)}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="hidden sm:block border border-border overflow-x-auto">
            <table className="w-full text-xs font-data">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-ink-dim border-b border-border text-left">
                  <th className="px-4 py-3 font-normal">Business</th>
                  <th className="px-4 py-3 font-normal">Owner wallet</th>
                  <th className="px-4 py-3 font-normal">Vaults</th>
                  <th className="px-4 py-3 font-normal text-right">Bills paid by agent</th>
                  <th className="px-4 py-3 font-normal text-right">USDC</th>
                  <th className="px-4 py-3 font-normal text-right">Commitments</th>
                  <th className="px-4 py-3 font-normal text-right">Hit / miss</th>
                </tr>
              </thead>
              <tbody>
                {businesses.map((b) => (
                  <tr key={b.owner} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-3">
                      <span className="text-ink">{b.business ?? "Unnamed"}</span>
                      {b.builder && <span className="ml-2 border border-border px-1.5 py-0.5 text-[10px] text-ink-dim uppercase">builder</span>}
                    </td>
                    <td className="px-4 py-3"><HashLink hash={b.owner} kind="address" /></td>
                    <td className="px-4 py-3 space-x-2">
                      {b.vaults.map((v) => (
                        <Link key={v} href={`/console?vault=${v}`} className="text-ink-dim hover:text-good underline decoration-border underline-offset-2">
                          {v.slice(0, 6)}…{v.slice(-4)}
                        </Link>
                      ))}
                    </td>
                    <td className="px-4 py-3 text-right">{b.bills_paid_autonomously}</td>
                    <td className="px-4 py-3 text-right">{Number(b.usdc_paid).toFixed(2)}</td>
                    <td className="px-4 py-3 text-right">{b.commitments_opened}</td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-good">{b.hits}</span> / <span className={b.misses ? "text-accent" : ""}>{b.misses}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <Link href="/console/onboard" className="border border-good text-good px-5 py-3 text-xs font-data uppercase hover:bg-good hover:text-bg">
            Put your treasury on Euthyna
          </Link>
          <Link href="/docs#get-started" className="text-xs font-data text-ink-dim hover:text-ink underline decoration-border underline-offset-2">
            5-minute guide
          </Link>
          <span className="text-[10px] text-ink-dim font-data">Test vaults are excluded. Each business is one owner wallet.</span>
        </div>
      </section>

      {/* proof */}
      <section id="proof" className="max-w-[1280px] mx-auto px-4 sm:px-8 py-12 sm:py-16 border-b border-border">
        <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-2">[ THE MECHANISM, PROVEN ]</div>
        <h2 className="font-macro uppercase text-2xl tracking-tight mb-2">Both ways, on-chain</h2>
        <p className="text-xs text-ink-dim leading-relaxed mb-6 max-w-2xl">
          On one labeled test vault (short parameters, not an organic business outcome), the contract has graded a
          hit and a miss. The limit stepped up, then down.
        </p>
        <div className="hairline-grid grid grid-cols-1 md:grid-cols-2 border border-border max-w-4xl">
          <div className="bg-bg p-5 sm:p-6">
            <div className="text-[10px] uppercase tracking-widest text-good mb-3">[ HIT ]</div>
            <p className="text-xs text-ink-dim leading-relaxed mb-4">
              The agent committed 1 USDC to reserve against a bill, paid it on time, and the contract settled the
              commitment as a hit.
            </p>
            <div className="font-data text-xs space-y-1.5">
              <div>
                score: <span className="text-ink-dim">0</span> → <span className="text-good">0.008333</span>
              </div>
              <div>
                limit: <span className="text-ink-dim">25.00</span> → <span className="text-good">25.016666 USDC</span>
              </div>
              <div>
                settle tx: <HashLink hash={REAL_HIT_TX} kind="tx" />
              </div>
            </div>
          </div>
          <div className="bg-bg p-5 sm:p-6">
            <div className="text-[10px] uppercase tracking-widest text-accent mb-3">[ MISS · ENGINEERED ]</div>
            <p className="text-xs text-ink-dim leading-relaxed mb-4">
              Staged deliberately to prove the other half: the agent&apos;s wallet committed reserve over a bill that
              nobody then paid. The contract halved the score and froze sweeps for 24 hours.
            </p>
            <div className="font-data text-xs space-y-1.5">
              <div>
                score: <span className="text-ink-dim">0.008333</span> → <span className="text-accent">0.004166</span>
              </div>
              <div>
                limit: <span className="text-ink-dim">25.016666</span> → <span className="text-accent">25.008332 USDC</span>
              </div>
              <div>
                settle tx: <HashLink hash={MISS_TX} kind="tx" />
              </div>
            </div>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-data">
          <span className="text-ink-dim">
            vault: <HashLink hash={REAL_HIT_VAULT} kind="address" /> (TEST)
          </span>
          <Link href={`/console/trust?vault=${REAL_HIT_VAULT}`} className="text-good hover:underline">
            → see both on the trust ledger
          </Link>
        </div>
      </section>

      {/* how it works */}
      <section id="how" className="max-w-[1280px] mx-auto px-4 sm:px-8 py-12 sm:py-16">
        <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-6">[ HOW IT WORKS ]</div>
        <div className="hairline-grid grid grid-cols-1 md:grid-cols-3 border border-border">
          {[
            {
              n: "01",
              t: "Commit",
              d: "The agent reserves cash against a specific bill and a deadline, on-chain — a verifiable promise, not a plan.",
            },
            {
              n: "02",
              t: "Settle",
              d: "When the deadline passes, the contract checks the outcome itself. Paid on time: hit. Missed: halved score.",
            },
            {
              n: "03",
              t: "Earn",
              d: "A hit linearly raises the autonomous spending limit. The track record is the only thing that moves it.",
            },
          ].map((s) => (
            <div key={s.n} className="bg-bg p-6">
              <div className="font-data text-xs text-ink-dim mb-3">{s.n}</div>
              <div className="font-macro uppercase text-lg mb-2">{s.t}</div>
              <div className="text-xs text-ink-dim leading-relaxed">{s.d}</div>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-border px-4 sm:px-8 py-6 max-w-[1280px] mx-auto text-[10px] text-ink-dim font-data flex flex-col sm:flex-row gap-1 sm:items-center sm:justify-between">
        <span>Arc testnet · chain 5042002</span>
        <span>testnet.arcscan.app</span>
      </footer>
    </div>
  );
}

function LoadingLine({ offline }: { offline: boolean }) {
  return (
    <div className="text-xs text-ink-dim font-data">
      {offline ? "[ WAKING THE BACKEND ] The hosted API is starting up. Retrying every few seconds…" : "Loading from the live backend…"}
    </div>
  );
}
