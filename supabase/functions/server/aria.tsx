// ============================================================
// Aria — Natural-Language Agent Configuration Assistant
//
// Translates operator plain-English into structured config
// change proposals, validates them against platform constraints,
// and applies confirmed changes via the existing agent-config
// upsert path.
//
// Actions:
//   interpret  — NL message → proposal | info | rejected
//   confirm    — apply a validated proposal
//   reject     — acknowledge cancellation, no-op
// ============================================================

import { getAdminClient } from "./supabase-admin.tsx";
import { callGemini } from "./gemini.tsx";
import {
  NETWORK_DEFAULTS,
  getBankConfig,
  getNetworkModeContext,
} from "./index.tsx";
import {
  buildAriaSystemPrompt,
  VALID_JURISDICTIONS,
  VALID_PURPOSE_CODES,
  ARCHITECTURE_KNOWLEDGE,
} from "./aria-prompts.ts";

// ── Types ────────────────────────────────────────────────────

export interface AriaChange {
  parameter: string;
  current_value: unknown;
  proposed_value: unknown;
  source: "network_default" | "bank_override";
  category: "maestro" | "concord" | "fermata" | "treasury" | "cadenza";
}

interface AriaProposalResponse {
  type: "proposal";
  proposal_id: string;
  reasoning: string;
  changes: AriaChange[];
  warnings: string[];
  affected_banks: string[];
}

interface AriaInfoResponse {
  type: "info";
  message: string;
}

interface AriaRejectedResponse {
  type: "rejected";
  message: string;
  constraint_violated: string;
}

type AriaResponse = AriaProposalResponse | AriaInfoResponse | AriaRejectedResponse;

// ── Valid value sets (imported from prompts/aria-prompts.ts) ─

const INJECTION_PATTERNS = [
  "ignore previous", "ignore above", "disregard", "system:", "system prompt",
  "you are now", "new instructions", "forget everything",
];

// ── Constraint Validation ───────────────────────────────────

