// ============================================================
// Cadenza Prompt Builders — Dispute Resolution & Monitoring Agent
//
// Used by: /cadenza-monitor route handler (HTTP)
//          /cadenza-scan periodic batch route (HTTP)
//          Both call sites in index.tsx
//
// All functions are pure: data in, string out. No DB queries,
// no Gemini calls, no side effects.
// ============================================================

import {
  CADENZA_NETWORK_RULES,
  CADENZA_RESPONSE_FORMAT,
  CADENZA_BATCH_RESPONSE_FORMAT,
} from "./shared-context.ts";

// ── Interfaces ──────────────────────────────────────────────

export interface LockupTokenData {
  id: string;
  transaction_id: string;
  sender_bank_id: string;
  receiver_bank_id: string;
  yb_token_mint: string;
  yb_token_symbol: string;
  yb_token_amount: string;  // BIGINT as string
  yb_holder: string;
  tb_token_mint: string;
  tb_token_symbol: string;
  tb_token_amount: string;
  tb_holder: string;
  yield_rate_bps: number;
  yield_accrued: string;
  lockup_start: string;
  lockup_end: string | null;
  status: string;            // active | escalated | settled | reversed
  resolution?: string | null;
  created_at: string;
}

export interface TransactionData {
  id: string;
  amount: number;
  amount_display?: number;
  purpose_code?: string;
  memo?: string;
  status: string;
  risk_level?: string;
  risk_score?: number;
  risk_reasoning?: string;
  lockup_status?: string;
  created_at: string;
  initiated_at?: string;
  solana_tx_signature?: string;
}

export interface BankData {
  id: string;
  name: string;
  short_code: string;
  jurisdiction: string;
  tier?: string;
  status: string;
  swift_bic?: string;
}

export interface CorridorTx {
  id: string;
  amount_display: number;
  purpose_code: string;
  status: string;
  risk_score: number;
  risk_level: string;
  created_at: string;
  direction: "sent" | "received";
}

export interface CadenzaFlag {
  id: string;
  flag_type: string;
  severity: string;
  reasoning: string;
  detected_at: string;
  action_taken?: string;
  action_at?: string;
}

export interface VelocityStats {
  count_10min: number;
  volume_10min: number;
  count_60min: number;
  volume_60min: number;
  distinct_receivers_30min: number;
}

export interface CadenzaBankConfig {
  cadenza_monitoring_sensitivity?: "conservative" | "balanced" | "aggressive";
  cadenza_auto_reverse_enabled?: boolean;
  cadenza_escalation_threshold?: number;
  cadenza_velocity_spike_multiplier?: number;
  cadenza_duplicate_window_seconds?: number;
  cadenza_max_lockup_hours?: number;
}

export interface NetworkRulesOverrides {
  networkModeContext: string;
  autoAcceptCeiling: number;
}

// ── Per-lockup monitoring data bundle ───────────────────────

export interface CadenzaMonitoringParams {
  networkModeContext: string;
  lockupToken: LockupTokenData;
  transaction: TransactionData;
  senderBank: BankData;
  receiverBank: BankData;
  corridorHistory: CorridorTx[];
  senderVelocity: VelocityStats;
  existingFlags: CadenzaFlag[];
  bankConfig: CadenzaBankConfig;
  networkRules: NetworkRulesOverrides;
}

export interface CadenzaEscalationParams {
  networkModeContext: string;
  lockupToken: LockupTokenData;
  transaction: TransactionData;
  senderBank: BankData;
  receiverBank: BankData;
  flags: CadenzaFlag[];
  operatorContext?: string;
}

export interface ActiveLockupSummary {
  lockup_id: string;
  transaction_id: string;
  sender_code: string;
  receiver_code: string;
  amount_display: number;
  purpose_code: string;
  risk_score: number;
  lockup_start: string;
  lockup_end: string | null;
  status: string;
  time_elapsed_seconds: number;
  time_remaining_seconds: number | null; // null = infinite
  existing_flag_count: number;
  yield_accrued: string;
}

export interface CadenzaPeriodicScanParams {
  networkModeContext: string;
  activeLockups: ActiveLockupSummary[];
  recentSettledTxns: {
    id: string;
    sender_code: string;
    receiver_code: string;
    amount_display: number;
    purpose_code: string;
    settled_at: string;
  }[];
  networkState: {
    total_active_banks: number;
    total_active_lockups: number;
    total_locked_value: number;
    network_tps_1h: number;
  };
}

