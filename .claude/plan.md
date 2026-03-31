# Task 149 — Admin Page Reorg + Production MFA

## Overview
Consolidate scattered admin pages into a unified admin section, add WebAuthn passkey MFA for production, and gate sensitive actions behind re-authentication.

---

## Phase 1: Admin Page Consolidation (Frontend Only)

### Step 1: Create unified Admin Console page
- New file: `src/app/components/AdminConsole.tsx`
- Tabbed layout with 3 sections: **Network Setup**, **Proving Ground**, **Network Command**
- Each tab renders the existing component content (extract from current pages)
- Admin gate at top level (`useIsAdmin()` → redirect)

### Step 2: Update sidebar navigation
- In `dashboard-layout.tsx`, replace the 3 separate CONFIG items (Setup, Proving Ground, Network Command) with a single **"Admin Console"** nav item at route `/admin`
- Agent Config stays as its own nav item (it's not admin-only)
- Move Danger Zone actions (Reset Tokens, Reset Network) into the Admin Console as a 4th tab: **Danger Zone**

### Step 3: Update routing
- In `routes.tsx`, add `/admin` route → `AdminConsole`
- Keep old routes (`/setup`, `/proving-ground`, `/network-command`) as redirects to `/admin?tab=X` for backward compatibility
- Remove old standalone page components after migration

### Step 4: Move Settings Danger Zone
- Remove the admin-only Danger Zone section from `SettingsPage.tsx`
- It now lives in Admin Console's Danger Zone tab

**Deliverable:** Single `/admin` page with tabs, cleaner sidebar, no behavior changes.

---

## Phase 2: Re-Auth Gate for Sensitive Actions (Frontend + Backend)

### Step 5: Create `ReAuthDialog` component
- Modal dialog that requires password re-entry before sensitive actions
- Staging (Supabase): re-authenticate via `supabase.auth.signInWithPassword()`
- Production (Azure): re-authenticate via a new backend endpoint that validates the session

### Step 6: Add re-auth endpoint to backend
- New endpoint: `POST /make-server-49d15288/verify-admin`
- Accepts: `{ email, proof }` where proof is a time-limited token
- Returns: `{ verified: true, token: <short-lived JWT> }` valid for 5 minutes
- Sensitive endpoints accept `X-Admin-Proof` header with this token

### Step 7: Gate sensitive actions
- Wrap these actions with `ReAuthDialog`:
  - Custodian reassignment (`reassign-custodian`)
  - Network reset (`reset-network`)
  - Reset tokens (`reset-tokens`)
  - Faucet funding (`faucet`)
- On confirmation, call `verify-admin`, then pass the proof token to the action endpoint

**Deliverable:** Sensitive actions require password re-entry. No WebAuthn yet.

---

## Phase 3: WebAuthn Passkey MFA (Production Only)

### Step 8: Add WebAuthn registration flow
- New component: `PasskeyManager` in Admin Console settings
- Backend endpoints:
  - `POST /make-server-49d15288/webauthn/register-options` — generate registration challenge
  - `POST /make-server-49d15288/webauthn/register-verify` — verify and store credential
- Store credentials in a new `admin_passkeys` Postgres table
- Use `@simplewebauthn/server` (Deno-compatible) on backend

### Step 9: Add WebAuthn authentication flow
- Backend endpoints:
  - `POST /make-server-49d15288/webauthn/auth-options` — generate auth challenge
  - `POST /make-server-49d15288/webauthn/auth-verify` — verify assertion, return proof token
- Frontend: `@simplewebauthn/browser` for credential creation/assertion
- ReAuthDialog enhanced: if passkey registered, offer passkey auth instead of password

### Step 10: Enforce passkey for production
- Production admin actions require passkey proof (not just password)
- Staging falls back to password re-auth (passkeys optional)
- Grace period: first 7 days after deployment, passkey not required (allows registration)

**Deliverable:** Full WebAuthn MFA for production admin actions.

---

## Implementation Order & Estimates

| Phase | Steps | Effort | Risk |
|-------|-------|--------|------|
| Phase 1 | 1-4 | ~2 sessions | Low — pure frontend restructure |
| Phase 2 | 5-7 | ~1 session | Medium — new backend endpoint |
| Phase 3 | 8-10 | ~2 sessions | High — WebAuthn complexity, Deno compat |

**Recommended:** Ship Phase 1 first, then Phase 2, then Phase 3. Each phase is independently valuable.

---

## Files Affected

### Phase 1
- `src/app/components/AdminConsole.tsx` (new)
- `src/app/components/dashboard/dashboard-layout.tsx` (sidebar nav)
- `src/app/routes.tsx` (routing)
- `src/app/components/SettingsPage.tsx` (remove Danger Zone)
- `src/app/components/SetupPage.tsx` (extract content)
- `src/app/components/proving-ground/*.tsx` (extract content)
- `src/app/components/NetworkCommand.tsx` (extract content)

### Phase 2
- `src/app/components/ReAuthDialog.tsx` (new)
- `supabase/functions/server/index.tsx` (verify-admin endpoint)
- `src/app/components/AdminConsole.tsx` (wire re-auth)

### Phase 3
- `supabase/functions/server/index.tsx` (WebAuthn endpoints)
- `src/app/components/PasskeyManager.tsx` (new)
- `src/app/components/ReAuthDialog.tsx` (passkey option)
- Database migration: `admin_passkeys` table