export function validateAriaProposal(
  changes: AriaChange[],
  currentConfig: Record<string, unknown>,
): { valid: boolean; violations: string[] } {
  const violations: string[] = [];

  // Build a merged view: current config + proposed changes
  const merged: Record<string, unknown> = { ...currentConfig };
  for (const ch of changes) {
    merged[ch.parameter] = ch.proposed_value;
  }

  // ── Risk weights must sum to 1.0 ────────────────────────
  const rw = [
    Number(merged.risk_weight_counterparty ?? 0),
    Number(merged.risk_weight_jurisdiction ?? 0),
    Number(merged.risk_weight_asset_type ?? 0),
    Number(merged.risk_weight_behavioral ?? 0),
  ];
  const weightSum = rw.reduce((a, b) => a + b, 0);
  if (Math.abs(weightSum - 1.0) > 0.001) {
    violations.push(
      `Risk weights must sum to exactly 1.0 — current sum is ${weightSum.toFixed(4)}.`,
    );
  }
  for (const w of rw) {
    if (w < 0 || w > 1) {
      violations.push(`Each risk weight must be between 0.0 and 1.0.`);
      break;
    }
  }

  // ── Safety floor: 5%–50%, cannot be 0 ───────────────────
  const floor = Number(merged.balance_safety_floor_pct ?? 0.2);
  if (floor < 0.05 || floor > 0.50) {
    violations.push(
      `balance_safety_floor_pct must be between 0.05 (5%) and 0.50 (50%). Got ${floor}.`,
    );
  }

  // ── Auto-accept ceiling: $0–$50M ────────────────────────
  const ceiling = Number(merged.auto_accept_ceiling ?? 0);
  if (ceiling < 0 || ceiling > 50_000_000) {
    violations.push(
      `auto_accept_ceiling must be between $0 and $50,000,000. Got $${ceiling.toLocaleString()}.`,
    );
  }

  // ── Finality thresholds: instant < 24h < 72h ────────────
  const instant = Number(merged.risk_instant_ceiling ?? 30);
  const d24 = Number(merged.risk_deferred_24h_ceiling ?? 50);
  const d72 = Number(merged.risk_deferred_72h_ceiling ?? 70);
  if (instant < 0 || instant > 100 || d24 < 0 || d24 > 100 || d72 < 0 || d72 > 100) {
    violations.push(`Finality thresholds must be between 0 and 100.`);
  }
  if (instant >= d24 || d24 >= d72) {
    violations.push(
      `Finality thresholds must maintain instant (${instant}) < deferred_24h (${d24}) < deferred_72h (${d72}).`,
    );
  }

  // ── Jurisdiction whitelist ──────────────────────────────
  const jurisdictions = merged.jurisdiction_whitelist;
  if (Array.isArray(jurisdictions)) {
    if (jurisdictions.length === 0) {
      violations.push(`jurisdiction_whitelist cannot be empty.`);
    }
    const invalid = jurisdictions.filter(
      (j: string) => !(VALID_JURISDICTIONS as readonly string[]).includes(j),
    );
    if (invalid.length > 0) {
      violations.push(
        `Invalid jurisdictions: ${invalid.join(", ")}. Valid: ${VALID_JURISDICTIONS.join(", ")}.`,
      );
    }
  }

  // ── Purpose codes ──────────────────────────────────────
  const purposes = merged.approved_purpose_codes;
  if (Array.isArray(purposes)) {
    if (purposes.length === 0) {
      violations.push(`approved_purpose_codes cannot be empty.`);
    }
    const invalid = purposes.filter(
      (p: string) => !(VALID_PURPOSE_CODES as readonly string[]).includes(p),
    );
    if (invalid.length > 0) {
      violations.push(
        `Invalid purpose codes: ${invalid.join(", ")}. Valid: ${VALID_PURPOSE_CODES.join(", ")}.`,
      );
    }
  }

  // ── Heartbeat: boolean only ────────────────────────────
  for (const ch of changes) {
    if (ch.parameter === "heartbeat_participation") {
      if (typeof ch.proposed_value !== "boolean") {
        violations.push(`heartbeat_participation must be a boolean (true/false).`);
      }
    }
  }

  // ── Agent personality: max 500 chars, no injection ─────
  for (const ch of changes) {
    if (ch.parameter === "agent_system_prompt") {
      const val = String(ch.proposed_value || "");
      if (val.length > 500) {
        violations.push(`agent_system_prompt exceeds 500 character limit (${val.length} chars).`);
      }
      const lower = val.toLowerCase();
      for (const pat of INJECTION_PATTERNS) {
        if (lower.includes(pat)) {
          violations.push(`agent_system_prompt contains blocked injection pattern: "${pat}".`);
          break;
        }
      }
    }
  }

  // ── Escalation thresholds: non-negative ────────────────
  for (const param of [
    "escalation_first_time_threshold",
    "escalation_cross_jurisdiction",
  ]) {
    if (param in merged) {
      const val = Number(merged[param]);
      if (val < 0 || val > 50_000_000) {
        violations.push(`${param} must be between $0 and $50,000,000.`);
      }
    }
  }
  if ("escalation_velocity_count" in merged) {
    const val = Number(merged.escalation_velocity_count);
    if (!Number.isInteger(val) || val < 1 || val > 100) {
      violations.push(`escalation_velocity_count must be an integer between 1 and 100.`);
    }
  }

  // ── Cadenza parameters ─────────────────────────────────
  if ("cadenza_monitoring_sensitivity" in merged) {
    const val = merged.cadenza_monitoring_sensitivity;
    if (!["conservative", "balanced", "aggressive"].includes(val as string)) {
      violations.push(`cadenza_monitoring_sensitivity must be 'conservative', 'balanced', or 'aggressive'.`);
    }
  }
  if ("cadenza_auto_reverse_enabled" in merged) {
    if (typeof merged.cadenza_auto_reverse_enabled !== "boolean") {
      violations.push(`cadenza_auto_reverse_enabled must be a boolean (true/false).`);
    }
  }
  if ("cadenza_escalation_threshold" in merged) {
    const val = Number(merged.cadenza_escalation_threshold);
    if (val < 0 || val > 1) {
      violations.push(`cadenza_escalation_threshold must be between 0.0 and 1.0.`);
    }
  }
  if ("cadenza_velocity_spike_multiplier" in merged) {
    const val = Number(merged.cadenza_velocity_spike_multiplier);
    if (val < 1.0 || val > 10.0) {
      violations.push(`cadenza_velocity_spike_multiplier must be between 1.0 and 10.0.`);
    }
  }
  if ("cadenza_duplicate_window_seconds" in merged) {
    const val = Number(merged.cadenza_duplicate_window_seconds);
    if (!Number.isInteger(val) || val < 10 || val > 3600) {
      violations.push(`cadenza_duplicate_window_seconds must be an integer between 10 and 3600.`);
    }
  }
  if ("cadenza_max_lockup_hours" in merged) {
    const val = Number(merged.cadenza_max_lockup_hours);
    if (!Number.isInteger(val) || val < 1 || val > 720) {
      violations.push(`cadenza_max_lockup_hours must be an integer between 1 and 720.`);
    }
  }

  return { valid: violations.length === 0, violations };
}

