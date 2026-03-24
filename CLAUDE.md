# CLAUDE.md — Project Context for AI Agents

## Project Overview

**CODA (Consortium fOr Digital Assets)** — Institutional digital asset settlement platform powered by Solstice Protocol. Multi-agent AI system for cross-bank Token-2022 settlement on Solstice Network (custom Solana validator cluster).

**Frontend:** React + Vite + TypeScript + Tailwind (LiquidGlass design system)
**Backend:** Deno + Hono server deployed as Azure Container App
**Database:** Azure Postgres (production), Supabase (staging)
**Blockchain:** Solstice Network (production), Solana Devnet (staging)
**Auth:** Azure Entra ID + Google OAuth (production), Supabase Auth (staging)
**Hosting:** Azure Static Web Apps (frontend), Azure Container Apps (backend)

## Architecture

### One Codebase, Two Environments

- **Production** (`coda.solsticenetwork.xyz`): Azure Postgres + Solstice Network + Azure Auth
- **Staging** (local/Supabase): Supabase Postgres + Solana Devnet + Supabase Auth

Environment detection via `VITE_SERVER_BASE_URL`:
- Set → production mode: frontend reads via REST endpoints, backend uses direct Postgres
- Unset → staging mode: frontend reads via Supabase client directly

### Key Files

| File | Purpose |
|------|---------|
| `supabase/functions/server/index.tsx` | Main backend (~7100 lines). All endpoints, SQL queries, REST data API |
| `supabase/functions/server/db.tsx` | Postgres connection pool (deno-postgres) |
| `supabase/functions/server/solana-real.tsx` | Solana/Solstice blockchain operations (Token-2022) |
| `supabase/functions/server/kv_store.tsx` | Key-value store backed by Postgres |
| `supabase/functions/server/aria.tsx` | AI agent (Aria) conversation handler |
| `supabase/functions/server/proving-ground.tsx` | Scenario testing engine |
| `src/app/dataClient.ts` | Frontend data abstraction (REST vs Supabase routing) |
| `src/app/supabaseClient.ts` | Server communication (`callServer` with retry/queue) |
| `src/app/contexts/AuthContext.tsx` | Dual auth provider (Azure / Supabase) |
| `src/app/hooks/useIsAdmin.ts` | Admin check against `VITE_ADMIN_EMAIL` |

### Admin-Gated Pages

Super admin: `jeremy@rimark.io` (configured via `VITE_ADMIN_EMAIL`)

| Page | Route | Gate |
|------|-------|------|
| Network Setup | `/setup` | Hard redirect if not admin |
| Proving Ground | `/proving-ground` | Hard redirect if not admin |
| Network Command | `/network-command` | Hard redirect if not admin |
| Settings (Danger Zone) | `/settings` | Conditional render for admin-only section |

Backend admin gate: `X-Admin-Email` header verified against `ADMIN_EMAIL` env var on sensitive endpoints (faucet, setup-bank, setup-custodian, reset-network, etc.).

### Deployment

```bash
# Backend: Docker build → ACR → Container App
docker build --platform linux/amd64 -t codaacrem64sl.azurecr.io/coda-api:TAG .
docker push codaacrem64sl.azurecr.io/coda-api:TAG
az containerapp update --name coda-prod-api --resource-group rg-coda-app --image codaacrem64sl.azurecr.io/coda-api:TAG

# Frontend: auto-deploys via Azure Static Web Apps CI on push to main
git push origin main
```

**Important:** Container Apps doesn't re-pull `latest` tag on restart. Always use unique tags and create new revisions.

### Solana/Solstice Specifics

- `sendAndPollTransaction` replaces `sendAndConfirmTransaction` — polls `getSignatureStatuses` instead of using `lastValidBlockHeight` (expires too fast on Solstice Network)
- Faucet uses `SystemProgram.transfer` from `FAUCET_KEYPAIR` env var (requestAirdrop disabled on Solstice)
- All token operations use Token-2022 program with permanent delegate extension

## Conventions

- Commit messages: imperative mood, explain "why" not "what"
- Branch flow: develop → main (merge, not rebase)
- SQL: `deno-postgres` tagged template literals (`sql\`SELECT ...\``)
- Frontend state: SWR-style cache via `useSWRCache` hook
- API routes: prefixed with `/make-server-49d15288/`
