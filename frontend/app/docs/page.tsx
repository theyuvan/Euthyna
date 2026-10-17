import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Docs · Euthyna",
  description: "What Euthyna is, how it works, and how to put your treasury on it in 5 minutes.",
};

const REPO = "https://github.com/theyuvan/Euthyna";
const FACTORY = "0xD6846FB7BAD7F8CDba6eE8fB4b42D4e16A30d658";
const API = "https://euthyna-np2i.onrender.com";

const TOC = [
  { id: "overview", label: "Overview" },
  { id: "how-it-works", label: "How it works" },
  { id: "get-started", label: "Get started" },
  { id: "console", label: "Using the console" },
  { id: "safety", label: "Safety rules" },
  { id: "faq", label: "FAQ" },
  { id: "developers", label: "For developers" },
];

export default function DocsPage() {
  return (
    <div className="min-h-full">
      {/* top bar, matching the landing page */}
      <div className="border-b border-border">
        <div className="px-8 py-5 flex items-center justify-between max-w-[1280px] mx-auto">
          <Link href="/" className="font-macro text-base tracking-tight">
            EUTHYNA
          </Link>
          <nav className="flex items-center gap-6 text-xs font-data text-ink-dim">
            <Link href="/#businesses" className="hover:text-ink">
              BUSINESSES
            </Link>
            <span className="text-ink">DOCS</span>
            <Link href="/console" className="border border-good text-good px-3 py-1.5 hover:bg-good hover:text-bg">
              LAUNCH CONSOLE
            </Link>
          </nav>
        </div>
      </div>

      <div className="max-w-[1280px] mx-auto px-8 grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-12">
        {/* table of contents */}
        <aside className="hidden lg:block">
          <div className="sticky top-0 pt-14">
            <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-4">[ Contents ]</div>
            <nav className="space-y-0.5">
              {TOC.map((t, i) => (
                <a
                  key={t.id}
                  href={`#${t.id}`}
                  className="block py-1.5 text-xs text-ink-dim hover:text-ink border-l-2 border-transparent hover:border-good pl-3"
                >
                  <span className="text-ink-dim/60 mr-2">{String(i + 1).padStart(2, "0")}</span>
                  {t.label}
                </a>
              ))}
            </nav>
          </div>
        </aside>

        <main className="pt-14 pb-24 max-w-3xl">
          <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-6">[ Documentation ]</div>
          <h1 className="font-macro uppercase leading-[0.9] tracking-tight" style={{ fontSize: "clamp(2.25rem, 4.5vw, 3.75rem)" }}>
            How Euthyna works
          </h1>
          <p className="text-sm text-ink-dim mt-6 leading-relaxed">
            Everything you need to understand the agent and put your own treasury on it. It runs on Arc testnet,
            so it uses free test USDC, but the bills, decisions and on-chain records are real.
          </p>

          <Section id="overview" n="01" title="Overview">
            <P>
              Euthyna is an AI treasurer for small businesses. It pays your bills in USDC, keeps enough cash on hand
              for what&apos;s coming due, and parks the rest in a reserve.
            </P>
            <P>
              Most AI agents get a spending limit from a config file, which means trusting whoever wrote it.
              Euthyna&apos;s limit lives in a <B>smart contract</B> and moves only with the agent&apos;s own
              track record, which the contract checks itself. It&apos;s an AI treasurer <B>on probation</B>.
            </P>
          </Section>

          <Section id="how-it-works" n="02" title="How it works">
            <Steps
              items={[
                ["You own a vault", "A smart contract that holds your USDC, your approved payees and your bills. Your wallet is the owner. The agent has its own Circle wallet and can act only through the vault."],
                ["The agent pays bills", "Before each bill is due, the agent pays it, but only to payees you approved and only within limits the contract enforces. It has no function that sends money to an address of its choosing."],
                ["It makes commitments", "When cash sits idle, the agent moves some into reserve and commits on-chain: “every bill due before time T will still be paid on time from liquid cash.”"],
                ["The contract grades it", "After T (plus a short grace period), anyone can call settle(). The contract checks its own records: if every covered bill was paid on time, it's a hit; otherwise, a miss."],
                ["The limit moves", "A hit raises the agent's score, and with it the amount it can pay on its own. A miss halves the score and freezes sweeps for 24 hours."],
              ]}
            />
            <Callout title="Every decision is auditable">
              Each run, the agent snapshots the vault, code computes every number that matters, the LLM proposes
              actions, a policy layer checks them, and the full record is hashed (keccak256). That hash goes
              on-chain with the transaction. On the <Link href="/console/replay" className="text-good hover:underline">Replay</Link>{" "}
              page you can re-hash any record in your own browser and check it matches.
            </Callout>
            <div className="mt-6 border border-border">
              <div className="px-4 py-2 border-b border-border text-[10px] uppercase tracking-widest text-ink-dim">Scoring</div>
              <dl className="text-xs font-data divide-y divide-border">
                <Row k="Autonomous limit" v="min(owner ceiling, base limit + rate × score)" />
                <Row k="Base limit (new vault)" v="25 USDC" />
                <Row k="Daily cap" v="min(owner daily ceiling, 3 × limit)" />
                <Row k="Hit" v="score += min(avg reserve, bills paid on time) × window / 30 days" />
                <Row k="Miss" v="score ÷ 2, sweeps frozen 24h" />
              </dl>
            </div>
          </Section>

          <Section id="get-started" n="03" title="Get started (5 min)">
            <Sub>Before you start</Sub>
            <ol className="list-none space-y-2 text-sm text-ink-dim leading-relaxed">
              <Li n="a">Install <Ext href="https://metamask.io">MetaMask</Ext>.</Li>
              <Li n="b">
                Get free test USDC from <Ext href="https://faucet.circle.com">faucet.circle.com</Ext>. Choose{" "}
                <B>Arc Testnet</B> and paste your address. On Arc, USDC is also the gas token.
              </Li>
              <Li n="c">
                Pick one real bill (hosting, a subscription, a supplier) and get the payee&apos;s wallet address.
                Keep it at <B>25 USDC or less</B> so the agent can pay it on its own.
              </Li>
            </ol>

            <Sub>Set up: 3 signatures</Sub>
            <Steps
              items={[
                ["Create your vault", "Open Onboard and connect your wallet; Arc Testnet is added automatically. Optionally enter a business name (shown publicly), then click Create. You get your own vault and agent wallet."],
                ["Add a payee", "Paste the payee's address and a name. Keep or lower the default limits. The page then shows when the payee goes live, about 1 hour later."],
                ["Register the bill", "Enter the amount and an invoice number. The due date defaults to 1 hour after go-live, and earlier dates are refused, because the agent couldn't pay them in time."],
                ["Fund the vault", "Send test USDC to your vault address, from the faucet or from MetaMask. Send enough to cover the bill, plus a little extra."],
              ]}
            />
            <Link
              href="/console/onboard"
              className="inline-block mt-6 border border-good text-good px-5 py-3 text-xs font-data uppercase hover:bg-good hover:text-bg"
            >
              Open Onboard
            </Link>

            <Sub>What happens next</Sub>
            <P>
              The agent checks your vault every 30 minutes and whenever a new bill arrives, and pays the bill before
              it&apos;s due. Your business shows up in <Link href="/#businesses" className="text-good hover:underline">Live businesses</Link> on
              the home page.
            </P>
          </Section>

          <Section id="console" n="04" title="Using the console">
            <div className="border border-border">
              <dl className="text-xs font-data divide-y divide-border">
                <Row k={<Link href="/console" className="hover:text-good">Treasury</Link>} v="Balance, reserve, the agent's current limit, upcoming bills, expected inflows and owner alerts." />
                <Row k={<Link href="/console/trust" className="hover:text-good">Trust</Link>} v="The limit over time and every commitment with its hit or miss." />
                <Row k={<Link href="/console/decisions" className="hover:text-good">Decisions</Link>} v="Every agent run: what it proposed, what policy allowed, what was sent." />
                <Row k={<Link href="/console/replay" className="hover:text-good">Replay</Link>} v="Re-hash a decision record in your browser and compare it with the on-chain hash." />
                <Row k={<Link href="/console/escalations" className="hover:text-good">Escalations</Link>} v="Bills over the agent's limit wait here for you to approve (paid from your wallet) or cancel." />
                <Row k={<Link href="/console/onboard" className="hover:text-good">Onboard</Link>} v="Create a vault, add payees, register bills." />
                <Row k={<Link href="/console/stats" className="hover:text-good">Public stats</Link>} v="Totals across all real (non-test) vaults." />
              </dl>
            </div>
            <P>
              Connect your wallet and the console opens your vault automatically. Any vault can be viewed with{" "}
              <code className="text-ink">?vault=0x…</code> in the URL.
            </P>
          </Section>

          <Section id="safety" n="05" title="Safety rules">
            <ul className="space-y-3 text-sm text-ink-dim leading-relaxed">
              <Bullet><B>Allowlist only.</B> The agent can pay only payees you added, and only bills that exist.</Bullet>
              <Bullet><B>Payee delay.</B> A new payee goes live after a delay (1 hour on production vaults, never under 10 minutes), so nobody can add an address and get paid instantly.</Bullet>
              <Bullet><B>Per-payee caps.</B> Each payee has a max per invoice and a max per month.</Bullet>
              <Bullet><B>Limits in the contract.</B> Bills above the agent&apos;s limit or daily cap are escalated to you, not paid.</Bullet>
              <Bullet><B>A cash floor.</B> The agent can&apos;t sweep cash below the vault&apos;s minimum liquid balance.</Bullet>
              <Bullet><B>The model never decides a number.</B> Code computes every amount; the policy layer rejects or clamps anything outside the rules, and the contract has the final word.</Bullet>
            </ul>
          </Section>

          <Section id="faq" n="06" title="FAQ">
            <Faq q="Can the agent send my money anywhere?">
              No. It can pay only your approved payees, only for registered bills, and only within limits the contract enforces.
            </Faq>
            <Faq q="Is this real money?">
              No. It&apos;s Arc testnet, and test USDC has no value. The bills, the decisions and the on-chain records are real.
            </Faq>
            <Faq q="What if I change my mind?">
              Only your wallet can cancel a bill (<code className="text-ink">cancelObligation</code>) or replace or remove the
              agent (<code className="text-ink">setAgent</code>). Escalations has a Cancel button for bills waiting on
              you; anything else can be called on your vault&apos;s page on{" "}
              <Ext href="https://testnet.arcscan.app">Arcscan</Ext>.
            </Faq>
            <Faq q="Why wasn't my bill paid yet?">
              Check that the payee is live (1 hour after adding), the vault has enough USDC, and the bill is within the
              agent&apos;s limit. Bills over the limit wait in Escalations.
            </Faq>
            <Faq q="Which AI model makes the decisions?">
              A chain of free models (Gemini first, OpenRouter as fallback). If one fails or runs out of quota, the next
              takes over, and each decision record says which model answered.
            </Faq>
          </Section>

          <Section id="developers" n="07" title="For developers">
            <div className="border border-border">
              <dl className="text-xs font-data divide-y divide-border">
                <Row k="Network" v="Arc testnet · chain 5042002" />
                <Row k="Factory" v={<Ext href={`https://testnet.arcscan.app/address/${FACTORY}`}>{FACTORY}</Ext>} />
                <Row k="API" v={<Ext href={`${API}/api/stats`}>{API}</Ext>} />
                <Row k="Source" v={<Ext href={REPO}>github.com/theyuvan/Euthyna</Ext>} />
              </dl>
            </div>
            <P>Deeper docs live in the repository:</P>
            <ul className="space-y-2 text-sm text-ink-dim">
              <Bullet><Ext href={`${REPO}/blob/main/docs/contract.md`}>contract.md</Ext>: mechanism, scoring, the 22-attack loophole audit, deployed addresses</Bullet>
              <Bullet><Ext href={`${REPO}/blob/main/docs/backend.md`}>backend.md</Ext>: the agent loop, LLM chain, setup, full API reference</Bullet>
              <Bullet><Ext href={`${REPO}/blob/main/docs/frontend.md`}>frontend.md</Ext>: pages, wallets, running and deploying the console</Bullet>
            </ul>
          </Section>
        </main>
      </div>

      <footer className="border-t border-border px-8 py-6 max-w-[1280px] mx-auto text-[10px] text-ink-dim font-data flex items-center justify-between">
        <span>Arc testnet · chain 5042002</span>
        <span>testnet.arcscan.app</span>
      </footer>
    </div>
  );
}