// ============================================================
// 1. Per-lockup monitoring prompt
// ============================================================

/**
 * Builds the user prompt for Cadenza's per-lockup monitoring decision.
 *
 * The system prompt is the static CADENZA_SYSTEM_IDENTITY from shared-context.ts.
 */
export function buildCadenzaMonitoringPrompt(p: CadenzaMonitoringParams): string {
  const lockup = p.lockupToken;
  const tx = p.transaction;
  const now = Date.now();
  const lockupStartMs = new Date(lockup.lockup_start).getTime();
  const elapsedSeconds = Math.floor((now - lockupStartMs) / 1000);

  // Time remaining
  let timeRemainingStr: string;
  if (!lockup.lockup_end) {
    timeRemainingStr = "INFINITE (escalation eligible — no lockup expiry)";
  } else {
    const remainMs = new Date(lockup.lockup_end).getTime() - now;
    if (remainMs <= 0) {
      timeRemainingStr = "EXPIRED (lockup period has ended, awaiting resolution)";
    } else {
      const remainSecs = Math.ceil(remainMs / 1000);
      const m = Math.floor(remainSecs / 60);
      const s = remainSecs % 60;
      timeRemainingStr = `${m}m ${s}s remaining`;
    }
  }

  // Amount in USD
  const amountUsd = tx.amount_display ?? Number(tx.amount) / 1_000_000;

  // Corridor history text
  const corridorText = p.corridorHistory.length > 0
    ? p.corridorHistory.map((ct, i) =>
        `  ${i + 1}. ${ct.direction === "sent" ? "\u2192" : "\u2190"} $${ct.amount_display.toLocaleString()} | ${ct.purpose_code} | risk=${ct.risk_score} (${ct.risk_level}) | ${ct.status} | ${ct.created_at}`
      ).join("\n")
    : "  No prior transactions in this corridor.";

  // Corridor statistics
  let corridorStats = "";
  if (p.corridorHistory.length > 0) {
    const amounts = p.corridorHistory.map(ct => ct.amount_display);
    const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const variance = amounts.reduce((sum, a) => sum + Math.pow(a - avgAmount, 2), 0) / amounts.length;
    const stdDev = Math.sqrt(variance);
    const deviationFromMean = stdDev > 0 ? Math.abs(amountUsd - avgAmount) / stdDev : 0;

    corridorStats = `
CORRIDOR STATISTICS:
- Average transaction: $${avgAmount.toLocaleString()}
- Standard deviation: $${stdDev.toLocaleString()}
- This transaction deviation: ${deviationFromMean.toFixed(1)} standard deviations from mean
- Corridor depth: ${p.corridorHistory.length} historical transactions`;
  }

  // Velocity context
  const vel = p.senderVelocity;
  const velocityText = `
SENDER VELOCITY (${p.senderBank.short_code}):
- Transactions in last 10 minutes: ${vel.count_10min} (volume: $${vel.volume_10min.toLocaleString()})
- Transactions in last 60 minutes: ${vel.count_60min} (volume: $${vel.volume_60min.toLocaleString()})
- Distinct receivers in last 30 minutes: ${vel.distinct_receivers_30min}`;

  // Existing flags
  const flagsText = p.existingFlags.length > 0
    ? p.existingFlags.map((f, i) =>
        `  ${i + 1}. [${f.severity.toUpperCase()}] ${f.flag_type} — ${f.reasoning} (${f.detected_at})${f.action_taken ? ` → ${f.action_taken}` : ""}`
      ).join("\n")
    : "  None — no flags have been raised on this lockup.";

  // Duplicate detection context — check corridor history for potential duplicates
  const duplicateCandidates = p.corridorHistory.filter(ct => {
    const ctTime = new Date(ct.created_at).getTime();
    const txTime = new Date(tx.created_at).getTime();
    const timeDiffSecs = Math.abs(ctTime - txTime) / 1000;
    return ct.amount_display === amountUsd
      && ct.purpose_code === tx.purpose_code
      && timeDiffSecs <= 120
      && ct.id !== tx.id;
  });
  const duplicateText = duplicateCandidates.length > 0
    ? `\nDUPLICATE ALERT: ${duplicateCandidates.length} transaction(s) with identical amount ($${amountUsd.toLocaleString()}) and purpose code (${tx.purpose_code}) found within 120 seconds.`
    : "";

  // Bank config sensitivity
  const sensitivity = p.bankConfig.cadenza_monitoring_sensitivity || "balanced";
  const autoReverseEnabled = p.bankConfig.cadenza_auto_reverse_enabled !== false;
  const escalationThreshold = p.bankConfig.cadenza_escalation_threshold ?? 0.6;
  const configText = `
CADENZA CONFIGURATION FOR ${p.receiverBank.short_code}:
- Sensitivity: ${sensitivity.toUpperCase()}${sensitivity === "aggressive" ? " (stricter thresholds, lower confidence requirements for flags)" : sensitivity === "conservative" ? " (more permissive, higher confidence required for flags)" : ""}
- Auto-reverse: ${autoReverseEnabled ? "ENABLED" : "DISABLED (can only ESCALATE or ALL_CLEAR)"}
- Escalation threshold: ${escalationThreshold} (confidence below this → ESCALATE instead of auto-act)
- Velocity spike multiplier: ${p.bankConfig.cadenza_velocity_spike_multiplier ?? 3.0}x corridor average
- Duplicate window: ${p.bankConfig.cadenza_duplicate_window_seconds ?? 300}s
- Max lockup hours: ${p.bankConfig.cadenza_max_lockup_hours ?? 72}h`;

  // Counterparty status check
  const counterpartyAlert = p.receiverBank.status !== "active"
    ? `\nCOUNTERPARTY ALERT: Receiver bank ${p.receiverBank.short_code} status is "${p.receiverBank.status}" — NOT ACTIVE. This is an AUTO-REVERSE trigger.`
    : "";

  return `${p.networkModeContext}You are performing POST-SETTLEMENT monitoring on a locked transaction.

LOCKUP STATE:
- Lockup ID: ${lockup.id}
- Status: ${lockup.status.toUpperCase()}
- Time elapsed: ${elapsedSeconds}s (${Math.floor(elapsedSeconds / 60)}m ${elapsedSeconds % 60}s)
- Time remaining: ${timeRemainingStr}
- Yield-bearing token: ${lockup.yb_token_symbol} (${lockup.yb_token_amount} raw) held by BNY custodian
- T-bill token: ${lockup.tb_token_symbol} (${lockup.tb_token_amount} raw) held by ${p.receiverBank.short_code}
- Yield accrued: ${lockup.yield_accrued} raw (${lockup.yield_rate_bps / 100}% annualized)

ORIGINAL TRANSACTION:
- ID: ${tx.id}
- Sender: ${p.senderBank.name} (${p.senderBank.short_code}), ${p.senderBank.jurisdiction}${p.senderBank.swift_bic ? `, BIC: ${p.senderBank.swift_bic}` : ""}
- Receiver: ${p.receiverBank.name} (${p.receiverBank.short_code}), ${p.receiverBank.jurisdiction}${p.receiverBank.swift_bic ? `, BIC: ${p.receiverBank.swift_bic}` : ""}
- Amount: $${amountUsd.toLocaleString()} USD
- Purpose: ${tx.purpose_code || "unspecified"}
- Memo: ${tx.memo || "none"}
- Risk assessment: ${tx.risk_level?.toUpperCase() || "unknown"} (score: ${tx.risk_score ?? "N/A"}/100)
- Original risk reasoning: ${tx.risk_reasoning || "none"}
- Solana signature: ${tx.solana_tx_signature || "none"}
- Initiated: ${tx.initiated_at || tx.created_at}${counterpartyAlert}${duplicateText}

CORRIDOR HISTORY (${p.senderBank.short_code} \u2194 ${p.receiverBank.short_code}, last 10):
${corridorText}${corridorStats}
${velocityText}

EXISTING CADENZA FLAGS ON THIS LOCKUP:
${flagsText}
${configText}

${CADENZA_NETWORK_RULES}

INSTRUCTIONS:
Analyze this lockup and determine the appropriate action. Consider:
1. Is there evidence of duplication, structuring, or velocity abuse?
2. Is the transaction consistent with corridor history?
3. Has the counterparty status changed since lockup?
4. Has the lockup period expired?
5. Are there any cross-transaction patterns visible from the velocity data?
${!autoReverseEnabled ? "\nIMPORTANT: Auto-reverse is DISABLED for this bank. You may only return ALL_CLEAR or ESCALATE." : ""}

Respond with JSON in this exact format:
${CADENZA_RESPONSE_FORMAT}`;
}

