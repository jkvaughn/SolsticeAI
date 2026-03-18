


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."update_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."agent_conversations" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "bank_id" "uuid" NOT NULL,
    "transaction_id" "uuid",
    "role" "text" NOT NULL,
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "agent_conversations_role_check" CHECK (("role" = ANY (ARRAY['user'::"text", 'assistant'::"text", 'system'::"text"])))
);


ALTER TABLE "public"."agent_conversations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agent_messages" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "transaction_id" "uuid",
    "from_bank_id" "uuid" NOT NULL,
    "to_bank_id" "uuid",
    "message_type" "text" NOT NULL,
    "content" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "natural_language" "text",
    "processed" boolean DEFAULT false NOT NULL,
    "processed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "agent_messages_message_type_check" CHECK (("message_type" = ANY (ARRAY['payment_request'::"text", 'payment_accept'::"text", 'payment_reject'::"text", 'compliance_query'::"text", 'compliance_response'::"text", 'risk_alert'::"text", 'settlement_confirm'::"text", 'system'::"text"])))
);


ALTER TABLE "public"."agent_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bank_agent_config" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bank_id" "uuid" NOT NULL,
    "auto_accept_ceiling" bigint,
    "escalation_first_time_threshold" bigint,
    "escalation_cross_jurisdiction" bigint,
    "escalation_velocity_count" integer,
    "jurisdiction_whitelist" "text"[],
    "approved_purpose_codes" "text"[],
    "risk_weight_counterparty" numeric(4,2) DEFAULT NULL::numeric,
    "risk_weight_jurisdiction" numeric(4,2) DEFAULT NULL::numeric,
    "risk_weight_asset_type" numeric(4,2) DEFAULT NULL::numeric,
    "risk_weight_behavioral" numeric(4,2) DEFAULT NULL::numeric,
    "risk_instant_ceiling" integer,
    "risk_deferred_24h_ceiling" integer,
    "risk_deferred_72h_ceiling" integer,
    "balance_safety_floor_pct" numeric(4,2) DEFAULT NULL::numeric,
    "heartbeat_participation" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "default_lockup_duration_minutes" integer
);


ALTER TABLE "public"."bank_agent_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."banks" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "short_code" "text" NOT NULL,
    "status" "text" DEFAULT 'deploying'::"text" NOT NULL,
    "jurisdiction" "text" DEFAULT 'US'::"text" NOT NULL,
    "tier" "text" DEFAULT 'tier_1'::"text",
    "solana_wallet_pubkey" "text",
    "solana_wallet_keypair_encrypted" "text",
    "token_mint_address" "text",
    "token_symbol" "text",
    "token_decimals" integer DEFAULT 6 NOT NULL,
    "agent_system_prompt" "text",
    "agent_model" "text" DEFAULT 'gemini-2.5-flash-preview-05-20'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "swift_bic" "text",
    CONSTRAINT "banks_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'suspended'::"text", 'onboarding'::"text", 'wallet_created'::"text", 'activating'::"text", 'awaiting_sol'::"text"]))),
    CONSTRAINT "banks_tier_check" CHECK (("tier" = ANY (ARRAY['tier_1'::"text", 'tier_2'::"text", 'community'::"text"])))
);


ALTER TABLE "public"."banks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cadenza_flags" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "transaction_id" "uuid",
    "lockup_token_id" "uuid",
    "flag_type" "text",
    "severity" "text",
    "reasoning" "text",
    "detected_at" timestamp with time zone DEFAULT "now"(),
    "action_taken" "text",
    "action_at" timestamp with time zone
);


ALTER TABLE "public"."cadenza_flags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."compliance_logs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "transaction_id" "uuid" NOT NULL,
    "bank_id" "uuid" NOT NULL,
    "check_type" "text" NOT NULL,
    "check_result" "text" NOT NULL,
    "details" "jsonb" DEFAULT '{}'::"jsonb",
    "solana_log_signature" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "compliance_logs_check_result_check" CHECK (("check_result" = ANY (ARRAY['pass'::"text", 'fail'::"text", 'warning'::"text"])))
);


