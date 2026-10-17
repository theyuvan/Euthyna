"use client";

import { useEffect } from "react";
import { explorerAddress, explorerTx, short } from "@/lib/api";

export function PageHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <header className="px-8 pt-8 pb-6 border-b border-border">
      <h1 className="font-macro text-3xl tracking-tight uppercase">{title}</h1>
      {sub && <p className="text-xs text-ink-dim mt-2 max-w-2xl leading-relaxed">{sub}</p>}
    </header>
  );
}

export function StatTile({ label, value, unit, dim }: { label: string; value: string; unit?: string; dim?: boolean }) {
  return (
    <div className="bg-surface p-5">
      <div className="text-[10px] uppercase tracking-wide text-ink-dim mb-2">{label}</div>
      <div className={`font-data text-2xl ${dim ? "text-ink-dim" : "text-ink"}`}>
        {value}
        {unit && <span className="text-xs text-ink-dim ml-1">{unit}</span>}
      </div>
    </div>
  );
}

export function StatRow({ children }: { children: React.ReactNode }) {
  return <div className="hairline-grid grid grid-cols-2 md:grid-cols-4 border border-border">{children}</div>;
}

type PillKind = "hit" | "miss" | "pending" | "paid" | "cancelled" | "escalated";
const PILL_STYLE: Record<PillKind, string> = {
  hit: "text-good border-good",
  paid: "text-good border-good",
  miss: "text-accent border-accent",
  escalated: "text-accent border-accent",
  pending: "text-ink-dim border-border",
  cancelled: "text-ink-dim border-border",
};
export function StatusPill({ kind, children }: { kind: PillKind; children: React.ReactNode }) {
  return (
    <span className={`inline-block border px-2 py-0.5 text-[10px] uppercase tracking-wide font-data ${PILL_STYLE[kind]}`}>
      [ {children} ]
    </span>
  );
}

/** A hash that isn't a transaction or an address (decisionHash, a ref) — shown, not linked, since
 *  there's nowhere on Arcscan it resolves to. Click-to-copy, full value in the title attribute. */
export function HashText({ hash }: { hash: string }) {
  return (
    <span
      className="font-data text-xs text-ink-dim cursor-pointer hover:text-ink"
      title={`${hash} (click to copy)`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard?.writeText(hash).catch(() => {});
      }}
    >
      {short(hash)}
    </span>
  );
}

export function HashLink({ hash, kind = "tx" }: { hash: string; kind?: "tx" | "address" }) {
  const href = kind === "tx" ? explorerTx(hash) : explorerAddress(hash);
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-data text-xs text-ink-dim hover:text-good underline decoration-border underline-offset-2"
      title={hash}
    >
      {short(hash)}
    </a>
  );
}

export function Panel({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="border border-border">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-surface">
        <span className="text-[10px] uppercase tracking-wide text-ink-dim">{title}</span>
        {right}
      </div>
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="px-6 py-10 text-xs text-ink-dim text-center">{children}</div>;
}

export function WalletButton({
  address,
  connecting,
  error,
  onConnect,
}: {
  address: string | null;
  connecting: boolean;
  error: string | null;
  onConnect: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-[10px] text-accent font-data">{error}</span>}
      <button
        onClick={onConnect}
        disabled={connecting}
        className={`border px-3 py-2 text-xs font-data uppercase ${
          address ? "border-good text-good" : "border-border text-ink-dim hover:border-good hover:text-good"
        }`}
      >
        {address ? short(address) : connecting ? "connecting…" : "connect wallet"}
      </button>
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="px-6 py-4 border border-accent text-accent text-xs font-data">
      [ ERROR ] {message}
    </div>
  );
}

/** The one error worth a dedicated, friendlier state: Arc testnet's public RPC going
 *  unreachable (external outage, not a bug here — it has recurred repeatedly). Auto-retries
 *  on an interval instead of making the operator manually refresh. */
export function RpcUnavailableState({ onRetry }: { onRetry: () => void }) {
  useEffect(() => {
    const id = setInterval(onRetry, 10_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="px-6 py-4 border border-border text-ink-dim text-xs font-data space-y-1">
      <div className="text-ink">[ RPC UNAVAILABLE ] Arc testnet&apos;s public RPC is temporarily unreachable.</div>
      <div>This is an outage on Arc&apos;s side, not a bug here — retrying automatically every 10s…</div>
    </div>
  );
}
