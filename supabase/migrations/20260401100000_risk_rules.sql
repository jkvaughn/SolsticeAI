-- Risk Rules Table + Seed Rules (Task 153)
-- Target: Azure Postgres + local Supabase
-- Deterministic scoring engine evaluates these rules before Fermata (LLM)

-- Risk rules — deterministic risk evaluation rules
CREATE TABLE IF NOT EXISTS risk_rules (
  id TEXT PRIMARY KEY,
  dimension TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  condition_type TEXT NOT NULL,
  condition_params JSONB NOT NULL DEFAULT '{}',
  score_impact INTEGER NOT NULL,
  override_type TEXT NOT NULL DEFAULT 'ADDITIVE',
  active BOOLEAN DEFAULT true,
  version INTEGER DEFAULT 1,
  created_by TEXT DEFAULT 'system',
  approved_by TEXT,
  effective_from TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Add floor columns to risk_scores
ALTER TABLE risk_scores ADD COLUMN IF NOT EXISTS floor_score NUMERIC(6,2);
ALTER TABLE risk_scores ADD COLUMN IF NOT EXISTS floor_breakdown JSONB;
ALTER TABLE risk_scores ADD COLUMN IF NOT EXISTS rules_fired TEXT[];
ALTER TABLE risk_scores ADD COLUMN IF NOT EXISTS hard_overrides TEXT[];

-- Seed 13 deterministic rules (R-010 timezone deferred)
-- condition_params schema per condition_type:
--   threshold:  { "field": string, "operator": ">"|"<"|">="|"<=", "value": number }
--   count:      { "count": number, "window_minutes": number, "field"?: string, "value_below"?: number }
--   lookup:     { "field": string, "value": string }
--   pattern:    { "description": string, ...custom }
--   comparison: { "field_a": string, "field_b": string, "operator": "!=" | "==" }

INSERT INTO risk_rules (id, dimension, name, description, condition_type, condition_params, score_impact, override_type) VALUES
  ('R-001', 'counterparty', 'First-time counterparty', 'No prior transactions in this corridor', 'count', '{"count": 0, "window_minutes": 525600, "description": "corridor_history_count == 0"}', 15, 'ADDITIVE'),
  ('R-002', 'counterparty', 'Counterparty tier mismatch', 'Sender and receiver are different bank tiers', 'comparison', '{"field_a": "sender_tier", "field_b": "receiver_tier", "operator": "!="}', 10, 'ADDITIVE'),
  ('R-003', 'jurisdiction', 'Cross-border transaction', 'Sender and receiver in different jurisdictions', 'comparison', '{"field_a": "sender_jurisdiction", "field_b": "receiver_jurisdiction", "operator": "!="}', 5, 'ADDITIVE'),
  ('R-004', 'jurisdiction', 'High-risk jurisdiction', 'Either party in a sanctioned or high-risk jurisdiction', 'lookup', '{"field": "jurisdiction", "high_risk_list": ["IR","KP","SY","CU","VE","MM","BY","RU"]}', 40, 'HARD_ESCALATE'),
  ('R-005', 'asset_type', 'Large transaction', 'Transaction amount exceeds $5M', 'threshold', '{"field": "amount", "operator": ">=", "value": 5000000}', 10, 'ADDITIVE'),
  ('R-006', 'asset_type', 'Very large transaction', 'Transaction amount exceeds $25M', 'threshold', '{"field": "amount", "operator": ">=", "value": 25000000}', 25, 'ADDITIVE'),
  ('R-007', 'behavioral', 'Velocity spike', 'More than 5 transactions from sender in 60 minutes', 'count', '{"count": 5, "window_minutes": 60, "description": "sender_tx_count_60m > 5"}', 20, 'ADDITIVE'),
  ('R-008', 'behavioral', 'Structuring pattern', '3+ transactions just below $10K within 24 hours', 'count', '{"count": 3, "window_minutes": 1440, "value_below": 10000, "description": "potential_structuring"}', 35, 'HARD_ESCALATE'),
  ('R-009', 'behavioral', 'Amount deviation', 'Amount is >10x the corridor average', 'threshold', '{"field": "amount_vs_corridor_avg", "operator": ">=", "value": 10}', 25, 'ADDITIVE'),
  ('R-011', 'behavioral', 'Rapid counterparty rotation', '3+ unique counterparties in 30 minutes', 'count', '{"count": 3, "window_minutes": 30, "description": "unique_counterparties_30m >= 3"}', 15, 'ADDITIVE'),
  ('R-012', 'counterparty', 'Suspended counterparty', 'Counterparty bank status is suspended', 'lookup', '{"field": "receiver_status", "value": "suspended"}', 100, 'HARD_BLOCK'),
  ('R-013', 'jurisdiction', 'Sanctioned entity match', 'Name matches simulated watchlist entry', 'lookup', '{"field": "watchlist_match", "value": true}', 100, 'HARD_BLOCK'),
  ('R-014', 'asset_type', 'Purpose code mismatch', 'Purpose code not in bank approved list', 'lookup', '{"field": "purpose_code_approved", "value": false}', 20, 'ADDITIVE')
ON CONFLICT (id) DO NOTHING;