ALTER TABLE "public"."compliance_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."heartbeat_cycles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cycle_number" integer NOT NULL,
    "status" "text" DEFAULT 'running'::"text" NOT NULL,
    "banks_evaluated" integer DEFAULT 0 NOT NULL,
    "transactions_initiated" integer DEFAULT 0 NOT NULL,
    "market_event" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"(),
    "completed_at" timestamp with time zone,
    "error_message" "text",
    CONSTRAINT "heartbeat_cycles_status_check" CHECK (("status" = ANY (ARRAY['running'::"text", 'completed'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."heartbeat_cycles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."kv_store_49d15288" (
    "key" "text" NOT NULL,
    "value" "jsonb" NOT NULL
);


ALTER TABLE "public"."kv_store_49d15288" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lockup_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "transaction_id" "uuid",
    "sender_bank_id" "uuid",
    "receiver_bank_id" "uuid",
    "yb_token_mint" "text",
    "yb_token_symbol" "text",
    "yb_token_amount" bigint,
    "yb_holder" "text",
    "tb_token_mint" "text",
    "tb_token_symbol" "text",
    "tb_token_amount" bigint,
    "tb_holder" "text",
    "yield_rate_bps" integer DEFAULT 525,
    "yield_accrued" bigint DEFAULT 0,
    "yield_last_calculated" timestamp with time zone,
    "lockup_start" timestamp with time zone,
    "lockup_end" timestamp with time zone,
    "status" "text" DEFAULT 'active'::"text",
    "resolution" "text",
    "resolved_at" timestamp with time zone,
    "resolved_by" "text",
    "yield_swept_to" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."lockup_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."network_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "timestamp" timestamp with time zone DEFAULT "now"(),
    "metrics" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."network_snapshots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."network_wallets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "code" "text" NOT NULL,
    "wallet_address" "text",
    "keypair_encrypted" "text",
    "purpose" "text",
    "balance" bigint DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."network_wallets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."risk_scores" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "transaction_id" "uuid" NOT NULL,
    "counterparty_score" numeric(6,2),
    "jurisdiction_score" numeric(6,2),
    "asset_type_score" numeric(6,2),
    "behavioral_score" numeric(6,2),
    "composite_score" numeric(6,2),
    "risk_level" "text",
    "finality_recommendation" "text",
    "reasoning" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "risk_scores_risk_level_check" CHECK (("risk_level" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text"])))
);


ALTER TABLE "public"."risk_scores" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."simulated_watchlist" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "entity_name" "text" NOT NULL,
    "bic_code" "text",
    "wallet_address" "text",
    "list_type" "text" DEFAULT 'OFAC_SDN'::"text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "added_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reason" "text"
);


ALTER TABLE "public"."simulated_watchlist" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transactions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "sender_bank_id" "uuid" NOT NULL,
    "receiver_bank_id" "uuid" NOT NULL,
    "amount" bigint NOT NULL,
    "amount_display" numeric(20,6),
    "currency" "text" DEFAULT 'USD'::"text" NOT NULL,
    "sender_token_mint" "text",
    "receiver_token_mint" "text",
    "settlement_type" "text" DEFAULT 'PvP'::"text" NOT NULL,
    "status" "text" DEFAULT 'initiated'::"text" NOT NULL,
    "risk_level" "text",
    "risk_score" numeric(6,2),
    "risk_reasoning" "text",
    "compliance_passed" boolean,
    "compliance_checks" "jsonb",
    "memo" "text",
    "purpose_code" "text",
    "solana_tx_signature" "text",
    "solana_slot" bigint,
    "solana_block_time" timestamp with time zone,
    "lockup_until" timestamp with time zone,
    "is_reversible" boolean DEFAULT false NOT NULL,
    "reversed_at" timestamp with time zone,
    "reversal_reason" "text",
    "initiated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "compliance_completed_at" timestamp with time zone,
    "risk_scored_at" timestamp with time zone,
    "settled_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "lockup_status" "text",
    "settlement_memo" "text",
    "settlement_method" "text",
    "network_fee_sol" numeric,
    "lockup_duration_minutes" integer DEFAULT 30 NOT NULL,
    "finality_tx_signature" "text",
    "finality_solana_slot" bigint,
    "finality_block_time" timestamp with time zone,
    "travel_rule_payload" "jsonb",
    CONSTRAINT "transactions_risk_level_check" CHECK (("risk_level" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text"]))),
    CONSTRAINT "transactions_settlement_type_check" CHECK (("settlement_type" = ANY (ARRAY['PvP'::"text", 'DvP'::"text", 'PvPvP'::"text", 'lockup'::"text"]))),
    CONSTRAINT "transactions_status_check" CHECK (("status" = ANY (ARRAY['initiated'::"text", 'compliance_check'::"text", 'risk_scored'::"text", 'executing'::"text", 'settled'::"text", 'locked'::"text", 'rejected'::"text", 'reversed'::"text"])))
);


ALTER TABLE "public"."transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."treasury_mandates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bank_id" "uuid" NOT NULL,
    "mandate_type" "text" NOT NULL,
    "parameters" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "priority" integer DEFAULT 1 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "description" "text",
    CONSTRAINT "treasury_mandates_mandate_type_check" CHECK (("mandate_type" = ANY (ARRAY['liquidity_rebalance'::"text", 'repo_settlement'::"text", 'corridor_allocation'::"text", 'treasury_sweep'::"text", 'collateral_call'::"text"])))
);


ALTER TABLE "public"."treasury_mandates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wallets" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "bank_id" "uuid" NOT NULL,
    "label" "text" DEFAULT 'primary'::"text" NOT NULL,
    "solana_pubkey" "text" NOT NULL,
    "is_default" boolean DEFAULT true NOT NULL,
    "token_account_address" "text",
    "balance_lamports" bigint DEFAULT 0 NOT NULL,
    "balance_tokens" bigint DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."wallets" OWNER TO "postgres";


ALTER TABLE ONLY "public"."agent_conversations"
    ADD CONSTRAINT "agent_conversations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agent_messages"
    ADD CONSTRAINT "agent_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bank_agent_config"
    ADD CONSTRAINT "bank_agent_config_bank_id_key" UNIQUE ("bank_id");



ALTER TABLE ONLY "public"."bank_agent_config"
    ADD CONSTRAINT "bank_agent_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."banks"
    ADD CONSTRAINT "banks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."banks"
    ADD CONSTRAINT "banks_short_code_key" UNIQUE ("short_code");



ALTER TABLE ONLY "public"."cadenza_flags"
    ADD CONSTRAINT "cadenza_flags_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."compliance_logs"
    ADD CONSTRAINT "compliance_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."heartbeat_cycles"
    ADD CONSTRAINT "heartbeat_cycles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kv_store_49d15288"
    ADD CONSTRAINT "kv_store_49d15288_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."lockup_tokens"
    ADD CONSTRAINT "lockup_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."network_snapshots"
    ADD CONSTRAINT "network_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."network_wallets"
    ADD CONSTRAINT "network_wallets_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."network_wallets"
    ADD CONSTRAINT "network_wallets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."risk_scores"
    ADD CONSTRAINT "risk_scores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."simulated_watchlist"
    ADD CONSTRAINT "simulated_watchlist_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."treasury_mandates"
    ADD CONSTRAINT "treasury_mandates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wallets"
    ADD CONSTRAINT "wallets_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_agent_conversations_bank" ON "public"."agent_conversations" USING "btree" ("bank_id");



CREATE INDEX "idx_agent_conversations_bank_time" ON "public"."agent_conversations" USING "btree" ("bank_id", "created_at" DESC);



CREATE INDEX "idx_agent_messages_processed" ON "public"."agent_messages" USING "btree" ("processed") WHERE (NOT "processed");



CREATE INDEX "idx_agent_messages_to_bank" ON "public"."agent_messages" USING "btree" ("to_bank_id");



CREATE INDEX "idx_agent_messages_transaction" ON "public"."agent_messages" USING "btree" ("transaction_id");



CREATE INDEX "idx_compliance_logs_transaction" ON "public"."compliance_logs" USING "btree" ("transaction_id");



CREATE INDEX "idx_heartbeat_cycles_number" ON "public"."heartbeat_cycles" USING "btree" ("cycle_number" DESC);



CREATE INDEX "idx_network_snapshots_timestamp" ON "public"."network_snapshots" USING "btree" ("timestamp" DESC);



CREATE INDEX "idx_risk_scores_transaction" ON "public"."risk_scores" USING "btree" ("transaction_id");



CREATE INDEX "idx_transactions_receiver" ON "public"."transactions" USING "btree" ("receiver_bank_id");



CREATE INDEX "idx_transactions_sender" ON "public"."transactions" USING "btree" ("sender_bank_id");



CREATE INDEX "idx_transactions_status" ON "public"."transactions" USING "btree" ("status");



CREATE INDEX "idx_treasury_mandates_bank" ON "public"."treasury_mandates" USING "btree" ("bank_id", "is_active");



CREATE INDEX "idx_wallets_bank_id" ON "public"."wallets" USING "btree" ("bank_id");



CREATE INDEX "kv_store_49d15288_key_idx" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx1" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx10" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx100" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx101" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx102" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx103" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx104" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx105" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx106" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx107" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx108" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx109" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx11" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx110" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx111" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx112" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx113" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx114" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx115" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx116" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx117" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx118" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx119" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx12" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx120" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx121" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx122" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx123" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx124" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx125" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx126" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx127" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx128" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx129" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx13" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx130" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx131" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx132" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx133" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx134" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx135" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx136" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx137" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx138" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx139" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx14" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx140" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx141" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx142" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx143" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx144" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx145" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx146" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx147" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx148" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx149" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx15" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx150" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx151" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx152" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx153" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx154" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx155" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx156" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx157" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx158" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx159" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx16" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx160" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx161" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx17" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx18" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx19" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx2" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx20" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx21" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx22" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx23" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx24" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx25" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx26" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx27" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx28" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx29" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx3" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx30" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx31" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx32" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx33" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx34" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx35" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx36" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx37" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx38" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx39" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx4" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx40" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx41" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx42" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx43" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx44" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx45" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx46" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx47" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx48" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx49" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx5" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx50" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx51" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx52" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx53" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx54" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx55" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx56" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx57" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx58" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx59" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx6" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx60" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx61" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx62" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx63" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx64" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx65" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx66" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx67" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx68" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx69" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx7" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx70" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx71" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx72" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx73" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx74" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx75" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx76" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx77" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx78" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx79" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx8" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx80" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx81" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx82" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx83" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx84" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx85" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx86" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx87" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx88" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx89" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx9" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx90" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx91" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx92" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx93" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx94" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx95" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx96" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx97" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx98" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE INDEX "kv_store_49d15288_key_idx99" ON "public"."kv_store_49d15288" USING "btree" ("key" "text_pattern_ops");



CREATE OR REPLACE TRIGGER "banks_updated_at" BEFORE UPDATE ON "public"."banks" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



ALTER TABLE ONLY "public"."agent_conversations"
    ADD CONSTRAINT "agent_conversations_bank_id_fkey" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id");



ALTER TABLE ONLY "public"."agent_conversations"
    ADD CONSTRAINT "agent_conversations_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id");



ALTER TABLE ONLY "public"."agent_messages"
    ADD CONSTRAINT "agent_messages_from_bank_id_fkey" FOREIGN KEY ("from_bank_id") REFERENCES "public"."banks"("id");



ALTER TABLE ONLY "public"."agent_messages"
    ADD CONSTRAINT "agent_messages_to_bank_id_fkey" FOREIGN KEY ("to_bank_id") REFERENCES "public"."banks"("id");



ALTER TABLE ONLY "public"."agent_messages"
    ADD CONSTRAINT "agent_messages_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id");



ALTER TABLE ONLY "public"."bank_agent_config"
    ADD CONSTRAINT "bank_agent_config_bank_id_fkey" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cadenza_flags"
    ADD CONSTRAINT "cadenza_flags_lockup_token_id_fkey" FOREIGN KEY ("lockup_token_id") REFERENCES "public"."lockup_tokens"("id");



ALTER TABLE ONLY "public"."cadenza_flags"
    ADD CONSTRAINT "cadenza_flags_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id");



