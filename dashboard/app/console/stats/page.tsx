"use client";

import { useEffect, useState } from "react";
import { getStats, type Stats } from "@/lib/api";
import { StatTile, StatRow, EmptyState, ErrorState } from "@/components/primitives";

export default function StatsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getStats().then(setStats).catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <div className="px-8 pt-8 pb-6 border-b border-border">
        <h1 className="font-macro text-3xl tracking-tight uppercase">Public Stats</h1>
        <p className="text-xs text-ink-dim mt-2 max-w-2xl leading-relaxed">
          Totals across every real, non-test vault. No login needed — this is the same honesty bar the whole
          product is built on: these numbers are exactly what&apos;s on Arcscan, nothing padded.
        </p>
      </div>

      <div className="p-8 space-y-8">
        {error && <ErrorState message={error} />}
        {!stats ? (
          <EmptyState>Loading…</EmptyState>
        ) : (
          <>
            <StatRow>
              <StatTile label="Businesses" value={stats.businesses} />
              <StatTile label="Vaults live" value={stats.vaults} />
              <StatTile label="Bills paid autonomously" value={stats.bills_paid_autonomously} />
              <StatTile label="USDC paid" value={stats.usdc_paid} unit="USDC" />
              <StatTile label="Distinct payees paid" value={stats.distinct_payees_paid} />
              <StatTile label="Commitments opened" value={stats.commitments_opened} />
              <StatTile label="Commitments settled" value={stats.commitments_settled} />
              <StatTile label="Capital put to work" value={stats.capital_usdc_days} unit="USDC·days" />
            </StatRow>
            <StatRow>
              <StatTile label="Hits" value={stats.hits} />
              <StatTile label="Misses" value={stats.misses} />
              <StatTile label="Escalations" value={stats.escalations} dim />
              <StatTile label="Approvals" value={stats.approvals} dim />
              <StatTile label="Blocked by contract" value={stats.blocked_by_contract} dim />
              <StatTile label="Blocked/clamped by policy" value={stats.blocked_or_clamped_by_policy} dim />
            </StatRow>
            <p className="text-[10px] text-ink-dim font-data max-w-xl">
              &quot;Capital put to work&quot; is USDC × days actually held in reserve — the real input to the credit
              formula, not a vanity metric. Test vaults (used to validate the mechanism quickly) are excluded from
              every number above; see the repo&apos;s README for exactly which vaults those are and why.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
