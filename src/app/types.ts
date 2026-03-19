// ============================================================
// UI Helper Types
// ============================================================

// Orphan detection — transactions stuck in non-terminal states beyond this threshold
export const ORPHAN_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

// ============================================================
// Persona / Role-Based Views (Task 126)
// ============================================================
export type PersonaType = 'compliance' | 'treasury' | 'leadership' | null;

export const TERMINAL_TX_STATUSES: TxStatus[] = ['settled', 'locked', 'rejected', 'reversed'];
export const IN_FLIGHT_TX_STATUSES: TxStatus[] = ['initiated', 'compliance_check', 'risk_scored', 'executing'];

export function isOrphanedTransaction(tx: Transaction): boolean {
  if (TERMINAL_TX_STATUSES.includes(tx.status)) return false;
  const age = Date.now() - new Date(tx.initiated_at || tx.created_at).getTime();
  return age > ORPHAN_THRESHOLD_MS;
}

export function getOrphanAge(tx: Transaction): string {
  const age = Date.now() - new Date(tx.initiated_at || tx.created_at).getTime();
  if (age < 60_000) return `${Math.floor(age / 1000)}s`;
  if (age < 3_600_000) return `${Math.floor(age / 60_000)}m`;
  if (age < 86_400_000) return `${Math.floor(age / 3_600_000)}h`;
  return `${Math.floor(age / 86_400_000)}d`;
}

export interface DeploymentStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'complete' | 'error';
  detail?: string;
}

export const TX_STATUS_CONFIG: Record<TxStatus, { label: string; color: string; bg: string }> = {
  initiated: { label: 'Initiated', color: 'text-coda-text-muted', bg: 'bg-coda-text-muted/20' },
  compliance_check: { label: 'Compliance', color: 'text-blue-400', bg: 'bg-blue-500/20' },
  risk_scored: { label: 'Risk Scored', color: 'text-yellow-400', bg: 'bg-yellow-500/20' },
  executing: { label: 'Executing', color: 'text-orange-400', bg: 'bg-orange-500/20' },
  settled: { label: 'Settled', color: 'text-emerald-400', bg: 'bg-emerald-500/20' },
  locked: { label: 'Locked', color: 'text-coda-brand', bg: 'bg-coda-brand/20' },
  rejected: { label: 'Rejected', color: 'text-red-400', bg: 'bg-red-500/20' },
  reversed: { label: 'Reversed', color: 'text-red-600', bg: 'bg-red-900/20' },
};

export const RISK_LEVEL_CONFIG: Record<RiskLevel, { label: string; color: string; bg: string }> = {
  low: { label: 'Low', color: 'text-emerald-400', bg: 'bg-emerald-500/20' },
  medium: { label: 'Medium', color: 'text-yellow-400', bg: 'bg-yellow-500/20' },
  high: { label: 'High', color: 'text-red-400', bg: 'bg-red-500/20' },
};

export const MESSAGE_TYPE_CONFIG: Record<MessageType, { label: string; color: string }> = {
  payment_request: { label: 'Payment Request', color: 'text-blue-400' },
  payment_accept: { label: 'Accepted', color: 'text-emerald-400' },
  payment_reject: { label: 'Rejected', color: 'text-red-400' },
  compliance_query: { label: 'Compliance Query', color: 'text-blue-400' },
  compliance_response: { label: 'Compliance Response', color: 'text-blue-300' },
  risk_alert: { label: 'Risk Alert', color: 'text-yellow-400' },
  settlement_confirm: { label: 'Settlement Confirmed', color: 'text-emerald-300' },
  status_update: { label: 'Status Update', color: 'text-coda-brand' },
  system: { label: 'System', color: 'text-coda-text-muted' },
  lockup_action: { label: 'Lockup Action', color: 'text-coda-brand' },
  cadenza_decision: { label: 'Cadenza Decision', color: 'text-red-400' },
};

// Format token amount (6 decimals) to display string
export function formatTokenAmount(amount: number | string | null | undefined): string {
  if (amount == null) return '$0.00';
  const numAmount = typeof amount === 'string' ? Number(amount) : amount;
  if (isNaN(numAmount)) return '$0.00';
  const display = numAmount / 1_000_000;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(display);
}

