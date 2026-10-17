"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/console", label: "TREASURY" },
  { href: "/console/trust", label: "TRUST" },
  { href: "/console/decisions", label: "DECISIONS" },
  { href: "/console/replay", label: "REPLAY" },
  { href: "/console/escalations", label: "ESCALATIONS" },
  { href: "/console/onboard", label: "ONBOARD" },
  { href: "/console/stats", label: "PUBLIC STATS" },
];

function NavBody({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <>
      <Link href="/" onClick={onNavigate} className="block px-4 py-5 border-b border-border hover:bg-surface">
        <div className="font-macro text-base leading-none tracking-tight">EUTHYNA</div>
        <div className="text-[10px] text-ink-dim tracking-wide mt-1">OPERATOR CONSOLE</div>
      </Link>
      <nav className="flex-1 py-2 overflow-y-auto">
        {NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={`block px-4 py-2.5 text-xs tracking-wide border-l-2 ${
                active
                  ? "border-good text-ink bg-surface"
                  : "border-transparent text-ink-dim hover:text-ink hover:bg-surface"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <Link href="/pitch" onClick={onNavigate} className="block px-4 py-2.5 text-xs tracking-wide border-t border-border text-ink-dim hover:text-ink hover:bg-surface">
        PITCH ↗
      </Link>
      <Link href="/docs" onClick={onNavigate} className="block px-4 py-2.5 text-xs tracking-wide border-t border-border text-ink-dim hover:text-ink hover:bg-surface">
        DOCS ↗
      </Link>
      <div className="px-4 py-3 border-t border-border text-[10px] text-ink-dim leading-relaxed">
        Arc testnet · chain 5042002
        <br />
        testnet.arcscan.app
      </div>
    </>
  );
}

/** Desktop: a fixed column. Below lg it's hidden, and MobileNav takes over. */
export function Sidebar() {
  return (
    <aside className="hidden lg:flex w-56 shrink-0 border-r border-border flex-col sticky top-0 h-screen">
      <NavBody />
    </aside>
  );
}

/** Phones and tablets: the same navigation as a slide-in drawer, opened from the top bar. */
export function MobileNav({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();

  // close on navigation and on Escape; lock page scroll while open
  useEffect(() => {
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  return (
    <div className={`lg:hidden fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/70 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`}
      />
      <aside
        className={`absolute left-0 top-0 h-full w-64 max-w-[80vw] bg-bg border-r border-border flex flex-col transition-transform duration-200 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <button
          onClick={onClose}
          aria-label="Close menu"
          className="absolute right-2 top-4 px-2 py-1 text-xs font-data text-ink-dim hover:text-ink"
        >
          ✕
        </button>
        <NavBody onNavigate={onClose} />
      </aside>
    </div>
  );
}
