"use client";

import { useEffect, useState } from "react";
import { DEFAULT_VAULT, getVaults } from "./api";
import { useWallet } from "./WalletContext";

const KEY = "euthyna.selectedVault";

/** The vault currently shown across /console. Driven by the connected wallet once one's
 *  connected (looks up the vault(s) that wallet owns and picks the first active, non-test one);
 *  falls back to the last-picked vault in localStorage, then DEFAULT_VAULT, when no wallet is
 *  connected — so the console still shows real data to a visitor who hasn't connected anything. */
export function useVault(): [string, (v: string) => void] {
  const { address } = useWallet();
  const [vault, setVaultState] = useState(DEFAULT_VAULT);

  useEffect(() => {
    if (!address) return;
    getVaults(address)
      .then((vaults) => {
        const pick = vaults.find((v) => v.active && !v.is_test) ?? vaults[0];
        if (pick) setVaultState(pick.address);
      })
      .catch(() => {});
  }, [address]);

  useEffect(() => {
    if (address) return; // wallet-driven selection takes precedence once connected
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) setVaultState(saved);
    } catch {
      /* private window / blocked storage — fall back to the default, silently */
    }
  }, [address]);

  const setVault = (v: string) => {
    setVaultState(v);
    try {
      localStorage.setItem(KEY, v);
    } catch {
      /* ignore */
    }
  };

  return [vault, setVault];
}
