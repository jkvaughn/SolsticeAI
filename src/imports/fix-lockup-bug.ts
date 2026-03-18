Here's the Figma task prompt — ready to paste:

---

**Task 92: Fix Lockup Bifurcation Bug + Harden Manual Approval/Reversal**

**What to do:**

**Bug 1 — Fix lockup bifurcation in `index.tsx` (3 changes):**

1. **`/execute` route bifurcation (~line 1978):** After computing `riskDerivedLockupMinutes`, add a risk-score gate before the `Math.max`. If `riskScore ≤ riskInstantCeiling` (load from sender's `getBankConfig()`, key: `risk_instant_ceiling`, default 30), force `effectiveLockupMinutes = 0` — bypassing `requestedLockup` entirely. Only apply `Math.max(requestedLockup, riskDerivedLockup)` when risk exceeds the instant ceiling. Update the adjacent log message to reflect "risk-gated bifurcation."

2. **Orchestrator Step 4 bifurcation (~lines 3041–3047):** Replace the hardcoded `>70 → 4320`, `>30 → 1440` thresholds with the sender bank's config-driven `risk_instant_ceiling` and `risk_deferred_ceiling` loaded via `getBankConfig()`. Apply the same risk-score gate as above — if `riskScore ≤ riskInstantCeiling`, set `effectiveLockupOrch = 0`. Update the adjacent log message.

3. **Transaction creation stamp (~line 2475–2499):** No logic change needed here, but add a comment noting that `lockup_duration_minutes` is intentionally stamped pre-risk-scoring and that the bifurcation gate at execution time is the authoritative decision point.

**Bug 2 — Harden manual approval/reversal (2 changes):**

4. **`supabaseClient.ts` — non-retryable patterns:** Add Solana-specific error strings to the existing non-retryable pattern list alongside `insufficient_sol` and `does not exist`. Add: `'already burned'`, `'token account'`, `'mint authority'`. This prevents callServer from retrying partially-completed atomic burn-and-mint operations.

5. **`TransactionDetail.tsx` — auto-settle concurrency guard:** Before the auto-settle trigger fires (when the lockup timer expires), check if `lockupActionLoading` is true. If so, skip the auto-trigger entirely. This prevents a race condition where auto-settle and a manual "Settle Now" click hit `/lockup-action` simultaneously.

---

**Why:**

Bug 1: `default_lockup_duration_minutes` (30) is being used as a Math.max floor, meaning `Math.max(30, 0) = 30` for every low-risk transaction — making PvP unreachable. Risk score must gate the lockup decision *before* the bank default applies. The orchestrator path also has hardcoded thresholds that have drifted from the configurable Fermata ceilings.

Bug 2: The non-retryable pattern fix prevents a dangerous double-burn scenario on Solana where a partial failure could be retried incorrectly. The concurrency guard prevents a race condition between auto-settle and manual actions.

---

**Constraints:**

- Do NOT change the `lockup_duration_minutes` write at transaction creation time — just add the comment.
- Do NOT change `/lockup-settle`, `/lockup-reverse`, or `/lockup-action` route logic.
- Do NOT change Fermata's `/risk-score` route — only the bifurcation paths in `/execute` and the orchestrator.
- Preserve all existing `getBankConfig()` call patterns — NULL → NETWORK_DEFAULTS fallback must remain intact.
- Do NOT change any UI components or Supabase table schemas.

---

**Verification:**

1. Onboard JPM and CITI. Initiate a small payment between them.
2. Confirm a low-risk transaction (score ≤ 30) goes straight to `settled` via PvP — no lockup.
3. Confirm a medium-risk transaction (score 31–70) enters `locked` with a lockup timer.
4. Run a heartbeat treasury cycle and verify the same bifurcation logic applies (orchestrator path).
5. In `TransactionDetail`, let a lockup timer run to near-zero while holding the "Settle Now" button — confirm no duplicate calls fire.

---

When complete, output the `---TASK_COMPLETE---` block to `PROJECT_STATUS.md` as usual.