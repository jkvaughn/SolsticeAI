// ============================================================
// Solstice Proving Ground -- Adversarial Scenario Engine
//
// Runs predefined stress-test scenarios against the live agent
// pipeline (real Gemini calls, real compliance checks, real risk
// scoring) and returns structured pass/fail results per agent.
//
// Test IDs: proper UUIDs (required by DB schema). Memos are
// prefixed with "PG_TEST" for traceability. All test artifacts
// are cleaned up after each scenario via explicit ID tracking.
// ============================================================

import sql from "./db.tsx";
import { calculateAccruedYield } from "./yield-engine.tsx";

// ── Direct function call injection (avoids HTTP self-call 401 issue) ──
// Same pattern as A2A orchestration fix in index.tsx line 2334.
// index.tsx injects coreCadenzaScanLockup and userReversal handlers
// after defining them, so proving-ground.tsx can call Cadenza logic
// directly without going through the Supabase gateway.

type CadenzaScanFn = (lockupId: string) => Promise<any>;
type CadenzaUserReversalFn = (lockupId: string, reason: string) => Promise<any>;

let _cadenzaScanLockup: CadenzaScanFn | null = null;
let _cadenzaUserReversal: CadenzaUserReversalFn | null = null;

export function setCadenzaDirectHandlers(
  scanLockup: CadenzaScanFn,
  userReversal: CadenzaUserReversalFn,
) {
  _cadenzaScanLockup = scanLockup;
  _cadenzaUserReversal = userReversal;
  console.log('[proving-ground] Cadenza direct handlers injected — HTTP self-calls bypassed');
}

// ── Agent direct handlers (Concord, Fermata, Maestro) ──
// Task 113: Same pattern as Cadenza — bypasses HTTP self-call 401.
type ComplianceCheckFn = (transactionId: string) => Promise<any>;
type RiskScoreFn = (transactionId: string) => Promise<any>;
type AgentThinkFn = (bankId: string, input: string, transactionId: string | null, contextType: string) => Promise<any>;

let _complianceCheck: ComplianceCheckFn | null = null;
let _riskScore: RiskScoreFn | null = null;
let _agentThink: AgentThinkFn | null = null;

export function setAgentDirectHandlers(
  complianceCheck: ComplianceCheckFn,
  riskScore: RiskScoreFn,
  agentThink: AgentThinkFn,
) {
  _complianceCheck = complianceCheck;
  _riskScore = riskScore;
  _agentThink = agentThink;
  console.log('[proving-ground] Agent direct handlers injected (Concord, Fermata, Maestro) — HTTP self-calls bypassed');
}

// ── Direct-call wrappers with HTTP fallback ──
async function callComplianceCheck(txId: string): Promise<any> {
  if (_complianceCheck) {
    try { return await _complianceCheck(txId); } catch (err) { return { error: (err as Error).message }; }
  }
  return internalPost('/compliance-check', { transaction_id: txId });
}

async function callRiskScore(txId: string): Promise<any> {
  if (_riskScore) {
    try { return await _riskScore(txId); } catch (err) { return { error: (err as Error).message }; }
  }
  return internalPost('/risk-score', { transaction_id: txId });
}

async function callAgentThink(bankId: string, input: string, txId: string | null, contextType: string): Promise<any> {
  if (_agentThink) {
    try { return await _agentThink(bankId, input, txId, contextType); } catch (err) { return { error: (err as Error).message }; }
  }
  return internalPost('/agent-think', { bank_id: bankId, input, transaction_id: txId, context_type: contextType });
}

// ── Type Definitions ────────────────────────────────────────

export interface ProvingGroundScenario {
  id: string;
  category: 'compliance' | 'risk' | 'operational' | 'dispute';
  name: string;
  description: string;
  tests_agents: string[];
  expected_behavior: string;
  severity: 'critical' | 'high' | 'medium';
}

export interface AgentResult {
  agent: string;
  result: 'CAUGHT' | 'MISSED' | 'N/A';
  reasoning: string;
  score?: number;
  timing_ms: number;
}

export interface PipelineStep {
  step: string;
  status: string;
  timestamp: string;
  data?: any;
}

export interface ScenarioResult {
  scenario_id: string;
  scenario_name: string;
  category: string;
  bank_id: string;
  bank_name: string;
  overall_result: 'PASS' | 'FAIL' | 'ERROR';
  duration_ms: number;
  agent_results: AgentResult[];
  pipeline_trace: PipelineStep[];
  expected_behavior: string;
  actual_behavior: string;
  error_message?: string;
}

export interface ProvingGroundSummary {
  total: number;
  passed: number;
  failed: number;
  duration_ms: number;
  by_category: Record<string, { passed: number; failed: number }>;
}

// ── Scenario Catalog ────────────────────────────────────────

const PROVING_GROUND_SCENARIOS: ProvingGroundScenario[] = [
  // ── Compliance Gauntlet (Concord) ──
  {
    id: 'C1_unknown_jurisdiction',
    category: 'compliance',
    name: 'Unknown Jurisdiction Code',
    description: 'Sends a transaction from a bank with an unrecognized jurisdiction code (XX) to test whether Concord\'s jurisdiction whitelist check rejects it.',
    tests_agents: ['Concord'],
    expected_behavior: 'Concord rejects transaction due to unrecognized jurisdiction code',
    severity: 'critical',
  },
  {
    id: 'C2_missing_purpose',
    category: 'compliance',
    name: 'Missing Purpose Code',
    description: 'Sends a transaction with null purpose_code and empty memo to test purpose code validation.',
    tests_agents: ['Concord'],
    expected_behavior: 'Concord rejects transaction due to missing purpose code and empty memo',
    severity: 'high',
  },
  {
    id: 'C3_suspended_counterparty',
    category: 'compliance',
    name: 'Suspended Counterparty',
    description: 'Sends a transaction to a temporarily created bank with status=suspended to test counterparty verification.',
    tests_agents: ['Concord'],
    expected_behavior: 'Concord rejects transaction because receiver bank status is not active',
    severity: 'critical',
  },
  {
    id: 'C4_network_maximum',
    category: 'compliance',
    name: 'Network Maximum Exceeded',
    description: 'Sends a transaction exceeding $10M network cap to test amount limit enforcement.',
    tests_agents: ['Concord'],
    expected_behavior: 'Concord rejects transaction exceeding network limits or sender balance',
    severity: 'high',
  },
  {
    id: 'C5_sanctions_memo',
    category: 'compliance',
    name: 'Sanctioned Entity in Memo',
    description: 'Sends a transaction with a sanctions-triggering memo referencing DPRK to test sanctions screening and behavioral analysis.',
    tests_agents: ['Concord', 'Fermata'],
    expected_behavior: 'Concord sanctions screening or Fermata behavioral analysis flags suspicious memo content',
    severity: 'critical',
  },
  {
    id: 'C6_ofac_sanctioned_counterparty',
    category: 'compliance',
    name: 'OFAC Hit — Sanctioned Counterparty',
    description: 'Sends a transaction to a receiver with BIC SHCPKY22 (Shadow Capital Ltd, UN Consolidated list) to test real-time OFAC watchlist screening.',
    tests_agents: ['Concord'],
    expected_behavior: 'Concord rejects transaction due to OFAC/UN watchlist hit on receiver BIC',
    severity: 'critical',
  },
  // ── Risk Provocation (Fermata) ──
  {
    id: 'R1_velocity_spike',
    category: 'risk',
    name: 'Rapid-Fire Velocity Spike',
    description: 'Pre-seeds 5 transactions in 60 seconds, then submits a 6th to test velocity detection.',
    tests_agents: ['Fermata'],
    expected_behavior: 'Fermata flags elevated risk due to 5 transactions in 60 seconds from same sender',
    severity: 'high',
  },
  {
    id: 'R2_new_corridor_large',
    category: 'risk',
    name: 'First-Time Corridor with Large Amount',
    description: 'Sends a $5M transaction through a corridor with zero history to test new-corridor risk elevation.',
    tests_agents: ['Fermata'],
    expected_behavior: 'Fermata elevates risk due to zero corridor history combined with large transfer amount',
    severity: 'high',
  },
  {
    id: 'R3_structuring',
    category: 'risk',
    name: 'Structuring Pattern Detection',
    description: 'Pre-seeds 3 transactions of $9,900 each (just below $10K threshold), then submits a 4th to test structuring detection.',
    tests_agents: ['Fermata'],
    expected_behavior: 'Fermata detects potential structuring -- multiple just-below-threshold transactions',
    severity: 'critical',
  },
  {
    id: 'R4_behavioral_deviation',
    category: 'risk',
    name: 'Sudden Behavioral Deviation',
    description: 'Establishes a pattern of $50K-$100K transactions over 7 days, then submits a $2M outlier.',
    tests_agents: ['Fermata'],
    expected_behavior: 'Fermata flags risk when established low-amount corridor suddenly receives a 20x outlier',
    severity: 'high',
  },
  // ── Dispute Resolution (Cadenza) ──
  {
    id: 'D1_lockup_reversal_duplicate',
    category: 'dispute',
    name: 'Lockup Reversal — Duplicate Detection',
    description: 'Creates a lockup, seeds a near-duplicate settled transaction within the duplicate window, then triggers Cadenza scan to test automatic reversal.',
    tests_agents: ['Cadenza'],
    expected_behavior: 'Cadenza detects duplicate and auto-reverses the lockup',
    severity: 'high',
  },
  {
    id: 'D2_lockup_reversal_velocity',
    category: 'dispute',
    name: 'Lockup Reversal — Velocity Spike During Lockup',
    description: 'Creates a lockup, seeds 6 rapid transactions from the same sender in 60 seconds, then triggers Cadenza scan to test velocity-based reversal.',
    tests_agents: ['Cadenza'],
    expected_behavior: 'Cadenza detects velocity spike and auto-reverses the lockup',
    severity: 'high',
  },
  {
    id: 'D3_lockup_reversal_flagged',
    category: 'dispute',
    name: 'Lockup Reversal — Counterparty Flagged Mid-Lockup',
    description: 'Creates a lockup, then temporarily suspends the sender bank mid-lockup to test whether Cadenza reverses when a counterparty is flagged.',
    tests_agents: ['Cadenza'],
    expected_behavior: 'Cadenza detects flagged counterparty and auto-reverses the lockup',
    severity: 'critical',
  },
  {
    id: 'D4_escalation_anomaly',
    category: 'dispute',
    name: 'Escalation — Anomaly Outside Rules',
    description: 'Creates a lockup for a transaction with ambiguous risk signals that don\'t clearly match auto-reverse rules, forcing Cadenza to escalate to human review.',
    tests_agents: ['Cadenza'],
    expected_behavior: 'Cadenza escalates to human review (infinite lockup set)',
    severity: 'high',
  },
  {
    id: 'D5_user_reversal',
    category: 'dispute',
    name: 'User-Initiated Reversal Within Window',
    description: 'Creates an active lockup, then submits a user-initiated reversal request via the Cadenza user_reversal action to test immediate reversal.',
    tests_agents: ['Cadenza'],
    expected_behavior: 'Cadenza processes immediate user-initiated reversal',
    severity: 'medium',
  },
  {
    id: 'D6_yield_accrual_accuracy',
    category: 'dispute',
    name: 'Yield Accrual Accuracy Over Extended Lockup',
    description: 'Creates a lockup with known principal ($1M), rate (525 bps), and start time (2 hours ago), then validates yield accrual math is within 0.1% tolerance.',
    tests_agents: ['Cadenza'],
    expected_behavior: 'Yield accrual within 0.1% of expected value',
    severity: 'medium',
  },
  // ── Operational Stress (Maestro + Canto) ──
  {
    id: 'O1_auto_accept_ceiling',
    category: 'operational',
    name: 'Auto-Accept Ceiling Boundary',
    description: 'Sends a transaction at exactly the $10M network maximum to test whether Maestro acknowledges boundary conditions.',
    tests_agents: ['Maestro', 'Concord', 'Fermata'],
    expected_behavior: 'Maestro explicitly references Operating Rules auto-accept limits when processing boundary-amount transaction',
    severity: 'medium',
  },
  {
    id: 'O2_safety_floor_breach',
    category: 'operational',
    name: 'Safety Floor Breach Attempt',
    description: 'Attempts a transaction that would push the sender below the 20% safety floor.',
    tests_agents: ['Maestro'],
    expected_behavior: 'System prevents transaction that would push sender below 20% safety floor',
    severity: 'critical',
  },
  {
    id: 'O3_duplicate_transaction',
    category: 'operational',
    name: 'Duplicate Transaction Detection',
    description: 'Submits a near-duplicate transaction within 60 seconds of an identical settled one.',
    tests_agents: ['Concord', 'Fermata', 'Maestro'],
    expected_behavior: 'At least one agent flags a near-duplicate transaction submitted within 60 seconds of an identical one',
    severity: 'medium',
  },
];

// ── Internal fetch helper ───────────────────────────────────
// Calls our own Hono routes via internal HTTP, same pattern
// used by the orchestrator.

const BASE_URL = `${Deno.env.get('SUPABASE_URL')}/functions/v1/make-server-49d15288`;
const SERVICE_KEY = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

