-- Azure Postgres migration for CODA production
-- Equivalent to initial_schema.sql but without Supabase-specific extensions,
-- RLS policies, realtime publications, or Supabase roles.
-- Uses gen_random_uuid() (built-in PG 13+) instead of extensions.uuid_generate_v4().

-- ── Function ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ── Tables ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    bank_id uuid NOT NULL,
    transaction_id uuid,
    role text NOT NULL,
    content text NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT agent_conversations_role_check CHECK (role = ANY (ARRAY['user','assistant','system']))
);

CREATE TABLE IF NOT EXISTS agent_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    transaction_id uuid,
    from_bank_id uuid NOT NULL,
    to_bank_id uuid,
    message_type text NOT NULL,
    content jsonb DEFAULT '{}'::jsonb NOT NULL,
    natural_language text,
    processed boolean DEFAULT false NOT NULL,
    processed_at timestamptz,
    created_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT agent_messages_message_type_check CHECK (message_type = ANY (ARRAY['payment_request','payment_accept','payment_reject','compliance_query','compliance_response','risk_alert','settlement_confirm','system']))
);

CREATE TABLE IF NOT EXISTS bank_agent_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    bank_id uuid NOT NULL UNIQUE,
    auto_accept_ceiling bigint,
    escalation_first_time_threshold bigint,
    escalation_cross_jurisdiction bigint,
    escalation_velocity_count integer,
    jurisdiction_whitelist text[],
    approved_purpose_codes text[],
    risk_weight_counterparty numeric(4,2),
    risk_weight_jurisdiction numeric(4,2),
    risk_weight_asset_type numeric(4,2),
    risk_weight_behavioral numeric(4,2),
    risk_instant_ceiling integer,
    risk_deferred_24h_ceiling integer,
    risk_deferred_72h_ceiling integer,
    balance_safety_floor_pct numeric(4,2),
    heartbeat_participation boolean DEFAULT true,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    default_lockup_duration_minutes integer
);

CREATE TABLE IF NOT EXISTS banks (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    name text NOT NULL,
    short_code text NOT NULL UNIQUE,
    status text DEFAULT 'deploying' NOT NULL,
    jurisdiction text DEFAULT 'US' NOT NULL,
    tier text DEFAULT 'tier_1',
    solana_wallet_pubkey text,
    solana_wallet_keypair_encrypted text,
    token_mint_address text,
    token_symbol text,
    token_decimals integer DEFAULT 6 NOT NULL,
    agent_system_prompt text,
    agent_model text DEFAULT 'gemini-2.5-flash-preview-05-20' NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    swift_bic text,
    CONSTRAINT banks_status_check CHECK (status = ANY (ARRAY['active','suspended','onboarding','wallet_created','activating','awaiting_sol'])),
    CONSTRAINT banks_tier_check CHECK (tier = ANY (ARRAY['tier_1','tier_2','community']))
);

CREATE TABLE IF NOT EXISTS cadenza_flags (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    transaction_id uuid,
    lockup_token_id uuid,
    flag_type text,
    severity text,
    reasoning text,
    detected_at timestamptz DEFAULT now(),
    action_taken text,
    action_at timestamptz
);

CREATE TABLE IF NOT EXISTS compliance_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    transaction_id uuid NOT NULL,
    bank_id uuid NOT NULL,
    check_type text NOT NULL,
    check_result text NOT NULL,
    details jsonb DEFAULT '{}'::jsonb,
    solana_log_signature text,
    created_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT compliance_logs_check_result_check CHECK (check_result = ANY (ARRAY['pass','fail','warning']))
);

CREATE TABLE IF NOT EXISTS heartbeat_cycles (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    cycle_number integer NOT NULL,
    status text DEFAULT 'running' NOT NULL,
    banks_evaluated integer DEFAULT 0 NOT NULL,
    transactions_initiated integer DEFAULT 0 NOT NULL,
    market_event jsonb DEFAULT '{}'::jsonb NOT NULL,
    started_at timestamptz DEFAULT now(),
    completed_at timestamptz,
    error_message text,
    CONSTRAINT heartbeat_cycles_status_check CHECK (status = ANY (ARRAY['running','completed','error']))
);

