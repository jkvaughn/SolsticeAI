-- Task 157: Unified Sandbox Framework
-- Adds per-integration sandbox/live mode tracking and activity logging.

-- Add unified integrations JSONB to bank_agent_config
ALTER TABLE bank_agent_config ADD COLUMN IF NOT EXISTS integrations JSONB DEFAULT '{
  "verify": { "mode": "sandbox", "last_promoted_at": null, "promoted_by": null },
  "compliance_filing": { "mode": "sandbox", "last_promoted_at": null, "promoted_by": null },
  "custody": { "mode": "sandbox", "last_promoted_at": null, "promoted_by": null }
}'::jsonb;

-- Integration activity log
CREATE TABLE IF NOT EXISTS integration_activity_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bank_id UUID NOT NULL,
  integration TEXT NOT NULL,
  action TEXT NOT NULL,
  endpoint TEXT,
  status_code INTEGER,
  latency_ms INTEGER,
  request_summary TEXT,
  response_summary TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ial_bank_integration ON integration_activity_log(bank_id, integration, created_at DESC);
