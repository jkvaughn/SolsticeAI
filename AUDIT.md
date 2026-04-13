# CODA Project Audit

**Date:** 2026-04-11
**Auditor:** Claude (assisted by project owner)
**Scope:** Full codebase structural audit — architecture, dependencies, code quality, security

---

## 1. Project Overview

**CODA (Consortium fOr Digital Assets)** — Institutional digital asset settlement platform powered by Solstice Protocol. Multi-agent AI system for cross-bank Token-2022 settlement on Solstice Network (custom Solana validator cluster).

| Layer | Stack |
|-------|-------|
| Frontend | React 18 + Vite 6.3 + Tailwind 4 + TypeScript |
| Backend | Deno 1.44 + Hono (single-file server) |
| Database | Azure Postgres (prod), Supabase (staging) |
| Blockchain | Solstice Network (prod), Solana Devnet (staging) |
| AI | Gemini 2.5 Flash (all agents) |
| Auth | Azure Entra ID + Google OAuth (prod), Supabase Auth (staging) |
| Hosting | Azure Static Web Apps (frontend), Azure Container Apps (backend) |
| Infra-as-Code | Terraform (Azure resources) |

---

## 2. Codebase Statistics

| Metric | Value |
|--------|-------|
| Total commits | 265 |
| Frontend source files (.ts/.tsx) | 154 |
| Frontend lines of code | ~40,000 |
| Backend source files (.ts/.tsx) | 15 |
| Backend lines of code | ~14,130 |
| Largest backend file (index.tsx) | 8,441 lines |
| API endpoints in index.tsx | ~80 |
| shadcn/ui components | 50 |
| Page/feature components | 37 |
| Context providers | 6 |
| Custom hooks | 10 |
| Database migrations | 6 |
| Test files | 0 |
| TypeScript config (tsconfig.json) | None |
| Linter/formatter config | None |

---

## 3. Architecture

### 3.1 Frontend Structure

```
src/
├── main.tsx                    # Entry point
├── app/
│   ├── App.tsx                 # Provider tree: Theme → Auth → Persona → Heartbeat → Router
│   ├── routes.tsx              # React Router v7 — AuthGate → Layout → Pages
│   ├── types.ts                # Domain types (Bank, Transaction, Wallet, etc.)
│   ├── supabaseClient.ts       # Supabase client + callServer() for writes/actions
│   ├── dataClient.ts           # ~35 fetch*() functions for reads (REST or Supabase)
│   ├── db.ts                   # Additional data layer (unclear purpose)
│   ├── contexts/               # 6 React contexts (Auth, Aria, Banks, Layout, Notification, Persona)
│   ├── hooks/                  # 10 custom hooks
│   ├── lib/                    # adminClient.ts, userClient.ts
│   └── components/
│       ├── ui/                 # 50 shadcn/ui primitives
│       ├── agent/              # Agent-related components
│       ├── aria/               # Aria assistant UI
│       ├── dashboard/          # Dashboard widgets
│       ├── network-command/    # Globe/war room
│       ├── proving-ground/     # Scenario testing
│       └── (37 page-level components at root)
```

### 3.2 Backend Structure

```
supabase/functions/server/
├── index.tsx              # 8,441 lines — ALL route handlers, business logic, SQL
├── db.tsx                 # Postgres connection pool (deno-postgres)
├── gemini.tsx             # Gemini API wrapper with retry + truncated JSON repair
├── solana-real.tsx         # Solana/Solstice blockchain operations (Token-2022)
├── aria.tsx               # Aria agent handler (NL → config changes)
├── proving-ground.tsx     # Scenario testing engine
├── risk-engine.ts         # Rule-based risk scoring
├── yield-engine.tsx       # Yield calculation
├── kv_store.tsx           # Key-value store backed by Postgres
├── shared-context.ts      # Shared prompt fragments across agents
├── maestro-prompts.ts     # Maestro (orchestration) prompt builders
├── concord-prompts.ts     # Concord (compliance) prompt builders
├── fermata-prompts.ts     # Fermata (risk scoring) prompt builders
├── cadenza-prompts.ts     # Cadenza (dispute resolution) prompt builders
└── aria-prompts.ts        # Aria (config assistant) prompt builders
```

### 3.3 Dependency Flow — Frontend

```
Component wants data
        │
        ├── imports fetchX() from dataClient?
        │       ├── VITE_SERVER_BASE_URL set? → GET /data/X → backend → Postgres
        │       └── not set? → supabase.from('X').select() → Supabase Postgres
        │
        ├── imports callServer() from supabaseClient?
        │       └── POST to backend route handler (always, both envs)
        │
        └── imports supabase client directly?
                └── supabase.from('X')... (ONLY works in staging)
```

**Problem:** Three competing data access paths. No enforcement of which one components use. Some components (`Visualizer`, `AgentTerminal`, `TransactionDetail`) import from both `dataClient` AND the raw `supabase` client in the same file.

Components that bypass `dataClient` and use `supabase` directly:
- `AgentTerminal.tsx` — imports raw supabase client
- `TransactionDetail.tsx` — imports raw supabase client
- `Visualizer.tsx` — imports raw supabase client
- `useRealtimeSubscription.ts` — imports raw supabase client
- `useNetworkSimulation.ts` — imports raw supabase client + callServer + dataClient

### 3.4 Dependency Flow — Backend

```
                    index.tsx (THE MONOLITH)
                   /    |    |    |    \      \
                  ▼     ▼    ▼    ▼     ▼      ▼
              db.tsx  gemini solana  aria  proving  6 prompt
              (Pool)  .tsx   -real   .tsx  -ground  modules
                             .tsx    │ ▲   .tsx
                                    │ │
                                    │ └── CIRCULAR DEPENDENCY
                                    │     aria.tsx imports from index.tsx:
                                    │     NETWORK_DEFAULTS, getBankConfig,
                                    │     getNetworkModeContext
                                    │
                                    ├──→ db.tsx
                                    └──→ gemini.tsx
```

**Circular dependency:** `index.tsx` → `aria.tsx` → `index.tsx`. This prevents extracting modules without also extracting the shared state from the monolith.

**Runtime injection hack:** `proving-ground.tsx` avoids the circular import by exporting `setCadenzaDirectHandlers` / `setAgentDirectHandlers` — setter functions that `index.tsx` calls to inject callbacks at startup. Same coupling, extra indirection.

### 3.5 External Service Dependencies

| Service | Access From | Config |
|---------|-------------|--------|
| Azure Postgres | db.tsx (pool) | `DATABASE_URL` env var |
| Gemini 2.5 Flash | gemini.tsx (HTTP) | `GEMINI_API_KEY` env var, model hardcoded |
| Solana/Solstice RPC | solana-real.tsx | `SOLANA_RPC_URL` env var |
| Faucet wallet | solana-real.tsx | `FAUCET_KEYPAIR` env var (base64 private key) |
| Supabase | supabaseClient.ts (frontend, staging only) | `VITE_SUPABASE_*` env vars |
| Mapbox | GlobeCanvas.tsx | `VITE_MAPBOX_TOKEN` env var |
| SimpleWebAuthn | index.tsx (in-process) | N/A |

---

## 4. Red Flags — Critical Issues

### 4.1 Zero Safety Net