// ============================================================
// 2. Escalation briefing prompt
// ============================================================

/**
 * Builds the user prompt for Cadenza's escalation briefing.
 * Generates a human-readable summary for operator review.
 *
 * The system prompt is the static CADENZA_SYSTEM_IDENTITY from shared-context.ts.
 */
export function buildCadenzaEscalationPrompt(p: CadenzaEscalationParams): string {
  const lockup = p.lockupToken;
  const tx = p.transaction;
  const amountUsd = tx.amount_display ?? Number(tx.amount) / 1_000_000;

  const lockupStartMs = new Date(lockup.lockup_start).getTime();
  const elapsedSeconds = Math.floor((Date.now() - lockupStartMs) / 1000);

  // Timeline
  const timelineEntries: string[] = [];
  timelineEntries.push(`${tx.initiated_at || tx.created_at} — Transaction initiated by ${p.senderBank.short_code}`);
  timelineEntries.push(`${lockup.lockup_start} — Lockup created (risk score: ${tx.risk_score ?? "N/A"}, level: ${tx.risk_level?.toUpperCase() || "unknown"})`);
  for (const flag of p.flags) {
    timelineEntries.push(`${flag.detected_at} — [${flag.severity.toUpperCase()}] ${flag.flag_type}: ${flag.reasoning}`);
    if (flag.action_taken) {
      timelineEntries.push(`${flag.action_at || flag.detected_at} — Action: ${flag.action_taken}`);
    }
  }
  timelineEntries.push(`${new Date().toISOString()} — Escalated to human review`);

  const flagSummary = p.flags.map((f, i) =>
    `  ${i + 1}. [${f.severity.toUpperCase()}] ${f.flag_type}\n     Reasoning: ${f.reasoning}\n     Detected: ${f.detected_at}`
  ).join("\n");

  return `${p.networkModeContext}You are generating an ESCALATION BRIEFING for a human operator.

This lockup has been flagged and requires human review. Generate a clear, structured briefing.

LOCKUP SUMMARY:
- Lockup ID: ${lockup.id}
- Transaction: ${tx.id}
- Corridor: ${p.senderBank.short_code} (${p.senderBank.jurisdiction}) \u2192 ${p.receiverBank.short_code} (${p.receiverBank.jurisdiction})
- Amount: $${amountUsd.toLocaleString()} USD
- Purpose: ${tx.purpose_code || "unspecified"}
- Risk level: ${tx.risk_level?.toUpperCase() || "unknown"} (score: ${tx.risk_score ?? "N/A"}/100)
- Lockup duration: ${elapsedSeconds}s elapsed
- Lockup end: ${lockup.lockup_end || "INFINITE (no expiry)"}
- Yield accrued: ${lockup.yield_accrued} raw tokens

TIMELINE:
${timelineEntries.map(e => `  ${e}`).join("\n")}

FLAGS RAISED:
${flagSummary || "  No flags (escalation triggered by other criteria)."}

${p.operatorContext ? `OPERATOR CONTEXT:\n${p.operatorContext}\n` : ""}
Generate a structured escalation briefing in this JSON format:
{
  "executive_summary": "1-2 sentence summary of why this was escalated",
  "risk_assessment": "paragraph assessing the overall risk level and pattern",
  "timeline_narrative": "chronological narrative of events",
  "flags_analysis": [
    {
      "flag_type": "type",
      "severity": "severity",
      "assessment": "your analysis of this flag"
    }
  ],
  "recommended_action": "APPROVE_SETTLEMENT | REVERSE_TRANSACTION | EXTEND_MONITORING",
  "confidence": 0.0 to 1.0,
  "reasoning": "why you recommend this action",
  "additional_investigation": ["suggested follow-up steps"]
}

After your analysis, generate a SAR (Suspicious Activity Report) draft in the following format:
SAR_DRAFT_START
Subject: {entity name and type}
Transaction: {amount, corridor, date}
Suspicious Indicators: {bullet list of specific red flags from your analysis}
Typology: {select one: structuring | velocity_abuse | sanctions_evasion | duplicate_pattern | anomalous_behavior}
Recommended Action: {select one: file | monitor | dismiss}
SAR_DRAFT_END
Keep the SAR draft factual and brief — 3-5 bullet indicators maximum.`;
}

