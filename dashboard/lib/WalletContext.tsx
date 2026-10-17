"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { connectWallet } from "./wallet";

interface WalletState {
  address: string | null;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
}

const WalletCtx = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const addr = await connectWallet();
      setAddress(addr);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  };

  return <WalletCtx.Provider value={{ address, connecting, error, connect }}>{children}</WalletCtx.Provider>;
}

/** Wallet state shared across every /console page — connect once on any page, it stays
 *  connected everywhere (Onboard, Escalations, and the top-bar connect button alike). */
export function useWallet() {
  const ctx = useContext(WalletCtx);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