- **No tests.** Not one `.test.*` or `.spec.*` file in the repo.
- **No `tsconfig.json`.** Vite infers defaults — no `strict: true`, no `noImplicitAny`. The backend (Deno) also has no TypeScript config.
- **No linter.** No ESLint, Biome, or Prettier config.
- **CI only runs `npm run build`.** A successful Vite build is the only quality gate. The CI does not type-check the backend at all (it's Deno, not in the npm build).

### 4.2 The 8,441-Line Backend Monolith

`supabase/functions/server/index.tsx` contains:
- ~80 HTTP route handlers
- All business logic (settlement, compliance, risk, treasury, lockup, cadenza)
- All SQL queries (inline, no abstraction)
- All AI orchestration (procedural Gemini calls)
- Exported config/state consumed by other modules (circular dependency)
- Helper functions (amount parsing, lockup parsing, SWIFT resolution)

No separation between routing, business logic, data access, or external service integration.

### 4.3 Security Concerns

| Issue | Severity | Detail |
|-------|----------|--------|
| Admin auth is spoofable | HIGH | Backend admin check uses `X-Admin-Email` header — easily set by any HTTP client unless gateway enforces it |
| Admin email exposed to client | MEDIUM | `VITE_ADMIN_EMAIL` is a `VITE_` prefixed var, embedded in the frontend bundle |
| Private keys are not encrypted | HIGH | `encodeKeypair()` is just `btoa()` (base64), despite the variable name `keypairEncrypted`. No HSM, KMS, or envelope encryption |
| FAUCET_KEYPAIR in env var | MEDIUM | Raw private key as base64 in an environment variable |
| Silent auth fallback | MEDIUM | `callServer` with `authenticated: true` silently falls back to anon key if session retrieval fails |
| Prompt injection defense is trivial | LOW | Aria's blacklist (`INJECTION_PATTERNS`) is a short list of English strings, trivially bypassed |
| No CSRF protection | LOW | Server accepts POST requests with bearer token auth only |

### 4.4 Structural Debt

| Issue | Impact |
|-------|--------|
| Dual UI frameworks (MUI + shadcn/Radix) | Double bundle size, visual inconsistency |
| Package name `@figma/my-make-file` | Scaffolding artifact, never cleaned up |
| React/ReactDOM as peerDependencies | Works but unconventional for an application |
| Hardcoded route prefix `/make-server-49d15288/` | Figma Make artifact baked into production URLs |
| Minimal `.gitignore` (5 lines) | No coverage for IDE files, OS files, Terraform state |
| `dataClient.ts` returns `Promise<any[]>` everywhere | No type safety on data reads |
| SQL insert pattern duplicates object literals | Every INSERT writes the same object twice (once for values, once for column names) |

---

## 5. Deep Dive: Supposedly "Good" Code

### 5.1 `callServer` Client (supabaseClient.ts)

**Claimed strength:** Retry logic, backoff, non-retryable error detection.

**Actual issues:**

| Issue | Lines | Detail |
|-------|-------|--------|
| Silent auth fallback | 80-89 | `authenticated: true` silently degrades to anon key if session fetch fails. Caller has no indication. |
| String-based error classification | 132-138 | Non-retryable errors detected by substring matching against response body (`"Insufficient SOL"`, `"already burned"`, etc.). Brittle — rephrased errors break it. |
| Global request serialization | 36-47 | All staging requests serialize through one Promise chain with 350ms gap. Invisible to callers, creates performance ceiling. |
| Implicit HTTP method | 100 | `method: body ? 'POST' : 'GET'`. Can't POST without body or GET with body. |
| Unstructured logging | Throughout | Request IDs, bodies, statuses all logged to browser console. No levels, no conditional, just noise in production. |

### 5.2 `solana-real.tsx` — Blockchain Operations

**Claimed strength:** Properly abstracted blockchain ops.

**Actual issues:**

| Issue | Lines | Detail |
|-------|-------|--------|
| "Encrypted" keys are just base64 | 84-91 | `encodeKeypair()` = `btoa()`, `decodeKeypair()` = `atob()`. Variable name `keypairEncrypted` is misleading. |
| Hardcoded polling (no backoff) | 69-81 | 30 polls at exactly 2s intervals. No jitter, no exponential backoff. |
| Duplicated poll loop | 155-172 | `requestFaucet` reimplements the same poll loop instead of calling `sendAndPollTransaction`. |
| Silent error swallowing | 101-107, 486-498 | `checkBalance` and `getTokenBalance` catch all errors and return 0. Network error = empty account. |
| No idempotency | N/A | If `sendAndPollTransaction` times out but the tx lands on-chain, a retry causes double execution. |
| Network fee is non-atomic | 773 (comment) | Fee sent as separate transaction from settlement. Success + fee failure = inconsistent state. |
| Multi-step lockup not atomic | N/A | Lockup flow is 4 separate transactions. Mid-failure cleanup depends on the 8,441-line monolith. |
| New Connection per call | 46-48 | `getConnection()` creates a new `Connection` object every invocation. |

### 5.3 AI Agent Architecture

**Claimed strength:** Five specialized agents with separate prompt modules.

**Actual issues:**

| Issue | Location | Detail |
|-------|----------|--------|
| "Agents" are prompt strings | Throughout | No agent framework, no classes, no state machines. Just different system prompts fed to `callGemini()`. |
| Single model for all agents | gemini.tsx:5 | `gemini-2.5-flash` hardcoded. `agent_model` DB column is cosmetic — never used for routing. |
| Truncated JSON repair as a feature | gemini.tsx:173-208 | `repairTruncatedJSON()` silently closes unclosed braces/brackets. Callers don't know response was repaired/truncated. |
| No structured output validation | gemini.tsx:136 | Response is `JSON.parse(text) as T` — no Zod, no runtime check, no field validation. |
| Amount correction is a workaround | index.tsx:2020-2057 | Server re-parses user input with regex and overrides Gemini's amount. If you need regex to fix the AI, the contract is broken. |
| Prompt injection defense is trivial | aria.tsx:63-66 | 7-string blacklist. Bypassed by Unicode, token splitting, indirect injection. |
| No token counting | index.tsx:1963 | Last 10 conversations loaded with no token budget. Long histories blow context window. |
| No TOCTOU protection on Aria confirm | aria.tsx:404-493 | Config can change between proposal generation and confirmation. |
| Duplicated SQL insert objects | index.tsx:2063-2132 | Every INSERT writes the record literal twice (values + column names). Change one, forget the other → silent mismatch. |

---

## 6. Dependency Tree — Frontend (npm)

### Core
- react 18.3.1 (peerDependency)
- react-dom 18.3.1 (peerDependency)
- react-router 7.13.0
- vite 6.3.5
- tailwindcss 4.1.12

### UI Libraries (DUAL — pick one)
- **shadcn/Radix stack:** @radix-ui/* (20 packages), lucide-react, class-variance-authority, clsx, tailwind-merge, cmdk, vaul, sonner
- **MUI stack:** @mui/material 7.3.5, @mui/icons-material 7.3.5, @emotion/react, @emotion/styled

### Data & State
- @supabase/supabase-js ^2.96.0
- swr ^2.4.0

### Visualization
- recharts 2.15.2
- mapbox-gl ^3.20.0
- lottie-react ^2.4.1

### Interaction
- react-dnd 16.0.1 + react-dnd-html5-backend
- react-hook-form 7.55.0
- motion 12.23.24 (Framer Motion)
- embla-carousel-react 8.6.0
- react-resizable-panels 2.1.7

### Auth
- @simplewebauthn/browser ^13.3.0

### Other
- date-fns 3.6.0
- next-themes 0.4.6 (theme switching — works outside Next.js)
- react-day-picker 8.10.1
- react-responsive-masonry 2.7.1
- react-slick 0.31.0
- input-otp 1.4.2

### Dev Dependencies
- @tailwindcss/vite 4.1.12
- @vitejs/plugin-react 4.7.0
- tailwindcss 4.1.12
- vite 6.3.5

## 7. Dependency Tree — Backend (Deno)

All resolved via `npm:` and `jsr:` specifiers at runtime (no package.json, no lock file for backend).

| Dependency | Specifier | Purpose |
|------------|-----------|---------|
| hono | npm:hono | Web framework |
| deno-postgres | https://deno.land/x/postgres@v0.19.3 | Direct Postgres pool |
| @solana/web3.js | npm:@solana/web3.js@1.98.0 | Solana client |
| @solana/spl-token | npm:@solana/spl-token@0.4.12 | Token-2022 operations |
| @simplewebauthn/server | npm:@simplewebauthn/server@13 | Passkey verification |
| @std/encoding | jsr:@std/encoding@1 | Base64 encode/decode |

---

## 8. Infrastructure

### Terraform (infra/)
- `main.tf` — Azure resource group, provider config
- `database.tf` — Azure Postgres Flexible Server
- `container.tf` — Azure Container App + Container App Environment
- `acr.tf` — Azure Container Registry
- `staticwebapp.tf` — Azure Static Web App
- `backend.tf` — Terraform state backend
- `variables.tf` / `outputs.tf` / `versions.tf`

### CI/CD (.github/workflows/)
- `ci.yml` — Build-only check on PRs and develop pushes (no tests, no backend check)
- `azure-static-web-apps-production.yml` — Auto-deploy frontend on push to main
- `azure-static-web-apps-zealous-smoke-*.yml` — Second SWA workflow (likely staging/preview)

### Docker
- `Dockerfile` — Deno 1.44 base, copies server source, `deno cache`, runs with `--allow-net --allow-env --allow-read`
- `docker/` directory exists (contents not inspected)

---

## 9. Database Schema (6 migrations)

| Migration | Purpose |
|-----------|---------|
| 20260318000000_initial_schema.sql | Core tables: banks, wallets, transactions, agent_messages, agent_conversations, bank_agent_config, compliance_logs, risk_scores, cadenza_flags, lockup_tokens, heartbeat_cycles, treasury_mandates, network_wallets, network_snapshots, simulated_watchlist |
| 20260319000000_azure_postgres.sql | Azure Postgres compatibility adjustments |
| 20260330000000_admin_passkeys.sql | Admin passkey credentials table |
| 20260330100000_user_enterprise.sql | User profiles, preferences, sessions |
| 20260401000000_user_roles.sql | Role-based access (treasury, compliance, bsa_officer, executive, admin) |
| 20260401100000_risk_rules.sql | Deterministic risk scoring rules table |

---

## 10. Priority Triage

### P0 — Do First (safety & correctness)

| # | Issue | Risk | Effort |
|---|-------|------|--------|
| 1 | Add `tsconfig.json` with `strict: true` (frontend + backend) | Catch type errors before production | Low |
| 2 | Add ESLint or Biome | Catch bugs, enforce consistency | Low |
| 3 | Audit admin auth — `X-Admin-Email` header is spoofable | Security vulnerability | Medium |
| 4 | Rename `keypairEncrypted` → `keypairBase64` or actually encrypt | Misleading name masks security gap | Low |
| 5 | Fix silent auth fallback in `callServer` | Silent security degradation | Low |

### P1 — Do Next (structural integrity)

| # | Issue | Risk | Effort |
|---|-------|------|--------|
| 6 | Break up `index.tsx` into route modules | Developer velocity, bug isolation | High |
| 7 | Break circular dependency (index.tsx ↔ aria.tsx) | Blocks modularization | Medium |
| 8 | Add integration tests for critical paths (settlement, auth, agent pipeline) | Regression safety | High |
| 9 | Remove MUI or Radix — pick one UI framework | Bundle size, consistency | Medium |
| 10 | Enforce single data access path (eliminate direct supabase imports in components) | Data consistency | Medium |

### P2 — Clean Up (quality & hygiene)

| # | Issue | Risk | Effort |
|---|-------|------|--------|
| 11 | Add Zod or similar for Gemini response validation | Silent malformed data | Medium |
| 12 | Fix duplicated SQL insert object pattern | Maintenance landmine | Medium |
| 13 | Add backend Deno type checking to CI | Backend type safety | Low |
| 14 | Move secrets to Azure Key Vault | Security hygiene | Medium |
| 15 | Expand `.gitignore` | Prevent accidental commits | Low |
| 16 | Fix `dataClient.ts` return types (replace `any[]`) | Type safety on reads | Medium |
| 17 | Add idempotency keys to blockchain operations | Double-execution prevention | High |
| 18 | Consolidate polling logic in solana-real.tsx | Code duplication | Low |

---

## 11. What Works

Despite the structural debt, the following are functionally correct:

- **Dual environment strategy** — Production (Azure) vs staging (Supabase) switching via env var is clean
- **Token-2022 settlement model** — Burn-and-mint PvP atomic swap is correct for tokenized deposits
- **ISO 20022 on-chain memos** — pacs.009 memo format with byte-size guards is well-implemented
- **Lockup escrow with permanent delegate** — Uses Token-2022 PermanentDelegate extension correctly
- **Domain model design** — The separation of Maestro/Concord/Fermata/Cadenza/Aria responsibilities is the right decomposition for this domain
- **Terraform infra** — Properly modularized Azure resources
- **The app ships and runs** — 265 commits, deployed to Azure, real on-chain operations

---

## 12. Settlement Flow — End-to-End Trace

### 12.1 Overview

The settlement pipeline is **fully backend-driven**. The frontend calls one endpoint (`/agent-think`), and the backend orchestrates the entire multi-step pipeline internally via fire-and-forget function calls.

### 12.2 State Machine

```
initiated ──→ compliance_check ──→ risk_scored ──→ executing
                                                      │
                                    ┌─────────────────┤
                                    ▼                  ▼
                                 settled            locked
                                 (PvP)           (lockup escrow)
                                                      │
                                          ┌───────────┤
                                          ▼           ▼
                                       settled     reversed
                                    (hard finality) (clawback)
```

Also: `rejected` — can occur after compliance failure or agent rejection.

### 12.3 Step-by-Step Flow

**Step 1: User initiates (Frontend)**
- User types "send $100 to CITI" in `AgentTerminal.tsx`
- Frontend calls `POST /agent-think` via `callServer()`

**Step 2: AI decides action (Backend — `/agent-think`)**
- Loads bank, wallet, other banks, recent conversations from DB
- Builds Maestro system prompt with full bank context
- Calls Gemini → returns structured JSON with `action: "initiate_payment"`
- **Amount sanity check**: re-parses user input with regex, overrides Gemini's amount
- **Lockup parse**: extracts lockup duration from user input (e.g., "with a 10 min lockup")
- Saves conversation to `agent_conversations` (2 INSERTs)
- Calls `handleInitiatePayment()`:
  - `INSERT INTO transactions` (status: `initiated`)
  - `UPDATE transactions SET travel_rule_payload` (if amount >= $3000)
  - `INSERT INTO agent_messages` (type: `payment_request`)
  - **Fire-and-forget** `coreOrchestrate(receiverId, messageId)` — no await

**Step 3: Receiver orchestration (Backend — `coreOrchestrate()` → `runSettlementPipeline()`)**

All four sub-steps run in sequence within a single function call:

**3a. Compliance Check (inline)**
- 5 checks: sanctions, AML threshold, counterparty, jurisdiction, purpose code
- `INSERT INTO compliance_logs` (5 rows)
- `UPDATE transactions SET status = 'compliance_check'`
- `INSERT INTO agent_messages` (compliance_response)
- Gemini call for Concord narrative (compliance summary)
- If fails → `handleRejectPayment()` → status `rejected`, return early

**3b. Risk Scoring (inline)**
- Loads corridor history + sender velocity
- Gemini call (Fermata system prompt) for risk assessment
- Recalculates composite score using per-bank weights
- `INSERT INTO risk_scores`
- `UPDATE transactions SET status = 'risk_scored', risk_level, risk_score, lockup_until`
- `INSERT INTO agent_messages` (risk_alert)

**3c. Agent Decision (inline via `coreAgentThink()`)**
- Presents compliance + risk results to receiver's Maestro agent via Gemini
- Agent decides: `accept_payment` or `reject_payment`
- `INSERT INTO agent_conversations` (2 rows)
- `INSERT INTO agent_messages` (status_update + payment_accept/reject)
- If reject → `handleRejectPayment()` → status `rejected`, return

**3d. On-Chain Execution (inline)**
- `UPDATE transactions SET status = 'executing'`
- **BIFURCATION DECISION** (see 12.4)

### 12.4 PvP vs Lockup Bifurcation

```
effectiveLockup =
  userForcedLockup?     → requestedLockup (bypass risk gate)
  riskScore <= instant?  → 0 (force PvP, ignore bank default)
  else                   → max(requestedLockup, riskDerivedLockup)

isLockupFlow = effectiveLockup > 0
```

Risk-derived lockup: score > instant_ceiling → 1440min (24h), score > 72h_ceiling → 4320min (72h).

User lockup override: stored as negative `lockup_duration_minutes` on the transaction to signal bypass of risk gate.

### 12.5 PvP Path (Branch A — Low Risk)

**One atomic on-chain transaction** (`executeTransfer()` in `solana-real.tsx`):
1. Instruction 1: Memo (ISO 20022 pacs.009, ≤566 bytes)
2. Instruction 2: BURN sender's tokens (sender's mint, Token-2022)
3. Instruction 3: MINT to receiver's ATA (receiver's mint, Token-2022)
4. Signed by BOTH keypairs

**Post-chain:**
- Read on-chain balances for both banks
- `UPDATE wallets SET balance_tokens` (sender + receiver)
- `UPDATE transactions SET status = 'settled', settlement_type = 'PvP', solana_tx_signature, settled_at`
- `collectNetworkFee()` — separate SOL transfer (non-atomic)
- `INSERT INTO agent_messages` (settlement_confirm)

### 12.6 Lockup Path (Branch B — Elevated Risk)

#### Phase 1: Soft Settlement (at execution time)

**Two separate on-chain transactions (NOT atomic):**
1. TX 1: `burnDepositToken()` — burn sender's tokens (sender signs)
2. TX 2: `mintLockupToEscrow()` — mint LOCKUP-USTB to custodian ATA (custodian signs)

**Post-chain:**
- `INSERT INTO lockup_tokens` (tracks per-tx escrow amounts)
- `UPDATE wallets SET balance_tokens` (sender only)
- `UPDATE transactions SET status = 'locked', lockup_status = 'active', is_reversible = true`
- `collectNetworkFee()` — Phase 1 fee

#### Phase 2: Hard Finality (triggered by Cadenza ALL_CLEAR, admin, or timer)

**Two separate on-chain transactions (NOT atomic):**
1. TX 3: `burnLockupFromEscrow()` — burn LOCKUP-USTB from custodian ATA
2. TX 4: `mintDepositToken()` — mint receiver's deposit tokens (receiver signs)

**Post-chain:**
- Yield sweep (accrued yield → SOLSTICE_FEES)
- `UPDATE lockup_tokens SET status = 'settled'`
- `UPDATE transactions SET status = 'settled', lockup_status = 'hard_finality', is_reversible = false`
- `collectNetworkFee()` — Phase 2 fee
- `UPDATE wallets` (receiver)

#### Reversal Path (triggered by Cadenza AUTO_REVERSE or user)

**Two separate on-chain transactions (NOT atomic):**
1. TX: `burnLockupFromEscrow()` — burn LOCKUP-USTB
2. TX: `mintDepositToken()` — re-mint sender's deposit tokens (clawback)

**Post-chain:**
- `UPDATE lockup_tokens SET status = 'reversed'`
- `UPDATE transactions SET status = 'reversed', lockup_status = 'reversed', reversal_reason`
- `collectNetworkFee()` — reversal fee

### 12.7 Settlement Failure Modes

#### CRITICAL: Lockup Phase 1 — Burn succeeds, escrow mint fails

Sender's tokens are **burned and gone** on-chain. No LOCKUP-USTB minted. DB reverts to `status = 'risk_scored'`. Error message says "SENDER TOKENS ALREADY BURNED -- manual recovery needed." **No automated recovery path exists.** Funds are lost until manual intervention.

#### CRITICAL: Phase 2 — Escrow burn succeeds, receiver mint fails

LOCKUP-USTB **burned from escrow**. Receiver never gets deposit tokens. Error: "LOCKUP TOKENS BURNED -- manual recovery needed." **Total loss of escrowed value.**

#### CRITICAL: Reversal — Escrow burn succeeds, sender re-mint fails

Same pattern. LOCKUP-USTB burned, sender tokens never re-minted. Value destroyed.

#### BUG: Undefined `txUpdateErr` variable in orchestrator

Lines 4241/4329 of `index.tsx` reference `txUpdateErr` in the orchestrator's inline execution path, but this variable is **never declared** in that scope. It is always `undefined`, so the retry block **never fires** even if the DB UPDATE fails. If the update throws, the error bubbles up unhandled.

#### MODERATE: On-chain success but DB update failure (PvP)

After `executeTransfer()` succeeds, the DB update to `status = 'settled'` can fail. On-chain is final — tokens moved — but DB shows `executing` or `risk_scored`. Frontend displays stale state with no reconciliation mechanism.

#### MODERATE: Balance update failures are swallowed

All post-settlement `getTokenBalance()` + `UPDATE wallets` are wrapped in try/catch with warning-only logging. On-chain balance and DB balance can diverge silently.

#### MODERATE: Network fee failure in `/agent-execute` route

The PvP path in the HTTP route (not orchestrator) does NOT wrap `collectNetworkFee()` in try/catch. If it throws, the function returns 500 **after** settlement was confirmed on-chain.

#### LOW: Duplicate orchestration race condition

Both server-side fire-and-forget AND frontend Supabase subscription can trigger `coreOrchestrate()` for the same message. Mitigated by `processed` flag check, but TOCTOU gap exists.

#### NOT IDEMPOTENT

The pipeline cannot resume from where it left off. If it fails after compliance but before risk scoring, the transaction is stuck at `compliance_check` status with no built-in recovery.

### 12.8 Orchestration Redundancy

The frontend has a backup path: `AgentTerminal.tsx` subscribes to `agent_messages` via Supabase realtime, detects unprocessed messages, and calls `POST /agent-orchestrator`. This is redundant with the server-side fire-and-forget but serves as a fallback if the backend call fails.

---

## 13. Authentication & Authorization — Security Audit

### 13.1 Auth Flow — Production (Azure)

1. User clicks "Sign in with Microsoft/Google" on `LoginPage.tsx`
2. Opens popup to `/.auth/login/aad` or `/.auth/login/google`
3. Azure Static Web Apps handles OAuth, sets auth cookie
4. Popup redirects to `/auth-callback`, posts `coda-auth-complete` message, closes
5. `AzureAuthProvider` fetches `/.auth/me` to get `clientPrincipal`
6. **No bearer token is ever obtained.** `accessToken` is always `null`.
7. All `callServer` calls use the Supabase `publicAnonKey` as `Authorization: Bearer`

### 13.2 Auth Flow — Staging (Supabase)

1. Email/password via `supabase.auth.signInWithPassword`
2. Signup goes to backend `/auth/signup` (uses Supabase Admin API with service role key)
3. Google OAuth via `supabase.auth.signInWithOAuth`
4. Supabase issues JWT `access_token` in session — but `callServer` **never sends it** (the `authenticated: true` option is never used by any caller)

### 13.3 CRITICAL: No Backend Authentication Middleware

The backend has **no global auth middleware**. The only `app.use("*")` calls are:
- `logger()` — logging
- `cors({ origin: "*" })` — **wide-open CORS, any website can call the API**

There is no middleware that validates the `Authorization` header, checks Azure SWA cookies, or verifies caller identity. Each route must individually call `requireAdmin` or `requireUser`, and **most don't**.

### 13.4 CRITICAL: Admin Identity is Client-Asserted

**Frontend** (`useIsAdmin.ts`):
```
VITE_ADMIN_EMAIL is baked into the frontend bundle (publicly visible)
isAdmin = userEmail === VITE_ADMIN_EMAIL || role === 'admin'
```

**Backend** (`requireAdmin` in `index.tsx`):
```
Checks X-Admin-Email header against ADMIN_EMAIL env var
No verification that the caller is actually authenticated as that user
```

**Attack:** Set `X-Admin-Email: jeremy@rimark.io` in any HTTP client → full admin access to:
- `/setup-bank`, `/faucet`, `/setup-custodian`, `/reassign-custodian`
- `/reset-tokens`, `/reset-network`
- `/admin-reauth`, all `/passkey-*` endpoints
- `/seed-mandates`, `/backfill-swift`

### 13.5 CRITICAL: User Identity is Client-Asserted

`requireUser` reads `X-User-Email` header — any client can impersonate any user. Access to:
- `/user/profile`, `/user/profile-update`
- `/user/preferences`, `/user/preferences-update`
- `/user/sessions` (returns session tokens for all sessions!), `/user/sessions-revoke`
- `/user/audit-log`, `/user/login-history`

### 13.6 CRITICAL: 30+ Routes Have Zero Auth Checks

Routes accessible by anyone with no identity verification:

| Route | Risk |
|-------|------|
| `POST /agent-execute` | **CRITICAL** — executes on-chain settlements |
| `POST /agent-orchestrator` | **CRITICAL** — full settlement pipeline |
| `POST /lockup-settle` | **CRITICAL** — settles lockups on-chain |
| `POST /lockup-reverse` | **CRITICAL** — reverses lockups on-chain |
| `POST /lockup-action` | **CRITICAL** — settles/reverses from UI |
| `POST /treasury-cycle` | **CRITICAL** — creates transactions autonomously |
| `POST /network-heartbeat` | **CRITICAL** — triggers cycles, resets data |
| `POST /retry-transaction` | **CRITICAL** — resets and re-runs transactions |
| `POST /agent-config` | **CRITICAL** — reads/writes bank config + system prompts |
| `POST /agent-think` | **HIGH** — triggers AI reasoning on any bank |
| `POST /agent-chat` | **HIGH** — triggers AI chat, burns Gemini credits |
| `POST /compliance-check` | **HIGH** — runs compliance on any tx |
| `POST /risk-score` | **HIGH** — triggers risk scoring |
| `POST /expire-transaction` | **HIGH** — marks transactions rejected |
| `POST /yield-accrue` | **HIGH** — modifies lockup yield data |
| `POST /yield-sweep` | **HIGH** — modifies wallet balances |
| `POST /cadenza-monitor` | **HIGH** — runs monitoring scans |
| `POST /cadenza-escalate` | **HIGH** — resolves escalations |
| `POST /proving-ground` | **HIGH** — adversarial scenarios |
| `GET /data/*` (all) | **HIGH** — full read access to all database tables |

### 13.7 HIGH: Role Self-Escalation

`POST /user/profile-update` allows any user (identified by spoofable `X-User-Email`) to set their own `role` field. Valid roles include `'admin'`. Any user can self-promote to admin.

### 13.8 HIGH: Passkey Registration Hijack

All passkey endpoints are gated behind `requireAdmin`, which only checks the `X-Admin-Email` header. An attacker can:
1. Spoof `X-Admin-Email: jeremy@rimark.io`
2. Call `/passkey-register-options` to get a challenge
3. Register their own hardware key under the admin's email
4. Use that passkey to pass MFA

### 13.9 HIGH: MFA Fails Open

`AuthGate.tsx` line 56-60: If the `/passkey-status` call fails (network error, timeout, backend down), the MFA check **silently passes**. User is marked "verified" in `sessionStorage` and never challenged again.

### 13.10 MEDIUM: Signup Access Code is Client-Side Only

`LoginPage.tsx`: access code `CODA2026` is hardcoded in frontend JavaScript. Backend `/auth/signup` has no access code check. Anyone can POST directly to create accounts.

### 13.11 MEDIUM: Session Tokens Exposed

`GET /user/sessions` returns `session_token` for ALL sessions in the response. Combined with user impersonation via spoofed `X-User-Email`, this enables session hijacking.

### 13.12 ROOT CAUSE

The backend trusts client-provided HTTP headers (`X-Admin-Email`, `X-User-Email`) as proof of identity with no cryptographic verification. In production, Azure SWA authenticates users via cookies, but the backend Container App is a separate service that never receives or validates those cookies. The `Authorization: Bearer` header contains the Supabase anon key (a public, shared secret), not a user-specific token.

**Fix requires one of:**
1. Backend middleware that validates Azure SWA's `X-MS-CLIENT-PRINCIPAL` header (injected by SWA when proxying)
2. JWT-based auth where frontend obtains a signed token the backend can verify
3. API gateway that injects verified identity headers after authentication

---

## 14. Supabase Client Leaks & Database Access

### 14.1 Files Importing Raw Supabase Client

| File | Imports | Category | Issue |
|------|---------|----------|-------|
| `dataClient.ts` | `supabase`, `serverBaseUrl` | LEGITIMATE | Abstraction layer |
| `db.ts` | `supabase`, `serverBaseUrl` | **DEAD CODE** | No consumers — never imported anywhere |
| `useRealtimeSubscription.ts` | `supabase` | LEGITIMATE | Realtime channels + polling fallback |
| `AuthContext.tsx` | `supabase`, `serverBaseUrl`, `publicAnonKey` | LEGITIMATE | Auth operations |
| `useNetworkSimulation.ts` | `supabase`, `callServer` | MIXED | Realtime subscription bypasses `useRealtimeSubscription` hook |
| `TransactionDetail.tsx` | `supabase`, `callServer` | MIXED | Direct `supabase.channel()` bypasses hook |
| `Visualizer.tsx` | `supabase`, `callServer` | MIXED | Direct `supabase.channel()` bypasses hook |
| **`AgentTerminal.tsx`** | `supabase`, `callServer`, `supabaseUrl`, `publicAnonKey` | **PROBLEMATIC** | Raw PostgREST calls (see 14.2) |

21 additional files import only `callServer` (legitimate RPC usage).

### 14.2 CRITICAL: AgentTerminal.tsx — Raw PostgREST Calls

Lines 133-141 and 164-171 make direct `fetch()` calls to `${supabaseUrl}/rest/v1/wallets` and `${supabaseUrl}/rest/v1/transactions`. These bypass `dataClient`, bypass the queue, and call the Supabase PostgREST API directly.

**In production, `supabaseUrl` still points to Supabase, not Azure.** These calls will either fail (if Supabase DB is empty/different) or return stale staging data while the user is looking at production.

**Fix:** Replace with `fetchWallets()` and `fetchTransactionStatus()` from `dataClient.ts`.

### 14.3 BUG: `fetchAgentMessageProcessed` Always Falls to Supabase

`dataClient.ts` lines 508-520: The `if (useServer)` block has a TODO comment and **no return statement**, so it falls through to the Supabase path unconditionally — even in production.

```typescript
if (useServer) {
  // TODO: add REST endpoint /data/agent-message-processed
  // Fallback to Supabase for now
}
// ALWAYS hits Supabase:
const { data, error } = await supabase.from('agent_messages')...
```

### 14.4 Realtime Subscriptions Bypass the Hook

Three components create manual `supabase.channel()` subscriptions instead of using `useRealtimeSubscription` (which has a polling fallback for production):
- `useNetworkSimulation.ts` (lines 421, 440, 479)
- `TransactionDetail.tsx` (line 561)
- `Visualizer.tsx` (line 414)
- `AgentTerminal.tsx` (lines 304, 365)

In production where `VITE_USE_SUPABASE_REALTIME = 'false'`, these manual subscriptions **silently fail** to receive updates.

### 14.5 Dead Code: `src/app/db.ts`

Declares a `Table` class that duplicates `dataClient.ts` logic. No file in `src/` imports it. Should be deleted.

### 14.6 Backend Database Access — Clean

The backend uses **only** the `sql` tagged template from `db.tsx`. Zero Supabase client references. All queries are parameterized.

### 14.7 BUG: Invalid PostgREST Syntax in SQL Queries

Seven queries in `index.tsx` use Supabase PostgREST join syntax inside `sql` tagged templates:

```sql
SELECT *, sender_bank:banks!transactions_sender_bank_id_fkey(*)
FROM transactions WHERE id = $1
```

This is NOT valid PostgreSQL. These throw syntax errors and are caught by try/catch. When they fail, `tx.sender_bank` and `tx.receiver_bank` are `undefined`, causing downstream code to log `'NULL'` or `'?'` for bank names/jurisdictions. **This degrades compliance check accuracy** (jurisdiction matching, sanctions screening) because bank metadata is missing.

Affected locations in `index.tsx`:
- Line 1982 (agent-think)
- Line 2327 (compliance check)
- Line 2484 (risk scoring)
- Line 2761 (settlement)
- Line 5662 (lockup settle)
- Line 5940 (lockup reverse)
- Line 7349 (data endpoint)

These need to be rewritten using proper `LEFT JOIN` syntax. Line 2206 shows the correct pattern:
```sql
SELECT t.*, json_build_object('short_code', sb.short_code, ...) AS sender_bank
FROM transactions t
LEFT JOIN banks sb ON sb.id = t.sender_bank_id
LEFT JOIN banks rb ON rb.id = t.receiver_bank_id
```

### 14.8 Tables: Code vs Migrations — Perfect Match

All 23 tables defined in migrations are referenced in code. No phantom tables, no missing migrations.

### 14.9 SQL Injection Risk — Low

The `sql` tagged template correctly parameterizes all values. The identifier mode (`sql("column_name")`) validates against `/^[a-zA-Z_][a-zA-Z0-9_.]*$/` and double-quotes. No raw string concatenation found in SQL.

One minor concern: the `/data/count` endpoint passes user-supplied column names through `sql(col)` without an allowlist (the table IS allowlisted, the column is not). The regex prevents injection, but it allows probing arbitrary columns.

---

## 15. Updated Priority Triage

### P0 — Immediate (security vulnerabilities actively exploitable)

| # | Issue | Severity | Section |
|---|-------|----------|---------|
| 1 | **Add backend authentication middleware** — validate identity on all routes | CRITICAL | 13.3 |
| 2 | **Replace header-based admin/user checks** with cryptographic identity verification | CRITICAL | 13.4, 13.5 |
| 3 | **Add auth checks to 30+ unprotected routes** | CRITICAL | 13.6 |
| 4 | **Restrict CORS** from `origin: "*"` to allowed domains | CRITICAL | 13.3 |
| 5 | **Block role self-escalation** — remove `role` from user-updatable fields | HIGH | 13.7 |
| 6 | **Fix MFA fail-open** — deny access on passkey status check failure | HIGH | 13.9 |

### P1 — Urgent (data integrity and correctness)

| # | Issue | Severity | Section |
|---|-------|----------|---------|
| 7 | **Fix 7 invalid PostgREST SQL queries** — rewrite with proper JOINs | BUG | 14.7 |
| 8 | **Fix AgentTerminal raw PostgREST calls** — use dataClient | BUG | 14.2 |
| 9 | **Fix `fetchAgentMessageProcessed` fallthrough** — add REST endpoint | BUG | 14.3 |
| 10 | **Fix `txUpdateErr` undefined variable** in orchestrator | BUG | 12.7 |
| 11 | **Add recovery mechanism** for partial lockup failures (burn succeeded, mint failed) | CRITICAL | 12.7 |
| 12 | **Fix realtime subscriptions** — route through `useRealtimeSubscription` hook | BUG | 14.4 |

### P2 — Important (structural & safety net)

| # | Issue | Severity | Section |
|---|-------|----------|---------|
| 13 | Add `tsconfig.json` with `strict: true` | Medium | 4.1 |
| 14 | Add ESLint or Biome | Medium | 4.1 |
| 15 | Break up `index.tsx` into route modules | Medium | 4.2 |
| 16 | Add integration tests for settlement + auth | Medium | 4.1 |
| 17 | Remove MUI or Radix — pick one | Low | 4.4 |
| 18 | Delete dead code `db.ts` | Low | 14.5 |
| 19 | Rename `keypairEncrypted` → `keypairBase64` | Low | 5.2 |
| 20 | Move signup access code to backend | Medium | 13.10 |

---

---

## 16. Production Database Audit

### 16.1 Infrastructure Configuration

| Setting | Value | Issue |
|---------|-------|-------|
| Provider | Azure Postgres Flexible Server | |
| Version | PostgreSQL 16 | Fine |
| SKU | `B_Standard_B1ms` | **Burstable, single-core, 2GB RAM.** This is the cheapest tier. Fine for demo, will not handle production load. |
| Storage | 32 GB | Fine for demo |
| Region | `westus3` (DB) vs `westus2` (Container App) | **Cross-region.** DB and backend are in different Azure regions. Adds latency to every SQL query. |
| Backup retention | 7 days | Minimum. No geo-redundant backup. |
| Zone | `"1"` (single AZ) | No HA. |

### 16.2 CRITICAL: Database is Open to the Internet

```hcl
# database.tf line 50-61
resource "azurerm_postgresql_flexible_server_firewall_rule" "dev_access" {
  start_ip_address = "0.0.0.0"
  end_ip_address   = "255.255.255.255"
}
```

The "DevAccess" firewall rule allows **every IP address on the internet** to connect directly to the Postgres server. The comment says "tighten to specific IPs before production launch" — it was never tightened. Combined with the Terraform variables having a default admin username (`codaadmin`) and the password in a tfvars file, this means anyone who can guess or brute-force the password has direct database access.

The `lifecycle { ignore_changes }` block means Terraform will never revert this even if someone fixes it manually — it has to be explicitly removed from the config.

### 16.3 No Migration Runner

Migrations are applied manually via `psql`:
```
psql "$DATABASE_URL" < supabase/migrations/20260330000000_admin_passkeys.sql
```
(per the comment in the migration file)

There is:
- No migration runner tool (no Flyway, no golang-migrate, no dbmate, no Prisma)
- No migration state table tracking which migrations have been applied
- No way to know if the production DB schema matches the migration files
- No rollback mechanism
- No CI/CD step that applies migrations

The two "initial schema" migrations (`20260318` Supabase dump and `20260319` Azure version) appear to be **competing, not sequential** — the Azure migration recreates all the same tables with `CREATE TABLE IF NOT EXISTS`. If both were run, the second would be a no-op. If only the Azure one was run, the FK constraints from the Supabase dump are **missing**.

### 16.4 CRITICAL: Azure Migration is Missing Foreign Key Constraints

The Supabase-format initial schema (`20260318`) defines **18 foreign key constraints**:

| Constraint | Table | References |
|-----------|-------|------------|
| agent_conversations_bank_id_fkey | agent_conversations | banks(id) |
| agent_conversations_transaction_id_fkey | agent_conversations | transactions(id) |
| agent_messages_from_bank_id_fkey | agent_messages | banks(id) |
| agent_messages_to_bank_id_fkey | agent_messages | banks(id) |
| agent_messages_transaction_id_fkey | agent_messages | transactions(id) |
| bank_agent_config_bank_id_fkey | bank_agent_config | banks(id) ON DELETE CASCADE |
| cadenza_flags_lockup_token_id_fkey | cadenza_flags | lockup_tokens(id) |
| cadenza_flags_transaction_id_fkey | cadenza_flags | transactions(id) |
| compliance_logs_bank_id_fkey | compliance_logs | banks(id) |
| compliance_logs_transaction_id_fkey | compliance_logs | transactions(id) |
| lockup_tokens_receiver_bank_id_fkey | lockup_tokens | banks(id) |
| lockup_tokens_sender_bank_id_fkey | lockup_tokens | banks(id) |
| lockup_tokens_transaction_id_fkey | lockup_tokens | transactions(id) |
| risk_scores_transaction_id_fkey | risk_scores | transactions(id) |
| transactions_receiver_bank_id_fkey | transactions | banks(id) |
| transactions_sender_bank_id_fkey | transactions | banks(id) |
| treasury_mandates_bank_id_fkey | treasury_mandates | banks(id) ON DELETE CASCADE |
| wallets_bank_id_fkey | wallets | banks(id) ON DELETE CASCADE |

The Azure-specific migration (`20260319`) defines **zero foreign key constraints**. If production was set up using only the Azure migration (which the file comments suggest is the intent), the production database has **no referential integrity**. You can:
- Insert transactions referencing non-existent banks
- Delete a bank without cascading to its wallets, config, or mandates
- Create orphaned compliance logs, risk scores, and agent messages

### 16.5 162 Duplicate Indexes on `kv_store_49d15288`

The Supabase-format initial schema contains **162 identical indexes** on `kv_store_49d15288.key`:

```sql
CREATE INDEX "kv_store_49d15288_key_idx" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");
CREATE INDEX "kv_store_49d15288_key_idx1" ON "public"."kv_store_49d15288" ...
CREATE INDEX "kv_store_49d15288_key_idx10" ON "public"."kv_store_49d15288" ...
...
CREATE INDEX "kv_store_49d15288_key_idx122" ON "public"."kv_store_49d15288" ...
CREATE INDEX "kv_store_49d15288_key_idx123" ON "public"."kv_store_49d15288" ...
```

This is clearly a Supabase migration dump artifact — every time the Supabase dashboard auto-creates an index, it generates a new numbered copy. The Azure migration (`20260319`) correctly has only one:

```sql
CREATE INDEX kv_store_key_prefix ON kv_store_49d15288 (key text_pattern_ops);
```

If the Supabase dump was ever applied to production, the KV table would have 162 identical btree indexes, each consuming storage and slowing writes for zero benefit.

### 16.6 Missing `updated_at` Triggers

Only 3 tables have `updated_at` auto-update triggers:
- `banks` (via `update_updated_at()` trigger)
- `user_profiles` (via `update_updated_at_column()` trigger)
- `user_preferences` (via `update_updated_at_column()` trigger)

Tables with `updated_at` columns but **no trigger**: `bank_agent_config`, `treasury_mandates`. These rely on the application setting `updated_at = NOW()` explicitly in every UPDATE query. If any code path forgets, `updated_at` goes stale.

Note: there are two different trigger functions (`update_updated_at()` from the initial schema and `update_updated_at_column()` from user_enterprise) that do the exact same thing.

### 16.7 Connection Pool Configuration

```typescript
// db.tsx line 21
const pool = new Pool(connUrl, 10, true); // url, size, lazy
```

- Pool size: 10 connections
- Lazy: `true` (connections created on demand)
- No connection timeout configured
- No idle timeout configured
- No statement timeout configured

With `B_Standard_B1ms` SKU (max ~50 connections), a pool of 10 is fine for a single container replica. But with `container_max_replicas = 3`, you could have 30 pool connections competing for ~50 Postgres slots. At scale-up under load, this could exhaust connections.

No connection health checks. If Postgres restarts or the connection drops, stale pool connections will cause 500 errors until they're evicted (which depends on deno-postgres internal behavior — not explicitly configured).

### 16.8 Missing Env Vars in Terraform

The Container App Terraform config (`container.tf`) is **missing several env vars** that the backend code requires:

| Env Var | Used By | In Terraform? |
|---------|---------|---------------|
| `DATABASE_URL` | db.tsx | Yes |
| `GEMINI_API_KEY` | gemini.tsx | Yes |
| `SOLANA_RPC_URL` | solana-real.tsx | Yes |
| `SOLANA_CLUSTER` | solana-real.tsx | Yes |
| `SOLANA_EXPLORER_URL` | solana-real.tsx | Yes |
| `SUPABASE_URL` | index.tsx (signup) | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | index.tsx (signup) | Yes |
| **`ADMIN_EMAIL`** | index.tsx (requireAdmin) | **NO** |
| **`FAUCET_KEYPAIR`** | solana-real.tsx | **NO** |
| **`WEBAUTHN_RP_ID`** | index.tsx (passkeys) | **NO** |
| **`WEBAUTHN_ORIGIN`** | index.tsx (passkeys) | **NO** |

Missing `ADMIN_EMAIL` means the admin check defaults to... whatever Deno returns for an undefined env var (empty string), which means `requireAdmin` rejects everyone — or if a default is hardcoded somewhere, it's not in Terraform.

Missing `FAUCET_KEYPAIR` means the faucet falls back to `requestAirdrop` (which doesn't work on Solstice Network).

Missing WebAuthn vars mean passkeys default to `localhost` / `http://localhost:5173`, which will fail in production.

These were likely set manually via `az containerapp update --set-env-vars` and aren't tracked in Terraform state.

### 16.9 Secrets in Plaintext Env Vars

```hcl
# container.tf line 43-44
env {
  name  = "DATABASE_URL"
  value = "postgresql://${var.db_admin_username}:${var.db_admin_password}@..."
}
```

All secrets (`DATABASE_URL` with password, `GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) are set as plaintext `env` blocks, not as Container App secrets. Azure Container Apps supports a `secret` block (used for the ACR password on line 94) that stores values encrypted. The database credentials are in plain env vars, visible in the Azure portal to anyone with Reader access to the resource group.

### 16.10 No Monitoring or Alerting

- No Azure Monitor alerts on the Postgres server (CPU, memory, connections, storage)
- No query performance monitoring configured
- No slow query logging
- Log Analytics workspace exists (for Container Apps) but no diagnostic settings on the Postgres server
- No deadlock detection or long-running query alerts

### 16.11 Summary: Production Database Risks

| # | Severity | Finding |
|---|----------|---------|
| 1 | **CRITICAL** | Database firewall allows all IPs (0.0.0.0 - 255.255.255.255) |
| 2 | **CRITICAL** | Azure migration has zero FK constraints — no referential integrity |
| 3 | **HIGH** | No migration runner — schema state is unknown/untracked |
| 4 | **HIGH** | 4 env vars missing from Terraform (ADMIN_EMAIL, FAUCET_KEYPAIR, WEBAUTHN_*) |
| 5 | **HIGH** | Secrets in plaintext env vars instead of Container App secrets |
| 6 | **MEDIUM** | DB and backend in different Azure regions (cross-region latency) |
| 7 | **MEDIUM** | Burstable single-core SKU with no HA |
| 8 | **LOW** | 162 duplicate indexes in Supabase migration dump |
| 9 | **LOW** | Missing `updated_at` triggers on 2 tables |
| 10 | **LOW** | Duplicate trigger functions (`update_updated_at` vs `update_updated_at_column`) |

---

---

## 17. Error Handling, Observability & Recovery

### 17.1 Frontend Error Boundaries

**There are none.** Zero React error boundaries anywhere in the codebase. No `componentDidCatch`, no `getDerivedStateFromError`, no `react-error-boundary` library.

- `main.tsx`: bare `createRoot(...).render(<App />)` — no wrapping
- `App.tsx`: provider tree (`ThemeProvider > AuthProvider > PersonaProvider > HeartbeatProvider > RouterProvider`) has no error boundary at any level

**Impact:** A single rendering error in any component anywhere in the tree will white-screen the entire application. No fallback UI, no error message, no way to navigate. The user has to manually refresh.

### 17.2 Frontend Error Handling in Data Fetching

**`callServer` (supabaseClient.ts)** — the one bright spot:
- Retry with exponential backoff (1s, 2s, 4s) for 5xx
- Non-retryable pattern detection
- Client-side request IDs (`req-{timestamp}-{random}`)
- But: request ID is never sent to backend — no correlation possible

**`dataClient.serverGet`** — the production read path:
- No retry logic at all
- No request ID
- No auth headers
- Just `fetch()` → throw on non-200

**`useSWRCache` hook** — sets an `error` state on failure, but **no component in the codebase ever reads it**. Every component destructures only `data` and `invalidate`. SWR fetch errors are universally invisible to users.

**No global `unhandledrejection` handler.** Failed promises in `Promise.all` without `.catch`, fire-and-forget calls, and abandoned promises all vanish silently.

### 17.3 Component-Level Error Handling

| Component | Handles errors? | Shows errors to user? |
|-----------|----------------|----------------------|
| Dashboard.tsx | No try/catch, bare Promise.all with no .catch | No |
| TransactionMonitor.tsx | useSWRCache error ignored | No |
| HeartbeatControl.tsx | catch → console.error only | No |
| AgentTerminal.tsx | catch → shows error in chat (best in codebase) | Yes (partial) |
| EscalationDashboard.tsx | catch → sets error state, renders message | **Yes** (only page that does this properly) |
| SetupPage.tsx | catch → sets deploy error state | Yes (admin page) |

**2 out of ~37 pages surface errors to users.** The rest either swallow them silently or show stale/empty data with no indication of failure.

### 17.4 Context Provider Error Handling

| Context | On failure... |
|---------|--------------|
| AuthContext | Azure fetch `/.auth/me` catch → sets loading=false, no user, no error state. Invisible failure. |
| BanksContext | fetch catch → console.log only. `banks` serves stale sessionStorage data. |
| NotificationContext | Three separate fetches each have bare `catch { /* silent */ }`. Polling failures completely invisible. |
| AriaContext | Propagates errors to caller (acceptable). |
| PersonaContext | No async operations (safe). |

### 17.5 Backend Error Handling

**No global error middleware.** Hono supports `app.onError()` but it's not used. Uncaught exceptions return bare `text/plain` 500 responses with raw error messages.

Every route handler has a top-level try/catch following this pattern:
```typescript
app.post("/route", async (c) => {
  try {
    // ... route logic ...
  } catch (err) {
    console.log(`[route] Error: ${(err as Error).message}`);
    return c.json({ error: `Route error: ${(err as Error).message}` }, 500);
  }
});
```

**Consistent problems across all ~80 handlers:**
- **No stack traces logged.** Only `(err as Error).message`. When debugging production, you get "Transaction failed: null" with no call stack.
- **No request ID, user ID, or bank ID in error logs.** Just a route-name tag like `[faucet]`.
- **Internal error details returned to clients.** Postgres error messages, Solana RPC errors, and Gemini API responses are returned verbatim in the JSON `error` field.
- **Some inner operations catch errors but continue silently.** Wallet balance updates after settlement (line 2880-2882) log a warning and keep going — on-chain state and DB state can diverge.

**KV store (`kv_store.tsx`):** Zero error handling in all 7 functions. Any Postgres failure during a KV operation is an unhandled crash that propagates to the caller.

### 17.6 Logging

**All logging is `console.log` / `console.warn` / `console.error`.** No structured logging library, no JSON format, no log levels.

- `index.tsx` alone has **433** console.log/warn/error calls
- Ad-hoc tag prefixes: `[faucet]`, `[settlement]`, `[cadenza]`, `[orchestrator]`, etc.
- Some contextual info (bank short codes, tx ID slices) but inconsistent
- In production, stdout goes to Azure Log Analytics (30-day retention, PerGB2018 SKU)
- **Unstructured text makes KQL queries painful** — no way to filter by severity, bank, transaction, or user

### 17.7 Request Tracing

**None.** There is no end-to-end request tracing.

- Frontend `callServer` generates a request ID — never sent to the backend
- Backend has no request ID generation, no `X-Request-ID` handling
- No correlation between frontend logs, backend logs, Gemini calls, and Solana transactions
- Hono's `logger()` middleware logs method + path + status + duration, but with no request ID

**It is impossible to trace a specific user's request through the system.**

### 17.8 Health Check

`GET /health` (index.tsx line 563-575):

- **Default:** Returns `{ status: "ok" }` — liveness only, checks nothing
- **With `?db=true`:** Runs `SELECT 1` to test Postgres connectivity
- **Does NOT check:** Gemini API key validity, Solana RPC connectivity, KV store, or any dependency

The production `Dockerfile` has **no HEALTHCHECK instruction**. The docker/ subdirectory has one that hits the health endpoint, but it's not the Dockerfile used in production.

**The health check lies:** Reports "ok" while Gemini is down, Solana is unreachable, or the DB connection pool is exhausted (unless `?db=true` is explicitly requested).

### 17.9 Monitoring & Alerting

**None configured.**

- No Azure Monitor alerts (CPU, memory, connections, error rate, response time)
- No diagnostic settings on the Postgres server
- No Application Insights
- No Prometheus / OpenTelemetry
- No Sentry / Datadog / BugSnag
- No slow query logging
- No metrics endpoint
- Terraform has zero `alert`, `monitor`, `diagnostic`, or `insight` resources

The Log Analytics workspace exists but only receives Container App stdout. No dashboards, no alert rules.

### 17.10 Error Recovery & Resilience

**No circuit breakers.** If Gemini is rate-limited, every incoming request hammers it until retries exhaust. If Solana RPC is down, every settlement attempt waits 60s (30 polls x 2s) before failing. No backpressure.

**Stuck transaction recovery:** If Gemini fails mid-settlement-pipeline:
- Transaction stays at `compliance_check` or `risk_scored` status permanently
- No watchdog, no timeout, no dead-letter queue
- No admin tool to resume or clean up stuck transactions (only `/retry-transaction` which re-runs the entire pipeline)

**Dependency failure behavior:**

| Dependency down | What happens |
|----------------|-------------|
| Postgres | All routes return 500. Health check still says "ok" (unless `?db=true`). Container keeps running. |
| Gemini | Agent-think, compliance, risk-score, cadenza all fail. Transactions get stuck mid-pipeline. No fallback. |
| Solana RPC | Settlements fail after 60s timeout. `checkBalance` returns 0 — wallets appear empty. `/agent-execute` properly reverts tx to `risk_scored` for retry. |
| All three | App appears healthy (200 on `/health`), serves cached/stale frontend data, every action fails with 500. |

**Balance display on RPC outage:** `checkBalance` and `getTokenBalance` catch all errors and return 0. Users see $0 balances with no error indication — indistinguishable from an actual empty account.

### 17.11 Summary

The error handling story is: **every layer catches errors and logs them to console, but almost nothing surfaces them to users or triggers automated recovery.**

```
Frontend:  Component throws → white screen (no error boundary)
           Fetch fails → console.log (no user feedback on 35/37 pages)
           Promise rejects → vanishes (no global handler)