// ============================================================
// 3. Periodic batch scan prompt
// ============================================================

/**
 * Builds the user prompt for Cadenza's periodic batch scan.
 * Reviews all active lockups at once for cross-transaction patterns.
 *
 * The system prompt is the static CADENZA_SYSTEM_IDENTITY from shared-context.ts.
 */
export function buildCadenzaPeriodicScanPrompt(p: CadenzaPeriodicScanParams): string {
  // Format active lockups table
  const lockupRows = p.activeLockups.map((l, i) => {
    const timeStr = l.time_remaining_seconds === null
      ? "\u221E (infinite)"
      : l.time_remaining_seconds <= 0
        ? "EXPIRED"
        : `${Math.floor(l.time_remaining_seconds / 60)}m ${l.time_remaining_seconds % 60}s`;

    return `  ${i + 1}. [${l.lockup_id.slice(0, 8)}] ${l.sender_code} \u2192 ${l.receiver_code} | $${l.amount_display.toLocaleString()} | ${l.purpose_code} | risk=${l.risk_score} | elapsed=${Math.floor(l.time_elapsed_seconds / 60)}m | remaining=${timeStr} | flags=${l.existing_flag_count} | status=${l.status}`;
  }).join("\n");

  // Format recent settled transactions for duplicate/pattern detection
  const recentSettledText = p.recentSettledTxns.length > 0
    ? p.recentSettledTxns.map((t, i) =>
        `  ${i + 1}. ${t.sender_code} \u2192 ${t.receiver_code} | $${t.amount_display.toLocaleString()} | ${t.purpose_code} | settled: ${t.settled_at}`
      ).join("\n")
    : "  No recently settled transactions.";

  // Cross-transaction pattern detection hints
  const senderGroups = new Map<string, ActiveLockupSummary[]>();
  for (const l of p.activeLockups) {
    const existing = senderGroups.get(l.sender_code) || [];
    existing.push(l);
    senderGroups.set(l.sender_code, existing);
  }

  const structuringAlerts: string[] = [];
  for (const [sender, lockups] of senderGroups) {
    if (lockups.length >= 3) {
      const totalAmount = lockups.reduce((s, l) => s + l.amount_display, 0);
      const distinctReceivers = new Set(lockups.map(l => l.receiver_code)).size;
      structuringAlerts.push(
        `  - ${sender} has ${lockups.length} active lockups totaling $${totalAmount.toLocaleString()} across ${distinctReceivers} receiver(s)`
      );
    }
  }

  const structuringText = structuringAlerts.length > 0
    ? `\nSTRUCTURING PATTERN ALERTS:\n${structuringAlerts.join("\n")}`
    : "";

  return `${p.networkModeContext}You are performing a PERIODIC BATCH SCAN of all active lockups on the CODA Solstice Network.

Your task: review all active lockups simultaneously to detect CROSS-TRANSACTION patterns that may not be visible when analyzing individual lockups in isolation.

NETWORK STATE:
- Active banks: ${p.networkState.total_active_banks}
- Active lockups: ${p.networkState.total_active_lockups}
- Total locked value: $${p.networkState.total_locked_value.toLocaleString()}
- Network TPS (1h): ${p.networkState.network_tps_1h}

ACTIVE LOCKUPS (${p.activeLockups.length}):
${lockupRows || "  No active lockups."}
${structuringText}

RECENTLY SETTLED TRANSACTIONS (for duplicate detection, last 20):
${recentSettledText}

${CADENZA_NETWORK_RULES}

BATCH ANALYSIS INSTRUCTIONS:
1. Check for CROSS-LOCKUP patterns: same sender splitting large amounts across multiple lockups (structuring)
2. Check for COORDINATED patterns: multiple senders targeting the same receiver in rapid succession
3. Check for DUPLICATES: any active lockup matching a recently settled transaction (same sender, receiver, amount, purpose)
4. Check lockup EXPIRY: any lockup whose period has expired should generally be ALL_CLEAR unless flags exist
5. For each lockup, decide: ALL_CLEAR, AUTO_REVERSE, ESCALATE, or NO_CHANGE (continue monitoring)

NO_CHANGE means you have no new information to change the lockup's status. Use this for lockups that are mid-lockup with no issues detected.

Respond with a JSON array, one entry per active lockup:
${CADENZA_BATCH_RESPONSE_FORMAT}`;
}