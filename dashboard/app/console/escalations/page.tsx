"use client";

import { useEffect, useRef, useState } from "react";
import { getObligations, prepareApproveEscalation, prepareCancelObligation, type Obligation } from "@/lib/api";
import { sendPreparedTx } from "@/lib/wallet";
import { useVault } from "@/lib/useVault";
import { useWallet } from "@/lib/WalletContext";
import { Panel, EmptyState, ErrorState, HashLink, WalletButton } from "@/components/primitives";

export default function EscalationsPage() {
  const [vault] = useVault();
  const wallet = useWallet();
  const [obligations, setObligations] = useState<Obligation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [lastTx, setLastTx] = useState<string | null>(null);

  // only the latest request may update state — a stale response for a superseded vault is dropped
  const latest = useRef(0);
  const load = () => {
    const req = ++latest.current;
    setObligations(null);
    setError(null);
    getObligations(vault)
      .then((o) => req === latest.current && setObligations(o))
      .catch((e) => req === latest.current && setError(e.message));
  };
  useEffect(load, [vault]);

  const escalated = (obligations ?? []).filter((o) => o.status === "ESCALATED");

  async function approve(id: number) {
    if (!wallet.address) return setError("Connect the owner's wallet first.");
    setBusy(id);
    setError(null);
    try {
      const { to, data } = await prepareApproveEscalation(vault, id, wallet.address);
      const hash = await sendPreparedTx(to, data, wallet.address);
      setLastTx(hash);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function cancel(id: number) {
    if (!wallet.address) return setError("Connect the owner's wallet first.");
    setBusy(id);
    setError(null);
    try {
      const { to, data } = await prepareCancelObligation(vault, id, wallet.address);
      const hash = await sendPreparedTx(to, data, wallet.address);
      setLastTx(hash);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between px-8 pt-8 pb-6 border-b border-border">
        <div>
          <h1 className="font-macro text-3xl tracking-tight uppercase">Escalations</h1>
          <p className="text-xs text-ink-dim mt-2 max-w-2xl leading-relaxed">
            Bills the agent couldn&apos;t pay on its own — above the autonomous limit, or the daily cap. Only the
            owner can approve or cancel one; this signs with your own wallet, the backend never holds your key.
          </p>
        </div>
        <WalletButton address={wallet.address} connecting={wallet.connecting} error={wallet.error} onConnect={wallet.connect} />
      </div>

      <div className="p-8 space-y-4">
        {error && <ErrorState message={error} />}
        {lastTx && (
          <div className="border border-good text-good text-xs font-data px-4 py-2">
            [ SENT ] <HashLink hash={lastTx} kind="tx" />
          </div>
        )}

        <Panel title={`Pending escalations · ${escalated.length}`}>
          {!obligations ? (
            <EmptyState>Loading…</EmptyState>
          ) : escalated.length === 0 ? (
            <EmptyState>Nothing waiting on owner approval right now.</EmptyState>
          ) : (
            <div className="divide-y divide-border">
              {escalated.map((o) => (
                <div key={o.chain_id} className="px-4 py-4 flex items-center justify-between gap-4">
                  <div className="text-xs font-data space-y-1">
                    <div>
                      #{o.chain_id} · {o.payee_name ?? o.payee} · <span className="text-ink">{o.amount} USDC</span>
                    </div>
                    <div className="text-ink-dim">due {new Date(o.due_at).toLocaleString()}</div>
                    {o.failed_for_liquidity && <div className="text-accent">previously failed for insufficient liquidity</div>}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => approve(o.chain_id)}
                      disabled={busy === o.chain_id}
                      className="border border-good text-good px-3 py-2 text-[10px] font-data uppercase hover:bg-good hover:text-bg disabled:opacity-50"
                    >
                      {busy === o.chain_id ? "…" : "Approve"}
                    </button>
                    <button
                      onClick={() => cancel(o.chain_id)}
                      disabled={busy === o.chain_id}
                      className="border border-accent text-accent px-3 py-2 text-[10px] font-data uppercase hover:bg-accent hover:text-bg disabled:opacity-50"
                    >
                      {busy === o.chain_id ? "…" : "Cancel"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
