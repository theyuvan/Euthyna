"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getBusinesses, getStats, type Business, type Stats } from "@/lib/api";
import { StatTile, StatRow, HashLink } from "@/components/primitives";
import { Orbit } from "@/components/orbit";

const REAL_HIT_TX = "0x218692358b25492f59c4958b3960f9688ded4239473263809e5024d0d909d5f1";
const REAL_HIT_VAULT = "0x4a08A58be01B5311D36EF4b042AA83BF738cF2b5";

export default function LandingPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [businesses, setBusinesses] = useState<Business[] | null>(null);

  useEffect(() => {
    getStats().then(setStats).catch(() => {});
    getBusinesses().then(setBusinesses).catch(() => {});
  }, []);

  const independent = businesses?.filter((b) => !b.builder).length ?? 0;

  return (
    <div className="min-h-full">
      {/* top bar */}
      <div className="border-b border-border px-8 py-5 flex items-center justify-between max-w-[1280px] mx-auto">
        <div className="font-macro text-base tracking-tight">EUTHYNA</div>
        <nav className="flex items-center gap-6 text-xs font-data text-ink-dim">
          <a href="#businesses" className="hover:text-ink">
            BUSINESSES
          </a>
          <Link href="/docs" className="hover:text-ink">
            DOCS
          </Link>
          <Link href="/console" className="border border-good text-good px-3 py-1.5 hover:bg-good hover:text-bg">
            LAUNCH CONSOLE
          </Link>
        </nav>
      </div>

      {/* hero */}
      <section className="max-w-[1280px] mx-auto px-8 pt-16 pb-16 border-b border-border grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-10 items-center">
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
        <div className="flex items-center gap-4 mt-10">
          <Link href="/console" className="border border-good text-good px-5 py-3 text-xs font-data uppercase hover:bg-good hover:text-bg">
            Launch operator console
          </Link>
          <Link href="/console/trust" className="border border-border text-ink-dim px-5 py-3 text-xs font-data uppercase hover:border-ink hover:text-ink">
            View trust ledger
          </Link>
        </div>
        </div>
        <Orbit />
      </section>

      {/* stats */}
      <section className="max-w-[1280px] mx-auto px-8 py-16 border-b border-border">
        <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-6">[ LIVE, REAL NUMBERS — NO TEST VAULTS ]</div>
        {!stats ? (
          <div className="text-xs text-ink-dim font-data">Loading from the live backend…</div>
        ) : (
          <StatRow>
            <StatTile label="Bills paid autonomously" value={stats.bills_paid_autonomously} />
            <StatTile label="USDC paid" value={stats.usdc_paid} unit="USDC" />
            <StatTile label="Distinct payees" value={stats.distinct_payees_paid} />
            <StatTile label="Businesses live" value={stats.businesses} />
          </StatRow>
        )}
      </section>

      {/* businesses */}
      <section id="businesses" className="max-w-[1280px] mx-auto px-8 py-16 border-b border-border">
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
          <div className="text-xs text-ink-dim font-data">Loading from the live backend…</div>
        ) : (
          <div className="border border-border overflow-x-auto">
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
      <section id="proof" className="max-w-[1280px] mx-auto px-8 py-16 border-b border-border">
        <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-2">[ THE MECHANISM, PROVEN ]</div>
        <h2 className="font-macro uppercase text-2xl tracking-tight mb-6">One real settled hit</h2>
        <div className="border border-border p-6 max-w-2xl">
          <p className="text-xs text-ink-dim leading-relaxed mb-4">
            On a labeled test vault (short parameters, used to demo the loop quickly — not an organic business
            outcome), the agent committed 1 USDC to reserve against a bill, paid it on time, and the contract
            settled the commitment as a hit.
          </p>
          <div className="font-data text-xs space-y-1.5">
            <div>
              score: <span className="text-ink-dim">0</span> → <span className="text-good">0.008333</span>
            </div>
            <div>
              limit: <span className="text-ink-dim">25.00 USDC</span> → <span className="text-good">25.016666 USDC</span>
            </div>
            <div>
              settle tx: <HashLink hash={REAL_HIT_TX} kind="tx" />
            </div>
            <div>
              vault: <HashLink hash={REAL_HIT_VAULT} kind="address" /> <span className="text-ink-dim">(TEST)</span>
            </div>
          </div>
          <Link href={`/console/trust?vault=${REAL_HIT_VAULT}`} className="inline-block mt-5 text-xs font-data text-good hover:underline">
            → see it on the trust ledger
          </Link>
        </div>
      </section>

      {/* how it works */}
      <section id="how" className="max-w-[1280px] mx-auto px-8 py-16">
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

      <footer className="border-t border-border px-8 py-6 max-w-[1280px] mx-auto text-[10px] text-ink-dim font-data flex items-center justify-between">
        <span>Arc testnet · chain 5042002</span>
        <span>testnet.arcscan.app</span>
      </footer>
    </div>
  );
}
