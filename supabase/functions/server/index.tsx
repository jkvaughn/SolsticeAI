// v6 -- Task 122: Fix lockup_status 'finalized' → 'hard_finality' in coreLockupSettle + /lockup-settle route
import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { getAdminClient } from "./supabase-admin.tsx";
import { callGemini, callGeminiJSON } from "./gemini.tsx";
import { handleProvingGround, setCadenzaDirectHandlers, setAgentDirectHandlers } from "./proving-ground.tsx";
import { handleAria } from "./aria.tsx";
import { calculateAccruedYield, formatYieldUsd } from "./yield-engine.tsx";
import {
  generateWallet,
  activateBank,
  executeTransfer,
  getTokenBalance,
  getSolBalance,
  tokenSymbol,
  TOKEN_DECIMALS,
  type ISO20022MemoFields,
  burnDepositToken,
  mintDepositToken,
  sendNetworkFee,
  NETWORK_FEE_SOL,
  createLockupMint,
  mintLockupToEscrow,
  burnLockupFromEscrow,
  LOCKUP_TOKEN_SYMBOL,
} from "./solana-real.tsx";

// ── Prompt modules ─────────────────────────────────────────
import {
  TREASURY_CYCLE_APPENDIX,
  AGENT_THINK_RESPONSE_FORMAT,
  AGENT_THINK_RESPONSE_FORMAT_COMPACT,
  CONCORD_SYSTEM_PROMPT,
  FERMATA_SYSTEM_PROMPT,
  MANDATE_GENERATION_SYSTEM_PROMPT,
  CADENZA_SYSTEM_IDENTITY,
} from "./shared-context.ts";
import {
  buildAgentSystemPrompt,
  buildAgentChatPrompt,
  buildTreasuryCyclePrompt,
  buildMandateGenerationPrompt,
  MAESTRO_PERSONALITY_SYSTEM_PROMPT,
  buildMaestroPersonalityUserPrompt,
  type AgentChatPromptParams,
} from "./maestro-prompts.ts";
import {
  buildConcordNarrativePrompt,
  concordNarrativeFallback,
} from "./concord-prompts.ts";
import {
  buildRiskScoringPrompt,
} from "./fermata-prompts.ts";
import {
  buildCadenzaMonitoringPrompt,
  buildCadenzaEscalationPrompt,
  buildCadenzaPeriodicScanPrompt,
  type CadenzaMonitoringParams,
  type CadenzaEscalationParams,
  type CadenzaPeriodicScanParams,
  type CorridorTx,
  type VelocityStats,
  type CadenzaFlag,
  type LockupTokenData,
  type TransactionData,
  type BankData,
  type ActiveLockupSummary,
} from "./cadenza-prompts.ts";

const app = new Hono();

// ── SWIFT/BIC Registry ─────────────────────────────────────
// Real SWIFT codes for known institutions. Used in ISO 20022
// pacs.009 on-chain memos. Falls back to short_code for
// unknown banks.
// ────────────────────────────────────────────────────────────
const SWIFT_BIC_REGISTRY: Record<string, string> = {
  JPM:  "CHASUS33",   // JPMorgan Chase, New York
  CITI: "CITIUS33",   // Citibank N.A., New York
  BAC:  "BOFAUS3N",   // Bank of America, Charlotte
  WFC:  "WFBIUS6S",   // Wells Fargo, San Francisco
  GS:   "GSCMUS33",   // Goldman Sachs, New York
  MS:   "MSTCUS33",   // Morgan Stanley, New York
  USB:  "USBKUS44",   // U.S. Bancorp, Minneapolis
  PNC:  "PNCCUS33",   // PNC Financial, Pittsburgh
  TD:   "TDOMCATT",   // TD Bank, Toronto
  HSBC: "MRMDUS33",   // HSBC USA, New York
  FNBT: "FNBTUS44",   // First National Bank of Texas (demo)
  UBS:  "UBSWCHZH",   // UBS Group AG, Zurich
};

/** Resolve SWIFT/BIC: bank record → registry → short_code fallback */
function resolveBic(bank: { swift_bic?: string; short_code: string }): string {
  return bank.swift_bic || SWIFT_BIC_REGISTRY[bank.short_code] || bank.short_code;
}

// ── Simulated OFAC Watchlist (Task 127) ─────────────────────
// Idempotent seed: inserts 20 rows if the table is empty.
// 17 clean fictional entities + 3 flagged (RGSTUS33, SHCPKY22, PHTRRU44).
// ────────────────────────────────────────────────────────────

let watchlistSeeded = false;

async function seedWatchlistIfNeeded(supabase: any): Promise<void> {
  if (watchlistSeeded) return;
  const { count } = await supabase.from("simulated_watchlist").select("id", { count: "exact", head: true });
  if (count && count > 0) { watchlistSeeded = true; return; }

  const rows = [
    // 3 flagged entities
    { entity_name: "Rogue State Bank", bic_code: "RGSTUS33", list_type: "OFAC_SDN", status: "active", reason: "State-sponsored financial institution" },
    { entity_name: "Shadow Capital Ltd", bic_code: "SHCPKY22", list_type: "UN_CONSOLIDATED", status: "active", reason: "Proliferation financing" },
    { entity_name: "Phantom Trust Co", bic_code: "PHTRRU44", list_type: "OFAC_SDN", status: "active", reason: "Sanctions evasion network" },
    // 17 clean fictional entities
    { entity_name: "Clearwater National Bank", bic_code: "CLWNUS33", list_type: "OFAC_SDN", status: "removed", reason: "Delisted 2024-01" },
    { entity_name: "Pacific Rim Credit Union", bic_code: "PACRUS66", list_type: "OFAC_SDN", status: "removed", reason: "Compliance resolved" },
    { entity_name: "Meridian Trade Finance", bic_code: "MRTFGB2L", list_type: "EU_CONSOLIDATED", status: "removed", reason: "Entity dissolved" },
    { entity_name: "Alpine Savings AG", bic_code: "ALPSCHZZ", list_type: "OFAC_SDN", status: "removed", reason: "Delisted 2023-06" },
    { entity_name: "Sunrise Commercial Bank", bic_code: "SRCBJPJT", list_type: "UN_CONSOLIDATED", status: "removed", reason: "Compliance resolved" },
    { entity_name: "Northern Star Holdings", bic_code: "NSTHDKKK", list_type: "EU_CONSOLIDATED", status: "removed", reason: "Entity restructured" },
    { entity_name: "Gateway Pacific Corp", bic_code: "GTWPAU2S", list_type: "OFAC_SDN", status: "removed", reason: "Delisted 2024-03" },
    { entity_name: "Emerald Coast Financial", bic_code: "EMCFUS44", list_type: "OFAC_SDN", status: "removed", reason: "False positive cleared" },
    { entity_name: "Ironclad Securities Ltd", bic_code: "IRCLGB22", list_type: "EU_CONSOLIDATED", status: "removed", reason: "Compliance resolved" },
    { entity_name: "Horizon Wealth Management", bic_code: "HZWMHKHH", list_type: "UN_CONSOLIDATED", status: "removed", reason: "Delisted 2023-11" },
    { entity_name: "Redwood Trust Company", bic_code: "RDWTCA33", list_type: "OFAC_SDN", status: "removed", reason: "Entity dissolved" },
    { entity_name: "Starlight Investment Bank", bic_code: "STLISGSG", list_type: "OFAC_SDN", status: "removed", reason: "Compliance resolved" },
    { entity_name: "Atlas Trade Corp", bic_code: "ATLTNL2A", list_type: "EU_CONSOLIDATED", status: "removed", reason: "False positive cleared" },
    { entity_name: "Coral Bay Finance", bic_code: "CRBFKY11", list_type: "UN_CONSOLIDATED", status: "removed", reason: "Delisted 2024-02" },
    { entity_name: "Summit Ridge Banking", bic_code: "SMRDUS77", list_type: "OFAC_SDN", status: "removed", reason: "Entity restructured" },
    { entity_name: "Oceanic Trust Group", bic_code: "OCTGMUMU", list_type: "EU_CONSOLIDATED", status: "removed", reason: "Compliance resolved" },
    { entity_name: "Pinnacle Financial Partners", bic_code: "PNFPUS55", list_type: "OFAC_SDN", status: "removed", reason: "Delisted 2023-09" },
  ];

  const { error } = await supabase.from("simulated_watchlist").insert(rows.map(r => ({ id: crypto.randomUUID(), ...r })));
  if (error) {
    console.log(`[watchlist] Seed error: ${error.message}`);
  } else {
    console.log(`[watchlist] Seeded ${rows.length} entities (3 flagged, 17 clean)`);
  }
  watchlistSeeded = true;
}

/** Check if sender or receiver BIC is on the active watchlist */
async function checkWatchlist(supabase: any, senderBic: string, receiverBic: string): Promise<{ hit: boolean; matches: any[] }> {
  await seedWatchlistIfNeeded(supabase);
  const { data, error } = await supabase
    .from("simulated_watchlist")
    .select("*")
    .in("bic_code", [senderBic, receiverBic])
    .eq("status", "active");
  if (error) {
    console.log(`[watchlist] Query error: ${error.message}`);
    return { hit: false, matches: [] };
  }
  return { hit: (data || []).length > 0, matches: data || [] };
}

// ── ISO 20022 pacs.009 lockup memo builder ─────────────────
// Mirrors the memo format in executeTransfer() (solana-real.tsx)
// so that lockup-flow on-chain operations carry the same
// standards-compliant audit trail as direct PvP swaps.
// ────────────────────────────────────────────────────────────
interface LockupMemoParams {
  transactionId: string;
  senderBank: { short_code: string; name: string; swift_bic?: string };
  receiverBank: { short_code: string; name: string; swift_bic?: string };
  amount: string;              // human-readable, e.g. "2000000.00"
  currency?: string;           // default "USD"
  purposeCode?: string;        // e.g. "WHOLESALE", "OTHER"
  remittanceInfo?: string;     // tx.memo free-text
  phase: string;               // e.g. "Phase 1 — Sender Burn", "Phase 2 — Hard Finality Mint"
  operation: string;           // e.g. "BURN", "ESCROW_MINT", "ESCROW_BURN", "FINALITY_MINT"
}

function buildISO20022LockupMemo(p: LockupMemoParams): string {
  const creDtTm = new Date().toISOString().replace(/\.\d{3}Z$/, "Z"); // drop milliseconds
  const ccy = p.currency ?? "USD";
  const purpose = p.purposeCode || "settlement";
  const rmtLine = p.remittanceInfo ? `\nRemittance: ${p.remittanceInfo}` : "";

  const memo = [
    `CODA pacs.009 Settlement`,
    `------------------------------------`,
    `TxId:    ${p.transactionId.slice(0, 8)}`,
    `Date:    ${creDtTm}`,
    `Amount:  ${p.amount} ${ccy}`,
    `From:    ${resolveBic(p.senderBank)} (${p.senderBank.name})`,
    `To:      ${resolveBic(p.receiverBank)} (${p.receiverBank.name})`,
    `Purpose: ${purpose}`,
    `Phase:   ${p.phase}`,
    `Op:      ${p.operation}`,
    ...(rmtLine ? [rmtLine.trim()] : []),
  ].join("\n");

  // Size guard: Solana memo program limit is ~566 bytes
  const memoBytes = new TextEncoder().encode(memo);
  if (memoBytes.length > 566) {
    // Truncate remittance info to fit
    const overhead = memoBytes.length - 566;
    if (p.remittanceInfo && p.remittanceInfo.length > overhead + 3) {
      return buildISO20022LockupMemo({ ...p, remittanceInfo: p.remittanceInfo.slice(0, -(overhead + 3)) + "..." });
    }
    // Last resort: drop remittance
    return buildISO20022LockupMemo({ ...p, remittanceInfo: undefined });
  }
  return memo;
}

// ── Network Mode Context ───────────────────────────────────
// When running in Devnet Mode (default), all Gemini prompts
// receive a preamble explaining that Solana Devnet settlement
// is expected and should NOT be flagged as an operational risk.
// ────────────────────────────────────────────────────────────
import * as kv from "./kv_store.tsx";

const DEVNET_CONTEXT = `
NETWORK ENVIRONMENT: SOLANA DEVNET (Demo Mode)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This is a controlled demonstration environment running on Solana Devnet.
All token settlements use Token-2022 program on Devnet with synthetic tokenized deposits.
This is the INTENDED and CORRECT infrastructure for this demo — Devnet settlement
is NOT an operational risk. Do NOT flag Devnet, test environments, or Token-2022
as risk factors. Evaluate transactions purely on financial merit: counterparty
reputation, jurisdiction compliance, amount thresholds, and purpose codes.
Treat all on-chain settlements as if they have production-grade finality.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

export function getNetworkModeContext(): string {
  const cluster = Deno.env.get("SOLANA_CLUSTER") || "devnet";
  if (cluster === "mainnet-beta") return ""; // Production — no context injection
  return DEVNET_CONTEXT; // Devnet/default — inject demo-mode context
}

app.use("*", logger(console.log));

app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  })
);

// Agent ID helper
function agentId(bankId: string): string {
  return `solstice_ai_maestro_${bankId}`;
}

// ============================================================
// Network Defaults — fallback values when a bank's config is NULL
// ============================================================
export const NETWORK_DEFAULTS = {
  auto_accept_ceiling: 10_000_000,
  escalation_first_time_threshold: 1_000_000,
  escalation_cross_jurisdiction: 5_000_000,
  escalation_velocity_count: 3,
  default_lockup_duration_minutes: 30,  // Task 117: sender-specified lockup. 0=instant PvP, >0=min lockup window in minutes
  jurisdiction_whitelist: ['US', 'GB', 'EU', 'JP', 'SG', 'CH', 'CA', 'AU'],
  approved_purpose_codes: ['WHOLESALE_TREASURY', 'INTERBANK_SETTLEMENT', 'LIQUIDITY_MGMT', 'REPO_SETTLEMENT', 'COLLATERAL_TRANSFER', 'CROSS_BORDER', 'FX_SETTLEMENT'],
  risk_weight_counterparty: 0.30,
  risk_weight_jurisdiction: 0.25,
  risk_weight_asset_type: 0.20,
  risk_weight_behavioral: 0.25,
  risk_instant_ceiling: 30,
  risk_deferred_24h_ceiling: 50,
  risk_deferred_72h_ceiling: 70,
  balance_safety_floor_pct: 0.20,
  heartbeat_participation: true,
  // Cadenza (Dispute Resolution)
  cadenza_monitoring_sensitivity: 'balanced',
  cadenza_auto_reverse_enabled: true,
  cadenza_escalation_threshold: 0.6,
  cadenza_velocity_spike_multiplier: 3.0,
  cadenza_duplicate_window_seconds: 300,
  cadenza_max_lockup_hours: 72,
  // Network fee (SOL gas-layer fee per settlement)
  network_fee_sol: NETWORK_FEE_SOL,  // 0.001 SOL per settlement
} as const;

// ============================================================
// Helper: Collect network fee (SOL gas-layer) after settlement
// MANDATORY — fee failure BLOCKS the settlement. No agent or
// user can bypass paying network fees.
// ============================================================
async function collectNetworkFee(
  senderKeypairEncrypted: string,
  transactionId: string,
  settlementMethod: string,
  settlementMemo: string,
  logPrefix: string = "[network-fee]",
): Promise<{ feeSig: string; feeSol: number }> {
  // Load Solstice fees wallet — primary: network_wallets table, fallback: KV store
  const supabase = getAdminClient();
  let feesWalletAddress: string | null = null;

  // Try network_wallets table first (source of truth)
  try {
    const { data: solsticeRow } = await supabase
      .from("network_wallets")
      .select("wallet_address")
      .eq("code", "SOLSTICE_FEES")
      .maybeSingle();
    if (solsticeRow?.wallet_address) {
      feesWalletAddress = solsticeRow.wallet_address;
    }
  } catch (dbErr) {
    console.log(`${logPrefix} ⚠ network_wallets query failed, trying KV fallback: ${(dbErr as Error).message}`);
  }

  // Fallback to KV store
  if (!feesWalletAddress) {
    const feesWalletRaw = await kv.get("infra:network_wallet:SOLSTICE_FEES");
    if (feesWalletRaw) {
      const feesWallet = JSON.parse(feesWalletRaw as string);
      feesWalletAddress = feesWallet.wallet_address;
    }
  }

  if (!feesWalletAddress) {
    throw new Error(`${logPrefix} Network fee enforcement: Solstice fees wallet not configured. Settlement blocked — configure the fees wallet via Network Setup before settling.`);
  }

  // Send fee — mandatory, will throw on failure
  const feeResult = await sendNetworkFee(senderKeypairEncrypted, feesWalletAddress);
  console.log(`${logPrefix} ✓ Network fee collected (mandatory): ${feeResult.feeSol} SOL → SOLSTICE_FEES`);

  // Update Solstice fees wallet balance in network_wallets table
  try {
    const { data: solsticeRow } = await supabase
      .from("network_wallets")
      .select("id, balance")
      .eq("code", "SOLSTICE_FEES")
      .maybeSingle();
    if (solsticeRow) {
      await supabase.from("network_wallets").update({
        balance: (solsticeRow.balance || 0) + feeResult.feeSol,
      }).eq("id", solsticeRow.id);
    }
  } catch (balErr) {
    console.log(`${logPrefix} ⚠ Failed to update fees wallet balance (non-critical): ${(balErr as Error).message}`);
  }

  // Update transaction record with fee + settlement metadata
  try {
    await supabase.from("transactions").update({
      network_fee_sol: feeResult.feeSol,
      settlement_method: settlementMethod,
      settlement_memo: settlementMemo,
    }).eq("id", transactionId);
  } catch (txErr) {
    console.log(`${logPrefix} ⚠ Failed to update tx fee metadata (non-critical): ${(txErr as Error).message}`);
  }

  return { feeSig: feeResult.signature, feeSol: feeResult.feeSol };
}

// ============================================================
// Helper: Shared lockup mint (Task 118)
// ============================================================
// Returns the LOCKUP-USTB mint address from KV store.
// If not yet created, creates it on-demand using BNY custodian.
// ============================================================
const KV_LOCKUP_MINT = "infra:lockup_mint:LOCKUP-USTB";

async function getCustodianKeypair(): Promise<{ keypairEncrypted: string; walletAddress: string }> {
  const supabase = getAdminClient();
  const rawCustodian = await kv.get("infra:custodian:BNY");
  if (!rawCustodian) throw new Error("BNY custodian not configured \u2014 run Network Setup first");
  const custodianData = JSON.parse(rawCustodian as string);

  let keypairEncrypted: string;
  if (custodianData.linked_bank_id) {
    const { data: bnyBank } = await supabase.from("banks").select("solana_wallet_keypair_encrypted, solana_wallet_pubkey").eq("id", custodianData.linked_bank_id).maybeSingle();
    keypairEncrypted = bnyBank?.solana_wallet_keypair_encrypted || custodianData.keypair_encrypted;
  } else {
    keypairEncrypted = custodianData.keypair_encrypted;
  }
  return { keypairEncrypted, walletAddress: custodianData.wallet_address };
}

async function ensureLockupMint(): Promise<{ mintAddress: string; ataAddress: string }> {
  const existing = await kv.get(KV_LOCKUP_MINT);
  if (existing) {
    const parsed = JSON.parse(existing as string);
    if (parsed.mintAddress) {
      return { mintAddress: parsed.mintAddress, ataAddress: parsed.ataAddress };
    }
  }

  console.log(`[lockup-mint] No existing LOCKUP-USTB mint found \u2014 creating...`);
  const { keypairEncrypted } = await getCustodianKeypair();
  const result = await createLockupMint(keypairEncrypted);

  await kv.set(KV_LOCKUP_MINT, JSON.stringify({
    mintAddress: result.mintAddress,
    ataAddress: result.ataAddress,
    createdAt: new Date().toISOString(),
    mintSignature: result.mintSignature,
  }));

  console.log(`[lockup-mint] \u2713 LOCKUP-USTB mint stored: ${result.mintAddress}`);
  return { mintAddress: result.mintAddress, ataAddress: result.ataAddress };
}

// ============================================================
// Helper: Load bank config merged with network defaults
// ============================================================
export async function getBankConfig(bankId: string) {
  const supabaseAdmin = getAdminClient();
  let data: any = null;
  try {
    const result = await supabaseAdmin
      .from('bank_agent_config')
      .select('*')
      .eq('bank_id', bankId)
      .maybeSingle();
    if (result.error) {
      console.log(`[getBankConfig] Query error for ${bankId}: ${result.error.message} (code: ${result.error.code}) — using defaults`);
    } else {
      data = result.data;
    }
  } catch (err) {
    console.log(`[getBankConfig] Exception for ${bankId}: ${(err as Error).message} — using defaults`);
  }

  return {
    bank_id: bankId,
    auto_accept_ceiling: data?.auto_accept_ceiling ?? NETWORK_DEFAULTS.auto_accept_ceiling,
    escalation_first_time_threshold: data?.escalation_first_time_threshold ?? NETWORK_DEFAULTS.escalation_first_time_threshold,
    escalation_cross_jurisdiction: data?.escalation_cross_jurisdiction ?? NETWORK_DEFAULTS.escalation_cross_jurisdiction,
    escalation_velocity_count: data?.escalation_velocity_count ?? NETWORK_DEFAULTS.escalation_velocity_count,
    default_lockup_duration_minutes: Number(data?.default_lockup_duration_minutes ?? NETWORK_DEFAULTS.default_lockup_duration_minutes),
    jurisdiction_whitelist: data?.jurisdiction_whitelist ?? [...NETWORK_DEFAULTS.jurisdiction_whitelist],
    approved_purpose_codes: data?.approved_purpose_codes ?? [...NETWORK_DEFAULTS.approved_purpose_codes],
    risk_weight_counterparty: Number(data?.risk_weight_counterparty ?? NETWORK_DEFAULTS.risk_weight_counterparty),
    risk_weight_jurisdiction: Number(data?.risk_weight_jurisdiction ?? NETWORK_DEFAULTS.risk_weight_jurisdiction),
    risk_weight_asset_type: Number(data?.risk_weight_asset_type ?? NETWORK_DEFAULTS.risk_weight_asset_type),
    risk_weight_behavioral: Number(data?.risk_weight_behavioral ?? NETWORK_DEFAULTS.risk_weight_behavioral),
    risk_instant_ceiling: data?.risk_instant_ceiling ?? NETWORK_DEFAULTS.risk_instant_ceiling,
    risk_deferred_24h_ceiling: data?.risk_deferred_24h_ceiling ?? NETWORK_DEFAULTS.risk_deferred_24h_ceiling,
    risk_deferred_72h_ceiling: data?.risk_deferred_72h_ceiling ?? NETWORK_DEFAULTS.risk_deferred_72h_ceiling,
    balance_safety_floor_pct: Number(data?.balance_safety_floor_pct ?? NETWORK_DEFAULTS.balance_safety_floor_pct),
    heartbeat_participation: data?.heartbeat_participation ?? NETWORK_DEFAULTS.heartbeat_participation,
    // Cadenza (Dispute Resolution)
    cadenza_monitoring_sensitivity: data?.cadenza_monitoring_sensitivity ?? NETWORK_DEFAULTS.cadenza_monitoring_sensitivity,
    cadenza_auto_reverse_enabled: data?.cadenza_auto_reverse_enabled ?? NETWORK_DEFAULTS.cadenza_auto_reverse_enabled,
    cadenza_escalation_threshold: Number(data?.cadenza_escalation_threshold ?? NETWORK_DEFAULTS.cadenza_escalation_threshold),
    cadenza_velocity_spike_multiplier: Number(data?.cadenza_velocity_spike_multiplier ?? NETWORK_DEFAULTS.cadenza_velocity_spike_multiplier),
    cadenza_duplicate_window_seconds: Number(data?.cadenza_duplicate_window_seconds ?? NETWORK_DEFAULTS.cadenza_duplicate_window_seconds),
    cadenza_max_lockup_hours: Number(data?.cadenza_max_lockup_hours ?? NETWORK_DEFAULTS.cadenza_max_lockup_hours),
  };
}

// ============================================================
// Health check
// ============================================================
app.get("/make-server-49d15288/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ============================================================
// Network Fee Info — Lightweight GET endpoint (reads KV only)
// Returns network fee configuration and Solstice fees wallet info.
// Safe to call on page load — no Solana RPC or heavy operations.
// ============================================================
app.get("/make-server-49d15288/network-fee-info", async (c) => {
  try {
    const feesWalletRaw = await kv.get("infra:network_wallet:SOLSTICE_FEES");
    const feesWallet = feesWalletRaw ? JSON.parse(feesWalletRaw as string) : null;

    return c.json({
      network_fee_sol: NETWORK_DEFAULTS.network_fee_sol,
      fee_model: "sol_gas_layer",
      fee_description: `${NETWORK_DEFAULTS.network_fee_sol} SOL per settlement — mandatory, enforced (settlement blocked on fee failure)`,
      fees_wallet: feesWallet ? {
        code: feesWallet.code,
        wallet_address: feesWallet.wallet_address,
        balance: feesWallet.balance || 0,
        purpose: feesWallet.purpose,
      } : null,
    });
  } catch (err) {
    console.log(`[network-fee-info] Error: ${(err as Error).message}`);
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ============================================================
// Auth — Signup (server-side with admin.createUser)
// ============================================================
app.post("/make-server-49d15288/auth/signup", async (c) => {
  try {
    const { email, password, name } = await c.req.json();

    if (!email || !password) {
      return c.json({ error: "Email and password are required" }, 400);
    }
    if (password.length < 6) {
      return c.json({ error: "Password must be at least 6 characters" }, 400);
    }

    const supabase = getAdminClient();
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      user_metadata: { name: name || email.split("@")[0] },
      // Automatically confirm the user's email since an email server hasn't been configured.
      email_confirm: true,
    });

    if (error) {
      console.log(`[auth/signup] Error creating user ${email}: ${error.message}`);
      return c.json({ error: error.message }, 400);
    }

    console.log(`[auth/signup] User created: ${data.user.id} (${email})`);
    return c.json({ user: { id: data.user.id, email: data.user.email } });
  } catch (err) {
    console.log(`[auth/signup] Unexpected error: ${(err as Error).message}`);
    return c.json({ error: `Signup error: ${(err as Error).message}` }, 500);
  }
});

// Auth — Get current user profile
app.get("/make-server-49d15288/auth/me", async (c) => {
  try {
    const accessToken = c.req.header("Authorization")?.split(" ")[1];
    if (!accessToken) {
      return c.json({ error: "No access token provided" }, 401);
    }

    const supabase = getAdminClient();
    const { data: { user }, error } = await supabase.auth.getUser(accessToken);
    if (error || !user) {
      return c.json({ error: "Invalid or expired token" }, 401);
    }

    return c.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.user_metadata?.name || user.email?.split("@")[0],
        created_at: user.created_at,
      },
    });
  } catch (err) {
    console.log(`[auth/me] Error: ${(err as Error).message}`);
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ============================================================
// BACKFILL-SWIFT — One-shot admin utility: populates swift_bic
// on existing bank rows using SWIFT_BIC_REGISTRY. Idempotent.
// ============================================================
app.post("/make-server-49d15288/backfill-swift", async (c) => {
  try {
    const supabase = getAdminClient();

    // 1. Read all banks
    const { data: banks, error: readErr } = await supabase
      .from("banks")
      .select("id, short_code, swift_bic, name, status");

    if (readErr) {
      console.log(`[backfill-swift] ✗ Error reading banks: ${readErr.message}`);
      return c.json({ error: readErr.message }, 500);
    }
    if (!banks || banks.length === 0) {
      return c.json({ message: "No banks found", updated: [] });
    }

    console.log(`[backfill-swift] Found ${banks.length} banks: ${banks.map((b: any) => `${b.short_code}(swift_bic=${b.swift_bic || "null"})`).join(", ")}`);

    // 2. Update banks that are missing swift_bic or have it set to their short_code
    const updated: { short_code: string; swift_bic: string; was: string | null }[] = [];

    for (const bank of banks) {
      const registryBic = SWIFT_BIC_REGISTRY[bank.short_code];
      if (!registryBic) {
        console.log(`[backfill-swift] ${bank.short_code} — no registry entry, skipping`);
        continue;
      }
      if (bank.swift_bic === registryBic) {
        console.log(`[backfill-swift] ${bank.short_code} — already set to ${registryBic}, skipping`);
        continue;
      }

      const { error: updateErr } = await supabase
        .from("banks")
        .update({ swift_bic: registryBic, updated_at: new Date().toISOString() })
        .eq("id", bank.id);

      if (updateErr) {
        console.log(`[backfill-swift] ✗ Error updating ${bank.short_code}: ${updateErr.message}`);
      } else {
        console.log(`[backfill-swift] ✓ ${bank.short_code}: ${bank.swift_bic || "null"} → ${registryBic}`);
        updated.push({ short_code: bank.short_code, swift_bic: registryBic, was: bank.swift_bic || null });
      }
    }

    // 3. Re-read to confirm
    const { data: confirmed } = await supabase
      .from("banks")
      .select("id, short_code, swift_bic, name, status")
      .order("created_at", { ascending: true });

    return c.json({
      message: `Backfill complete — ${updated.length} bank(s) updated`,
      updated,
      banks: confirmed?.map((b: any) => ({
        short_code: b.short_code,
        name: b.name,
        swift_bic: b.swift_bic,
        status: b.status,
      })),
    });
  } catch (err) {
    const errObj = err as Error;
    console.log(`[backfill-swift] ✗ Unexpected error: ${errObj.message}`);
    return c.json({ error: errObj.message }, 500);
  }
});

// ============================================================
// 1. SETUP-BANK — Two-stage bank onboarding (no legacy path)
//    stage: "wallet"   → pure DB, generates keypair, always succeeds
//    stage: "activate"  → network ops, checks SOL balance, deploys tokens
//    (no stage)         → defaults to "wallet" (safe, no Solana RPC calls)
// ============================================================
app.post("/make-server-49d15288/setup-bank", async (c) => {
  try {
    const body = await c.req.json();
    const { name, short_code, jurisdiction, initial_deposit_supply, agent_system_prompt, stage: rawStage, bank_id, swift_bic } = body;

    // Default to wallet-only when no stage specified.
    // The ONLY path that calls activateBank() is stage === "activate".
    const stage = rawStage || "wallet";

    // Resolve SWIFT/BIC: explicit field → registry → short_code
    const resolvedBic = swift_bic || SWIFT_BIC_REGISTRY[short_code?.toUpperCase()] || short_code?.toUpperCase();

    console.log(`[setup-bank] ▶ INCOMING REQUEST — stage=${stage} (raw=${rawStage || "none"}), short_code=${short_code}, name=${name}, jurisdiction=${jurisdiction}, bank_id=${bank_id || "none"}, initial_deposit_supply=${initial_deposit_supply}, swift_bic=${resolvedBic}`);

    if (!name || !short_code || !jurisdiction) {
      console.log(`[setup-bank] ✗ Missing required fields: name=${!!name}, short_code=${!!short_code}, jurisdiction=${!!jurisdiction}`);
      return c.json({ error: "Missing required fields: name, short_code, jurisdiction" }, 400);
    }

    const supabase = getAdminClient();
    const initialSupply = initial_deposit_supply || 10_000_000;
    const codeUpper = short_code.toUpperCase();

    // ── Idempotency check ───────��──────────────────────────
    console.log(`[setup-bank] Querying banks table for short_code=${codeUpper}...`);
    const { data: existing, error: existingError } = await supabase
      .from("banks")
      .select("*, wallets(*)")
      .eq("short_code", codeUpper)
      .maybeSingle();

    if (existingError) {
      console.log(`[setup-bank] ✗ Error querying existing bank: ${existingError.message} (code: ${existingError.code}, details: ${existingError.details}, hint: ${existingError.hint})`);
    }
    console.log(`[setup-bank] Existing bank lookup result: ${existing ? `FOUND (id=${existing.id}, status=${existing.status}, pubkey=${existing.solana_wallet_pubkey || "null"}, wallets=${existing.wallets?.length || 0})` : "NOT FOUND — will create new"}`);

    if (existing) {
      const defaultWallet = existing.wallets?.find((w: any) => w.is_default) || existing.wallets?.[0];
      const hasKeypair = !!existing.solana_wallet_keypair_encrypted;
      const hasTokenAccount = !!defaultWallet?.token_account_address;

      // Fully onboarded — return early for any stage
      if (existing.status === "active" && hasKeypair && hasTokenAccount) {
        console.log(`[setup-bank] ${codeUpper} already fully onboarded — skipping`);
        return c.json({
          bank: existing,
          wallet: defaultWallet,
          stage: "already_onboarded",
          step: "already_onboarded",
          public_key: existing.solana_wallet_pubkey,
          bank_id: existing.id,
        });
      }

      console.log(`[setup-bank] ${codeUpper} detected as retry_partial — keypair found: ${hasKeypair}, token_account: ${hasTokenAccount}, status: ${existing.status}, stage requested: ${stage || "legacy"}`);

      // ── Stage: WALLET (existing bank) ──────────────────
      if (stage === "wallet") {
        if (hasKeypair && existing.solana_wallet_pubkey) {
          // Keypair exists — reuse it
          console.log(`[setup-bank] ${codeUpper} wallet already exists: ${existing.solana_wallet_pubkey}`);
          return c.json({
            stage: "wallet_created",
            public_key: existing.solana_wallet_pubkey,
            bank_id: existing.id,
            reused: true,
          });
        }

        // No keypair — generate new one and update the row (safety net)
        const walletResult = generateWallet();
        console.log(`[setup-bank] ${codeUpper} had no keypair — generated new wallet: ${walletResult.walletPubkey}`);

        const now = new Date().toISOString();
        const { error: updateErr } = await supabase
          .from("banks")
          .update({
            solana_wallet_pubkey: walletResult.walletPubkey,
            solana_wallet_keypair_encrypted: walletResult.keypairEncrypted,
            status: "onboarding",
            updated_at: now,
          })
          .eq("id", existing.id);

        if (updateErr) {
          console.log(`[setup-bank] ✗ Error updating bank ${codeUpper} with new keypair: ${updateErr.message} (code: ${updateErr.code})`);
          return c.json({ error: `Failed to update bank keypair: ${updateErr.message}` }, 500);
        }
        console.log(`[setup-bank] ${codeUpper} bank row updated with new keypair, status=onboarding`);

        // Upsert wallet row
        if (defaultWallet) {
          const { error: wuErr } = await supabase.from("wallets").update({
            solana_pubkey: walletResult.walletPubkey,
          }).eq("id", defaultWallet.id);
          if (wuErr) console.log(`[setup-bank] ✗ wallet update error: ${wuErr.message}`);
          else console.log(`[setup-bank] ${codeUpper} wallet row updated`);
        } else {
          const { error: wiErr } = await supabase.from("wallets").insert({
            id: crypto.randomUUID(),
            bank_id: existing.id,
            label: `${codeUpper} Primary`,
            solana_pubkey: walletResult.walletPubkey,
            is_default: true,
            token_account_address: null,
            balance_lamports: 0,
            balance_tokens: 0,
            created_at: now,
          });
          if (wiErr) console.log(`[setup-bank] ✗ wallet insert error: ${wiErr.message}`);
          else console.log(`[setup-bank] ${codeUpper} wallet row inserted`);
        }

        return c.json({
          stage: "wallet_created",
          public_key: walletResult.walletPubkey,
          bank_id: existing.id,
          reused: false,
        });
      }

      // ── Stage: ACTIVATE (existing bank) ────────────────
      if (stage === "activate") {
        if (!existing.solana_wallet_keypair_encrypted) {
          return c.json({ error: `${codeUpper} has no keypair stored. Run wallet stage first.`, stage: "error" }, 400);
        }

        // Pre-check SOL balance before attempting activation
        const preBalance = await getSolBalance(existing.solana_wallet_pubkey!);
        console.log(`[setup-bank] ${codeUpper} pre-activation balance: ${(preBalance / 1e9).toFixed(4)} SOL`);

        if (preBalance < 50_000_000) { // 0.05 SOL
          console.log(`[setup-bank] ${codeUpper} insufficient SOL (${(preBalance / 1e9).toFixed(4)} < 0.05) — returning 400`);
          return c.json({
            error: "insufficient_sol",
            balance: preBalance / 1e9,
            wallet_address: existing.solana_wallet_pubkey,
            minimum_required: 0.05,
            stage: "awaiting_funding",
          }, 400);
        }

        console.log(`[setup-bank] ${codeUpper} activating — wallet: ${existing.solana_wallet_pubkey}, setting status=onboarding`);

        const { error: actStatusErr } = await supabase.from("banks").update({ status: "onboarding", updated_at: new Date().toISOString() }).eq("id", existing.id);
        if (actStatusErr) console.log(`[setup-bank] ✗ Error setting onboarding status: ${actStatusErr.message}`);

        let result;
        try {
          result = await activateBank(existing.solana_wallet_keypair_encrypted, codeUpper, initialSupply);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.log(`[setup-bank] ${codeUpper} activation error: ${errMsg}`);
          // Reset status back to onboarding so user can retry
          await supabase.from("banks").update({ status: "onboarding", updated_at: new Date().toISOString() }).eq("id", existing.id);
          return c.json({ error: `Activation failed: ${errMsg}`, stage: "error" }, 500);
        }

        // Activated successfully
        const now = new Date().toISOString();
        const supplyBaseUnits = initialSupply * Math.pow(10, TOKEN_DECIMALS);

        await supabase.from("banks").update({
          token_mint_address: result.tokenMintAddress,
          token_symbol: result.tokenSymbol,
          token_decimals: TOKEN_DECIMALS,
          status: "active",
          updated_at: now,
        }).eq("id", existing.id);

        // Update wallet with token account and balances
        if (defaultWallet) {
          await supabase.from("wallets").update({
            token_account_address: result.tokenAccountAddress,
            balance_lamports: result.solBalance,
            balance_tokens: supplyBaseUnits,
          }).eq("id", defaultWallet.id);
        }

        console.log(`[setup-bank] ${codeUpper} activated — mint: ${result.tokenMintAddress}`);

        // Re-fetch full bank
        const { data: updatedBank } = await supabase.from("banks").select("*, wallets(*)").eq("id", existing.id).single();

        return c.json({
          stage: "activated",
          bank: updatedBank,
          wallet: updatedBank?.wallets?.[0],
          bank_id: existing.id,
          public_key: existing.solana_wallet_pubkey,
          token_mint: result.tokenMintAddress,
          sol_balance: result.solBalance,
        });
      }

      // ── Unreachable: stage is always "wallet" or "activate" (defaulted above) ──
      // If somehow neither matched, return an error.
      console.log(`[setup-bank] ${codeUpper} exists — unexpected stage=${stage}`);
      return c.json({ error: `Unknown stage: ${stage}`, stage: "error" }, 400);
    }

    // ── No existing bank — create new ────────────────────────
    console.log(`[setup-bank] ${codeUpper} — NO EXISTING BANK. Creating new. stage=${stage}, supplied bank_id=${bank_id || "auto-generated"}`);
    const newBankId = bank_id || crypto.randomUUID();
    const nowCreate = new Date().toISOString();

    // ── Auto-generate agent system prompt if not provided ──
    // generateMaestroPrompt never throws — falls back to template on Gemini failure.
    let resolvedPrompt = agent_system_prompt || null;
    if (!resolvedPrompt) {
      console.log(`[setup-bank] ${codeUpper} — No agent_system_prompt provided, auto-generating...`);
      resolvedPrompt = await generateMaestroPrompt(name, codeUpper, jurisdiction);
      console.log(`[setup-bank] ${codeUpper} — Resolved prompt (${resolvedPrompt.length} chars)`);
    }

    // ── Stage: WALLET (new bank) ─────────────────────────────
    if (stage === "wallet") {
      const walletResult = generateWallet();
      console.log(`[setup-bank] Onboarding new bank: ${name} (${codeUpper}) — wallet: ${walletResult.walletPubkey}`);

      const bankRecord = {
        id: newBankId,
        name,
        short_code: codeUpper,
        swift_bic: resolvedBic,
        status: "onboarding",
        solana_wallet_pubkey: walletResult.walletPubkey,
        solana_wallet_keypair_encrypted: walletResult.keypairEncrypted,
        token_mint_address: null,
        token_symbol: null,
        token_decimals: TOKEN_DECIMALS,
        agent_system_prompt: resolvedPrompt,
        agent_model: "gemini-2.5-flash",
        jurisdiction: jurisdiction.toUpperCase(),
        // tier omitted — let DB default apply (banks_tier_check constraint)
        created_at: nowCreate,
        updated_at: nowCreate,
      };

      console.log(`[setup-bank] Inserting bank record: id=${newBankId}, status=${bankRecord.status}, short_code=${bankRecord.short_code}, jurisdiction=${bankRecord.jurisdiction}, prompt=${resolvedPrompt ? `${resolvedPrompt.length} chars` : "null"}`);
      const { error: bankError } = await supabase.from("banks").insert(bankRecord);
      if (bankError) {
        console.log(`[setup-bank] ✗ Error creating bank record: ${bankError.message} (code: ${bankError.code}, details: ${bankError.details}, hint: ${bankError.hint})`);
        return c.json({ error: `Failed to create bank: ${bankError.message}`, pg_code: bankError.code, pg_details: bankError.details }, 500);
      }
      console.log(`[setup-bank] ✓ Bank record inserted successfully: ${newBankId}`);

      const walletRecord = {
        id: crypto.randomUUID(),
        bank_id: newBankId,
        label: `${codeUpper} Primary`,
        solana_pubkey: walletResult.walletPubkey,
        is_default: true,
        token_account_address: null,
        balance_lamports: 0,
        balance_tokens: 0,
        created_at: nowCreate,
      };

      console.log(`[setup-bank] Inserting wallet record for bank ${newBankId}...`);
      const { error: walletError } = await supabase.from("wallets").insert(walletRecord);
      if (walletError) {
        console.log(`[setup-bank] ✗ Error creating wallet record: ${walletError.message} (code: ${walletError.code}, details: ${walletError.details}, hint: ${walletError.hint})`);
        return c.json({ error: `Failed to create wallet: ${walletError.message}`, pg_code: walletError.code, pg_details: walletError.details }, 500);
      }

      console.log(`[setup-bank] ✓ ${codeUpper} wallet stage complete — bank=${newBankId}, pubkey=${walletResult.walletPubkey}`);

      return c.json({
        stage: "wallet_created",
        public_key: walletResult.walletPubkey,
        bank_id: newBankId,
        reused: false,
      });
    }

    // ── Stage: ACTIVATE (new bank — should not happen without wallet stage first) ──
    if (stage === "activate") {
      return c.json({ error: `Bank ${codeUpper} does not exist. Run wallet stage first.`, stage: "error" }, 400);
    }

    // ── Unreachable: stage is always "wallet" or "activate" (defaulted above) ──
    console.log(`[setup-bank] ${codeUpper} new bank — unexpected stage=${stage}`);
    return c.json({ error: `Unknown stage: ${stage}`, stage: "error" }, 400);
  } catch (err) {
    const errObj = err as Error;
    console.log(`[setup-bank] ✗ UNEXPECTED ERROR: ${errObj.message}`);
    console.log(`[setup-bank] Stack: ${errObj.stack || "(no stack)"}`);
    return c.json({ error: `Setup bank error: ${errObj.message}`, stack: errObj.stack?.slice(0, 500) }, 500);
  }
});

// ============================================================
// 1b. SETUP-CUSTODIAN �� BNY custodian + Solstice fees wallet
//     Links BNY custodian to existing BNY bank wallet from banks table.
//     Generates new Solana Devnet keypair for Solstice fees wallet only.
//     Idempotent — returns existing data if already created.
// ============================================================
app.post("/make-server-49d15288/setup-custodian", async (c) => {
  try {
    console.log("[setup-custodian] ▶ Setting up BNY custodian + Solstice fees wallet");
    const supabase = getAdminClient();

    // Check if already set up
    const existingCustodianRaw = await kv.get("infra:custodian:BNY");
    const existingFees = await kv.get("infra:network_wallet:SOLSTICE_FEES");

    // If custodian exists but was created with a standalone keypair (no linked_bank_id),
    // treat it as stale and re-link to the actual BNY bank wallet.
    let existingCustodian = existingCustodianRaw;
    if (existingCustodianRaw) {
      const parsed = JSON.parse(existingCustodianRaw as string);
      if (!parsed.linked_bank_id) {
        console.log(`[setup-custodian] Stale custodian record (no linked_bank_id) — will re-link to BNY bank`);
        existingCustodian = null; // Force re-creation with bank link
      }
    }

    if (existingCustodian && existingFees) {
      const custodian = JSON.parse(existingCustodian as string);
      const feesWallet = JSON.parse(existingFees as string);

      // Fetch live SOL balances
      let custodianSol = 0;
      let feesSol = 0;
      try {
        custodianSol = await getSolBalance(custodian.wallet_address);
        feesSol = await getSolBalance(feesWallet.wallet_address);
      } catch (e) {
        console.log(`[setup-custodian] Balance check failed (non-blocking): ${(e as Error).message}`);
      }

      console.log(`[setup-custodian] Already exists — BNY: ${custodian.wallet_address}, Solstice: ${feesWallet.wallet_address}`);
      return c.json({
        status: "already_created",
        custodian: { ...custodian, keypair_encrypted: undefined, sol_balance: custodianSol / 1e9 },
        fees_wallet: { ...feesWallet, keypair_encrypted: undefined, sol_balance: feesSol / 1e9 },
      });
    }

    // ── BNY Custodian: link to existing BNY bank from banks table ──
    if (!existingCustodian) {
      const { data: bnyBank, error: bnyErr } = await supabase
        .from("banks")
        .select("id, name, short_code, solana_wallet_pubkey, solana_wallet_keypair_encrypted, status, created_at")
        .eq("short_code", "BNY")
        .maybeSingle();

      if (bnyErr) {
        console.log(`[setup-custodian] ✗ Error querying banks table for BNY: ${bnyErr.message}`);
        return c.json({ error: `Failed to find BNY bank: ${bnyErr.message}` }, 500);
      }

      if (!bnyBank || !bnyBank.solana_wallet_pubkey) {
        console.log(`[setup-custodian] ✗ BNY bank not found or has no wallet. Please create BNY bank first.`);
        return c.json({ error: "BNY bank not found in network. Please create 'The Bank of New York Mellon Corporation' (BNY) first via Bank Setup." }, 400);
      }

      const bnyRecord = {
        id: bnyBank.id,
        name: "BNY Mellon",
        code: "BNY",
        wallet_address: bnyBank.solana_wallet_pubkey,
        keypair_encrypted: bnyBank.solana_wallet_keypair_encrypted,
        role: "universal_custodian",
        linked_bank_id: bnyBank.id,
        created_at: bnyBank.created_at || new Date().toISOString(),
      };
      await kv.set("infra:custodian:BNY", JSON.stringify(bnyRecord));
      console.log(`[setup-custodian] ✓ BNY custodian linked to existing bank wallet: ${bnyBank.solana_wallet_pubkey}`);
    }

    // ── Solstice Network Fees: generate new wallet if not yet created ──
    if (!existingFees) {
      const solsticeWallet = generateWallet();
      const solsticeRecord = {
        id: crypto.randomUUID(),
        name: "Solstice Network Fees",
        code: "SOLSTICE_FEES",
        wallet_address: solsticeWallet.walletPubkey,
        keypair_encrypted: solsticeWallet.keypairEncrypted,
        purpose: "yield_collection",
        balance: 0,
        created_at: new Date().toISOString(),
      };
      await kv.set("infra:network_wallet:SOLSTICE_FEES", JSON.stringify(solsticeRecord));
      console.log(`[setup-custodian] ✓ Solstice fees wallet created (KV): ${solsticeWallet.walletPubkey}`);

      // Also persist to network_wallets Postgres table for Realtime subscriptions
      const { data: existingNwRow } = await supabase
        .from("network_wallets")
        .select("id")
        .eq("code", "SOLSTICE_FEES")
        .maybeSingle();

      if (!existingNwRow) {
        const { error: insertErr } = await supabase
          .from("network_wallets")
          .insert({
            id: solsticeRecord.id,
            name: solsticeRecord.name,
            code: solsticeRecord.code,
            wallet_address: solsticeRecord.wallet_address,
            keypair_encrypted: solsticeRecord.keypair_encrypted,
            purpose: solsticeRecord.purpose,
            balance: 0,
            created_at: solsticeRecord.created_at,
          });

        if (insertErr) {
          console.log(`[setup-custodian] ⚠ network_wallets INSERT failed (non-blocking): ${insertErr.message}`);
        } else {
          console.log(`[setup-custodian] ✓ Solstice fees wallet persisted to network_wallets table`);
        }
      } else {
        console.log(`[setup-custodian] network_wallets row for SOLSTICE_FEES already exists — skipping insert`);
      }
    }

    // Re-read both records to return consistent data
    const finalCustodian = JSON.parse((await kv.get("infra:custodian:BNY")) as string);
    const finalFees = JSON.parse((await kv.get("infra:network_wallet:SOLSTICE_FEES")) as string);

    // Fetch live SOL balances
    let custodianSol = 0;
    let feesSol = 0;
    try {
      custodianSol = await getSolBalance(finalCustodian.wallet_address);
      feesSol = await getSolBalance(finalFees.wallet_address);
    } catch (e) {
      console.log(`[setup-custodian] Balance check failed (non-blocking): ${(e as Error).message}`);
    }

    return c.json({
      status: "created",
      custodian: { ...finalCustodian, keypair_encrypted: undefined, sol_balance: custodianSol / 1e9 },
      fees_wallet: { ...finalFees, keypair_encrypted: undefined, sol_balance: feesSol / 1e9 },
    });
  } catch (err) {
    const errObj = err as Error;
    console.log(`[setup-custodian] ✗ Error: ${errObj.message}`);
    return c.json({ error: `Setup custodian error: ${errObj.message}` }, 500);
  }
});

// ============================================================
// 1c. CUSTODIAN-STATUS — Get current BNY + Solstice wallet status
// ============================================================
app.post("/make-server-49d15288/custodian-status", async (c) => {
  try {
    const supabase = getAdminClient();
    let rawCustodian = await kv.get("infra:custodian:BNY");

    // Auto-fix stale custodian records: if BNY record exists but has no linked_bank_id,
    // re-link it to the actual BNY bank entity from the banks table.
    if (rawCustodian) {
      const parsed = JSON.parse(rawCustodian as string);
      if (!parsed.linked_bank_id) {
        console.log(`[custodian-status] Stale BNY custodian record detected (no linked_bank_id) — auto-re-linking to BNY bank`);
        const { data: bnyBank, error: bnyErr } = await supabase
          .from("banks")
          .select("id, name, short_code, solana_wallet_pubkey, solana_wallet_keypair_encrypted, status, created_at")
          .eq("short_code", "BNY")
          .maybeSingle();

        if (!bnyErr && bnyBank && bnyBank.solana_wallet_pubkey) {
          const bnyRecord = {
            id: bnyBank.id,
            name: "BNY Mellon",
            code: "BNY",
            wallet_address: bnyBank.solana_wallet_pubkey,
            keypair_encrypted: bnyBank.solana_wallet_keypair_encrypted,
            role: "universal_custodian",
            linked_bank_id: bnyBank.id,
            created_at: bnyBank.created_at || new Date().toISOString(),
          };
          await kv.set("infra:custodian:BNY", JSON.stringify(bnyRecord));
          rawCustodian = JSON.stringify(bnyRecord);
          console.log(`[custodian-status] ✓ BNY custodian auto-re-linked to bank wallet: ${bnyBank.solana_wallet_pubkey}`);
        } else {
          console.log(`[custodian-status] Could not auto-re-link BNY: bank not found or query error`);
        }
      }
    }

    // ── Solstice fees wallet: read from network_wallets table (primary), KV fallback with auto-migration ──
    let feesWallet: Record<string, unknown> | null = null;
    const { data: nwRow, error: nwErr } = await supabase
      .from("network_wallets")
      .select("id, name, code, wallet_address, purpose, balance, created_at")
      .eq("code", "SOLSTICE_FEES")
      .maybeSingle();

    if (!nwErr && nwRow) {
      feesWallet = nwRow;
      console.log(`[custodian-status] Solstice fees wallet loaded from network_wallets table`);
    } else {
      // Auto-migration fallback: if KV has the record but network_wallets doesn't, migrate it
      const rawFees = await kv.get("infra:network_wallet:SOLSTICE_FEES");
      if (rawFees) {
        const kvFees = JSON.parse(rawFees as string);
        console.log(`[custodian-status] Solstice not in network_wallets — auto-migrating from KV`);
        const { error: migrateErr } = await supabase
          .from("network_wallets")
          .insert({
            id: kvFees.id,
            name: kvFees.name,
            code: kvFees.code,
            wallet_address: kvFees.wallet_address,
            keypair_encrypted: kvFees.keypair_encrypted,
            purpose: kvFees.purpose,
            balance: kvFees.balance ?? 0,
            created_at: kvFees.created_at,
          });

        if (migrateErr) {
          console.log(`[custodian-status] ⚠ Auto-migration INSERT failed: ${migrateErr.message} — falling back to KV data`);
        } else {
          console.log(`[custodian-status] ✓ Solstice auto-migrated to network_wallets table`);
        }
        // Return the KV data shape (without keypair_encrypted) regardless of migration success
        feesWallet = {
          id: kvFees.id,
          name: kvFees.name,
          code: kvFees.code,
          wallet_address: kvFees.wallet_address,
          purpose: kvFees.purpose,
          balance: kvFees.balance ?? 0,
          created_at: kvFees.created_at,
        };
      }
    }

    if (!rawCustodian && !feesWallet) {
      return c.json({ status: "not_created", custodian: null, fees_wallet: null });
    }

    const custodian = rawCustodian ? JSON.parse(rawCustodian as string) : null;

    // Fetch live SOL balances
    let custodianSol = 0;
    let feesSol = 0;
    try {
      if (custodian) custodianSol = await getSolBalance(custodian.wallet_address);
      if (feesWallet) feesSol = await getSolBalance(feesWallet.wallet_address as string);
    } catch (e) {
      console.log(`[custodian-status] Balance check failed (non-blocking): ${(e as Error).message}`);
    }

    return c.json({
      status: "exists",
      custodian: custodian ? { ...custodian, keypair_encrypted: undefined, sol_balance: custodianSol / 1e9 } : null,
      fees_wallet: feesWallet ? { ...feesWallet, keypair_encrypted: undefined, sol_balance: feesSol / 1e9 } : null,
    });
  } catch (err) {
    const errObj = err as Error;
    console.log(`[custodian-status] ✗ Error: ${errObj.message}`);
    return c.json({ error: `Custodian status error: ${errObj.message}` }, 500);
  }
});

// ============================================================
// 1a. CHECK-SOL-BALANCE — Query Solana Devnet for wallet SOL balance
// ============================================================
app.post("/make-server-49d15288/check-sol-balance", async (c) => {
  try {
    const body = await c.req.json();
    const { wallet_address } = body;

    if (!wallet_address) {
      return c.json({ error: "Missing required field: wallet_address" }, 400);
    }

    const balance = await getSolBalance(wallet_address);
    const balanceSol = balance / 1e9;
    const funded = balance >= 50_000_000; // 0.05 SOL

    console.log(`[check-sol-balance] ${wallet_address.slice(0, 12)}... = ${balanceSol.toFixed(4)} SOL (funded=${funded})`);

    return c.json({
      wallet_address,
      balance_lamports: balance,
      balance_sol: balanceSol,
      funded,
      minimum_required: 0.05,
    });
  } catch (err) {
    const errObj = err as Error;
    console.log(`[check-sol-balance] Error: ${errObj.message}`);
    return c.json({ error: `Balance check failed: ${errObj.message}` }, 500);
  }
});

// ============================================================
// 1b. GENERATE-AGENT-PROMPT — Auto-generate agent system prompt
//     Calls Gemini to create a contextually accurate prompt
//     based on the bank's real-world profile.
// ============================================================

// ── Shared helper: generates a Maestro agent system prompt via Gemini ──
// Used by both the standalone endpoint AND setup-bank auto-generation.
// Falls back to a deterministic template if Gemini is unavailable (429/503/timeout).
function templateFallbackPrompt(bankName: string): string {
  return `You are ${bankName}'s autonomous settlement agent on the CODA Solstice Network. As a member of the network, you handle wholesale bank-to-bank settlements with diligence and professionalism. You review all incoming settlement requests carefully, verifying purpose codes and counterparty standing. Your risk tolerance is moderate — you accept well-documented interbank transfers but flag anything unusual. Always confirm receipt and provide clear reasoning for your decisions.`;
}

async function generateMaestroPrompt(bankName: string, shortCode?: string, jurisdiction?: string): Promise<string> {
  try {
    const userPrompt = buildMaestroPersonalityUserPrompt(bankName, shortCode, jurisdiction);
    const result = await callGemini(MAESTRO_PERSONALITY_SYSTEM_PROMPT, userPrompt, {
      temperature: 0.5,
      maxTokens: 512,
    });
    return result.trim();
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.log(`[generateMaestroPrompt] Gemini failed for "${bankName}", using template fallback: ${errMsg}`);
    return templateFallbackPrompt(bankName);
  }
}

app.post("/make-server-49d15288/generate-agent-prompt", async (c) => {
  try {
    const body = await c.req.json();
    const { bank_name, jurisdiction, short_code } = body;

    if (!bank_name) {
      return c.json({ error: "Missing required field: bank_name" }, 400);
    }

    console.log(`[generate-agent-prompt] ▶ Generating prompt for "${bank_name}" (${short_code || "?"}, ${jurisdiction || "?"})`);

    const generatedPrompt = await generateMaestroPrompt(bank_name, short_code, jurisdiction);

    console.log(`[generate-agent-prompt] ✓ Generated prompt for "${bank_name}" (${generatedPrompt.length} chars)`);

    return c.json({ prompt: generatedPrompt });
  } catch (err) {
    const errObj = err as Error;
    console.log(`[generate-agent-prompt] ✗ Error: ${errObj.message}`);
    return c.json({ error: `Failed to generate prompt: ${errObj.message}` }, 500);
  }
});

// ============================================================
// 2. AGENT-THINK — LLM reasoning for bank agent
// ============================================================
app.post("/make-server-49d15288/agent-think", async (c) => {
  try {
    const body = await c.req.json();
    const { bank_id, input, transaction_id, context_type } = body;

    if (!bank_id || !input) {
      return c.json({ error: "Missing required fields: bank_id, input" }, 400);
    }

    const supabase = getAdminClient();
    const aid = agentId(bank_id);

    // Load bank
    const { data: bank, error: bankErr } = await supabase
      .from("banks")
      .select("*")
      .eq("id", bank_id)
      .single();

    if (bankErr || !bank) {
      return c.json({ error: `Bank not found: ${bankErr?.message}` }, 404);
    }

    // Load wallet
    const { data: wallet } = await supabase
      .from("wallets")
      .select("*")
      .eq("bank_id", bank_id)
      .eq("is_default", true)
      .maybeSingle();

    // Load other banks for context
    const { data: otherBanks } = await supabase
      .from("banks")
      .select("id, name, short_code, status, token_symbol, jurisdiction")
      .neq("id", bank_id)
      .eq("status", "active");

    // Load recent conversations for context
    const { data: recentConvos } = await supabase
      .from("agent_conversations")
      .select("role, content")
      .eq("bank_id", bank_id)
      .order("created_at", { ascending: false })
      .limit(10);

    const history = (recentConvos || []).reverse();

    // Build system prompt
    const systemPrompt = buildAgentSystemPrompt(bank, wallet, otherBanks || [], aid);

    // ── Network mode context (Devnet preamble for AI) ──
    const networkCtxThink = await getNetworkModeContext();

    // ── Treasury cycle context: append autonomous mode instructions ──
    let effectiveSystemPrompt = (networkCtxThink || "") + systemPrompt;
    if (context_type === 'treasury_cycle') {
      effectiveSystemPrompt += TREASURY_CYCLE_APPENDIX;
    }

    // Build user prompt with context
    let userPrompt = input;
    if (context_type === "incoming_message" && transaction_id) {
      const { data: tx } = await supabase
        .from("transactions")
        .select("*, sender_bank:banks!transactions_sender_bank_id_fkey(name, short_code), receiver_bank:banks!transactions_receiver_bank_id_fkey(name, short_code)")
        .eq("id", transaction_id)
        .single();

      if (tx) {
        userPrompt = `INCOMING MESSAGE regarding transaction ${transaction_id}:\n${input}\n\nTransaction details: ${JSON.stringify({
          sender: (tx as any).sender_bank?.short_code,
          receiver: (tx as any).receiver_bank?.short_code,
          amount: tx.amount / 1e6,
          status: tx.status,
          memo: tx.memo,
          purpose_code: tx.purpose_code,
          risk_level: tx.risk_level,
          risk_score: tx.risk_score,
          compliance_passed: tx.compliance_passed,
        })}`;
      }
    }

    // Call Gemini — response format imported from prompts/shared-context.ts
    const responseFormat = AGENT_THINK_RESPONSE_FORMAT;

    const fullPrompt = `${userPrompt}\n\n${responseFormat}`;

    const geminiResponse = await callGeminiJSON<{
      reasoning: string;
      action: string;
      params: Record<string, unknown>;
      message_to_counterparty: string | null;
      message_to_user: string;
    }>(effectiveSystemPrompt, fullPrompt, { temperature: 0.2 });

    console.log(`[${aid}] Gemini response: action=${geminiResponse.action}, context=${context_type}`);
    if (context_type === 'risk_result' || context_type === 'incoming_message') {
      console.log(`[${aid}] │  reasoning: ${geminiResponse.reasoning?.slice(0, 200)}`);
      console.log(`[${aid}] │  message_to_user: ${geminiResponse.message_to_user?.slice(0, 150)}`);
      console.log(`[${aid}] │  message_to_counterparty: ${geminiResponse.message_to_counterparty?.slice(0, 150)}`);
      console.log(`[${aid}] │  params: ${JSON.stringify(geminiResponse.params)}`);
    }

    // ── Amount sanity check: parse exact dollar amount from user input ──
    // Gemini sometimes inflates small amounts (e.g. "$100.00" → 10000).
    // We extract the amount from the user's original text and ALWAYS override.
    if (geminiResponse.action === 'initiate_payment' && context_type === 'user_instruction') {
      const correctedAmount = parseExactDollarAmount(input);
      // Robustly parse Gemini's amount — handle strings like "$10,000", "10,000", etc.
      const rawGemini = geminiResponse.params?.amount;
      const geminiAmount = parseNumericAmount(rawGemini);
      console.log(`[${aid}] Amount check: geminiRaw=${JSON.stringify(rawGemini)}, geminiParsed=${geminiAmount}, userInputParsed=${correctedAmount}, input="${input}"`);
      if (correctedAmount !== null) {
        // ALWAYS use the parsed amount from user input — it is the ground truth
        if (geminiAmount !== correctedAmount) {
          console.log(`[${aid}] AMOUNT CORRECTED: Gemini=${geminiAmount} -> parsed=${correctedAmount}`);
        } else {
          console.log(`[${aid}] Amount matches: ${correctedAmount}`);
        }
        geminiResponse.params.amount = correctedAmount;
      } else if (geminiAmount > 0) {
        console.log(`[${aid}] Could not parse amount from user input — using Gemini's: ${geminiAmount}`);
        geminiResponse.params.amount = geminiAmount;
      }

      // ── Lockup duration override: parse explicit lockup from user input ──
      // Similar to amount correction — user input is ground truth.
      // If user says "with a 10 minute lockup", force lockup regardless of risk score.
      const parsedLockup = parseLockupMinutes(input);
      const geminiLockup = geminiResponse.params?.lockup_minutes != null
        ? parseInt(String(geminiResponse.params.lockup_minutes), 10)
        : null;
      const effectiveUserLockup = parsedLockup ?? geminiLockup;
      if (effectiveUserLockup != null && effectiveUserLockup > 0) {
        geminiResponse.params.lockup_minutes = effectiveUserLockup;
        console.log(`[${aid}] LOCKUP OVERRIDE: user requested ${effectiveUserLockup} min lockup (parsed=${parsedLockup}, gemini=${geminiLockup})`);
      } else {
        // Ensure we don't pass through a spurious Gemini lockup_minutes
        delete geminiResponse.params.lockup_minutes;
      }
    }

    // Save conversation entries
    const now = new Date().toISOString();

    // Save user input
    await supabase.from("agent_conversations").insert({
      id: crypto.randomUUID(),
      bank_id,
      transaction_id: transaction_id || null,
      role: "user",
      content: input,
      created_at: now,
    });

    // Save agent response
    await supabase.from("agent_conversations").insert({
      id: crypto.randomUUID(),
      bank_id,
      transaction_id: transaction_id || null,
      role: "model",
      content: geminiResponse.message_to_user || geminiResponse.reasoning,
      created_at: new Date(Date.now() + 100).toISOString(),
    });

    // Execute action
    let resultTxId = transaction_id || null;

    // ── Treasury cycle: handle NO_ACTION early return ──
    if (context_type === 'treasury_cycle' &&
        (geminiResponse.action === 'no_action' || geminiResponse.action === 'NO_ACTION')) {
      await supabase.from("agent_messages").insert({
        id: crypto.randomUUID(),
        transaction_id: null,
        from_bank_id: bank_id,
        to_bank_id: bank_id,
        message_type: "status_update",
        content: {
          agent_id: aid,
          action: "NO_ACTION",
          context: "treasury_cycle",
          reasoning: geminiResponse.reasoning,
        },
        natural_language: `Maestro — Treasury cycle evaluation: no action taken. ${geminiResponse.reasoning?.slice(0, 200) || ''}`,
        processed: true,
        created_at: new Date().toISOString(),
      });
      console.log(`[${aid}] Treasury cycle: NO_ACTION — ${geminiResponse.reasoning?.slice(0, 100)}`);
      return c.json({
        reasoning: geminiResponse.reasoning,
        action: 'NO_ACTION',
        params: geminiResponse.params,
        message_to_counterparty: null,
        message_to_user: geminiResponse.message_to_user || geminiResponse.reasoning,
        transaction_id: null,
      });
    }

    if (geminiResponse.action === "initiate_payment") {
      resultTxId = await handleInitiatePayment(
        supabase,
        bank,
        wallet,
        otherBanks || [],
        geminiResponse.params,
        geminiResponse.message_to_counterparty
      );
    } else if (geminiResponse.action === "accept_payment" && transaction_id) {
      await handleAcceptPayment(supabase, bank, transaction_id, geminiResponse.message_to_counterparty);
    } else if (geminiResponse.action === "reject_payment" && transaction_id) {
      await handleRejectPayment(
        supabase,
        bank,
        transaction_id,
        geminiResponse.params.rejection_reason as string || "Rejected by agent",
        geminiResponse.message_to_counterparty
      );
    }

    return c.json({
      reasoning: geminiResponse.reasoning,
      action: geminiResponse.action,
      params: geminiResponse.params,
      message_to_counterparty: geminiResponse.message_to_counterparty,
      message_to_user: geminiResponse.message_to_user,
      transaction_id: resultTxId,
    });
  } catch (err) {
    console.log(`[agent-think] Error: ${(err as Error).message}`);
    return c.json({ error: `Agent think error: ${(err as Error).message}` }, 500);
  }
});

// ============================================================
// 2b. AGENT-CHAT — Conversational AI endpoint (non-payment queries)
// ============================================================
app.post("/make-server-49d15288/agent-chat", async (c) => {
  try {
    const body = await c.req.json();
    const { bank_id, message } = body;

    if (!bank_id || !message) {
      return c.json({ error: "Missing required fields: bank_id, message" }, 400);
    }

    const supabase = getAdminClient();
    const aid = agentId(bank_id);

    // Load bank
    const { data: bank, error: bankErr } = await supabase
      .from("banks")
      .select("*")
      .eq("id", bank_id)
      .single();

    if (bankErr || !bank) {
      return c.json({ error: `Bank not found: ${bankErr?.message}` }, 404);
    }

    // Load wallet
    const { data: wallet } = await supabase
      .from("wallets")
      .select("*")
      .eq("bank_id", bank_id)
      .eq("is_default", true)
      .maybeSingle();

    // Load other banks
    const { data: otherBanks } = await supabase
      .from("banks")
      .select("id, name, short_code, status, token_symbol, jurisdiction")
      .neq("id", bank_id);

    // Load recent transactions (last 20)
    const { data: recentTxs } = await supabase
      .from("transactions")
      .select("id, sender_bank_id, receiver_bank_id, amount_display, status, purpose_code, memo, risk_level, risk_score, solana_tx_signature, created_at, settled_at, sender_bank:banks!transactions_sender_bank_id_fkey(short_code, name), receiver_bank:banks!transactions_receiver_bank_id_fkey(short_code, name)")
      .or(`sender_bank_id.eq.${bank_id},receiver_bank_id.eq.${bank_id}`)
      .order("created_at", { ascending: false })
      .limit(20);

    // Load recent conversation history
    const { data: recentConvos } = await supabase
      .from("agent_conversations")
      .select("role, content")
      .eq("bank_id", bank_id)
      .order("created_at", { ascending: false })
      .limit(10);

    const history = (recentConvos || []).reverse();

    // Build transaction summary for context
    const txSummary = (recentTxs || []).map((tx: any) => {
      const dir = tx.sender_bank_id === bank_id ? "SENT" : "RECEIVED";
      const counterparty = dir === "SENT"
        ? `${tx.receiver_bank?.short_code || "?"} (${tx.receiver_bank?.name || "?"})`
        : `${tx.sender_bank?.short_code || "?"} (${tx.sender_bank?.name || "?"})`;
      return `  - ${dir} $${(tx.amount_display || 0).toLocaleString()} ${dir === "SENT" ? "to" : "from"} ${counterparty} | Status: ${tx.status} | Purpose: ${tx.purpose_code || "N/A"} | ${tx.created_at?.slice(0, 19)}${tx.solana_tx_signature ? ` | Solana TX: ${tx.solana_tx_signature.slice(0, 16)}...` : ""}`;
    }).join("\n");

    // Calculate stats
    const totalTxCount = recentTxs?.length || 0;
    const settledTxs = recentTxs?.filter((tx: any) => tx.status === "settled") || [];
    const settledVolumeSent = settledTxs
      .filter((tx: any) => tx.sender_bank_id === bank_id)
      .reduce((s: number, tx: any) => s + (tx.amount_display || 0), 0);
    const settledVolumeReceived = settledTxs
      .filter((tx: any) => tx.receiver_bank_id === bank_id)
      .reduce((s: number, tx: any) => s + (tx.amount_display || 0), 0);
    const successRate = totalTxCount > 0
      ? Math.round((settledTxs.length / totalTxCount) * 100)
      : 100;

    const networkBankList = (otherBanks || [])
      .map((b: any) => `  - ${b.name} (${b.short_code}) — ${b.jurisdiction}, Status: ${b.status}, Token: ${b.token_symbol || "N/A"}`)
      .join("\n");

    // Build conversational system prompt (extracted to prompts/maestro-prompts.ts)
    const networkCtxChat = await getNetworkModeContext();
    const chatPromptParams: AgentChatPromptParams = {
      networkModeContext: networkCtxChat,
      bankName: bank.name,
      bankCode: bank.short_code,
      bankJurisdiction: bank.jurisdiction,
      bankStatus: bank.status,
      bankTokenSymbol: bank.token_symbol,
      bankWalletPubkey: bank.solana_wallet_pubkey,
      walletBalanceTokens: wallet ? wallet.balance_tokens : null,
      networkBankList,
      txSummary,
      totalTxCount,
      settledCount: settledTxs.length,
      settledVolumeSent,
      settledVolumeReceived,
      successRate,
      conversationHistory: history.map((c: any) => `${c.role}: ${c.content}`).join("\n") || "(new conversation)",
    };
    const systemPrompt = buildAgentChatPrompt(chatPromptParams);

    console.log(`[${aid}] agent-chat: "${message.slice(0, 100)}"`);

    const response = await callGemini(systemPrompt, message, {
      temperature: 0.4,
      maxTokens: 1024,
    });

    console.log(`[${aid}] agent-chat response: "${response.slice(0, 200)}"`);

    // Save conversation
    const now = new Date().toISOString();
    await supabase.from("agent_conversations").insert({
      id: crypto.randomUUID(),
      bank_id,
      transaction_id: null,
      role: "user",
      content: message,
      created_at: now,
    });
    await supabase.from("agent_conversations").insert({
      id: crypto.randomUUID(),
      bank_id,
      transaction_id: null,
      role: "model",
      content: response,
      created_at: new Date(Date.now() + 100).toISOString(),
    });

    return c.json({
      response,
      context: {
        balance: wallet ? wallet.balance_tokens / 1e6 : null,
        tx_count: totalTxCount,
        settled_count: settledTxs.length,
        success_rate: successRate,
        sent_volume: settledVolumeSent,
        received_volume: settledVolumeReceived,
      },
    });
  } catch (err) {
    console.log(`[agent-chat] Error: ${(err as Error).message}`);
    return c.json({ error: `Agent chat error: ${(err as Error).message}` }, 500);
  }
});

// ============================================================
// 3a. Core compliance-check logic (reusable from route + proving-ground)
// ============================================================
async function coreComplianceCheck(transactionId: string): Promise<any> {
  const supabase = getAdminClient();

  const { data: tx, error: txErr } = await supabase
    .from("transactions")
    .select("*, sender_bank:banks!transactions_sender_bank_id_fkey(*), receiver_bank:banks!transactions_receiver_bank_id_fkey(*)")
    .eq("id", transactionId)
    .single();

  if (txErr || !tx) {
    throw new Error(`Transaction not found: ${txErr?.message}`);
  }

  const aid = agentId(tx.receiver_bank_id);
  console.log(`[${aid}] ┌─ COMPLIANCE CHECK (core) for tx ${transactionId.slice(0, 8)}`);
  console.log(`[${aid}] │  TX data: status=${tx.status}, amount_display=${tx.amount_display}, amount_raw=${tx.amount}, purpose_code=${JSON.stringify(tx.purpose_code)}, memo=${JSON.stringify(tx.memo)}`);
  console.log(`[${aid}] │  Sender: ${(tx as any).sender_bank?.short_code || 'NULL'} (${(tx as any).sender_bank?.name || 'NULL'}), jurisdiction=${(tx as any).sender_bank?.jurisdiction || 'NULL'}`);
  console.log(`[${aid}] │  Receiver: ${(tx as any).receiver_bank?.short_code || 'NULL'} (${(tx as any).receiver_bank?.name || 'NULL'}), jurisdiction=${(tx as any).receiver_bank?.jurisdiction || 'NULL'}`);

  const bankConfig = await getBankConfig(tx.receiver_bank_id);
  const purposeCodeRaw = tx.purpose_code;
  const purposeCodeTruthy = !!purposeCodeRaw;
  console.log(`[${aid}] │  purpose_code raw value: ${JSON.stringify(purposeCodeRaw)}, truthy: ${purposeCodeTruthy}, typeof: ${typeof purposeCodeRaw}`);

  const senderJur = (tx as any).sender_bank?.jurisdiction || '';
  const receiverJur = (tx as any).receiver_bank?.jurisdiction || '';
  const jurAllowed = bankConfig.jurisdiction_whitelist.includes(senderJur) && bankConfig.jurisdiction_whitelist.includes(receiverJur);
  const purposeAllowed = purposeCodeRaw ? bankConfig.approved_purpose_codes.some((pc: string) => purposeCodeRaw.toUpperCase().includes(pc) || pc.includes(purposeCodeRaw.toUpperCase())) : false;

  // Task 127: Query simulated OFAC watchlist
  const senderBicComp = resolveBic((tx as any).sender_bank || { short_code: '' });
  const receiverBicComp = resolveBic((tx as any).receiver_bank || { short_code: '' });
  const watchlistResult = await checkWatchlist(supabase, senderBicComp, receiverBicComp);
  const sanctionsPassed = !watchlistResult.hit;
  const sanctionsDetail = sanctionsPassed
    ? `Neither ${(tx as any).sender_bank?.short_code} (${senderBicComp}) nor ${(tx as any).receiver_bank?.short_code} (${receiverBicComp}) appear on OFAC, EU, or UN sanctions lists`
    : `WATCHLIST HIT: ${watchlistResult.matches.map((m: any) => `${m.entity_name} (${m.bic_code}) on ${m.list_type} — ${m.reason}`).join('; ')}`;

  const checks = [
    {
      type: "sanctions_screening",
      passed: sanctionsPassed,
      detail: sanctionsDetail,
    },
    {
      type: "aml_threshold",
      passed: tx.amount_display < 50_000_000,
      detail: tx.amount_display >= 50_000_000
        ? `Amount $${(tx.amount_display).toLocaleString()} exceeds $50M AML threshold — enhanced due diligence required`
        : `Amount $${(tx.amount_display).toLocaleString()} within normal wholesale settlement range`,
    },
    {
      type: "counterparty_verification",
      passed: true,
      detail: `${(tx as any).receiver_bank?.name} is a verified CODA network participant with active status`,
    },
    {
      type: "jurisdiction_check",
      passed: jurAllowed,
      detail: jurAllowed
        ? `${senderJur} to ${receiverJur} corridor is approved`
        : `${senderJur} to ${receiverJur} not in whitelist [${bankConfig.jurisdiction_whitelist.join(', ')}]`,
    },
    {
      type: "purpose_code_validation",
      passed: purposeCodeTruthy && purposeAllowed,
      detail: !purposeCodeRaw
        ? "Missing purpose code — recommended for audit trail"
        : purposeAllowed
        ? `Purpose code '${purposeCodeRaw}' is valid for wholesale settlement`
        : `Purpose code '${purposeCodeRaw}' not in approved codes`,
    },
  ];

  for (const check of checks) {
    console.log(`[${aid}] │  ${check.passed ? '✓' : '✗'} ${check.type}: ${check.detail}`);
  }

  const allPassed = checks.every((ch) => ch.passed);

  const now = new Date().toISOString();
  for (const check of checks) {
    const { error: logErr } = await supabase.from("compliance_logs").insert({
      id: crypto.randomUUID(),
      transaction_id: transactionId,
      bank_id: tx.receiver_bank_id,
      check_type: check.type,
      check_result: check.passed,
      details: { detail: check.detail, agent_id: aid },
      solana_log_signature: null,
      created_at: now,
    });
    if (logErr) console.log(`[${aid}] │  WARNING: compliance_log insert error for ${check.type}: ${logErr.message}`);
  }

  const { error: txUpdateErr } = await supabase
    .from("transactions")
    .update({
      status: "compliance_check",
      compliance_passed: allPassed,
      compliance_checks: checks,
      compliance_completed_at: now,
    })
    .eq("id", transactionId);

  if (txUpdateErr) console.log(`[${aid}] │  WARNING: tx status update error: ${txUpdateErr.message}`);
  console.log(`[${aid}] └─ COMPLIANCE RESULT: ${allPassed ? "PASSED ✓" : "FAILED ✗"} (${checks.filter(c => c.passed).length}/${checks.length} checks)`);

  // Concord narrative
  let concordNarrative = '';
  try {
    const networkModeCtx = await getNetworkModeContext();
    const concordPrompt = buildConcordNarrativePrompt({
      networkModeContext: networkModeCtx,
      amountDisplay: tx.amount_display || 0,
      senderName: (tx as any).sender_bank?.name || '?',
      senderCode: (tx as any).sender_bank?.short_code || '?',
      senderJurisdiction: (tx as any).sender_bank?.jurisdiction || '?',
      receiverName: (tx as any).receiver_bank?.name || '?',
      receiverCode: (tx as any).receiver_bank?.short_code || '?',
      receiverJurisdiction: (tx as any).receiver_bank?.jurisdiction || '?',
      purposeCode: tx.purpose_code,
      checks,
      allPassed,
    });
    const narrativeResp = await callGemini(CONCORD_SYSTEM_PROMPT, concordPrompt, { maxTokens: 300 });
    concordNarrative = narrativeResp.trim();
  } catch (err2) {
    console.error(`[compliance-check] Concord narrative generation failed:`, err2);
    concordNarrative = concordNarrativeFallback(allPassed, checks.length, checks.filter((c: any) => !c.passed).length);
  }

  return {
    transaction_id: transactionId,
    compliance_passed: allPassed,
    checks,
    concord_narrative: concordNarrative,
  };
}

// ============================================================
// 3b. COMPLIANCE-CHECK route (delegates to coreComplianceCheck)
// ============================================================
app.post("/make-server-49d15288/compliance-check", async (c) => {
  try {
    const body = await c.req.json();
    const { transaction_id } = body;

    if (!transaction_id) {
      return c.json({ error: "Missing required field: transaction_id" }, 400);
    }

    const result = await coreComplianceCheck(transaction_id);
    return c.json(result);
  } catch (err) {
    console.log(`[compliance-check] Error: ${(err as Error).message}`);
    return c.json({ error: `Compliance check error: ${(err as Error).message}` }, 500);
  }
});

// ============================================================
// 4a. Core risk-score logic (reusable from route + proving-ground)
// ============================================================
async function coreRiskScore(transactionId: string): Promise<any> {
  const supabase = getAdminClient();

  const { data: tx, error: txErr } = await supabase
    .from("transactions")
    .select("*, sender_bank:banks!transactions_sender_bank_id_fkey(*), receiver_bank:banks!transactions_receiver_bank_id_fkey(*)")
    .eq("id", transactionId)
    .single();

  if (txErr || !tx) {
    throw new Error(`Transaction not found: ${txErr?.message}`);
  }

  const aid = agentId(tx.receiver_bank_id);
  console.log(`[${aid}] ┌─ RISK ASSESSMENT (core) for tx ${transactionId.slice(0, 8)}`);
  console.log(`[${aid}] │  TX: $${tx.amount_display?.toLocaleString()}, purpose=${tx.purpose_code}, compliance_passed=${tx.compliance_passed}, status=${tx.status}`);

  const senderBankId = tx.sender_bank_id;
  const receiverBankId = tx.receiver_bank_id;

  const { data: corridorHistory } = await supabase
    .from('transactions')
    .select('id, amount_display, purpose_code, risk_level, risk_score, status, created_at, sender_bank_id, receiver_bank_id')
    .or(`and(sender_bank_id.eq.${senderBankId},receiver_bank_id.eq.${receiverBankId}),and(sender_bank_id.eq.${receiverBankId},receiver_bank_id.eq.${senderBankId})`)
    .neq('id', transactionId)
    .order('created_at', { ascending: false })
    .limit(10);

  const { data: senderRecentTxns } = await supabase
    .from('transactions')
    .select('id, amount_display, receiver_bank_id, purpose_code, status, created_at')
    .eq('sender_bank_id', senderBankId)
    .neq('id', transactionId)
    .order('created_at', { ascending: false })
    .limit(10);

  const sBankCode = (tx as any).sender_bank?.short_code || '?';
  const rBankCode = (tx as any).receiver_bank?.short_code || '?';

  const corridorCtx = corridorHistory && corridorHistory.length > 0
    ? corridorHistory.map((t: any) => {
        const direction = t.sender_bank_id === senderBankId ? '→' : '←';
        const age = Math.round((Date.now() - new Date(t.created_at).getTime()) / (1000 * 60));
        return `  ${direction} $${Number(t.amount_display).toLocaleString()} | ${t.purpose_code} | risk:${t.risk_level}(${t.risk_score}) | ${t.status} | ${age}min ago`;
      }).join('\n')
    : '  No prior transactions between these counterparties.';

  const senderVelCtx = senderRecentTxns && senderRecentTxns.length > 0
    ? senderRecentTxns.map((t: any) => {
        const age = Math.round((Date.now() - new Date(t.created_at).getTime()) / (1000 * 60));
        return `  $${Number(t.amount_display).toLocaleString()} → ${t.receiver_bank_id?.slice(0, 8)} | ${t.purpose_code} | ${t.status} | ${age}min ago`;
      }).join('\n')
    : '  No recent sender activity.';

  const senderTxns60Min = (senderRecentTxns || []).filter((t: any) => {
    const age = Date.now() - new Date(t.created_at).getTime();
    return age < 60 * 60 * 1000;
  });
  const senderVol60Min = senderTxns60Min.reduce((sum: number, t: any) => sum + Number(t.amount_display), 0);

  const riskConfig = await getBankConfig(tx.receiver_bank_id);
  const networkCtx = await getNetworkModeContext();
  const riskPrompt = buildRiskScoringPrompt({
    networkModeContext: networkCtx,
    senderName: (tx as any).sender_bank?.name,
    senderCode: sBankCode,
    senderTier: (tx as any).sender_bank?.tier,
    senderJurisdiction: (tx as any).sender_bank?.jurisdiction,
    receiverName: (tx as any).receiver_bank?.name,
    receiverCode: rBankCode,
    receiverTier: (tx as any).receiver_bank?.tier,
    receiverJurisdiction: (tx as any).receiver_bank?.jurisdiction,
    amountDisplay: tx.amount_display,
    purposeCode: tx.purpose_code,
    memo: tx.memo,
    settlementType: tx.settlement_type,
    compliancePassed: tx.compliance_passed,
    corridorContext: corridorCtx,
    senderVelocityContext: senderVelCtx,
    senderTxnsLast60MinCount: senderTxns60Min.length,
    senderVolumeLast60Min: senderVol60Min,
    corridorLength: corridorHistory?.length || 0,
    riskWeightCounterparty: riskConfig.risk_weight_counterparty,
    riskWeightJurisdiction: riskConfig.risk_weight_jurisdiction,
    riskWeightAssetType: riskConfig.risk_weight_asset_type,
    riskWeightBehavioral: riskConfig.risk_weight_behavioral,
  });

  const riskResult = await callGeminiJSON<{
    counterparty_score: number;
    jurisdiction_score: number;
    asset_type_score: number;
    behavioral_score: number;
    composite_score: number;
    risk_level: string;
    finality_recommendation: string;
    reasoning: string;
  }>(FERMATA_SYSTEM_PROMPT, riskPrompt, {
    temperature: 0.3,
  });

  console.log(`[${aid}] │  Gemini risk response: composite=${riskResult.composite_score}, level=${riskResult.risk_level}, finality=${riskResult.finality_recommendation}`);
  console.log(`[${aid}] │  Sub-scores: counterparty=${riskResult.counterparty_score}, jurisdiction=${riskResult.jurisdiction_score}, asset=${riskResult.asset_type_score}, behavioral=${riskResult.behavioral_score}`);
  console.log(`[${aid}] │  Reasoning: ${riskResult.reasoning?.slice(0, 200)}`);

  const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

  const composite = clamp(Math.round(
    riskResult.counterparty_score * riskConfig.risk_weight_counterparty +
    riskResult.jurisdiction_score * riskConfig.risk_weight_jurisdiction +
    riskResult.asset_type_score * riskConfig.risk_weight_asset_type +
    riskResult.behavioral_score * riskConfig.risk_weight_behavioral
  ));

  let finality: string;
  if (composite <= riskConfig.risk_instant_ceiling) finality = "immediate";
  else if (composite <= riskConfig.risk_deferred_24h_ceiling) finality = "deferred_24h";
  else if (composite <= riskConfig.risk_deferred_72h_ceiling) finality = "deferred_72h";
  else finality = "manual_review";
  const riskLevel = composite <= riskConfig.risk_instant_ceiling ? "low" : composite <= riskConfig.risk_deferred_72h_ceiling ? "medium" : "high";

  const riskScore = {
    id: crypto.randomUUID(),
    transaction_id: transactionId,
    counterparty_score: clamp(riskResult.counterparty_score),
    jurisdiction_score: clamp(riskResult.jurisdiction_score),
    asset_type_score: clamp(riskResult.asset_type_score),
    behavioral_score: clamp(riskResult.behavioral_score),
    composite_score: composite,
    risk_level: riskLevel,
    finality_recommendation: finality,
    reasoning: riskResult.reasoning || "",
    created_at: new Date().toISOString(),
  };

  console.log(`[${aid}] │  Config-adjusted: composite=${composite} (gemini raw: ${riskResult.composite_score}), finality=${finality} (gemini: ${riskResult.finality_recommendation})`);

  const { error: rsErr } = await supabase.from("risk_scores").insert(riskScore);
  if (rsErr) {
    console.log(`[${aid}] │  ERROR saving risk score: ${rsErr.message}`);
  }

  let lockupUntil: string | null = null;
  if (finality === "deferred_24h") {
    lockupUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  } else if (finality === "deferred_72h") {
    lockupUntil = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
  } else if (finality === "manual_review") {
    lockupUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  }

  await supabase
    .from("transactions")
    .update({
      status: "risk_scored",
      risk_level: riskScore.risk_level,
      risk_score: riskScore.composite_score,
      risk_reasoning: riskScore.reasoning,
      risk_scored_at: new Date().toISOString(),
      lockup_until: lockupUntil,
    })
    .eq("id", transactionId);

  console.log(`[${aid}] └─ RISK RESULT: ${(riskScore.risk_level as string).toUpperCase()} (${riskScore.composite_score}/100) — finality: ${riskResult.finality_recommendation}`);

  return {
    transaction_id: transactionId,
    risk_score: riskScore,
  };
}

// ============================================================
// 4b. RISK-SCORE route (delegates to coreRiskScore)
// ============================================================
app.post("/make-server-49d15288/risk-score", async (c) => {
  try {
    const body = await c.req.json();
    const { transaction_id } = body;

    if (!transaction_id) {
      return c.json({ error: "Missing required field: transaction_id" }, 400);
    }

    const result = await coreRiskScore(transaction_id);
    return c.json(result);
  } catch (err) {
    console.log(`[risk-score] Error: ${(err as Error).message}`);
    return c.json({ error: `Risk score error: ${(err as Error).message}` }, 500);
  }
});

// ============================================================
// 5. AGENT-EXECUTE — Execute real on-chain settlement
// ============================================================
app.post("/make-server-49d15288/agent-execute", async (c) => {
  try {
    const body = await c.req.json();
    const { transaction_id } = body;

    if (!transaction_id) {
      return c.json({ error: "Missing required field: transaction_id" }, 400);
    }

    const supabase = getAdminClient();

    const { data: tx, error: txErr } = await supabase
      .from("transactions")
      .select("*, sender_bank:banks!transactions_sender_bank_id_fkey(*), receiver_bank:banks!transactions_receiver_bank_id_fkey(*)")
      .eq("id", transaction_id)
      .single();

    if (txErr || !tx) {
      return c.json({ error: `Transaction not found: ${txErr?.message}` }, 404);
    }

    const senderBank = (tx as any).sender_bank;
    const receiverBank = (tx as any).receiver_bank;
    const aid = agentId(tx.receiver_bank_id);

    // Status guard
    if (["settled", "rejected", "reversed"].includes(tx.status)) {
      return c.json({ error: `Transaction already ${tx.status}` }, 400);
    }

    // Check if high risk requires manual review
    if (tx.risk_level === "high" && tx.status !== "executing") {
      return c.json({ error: "High risk transaction requires manual review before execution" }, 400);
    }

    // ── Task 117: Sender-specified lockup + risk-derived lockup → max(requested, risk) ──
    const riskScore = tx.risk_score ?? 0;
    const rawLockupField = tx.lockup_duration_minutes ?? NETWORK_DEFAULTS.default_lockup_duration_minutes;
    // Convention: negative lockup_duration_minutes = user explicitly requested lockup (bypass risk gate)
    const userForcedLockup = rawLockupField < 0;
    const requestedLockup = Math.abs(rawLockupField);

    // Get sender's bank config for risk ceiling thresholds
    const senderBankConfig = await getBankConfig(tx.sender_bank_id);
    const riskInstantCeiling = senderBankConfig.risk_instant_ceiling;
    const riskDeferred24hCeiling = senderBankConfig.risk_deferred_24h_ceiling;
    const riskDeferred72hCeiling = senderBankConfig.risk_deferred_72h_ceiling;

    // Derive lockup minutes from risk score using existing thresholds
    let riskDerivedLockupMinutes = 0;
    if (riskScore > riskDeferred72hCeiling) {
      riskDerivedLockupMinutes = 4320; // 72h max
    } else if (riskScore > riskDeferred24hCeiling) {
      riskDerivedLockupMinutes = 4320; // 72h
    } else if (riskScore > riskInstantCeiling) {
      riskDerivedLockupMinutes = 1440; // 24h
    }

    // Risk-gated bifurcation:
    // - If user explicitly forced lockup (negative convention), ALWAYS use their duration
    // - If risk score is at or below the instant ceiling, force direct PvP
    // - Otherwise, use max(requestedLockup, riskDerivedLockup)
    let effectiveLockupMinutes: number;
    if (userForcedLockup) {
      effectiveLockupMinutes = requestedLockup; // User override — bypass risk gate
      console.log(`[settlement] USER-FORCED LOCKUP: ${requestedLockup}min (bypassing risk gate, riskScore=${riskScore})`);
    } else if (riskScore <= riskInstantCeiling) {
      effectiveLockupMinutes = 0; // Low risk — direct PvP, bypass requestedLockup
    } else {
      effectiveLockupMinutes = Math.max(requestedLockup, riskDerivedLockupMinutes);
    }
    const isLockupFlow = effectiveLockupMinutes > 0;

    console.log(`[settlement] Risk-gated bifurcation: riskScore=${riskScore}, instantCeiling=${riskInstantCeiling}, requested=${requestedLockup}min, riskDerived=${riskDerivedLockupMinutes}min, effective=${effectiveLockupMinutes}min → ${isLockupFlow ? 'LOCKUP' : 'PvP'}`);
    console.log(`[${aid}] ┌─ ON-CHAIN EXECUTION for tx ${transaction_id.slice(0, 8)}`);
    console.log(`[${aid}] │  Status: ${tx.status}, risk_level: ${tx.risk_level}, risk_score: ${riskScore}, flow: ${isLockupFlow ? "LOCKUP" : "DIRECT PvP"}`);
    console.log(`[${aid}] │  Lockup: requested=${requestedLockup}min, risk_derived=${riskDerivedLockupMinutes}min, effective=${effectiveLockupMinutes}min`);
    console.log(`[${aid}] │  Amount: $${tx.amount_display?.toLocaleString()} (${tx.amount} raw)`);
    console.log(`[${aid}] │  Sender: ${senderBank?.short_code} wallet=${senderBank?.solana_wallet_pubkey?.slice(0, 16)}..., mint=${senderBank?.token_mint_address?.slice(0, 16)}...`);
    console.log(`[${aid}] │  Receiver: ${receiverBank?.short_code} wallet=${receiverBank?.solana_wallet_pubkey?.slice(0, 16)}..., mint=${receiverBank?.token_mint_address?.slice(0, 16)}...`);

    // Update status to executing
    await supabase
      .from("transactions")
      .update({ status: "executing" })
      .eq("id", transaction_id);

    const settlementAmt = tx.amount_display != null
      ? Number(tx.amount_display).toFixed(2)
      : (Number(BigInt(tx.amount)) / Math.pow(10, TOKEN_DECIMALS)).toFixed(2);
    const rawAmount = BigInt(tx.amount);

    // ════════════════════════════════════════════════════════════
    // BRANCH A: LOW RISK (0-30) — Direct burn-and-mint PvP
    // ════════════════════════════════════════════════════════════
    if (!isLockupFlow) {
      let transferResult;
      try {
        transferResult = await executeTransfer(
          senderBank.solana_wallet_keypair_encrypted,
          senderBank.token_mint_address,
          receiverBank.solana_wallet_keypair_encrypted,
          receiverBank.token_mint_address,
          rawAmount,
          tx.purpose_code || "settlement",
          transaction_id,
          {
            senderBic: resolveBic(senderBank),
            senderName: senderBank.name,
            receiverBic: resolveBic(receiverBank),
            receiverName: receiverBank.name,
            settlementAmount: settlementAmt,
            currency: "USD",
            remittanceInfo: tx.memo || undefined,
          },
        );
      } catch (solanaErr) {
        const errMsg = solanaErr instanceof Error ? solanaErr.message : String(solanaErr);
        console.log(`[${aid}] │  Transfer FAILED: ${errMsg}`);
        console.log(`[${aid}] └─ EXECUTION FAILED — reverting to risk_scored`);
        await supabase
          .from("transactions")
          .update({ status: "risk_scored" })
          .eq("id", transaction_id);
        return c.json({ error: `On-chain settlement failed: ${errMsg}`, step: "solana_transfer" }, 500);
      }

      const now = new Date().toISOString();
      const shouldLock = tx.lockup_until && new Date(tx.lockup_until) > new Date();
      const finalStatus = shouldLock ? "locked" : "settled";

      // Update wallet balances from real on-chain state
      try {
        const senderBalance = await getTokenBalance(senderBank.solana_wallet_pubkey, senderBank.token_mint_address);
        await supabase
          .from("wallets")
          .update({ balance_tokens: Number(senderBalance) })
          .eq("bank_id", tx.sender_bank_id)
          .eq("is_default", true);

        const receiverBalance = await getTokenBalance(receiverBank.solana_wallet_pubkey, receiverBank.token_mint_address);
        await supabase
          .from("wallets")
          .update({ balance_tokens: Number(receiverBalance) })
          .eq("bank_id", tx.receiver_bank_id)
          .eq("is_default", true);

        console.log(`[${aid}] Balances updated — sender: ${Number(senderBalance)} (${senderBank.short_code} mint), receiver: ${Number(receiverBalance)} (${receiverBank.short_code} mint)`);
      } catch (balErr) {
        console.log(`[${aid}] Warning: failed to read on-chain balances: ${(balErr as Error).message}`);
      }

      console.log(`[${aid}] |  Updating tx ${transaction_id.slice(0, 8)} status -> ${finalStatus} (HTTP route)`);
      const { error: txUpdateErr } = await supabase
        .from("transactions")
        .update({
          status: finalStatus,
          settlement_type: "PvP",
          solana_tx_signature: transferResult.signature,
          solana_slot: transferResult.slot,
          solana_block_time: transferResult.blockTime ? new Date(transferResult.blockTime * 1000).toISOString() : now,
          settled_at: shouldLock ? null : now,
          is_reversible: shouldLock ? true : false,
        })
        .eq("id", transaction_id);
      if (txUpdateErr) {
        console.log(`[${aid}] |  FAILED to update tx status: ${JSON.stringify(txUpdateErr)}`);
      } else {
        console.log(`[${aid}] |  TX status updated to ${finalStatus} OK`);
      }

      // ── Collect network fee (SOL gas-layer) ──
      const pvpMemo = [
        `CODA Solstice | PvP Burn-Mint Settlement`,
        `TxId:    ${transaction_id}`,
        `Amount:  ${settlementAmt} USD`,
        `From:    ${resolveBic(senderBank)} (${senderBank.name})`,
        `To:      ${resolveBic(receiverBank)} (${receiverBank.name})`,
        `Fee:     ${NETWORK_DEFAULTS.network_fee_sol} SOL → SOLSTICE_FEES`,
      ].join("\n");
      const feeResult = await collectNetworkFee(
        senderBank.solana_wallet_keypair_encrypted,
        transaction_id,
        "pvp_burn_mint",
        pvpMemo,
        `[${aid}]`,
      );
      if (feeResult.feeSig) {
        console.log(`[${aid}] │  Network fee: ${feeResult.feeSol} SOL — sig: ${feeResult.feeSig.slice(0, 20)}...`);
      }

      await supabase.from("agent_messages").insert({
        id: crypto.randomUUID(),
        transaction_id,
        from_bank_id: tx.receiver_bank_id,
        to_bank_id: tx.sender_bank_id,
        message_type: "settlement_confirm",
        content: {
          agent_id: aid,
          action: finalStatus,
          tx_signature: transferResult.signature,
          amount: tx.amount,
          amount_display: tx.amount_display,
          locked_until: shouldLock ? tx.lockup_until : null,
          network_fee_sol: feeResult.feeSol,
        },
        natural_language: shouldLock
          ? `Maestro \u2014 Settlement executed with deferred finality. Tx: ${transferResult.signature.slice(0, 16)}... locked until ${tx.lockup_until}. Amount: $${tx.amount_display?.toLocaleString()}. Fee: ${feeResult.feeSol} SOL`
          : `Maestro \u2014 Settlement confirmed on Solana Devnet. Tx: ${transferResult.signature.slice(0, 16)}... Amount: $${tx.amount_display?.toLocaleString()} transferred successfully. Fee: ${feeResult.feeSol} SOL`,
        processed: false,
        created_at: now,
      });

      console.log(`[${aid}] └─ EXECUTION COMPLETE: ${finalStatus} — sig=${transferResult.signature.slice(0, 20)}... (slot ${transferResult.slot}), fee=${feeResult.feeSol} SOL`);

      return c.json({
        transaction_id,
        status: finalStatus,
        solana_tx_signature: transferResult.signature,
        solana_slot: transferResult.slot,
        locked_until: shouldLock ? tx.lockup_until : null,
      });
    }

    // ════════════════════════════════════════════════════════════
    // BRANCH B: MEDIUM/HIGH RISK (31+) — Three-token lockup flow
    // ════════════════════════════════════════════════════════════
    console.log(`[${aid}] │  ▶ LOCKUP FLOW — risk_score=${riskScore}, effective=${effectiveLockupMinutes}min`);

    // Task 117: Use effective lockup minutes. High risk (score > 72h ceiling) = indefinite/escalation
    const isHighRisk = riskScore > riskDeferred72hCeiling;
    const lockupSeconds = isHighRisk ? 0 : effectiveLockupMinutes * 60;
    const lockupDuration = isHighRisk ? "indefinite (escalation eligible)" : `${effectiveLockupMinutes}min (${lockupSeconds}s)`;

    // Retrieve BNY custodian keypair from KV
    const rawCustodian = await kv.get("infra:custodian:BNY");
    if (!rawCustodian) {
      console.log(`[${aid}] └─ LOCKUP FAILED — BNY custodian not set up`);
      await supabase.from("transactions").update({ status: "risk_scored" }).eq("id", transaction_id);
      return c.json({ error: "BNY custodian not configured. Run /setup-custodian first." }, 400);
    }
    const custodianData = JSON.parse(rawCustodian as string);

    // If BNY is linked to a bank, get the bank's keypair
    let custodianKeypairEncrypted: string;
    if (custodianData.linked_bank_id) {
      const { data: bnyBank } = await supabase.from("banks").select("solana_wallet_keypair_encrypted").eq("id", custodianData.linked_bank_id).maybeSingle();
      custodianKeypairEncrypted = bnyBank?.solana_wallet_keypair_encrypted || custodianData.keypair_encrypted;
    } else {
      custodianKeypairEncrypted = custodianData.keypair_encrypted;
    }

    if (!custodianKeypairEncrypted) {
      console.log(`[${aid}] └─ LOCKUP FAILED — BNY custodian keypair not found`);
      await supabase.from("transactions").update({ status: "risk_scored" }).eq("id", transaction_id);
      return c.json({ error: "BNY custodian keypair not found." }, 500);
    }

    // Step 1: Burn sender deposit token
    let burnResult;
    try {
      const burnMemo = buildISO20022LockupMemo({
        transactionId: transaction_id, senderBank, receiverBank,
        amount: settlementAmt, purposeCode: tx.purpose_code || "settlement",
        remittanceInfo: tx.memo || undefined,
        phase: "Phase 1 — Sender Burn", operation: "BURN",
      });
      burnResult = await burnDepositToken(
        senderBank.solana_wallet_keypair_encrypted,
        senderBank.token_mint_address,
        rawAmount,
        burnMemo,
      );
      console.log(`[${aid}] │  Step 1 ✓ Sender deposit burned: ${burnResult.signature.slice(0, 20)}...`);
    } catch (burnErr) {
      const errMsg = burnErr instanceof Error ? burnErr.message : String(burnErr);
      console.log(`[${aid}] │  Step 1 ✗ Sender deposit burn FAILED: ${errMsg}`);
      console.log(`[${aid}] └─ LOCKUP FAILED — reverting to risk_scored`);
      await supabase.from("transactions").update({ status: "risk_scored" }).eq("id", transaction_id);
      return c.json({ error: `Lockup step 1 (sender burn) failed: ${errMsg}`, step: "sender_burn" }, 500);
    }

    // Step 2: Mint LOCKUP-USTB to BNY custodian escrow (Task 118: shared lockup mint)
    let lockupMintResult;
    let lockupMintAddr: string;
    try {
      const { mintAddress } = await ensureLockupMint();
      lockupMintAddr = mintAddress;
      const escrowMemo = buildISO20022LockupMemo({
        transactionId: transaction_id, senderBank, receiverBank,
        amount: settlementAmt, purposeCode: tx.purpose_code || "settlement",
        remittanceInfo: tx.memo || undefined,
        phase: "Phase 1 — Escrow Mint", operation: "ESCROW_MINT",
      });
      lockupMintResult = await mintLockupToEscrow(
        custodianKeypairEncrypted,
        lockupMintAddr,
        rawAmount,
        escrowMemo,
      );
      console.log(`[${aid}] \u2502  Step 2 \u2713 LOCKUP-USTB minted to escrow: ${lockupMintResult.signature.slice(0, 20)}...`);
    } catch (escrowErr) {
      const errMsg = escrowErr instanceof Error ? escrowErr.message : String(escrowErr);
      console.log(`[${aid}] \u2502  Step 2 \u2717 Escrow mint FAILED: ${errMsg}`);
      await supabase.from("transactions").update({ status: "risk_scored", lockup_status: null }).eq("id", transaction_id);
      return c.json({ error: `Lockup step 2 (escrow mint) failed after sender burn: ${errMsg}. SENDER TOKENS ALREADY BURNED \u2014 manual recovery needed.`, step: "escrow_mint" }, 500);
    }

    const now = new Date().toISOString();
    const lockupStart = now;
    const lockupEnd = isHighRisk ? null : new Date(Date.now() + lockupSeconds * 1000).toISOString();

    // Step 3: Insert lockup_tokens record (shared LOCKUP-USTB mint, no TB token)
    const lockupId = crypto.randomUUID();
    const { error: lockupInsertErr } = await supabase.from("lockup_tokens").insert({
      id: lockupId,
      transaction_id,
      sender_bank_id: tx.sender_bank_id,
      receiver_bank_id: tx.receiver_bank_id,
      yb_token_mint: lockupMintAddr,
      yb_token_symbol: LOCKUP_TOKEN_SYMBOL,
      yb_token_amount: rawAmount.toString(),
      yb_holder: custodianData.wallet_address,
      tb_token_mint: null,
      tb_token_symbol: null,
      tb_token_amount: null,
      tb_holder: null,
      yield_rate_bps: 525,
      yield_accrued: "0",
      yield_last_calculated: lockupStart,
      lockup_start: lockupStart,
      lockup_end: lockupEnd,
      status: "active",
      created_at: lockupStart,
    });
    if (lockupInsertErr) {
      console.log(`[${aid}] \u2502  Step 3 \u26a0 lockup_tokens insert failed: ${lockupInsertErr.message}`);
    } else {
      console.log(`[${aid}] \u2502  Step 3 \u2713 lockup_tokens record: ${lockupId.slice(0, 8)}... (${lockupDuration})`);
    }

    // Step 5: Update transactions.lockup_status = 'soft_settled'
    // Step 6: Update transactions.status = 'locked'
    // Also update sender wallet balance (tokens were burned)
    try {
      const senderBalance = await getTokenBalance(senderBank.solana_wallet_pubkey, senderBank.token_mint_address);
      await supabase.from("wallets").update({ balance_tokens: Number(senderBalance) }).eq("bank_id", tx.sender_bank_id).eq("is_default", true);
    } catch (balErr) {
      console.log(`[${aid}] Warning: failed to update sender balance: ${(balErr as Error).message}`);
    }

    const { error: txLockupUpdateErr } = await supabase
      .from("transactions")
      .update({
        status: "locked",
        settlement_type: "lockup",
        settlement_method: userForcedLockup ? "lockup_user_requested" : "lockup_three_token",
        lockup_status: "active",
        lockup_until: lockupEnd,
        lockup_duration_minutes: effectiveLockupMinutes, // Normalize negative convention → positive actual minutes
        solana_tx_signature: burnResult.signature,
        solana_slot: burnResult.slot,
        solana_block_time: now,
        settled_at: null,
        is_reversible: true,
      })
      .eq("id", transaction_id);
    if (txLockupUpdateErr) {
      console.log(`[${aid}] \u2502  Steps 4-5 \u26a0 tx update failed: ${txLockupUpdateErr.message}`);
    } else {
      console.log(`[${aid}] \u2502  Steps 4-5 \u2713 tx status=locked, lockup_status=active (Phase 1)`);
    }

    // Step 7: Insert agent_message
    await supabase.from("agent_messages").insert({
      id: crypto.randomUUID(),
      transaction_id,
      from_bank_id: tx.receiver_bank_id,
      to_bank_id: tx.sender_bank_id,
      message_type: "settlement_confirm",
      content: {
        agent_id: aid,
        action: "lockup",
        flow: "three_token_escrow",
        phase: 1,
        burn_signature: burnResult.signature,
        escrow_mint_signature: lockupMintResult.signature,
        lockup_mint: lockupMintAddr,
        lockup_symbol: LOCKUP_TOKEN_SYMBOL,
        lockup_id: lockupId,
        lockup_seconds: lockupSeconds,
        lockup_end: lockupEnd,
        amount: tx.amount,
        amount_display: tx.amount_display,
      },
      natural_language: `Maestro \u2014 Phase 1 complete. ${LOCKUP_TOKEN_SYMBOL} minted to BNY escrow. Receiver has NO tokens yet. Lockup: ${lockupDuration}. Cadenza monitoring initiated.`,
      processed: false,
      created_at: now,
    });

    // ── Collect network fee (SOL gas-layer) ──
    const lockupMemoText = [
      `CODA Solstice | Lockup Phase 1 (Escrow)`,
      `TxId:    ${transaction_id}`,
      `Amount:  ${settlementAmt} USD`,
      `From:    ${resolveBic(senderBank)} (${senderBank.name})`,
      `To:      ${resolveBic(receiverBank)} (${receiverBank.name})`,
      `Burn:    ${burnResult.signature.slice(0, 16)}...`,
      `Escrow:  ${lockupMintResult.signature.slice(0, 16)}...`,
      `Lockup:  ${lockupDuration}`,
      `Fee:     ${NETWORK_DEFAULTS.network_fee_sol} SOL \u2192 SOLSTICE_FEES (Phase 1 of 2)`,
    ].join("\n");
    const lockupFeeResult = await collectNetworkFee(
      senderBank.solana_wallet_keypair_encrypted,
      transaction_id,
      "lockup_three_token",
      lockupMemoText,
      `[${aid}]`,
    );
    if (lockupFeeResult.feeSig) {
      console.log(`[${aid}] │  Network fee: ${lockupFeeResult.feeSol} SOL — sig: ${lockupFeeResult.feeSig.slice(0, 20)}...`);
    }

    console.log(`[${aid}] \u2514\u2500 LOCKUP PHASE 1 COMPLETE: locked \u2014 LOCKUP-USTB=${lockupMintAddr.slice(0, 16)}..., fee=${lockupFeeResult.feeSol} SOL`);

    return c.json({
      transaction_id,
      status: "locked",
      lockup_status: "active",
      flow: "three_token_escrow",
      phase: 1,
      lockup_id: lockupId,
      risk_score: riskScore,
      lockup_seconds: lockupSeconds,
      lockup_end: lockupEnd,
      burn_signature: burnResult.signature,
      escrow_mint_signature: lockupMintResult.signature,
      lockup_mint: lockupMintAddr,
      network_fee_sol: lockupFeeResult.feeSol,
    });
  } catch (err) {
    console.log(`[agent-execute] Error: ${(err as Error).message}`);
    return c.json({ error: `Agent execute error: ${(err as Error).message}` }, 500);
  }
});

// ============================================================
// 6. AGENT-ORCHESTRATOR — Multi-agent autonomous flow
// ============================================================
app.post("/make-server-49d15288/agent-orchestrator", async (c) => {
  try {
    const body = await c.req.json();
    const { bank_id, message_id } = body;
    if (!bank_id || !message_id) {
      return c.json({ error: "Missing required fields: bank_id, message_id" }, 400);
    }
    const supabase = getAdminClient();
    console.log(`[orchestrator] Received: bank_id=${bank_id?.slice(0, 8)}, message_id=${message_id?.slice(0, 8)}`);
    const result = await coreOrchestrate(supabase, bank_id, message_id);
    return c.json(result);
  } catch (err) {
    console.log(`[orchestrator] Error: ${(err as Error).message}`);
    return c.json({ error: `Orchestrator error: ${(err as Error).message}` }, 500);
  }
});

// ============================================================
// Helper: Robustly parse a numeric amount from any format
// ============================================================
// Handles: 100, "100", "$100", "10,000", "$10,000.00", etc.
function parseNumericAmount(raw: unknown): number {
  if (raw == null) return 0;
  if (typeof raw === 'number') return raw;
  const s = String(raw).replace(/[$,\s]/g, '').trim();
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// ============================================================
// Helper: Parse exact dollar amount from user input text
// ============================================================
// Handles formats like: $1, $1.00, $100, $1,000, $1,000.50,
// $100K, $100k, $1M, $1m, $1 million, $2.5M, etc.
// Returns null if no amount found.
function parseExactDollarAmount(input: string): number | null {
  // Normalize input
  const text = input.replace(/\s+/g, ' ').trim();

  // Pattern 1: $X with optional K/M/B suffix
  // Matches: $1, $1.00, $1,000, $1,000.50, $100K, $2.5M, $1B
  const dollarPattern = /\$\s*([\d,]+(?:\.\d+)?)\s*(k|m|b|thousand|million|billion)?/gi;
  const matches = [...text.matchAll(dollarPattern)];

  if (matches.length > 0) {
    // Use the first match
    const match = matches[0];
    const numStr = match[1].replace(/,/g, '');
    const base = parseFloat(numStr);
    if (isNaN(base)) return null;

    const suffix = (match[2] || '').toLowerCase();
    let multiplier = 1;
    if (suffix === 'k' || suffix === 'thousand') multiplier = 1_000;
    else if (suffix === 'm' || suffix === 'million') multiplier = 1_000_000;
    else if (suffix === 'b' || suffix === 'billion') multiplier = 1_000_000_000;

    return base * multiplier;
  }

  // Pattern 2: plain number followed by "dollars" or K/M/B
  // Matches: "1 dollar", "100 dollars", "1 million dollars", "send 500 to"
  const plainPattern = /([\d,]+(?:\.\d+)?)\s*(k|m|b|thousand|million|billion)?\s*(?:dollars?|usd)?/gi;
  const plainMatches = [...text.matchAll(plainPattern)];

  if (plainMatches.length > 0) {
    const match = plainMatches[0];
    const numStr = match[1].replace(/,/g, '');
    const base = parseFloat(numStr);
    if (isNaN(base)) return null;

    const suffix = (match[2] || '').toLowerCase();
    let multiplier = 1;
    if (suffix === 'k' || suffix === 'thousand') multiplier = 1_000;
    else if (suffix === 'm' || suffix === 'million') multiplier = 1_000_000;
    else if (suffix === 'b' || suffix === 'billion') multiplier = 1_000_000_000;

    return base * multiplier;
  }

  return null;
}

// ============================================================
// Helper: Parse lockup duration from user input
// ============================================================
// Matches patterns like "10 minute lockup", "with a 5 min lockup",
// "30-minute hold", "lock for 2 hours", "1 hour lockup", etc.
// Returns the lockup duration in minutes, or null if not specified.
function parseLockupMinutes(input: string): number | null {
  const text = input.replace(/\s+/g, ' ').trim().toLowerCase();

  // Pattern 1: "X minute/min/m lockup/lock/hold"
  const minPattern = /(\d+)\s*[-\s]?\s*(?:minute|min)\s*(?:lockup|lock|hold)/i;
  const minMatch = text.match(minPattern);
  if (minMatch) return parseInt(minMatch[1], 10);

  // Pattern 2: "X hour/hr lockup/lock/hold"
  const hourPattern = /(\d+(?:\.\d+)?)\s*[-\s]?\s*(?:hour|hr)\s*(?:lockup|lock|hold)/i;
  const hourMatch = text.match(hourPattern);
  if (hourMatch) return Math.round(parseFloat(hourMatch[1]) * 60);

  // Pattern 3: "lockup/lock/hold for X minutes/hours"
  const forPattern = /(?:lockup|lock|hold)\s+(?:for\s+)?(\d+(?:\.\d+)?)\s*(minute|min|hour|hr)/i;
  const forMatch = text.match(forPattern);
  if (forMatch) {
    const val = parseFloat(forMatch[1]);
    const isHours = /hour|hr/i.test(forMatch[2]);
    return isHours ? Math.round(val * 60) : Math.round(val);
  }

  // Pattern 4: "with a X min/minute lockup"
  const withPattern = /with\s+(?:a\s+)?(\d+(?:\.\d+)?)\s*[-\s]?\s*(minute|min|hour|hr)\s*(?:lockup|lock|hold)?/i;
  const withMatch = text.match(withPattern);
  if (withMatch) {
    const val = parseFloat(withMatch[1]);
    const isHours = /hour|hr/i.test(withMatch[2]);
    return isHours ? Math.round(val * 60) : Math.round(val);
  }

  return null;
}

// ============================================================
// Helper: Initiate payment
// ============================================================
async function handleInitiatePayment(
  supabase: any,
  senderBank: any,
  senderWallet: any,
  otherBanks: any[],
  params: Record<string, unknown>,
  messageToCounterparty: string | null
): Promise<string> {
  const receiverCode = (params.receiver_bank_code as string || "").toUpperCase();
  const amount = parseNumericAmount(params.amount);
  const memo = (params.memo as string) || "";
  const purposeCode = (params.purpose_code as string) || "OTHER";
  const aid = agentId(senderBank.id);

  console.log(`[${aid}] handleInitiatePayment: receiver=${receiverCode}, amount=$${amount.toLocaleString()}, amountRaw=${JSON.stringify(params.amount)}, amountParsed=${amount}, memo="${memo}", purpose=${purposeCode}`);

  const receiver = otherBanks.find(
    (b) => b.short_code.toUpperCase() === receiverCode
  );

  if (!receiver) {
    throw new Error(`Receiver bank '${receiverCode}' not found on the network`);
  }

  if (amount <= 0) {
    throw new Error("Payment amount must be positive");
  }

  const amountTokens = amount * 1e6; // Convert to 6 decimal raw tokens

  // Check sender balance
  if (senderWallet && senderWallet.balance_tokens < amountTokens) {
    throw new Error(
      `Insufficient balance. Have $${(senderWallet.balance_tokens / 1e6).toLocaleString()}, need $${amount.toLocaleString()}`
    );
  }

  const txId = crypto.randomUUID();
  const now = new Date().toISOString();

  // Task 117: Resolve sender's lockup duration from their config
  const senderConfig = await getBankConfig(senderBank.id);
  let lockupDurationMinutes = senderConfig.default_lockup_duration_minutes;

  // User-specified lockup override: if the user explicitly requested a lockup duration
  // (e.g. "with a 10 minute lockup"), store as NEGATIVE to signal the bifurcation logic
  // to force lockup regardless of risk score. Convention:
  //   positive = bank config default (subject to risk gate — may be overridden to PvP)
  //   negative = user explicitly requested |N| minutes (bypasses risk gate)
  const userLockupMinutes = params.lockup_minutes != null ? parseInt(String(params.lockup_minutes), 10) : null;
  if (userLockupMinutes != null && userLockupMinutes > 0) {
    lockupDurationMinutes = -userLockupMinutes; // Negative = user-forced lockup
    console.log(`[${aid}] User-forced lockup: ${userLockupMinutes} min (stored as ${lockupDurationMinutes})`);
  }
  // NOTE: lockup_duration_minutes is stamped at transaction creation time.
  // Positive values = bank config default (subject to risk-score gate at execution time).
  // Negative values = user explicitly requested lockup (bypasses risk gate at execution).

  // Create transaction
  const txRecord = {
    id: txId,
    sender_bank_id: senderBank.id,
    receiver_bank_id: receiver.id,
    amount: amountTokens,
    amount_display: amount,
    currency: "USD",
    sender_token_mint: senderBank.token_mint_address,
    receiver_token_mint: receiver.token_mint_address,
    status: "initiated",
    risk_level: null,
    risk_score: null,
    risk_reasoning: null,
    compliance_passed: null,
    compliance_checks: null,
    memo,
    purpose_code: purposeCode,
    solana_tx_signature: null,
    solana_slot: null,
    solana_block_time: null,
    lockup_until: null,
    lockup_duration_minutes: lockupDurationMinutes,
    is_reversible: false,
    reversed_at: null,
    reversal_reason: null,
    initiated_at: now,
    compliance_completed_at: null,
    risk_scored_at: null,
    settled_at: null,
    created_at: now,
  };

  const { error: txErr } = await supabase.from("transactions").insert(txRecord);
  if (txErr) {
    throw new Error(`Failed to create transaction: ${txErr.message}`);
  }

  // ── Travel Rule Payload (IVMS 101) ──
  // FinCEN Travel Rule: transactions >= $3,000 require originator/beneficiary data
  const senderBic = senderBank.swift_bic || SWIFT_BIC_REGISTRY[senderBank.short_code] || senderBank.short_code;
  const receiverBic = receiver.swift_bic || SWIFT_BIC_REGISTRY[receiver.short_code] || receiver.short_code;
  const travelRulePayload = amount >= 3000
    ? {
        standard: 'IVMS101',
        version: '1.0',
        originator: { name: senderBank.name, accountNumber: senderWallet?.sol_address || '', bic: senderBic },
        beneficiary: { name: receiver.name, accountNumber: '', bic: receiverBic },
        amount,
        currency: 'USD',
        purposeCode,
        threshold: 3000,
        status: 'transmitted',
        transmittedAt: now,
      }
    : {
        status: 'not_required',
        threshold: 3000,
        reason: 'Below FinCEN $3,000 threshold',
      };

  const { error: travelRuleErr } = await supabase
    .from("transactions")
    .update({ travel_rule_payload: travelRulePayload })
    .eq("id", txId);
  if (travelRuleErr) {
    console.log(`[${aid}] Warning: Failed to write travel_rule_payload: ${travelRuleErr.message}`);
  } else {
    console.log(`[${aid}] Travel Rule: ${travelRulePayload.status} (amount=$${amount.toLocaleString()}, threshold=$3,000)`);
  }

  // Send payment_request message to receiver
  const paymentRequestMsgId = crypto.randomUUID();
  await supabase.from("agent_messages").insert({
    id: paymentRequestMsgId,
    transaction_id: txId,
    from_bank_id: senderBank.id,
    to_bank_id: receiver.id,
    message_type: "payment_request",
    content: {
      agent_id: aid,
      action: "payment_request",
      amount,
      amount_tokens: amountTokens,
      memo,
      purpose_code: purposeCode,
      sender_token_mint: senderBank.token_mint_address,
    },
    natural_language:
      messageToCounterparty
        ? `Maestro \u2014 ${messageToCounterparty}`
        : `Maestro \u2014 ${senderBank.short_code} requests settlement of $${amount.toLocaleString()} to ${receiver.short_code} for ${purposeCode}. Memo: ${memo}`,
    processed: false,
    created_at: now,
  });

  console.log(`[${aid}] ┌─ PAYMENT INITIATED: $${amount.toLocaleString()} PvP settlement to ${receiver.short_code}`);
  console.log(`[${aid}] │  txId=${txId.slice(0, 8)}, msgId=${paymentRequestMsgId.slice(0, 8)}, purposeCode=${purposeCode}, memo=${memo}`);
  console.log(`[${aid}] │  Sender mint: ${senderBank.token_mint_address?.slice(0, 16)}...`);
  console.log(`[${aid}] │  Receiver: ${receiver.short_code} (${receiver.id.slice(0, 8)})`);

  // ── A2A: Fire-and-forget receiver-side orchestration ──
  // Direct function call (no HTTP self-call — fixes 401 auth issue)
  console.log(`[${aid}] └─ Triggering A2A receiver orchestration for ${receiver.short_code} (msg ${paymentRequestMsgId.slice(0, 8)})`);

  const orchestrationSupabase = getAdminClient();
  coreOrchestrate(orchestrationSupabase, receiver.id, paymentRequestMsgId)
    .then((result) => {
      console.log(`[${aid}] A2A orchestration result: action=${result.action}, settled=${result.settlement?.status || 'N/A'}, tx=${txId.slice(0, 8)}`);
      if (result.error) console.log(`[${aid}] A2A orchestration ERROR: ${result.error}`);
    })
    .catch((err: Error) => {
      console.log(`[${aid}] A2A receiver orchestration error for ${receiver.short_code}: ${err.message}`);
    });

  return txId;
}

// ============================================================
// Helper: Accept payment
// ============================================================
async function handleAcceptPayment(
  supabase: any,
  bank: any,
  transactionId: string,
  messageToCounterparty: string | null
): Promise<void> {
  const { data: tx } = await supabase
    .from("transactions")
    .select("*")
    .eq("id", transactionId)
    .single();

  if (!tx) return;

  const aid = agentId(bank.id);

  // Send accept message
  await supabase.from("agent_messages").insert({
    id: crypto.randomUUID(),
    transaction_id: transactionId,
    from_bank_id: bank.id,
    to_bank_id: tx.sender_bank_id,
    message_type: "payment_accept",
    content: { agent_id: aid, action: "accept", transaction_id: transactionId },
    natural_language:
      messageToCounterparty
        ? `Maestro \u2014 ${messageToCounterparty}`
        : `Maestro \u2014 ${bank.short_code} accepts the settlement of $${(tx.amount_display || tx.amount / 1e6).toLocaleString()}.`,
    processed: false,
    created_at: new Date().toISOString(),
  });

  console.log(`[${aid}] Accepted settlement for tx ${transactionId.slice(0, 8)}`);
}

// ============================================================
// Helper: Reject payment
// ============================================================
async function handleRejectPayment(
  supabase: any,
  bank: any,
  transactionId: string,
  reason: string,
  messageToCounterparty: string | null
): Promise<void> {
  const { data: tx } = await supabase
    .from("transactions")
    .select("*")
    .eq("id", transactionId)
    .single();

  if (!tx) return;

  const aid = agentId(bank.id);

  // Update transaction status
  await supabase
    .from("transactions")
    .update({ status: "rejected" })
    .eq("id", transactionId);

  // Send reject message
  await supabase.from("agent_messages").insert({
    id: crypto.randomUUID(),
    transaction_id: transactionId,
    from_bank_id: bank.id,
    to_bank_id: tx.sender_bank_id,
    message_type: "payment_reject",
    content: {
      agent_id: aid,
      action: "reject",
      transaction_id: transactionId,
      reason,
    },
    natural_language:
      messageToCounterparty
        ? `Maestro \u2014 ${messageToCounterparty}`
        : `Maestro \u2014 ${bank.short_code} has rejected the settlement. Reason: ${reason}`,
    processed: false,
    created_at: new Date().toISOString(),
  });

  console.log(`[${aid}] Rejected settlement for tx ${transactionId.slice(0, 8)}: ${reason}`);
}

// ============================================================
// Core: Run agent-think logic directly (no HTTP self-call)
// ============================================================
async function coreAgentThink(
  supabase: any, bankId: string, input: string,
  transactionId: string | null, contextType: string
): Promise<any> {
  const aid = agentId(bankId);
  const { data: bank, error: bankErr } = await supabase.from("banks").select("*").eq("id", bankId).single();
  if (bankErr || !bank) throw new Error(`Bank not found: ${bankErr?.message}`);
  const { data: wallet } = await supabase.from("wallets").select("*").eq("bank_id", bankId).eq("is_default", true).maybeSingle();
  const { data: otherBanks } = await supabase.from("banks").select("id, name, short_code, status, token_symbol, jurisdiction").neq("id", bankId).eq("status", "active");
  const { data: recentConvos } = await supabase.from("agent_conversations").select("role, content").eq("bank_id", bankId).order("created_at", { ascending: false }).limit(10);
  let effectiveSysPrompt = buildAgentSystemPrompt(bank, wallet, otherBanks || [], aid);

  // ── Network mode context (Devnet preamble for AI) ──
  const networkCtxAgent = await getNetworkModeContext();
  if (networkCtxAgent) effectiveSysPrompt = networkCtxAgent + effectiveSysPrompt;

  // ── Treasury cycle context: append autonomous mode instructions (from prompts/shared-context.ts) ──
  if (contextType === 'treasury_cycle') {
    effectiveSysPrompt += TREASURY_CYCLE_APPENDIX;
  }

  // ── Task 117: Lockup duration context for all agent reasoning ──
  const agentBankConfig = await getBankConfig(bankId);
  const lockupMinutes = agentBankConfig.default_lockup_duration_minutes;
  if (lockupMinutes > 0) {
    effectiveSysPrompt += `\n\nLOCKUP POLICY: Your configured lockup duration is ${lockupMinutes} minutes. All outgoing transactions will have a minimum ${lockupMinutes}-minute reversibility window (the risk engine may extend this for higher-risk transactions, but never shorten it). This is your bank's policy — it ensures all settlements can be reversed within this window if issues are detected.`;
  } else {
    effectiveSysPrompt += `\n\nLOCKUP POLICY: Your lockup duration is set to 0 (immediate settlement). Low-risk transactions settle instantly via atomic PvP. The risk engine may still impose lockups for medium/high-risk transactions.`;
  }

  let userPrompt = input;
  if (contextType === "incoming_message" && transactionId) {
    const { data: tx } = await supabase.from("transactions")
      .select("*, sender_bank:banks!transactions_sender_bank_id_fkey(name, short_code), receiver_bank:banks!transactions_receiver_bank_id_fkey(name, short_code)")
      .eq("id", transactionId).single();
    if (tx) {
      userPrompt = `INCOMING MESSAGE regarding transaction ${transactionId}:\n${input}\n\nTransaction details: ${JSON.stringify({
        sender: (tx as any).sender_bank?.short_code, receiver: (tx as any).receiver_bank?.short_code,
        amount: tx.amount / 1e6, status: tx.status, memo: tx.memo, purpose_code: tx.purpose_code,
        risk_level: tx.risk_level, risk_score: tx.risk_score, compliance_passed: tx.compliance_passed })}`;
    }
  }
  const responseFormat = AGENT_THINK_RESPONSE_FORMAT_COMPACT;
  const geminiResponse = await callGeminiJSON<{ reasoning: string; action: string; params: Record<string, unknown>; message_to_counterparty: string | null; message_to_user: string; }>(effectiveSysPrompt, `${userPrompt}\n\n${responseFormat}`, { temperature: 0.2 });
  console.log(`[${aid}] coreAgentThink: action=${geminiResponse.action}, context=${contextType}`);
  console.log(`[${aid}] reasoning: ${geminiResponse.reasoning?.slice(0, 200)}`);
  const now = new Date().toISOString();
  // Save pipeline/treasury-generated inputs as "system" (not "user") so the frontend
  // doesn't render auto-generated prompts with the "You" label
  const inputRole = (contextType === 'user_instruction' || contextType === 'user_chat') ? 'user' : 'system';
  await supabase.from("agent_conversations").insert({ id: crypto.randomUUID(), bank_id: bankId, transaction_id: transactionId || null, role: inputRole, content: input, created_at: now });
  await supabase.from("agent_conversations").insert({ id: crypto.randomUUID(), bank_id: bankId, transaction_id: transactionId || null, role: "model", content: geminiResponse.message_to_user || geminiResponse.reasoning, created_at: new Date(Date.now() + 100).toISOString() });

  // ── Treasury cycle: handle NO_ACTION early return ──
  if (contextType === 'treasury_cycle' &&
      (geminiResponse.action === 'no_action' || geminiResponse.action === 'NO_ACTION')) {
    await supabase.from("agent_messages").insert({
      id: crypto.randomUUID(), transaction_id: null,
      from_bank_id: bankId, to_bank_id: bankId,
      message_type: "status_update",
      content: { agent_id: aid, action: "NO_ACTION", context: "treasury_cycle", reasoning: geminiResponse.reasoning },
      natural_language: `Maestro — Treasury cycle evaluation: no action taken. ${geminiResponse.reasoning?.slice(0, 200) || ''}`,
      processed: true, created_at: now,
    });
    console.log(`[${aid}] Treasury cycle (core): NO_ACTION — ${geminiResponse.reasoning?.slice(0, 100)}`);
    return { reasoning: geminiResponse.reasoning, action: 'NO_ACTION', params: geminiResponse.params, message_to_counterparty: null, message_to_user: geminiResponse.message_to_user || geminiResponse.reasoning, transaction_id: null };
  }

  // ── Execute action (mirrors route handler logic) ──
  let resultTxId = transactionId;
  if (geminiResponse.action === "initiate_payment") {
    console.log(`[${aid}] coreAgentThink: executing handleInitiatePayment (context=${contextType})`);
    resultTxId = await handleInitiatePayment(supabase, bank, wallet, otherBanks || [], geminiResponse.params, geminiResponse.message_to_counterparty);
    console.log(`[${aid}] coreAgentThink: transaction created txId=${resultTxId?.slice(0, 8)}`);
  } else if (geminiResponse.action === "accept_payment" && transactionId) {
    await handleAcceptPayment(supabase, bank, transactionId, geminiResponse.message_to_counterparty);
  } else if (geminiResponse.action === "reject_payment" && transactionId) {
    await handleRejectPayment(supabase, bank, transactionId, geminiResponse.params.rejection_reason as string || "Rejected by agent", geminiResponse.message_to_counterparty);
  }
  return { reasoning: geminiResponse.reasoning, action: geminiResponse.action, params: geminiResponse.params, message_to_counterparty: geminiResponse.message_to_counterparty, message_to_user: geminiResponse.message_to_user, transaction_id: resultTxId };
}

// ============================================================
// Core: Full orchestration (no HTTP self-calls — fixes 401)
// ============================================================
async function coreOrchestrate(supabase: any, bankId: string, messageId: string): Promise<any> {
  const aid = agentId(bankId);
  const { data: msg, error: msgErr } = await supabase.from("agent_messages").select("*").eq("id", messageId).single();
  if (msgErr || !msg) throw new Error(`Message not found: ${msgErr?.message}`);
  await supabase.from("agent_messages").update({ processed: true, processed_at: new Date().toISOString() }).eq("id", messageId);
  if (msg.transaction_id) {
    const { data: tx } = await supabase.from("transactions").select("status").eq("id", msg.transaction_id).single();
    if (tx && ["settled", "rejected", "reversed", "executing"].includes(tx.status)) {
      console.log(`[${aid}] Skipping: tx ${msg.transaction_id.slice(0, 8)} already ${tx.status}`);
      return { reasoning: `Transaction already ${tx.status}.`, action: "no_action", params: {}, message_to_counterparty: null, message_to_user: `Transaction already ${tx.status}.`, transaction_id: msg.transaction_id };
    }
  }
  console.log(`[${aid}] Processing ${msg.message_type} (id=${msg.id?.slice(0, 8)}, tx=${msg.transaction_id?.slice(0, 8) || 'none'})`);
  if (msg.message_type === "payment_request" && msg.transaction_id) return await runSettlementPipeline(supabase, bankId, msg);
  if (msg.message_type === "settlement_confirm") return { reasoning: "Settlement confirmation received.", action: "no_action", params: {}, message_to_counterparty: null, message_to_user: `Settlement confirmed. ${msg.natural_language || ""}`, transaction_id: msg.transaction_id };
  return await coreAgentThink(supabase, bankId, msg.natural_language || JSON.stringify(msg.content), msg.transaction_id, "incoming_message");
}

// ============================================================
// Core: Settlement pipeline (inline, no HTTP self-calls)
// ============================================================
async function runSettlementPipeline(supabase: any, bankId: string, msg: any): Promise<any> {
  const txId = msg.transaction_id;
  const aid = agentId(bankId);

  try {
    // Fetch network mode context for Gemini prompts
    const networkCtx = await getNetworkModeContext();

    // Step 1: Compliance check
    console.log(`[${aid}] ======================================================`);
    console.log(`[${aid}] SETTLEMENT PIPELINE - Direct Inline Execution`);
    console.log(`[${aid}] TX: ${txId.slice(0, 8)}  Bank: ${bankId.slice(0, 8)}`);
    console.log(`[${aid}] ======================================================`);
    console.log(`[${aid}] Step 1/4: Compliance check`);
    const { data: txComp, error: txCompErr } = await supabase.from("transactions")
      .select("*, sender_bank:banks!transactions_sender_bank_id_fkey(*), receiver_bank:banks!transactions_receiver_bank_id_fkey(*)")
      .eq("id", txId).single();
    if (txCompErr || !txComp) throw new Error(`TX not found for compliance: ${txCompErr?.message}`);
    console.log(`[${aid}] |  TX: status=${txComp.status}, amount=$${txComp.amount_display}, purpose=${JSON.stringify(txComp.purpose_code)}`);
    console.log(`[${aid}] |  ${(txComp as any).sender_bank?.short_code} -> ${(txComp as any).receiver_bank?.short_code}`);
    const purposeCodeRaw = txComp.purpose_code;
    const purposeCodeTruthy = !!purposeCodeRaw;
    console.log(`[${aid}] |  purpose_code: ${JSON.stringify(purposeCodeRaw)} (truthy=${purposeCodeTruthy}, typeof=${typeof purposeCodeRaw})`);

    // Load receiver bank's agent config for compliance parameters
    const pipelineConfig = await getBankConfig(bankId);
    const senderJurisdiction = (txComp as any).sender_bank?.jurisdiction || '';
    const receiverJurisdiction = (txComp as any).receiver_bank?.jurisdiction || '';
    const jurisdictionAllowed = pipelineConfig.jurisdiction_whitelist.includes(senderJurisdiction) && pipelineConfig.jurisdiction_whitelist.includes(receiverJurisdiction);
    const purposeAllowed = purposeCodeRaw ? pipelineConfig.approved_purpose_codes.some((pc: string) => purposeCodeRaw.toUpperCase().includes(pc) || pc.includes(purposeCodeRaw.toUpperCase())) : false;

    // Task 127: Query simulated OFAC watchlist for inline pipeline
    const senderBicPipe = resolveBic((txComp as any).sender_bank || { short_code: '' });
    const receiverBicPipe = resolveBic((txComp as any).receiver_bank || { short_code: '' });
    const watchlistPipe = await checkWatchlist(supabase, senderBicPipe, receiverBicPipe);
    const sanctionsPassedPipe = !watchlistPipe.hit;
    const sanctionsDetailPipe = sanctionsPassedPipe
      ? `Neither ${(txComp as any).sender_bank?.short_code} (${senderBicPipe}) nor ${(txComp as any).receiver_bank?.short_code} (${receiverBicPipe}) on sanctions lists`
      : `WATCHLIST HIT: ${watchlistPipe.matches.map((m: any) => `${m.entity_name} (${m.bic_code}) on ${m.list_type} — ${m.reason}`).join('; ')}`;

    const checks = [
      { type: "sanctions_screening", passed: sanctionsPassedPipe, detail: sanctionsDetailPipe },
      { type: "aml_threshold", passed: txComp.amount_display < 50_000_000, detail: txComp.amount_display >= 50_000_000 ? `$${txComp.amount_display.toLocaleString()} exceeds $50M AML threshold` : `$${txComp.amount_display.toLocaleString()} within range` },
      { type: "counterparty_verification", passed: true, detail: `${(txComp as any).receiver_bank?.name} is verified` },
      { type: "jurisdiction_check", passed: jurisdictionAllowed, detail: jurisdictionAllowed ? `${senderJurisdiction} -> ${receiverJurisdiction} approved` : `${senderJurisdiction} -> ${receiverJurisdiction} not in whitelist [${pipelineConfig.jurisdiction_whitelist.join(', ')}]` },
      { type: "purpose_code_validation", passed: purposeCodeTruthy && purposeAllowed, detail: !purposeCodeRaw ? "Missing purpose code" : purposeAllowed ? `'${purposeCodeRaw}' valid` : `'${purposeCodeRaw}' not in approved codes` },
    ];
    for (const ch of checks) console.log(`[${aid}] |  ${ch.passed ? 'PASS' : 'FAIL'} ${ch.type}: ${ch.detail}`);
    const allPassed = checks.every((ch) => ch.passed);
    const compNow = new Date().toISOString();
    for (const check of checks) {
      await supabase.from("compliance_logs").insert({ id: crypto.randomUUID(), transaction_id: txId, bank_id: txComp.receiver_bank_id, check_type: check.type, check_result: check.passed, details: { detail: check.detail, agent_id: aid }, solana_log_signature: null, created_at: compNow });
    }
    await supabase.from("transactions").update({ status: "compliance_check", compliance_passed: allPassed, compliance_checks: checks, compliance_completed_at: compNow }).eq("id", txId);
    console.log(`[${aid}] Step 1 result: ${allPassed ? "PASSED" : "FAILED"} (${checks.filter(c => c.passed).length}/${checks.length})`);

    // ── NEW: Concord narrative reasoning (Gemini LLM pass) ──
    let concordNarrative = '';
    try {
      const senderBankComp = (txComp as any).sender_bank;
      const receiverBankComp = (txComp as any).receiver_bank;
      const concordNarrativePrompt = buildConcordNarrativePrompt({
        networkModeContext: networkCtx,
        amountDisplay: txComp.amount_display || 0,
        senderName: senderBankComp?.name || '?',
        senderCode: senderBankComp?.short_code || '?',
        senderJurisdiction: senderBankComp?.jurisdiction || '?',
        receiverName: receiverBankComp?.name || '?',
        receiverCode: receiverBankComp?.short_code || '?',
        receiverJurisdiction: receiverBankComp?.jurisdiction || '?',
        purposeCode: purposeCodeRaw,
        checks,
        allPassed,
      });

      const narrativeResponse = await callGemini(CONCORD_SYSTEM_PROMPT, concordNarrativePrompt, { maxTokens: 300 });
      concordNarrative = narrativeResponse.trim();
      console.log(`[${aid}] |  Concord narrative: ${concordNarrative.slice(0, 120)}...`);
    } catch (err) {
      console.error(`[${aid}] |  Concord narrative generation failed:`, err);
      concordNarrative = concordNarrativeFallback(allPassed, checks.length, checks.filter((c: any) => !c.passed).length);
    }

    // ── Compliance result agent_message (detailed feed event) ──
    const sCodeComp = (txComp as any).sender_bank?.short_code || "?";
    const rCodeComp = (txComp as any).receiver_bank?.short_code || "?";
    const checksDetail = checks.map((c: any) => `${c.passed ? "✓" : "✗"} ${c.type.replace(/_/g, " ")}: ${c.detail}`).join("; ");
    await supabase.from("agent_messages").insert({
      id: crypto.randomUUID(), transaction_id: txId,
      from_bank_id: txComp.receiver_bank_id, to_bank_id: txComp.sender_bank_id,
      message_type: "compliance_response",
      content: { agent_id: aid, result: allPassed ? "PASSED" : "FAILED", checks_passed: checks.filter((c: any) => c.passed).length, checks_total: checks.length, checks, amount_display: txComp.amount_display, concord_narrative: concordNarrative },
      natural_language: `Concord — Compliance ${allPassed ? "PASSED" : "FAILED"} (${checks.filter((c: any) => c.passed).length}/${checks.length}) for ${sCodeComp}→${rCodeComp} $${txComp.amount_display?.toLocaleString()}: ${checksDetail}`,
      processed: true, created_at: compNow,
    });

    if (!allPassed) {
      const failedChecks = checks.filter((ch) => !ch.passed);
      const failedSummary = failedChecks.map((ch) => `${ch.type.replace(/_/g, ' ')}: ${ch.detail}`).join('; ');
      const passedCount = checks.filter((ch) => ch.passed).length;
      const { data: bank } = await supabase.from("banks").select("*").eq("id", bankId).single();
      const rejectionReason = `Compliance failed (${passedCount}/${checks.length} passed): ${failedSummary}`;
      if (bank) await handleRejectPayment(supabase, bank, txId, rejectionReason, `${bank.short_code} agent rejected: ${failedSummary}`);
      return { reasoning: `Compliance failed. ${failedSummary}`, action: "reject_payment",
        params: { rejection_reason: rejectionReason, failed_checks: failedChecks },
        message_to_counterparty: `Maestro: Settlement rejected. ${failedSummary}`,
        message_to_user: `Rejected: compliance failures: ${failedSummary}`, transaction_id: txId };
    }

    // Step 2: Risk Scoring (INLINE)
    console.log(`[${aid}] Step 2/4: Risk scoring`);
    const { data: txRisk } = await supabase.from("transactions")
      .select("*, sender_bank:banks!transactions_sender_bank_id_fkey(*), receiver_bank:banks!transactions_receiver_bank_id_fkey(*)")
      .eq("id", txId).single();
    if (!txRisk) throw new Error("TX not found for risk scoring");

    // ── NEW: Corridor history + sender velocity for behavioral analysis ──
    const senderBankIdRisk = txRisk.sender_bank_id;
    const receiverBankIdRisk = txRisk.receiver_bank_id;

    const { data: corridorHistory } = await supabase
      .from('transactions')
      .select('id, amount_display, purpose_code, risk_level, risk_score, status, created_at, sender_bank_id, receiver_bank_id')
      .or(`and(sender_bank_id.eq.${senderBankIdRisk},receiver_bank_id.eq.${receiverBankIdRisk}),and(sender_bank_id.eq.${receiverBankIdRisk},receiver_bank_id.eq.${senderBankIdRisk})`)
      .neq('id', txId)
      .order('created_at', { ascending: false })
      .limit(10);

    const { data: senderRecentTxns } = await supabase
      .from('transactions')
      .select('id, amount_display, receiver_bank_id, purpose_code, status, created_at')
      .eq('sender_bank_id', senderBankIdRisk)
      .neq('id', txId)
      .order('created_at', { ascending: false })
      .limit(10);

    const senderBankCodeR = (txRisk as any).sender_bank?.short_code || '?';
    const receiverBankCodeR = (txRisk as any).receiver_bank?.short_code || '?';

    const corridorContext = corridorHistory && corridorHistory.length > 0
      ? corridorHistory.map((t: any) => {
          const direction = t.sender_bank_id === senderBankIdRisk ? '→' : '←';
          const age = Math.round((Date.now() - new Date(t.created_at).getTime()) / (1000 * 60));
          return `  ${direction} $${Number(t.amount_display).toLocaleString()} | ${t.purpose_code} | risk:${t.risk_level}(${t.risk_score}) | ${t.status} | ${age}min ago`;
        }).join('\n')
      : '  No prior transactions between these counterparties.';

    const senderVelocityContext = senderRecentTxns && senderRecentTxns.length > 0
      ? senderRecentTxns.map((t: any) => {
          const age = Math.round((Date.now() - new Date(t.created_at).getTime()) / (1000 * 60));
          return `  $${Number(t.amount_display).toLocaleString()} → ${t.receiver_bank_id?.slice(0, 8)} | ${t.purpose_code} | ${t.status} | ${age}min ago`;
        }).join('\n')
      : '  No recent sender activity.';

    const senderTxnsLast60Min = (senderRecentTxns || []).filter((t: any) => {
      const age = Date.now() - new Date(t.created_at).getTime();
      return age < 60 * 60 * 1000;
    });
    const senderVolumeLast60Min = senderTxnsLast60Min.reduce((sum: number, t: any) => sum + Number(t.amount_display), 0);

    console.log(`[${aid}] |  Corridor history: ${corridorHistory?.length || 0} prior txns, Sender velocity: ${senderTxnsLast60Min.length} txns in last 60min ($${senderVolumeLast60Min.toLocaleString()})`);

    const riskPrompt = buildRiskScoringPrompt({
      networkModeContext: networkCtx,
      senderName: (txRisk as any).sender_bank?.name,
      senderCode: senderBankCodeR,
      senderTier: (txRisk as any).sender_bank?.tier,
      senderJurisdiction: (txRisk as any).sender_bank?.jurisdiction,
      receiverName: (txRisk as any).receiver_bank?.name,
      receiverCode: receiverBankCodeR,
      receiverTier: (txRisk as any).receiver_bank?.tier,
      receiverJurisdiction: (txRisk as any).receiver_bank?.jurisdiction,
      amountDisplay: txRisk.amount_display,
      purposeCode: txRisk.purpose_code,
      memo: txRisk.memo,
      compliancePassed: txRisk.compliance_passed,
      corridorContext,
      senderVelocityContext,
      senderTxnsLast60MinCount: senderTxnsLast60Min.length,
      senderVolumeLast60Min: senderVolumeLast60Min,
      corridorLength: corridorHistory?.length || 0,
      riskWeightCounterparty: pipelineConfig.risk_weight_counterparty,
      riskWeightJurisdiction: pipelineConfig.risk_weight_jurisdiction,
      riskWeightAssetType: pipelineConfig.risk_weight_asset_type,
      riskWeightBehavioral: pipelineConfig.risk_weight_behavioral,
    });
    const riskResult = await callGeminiJSON<{ counterparty_score: number; jurisdiction_score: number; asset_type_score: number; behavioral_score: number; composite_score: number; risk_level: string; finality_recommendation: string; reasoning: string; }>(FERMATA_SYSTEM_PROMPT, riskPrompt, { temperature: 0.3 });
    const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

    // Recalculate composite using bank's configured weights
    const configComposite = clamp(Math.round(
      riskResult.counterparty_score * pipelineConfig.risk_weight_counterparty +
      riskResult.jurisdiction_score * pipelineConfig.risk_weight_jurisdiction +
      riskResult.asset_type_score * pipelineConfig.risk_weight_asset_type +
      riskResult.behavioral_score * pipelineConfig.risk_weight_behavioral
    ));
    // Apply bank's finality thresholds
    let configFinality: string;
    if (configComposite <= pipelineConfig.risk_instant_ceiling) configFinality = "immediate";
    else if (configComposite <= pipelineConfig.risk_deferred_24h_ceiling) configFinality = "deferred_24h";
    else if (configComposite <= pipelineConfig.risk_deferred_72h_ceiling) configFinality = "deferred_72h";
    else configFinality = "manual_review";
    const configRiskLevel = configComposite <= pipelineConfig.risk_instant_ceiling ? "low" : configComposite <= pipelineConfig.risk_deferred_72h_ceiling ? "medium" : "high";

    const riskScore = { id: crypto.randomUUID(), transaction_id: txId, counterparty_score: clamp(riskResult.counterparty_score), jurisdiction_score: clamp(riskResult.jurisdiction_score), asset_type_score: clamp(riskResult.asset_type_score), behavioral_score: clamp(riskResult.behavioral_score), composite_score: configComposite, risk_level: configRiskLevel, finality_recommendation: configFinality, reasoning: riskResult.reasoning || "", created_at: new Date().toISOString() };
    console.log(`[${aid}] |  Risk: ${riskScore.risk_level} (${riskScore.composite_score}/100), finality=${riskScore.finality_recommendation} (gemini raw: ${riskResult.composite_score}, ${riskResult.finality_recommendation})`);
    await supabase.from("risk_scores").insert(riskScore);
    let lockupUntil: string | null = null;
    if (configFinality === "deferred_24h") lockupUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    else if (configFinality === "deferred_72h") lockupUntil = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    else if (configFinality === "manual_review") lockupUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from("transactions").update({ status: "risk_scored", risk_level: riskScore.risk_level, risk_score: riskScore.composite_score, risk_reasoning: riskScore.reasoning, risk_scored_at: new Date().toISOString(), lockup_until: lockupUntil }).eq("id", txId);
    console.log(`[${aid}] Step 2 result: ${(riskScore.risk_level as string).toUpperCase()} (${riskScore.composite_score}/100)`);

    // ── Risk assessment agent_message (detailed feed event) ──
    const riskSCodeR = senderBankCodeR;
    const riskRCodeR = receiverBankCodeR;
    const riskFinalityText = riskScore.finality_recommendation === "immediate" ? "Immediate finality approved." : `Finality deferred: ${riskScore.finality_recommendation}.`;
    await supabase.from("agent_messages").insert({
      id: crypto.randomUUID(), transaction_id: txId,
      from_bank_id: bankId, to_bank_id: (txRisk as any).sender_bank_id || bankId,
      message_type: "risk_alert",
      content: { agent_id: aid, risk_level: riskScore.risk_level, composite_score: riskScore.composite_score, counterparty_score: riskScore.counterparty_score, jurisdiction_score: riskScore.jurisdiction_score, asset_type_score: riskScore.asset_type_score, behavioral_score: riskScore.behavioral_score, finality: riskScore.finality_recommendation, reasoning: riskScore.reasoning, amount_display: txRisk.amount_display, corridor_depth: corridorHistory?.length || 0, sender_velocity_60min: senderTxnsLast60Min.length, sender_volume_60min: senderVolumeLast60Min },
      natural_language: `Fermata — Risk ${(riskScore.risk_level as string).toUpperCase()} (${riskScore.composite_score}/100) for ${riskSCodeR}→${riskRCodeR} $${txRisk.amount_display?.toLocaleString()}. Counterparty: ${riskScore.counterparty_score}/100, Jurisdiction: ${riskScore.jurisdiction_score}/100, Asset: ${riskScore.asset_type_score}/100, Behavioral: ${riskScore.behavioral_score}/100. ${riskFinalityText} ${(riskScore.reasoning || "").slice(0, 150)}`,
      processed: true, created_at: new Date().toISOString(),
    });

    // Step 3: Agent Decision (INLINE via coreAgentThink)
    console.log(`[${aid}] Step 3/4: Agent decision`);

    const agentInput = `An incoming payment request has been processed through compliance (PASSED) and risk scoring (level: ${riskScore.risk_level}, score: ${riskScore.composite_score}/100, recommendation: ${riskScore.finality_recommendation}).

Original request: ${msg.natural_language || JSON.stringify(msg.content)}

Risk reasoning: ${riskScore.reasoning || "N/A"}

Based on your bank's policies, should you ACCEPT or REJECT this payment?`;
    const thinkResult = await coreAgentThink(supabase, bankId, agentInput, txId, "risk_result");
    console.log(`[${aid}] Step 3 result: action=${thinkResult.action}`);

    // Attach structured evaluation text so the frontend can render a PaymentEvaluationCard
    // immediately (without waiting for a page reload to fetch agent_conversations from DB)
    thinkResult.evaluation_summary = agentInput;

    // ── Agent decision reasoning message (detailed feed event) ──
    // NOTE: handleAcceptPayment/handleRejectPayment (called inside coreAgentThink)
    // already emit payment_accept/payment_reject messages. This status_update provides
    // the detailed REASONING behind the decision — a separate feed entry.
    const decisionVerb = thinkResult.action === "accept_payment" ? "ACCEPT" : thinkResult.action === "reject_payment" ? "REJECT" : String(thinkResult.action).toUpperCase();
    const decisionSCode = (txRisk as any).sender_bank?.short_code || "?";
    const decisionRCode = (txRisk as any).receiver_bank?.short_code || "?";
    await supabase.from("agent_messages").insert({
      id: crypto.randomUUID(), transaction_id: txId,
      from_bank_id: bankId, to_bank_id: (txRisk as any).sender_bank_id || bankId,
      message_type: "status_update",
      content: { agent_id: aid, action: "agent_decision", decision: thinkResult.action, context: "pipeline_decision", reasoning: thinkResult.reasoning, risk_context: { level: riskScore.risk_level, score: riskScore.composite_score, finality: riskScore.finality_recommendation }, amount_display: txRisk.amount_display },
      natural_language: `Maestro — ${decisionRCode} agent reasoning: ${decisionVerb} payment from ${decisionSCode} ($${txRisk.amount_display?.toLocaleString()}). Risk: ${(riskScore.risk_level as string).toUpperCase()} (${riskScore.composite_score}/100). ${(thinkResult.reasoning || "").slice(0, 200)}`,
      processed: true, created_at: new Date().toISOString(),
    });

    // Step 4: Execute if accepted (INLINE)
    if (thinkResult.action === "accept_payment") {
      console.log(`[${aid}] Step 4/4: On-chain settlement`);
      const { data: txExec } = await supabase.from("transactions")
        .select("*, sender_bank:banks!transactions_sender_bank_id_fkey(*), receiver_bank:banks!transactions_receiver_bank_id_fkey(*)")
        .eq("id", txId).single();
      if (!txExec) throw new Error("TX not found for execution");
      const senderBank = (txExec as any).sender_bank;
      const receiverBank = (txExec as any).receiver_bank;

      if (["settled", "rejected", "reversed"].includes(txExec.status)) {
        console.log(`[${aid}] |  Already ${txExec.status} -- skip`);
      } else if (txExec.risk_level === "high" && txExec.status !== "executing") {
        console.log(`[${aid}] |  High risk -- manual review required`);
      } else {
        console.log(`[${aid}] |  ${senderBank?.short_code}->${receiverBank?.short_code}, amount=${txExec.amount}`);
        await supabase.from("transactions").update({ status: "executing" }).eq("id", txId);

        // ── Settlement initiation agent_message ──
        await supabase.from("agent_messages").insert({
          id: crypto.randomUUID(), transaction_id: txId,
          from_bank_id: txExec.receiver_bank_id, to_bank_id: txExec.sender_bank_id,
          message_type: "status_update",
          content: { agent_id: aid, action: "settlement_started", context: "settlement", sender: senderBank?.short_code, receiver: receiverBank?.short_code, amount_display: txExec.amount_display },
          natural_language: `Canto — Executing on-chain settlement: ${senderBank?.short_code}→${receiverBank?.short_code} $${txExec.amount_display?.toLocaleString()}...`,
          processed: true, created_at: new Date().toISOString(),
        });

        // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
        // Task 118: True Three-Token Lockup Settlement
        // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
        const rawLockupFieldOrch = txExec.lockup_duration_minutes ?? NETWORK_DEFAULTS.default_lockup_duration_minutes;
        // Convention: negative lockup_duration_minutes = user explicitly requested lockup (bypass risk gate)
        const userForcedLockupOrch = rawLockupFieldOrch < 0;
        const requestedLockupOrch = Math.abs(rawLockupFieldOrch);
        const txRiskScoreOrch = txExec.risk_score ?? 0;

        // Load sender's config-driven risk ceilings (replaces hardcoded >70/>30)
        const senderConfigOrch = await getBankConfig(txExec.sender_bank_id);
        const riskInstantCeilingOrch = senderConfigOrch.risk_instant_ceiling;
        const riskDeferred24hCeilingOrch = senderConfigOrch.risk_deferred_24h_ceiling;
        const riskDeferred72hCeilingOrch = senderConfigOrch.risk_deferred_72h_ceiling;

        let riskDerivedLockupOrch = 0;
        if (txRiskScoreOrch > riskDeferred72hCeilingOrch) riskDerivedLockupOrch = 4320;      // 72 hours
        else if (txRiskScoreOrch > riskDeferred24hCeilingOrch) riskDerivedLockupOrch = 1440;  // 24 hours

        // Risk-gated bifurcation:
        // - User-forced lockup (negative convention) → ALWAYS lockup, bypass risk gate
        // - Low risk → direct PvP, bypass requestedLockup
        // - Otherwise → max(requestedLockup, riskDerivedLockup)
        let effectiveLockupOrch: number;
        if (userForcedLockupOrch) {
          effectiveLockupOrch = requestedLockupOrch; // User override — bypass risk gate
          console.log(`[${aid}] USER-FORCED LOCKUP (orch): ${requestedLockupOrch}min (bypassing risk gate, riskScore=${txRiskScoreOrch})`);
        } else if (txRiskScoreOrch <= riskInstantCeilingOrch) {
          effectiveLockupOrch = 0; // Low risk -- direct PvP
        } else {
          effectiveLockupOrch = Math.max(requestedLockupOrch, riskDerivedLockupOrch);
        }
        const isLockupFlowOrch = effectiveLockupOrch > 0;
        console.log(`[settlement] Risk-gated bifurcation (orch): riskScore=${txRiskScoreOrch}, instantCeiling=${riskInstantCeilingOrch}, requested=${requestedLockupOrch}min, riskDerived=${riskDerivedLockupOrch}min, effective=${effectiveLockupOrch}min \u2192 ${isLockupFlowOrch ? 'LOCKUP' : 'PvP'}`);

        const pipelineSettlementAmt = txExec.amount_display != null
          ? Number(txExec.amount_display).toFixed(2)
          : (Number(BigInt(txExec.amount)) / Math.pow(10, TOKEN_DECIMALS)).toFixed(2);

        const rawAmount = BigInt(txExec.amount);
        const execNow = new Date().toISOString();
        let finalStatus: string;
        let lockupUntilOrch: string | null = null;
        let primarySignature: string = "";  // Set by whichever path executes
        let primarySlot: number = 0;

        if (isLockupFlowOrch) {
          // \u2550\u2550\u2550\u2550\u2550 TRUE LOCKUP PATH (Phase 1) \u2550\u2550\u2550\u2550\u2550
          // Burn sender tokens \u2192 Mint LOCKUP-USTB to BNY escrow \u2192 Fee #1
          // Receiver gets NOTHING until Phase 2 (hard finality).
          console.log(`[${aid}] |  LOCKUP PATH (Phase 1): ${effectiveLockupOrch}min lockup`);
          lockupUntilOrch = new Date(Date.now() + effectiveLockupOrch * 60 * 1000).toISOString();
          finalStatus = "locked";

          // Phase 1a: Burn sender's deposit tokens
          let burnResult;
          try {
            const burnMemo = buildISO20022LockupMemo({
              transactionId: txId, senderBank, receiverBank,
              amount: pipelineSettlementAmt, purposeCode: txExec.purpose_code || "settlement",
              remittanceInfo: txExec.memo || undefined,
              phase: "Phase 1 — Sender Burn", operation: "BURN",
            });
            burnResult = await burnDepositToken(
              senderBank.solana_wallet_keypair_encrypted,
              senderBank.token_mint_address,
              rawAmount,
              burnMemo,
            );
            console.log(`[${aid}] |  Phase 1a \u2713 Sender deposit burned: ${burnResult.signature.slice(0, 20)}...`);
          } catch (burnErr) {
            const errMsg = (burnErr as Error).message;
            console.log(`[${aid}] |  Phase 1a \u2717 Sender burn FAILED: ${errMsg}`);
            await supabase.from("transactions").update({ status: "risk_scored" }).eq("id", txId);
            console.log(`[${aid}] === PIPELINE FAILED at Phase 1a ===`);
            return { ...thinkResult, settlement: { error: errMsg } };
          }

          // Phase 1b: Mint LOCKUP-USTB to BNY custodian escrow
          let lockupMintResult;
          let lockupMintAddr: string;
          try {
            const { mintAddress } = await ensureLockupMint();
            lockupMintAddr = mintAddress;
            const { keypairEncrypted: custodianKpEnc, walletAddress: custodianWallet } = await getCustodianKeypair();
            const escrowMemo = buildISO20022LockupMemo({
              transactionId: txId, senderBank, receiverBank,
              amount: pipelineSettlementAmt, purposeCode: txExec.purpose_code || "settlement",
              remittanceInfo: txExec.memo || undefined,
              phase: "Phase 1 — Escrow Mint", operation: "ESCROW_MINT",
            });
            lockupMintResult = await mintLockupToEscrow(
              custodianKpEnc,
              lockupMintAddr,
              rawAmount,
              escrowMemo,
            );
            console.log(`[${aid}] |  Phase 1b \u2713 LOCKUP-USTB minted to escrow: ${lockupMintResult.signature.slice(0, 20)}...`);

            // Insert lockup_tokens record
            const lockupId = crypto.randomUUID();
            await supabase.from("lockup_tokens").insert({
              id: lockupId,
              transaction_id: txId,
              sender_bank_id: txExec.sender_bank_id,
              receiver_bank_id: txExec.receiver_bank_id,
              yb_token_mint: lockupMintAddr,
              yb_token_symbol: LOCKUP_TOKEN_SYMBOL,
              yb_token_amount: rawAmount.toString(),
              yb_holder: custodianWallet,
              tb_token_mint: null,
              tb_token_symbol: null,
              tb_token_amount: null,
              tb_holder: null,
              yield_rate_bps: 525,
              yield_accrued: "0",
              yield_last_calculated: execNow,
              lockup_start: execNow,
              lockup_end: lockupUntilOrch,
              status: "active",
              created_at: execNow,
            });
            console.log(`[${aid}] |  Phase 1c \u2713 lockup_tokens record: ${lockupId.slice(0, 8)}... (${effectiveLockupOrch}min)`);
          } catch (escrowErr) {
            const errMsg = (escrowErr as Error).message;
            console.log(`[${aid}] |  Phase 1b \u2717 Escrow mint FAILED: ${errMsg}. SENDER TOKENS BURNED \u2014 manual recovery needed.`);
            await supabase.from("transactions").update({ status: "risk_scored", lockup_status: null }).eq("id", txId);
            return { ...thinkResult, settlement: { error: `Escrow mint failed after sender burn: ${errMsg}` } };
          }

          primarySignature = burnResult.signature;
          primarySlot = burnResult.slot;

          // Update sender wallet balance (tokens were burned)
          try {
            const senderBal = await getTokenBalance(senderBank.solana_wallet_pubkey, senderBank.token_mint_address);
            await supabase.from("wallets").update({ balance_tokens: Number(senderBal) }).eq("bank_id", txExec.sender_bank_id).eq("is_default", true);
            console.log(`[${aid}] |  Sender balance: ${Number(senderBal)} (${senderBank.short_code})`);
          } catch (balErr) { console.log(`[${aid}] |  Balance read warning: ${(balErr as Error).message}`); }

          // Update transaction status
          const txUpdatePayload = {
            status: "locked",
            settlement_type: "lockup",
            settlement_method: userForcedLockupOrch ? "lockup_user_requested" : "lockup_three_token",
            lockup_status: "active",
            is_reversible: true,
            lockup_until: lockupUntilOrch,
            lockup_duration_minutes: effectiveLockupOrch, // Normalize negative convention → positive actual minutes
            solana_tx_signature: burnResult.signature,
            solana_slot: burnResult.slot,
            solana_block_time: execNow,
            settled_at: null,
          };
          const { error: txUpdateErr } = await supabase.from("transactions").update(txUpdatePayload).eq("id", txId);
          if (txUpdateErr) {
            console.log(`[${aid}] |  TX status update failed: ${JSON.stringify(txUpdateErr)} \u2014 retrying`);
            await supabase.from("transactions").update({
              status: "locked", settlement_type: "lockup", lockup_status: "active",
              is_reversible: true, lockup_until: lockupUntilOrch,
              lockup_duration_minutes: effectiveLockupOrch,
              solana_tx_signature: burnResult.signature,
            }).eq("id", txId);
          }
          console.log(`[${aid}] |  TX status \u2192 locked (Phase 1 complete)`);

          // Phase 1 network fee
          try {
            const lockupFeeMemo = [
              `CODA Solstice | Lockup Phase 1 (Escrow)`,
              `TxId:    ${txId}`, `Amount:  ${pipelineSettlementAmt} USD`,
              `From:    ${resolveBic(senderBank)} (${senderBank.name})`,
              `To:      ${resolveBic(receiverBank)} (${receiverBank.name})`,
              `Burn:    ${burnResult.signature.slice(0, 16)}...`,
              `Escrow:  ${lockupMintResult.signature.slice(0, 16)}...`,
              `Lockup:  ${effectiveLockupOrch}min`,
              `Fee:     ${NETWORK_DEFAULTS.network_fee_sol} SOL \u2192 SOLSTICE_FEES (Phase 1 of 2)`,
            ].join("\n");
            const feeRes = await collectNetworkFee(senderBank.solana_wallet_keypair_encrypted, txId, "lockup_three_token", lockupFeeMemo, `[${aid}]`);
            if (feeRes.feeSig) console.log(`[${aid}] |  Phase 1 fee: ${feeRes.feeSol} SOL \u2014 sig: ${feeRes.feeSig.slice(0, 20)}...`);
          } catch (feeErr) { console.log(`[${aid}] |  Phase 1 fee warning: ${(feeErr as Error).message}`); }

        } else {
          // \u2550\u2550\u2550\u2550\u2550 PvP PATH (unchanged) \u2550\u2550\u2550\u2550\u2550
          console.log(`[${aid}] |  PvP PATH: atomic burn-and-mint, no lockup`);
          finalStatus = "settled";

          let transferResult;
          try {
            transferResult = await executeTransfer(
              senderBank.solana_wallet_keypair_encrypted,
              senderBank.token_mint_address,
              receiverBank.solana_wallet_keypair_encrypted,
              receiverBank.token_mint_address,
              rawAmount,
              txExec.purpose_code || "settlement",
              txId,
              {
                senderBic: resolveBic(senderBank),
                senderName: senderBank.name,
                receiverBic: resolveBic(receiverBank),
                receiverName: receiverBank.name,
                settlementAmount: pipelineSettlementAmt,
                currency: "USD",
                remittanceInfo: txExec.memo || undefined,
              },
            );
            console.log(`[${aid}] |  PvP Transfer OK: ${transferResult.signature.slice(0, 20)}... slot=${transferResult.slot}`);
            primarySignature = transferResult.signature;
            primarySlot = transferResult.slot;
          } catch (solanaErr) {
            const errMsg = solanaErr instanceof Error ? solanaErr.message : String(solanaErr);
            console.log(`[${aid}] |  PvP Transfer FAILED: ${errMsg}`);
            await supabase.from("transactions").update({ status: "risk_scored" }).eq("id", txId);
            console.log(`[${aid}] === PIPELINE FAILED at Step 4 ===`);
            return { ...thinkResult, settlement: { error: errMsg } };
          }

          // Update wallet balances
          try {
            const senderBal = await getTokenBalance(senderBank.solana_wallet_pubkey, senderBank.token_mint_address);
            await supabase.from("wallets").update({ balance_tokens: Number(senderBal) }).eq("bank_id", txExec.sender_bank_id).eq("is_default", true);
            const receiverBal = await getTokenBalance(receiverBank.solana_wallet_pubkey, receiverBank.token_mint_address);
            await supabase.from("wallets").update({ balance_tokens: Number(receiverBal) }).eq("bank_id", txExec.receiver_bank_id).eq("is_default", true);
          } catch (balErr) { console.log(`[${aid}] |  Balance read warning: ${(balErr as Error).message}`); }

          const txUpdatePayload = {
            status: "settled",
            settlement_type: "PvP",
            settlement_method: "pvp_burn_mint",
            lockup_status: null,
            is_reversible: false,
            solana_tx_signature: transferResult.signature,
            solana_slot: transferResult.slot,
            solana_block_time: transferResult.blockTime ? new Date(transferResult.blockTime * 1000).toISOString() : execNow,
            settled_at: execNow,
          };
          const { error: txUpdateErr } = await supabase.from("transactions").update(txUpdatePayload).eq("id", txId);
          if (txUpdateErr) {
            console.log(`[${aid}] |  TX update failed: ${JSON.stringify(txUpdateErr)} \u2014 retrying`);
            await supabase.from("transactions").update({
              status: "settled", settlement_type: "PvP", settled_at: execNow,
              solana_tx_signature: transferResult.signature,
            }).eq("id", txId);
          }

          // PvP network fee
          try {
            const pvpFeeMemo = [
              `CODA Solstice | PvP Burn-Mint Settlement`,
              `TxId:    ${txId}`, `Amount:  ${pipelineSettlementAmt} USD`,
              `From:    ${resolveBic(senderBank)} (${senderBank.name})`,
              `To:      ${resolveBic(receiverBank)} (${receiverBank.name})`,
              `Fee:     ${NETWORK_DEFAULTS.network_fee_sol} SOL \u2192 SOLSTICE_FEES`,
            ].join("\n");
            const feeRes = await collectNetworkFee(senderBank.solana_wallet_keypair_encrypted, txId, "pvp_burn_mint", pvpFeeMemo, `[${aid}]`);
            if (feeRes.feeSig) console.log(`[${aid}] |  Network fee: ${feeRes.feeSol} SOL \u2014 sig: ${feeRes.feeSig.slice(0, 20)}...`);
          } catch (feeErr) { console.log(`[${aid}] |  Network fee warning: ${(feeErr as Error).message}`); }
        }

        await supabase.from("agent_messages").insert({
          id: crypto.randomUUID(), transaction_id: txId,
          from_bank_id: txExec.receiver_bank_id, to_bank_id: txExec.sender_bank_id,
          message_type: "settlement_confirm",
          content: { agent_id: aid, action: finalStatus, tx_signature: primarySignature, amount: txExec.amount, amount_display: txExec.amount_display, locked_until: lockupUntilOrch, settlement_type: isLockupFlowOrch ? "lockup_escrow" : "PvP", phase: isLockupFlowOrch ? 1 : undefined },
          natural_language: isLockupFlowOrch
            ? `Maestro \u2014 Phase 1 escrow complete. $${txExec.amount_display?.toLocaleString()} LOCKUP-USTB minted to BNY escrow. Receiver has NO tokens. Lockup: ${effectiveLockupOrch}min until ${lockupUntilOrch}. Phase 2 (finality) triggers at expiry.`
            : `Maestro \u2014 Settlement confirmed on Solana Devnet. Tx: ${primarySignature.slice(0, 16)}... Amount: $${txExec.amount_display?.toLocaleString()} transferred.`,
          processed: false, created_at: execNow,
        });

        const settlementConfirmMsg = isLockupFlowOrch
          ? `Phase 1 escrow complete. ${senderBank?.short_code} \u2192 ${receiverBank?.short_code} $${txExec.amount_display?.toLocaleString()}.\\n\\nSender burn sig: ${primarySignature}\\nLockup: ${effectiveLockupOrch}min\\nPhase 2 at: ${lockupUntilOrch}\\nReceiver gets tokens at Phase 2.`
          : `Settlement confirmed. ${senderBank?.short_code} \u2192 ${receiverBank?.short_code} $${txExec.amount_display?.toLocaleString()} settled on Solana Devnet.\\n\\nSignature: ${primarySignature}\\nSlot: ${primarySlot}`;
        await supabase.from("agent_conversations").insert({
          id: crypto.randomUUID(), bank_id: bankId,
          transaction_id: txId, role: "model",
          content: settlementConfirmMsg,
          created_at: new Date(Date.now() + 200).toISOString(),
        });

        console.log(`[${aid}] Step 4 result: ${finalStatus} sig=${primarySignature.slice(0, 20)}...`);
        console.log(`[${aid}] === PIPELINE COMPLETE: ${finalStatus.toUpperCase()} ===`);
        const settlement = { transaction_id: txId, status: finalStatus, solana_tx_signature: primarySignature, solana_slot: primarySlot, sender_code: senderBank?.short_code, receiver_code: receiverBank?.short_code, amount_display: txExec.amount_display, settlement_type: isLockupFlowOrch ? "lockup_escrow" : "PvP", lockup_until: lockupUntilOrch };
        return { ...thinkResult, settlement, settlement_message: settlementConfirmMsg };
      }
    }

    console.log(`[${aid}] === PIPELINE COMPLETE: ${thinkResult.action} ===`);
    return thinkResult;
  } catch (err) {
    console.log(`[${aid}] === PIPELINE FAILED: ${(err as Error).message} ===`);
    console.log(`[${aid}] Stack: ${(err as Error).stack}`);
    return { reasoning: `Orchestration error: ${(err as Error).message}`, action: "no_action", params: {},
      message_to_counterparty: null, message_to_user: `Error processing payment: ${(err as Error).message}`,
      transaction_id: txId, error: (err as Error).message };
  }
}

// ============================================================
// Treasury Heartbeat — Helper: Generate narrative detail
// ============================================================
function generateNarrativeDetail(bankCode: string, bankEvent: {
  inflow: number; outflow: number; repo_maturing: number;
  corridor_window_open: boolean; liquidity_stress: boolean;
}): string {
  const parts: string[] = [];
  if (bankEvent.inflow > 0) parts.push(`+$${(bankEvent.inflow / 1e6).toLocaleString()} inflow`);
  if (bankEvent.outflow > 0) parts.push(`-$${(bankEvent.outflow / 1e6).toLocaleString()} outflow`);
  if (bankEvent.repo_maturing > 0) parts.push(`$${(bankEvent.repo_maturing / 1e6).toLocaleString()} repo maturing`);
  if (bankEvent.corridor_window_open) parts.push('corridor window open');
  if (bankEvent.liquidity_stress) parts.push('LIQUIDITY STRESS');
  return `${bankCode}: ${parts.join(', ') || 'normal operations'}`;
}

// ============================================================
// Treasury Heartbeat — Helper: Generate market event
// ============================================================
function generateMarketEvent(cycleNumber: number, banks: any[]): {
  cycle_number: number; event_type: string; cycle_narrative: string;
  per_bank_events: Record<string, any>; timestamp: string;
} {
  // Weighted event selection
  const rand = Math.random();
  let eventType: string;
  let cycleNarrative: string;
  if (rand < 0.50)      { eventType = 'normal_ops';       cycleNarrative = 'Standard operating cycle'; }
  else if (rand < 0.65) { eventType = 'deposit_surge';    cycleNarrative = 'Customer deposit surge detected'; }
  else if (rand < 0.75) { eventType = 'liquidity_squeeze'; cycleNarrative = 'Interbank liquidity tightening'; }
  else if (rand < 0.90) { eventType = 'repo_maturity';    cycleNarrative = 'Overnight repo positions maturing'; }
  else                  { eventType = 'corridor_window';  cycleNarrative = 'Community bank corridor allocation window'; }

  // 30% chance of bank-specific event when 2+ active banks — creates natural asymmetry
  if (banks.length >= 2 && Math.random() < 0.30) {
    const targetBank = banks[Math.floor(Math.random() * banks.length)];
    const bankSpecificTemplates = [
      `Large deposit inflow reported at ${targetBank.name}`,
      `${targetBank.name} facing elevated withdrawal requests from retail depositors`,
      `Regulatory review initiated for ${targetBank.name} — temporary reserve requirement increase`,
      `${targetBank.name} received large incoming wire transfer — excess liquidity available`,
      `Credit downgrade watch for ${targetBank.name} counterparty — review exposure limits`,
      `${targetBank.name} approaching quarter-end — increased settlement activity expected`,
    ];
    eventType = 'bank_specific';
    cycleNarrative = bankSpecificTemplates[Math.floor(Math.random() * bankSpecificTemplates.length)];
  }

  const perBankEvents: Record<string, any> = {};

  for (const bank of banks) {
    const code = bank.short_code as string;
    const wallet = bank.wallets?.[0];
    const currentBalance: number = (wallet?.balance_tokens ?? 0) / 1e6; // raw tokens → human units
    const initialSupply: number = bank.initial_deposit_supply || 10_000_000;
    const deployedPct = initialSupply > 0 ? Math.max(0, ((initialSupply - currentBalance) / initialSupply) * 100) : 0;

    // Scale random flows relative to bank size (0-2% of supply)
    const flowScale = initialSupply * 0.02;
    let inflow  = Math.floor(Math.random() * flowScale);
    let outflow = Math.floor(Math.random() * flowScale * 0.5);
    let repoMaturing = 0;
    let corridorWindowOpen = false;
    let liquidityStress = false;

    // Event-type modifications (dynamic — no hardcoded bank codes)
    if (eventType === 'deposit_surge' && deployedPct > 30) {
      // Larger / more-deployed banks get bigger deposit surges
      inflow += Math.floor((0.01 + Math.random() * 0.03) * initialSupply);
    }
    if (eventType === 'liquidity_squeeze') {
      outflow += Math.floor((0.005 + Math.random() * 0.015) * initialSupply);
      liquidityStress = true;
    }
    if (eventType === 'repo_maturity') {
      // Scale repo maturing to bank size — bigger banks have bigger repo books
      const repoScale = initialSupply > 5_000_000 ? 0.02 : 0.01;
      repoMaturing = Math.floor((repoScale + Math.random() * repoScale) * initialSupply);
    }
    if (eventType === 'corridor_window') {
      corridorWindowOpen = true;
    }

    const netPositionChange = inflow - outflow;

    perBankEvents[code] = {
      inflow, outflow,
      net_position_change: netPositionChange,
      current_balance: currentBalance,
      initial_supply: initialSupply,
      deployed_pct: Math.round(deployedPct * 100) / 100,
      repo_maturing: repoMaturing,
      corridor_window_open: corridorWindowOpen,
      liquidity_stress: liquidityStress,
      narrative: generateNarrativeDetail(code, {
        inflow, outflow, repo_maturing: repoMaturing,
        corridor_window_open: corridorWindowOpen, liquidity_stress: liquidityStress,
      }),
    };
  }

  return {
    cycle_number: cycleNumber,
    event_type: eventType,
    cycle_narrative: cycleNarrative,
    per_bank_events: perBankEvents,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================
// Treasury Heartbeat — Helper: Capture network snapshot
// ============================================================
async function captureNetworkSnapshot(supabase: any): Promise<void> {
  try {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: recentTxns } = await supabase
      .from("transactions")
      .select("amount_display, amount, status, risk_score")
      .gte("created_at", fiveMinAgo);

    const txns = recentTxns || [];
    const count = txns.length;
    const settled = txns.filter((t: any) => t.status === 'settled');
    const settledVolume = settled.reduce((s: number, t: any) => s + (t.amount_display || t.amount / 1e6), 0);
    const riskScores = txns.filter((t: any) => t.risk_score != null).map((t: any) => t.risk_score as number);
    const avgRisk = riskScores.length > 0 ? riskScores.reduce((a: number, b: number) => a + b, 0) / riskScores.length : 0;

    await supabase.from("network_snapshots").insert({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      metrics: {
        tps: count / 300,
        volume_5min: settledVolume,
        count_5min: count,
        settled_5min: settled.length,
        avg_risk: Math.round(avgRisk * 10) / 10,
      },
    });
    console.log(`[snapshot] Captured: ${count} txns, ${settled.length} settled, $${settledVolume.toLocaleString()} volume`);
  } catch (err) {
    console.log(`[snapshot] Non-critical error: ${(err as Error).message}`);
  }
}

// ============================================================
// Treasury Heartbeat — Gemini-driven mandate generation
// ============================================================

async function generateMandatesViaGemini(bank: any, allBanks: any[]): Promise<any[]> {
  const otherBanks = allBanks.filter((b: any) => b.id !== bank.id);
  const networkCtxMandates = await getNetworkModeContext();

  const prompt = buildMandateGenerationPrompt(networkCtxMandates, bank, otherBanks);

  const supply = bank.initial_deposit_supply || 10_000_000;
  const maxTransfer = Math.floor(supply * 0.2);

  try {
    console.log(`[generateMandatesViaGemini] Generating mandates for ${bank.short_code} (supply=${supply})...`);

    const result = await callGeminiJSON<{ mandates: any[] }>(
      MANDATE_GENERATION_SYSTEM_PROMPT,
      prompt,
      { temperature: 0.7, maxTokens: 2048 },
    );

    const mandates = Array.isArray(result?.mandates) ? result.mandates : [];
    if (mandates.length === 0) {
      console.log(`[generateMandatesViaGemini] ${bank.short_code}: Gemini returned 0 mandates, using fallback`);
      return fallbackMandates(bank);
    }

    // Validate and clamp each mandate
    const validTypes = new Set(['liquidity_rebalance', 'repo_settlement', 'corridor_allocation', 'treasury_sweep', 'collateral_call']);
    const validFreqs = new Set(['every_cycle', 'every_other_cycle', 'conditional']);

    const validated = mandates.slice(0, 4).map((m: any, idx: number) => {
      const params = m.parameters || {};

      // Clamp min_transfer_amount
      let minAmt = Number(params.min_transfer_amount) || 50000;
      if (minAmt < 50000) minAmt = 50000;

      // Clamp max_transfer_amount
      let maxAmt = Number(params.max_transfer_amount) || maxTransfer;
      if (maxAmt > maxTransfer) maxAmt = maxTransfer;
      if (maxAmt < minAmt) maxAmt = minAmt; // Ensure max >= min

      return {
        mandate_type: validTypes.has(m.mandate_type) ? m.mandate_type : 'liquidity_rebalance',
        priority: idx + 1,
        description: typeof m.description === 'string' ? m.description : `Treasury mandate ${idx + 1}`,
        parameters: {
          ...params,
          min_transfer_amount: minAmt,
          max_transfer_amount: maxAmt,
          frequency: validFreqs.has(params.frequency) ? params.frequency : 'every_cycle',
        },
      };
    });

    console.log(`[generateMandatesViaGemini] ${bank.short_code}: generated ${validated.length} mandates via Gemini`);
    return validated;
  } catch (err) {
    console.log(`[generateMandatesViaGemini] ${bank.short_code}: Gemini error, using fallback — ${(err as Error).message}`);
    return fallbackMandates(bank);
  }
}

// Deterministic fallback if Gemini is unavailable
function fallbackMandates(bank: any): any[] {
  const supply = bank.initial_deposit_supply || 10_000_000;
  const maxAmt = Math.floor(supply * 0.2);
  const minAmt = Math.max(50000, Math.floor(supply * 0.005));

  return [
    {
      mandate_type: 'liquidity_rebalance',
      priority: 1,
      description: `Rebalance excess liquidity for ${bank.short_code} based on target deployment ratio`,
      parameters: {
        min_transfer_amount: minAmt,
        max_transfer_amount: maxAmt,
        target_balance_pct: 0.65,
        frequency: 'every_cycle',
        condition: 'balance_above_target',
      },
    },
  ];
}

// ============================================================
// 10. SEED-MANDATES — Seed treasury mandates for all active banks
//     Always regenerates ALL mandates so Gemini sees current
//     network composition. Existing mandates are deleted first.
// ============================================================
app.post("/make-server-49d15288/seed-mandates", async (c) => {
  try {
    const supabase = getAdminClient();
    console.log("[seed-mandates] Starting mandate seeding (full regeneration)...");

    // Load all active banks
    const { data: banks, error: banksErr } = await supabase
      .from("banks").select("*").eq("status", "active");
    if (banksErr) return c.json({ error: `Failed to load banks: ${banksErr.message}` }, 500);
    if (!banks || banks.length === 0) return c.json({ error: "No active banks found" }, 400);

    console.log(`[seed-mandates] Found ${banks.length} active banks: ${banks.map((b: any) => b.short_code).join(', ')}`);

    let totalMandates = 0;
    const results: { bank: string; status: string; mandates_seeded: number }[] = [];

    for (let i = 0; i < banks.length; i++) {
      const bank = banks[i];
      const code = bank.short_code as string;

      try {
        // Delete existing mandates for this bank (makes re-seeding idempotent)
        const { error: delErr } = await supabase
          .from("treasury_mandates").delete().eq("bank_id", bank.id);
        if (delErr) {
          console.log(`[seed-mandates] ${code}: failed to delete existing mandates — ${delErr.message}`);
        }

        // Generate mandates via Gemini
        const mandates = await generateMandatesViaGemini(bank, banks);
        console.log(`[seed-mandates] ${code}: ${mandates.length} mandates generated`);

        // Insert mandates
        const rows = mandates.map((m: any) => ({
          id: crypto.randomUUID(),
          bank_id: bank.id,
          mandate_type: m.mandate_type,
          description: m.description,
          parameters: m.parameters,
          priority: m.priority,
          is_active: true,
          created_at: new Date().toISOString(),
        }));

        const { error: insertErr } = await supabase.from("treasury_mandates").insert(rows);
        if (insertErr) {
          console.log(`[seed-mandates] ${code}: insert error — ${insertErr.message}`);
          results.push({ bank: code, status: `error: ${insertErr.message}`, mandates_seeded: 0 });
        } else {
          console.log(`[seed-mandates] ${code}: seeded ${rows.length} mandates`);
          totalMandates += rows.length;
          results.push({ bank: code, status: 'seeded', mandates_seeded: rows.length });
        }
      } catch (bankErr) {
        console.log(`[seed-mandates] ${code}: generation failed — ${(bankErr as Error).message}`);
        results.push({ bank: code, status: `error: ${(bankErr as Error).message}`, mandates_seeded: 0 });
      }

      // Rate-limit delay between banks (skip after last bank)
      if (i < banks.length - 1) {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }

    console.log(`[seed-mandates] Complete: seeded=${banks.length}, total_mandates=${totalMandates} | ${results.map(r => `${r.bank}=${r.mandates_seeded}`).join(', ')}`);
    return c.json({ seeded: banks.length, total_mandates: totalMandates, results, timestamp: new Date().toISOString() });
  } catch (err) {
    console.log(`[seed-mandates] Error: ${(err as Error).message}`);
    return c.json({ error: `Seed mandates error: ${(err as Error).message}` }, 500);
  }
});

// ============================================================
// 11. TREASURY-CYCLE — Core heartbeat engine
// ============================================================
// Extracted as standalone function so network-heartbeat can call
// directly (no HTTP self-call — matches coreOrchestrate pattern)
async function coreTreasuryCycle(cycleNumber: number): Promise<any> {
  const supabase = getAdminClient();
  console.log(`[treasury-cycle] CYCLE ${cycleNumber} START`);

  // Load banks first so we can generate market event before inserting cycle record
  const { data: banks, error: banksErr } = await supabase
    .from("banks")
    .select("*, wallets!inner(balance_tokens, balance_lamports, token_account_address, solana_pubkey)")
    .eq("status", "active");

  if (banksErr || !banks || banks.length === 0) {
    throw new Error(`No active banks: ${banksErr?.message || "none found"}`);
  }

  // Generate market event BEFORE inserting cycle (market_event column is NOT NULL)
  const marketEvent = generateMarketEvent(cycleNumber, banks);
  console.log(`[treasury-cycle] ${banks.length} banks, event: ${marketEvent.event_type}`);

  const cycleId = crypto.randomUUID();
  const { error: cycleErr } = await supabase.from("heartbeat_cycles").insert({
    id: cycleId,
    cycle_number: cycleNumber,
    status: "running",
    banks_evaluated: 0,
    transactions_initiated: 0,
    market_event: marketEvent,
    started_at: new Date().toISOString(),
  });
  if (cycleErr) {
    throw new Error(`Failed to create cycle: ${cycleErr.message}`);
  }

  let totalBanksEvaluated = 0;
  let totalTransactions = 0;
  const bankResults: { bank: string; action: string; amount?: number; receiver?: string; error?: string }[] = [];

  // ── SEQUENTIAL MANDATE EVALUATION ──────────────────────────────
  // Banks evaluated one at a time to stay within Supabase Edge
  // Function CPU-time limits.  Previous parallel (Promise.allSettled)
  // approach caused "CPU Time exceeded" because all Gemini responses
  // arrived in the same tick and the result processing burst exceeded
  // the limit.  Sequential evaluation spreads CPU across I/O pauses.
  // ──────────────────────────────────────────────────────────────
  console.log(`[treasury-cycle] Evaluating ${banks.length} banks sequentially...`);

  for (let i = 0; i < banks.length; i++) {
    const bank = banks[i] as any;
    const code = bank.short_code as string;
    totalBanksEvaluated++;

    try {
      const bankEvent = marketEvent.per_bank_events[code] || {};

      // Check heartbeat participation config
      const bankCfg = await getBankConfig(bank.id);
      if (!bankCfg.heartbeat_participation) {
        bankResults.push({ bank: code, action: "opted_out" });
        continue;
      }

      const { data: mandates } = await supabase
        .from("treasury_mandates")
        .select("*")
        .eq("bank_id", bank.id)
        .eq("is_active", true)
        .order("priority", { ascending: true });

      if (!mandates || mandates.length === 0) {
        bankResults.push({ bank: code, action: "no_mandates" });
        continue;
      }

      const wallet = bank.wallets?.[0];
      const currentBalance: number = (wallet?.balance_tokens ?? 0) / 1e6;
      const initialSupply: number = bank.initial_deposit_supply || 10_000_000;
      const deployedPct = initialSupply > 0 ? Math.max(0, ((initialSupply - currentBalance) / initialSupply) * 100) : 0;

      const { data: recentTxns } = await supabase
        .from("transactions")
        .select("*")
        .or(`sender_bank_id.eq.${bank.id},receiver_bank_id.eq.${bank.id}`)
        .order("created_at", { ascending: false })
        .limit(10);

      const { data: otherBanks } = await supabase
        .from("banks")
        .select("*, wallets(balance_tokens, balance_lamports)")
        .neq("id", bank.id)
        .eq("status", "active");

      const enrichedBankEvent = { ...bankEvent, lockup_duration_minutes: bankCfg.default_lockup_duration_minutes };
      const treasuryPrompt = buildTreasuryCyclePrompt(
        cycleNumber, bank, mandates, enrichedBankEvent,
        currentBalance, initialSupply, deployedPct,
        recentTxns || [], otherBanks || [],
        marketEvent.cycle_narrative
      );

      const result = await coreAgentThink(supabase, bank.id, treasuryPrompt, null, "treasury_cycle");
      console.log(`[treasury-cycle] ${code}: action=${result.action}`);

      if (result.action === "initiate_payment" || result.action === "INITIATE_PAYMENT") {
        const proposedAmount = parseNumericAmount(result.params?.amount) * 1e6;
        const safetyFloor = initialSupply * bankCfg.balance_safety_floor_pct;
        if (currentBalance - proposedAmount < safetyFloor) {
          bankResults.push({ bank: code, action: "blocked_safety_floor", amount: proposedAmount / 1e6 });
        } else {
          totalTransactions++;
          bankResults.push({ bank: code, action: "initiate_payment", amount: proposedAmount / 1e6, receiver: result.params?.receiver_bank_code as string });
        }
      } else {
        bankResults.push({ bank: code, action: result.action || "NO_ACTION" });
      }
    } catch (bankErr) {
      const errMsg = (bankErr as Error).message || String(bankErr);
      console.error(`[treasury-cycle] ${code}: FAILED -- ${errMsg}`);
      bankResults.push({ bank: code, action: "error", error: errMsg });
    }
  }

  const completedAt = new Date().toISOString();
  await supabase.from("heartbeat_cycles").update({
    status: "completed",
    banks_evaluated: totalBanksEvaluated,
    transactions_initiated: totalTransactions,
    market_event: marketEvent,
    completed_at: completedAt,
  }).eq("id", cycleId);

  await captureNetworkSnapshot(supabase);

  // ── Trailing step: yield accrual on active lockups ──
  let yieldAccrualResult = null;
  try {
    yieldAccrualResult = await coreYieldAccrue();
    if (yieldAccrualResult.lockups_processed > 0) {
      console.log(`[treasury-cycle] Yield accrual: ${yieldAccrualResult.lockups_processed} lockups, +${yieldAccrualResult.total_yield_this_cycle} this cycle`);
    }
  } catch (yieldErr) {
    console.log(`[treasury-cycle] ⚠ Yield accrual failed (non-blocking): ${(yieldErr as Error).message}`);
  }

  // NOTE: Cadenza periodic scan removed from treasury cycle to stay within
  // Supabase Edge Function CPU-time limits.  Each lockup scan triggers a
  // Gemini call, and combined with the per-bank evaluation calls above,
  // the cumulative CPU processing exceeded the limit.  Cadenza scan is
  // still available as a standalone endpoint via /cadenza-monitor
  // { action: 'periodic_scan' } and can be triggered separately.
  const cadenzaScanResult = null;

  console.log(`[treasury-cycle] CYCLE ${cycleNumber} DONE — ${totalBanksEvaluated} banks, ${totalTransactions} txns`);

  return {
    status: "completed",
    cycle_id: cycleId,
    cycle_number: cycleNumber,
    banks_evaluated: totalBanksEvaluated,
    transactions_initiated: totalTransactions,
    market_event: marketEvent,
    bank_results: bankResults,
    yield_accrual: yieldAccrualResult,
    cadenza_scan: cadenzaScanResult,
    timestamp: completedAt,
  };
}

app.post("/make-server-49d15288/treasury-cycle", async (c) => {
  try {
    const body = await c.req.json();
    const { cycle_number } = body;
    if (!cycle_number) return c.json({ error: "Missing required field: cycle_number" }, 400);
    const result = await coreTreasuryCycle(cycle_number);
    return c.json(result);
  } catch (err) {
    console.log(`[treasury-cycle] Fatal error: ${(err as Error).message}`);
    return c.json({ error: `Treasury cycle error: ${(err as Error).message}` }, 500);
  }
});

// ============================================================
// 12. NETWORK-HEARTBEAT — Convenience wrapper for frontend
// ============================================================
app.post("/make-server-49d15288/network-heartbeat", async (c) => {
  try {
    const body = await c.req.json();
    const { action } = body;
    const supabase = getAdminClient();

    if (action === "status") {
      const { data: lastCycle } = await supabase
        .from("heartbeat_cycles")
        .select("*")
        .order("cycle_number", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { count: bankCount } = await supabase
        .from("banks").select("id", { count: "exact", head: true }).eq("status", "active");

      const { count: mandateCount } = await supabase
        .from("treasury_mandates").select("id", { count: "exact", head: true }).eq("is_active", true);

      return c.json({
        last_cycle: lastCycle || null,
        active_banks: bankCount || 0,
        active_mandates: mandateCount || 0,
        timestamp: new Date().toISOString(),
      });
    }

    if (action === "next_cycle") {
      const { data: lastCycle } = await supabase
        .from("heartbeat_cycles")
        .select("cycle_number")
        .order("cycle_number", { ascending: false })
        .limit(1)
        .maybeSingle();

      const nextCycleNumber = (lastCycle?.cycle_number || 0) + 1;
      console.log(`[network-heartbeat] Triggering cycle ${nextCycleNumber}`);

      // Direct function call (no HTTP self-call -- matches coreOrchestrate pattern)
      const result = await coreTreasuryCycle(nextCycleNumber);
      return c.json(result);
    }

    if (action === "reset_cycles") {
      console.log("[network-heartbeat] Resetting cycles and snapshots...");
      await supabase.from("network_snapshots").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("heartbeat_cycles").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      console.log("[network-heartbeat] Reset complete");
      return c.json({ status: "reset_complete", timestamp: new Date().toISOString() });
    }

    return c.json({ error: `Unknown action: ${action}. Use status, next_cycle, or reset_cycles.` }, 400);
  } catch (err) {
    console.log(`[network-heartbeat] Error: ${(err as Error).message}`);
    return c.json({ error: `Network heartbeat error: ${(err as Error).message}` }, 500);
  }
});

// ============================================================
// 13. NETWORK-METRICS — Dashboard aggregation endpoint
// ============================================================
app.post("/make-server-49d15288/network-metrics", async (c) => {
  try {
    const supabase = getAdminClient();
    const now = new Date();
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
    const twentyFourHAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    // TPS: transactions in last 5 min / 300
    const { data: recentTxns5m } = await supabase
      .from("transactions").select("id").gte("created_at", fiveMinAgo);
    const tps = (recentTxns5m?.length || 0) / 300;

    // 24h transaction aggregates
    const { data: txns24h } = await supabase
      .from("transactions")
      .select("amount_display, amount, status, risk_score, risk_level, sender_bank_id, receiver_bank_id, purpose_code")
      .gte("created_at", twentyFourHAgo);
    const allTxns = txns24h || [];
    const settled = allTxns.filter((t: any) => t.status === 'settled');
    const rejected = allTxns.filter((t: any) => t.status === 'rejected');
    const locked = allTxns.filter((t: any) => t.status === 'locked');
    const totalVolume24h = settled.reduce((s: number, t: any) => s + (t.amount_display || t.amount / 1e6), 0);
    const terminalCount = settled.length + rejected.length + locked.length;
    const successRate = terminalCount > 0 ? settled.length / terminalCount : 0;
    const riskScores24h = allTxns.filter((t: any) => t.risk_score != null).map((t: any) => t.risk_score as number);
    const avgRiskScore = riskScores24h.length > 0 ? riskScores24h.reduce((a: number, b: number) => a + b, 0) / riskScores24h.length : 0;

    // Corridor breakdown — build from banks
    const { data: allBanks } = await supabase.from("banks").select("id, short_code, name, status, wallets(balance_tokens, balance_lamports)");
    const bankMap: Record<string, string> = {};
    for (const b of (allBanks || [])) bankMap[b.id] = b.short_code;

    const corridors: Record<string, { volume: number; count: number; risk_scores: number[]; held: number }> = {};
    for (const tx of allTxns) {
      const sCode = bankMap[tx.sender_bank_id] || '?';
      const rCode = bankMap[tx.receiver_bank_id] || '?';
      const key = `${sCode}\u2192${rCode}`;
      if (!corridors[key]) corridors[key] = { volume: 0, count: 0, risk_scores: [], held: 0 };
      corridors[key].count++;
      if (tx.status === 'settled') corridors[key].volume += (tx.amount_display || tx.amount / 1e6);
      if (tx.risk_score != null) corridors[key].risk_scores.push(tx.risk_score);
      if (tx.status === 'locked') corridors[key].held++;
    }
    const corridorSummary: Record<string, { volume: number; count: number; avg_risk: number; held: number }> = {};
    for (const [key, val] of Object.entries(corridors)) {
      corridorSummary[key] = {
        volume: val.volume,
        count: val.count,
        avg_risk: val.risk_scores.length > 0 ? val.risk_scores.reduce((a, b) => a + b, 0) / val.risk_scores.length : 0,
        held: val.held,
      };
    }

    // Agent fleet
    const agentFleet = (allBanks || []).map((b: any) => {
      const w = b.wallets?.[0];
      return {
        bank_code: b.short_code,
        name: b.name,
        status: b.status,
        balance: w?.balance_tokens ?? 0,
      };
    });

    // Recent cycles
    const { data: recentCycles } = await supabase
      .from("heartbeat_cycles")
      .select("*")
      .order("cycle_number", { ascending: false })
      .limit(5);

    // Anomalies: locked txns or risk_score > 60
    const { data: anomalies } = await supabase
      .from("transactions")
      .select("id, amount_display, amount, status, risk_score, risk_level, purpose_code, sender_bank_id, receiver_bank_id, created_at")
      .or("status.eq.locked,risk_score.gt.60")
      .order("created_at", { ascending: false })
      .limit(20);

    return c.json({
      tps: Math.round(tps * 1000) / 1000,
      total_volume_24h: totalVolume24h,
      transaction_count_24h: allTxns.length,
      settled_count_24h: settled.length,
      success_rate: Math.round(successRate * 1000) / 1000,
      held_count: locked.length,
      avg_risk_score: Math.round(avgRiskScore * 10) / 10,
      corridors: corridorSummary,
      agent_fleet: agentFleet,
      recent_cycles: recentCycles || [],
      anomalies: (anomalies || []).map((a: any) => ({
        ...a,
        sender_code: bankMap[a.sender_bank_id] || '?',
        receiver_code: bankMap[a.receiver_bank_id] || '?',
      })),
      timestamp: now.toISOString(),
    });
  } catch (err) {
    console.log(`[network-metrics] Error: ${(err as Error).message}`);
    return c.json({ error: `Network metrics error: ${(err as Error).message}` }, 500);
  }
});

// ============================================================
// 7. RETRY-TRANSACTION — Retry orchestration for a stuck/orphaned transaction
// ============================================================
app.post("/make-server-49d15288/retry-transaction", async (c) => {
  try {
    const body = await c.req.json();
    const { transaction_id } = body;

    if (!transaction_id) {
      return c.json({ error: "Missing required field: transaction_id" }, 400);
    }

    const supabase = getAdminClient();

    // Load transaction
    const { data: tx, error: txErr } = await supabase
      .from("transactions")
      .select("*, sender_bank:banks!transactions_sender_bank_id_fkey(id, short_code), receiver_bank:banks!transactions_receiver_bank_id_fkey(id, short_code, status)")
      .eq("id", transaction_id)
      .single();

    if (txErr || !tx) {
      return c.json({ error: `Transaction not found: ${txErr?.message}` }, 404);
    }

    // Guard: already terminal
    if (["settled", "rejected", "reversed"].includes(tx.status)) {
      return c.json({ error: `Transaction already ${tx.status} — cannot retry` }, 400);
    }

    // Guard: receiver must be active
    if ((tx as any).receiver_bank?.status !== "active") {
      return c.json({ error: `Receiver bank is not active — cannot retry` }, 400);
    }

    const receiverBankId = tx.receiver_bank_id;
    const aid = agentId(receiverBankId);

    console.log(`[retry-transaction] Retrying tx ${transaction_id.slice(0, 8)} — current status: ${tx.status}`);

    // Find the payment_request message for this transaction
    const { data: msgs } = await supabase
      .from("agent_messages")
      .select("*")
      .eq("transaction_id", transaction_id)
      .eq("message_type", "payment_request")
      .order("created_at", { ascending: false })
      .limit(1);

    if (!msgs || msgs.length === 0) {
      return c.json({ error: "No payment_request message found for this transaction" }, 404);
    }

    const msg = msgs[0];

    // Reset transaction to initiated so the orchestrator can re-run all steps
    await supabase
      .from("transactions")
      .update({
        status: "initiated",
        compliance_passed: null,
        compliance_checks: null,
        compliance_completed_at: null,
        risk_level: null,
        risk_score: null,
        risk_reasoning: null,
        risk_scored_at: null,
        solana_tx_signature: null,
        solana_slot: null,
        solana_block_time: null,
        settled_at: null,
        lockup_until: null,
      })
      .eq("id", transaction_id);

    // Reset the message to unprocessed
    await supabase
      .from("agent_messages")
      .update({ processed: false, processed_at: null })
      .eq("id", msg.id);

    // Clean up any existing compliance logs & risk scores from prior partial run
    await supabase.from("compliance_logs").delete().eq("transaction_id", transaction_id);
    await supabase.from("risk_scores").delete().eq("transaction_id", transaction_id);

    console.log(`[retry-transaction] Reset tx ${transaction_id.slice(0, 8)} to initiated — calling coreOrchestrate directly`);

    // Direct function call (no HTTP self-call — fixes 401)
    const orchResult = await coreOrchestrate(supabase, receiverBankId, msg.id);

    console.log(`[retry-transaction] Orchestrator result for tx ${transaction_id.slice(0, 8)}: action=${orchResult.action}`);

    return c.json({
      status: "retried",
      transaction_id,
      orchestrator_result: orchResult,
    });
  } catch (err) {
    console.log(`[retry-transaction] Error: ${(err as Error).message}`);
    return c.json({ error: `Retry transaction error: ${(err as Error).message}` }, 500);
  }
});

// ============================================================
// 8. EXPIRE-TRANSACTION — Mark an orphaned transaction as rejected
// ============================================================
app.post("/make-server-49d15288/expire-transaction", async (c) => {
  try {
    const body = await c.req.json();
    const { transaction_id } = body;

    if (!transaction_id) {
      return c.json({ error: "Missing required field: transaction_id" }, 400);
    }

    const supabase = getAdminClient();

    // Load transaction
    const { data: tx, error: txErr } = await supabase
      .from("transactions")
      .select("status")
      .eq("id", transaction_id)
      .single();

    if (txErr || !tx) {
      return c.json({ error: `Transaction not found: ${txErr?.message}` }, 404);
    }

    // Guard: already terminal
    if (["settled", "rejected", "reversed"].includes(tx.status)) {
      return c.json({ error: `Transaction already ${tx.status} — cannot expire` }, 400);
    }

    console.log(`[expire-transaction] Expiring tx ${transaction_id.slice(0, 8)} — was ${tx.status}`);

    const now = new Date().toISOString();

    // Mark as rejected with expiry reason
    await supabase
      .from("transactions")
      .update({
        status: "rejected",
        risk_reasoning: `Expired: orphaned transaction was stuck in '${tx.status}' status and manually expired at ${now}`,
      })
      .eq("id", transaction_id);

    // Mark any unprocessed messages for this tx as processed
    await supabase
      .from("agent_messages")
      .update({ processed: true, processed_at: now })
      .eq("transaction_id", transaction_id)
      .eq("processed", false);

    console.log(`[expire-transaction] Tx ${transaction_id.slice(0, 8)} expired (rejected)`);

    return c.json({
      status: "expired",
      transaction_id,
      previous_status: tx.status,
      timestamp: now,
    });
  } catch (err) {
    console.log(`[expire-transaction] Error: ${(err as Error).message}`);
    return c.json({ error: `Expire transaction error: ${(err as Error).message}` }, 500);
  }
});

// ============================================================
// 9a. RESET-TOKENS — Soft reset: preserve keypairs + SOL,
//     clear transactions/messages/token data, rebuild via re-activate
// ============================================================
app.post("/make-server-49d15288/reset-tokens", async (c) => {
  try {
    const supabase = getAdminClient();
    console.log("[reset-tokens] Starting soft token reset...");

    const results: Record<string, { success: boolean; error?: string; detail?: string }> = {};

    // Step 0: Clear Cadenza lockup tables (FK order: cadenza_flags → lockup_tokens)
    for (const lockupTable of ["cadenza_flags", "lockup_tokens"]) {
      const { error } = await supabase
        .from(lockupTable)
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");

      if (error) {
        console.log(`[reset-tokens] Error deleting from ${lockupTable}: ${error.message}`);
        results[lockupTable] = { success: false, error: error.message };
      } else {
        console.log(`[reset-tokens] Cleared ${lockupTable}`);
        results[lockupTable] = { success: true };
      }
    }

    // Step 0b: Reset lockup_status on all transactions (before deleting transactions)
    const { error: lockupResetErr } = await supabase
      .from("transactions")
      .update({ lockup_status: null })
      .neq("id", "00000000-0000-0000-0000-000000000000");

    if (lockupResetErr) {
      console.log(`[reset-tokens] Error resetting lockup_status: ${lockupResetErr.message}`);
      results["transactions_lockup_status"] = { success: false, error: lockupResetErr.message };
    } else {
      console.log(`[reset-tokens] Reset lockup_status to NULL on all transactions`);
      results["transactions_lockup_status"] = { success: true };
    }

    // Step 1: Delete transaction-related rows + treasury tables (FK-safe order)
    const tablesToClear = [
      "agent_conversations",
      "agent_messages",
      "compliance_logs",
      "risk_scores",
      "transactions",
      "treasury_mandates",
      "heartbeat_cycles",
      "network_snapshots",
    ];

    for (const table of tablesToClear) {
      const { error } = await supabase
        .from(table)
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");

      if (error) {
        console.log(`[reset-tokens] Error deleting from ${table}: ${error.message}`);
        results[table] = { success: false, error: error.message };
      } else {
        console.log(`[reset-tokens] Cleared ${table}`);
        results[table] = { success: true };
      }
    }

    // Step 2: Clear token columns in wallets (keep solana_pubkey, balance_lamports)
    const { error: walletErr } = await supabase
      .from("wallets")
      .update({
        token_account_address: null,
        balance_tokens: 0,
      })
      .neq("id", "00000000-0000-0000-0000-000000000000");

    if (walletErr) {
      console.log(`[reset-tokens] Error clearing wallet token data: ${walletErr.message}`);
      results["wallets"] = { success: false, error: walletErr.message };
    } else {
      console.log("[reset-tokens] Cleared token data from wallets (kept keypairs + SOL)");
      results["wallets"] = { success: true, detail: "token_columns_cleared" };
    }

    // Step 3: Reset banks to 'onboarding' status, clear token columns
    // Note: token_decimals kept at TOKEN_DECIMALS (not null) to avoid NOT NULL constraint violations
    const { data: banksBeforeReset } = await supabase.from("banks").select("id, short_code, solana_wallet_pubkey");
    const bankCount = banksBeforeReset?.length ?? 0;

    const { error: bankErr } = await supabase
      .from("banks")
      .update({
        token_mint_address: null,
        token_symbol: null,
        token_decimals: TOKEN_DECIMALS,
        status: "onboarding",
        updated_at: new Date().toISOString(),
      })
      .neq("id", "00000000-0000-0000-0000-000000000000");

    if (bankErr) {
      console.log(`[reset-tokens] Bulk bank update failed: ${bankErr.message} (code: ${bankErr.code}, details: ${bankErr.details}, hint: ${bankErr.hint})`);
      // Fallback: update each bank individually to isolate which field/constraint is failing
      let perBankSuccesses = 0;
      const perBankErrors: string[] = [];
      for (const b of (banksBeforeReset || [])) {
        // Try status-only update first (most critical)
        const { error: statusErr } = await supabase
          .from("banks")
          .update({ status: "onboarding", updated_at: new Date().toISOString() })
          .eq("id", b.id);
        if (statusErr) {
          console.log(`[reset-tokens] ${b.short_code} status update failed: ${statusErr.message}`);
          perBankErrors.push(`${b.short_code} status: ${statusErr.message}`);
        } else {
          console.log(`[reset-tokens] ${b.short_code} status -> onboarding`);
        }

        // Try clearing token columns separately
        const { error: tokenErr } = await supabase
          .from("banks")
          .update({ token_mint_address: null, token_symbol: null, token_decimals: TOKEN_DECIMALS })
          .eq("id", b.id);
        if (tokenErr) {
          console.log(`[reset-tokens] ${b.short_code} token column clear failed: ${tokenErr.message}`);
          perBankErrors.push(`${b.short_code} tokens: ${tokenErr.message}`);
        } else {
          perBankSuccesses++;
          console.log(`[reset-tokens] ${b.short_code} token columns cleared`);
        }
      }
      results["banks"] = {
        success: perBankErrors.length === 0,
        error: perBankErrors.length > 0 ? `Bulk failed, per-bank fallback: ${perBankErrors.join('; ')}` : undefined,
        detail: `${perBankSuccesses}/${bankCount} banks reset via fallback`,
      };
    } else {
      console.log(`[reset-tokens] Reset ${bankCount} banks to 'onboarding' (kept keypairs)`);
      results["banks"] = { success: true, detail: `${bankCount} banks reset to onboarding` };
    }

    // Log preserved wallet addresses
    if (banksBeforeReset) {
      for (const b of banksBeforeReset) {
        console.log(`[reset-tokens] Preserved: ${b.short_code} wallet=${b.solana_wallet_pubkey}`);
      }
    }

    console.log("[reset-tokens] Soft reset complete — banks need re-activation (Stage 2)");

    return c.json({
      status: "tokens_reset",
      banks_preserved: bankCount,
      tables: results,
      next_step: "Re-activate each bank to create new Token-2022 mints with correct supply encoding",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.log(`[reset-tokens] Error: ${(err as Error).message}`);
    return c.json({ error: `Reset tokens error: ${(err as Error).message}` }, 500);
  }
});

// ============================================================
// 9b. RESET-NETWORK — Delete all data from all 14 tables (FK order)
// ============================================================
app.post("/make-server-49d15288/reset-network", async (c) => {
  try {
    const supabase = getAdminClient();
    console.log("[reset-network] Starting full network reset...");

    // Reset lockup_status on transactions before deleting them
    const { error: lockupResetErr } = await supabase
      .from("transactions")
      .update({ lockup_status: null })
      .neq("id", "00000000-0000-0000-0000-000000000000");

    if (lockupResetErr) {
      console.log(`[reset-network] Error resetting lockup_status (non-blocking): ${lockupResetErr.message}`);
    } else {
      console.log(`[reset-network] Reset lockup_status to NULL on all transactions`);
    }

    // Delete in FK-safe order (children before parents)
    // cadenza_flags → lockup_tokens → network_wallets added for Cadenza infrastructure
    const tables = [
      "cadenza_flags",
      "lockup_tokens",
      "bank_agent_config",
      "agent_conversations",
      "agent_messages",
      "compliance_logs",
      "risk_scores",
      "transactions",
      "treasury_mandates",
      "heartbeat_cycles",
      "network_snapshots",
      "network_wallets",
      "wallets",
      "banks",
    ];

    const results: Record<string, { deleted: boolean; error?: string }> = {};

    for (const table of tables) {
      // Use neq on id to match all rows (Supabase requires a filter for delete)
      const { error } = await supabase
        .from(table)
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");

      if (error) {
        console.log(`[reset-network] Error deleting from ${table}: ${error.message}`);
        results[table] = { deleted: false, error: error.message };
      } else {
        console.log(`[reset-network] Cleared ${table}`);
        results[table] = { deleted: true };
      }
    }

    console.log("[reset-network] Network reset complete");

    return c.json({
      status: "reset_complete",
      tables: results,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.log(`[reset-network] Error: ${(err as Error).message}`);
    return c.json({ error: `Reset network error: ${(err as Error).message}` }, 500);
  }
});

// ============================================================
// 20. AGENT-CONFIG — Get or update per-bank agent configuration
// ============================================================
app.post("/make-server-49d15288/agent-config", async (c) => {
  const t0 = Date.now();
  try {
    const body = await c.req.json();
    const { action, bank_id, config } = body;
    console.log(`[agent-config] action=${action} bank_id=${bank_id?.slice(0, 8) || 'none'} config_keys=${config ? Object.keys(config).join(',') : 'none'}`);
    const supabase = getAdminClient();

    if (action === "get") {
      if (!bank_id) return c.json({ error: "Missing bank_id" }, 400);
      const bankConfig = await getBankConfig(bank_id);

      let bank: any = null;
      try {
        const bankResult = await supabase
          .from("banks")
          .select("agent_system_prompt, name, short_code")
          .eq("id", bank_id)
          .single();
        if (bankResult.error) {
          console.log(`[agent-config:get] banks query error: ${bankResult.error.message} (code: ${bankResult.error.code})`);
        } else {
          bank = bankResult.data;
        }
      } catch (err) {
        console.log(`[agent-config:get] banks query exception: ${(err as Error).message}`);
      }

      let mandates: any[] = [];
      try {
        const mandatesResult = await supabase
          .from("treasury_mandates")
          .select("*")
          .eq("bank_id", bank_id)
          .eq("is_active", true)
          .order("priority", { ascending: true });
        if (mandatesResult.error) {
          console.log(`[agent-config:get] treasury_mandates query error: ${mandatesResult.error.message} (code: ${mandatesResult.error.code})`);
        } else {
          mandates = mandatesResult.data || [];
        }
      } catch (err) {
        console.log(`[agent-config:get] treasury_mandates query exception: ${(err as Error).message}`);
      }

      console.log(`[agent-config:get] Responding in ${Date.now() - t0}ms — config keys: ${Object.keys(bankConfig).length}, mandates: ${mandates.length}, bank: ${bank?.short_code || 'unknown'}`);
      return c.json({
        config: bankConfig,
        agent_system_prompt: bank?.agent_system_prompt || "",
        bank_name: bank?.name || "",
        bank_code: bank?.short_code || "",
        mandates,
        network_defaults: NETWORK_DEFAULTS,
      });
    }

    if (action === "get_defaults") {
      return c.json({ network_defaults: NETWORK_DEFAULTS });
    }

    if (action === "update") {
      if (!bank_id || !config) return c.json({ error: "Missing bank_id or config" }, 400);
      // Task 117: Validate lockup duration (0 or ≥5, no negatives)
      if (config.default_lockup_duration_minutes != null) {
        const ldm = Number(config.default_lockup_duration_minutes);
        if (isNaN(ldm) || ldm < 0 || (ldm !== 0 && ldm < 5)) {
          return c.json({ error: "default_lockup_duration_minutes must be 0 (instant) or ≥5 minutes" }, 400);
        }
        config.default_lockup_duration_minutes = ldm;
      }
      const { data, error } = await supabase
        .from("bank_agent_config")
        .upsert({
          bank_id,
          ...config,
          updated_at: new Date().toISOString(),
        }, { onConflict: "bank_id" })
        .select()
        .single();

      if (error) {
        console.log(`[agent-config] update error: ${error.message}`);
        return c.json({ error: error.message }, 500);
      }
      return c.json({ success: true, config: data });
    }

    if (action === "update_personality") {
      if (!bank_id || !config) return c.json({ error: "Missing bank_id or config" }, 400);
      const { error } = await supabase
        .from("banks")
        .update({ agent_system_prompt: config.agent_system_prompt })
        .eq("id", bank_id);

      if (error) {
        console.log(`[agent-config] update_personality error: ${error.message}`);
        return c.json({ error: error.message }, 500);
      }
      return c.json({ success: true });
    }

    if (action === "toggle_mandate") {
      if (!bank_id || !config) return c.json({ error: "Missing bank_id or config" }, 400);
      const { mandate_id, is_active } = config;
      const { error } = await supabase
        .from("treasury_mandates")
        .update({ is_active })
        .eq("id", mandate_id)
        .eq("bank_id", bank_id);

      if (error) {
        console.log(`[agent-config] toggle_mandate error: ${error.message}`);
        return c.json({ error: error.message }, 500);
      }
      return c.json({ success: true });
    }

    if (action === "regenerate_mandates") {
      if (!bank_id) return c.json({ error: "Missing bank_id" }, 400);
      await supabase
        .from("treasury_mandates")
        .delete()
        .eq("bank_id", bank_id);

      const { data: bank } = await supabase
        .from("banks")
        .select("*")
        .eq("id", bank_id)
        .single();

      const { data: allBanks } = await supabase
        .from("banks")
        .select("*")
        .eq("status", "active");

      if (bank && allBanks) {
        await generateMandatesViaGemini(bank, allBanks);
      }

      const { data: newMandates } = await supabase
        .from("treasury_mandates")
        .select("*")
        .eq("bank_id", bank_id)
        .eq("is_active", true)
        .order("priority", { ascending: true });

      return c.json({ success: true, mandates: newMandates || [] });
    }

    return c.json({ error: "Invalid action" }, 400);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const errStack = err instanceof Error ? err.stack : '';
    console.log(`[agent-config] Unhandled error after ${Date.now() - t0}ms: ${errMsg}\n${errStack}`);
    return c.json({ error: `Agent config error: ${errMsg}` }, 500);
  }
});

// ============================================================
// 21. PROVING GROUND — Adversarial scenario engine
// ============================================================
app.post("/make-server-49d15288/proving-ground", handleProvingGround);

// ============================================================
// 22. ARIA — Natural-language agent configuration assistant
// ============================================================
app.post("/make-server-49d15288/aria", handleAria);

// ============================================================
// 23. YIELD-ACCRUE — Batch yield accrual for active lockups
//     Queries all lockup_tokens with status IN ('active', 'escalated'),
//     calculates yield since yield_last_calculated, updates records.
//     Designed to be called as a trailing step in the heartbeat cycle.
// ============================================================
async function coreYieldAccrue(): Promise<{
  lockups_processed: number;
  total_yield_this_cycle: string;
  total_yield_this_cycle_raw: string;
  details: Array<{ lockup_id: string; symbol: string; principal: string; yield_delta: string; yield_total: string }>;
}> {
  const supabase = getAdminClient();
  const now = new Date().toISOString();

  console.log(`[yield-accrue] ▶ Starting batch yield accrual at ${now}`);

  const { data: lockups, error: fetchErr } = await supabase
    .from("lockup_tokens")
    .select("id, yb_token_symbol, yb_token_amount, yield_rate_bps, yield_accrued, yield_last_calculated, lockup_start, status")
    .in("status", ["active", "escalated"]);

  if (fetchErr) {
    console.log(`[yield-accrue] ✗ Failed to fetch lockups: ${fetchErr.message}`);
    throw new Error(`Failed to fetch active lockups: ${fetchErr.message}`);
  }

  if (!lockups || lockups.length === 0) {
    console.log(`[yield-accrue] No active/escalated lockups — skipping`);
    return { lockups_processed: 0, total_yield_this_cycle: "$0.00", total_yield_this_cycle_raw: "0", details: [] };
  }

  console.log(`[yield-accrue] Found ${lockups.length} active/escalated lockups`);

  let totalYieldThisCycle = 0n;
  const details: Array<{ lockup_id: string; symbol: string; principal: string; yield_delta: string; yield_total: string }> = [];

  for (const lockup of lockups) {
    const principal = BigInt(lockup.yb_token_amount || 0);
    const rateBps = lockup.yield_rate_bps || 525;
    const lastCalc = lockup.yield_last_calculated || lockup.lockup_start || now;
    const existingYield = BigInt(lockup.yield_accrued || 0);

    const yieldDelta = calculateAccruedYield(principal, rateBps, lastCalc, now);

    if (yieldDelta <= 0n) {
      console.log(`[yield-accrue] ${lockup.yb_token_symbol} (${lockup.id}): no accrual (zero elapsed)`);
      continue;
    }

    const newTotalYield = existingYield + yieldDelta;

    const { error: updateErr } = await supabase
      .from("lockup_tokens")
      .update({
        yield_accrued: newTotalYield.toString(),
        yield_last_calculated: now,
      })
      .eq("id", lockup.id);

    if (updateErr) {
      console.log(`[yield-accrue] ⚠ Failed to update lockup ${lockup.id}: ${updateErr.message}`);
      continue;
    }

    totalYieldThisCycle += yieldDelta;
    details.push({
      lockup_id: lockup.id,
      symbol: lockup.yb_token_symbol || "unknown",
      principal: formatYieldUsd(principal),
      yield_delta: formatYieldUsd(yieldDelta),
      yield_total: formatYieldUsd(newTotalYield),
    });

    console.log(`[yield-accrue] ✓ ${lockup.yb_token_symbol}: +${formatYieldUsd(yieldDelta)} (total: ${formatYieldUsd(newTotalYield)})`);
  }

  console.log(`[yield-accrue] ✓ Batch complete — ${details.length} lockups updated, cycle yield: ${formatYieldUsd(totalYieldThisCycle)}`);

  return {
    lockups_processed: details.length,
    total_yield_this_cycle: formatYieldUsd(totalYieldThisCycle),
    total_yield_this_cycle_raw: totalYieldThisCycle.toString(),
    details,
  };
}

app.post("/make-server-49d15288/yield-accrue", async (c) => {
  try {
    const result = await coreYieldAccrue();
    return c.json(result);
  } catch (err) {
    console.log(`[yield-accrue] Fatal error: ${(err as Error).message}`);
    return c.json({ error: `Yield accrual failed: ${(err as Error).message}` }, 500);
  }
});

// ============================================================
// 24. YIELD-SWEEP — Transfer accrued yield to Solstice fees wallet
//     Called on lockup resolution (settle or reverse).
//     Updates lockup_tokens.yield_swept_to and network_wallets.balance.
//     Yield is tracked as an accounting entry (no actual SPL token mint).
// ============================================================
app.post("/make-server-49d15288/yield-sweep", async (c) => {
  try {
    const { lockup_id } = await c.req.json();
    if (!lockup_id) return c.json({ error: "Missing required field: lockup_id" }, 400);

    const supabase = getAdminClient();
    console.log(`[yield-sweep] ▶ Sweeping yield for lockup ${lockup_id}`);

    // 1. Fetch the lockup record
    const { data: lockup, error: lockupErr } = await supabase
      .from("lockup_tokens")
      .select("id, yb_token_symbol, yield_accrued, yield_swept_to, status")
      .eq("id", lockup_id)
      .maybeSingle();

    if (lockupErr || !lockup) {
      console.log(`[yield-sweep] ✗ Lockup not found: ${lockupErr?.message || "no record"}`);
      return c.json({ error: `Lockup not found: ${lockupErr?.message || lockup_id}` }, 404);
    }

    if (lockup.yield_swept_to) {
      console.log(`[yield-sweep] Already swept for lockup ${lockup_id} → ${lockup.yield_swept_to}`);
      return c.json({ status: "already_swept", lockup_id, swept_to: lockup.yield_swept_to });
    }

    const yieldAmount = BigInt(lockup.yield_accrued || 0);
    if (yieldAmount <= 0n) {
      console.log(`[yield-sweep] No yield to sweep for lockup ${lockup_id}`);
      return c.json({ status: "no_yield", lockup_id, yield_accrued: "0" });
    }

    // 2. Find Solstice fees wallet from network_wallets table
    const { data: solsticeRow, error: nwErr } = await supabase
      .from("network_wallets")
      .select("id, wallet_address, balance")
      .eq("code", "SOLSTICE_FEES")
      .maybeSingle();

    if (nwErr || !solsticeRow) {
      console.log(`[yield-sweep] ✗ Solstice fees wallet not found: ${nwErr?.message || "no record"}`);
      return c.json({ error: `Solstice fees wallet not found. Run /setup-custodian first.` }, 400);
    }

    // 3. Update network_wallets.balance (accounting entry, BIGINT stored as numeric)
    const currentBalance = BigInt(Math.round((solsticeRow.balance || 0) * 1_000_000));
    const newBalance = currentBalance + yieldAmount;
    const newBalanceNumeric = Number(newBalance) / 1_000_000;

    const { error: balErr } = await supabase
      .from("network_wallets")
      .update({ balance: newBalanceNumeric })
      .eq("id", solsticeRow.id);

    if (balErr) {
      console.log(`[yield-sweep] ⚠ Failed to update Solstice balance: ${balErr.message}`);
      return c.json({ error: `Failed to update Solstice balance: ${balErr.message}` }, 500);
    }

    // 4. Mark lockup as swept
    const { error: sweepErr } = await supabase
      .from("lockup_tokens")
      .update({ yield_swept_to: solsticeRow.wallet_address })
      .eq("id", lockup_id);

    if (sweepErr) {
      console.log(`[yield-sweep] ⚠ Failed to mark lockup as swept: ${sweepErr.message}`);
      return c.json({ error: `Failed to mark lockup as swept: ${sweepErr.message}` }, 500);
    }

    console.log(`[yield-sweep] ✓ Swept ${formatYieldUsd(yieldAmount)} from ${lockup.yb_token_symbol} → Solstice (${solsticeRow.wallet_address})`);
    console.log(`[yield-sweep] Solstice balance: ${formatYieldUsd(currentBalance)} → ${formatYieldUsd(newBalance)}`);

    return c.json({
      status: "swept",
      lockup_id,
      symbol: lockup.yb_token_symbol,
      yield_swept: formatYieldUsd(yieldAmount),
      yield_swept_raw: yieldAmount.toString(),
      swept_to: solsticeRow.wallet_address,
      solstice_balance_before: formatYieldUsd(currentBalance),
      solstice_balance_after: formatYieldUsd(newBalance),
    });
  } catch (err) {
    console.log(`[yield-sweep] Fatal error: ${(err as Error).message}`);
    return c.json({ error: `Yield sweep failed: ${(err as Error).message}` }, 500);
  }
});

// ============================================================
// 25. LOCKUP-SETTLE \u2014 Phase 2: Hard finality for lockup
//     Burns LOCKUP-USTB from escrow, mints receiver deposit
//     tokens, sweeps accrued yield, collects Phase 2 fee.
// ============================================================

// \u2500\u2500 Core lockup-settle function (callable directly, bypasses HTTP) \u2500\u2500
// Returns the same JSON shape as the route handler. On error, returns { error: "..." }.
// Task 118.2: Extracted so resolve_escalation can call directly (avoids 401 on internal fetch).
interface CoreLockupSettleParams {
  lockup_id: string;
  caller_resolution?: string;
  caller_resolved_by?: string;
}

async function coreLockupSettle(params: CoreLockupSettleParams): Promise<any> {
  const { lockup_id, caller_resolution, caller_resolved_by } = params;
  if (!lockup_id) return { error: "Missing required field: lockup_id" };

  const supabase = getAdminClient();
  console.log(`[lockup-settle] \u25b6 Phase 2: Hard finality for lockup ${lockup_id}`);

  // 1. Fetch lockup record with status guard
  const { data: lockup, error: lockupErr } = await supabase
    .from("lockup_tokens")
    .select("*")
    .eq("id", lockup_id)
    .maybeSingle();

  if (lockupErr || !lockup) {
    return { error: `Lockup not found: ${lockupErr?.message || lockup_id}` };
  }

  if (!["active", "escalated"].includes(lockup.status)) {
    console.log(`[lockup-settle] Lockup ${lockup_id} status=${lockup.status} \u2014 cannot settle`);
    return { error: `Lockup status is '${lockup.status}' \u2014 must be 'active' or 'escalated' to settle` };
  }

  // 2. Fetch transaction + banks
  const { data: tx } = await supabase
    .from("transactions")
    .select("*, sender_bank:banks!transactions_sender_bank_id_fkey(*), receiver_bank:banks!transactions_receiver_bank_id_fkey(*)")
    .eq("id", lockup.transaction_id)
    .single();

  if (!tx) return { error: `Transaction not found for lockup ${lockup_id}` };

  const receiverBank = (tx as any).receiver_bank;
  const senderBank = (tx as any).sender_bank;
  const aid = agentId(tx.receiver_bank_id);
  const rawAmount = BigInt(lockup.yb_token_amount);

  console.log(`[lockup-settle] \u2502 Tx: ${lockup.transaction_id.slice(0, 8)}, Amount: ${rawAmount.toString()} raw`);
  console.log(`[lockup-settle] \u2502 Lockup mint: ${lockup.yb_token_symbol} (${lockup.yb_token_mint?.slice(0, 16)}...)`);

  // 3. Get BNY custodian keypair
  const { keypairEncrypted: custodianKeypairEncrypted } = await getCustodianKeypair();

  // 4. Burn LOCKUP-USTB from escrow
  const settleAmtDisplay = (Number(rawAmount) / 1_000_000).toFixed(2);
  let burnResult;
  try {
    const burnMemo = buildISO20022LockupMemo({
      transactionId: lockup.transaction_id, senderBank, receiverBank,
      amount: settleAmtDisplay, purposeCode: tx.purpose_code || "settlement",
      remittanceInfo: tx.memo || undefined,
      phase: "Phase 2 — Escrow Burn", operation: "ESCROW_BURN",
    });
    burnResult = await burnLockupFromEscrow(
      custodianKeypairEncrypted,
      lockup.yb_token_mint,
      rawAmount,
      burnMemo,
    );
    console.log(`[lockup-settle] \u2502 Step 1 \u2713 LOCKUP-USTB burned from escrow: ${burnResult.signature.slice(0, 20)}...`);
  } catch (burnErr) {
    const errMsg = (burnErr as Error).message;
    console.log(`[lockup-settle] \u2502 Step 1 \u2717 Escrow burn failed: ${errMsg}`);
    return { error: `Lockup escrow burn failed: ${errMsg}` };
  }

  // 5. Mint receiver deposit token
  let mintResult;
  try {
    const mintMemo = buildISO20022LockupMemo({
      transactionId: lockup.transaction_id, senderBank, receiverBank,
      amount: settleAmtDisplay, purposeCode: tx.purpose_code || "settlement",
      remittanceInfo: tx.memo || undefined,
      phase: "Phase 2 — Hard Finality Mint", operation: "FINALITY_MINT",
    });
    mintResult = await mintDepositToken(
      receiverBank.solana_wallet_keypair_encrypted,
      receiverBank.token_mint_address,
      rawAmount,
      mintMemo,
    );
    console.log(`[lockup-settle] \u2502 Step 2 \u2713 ${tokenSymbol(receiverBank.short_code)} minted to ${receiverBank.short_code}: ${mintResult.signature.slice(0, 20)}...`);
  } catch (mintErr) {
    const errMsg = (mintErr as Error).message;
    console.log(`[lockup-settle] \u2502 Step 2 \u2717 Receiver deposit mint failed: ${errMsg}`);
    return { error: `Receiver deposit mint failed after lockup burn: ${errMsg}. LOCKUP TOKENS BURNED \u2014 manual recovery needed.` };
  }

  const now = new Date().toISOString();

  // 6. Sweep accrued yield
  let yieldSweptDisplay = "$0.00";
  try {
    const yieldDelta = calculateAccruedYield(
      BigInt(lockup.yb_token_amount),
      lockup.yield_rate_bps || 525,
      lockup.yield_last_calculated || lockup.lockup_start || now,
      now,
    );
    const totalYield = BigInt(lockup.yield_accrued || 0) + yieldDelta;
    if (totalYield > 0n) {
      await supabase.from("lockup_tokens").update({ yield_accrued: totalYield.toString(), yield_last_calculated: now }).eq("id", lockup_id);
      const { data: solsticeRow } = await supabase.from("network_wallets").select("id, wallet_address, balance").eq("code", "SOLSTICE_FEES").maybeSingle();
      if (solsticeRow) {
        const currentBalance = BigInt(Math.round((solsticeRow.balance || 0) * 1_000_000));
        const newBalance = currentBalance + totalYield;
        await supabase.from("network_wallets").update({ balance: Number(newBalance) / 1_000_000 }).eq("id", solsticeRow.id);
        await supabase.from("lockup_tokens").update({ yield_swept_to: solsticeRow.wallet_address }).eq("id", lockup_id);
        yieldSweptDisplay = formatYieldUsd(totalYield);
        console.log(`[lockup-settle] \u2502 Step 3 \u2713 Yield swept: ${yieldSweptDisplay} \u2192 Solstice`);
      }
    } else {
      console.log(`[lockup-settle] \u2502 Step 3 \u2014 No yield to sweep`);
    }
  } catch (yieldErr) {
    console.log(`[lockup-settle] \u2502 Step 3 \u26a0 Yield sweep failed (non-blocking): ${(yieldErr as Error).message}`);
  }

  // 7. Update lockup_tokens status + populate T-Bill (receiver deposit) token columns
  await supabase.from("lockup_tokens").update({
    status: "settled",
    resolution: caller_resolution || "cadenza_all_clear",
    resolved_at: now,
    resolved_by: caller_resolved_by || "cadenza",
    // Phase 2: receiver deposit token info (the "T-Bill" column in the Three-Token Lockup Flow widget)
    tb_token_mint: receiverBank.token_mint_address,
    tb_token_symbol: tokenSymbol(receiverBank.short_code),
    tb_token_amount: rawAmount.toString(),
    tb_holder: receiverBank.solana_wallet_pubkey,
  }).eq("id", lockup_id);

  // 8. Update transactions
  const { error: txUpdateErr } = await supabase.from("transactions").update({
    lockup_status: "hard_finality",
    status: "settled",
    settled_at: now,
    is_reversible: false,
  }).eq("id", lockup.transaction_id);
  if (txUpdateErr) {
    console.log(`[lockup-settle] \u2502 Step 5 \u2717 Critical tx update failed: ${txUpdateErr.message}`);
    return { error: `Transaction status update failed: ${txUpdateErr.message}` };
  }

  // 8a. Store Phase 2 finality signature + slot
  try {
    const { error: finColErr } = await supabase.from("transactions").update({
      finality_tx_signature: mintResult.signature,
      finality_solana_slot: mintResult.slot,
      finality_block_time: now,
    }).eq("id", lockup.transaction_id);
    if (finColErr) {
      console.log(`[lockup-settle] \u2502 Step 5a \u26a0 Finality columns not available: ${finColErr.message}`);
    } else {
      console.log(`[lockup-settle] \u2502 Step 5a \u2713 Finality sig stored: ${mintResult.signature.slice(0, 20)}...`);
    }
  } catch (finErr) {
    console.log(`[lockup-settle] \u2502 Step 5a \u26a0 Finality columns not available (non-blocking): ${(finErr as Error).message}`);
  }

  // 8b. Phase 2 network fee
  const finalityMemo = [
    `CODA Solstice | Lockup Phase 2 (Hard Finality)`,
    `TxId:    ${lockup.transaction_id}`,
    `Amount:  ${(Number(rawAmount) / 1_000_000).toFixed(2)} USD`,
    `From:    ${senderBank.short_code} (${senderBank.name})`,
    `To:      ${receiverBank.short_code} (${receiverBank.name})`,
    `Escrow Burn: ${burnResult.signature.slice(0, 16)}...`,
    `Receiver Mint: ${mintResult.signature.slice(0, 16)}...`,
    `Yield:   ${yieldSweptDisplay}`,
    `Fee:     ${NETWORK_DEFAULTS.network_fee_sol} SOL \u2192 SOLSTICE_FEES (Phase 2 of 2)`,
  ].join("\n");
  const feeResult = await collectNetworkFee(
    senderBank.solana_wallet_keypair_encrypted,
    lockup.transaction_id,
    "lockup_hard_finality",
    finalityMemo,
    "[lockup-settle]",
  );
  if (feeResult.feeSig) {
    console.log(`[lockup-settle] \u2502 Step 4 \u2713 Phase 2 fee: ${feeResult.feeSol} SOL \u2014 sig: ${feeResult.feeSig.slice(0, 20)}...`);
  }

  const phase1Fee = tx.network_fee_sol || NETWORK_DEFAULTS.network_fee_sol;
  await supabase.from("transactions").update({
    network_fee_sol: phase1Fee + feeResult.feeSol,
    settlement_method: "lockup_hard_finality",
  }).eq("id", lockup.transaction_id);

  // 9. Update wallet balances
  try {
    const receiverBalance = await getTokenBalance(receiverBank.solana_wallet_pubkey, receiverBank.token_mint_address);
    await supabase.from("wallets").update({ balance_tokens: Number(receiverBalance) }).eq("bank_id", tx.receiver_bank_id).eq("is_default", true);
  } catch (balErr) {
    console.log(`[lockup-settle] \u26a0 Balance update failed: ${(balErr as Error).message}`);
  }

  // 10. Insert agent_message
  const amountDisplay = tx.amount_display || (Number(rawAmount) / 1_000_000);
  await supabase.from("agent_messages").insert({
    id: crypto.randomUUID(),
    transaction_id: lockup.transaction_id,
    from_bank_id: tx.receiver_bank_id,
    to_bank_id: tx.sender_bank_id,
    message_type: "settlement_confirm",
    content: {
      agent_id: aid,
      action: "hard_finality",
      flow: "lockup_settle",
      phase: 2,
      lockup_id,
      escrow_burn: burnResult.signature,
      deposit_mint: mintResult.signature,
      finality_signature: mintResult.signature,
      finality_slot: mintResult.slot,
      yield_swept: yieldSweptDisplay,
      network_fee_sol: feeResult.feeSol,
      total_fee_sol: phase1Fee + feeResult.feeSol,
    },
    natural_language: `Maestro \u2014 Phase 2 hard finality achieved. $${Number(amountDisplay).toLocaleString()} ${tokenSymbol(receiverBank.short_code)} minted to ${receiverBank.short_code} for the first time. Yield of ${yieldSweptDisplay} swept to network fees. Lockup resolved. Total fees: ${(phase1Fee + feeResult.feeSol).toFixed(3)} SOL.`,
    processed: false,
    created_at: now,
  });

  console.log(`[lockup-settle] \u2514\u2500 HARD FINALITY \u2014 lockup ${lockup_id.slice(0, 8)} settled, ${tokenSymbol(receiverBank.short_code)} minted to ${receiverBank.short_code}`);

  return {
    status: "settled",
    lockup_id,
    transaction_id: lockup.transaction_id,
    resolution: caller_resolution || "cadenza_all_clear",
    receiver_deposit_mint_signature: mintResult.signature,
    escrow_burn_signature: burnResult.signature,
    finality_signature: mintResult.signature,
    yield_swept: yieldSweptDisplay,
    total_fee_sol: phase1Fee + feeResult.feeSol,
  };
}

// \u2500\u2500 Core lockup-reverse function (callable directly, bypasses HTTP) \u2500\u2500
// Task 118.2: Same pattern as coreLockupSettle above.
interface CoreLockupReverseParams {
  lockup_id: string;
  reason?: string;
  caller_resolution?: string;
  caller_resolved_by?: string;
}

async function coreLockupReverse(params: CoreLockupReverseParams): Promise<any> {
  const { lockup_id, reason, caller_resolution, caller_resolved_by } = params;
  if (!lockup_id) return { error: "Missing required field: lockup_id" };

  const supabase = getAdminClient();
  const reversalReason = reason || "cadenza_auto_reverse";
  console.log(`[lockup-reverse] \u25b6 Reversal for lockup ${lockup_id} \u2014 reason: ${reversalReason}`);

  // 1. Fetch lockup record with status guard
  const { data: lockup, error: lockupErr } = await supabase
    .from("lockup_tokens")
    .select("*")
    .eq("id", lockup_id)
    .maybeSingle();

  if (lockupErr || !lockup) {
    return { error: `Lockup not found: ${lockupErr?.message || lockup_id}` };
  }

  if (!["active", "escalated"].includes(lockup.status)) {
    console.log(`[lockup-reverse] Lockup ${lockup_id} status=${lockup.status} \u2014 cannot reverse`);
    return { error: `Lockup status is '${lockup.status}' \u2014 must be 'active' or 'escalated' to reverse` };
  }

  // 2. Fetch transaction + banks
  const { data: tx } = await supabase
    .from("transactions")
    .select("*, sender_bank:banks!transactions_sender_bank_id_fkey(*), receiver_bank:banks!transactions_receiver_bank_id_fkey(*)")
    .eq("id", lockup.transaction_id)
    .single();

  if (!tx) return { error: `Transaction not found for lockup ${lockup_id}` };

  const senderBank = (tx as any).sender_bank;
  const receiverBank = (tx as any).receiver_bank;
  const aid = agentId(tx.receiver_bank_id);
  const rawAmount = BigInt(lockup.yb_token_amount);

  console.log(`[lockup-reverse] \u2502 Tx: ${lockup.transaction_id.slice(0, 8)}, Amount: ${rawAmount.toString()} raw`);

  // 3. Get BNY custodian keypair
  const { keypairEncrypted: custodianKeypairEncrypted } = await getCustodianKeypair();

  // 4. Burn LOCKUP-USTB from escrow
  const reverseAmtDisplay = (Number(rawAmount) / 1_000_000).toFixed(2);
  let burnResult;
  try {
    const burnMemo = buildISO20022LockupMemo({
      transactionId: lockup.transaction_id, senderBank, receiverBank,
      amount: reverseAmtDisplay, purposeCode: tx.purpose_code || "settlement",
      remittanceInfo: tx.memo || undefined,
      phase: "Reversal — Escrow Burn", operation: "REVERSAL_ESCROW_BURN",
    });
    burnResult = await burnLockupFromEscrow(
      custodianKeypairEncrypted,
      lockup.yb_token_mint,
      rawAmount,
      burnMemo,
    );
    console.log(`[lockup-reverse] \u2502 Step 1 \u2713 LOCKUP-USTB burned from escrow: ${burnResult.signature.slice(0, 20)}...`);
  } catch (burnErr) {
    const errMsg = (burnErr as Error).message;
    console.log(`[lockup-reverse] \u2502 Step 1 \u2717 Escrow burn failed: ${errMsg}`);
    return { error: `Lockup escrow burn failed: ${errMsg}` };
  }

  // 5. Re-mint sender deposit token (clawback)
  let mintResult;
  try {
    const mintMemo = buildISO20022LockupMemo({
      transactionId: lockup.transaction_id, senderBank, receiverBank,
      amount: reverseAmtDisplay, purposeCode: tx.purpose_code || "settlement",
      remittanceInfo: reversalReason || undefined,
      phase: "Reversal — Sender Re-Mint", operation: "REVERSAL_REMINT",
    });
    mintResult = await mintDepositToken(
      senderBank.solana_wallet_keypair_encrypted,
      senderBank.token_mint_address,
      rawAmount,
      mintMemo,
    );
    console.log(`[lockup-reverse] \u2502 Step 2 \u2713 ${tokenSymbol(senderBank.short_code)} re-minted to ${senderBank.short_code}: ${mintResult.signature.slice(0, 20)}...`);
  } catch (mintErr) {
    const errMsg = (mintErr as Error).message;
    console.log(`[lockup-reverse] \u2502 Step 2 \u2717 Sender deposit re-mint failed: ${errMsg}`);
    return { error: `Sender deposit re-mint failed after lockup burn: ${errMsg}. LOCKUP TOKENS BURNED \u2014 manual recovery needed.` };
  }

  const now = new Date().toISOString();

  // 6. Sweep accrued yield
  let yieldSweptDisplay = "$0.00";
  try {
    const yieldDelta = calculateAccruedYield(
      BigInt(lockup.yb_token_amount),
      lockup.yield_rate_bps || 525,
      lockup.yield_last_calculated || lockup.lockup_start || now,
      now,
    );
    const totalYield = BigInt(lockup.yield_accrued || 0) + yieldDelta;
    if (totalYield > 0n) {
      await supabase.from("lockup_tokens").update({ yield_accrued: totalYield.toString(), yield_last_calculated: now }).eq("id", lockup_id);
      const { data: solsticeRow } = await supabase.from("network_wallets").select("id, wallet_address, balance").eq("code", "SOLSTICE_FEES").maybeSingle();
      if (solsticeRow) {
        const currentBalance = BigInt(Math.round((solsticeRow.balance || 0) * 1_000_000));
        const newBalance = currentBalance + totalYield;
        await supabase.from("network_wallets").update({ balance: Number(newBalance) / 1_000_000 }).eq("id", solsticeRow.id);
        await supabase.from("lockup_tokens").update({ yield_swept_to: solsticeRow.wallet_address }).eq("id", lockup_id);
        yieldSweptDisplay = formatYieldUsd(totalYield);
        console.log(`[lockup-reverse] \u2502 Step 3 \u2713 Yield swept: ${yieldSweptDisplay} \u2192 Solstice`);
      }
    }
  } catch (yieldErr) {
    console.log(`[lockup-reverse] \u2502 Step 3 \u26a0 Yield sweep failed (non-blocking): ${(yieldErr as Error).message}`);
  }

  // 7. Update lockup_tokens status
  await supabase.from("lockup_tokens").update({
    status: "reversed",
    resolution: caller_resolution || reversalReason,
    resolved_at: now,
    resolved_by: caller_resolved_by || "cadenza",
  }).eq("id", lockup_id);

  // 8. Update transactions
  const { error: revTxErr } = await supabase.from("transactions").update({
    lockup_status: "reversed",
    status: "reversed",
    is_reversible: false,
    reversed_at: now,
    reversal_reason: reversalReason,
  }).eq("id", lockup.transaction_id);
  if (revTxErr) {
    console.log(`[lockup-reverse] \u2502 Step 4 \u2717 Critical tx update failed: ${revTxErr.message}`);
    return { error: `Transaction status update failed: ${revTxErr.message}` };
  }

  // 8a. Store reversal finality signature
  try {
    const { error: finColErr } = await supabase.from("transactions").update({
      finality_tx_signature: mintResult.signature,
      finality_solana_slot: mintResult.slot,
      finality_block_time: now,
    }).eq("id", lockup.transaction_id);
    if (finColErr) {
      console.log(`[lockup-reverse] \u2502 Step 4a \u26a0 Finality columns not available: ${finColErr.message}`);
    }
  } catch (finErr) {
    console.log(`[lockup-reverse] \u2502 Step 4a \u26a0 Finality columns not available (non-blocking): ${(finErr as Error).message}`);
  }

  // 8b. Collect network fee
  const isUserReversal = reversalReason.startsWith("user_requested_reversal");
  const reversalSettlementMethod = isUserReversal ? "lockup_user_reversal" : "lockup_reversal";
  const reversalMemo = [
    `CODA Solstice | Lockup Reversal`,
    `TxId:    ${lockup.transaction_id}`,
    `Amount:  ${(Number(rawAmount) / 1_000_000).toFixed(2)} USD`,
    `From:    ${senderBank.short_code} (${senderBank.name})`,
    `To:      ${receiverBank.short_code} (${receiverBank.name})`,
    `Reason:  ${reversalReason.slice(0, 100)}`,
    `Escrow Burn: ${burnResult.signature.slice(0, 16)}...`,
    `Re-mint: ${mintResult.signature.slice(0, 16)}...`,
    `Fee:     ${NETWORK_DEFAULTS.network_fee_sol} SOL \u2192 SOLSTICE_FEES`,
  ].join("\n");
  const feeResult = await collectNetworkFee(
    senderBank.solana_wallet_keypair_encrypted,
    lockup.transaction_id,
    reversalSettlementMethod,
    reversalMemo,
    "[lockup-reverse]",
  );
  if (feeResult.feeSig) {
    console.log(`[lockup-reverse] \u2502 Step 4 \u2713 Network fee: ${feeResult.feeSol} SOL \u2014 sig: ${feeResult.feeSig.slice(0, 20)}...`);
  }

  // 9. Update wallet balances
  try {
    const senderBalance = await getTokenBalance(senderBank.solana_wallet_pubkey, senderBank.token_mint_address);
    await supabase.from("wallets").update({ balance_tokens: Number(senderBalance) }).eq("bank_id", tx.sender_bank_id).eq("is_default", true);
  } catch (balErr) {
    console.log(`[lockup-reverse] \u26a0 Balance update failed: ${(balErr as Error).message}`);
  }

  // 10. Insert agent_message
  const amountDisplay = tx.amount_display || (Number(rawAmount) / 1_000_000);
  await supabase.from("agent_messages").insert({
    id: crypto.randomUUID(),
    transaction_id: lockup.transaction_id,
    from_bank_id: tx.receiver_bank_id,
    to_bank_id: tx.sender_bank_id,
    message_type: "settlement_confirm",
    content: {
      agent_id: aid,
      action: "reversed",
      flow: "lockup_reverse",
      lockup_id,
      reason: reversalReason,
      escrow_burn: burnResult.signature,
      sender_remint: mintResult.signature,
      yield_swept: yieldSweptDisplay,
      network_fee_sol: feeResult.feeSol,
    },
    natural_language: `Maestro \u2014 Lockup reversed (clean reversal \u2014 receiver never had tokens). $${Number(amountDisplay).toLocaleString()} ${tokenSymbol(senderBank.short_code)} re-minted to ${senderBank.short_code}. Reason: ${reversalReason}. Yield of ${yieldSweptDisplay} swept to network fees.`,
    processed: false,
    created_at: now,
  });

  console.log(`[lockup-reverse] \u2514\u2500 REVERSED \u2014 lockup ${lockup_id.slice(0, 8)}, ${tokenSymbol(senderBank.short_code)} re-minted to sender`);

  return {
    status: "reversed",
    lockup_id,
    transaction_id: lockup.transaction_id,
    resolution: caller_resolution || reversalReason,
    sender_remint_signature: mintResult.signature,
    escrow_burn_signature: burnResult.signature,
    yield_swept: yieldSweptDisplay,
  };
}

// Task 125: Thin wrapper — delegates to coreLockupSettle() to avoid code duplication
// and ensure ISO 20022 memo format is used (old duplicate had pipe-delimited memos).
app.post("/make-server-49d15288/lockup-settle", async (c) => {
  try {
    const { lockup_id, caller_resolution, caller_resolved_by } = await c.req.json();
    if (!lockup_id) return c.json({ error: "Missing required field: lockup_id" }, 400);

    const result = await coreLockupSettle({ lockup_id, caller_resolution, caller_resolved_by });
    if (result.error) {
      const status = result.error.includes("not found") ? 404 : result.error.includes("must be") ? 400 : 500;
      return c.json({ error: result.error }, status);
    }
    return c.json(result);
  } catch (err) {
    console.log(`[lockup-settle] Fatal error: ${(err as Error).message}`);
    return c.json({ error: `Lockup settle failed: ${(err as Error).message}` }, 500);
  }
});

// NOTE: Previous duplicate implementation removed in Task 125.
// The old HTTP route had its own full copy of settle logic with pipe-delimited memos
// (e.g. `LOCKUP_P2|txId|...|BURN_ESCROW`) instead of ISO 20022 pacs.009 format.
// Now delegates to coreLockupSettle() which uses buildISO20022LockupMemo().
// Dead code below this line removed:
//   - Fetch lockup/tx/banks (duplicate of coreLockupSettle steps 1-2)
//   - burnLockupFromEscrow with pipe-delimited memo (should be ISO 20022)
//   - mintDepositToken with pipe-delimited memo (should be ISO 20022)
//   - Yield sweep, lockup_tokens update, transactions update, finality columns,
//     network fee, wallet balance update, agent_message insert (all duplicates)

// ============================================================
// 26. LOCKUP-REVERSE \u2014 Reversal path for lockup
//     Burns LOCKUP-USTB from escrow, re-mints sender deposit
//     tokens, sweeps accrued yield, marks as reversed.
// ============================================================
// Task 125: Thin wrapper — delegates to coreLockupReverse() to avoid code duplication
// and ensure ISO 20022 memo format is used (old duplicate had pipe-delimited memos).
app.post("/make-server-49d15288/lockup-reverse", async (c) => {
  try {
    const { lockup_id, reason, caller_resolution, caller_resolved_by } = await c.req.json();
    if (!lockup_id) return c.json({ error: "Missing required field: lockup_id" }, 400);

    const result = await coreLockupReverse({ lockup_id, reason, caller_resolution, caller_resolved_by });
    if (result.error) {
      const status = result.error.includes("not found") ? 404 : result.error.includes("must be") ? 400 : 500;
      return c.json({ error: result.error }, status);
    }
    return c.json(result);
  } catch (err) {
    console.log(`[lockup-reverse] Fatal error: ${(err as Error).message}`);
    return c.json({ error: `Lockup reverse failed: ${(err as Error).message}` }, 500);
  }
});

// ============================================================
// 28. CADENZA-MONITOR — Cadenza dispute resolution & monitoring
//     Actions: scan_lockup, periodic_scan, user_reversal
//     Cadenza NEVER calls Solana directly — signals via
//     /lockup-settle or /lockup-reverse routes (Canto executes).
// ============================================================

// Task 118.2: cadenzaInternalPost removed — all call sites now use coreLockupSettle/coreLockupReverse directly

// ── Core scan_lockup function (reusable from route + periodic scan) ──

interface CadenzaScanResult {
  lockup_id: string;
  decision: string;
  confidence: number;
  reasoning: string;
  flag_type: string | null;
  risk_factors: string[];
  action_taken: string | null;
  action_result: any;
}

async function coreCadenzaScanLockup(lockupId: string): Promise<CadenzaScanResult> {
  console.log(`[cadenza] ████ coreCadenzaScanLockup ENTERED ████ lockupId=${lockupId}`);
  const supabase = getAdminClient();
  console.log(`[cadenza] ▶ scan_lockup ${lockupId.slice(0, 8)}`);

  // 1. Load lockup token
  const { data: lockup, error: lockupErr } = await supabase
    .from("lockup_tokens")
    .select("*")
    .eq("id", lockupId)
    .single();

  if (lockupErr || !lockup) {
    throw new Error(`Lockup not found: ${lockupErr?.message || 'missing'}`);
  }

  if (!["active", "escalated"].includes(lockup.status)) {
    throw new Error(`Lockup status is '${lockup.status}' — must be 'active' or 'escalated'`);
  }

  // 2. Load transaction
  const { data: tx, error: txErr } = await supabase
    .from("transactions")
    .select("*, sender_bank:banks!transactions_sender_bank_id_fkey(id, name, short_code, jurisdiction, tier, status, swift_bic, solana_wallet_pubkey, token_mint_address, solana_wallet_keypair_encrypted), receiver_bank:banks!transactions_receiver_bank_id_fkey(id, name, short_code, jurisdiction, tier, status, swift_bic, solana_wallet_pubkey, token_mint_address, solana_wallet_keypair_encrypted)")
    .eq("id", lockup.transaction_id)
    .single();

  if (txErr || !tx) {
    throw new Error(`Transaction not found: ${txErr?.message || 'missing'}`);
  }

  const senderBank = tx.sender_bank as any;
  const receiverBank = tx.receiver_bank as any;
  console.log(`[cadenza] │ Tx: ${tx.id.slice(0, 8)}, ${senderBank.short_code} → ${receiverBank.short_code}, $${tx.amount_display?.toLocaleString()}`);
  console.log(`[cadenza] │ Lockup status: ${lockup.status}, end: ${lockup.lockup_end || '∞'}`);

  // 3. Corridor history (last 10 bidirectional txns)
  const { data: corridorRaw } = await supabase
    .from('transactions')
    .select('id, amount_display, purpose_code, risk_level, risk_score, status, created_at, sender_bank_id, receiver_bank_id')
    .or(`and(sender_bank_id.eq.${tx.sender_bank_id},receiver_bank_id.eq.${tx.receiver_bank_id}),and(sender_bank_id.eq.${tx.receiver_bank_id},receiver_bank_id.eq.${tx.sender_bank_id})`)
    .neq('id', tx.id)
    .order('created_at', { ascending: false })
    .limit(10);

  const corridorHistory: CorridorTx[] = (corridorRaw || []).map((t: any) => ({
    id: t.id,
    amount_display: Number(t.amount_display || 0),
    purpose_code: t.purpose_code || 'unspecified',
    status: t.status,
    risk_score: t.risk_score || 0,
    risk_level: t.risk_level || 'unknown',
    created_at: t.created_at,
    direction: t.sender_bank_id === tx.sender_bank_id ? "sent" as const : "received" as const,
  }));

  // 4. Sender velocity stats
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const sixtyMinAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { data: senderTxns60 } = await supabase
    .from('transactions')
    .select('id, amount_display, receiver_bank_id, created_at')
    .eq('sender_bank_id', tx.sender_bank_id)
    .gte('created_at', sixtyMinAgo)
    .neq('id', tx.id);

  const allTxns = senderTxns60 || [];
  const txns10 = allTxns.filter(t => t.created_at >= tenMinAgo);
  const txns30 = allTxns.filter(t => t.created_at >= thirtyMinAgo);

  const velocity: VelocityStats = {
    count_10min: txns10.length,
    volume_10min: txns10.reduce((s, t) => s + Number(t.amount_display || 0), 0),
    count_60min: allTxns.length,
    volume_60min: allTxns.reduce((s, t) => s + Number(t.amount_display || 0), 0),
    distinct_receivers_30min: new Set(txns30.map(t => t.receiver_bank_id)).size,
  };

  // 5. Existing cadenza_flags on this lockup
  const { data: flagsRaw } = await supabase
    .from('cadenza_flags')
    .select('*')
    .eq('lockup_token_id', lockupId)
    .order('detected_at', { ascending: true });

  const existingFlags: CadenzaFlag[] = (flagsRaw || []).map((f: any) => ({
    id: f.id,
    flag_type: f.flag_type,
    severity: f.severity,
    reasoning: f.reasoning || '',
    detected_at: f.detected_at,
    action_taken: f.action_taken,
    action_at: f.action_at,
  }));

  // 6. Per-bank config
  const bankConfig = await getBankConfig(receiverBank.id);

  // 7. Build network mode context
  const networkModeContext = await getNetworkModeContext();

  // 8. Build prompt
  const monitoringParams: CadenzaMonitoringParams = {
    networkModeContext,
    lockupToken: {
      id: lockup.id,
      transaction_id: lockup.transaction_id,
      sender_bank_id: lockup.sender_bank_id,
      receiver_bank_id: lockup.receiver_bank_id,
      yb_token_mint: lockup.yb_token_mint,
      yb_token_symbol: lockup.yb_token_symbol,
      yb_token_amount: String(lockup.yb_token_amount),
      yb_holder: lockup.yb_holder,
      tb_token_mint: lockup.tb_token_mint || null,
      tb_token_symbol: lockup.tb_token_symbol || null,
      tb_token_amount: lockup.tb_token_amount ? String(lockup.tb_token_amount) : null,
      tb_holder: lockup.tb_holder || null,
      yield_rate_bps: lockup.yield_rate_bps || 525,
      yield_accrued: String(lockup.yield_accrued || 0),
      lockup_start: lockup.lockup_start || lockup.created_at,
      lockup_end: lockup.lockup_end,
      status: lockup.status,
      resolution: lockup.resolution,
      created_at: lockup.created_at,
    },
    transaction: {
      id: tx.id,
      amount: tx.amount,
      amount_display: tx.amount_display,
      purpose_code: tx.purpose_code,
      memo: tx.memo,
      status: tx.status,
      risk_level: tx.risk_level,
      risk_score: tx.risk_score,
      risk_reasoning: tx.risk_reasoning,
      lockup_status: tx.lockup_status,
      created_at: tx.created_at,
      initiated_at: tx.initiated_at,
      solana_tx_signature: tx.solana_tx_signature,
    },
    senderBank: {
      id: senderBank.id,
      name: senderBank.name,
      short_code: senderBank.short_code,
      jurisdiction: senderBank.jurisdiction,
      tier: senderBank.tier,
      status: senderBank.status,
      swift_bic: senderBank.swift_bic,
    },
    receiverBank: {
      id: receiverBank.id,
      name: receiverBank.name,
      short_code: receiverBank.short_code,
      jurisdiction: receiverBank.jurisdiction,
      tier: receiverBank.tier,
      status: receiverBank.status,
      swift_bic: receiverBank.swift_bic,
    },
    corridorHistory,
    senderVelocity: velocity,
    existingFlags,
    bankConfig: {
      cadenza_monitoring_sensitivity: bankConfig.cadenza_monitoring_sensitivity as any,
      cadenza_auto_reverse_enabled: bankConfig.cadenza_auto_reverse_enabled,
      cadenza_escalation_threshold: bankConfig.cadenza_escalation_threshold,
      cadenza_velocity_spike_multiplier: bankConfig.cadenza_velocity_spike_multiplier,
      cadenza_duplicate_window_seconds: bankConfig.cadenza_duplicate_window_seconds,
      cadenza_max_lockup_hours: bankConfig.cadenza_max_lockup_hours,
    },
    networkRules: {
      networkModeContext,
      autoAcceptCeiling: bankConfig.auto_accept_ceiling,
    },
  };

  const prompt = buildCadenzaMonitoringPrompt(monitoringParams);

  // 9. Call Gemini
  console.log(`[cadenza] │ Calling Gemini for monitoring decision...`);
  let decision: {
    decision: string;
    confidence: number;
    reasoning: string;
    flag_type: string | null;
    risk_factors: string[];
  };

  try {
    decision = await callGeminiJSON<typeof decision>(
      CADENZA_SYSTEM_IDENTITY,
      prompt,
      { temperature: 0.3, maxTokens: 4096 },
    );
  } catch (geminiErr) {
    console.log(`[cadenza] │ Gemini error: ${(geminiErr as Error).message}`);
    throw new Error(`Gemini call failed: ${(geminiErr as Error).message}`);
  }

  console.log(`[cadenza] │ Full parsed decision object: ${JSON.stringify(decision)}`);
  console.log(`[cadenza] │ Decision: ${decision.decision} (confidence: ${decision.confidence})`);
  console.log(`[cadenza] │ Reasoning: ${decision.reasoning?.slice(0, 200)}...`);

  // ── Re-verify lockup status (prevent race condition) ──
  const { data: lockupCheck } = await supabase
    .from("lockup_tokens")
    .select("status")
    .eq("id", lockupId)
    .single();

  if (!lockupCheck || !["active", "escalated"].includes(lockupCheck.status)) {
    console.log(`[cadenza] │ Lockup status changed during Gemini call — aborting action`);
    return {
      lockup_id: lockupId,
      decision: decision.decision,
      confidence: decision.confidence,
      reasoning: decision.reasoning,
      flag_type: decision.flag_type,
      risk_factors: decision.risk_factors || [],
      action_taken: "aborted_race_condition",
      action_result: { message: `Lockup status changed to '${lockupCheck?.status}' during evaluation` },
    };
  }

  const now = new Date().toISOString();
  let actionTaken: string | null = null;
  let actionResult: any = null;

  // 10. Execute decision
  if (decision.decision === "ALL_CLEAR") {
    console.log(`[cadenza] │ ALL_CLEAR — updating lockup and triggering settlement`);

    // Update lockup + transaction status before calling lockup-settle
    await supabase.from("lockup_tokens").update({
      resolution: "cadenza_all_clear",
    }).eq("id", lockupId);

    await supabase.from("transactions").update({
      lockup_status: "cadenza_cleared",
    }).eq("id", tx.id);

    // Task 118.2: Direct call to coreLockupSettle (bypasses HTTP, avoids 401)
    actionResult = await coreLockupSettle({ lockup_id: lockupId });
    if (actionResult?.error) {
      console.log(`[cadenza] │ /lockup-settle error: ${actionResult.error} — rolling back`);
      await supabase.from("lockup_tokens").update({ resolution: null }).eq("id", lockupId);
      await supabase.from("transactions").update({ lockup_status: "active" }).eq("id", tx.id);
      actionTaken = "settle_failed";
    } else {
      actionTaken = "settled";
    }
    console.log(`[cadenza] │ Settlement result: ${JSON.stringify(actionResult).slice(0, 200)}`);

  } else if (decision.decision === "AUTO_REVERSE") {
    console.log(`[cadenza] │ AUTO_REVERSE — inserting flag and triggering reversal`);

    // Insert cadenza_flags record
    await supabase.from("cadenza_flags").insert({
      id: crypto.randomUUID(),
      transaction_id: tx.id,
      lockup_token_id: lockupId,
      flag_type: decision.flag_type || "anomaly_detected",
      severity: "auto_reverse",
      reasoning: decision.reasoning,
      detected_at: now,
      action_taken: "reversed",
      action_at: now,
    });

    // Task 118.2: Direct call to coreLockupReverse (bypasses HTTP, avoids 401)
    actionResult = await coreLockupReverse({
      lockup_id: lockupId,
      reason: `cadenza_auto_reverse: ${decision.flag_type || 'anomaly'} — ${decision.reasoning?.slice(0, 200)}`,
    });
    if (actionResult?.error) {
      console.log(`[cadenza] │ /lockup-reverse error: ${actionResult.error}`);
      actionTaken = "reverse_failed";
    } else {
      actionTaken = "reversed";
    }
    console.log(`[cadenza] │ Reversal result: ${JSON.stringify(actionResult).slice(0, 200)}`);

  } else if (decision.decision === "ESCALATE") {
    console.log(`[cadenza] │ ESCALATE — inserting flag, setting infinite lockup`);

    // Insert cadenza_flags record
    await supabase.from("cadenza_flags").insert({
      id: crypto.randomUUID(),
      transaction_id: tx.id,
      lockup_token_id: lockupId,
      flag_type: decision.flag_type || "anomaly_detected",
      severity: "escalate",
      reasoning: decision.reasoning,
      detected_at: now,
      action_taken: "escalated",
      action_at: now,
    });

    // Set lockup_end = NULL (infinite), status = escalated
    await supabase.from("lockup_tokens").update({
      lockup_end: null,
      status: "escalated",
    }).eq("id", lockupId);

    // Update transaction lockup_status
    await supabase.from("transactions").update({
      lockup_status: "cadenza_escalated",
    }).eq("id", tx.id);

    actionTaken = "escalated";
    actionResult = { message: "Lockup escalated to human review — infinite hold" };
    console.log(`[cadenza] │ Lockup escalated to human review`);

  } else {
    // Unrecognized decision — treat as no-op
    console.log(`[cadenza] │ Unrecognized decision '${decision.decision}' — no action`);
    actionTaken = "no_action";
    actionResult = { message: `Unrecognized decision: ${decision.decision}` };
  }

  // 11. Insert agent_message with Cadenza's reasoning (non-blocking — don't crash scan on insert failure)
  const amountDisplay = tx.amount_display || (Number(tx.amount) / 1_000_000);
  try {
    await supabase.from("agent_messages").insert({
      id: crypto.randomUUID(),
      transaction_id: tx.id,
      from_bank_id: tx.receiver_bank_id,
      to_bank_id: tx.sender_bank_id,
      message_type: "cadenza_decision",
      content: {
        agent_id: "solstice_ai_cadenza",
        action: decision.decision.toLowerCase(),
        lockup_id: lockupId,
        confidence: decision.confidence,
        flag_type: decision.flag_type,
        risk_factors: decision.risk_factors,
        action_taken: actionTaken,
      },
      natural_language: `Cadenza \u2014 ${decision.decision} (${(decision.confidence * 100).toFixed(0)}% confidence) for $${Number(amountDisplay).toLocaleString()} ${senderBank.short_code} \u2192 ${receiverBank.short_code}. ${decision.reasoning?.slice(0, 300)}`,
      processed: false,
      created_at: now,
    });
  } catch (msgErr) {
    console.log(`[cadenza] ⚠ agent_message insert failed (non-blocking): ${(msgErr as Error).message}`);
  }

  console.log(`[cadenza] └─ scan_lockup complete: ${decision.decision} for lockup ${lockupId.slice(0, 8)}`);

  return {
    lockup_id: lockupId,
    decision: decision.decision,
    confidence: decision.confidence,
    reasoning: decision.reasoning,
    flag_type: decision.flag_type,
    risk_factors: decision.risk_factors || [],
    action_taken: actionTaken,
    action_result: actionResult,
  };
}

// ── Core user_reversal function (reusable from route + proving-ground) ──

async function coreCadenzaUserReversal(lockupId: string, reason: string): Promise<any> {
  const supabase = getAdminClient();
  const now = new Date().toISOString();

  // Validate lockup is still active
  const { data: lockup, error: lockupErr } = await supabase
    .from("lockup_tokens")
    .select("id, transaction_id, status, sender_bank_id, receiver_bank_id")
    .eq("id", lockupId)
    .single();

  if (lockupErr || !lockup) {
    throw new Error(`Lockup not found: ${lockupErr?.message || 'missing'}`);
  }

  if (!["active", "escalated"].includes(lockup.status)) {
    throw new Error(`Lockup status is '${lockup.status}' — must be 'active' or 'escalated' for user reversal`);
  }

  console.log(`[cadenza] ▶ user_reversal for lockup ${lockupId.slice(0, 8)}`);

  // Insert cadenza_flags record
  await supabase.from("cadenza_flags").insert({
    id: crypto.randomUUID(),
    transaction_id: lockup.transaction_id,
    lockup_token_id: lockupId,
    flag_type: "user_reversal_request",
    severity: "auto_reverse",
    reasoning: reason || "User-initiated reversal request",
    detected_at: now,
    action_taken: "reversed",
    action_at: now,
  });

  // Task 118.2: Direct call to coreLockupReverse (no Gemini needed — user authority)
  const reversalReason = `user_requested_reversal: ${reason || 'operator-initiated'}`;
  const result = await coreLockupReverse({
    lockup_id: lockupId,
    reason: reversalReason,
    caller_resolution: "user_reversal",
    caller_resolved_by: "user_request",
  });

  // Insert agent_message (non-blocking — don't crash user_reversal on insert failure)
  try {
    await supabase.from("agent_messages").insert({
      id: crypto.randomUUID(),
      transaction_id: lockup.transaction_id,
      from_bank_id: lockup.receiver_bank_id,
      to_bank_id: lockup.sender_bank_id,
      message_type: "cadenza_decision",
      content: {
        agent_id: "solstice_ai_cadenza",
        action: "user_reversal",
        lockup_id: lockupId,
        reason: reversalReason,
      },
      natural_language: `Cadenza \u2014 User-initiated reversal for lockup ${lockupId.slice(0, 8)}. Reason: ${reason || 'operator-initiated'}. No Gemini evaluation required.`,
      processed: false,
      created_at: now,
    });
  } catch (msgErr) {
    console.log(`[cadenza] \u26a0 user_reversal agent_message insert failed (non-blocking): ${(msgErr as Error).message}`);
  }

  console.log(`[cadenza] \u2514\u2500 user_reversal complete for lockup ${lockupId.slice(0, 8)}`);

  return {
    status: "reversed",
    lockup_id: lockupId,
    transaction_id: lockup.transaction_id,
    action: "user_reversal",
    reversal_result: result,
  };
}

// ── Inject Cadenza handlers into Proving Ground (bypasses HTTP self-call 401) ──
// Same pattern as A2A orchestration fix at line 2334.
setCadenzaDirectHandlers(coreCadenzaScanLockup, coreCadenzaUserReversal);

// ── Inject agent handlers (Concord, Fermata, Maestro) into Proving Ground ──
// Task 113: Same pattern — all PG scenarios now call core functions directly.
setAgentDirectHandlers(
  coreComplianceCheck,
  coreRiskScore,
  async (bankId: string, input: string, transactionId: string | null, contextType: string) => {
    const supabase = getAdminClient();
    return coreAgentThink(supabase, bankId, input, transactionId, contextType);
  },
);

// ── Core periodic scan function (reusable from route + heartbeat) ──

interface CadenzaPeriodicScanResult {
  lockups_scanned: number;
  decisions: CadenzaScanResult[];
  skipped: { lockup_id: string; reason: string }[];
}

async function coreCadenzaPeriodicScan(options?: {
  heartbeatMode?: boolean; // Only scan lockups near expiry
}): Promise<CadenzaPeriodicScanResult> {
  const supabase = getAdminClient();
  const now = Date.now();
  const thirtySecondsAgo = new Date(now - 30_000).toISOString();

  console.log(`[cadenza] \u25b6 periodic_scan${options?.heartbeatMode ? ' (heartbeat mode)' : ''}`);

  // ────────────────────────────────────────────────────────────────
  // Step 0: Sweep expired orchestrator-inline lockups (NO lockup_tokens row)
  // The orchestrator inline path (Task 117.3) does a real PvP transfer
  // on-chain but marks status='locked' with a lockup_until timer.
  // No lockup_tokens record is created, so Cadenza's lockup_tokens-based
  // scan never finds them. We auto-settle these when lockup_until passes.
  // Also fast-path settles real lockup_tokens that have expired.
  // ────────────────────────────────────────────────────────────────
  try {
    const nowIso = new Date().toISOString();
    const { data: expiredInlineTxs, error: expiredErr } = await supabase
      .from("transactions")
      .select("id, lockup_until, lockup_status, amount_display, sender_bank_id, receiver_bank_id")
      .eq("status", "locked")
      .not("lockup_until", "is", null)
      .lte("lockup_until", nowIso);

    if (!expiredErr && expiredInlineTxs && expiredInlineTxs.length > 0) {
      console.log(`[cadenza] \u2502 Found ${expiredInlineTxs.length} expired locked tx(es) \u2014 checking for auto-settle`);

      for (const expTx of expiredInlineTxs) {
        // Check if this tx has a lockup_tokens record
        const { data: ltRecord } = await supabase
          .from("lockup_tokens")
          .select("id, status")
          .eq("transaction_id", expTx.id)
          .in("status", ["active", "escalated"])
          .maybeSingle();

        if (ltRecord) {
          // Has a real lockup_tokens row \u2014 fast-path settle (skip Gemini)
          console.log(`[cadenza] \u2502 Expired lockup with lockup_tokens: ${expTx.id.slice(0, 8)} \u2014 fast-path settle`);
          try {
            await supabase.from("lockup_tokens").update({ resolution: "expired_auto_settle" }).eq("id", ltRecord.id);
            await supabase.from("transactions").update({ lockup_status: "cadenza_cleared" }).eq("id", expTx.id);
            // Task 118.2: Direct call to coreLockupSettle (bypasses HTTP, avoids 401)
            await coreLockupSettle({ lockup_id: ltRecord.id, caller_resolution: "expired_auto_settle", caller_resolved_by: "cadenza_periodic" });
            console.log(`[cadenza] \u2502 \u2192 Settled lockup_tokens ${ltRecord.id.slice(0, 8)} for tx ${expTx.id.slice(0, 8)}`);
          } catch (settleErr) {
            console.log(`[cadenza] \u2502 \u2192 Fast-path settle failed: ${(settleErr as Error).message}`);
          }
        } else {
          // No lockup_tokens row \u2014 orchestrator inline lockup. Funds already on-chain.
          // Just update DB status to settled.
          console.log(`[cadenza] \u2502 Expired inline lockup (no lockup_tokens): ${expTx.id.slice(0, 8)} \u2014 auto-settling`);
          const { error: updateErr } = await supabase.from("transactions").update({
            status: "settled",
            lockup_status: "hard_settled",
            settled_at: nowIso,
            is_reversible: false,
          }).eq("id", expTx.id);

          if (updateErr) {
            console.log(`[cadenza] \u2502 \u2192 Auto-settle update failed: ${updateErr.message}`);
          } else {
            console.log(`[cadenza] \u2502 \u2192 Auto-settled tx ${expTx.id.slice(0, 8)} (inline lockup expired)`);
            // Insert agent_message for audit trail
            await supabase.from("agent_messages").insert({
              id: crypto.randomUUID(),
              transaction_id: expTx.id,
              from_bank_id: expTx.receiver_bank_id,
              to_bank_id: expTx.sender_bank_id,
              message_type: "settlement_confirm",
              content: {
                agent_id: "solstice_ai_cadenza",
                action: "auto_settle_expired",
                lockup_until: expTx.lockup_until,
              },
              natural_language: `Cadenza \u2014 Lockup timer expired. Transaction auto-settled to hard finality. Amount: $${Number(expTx.amount_display || 0).toLocaleString()}.`,
              processed: false,
              created_at: nowIso,
            });
          }
        }
      }
    }
  } catch (sweepErr) {
    console.log(`[cadenza] \u2502 Expired lockup sweep error (non-blocking): ${(sweepErr as Error).message}`);
  }

  // 1. Query all active lockups (not escalated \u2014 those wait for humans)
  const { data: activeLockups, error: lockupErr } = await supabase
    .from("lockup_tokens")
    .select("id, transaction_id, lockup_start, lockup_end, status, created_at, sender_bank_id, receiver_bank_id")
    .eq("status", "active")
    .lte("created_at", thirtySecondsAgo) // Skip lockups < 30s old
    .order("lockup_end", { ascending: true, nullsFirst: false });

  if (lockupErr) {
    throw new Error(`Failed to query active lockups: ${lockupErr.message}`);
  }

  if (!activeLockups || activeLockups.length === 0) {
    console.log(`[cadenza] │ No active lockups to scan`);
    return { lockups_scanned: 0, decisions: [], skipped: [] };
  }

  console.log(`[cadenza] │ Found ${activeLockups.length} active lockup(s)`);

  const decisions: CadenzaScanResult[] = [];
  const skipped: { lockup_id: string; reason: string }[] = [];

  // In heartbeat mode, only process lockups where lockup_end is
  // within 30s of expiry or already past
  const lockupsToScan = options?.heartbeatMode
    ? activeLockups.filter(l => {
        if (!l.lockup_end) return false; // infinite lockups skip in heartbeat mode
        const endMs = new Date(l.lockup_end).getTime();
        return endMs - now <= 30_000; // within 30s of expiry or past
      })
    : activeLockups;

  // Track which lockups we skip in heartbeat mode
  if (options?.heartbeatMode) {
    for (const l of activeLockups) {
      if (!lockupsToScan.includes(l)) {
        skipped.push({ lockup_id: l.id, reason: "not_near_expiry" });
      }
    }
    console.log(`[cadenza] │ Heartbeat mode: ${lockupsToScan.length} near-expiry, ${skipped.length} skipped`);
  }

  if (lockupsToScan.length === 0) {
    console.log(`[cadenza] │ No lockups ready for scanning`);
    return { lockups_scanned: 0, decisions, skipped };
  }

  // 2. For each lockup: run individual scan_lockup
  for (const lockup of lockupsToScan) {
    try {
      // Re-check status (may have changed during previous iterations)
      const { data: check } = await supabase
        .from("lockup_tokens")
        .select("status")
        .eq("id", lockup.id)
        .single();

      if (!check || check.status !== "active") {
        skipped.push({ lockup_id: lockup.id, reason: `status_changed_to_${check?.status || 'unknown'}` });
        continue;
      }

      const result = await coreCadenzaScanLockup(lockup.id);
      decisions.push(result);

      // Small delay between scans to avoid Gemini rate limits
      if (lockupsToScan.indexOf(lockup) < lockupsToScan.length - 1) {
        await new Promise(r => setTimeout(r, 1000));
      }
    } catch (err) {
      console.log(`[cadenza] │ Error scanning lockup ${lockup.id.slice(0, 8)}: ${(err as Error).message}`);
      skipped.push({ lockup_id: lockup.id, reason: (err as Error).message });
    }
  }

  console.log(`[cadenza] └─ periodic_scan complete: ${decisions.length} scanned, ${skipped.length} skipped`);

  return {
    lockups_scanned: decisions.length,
    decisions,
    skipped,
  };
}

// ── Route handler ──

app.post("/make-server-49d15288/cadenza-monitor", async (c) => {
  console.log(`[cadenza-monitor] ████ ROUTE HIT ████ ${new Date().toISOString()}`);
  try {
    const { action, lockup_id, reason } = await c.req.json();
    console.log(`[cadenza-monitor] action=${action}, lockup_id=${lockup_id?.slice(0, 8)}`);

    if (!action) {
      return c.json({ error: "Missing required field: action (scan_lockup | periodic_scan | user_reversal)" }, 400);
    }

    // ── Action: scan_lockup (single transaction) ──
    if (action === "scan_lockup") {
      if (!lockup_id) {
        return c.json({ error: "Missing required field: lockup_id for scan_lockup action" }, 400);
      }

      const result = await coreCadenzaScanLockup(lockup_id);
      return c.json(result);
    }

    // ── Action: periodic_scan (batch — all active lockups) ──
    if (action === "periodic_scan") {
      const result = await coreCadenzaPeriodicScan();
      return c.json(result);
    }

    // ── Action: user_reversal (user-initiated) ──
    if (action === "user_reversal") {
      if (!lockup_id) {
        return c.json({ error: "Missing required field: lockup_id for user_reversal action" }, 400);
      }

      const result = await coreCadenzaUserReversal(lockup_id, reason || '');
      return c.json(result);
    }

    return c.json({ error: `Unknown action: ${action}. Valid: scan_lockup, periodic_scan, user_reversal` }, 400);

  } catch (err) {
    console.log(`[cadenza-monitor] Error: ${(err as Error).message}`);
    return c.json({ error: `Cadenza monitor error: ${(err as Error).message}` }, 500);
  }
});

// ============================================================
// 29. CADENZA-ESCALATE — Human review for escalated lockups
//     Actions: get_escalations, resolve_escalation, get_briefing
//     The human-in-the-loop path for Cadenza-escalated transactions.
// ============================================================

app.post("/make-server-49d15288/cadenza-escalate", async (c) => {
  try {
    const body = await c.req.json();
    const { action } = body;

    if (!action) {
      return c.json({ error: "Missing required field: action (get_escalations | resolve_escalation | get_briefing)" }, 400);
    }

    const supabase = getAdminClient();

    // ── Action: get_escalations — list all escalated lockups ──
    if (action === "get_escalations") {
      console.log(`[cadenza-escalate] ▶ get_escalations`);

      const { data: escalated, error: escErr } = await supabase
        .from("lockup_tokens")
        .select("*, transaction:transactions(id, amount, amount_display, purpose_code, memo, status, risk_level, risk_score, risk_reasoning, lockup_status, created_at, initiated_at, solana_tx_signature, sender_bank_id, receiver_bank_id, sender_bank:banks!transactions_sender_bank_id_fkey(id, name, short_code, jurisdiction, tier, status, swift_bic), receiver_bank:banks!transactions_receiver_bank_id_fkey(id, name, short_code, jurisdiction, tier, status, swift_bic))")
        .eq("status", "escalated")
        .order("created_at", { ascending: false });

      if (escErr) {
        return c.json({ error: `Failed to query escalated lockups: ${escErr.message}` }, 500);
      }

      if (!escalated || escalated.length === 0) {
        console.log(`[cadenza-escalate] │ No escalated lockups`);
        return c.json({ escalations: [], count: 0 });
      }

      // Fetch flags for all escalated lockups
      const lockupIds = escalated.map(l => l.id);
      const { data: allFlags } = await supabase
        .from("cadenza_flags")
        .select("*")
        .in("lockup_token_id", lockupIds)
        .order("detected_at", { ascending: true });

      const flagsByLockup = new Map<string, any[]>();
      for (const f of (allFlags || [])) {
        const existing = flagsByLockup.get(f.lockup_token_id) || [];
        existing.push(f);
        flagsByLockup.set(f.lockup_token_id, existing);
      }

      const now = new Date().toISOString();
      const enriched = escalated.map(lockup => {
        const tx = lockup.transaction as any;
        const flags = flagsByLockup.get(lockup.id) || [];

        // Calculate time in escalation
        const escalatedFlag = flags.find((f: any) => f.severity === "escalate");
        const escalatedAt = escalatedFlag?.detected_at || lockup.created_at;
        const escalationDurationSeconds = Math.floor(
          (Date.now() - new Date(escalatedAt).getTime()) / 1000
        );

        // Calculate current yield on-the-fly
        let currentYieldRaw = BigInt(lockup.yield_accrued || 0);
        try {
          const yieldDelta = calculateAccruedYield(
            BigInt(lockup.yb_token_amount),
            lockup.yield_rate_bps || 525,
            lockup.yield_last_calculated || lockup.lockup_start || lockup.created_at,
            now,
          );
          currentYieldRaw += yieldDelta;
        } catch { /* use stored value */ }

        const currentYieldDisplay = formatYieldUsd(currentYieldRaw);

        return {
          lockup_id: lockup.id,
          transaction_id: lockup.transaction_id,
          sender_bank: tx?.sender_bank || null,
          receiver_bank: tx?.receiver_bank || null,
          amount_display: tx?.amount_display || 0,
          purpose_code: tx?.purpose_code || "unspecified",
          memo: tx?.memo || null,
          risk_level: tx?.risk_level || "unknown",
          risk_score: tx?.risk_score || 0,
          risk_reasoning: tx?.risk_reasoning || null,
          yb_token_symbol: lockup.yb_token_symbol,
          yb_token_amount: lockup.yb_token_amount,
          tb_token_symbol: lockup.tb_token_symbol,
          tb_token_amount: lockup.tb_token_amount,
          yield_rate_bps: lockup.yield_rate_bps,
          yield_accrued_raw: currentYieldRaw.toString(),
          yield_accrued_display: currentYieldDisplay,
          lockup_start: lockup.lockup_start,
          lockup_end: lockup.lockup_end,
          status: lockup.status,
          resolution: lockup.resolution,
          escalated_at: escalatedAt,
          escalation_duration_seconds: escalationDurationSeconds,
          escalation_duration_display: escalationDurationSeconds >= 3600
            ? `${Math.floor(escalationDurationSeconds / 3600)}h ${Math.floor((escalationDurationSeconds % 3600) / 60)}m`
            : `${Math.floor(escalationDurationSeconds / 60)}m ${escalationDurationSeconds % 60}s`,
          flags,
          flag_count: flags.length,
          transaction_created_at: tx?.created_at || null,
          solana_tx_signature: tx?.solana_tx_signature || null,
        };
      });

      console.log(`[cadenza-escalate] └─ Returning ${enriched.length} escalated lockup(s)`);
      return c.json({ escalations: enriched, count: enriched.length });
    }

    // ── Action: resolve_escalation — human approve/reverse ──
    if (action === "resolve_escalation") {
      const { lockup_id, decision, operator_name } = body;

      if (!lockup_id) return c.json({ error: "Missing required field: lockup_id" }, 400);
      if (!decision || !["approve", "reverse"].includes(decision)) {
        return c.json({ error: "Missing or invalid field: decision (must be 'approve' or 'reverse')" }, 400);
      }
      if (!operator_name) return c.json({ error: "Missing required field: operator_name" }, 400);

      console.log(`[cadenza-escalate] ▶ resolve_escalation: ${decision} by ${operator_name} for lockup ${lockup_id.slice(0, 8)}`);

      // Verify lockup is escalated
      const { data: lockup, error: lockupErr } = await supabase
        .from("lockup_tokens")
        .select("id, transaction_id, status, sender_bank_id, receiver_bank_id, yb_token_amount, yield_accrued, yield_rate_bps, yield_last_calculated, lockup_start")
        .eq("id", lockup_id)
        .single();

      if (lockupErr || !lockup) {
        return c.json({ error: `Lockup not found: ${lockupErr?.message || 'missing'}` }, 404);
      }

      if (lockup.status !== "escalated") {
        console.log(`[cadenza-escalate] │ Lockup status=${lockup.status}, expected 'escalated'`);
        return c.json({ error: `Lockup status is '${lockup.status}' — must be 'escalated' for human resolution` }, 400);
      }

      // Load transaction for agent_message
      const { data: tx } = await supabase
        .from("transactions")
        .select("id, amount_display, sender_bank_id, receiver_bank_id, sender_bank:banks!transactions_sender_bank_id_fkey(short_code, name), receiver_bank:banks!transactions_receiver_bank_id_fkey(short_code, name)")
        .eq("id", lockup.transaction_id)
        .single();

      const senderCode = (tx?.sender_bank as any)?.short_code || "?";
      const receiverCode = (tx?.receiver_bank as any)?.short_code || "?";
      const amountDisplay = tx?.amount_display || 0;

      const now = new Date().toISOString();
      const resolvedBy = `operator:${operator_name}`;

      if (decision === "approve") {
        console.log(`[cadenza-escalate] │ APPROVE — updating resolution, calling lockup-settle`);

        // Update lockup metadata before settlement
        await supabase.from("lockup_tokens").update({
          resolution: "human_approved",
          resolved_by: resolvedBy,
          resolved_at: now,
        }).eq("id", lockup_id);

        await supabase.from("transactions").update({
          lockup_status: "cadenza_cleared",
        }).eq("id", lockup.transaction_id);

        // Task 118.2: Direct call to coreLockupSettle (bypasses HTTP, avoids 401 on internal fetch)
        const settleResult = await coreLockupSettle({
          lockup_id,
          caller_resolution: "human_approved",
          caller_resolved_by: resolvedBy,
        });

        // Check if settlement failed — propagate error
        if (settleResult?.error) {
          console.log(`[cadenza-escalate] │ /lockup-settle failed: ${settleResult.error} — rolling back`);
          await supabase.from("lockup_tokens").update({ resolution: null, resolved_by: null, resolved_at: null }).eq("id", lockup_id);
          await supabase.from("transactions").update({ lockup_status: "cadenza_escalated" }).eq("id", lockup.transaction_id);
          return c.json({ error: `Settlement failed: ${settleResult.error}` }, 500);
        }

        // Insert agent_message
        await supabase.from("agent_messages").insert({
          id: crypto.randomUUID(),
          transaction_id: lockup.transaction_id,
          from_bank_id: lockup.receiver_bank_id,
          to_bank_id: lockup.sender_bank_id,
          message_type: "cadenza_decision",
          content: {
            agent_id: "solstice_ai_cadenza",
            action: "human_approved",
            lockup_id,
            operator: operator_name,
            decision: "approve",
            settle_result: settleResult,
          },
          natural_language: `Cadenza \u2014 Human review complete. ${operator_name} approved settlement of $${Number(amountDisplay).toLocaleString()} ${senderCode} \u2192 ${receiverCode}. Lockup released to hard finality.`,
          processed: false,
          created_at: now,
        });

        // Insert cadenza_flag to record the human decision
        await supabase.from("cadenza_flags").insert({
          id: crypto.randomUUID(),
          transaction_id: lockup.transaction_id,
          lockup_token_id: lockup_id,
          flag_type: "human_resolution",
          severity: "info",
          reasoning: `Approved by ${operator_name}`,
          detected_at: now,
          action_taken: "approved",
          action_at: now,
        });

        console.log(`[cadenza-escalate] └─ APPROVED by ${operator_name}`);

        return c.json({
          status: "approved",
          lockup_id,
          transaction_id: lockup.transaction_id,
          operator: operator_name,
          resolved_by: resolvedBy,
          settle_result: settleResult,
        });

      } else {
        // decision === "reverse"
        console.log(`[cadenza-escalate] │ REVERSE — updating resolution, calling lockup-reverse`);

        // Update lockup metadata before reversal
        await supabase.from("lockup_tokens").update({
          resolution: "human_reversed",
          resolved_by: resolvedBy,
          resolved_at: now,
        }).eq("id", lockup_id);

        const reversalReason = `human_reversed by ${operator_name}`;

        // Task 118.2: Direct call to coreLockupReverse (bypasses HTTP, avoids 401 on internal fetch)
        const reverseResult = await coreLockupReverse({
          lockup_id,
          reason: reversalReason,
          caller_resolution: "human_reversed",
          caller_resolved_by: resolvedBy,
        });

        // Check if reversal failed — propagate error
        if (reverseResult?.error) {
          console.log(`[cadenza-escalate] │ /lockup-reverse failed: ${reverseResult.error} — rolling back`);
          await supabase.from("lockup_tokens").update({ resolution: null, resolved_by: null, resolved_at: null }).eq("id", lockup_id);
          return c.json({ error: `Reversal failed: ${reverseResult.error}` }, 500);
        }

        // Insert agent_message
        await supabase.from("agent_messages").insert({
          id: crypto.randomUUID(),
          transaction_id: lockup.transaction_id,
          from_bank_id: lockup.receiver_bank_id,
          to_bank_id: lockup.sender_bank_id,
          message_type: "cadenza_decision",
          content: {
            agent_id: "solstice_ai_cadenza",
            action: "human_reversed",
            lockup_id,
            operator: operator_name,
            decision: "reverse",
            reverse_result: reverseResult,
          },
          natural_language: `Cadenza \u2014 Human review complete. ${operator_name} reversed $${Number(amountDisplay).toLocaleString()} ${senderCode} \u2192 ${receiverCode}. Funds clawed back to sender.`,
          processed: false,
          created_at: now,
        });

        // Insert cadenza_flag to record the human decision
        await supabase.from("cadenza_flags").insert({
          id: crypto.randomUUID(),
          transaction_id: lockup.transaction_id,
          lockup_token_id: lockup_id,
          flag_type: "human_resolution",
          severity: "info",
          reasoning: `Reversed by ${operator_name}`,
          detected_at: now,
          action_taken: "reversed",
          action_at: now,
        });

        console.log(`[cadenza-escalate] └─ REVERSED by ${operator_name}`);

        return c.json({
          status: "reversed",
          lockup_id,
          transaction_id: lockup.transaction_id,
          operator: operator_name,
          resolved_by: resolvedBy,
          reverse_result: reverseResult,
        });
      }
    }

    // ── Action: get_briefing — on-demand Gemini escalation briefing ──
    if (action === "get_briefing") {
      const { lockup_id } = body;

      if (!lockup_id) return c.json({ error: "Missing required field: lockup_id" }, 400);

      console.log(`[cadenza-escalate] ▶ get_briefing for lockup ${lockup_id.slice(0, 8)}`);

      // Load lockup
      const { data: lockup, error: lockupErr } = await supabase
        .from("lockup_tokens")
        .select("*")
        .eq("id", lockup_id)
        .single();

      if (lockupErr || !lockup) {
        return c.json({ error: `Lockup not found: ${lockupErr?.message || 'missing'}` }, 404);
      }

      if (lockup.status !== "escalated") {
        return c.json({ error: `Lockup status is '${lockup.status}' — briefings are only generated for escalated lockups` }, 400);
      }

      // Load transaction + banks
      const { data: tx, error: txErr } = await supabase
        .from("transactions")
        .select("*, sender_bank:banks!transactions_sender_bank_id_fkey(id, name, short_code, jurisdiction, tier, status, swift_bic), receiver_bank:banks!transactions_receiver_bank_id_fkey(id, name, short_code, jurisdiction, tier, status, swift_bic)")
        .eq("id", lockup.transaction_id)
        .single();

      if (txErr || !tx) {
        return c.json({ error: `Transaction not found: ${txErr?.message || 'missing'}` }, 404);
      }

      const senderBank = tx.sender_bank as any;
      const receiverBank = tx.receiver_bank as any;

      // Load all flags
      const { data: flagsRaw } = await supabase
        .from("cadenza_flags")
        .select("*")
        .eq("lockup_token_id", lockup_id)
        .order("detected_at", { ascending: true });

      const flags: CadenzaFlag[] = (flagsRaw || []).map((f: any) => ({
        id: f.id,
        flag_type: f.flag_type,
        severity: f.severity,
        reasoning: f.reasoning || "",
        detected_at: f.detected_at,
        action_taken: f.action_taken,
        action_at: f.action_at,
      }));

      // Calculate current yield on-the-fly for the briefing
      const now = new Date().toISOString();
      let currentYieldRaw = BigInt(lockup.yield_accrued || 0);
      try {
        const yieldDelta = calculateAccruedYield(
          BigInt(lockup.yb_token_amount),
          lockup.yield_rate_bps || 525,
          lockup.yield_last_calculated || lockup.lockup_start || lockup.created_at,
          now,
        );
        currentYieldRaw += yieldDelta;
      } catch { /* use stored value */ }

      // Build network mode context
      const networkModeContext = await getNetworkModeContext();

      // Build escalation prompt
      const escalationParams: CadenzaEscalationParams = {
        networkModeContext,
        lockupToken: {
          id: lockup.id,
          transaction_id: lockup.transaction_id,
          sender_bank_id: lockup.sender_bank_id,
          receiver_bank_id: lockup.receiver_bank_id,
          yb_token_mint: lockup.yb_token_mint,
          yb_token_symbol: lockup.yb_token_symbol,
          yb_token_amount: String(lockup.yb_token_amount),
          yb_holder: lockup.yb_holder,
          tb_token_mint: lockup.tb_token_mint || null,
          tb_token_symbol: lockup.tb_token_symbol || null,
          tb_token_amount: lockup.tb_token_amount ? String(lockup.tb_token_amount) : null,
          tb_holder: lockup.tb_holder || null,
          yield_rate_bps: lockup.yield_rate_bps || 525,
          yield_accrued: currentYieldRaw.toString(),
          lockup_start: lockup.lockup_start || lockup.created_at,
          lockup_end: lockup.lockup_end,
          status: lockup.status,
          resolution: lockup.resolution,
          created_at: lockup.created_at,
        },
        transaction: {
          id: tx.id,
          amount: tx.amount,
          amount_display: tx.amount_display,
          purpose_code: tx.purpose_code,
          memo: tx.memo,
          status: tx.status,
          risk_level: tx.risk_level,
          risk_score: tx.risk_score,
          risk_reasoning: tx.risk_reasoning,
          lockup_status: tx.lockup_status,
          created_at: tx.created_at,
          initiated_at: tx.initiated_at,
          solana_tx_signature: tx.solana_tx_signature,
        },
        senderBank: {
          id: senderBank.id,
          name: senderBank.name,
          short_code: senderBank.short_code,
          jurisdiction: senderBank.jurisdiction,
          tier: senderBank.tier,
          status: senderBank.status,
          swift_bic: senderBank.swift_bic,
        },
        receiverBank: {
          id: receiverBank.id,
          name: receiverBank.name,
          short_code: receiverBank.short_code,
          jurisdiction: receiverBank.jurisdiction,
          tier: receiverBank.tier,
          status: receiverBank.status,
          swift_bic: receiverBank.swift_bic,
        },
        flags,
        operatorContext: `Current yield accrued: ${formatYieldUsd(currentYieldRaw)} (${currentYieldRaw.toString()} raw units). Yield rate: ${(lockup.yield_rate_bps || 525) / 100}% annualized.`,
      };

      const prompt = buildCadenzaEscalationPrompt(escalationParams);

      // Call Gemini for briefing (text mode to capture SAR_DRAFT block)
      console.log(`[cadenza-escalate] │ Calling Gemini for escalation briefing + SAR draft...`);
      let briefing: any;
      let sarDraft: any = null;
      try {
        const rawText = await callGemini(
          CADENZA_SYSTEM_IDENTITY,
          prompt,
          { temperature: 0.4, maxTokens: 4096 },
        );

        // Parse JSON briefing from raw text
        const jsonMatch = rawText.match(/\{[\s\S]*?\n\}/);
        if (jsonMatch) {
          briefing = JSON.parse(jsonMatch[0]);
        } else {
          briefing = JSON.parse(rawText);
        }

        // Parse SAR_DRAFT_START...SAR_DRAFT_END block
        const sarMatch = rawText.match(/SAR_DRAFT_START\s*\n([\s\S]*?)SAR_DRAFT_END/);
        if (sarMatch) {
          const sarText = sarMatch[1].trim();
          const subjectMatch = sarText.match(/Subject:\s*(.+)/);
          const txMatch = sarText.match(/Transaction:\s*(.+)/);
          const typologyMatch = sarText.match(/Typology:\s*(.+)/);
          const actionMatch = sarText.match(/Recommended Action:\s*(.+)/);

          // Extract bullet indicators
          const indicatorsMatch = sarText.match(/Suspicious Indicators:\s*([\s\S]*?)(?=Typology:|Recommended Action:|$)/);
          const indicators: string[] = [];
          if (indicatorsMatch) {
            for (const line of indicatorsMatch[1].split('\n')) {
              const cleaned = line.replace(/^[\s\-\*\u2022]+/, '').trim();
              if (cleaned) indicators.push(cleaned);
            }
          }

          const typologyRaw = (typologyMatch?.[1] || '').trim().toLowerCase().replace(/\s+/g, '_');
          const validTypologies = ['structuring', 'velocity_abuse', 'sanctions_evasion', 'duplicate_pattern', 'anomalous_behavior'];
          const typology = validTypologies.includes(typologyRaw) ? typologyRaw : 'anomalous_behavior';

          const actionRaw = (actionMatch?.[1] || '').trim().toLowerCase();
          const validActions = ['file', 'monitor', 'dismiss'];
          const recommendedAction = validActions.includes(actionRaw) ? actionRaw : 'monitor';

          sarDraft = {
            subject: (subjectMatch?.[1] || '').trim(),
            transaction: (txMatch?.[1] || '').trim(),
            indicators,
            typology,
            recommendedAction,
          };
          console.log(`[cadenza-escalate] │ SAR Draft parsed: typology=${sarDraft.typology}, action=${sarDraft.recommendedAction}, indicators=${sarDraft.indicators.length}`);
        }
      } catch (geminiErr) {
        console.log(`[cadenza-escalate] │ Gemini error: ${(geminiErr as Error).message}`);
        return c.json({ error: `Briefing generation failed: ${(geminiErr as Error).message}` }, 500);
      }

      console.log(`[cadenza-escalate] └─ Briefing generated: recommendation=${briefing.recommended_action}, confidence=${briefing.confidence}, hasSarDraft=${!!sarDraft}`);

      return c.json({
        lockup_id,
        transaction_id: lockup.transaction_id,
        sender: `${senderBank.short_code} (${senderBank.jurisdiction})`,
        receiver: `${receiverBank.short_code} (${receiverBank.jurisdiction})`,
        amount_display: tx.amount_display,
        yield_accrued_display: formatYieldUsd(currentYieldRaw),
        flag_count: flags.length,
        briefing,
        sarDraft,
      });
    }

    return c.json({ error: `Unknown action: ${action}. Valid: get_escalations, resolve_escalation, get_briefing` }, 400);

  } catch (err) {
    console.log(`[cadenza-escalate] Error: ${(err as Error).message}`);
    return c.json({ error: `Cadenza escalate error: ${(err as Error).message}` }, 500);
  }
});

// ============================================================
// 30. LOCKUP-ACTION — Operator lockup management for active lockups
//     Actions: settle_now, extend, reverse
//     Distinct from Cadenza escalation resolution — this operates
//     on ALL active (non-escalated) lockups, not just flagged ones.
// ============================================================

app.post("/make-server-49d15288/lockup-action", async (c) => {
  try {
    const body = await c.req.json();
    const { action, transaction_id, operator_name } = body;

    if (!action || !["settle_now", "extend", "reverse"].includes(action)) {
      return c.json({ error: "Missing or invalid field: action (settle_now | extend | reverse)" }, 400);
    }
    if (!transaction_id) return c.json({ error: "Missing required field: transaction_id" }, 400);
    if (!operator_name) return c.json({ error: "Missing required field: operator_name" }, 400);

    const supabase = getAdminClient();
    console.log(`[lockup-action] ▶ ${action} by ${operator_name} for tx ${transaction_id.slice(0, 8)}`);

    // Load transaction
    const { data: tx, error: txErr } = await supabase
      .from("transactions")
      .select("id, status, lockup_status, lockup_until, amount_display, sender_bank_id, receiver_bank_id, sender_bank:banks!transactions_sender_bank_id_fkey(short_code, name), receiver_bank:banks!transactions_receiver_bank_id_fkey(short_code, name)")
      .eq("id", transaction_id)
      .single();

    if (txErr || !tx) {
      return c.json({ error: `Transaction not found: ${txErr?.message || 'missing'}` }, 404);
    }

    if (tx.status !== "locked") {
      return c.json({ error: `Transaction status is '${tx.status}' — must be 'locked' for lockup management` }, 400);
    }

    // Find active lockup_tokens record
    const { data: lockup, error: lockupErr } = await supabase
      .from("lockup_tokens")
      .select("id, status, lockup_start, lockup_end, yb_token_amount, yield_accrued, yield_rate_bps, yield_last_calculated, sender_bank_id, receiver_bank_id")
      .eq("transaction_id", transaction_id)
      .in("status", ["active", "escalated"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const senderCode = (tx.sender_bank as any)?.short_code || "?";
    const receiverCode = (tx.receiver_bank as any)?.short_code || "?";
    const amountDisplay = tx.amount_display || 0;
    const now = new Date().toISOString();
    const resolvedBy = `operator:${operator_name}`;

    // If no lockup_tokens record, this is an orchestrator-inline lockup
    // where funds are already on-chain. Only settle_now is valid (no tokens to reverse/extend).
    if (!lockup && action === "settle_now") {
      console.log(`[lockup-action] \u2502 SETTLE NOW (inline lockup \u2014 no lockup_tokens, funds already on-chain)`);

      const { error: updateErr } = await supabase.from("transactions").update({
        status: "settled",
        lockup_status: "hard_settled",
        settled_at: now,
        is_reversible: false,
      }).eq("id", transaction_id);

      if (updateErr) {
        return c.json({ error: `Failed to settle inline lockup: ${updateErr.message}` }, 500);
      }

      await supabase.from("agent_messages").insert({
        id: crypto.randomUUID(),
        transaction_id,
        from_bank_id: tx.receiver_bank_id,
        to_bank_id: tx.sender_bank_id,
        message_type: "lockup_action",
        content: { agent_id: "solstice_operator", action: "settle_now_inline", operator: operator_name },
        natural_language: `Operator ${operator_name} \u2014 Inline lockup settled to hard finality for $${Number(amountDisplay).toLocaleString()} ${senderCode} \u2192 ${receiverCode}. Funds were already on-chain.`,
        processed: false,
        created_at: now,
      });

      console.log(`[lockup-action] \u2514\u2500 SETTLED (inline) by ${operator_name}`);
      return c.json({
        status: "settled",
        action: "settle_now",
        flow: "inline_lockup",
        transaction_id,
        operator: operator_name,
      });
    }

    if (lockupErr || !lockup) {
      return c.json({ error: `No active lockup found for transaction ${transaction_id.slice(0, 8)}: ${lockupErr?.message || 'none'}. For extend/reverse, a lockup_tokens record is required.` }, 404);
    }

    // ── Action: settle_now ──
    if (action === "settle_now") {
      console.log(`[lockup-action] \u2502 SETTLE NOW \u2014 operator fast-forward to hard finality`);

      await supabase.from("lockup_tokens").update({
        resolution: "operator_settled",
        resolved_by: resolvedBy,
        resolved_at: now,
      }).eq("id", lockup.id);

      await supabase.from("transactions").update({
        lockup_status: "operator_cleared",
      }).eq("id", transaction_id);

      // Task 118.2: Direct call to coreLockupSettle (bypasses HTTP, avoids 401)
      const settleResult = await coreLockupSettle({
        lockup_id: lockup.id,
        caller_resolution: "operator_settled",
        caller_resolved_by: resolvedBy,
      });

      // Check if /lockup-settle returned an error — propagate to frontend
      if (settleResult?.error) {
        console.log(`[lockup-action] \u2502 /lockup-settle failed: ${settleResult.error}`);
        // Rollback pre-updates so the lockup is still actionable
        await supabase.from("lockup_tokens").update({ resolution: null, resolved_by: null, resolved_at: null }).eq("id", lockup.id);
        await supabase.from("transactions").update({ lockup_status: "active" }).eq("id", transaction_id);
        return c.json({ error: `Settlement failed: ${settleResult.error}` }, 500);
      }

      await supabase.from("agent_messages").insert({
        id: crypto.randomUUID(),
        transaction_id,
        from_bank_id: tx.receiver_bank_id,
        to_bank_id: tx.sender_bank_id,
        message_type: "lockup_action",
        content: {
          agent_id: "solstice_operator",
          action: "settle_now",
          lockup_id: lockup.id,
          operator: operator_name,
          settle_result: settleResult,
        },
        natural_language: `Operator ${operator_name} \u2014 Final settlement fast-forwarded for $${Number(amountDisplay).toLocaleString()} ${senderCode} \u2192 ${receiverCode}. Lockup released to hard finality.`,
        processed: false,
        created_at: now,
      });

      console.log(`[lockup-action] \u2514\u2500 SETTLED by ${operator_name}`);
      return c.json({
        status: "settled",
        action: "settle_now",
        transaction_id,
        lockup_id: lockup.id,
        operator: operator_name,
        settle_result: settleResult,
      });
    }

    // ── Action: extend ──
    if (action === "extend") {
      const { extend_minutes } = body;
      if (!extend_minutes || typeof extend_minutes !== "number" || extend_minutes < 5) {
        return c.json({ error: "Missing or invalid field: extend_minutes (must be >= 5)" }, 400);
      }

      console.log(`[lockup-action] \u2502 EXTEND \u2014 adding ${extend_minutes}min to lockup`);

      const currentEnd = tx.lockup_until ? new Date(tx.lockup_until).getTime() : Date.now();
      const newEnd = new Date(currentEnd + extend_minutes * 60 * 1000).toISOString();

      await supabase.from("lockup_tokens").update({ lockup_end: newEnd }).eq("id", lockup.id);
      await supabase.from("transactions").update({ lockup_until: newEnd }).eq("id", transaction_id);

      await supabase.from("agent_messages").insert({
        id: crypto.randomUUID(),
        transaction_id,
        from_bank_id: tx.receiver_bank_id,
        to_bank_id: tx.sender_bank_id,
        message_type: "lockup_action",
        content: {
          agent_id: "solstice_operator",
          action: "extend",
          lockup_id: lockup.id,
          operator: operator_name,
          extend_minutes,
          new_lockup_until: newEnd,
        },
        natural_language: `Operator ${operator_name} \u2014 Lockup extended by ${extend_minutes} minutes for $${Number(amountDisplay).toLocaleString()} ${senderCode} \u2192 ${receiverCode}. New expiry: ${newEnd}.`,
        processed: false,
        created_at: now,
      });

      await supabase.from("cadenza_flags").insert({
        id: crypto.randomUUID(),
        transaction_id,
        lockup_token_id: lockup.id,
        flag_type: "operator_extension",
        severity: "info",
        reasoning: `Lockup extended by ${extend_minutes} minutes by ${operator_name}`,
        detected_at: now,
        action_taken: "extended",
        action_at: now,
      });

      console.log(`[lockup-action] \u2514\u2500 EXTENDED by ${operator_name}: +${extend_minutes}min \u2192 ${newEnd}`);
      return c.json({
        status: "extended",
        action: "extend",
        transaction_id,
        lockup_id: lockup.id,
        operator: operator_name,
        extend_minutes,
        new_lockup_until: newEnd,
      });
    }

    // ── Action: reverse ──
    if (action === "reverse") {
      const { reason } = body;
      console.log(`[lockup-action] \u2502 REVERSE \u2014 operator-initiated reversal`);

      await supabase.from("lockup_tokens").update({
        resolution: "operator_reversed",
        resolved_by: resolvedBy,
        resolved_at: now,
      }).eq("id", lockup.id);

      const reversalReason = `operator_reversed by ${operator_name}: ${reason || 'no reason given'}`;
      // Task 118.2: Direct call to coreLockupReverse (bypasses HTTP, avoids 401)
      const reverseResult = await coreLockupReverse({
        lockup_id: lockup.id,
        reason: reversalReason,
        caller_resolution: "operator_reversed",
        caller_resolved_by: resolvedBy,
      });

      // Check if /lockup-reverse returned an error — propagate to frontend
      if (reverseResult?.error) {
        console.log(`[lockup-action] \u2502 /lockup-reverse failed: ${reverseResult.error}`);
        // Rollback pre-updates so the lockup is still actionable
        await supabase.from("lockup_tokens").update({ resolution: null, resolved_by: null, resolved_at: null }).eq("id", lockup.id);
        return c.json({ error: `Reversal failed: ${reverseResult.error}` }, 500);
      }

      await supabase.from("agent_messages").insert({
        id: crypto.randomUUID(),
        transaction_id,
        from_bank_id: tx.receiver_bank_id,
        to_bank_id: tx.sender_bank_id,
        message_type: "lockup_action",
        content: {
          agent_id: "solstice_operator",
          action: "reverse",
          lockup_id: lockup.id,
          operator: operator_name,
          reason: reason || null,
          reverse_result: reverseResult,
        },
        natural_language: `Operator ${operator_name} \u2014 Transaction reversed for $${Number(amountDisplay).toLocaleString()} ${senderCode} \u2192 ${receiverCode}. Clean reversal \u2014 receiver never had tokens (escrow model).${reason ? ` Reason: ${reason}` : ''}`,
        processed: false,
        created_at: now,
      });

      await supabase.from("cadenza_flags").insert({
        id: crypto.randomUUID(),
        transaction_id,
        lockup_token_id: lockup.id,
        flag_type: "operator_reversal",
        severity: "auto_reverse",
        reasoning: `Reversed by ${operator_name}${reason ? `: ${reason}` : ''}`,
        detected_at: now,
        action_taken: "reversed",
        action_at: now,
      });

      console.log(`[lockup-action] \u2514\u2500 REVERSED by ${operator_name}`);
      return c.json({
        status: "reversed",
        action: "reverse",
        transaction_id,
        lockup_id: lockup.id,
        operator: operator_name,
        reverse_result: reverseResult,
      });
    }

    return c.json({ error: `Unknown action: ${action}` }, 400);

  } catch (err) {
    console.log(`[lockup-action] Error: ${(err as Error).message}`);
    return c.json({ error: `Lockup action error: ${(err as Error).message}` }, 500);
  }
});

console.log(`\u2588\u2588\u2588\u2588 EDGE FUNCTION COLD START \u2588\u2588\u2588\u2588 v13 Task-118.2 (coreLockupSettle/Reverse-all-callsites) ${new Date().toISOString()}`);
Deno.serve(app.fetch);