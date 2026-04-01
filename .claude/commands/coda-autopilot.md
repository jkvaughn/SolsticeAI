---
name: coda-autopilot
description: Automated post-feature pipeline — migrate, deploy, QA, update docs. Runs automatically after completing a feature task.
triggers:
  - autopilot
  - run pipeline
  - ship and verify
---

# CODA Autopilot

Automated pipeline that runs after a feature is complete. Handles everything between "code is done" and "feature is live and verified."

**Important:** Always narrate what you're doing with brief status updates so the user can follow along without having to prompt.

## When to trigger automatically

Run this pipeline when ALL of these are true:
1. A feature task (151+) has been implemented
2. `npx vite build` passes
3. The user says "done", "ship it", "looks good", or approves the feature

## Pipeline stages

### Stage 1: Build Verification
```
🔨 Building...
```
- Run `npx vite build` — abort pipeline if it fails
- Report: "Build passed ✓"

### Stage 2: Database Migration (if applicable)
```
🗄️ Checking for new migrations...
```
- Check if any new `.sql` files exist in `supabase/migrations/` that haven't been applied
- If yes, run `/coda-db-migrate`:
  - Apply to Supabase (staging)
  - Apply to Azure Postgres (production)
  - Report: "Migration applied to both environments ✓"
- If no migrations: "No new migrations ✓"

### Stage 3: Git Commit + Push
```
📦 Committing and pushing...
```
- Stage changed files (specific files, not `git add -A`)
- Commit with descriptive message + Co-Authored-By
- Merge develop → main
- Push both branches
- Report: "Pushed to main @ {sha} ✓"

### Stage 4: Backend Deploy (if server files changed)
```
🚀 Deploying backend...
```
- Check if `supabase/functions/server/` was modified
- If yes:
  - `docker build --platform linux/amd64`
  - `az acr login --name codaacrem64sl`
  - `docker push`
  - `az containerapp update`
  - Wait 15s, verify revision is Healthy
  - Report: "Backend deployed, revision healthy ✓"
- If no: "Backend unchanged, skipping deploy ✓"

### Stage 5: Frontend Deploy Verification
```
🌐 Verifying frontend deploy...
```
- Check GitHub Actions: `gh run list --repo jkvaughn/SolsticeAI --limit 1`
- Report: "SWA CI triggered, deploying ✓"

### Stage 6: Quick QA
```
🧪 Running quick QA...
```
- Test backend health endpoint
- Test user profile endpoint (if user endpoints exist)
- Report: "API health check passed ✓"

### Stage 7: Update Project Docs (runs `/coda-docs`)
```
📝 Updating project docs...
```
- Run the `coda-docs` skill which updates:
  - PROJECT_STATUS.md (task marked complete, timestamp updated)
  - PROJECT_HISTORY.md (task entry appended)
  - Notion To Dos page (task marked ✅ COMPLETE)
  - Notion Build Tracker (if applicable)
- Commit doc changes and push
- Report: "Project docs + Notion updated ✓"

### Stage 8: Summary
```
✅ Pipeline complete!
```
Report a concise summary:
- Task completed
- Git SHA
- Backend: deployed / unchanged
- Frontend: deploying via SWA CI
- Migrations: applied / none
- QA: passed
- Docs: updated

## Error handling

If any stage fails:
1. Stop the pipeline
2. Report which stage failed and why
3. Do NOT continue to subsequent stages
4. Ask the user how to proceed

## Narration format

Keep status updates short and scannable:
```
🔨 Build passed ✓
🗄️ No new migrations ✓
📦 Committed: "Add role-based auth model" → pushed main @ abc1234
🚀 Backend deployed → revision coda-prod-api--0000025 healthy
🌐 SWA CI triggered → deploying
🧪 Health check passed ✓
📝 Docs updated ✓
✅ Task 151 shipped! Backend v151-roles, frontend deploying.
```