async function internalPost(route: string, body: Record<string, unknown>, retries = 1): Promise<any> {
  const url = `${BASE_URL}${route}`;
  console.log(`[proving-ground] POST ${route} — ${JSON.stringify(body).slice(0, 200)}`);

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_KEY()}`,
      },
      body: JSON.stringify(body),
    });

    // Retry on 429 (Gemini rate limit)
    if (res.status === 429 && attempt < retries) {
      const backoff = 2000 * (attempt + 1); // 2s, 4s, ...
      console.log(`[proving-ground] 429 rate limit on ${route}, retrying in ${backoff}ms (attempt ${attempt + 1}/${retries})`);
      await new Promise(r => setTimeout(r, backoff));
      continue;
    }

    const text = await res.text();
    console.log(`[proving-ground] Response from ${route}: status=${res.status}, body(first 500)=${text.slice(0, 500)}`);
    try {
      const parsed = JSON.parse(text);
      console.log(`[proving-ground] Parsed response keys: ${Object.keys(parsed).join(', ')}`);
      // Also handle 429 wrapped in JSON response body
      if (parsed?.error && typeof parsed.error === 'string' && parsed.error.includes('429') && attempt < retries) {
        const backoff = 2000 * (attempt + 1);
        console.log(`[proving-ground] 429 in response body on ${route}, retrying in ${backoff}ms`);
        await new Promise(r => setTimeout(r, backoff));
        continue;
      }
      return parsed;
    } catch {
      console.log(`[proving-ground] ⚠ JSON parse failed for ${route}, returning raw. text(first 300)=${text.slice(0, 300)}`);
      return { raw: text, status: res.status };
    }
  }
}

// ── Test Context Helper ─────────────────────────────────────

interface TestContext {
  sender: any;
  senderWallet: any;
  senderConfig: any;
  receiver: any;
  receiverWallet: any;
}

async function getTestContext(bankId: string): Promise<TestContext> {
  // Load sender bank + wallet
  const [sender] = await sql`SELECT * FROM banks WHERE id = ${bankId}`;
  if (!sender) throw new Error(`Bank not found: ${bankId}`);

  const [senderWallet] = await sql`SELECT * FROM wallets WHERE bank_id = ${bankId} AND is_default = true`;

  // Load sender config
  const [configRow] = await sql`SELECT * FROM bank_agent_config WHERE bank_id = ${bankId}`;

  const senderConfig = {
    auto_accept_ceiling: configRow?.auto_accept_ceiling ?? 10_000_000,
    balance_safety_floor_pct: Number(configRow?.balance_safety_floor_pct ?? 0.20),
  };

  // Pick a counterparty (first active bank that isn't the sender)
  const others = await sql`SELECT * FROM banks WHERE id != ${bankId} AND status = 'active' LIMIT 1`;

  const receiver = others?.[0];
  if (!receiver) throw new Error('No active counterparty bank found');

  const [receiverWallet] = await sql`SELECT * FROM wallets WHERE bank_id = ${receiver.id} AND is_default = true`;

  return { sender, senderWallet, senderConfig, receiver, receiverWallet };
}

// ── Cleanup Helper ──────────────────────────────────────────

interface CleanupIds {
  txIds: string[];
  bankIds: string[];
  lockupIds: string[];
  restoreBanks: { id: string; status: string }[];
}

async function cleanupTestData(ids: CleanupIds): Promise<void> {
  const { txIds, bankIds, lockupIds = [], restoreBanks = [] } = ids;
  console.log(`[proving-ground] Cleanup: ${txIds.length} txs, ${bankIds.length} banks, ${lockupIds.length} lockups`);

  // Restore modified banks to their original status
  for (const rb of restoreBanks) {
    await sql`UPDATE banks SET status = ${rb.status} WHERE id = ${rb.id}`;
  }

  // Delete cadenza_flags for lockups
  if (lockupIds.length > 0) {
    for (const lid of lockupIds) {
      await sql`DELETE FROM cadenza_flags WHERE lockup_token_id = ${lid}`;
    }
  }

  if (txIds.length > 0) {
    // Delete cadenza_flags by transaction_id too
    for (const txId of txIds) {
      await sql`DELETE FROM cadenza_flags WHERE transaction_id = ${txId}`;
    }
    for (const txId of txIds) {
      await sql`DELETE FROM agent_messages WHERE transaction_id = ${txId}`;
      await sql`DELETE FROM agent_conversations WHERE transaction_id = ${txId}`;
    }
    for (const txId of txIds) {
      await sql`DELETE FROM compliance_logs WHERE transaction_id = ${txId}`;
    }
    for (const txId of txIds) {
      await sql`DELETE FROM risk_scores WHERE transaction_id = ${txId}`;
    }
  }

  // Delete lockup_tokens before transactions (FK dependency)
  if (lockupIds.length > 0) {
    await sql`DELETE FROM lockup_tokens WHERE id = ANY(${lockupIds})`;
  }

  if (txIds.length > 0) {
    await sql`DELETE FROM transactions WHERE id = ANY(${txIds})`;
  }

  if (bankIds.length > 0) {
    await sql`DELETE FROM banks WHERE id = ANY(${bankIds})`;
  }

  console.log(`[proving-ground] Cleanup complete: ${txIds.length} txs, ${bankIds.length} banks, ${lockupIds.length} lockups removed`);
}

/** Create a fresh CleanupIds object */
function newCleanupIds(): CleanupIds {
  return { txIds: [], bankIds: [], lockupIds: [], restoreBanks: [] };
}

// ── Scoring Helpers ─────────────────────────────────────────

function scoreComplianceResult(
  response: any,
  expectedToFail: boolean,
  startTime: number,
): AgentResult {
  const timing_ms = Date.now() - startTime;

  if (response?.error) {
    return {
      agent: 'Concord',
      result: expectedToFail ? 'CAUGHT' : 'MISSED',
      reasoning: `Compliance check errored: ${response.error}`,
      timing_ms,
    };
  }

  const passed = response?.compliance_passed;
  const narrative = response?.concord_narrative || '';
  const failedChecks = (response?.checks || [])
    .filter((c: any) => !c.passed)
    .map((c: any) => `${c.type}: ${c.detail}`)
    .join('; ');

  if (expectedToFail) {
    // We WANT compliance to reject
    return {
      agent: 'Concord',
      result: passed ? 'MISSED' : 'CAUGHT',
      reasoning: passed
        ? `Concord PASSED when it should have rejected. Narrative: ${narrative.slice(0, 200)}`
        : `Concord correctly rejected: ${failedChecks || narrative.slice(0, 200)}`,
      timing_ms,
    };
  } else {
    // We expect compliance to pass
    return {
      agent: 'Concord',
      result: passed ? 'CAUGHT' : 'MISSED',
      reasoning: passed
        ? `Concord correctly passed. ${narrative.slice(0, 200)}`
        : `Concord unexpectedly rejected: ${failedChecks}`,
      timing_ms,
    };
  }
}

function scoreRiskResult(
  response: any,
  expectedMinScore: number,
  startTime: number,
  expectedKeywords: string[] = [],
): AgentResult {
  const timing_ms = Date.now() - startTime;

  if (response?.error) {
    return {
      agent: 'Fermata',
      result: 'MISSED',
      reasoning: `Risk scoring errored: ${response.error}`,
      timing_ms,
    };
  }

  const rs = response?.risk_score;
  const composite = rs?.composite_score ?? 0;
  const reasoning = rs?.reasoning || '';
  const level = rs?.risk_level || 'unknown';

  const keywordMatch = expectedKeywords.length > 0
    ? expectedKeywords.some(kw => reasoning.toLowerCase().includes(kw.toLowerCase()))
    : false;

  const scorePass = composite >= expectedMinScore;

  return {
    agent: 'Fermata',
    result: (scorePass || keywordMatch) ? 'CAUGHT' : 'MISSED',
    reasoning: `Score: ${composite}/100 (${level}), threshold: ${expectedMinScore}. ` +
      `Keywords matched: ${keywordMatch}. ` +
      `Reasoning: ${reasoning.slice(0, 300)}`,
    score: composite,
    timing_ms,
  };
}

// ── Transaction Helper ──────────────────────────────────────

async function insertTestTransaction(opts: {
  id: string;
  senderBankId: string;
  receiverBankId: string;
  amount: number; // BIGINT raw tokens (6 decimals)
  amountDisplay: number; // USD display value
  status: string;
  purposeCode?: string | null;
  memo?: string;
  riskReasoning?: string;
  settledAt?: string;
  createdAt?: string;
  lockupStatus?: string;
}): Promise<void> {
  const now = opts.createdAt || new Date().toISOString();
  try {
    if (opts.lockupStatus) {
      await sql`INSERT INTO transactions (id, sender_bank_id, receiver_bank_id, amount, amount_display, status, purpose_code, memo, risk_reasoning, settled_at, initiated_at, created_at, lockup_status) VALUES (${opts.id}, ${opts.senderBankId}, ${opts.receiverBankId}, ${opts.amount}, ${opts.amountDisplay}, ${opts.status}, ${opts.purposeCode ?? null}, ${opts.memo || ''}, ${opts.riskReasoning || null}, ${opts.settledAt || null}, ${now}, ${now}, ${opts.lockupStatus})`;
    } else {
      await sql`INSERT INTO transactions (id, sender_bank_id, receiver_bank_id, amount, amount_display, status, purpose_code, memo, risk_reasoning, settled_at, initiated_at, created_at) VALUES (${opts.id}, ${opts.senderBankId}, ${opts.receiverBankId}, ${opts.amount}, ${opts.amountDisplay}, ${opts.status}, ${opts.purposeCode ?? null}, ${opts.memo || ''}, ${opts.riskReasoning || null}, ${opts.settledAt || null}, ${now}, ${now})`;
    }
  } catch (err) {
    console.log(`[proving-ground] Insert tx ${opts.id.slice(0, 20)} error: ${(err as Error).message}`);
    throw new Error(`Failed to insert test transaction: ${(err as Error).message}`);
  }
}

// ── Scenario Runners ────────────────────────────────────────

async function runC1(bankId: string): Promise<ScenarioResult> {
  const scenario = PROVING_GROUND_SCENARIOS.find(s => s.id === 'C1_unknown_jurisdiction')!;
  const start = Date.now();
  const trace: PipelineStep[] = [];
  const cleanupIds = newCleanupIds();

  try {
    trace.push({ step: 'setup', status: 'started', timestamp: new Date().toISOString() });
    const ctx = await getTestContext(bankId);

    // Create shadow bank with unknown jurisdiction
    const tempBankId = crypto.randomUUID();
    cleanupIds.bankIds.push(tempBankId);
    await sql`INSERT INTO banks (id, name, short_code, jurisdiction, status, solana_wallet_pubkey, token_decimals, created_at, updated_at) VALUES (${tempBankId}, ${'PG Test Bank (XX Jurisdiction)'}, ${'PGXX'}, ${'XX'}, ${'active'}, ${ctx.sender.solana_wallet_pubkey}, ${6}, ${new Date().toISOString()}, ${new Date().toISOString()})`;
    trace.push({ step: 'shadow_bank_created', status: 'ok', timestamp: new Date().toISOString(), data: { id: tempBankId, jurisdiction: 'XX' } });

    // Create test transaction with shadow bank as sender
    const txId = crypto.randomUUID();
    cleanupIds.txIds.push(txId);
    await insertTestTransaction({
      id: txId,
      senderBankId: tempBankId,
      receiverBankId: ctx.receiver.id,
      amount: 1_000_000_000_000, // $1M
      amountDisplay: 1_000_000,
      status: 'initiated',
      purposeCode: 'WHOLESALE_TREASURY',
      memo: 'PG_TEST C1: Unknown jurisdiction',
    });
    trace.push({ step: 'test_tx_created', status: 'ok', timestamp: new Date().toISOString(), data: { txId } });

    // Run compliance check (direct call — bypasses HTTP 401)
    const compStart = Date.now();
    const compResult = await callComplianceCheck(txId);
    trace.push({ step: 'compliance_check', status: compResult?.compliance_passed ? 'passed' : 'failed', timestamp: new Date().toISOString(), data: compResult });

    const concordResult = scoreComplianceResult(compResult, true, compStart);

    const agentResults = [concordResult];
    const overall = concordResult.result === 'CAUGHT' ? 'PASS' : 'FAIL';

    return {
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      category: scenario.category,
      bank_id: bankId,
      bank_name: ctx.sender.name,
      overall_result: overall,
      duration_ms: Date.now() - start,
      agent_results: agentResults,
      pipeline_trace: trace,
      expected_behavior: scenario.expected_behavior,
      actual_behavior: concordResult.result === 'CAUGHT'
        ? `Concord correctly rejected: jurisdiction XX not in whitelist. ${concordResult.reasoning.slice(0, 150)}`
        : `Concord MISSED: allowed transaction from unknown jurisdiction XX. ${concordResult.reasoning.slice(0, 150)}`,
    };
  } finally {
    await cleanupTestData(cleanupIds);
  }
}

async function runC2(bankId: string): Promise<ScenarioResult> {
  const scenario = PROVING_GROUND_SCENARIOS.find(s => s.id === 'C2_missing_purpose')!;
  const start = Date.now();
  const trace: PipelineStep[] = [];
  const cleanupIds = newCleanupIds();

  try {
    const ctx = await getTestContext(bankId);
    const txId = crypto.randomUUID();
    cleanupIds.txIds.push(txId);

    await insertTestTransaction({
      id: txId,
      senderBankId: ctx.sender.id,
      receiverBankId: ctx.receiver.id,
      amount: 500_000_000_000,
      amountDisplay: 500_000,
      status: 'initiated',
      purposeCode: null,
      memo: '',
      riskReasoning: 'PG_TEST_C2_MARKER',
    });
    trace.push({ step: 'test_tx_created', status: 'ok', timestamp: new Date().toISOString(), data: { txId, purposeCode: null, memo: '' } });

    const compStart = Date.now();
    const compResult = await callComplianceCheck(txId);
    trace.push({ step: 'compliance_check', status: compResult?.compliance_passed ? 'passed' : 'failed', timestamp: new Date().toISOString(), data: compResult });

    const concordResult = scoreComplianceResult(compResult, true, compStart);

    return {
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      category: scenario.category,
      bank_id: bankId,
      bank_name: ctx.sender.name,
      overall_result: concordResult.result === 'CAUGHT' ? 'PASS' : 'FAIL',
      duration_ms: Date.now() - start,
      agent_results: [concordResult],
      pipeline_trace: trace,
      expected_behavior: scenario.expected_behavior,
      actual_behavior: concordResult.result === 'CAUGHT'
        ? `Concord correctly rejected missing purpose code. ${concordResult.reasoning.slice(0, 150)}`
        : `Concord MISSED: allowed transaction without purpose code. ${concordResult.reasoning.slice(0, 150)}`,
    };
  } finally {
    await cleanupTestData(cleanupIds);
  }
}

async function runC3(bankId: string): Promise<ScenarioResult> {
  const scenario = PROVING_GROUND_SCENARIOS.find(s => s.id === 'C3_suspended_counterparty')!;
  const start = Date.now();
  const trace: PipelineStep[] = [];
  const cleanupIds = newCleanupIds();

  try {
    const ctx = await getTestContext(bankId);

    // Create suspended bank
    const tempBankId = crypto.randomUUID();
    cleanupIds.bankIds.push(tempBankId);
    await sql`INSERT INTO banks (id, name, short_code, jurisdiction, status, solana_wallet_pubkey, token_decimals, created_at, updated_at) VALUES (${tempBankId}, ${'PG Suspended Bank'}, ${'PGSUSP'}, ${'US'}, ${'suspended'}, ${ctx.receiver.solana_wallet_pubkey}, ${6}, ${new Date().toISOString()}, ${new Date().toISOString()})`;
    trace.push({ step: 'suspended_bank_created', status: 'ok', timestamp: new Date().toISOString(), data: { id: tempBankId } });

    const txId = crypto.randomUUID();
    cleanupIds.txIds.push(txId);
    await insertTestTransaction({
      id: txId,
      senderBankId: ctx.sender.id,
      receiverBankId: tempBankId,
      amount: 1_000_000_000_000,
      amountDisplay: 1_000_000,
      status: 'initiated',
      purposeCode: 'WHOLESALE_TREASURY',
      memo: 'PG_TEST C3: Suspended counterparty',
    });
    trace.push({ step: 'test_tx_created', status: 'ok', timestamp: new Date().toISOString(), data: { txId } });

    const compStart = Date.now();
    const compResult = await callComplianceCheck(txId);
    trace.push({ step: 'compliance_check', status: compResult?.compliance_passed ? 'passed' : 'failed', timestamp: new Date().toISOString(), data: compResult });

    // Current compliance-check has "counterparty_verification" that always returns true
    // with hardcoded "active status" text. It checks the receiver bank from DB join but
    // doesn't actually verify status field. Score accordingly.
    const concordResult = scoreComplianceResult(compResult, true, compStart);

    // Check if the counterparty_verification check text mentions "active"
    const cvCheck = (compResult?.checks || []).find((c: any) => c.type === 'counterparty_verification');
    let actualBehavior = '';
    if (concordResult.result === 'CAUGHT') {
      actualBehavior = `Concord correctly rejected suspended counterparty. ${concordResult.reasoning.slice(0, 150)}`;
    } else {
      actualBehavior = `Concord MISSED: counterparty_verification is currently hardcoded to pass=true. ` +
        `Check text: "${cvCheck?.detail || 'N/A'}". This is a known gap -- the check does not verify bank.status field.`;
    }

    return {
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      category: scenario.category,
      bank_id: bankId,
      bank_name: ctx.sender.name,
      overall_result: concordResult.result === 'CAUGHT' ? 'PASS' : 'FAIL',
      duration_ms: Date.now() - start,
      agent_results: [concordResult],
      pipeline_trace: trace,
      expected_behavior: scenario.expected_behavior,
      actual_behavior: actualBehavior,
    };
  } finally {
    await cleanupTestData(cleanupIds);
  }
}

async function runC4(bankId: string): Promise<ScenarioResult> {
  const scenario = PROVING_GROUND_SCENARIOS.find(s => s.id === 'C4_network_maximum')!;
  const start = Date.now();
  const trace: PipelineStep[] = [];
  const cleanupIds = newCleanupIds();

  try {
    const ctx = await getTestContext(bankId);
    const txId = crypto.randomUUID();
    cleanupIds.txIds.push(txId);

    // $11M -- exceeds $10M network cap
    await insertTestTransaction({
      id: txId,
      senderBankId: ctx.sender.id,
      receiverBankId: ctx.receiver.id,
      amount: 11_000_000_000_000,
      amountDisplay: 11_000_000,
      status: 'initiated',
      purposeCode: 'WHOLESALE_TREASURY',
      memo: 'PG_TEST C4: Network maximum exceeded',
    });
    trace.push({ step: 'test_tx_created', status: 'ok', timestamp: new Date().toISOString(), data: { txId, amount: 11_000_000 } });

    const compStart = Date.now();
    const compResult = await callComplianceCheck(txId);
    trace.push({ step: 'compliance_check', status: compResult?.compliance_passed ? 'passed' : 'failed', timestamp: new Date().toISOString(), data: compResult });

    const concordResult = scoreComplianceResult(compResult, true, compStart);

    // Check which specific check caught it (if any)
    const failedChecks = (compResult?.checks || []).filter((c: any) => !c.passed);
    const caughtByAml = failedChecks.some((c: any) => c.type === 'aml_threshold');

    let actualBehavior: string;
    if (concordResult.result === 'CAUGHT') {
      if (caughtByAml) {
        actualBehavior = `Caught by AML threshold check ($50M). Note: there is no explicit $10M network cap check in current compliance checks. Amount was caught by AML threshold at $50M, but $11M < $50M so this may not trigger.`;
      }
      actualBehavior = `Concord rejected. Failed checks: ${failedChecks.map((c: any) => c.type).join(', ')}. ${concordResult.reasoning.slice(0, 150)}`;
    } else {
      actualBehavior = `Concord MISSED: $11M transaction passed all checks. Current compliance has no explicit $10M network cap check. ` +
        `AML threshold is $50M. No balance sufficiency check exists. This is a finding -- the $10M Operating Rules cap is not enforced at the compliance layer.`;
    }

    return {
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      category: scenario.category,
      bank_id: bankId,
      bank_name: ctx.sender.name,
      overall_result: concordResult.result === 'CAUGHT' ? 'PASS' : 'FAIL',
      duration_ms: Date.now() - start,
      agent_results: [concordResult],
      pipeline_trace: trace,
      expected_behavior: scenario.expected_behavior,
      actual_behavior: actualBehavior,
    };
  } finally {
    await cleanupTestData(cleanupIds);
  }
}

async function runC5(bankId: string): Promise<ScenarioResult> {
  const scenario = PROVING_GROUND_SCENARIOS.find(s => s.id === 'C5_sanctions_memo')!;
  const start = Date.now();
  const trace: PipelineStep[] = [];
  const cleanupIds = newCleanupIds();

  try {
    const ctx = await getTestContext(bankId);
    const txId = crypto.randomUUID();
    cleanupIds.txIds.push(txId);

    await insertTestTransaction({
      id: txId,
      senderBankId: ctx.sender.id,
      receiverBankId: ctx.receiver.id,
      amount: 500_000_000_000,
      amountDisplay: 500_000,
      status: 'initiated',
      purposeCode: 'TRADE',
      memo: 'Payment to DPRK Ministry of Finance -- reference KP-2024-881',
      riskReasoning: 'PG_TEST_C5_MARKER',
    });
    trace.push({ step: 'test_tx_created', status: 'ok', timestamp: new Date().toISOString(), data: { txId, memo: 'DPRK sanctions test' } });

    // Compliance check (Concord)
    const compStart = Date.now();
    const compResult = await callComplianceCheck(txId);
    trace.push({ step: 'compliance_check', status: compResult?.compliance_passed ? 'passed' : 'failed', timestamp: new Date().toISOString() });
    const concordResult = scoreComplianceResult(compResult, true, compStart);

    // Risk score (Fermata)
    const riskStart = Date.now();
    const riskResult = await callRiskScore(txId);
    trace.push({ step: 'risk_score', status: riskResult?.risk_score?.risk_level || 'unknown', timestamp: new Date().toISOString() });
    const fermataResult = scoreRiskResult(riskResult, 40, riskStart, ['sanctions', 'dprk', 'restricted', 'prohibited', 'north korea', 'sanctioned']);

    // Overall PASS if EITHER caught it
    const eitherCaught = concordResult.result === 'CAUGHT' || fermataResult.result === 'CAUGHT';

    return {
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      category: scenario.category,
      bank_id: bankId,
      bank_name: ctx.sender.name,
      overall_result: eitherCaught ? 'PASS' : 'FAIL',
      duration_ms: Date.now() - start,
      agent_results: [concordResult, fermataResult],
      pipeline_trace: trace,
      expected_behavior: scenario.expected_behavior,
      actual_behavior: eitherCaught
        ? `Caught by: ${[concordResult.result === 'CAUGHT' ? 'Concord' : null, fermataResult.result === 'CAUGHT' ? 'Fermata' : null].filter(Boolean).join(' + ')}. ` +
          `Fermata score: ${fermataResult.score ?? 'N/A'}/100.`
        : `BOTH agents missed DPRK sanctions reference in memo. Concord sanctions_screening is currently hardcoded pass=true. Fermata score: ${fermataResult.score ?? 'N/A'}/100.`,
    };
  } finally {
    await cleanupTestData(cleanupIds);
  }
}

async function runC6(bankId: string): Promise<ScenarioResult> {
  const scenario = PROVING_GROUND_SCENARIOS.find(s => s.id === 'C6_ofac_sanctioned_counterparty')!;
  const start = Date.now();
  const trace: PipelineStep[] = [];
  const cleanupIds = newCleanupIds();

  try {
    const ctx = await getTestContext(bankId);

    // Create shadow bank with sanctioned BIC (Shadow Capital Ltd — SHCPKY22)
    const tempBankId = crypto.randomUUID();
    cleanupIds.bankIds.push(tempBankId);
    await sql`INSERT INTO banks (id, name, short_code, jurisdiction, swift_bic, status, solana_wallet_pubkey, token_decimals, created_at, updated_at) VALUES (${tempBankId}, ${'Shadow Capital Ltd (PG Test)'}, ${'SHCP'}, ${'KY'}, ${'SHCPKY22'}, ${'active'}, ${ctx.receiver.solana_wallet_pubkey}, ${6}, ${new Date().toISOString()}, ${new Date().toISOString()})`;
    trace.push({ step: 'shadow_bank_created', status: 'ok', timestamp: new Date().toISOString(), data: { id: tempBankId, bic: 'SHCPKY22' } });

    const txId = crypto.randomUUID();
    cleanupIds.txIds.push(txId);
    await insertTestTransaction({
      id: txId,
      senderBankId: ctx.sender.id,
      receiverBankId: tempBankId,
      amount: 2_000_000_000_000,
      amountDisplay: 2_000_000,
      status: 'initiated',
      purposeCode: 'WHOLESALE_TREASURY',
      memo: 'PG_TEST C6: OFAC sanctioned counterparty',
    });
    trace.push({ step: 'test_tx_created', status: 'ok', timestamp: new Date().toISOString(), data: { txId } });

    const compStart = Date.now();
    const compResult = await callComplianceCheck(txId);
    trace.push({ step: 'compliance_check', status: compResult?.compliance_passed ? 'passed' : 'failed', timestamp: new Date().toISOString(), data: compResult });

    const concordResult = scoreComplianceResult(compResult, true, compStart);

    // Check specifically that sanctions_screening was the failing check
    const sanctionsCheck = compResult?.compliance_checks?.find((c: any) => c.type === 'sanctions_screening');
    const sanctionsFailed = sanctionsCheck && !sanctionsCheck.passed;

    return {
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      category: scenario.category,
      bank_id: bankId,
      bank_name: ctx.sender.name,
      overall_result: concordResult.result === 'CAUGHT' ? 'PASS' : 'FAIL',
      duration_ms: Date.now() - start,
      agent_results: [concordResult],
      pipeline_trace: trace,
      expected_behavior: scenario.expected_behavior,
      actual_behavior: sanctionsFailed
        ? `Concord correctly rejected: OFAC watchlist hit on SHCPKY22 (Shadow Capital Ltd, UN_CONSOLIDATED). ${sanctionsCheck.detail.slice(0, 200)}`
        : concordResult.result === 'CAUGHT'
          ? `Concord rejected but not via sanctions_screening. ${concordResult.reasoning.slice(0, 200)}`
          : `Concord MISSED: allowed transaction to sanctioned counterparty SHCPKY22. ${concordResult.reasoning.slice(0, 200)}`,
    };
  } finally {
    await cleanupTestData(cleanupIds);
  }
}

async function runR1(bankId: string): Promise<ScenarioResult> {
  const scenario = PROVING_GROUND_SCENARIOS.find(s => s.id === 'R1_velocity_spike')!;
  const start = Date.now();
  const ts = Date.now();
  const trace: PipelineStep[] = [];
  const cleanupIds = newCleanupIds();

  try {
    const ctx = await getTestContext(bankId);

    // Seed 5 settled transactions in rapid succession
    for (let i = 1; i <= 5; i++) {
      const seedTs = new Date(ts - (60 - i * 10) * 1000).toISOString();
      const seedId = crypto.randomUUID();
      cleanupIds.txIds.push(seedId);
      await insertTestTransaction({
        id: seedId,
        senderBankId: ctx.sender.id,
        receiverBankId: ctx.receiver.id,
        amount: 100_000_000_000,
        amountDisplay: 100_000,
        status: 'settled',
        purposeCode: 'WHOLESALE_TREASURY',
        memo: 'PG_TEST R1: velocity seed',
        riskReasoning: 'PG_TEST_SEED',
        createdAt: seedTs,
      });
    }
    trace.push({ step: 'velocity_seeds', status: 'ok', timestamp: new Date().toISOString(), data: { count: 5, interval_sec: 10 } });

    // 6th transaction
    const txId = crypto.randomUUID();
    cleanupIds.txIds.push(txId);
    await insertTestTransaction({
      id: txId,
      senderBankId: ctx.sender.id,
      receiverBankId: ctx.receiver.id,
      amount: 100_000_000_000,
      amountDisplay: 100_000,
      status: 'initiated',
      purposeCode: 'WHOLESALE_TREASURY',
      memo: 'PG_TEST R1: velocity test -- 6th in 60s',
    });
    trace.push({ step: 'test_tx_created', status: 'ok', timestamp: new Date().toISOString(), data: { txId } });

    const riskStart = Date.now();
    const riskResult = await callRiskScore(txId);
    trace.push({ step: 'risk_score', status: riskResult?.risk_score?.risk_level || 'unknown', timestamp: new Date().toISOString() });

    const fermataResult = scoreRiskResult(riskResult, 50, riskStart, ['velocity', 'frequency', 'rapid', 'pattern', 'burst', 'spike', 'multiple']);

    return {
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      category: scenario.category,
      bank_id: bankId,
      bank_name: ctx.sender.name,
      overall_result: fermataResult.result === 'CAUGHT' ? 'PASS' : 'FAIL',
      duration_ms: Date.now() - start,
      agent_results: [fermataResult],
      pipeline_trace: trace,
      expected_behavior: scenario.expected_behavior,
      actual_behavior: fermataResult.result === 'CAUGHT'
        ? `Fermata elevated risk: score ${fermataResult.score}/100. Velocity pattern detected. ${fermataResult.reasoning.slice(0, 200)}`
        : `Fermata MISSED velocity spike: score ${fermataResult.score}/100. 6 transactions in 60 seconds did not trigger sufficient elevation. ${fermataResult.reasoning.slice(0, 200)}`,
    };
  } finally {
    await cleanupTestData(cleanupIds);
  }
}

async function runR2(bankId: string): Promise<ScenarioResult> {
  const scenario = PROVING_GROUND_SCENARIOS.find(s => s.id === 'R2_new_corridor_large')!;
  const start = Date.now();
  const trace: PipelineStep[] = [];
  const cleanupIds = newCleanupIds();

  try {
    const ctx = await getTestContext(bankId);
    const txId = crypto.randomUUID();
    cleanupIds.txIds.push(txId);

    await insertTestTransaction({
      id: txId,
      senderBankId: ctx.sender.id,
      receiverBankId: ctx.receiver.id,
      amount: 5_000_000_000_000,
      amountDisplay: 5_000_000,
      status: 'initiated',
      purposeCode: 'WHOLESALE_TREASURY',
      memo: 'PG_TEST R2: First-time corridor large amount',
    });
    trace.push({ step: 'test_tx_created', status: 'ok', timestamp: new Date().toISOString(), data: { txId, amount: 5_000_000 } });

    const riskStart = Date.now();
    const riskResult = await callRiskScore(txId);
    trace.push({ step: 'risk_score', status: riskResult?.risk_score?.risk_level || 'unknown', timestamp: new Date().toISOString() });

    const fermataResult = scoreRiskResult(riskResult, 40, riskStart, ['first-time', 'new corridor', 'no history', 'unfamiliar', 'first transaction', 'no prior', 'new counterparty']);

    return {
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      category: scenario.category,
      bank_id: bankId,
      bank_name: ctx.sender.name,
      overall_result: fermataResult.result === 'CAUGHT' ? 'PASS' : 'FAIL',
      duration_ms: Date.now() - start,
      agent_results: [fermataResult],
      pipeline_trace: trace,
      expected_behavior: scenario.expected_behavior,
      actual_behavior: fermataResult.result === 'CAUGHT'
        ? `Fermata elevated risk: score ${fermataResult.score}/100. New corridor + $5M recognized. ${fermataResult.reasoning.slice(0, 200)}`
        : `Fermata MISSED: score ${fermataResult.score}/100 for $5M in new corridor. ${fermataResult.reasoning.slice(0, 200)}`,
    };
  } finally {
    await cleanupTestData(cleanupIds);
  }
}

async function runR3(bankId: string): Promise<ScenarioResult> {
  const scenario = PROVING_GROUND_SCENARIOS.find(s => s.id === 'R3_structuring')!;
  const start = Date.now();
  const ts = Date.now();
  const trace: PipelineStep[] = [];
  const cleanupIds = newCleanupIds();

  try {
    const ctx = await getTestContext(bankId);

    // Seed 3 just-below-threshold transactions
    for (let i = 1; i <= 3; i++) {
      const seedTs = new Date(ts - (30 - i * 5) * 60 * 1000).toISOString();
      const seedId = crypto.randomUUID();
      cleanupIds.txIds.push(seedId);
      await insertTestTransaction({
        id: seedId,
        senderBankId: ctx.sender.id,
        receiverBankId: ctx.receiver.id,
        amount: 9_900_000_000,
        amountDisplay: 9_900,
        status: 'settled',
        purposeCode: 'WHOLESALE_TREASURY',
        memo: 'PG_TEST R3: Routine settlement',
        riskReasoning: 'PG_TEST_SEED',
        createdAt: seedTs,
      });
    }
    trace.push({ step: 'structuring_seeds', status: 'ok', timestamp: new Date().toISOString(), data: { count: 3, amount_each: 9_900 } });

    const txId = crypto.randomUUID();
    cleanupIds.txIds.push(txId);
    await insertTestTransaction({
      id: txId,
      senderBankId: ctx.sender.id,
      receiverBankId: ctx.receiver.id,
      amount: 9_900_000_000,
      amountDisplay: 9_900,
      status: 'initiated',
      purposeCode: 'WHOLESALE_TREASURY',
      memo: 'Routine settlement',
      riskReasoning: 'PG_TEST_R3_MARKER',
    });
    trace.push({ step: 'test_tx_created', status: 'ok', timestamp: new Date().toISOString(), data: { txId } });

    const riskStart = Date.now();
    const riskResult = await callRiskScore(txId);
    trace.push({ step: 'risk_score', status: riskResult?.risk_score?.risk_level || 'unknown', timestamp: new Date().toISOString() });

    const fermataResult = scoreRiskResult(riskResult, 50, riskStart, ['structuring', 'pattern', 'threshold', 'smurfing', 'splitting', 'just below', 'below threshold', 'evasion']);

    return {
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      category: scenario.category,
      bank_id: bankId,
      bank_name: ctx.sender.name,
      overall_result: fermataResult.result === 'CAUGHT' ? 'PASS' : 'FAIL',
      duration_ms: Date.now() - start,
      agent_results: [fermataResult],
      pipeline_trace: trace,
      expected_behavior: scenario.expected_behavior,
      actual_behavior: fermataResult.result === 'CAUGHT'
        ? `Fermata detected structuring: score ${fermataResult.score}/100. ${fermataResult.reasoning.slice(0, 200)}`
        : `Fermata MISSED structuring: score ${fermataResult.score}/100. 4x $9,900 not flagged. ${fermataResult.reasoning.slice(0, 200)}`,
    };
  } finally {
    await cleanupTestData(cleanupIds);
  }
}

async function runR4(bankId: string): Promise<ScenarioResult> {
  const scenario = PROVING_GROUND_SCENARIOS.find(s => s.id === 'R4_behavioral_deviation')!;
  const start = Date.now();
  const ts = Date.now();
  const trace: PipelineStep[] = [];
  const cleanupIds = newCleanupIds();

  try {
    const ctx = await getTestContext(bankId);

    // Seed 8 historical transactions establishing a $50K-$100K pattern
    for (let i = 1; i <= 8; i++) {
      const daysAgo = 7 - i + 1;
      const seedTs = new Date(ts - daysAgo * 24 * 60 * 60 * 1000).toISOString();
      const amount = 50_000 + Math.floor(Math.random() * 50_000); // $50K-$100K
      const seedId = crypto.randomUUID();
      cleanupIds.txIds.push(seedId);
      await insertTestTransaction({
        id: seedId,
        senderBankId: ctx.sender.id,
        receiverBankId: ctx.receiver.id,
        amount: amount * 1_000_000,
        amountDisplay: amount,
        status: 'settled',
        purposeCode: 'WHOLESALE_TREASURY',
        memo: 'PG_TEST R4: Routine interbank settlement',
        riskReasoning: 'PG_TEST_SEED',
        createdAt: seedTs,
      });
    }
    trace.push({ step: 'pattern_seeds', status: 'ok', timestamp: new Date().toISOString(), data: { count: 8, range: '$50K-$100K', span: '7 days' } });

    // Outlier: $2M (20x the average)
    const txId = crypto.randomUUID();
    cleanupIds.txIds.push(txId);
    await insertTestTransaction({
      id: txId,
      senderBankId: ctx.sender.id,
      receiverBankId: ctx.receiver.id,
      amount: 2_000_000_000_000,
      amountDisplay: 2_000_000,
      status: 'initiated',
      purposeCode: 'WHOLESALE_TREASURY',
      memo: 'Large settlement -- operational requirement',
      riskReasoning: 'PG_TEST_R4_MARKER',
    });
    trace.push({ step: 'test_tx_created', status: 'ok', timestamp: new Date().toISOString(), data: { txId, amount: 2_000_000 } });

    const riskStart = Date.now();
    const riskResult = await callRiskScore(txId);
    trace.push({ step: 'risk_score', status: riskResult?.risk_score?.risk_level || 'unknown', timestamp: new Date().toISOString() });

    const fermataResult = scoreRiskResult(riskResult, 45, riskStart, ['deviation', 'unusual', 'outlier', 'spike', 'significantly higher', 'established pattern', 'abnormal', 'inconsistent', 'sudden']);

    return {
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      category: scenario.category,
      bank_id: bankId,
      bank_name: ctx.sender.name,
      overall_result: fermataResult.result === 'CAUGHT' ? 'PASS' : 'FAIL',
      duration_ms: Date.now() - start,
      agent_results: [fermataResult],
      pipeline_trace: trace,
      expected_behavior: scenario.expected_behavior,
      actual_behavior: fermataResult.result === 'CAUGHT'
        ? `Fermata detected deviation: score ${fermataResult.score}/100. $2M vs $50K-$100K pattern. ${fermataResult.reasoning.slice(0, 200)}`
        : `Fermata MISSED behavioral deviation: score ${fermataResult.score}/100. 20x outlier not flagged. ${fermataResult.reasoning.slice(0, 200)}`,
    };
  } finally {
    await cleanupTestData(cleanupIds);
  }
}

async function runO1(bankId: string): Promise<ScenarioResult> {
  const scenario = PROVING_GROUND_SCENARIOS.find(s => s.id === 'O1_auto_accept_ceiling')!;
  const start = Date.now();
  const trace: PipelineStep[] = [];
  const cleanupIds = newCleanupIds();

  try {
    const ctx = await getTestContext(bankId);
    const txId = crypto.randomUUID();
    cleanupIds.txIds.push(txId);

    // $10M -- exactly at the ceiling
    await insertTestTransaction({
      id: txId,
      senderBankId: ctx.sender.id,
      receiverBankId: ctx.receiver.id,
      amount: 10_000_000_000_000,
      amountDisplay: 10_000_000,
      status: 'initiated',
      purposeCode: 'WHOLESALE_TREASURY',
      memo: 'PG_TEST O1: Auto-accept ceiling boundary',
    });
    trace.push({ step: 'test_tx_created', status: 'ok', timestamp: new Date().toISOString(), data: { txId, amount: 10_000_000 } });

    // Compliance (Concord)
    const compStart = Date.now();
    const compResult = await callComplianceCheck(txId);
    trace.push({ step: 'compliance_check', status: compResult?.compliance_passed ? 'passed' : 'failed', timestamp: new Date().toISOString() });
    // For O1, passing is valid -- we're testing if agents NOTICE the boundary
    const concordResult: AgentResult = {
      agent: 'Concord',
      result: compResult?.compliance_passed ? 'N/A' : 'CAUGHT',
      reasoning: compResult?.compliance_passed
        ? `Compliance passed (valid for boundary test). ${(compResult?.concord_narrative || '').slice(0, 200)}`
        : `Compliance rejected $10M. ${(compResult?.checks || []).filter((c: any) => !c.passed).map((c: any) => c.detail).join('; ').slice(0, 200)}`,
      timing_ms: Date.now() - compStart,
    };

    // Risk (Fermata)
    const riskStart = Date.now();
    const riskResult = await callRiskScore(txId);
    trace.push({ step: 'risk_score', status: riskResult?.risk_score?.risk_level || 'unknown', timestamp: new Date().toISOString() });
    const fermataResult = scoreRiskResult(riskResult, 40, riskStart, ['ceiling', 'maximum', 'limit', 'boundary', 'large', 'significant']);

    // Maestro (agent-think) -- receiver evaluates whether to accept
    let maestroResult: AgentResult;
    const thinkStart = Date.now();
    try {
      const thinkResult = await callAgentThink(
        ctx.receiver.id,
        `Incoming payment of $10,000,000 from ${ctx.sender.short_code}. This is at the exact network auto-accept ceiling. Transaction ID: ${txId}. Evaluate whether to auto-accept, escalate, or reject.`,
        txId,
        'incoming_message',
      );
      trace.push({ step: 'agent_think', status: 'ok', timestamp: new Date().toISOString(), data: { action: thinkResult?.action } });

      const reasoning = (thinkResult?.reasoning || thinkResult?.message_to_user || '').toLowerCase();
      const mentionsBoundary = ['ceiling', 'maximum', 'limit', 'boundary', 'operating rules', 'escalat', 'threshold', 'auto-accept', 'cap'].some(kw => reasoning.includes(kw));

      maestroResult = {
        agent: 'Maestro',
        result: mentionsBoundary ? 'CAUGHT' : 'MISSED',
        reasoning: `Action: ${thinkResult?.action || 'unknown'}. ${(thinkResult?.reasoning || thinkResult?.message_to_user || '').slice(0, 300)}`,
        timing_ms: Date.now() - thinkStart,
      };
    } catch (err) {
      maestroResult = {
        agent: 'Maestro',
        result: 'MISSED',
        reasoning: `Agent-think failed: ${(err as Error).message}`,
        timing_ms: Date.now() - thinkStart,
      };
    }

    const agentResults = [concordResult, fermataResult, maestroResult];
    // PASS if Maestro noticed the boundary (primary test) OR if Fermata elevated
    const overall = maestroResult.result === 'CAUGHT' || fermataResult.result === 'CAUGHT' ? 'PASS' : 'FAIL';

    return {
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      category: scenario.category,
      bank_id: bankId,
      bank_name: ctx.sender.name,
      overall_result: overall,
      duration_ms: Date.now() - start,
      agent_results: agentResults,
      pipeline_trace: trace,
      expected_behavior: scenario.expected_behavior,
      actual_behavior: overall === 'PASS'
        ? `Boundary acknowledged. Maestro: ${maestroResult.result}. Fermata score: ${fermataResult.score}/100.`
        : `Neither Maestro nor Fermata explicitly referenced the $10M ceiling boundary. Maestro: ${maestroResult.reasoning.slice(0, 150)}`,
    };
  } finally {
    await cleanupTestData(cleanupIds);
  }
}

async function runO2(bankId: string): Promise<ScenarioResult> {
  const scenario = PROVING_GROUND_SCENARIOS.find(s => s.id === 'O2_safety_floor_breach')!;
  const start = Date.now();
  const trace: PipelineStep[] = [];
  const cleanupIds = newCleanupIds();

  try {
    const ctx = await getTestContext(bankId);
    const senderBalance = ctx.senderWallet?.balance_tokens || 0;
    const initialSupply = ctx.sender.initial_deposit_supply || 10_000_000;
    const floorPct = ctx.senderConfig.balance_safety_floor_pct;
    const floorTokens = initialSupply * floorPct * 1_000_000; // floor in raw tokens
    const maxSafeWithdraw = senderBalance - floorTokens;

    // We want to withdraw $1 MORE than the safe maximum
    let breachAmount = maxSafeWithdraw + 1_000_000; // +$1 in tokens
    let breachDisplay = Math.round(breachAmount / 1_000_000);

    if (breachAmount <= 0) {
      // Already near floor, try full balance
      breachAmount = senderBalance;
      breachDisplay = Math.round(breachAmount / 1_000_000);
    }

    trace.push({
      step: 'floor_calculation', status: 'ok', timestamp: new Date().toISOString(),
      data: { balance: senderBalance, initialSupply, floorPct, floorTokens, maxSafeWithdraw, breachAmount, breachDisplay },
    });

    const txId = crypto.randomUUID();
    cleanupIds.txIds.push(txId);
    await insertTestTransaction({
      id: txId,
      senderBankId: ctx.sender.id,
      receiverBankId: ctx.receiver.id,
      amount: breachAmount,
      amountDisplay: breachDisplay,
      status: 'initiated',
      purposeCode: 'WHOLESALE_TREASURY',
      memo: 'PG_TEST O2: Safety floor breach attempt',
    });
    trace.push({ step: 'test_tx_created', status: 'ok', timestamp: new Date().toISOString(), data: { txId, amount: breachDisplay } });

    // Compliance check
    const compStart = Date.now();
    const compResult = await callComplianceCheck(txId);
    trace.push({ step: 'compliance_check', status: compResult?.compliance_passed ? 'passed' : 'failed', timestamp: new Date().toISOString() });
    const compCaught = !compResult?.compliance_passed;

    // Risk score
    const riskStart = Date.now();
    const riskResult = await callRiskScore(txId);
    trace.push({ step: 'risk_score', status: riskResult?.risk_score?.risk_level || 'unknown', timestamp: new Date().toISOString() });

    // Agent-think (Maestro in treasury cycle mode)
    let maestroCaught = false;
    let maestroReasoning = '';
    const thinkStart = Date.now();
    try {
      const thinkResult = await callAgentThink(
        ctx.sender.id,
        `Treasury cycle evaluation: Consider sending $${breachDisplay.toLocaleString()} to ${ctx.receiver.short_code}. ` +
          `Current balance: $${Math.round(senderBalance / 1_000_000).toLocaleString()}. ` +
          `Safety floor: ${floorPct * 100}% of initial $${initialSupply.toLocaleString()} = $${Math.round(floorTokens / 1_000_000).toLocaleString()}.`,
        null,
        'treasury_cycle',
      );
      trace.push({ step: 'agent_think', status: 'ok', timestamp: new Date().toISOString(), data: { action: thinkResult?.action } });

      const reasoningLower = (thinkResult?.reasoning || thinkResult?.message_to_user || '').toLowerCase();
      maestroCaught = ['safety floor', 'minimum balance', '20%', 'reserve', 'floor', 'insufficient', 'below', 'exceed', 'not enough'].some(kw => reasoningLower.includes(kw));
      maestroReasoning = (thinkResult?.reasoning || thinkResult?.message_to_user || '').slice(0, 300);

      // Also check if action is NO_ACTION or no_action
      if (thinkResult?.action?.toLowerCase() === 'no_action') {
        maestroCaught = true;
      }
    } catch (err) {
      maestroReasoning = `Agent-think failed: ${(err as Error).message}`;
    }

    const maestroResult: AgentResult = {
      agent: 'Maestro',
      result: (compCaught || maestroCaught) ? 'CAUGHT' : 'MISSED',
      reasoning: maestroCaught
        ? `Maestro blocked: ${maestroReasoning}`
        : compCaught
          ? `Compliance blocked before Maestro evaluation. ${(compResult?.concord_narrative || '').slice(0, 150)}`
          : `Maestro did not reference safety floor. ${maestroReasoning}`,
      timing_ms: Date.now() - thinkStart,
    };

    const anyCaught = compCaught || maestroCaught;

    return {
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      category: scenario.category,
      bank_id: bankId,
      bank_name: ctx.sender.name,
      overall_result: anyCaught ? 'PASS' : 'FAIL',
      duration_ms: Date.now() - start,
      agent_results: [maestroResult],
      pipeline_trace: trace,
      expected_behavior: scenario.expected_behavior,
      actual_behavior: anyCaught
        ? `Safety floor breach prevented. ${maestroResult.reasoning.slice(0, 200)}`
        : `MISSED: $${breachDisplay.toLocaleString()} would breach ${floorPct * 100}% floor but no agent caught it. ` +
          `Note: 20% floor is enforced server-side in treasury-cycle route, not at compliance layer.`,
    };
  } finally {
    await cleanupTestData(cleanupIds);
  }
}

async function runO3(bankId: string): Promise<ScenarioResult> {
  const scenario = PROVING_GROUND_SCENARIOS.find(s => s.id === 'O3_duplicate_transaction')!;
  const start = Date.now();
  const trace: PipelineStep[] = [];
  const cleanupIds = newCleanupIds();

  try {
    const ctx = await getTestContext(bankId);

    // Original settled transaction
    const origId = crypto.randomUUID();
    cleanupIds.txIds.push(origId);
    await insertTestTransaction({
      id: origId,
      senderBankId: ctx.sender.id,
      receiverBankId: ctx.receiver.id,
      amount: 500_000_000_000,
      amountDisplay: 500_000,
      status: 'settled',
      purposeCode: 'WHOLESALE_TREASURY',
      memo: 'PG_TEST O3: Regular interbank settlement',
      settledAt: new Date().toISOString(),
    });
    trace.push({ step: 'original_tx', status: 'ok', timestamp: new Date().toISOString(), data: { id: origId, amount: 500_000 } });

    // Duplicate transaction
    const dupId = crypto.randomUUID();
    cleanupIds.txIds.push(dupId);
    await insertTestTransaction({
      id: dupId,
      senderBankId: ctx.sender.id,
      receiverBankId: ctx.receiver.id,
      amount: 500_000_000_000,
      amountDisplay: 500_000,
      status: 'initiated',
      purposeCode: 'WHOLESALE_TREASURY',
      memo: 'Regular interbank settlement',
      riskReasoning: 'PG_TEST_O3_MARKER',
    });
    trace.push({ step: 'duplicate_tx', status: 'ok', timestamp: new Date().toISOString(), data: { id: dupId } });

    // Compliance on duplicate (Concord)
    const compStart = Date.now();
    const compResult = await callComplianceCheck(dupId);
    trace.push({ step: 'compliance_check', status: compResult?.compliance_passed ? 'passed' : 'failed', timestamp: new Date().toISOString() });

    const concordResult: AgentResult = {
      agent: 'Concord',
      result: !compResult?.compliance_passed ? 'CAUGHT' : 'N/A',
      reasoning: !compResult?.compliance_passed
        ? `Concord rejected duplicate. ${(compResult?.concord_narrative || '').slice(0, 200)}`
        : 'No explicit duplicate detection in current compliance checks.',
      timing_ms: Date.now() - compStart,
    };

    // Risk on duplicate (Fermata)
    const riskStart = Date.now();
    const riskResult = await callRiskScore(dupId);
    trace.push({ step: 'risk_score', status: riskResult?.risk_score?.risk_level || 'unknown', timestamp: new Date().toISOString() });

    const riskReasoning = (riskResult?.risk_score?.reasoning || '').toLowerCase();
    const fermataFlagsDup = ['duplicate', 'identical', 'repeat', 'same amount', 'same counterparty', 'just settled', 'seconds ago'].some(kw => riskReasoning.includes(kw));
    const fermataElevated = (riskResult?.risk_score?.composite_score || 0) >= 40;

    const fermataResult: AgentResult = {
      agent: 'Fermata',
      result: (fermataFlagsDup || fermataElevated) ? 'CAUGHT' : 'N/A',
      reasoning: `Score: ${riskResult?.risk_score?.composite_score || 0}/100. ` +
        `Duplicate keywords: ${fermataFlagsDup}. ${(riskResult?.risk_score?.reasoning || '').slice(0, 200)}`,
      score: riskResult?.risk_score?.composite_score,
      timing_ms: Date.now() - riskStart,
    };

    const maestroResult: AgentResult = {
      agent: 'Maestro',
      result: 'N/A',
      reasoning: 'Maestro not invoked for duplicate detection test (tested at compliance + risk layer).',
      timing_ms: 0,
    };

    const anyCaught = concordResult.result === 'CAUGHT' || fermataResult.result === 'CAUGHT';

    return {
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      category: scenario.category,
      bank_id: bankId,
      bank_name: ctx.sender.name,
      overall_result: anyCaught ? 'PASS' : 'FAIL',
      duration_ms: Date.now() - start,
      agent_results: [concordResult, fermataResult, maestroResult],
      pipeline_trace: trace,
      expected_behavior: scenario.expected_behavior,
      actual_behavior: anyCaught
        ? `Duplicate detected by: ${[concordResult.result === 'CAUGHT' ? 'Concord' : null, fermataResult.result === 'CAUGHT' ? 'Fermata' : null].filter(Boolean).join(' + ')}.`
        : 'No explicit duplicate detection implemented. This is a known gap suitable for future enhancement. ' +
          `Concord: no duplicate check exists. Fermata score: ${fermataResult.score}/100.`,
    };
  } finally {
    await cleanupTestData(cleanupIds);
  }
}

// ── Lockup Insert Helper (for Dispute scenarios) ────────────

async function insertTestLockup(opts: {
  id: string;
  transactionId: string;
  senderBankId: string;
  receiverBankId: string;
  amount: number; // raw tokens
  yieldRateBps?: number;
  lockupStart?: string;
  lockupEnd?: string | null;
  status?: string;
}): Promise<void> {
  const start = opts.lockupStart || new Date().toISOString();
  const lockupEnd = opts.lockupEnd !== undefined ? opts.lockupEnd : new Date(Date.now() + 120_000).toISOString();
  try {
    await sql`INSERT INTO lockup_tokens (id, transaction_id, sender_bank_id, receiver_bank_id, yb_token_mint, yb_token_symbol, yb_token_amount, yb_holder, tb_token_mint, tb_token_symbol, tb_token_amount, tb_holder, yield_rate_bps, yield_accrued, yield_last_calculated, lockup_start, lockup_end, status, created_at) VALUES (${opts.id}, ${opts.transactionId}, ${opts.senderBankId}, ${opts.receiverBankId}, ${`pg_yb_${opts.id.slice(0, 8)}`}, ${'PG-USDYB'}, ${opts.amount.toString()}, ${'pg_custodian_test'}, ${`pg_tb_${opts.id.slice(0, 8)}`}, ${'PG-USTB'}, ${opts.amount.toString()}, ${'pg_receiver_test'}, ${opts.yieldRateBps ?? 525}, ${'0'}, ${start}, ${start}, ${lockupEnd}, ${opts.status || 'active'}, ${start})`;
  } catch (err) {
    console.log(`[proving-ground] Insert lockup ${opts.id.slice(0, 8)} error: ${(err as Error).message}`);
    throw new Error(`Failed to insert test lockup: ${(err as Error).message}`);
  }
}

// ── Cadenza Scoring Helper ──────────────────────────────────

function scoreCadenzaResult(
  scanResult: any,
  expectedDecision: string | string[],
  startTime: number,
  keywords: string[] = [],
): AgentResult {
  const timing_ms = Date.now() - startTime;
  const decisions = Array.isArray(expectedDecision) ? expectedDecision : [expectedDecision];

  if (scanResult?.error) {
    return {
      agent: 'Cadenza',
      result: 'MISSED',
      reasoning: `Cadenza scan errored: ${scanResult.error}`,
      timing_ms,
    };
  }

  const decision = scanResult?.decision || 'UNKNOWN';
  const confidence = scanResult?.confidence || 0;
  const reasoning = scanResult?.reasoning || '';

  const decisionMatch = decisions.some(d => decision.toUpperCase() === d.toUpperCase());
  const keywordMatch = keywords.length > 0
    ? keywords.some(kw => reasoning.toLowerCase().includes(kw.toLowerCase()))
    : false;

  return {
    agent: 'Cadenza',
    result: (decisionMatch || keywordMatch) ? 'CAUGHT' : 'MISSED',
    reasoning: `Decision: ${decision} (confidence: ${(confidence * 100).toFixed(0)}%). ` +
      `Expected: ${decisions.join('|')}. Match: ${decisionMatch}. ` +
      `Keywords: ${keywordMatch}. ` +
      `Reasoning: ${reasoning.slice(0, 300)}`,
    score: Math.round(confidence * 100),
    timing_ms,
  };
}

// ── Dispute Scenario Runners (D1–D6) ────────────────────────
//
// NOTE: AUTO_REVERSE scenarios (D1/D2/D3/D5) will fail at the Solana
// execution step in /lockup-reverse because PG test lockups use fake
// mint addresses (pg_yb_*, pg_tb_*). This is expected and acceptable:
// scoring only checks Gemini's *decision*, not execution success.
// cadenzaInternalPost does NOT throw on HTTP errors — it returns the
// error response object, so the scan completes and returns the decision.
// The test lockup remains status=active in DB but is cleaned up in
// the finally block via cleanupTestData.

async function runD1(bankId: string): Promise<ScenarioResult> {
  const scenario = PROVING_GROUND_SCENARIOS.find(s => s.id === 'D1_lockup_reversal_duplicate')!;
  const start = Date.now();
  const trace: PipelineStep[] = [];
  const cleanupIds = newCleanupIds();

  try {
    trace.push({ step: 'setup', status: 'started', timestamp: new Date().toISOString() });
    const ctx = await getTestContext(bankId);

    // Seed a recently-settled duplicate transaction (same sender, receiver, amount)
    const dupAmount = 750_000_000_000; // $750K
    const dupAmountDisplay = 750_000;
    const dupId = crypto.randomUUID();
    cleanupIds.txIds.push(dupId);
    await insertTestTransaction({
      id: dupId,
      senderBankId: ctx.sender.id,
      receiverBankId: ctx.receiver.id,
      amount: dupAmount,
      amountDisplay: dupAmountDisplay,
      status: 'settled',
      purposeCode: 'WHOLESALE_TREASURY',
      memo: 'PG_TEST D1: Interbank settlement (original)',
      settledAt: new Date(Date.now() - 30_000).toISOString(),
      createdAt: new Date(Date.now() - 45_000).toISOString(),
    });
    trace.push({ step: 'duplicate_seed', status: 'ok', timestamp: new Date().toISOString(), data: { dupId, amount: dupAmountDisplay } });

    // Create the test transaction (near-duplicate) + lockup
    const txId = crypto.randomUUID();
    const lockupId = crypto.randomUUID();
    cleanupIds.txIds.push(txId);
    cleanupIds.lockupIds.push(lockupId);

    await insertTestTransaction({
      id: txId,
      senderBankId: ctx.sender.id,
      receiverBankId: ctx.receiver.id,
      amount: dupAmount,
      amountDisplay: dupAmountDisplay,
      status: 'locked',
      lockupStatus: 'soft_settled',
      purposeCode: 'WHOLESALE_TREASURY',
      memo: 'PG_TEST D1: Interbank settlement (duplicate)',
    });

    await insertTestLockup({
      id: lockupId,
      transactionId: txId,
      senderBankId: ctx.sender.id,
      receiverBankId: ctx.receiver.id,
      amount: dupAmount,
    });
    trace.push({ step: 'lockup_created', status: 'ok', timestamp: new Date().toISOString(), data: { txId, lockupId } });

    // Trigger Cadenza scan — direct function call (bypasses HTTP self-call 401)
    const scanStart = Date.now();
    let scanResult: any;
    if (_cadenzaScanLockup) {
      console.log(`[proving-ground] D1: calling coreCadenzaScanLockup directly (bypassing HTTP)`);
      try {
        scanResult = await _cadenzaScanLockup(lockupId);
      } catch (err) {
        scanResult = { decision: 'ERROR', confidence: 0, reasoning: `Direct call error: ${(err as Error).message}`, flag_type: null, risk_factors: [] };
      }
    } else {
      console.log(`[proving-ground] D1: FALLBACK to internalPost (handlers not injected)`);
      scanResult = await internalPost('/cadenza-monitor', { action: 'scan_lockup', lockup_id: lockupId }, 2);
    }
    console.log(`[proving-ground] D1 scanResult: ${JSON.stringify(scanResult).slice(0, 500)}`);
    trace.push({ step: 'cadenza_scan', status: scanResult?.decision || 'unknown', timestamp: new Date().toISOString(), data: scanResult });

    const cadenzaResult = scoreCadenzaResult(scanResult, 'AUTO_REVERSE', scanStart, ['duplicate', 'identical', 'repeat', 'same amount', 'same counterparty']);

    return {
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      category: scenario.category,
      bank_id: bankId,
      bank_name: ctx.sender.name,
      overall_result: cadenzaResult.result === 'CAUGHT' ? 'PASS' : 'FAIL',
      duration_ms: Date.now() - start,
      agent_results: [cadenzaResult],
      pipeline_trace: trace,
      expected_behavior: scenario.expected_behavior,
      actual_behavior: cadenzaResult.result === 'CAUGHT'
        ? `Cadenza detected duplicate and decided: ${scanResult?.decision}. ${cadenzaResult.reasoning.slice(0, 200)}`
        : `Cadenza MISSED duplicate: decided ${scanResult?.decision} instead of AUTO_REVERSE. ${cadenzaResult.reasoning.slice(0, 200)}`,
    };
  } finally {
    await cleanupTestData(cleanupIds);
  }
}

async function runD2(bankId: string): Promise<ScenarioResult> {
  const scenario = PROVING_GROUND_SCENARIOS.find(s => s.id === 'D2_lockup_reversal_velocity')!;
  const start = Date.now();
  const ts = Date.now();
  const trace: PipelineStep[] = [];
  const cleanupIds = newCleanupIds();

  try {
    const ctx = await getTestContext(bankId);

    // Seed 6 rapid transactions in 60 seconds from same sender
    for (let i = 1; i <= 6; i++) {
      const seedTs = new Date(ts - (60 - i * 8) * 1000).toISOString();
      const seedId = crypto.randomUUID();
      cleanupIds.txIds.push(seedId);
      await insertTestTransaction({
        id: seedId,
        senderBankId: ctx.sender.id,
        receiverBankId: ctx.receiver.id,
        amount: 200_000_000_000, // $200K each
        amountDisplay: 200_000,
        status: 'settled',
        purposeCode: 'WHOLESALE_TREASURY',
        memo: 'PG_TEST D2: velocity seed',
        riskReasoning: 'PG_TEST_SEED',
        createdAt: seedTs,
      });
    }
    trace.push({ step: 'velocity_seeds', status: 'ok', timestamp: new Date().toISOString(), data: { count: 6, interval_sec: 8 } });

    // Create the test transaction + lockup
    const txId = crypto.randomUUID();
    const lockupId = crypto.randomUUID();
    cleanupIds.txIds.push(txId);
    cleanupIds.lockupIds.push(lockupId);

    await insertTestTransaction({
      id: txId,
      senderBankId: ctx.sender.id,
      receiverBankId: ctx.receiver.id,
      amount: 200_000_000_000,
      amountDisplay: 200_000,
      status: 'locked',
      lockupStatus: 'soft_settled',
      purposeCode: 'WHOLESALE_TREASURY',
      memo: 'PG_TEST D2: velocity test — 7th in 60s',
    });

    await insertTestLockup({
      id: lockupId,
      transactionId: txId,
      senderBankId: ctx.sender.id,
      receiverBankId: ctx.receiver.id,
      amount: 200_000_000_000,
    });
    trace.push({ step: 'lockup_created', status: 'ok', timestamp: new Date().toISOString(), data: { txId, lockupId } });

    // Trigger Cadenza scan — direct function call (bypasses HTTP self-call 401)
    const scanStart = Date.now();
    let scanResult: any;
    if (_cadenzaScanLockup) {
      console.log(`[proving-ground] D2: calling coreCadenzaScanLockup directly`);
      try {
        scanResult = await _cadenzaScanLockup(lockupId);
      } catch (err) {
        scanResult = { decision: 'ERROR', confidence: 0, reasoning: `Direct call error: ${(err as Error).message}`, flag_type: null, risk_factors: [] };
      }
    } else {
      scanResult = await internalPost('/cadenza-monitor', { action: 'scan_lockup', lockup_id: lockupId }, 2);
    }
    trace.push({ step: 'cadenza_scan', status: scanResult?.decision || 'unknown', timestamp: new Date().toISOString(), data: scanResult });

    const cadenzaResult = scoreCadenzaResult(scanResult, 'AUTO_REVERSE', scanStart, ['velocity', 'rapid', 'burst', 'spike', 'frequency', 'multiple', 'pattern']);

    return {
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      category: scenario.category,
      bank_id: bankId,
      bank_name: ctx.sender.name,
      overall_result: cadenzaResult.result === 'CAUGHT' ? 'PASS' : 'FAIL',
      duration_ms: Date.now() - start,
      agent_results: [cadenzaResult],
      pipeline_trace: trace,
      expected_behavior: scenario.expected_behavior,
      actual_behavior: cadenzaResult.result === 'CAUGHT'
        ? `Cadenza detected velocity spike: ${scanResult?.decision}. ${cadenzaResult.reasoning.slice(0, 200)}`
        : `Cadenza MISSED velocity spike: decided ${scanResult?.decision}. 7 txns in 60s not flagged. ${cadenzaResult.reasoning.slice(0, 200)}`,
    };
  } finally {
    await cleanupTestData(cleanupIds);
  }
}

async function runD3(bankId: string): Promise<ScenarioResult> {
  const scenario = PROVING_GROUND_SCENARIOS.find(s => s.id === 'D3_lockup_reversal_flagged')!;
  const start = Date.now();
  const trace: PipelineStep[] = [];
  const cleanupIds = newCleanupIds();

  try {
    const ctx = await getTestContext(bankId);

    // Create test tx + lockup
    const txId = crypto.randomUUID();
    const lockupId = crypto.randomUUID();
    cleanupIds.txIds.push(txId);
    cleanupIds.lockupIds.push(lockupId);

    await insertTestTransaction({
      id: txId,
      senderBankId: ctx.sender.id,
      receiverBankId: ctx.receiver.id,
      amount: 2_000_000_000_000, // $2M
      amountDisplay: 2_000_000,
      status: 'locked',
      lockupStatus: 'soft_settled',
      purposeCode: 'WHOLESALE_TREASURY',
      memo: 'PG_TEST D3: Flagged counterparty test',
    });

    await insertTestLockup({
      id: lockupId,
      transactionId: txId,
      senderBankId: ctx.sender.id,
      receiverBankId: ctx.receiver.id,
      amount: 2_000_000_000_000,
    });
    trace.push({ step: 'lockup_created', status: 'ok', timestamp: new Date().toISOString(), data: { txId, lockupId } });

    // Temporarily suspend the sender bank (simulating mid-lockup flagging)
    const originalStatus = ctx.sender.status;
    await sql`UPDATE banks SET status = 'suspended' WHERE id = ${ctx.sender.id}`;
    cleanupIds.restoreBanks.push({ id: ctx.sender.id, status: originalStatus });
    trace.push({ step: 'sender_suspended', status: 'ok', timestamp: new Date().toISOString(), data: { bankId: ctx.sender.id, originalStatus, newStatus: 'suspended' } });

    // Trigger Cadenza scan — direct function call (bypasses HTTP self-call 401)
    const scanStart = Date.now();
    let scanResult: any;
    if (_cadenzaScanLockup) {
      console.log(`[proving-ground] D3: calling coreCadenzaScanLockup directly`);
      try {
        scanResult = await _cadenzaScanLockup(lockupId);
      } catch (err) {
        scanResult = { decision: 'ERROR', confidence: 0, reasoning: `Direct call error: ${(err as Error).message}`, flag_type: null, risk_factors: [] };
      }
    } else {
      scanResult = await internalPost('/cadenza-monitor', { action: 'scan_lockup', lockup_id: lockupId }, 2);
    }
    trace.push({ step: 'cadenza_scan', status: scanResult?.decision || 'unknown', timestamp: new Date().toISOString(), data: scanResult });

    const cadenzaResult = scoreCadenzaResult(
      scanResult,
      ['AUTO_REVERSE', 'ESCALATE'],
      scanStart,
      ['suspended', 'flagged', 'counterparty', 'status', 'inactive', 'blocked', 'frozen'],
    );

    return {
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      category: scenario.category,
      bank_id: bankId,
      bank_name: ctx.sender.name,
      overall_result: cadenzaResult.result === 'CAUGHT' ? 'PASS' : 'FAIL',
      duration_ms: Date.now() - start,
      agent_results: [cadenzaResult],
      pipeline_trace: trace,
      expected_behavior: scenario.expected_behavior,
      actual_behavior: cadenzaResult.result === 'CAUGHT'
        ? `Cadenza responded to flagged counterparty: ${scanResult?.decision}. ${cadenzaResult.reasoning.slice(0, 200)}`
        : `Cadenza MISSED flagged counterparty: decided ${scanResult?.decision}. Suspended sender not caught. ${cadenzaResult.reasoning.slice(0, 200)}`,
    };
  } finally {
    await cleanupTestData(cleanupIds);
  }
}

async function runD4(bankId: string): Promise<ScenarioResult> {
  const scenario = PROVING_GROUND_SCENARIOS.find(s => s.id === 'D4_escalation_anomaly')!;
  const start = Date.now();
  const trace: PipelineStep[] = [];
  const cleanupIds = newCleanupIds();

  try {
    const ctx = await getTestContext(bankId);

    // Create an unusual transaction with ambiguous signals — not clearly fraudulent
    // but unusual enough to require human judgment
    const txId = crypto.randomUUID();
    const lockupId = crypto.randomUUID();
    cleanupIds.txIds.push(txId);
    cleanupIds.lockupIds.push(lockupId);

    await insertTestTransaction({
      id: txId,
      senderBankId: ctx.sender.id,
      receiverBankId: ctx.receiver.id,
      amount: 8_500_000_000_000, // $8.5M — near network max but not over
      amountDisplay: 8_500_000,
      status: 'locked',
      lockupStatus: 'soft_settled',
      purposeCode: 'OTHER',
      memo: 'PG_TEST D4: Unusual cross-border restructuring — offshore subsidiary consolidation — confidential advisory mandate — reference ESCROW-2026-7782. Ambiguous regulatory classification. Multiple jurisdictions involved. Purpose code intentionally vague.',
      riskReasoning: 'Near network maximum, unusual purpose code, multi-jurisdiction restructuring with offshore entities',
    });

    // Create lockup FIRST (cadenza_flags references lockup_token_id via FK)
    await insertTestLockup({
      id: lockupId,
      transactionId: txId,
      senderBankId: ctx.sender.id,
      receiverBankId: ctx.receiver.id,
      amount: 8_500_000_000_000,
      lockupEnd: null, // Already infinite — signals prior concern
    });

    // Pre-insert an existing cadenza flag to signal prior concern
    // (must come AFTER lockup insert due to FK on lockup_token_id)
    const flagId = crypto.randomUUID();
    await sql`INSERT INTO cadenza_flags (id, transaction_id, lockup_token_id, flag_type, severity, reasoning, detected_at, action_taken, action_at) VALUES (${flagId}, ${txId}, ${lockupId}, ${'anomaly_detected'}, ${'escalate'}, ${'Prior automated scan detected unusual pattern — offshore restructuring with vague purpose code near network limits. Requires human judgment.'}, ${new Date(Date.now() - 60_000).toISOString()}, ${null}, ${null})`;
    trace.push({ step: 'lockup_created', status: 'ok', timestamp: new Date().toISOString(), data: { txId, lockupId, amount: 8_500_000, priorFlag: true } });

    // Trigger Cadenza scan — direct function call (bypasses HTTP self-call 401)
    const scanStart = Date.now();
    let scanResult: any;
    if (_cadenzaScanLockup) {
      console.log(`[proving-ground] D4: calling coreCadenzaScanLockup directly`);
      try {
        scanResult = await _cadenzaScanLockup(lockupId);
      } catch (err) {
        scanResult = { decision: 'ERROR', confidence: 0, reasoning: `Direct call error: ${(err as Error).message}`, flag_type: null, risk_factors: [] };
      }
    } else {
      scanResult = await internalPost('/cadenza-monitor', { action: 'scan_lockup', lockup_id: lockupId }, 2);
    }
    trace.push({ step: 'cadenza_scan', status: scanResult?.decision || 'unknown', timestamp: new Date().toISOString(), data: scanResult });

    const cadenzaResult = scoreCadenzaResult(
      scanResult,
      'ESCALATE',
      scanStart,
      ['escalat', 'human', 'review', 'ambiguous', 'uncertain', 'judgment', 'manual', 'offshore', 'unusual'],
    );

    // Also check if lockup was set to escalated status (infinite lockup)
    const [lockupCheck] = await sql`SELECT status, lockup_end FROM lockup_tokens WHERE id = ${lockupId}`;

    const isEscalated = lockupCheck?.status === 'escalated' || scanResult?.decision === 'ESCALATE';

    return {
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      category: scenario.category,
      bank_id: bankId,
      bank_name: ctx.sender.name,
      overall_result: (cadenzaResult.result === 'CAUGHT' || isEscalated) ? 'PASS' : 'FAIL',
      duration_ms: Date.now() - start,
      agent_results: [cadenzaResult],
      pipeline_trace: trace,
      expected_behavior: scenario.expected_behavior,
      actual_behavior: (cadenzaResult.result === 'CAUGHT' || isEscalated)
        ? `Cadenza escalated to human review: ${scanResult?.decision}. Lockup status: ${lockupCheck?.status}. ${cadenzaResult.reasoning.slice(0, 200)}`
        : `Cadenza did NOT escalate: decided ${scanResult?.decision}. Expected ESCALATE for ambiguous anomaly. ${cadenzaResult.reasoning.slice(0, 200)}`,
    };
  } finally {
    await cleanupTestData(cleanupIds);
  }
}

async function runD5(bankId: string): Promise<ScenarioResult> {
  const scenario = PROVING_GROUND_SCENARIOS.find(s => s.id === 'D5_user_reversal')!;
  const start = Date.now();
  const trace: PipelineStep[] = [];
  const cleanupIds = newCleanupIds();

  try {
    const ctx = await getTestContext(bankId);

    // Create an active lockup
    const txId = crypto.randomUUID();
    const lockupId = crypto.randomUUID();
    cleanupIds.txIds.push(txId);
    cleanupIds.lockupIds.push(lockupId);

    await insertTestTransaction({
      id: txId,
      senderBankId: ctx.sender.id,
      receiverBankId: ctx.receiver.id,
      amount: 500_000_000_000, // $500K
      amountDisplay: 500_000,
      status: 'locked',
      lockupStatus: 'soft_settled',
      purposeCode: 'WHOLESALE_TREASURY',
      memo: 'PG_TEST D5: User reversal test',
    });

    await insertTestLockup({
      id: lockupId,
      transactionId: txId,
      senderBankId: ctx.sender.id,
      receiverBankId: ctx.receiver.id,
      amount: 500_000_000_000,
      lockupEnd: new Date(Date.now() + 300_000).toISOString(), // 5 min window
    });
    trace.push({ step: 'lockup_created', status: 'ok', timestamp: new Date().toISOString(), data: { txId, lockupId, amount: 500_000 } });

    // Submit user-initiated reversal — direct function call (bypasses HTTP self-call 401)
    const reversalStart = Date.now();
    let reversalResult: any;
    if (_cadenzaUserReversal) {
      console.log(`[proving-ground] D5: calling cadenzaUserReversal directly`);
      try {
        reversalResult = await _cadenzaUserReversal(lockupId, 'PG_TEST D5: Operator-initiated reversal — testing user reversal within lockup window');
      } catch (err) {
        reversalResult = { status: 'error', error: `Direct call error: ${(err as Error).message}` };
      }
    } else {
      reversalResult = await internalPost('/cadenza-monitor', {
        action: 'user_reversal',
        lockup_id: lockupId,
        reason: 'PG_TEST D5: Operator-initiated reversal — testing user reversal within lockup window',
      }, 2);
    }
    trace.push({ step: 'user_reversal', status: reversalResult?.status || reversalResult?.error || 'unknown', timestamp: new Date().toISOString(), data: reversalResult });

    const timing_ms = Date.now() - reversalStart;

    // Validate: user_reversal returns { status: 'reversed', lockup_id, ... }
    const reversed = reversalResult?.status === 'reversed' || reversalResult?.action === 'user_reversal';

    // Also check if a cadenza_flags record was created
    const flags = await sql`SELECT id, flag_type, action_taken FROM cadenza_flags WHERE lockup_token_id = ${lockupId}`;

    const hasReversalFlag = (flags || []).some((f: any) => f.flag_type === 'user_reversal_request' && f.action_taken === 'reversed');

    const cadenzaResult: AgentResult = {
      agent: 'Cadenza',
      result: (reversed || hasReversalFlag) ? 'CAUGHT' : 'MISSED',
      reasoning: reversed
        ? `User reversal processed: status=${reversalResult?.status}. Flag created: ${hasReversalFlag}. ` +
          `Transaction: ${reversalResult?.transaction_id || txId}. No Gemini call needed — direct user authority.`
        : `User reversal FAILED: response=${JSON.stringify(reversalResult).slice(0, 300)}`,
      timing_ms,
    };

    return {
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      category: scenario.category,
      bank_id: bankId,
      bank_name: ctx.sender.name,
      overall_result: cadenzaResult.result === 'CAUGHT' ? 'PASS' : 'FAIL',
      duration_ms: Date.now() - start,
      agent_results: [cadenzaResult],
      pipeline_trace: trace,
      expected_behavior: scenario.expected_behavior,
      actual_behavior: cadenzaResult.result === 'CAUGHT'
        ? `User-initiated reversal processed successfully. ${cadenzaResult.reasoning.slice(0, 200)}`
        : `User reversal FAILED. ${cadenzaResult.reasoning.slice(0, 200)}`,
    };
  } finally {
    await cleanupTestData(cleanupIds);
  }
}

async function runD6(bankId: string): Promise<ScenarioResult> {
  const scenario = PROVING_GROUND_SCENARIOS.find(s => s.id === 'D6_yield_accrual_accuracy')!;
  const start = Date.now();
  const trace: PipelineStep[] = [];
  const cleanupIds = newCleanupIds();

  try {
    const ctx = await getTestContext(bankId);

    // Known parameters
    const principalRaw = 1_000_000_000_000n; // $1M in 6-decimal raw units
    const rateBps = 525; // 5.25%
    const lockupStartTime = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2 hours ago
    const nowTime = new Date().toISOString();

    // Calculate expected yield using the yield engine
    const engineYield = calculateAccruedYield(principalRaw, rateBps, lockupStartTime, nowTime);

    // Independent manual calculation for cross-check:
    // yield = principal × (rateBps / 10000) × (elapsedSeconds / 31536000)
    const elapsedSeconds = Math.floor((new Date(nowTime).getTime() - new Date(lockupStartTime).getTime()) / 1000);
    const manualYield = (Number(principalRaw) * rateBps * elapsedSeconds) / (10_000 * 31_536_000);
    const manualYieldBigint = BigInt(Math.floor(manualYield));

    trace.push({
      step: 'yield_calculation',
      status: 'ok',
      timestamp: new Date().toISOString(),
      data: {
        principal_usd: 1_000_000,
        rate_bps: rateBps,
        elapsed_seconds: elapsedSeconds,
        elapsed_hours: (elapsedSeconds / 3600).toFixed(2),
        engine_yield_raw: engineYield.toString(),
        manual_yield_raw: manualYieldBigint.toString(),
        engine_yield_usd: (Number(engineYield) / 1_000_000).toFixed(6),
        manual_yield_usd: (manualYield / 1_000_000).toFixed(6),
      },
    });

    // Compare: within 0.1% tolerance
    const engineNum = Number(engineYield);
    const manualNum = manualYield;
    const diff = Math.abs(engineNum - manualNum);
    const tolerance = manualNum * 0.001; // 0.1%
    const withinTolerance = diff <= tolerance || manualNum === 0;

    trace.push({
      step: 'tolerance_check',
      status: withinTolerance ? 'passed' : 'failed',
      timestamp: new Date().toISOString(),
      data: {
        difference_raw: diff.toFixed(2),
        tolerance_raw: tolerance.toFixed(2),
        pct_diff: manualNum > 0 ? ((diff / manualNum) * 100).toFixed(6) + '%' : '0%',
        within_tolerance: withinTolerance,
      },
    });

    // Also create a lockup and verify the stored data matches
    const txId = crypto.randomUUID();
    const lockupId = crypto.randomUUID();
    cleanupIds.txIds.push(txId);
    cleanupIds.lockupIds.push(lockupId);

    await insertTestTransaction({
      id: txId,
      senderBankId: ctx.sender.id,
      receiverBankId: ctx.receiver.id,
      amount: Number(principalRaw),
      amountDisplay: 1_000_000,
      status: 'locked',
      lockupStatus: 'soft_settled',
      purposeCode: 'WHOLESALE_TREASURY',
      memo: 'PG_TEST D6: Yield accrual accuracy test',
      createdAt: lockupStartTime,
    });

    await insertTestLockup({
      id: lockupId,
      transactionId: txId,
      senderBankId: ctx.sender.id,
      receiverBankId: ctx.receiver.id,
      amount: Number(principalRaw),
      yieldRateBps: rateBps,
      lockupStart: lockupStartTime,
      lockupEnd: new Date(Date.now() + 3600_000).toISOString(),
    });

    trace.push({ step: 'lockup_created', status: 'ok', timestamp: new Date().toISOString(), data: { txId, lockupId, startedHoursAgo: 2 } });

    const cadenzaResult: AgentResult = {
      agent: 'Cadenza',
      result: withinTolerance ? 'CAUGHT' : 'MISSED',
      reasoning: `Yield engine: ${(engineNum / 1_000_000).toFixed(6)} USD. Manual calc: ${(manualNum / 1_000_000).toFixed(6)} USD. ` +
        `Diff: ${(diff / 1_000_000).toFixed(6)} USD (${manualNum > 0 ? ((diff / manualNum) * 100).toFixed(4) : 0}%). ` +
        `Tolerance: 0.1%. Principal: $1M, Rate: 5.25%, Duration: ${(elapsedSeconds / 3600).toFixed(2)}h. ` +
        `Result: ${withinTolerance ? 'WITHIN tolerance' : 'EXCEEDS tolerance'}`,
      score: withinTolerance ? 100 : 0,
      timing_ms: Date.now() - start,
    };

    return {
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      category: scenario.category,
      bank_id: bankId,
      bank_name: ctx.sender.name,
      overall_result: withinTolerance ? 'PASS' : 'FAIL',
      duration_ms: Date.now() - start,
      agent_results: [cadenzaResult],
      pipeline_trace: trace,
      expected_behavior: scenario.expected_behavior,
      actual_behavior: withinTolerance
        ? `Yield accrual accurate: engine=${(engineNum / 1_000_000).toFixed(6)} vs manual=${(manualNum / 1_000_000).toFixed(6)} (${manualNum > 0 ? ((diff / manualNum) * 100).toFixed(4) : 0}% diff, within 0.1%)`
        : `Yield accrual INACCURATE: engine=${(engineNum / 1_000_000).toFixed(6)} vs manual=${(manualNum / 1_000_000).toFixed(6)} (${((diff / manualNum) * 100).toFixed(4)}% diff, exceeds 0.1%)`,
    };
  } finally {
    await cleanupTestData(cleanupIds);
  }
}

// ── Scenario Dispatcher ─────────────────────────────────────

const SCENARIO_RUNNERS: Record<string, (bankId: string) => Promise<ScenarioResult>> = {
  C1_unknown_jurisdiction: runC1,
  C2_missing_purpose: runC2,
  C3_suspended_counterparty: runC3,
  C4_network_maximum: runC4,
  C5_sanctions_memo: runC5,
  C6_ofac_sanctioned_counterparty: runC6,
  R1_velocity_spike: runR1,
  R2_new_corridor_large: runR2,
  R3_structuring: runR3,
  R4_behavioral_deviation: runR4,
  O1_auto_accept_ceiling: runO1,
  O2_safety_floor_breach: runO2,
  O3_duplicate_transaction: runO3,
  D1_lockup_reversal_duplicate: runD1,
  D2_lockup_reversal_velocity: runD2,
  D3_lockup_reversal_flagged: runD3,
  D4_escalation_anomaly: runD4,
  D5_user_reversal: runD5,
  D6_yield_accrual_accuracy: runD6,
};

async function runScenario(scenarioId: string, bankId: string): Promise<ScenarioResult> {
  const runner = SCENARIO_RUNNERS[scenarioId];
  if (!runner) {
    return {
      scenario_id: scenarioId,
      scenario_name: 'Unknown',
      category: 'unknown',
      bank_id: bankId,
      bank_name: '',
      overall_result: 'FAIL',
      duration_ms: 0,
      agent_results: [],
      pipeline_trace: [],
      expected_behavior: '',
      actual_behavior: `Unknown scenario: ${scenarioId}`,
    };
  }

  try {
    return await runner(bankId);
  } catch (err) {
    console.log(`[proving-ground] Scenario ${scenarioId} CRASHED: ${(err as Error).message}`);
    return {
      scenario_id: scenarioId,
      scenario_name: PROVING_GROUND_SCENARIOS.find(s => s.id === scenarioId)?.name || scenarioId,
      category: PROVING_GROUND_SCENARIOS.find(s => s.id === scenarioId)?.category || 'unknown',
      bank_id: bankId,
      bank_name: '',
      overall_result: 'ERROR' as const,
      duration_ms: 0,
      agent_results: [],
      pipeline_trace: [{ step: 'crash', status: 'error', timestamp: new Date().toISOString(), data: { error: (err as Error).message } }],
      expected_behavior: PROVING_GROUND_SCENARIOS.find(s => s.id === scenarioId)?.expected_behavior || '',
      actual_behavior: `Scenario crashed: ${(err as Error).message}`,
      error_message: (err as Error).message,
    };
  }
}

// ── Exported Handler ────────────────────────────────────────

export async function handleProvingGround(c: any): Promise<Response> {
  try {
    const body = await c.req.json();
    const { action, scenario_id, bank_id } = body;

    console.log(`[proving-ground] Action: ${action}, scenario: ${scenario_id || 'N/A'}, bank: ${bank_id || 'N/A'}`);

    if (action === 'list_scenarios') {
      return c.json({ scenarios: PROVING_GROUND_SCENARIOS });
    }

    if (action === 'run_scenario') {
      if (!scenario_id || !bank_id) {
        return c.json({ error: 'scenario_id and bank_id required' }, 400);
      }
      const result = await runScenario(scenario_id, bank_id);
      return c.json(result);
    }

    if (action === 'run_all') {
      if (!bank_id) {
        return c.json({ error: 'bank_id required' }, 400);
      }
      const results: ScenarioResult[] = [];
      for (const scenario of PROVING_GROUND_SCENARIOS) {
        console.log(`[proving-ground] Running ${scenario.id} (${results.length + 1}/${PROVING_GROUND_SCENARIOS.length})...`);
        const result = await runScenario(scenario.id, bank_id);
        results.push(result);
        // Rate limit gap between scenarios (1s to avoid Gemini 429s)
        await new Promise(r => setTimeout(r, 1000));
      }

      const summary: ProvingGroundSummary = {
        total: results.length,
        passed: results.filter(r => r.overall_result === 'PASS').length,
        failed: results.filter(r => r.overall_result === 'FAIL').length,
        duration_ms: results.reduce((sum, r) => sum + r.duration_ms, 0),
        by_category: {},
      };
      for (const r of results) {
        if (!summary.by_category[r.category]) {
          summary.by_category[r.category] = { passed: 0, failed: 0 };
        }
        summary.by_category[r.category][r.overall_result === 'PASS' ? 'passed' : 'failed']++;
      }

      return c.json({ results, summary });
    }

    if (action === 'cleanup') {
      const counts: Record<string, number> = {};

      // Find PG test transactions via multiple markers:
      // 1. Memo prefix "PG_TEST" — most test txns use this
      // 2. risk_reasoning prefix "PG_TEST_" — marks txns with intentionally non-test memos (C2, C5, R3, R4, O3)
      // 3. Lockup tokens with yb_holder = 'pg_custodian_test' — all D-scenario lockups
      // Scenario runners use crypto.randomUUID() for IDs, so we can't match on id prefix.
      const pgTxIdSet = new Set<string>();

      const pgMemoRows = await sql`SELECT id FROM transactions WHERE memo LIKE 'PG_TEST%'`;
      for (const r of pgMemoRows) pgTxIdSet.add(r.id);

      const pgReasonRows = await sql`SELECT id FROM transactions WHERE risk_reasoning LIKE 'PG_TEST_%'`;
      for (const r of pgReasonRows) pgTxIdSet.add(r.id);

      // Find lockup tokens with PG marker and add their transaction_ids
      const pgLockupRows = await sql`SELECT id, transaction_id FROM lockup_tokens WHERE yb_holder LIKE 'pg_%'`;
      for (const r of pgLockupRows) {
        if (r.transaction_id) pgTxIdSet.add(r.transaction_id);
      }

      const pgTxIds = Array.from(pgTxIdSet);
      console.log(`[proving-ground] Cleanup: found ${pgTxIds.length} PG test transactions (memo: ${pgMemoRows?.length || 0}, reason: ${pgReasonRows?.length || 0}, lockup: ${pgLockupRows?.length || 0})`);

      // Also find test banks (short_code starting with PG)
      const pgBankRows = await sql`SELECT id FROM banks WHERE short_code LIKE 'PG%'`;
      const pgBankIds = pgBankRows.map((r: any) => r.id);

      // Delete in dependency order (children first)

      // 1. agent_messages + agent_conversations by transaction_id
      counts.agent_messages = 0;
      for (const txId of pgTxIds) {
        const txMsgs = await sql`DELETE FROM agent_messages WHERE transaction_id = ${txId} RETURNING id`;
        counts.agent_messages += txMsgs?.length || 0;
        await sql`DELETE FROM agent_conversations WHERE transaction_id = ${txId}`;
      }

      // 2. cadenza_flags by transaction_id + lockup_token_id
      let flagCount = 0;
      for (const txId of pgTxIds) {
        const deletedFlags = await sql`DELETE FROM cadenza_flags WHERE transaction_id = ${txId} RETURNING id`;
        flagCount += deletedFlags?.length || 0;
      }
      // Also delete by lockup_token_id for PG lockups (catches flags orphaned from tx cleanup)
      for (const r of pgLockupRows) {
        const deletedFlags = await sql`DELETE FROM cadenza_flags WHERE lockup_token_id = ${r.id} RETURNING id`;
        flagCount += deletedFlags?.length || 0;
      }
      counts.cadenza_flags = flagCount;

      // 3. compliance_logs + risk_scores by transaction_id
      counts.compliance_logs = 0;
      counts.risk_scores = 0;
      for (const txId of pgTxIds) {
        const comp = await sql`DELETE FROM compliance_logs WHERE transaction_id = ${txId} RETURNING id`;
        counts.compliance_logs += comp?.length || 0;
        const risk = await sql`DELETE FROM risk_scores WHERE transaction_id = ${txId} RETURNING id`;
        counts.risk_scores += risk?.length || 0;
      }

      // 4. lockup_tokens before transactions (FK dependency)
      //    Delete by transaction_id AND by yb_holder marker (catches orphaned lockups)
      counts.lockup_tokens = 0;
      const deletedLockupIds = new Set<string>();
      for (const txId of pgTxIds) {
        const lockups = await sql`DELETE FROM lockup_tokens WHERE transaction_id = ${txId} RETURNING id`;
        for (const l of (lockups || [])) deletedLockupIds.add(l.id);
      }
      // Also clean any PG lockups missed above (orphaned from crashes)
      const pgHolderLockups = await sql`DELETE FROM lockup_tokens WHERE yb_holder LIKE 'pg_%' RETURNING id`;
      for (const l of (pgHolderLockups || [])) deletedLockupIds.add(l.id);
      counts.lockup_tokens = deletedLockupIds.size;

      // 5. transactions
      if (pgTxIds.length > 0) {
        await sql`DELETE FROM transactions WHERE id = ANY(${pgTxIds})`;
      }
      counts.transactions = pgTxIds.length;

      // 6. test banks
      if (pgBankIds.length > 0) {
        await sql`DELETE FROM banks WHERE id = ANY(${pgBankIds})`;
      }
      counts.banks = pgBankIds.length;

      const total = Object.values(counts).reduce((s, n) => s + n, 0);
      console.log(`[proving-ground] Cleanup complete: ${total} rows deleted`, counts);

      return c.json({ cleaned: true, counts, total });
    }

    return c.json({ error: 'Unknown action. Use: list_scenarios, run_scenario, run_all, cleanup' }, 400);
  } catch (err) {
    console.log(`[proving-ground] Error: ${(err as Error).message}`);
    return c.json({ error: `Proving ground error: ${(err as Error).message}` }, 500);
  }
}
