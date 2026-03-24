# Changelog

## 2026-03-24 — Custodian Reassignment + Infra Wallet Faucet

- **Custodian dropdown selector** — pick any active bank as universal custodian (replaces hardcoded BNY/TBD)
- **Reassign custodian** endpoint with typed confirmation ("REASSIGN") for safety
- **Dynamic KV scan** — `custodian-status` scans `infra:custodian:*` instead of hardcoded key
- **Infra wallet faucet buttons** — custodian and fees wallet cards now have one-click "Fund Wallet (100 SNT)" on production (replaces "Fund via Solstice CLI" text)
- **KV store `scan(prefix)`** method for LIKE-based key queries

## 2026-03-24 — Polling-Based Transaction Confirmation

- **`sendAndPollTransaction`** replaces all `sendAndConfirmTransaction` calls across the codebase
- Polls `getSignatureStatuses` every 2s for up to 60s instead of using `lastValidBlockHeight` (which expires on Solstice Network's fast block production)
- Applied to: token mint creation, ATA creation, MemoTransfer setup, supply minting, settlements, burns, lockup tokens, fee transfers

## 2026-03-20 — SNT Faucet + Admin Gate

- **Faucet via keypair transfer** — `SystemProgram.transfer` from pre-funded faucet wallet (`FAUCET_KEYPAIR` env var). Falls back to `requestAirdrop` on Devnet.
- **100 SNT per request** (max 500) for testing runway
- **Admin-gated endpoints** — all Network Setup endpoints require `X-Admin-Email` header matching `ADMIN_EMAIL` env var: setup-bank, setup-custodian, faucet, reset-network, reset-tokens, seed-mandates, backfill-swift
- **Frontend `adminCallServer`** wrapper auto-attaches admin email header

## 2026-03-20 — Test Banks for Production

- **Generic test bank names** — Test Bank Alpha (TBA), Bravo (TBB), Charlie (TBC), Delta (TBD) replace real bank names (JPMorgan, Citibank, etc.) in production
- **TBD as test custodian** — Test Bank Delta serves as universal custodian
- **Fixed SQL INSERT** helper for `deno-postgres` tagged template compatibility
- **Dynamic custodian** code selection based on environment

## 2026-03-19 — Production Database Separation (Task 139)

- **Backend migrated from Supabase to Azure Postgres** — all ~190 Supabase calls converted to direct SQL via `deno-postgres`
- **18 REST GET endpoints** under `/data/` prefix for frontend reads
- **Frontend `dataClient.ts`** abstraction layer — routes to REST (production) or Supabase (staging) based on `VITE_SERVER_BASE_URL`
- **All frontend components migrated** — Dashboard, TransactionMonitor, TransactionDetail, NetworkInfrastructureWidget, useNetworkSimulation
- **Clean Azure Postgres migration** — no Supabase-specific extensions, `gen_random_uuid()` instead of `extensions.uuid_generate_v4()`
- **`db.tsx`** — deno-postgres connection pool with SSL and fail-fast on missing `DATABASE_URL`
- **`supabase-admin.tsx` deleted** — no longer needed

## 2026-03-18 — Frontend Data Split-Brain Fix

- **All frontend reads routed through `dataClient.ts`** — eliminates split-brain where some components read Supabase directly while others use REST
- **`fetchCount()`** for dashboard aggregate queries
- **Environment-aware routing** — `useServer` flag determines data source at build time