// Truncate a Solana address for display
export function truncateAddress(address: string | null | undefined, chars = 4): string {
  if (!address) return '—';
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

// Solana explorer + faucet URLs — configurable via env vars
const SOLANA_EXPLORER = import.meta.env.VITE_SOLANA_EXPLORER_URL || 'https://explorer.solana.com';
const SOLANA_CLUSTER = import.meta.env.VITE_SOLANA_CLUSTER || 'devnet';
const SOLANA_FAUCET = import.meta.env.VITE_SOLANA_FAUCET_URL || 'https://faucet.solana.com';

export function explorerUrl(value: string, type: 'tx' | 'address' = 'tx'): string {
  const clusterParam = SOLANA_CLUSTER === 'mainnet-beta' ? '' : `?cluster=${SOLANA_CLUSTER}`;
  return `${SOLANA_EXPLORER}/${type}/${value}${clusterParam}`;
}

export function faucetUrl(address?: string): string {
  return address ? `${SOLANA_FAUCET}/?address=${address}` : SOLANA_FAUCET;
}

// ============================================================
// Domain Model Interfaces
// ============================================================

export type TxStatus = 'initiated' | 'compliance_check' | 'risk_scored' | 'executing' | 'settled' | 'locked' | 'rejected' | 'reversed';
export type RiskLevel = 'low' | 'medium' | 'high';
export type MessageType = 'payment_request' | 'payment_accept' | 'payment_reject' | 'compliance_query' | 'compliance_response' | 'risk_alert' | 'settlement_confirm' | 'status_update' | 'system' | 'lockup_action' | 'cadenza_decision';

export interface Bank {
  id: string;
  name: string;
  short_code: string;
  swift_bic?: string;         // SWIFT/BIC code (e.g. "CHASUS33")
  status: string;
  jurisdiction: string;
  tier?: string;
  solana_wallet_pubkey?: string;
  solana_wallet_keypair_encrypted?: string;
  token_mint_address?: string;
  token_symbol?: string;
  token_decimals?: number;
  agent_system_prompt?: string;
  agent_model?: string;
  created_at: string;
  updated_at: string;
  wallets?: Wallet[];
}

export interface Wallet {
  id: string;
  bank_id: string;
  label: string;
  solana_pubkey: string;
  is_default: boolean;
  token_account_address?: string;
  balance_lamports: number;
  balance_tokens: number;
  created_at: string;
}

export interface Transaction {
  id: string;
  sender_bank_id: string;
  receiver_bank_id: string;
  amount: number;
  amount_display?: number;
  purpose_code?: string;
  memo?: string;
  status: TxStatus;
  risk_level?: RiskLevel;
  risk_score?: number;
  risk_reasoning?: string;
  compliance_passed?: boolean;
  compliance_checks?: { type: string; passed: boolean; detail: string }[];
  solana_tx_signature?: string;
  solana_slot?: number;
  solana_block_time?: string;
  lockup_until?: string;
  lockup_status?: string | null;
  is_reversible?: boolean;
  initiated_at?: string;
  settled_at?: string;
  reversed_at?: string;
  reversal_reason?: string;
  // Network fee & settlement metadata (Task 115)
  network_fee_sol?: number;
  settlement_method?: 'pvp_burn_mint' | 'lockup_hard_finality' | 'lockup_reversal' | 'lockup_user_reversal' | string;
  settlement_memo?: string;
  // Phase 2 finality on-chain data (Task 118.1) — lockup settlements only
  finality_tx_signature?: string | null;
  finality_solana_slot?: number | null;
  finality_block_time?: string | null;
  // Lockup duration (Task 117) — sender-specified reversibility window in minutes
  lockup_duration_minutes?: number;
  // Travel Rule (Task 127) — IVMS 101 payload for FinCEN compliance
  travel_rule_payload?: any;
  created_at: string;
  updated_at?: string;
  sender_bank?: Bank;
  receiver_bank?: Bank;
}

export interface AgentMessage {
  id: string;
  transaction_id?: string;
  from_bank_id: string;
  to_bank_id?: string;
  message_type: MessageType;
  content: Record<string, unknown>;
  natural_language?: string;
  processed: boolean;
  created_at: string;
}

export interface SetupBankRequest {
  name: string;
  short_code: string;
  swift_bic?: string;          // SWIFT/BIC code — resolved from registry if omitted
  jurisdiction: string;
  initial_deposit_supply?: number;
  agent_system_prompt?: string;
}

// ============================================================
// Agent Configuration (per-bank parameter overrides)
// ============================================================
export interface BankAgentConfig {
  bank_id: string;
  auto_accept_ceiling: number;
  escalation_first_time_threshold: number;
  escalation_cross_jurisdiction: number;
  escalation_velocity_count: number;
  // Lockup duration (Task 117)
  default_lockup_duration_minutes: number;  // 0 = immediate PvP, >0 = minimum lockup window
  jurisdiction_whitelist: string[];
  approved_purpose_codes: string[];
  risk_weight_counterparty: number;
  risk_weight_jurisdiction: number;
  risk_weight_asset_type: number;
  risk_weight_behavioral: number;
  risk_instant_ceiling: number;
  risk_deferred_24h_ceiling: number;
  risk_deferred_72h_ceiling: number;
  balance_safety_floor_pct: number;
  heartbeat_participation: boolean;
  // Cadenza (Dispute Resolution)
  cadenza_monitoring_sensitivity: string;     // 'conservative' | 'balanced' | 'aggressive'
  cadenza_auto_reverse_enabled: boolean;
  cadenza_escalation_threshold: number;       // confidence below this → escalate (0.0–1.0)
  cadenza_velocity_spike_multiplier: number;  // flag if velocity > Nx 24h average
  cadenza_duplicate_window_seconds: number;   // duplicate detection window in seconds
  cadenza_max_lockup_hours: number;           // max lockup before auto-escalation
}

export interface NetworkDefaults {
  auto_accept_ceiling: number;
  escalation_first_time_threshold: number;
  escalation_cross_jurisdiction: number;
  escalation_velocity_count: number;
  // Lockup duration (Task 117)
  default_lockup_duration_minutes: number;
  jurisdiction_whitelist: string[];
  approved_purpose_codes: string[];
  risk_weight_counterparty: number;
  risk_weight_jurisdiction: number;
  risk_weight_asset_type: number;
  risk_weight_behavioral: number;
  risk_instant_ceiling: number;
  risk_deferred_24h_ceiling: number;
  risk_deferred_72h_ceiling: number;
  balance_safety_floor_pct: number;
  heartbeat_participation: boolean;
  // Cadenza (Dispute Resolution)
  cadenza_monitoring_sensitivity: string;
  cadenza_auto_reverse_enabled: boolean;
  cadenza_escalation_threshold: number;
  cadenza_velocity_spike_multiplier: number;
  cadenza_duplicate_window_seconds: number;
  cadenza_max_lockup_hours: number;
  // Network fee (SOL gas-layer)
  network_fee_sol?: number;
}

export interface TreasuryMandate {
  id: string;
  bank_id: string;
  mandate_type: string;
  description: string;
  parameters: Record<string, unknown>;
  priority: number;
  is_active: boolean;
  created_at: string;
}

// ============================================================
// Aria — Natural-language Agent Configuration Assistant
// ============================================================
export interface AriaChange {
  parameter: string;
  current_value: unknown;
  proposed_value: unknown;
  source: 'network_default' | 'bank_override';
  category: 'maestro' | 'concord' | 'fermata' | 'treasury' | 'cadenza';
}

export interface AriaProposal {
  proposal_id: string;
  changes: AriaChange[];
  reasoning: string;
  warnings: string[];
  status: 'pending' | 'applied' | 'rejected';
}

export interface AriaMessage {
  role: 'user' | 'aria';
  content: string;
  proposal?: AriaProposal;
  timestamp: number;
}

// ============================================================
// Network Command — War Room Visualization
// ============================================================
export interface NetworkCommandState {
  tps: number;
  peakTps: number;
  confirmedTxs: number;
  volumeSettled: number;
  activeLockups: number;
  yieldAccruing: number;
  feesCollected: number;
  networkMode: string;
}

export interface NetworkSimulationParams {
  rampDurationMs: number;
  tpsVarianceRange: [number, number]; // [min%, max%] e.g. [0.05, 0.08]
  arcSpawnRate: number; // arcs per second at 10k TPS
  arcDurationMs: number;
  counterUpdateIntervalMs: number;
  heartbeatSpikeMultiplier: number;
  heartbeatSpikeDurationMs: number;
}