ALTER TABLE ONLY "public"."compliance_logs"
    ADD CONSTRAINT "compliance_logs_bank_id_fkey" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id");



ALTER TABLE ONLY "public"."compliance_logs"
    ADD CONSTRAINT "compliance_logs_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id");



ALTER TABLE ONLY "public"."lockup_tokens"
    ADD CONSTRAINT "lockup_tokens_receiver_bank_id_fkey" FOREIGN KEY ("receiver_bank_id") REFERENCES "public"."banks"("id");



ALTER TABLE ONLY "public"."lockup_tokens"
    ADD CONSTRAINT "lockup_tokens_sender_bank_id_fkey" FOREIGN KEY ("sender_bank_id") REFERENCES "public"."banks"("id");



ALTER TABLE ONLY "public"."lockup_tokens"
    ADD CONSTRAINT "lockup_tokens_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id");



ALTER TABLE ONLY "public"."risk_scores"
    ADD CONSTRAINT "risk_scores_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_receiver_bank_id_fkey" FOREIGN KEY ("receiver_bank_id") REFERENCES "public"."banks"("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_sender_bank_id_fkey" FOREIGN KEY ("sender_bank_id") REFERENCES "public"."banks"("id");



ALTER TABLE ONLY "public"."treasury_mandates"
    ADD CONSTRAINT "treasury_mandates_bank_id_fkey" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wallets"
    ADD CONSTRAINT "wallets_bank_id_fkey" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE CASCADE;



CREATE POLICY "Allow all for demo" ON "public"."agent_conversations" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for demo" ON "public"."agent_messages" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for demo" ON "public"."bank_agent_config" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for demo" ON "public"."banks" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for demo" ON "public"."compliance_logs" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for demo" ON "public"."risk_scores" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for demo" ON "public"."transactions" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for demo" ON "public"."wallets" USING (true) WITH CHECK (true);



ALTER TABLE "public"."agent_conversations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."agent_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bank_agent_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."banks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."compliance_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kv_store_49d15288" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."risk_scores" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wallets" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."agent_messages";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."bank_agent_config";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."banks";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."heartbeat_cycles";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."network_snapshots";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."transactions";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

























































































































































GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "service_role";


















GRANT ALL ON TABLE "public"."agent_conversations" TO "anon";
GRANT ALL ON TABLE "public"."agent_conversations" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_conversations" TO "service_role";



GRANT ALL ON TABLE "public"."agent_messages" TO "anon";
GRANT ALL ON TABLE "public"."agent_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_messages" TO "service_role";



GRANT ALL ON TABLE "public"."bank_agent_config" TO "anon";
GRANT ALL ON TABLE "public"."bank_agent_config" TO "authenticated";
GRANT ALL ON TABLE "public"."bank_agent_config" TO "service_role";



GRANT ALL ON TABLE "public"."banks" TO "anon";
GRANT ALL ON TABLE "public"."banks" TO "authenticated";
GRANT ALL ON TABLE "public"."banks" TO "service_role";



GRANT ALL ON TABLE "public"."cadenza_flags" TO "anon";
GRANT ALL ON TABLE "public"."cadenza_flags" TO "authenticated";
GRANT ALL ON TABLE "public"."cadenza_flags" TO "service_role";



GRANT ALL ON TABLE "public"."compliance_logs" TO "anon";
GRANT ALL ON TABLE "public"."compliance_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."compliance_logs" TO "service_role";



GRANT ALL ON TABLE "public"."heartbeat_cycles" TO "anon";
GRANT ALL ON TABLE "public"."heartbeat_cycles" TO "authenticated";
GRANT ALL ON TABLE "public"."heartbeat_cycles" TO "service_role";



GRANT ALL ON TABLE "public"."kv_store_49d15288" TO "anon";
GRANT ALL ON TABLE "public"."kv_store_49d15288" TO "authenticated";
GRANT ALL ON TABLE "public"."kv_store_49d15288" TO "service_role";



GRANT ALL ON TABLE "public"."lockup_tokens" TO "anon";
GRANT ALL ON TABLE "public"."lockup_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."lockup_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."network_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."network_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."network_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."network_wallets" TO "anon";
GRANT ALL ON TABLE "public"."network_wallets" TO "authenticated";
GRANT ALL ON TABLE "public"."network_wallets" TO "service_role";



GRANT ALL ON TABLE "public"."risk_scores" TO "anon";
GRANT ALL ON TABLE "public"."risk_scores" TO "authenticated";
GRANT ALL ON TABLE "public"."risk_scores" TO "service_role";



GRANT ALL ON TABLE "public"."simulated_watchlist" TO "anon";
GRANT ALL ON TABLE "public"."simulated_watchlist" TO "authenticated";
GRANT ALL ON TABLE "public"."simulated_watchlist" TO "service_role";



GRANT ALL ON TABLE "public"."transactions" TO "anon";
GRANT ALL ON TABLE "public"."transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."transactions" TO "service_role";



GRANT ALL ON TABLE "public"."treasury_mandates" TO "anon";
GRANT ALL ON TABLE "public"."treasury_mandates" TO "authenticated";
GRANT ALL ON TABLE "public"."treasury_mandates" TO "service_role";



GRANT ALL ON TABLE "public"."wallets" TO "anon";
GRANT ALL ON TABLE "public"."wallets" TO "authenticated";
GRANT ALL ON TABLE "public"."wallets" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































