---
name: coda-qa
description: QA testing for CODA — check pages, API endpoints, auth flow, and visual consistency
triggers:
  - qa
  - test the app
  - check production
  - verify deploy
---

# CODA QA

Systematic QA for CODA Agentic Payments after changes.

## Quick Health Check (run after every deploy)
1. **Backend health**: `curl -s https://coda-prod-api.whitemoss-8572d17c.westus2.azurecontainerapps.io/make-server-49d15288/health`
2. **Frontend loads**: Check SWA deploy status via `gh run list`
3. **Container revision**: `az containerapp revision list --name coda-prod-api --resource-group rg-coda-app` — latest should be Healthy with 100% traffic

## Page-by-Page Check (run after UI changes)
Use Claude Preview tools to verify each page:

| Page | Route | Key checks |
|------|-------|------------|
| Dashboard | `/` | Stats load, bank cards render, agent terminals linked |
| Treasury Ops | `/treasury-ops` | Heartbeat controls, mandate list, agent feed |
| Network Command | `/network-command` | Globe renders, particles visible, metrics updating |
| Transactions | `/transactions` | Table loads, filters work, tab pills slide |
| Escalations | `/escalations` | Flags load, resolution buttons work |
| Visualizer | `/visualizer` | Manhattan lines render, bank nodes visible |
| Admin Console | `/admin` | 3 tabs work (Setup, Proving Ground, Danger Zone) |
| Agent Config | `/agent-config` | Config loads per bank, save buttons work |
| Settings | `/settings` | 5 tabs (Profile, Security, Appearance, Network, Notifications) |

## Auth Flow Check (run after auth changes)
1. Sign out from Settings
2. Login page loads
3. Click "Sign in with Microsoft" → popup opens
4. Complete OAuth → popup closes
5. MFA passkey challenge appears (if enrolled)
6. Verify passkey → app loads
7. Settings > Security > Active Sessions shows current session

## API Endpoint Check (run after backend changes)
```bash
BASE="https://coda-prod-api.whitemoss-8572d17c.westus2.azurecontainerapps.io/make-server-49d15288"
curl -s "$BASE/health"
curl -s -H "X-User-Email: jeremy@rimark.io" "$BASE/user/profile"
curl -s -H "X-Admin-Email: jeremy@rimark.io" "$BASE/passkey-status"
```

## Visual Consistency (run after design changes)
- Check light + dark mode
- Verify XD reference compliance (fill-only inputs, section label weights)
- Tab pill animation slides smoothly
- No overlapping divs or extra borders
- Scrollbar overlay (not pushing content)
