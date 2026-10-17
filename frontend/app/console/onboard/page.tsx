"use client";

import { useState } from "react";
import { encodeFunctionData, parseEventLogs, getAddress } from "viem";
import { createAgentWallet, prepareAddPayee, prepareRegisterObligation, setBusinessName } from "@/lib/api";
import { factoryAbi, FACTORY_ADDRESS } from "@/lib/factory-abi";
import { vaultAbi } from "@/lib/vault-abi";
import { publicClient } from "@/lib/chain";
import { sendPreparedTx } from "@/lib/wallet";
import { useWallet } from "@/lib/WalletContext";
import { Panel, HashLink } from "@/components/primitives";

type Step = "connect" | "vault" | "payee" | "bill" | "done";

/** ms epoch -> "YYYY-MM-DDTHH:mm" in local time, the format a datetime-local input takes */
function toLocalInput(ms: number) {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function OnboardPage() {
  const wallet = useWallet();
  const [step, setStep] = useState<Step>("connect");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [businessName, setBusinessNameInput] = useState("");
  const [businessSaved, setBusinessSaved] = useState(false);
  const [agentAddress, setAgentAddress] = useState<string | null>(null);
  const [vaultAddress, setVaultAddress] = useState<string | null>(null);
  const [vaultTx, setVaultTx] = useState<string | null>(null);

  const [payeeAddr, setPayeeAddr] = useState("");
  const [payeeName, setPayeeName] = useState("");
  const [maxInvoice, setMaxInvoice] = useState("50");
  const [maxMonth, setMaxMonth] = useState("200");
  const [payeeTx, setPayeeTx] = useState<string | null>(null);
  // when the contract lets the agent pay this payee (its anti-sabotage delay), read from chain
  const [payeeLiveAt, setPayeeLiveAt] = useState<number | null>(null);
  const [payeeLiveInMin, setPayeeLiveInMin] = useState<number | null>(null);

  const [billAmount, setBillAmount] = useState("");
  const [billDue, setBillDue] = useState("");
  const [billInvoice, setBillInvoice] = useState("");
  const [billTx, setBillTx] = useState<string | null>(null);

  async function createVault() {
    if (!wallet.address) return;
    setBusy(true);
    setError(null);
    try {
      const w = await createAgentWallet();
      setAgentAddress(w.address);

      const data = encodeFunctionData({ abi: factoryAbi, functionName: "createVault", args: [getAddress(w.address)] });
      const hash = await sendPreparedTx(FACTORY_ADDRESS, data, wallet.address);
      setVaultTx(hash);

      const receipt = await publicClient.waitForTransactionReceipt({ hash: hash as `0x${string}` });
      const [ev] = parseEventLogs({ abi: factoryAbi, logs: receipt.logs, eventName: "VaultCreated" });
      if (!ev) throw new Error("VaultCreated event not found in receipt");
      setVaultAddress(ev.args.vault);
      setStep("payee");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function addPayee() {
    if (!wallet.address || !vaultAddress) return;
    setBusy(true);
    setError(null);
    try {
      const { to, data } = await prepareAddPayee(
        vaultAddress,
        { address: payeeAddr, maxPerInvoiceUsdc: maxInvoice, maxPerMonthUsdc: maxMonth, displayName: payeeName || undefined },
        wallet.address,
      );
      const hash = await sendPreparedTx(to, data, wallet.address);
      setPayeeTx(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: hash as `0x${string}` });
      if (receipt.status !== "success") throw new Error("addPayee transaction reverted");
      const p = await publicClient.readContract({
        address: getAddress(vaultAddress),
        abi: vaultAbi,
        functionName: "getPayee",
        args: [getAddress(payeeAddr)],
      });
      const liveAt = Number(p.activeAt) * 1000;
      setPayeeLiveAt(liveAt);
      setPayeeLiveInMin(Math.max(0, Math.round((liveAt - Date.now()) / 60000)));
      setBillDue(toLocalInput(liveAt + 60 * 60 * 1000)); // a sensible default: an hour after go-live
      setStep("bill");
      // The name is off-chain metadata, saved now that the backend has indexed the vault. Optional,
      // so a failure here (e.g. the signature request is declined) never blocks the bill step.
      if (businessName.trim() && !businessSaved) {
        await setBusinessName(vaultAddress, businessName.trim(), wallet.address)
          .then(() => setBusinessSaved(true))
          .catch(() => {});
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const dueTooEarly = Boolean(payeeLiveAt && billDue && new Date(billDue).getTime() < payeeLiveAt);

  async function addBill() {
    if (!wallet.address || !vaultAddress) return;
    setBusy(true);
    setError(null);
    try {
      const { to, data } = await prepareRegisterObligation(
        vaultAddress,
        { payee: payeeAddr, amountUsdc: billAmount, dueAt: new Date(billDue).toISOString(), invoiceNumber: billInvoice },
        wallet.address,
      );
      const hash = await sendPreparedTx(to, data, wallet.address);
      setBillTx(hash);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 px-4 sm:px-8 pt-6 sm:pt-8 pb-5 sm:pb-6 border-b border-border">
        <div>
          <h1 className="font-macro text-2xl sm:text-3xl tracking-tight uppercase">Onboard</h1>
          <p className="text-xs text-ink-dim mt-2 max-w-2xl leading-relaxed">
            A real vault, a real agent wallet, one real payee, one real bill — under 5 minutes. Your wallet signs
            every step; nobody else ever holds your key. Note: a new payee is locked for the vault&apos;s activation
            delay (set per vault, never under 10 minutes) before the agent can pay it — an anti-sabotage rule that
            can&apos;t be sped up. You&apos;ll see the exact go-live time after adding the payee.
          </p>
        </div>
      </div>

      <div className="p-4 sm:p-8 max-w-xl space-y-6">
        {error && <div className="border border-accent text-accent text-xs font-data px-4 py-2">[ ERROR ] {error}</div>}

        <div className={`border px-4 py-3 text-xs font-data ${wallet.address ? "border-good" : "border-border"}`}>
          <div className="text-[10px] uppercase tracking-wide text-ink-dim mb-1">Owner wallet</div>
          {wallet.address ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-good">●</span>
              <HashLink hash={wallet.address} kind="address" />
              <span className="text-ink-dim">connected · this wallet will own the vault and sign every step</span>
            </div>
          ) : (
            <div className="text-ink-dim">
              Not connected. Use <span className="text-ink">connect wallet</span> in the top bar; that wallet becomes the
              vault&apos;s owner.
            </div>
          )}
        </div>

        <Panel title="Step 1 · Create vault">
          <div className="p-5 space-y-3">
            {!wallet.address ? (
              <p className="text-xs text-ink-dim">Connect your wallet from the top bar first. It becomes this vault&apos;s owner.</p>
            ) : vaultAddress ? (
              <div className="text-xs font-data space-y-1">
                {businessName.trim() && (
                  <div>
                    business: {businessName.trim()}{" "}
                    <span className="text-ink-dim">{businessSaved ? "(saved)" : "(saved with the payee step)"}</span>
                  </div>
                )}
                <div>vault: <HashLink hash={vaultAddress} kind="address" /></div>
                <div>agent: {agentAddress && <HashLink hash={agentAddress} kind="address" />}</div>
                {vaultTx && <div>tx: <HashLink hash={vaultTx} kind="tx" /></div>}
              </div>
            ) : (
              <>
              <Field label="Business name (optional, shown publicly)" value={businessName} onChange={setBusinessNameInput} placeholder="e.g. Asha's Bakery" />
              <button
                onClick={createVault}
                disabled={busy}
                className="border border-good text-good px-4 py-2 text-xs font-data uppercase hover:bg-good hover:text-bg disabled:opacity-50"
              >
                {busy ? "creating…" : "Create a real vault owned by me"}
              </button>
              </>
            )}
          </div>
        </Panel>

        {step !== "connect" && vaultAddress && (
          <Panel title="Step 2 · Add a payee">
            <div className="p-5 space-y-3">
              {payeeTx ? (
                <div className="text-xs font-data space-y-1">
                  <div>payee added — tx: <HashLink hash={payeeTx} kind="tx" /></div>
                  {payeeLiveAt ? (
                    <div className="text-ink-dim">
                      goes live at <span className="text-ink">{new Date(payeeLiveAt).toLocaleString()}</span>
                      {payeeLiveInMin !== null && <> (in {payeeLiveInMin} min)</>} — the agent can&apos;t pay it before then.
                    </div>
                  ) : (
                    <div className="text-ink-dim">waiting for confirmation…</div>
                  )}
                </div>
              ) : (
                <>
                  <Field label="Payee address" value={payeeAddr} onChange={setPayeeAddr} placeholder="0x..." />
                  <Field label="Display name" value={payeeName} onChange={setPayeeName} placeholder="e.g. hosting provider" />
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Max per invoice (USDC)" value={maxInvoice} onChange={setMaxInvoice} />
                    <Field label="Max per month (USDC)" value={maxMonth} onChange={setMaxMonth} />
                  </div>
                  <button
                    onClick={addPayee}
                    disabled={busy || !payeeAddr}
                    className="border border-good text-good px-4 py-2 text-xs font-data uppercase hover:bg-good hover:text-bg disabled:opacity-50"
                  >
                    {busy ? "sending…" : "Add payee"}
                  </button>
                </>
              )}
            </div>
          </Panel>
        )}

        {step === "bill" && payeeTx && (
          <Panel title="Step 3 · Register your first real bill">
            <div className="p-5 space-y-3">
              <Field label="Amount (USDC)" value={billAmount} onChange={setBillAmount} placeholder="e.g. 10" />
              <Field
                label="Due date"
                value={billDue}
                onChange={setBillDue}
                type="datetime-local"
                min={payeeLiveAt ? toLocalInput(payeeLiveAt) : undefined}
              />
              {dueTooEarly && (
                <div className="border border-accent text-accent text-xs font-data px-3 py-2">
                  [ TOO EARLY ] This is before the payee goes live ({new Date(payeeLiveAt!).toLocaleTimeString()}), so
                  the agent couldn&apos;t pay it on time. Pick a later due date.
                </div>
              )}
              <Field label="Invoice number" value={billInvoice} onChange={setBillInvoice} placeholder="e.g. INV-001" />
              <button
                onClick={addBill}
                disabled={busy || !billAmount || !billDue || !billInvoice || dueTooEarly}
                className="border border-good text-good px-4 py-2 text-xs font-data uppercase hover:bg-good hover:text-bg disabled:opacity-50"
              >
                {busy ? "sending…" : "Register bill"}
              </button>
            </div>
          </Panel>
        )}

        {step === "done" && billTx && (
          <div className="border border-good text-good px-4 py-3 text-xs font-data">
            [ DONE ] Real vault, real payee, real bill. tx: <HashLink hash={billTx} kind="tx" />
            <br />
            Fund it from faucet.circle.com (Arc testnet) to the vault address above, and it&apos;s live.
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  min,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  min?: string;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wide text-ink-dim mb-1">{label}</span>
      <input
        type={type}
        min={min}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-bg border border-border text-xs font-data px-3 py-2 text-ink outline-none focus:border-good"
      />
    </label>
  );
}