// ── Category resolver ───────────────────────────────────────

function resolveCategory(param: string): "maestro" | "concord" | "fermata" | "treasury" | "cadenza" {
  if (param.startsWith("cadenza_")) return "cadenza";
  if (param.startsWith("risk_weight_") || param.startsWith("risk_instant") || param.startsWith("risk_deferred")) return "fermata";
  if (param.startsWith("jurisdiction_") || param.startsWith("approved_purpose")) return "concord";
  if (param.startsWith("balance_") || param === "heartbeat_participation") return "treasury";
  return "maestro";
}

// ── Action Handlers ─────────────────────────────────────────

async function handleInterpret(body: {
  bank_id: string;
  message: string;
  conversation_history?: { role: "user" | "aria"; content: string }[];
}): Promise<Response> {
  const { bank_id, message, conversation_history = [] } = body;

  if (!bank_id) {
    return Response.json({ error: "Missing bank_id" }, { status: 400 });
  }
  if (!message || typeof message !== "string" || message.trim().length === 0) {
    return Response.json({ error: "Missing or empty message" }, { status: 400 });
  }

  const supabase = getAdminClient();

  // Load bank info
  const { data: bank } = await supabase
    .from("banks")
    .select("id, name, short_code")
    .eq("id", bank_id)
    .single();

  if (!bank) {
    return Response.json({ error: `Bank not found: ${bank_id}` }, { status: 404 });
  }

  // Load merged config
  const bankConfig = await getBankConfig(bank_id);
  const bankName = bank.short_code || bank.name;

  // Build system prompt
  const devnetContext = await getNetworkModeContext();
  const systemPrompt = devnetContext + "\n\n" + ARCHITECTURE_KNOWLEDGE + "\n\n" + buildAriaSystemPrompt(
    bankConfig as unknown as Record<string, unknown>,
    NETWORK_DEFAULTS as unknown as Record<string, unknown>,
    bankName,
  );

  // Map conversation history to Gemini format
  const geminiHistory = conversation_history.map((msg) => ({
    role: (msg.role === "aria" ? "model" : "user") as "user" | "model",
    parts: [{ text: msg.content }],
  }));

  // Call Gemini
  let rawResponse: string;
  try {
    rawResponse = await callGemini(systemPrompt, message, {
      temperature: 0.3,
      maxTokens: 2048,
      jsonMode: true,
      history: geminiHistory,
    });
  } catch (err) {
    console.log(`[aria] Gemini call failed: ${(err as Error).message}`);
    return Response.json(
      { error: `Aria reasoning failed: ${(err as Error).message}` },
      { status: 500 },
    );
  }

  // Parse response
  let parsed: AriaResponse;
  try {
    parsed = JSON.parse(rawResponse);
  } catch {
    // Try to extract JSON from markdown fences
    const match = rawResponse.match(/```json?\s*\n?([\s\S]*?)\n?```/);
    if (match) {
      try {
        parsed = JSON.parse(match[1]);
      } catch {
        console.log(`[aria] Failed to parse Gemini JSON (extracted):`, rawResponse.slice(0, 500));
        return Response.json(
          { error: "Aria returned unparseable response", raw: rawResponse.slice(0, 500) },
          { status: 500 },
        );
      }
    } else {
      console.log(`[aria] Failed to parse Gemini JSON:`, rawResponse.slice(0, 500));
      return Response.json(
        { error: "Aria returned unparseable response", raw: rawResponse.slice(0, 500) },
        { status: 500 },
      );
    }
  }

  // If info or rejected, pass through directly
  if (parsed.type === "info" || parsed.type === "rejected") {
    return Response.json(parsed);
  }

  // For proposals, validate server-side before returning
  if (parsed.type === "proposal") {
    const proposal = parsed as AriaProposalResponse;

    // Normalize: ensure every change has a category
    for (const ch of proposal.changes) {
      if (!ch.category) {
        ch.category = resolveCategory(ch.parameter);
      }
      // Ensure source is set
      if (!ch.source) {
        ch.source = "bank_override";
      }
    }

    // Server-side constraint validation
    const validation = validateAriaProposal(
      proposal.changes,
      bankConfig as unknown as Record<string, unknown>,
    );

    if (!validation.valid) {
      console.log(`[aria] Proposal failed validation:`, validation.violations);
      return Response.json({
        type: "rejected",
        message: `Proposal violates platform constraints: ${validation.violations.join(" ")}`,
        constraint_violated: validation.violations[0],
      } satisfies AriaRejectedResponse);
    }

    // Generate a proposal_id
    proposal.proposal_id = crypto.randomUUID();
    // Ensure affected_banks is set
    if (!proposal.affected_banks || proposal.affected_banks.length === 0) {
      proposal.affected_banks = [bankName];
    }
    // Ensure warnings is an array
    if (!Array.isArray(proposal.warnings)) {
      proposal.warnings = [];
    }

    console.log(
      `[aria] Proposal ${proposal.proposal_id}: ${proposal.changes.length} changes for ${bankName}`,
    );
    return Response.json(proposal);
  }

  // Unknown type — return as info
  console.log(`[aria] Unknown response type from Gemini:`, JSON.stringify(parsed).slice(0, 300));
  return Response.json({
    type: "info",
    message: "I couldn't process that request. Could you rephrase?",
  } satisfies AriaInfoResponse);
}

