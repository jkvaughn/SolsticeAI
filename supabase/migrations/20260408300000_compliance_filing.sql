-- Task 164: Compliance Filing + Alert Infrastructure
-- Compliance filing requests (CTR, SAR candidates) and unified alert queue

-- Compliance filing requests (CTR, SAR candidates)
CREATE TABLE IF NOT EXISTS compliance_filings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bank_id UUID,
  transaction_id UUID,
  filing_type TEXT NOT NULL CHECK (filing_type IN ('CTR', 'SAR', 'OTHER')),
  status TEXT DEFAULT 'auto_generated' CHECK (status IN ('auto_generated', 'under_review', 'filed', 'dismissed')),
  amount NUMERIC,
  trigger_reason TEXT,
  filed_by TEXT,
  filed_at TIMESTAMPTZ,
  external_case_url TEXT,
  external_tracking_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cf_status ON compliance_filings(status);
CREATE INDEX IF NOT EXISTS idx_cf_bank ON compliance_filings(bank_id);

-- Unified alert queue (merges Cadenza + external alerts)
CREATE TABLE IF NOT EXISTS unified_alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('cadenza', 'external', 'filing')),
  source_id TEXT,
  alert_type TEXT NOT NULL,
  severity TEXT DEFAULT 'medium',
  title TEXT NOT NULL,
  description TEXT,
  transaction_id UUID,
  bank_id UUID,
  resolved BOOLEAN DEFAULT false,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ua_resolved ON unified_alerts(resolved, created_at DESC);
