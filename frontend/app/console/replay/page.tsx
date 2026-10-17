"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { keccak256 } from "js-sha3";
import { getDecisionReplay, type DecisionReplay } from "@/lib/api";
import { Panel, EmptyState, ErrorState, HashText } from "@/components/primitives";

/** Independent of the server's own claim: hashes the stored canonical_json right here, in this
 *  browser, the same way backend/src/canonical.ts does (keccak256 of the UTF-8 bytes) — so a viewer
 *  doesn't have to trust our backend's arithmetic, only the public record and their own browser. */
function recomputeInBrowser(canonicalJson: string): `0x${string}` {
  return `0x${keccak256(canonicalJson)}`;
}

function ReplayInner() {
  const params = useSearchParams();
  const id = params.get("id");
  const [data, setData] = useState<DecisionReplay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [idInput, setIdInput] = useState(id ?? "");

  useEffect(() => {
    if (!id) return;
    setData(null);
    setError(null);
    getDecisionReplay(id).then(setData).catch((e) => setError(e.message));
  }, [id]);

  return (
    <div>
      <div className="px-4 sm:px-8 pt-6 sm:pt-8 pb-5 sm:pb-6 border-b border-border">
        <h1 className="font-macro text-2xl sm:text-3xl tracking-tight uppercase">Replay</h1>
        <p className="text-xs text-ink-dim mt-2 max-w-2xl leading-relaxed">
          The stored decision record, re-hashed in this browser and compared against what&apos;s on-chain. A green
          match means the record hasn&apos;t been edited since the agent wrote it — a red mismatch means it has.
        </p>
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            window.location.href = `/replay?id=${idInput.trim()}`;
          }}
        >
          <input
            value={idInput}
            onChange={(e) => setIdInput(e.target.value)}
            placeholder="decision id (uuid)"
            className="bg-surface border border-border text-xs font-data px-3 py-2 text-ink outline-none focus:border-good flex-1 max-w-md"
          />
          <button type="submit" className="border border-border px-4 py-2 text-xs font-data uppercase hover:border-good hover:text-good">
            Load
          </button>
        </form>
      </div>

      <div className="p-4 sm:p-8 space-y-8">
        {error && <ErrorState message={error} />}
        {!id && !error && <EmptyState>Pick a decision from the Decisions page, or paste an id above.</EmptyState>}

        {data && (() => {
          const browserHash = recomputeInBrowser(data.decision.canonical_json);
          const browserMatches = browserHash.toLowerCase() === data.verify.storedHash.toLowerCase();
          const allOk = browserMatches && data.verify.hashMatches && data.verify.columnsMatch && data.verify.onchainMatches;
          return (
          <>
            <Panel title="Verification">
              <div className="p-5 space-y-3">
                <VerifyRow label="Stored hash (decisionHash on-chain)" ok>
                  <HashText hash={data.verify.storedHash} />
                </VerifyRow>
                <VerifyRow label="Recomputed right here, in this browser, from the stored canonical_json" ok={browserMatches}>
                  <HashText hash={browserHash} />
                </VerifyRow>
                <VerifyRow label="Server's own recomputation agrees" ok={data.verify.hashMatches} />
                <VerifyRow label="Columns match the hashed bytes" ok={data.verify.columnsMatch} />
                <VerifyRow label="Matches the decisionHash emitted on-chain" ok={data.verify.onchainMatches} />
                <div className="pt-2">
                  {allOk ? (
                    <div className="inline-block border border-good text-good px-4 py-2 text-sm font-data">[ ✓ VERIFIED — record unedited ]</div>
                  ) : (
                    <div className="inline-block border border-accent text-accent px-4 py-2 text-sm font-data">[ ✗ MISMATCH — record does not match the hash ]</div>
                  )}
                </div>
              </div>
            </Panel>

            {data.onchain.length > 0 && (
              <Panel title="On-chain events carrying this decisionHash">
                <div className="divide-y divide-border">
                  {data.onchain.map((e, i) => (
                    <div key={i} className="px-4 py-2.5 text-xs font-data flex items-center justify-between">
                      <span className="uppercase">{e.name}</span>
                      <a href={e.explorer} target="_blank" rel="noreferrer" className="text-ink-dim hover:text-good underline underline-offset-2">
                        view on arcscan
                      </a>
                    </div>
                  ))}
                </div>
              </Panel>
            )}

            <Panel title="Full stored record (snapshot + policy + LLM output)">
              <pre className="p-4 text-[11px] font-data text-ink-dim overflow-x-auto whitespace-pre-wrap break-all max-h-[480px] overflow-y-auto">
                {JSON.stringify(data.decision, null, 2)}
              </pre>
            </Panel>
          </>
          );
        })()}
      </div>
    </div>
  );
}

function VerifyRow({ label, ok, children }: { label: string; ok: boolean; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-xs font-data border-b border-border pb-2">
      <span className="text-ink-dim">{label}</span>
      <span className="flex items-center gap-2">
        {children}
        <span className={ok ? "text-good" : "text-accent"}>{ok ? "✓" : "✗"}</span>
      </span>
    </div>
  );
}

export default function ReplayPage() {
  return (
    <Suspense fallback={<EmptyState>Loading…</EmptyState>}>
      <ReplayInner />
    </Suspense>
  );
}