Backend:   Route throws → 500 with raw error text (no structured envelope)
           SQL fails → 500 with Postgres error message leaked to client
           Gemini fails → transaction stuck forever (no watchdog)
           Solana fails → 60s hang then 500 (no circuit breaker)

Ops:       Logs → unstructured console.log to stdout
           Tracing → none (can't correlate frontend↔backend)
           Alerts → none configured
           Health → lies (only checks liveness, not readiness)
           Monitoring → none
```

---

---

## 18. Why Deno? — Forensic Trace

### 18.1 The Origin Story (Reconstructed from Git)

**Commit 1 (`1c44265`, Mar 18 2026):** "Initial commit — SolsticeAI from Figma export (secrets removed)"

The package.json name is `@figma/my-make-file`. The entire project was generated by **Figma Make** (Figma's AI code generation feature). Figma Make scaffolds a Vite + React frontend and outputs it as a project.

In this same initial commit, the `supabase/functions/server/` directory appears with 7,072 lines of `index.tsx` already written. The backend was built as a **Supabase Edge Function** — which runs on Deno Deploy. This is why Deno exists: Supabase Edge Functions only run on Deno. There was no choice.

Evidence:
- `supabase/functions/server/` is the standard Supabase Edge Function directory structure
- `supabase-admin.tsx` uses `jsr:@supabase/supabase-js` (JSR is the Deno-native registry)
- `utils/supabase/info.tsx` is an autogenerated Supabase project config file
- All backend imports use `npm:` and `jsr:` specifiers (Deno-native, not Node)

**Commit 2 (`7fde024`, Mar 19 2026):** "Add Dockerfile for Hono/Deno backend"

One day after the initial commit, the backend was containerized for Azure Container Apps. The Dockerfile uses `denoland/deno:1.44.0` and simply copies the Edge Function files as-is.

**Commit 3 (`54e73cd`, Mar 19 2026):** "Separate production database: migrate backend to Azure Postgres"

Same day. Replaced `supabase-admin.tsx` (Supabase client) with `db.tsx` (direct Postgres pool). Deleted the Supabase admin client. Added REST endpoints so the frontend could read from the backend instead of Supabase directly.

### 18.2 The Accidental Architecture

The sequence was:

1. Figma Make generates a React frontend (`@figma/my-make-file`)
2. Someone builds the entire backend as a Supabase Edge Function (Deno + Hono, reading/writing via Supabase client)
3. Within 24 hours, realizes Supabase Edge Functions can't handle the production workload → containerizes the Deno server for Azure
4. Same day, replaces Supabase database access with direct Postgres → but keeps the Deno runtime, the `supabase/functions/server/` directory structure, and all the `npm:` import specifiers

**Deno was never a deliberate technical choice.** It's a vestige of starting on Supabase Edge Functions. The project outgrew Supabase on day 1 but never migrated the runtime. The backend is still structured as an Edge Function that's been awkwardly shoe-horned into a Docker container.

### 18.3 What Deno Costs This Project

| Cost | Detail |
|------|--------|
| No `package.json` for backend | Dependencies resolved at runtime via `npm:` and `jsr:` specifiers. No lockfile, no reproducible builds. |
| No `tsconfig.json` support | Deno has its own config system (`deno.json`), but neither exists. TypeScript runs with defaults only. |
| No shared types between frontend and backend | Frontend uses `src/app/types.ts`, backend uses `any` everywhere. Can't share a package because they're different runtimes. |
| Deno 1.44 is ancient | Current stable is Deno 2.x. Deno 1.44 has known bugs and missing features. |
| No Node ecosystem integration | Can't use Node.js middleware, APM agents (Datadog, Sentry), or structured logging libraries without `npm:` prefix and compatibility issues. |
| Docker image is Deno-specific | `denoland/deno:1.44.0` base image. Can't use standard Node.js base images, multi-stage builds, or Node.js production tooling. |
| Two incompatible import systems | Frontend uses bare specifiers (`import { x } from 'react'`) resolved by Vite. Backend uses URL specifiers (`import { Pool } from "https://deno.land/x/postgres@v0.19.3/mod.ts"`). |
| IDE support fragmented | VSCode Deno extension conflicts with TypeScript extension. Need workspace-scoped settings to avoid errors in the frontend. |

### 18.4 What Migration Would Look Like

The backend could be migrated to Node.js with relatively low effort because:
- Hono works on Node.js (it's runtime-agnostic)
- `npm:` imports just need the `npm:` prefix removed
- The one Deno-specific import (`https://deno.land/x/postgres@v0.19.3`) → `npm:postgres` or `npm:pg`
- `Deno.env.get()` → `process.env.`
- `Deno.serve()` → Hono's Node adapter
- `jsr:@std/encoding` → `Buffer.from(...).toString('base64')`

The hard part isn't the runtime swap — it's that the backend needs to be restructured anyway (the 8,441-line monolith, circular dependencies, etc.), so you'd do both at once.

---

## 19. Repository Structure Audit

### 19.1 Current Layout

```
SolsticeAI/                          ← Root = Vite frontend project
├── package.json                     ← "@figma/my-make-file" (frontend only)
├── package-lock.json                ← Frontend deps only
├── vite.config.ts                   ← Frontend build config
├── postcss.config.mjs               ← Frontend CSS
├── index.html                       ← Frontend entry HTML
├── staticwebapp.config.json         ← Azure SWA config (auth, routes)
├── Dockerfile                       ← Backend Docker build (COPIES from supabase/)
├── .dockerignore
├── .env.example                     ← Mixed frontend + backend env vars
├── .gitignore                       ← 5 lines
├── CLAUDE.md                        ← AI agent instructions
├── AUDIT.md                         ← This file
├── README.md                        ← 11 lines
├── ATTRIBUTIONS.md                  ← 3 lines
├── CHANGELOG.md                     ← 67 lines
├── PROJECT_HISTORY.md               ← 1,914 lines (120 KB)
├── PROJECT_STATUS.md                ← 771 lines (72 KB)
├── src/                             ← FRONTEND source
│   ├── main.tsx
│   ├── app/                         ← All frontend code
│   ├── assets/                      ← One PNG with a hash filename
│   ├── imports/                     ← Dead code (see 19.3)
│   └── styles/                      ← CSS files
├── supabase/                        ← BACKEND source (misleading name)
│   ├── functions/server/            ← Deno/Hono API server
│   └── migrations/                  ← SQL migration files
├── infra/                           ← Terraform (Azure resources)
├── docker/                          ← Alternative Dockerfile (unused in prod)
├── guidelines/                      ← Empty Figma Make template
└── .github/workflows/               ← CI + Azure SWA deploy
```

### 19.2 What's Wrong

**The root is the frontend.** `package.json`, `vite.config.ts`, `index.html`, `postcss.config.mjs` — these are all frontend files living at the root. The backend is nested inside `supabase/functions/server/`, a path that implies it's a Supabase Edge Function (it's not anymore — it's a standalone Docker container).

**No shared code is possible.** The frontend is a Vite/Node.js project. The backend is Deno. They cannot share types, constants, utilities, or validation logic. This is why:
- `src/app/types.ts` defines `Bank`, `Transaction`, `Wallet`, `TxStatus`, `RiskLevel`, etc.
- The backend uses `any` everywhere and re-derives the same domain knowledge from raw SQL results
- Status values like `'initiated' | 'compliance_check' | 'risk_scored' | 'executing' | 'settled' | 'locked' | 'rejected' | 'reversed'` are defined as a TypeScript union in the frontend but are implicit string literals in the backend
- Risk level values, message types, and settlement types are similarly duplicated

**Two competing Dockerfiles:**
- `/Dockerfile` — production (port 8000, no health check)
- `/docker/Dockerfile` — alternative (port 8080, has health check, different CMD format)
- Neither references the other. `CLAUDE.md` documents the root Dockerfile.

**`supabase/` is a lie.** The name implies Supabase project structure, but:
- `supabase/functions/server/` is a standalone Deno HTTP server, not a Supabase Edge Function
- The backend doesn't use Supabase at all (it uses direct Postgres via `db.tsx`)
- `supabase/migrations/` contains SQL files applied manually, not via Supabase CLI
- There's no `supabase/config.toml` (the Supabase CLI config file)

**192 KB of project tracking docs in the repo root:**
- `PROJECT_HISTORY.md` — 1,914 lines, 120 KB. Detailed per-task development log.
- `PROJECT_STATUS.md` — 771 lines, 72 KB. Task tracker with status columns.
- These are AI-generated project management artifacts. They're useful context but shouldn't live in the repo root alongside source code.

**`src/imports/` is dead code.** Contains 4 files (52 KB) that are never imported by any source file:
- `fix-lockup-bug.ts` — a standalone script/snippet
- `pasted_text/compliance-agent-upgrades.md` — a markdown spec
- `pasted_text/network-command-page.tsx` — a component draft
- `pasted_text/supply-chain-viz.tsx` — another component draft

These are Figma Make's "pasted text" imports — reference material pasted into the AI tool. They're artifacts, not source code.

**`guidelines/Guidelines.md` is a blank template.** 62 lines of HTML comments explaining what guidelines could look like. Another Figma Make artifact.

**`src/assets/` has one PNG with a hash filename** (`525770ff6aafbf8b7bc340047eb93989c174c635.png`). No human could find or reference this.

**Mixed `.env.example`:** Frontend vars (`VITE_*`) and backend vars (`SOLANA_RPC_URL`, `GEMINI_API_KEY`, `DATABASE_URL`) are in the same file. In a monorepo, these would be separate `.env.example` files per package.

### 19.3 What a Clean Structure Would Look Like

```
coda/                                ← Monorepo root
├── package.json                     ← Workspace config (npm/pnpm/yarn workspaces)
├── turbo.json / nx.json             ← Build orchestration (optional)
├── tsconfig.base.json               ← Shared TypeScript config
│
├── packages/
│   ├── shared/                      ← Shared types, constants, validation
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── types.ts             ← Bank, Transaction, Wallet, TxStatus, etc.
│   │       ├── constants.ts         ← Status values, risk levels, purpose codes
│   │       └── validation.ts        ← Amount parsing, Zod schemas
│   │
│   ├── web/                         ← Frontend (React + Vite)
│   │   ├── package.json
│   │   ├── tsconfig.json            ← extends ../../tsconfig.base.json
│   │   ├── vite.config.ts
│   │   ├── index.html
│   │   ├── .env.example             ← Frontend env vars only
│   │   └── src/
│   │       ├── app/                 ← Components, hooks, contexts
│   │       └── styles/
│   │
│   └── api/                         ← Backend (Node.js + Hono)
│       ├── package.json
│       ├── tsconfig.json            ← extends ../../tsconfig.base.json
│       ├── Dockerfile
│       ├── .env.example             ← Backend env vars only
│       └── src/
│           ├── index.ts             ← Server entry
│           ├── routes/              ← Route modules (broken out of monolith)
│           ├── services/            ← Business logic
│           ├── db/                  ← Database layer
│           ├── agents/              ← AI agent orchestration
│           ├── blockchain/          ← Solana operations
│           └── middleware/          ← Auth, logging, error handling
│
├── infra/                           ← Terraform
├── migrations/                      ← Database migrations (with runner config)
├── .github/workflows/               ← CI/CD
└── docs/                            ← PROJECT_HISTORY, PROJECT_STATUS, etc.
```

**What this gives you:**
- `packages/shared` — types, constants, and validation shared between frontend and backend. One source of truth for `TxStatus`, `RiskLevel`, amount parsing, etc.
- Separate `package.json` per package — frontend and backend have independent dependency trees
- Separate `tsconfig.json` per package with a shared base — `strict: true` everywhere
- Backend on Node.js — access to the entire npm ecosystem without `npm:` prefix hacks
- Separate `.env.example` per package — no mixing of `VITE_*` and server secrets
- Backend source in `src/routes/`, `src/services/`, etc. — not one 8,441-line file
- Migrations at the monorepo root with a runner tool — not buried in `supabase/`
- Docs in `docs/` — not 192 KB of markdown at the repo root

### 19.4 Dead Code and Artifacts to Remove

| Item | Size | Reason |
|------|------|--------|
| `src/imports/` | 52 KB | Never imported. Figma Make pasted-text artifacts. |
| `src/app/db.ts` | ~200 lines | Dead code. Never imported by any file. |
| `guidelines/Guidelines.md` | 62 lines | Blank Figma Make template. |
| `docker/Dockerfile` | 27 lines | Competing Dockerfile, not used in production. |
| `utils/` | (deleted in later commit) | Was Supabase autogenerated config with hardcoded anon key. |
| `src/assets/525770ff...png` | Unknown | Hash-named PNG. Check if actually used. |

### 19.5 Figma Make Artifacts Still in the Codebase

The project was scaffolded by Figma Make and still carries these traces:

| Artifact | Location |
|----------|----------|
| Package name `@figma/my-make-file` | `package.json` line 2 |
| Route prefix `/make-server-49d15288/` | Every backend endpoint (80+ routes) |
| `guidelines/Guidelines.md` blank template | `guidelines/` |
| Pasted text reference files | `src/imports/pasted_text/` |
| KV table name `kv_store_49d15288` | Database, `kv_store.tsx` |

The `49d15288` hash appears in the route prefix, KV table name, and the Supabase function name. It's a Figma Make project identifier baked into production URLs and database schema.

---

---

## 20. Rebuild Brief

### 20.1 Verdict

This codebase cannot be incrementally fixed into a production-grade system. The accumulated debt — no auth, no types, no tests, a monolith backend on an accidental runtime, a database open to the internet — means that fixing any one issue properly requires touching nearly everything else. A rebuild that preserves the domain knowledge and feature concepts is the correct path.

### 20.2 What to Keep (Concepts Only — Not Code)

**Domain model:**
- Five-agent decomposition: Maestro (orchestration), Concord (compliance), Fermata (risk), Cadenza (dispute resolution), Aria (NL config assistant)
- Agent prompt structures and the separation of prompt modules from orchestration logic
- The concept of per-bank agent configuration with network-level defaults

**Settlement model:**
- Token-2022 burn-and-mint PvP atomic swap (each bank issues its own tokenized deposit)
- Three-token lockup escrow with LOCKUP-USTB permanent delegate
- Risk-gated bifurcation: low risk → instant PvP, elevated risk → lockup with configurable duration
- User-forced lockup override (negative duration convention or equivalent)
- ISO 20022 pacs.009 on-chain memo format with byte-size guards

**Transaction state machine:**
- `initiated → compliance_check → risk_scored → executing → settled` (PvP path)
- `initiated → compliance_check → risk_scored → executing → locked → settled/reversed` (lockup path)
- The 4-step pipeline: compliance → risk → agent decision → on-chain execution

**Database schema:**
- The 23-table design is sound. Rebuild with proper FK constraints, indexes, and a migration runner.
- Risk rules table with deterministic scoring (R-001 through R-014)
- Cadenza flags, lockup tokens, compliance logs, risk scores as separate audit trail tables

**Infrastructure patterns:**
- Dual environment (Azure prod, Supabase/local staging) with env-var switching
- Terraform for Azure resources (but fix the firewall, secrets, and cross-region issues)
- Azure Static Web Apps for frontend, Container Apps for backend

**UI/UX features (as feature specs, not component code):**
- Dashboard with settlement stats, pipeline visualization, liquidity gauges
- Agent terminal (chat-based settlement initiation)
- Transaction monitor with detail view
- Escalation dashboard with Cadenza resolution
- Heartbeat/treasury cycle control
- Network Command (globe visualization)
- Proving Ground (scenario testing)
- Admin console, settings, user profile management
- Persona/role-based views (treasury, compliance, BSA officer, executive, admin)

### 20.3 Target Architecture

**Monorepo (pnpm/npm workspaces):**

```
coda/
├── packages/
│   ├── shared/          ← Types, constants, validation (Zod schemas)
│   ├── web/             ← React + Vite frontend
│   └── api/             ← Node.js + Hono backend
├── migrations/          ← SQL migrations (with dbmate or similar)
├── infra/               ← Terraform
└── .github/workflows/   ← CI/CD
```

**Backend — Node.js + Hono (not Deno):**
- Hono is runtime-agnostic — the migration is straightforward
- Layered architecture: routes → services → repositories → external clients
- Shared types from `packages/shared` — one source of truth
- Proper auth middleware (validate Azure SWA `X-MS-CLIENT-PRINCIPAL` or JWT)
- Structured JSON logging (pino)
- Zod validation on all AI responses and API inputs
- Error middleware with request IDs and structured error envelopes

**Frontend — React 19 + TypeScript strict (stack decision pending):**

This is a greenfield rebuild. The existing codebase is not being migrated — it's being replaced. Stack decisions should be evaluated purely on merit for the app being built: an authenticated, data-heavy, real-time financial dashboard with ~15 routes, a separate Hono API backend, and deployment to Azure.

**Option A: React Router 7 Framework Mode**

SSR framework built into React Router as a Vite plugin. Loaders, actions, streaming, nested routes.

| | |
|---|---|
| SSR | Yes — loaders fetch data server-side with the user's auth. Content on first paint. |
| Data loading | Loaders — parallel, per-route, server-side. |
| Mutations | Actions — built-in pending/error states. |
| Auth | `requireAuth()` in root loader. No dedicated middleware file — requires manual pattern. |
| Error boundaries | Per route segment (built-in). |
| Build | Vite plugin. |
| Deploy | Node server on Container Apps. |
| Complexity | Low-medium. |

Pros:
- Lightest SSR framework opinion. Handles routing + SSR + data loading, everything else is your choice.
- Vite-native. Fast DX.
- Loader/action model is clean and easy to reason about.

Cons:
- No built-in auth middleware file (manual pattern).
- Smaller community than Next.js. Framework mode docs still maturing (Remix → RR convergence).
- Newer path — fewer battle-tested production deployments.

**Option B: Next.js (App Router)**

Industry default. Largest ecosystem, most opinionated, most battle-tested.

| | |
|---|---|
| SSR | Yes — server components fetch data directly. The component IS the data loader. |
| Data loading | Server components + `fetch` with caching. |
| Mutations | Server actions (`"use server"` functions). |
| Auth | `middleware.ts` — single file, gates every request. |
| Error boundaries | `error.tsx` per route segment. |
| Build | Turbopack (not Vite). |
| Deploy | Node server on Container Apps. Self-hostable, not locked to Vercel. |
| Complexity | Highest. |

Pros:
- Largest ecosystem and hiring pool. Every problem has a public solution.
- `middleware.ts` for auth is a single-file solution to CODA's biggest gap.
- Server components: data-heavy pages ship zero client JS for non-interactive parts.
- Most production battle-tested. Proven at scale.

Cons:
- Most complex mental model. Server vs client components, `"use client"` boundaries, caching behavior.
- Caching layer is confusing and has changed between versions. Real-time dashboard will fight it.
- Not Vite. Different DX, different plugin ecosystem.
- Heavy framework opinion — more magic, more implicit behavior.

**Option C: TanStack Start**

Best-in-class data loading and type safety. TanStack Query + Router unified with a server layer. Currently in beta.

| | |
|---|---|
| SSR | Yes — loaders with TanStack Query integration. |
| Data loading | TanStack Query at the core. Loaders with automatic cache integration. |
| Mutations | Server functions — call server code like regular functions. |
| Auth | Custom (manual pattern, similar to RR7). |
| Type safety | Best-in-class — full-stack, route params through loaders through components. |
| Build | Vite-based. |
| Deploy | Node server with adapters. |
| Complexity | Medium. |

Pros:
- TanStack Query is the data layer, not an add-on. Best fit for a data-heavy real-time dashboard.
- Full-stack type safety with zero casting.
- Vite-based, clean mental model.
- If it stabilizes, this is the strongest overall option for CODA's use case.

Cons:
- **Beta.** API could change. Docs incomplete. Edge cases undiscovered.
- Tiny community. You're reading source code when you hit problems.
- Unclear production track record.
- Revisit when 1.0 ships.

**Option D: Vite SPA + TanStack Router + TanStack Query**

No SSR. Client-side SPA with the best routing and data-fetching libraries in the React ecosystem. Both stable, both designed to work together.

| | |
|---|---|
| SSR | No. Client-side rendering only. |
| Data loading | TanStack Query — cache, refetch, optimistic updates, prefetching. Mature and stable. |
| Route-level loading | TanStack Router `loader` prefetches queries before component mounts. No waterfall. |
| Mutations | TanStack Query `useMutation` — built-in pending/error/success states. |
| Auth | TanStack Router `beforeLoad` — type-safe route guards. Backend validates every request server-side. |
| Type safety | TanStack Router is fully type-safe — route params, search params, loader data all inferred. |
| Build | Vite. Pure, fast, no framework layer. |
| Deploy | Azure Static Web Apps (static files, no server). Simplest deployment. |
| Complexity | Lowest. |

Pros:
- **No frontend server.** Static files on a CDN. The Hono API is the only server. Simplest infra.
- **TanStack Query is the most battle-tested data library in React.** You'd use it regardless of framework.
- **TanStack Router type safety is the best of any React router.** Zero `as` casts, zero runtime surprises.
- **Loader prefetching** closes most of the SSR gap — data loads before the component mounts, cached data renders instantly on re-navigation.
- **Cleanest upgrade path.** If TanStack Start stabilizes and you want SSR, add the server layer on top of the same Router + Query. Additive, not a rewrite.
- **Simplest mental model.** No server/client boundary, no "which code runs where," no hydration mismatches.

Cons:
- **No SSR.** First paint is a loading state while JS loads and queries fire. Loaders and prefetching mitigate but don't eliminate.
- **Auth is client-side only.** Route guards run in the browser. Server-side auth is the Hono API's responsibility.
- **No server-side middleware.** Can't intercept requests before they reach the client.
- **Larger client bundle** than SSR options. Route-based code splitting (TanStack Router lazy routes) helps.

**Decision criteria:**

| If you value... | Choose |
|----------------|--------|
| SSR with lightest framework opinion | Option A (RR7) |
| Largest ecosystem, built-in auth middleware | Option B (Next.js) |
| Best data layer + type safety (when stable) | Option C (TanStack Start) |
| Simplest architecture, no frontend server | Option D (Vite + TanStack) |
| Best data layer + type safety NOW (stable) | Option D (Vite + TanStack) |
| Simplest mental model | Option D (Vite + TanStack) |
| Minimum ecosystem risk | Option B (Next.js) |
| Upgrade path to SSR later | Option D → C (TanStack Start) |
| SSR is a requirement today | Option A or B |

**Architecture note:** CODA has a separate Hono API backend that owns all business logic, data access, auth validation, and blockchain operations. The frontend's job is to call that API and render results. Options A-C add a frontend Node server between the browser and the API (for SSR). Option D keeps it simple — browser calls API directly, static files on CDN. Both patterns are valid. The question is whether SSR's first-paint benefit justifies a second server.

**Database — Azure Postgres with proper setup:**
- Migration runner (dbmate, Flyway, or golang-migrate) integrated into CI
- FK constraints on all relationships
- Connection pooling with health checks (PgBouncer or pooler config)
- Firewall locked to Container App VNet only
- Secrets in Azure Key Vault, referenced as Container App secrets

**Auth — Real authentication:**
- Backend middleware validates identity on every request
- Azure SWA `X-MS-CLIENT-PRINCIPAL` header validation (production)
- Supabase JWT validation (staging)
- Role-based access enforced server-side, not client-asserted headers
- Admin actions gated by verified identity + passkey MFA

**Observability:**
- Structured JSON logs → Azure Log Analytics
- Request tracing with correlation IDs (frontend → backend → external)
- Health check that verifies all dependencies (DB, Gemini, Solana RPC)
- Azure Monitor alerts (error rate, latency, connection exhaustion)
- React Error Boundary with error reporting

**Blockchain:**
- Idempotency keys on all on-chain operations
- Atomic-or-compensating pattern for multi-step lockup flows (if step 2 fails, automated recovery for step 1)
- Circuit breaker for Solana RPC and Gemini API
- Honest key naming (`keypairBase64`, not `keypairEncrypted`) — and a roadmap to actual KMS

**Testing:**
- Integration tests for the settlement pipeline (both PvP and lockup paths)
- API route tests with a test database
- Frontend component tests for critical flows (auth, settlement initiation)
- CI runs type-check, lint, and tests on every PR

### 20.4 Sequencing

**Phase 1 — Foundation (scaffold, no features):**
- Monorepo setup with shared types package
- Node.js + Hono backend with layered architecture (empty routes)
- Auth middleware that actually validates identity
- Database with migration runner and FK constraints
- CI with type-check + lint + test
- Structured logging and health check
- React app shell with error boundary and router

**Phase 2 — Core settlement (the thing that matters):**
- Bank setup and wallet management
- Transaction creation and state machine
- Solana Token-2022 operations (PvP burn-and-mint)
- Compliance check pipeline
- Risk scoring (deterministic rules + AI)
- Agent orchestration (Maestro think/decide/execute)
- Integration tests for the full pipeline

**Phase 3 — Lockup and dispute resolution:**
- Lockup escrow flow (three-token model)
- Cadenza monitoring and auto-resolution
- Hard finality and reversal paths
- Recovery mechanism for partial lockup failures
- Escalation dashboard

**Phase 4 — Full feature set:**
- Treasury cycles and heartbeat
- Aria (NL config assistant)
- Proving Ground (scenario testing)
- Network Command (visualization)
- Persona/role-based views
- Notifications and activity feeds
- User management and sessions

**Phase 5 — Production hardening:**
- Azure Key Vault integration
- Firewall lockdown
- Monitoring and alerting
- Circuit breakers for external services
- Performance testing
- Stuck transaction watchdog

### 20.5 What This Audit Provides for the Rebuild

This document serves as the functional specification. It contains:

- Every API endpoint and what it does (Section 12, traced end-to-end)
- Every database table and its relationships (Section 9, 14.8)
- Every state transition in the settlement pipeline (Section 12.2-12.6)
- Every on-chain operation and its parameters (Section 12.5-12.6)
- Every AI agent's role, prompt structure, and response format (Section 5.3, prompt module files)
- Every known failure mode and what should happen instead (Section 12.7, 17.10)
- Every security requirement (Section 13)
- The complete dependency tree (Sections 6-7)
- The infrastructure setup (Sections 8, 16)

The rebuild doesn't need to reverse-engineer the current system. This audit already did that.

---

---

## 21. Overlooked Areas

### 21.1 RLS Policies: "Allow All for Demo"

Supabase Row-Level Security is enabled on 9 tables in the Supabase migration, but every policy is:

```sql
CREATE POLICY "Allow all for demo" ON "public"."transactions" USING (true) WITH CHECK (true);
```

RLS is turned on but every policy says "allow everything." This is security theater — it gives the appearance of access control while providing none. Any Supabase client with the anon key has full read/write access to all rows in all tables.

Tables with RLS enabled but "allow all" policies: `agent_conversations`, `agent_messages`, `bank_agent_config`, `banks`, `compliance_logs`, `kv_store_49d15288`, `risk_scores`, `transactions`, `wallets`.

Tables with no RLS at all: `cadenza_flags`, `heartbeat_cycles`, `lockup_tokens`, `network_snapshots`, `network_wallets`, `simulated_watchlist`, `treasury_mandates`, and all user/enterprise tables.

The Azure migration (`20260319`) strips RLS entirely — production Postgres has no row-level policies. This is actually correct since the backend connects with a single admin pool, but it means the database has zero access control at any layer.

### 21.2 API Input Validation: Almost None

The ~80 route handlers have minimal input validation. The pattern is:

```typescript
const { bank_id, input } = body;
if (!bank_id || !input) return c.json({ error: "Missing required fields" }, 400);
// ... immediately use bank_id in SQL query
```

**What's validated:** Presence of required fields (null/undefined checks). A few routes check string format (e.g., base58 for wallet addresses). The `user/profile-update` route validates role against an allowlist (but allows self-escalation to admin).

**What's NOT validated:**
- No type checking on any field (a number where a string is expected just passes through)
- No length limits on string fields (memo, content, reasoning could be arbitrarily large)
- No format validation on UUIDs (invalid UUID → Postgres error leaked to client)
- No range validation on numeric fields (negative amounts, absurd lockup durations)
- No Zod, no Joi, no JSON schema, no validation library of any kind
- `JSON.parse()` on KV store values with no try/catch in many places (lines 440, 484, 499, 1101, etc.) — malformed KV data crashes the route

The mandate validation at line 4587-4591 is one of the few places that clamps values, but it operates on AI-generated output, not user input.

### 21.3 Rate Limiting: None on the API

There is zero rate limiting on any endpoint. The only rate-limiting behavior is:
- Gemini wrapper retries on 429 (Gemini's own rate limit)
- `sleep()` delays between heartbeat cycle bank evaluations to avoid Gemini 429s
- Frontend staging queue (350ms gap between requests to avoid Supabase 429s)

**No rate limiting exists on the backend itself.** Any client can:
- Call `/agent-think` thousands of times, burning Gemini API credits
- Call `/agent-execute` repeatedly, attempting to settle the same transaction
- Call `/data/*` endpoints at any rate, hammering the database
- Call `/faucet` repeatedly, draining the faucet wallet

For the rebuild: Hono has rate-limiting middleware (`hono/rate-limiter`) or use a dedicated package. Critical for Gemini-calling endpoints and settlement operations.

### 21.4 Secrets in Git History

The initial commit (`1c44265`) contains `utils/supabase/info.tsx` with:
- Supabase project ID: `daekdqzghrjneftpvnfy`
- Supabase anon key (full JWT): `eyJhbGciOiJI...`

The commit message says "secrets removed" but the anon key is committed. Anon keys are semi-public by Supabase's design (they're meant for client-side use), but this one grants access to the Supabase database through the "Allow all for demo" RLS policies.

No actual secrets (service role key, database password, Gemini API key, faucet keypair) were found in git history. Terraform state is stored in Azure Blob Storage (not committed). No `.tfstate` or `terraform.tfvars` files in the repo.

### 21.5 Memory Leaks: Uncleared Timers in AgentTerminal

`AgentTerminal.tsx` creates **cascading `setTimeout` chains** that are never cleaned up:

```typescript
// Lines 326-352 — triggered on every realtime message
setTimeout(() => refreshPipelineFromDB(scTxId), 500);
setTimeout(() => refreshPipelineFromDB(scTxId), 2000);
setTimeout(() => {
  // ...
  setTimeout(() => refreshWalletDirect(), 1000);
  setTimeout(() => refreshWalletDirect(), 3000);
}, 5000);
setTimeout(() => refreshPipelineFromDB(msg.transaction_id!), 500);
setTimeout(() => refreshPipelineFromDB(msg.transaction_id!), 2000);
setTimeout(() => refreshPipelineFromDB(msg.transaction_id!), 5000);
setTimeout(() => refreshPipelineFromDB(msg.transaction_id!), 8000);
setTimeout(() => refreshPipelineFromDB(msg.transaction_id!), 12000);
```

These fire on every realtime subscription message. If the user navigates away from the page before the timers complete, the callbacks still execute against a stale/unmounted component. The `setTimeout` IDs are never stored in refs and never cleared in cleanup functions.

The realtime channel subscriptions themselves ARE properly cleaned up (`return () => { supabase.removeChannel(channel) }`), but the cascading timers are not.

`useNetworkSimulation.ts` is cleaner — it properly cleans up channels, animation frames, and uses a `cancelled` flag for async operations.

### 21.6 Accessibility: Minimal

72 ARIA-related attributes found across 31 files — but almost entirely from the shadcn/ui primitives (which include `aria-*` and `role` attributes by default). The page-level components have almost zero accessibility work:

- No skip-to-content link
- No landmark regions on page components
- No focus management on route changes
- No announcements for async operations (settlement status changes, pipeline progress)
- No keyboard navigation for custom interactive elements (pipeline visualizer, agent terminal chat)
- Color contrast may be an issue with the dark theme and muted text colors (`text-coda-text-muted`)

For a financial platform, WCAG compliance would be expected. The shadcn/ui primitives provide a solid base, but the page-level components built on top of them have no accessibility consideration.

### 21.7 Bundle Size

Not measured during this audit, but the dual UI framework issue (MUI + shadcn/Radix) means the production bundle includes:
- `@mui/material` + `@emotion/react` + `@emotion/styled` (~300KB minified)
- 20 `@radix-ui/*` packages (~150KB minified)
- `mapbox-gl` (~500KB minified — loaded on NetworkCommand page)
- `recharts` + `d3` subset (~200KB minified)
- `motion` (Framer Motion) (~100KB minified)
- `lottie-react` + animation data (variable)

With only one route using `React.lazy()` (EscalationDashboard), most of this ships in the initial bundle. For the rebuild: route-based code splitting on every route is mandatory, and pick one UI framework.

### 21.8 Concurrency Issues Beyond Settlement

The settlement flow race conditions were covered in Section 12.7. Additional concurrency gaps:

- **Bank config updates vs active settlements:** An Aria config change (risk weights, auto-accept ceiling) takes effect immediately. An in-flight transaction that already passed risk scoring with the old config will execute with stale risk parameters. No versioning or snapshotting of config at transaction creation time.
- **Treasury cycle overlap:** If a heartbeat cycle takes longer than the interval, the next cycle can start before the previous one finishes. No mutex or cycle-in-progress guard exists.
- **KV store race conditions:** The custodian/fees wallet data is stored in KV (`kv.get` → modify → `kv.set`). Two concurrent requests can read the same value, both modify it, and one overwrites the other. No atomic read-modify-write.

---

### 21.9 Load Balancing, Scaling & Work Distribution: None

**What exists:** Azure Container Apps config has `min_replicas = 0` (scale to zero), `max_replicas = 3`. Container Apps has a built-in HTTP load balancer that round-robins across replicas. That's it.

**The backend is built assuming a single process.** With multiple replicas:

| Problem | Detail |
|---------|--------|
| **No job queue** | Long-running operations (settlement pipeline, Cadenza scans, treasury cycles) run inline in HTTP handlers. No Bull/BullMQ, no Redis, no message queue. If a replica scales down mid-operation, the work is lost. |
| **Fire-and-forget is per-process** | `coreOrchestrate()` runs as a fire-and-forget function call on the replica that handled the initiating request. If that replica scales down mid-pipeline, the settlement is abandoned with no recovery. |
| **No distributed locking** | Heartbeat/treasury cycles have no coordination. Two replicas processing `/network-heartbeat` simultaneously create duplicate cycles with duplicate transactions. |
| **KV store race conditions** | Two replicas doing `kv.get` → modify → `kv.set` on custodian/fees data simultaneously overwrite each other. No atomic read-modify-write, no optimistic concurrency. |
| **Connection pool exhaustion** | Each replica creates 10 Postgres connections. 3 replicas = 30 connections against B_Standard_B1ms's ~50 limit. No external pooler (PgBouncer). Under load, new replicas can't connect. |
| **No sticky sessions** | Sequential frontend calls for a single settlement flow can hit different replicas. The `agent-think` → `coreOrchestrate` fire-and-forget assumes same-process handling. |
| **Cold starts** | `min_replicas = 0` means first request after idle boots a Deno container, caches all `npm:` deps, and establishes a DB pool. For a financial platform, this latency spike is unacceptable. |

**What the rebuild needs:**
- A job queue (BullMQ + Redis, or Azure Service Bus) for long-running operations — settlements, Cadenza scans, treasury cycles should be enqueued, not run inline
- Distributed locking (Redis or Postgres advisory locks) for heartbeat cycles and any singleton operations
- An external connection pooler (PgBouncer sidecar or Azure's built-in Postgres pooler) to manage connection limits across replicas
- `min_replicas = 1` minimum in production — no cold starts for a financial platform
- Idempotency keys on all enqueued work so duplicate delivery doesn't cause duplicate settlements

### 21.10 Database Transactions: None

Every SQL statement in the codebase is a separate auto-committed transaction. The `sql` tagged template in `db.tsx` grabs a connection from the pool, runs one query, releases the connection. There is no concept of holding a connection across multiple queries and no `BEGIN`/`COMMIT`/`ROLLBACK` anywhere.

**Impact on the settlement pipeline:**

The PvP settlement path executes these as independent commits:
1. `UPDATE transactions SET status = 'executing'`
2. _(Solana call — 2-60 seconds)_
3. `UPDATE wallets SET balance_tokens = ...` (sender)
4. `UPDATE wallets SET balance_tokens = ...` (receiver)
5. `UPDATE transactions SET status = 'settled', solana_tx_signature = ...`
6. `INSERT INTO agent_messages ...`

If the process dies between step 3 and step 4, sender balance is updated but receiver balance is not. Transaction is stuck at `executing`. Data is permanently inconsistent.

**Operations that need transaction wrapping:**

| Operation | Writes that must be atomic |
|-----------|---------------------------|
| Settlement complete (PvP) | wallets x2 + transaction status + agent_message |
| Lockup initiate | lockup_tokens + transaction status + wallets + agent_message |
| Lockup settle (hard finality) | lockup_tokens + transaction status + wallets + yield sweep |
| Lockup reversal | lockup_tokens + transaction status + wallets |
| Compliance pipeline | compliance_logs x5 + transaction status |
| Bank setup | banks + wallets + bank_agent_config |

**What the rebuild needs:**

A `withTransaction` wrapper in the repository layer:

```typescript
await withTransaction(async (tx) => {
  await transactionRepo.updateStatus(tx, id, 'settled', { signature });
  await walletRepo.updateBalance(tx, senderId, senderBalance);
  await walletRepo.updateBalance(tx, receiverId, receiverBalance);
  await agentMessageRepo.create(tx, { ... });
  // ALL commit or ALL roll back
});
```

Repository functions accept an optional transaction client. Inside `withTransaction`, they share a connection and commit/rollback atomically. Outside, they use the pool normally (auto-commit for simple reads).

**Nuance with blockchain operations:** Postgres transactions cannot wrap Solana calls. The pattern is:

1. `BEGIN` → validate, lock rows (`SELECT FOR UPDATE`), write pre-state → `COMMIT`
2. Execute Solana call (outside any DB transaction — irreversible)
3. `BEGIN` → write results (balances, signatures, status) → `COMMIT`

The DB writes before and after the chain call are each atomic. The chain call itself can't be rolled back — which is why idempotency keys and a recovery mechanism for "Solana succeeded but DB write failed" are also required (see Section 12.7).

---

## 22. Frontend Framework Decision

### 22.1 Constraints Established

Through discussion, several decisions were locked in before the framework choice:

- **This is a greenfield rebuild.** The existing codebase is not being migrated. Stack decisions are evaluated on merit, not migration path.
- **A framework is the way to go.** Rolling your own SSR/data-loading/caching on top of React Router is just building a worse framework. Let the framework handle plumbing.
- **better-auth for authentication.** Framework-agnostic, works with any option.
- **TanStack Query for data.** Non-negotiable for a real-time settlement dashboard — cache control, refetch intervals, optimistic updates, invalidation.
- **Separate Hono API backend.** The frontend framework is a rendering layer, not the business logic server.

### 22.2 Final Shortlist: Next.js vs TanStack Start

The decision narrowed to two options after eliminating plain SPA (needs SSR for heavy pages) and React Router 7 framework mode (if you're going framework, go all the way).

**TanStack Start — Updated Status (April 2026):**
- v1 Release Candidate (March 2026). API frozen, considered stable. Not beta.
- Full SSR, streaming, server functions, middleware, API routes
- Built on Vite, TanStack Router + Query as first-class core
- End-to-end type safety (route params → loaders → components)
- ~30-35% smaller client bundles than Next.js in benchmarks
- ~5.5x throughput (2,357 req/s vs 427 req/s in published benchmarks)
- RSC support experimental/coming — designed as opt-in, not default paradigm
- Deploys anywhere (Node adapter)

**Next.js — Current strengths:**
- Largest ecosystem, most tutorials, most Stack Overflow answers
- `middleware.ts` for auth gating (single file)
- RSC production-ready today
- `"use cache"` directive (new, more opt-in caching model)
- Server components: zero client JS for non-interactive page sections
- Most production battle-tested

### 22.3 Comparison for CODA's Use Case

| | Next.js | TanStack Start |
|---|---|---|
| Routing | File-based conventions | File-based, fully type-safe |
| Data loading | Server components + fetch | Loaders + TanStack Query (integrated) |
| Caching | Built-in (complex, `"use cache"` improving it) | TanStack Query (explicit, you control it) |
| Dynamic rendering | Per-route config (`force-dynamic`) | SSR by default, opt into static |
| Server functions | Server actions (`"use server"`) | Server functions with middleware |
| Auth | `middleware.ts` | Middleware support (better-auth works in both) |
| Build tool | Turbopack | Vite |
| Bundle size | Larger | ~30-35% smaller |
| Throughput | Baseline | ~5.5x in benchmarks |
| RSC | Production-ready | Experimental (opt-in, coming) |
| Type safety | Good (gaps at boundaries) | Best-in-class (end-to-end) |
| Ecosystem | Largest | Smaller, growing fast |
| Mental model | Implicit (framework magic) | Explicit (you control what happens) |
| Maturity | Years of production | RC, approaching 1.0 final |

### 22.4 Recommendation: TanStack Start

For CODA specifically, the deciding factors:

1. **TanStack Query is already the data layer.** In Next.js, Query sits alongside the framework's own caching — two systems doing similar things, sometimes conflicting. In Start, it's the core. No redundancy, no conflict.

2. **Explicit caching for a financial dashboard.** You need to know exactly when data is fresh and when it's stale. Query's `staleTime`, `refetchInterval`, and `invalidateQueries` are precise tools. Next.js's caching — even with `"use cache"` — is another layer to learn and debug on top of that.

3. **End-to-end type safety.** This app has a complex domain — transaction statuses, risk levels, settlement types, agent configs with 20+ parameters. Type errors at route boundaries are exactly the bugs the current codebase is full of. Start catches them at compile time.

4. **Vite across the monorepo.** The backend is Hono (Vite-compatible). The shared types package is plain TypeScript. Frontend on Vite means one build tool for the entire monorepo. Next.js Turbopack is a different universe.

5. **The RC is stable enough.** API is frozen. The team is polishing docs and edge cases, not redesigning. This is not a bet on beta software.

**What you give up:** Next.js's ecosystem depth when Googling a problem. But the Start-specific surface area (server functions, middleware, file-based routes) is small. The core libraries — React, TanStack Query, TanStack Router — are all well-documented independently.

### 22.5 Sequencing Note

The framework choice only affects `packages/web/`. The rebuild should start with the backend (Phase 1): monorepo scaffold, shared types, Hono API with auth middleware, database with migrations and FK constraints, CI pipeline. None of that depends on the frontend framework. By the time the API is solid and you're building UI, TanStack Start will likely have shipped 1.0 final.

---

*This audit captures the state of the codebase as of commit `f83be40` on `main`.*
*Completed 2026-04-11/13. Sections: structural analysis (1-11), settlement flow trace (12), auth security audit (13), database access patterns (14), updated triage (15), production database (16), error handling & observability (17), Deno forensics (18), repo structure (19), rebuild brief (20), overlooked areas (21), frontend framework decision (22).*