function Section({ id, n, title, children }: { id: string; n: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-8 border-t border-border mt-14 pt-10">
      <div className="font-data text-xs text-ink-dim mb-2">{n}</div>
      <h2 className="font-macro uppercase text-2xl tracking-tight mb-6">{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-ink-dim leading-relaxed">{children}</p>;
}

function B({ children }: { children: React.ReactNode }) {
  return <strong className="text-ink font-semibold">{children}</strong>;
}

function Sub({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[10px] uppercase tracking-widest text-ink pt-4">[ {children} ]</h3>;
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-good hover:underline break-all">
      {children}
    </a>
  );
}

function Steps({ items }: { items: [string, string][] }) {
  return (
    <ol className="hairline-grid grid grid-cols-1 border border-border">
      {items.map(([t, d], i) => (
        <li key={t} className="bg-bg p-5 grid grid-cols-[2.5rem_1fr]">
          <span className="font-data text-xs text-good">{String(i + 1).padStart(2, "0")}</span>
          <div>
            <div className="font-macro uppercase text-sm mb-1.5">{t}</div>
            <div className="text-xs text-ink-dim leading-relaxed">{d}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Li({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[1.5rem_1fr]">
      <span className="font-data text-xs text-good pt-0.5">{n}.</span>
      <span>{children}</span>
    </li>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[1.5rem_1fr]">
      <span className="text-good">+</span>
      <span>{children}</span>
    </li>
  );
}

function Row({ k, v }: { k: React.ReactNode; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-1 sm:gap-4 px-4 py-3">
      <dt className="text-ink uppercase tracking-wide text-[11px]">{k}</dt>
      <dd className="text-ink-dim">{v}</dd>
    </div>
  );
}

function Callout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-good/50 border-l-2 border-l-good p-5 mt-6">
      <div className="text-[10px] uppercase tracking-widest text-good mb-2">{title}</div>
      <div className="text-xs text-ink-dim leading-relaxed">{children}</div>
    </div>
  );
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border pb-4">
      <div className="text-sm text-ink mb-1.5">{q}</div>
      <div className="text-xs text-ink-dim leading-relaxed">{children}</div>
    </div>
  );
}
