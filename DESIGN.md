# Euthyna design system

> Keep this file in step with the code. When a real decision changes, update it here.

- **Archetype:** Tactical Telemetry / CRT Terminal (dark), from the `industrial-brutalist-ui` skill. Chosen over Swiss Industrial Print because the product is an audit log and telemetry feed, not a print document.
- **History:** the owner tried later directions: Wagmi's cyan/sand palette with an orbit hero, Yarn's palette, and a painted full-bleed hero with snow. They chose to come back to this system.
  - Kept from those rounds: **no `///` or `>>>` prefixes** in the navigation (an explicit request), a full-height sticky sidebar, and the wallet-driven top bar.
- **Mode:** dark only, single substrate. No light mode: this is an operator console.

## Tone

Terminal, not ornamental. The product's thesis, a continuous, replayable audit, is literally a telemetry feed, so the UI should look like one:
- monospace data, hairline grid dividers, and a single reserved accent for state;
- no gradients, no soft shadows, no rounded cards.

## Colors

| Role | Hex | Notes |
|---|---|---|
| `--bg` | `#0A0A0A` | page substrate, not pure black |
| `--surface` | `#121212` | panel/card substrate, one step up from bg |
| `--ink` | `#EAEAEA` | primary text ("white phosphor") |
| `--ink-dim` | `#8A8A86` | secondary/muted text, labels |
| `--border` | `#2A2A28` | hairline dividers, 1px solid, never dashed |
| `--accent` | `#E61919` | the only "alert" hue: escalations, misses, destructive actions |
| `--good` | `#4AF626` | terminal green, reserved for a live "hit" / confirmed status, the active nav bar, and primary CTAs. Never general body text. |

## Typography

| Role | Family | Size | Case |
|---|---|---|---|
| Macro (page/section headers) | Archivo Black | `clamp()`-scaled | UPPERCASE, tight tracking |
| Body / UI labels | JetBrains Mono | 12–14px | sentence case for prose, UPPERCASE for labels/metadata |
| Data (tx hashes, amounts, timestamps) | JetBrains Mono | 12–13px | as-is |

- Archivo Black ships one weight only, so never pair it with `font-semibold` or `font-bold`.
- No serif anywhere.

## Border radius

`0px` everywhere (`* { border-radius: 0 !important; }`). There is **one exemption**: the landing orbit, which is circular by nature. It uses `.orbit-round`; a class selector outranks the universal one at equal `!important`. Don't use `.orbit-round` anywhere else.

## Layout

- **Grid-first.** `display: grid; gap: 1px` on a border-coloured parent generates hairline dividers. Used for stat rows and the how-it-works grid.
- **Max content width:** `1280px`.
- **Sidebar nav:** the 7 console pages are peer destinations. Labels are UPPERCASE and the active item gets a green left border on the surface fill.
- **Spacing scale:** `4 / 8 / 16 / 24 / 32 / 48px`.

## Components

- **Stat tile:** an uppercase 10px `--ink-dim` label over a 24px JetBrains Mono value. No card chrome; hairline borders only.
- **Status pill:** `[ HIT ]` / `[ MISS ]` / `[ PENDING ]` in bracket-framed uppercase mono, coloured by `--good` / `--accent` / `--ink-dim`.
- **Messages:** bracketed too, e.g. `[ ERROR ]`, `[ SENT ]`, `[ DONE ]`, `[ ✓ VERIFIED ]`, `[ RPC UNAVAILABLE ]`.
- **Hash/address:** always truncated `0x1234…abcd`. Transactions and addresses link to Arcscan; a decisionHash is click-to-copy only, since it resolves to nothing on Arcscan.
- **Trust chart:** a step line (the limit only changes at a settlement), with hit markers in `--good` and miss markers in `--accent`, hover tooltips, and a table fallback.

## Landing page

- `/` is the public page; the console lives under `/console/*`.
- **Top bar:** `EUTHYNA`, `PROOF`, `HOW IT WORKS`, and a green-bordered `LAUNCH CONSOLE`.
- **Hero, in two columns.**
  - **Left:** the `[ AI TREASURY · ARC TESTNET ]` tag, a huge uppercase headline ("AN AI TREASURER ON PROBATION."), the copy, and two square CTAs.
  - **Right:** the **orbit**.
- **Orbit** (`components/orbit.tsx`), in the terminal palette:
  - **Motion:** two streams, from the top-right and the bottom-left, flow continuously into the Euthyna emblem. They curl clockwise, shrink and fade. The animation runs on `requestAnimationFrame` and stays still under `prefers-reduced-motion`.
  - **Background and texture:** soft phosphor-white bands with a faint green core, and CRT scanlines (`.orbit-scan`) over the whole orbit.
  - **Badges:** utility badges in phosphor white, graphite and grey, with the one green.
  - **Logos:** Arc, Circle and USDC are official marks from arc.io and circle.com (`public/logos/`), kept in their own brand colours. No third-party ecosystem logos (Visa, Mastercard and so on), because they'd imply partnerships Euthyna doesn't have.
  - **Emblem** (`components/mark.tsx`): flat. A balance scale in a hairline ring with one green status dot.
- **Sections:** `[ LIVE, REAL NUMBERS — NO TEST VAULTS ]` (real `/api/stats`); the one real settled hit, labeled as a test vault; a 3-column hairline how-it-works grid (Commit, Settle, Earn); the footer.

## Rules

- Every number comes from the real backend API or real on-chain reads. Never mock one.
- Re-check this file before adding a page or component type.
