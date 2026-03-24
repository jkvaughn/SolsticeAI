
# Solstice AI — CODA Agentic Payments

Multi-agent AI settlement platform for institutional digital assets on [Solstice Network](https://solsticenetwork.xyz).

## Architecture

- **Frontend:** React + Vite + TypeScript + Tailwind (LiquidGlass theme)
- **Backend:** Deno + Hono → Azure Container Apps
- **Database:** Azure Postgres (prod) / Supabase (staging)
- **Blockchain:** Solstice Network (prod) / Solana Devnet (staging)
- **Auth:** Azure Entra ID + Google OAuth (prod) / Supabase Auth (staging)

## Quick Start

```bash
npm install
npm run dev          # Local dev server (Supabase/Devnet)
npm run build        # Production build
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `VITE_SERVER_BASE_URL` | Backend URL (set for production, unset for staging) |
| `VITE_ADMIN_EMAIL` | Super admin email for admin-gated features |
| `VITE_AUTH_PROVIDER` | `azure` (production) or `supabase` (staging) |
| `VITE_SUPABASE_URL` | Supabase project URL (staging only) |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key (staging only) |
| `VITE_SOLANA_RPC_URL` | RPC endpoint (defaults to devnet) |
| `VITE_SOLANA_CLUSTER` | `solstice` or `devnet` |

## Deployment

Frontend auto-deploys to Azure Static Web Apps on push to `main`.

Backend requires Docker build + ACR push + Container App revision:

```bash
TAG="v$(date +%s)"
docker build --platform linux/amd64 -t codaacrem64sl.azurecr.io/coda-api:$TAG .
docker push codaacrem64sl.azurecr.io/coda-api:$TAG
az containerapp update --name coda-prod-api --resource-group rg-coda-app --image codaacrem64sl.azurecr.io/coda-api:$TAG
```

## Production URLs

- **App:** https://coda.solsticenetwork.xyz
- **API:** https://coda-prod-api.whitemoss-8572d17c.westus2.azurecontainerapps.io
- **Health:** `/make-server-49d15288/health?db=1`

## Design

Original Figma: https://www.figma.com/design/SqFV9SegUrREgP0pNWLn2I/Solstice-AI