CREATE TABLE IF NOT EXISTS kv_store_49d15288 (
    key text NOT NULL PRIMARY KEY,
    value jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS lockup_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    transaction_id uuid,
    sender_bank_id uuid,
    receiver_bank_id uuid,
    yb_token_mint text,
    yb_token_symbol text,
    yb_token_amount bigint,
    yb_holder text,
    tb_token_mint text,
    tb_token_symbol text,
    tb_token_amount bigint,
    tb_holder text,
    yield_rate_bps integer DEFAULT 525,
    yield_accrued bigint DEFAULT 0,
    yield_last_calculated timestamptz,
    lockup_start timestamptz,
    lockup_end timestamptz,
    status text DEFAULT 'active',
    resolution text,
    resolved_at timestamptz,
    resolved_by text,
    yield_swept_to text,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS network_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    timestamp timestamptz DEFAULT now(),
    metrics jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS network_wallets (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    name text NOT NULL,
    code text NOT NULL UNIQUE,
    wallet_address text,
    keypair_encrypted text,
    purpose text,
    balance bigint DEFAULT 0,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS risk_scores (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    transaction_id uuid NOT NULL,
    counterparty_score numeric(6,2),
    jurisdiction_score numeric(6,2),
    asset_type_score numeric(6,2),
    behavioral_score numeric(6,2),
    composite_score numeric(6,2),
    risk_level text,
    finality_recommendation text,
    reasoning text,
    created_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT risk_scores_risk_level_check CHECK (risk_level = ANY (ARRAY['low','medium','high']))
);

CREATE TABLE IF NOT EXISTS simulated_watchlist (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    entity_name text NOT NULL,
    bic_code text,
    wallet_address text,
    list_type text DEFAULT 'OFAC_SDN' NOT NULL,
    status text DEFAULT 'active' NOT NULL,
    added_at timestamptz DEFAULT now() NOT NULL,
    reason text
);

CREATE TABLE IF NOT EXISTS transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    sender_bank_id uuid NOT NULL,
    receiver_bank_id uuid NOT NULL,
    amount bigint NOT NULL,
    amount_display numeric(20,6),
    currency text DEFAULT 'USD' NOT NULL,
    sender_token_mint text,
    receiver_token_mint text,
    settlement_type text DEFAULT 'PvP' NOT NULL,
    status text DEFAULT 'initiated' NOT NULL,
    risk_level text,
    risk_score numeric(6,2),
    risk_reasoning text,
    compliance_passed boolean,
    compliance_checks jsonb,
    memo text,
    purpose_code text,
    solana_tx_signature text,
    solana_slot bigint,
    solana_block_time timestamptz,
    lockup_until timestamptz,
    is_reversible boolean DEFAULT false NOT NULL,
    reversed_at timestamptz,
    reversal_reason text,
    initiated_at timestamptz DEFAULT now() NOT NULL,
    compliance_completed_at timestamptz,
    risk_scored_at timestamptz,
    settled_at timestamptz,
    created_at timestamptz DEFAULT now() NOT NULL,
    lockup_status text,
    settlement_memo text,
    settlement_method text,
    network_fee_sol numeric,
    lockup_duration_minutes integer DEFAULT 30 NOT NULL,
    finality_tx_signature text,
    finality_solana_slot bigint,
    finality_block_time timestamptz,
    travel_rule_payload jsonb,
    CONSTRAINT transactions_risk_level_check CHECK (risk_level = ANY (ARRAY['low','medium','high'])),
    CONSTRAINT transactions_settlement_type_check CHECK (settlement_type = ANY (ARRAY['PvP','DvP','PvPvP','lockup'])),
    CONSTRAINT transactions_status_check CHECK (status = ANY (ARRAY['initiated','compliance_check','risk_scored','executing','settled','locked','rejected','reversed']))
);

CREATE TABLE IF NOT EXISTS treasury_mandates (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    bank_id uuid NOT NULL,
    mandate_type text NOT NULL,
    parameters jsonb DEFAULT '{}'::jsonb NOT NULL,
    priority integer DEFAULT 1 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    description text,
    CONSTRAINT treasury_mandates_mandate_type_check CHECK (mandate_type = ANY (ARRAY['liquidity_rebalance','repo_settlement','corridor_allocation','treasury_sweep','collateral_call']))
);

CREATE TABLE IF NOT EXISTS wallets (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    bank_id uuid NOT NULL,
    label text DEFAULT 'primary' NOT NULL,
    solana_pubkey text NOT NULL,
    is_default boolean DEFAULT true NOT NULL,
    token_account_address text,
    balance_lamports bigint DEFAULT 0 NOT NULL,
    balance_tokens bigint DEFAULT 0 NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL
);

-- ── Indexes ─────────────────────────────────────────────────

CREATE INDEX idx_agent_conversations_bank ON agent_conversations (bank_id);
CREATE INDEX idx_agent_conversations_bank_time ON agent_conversations (bank_id, created_at DESC);
CREATE INDEX idx_agent_messages_processed ON agent_messages (processed) WHERE (NOT processed);
CREATE INDEX idx_agent_messages_to_bank ON agent_messages (to_bank_id);
CREATE INDEX idx_agent_messages_transaction ON agent_messages (transaction_id);
CREATE INDEX idx_compliance_logs_transaction ON compliance_logs (transaction_id);
CREATE INDEX idx_heartbeat_cycles_number ON heartbeat_cycles (cycle_number DESC);
CREATE INDEX idx_network_snapshots_timestamp ON network_snapshots (timestamp DESC);
CREATE INDEX idx_risk_scores_transaction ON risk_scores (transaction_id);
CREATE INDEX idx_transactions_receiver ON transactions (receiver_bank_id);
CREATE INDEX idx_transactions_sender ON transactions (sender_bank_id);
CREATE INDEX idx_transactions_status ON transactions (status);
CREATE INDEX idx_treasury_mandates_bank ON treasury_mandates (bank_id, is_active);
CREATE INDEX idx_wallets_bank_id ON wallets (bank_id);
CREATE INDEX kv_store_key_prefix ON kv_store_49d15288 (key text_pattern_ops);

-- ── Trigger ─────────────────────────────────────────────────

CREATE TRIGGER banks_updated_at BEFORE UPDATE ON banks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
