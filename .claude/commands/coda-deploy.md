---
name: coda-deploy
description: Full-stack deploy for CODA — backend Docker image + frontend push + verify
triggers:
  - deploy
  - push to prod
  - deploy backend
  - ship to production
---

# CODA Deploy

Automated deployment pipeline for CODA Agentic Payments.

## Steps

### 1. Pre-flight checks
- Run `npx vite build` — abort if build fails
- Run `git status` — warn if uncommitted changes
- Confirm on `develop` branch (or `main` if merging)

### 2. Git: commit, merge, push
- If uncommitted changes: stage, commit with descriptive message
- Merge `develop` → `main`: `git checkout main && git merge develop --no-edit`
- Push both: `git push origin main && git push origin develop`
- Switch back to develop

### 3. Backend deploy (only if server files changed)
Check if `supabase/functions/server/` was modified in the last commit. If yes:
```bash
TAG="v$(date +%s)"
docker build --platform linux/amd64 -t codaacrem64sl.azurecr.io/coda-api:$TAG .
az acr login --name codaacrem64sl
docker push codaacrem64sl.azurecr.io/coda-api:$TAG
az containerapp update --name coda-prod-api --resource-group rg-coda-app --image codaacrem64sl.azurecr.io/coda-api:$TAG
```

### 4. Verify
- Check Container App revision health: `az containerapp revision list --name coda-prod-api --resource-group rg-coda-app -o table`
- Test health endpoint: `curl -s https://coda-prod-api.whitemoss-8572d17c.westus2.azurecontainerapps.io/make-server-49d15288/health`
- Check SWA CI status: `gh run list --repo jkvaughn/SolsticeAI --limit 1`
- Report: revision healthy, SWA deploying, frontend hash

### 5. Post-deploy
- Report summary: what was deployed, git SHA, container tag, SWA status
