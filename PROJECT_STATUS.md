# CODA Agentic Payments -- Project Status

> Last updated: 2026-03-18T21:30:00Z
> Phase: Phase B — Staging Environment + Azure Static Web Apps (Tasks 132a–132c)
> Server version: v7 Task-125 (lockup-route-dedup-iso20022-fix)
> History: see PROJECT_HISTORY.md for all previous TASK_COMPLETE blocks (Tasks 13-40, 41-132c)

---

## Session Context

### Restore note

The app was restored to its current state on 2026-02-20. A compact memo optimization (Task 31 follow-up: "CODA pacs.009 Settlement" format with truncated TxId, removed MsgId/E2EId, dropped milliseconds) was rolled back. The current Solana memo uses the v1 human-readable format with the full field set ("CODA Solstice | ISO 20022 pacs.009"). The planned NetworkOps redesign (procedural anomaly generation, seeded pseudo-random ring connections, warm sparklines, merged capacity gauge, clean metric strip, proper TypeScript interfaces) has NOT been implemented and still needs to be done from scratch.

### Current on-chain state

| Bank | DB Status | Token Symbol | Token Balance | SOL Remaining | ATA + MemoTransfer |
|------|-----------|--------------|---------------|---------------|---------------------|
| **JPM** | `active` | JPM-USDTD | $9,000,000 (post-payment) | ~4.98 SOL | New mints after soft reset |
| **CITI** | `active` | CITI-USDTD | $11,000,000 (post-payment) | ~4.98 SOL | New mints after soft reset |
| **FNBT** | `onboarding` or not yet seeded | FNBT-USDTD | -- | -- | Re-enabled in DEMO_BANKS, needs faucet funding |

First successful JPM->CITI $1M atomic burn-and-mint PvP settlement completed. Balances correct: JPM burned 1,000,000,000,000 raw tokens from JPM-USDTD mint, CITI minted 1,000,000,000,000 raw tokens to CITI-USDTD mint. Single Solana transaction signed by both bank keypairs.

SWIFT/BIC codes populated on both active banks (JPM -> CHASUS33, CITI -> CITIUS33) via backfill endpoint. On-chain memos now include real BIC codes in the From/To fields.

### Demo entities

| Entity | Type | Role | Token(s) | Wallet Source | Notes |
|--------|------|------|----------|---------------|-------|
| **JPMorgan Chase** (JPM) | Bank | Demo bank A | JPM-USDTD (deposit) | `banks` + `wallets` tables | BIC: CHASUS33 |
| **Citibank** (CITI) | Bank | Demo bank B | CITI-USDTD (deposit) | `banks` + `wallets` tables | BIC: CITIUS33 |
| **First National Bank of Tuvalu** (FNBT) | Bank | Demo bank C | FNBT-USDTD (deposit) | `banks` + `wallets` tables | BIC: FNBTTVTV |
| **BNY Mellon** (BNY) | Custodian | Universal lockup custodian. Holds LOCKUP-USTB escrow tokens during lockup. PermanentDelegate authority on lockup mint. | LOCKUP-USTB (shared lockup token) | KV store (`infra:custodian:BNY`, `infra:lockup_mint:LOCKUP-USTB`) | Not a bank. Diamond node in Visualizer. |
| **Rimark / Solstice Network Fees** | Network wallet | Yield collection — receives swept yield on lockup resolution. | None (accounting balance only) | `network_wallets` table + KV (`infra:network_wallet:SOLSTICE_FEES`) | Not a bank. Circle node in Visualizer. Balance in `network_wallets.balance`. |

### Agent fleet (6 agents)

