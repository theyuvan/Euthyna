"use client";

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

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-56 shrink-0 border-r border-border flex flex-col sticky top-0 h-screen">
      <Link href="/" className="block px-4 py-5 border-b border-border hover:bg-surface">
        <div className="font-macro text-base leading-none tracking-tight">EUTHYNA</div>
        <div className="text-[10px] text-ink-dim tracking-wide mt-1">OPERATOR CONSOLE</div>
      </Link>
      <nav className="flex-1 py-2">
        {NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
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
      <Link href="/docs" className="block px-4 py-2.5 text-xs tracking-wide border-t border-border text-ink-dim hover:text-ink hover:bg-surface">
        DOCS ↗
      </Link>
      <div className="px-4 py-3 border-t border-border text-[10px] text-ink-dim leading-relaxed">
        Arc testnet · chain 5042002
        <br />
        testnet.arcscan.app
      </div>
    </aside>
  );
}
