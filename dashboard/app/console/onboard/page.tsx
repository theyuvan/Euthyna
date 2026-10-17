"use client";

import { useState } from "react";
import { encodeFunctionData, parseEventLogs, getAddress } from "viem";
import { createAgentWallet, prepareAddPayee, prepareRegisterObligation } from "@/lib/api";
import { factoryAbi, FACTORY_ADDRESS } from "@/lib/factory-abi";
import { publicClient } from "@/lib/chain";
import { sendPreparedTx } from "@/lib/wallet";
import { useWallet } from "@/lib/WalletContext";
import { Panel, WalletButton, HashLink } from "@/components/primitives";

type Step = "connect" | "vault" | "payee" | "bill" | "done";

export default function OnboardPage() {
  const wallet = useWallet();
  const [step, setStep] = useState<Step>("connect");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [agentAddress, setAgentAddress] = useState<string | null>(null);
  const [vaultAddress, setVaultAddress] = useState<string | null>(null);
  const [vaultTx, setVaultTx] = useState<string | null>(null);

  const [payeeAddr, setPayeeAddr] = useState("");
  const [payeeName, setPayeeName] = useState("");
  const [maxInvoice, setMaxInvoice] = useState("50");
  const [maxMonth, setMaxMonth] = useState("200");
  const [payeeTx, setPayeeTx] = useState<string | null>(null);

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
      setStep("bill");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

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
      <div className="flex items-start justify-between px-8 pt-8 pb-6 border-b border-border">
        <div>
          <h1 className="font-macro text-3xl tracking-tight uppercase">Onboard</h1>
          <p className="text-xs text-ink-dim mt-2 max-w-2xl leading-relaxed">
            A real vault, a real agent wallet, one real payee, one real bill — under 5 minutes. Your wallet signs
            every step; nobody else ever holds your key. Note: a new payee needs the contract&apos;s own activation
            delay (10 min minimum) before the agent can pay it — that part can&apos;t be sped up here, by design.
          </p>
        </div>
        <WalletButton address={wallet.address} connecting={wallet.connecting} error={wallet.error} onConnect={wallet.connect} />
      </div>

      <div className="p-8 max-w-xl space-y-6">
        {error && <div className="border border-accent text-accent text-xs font-data px-4 py-2">[ ERROR ] {error}</div>}

        <Panel title="Step 1 · Create vault">
          <div className="p-5 space-y-3">
            {!wallet.address ? (
              <p className="text-xs text-ink-dim">Connect your wallet above first — it becomes this vault&apos;s owner.</p>
            ) : vaultAddress ? (
              <div className="text-xs font-data space-y-1">
                <div>vault: <HashLink hash={vaultAddress} kind="address" /></div>
                <div>agent: {agentAddress && <HashLink hash={agentAddress} kind="address" />}</div>
                {vaultTx && <div>tx: <HashLink hash={vaultTx} kind="tx" /></div>}
              </div>
            ) : (
              <button
                onClick={createVault}
                disabled={busy}
                className="border border-good text-good px-4 py-2 text-xs font-data uppercase hover:bg-good hover:text-bg disabled:opacity-50"
              >
                {busy ? "creating…" : "Create a real vault owned by me"}
              </button>
            )}
          </div>
        </Panel>

        {step !== "connect" && vaultAddress && (
          <Panel title="Step 2 · Add a payee">
            <div className="p-5 space-y-3">
              {payeeTx ? (
                <div className="text-xs font-data">payee added — tx: <HashLink hash={payeeTx} kind="tx" /></div>
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
              <Field label="Due date" value={billDue} onChange={setBillDue} type="datetime-local" />
              <Field label="Invoice number" value={billInvoice} onChange={setBillInvoice} placeholder="e.g. INV-001" />
              <button
                onClick={addBill}
                disabled={busy || !billAmount || !billDue || !billInvoice}
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wide text-ink-dim mb-1">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-bg border border-border text-xs font-data px-3 py-2 text-ink outline-none focus:border-good"
      />
    </label>
  );
}
