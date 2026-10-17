"use client";

import { useCallback, useState } from "react";
import { MobileNav, Sidebar } from "@/components/sidebar";
import { WalletButton } from "@/components/primitives";
import { WalletProvider, useWallet } from "@/lib/WalletContext";
import { useVault } from "@/lib/useVault";
import { DEFAULT_VAULT, short } from "@/lib/api";

function TopBar({ onMenu }: { onMenu: () => void }) {
  const wallet = useWallet();
  const [vault] = useVault();
  const isDefault = vault.toLowerCase() === DEFAULT_VAULT.toLowerCase();
  return (
    <div className="flex items-center justify-between gap-3 px-4 sm:px-8 py-3 border-b border-border sticky top-0 z-30 bg-bg lg:static">
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onMenu}
          aria-label="Open menu"
          className="lg:hidden shrink-0 border border-border px-2.5 py-1.5 text-xs font-data text-ink-dim hover:border-ink hover:text-ink"
        >
          ☰
        </button>
        <div className="text-[10px] uppercase tracking-wide text-ink-dim font-data min-w-0">
          <span className="hidden sm:inline">Viewing vault: </span>
          <span className="sm:hidden">Vault </span>
          <span className="text-ink-dim normal-case">{short(vault)}</span>
          {!wallet.address && isDefault && (
            <span className="ml-1 hidden md:inline">(default — connect your wallet to see your own)</span>
          )}
        </div>
      </div>
      <WalletButton address={wallet.address} connecting={wallet.connecting} error={wallet.error} onConnect={wallet.connect} onDisconnect={wallet.disconnect} />
    </div>
  );
}

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  return (
    <WalletProvider>
      <div className="min-h-full flex">
        <Sidebar />
        <MobileNav open={menuOpen} onClose={closeMenu} />
        <div className="flex-1 min-w-0 flex flex-col">
          <TopBar onMenu={() => setMenuOpen(true)} />
          <main className="flex-1 min-w-0 overflow-x-hidden">{children}</main>
        </div>
      </div>
    </WalletProvider>
  );
}
