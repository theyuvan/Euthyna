"use client";

import { useEffect, useRef } from "react";
import { EuthynaMark } from "@/components/mark";

// Only what Euthyna actually runs on: Arc (chain), Circle (agent wallets), USDC (the money).
// Official marks from arc.io / circle.com, in their own brand colours — no third-party logos
// that would imply a partnership.
type Logo = "arc" | "circle" | "usdc";
const LOGO_BADGE: Record<Logo, { bg: string; img: string; scale: string; alt: string }> = {
  arc: { bg: "linear-gradient(180deg,#1C2998 0%,#3E2B63 53%,#942753 100%)", img: "/logos/arc.svg", scale: "52%", alt: "Arc" },
  circle: { bg: "#121212", img: "/logos/circle.svg", scale: "64%", alt: "Circle" },
  usdc: { bg: "#2775CA", img: "/logos/usdc.svg", scale: "70%", alt: "USDC" },
};

const GLYPHS: Record<string, React.ReactNode> = {
  invoice: <path d="M7 3h7l4 4v14H7zM14 3v4h4M10 12h6M10 16h6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" />
    </>
  ),
  hit: <path d="M5 12.5l4.5 4.5L19 7" />,
  vault: (
    <>
      <rect x="6" y="11" width="12" height="9" />
      <path d="M9 11V8a3 3 0 0 1 6 0v3" />
    </>
  ),
  payee: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c1.2-3.5 4-5 7-5s5.8 1.5 7 5" />
    </>
  ),
  hash: <path d="M9 4 7 20M17 4l-2 16M4 9h16M3 15h16" />,
};
// terminal palette: phosphor white, graphite, and the one green
const GLYPH_SKINS = [
  { bg: "#eaeaea", fg: "#0a0a0a" },
  { bg: "#1a1a1a", fg: "#4af626" },
  { bg: "#2a2a28", fg: "#eaeaea" },
  { bg: "#8a8a86", fg: "#0a0a0a" },
];

type Token = { kind: "logo"; logo: Logo } | { kind: "glyph"; glyph: string; skin: (typeof GLYPH_SKINS)[number] };

const STREAM: Token[] = [
  { kind: "logo", logo: "arc" },
  { kind: "glyph", glyph: "invoice", skin: GLYPH_SKINS[0] },
  { kind: "logo", logo: "usdc" },
  { kind: "glyph", glyph: "clock", skin: GLYPH_SKINS[2] },
  { kind: "logo", logo: "circle" },
  { kind: "glyph", glyph: "hit", skin: GLYPH_SKINS[1] },
  { kind: "logo", logo: "arc" },
  { kind: "glyph", glyph: "vault", skin: GLYPH_SKINS[3] },
  { kind: "logo", logo: "usdc" },
  { kind: "glyph", glyph: "payee", skin: GLYPH_SKINS[2] },
  { kind: "logo", logo: "circle" },
  { kind: "glyph", glyph: "hash", skin: GLYPH_SKINS[0] },
];

// Two arms: one entering from the top-right, one from the bottom-left, both curling clockwise as
// they're drawn into the centre.
const ARMS = [
  { base: -40, offset: 0 },
  { base: 140, offset: 5 },
];
const SWEEP = 70; // degrees of curl from edge to centre
const PERIOD = 30; // seconds for one item to travel edge → centre
const MAX_SIZE = 60; // px, at the outer edge
// Lateral lanes, cycled so neighbours zig-zag and the same lane only recurs every 5 items.
const LANES = [-1, 0.1, 1, -0.5, 0.6];
const LANE_WIDTH = 11; // % of the box at the outer edge

interface Slot {
  arm: number;
  phase: number;
  lane: number;
  token: Token;
}
const SLOTS: Slot[] = ARMS.flatMap((arm, a) =>
  STREAM.map((_, i) => ({
    arm: a,
    phase: i / STREAM.length,
    lane: LANES[i % LANES.length],
    token: STREAM[(i + arm.offset) % STREAM.length],
  })),
);

/** s: 0 = outer edge, 1 = centre. Returns position (% of box), scale and opacity. */
function place(slot: Slot, s: number) {
  const arm = ARMS[slot.arm];
  const angle = ((arm.base + s * SWEEP) * Math.PI) / 180;
  const r = 47 * Math.pow(1 - s, 0.85) + 4;
  const spread = slot.lane * LANE_WIDTH * (1 - s); // perpendicular offset, narrowing toward the centre
  const x = 50 + r * Math.cos(angle) - spread * Math.sin(angle);
  const y = 50 + r * Math.sin(angle) + spread * Math.cos(angle);
  const scale = 1 - 0.78 * s;
  const fadeIn = Math.min(1, s / 0.06);
  const opacity = fadeIn * Math.pow(1 - s, 1.3);
  // rounded so the server- and client-rendered style strings match (else a hydration mismatch)
  return { x: x.toFixed(2), y: y.toFixed(2), scale: scale.toFixed(3), opacity: opacity.toFixed(3) };
}

function styleAt(slot: Slot, s: number): React.CSSProperties {
  const p = place(slot, s);
  return {
    left: `${p.x}%`,
    top: `${p.y}%`,
    opacity: Number(p.opacity),
    transform: `translate(-50%, -50%) scale(${p.scale})`,
  };
}

function Badge({ token }: { token: Token }) {
  if (token.kind === "logo") {
    const b = LOGO_BADGE[token.logo];
    return (
      <div className="orbit-round w-full h-full flex items-center justify-center ring-2 ring-[#0a0a0a]/80" style={{ background: b.bg }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={b.img} alt={b.alt} style={{ width: b.scale, height: b.scale }} draggable={false} />
      </div>
    );
  }
  return (
    <div className="orbit-round w-full h-full flex items-center justify-center ring-2 ring-[#0a0a0a]/80" style={{ background: token.skin.bg }}>
      <svg viewBox="0 0 24 24" className="w-1/2 h-1/2" fill="none" stroke={token.skin.fg} strokeWidth={2} strokeLinecap="square" strokeLinejoin="miter">
        {GLYPHS[token.glyph]}
      </svg>
    </div>
  );
}

export function Orbit() {
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = (now - start) / 1000 / PERIOD;
      SLOTS.forEach((slot, i) => {
        const el = refs.current[i];
        if (!el) return;
        const s = (slot.phase + t) % 1;
        const p = place(slot, s);
        el.style.left = `${p.x}%`;
        el.style.top = `${p.y}%`;
        el.style.opacity = p.opacity;
        el.style.transform = `translate(-50%, -50%) scale(${p.scale})`;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="relative w-full max-w-[560px] aspect-square mx-auto select-none" aria-hidden>
      <div className="orbit-round absolute inset-0 orbit-glow" />

      {SLOTS.map((slot, i) => (
        <div
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className="absolute will-change-transform"
          style={{ width: MAX_SIZE, height: MAX_SIZE, ...styleAt(slot, slot.phase) }}
        >
          <Badge token={slot.token} />
        </div>
      ))}

      <div className="orbit-round absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[36%] aspect-square shadow-[0_0_80px_rgba(74,246,38,0.16)]">
        <EuthynaMark className="w-full h-full" />
      </div>

      <div className="orbit-round absolute inset-0 orbit-scan pointer-events-none" />
    </div>
  );
}
