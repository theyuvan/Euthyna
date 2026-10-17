"use client";

import { useEffect, useState } from "react";
import { DEFAULT_VAULT, getVaults } from "./api";
import { useWallet } from "./WalletContext";

const KEY = "euthyna.selectedVault";

/** `?vault=0x…` in the URL, if valid. Read inside effects only (client-side), so pages don't need
 *  a Suspense boundary the way useSearchParams would. */
function urlVault(): string | null {
  const v = new URLSearchParams(window.location.search).get("vault");
  return v && /^0x[0-9a-fA-F]{40}$/.test(v) ? v : null;
}

/** The vault currently shown across /console, in priority order:
 *  1. an explicit `?vault=` link (e.g. the landing page's proof link to the test vault's chart);
 *  2. the connected wallet's own vault (first active, non-test one it owns);
 *  3. the last-picked vault in localStorage, then DEFAULT_VAULT — so a visitor who hasn't
 *     connected anything still sees real data. */
export function useVault(): [string, (v: string) => void] {
  const { address } = useWallet();
  const [vault, setVaultState] = useState(DEFAULT_VAULT);

  useEffect(() => {
    const fromUrl = urlVault();
    if (fromUrl) return setVaultState(fromUrl);
    if (!address) return;
    getVaults(address)
      .then((vaults) => {
        const pick = vaults.find((v) => v.active && !v.is_test) ?? vaults[0];
        if (pick) setVaultState(pick.address);
      })
      .catch(() => {});
  }, [address]);

  useEffect(() => {
    if (address || urlVault()) return;
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
