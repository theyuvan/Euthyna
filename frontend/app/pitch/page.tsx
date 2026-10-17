"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getBusinesses, getStats, type Business, type Stats } from "@/lib/api";
import { EuthynaMark } from "@/components/mark";

const REPO = "https://github.com/theyuvan/Euthyna";

const SLIDES = ["Euthyna", "Live numbers", "The problem", "What we built", "How it works", "Why it's different", "Try it"];

export default function PitchPage() {
  const [i, setI] = useState(0);
  const last = SLIDES.length - 1;

  const go = useCallback((n: number) => {
    const next = Math.max(0, Math.min(last, n));
    setI(next);
    window.history.replaceState(null, "", `#${next + 1}`);
  }, [last]);

  // Deep links: /pitch#3 opens slide 3.
  useEffect(() => {
    const n = Number(window.location.hash.slice(1));
    if (n >= 1 && n <= SLIDES.length) setI(n - 1);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault();
        go(i + 1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        go(i - 1);
      } else if (e.key === "Home") go(0);
      else if (e.key === "End") go(last);
      else if (e.key === "f" || e.key === "F") {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else document.documentElement.requestFullscreen().catch(() => {});
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [i, go, last]);

  return (
    <div className="min-h-screen flex flex-col">
      {/* top bar, matching the landing page */}
      <div className="border-b border-border shrink-0">
        <div className="px-8 py-5 flex items-center justify-between max-w-[1280px] mx-auto">
          <Link href="/" className="font-macro text-base tracking-tight">
            EUTHYNA
          </Link>
          <nav className="flex items-center gap-6 text-xs font-data text-ink-dim">
            <span className="text-ink">PITCH</span>
            <Link href="/docs" className="hover:text-ink">
              DOCS
            </Link>
            <Link href="/console" className="border border-good text-good px-3 py-1.5 hover:bg-good hover:text-bg">
              LAUNCH CONSOLE
            </Link>
          </nav>
        </div>
      </div>

      <div className="flex-1 flex items-center">
        <div key={i} className="slide-in w-full max-w-[1180px] mx-auto px-8 py-8">
          {i === 0 && <TitleSlide />}
          {i === 1 && <NumbersSlide />}
          {i === 2 && <ProblemSlide />}
          {i === 3 && <SolutionSlide />}
          {i === 4 && <WorkflowSlide />}
          {i === 5 && <DifferentSlide />}
          {i === 6 && <TrySlide />}
        </div>
      </div>

      {/* controls */}
      <div className="shrink-0 border-t border-border">
        <div className="max-w-[1180px] mx-auto px-8 py-4 flex items-center gap-4">
          <button
            onClick={() => go(i - 1)}
            disabled={i === 0}
            aria-label="Previous slide"
            className="border border-border px-4 py-2 text-xs font-data hover:border-ink disabled:opacity-30"
          >
            ←
          </button>
          <div className="flex items-center gap-1.5">
            {SLIDES.map((s, n) => (
              <button
                key={s}
                onClick={() => go(n)}
                aria-label={`Slide ${n + 1}: ${s}`}
                className={`h-2 transition-all ${n === i ? "w-8 bg-good" : "w-2 bg-border hover:bg-ink-dim"}`}
              />
            ))}
          </div>
          <button
            onClick={() => go(i + 1)}
            disabled={i === last}
            aria-label="Next slide"
            className="border border-border px-4 py-2 text-xs font-data hover:border-ink disabled:opacity-30"
          >
            →
          </button>
          <span className="ml-auto text-[10px] font-data text-ink-dim uppercase tracking-widest">
            ← → to move · F for fullscreen
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ slides */

function Kicker({ n, label }: { n: number; label: string }) {
  return (
    <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-5 font-data">
      [ {String(n).padStart(2, "0")} / {String(SLIDES.length).padStart(2, "0")} · {label} ]
    </div>
  );
}

function Headline({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-macro uppercase leading-[0.92] tracking-tight mb-8" style={{ fontSize: "clamp(2rem, 4.2vw, 3.4rem)" }}>
      {children}
    </h2>
  );
}

function TitleSlide() {
  return (
    <div className="text-center">
      <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-8 font-data">[ Tameion hackathon · Canteen × Circle · on Arc ]</div>
      <div className="flex items-center justify-center gap-6 md:gap-8">
        <EuthynaMark className="w-16 h-16 md:w-28 md:h-28 shrink-0" />
        <h1 className="font-macro uppercase leading-none tracking-tight" style={{ fontSize: "clamp(3rem, 11vw, 9.5rem)" }}>
          Euthyna
        </h1>
      </div>
      <p className="font-macro uppercase text-xl md:text-3xl tracking-tight mt-8">An AI treasurer on probation.</p>
      <p className="text-sm text-ink-dim max-w-2xl mx-auto mt-5 leading-relaxed">
        It pays a business&apos;s bills in USDC. Its spending limit lives in a smart contract and moves only with its own
        on-chain track record. Trust is earned, never configured.
      </p>
      <div className="hairline-grid grid grid-cols-1 md:grid-cols-3 border border-border mt-12 max-w-4xl mx-auto text-left">
        {[
          ["/logos/arc.svg", "Arc", "USDC settles in under a second, fees paid in USDC"],
          ["/logos/circle.svg", "Circle", "the agent acts through its own smart-contract wallet"],
          ["/logos/usdc.svg", "USDC", "bills, reserve and gas, all in one stablecoin"],
        ].map(([logo, t, d]) => (
          <div key={t} className="bg-bg px-5 py-4 flex items-start gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logo} alt="" className="w-5 h-5 mt-0.5 shrink-0" />
            <div className="text-xs leading-relaxed">
              <span className="text-ink font-semibold">{t}</span> <span className="text-ink-dim">{d}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NumbersSlide() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [biz, setBiz] = useState<Business[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const load = (attempt: number) =>
      Promise.all([getStats(), getBusinesses()])
        .then(([s, b]) => {
          if (!live) return;
          setStats(s);
          setBiz(b);
        })
        .catch(() => {
          if (!live) return;
          if (attempt >= 2) setFailed(true);
          if (attempt < 12) setTimeout(() => load(attempt + 1), 5000);
        });
    load(0);
    return () => {
      live = false;
    };
  }, []);

  const independent = biz?.filter((b) => !b.builder).length ?? 0;
  const cards: [string, string, string][] = stats
    ? [
        [stats.bills_paid_autonomously, "bills paid by the agent", "Decided, checked and sent with no human in the loop."],
        [Number(stats.usdc_paid).toFixed(2), "USDC moved", `To ${stats.distinct_payees_paid} distinct payees, all on the owner's allowlist.`],
        [stats.blocked_or_clamped_by_policy, "model proposals corrected", "Clamped or rejected by code before reaching the chain."],
        [stats.commitments_opened, "on-chain commitments", `${stats.hits} hit · ${stats.misses} miss so far on real vaults, graded by the contract.`],
      ]
    : [];

  return (
    <div>
      <Kicker n={2} label="Live numbers" />
      <Headline>
        Already paying bills,
        <br />
        on its own.
      </Headline>
      {!stats ? (
        <div className="text-xs text-ink-dim font-data">
          {failed ? "[ WAKING THE BACKEND ] The hosted API is starting up. Retrying…" : "Loading live numbers…"}
        </div>
      ) : (
        <>
          <div className="hairline-grid grid grid-cols-2 lg:grid-cols-4 border border-border">
            {cards.map(([v, l, d]) => (
              <div key={l} className="bg-bg p-6">
                <div className="font-macro text-5xl tracking-tight text-good">{v}</div>
                <div className="text-sm text-ink mt-3">{l}</div>
                <div className="text-xs text-ink-dim mt-2 leading-relaxed">{d}</div>
              </div>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px] font-data text-ink-dim">
            <span>Source: live from /api/stats, real (non-test) vaults only · Arc testnet</span>
            <span>
              {biz?.length ?? 0} business{biz?.length === 1 ? "" : "es"} live · {independent} independent
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function ProblemSlide() {
  const items: [string, string, string][] = [
    ["A limit is just a number someone typed", "Agents get a spending limit from a config file. Nothing ties it to how well the agent actually performs.", "e.g. “max $500/day”, set once, never earned"],
    ["Trust is all or nothing", "You hand the agent the keys or you don't use it. There's no probation, no way to start small and grow, the way you would with a new hire.", "full access, or a human approving every payment"],
    ["Agents grade their own homework", "Performance claims come from logs and dashboards the operator controls. Nobody outside can check them.", "self-reported uptime, self-reported accuracy"],
  ];
  return (
    <div>
      <Kicker n={3} label="The problem" />
      <Headline>Why nobody gives an AI the company card</Headline>
      <div className="hairline-grid grid grid-cols-1 md:grid-cols-3 border border-border">
        {items.map(([t, d, e], n) => (
          <div key={t} className="bg-bg p-6 flex flex-col">
            <div className="font-data text-xs text-accent mb-4">0{n + 1}</div>
            <div className="font-macro uppercase text-lg leading-tight mb-3">{t}</div>
            <div className="text-xs text-ink-dim leading-relaxed flex-1">{d}</div>
            <div className="text-[11px] text-ink-dim/70 font-data mt-5 border-t border-border pt-3">{e}</div>
          </div>
        ))}
      </div>
      <p className="text-sm text-ink-dim mt-8 max-w-2xl leading-relaxed">
        Today, letting an AI agent move a business&apos;s money is a leap of faith, and{" "}
        <span className="text-ink">the business carries all of the risk.</span>
      </p>
    </div>
  );
}

function SolutionSlide() {
  const items: [string, string, string][] = [
    ["VAULT", "The owner's vault", "USDC, payees and bills live in a contract the owner controls. The agent acts only through it."],
    ["ALLOWLIST", "Pays only who you approve", "No function sends money anywhere else. New payees wait an hour before they can be paid."],
    ["SWEEP", "Every saving is a promise", "Parking idle cash commits the agent on-chain: every bill due before T is paid on time."],
    ["SETTLE", "Graded by the contract", "After T, anyone calls settle(). The contract checks its own records: hit or miss."],
    ["SCORE", "Limit = track record", "A hit raises the limit; a miss halves the score. Only kept promises can raise it."],
    ["KECCAK256", "Every decision replayable", "Hashed before money moves, hash stored on-chain. Re-verify any decision in your browser."],
  ];
  return (
    <div>
      <Kicker n={4} label="What we built" />
      <Headline>
        Euthyna: an AI treasurer
        <br />
        that earns its limit.
      </Headline>
      <div className="hairline-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 border border-border">
        {items.map(([tag, t, d], n) => (
          <div key={t} className="bg-bg p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="font-data text-xs text-good">{String(n + 1).padStart(2, "0")}</span>
              <span className="font-data text-[10px] text-ink-dim tracking-widest">{tag}</span>
            </div>
            <div className="font-macro uppercase text-base mb-2">{t}</div>
            <div className="text-xs text-ink-dim leading-relaxed">{d}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

type Tone = "routine" | "judge" | "earn";
function WorkflowSlide() {
  const steps: [string, string, string, string, Tone][] = [
    ["ONBOARD", "Owner sets up", "Creates a vault, approves a payee, registers a bill. Three wallet signatures.", "/console/onboard", "routine"],
    ["DECIDE", "Agent decides", "Snapshot, code computes every number, the model proposes, policy checks.", "LLM chain · policy", "routine"],
    ["PAY", "Bills get paid", "Paid on time through the agent's Circle wallet, decision hash on-chain.", "Circle SCA · Arc", "routine"],
    ["COMMIT", "Agent makes a promise", "Spare cash goes to reserve with a deadline T. The claim is now falsifiable.", "sweep()", "judge"],
    ["SETTLE", "Contract grades it", "After T plus grace, anyone settles. Hit or miss, from contract state.", "settle()", "judge"],
    ["EARN", "Trust moves", "A hit raises the limit. A miss halves the score and freezes sweeps for 24h.", "score → limit", "earn"],
  ];
  const node = (t: Tone) =>
    t === "judge" ? "border-accent text-accent" : t === "earn" ? "border-good bg-good text-bg" : "border-border text-ink";
  const card = (t: Tone) => (t === "judge" ? "border-accent/60" : t === "earn" ? "border-good" : "border-border");
  return (
    <div>
      <Kicker n={5} label="How it works" />
      <Headline>End to end, on-chain</Headline>
      <div className="relative">
        {/* connector line behind the nodes (desktop) */}
        <div className="hidden lg:block absolute left-[8%] right-[8%] top-[22px] h-px bg-border" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          {steps.map(([k, t, d, tag, tone], n) => (
            <div key={k} className="flex flex-col">
              <div className="flex lg:justify-center mb-3">
                <div className={`relative z-10 w-11 h-11 border-2 bg-bg flex items-center justify-center font-data text-xs ${node(tone)}`}>
                  {String(n + 1).padStart(2, "0")}
                </div>
              </div>
              <div className="font-data text-[10px] tracking-widest text-ink-dim lg:text-center mb-2">{k}</div>
              <div className={`border p-4 flex-1 flex flex-col ${card(tone)}`}>
                <div className="font-macro uppercase text-sm mb-2 leading-tight">{t}</div>
                <div className="text-[11px] text-ink-dim leading-relaxed flex-1">{d}</div>
                <div className="mt-3 text-[10px] font-data text-ink-dim border border-border px-2 py-1 self-start">{tag}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-6 flex flex-wrap gap-6 text-[11px] font-data text-ink-dim">
        <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 border border-border" /> the agent&apos;s routine</span>
        <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 border border-accent" /> where the contract judges</span>
        <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 bg-good" /> trust earned</span>
      </div>
    </div>
  );
}

function DifferentSlide() {
  const cols = ["Pays bills itself", "Limit enforced on-chain", "Limit earned from results", "Graded by a contract", "Decisions replayable"];
  const rows: [string, string[], boolean?][] = [
    ["AI payment agents", ["✓", "—", "—", "—", "—"]],
    ["Fixed spending caps (multisig, policy rules)", ["—", "✓", "fixed", "—", "—"]],
    ["Off-chain agent ratings", ["—", "—", "self-reported", "—", "—"]],
    ["Euthyna", ["✓", "✓", "✓", "✓", "✓"], true],
  ];
  return (
    <div>
      <Kicker n={6} label="Why it's different" />
      <Headline>Verified, not assumed</Headline>
      <div className="border border-border overflow-x-auto">
        <table className="w-full text-xs font-data">
          <thead>
            <tr className="border-b border-border text-[10px] uppercase tracking-wide text-ink-dim text-left">
              <th className="px-4 py-3 font-normal" />
              {cols.map((c) => (
                <th key={c} className="px-4 py-3 font-normal">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, cells, us]) => (
              <tr key={name} className={`border-b border-border last:border-b-0 ${us ? "bg-surface" : ""}`}>
                <td className={`px-4 py-3 ${us ? "text-ink font-semibold" : "text-ink-dim"}`}>{name}</td>
                {cells.map((c, n) => (
                  <td key={n} className={`px-4 py-3 ${us ? "text-good" : c === "✓" ? "text-ink" : "text-ink-dim"}`}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="hairline-grid grid grid-cols-1 md:grid-cols-3 border border-border mt-6">
        {[
          ["Earned, not configured", "The only thing that raises the limit is a promise kept, checked by the contract."],
          ["Lost faster than earned", "Hits add a little; one miss halves the score. Reckless agents shrink quickly."],
          ["Anyone can audit it", "settle() is permissionless and every decision hash is on-chain, so outsiders can check everything."],
        ].map(([t, d]) => (
          <div key={t} className="bg-bg px-5 py-4">
            <div className="font-macro uppercase text-sm mb-1.5">{t}</div>
            <div className="text-xs text-ink-dim leading-relaxed">{d}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrySlide() {
  return (
    <div>
      <Kicker n={7} label="Try it" />
      <Headline>
        Put one real bill on it.
        <br />
        Five minutes.
      </Headline>
      <div className="hairline-grid grid grid-cols-1 md:grid-cols-4 border border-border">
        {[
          ["Get test USDC", "faucet.circle.com, Arc Testnet"],
          ["Create a vault", "Connect MetaMask on Onboard"],
          ["Add a payee and a bill", "Payee goes live in 1 hour"],
          ["Fund it", "Watch the agent pay and commit"],
        ].map(([t, d], n) => (
          <div key={t} className="bg-bg p-5">
            <div className="font-data text-xs text-good mb-3">{String(n + 1).padStart(2, "0")}</div>
            <div className="font-macro uppercase text-sm mb-1.5">{t}</div>
            <div className="text-xs text-ink-dim">{d}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-4 mt-8">
        <Link href="/console/onboard" className="border border-good text-good px-5 py-3 text-xs font-data uppercase hover:bg-good hover:text-bg">
          Open Onboard
        </Link>
        <Link href="/console/trust" className="border border-border text-ink-dim px-5 py-3 text-xs font-data uppercase hover:border-ink hover:text-ink">
          See the trust ledger
        </Link>
        <Link href="/docs" className="text-xs font-data text-ink-dim hover:text-ink underline decoration-border underline-offset-2">
          Docs
        </Link>
        <a href={REPO} target="_blank" rel="noreferrer" className="text-xs font-data text-ink-dim hover:text-ink underline decoration-border underline-offset-2">
          Source on GitHub
        </a>
      </div>
    </div>
  );
}
