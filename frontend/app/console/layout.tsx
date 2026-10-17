"use client";

import { Sidebar } from "@/components/sidebar";
import { WalletButton } from "@/components/primitives";
import { WalletProvider, useWallet } from "@/lib/WalletContext";
import { useVault } from "@/lib/useVault";
import { DEFAULT_VAULT, short } from "@/lib/api";

function TopBar() {
  const wallet = useWallet();
  const [vault] = useVault();
  const isDefault = vault.toLowerCase() === DEFAULT_VAULT.toLowerCase();
  return (
    <div className="flex items-center justify-between px-8 py-3 border-b border-border">
      <div className="text-[10px] uppercase tracking-wide text-ink-dim font-data">
        Viewing vault: <span className="text-ink-dim normal-case">{short(vault)}</span>
        {!wallet.address && isDefault && <span className="ml-1">(default — connect your wallet to see your own)</span>}
      </div>
      <WalletButton address={wallet.address} connecting={wallet.connecting} error={wallet.error} onConnect={wallet.connect} onDisconnect={wallet.disconnect} />
    </div>
  );
}

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider>
      <div className="min-h-full flex">
        <Sidebar />
        <div className="flex-1 min-w-0 flex flex-col">
          <TopBar />
          <main className="flex-1 min-w-0 overflow-x-hidden">{children}</main>
        </div>
      </div>
    </WalletProvider>
  );
}