| Agent | Color | Role | Executes on-chain? | Config params | Prompt module |
|-------|-------|------|-------------------|---------------|---------------|
| **Maestro** | — | Per-bank orchestrator agent. Receives compliance/risk signals, makes approve/reject/defer decision, triggers Canto for on-chain execution. | No (signals Canto) | `auto_accept_ceiling`, `escalation_*`, `escalation_velocity_count` | `maestro-prompts.ts` |
| **Concord** | — | Compliance agent. 6 deterministic checks + Gemini narrative. Per-bank jurisdiction/purpose code config. | No | `jurisdiction_whitelist`, `approved_purpose_codes` | `concord-prompts.ts` |
| **Fermata** | — | Risk scoring agent. 4-dimension weighted risk model + corridor history + velocity analysis. Sets finality tier (instant/24h/72h). | No | `risk_weight_*` (4), `risk_*_ceiling` (3) | `fermata-prompts.ts` |
| **Canto** | — | Settlement executor. Burns sender deposit, mints receiver deposit (direct PvP) or creates three-token lockup flow (medium/high risk). Pure execution — no AI reasoning. | **Yes** | None (inherits Maestro's decision) | None |
| **Aria** | Blue (`coda-brand`) | Natural language config assistant. Interprets user intent, proposes parameter changes, applies approved changes. Lives on `/agent-config` page. | No | Reads/writes all agent config params | `aria-prompts.ts` |
| **Cadenza** | Purple (`purple-400`) | Network police / dispute resolution. Monitors active lockups, detects anomalies (duplicates, velocity spikes, flagged counterparties), decides ALL_CLEAR / AUTO_REVERSE / ESCALATE. Never executes on-chain — signals Maestro → Canto for settlement/reversal. | No | `cadenza_monitoring_sensitivity`, `cadenza_auto_reverse_enabled`, `cadenza_escalation_threshold`, `cadenza_velocity_spike_multiplier`, `cadenza_duplicate_window_seconds`, `cadenza_max_lockup_hours` | `cadenza-prompts.ts` |

### Three-token lockup flow (v11 Task-118: True escrow model)

When Fermata scores a transaction as medium or high risk (score > 30) OR the sender specifies a lockup duration > 0, Canto executes a two-phase lockup with a shared `LOCKUP-USTB` escrow token:

**Phase 1 (Lockup Initiation) — On-chain TX #1:**
1. **Burn sender deposit** — Sender's `{CODE}-USDTD` tokens are burned. Memo: ISO 20022 pacs.009 format, `Phase: Phase 1 — Sender Burn`, `Op: BURN`.
2. **Mint LOCKUP-USTB to escrow** — Shared lockup tokens minted to BNY custodian's escrow wallet. PermanentDelegate extension. Memo: ISO 20022 pacs.009 format, `Phase: Phase 1 — Escrow Mint`, `Op: ESCROW_MINT`.
3. **Network Fee #1** — 0.001 SOL collected from sender. Phase 1 of 2.
4. **Lockup record** — `lockup_tokens` row inserted with `yb_token_mint=LOCKUP-USTB`, `tb_*=null`, status=`active`, yield_rate=525 bps.

**Lockup Hold Period:**
- Receiver has NO tokens. Funds sit in BNY escrow.
- Cadenza monitors: `ALL_CLEAR` / `AUTO_REVERSE` / `ESCALATE`.
- Yield accrues on escrow tokens at 5.25% APY.

**Phase 2 (Hard Finality) — On-chain TX #2:**
5. **Burn LOCKUP-USTB from escrow** — Lockup tokens burned from BNY custodian. Memo: ISO 20022 pacs.009 format, `Phase: Phase 2 — Escrow Burn`, `Op: ESCROW_BURN`.
6. **Mint receiver deposit** — `{RECEIVER_CODE}-USDTD` minted to receiver for the FIRST time. Memo: ISO 20022 pacs.009 format, `Phase: Phase 2 — Hard Finality Mint`, `Op: FINALITY_MINT`.
7. **Network Fee #2** — 0.001 SOL collected. Total: 0.002 SOL for lockup settlements.
8. **Yield sweep** — Accrued yield swept to Solstice network fees wallet.

**Reversal (alternative to Phase 2):**
- Burn LOCKUP-USTB from escrow (memo: `Phase: Reversal — Escrow Burn`, `Op: REVERSAL_ESCROW_BURN`), re-mint sender deposit (memo: `Phase: Reversal — Sender Re-Mint`, `Op: REVERSAL_REMINT`). Clean — receiver never had tokens.

**Key design decisions (Task 118):**
- Single shared `LOCKUP-USTB` mint (Option A) — not per-transaction mints.
- Mint stored in KV: `infra:lockup_mint:LOCKUP-USTB`. Created on first lockup settlement (lazy init).
- No TB token — eliminated. Receiver gets nothing until Phase 2.
- `network_fee_sol` updated to 0.002 (total) after Phase 2.
- Phase 2 signature stored in `settlement_confirm` agent_message content (`finality_signature`, `escrow_burn`).

Yield accrues per-second at `yield_rate_bps / 10000 / 365.25 / 86400` rate on the principal. Stored as BIGINT with 6 decimal places. Swept to Rimark/Solstice network fees wallet on resolution.

### Cadenza decision framework

Cadenza's Gemini-powered monitoring evaluates each lockup against:
- **Duplicate detection**: Same sender/receiver/amount within `cadenza_duplicate_window_seconds` (default 300s)
- **Velocity spikes**: Transaction count exceeds `cadenza_velocity_spike_multiplier` × 24h corridor average (default 3.0x)
- **Counterparty flags**: Sender or receiver bank has status != `active` (suspended/onboarding)
- **Anomaly detection**: Unusual patterns that don't match specific rules (amount deviation, timing, corridor history)
- **Sensitivity**: `cadenza_monitoring_sensitivity` (conservative/balanced/aggressive) adjusts confidence thresholds
- **Auto-reverse gate**: `cadenza_auto_reverse_enabled` controls whether high-confidence flags trigger automatic reversal or escalate to human review
- **Escalation threshold**: Confidence below `cadenza_escalation_threshold` (default 0.6) triggers escalation instead of auto-action
- **Max lockup duration**: Lockups exceeding `cadenza_max_lockup_hours` (default 72h) auto-escalate

Severity mapping: `auto_reverse` → immediate reversal (if auto-reverse enabled), `escalate` → human review on `/escalations` page, `info` → logged but no action.

### Architecture

- **Frontend:** React 18 + Vite + Tailwind v4, iOS 26 LiquidGlass design system (Clash Grotesk + JetBrains Mono). React Router v7 Data Mode. 14 routes (incl. `/login`, `/transactions/:txId`, `/treasury-ops`, `/agent-config`, `/proving-ground`, `/escalations`, `/settings`, `/network-command`), all eagerly imported (no React.lazy/Suspense). 19+ page components in `/src/app/components/`, 7 agent sub-components in `/src/app/components/agent/`, 7 proving-ground sub-components in `/src/app/components/proving-ground/`, 2 aria sub-components in `/src/app/components/aria/`, 1 dashboard layout, 1 theme provider, 1 animated background, 1 heartbeat context provider, 1 aria context provider, 1 layout context provider.
- **Backend:** Single Hono web server in `/supabase/functions/server/index.tsx` (Supabase Deno Edge Function). 30 routes (2 GET + 28 POST) + `SWIFT_BIC_REGISTRY` + `resolveBic()` + `getNetworkModeContext()` + `NETWORK_DEFAULTS` + `getBankConfig()` + treasury heartbeat helpers + `coreYieldAccrue()` + `coreCadenzaScanLockup()` + `coreCadenzaPeriodicScan()` + `collectNetworkFee()`. Proving Ground scenario engine in `proving-ground.tsx` with cleanup action + retry-on-429 + 1s inter-scenario delay. 6 prompt module files (`shared-context.ts`, `maestro-prompts.ts`, `concord-prompts.ts`, `fermata-prompts.ts`, `aria-prompts.ts`, `cadenza-prompts.ts`) — all flat in `/supabase/functions/server/` (Supabase Edge Functions don't support subdirectories). Aria NL config agent in `aria.tsx`. Yield accrual engine in `yield-engine.tsx`.
- **Database:** 14 real Supabase Postgres tables (`banks`, `wallets`, `transactions`, `agent_messages`, `compliance_logs`, `risk_scores`, `agent_conversations`, `treasury_mandates`, `heartbeat_cycles`, `network_snapshots`, `bank_agent_config`, `lockup_tokens`, `cadenza_flags`, `network_wallets`). `transactions` has `lockup_status` column (nullable, values: NULL | `yb_minted` | `soft_settled` | `cadenza_monitoring` | `cadenza_flagged` | `cadenza_escalated` | `cadenza_cleared` | `hard_finality` | `reversed`) + `network_fee_sol` NUMERIC nullable + `settlement_method` TEXT nullable + `settlement_memo` TEXT nullable (Task 115). Realtime enabled on `lockup_tokens` and `network_wallets`.
  - **`lockup_tokens` schema:** `id` UUID PK, `transaction_id` UUID FK→transactions, `sender_bank_id` UUID FK→banks, `receiver_bank_id` UUID FK→banks, `yb_token_mint` TEXT, `yb_token_symbol` TEXT (e.g. `JPM-USDYB`), `yb_token_amount` BIGINT (6 decimals), `yb_holder` TEXT (BNY custodian wallet), `tb_token_mint` TEXT, `tb_token_symbol` TEXT (`BNY-USTB`), `tb_token_amount` BIGINT, `tb_holder` TEXT (receiver wallet), `yield_rate_bps` INT DEFAULT 525, `yield_accrued` BIGINT DEFAULT 0, `yield_last_calculated` TIMESTAMPTZ, `lockup_start` TIMESTAMPTZ, `lockup_end` TIMESTAMPTZ (NULL=infinite/escalated), `status` TEXT DEFAULT `active` (active|settled|reversed|escalated), `resolution` TEXT (cadenza_all_clear|cadenza_auto_reverse|cadenza_escalation|human_approved|human_reversed|user_requested_reversal), `resolved_at` TIMESTAMPTZ, `resolved_by` TEXT (cadenza|operator:{name}|system), `yield_swept_to` TEXT (Solstice fees wallet), `created_at` TIMESTAMPTZ DEFAULT now().
  - **`cadenza_flags` schema:** `id` UUID PK, `transaction_id` UUID FK→transactions, `lockup_token_id` UUID FK→lockup_tokens, `flag_type` TEXT (duplicate|velocity_spike|counterparty_flagged|anomaly_detected|user_reversal_request|human_resolution), `severity` TEXT (auto_reverse|escalate|info), `reasoning` TEXT (Gemini-generated), `detected_at` TIMESTAMPTZ DEFAULT now(), `action_taken` TEXT (reversed|escalated|dismissed), `action_at` TIMESTAMPTZ.
  - **`network_wallets` schema:** `id` UUID PK, `name` TEXT, `code` TEXT, `wallet_address` TEXT, `keypair_encrypted` TEXT, `purpose` TEXT, `balance` NUMERIC, `created_at` TIMESTAMPTZ.
- **LLM:** Gemini 2.5 Flash
- **Blockchain:** Solana Devnet via `solana-real.tsx`. Token-2022 mints (standard + PermanentDelegate extension for lockup tokens), ATAs with MemoTransfer (reallocate before enable). **No programmatic airdrop** -- manual faucet funding required (0.05 SOL minimum). Human-readable multi-line ISO 20022 pacs.009 memo format (~400 bytes, 566-byte limit) used for ALL on-chain operations: direct PvP swaps (via `executeTransfer`), lockup Phase 1/Phase 2 burns and mints (via `buildISO20022LockupMemo`), and reversals. Lockup memos include `Phase:` and `Op:` fields to distinguish operations within the same pacs.009 format. `solana-real.tsx` exports: `generateWallet` (pure keypair, no network), `activateBank` (SOL balance gate + Token-2022 deploy), `executeTransfer`, `getTokenBalance`, `getSolBalance`, `checkBalance`, `tokenSymbol`, `TOKEN_DECIMALS`, `burnDepositToken` (standalone sender burn with memo), `mintDepositToken` (standalone receiver mint with memo), `createYieldBearingToken` (PermanentDelegate YB mint), `createTBillToken` (PermanentDelegate TB mint), `burnLockupTokens` (atomic dual burn via delegate authority), `ybTokenSymbol`, `TB_TOKEN_SYMBOL`.
- **Orchestration:** Sequential chain (Compliance -> Risk Score -> Agent Think -> Agent Execute). 2s debounce + `processingRef` guard on frontend. `processPendingMessages()` on terminal load handles missed receiver-side messages. Orphan detection at 2-minute threshold with retry/expire server routes. Treasury heartbeat: recurring cycles with synthetic market events -> mandate evaluation -> autonomous settlement via existing pipeline. `HeartbeatContext` wraps above the router in `App.tsx` so timer state persists across navigation. `HeartbeatIndicator` floating pill visible on all pages except Treasury Ops when heartbeat is running.
- **Pipeline:** 9-step tracker (standard) or 12-step tracker (lockup). Standard: Agent Reasoning -> Tx Created -> Request Sent -> Awaiting Receiver -> Compliance Check -> Risk Assessment -> Agent Decision -> On-chain Settlement -> Confirmed. Lockup (when `lockup_status` non-null): replaces last 2 steps with 5 lockup steps: Yield-Bearing Mint -> Soft Settlement -> Cadenza Monitoring (live countdown) -> Resolution -> Hard Finality. "Awaiting Receiver" step with escalating hints distinguishes "waiting for receiver agent" from "compliance in progress". Compliance shows 5 sub-checks inline. Lockup color coding: amber=active lockup, blue=Cadenza monitoring, red=flagged/reversed, purple=escalated (∞), green=settled.
- **Theming:** 3-mode theme system (light/dark/auto) via `ThemeProvider` context. 16+ CODA-specific CSS custom properties (`--coda-bg`, `--coda-surface`, `--coda-border`, `--coda-text`, `--coda-brand`, etc.) mapped through Tailwind v4 `@theme inline`. Font: Clash Grotesk (sans) + JetBrains Mono (mono) from Fontshare/Google Fonts. Keyboard shortcut: `Cmd+Shift+L` cycles auto->light->dark->auto. FOUC prevention via synchronous class application before React mount.
- **Layout:** iOS 26 LiquidGlass shell via `DashboardLayout` -- glassmorphic sidebar nav with icon tooltips, CODA logo asset, animated background orbs (dual-layer light/dark crossfade), theme toggle, back button, time range selector. `Layout.tsx` is a thin wrapper (`DashboardLayout` + `Outlet`).

### Key conventions

- Token symbol format: `{CODE}-{CCY}TD` (e.g. JPM-USDTD)
- Agent naming: "Maestro" / `solstice_ai_maestro_{bank_uuid}`
- Setup page: "Onboard Demo Banks" with destructive "Reset Network" button
- `setup-bank` route: two stages (`"wallet"` = DB-only keypair generation, `"activate"` = SOL balance check + Token-2022 deploy). Activate returns structured 400 with `error: "insufficient_sol"` if balance < 0.05 SOL.
- DB constraints: `banks_status_check` (allows `active`, `suspended`, `onboarding`), `banks_tier_check` (does not allow `tier1` -- omit `tier` from inserts), `transactions_settlement_type_check` — `settlement_type` is now explicitly set by `/agent-execute`: `'PvP'` for direct burn-and-mint, `'lockup'` for three-token flow
- `onboarding` is kept in the DB while the frontend uses `awaiting_funding` as a semantic card status
- Supabase retry: 5 attempts, exponential backoff 500ms-8s (`supabaseClient.ts`)
- Realtime debounce: 2.5s in `BanksContext.tsx`
- `seedCardsRef` (useRef) used alongside React state to avoid React 18 automatic batching issues in `SetupPage.tsx`
- All 3 demo banks (JPM, CITI, FNBT) included in `DEMO_BANKS` array -- no `SEED_BANKS` alias
- Clipboard: `document.execCommand('copy')` fallback for sandboxed iframe environments
- Orchestrator guard in `AgentTerminal.tsx`: skips triggers when bank status != `active`
- Orphan threshold: 2 minutes (`ORPHAN_THRESHOLD_MS` in `types.ts`). Expired transactions use `status: 'rejected'` with `risk_reasoning` prefixed `"Expired: "` to distinguish from genuine rejections.
- Pipeline steps: 9 total (8 original + "Awaiting Receiver" inserted between "Request Sent" and "Compliance Check")
- **Theme tokens**: Use `bg-coda-bg`, `bg-coda-surface`, `border-coda-border`, `text-coda-text`, `text-coda-text-secondary`, `text-coda-text-muted`, `text-coda-text-faint`, `bg-coda-brand`, etc. -- NOT hardcoded hex colors like `bg-[#0a0a0f]`
- **Theme toggle**: Header button cycles auto->light->dark; `Cmd+Shift+L` keyboard shortcut; persists to `localStorage` key `coda-theme-preference`
- **SWIFT/BIC**: `SWIFT_BIC_REGISTRY` (11 institutions) in `index.tsx`, `resolveBic()` resolves bank->BIC for on-chain memos, `swift_bic` stored in `banks` table, auto-backfill on SetupPage load
- **Treasury heartbeat**: Dynamic Gemini-driven mandate generation via `generateMandatesViaGemini(bank, allBanks)` (replaces static `MANDATE_CONFIGS`), `generateMarketEvent()` (5 weighted generic event types + 6 bank-specific templates at 30% chance), `buildTreasuryCyclePrompt()` (fully dynamic counterparty selection -- per-bank balance, deployed%, SOL, recent interaction summary; NETWORK ACTIVITY EXPECTATIONS scaled to `totalActiveBanks`), `captureNetworkSnapshot()`. Agent-think route + `coreAgentThink` both support `context_type='treasury_cycle'` with autonomous system prompt appendix referencing ACTIVE COUNTERPARTIES list and NO_ACTION early return. 20% safety floor enforced server-side.
- **BanksContext**: All client-side `supabase.from('banks')` calls consolidated to just `BanksContext` (all banks) and `AgentTerminal` (single bank by ID). `BanksContext` at Layout level provides banks/wallets globally with Realtime subscriptions (debounce 2500ms), sessionStorage persistence, and a `cacheVersion` counter.
- **useSWRCache**: Generic SWR-style hook for Dashboard/Transactions/Visualizer data caching.
- **Import convention**: Use `react-router` (NOT `react-router-dom`). All routes eagerly imported, no React.lazy/Suspense.
- **Devnet Mode**: Network mode toggle on SetupPage (defaults to `devnet`). Stored in KV store as `network_mode`. When `devnet`, `DEVNET_CONTEXT` preamble is injected into ALL Gemini prompts (risk scoring, agent-think, agent-chat, mandate generation) telling AI to NOT flag Devnet as a risk. When `production`, no context injected -- Gemini assesses freely. `getNetworkModeContext()` helper in index.tsx.
- **Concord hybrid compliance**: After 6 deterministic checks, a Gemini call generates a `concord_narrative` (2-4 sentence regulatory explanation). Included in `compliance_response` agent_message content. Deterministic checks remain source of truth; narrative is cosmetic.
- **Fermata corridor history**: Risk scoring prompt enriched with corridor history (last 10 bidirectional txns), sender velocity (last 10 txns + 60min stats), and behavioral analysis guidance. `risk_alert` agent_message includes `corridor_depth`, `sender_velocity_60min`, `sender_volume_60min`.
- **Agent Config**: Per-bank parameter overrides stored in `bank_agent_config` table with NULL = network default. `NETWORK_DEFAULTS` constant + `getBankConfig(bankId)` helper in index.tsx. Wired into: compliance checks (jurisdiction whitelist, purpose codes), risk scoring (dimension weights, finality thresholds), treasury cycles (safety floor, heartbeat participation). `bank_agent_config` deleted on network reset but preserved on token reset. `/agent-config` route in sidebar between Treasury Ops and Transactions.
- **Cadenza lockup tokens**: Yield-bearing token symbol: `{SENDER_CODE}-USDYB` (e.g. `JPM-USDYB`). T-bill token symbol: `BNY-USTB` (universal, one per custodian). Both use Token-2022 PermanentDelegate extension. Yield: BIGINT with 6 decimal places, 5.25% annualized default (525 bps), per-second granularity via `calculateAccruedYield()` in `yield-engine.tsx`.
- **Cadenza agent**: Network police — monitors lockups, never executes on-chain. Signals Maestro → Canto for settlement/reversal. Purple color identity (`text-purple-400`, `bg-purple-500/10`). 6 per-bank config params in `bank_agent_config`. Periodic scan wired into treasury heartbeat via `coreCadenzaPeriodicScan(heartbeatMode)`. User-initiated reversals bypass Gemini.
- **BNY custodian**: Universal lockup custodian. Not a bank (no `banks` table row). Stored in KV (`infra:custodian:BNY`). PermanentDelegate authority on all YB/TB mints — can burn without holder signature. Diamond node in Visualizer. Created idempotently via `/setup-custodian`.
- **Rimark / Solstice fees**: Yield collection + network fee wallet. Not a bank. Stored in `network_wallets` table + KV dual-write. Receives swept yield on lockup resolution (accounting entry, no SPL mint) + 0.001 SOL per settlement via `SystemProgram.transfer` (on-chain). Circle node in Visualizer.
- **Network Fee Protocol**: 0.001 SOL per settlement. Sender bank pays via `sendNetworkFee()` → Solstice Network Fees wallet. `collectNetworkFee()` helper: sends SOL, updates `network_wallets.balance`, writes `network_fee_sol`/`settlement_method`/`settlement_memo` to `transactions` row. **Mandatory — fee failure blocks settlement.** No agent or user can bypass paying network fees. Pre-flight SOL balance check in `sendNetworkFee()` requires ≥0.002 SOL (0.001 fee + ~0.001 tx gas) — fails fast with actionable error + faucet link instead of cryptic Solana transaction failure. Three settlement methods: `pvp_burn_mint`, `lockup_hard_finality`, `lockup_reversal` / `lockup_user_reversal`. Network Fee Protocol card displayed on Network Setup page (not Agent Config).
- **Pipeline steps**: 9 total (standard, low-risk) or 12 total (lockup, medium/high-risk). Lockup pipeline replaces last 2 standard steps with 5 lockup steps: Yield-Bearing Mint → Soft Settlement → Cadenza Monitoring (live countdown) → Resolution → Hard Finality. Color coding: amber=active lockup, blue=monitoring, red=flagged/reversed, purple=escalated (∞), green=settled.
- **Proving Ground**: 18 adversarial scenarios across 4 categories: 5 compliance, 4 risk, 3 operational, 6 dispute (Cadenza D1–D6). Compare-banks mode with CadenzaConfigComparison (dispute only) + ConfigDelta (all categories). Dispute category uses purple theming. All D1–D6 test transactions include `lockupStatus: 'soft_settled'` for Gemini context. Test txns with non-PG_TEST memos (C2, C5, R3, R4, O3) have `riskReasoning: 'PG_TEST_*_MARKER'` for cleanup. Global cleanup finds orphans via 3 paths: `memo LIKE 'PG_TEST%'`, `risk_reasoning LIKE 'PG_TEST_%'`, `yb_holder LIKE 'pg_%'`. D-scenario AUTO_REVERSE tests (D1/D2/D3/D5) fail at Solana execution (fake mints) but scoring only checks Gemini's decision, not execution success. **Dependency injection**: All scenario runners use direct in-process function calls via `setCadenzaDirectHandlers` (D1–D6) and `setAgentDirectHandlers` (C1–C5, R1–R4, S1, O1–O3) — eliminates HTTP self-call 401 errors. Helper functions `callComplianceCheck`, `callRiskScore`, `callAgentThink` use injected handlers with HTTP fallback. Frontend `callServer` uses `maxRetries=5` for all `/proving-ground` calls (31s exponential backoff window for cold-start resilience).
- **Aria NL Assistant**: Natural language config assistant on `/agent-config`. Blue accent color identity (coda-brand). `AriaContext` in `/src/app/contexts/AriaContext.tsx` manages conversation state, Gemini calls, proposal parsing, and config application. `LayoutContext` in `/src/app/contexts/LayoutContext.tsx` exposes sidebar geometry. `GlobalInputBar` component in `/src/app/components/aria/` morphs between collapsed bottom bar and expanded right-side panel via Motion `layoutId` + `LayoutGroup`. Content push via `paddingRight` transition (not overlay). Proposal approve/reject workflow parses `PROPOSED_CHANGES` JSON from Gemini responses. `ConfigChangeToast` renders via React Portal (`createPortal` to `document.body`) to escape parent stacking contexts — frosted-glass (`backdrop-blur-2xl`, `bg-white/[0.12]`) toast with spring animations for config change confirmations. `renderMarkdown` in GlobalInputBar has smart value formatting (JSON arrays as blue pill tags, `$10.0M` notation, boolean `✓ On`/`✗ Off`, tabular numbers, KV rows with blue key labels, stripped JSON wrapper lines). Collapsed bar shows single-line acknowledgment via `extractAcknowledgment()` (skips KV lines, headers, bullets, JSON braces, short labels). All sidebar chat text normalized to `text-xs`.
- **Sender-Specified Lockup Duration**: Every transaction carries `lockup_duration_minutes` (default 30, from sender's `bank_agent_config`). Settlement bifurcation uses `max(requested, risk_derived)` — sender's lockup is a floor, risk engine can extend but never shorten. 0 = immediate PvP for low risk. Risk mapping: ≤instant_ceiling → 0min, ≤24h_ceiling → 1440min, ≤72h_ceiling → 4320min, >72h_ceiling → indefinite. Validation: must be 0 or ≥5 (server-side). Configurable via AgentConfig Maestro card + Aria NL. Frontend shows "Requested vs Effective" on TransactionDetail + TransactionMonitor lockup sections.

### File tree (key files)

```
/src/app/
  App.tsx                     RouterProvider entry point + ThemeProvider wrapper
  routes.tsx                  createBrowserRouter, 14 eagerly-imported routes incl. /login, /transactions/:txId, /treasury-ops, /agent-config, /proving-ground, /escalations, /settings, /network-command (full-bleed, outside DashboardLayout)
  types.ts                    7 table interfaces + API types + helpers + orphan detection + swift_bic fields + BankAgentConfig (incl. 6 Cadenza params) + NetworkDefaults + NetworkCommandState + NetworkSimulationParams
  supabaseClient.ts           Singleton client + callServer + serial queue (200ms gaps)
  /contexts/
    BanksContext.tsx           Global banks/wallets provider, Realtime, sessionStorage, cacheVersion
    AriaContext.tsx            Aria NL assistant state: conversation history, Gemini calls, proposal parsing, config apply + SWR invalidation
    LayoutContext.tsx          Exposes sidebar geometry (sidebarWidth) from DashboardLayout
    PersonaContext.tsx         React context + provider. `PersonaType`. localStorage persistence (`coda-persona-preference`).
  /hooks/
    useSWRCache.ts             Generic SWR-style data caching hook
    useNetworkSimulation.ts    Network Command simulation engine — TPS ramp, arc generation, counter increments, heartbeat integration, Realtime on cadenza_flags/transactions/heartbeat_cycles
  /components/
    Layout.tsx                Thin wrapper: DashboardLayout + Outlet
    ThemeProvider.tsx          Theme context (light/dark/auto), localStorage, Cmd+Shift+L
    AnimatedBackground.tsx    iOS 26 dual-layer ambient orb system (light/dark crossfade)
    PageHeader.tsx            Reusable page header with icon + title + subtitle + action slot
    Dashboard.tsx             Home page with stats + orphan alert banner + quick actions
    SetupPage.tsx             Three-stage onboarding (wallet gen, manual faucet funding, per-bank activate), seed cards with live SOL balance polling, SWIFT/BIC column + auto-backfill
    HeartbeatControl.tsx      Autonomous settlement control panel -- start/stop/single-cycle, speed selector, mandate seeding, expandable cycle log with lazy-loaded detail (market event, per-bank conditions, txns, agent decisions), Realtime
    HeartbeatContext.tsx       React context provider for persistent heartbeat timer state across navigation
    HeartbeatIndicator.tsx     Floating LiquidGlass pill -- shows cycle count when heartbeat running, clickable nav to /treasury-ops
    LiquidityGauges.tsx       SVG arc gauge component for per-bank liquidity visualization in expanded cycle rows
    PipelineWaterfall.tsx     Standalone 2-column pipeline checklist (emerald/gray palette) -- renders per-transaction in Pipeline Progress section of expanded cycle rows
    LivePipelineProgress.tsx  Page-level real-time pipeline tracker -- 2s polling, per-tx waterfall cards, slide-in/fade-out lifecycle, renders between metrics and cycle log
    AgentReasoningPanel.tsx   Agent Dialogue Theater -- two-part reasoning visualization (PipelineStrip + expanding reasoning card), dual Realtime subscriptions, typewriter text, staggered animations, Concord narrative display, Fermata corridor context
    PipelineStrip.tsx         Compact 5-node pipeline strip with data packet pill animations, used by AgentReasoningPanel
    AgentConfig.tsx           Per-bank agent configuration page
    ProvingGround.tsx         Adversarial testing war room -- scenario catalog, run/run-all, live progress feed, scorecard + summary views, compare-banks mode with dual results + config delta
    NetworkActivityFeed.tsx    Agentic multi-agent reasoning log -- 5 agent personas, timeline spine, timestamps, Realtime on agent_messages + transactions
    AgentTerminal.tsx         Transaction Lifecycle view, orchestrator guard, processPendingMessages, conversational AI
    TransactionMonitor.tsx    Tx table + orphan flagging + retry/expire actions + risk/compliance detail + Cadenza lockup badges, pending balance, request reversal with confirmation, lockup detail card, lockup_tokens Realtime
    TransactionDetail.tsx     Drill-down transaction view (/transactions/:txId) -- metadata, agent messages, on-chain links
    EscalationDashboard.tsx   Cadenza escalation review page (/escalations) -- escalation cards, live yield/duration counters, AI briefing panel, approve/reverse with confirmation, Realtime auto-refresh, Motion AnimatePresence list transitions (popLayout, staggered enter, slide-left+blur exit, layout reflow), processing overlay with color-coded spinner + ProcessingStepLabel step cycling + pulsing Solana status badge, resolvingDecision state
    Visualizer.tsx            SVG network graph + BNY custodian diamond node (center) + Rimark/Solstice fees node (bottom-right) + lockup flow animation (amber USDYB sender→BNY, purple USTB BNY→receiver) + settled/reversed lockup paths + yield sweep line + orphan amber lines + lockup badges in tx log
    NetworkCommand.tsx        Full-screen war room visualization (/network-command) — floating glassmorphic header (UTC clock, network mode badge, Start/Stop/Reset), floating metrics badges (TPS, Confirmed, Settled, Lockups, Yield, Fees, Cadenza), event ticker (scrolling settlements), heartbeat cycle banner. Full-bleed (no DashboardLayout).
    /network-command/
      GlobeCanvas.tsx         Mapbox GL JS globe with native GeoJSON particle animation — 4-layer orb system (outer glow, mid glow, core, hot center), dual color palette (standard + bright), corridor glow lines, bank node white center dots, pulsing glow halos. 7 bank nodes at real-world coords, 12 corridor bezier arcs, rAF particle loop. Globe projection handles 3D occlusion natively.
    /dashboard/
      dashboard-layout.tsx    iOS 26 LiquidGlass sidebar nav shell -- glassmorphic, icon tooltips, CODA logo, theme toggle
    /agent/
      ActionGuide.tsx         Welcome screen + quick actions
      RichMessage.tsx         Rich formatted message rendering (ChatMessage type)
      TransactionLifecycle.tsx StepRow, TransactionRow, LiveTransactionCard, buildVisualSteps
      AgentActivityFeed.tsx   Real-time agent communications feed (inside LiveTransactionCard)
      CommsFeed.tsx           Unified inter-agent comms feed (chat + pipeline + agent messages, color-coded agents)
      PipelineTracker.tsx     9/12-step pipeline visualization — standard (9 steps) for low-risk, lockup (12 steps: 7 base + 5 lockup) for medium/high-risk. LockupCountdown timer, color-coded lockup states (amber/blue/red/purple/green), Cadenza monitoring expanded view. MiniPipeline lockup-aware.
      TransactionSidebar.tsx  Compact sidebar for active/completed transactions with step progress
    /proving-ground/
      ScenarioCard.tsx        Individual scenario card with severity badge, agent pills, run button, result overlay, dual-badge compare mode
      ScenarioScorecard.tsx   Detailed result view -- per-agent breakdown, reasoning excerpts, expected vs actual, pipeline trace
      ProvingGroundSummary.tsx Aggregate report card -- resilience ring, category bars, agent performance grid, findings list
      ComparisonScorecard.tsx  Side-by-side single-scenario comparison with divergence highlights, CadenzaConfigComparison (dispute only), and config delta
      ComparisonSummary.tsx    Dual resilience rings, comparative agent grid, divergence report, key insight callout
      ConfigDelta.tsx          Fetches and diffs two bank agent configs (incl. 6 Cadenza params), compact table with default indicators, filterAgents prop
      CadenzaConfigComparison.tsx  Cadenza-specific full config comparison — all 6 params side-by-side with scenario-aware impact annotations, divergence summary
    /aria/
      GlobalInputBar.tsx      Dual-mode Aria input — collapsed bottom bar with inline response + expanded right panel with conversation history. Motion layoutId morph, LayoutGroup, blue accent, auto-dismiss, workflow actions, suggestion chips. renderMarkdown smart formatting, extractAcknowledgment collapsed text.
      ConfigChangeToast.tsx   Frosted-glass toast via React Portal (createPortal to document.body) — backdrop-blur-2xl, spring animations, auto-dismiss progress bar. Renders above all content by escaping parent stacking contexts.
    /icons/
      ArrowLeftIcon.tsx       Back arrow icon component
      coda-icon.svg           CODA brand mark
      sidebar-close-animation.ts / sidebar-expand-animation.ts
    /figma/
      ImageWithFallback.tsx   PROTECTED -- fallback image component

/src/styles/
  fonts.css                   Clash Grotesk (Fontshare) + JetBrains Mono (Google Fonts)
  theme.css                   CODA tokens (:root light + .dark), @theme inline mappings, scrollbar theming, keyframes (shimmer, bpulse, orbs, heartbeat-pulse, heartbeat-ring)
  index.css                   Import order: fonts -> tailwind -> theme
  tailwind.css                Tailwind v4 base

/supabase/functions/server/
  index.tsx                   Hono server, 30 routes (2 GET + 28 POST), NETWORK_DEFAULTS + getBankConfig() + SWIFT_BIC_REGISTRY + resolveBic() + getNetworkModeContext() + treasury heartbeat helpers + `coreYieldAccrue()` + `coreCadenzaScanLockup()` + `coreCadenzaPeriodicScan()` + `coreComplianceCheck()` + `coreRiskScore()` + `coreLockupSettle()` + `coreLockupReverse()` (extracted core functions for DI) + `setAgentDirectHandlers()` injection into proving-ground.tsx + `collectNetworkFee()` helper (SOL gas-layer fee + DB update)
  shared-context.ts           Shared prompt constants: TREASURY_CYCLE_APPENDIX, AGENT_THINK_RESPONSE_FORMAT[_COMPACT], CONCORD/FERMATA/MANDATE/CADENZA system prompts + CADENZA_NETWORK_RULES + CADENZA_RESPONSE_FORMAT + CADENZA_BATCH_RESPONSE_FORMAT
  maestro-prompts.ts          Maestro agent prompt builders: buildAgentSystemPrompt, buildAgentChatPrompt, buildTreasuryCyclePrompt, buildMandateGenerationPrompt, buildMaestroPersonalityUserPrompt
  concord-prompts.ts          Concord agent prompt builders: buildConcordNarrativePrompt, concordNarrativeFallback
  fermata-prompts.ts          Fermata agent prompt builders: buildRiskScoringPrompt
  aria-prompts.ts             Aria agent prompt builders: buildAriaSystemPrompt, PARAMETER_CATALOG, VALID_JURISDICTIONS, VALID_PURPOSE_CODES
  cadenza-prompts.ts          Cadenza agent prompt builders: buildCadenzaMonitoringPrompt (per-lockup), buildCadenzaEscalationPrompt (human briefing), buildCadenzaPeriodicScanPrompt (batch scan). 12 interfaces.
  aria.tsx                    Aria NL config assistant handler: handleAria, validateAriaProposal, handleInterpret/handleApply/handleReject
  supabase-admin.tsx          Admin client singleton
  gemini.tsx                  Gemini 2.5 Flash wrapper (model: gemini-2.5-flash)
  solana-real.tsx             Real Devnet: generateWallet, activateBank (SOL gate + Token-2022), executeTransfer (human-readable memo), getTokenBalance, getSolBalance, checkBalance, burnDepositToken, mintDepositToken, createYieldBearingToken (PermanentDelegate YB mint), createTBillToken (PermanentDelegate TB mint), burnLockupTokens (delegate burn), sendNetworkFee (SOL gas-layer fee transfer + pre-flight balance check ≥0.002 SOL), NETWORK_FEE_SOL (0.001). NO airdrop functions.
  kv_store.tsx                PROTECTED -- used for network_mode, infra:custodian:BNY (KV-only), infra:network_wallet:SOLSTICE_FEES (KV + network_wallets table dual-write)
  proving-ground.tsx          Adversarial scenario engine -- 18 scenarios (5 compliance, 4 risk, 3 operational, 6 dispute/Cadenza), structured pass/fail results per agent. All inter-agent calls use dependency-injected direct handlers (setCadenzaDirectHandlers + setAgentDirectHandlers) with HTTP fallback — no internalPost HTTP self-calls in scenario runners.
  yield-engine.tsx            Yield accrual engine -- calculates and updates yield_accrued for lockup_tokens
```

### Server routes (index.tsx)

| # | Route | Method | Description |
|---|-------|--------|-------------|
| 1 | `/health` | GET | Health check |
| 1b | `/network-fee-info` | GET | Network fee config + Solstice fees wallet info (lightweight, KV-only) |
| 2 | `/backfill-swift` | POST | One-shot SWIFT/BIC backfill on existing bank rows using registry |
| 3 | `/setup-bank` | POST | Two-stage bank onboarding (wallet / activate / legacy), includes swift_bic. Activate returns 400 with `insufficient_sol` if balance < 0.05 SOL. |
| 4 | `/check-sol-balance` | POST | Query Solana Devnet for wallet SOL balance (used by frontend polling) |
| 5 | `/agent-think` | POST | LLM reasoning for bank agent (supports `context_type: 'treasury_cycle'`) |
| 6 | `/agent-chat` | POST | Conversational AI queries (balance, status, network info) via Gemini |
| 7 | `/compliance-check` | POST | Run compliance checks + Concord narrative generation via Gemini |
| 8 | `/risk-score` | POST | AI-powered risk scoring via Gemini with corridor history + sender velocity |
| 9 | `/agent-execute` | POST | Execute on-chain settlement. Bifurcation: `effectiveLockup = max(requested, risk_derived)`. If 0 → direct PvP burn-and-mint; if >0 → three-token lockup flow (burn sender deposit, mint USDYB to BNY, mint USTB to receiver, insert lockup_tokens, set lockup_status=soft_settled). `collectNetworkFee()` called in both branches. |
| 10 | `/agent-orchestrator` | POST | Multi-agent autonomous flow |
| 11 | `/seed-mandates` | POST | Seed treasury mandates for all active banks (idempotent) |
| 12 | `/treasury-cycle` | POST | Core heartbeat engine -- market event -> mandate evaluation -> autonomous settlement |
| 13 | `/network-heartbeat` | POST | Convenience wrapper: `status`, `next_cycle`, `reset_cycles` actions |
| 14 | `/network-metrics` | POST | Dashboard aggregation: TPS, volume, corridors, fleet, anomalies |
| 15 | `/retry-transaction` | POST | Retry orchestration for orphaned transaction |
| 16 | `/expire-transaction` | POST | Mark orphaned transaction as rejected |
| 17 | `/reset-tokens` | POST | Soft reset: clear txns/messages/mandates/cycles/snapshots + cadenza_flags/lockup_tokens + reset lockup_status, preserve keypairs + SOL + network_wallets |
| 18 | `/reset-network` | POST | Nuclear reset: delete all data from all 14 tables (incl. cadenza_flags, lockup_tokens, network_wallets) + reset lockup_status |
| 19 | `/network-mode` | POST | Get/set network mode (devnet/production) for AI context injection |
| 20 | `/agent-config` | POST | Get/update per-bank agent configuration (5 actions: get, get_defaults, update, update_personality, toggle_mandate, regenerate_mandates) |
| 21 | `/proving-ground` | POST | Adversarial scenario engine -- 3 actions: list_scenarios, run_scenario, run_all. 18 scenarios across compliance/risk/operational/dispute categories. |
| 22 | `/setup-custodian` | POST | Idempotent BNY custodian + Solstice fees wallet creation. BNY linked from banks table (KV-only). Solstice dual-writes to KV + `network_wallets` Postgres table. Returns wallet addresses + SOL balances. |
| 23 | `/custodian-status` | POST | BNY custodian from KV (with auto-re-link for stale records). Solstice fees wallet from `network_wallets` table (primary) with KV auto-migration fallback. Live SOL balances. |
| 24 | `/yield-accrue` | POST | Batch yield accrual for all active/escalated lockups. Also called as trailing step in `/treasury-cycle`. Returns per-lockup yield deltas. |
| 25 | `/yield-sweep` | POST | Transfer accrued yield to Solstice fees wallet on lockup resolution. Accounting entry only (no SPL mint). Updates `network_wallets.balance` + `lockup_tokens.yield_swept_to`. |
| 26 | `/lockup-settle` | POST | Phase 2 hard finality for lockup. On-chain: burns LOCKUP-USTB from BNY escrow (`burnLockupFromEscrow`), mints receiver deposit token (`mintDepositToken`), collects Phase 2 network fee (0.001 SOL). DB: `lockup_tokens.status=settled`, `transactions.lockup_status=hard_finality`, `transactions.status=settled`, `finality_tx_signature`, `finality_solana_slot`, `finality_block_time`, `network_fee_sol=0.002`, `settlement_method=lockup_hard_finality`. Status guard: active or escalated only. |
| 27 | `/lockup-reverse` | POST | Reversal path for lockup. On-chain: burns LOCKUP-USTB from BNY escrow, re-mints sender deposit token (clean clawback — receiver never had tokens). DB: `lockup_tokens.status=reversed`, `transactions.status=reversed`, `finality_tx_signature`, `finality_solana_slot`, `finality_block_time`. Status guard: active or escalated only. |
| 28 | `/cadenza-monitor` | POST | Cadenza dispute resolution agent. 3 actions: `scan_lockup` (single lockup → Gemini monitoring decision → ALL_CLEAR/AUTO_REVERSE/ESCALATE), `periodic_scan` (batch all active lockups), `user_reversal` (operator-initiated reversal, no Gemini). Wired into heartbeat via `coreCadenzaPeriodicScan(heartbeatMode)`. |
| 29 | `/cadenza-escalate` | POST | Human review for escalated lockups. 3 actions: `get_escalations` (list all escalated lockups with flags, yield, timing), `resolve_escalation` (operator approve/reverse with name attribution), `get_briefing` (on-demand Gemini briefing via buildCadenzaEscalationPrompt). |

### Solana memo format (current)

Human-readable multi-line text, ~400 bytes typical. Used by ALL on-chain operations (PvP swaps + lockup burns/mints + reversals):
```
CODA Solstice | ISO 20022 pacs.009
------------------------------------
MsgId:   {uuid}
TxId:    {transaction_id}
E2EId:   {end_to_end_id}
Date:    {iso_8601_timestamp}
Amount:  {amount} {currency}
From:    {sender_bic} ({sender_name})
To:      {receiver_bic} ({receiver_name})
Purpose: {purpose_code}
Remittance: {optional_free_text}
```

Lockup operations add two additional fields:
```
Phase:   {lockup_phase}
Op:      {operation_code}
```

Phase values: `Phase 1 — Sender Burn`, `Phase 1 — Escrow Mint`, `Phase 2 — Escrow Burn`, `Phase 2 — Hard Finality Mint`, `Reversal — Escrow Burn`, `Reversal — Sender Re-Mint`.
Op values: `BURN`, `ESCROW_MINT`, `ESCROW_BURN`, `FINALITY_MINT`, `REVERSAL_ESCROW_BURN`, `REVERSAL_REMINT`.

---

## Most Recent Tasks

---TASK_COMPLETE---
Step: Task 127a — Fix Figma Asset Imports for Local Dev
Timestamp: 2026-03-18T18:45:00Z
Status: DONE

### Summary:
Replaced 2 `figma:asset/...` imports (Figma-specific protocol that doesn't resolve outside their environment) with the local `coda-icon.svg` file. This unblocked the Vite dev server from starting.

### Modified files:
| File | Change |
|------|--------|
| `/src/app/components/LoginPage.tsx` | `figma:asset/...` → `./icons/coda-icon.svg` |
| `/src/app/components/dashboard/dashboard-layout.tsx` | `figma:asset/...` → `../icons/coda-icon.svg` |

---END_TASK---

---TASK_COMPLETE---
Step: Task 127b — Replace CODA Icon with Official Brand SVG
Timestamp: 2026-03-18T19:00:00Z
Status: DONE

### Summary:
Replaced the placeholder "C" circle icon (`coda-icon.svg`) with the official CODA geometric logo from the brand assets folder. Uses `fill="currentColor"` for theme compatibility.

### Modified files:
| File | Change |
|------|--------|
| `/src/app/components/icons/coda-icon.svg` | Replaced placeholder with official CODA brand mark (2900x2900 viewBox, single path) |

---END_TASK---

---TASK_COMPLETE---
Step: Task 127c — Login Error Handling UX Improvements
Timestamp: 2026-03-18T19:30:00Z
Status: DONE

### Summary:
Improved failed login UX with three changes: (1) `friendlyAuthError()` in AuthContext maps raw Supabase errors to clear, actionable messages (e.g. "Invalid login credentials" → "Incorrect email or password. Please try again."), (2) form shakes on failed attempt via CSS `animate-shake` keyframe, (3) password field auto-clears and re-focuses so user can immediately retype.

### Modified files:
| File | Change |
|------|--------|
| `/src/app/contexts/AuthContext.tsx` | Added `friendlyAuthError()` mapper (handles: wrong credentials, unconfirmed email, duplicate account, rate limit, network errors). Wired into `signIn`, `signUp`, and catch blocks. |
| `/src/app/components/LoginPage.tsx` | Added `formRef` + `passwordRef`. Form gets `animate-shake` class on error. Password clears + re-focuses on failed login. |
| `/src/styles/theme.css` | Added `@keyframes shake` (8-step dampened horizontal oscillation, 0.5s) + `.animate-shake` class. |

### Verification:
- Friendly error message renders: "Incorrect email or password. Please try again."
- `animate-shake` class confirmed on form element after failed login
- Password field clears and receives focus
- No console or server errors
- Shake replays on consecutive failed attempts (reflow trick)

---END_TASK---

---TASK_COMPLETE---
Step: Task 128a–e — Phase A: Dev Environment Setup
Timestamp: 2026-03-18T21:00:00Z
Status: DONE

### Summary:
Extracted all hardcoded configuration to environment variables, set up git branching (main + develop), and added GitHub Actions CI. Supabase project ID, anon key, and Edge Function name now read from `VITE_SUPABASE_*` env vars. Solana explorer, cluster, and faucet URLs configurable via env vars (server + client). Deleted autogenerated `utils/supabase/info.tsx`. Added TypeScript env type declarations. Created `.env.example` with full documentation (committed), `.env.staging` and `.env.production` templates (gitignored).

### New files created:
| File | Description |
|------|-------------|
| `src/vite-env.d.ts` | Vite env type declarations for `ImportMetaEnv` |
| `.github/workflows/ci.yml` | GitHub Actions CI — build check on PRs to main/develop |
| `.env.staging` | Staging env template (gitignored) |
| `.env.production` | Production env template with Solstice Network URLs (gitignored) |

### Modified files:
| File | Change |
|------|--------|
| `src/app/supabaseClient.ts` | Reads from `import.meta.env.VITE_SUPABASE_*` with runtime validation. Exports `supabaseUrl`. |
| `src/app/components/AgentTerminal.tsx` | Uses exported `supabaseUrl` instead of reconstructing from `projectId` |
| `src/app/contexts/AuthContext.tsx` | Static import of `serverBaseUrl`/`publicAnonKey` from supabaseClient (removes dynamic import of info.tsx) |
| `src/app/types.ts` | `explorerUrl()` and `faucetUrl()` now use env vars with Devnet defaults |
| `supabase/functions/server/solana-real.tsx` | Added `SOLANA_EXPLORER_URL`, `SOLANA_CLUSTER`, `SOLANA_FAUCET_URL` env vars |
| `src/app/components/SetupPage.tsx` | Faucet + explorer URLs use env vars |
| `src/app/components/agent/PipelineTracker.tsx` | Explorer cluster from env var |
| `src/app/components/agent/TransactionLifecycle.tsx` | Explorer cluster from env var |
| `src/app/components/agent/CommsFeed.tsx` | Explorer cluster from env var |
| `.env.example` | Full template with all client + server env vars |
| `.gitignore` | Already covers `.env.*` with `!.env.example` exception |

### Deleted files:
| File | Reason |
|------|--------|
| `utils/supabase/info.tsx` | Figma autogenerated — replaced by env vars |

### Git:
- Committed to `main`, pushed to `origin/main`
- Created `develop` branch, pushed to `origin/develop`
- Working branch: `develop`

### Verification:
- App builds (`npm run build` — 0 errors)
- Dev server starts, dashboard loads, Supabase auth works
- No console errors
- `.env` not committed, `.env.example` committed
- Both branches pushed to GitHub
- Missing env var throws clear error message

---END_TASK---

---TASK_COMPLETE---
Step: Task 132a–c — Phase B: Staging Environment + Azure Static Web Apps
Timestamp: 2026-03-18T21:30:00Z
Status: DONE

### Summary:
Captured the full database schema as a Supabase migration file (16 tables, all constraints/indexes/RLS/grants). Deployed the staging frontend to Azure Static Web Apps (free tier) in `rg-solstice-network` (westus2), colocated with the Solstice Network validators. Auto-deploy from `develop` branch via GitHub Actions. Build-time env vars passed as GitHub secrets.

### New files created:
| File | Description |
|------|-------------|
| `supabase/config.toml` | Supabase CLI project config |
| `supabase/migrations/20260318000000_initial_schema.sql` | Full schema dump — 16 tables, 1,703 lines |
| `supabase/.gitignore` | Supabase CLI generated gitignore |
| `.github/workflows/azure-static-web-apps-*.yml` | Azure auto-generated deploy workflow (modified to pass VITE_* env vars) |

### Infrastructure:
| Resource | Detail |
|----------|--------|
| Azure Static Web App | `solstice-ai-staging` in `rg-solstice-network` (westus2, Free tier) |
| Staging URL | `https://zealous-smoke-037ea5c1e.1.azurestaticapps.net` |
| GitHub Secrets | `VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_FUNCTION_NAME`, `VITE_MAPBOX_TOKEN` |
| Deploy trigger | Push to `develop` branch |

### Verification:
- Migration SQL includes all 16 tables + Task 127 additions (travel_rule_payload, simulated_watchlist)
- Azure deploy succeeded (GitHub Actions run #23267897933)
- Staging URL serves the React SPA

---END_TASK---