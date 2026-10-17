"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { connectWallet, onAccountsChanged, revokeWallet } from "./wallet";

interface WalletState {
  address: string | null;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
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

  const disconnect = async () => {
    setAddress(null);
    setError(null);
    await revokeWallet();
  };

  // Follow the wallet: switching accounts updates the address, locking it disconnects.
  useEffect(() => {
    if (!address) return;
    return onAccountsChanged((a) => setAddress(a));
  }, [address]);

  return <WalletCtx.Provider value={{ address, connecting, error, connect, disconnect }}>{children}</WalletCtx.Provider>;
}

/** Wallet state shared across every /console page — connect once on any page, it stays
 *  connected everywhere (Onboard, Escalations, and the top-bar connect button alike). */
export function useWallet() {
  const ctx = useContext(WalletCtx);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