async function handleConfirm(body: {
  bank_id: string;
  changes: AriaChange[];
  proposal_id: string;
}): Promise<Response> {
  const { bank_id, changes, proposal_id } = body;

  if (!bank_id) {
    return Response.json({ error: "Missing bank_id" }, { status: 400 });
  }
  if (!changes || !Array.isArray(changes) || changes.length === 0) {
    return Response.json({ error: "Missing or empty changes array" }, { status: 400 });
  }
  if (!proposal_id) {
    return Response.json({ error: "Missing proposal_id" }, { status: 400 });
  }

  // Final validation before applying
  const bankConfig = await getBankConfig(bank_id);
  const validation = validateAriaProposal(
    changes,
    bankConfig as unknown as Record<string, unknown>,
  );

  if (!validation.valid) {
    console.log(`[aria] Confirm rejected — validation failed:`, validation.violations);
    return Response.json(
      {
        success: false,
        applied: [],
        message: `Cannot apply: ${validation.violations.join(" ")}`,
      },
      { status: 400 },
    );
  }

  // Build the config update object
  const configUpdate: Record<string, unknown> = {};
  for (const ch of changes) {
    // Skip agent_system_prompt — handled separately
    if (ch.parameter === "agent_system_prompt") continue;
    configUpdate[ch.parameter] = ch.proposed_value;
  }

  const supabase = getAdminClient();

  // Apply config changes via upsert (same logic as agent-config "update" action)
  if (Object.keys(configUpdate).length > 0) {
    const { error } = await supabase
      .from("bank_agent_config")
      .upsert(
        {
          bank_id,
          ...configUpdate,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "bank_id" },
      )
      .select()
      .single();

    if (error) {
      console.log(`[aria] Config upsert failed: ${error.message}`);
      return Response.json(
        { success: false, applied: [], message: `Database error: ${error.message}` },
        { status: 500 },
      );
    }
  }

  // Handle agent_system_prompt separately (stored on banks table)
  const promptChange = changes.find((ch) => ch.parameter === "agent_system_prompt");
  if (promptChange) {
    const { error } = await supabase
      .from("banks")
      .update({ agent_system_prompt: promptChange.proposed_value })
      .eq("id", bank_id);

    if (error) {
      console.log(`[aria] Personality update failed: ${error.message}`);
      return Response.json(
        { success: false, applied: [], message: `Personality update error: ${error.message}` },
        { status: 500 },
      );
    }
  }

  console.log(
    `[aria] Confirmed proposal ${proposal_id}: applied ${changes.length} changes to ${bank_id}`,
  );

  return Response.json({
    success: true,
    applied: changes,
    message: `Applied ${changes.length} configuration change${changes.length !== 1 ? "s" : ""} successfully.`,
  });
}

function handleReject(body: { proposal_id: string }): Response {
  const { proposal_id } = body;
  console.log(`[aria] Proposal ${proposal_id || "unknown"} rejected by operator — no changes made`);
  return Response.json({
    message: "Understood \u2014 no changes made.",
  });
}

// ── Exported Handler ────────────────────────────────────────

export async function handleAria(c: any): Promise<Response> {
  try {
    const body = await c.req.json();
    const { action } = body;

    console.log(`[aria] Action: ${action}, bank: ${body.bank_id || "N/A"}`);

    switch (action) {
      case "interpret":
        return await handleInterpret(body);
      case "confirm":
        return await handleConfirm(body);
      case "reject":
        return handleReject(body);
      default:
        return Response.json(
          { error: `Unknown aria action: ${action}` },
          { status: 400 },
        );
    }
  } catch (err) {
    console.log(`[aria] Unhandled error: ${(err as Error).message}`);
    return Response.json(
      { error: `Aria error: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}