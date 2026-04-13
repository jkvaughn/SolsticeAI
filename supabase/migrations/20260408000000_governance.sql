-- ============================================================
-- Task 154: Governance Architecture + Change Request Workflow
-- Config permissions, change requests (maker/checker), config history
-- ============================================================

-- Config permissions (role authority matrix)
CREATE TABLE IF NOT EXISTS config_permissions (
  id TEXT PRIMARY KEY,
  resource TEXT NOT NULL,
  action TEXT NOT NULL,
  allowed_roles TEXT[] NOT NULL,
  requires_approval BOOLEAN DEFAULT false,
  approval_role TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Config change requests (maker/checker workflow)
CREATE TABLE IF NOT EXISTS config_change_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bank_id UUID,
  resource TEXT NOT NULL,
  field_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'applied')),
  submitted_by TEXT NOT NULL,
  submitted_at TIMESTAMPTZ DEFAULT now(),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ccr_status ON config_change_requests(status);
CREATE INDEX IF NOT EXISTS idx_ccr_bank ON config_change_requests(bank_id);

-- Agent config version history
CREATE TABLE IF NOT EXISTS agent_config_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bank_id UUID NOT NULL,
  field_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_by TEXT NOT NULL,
  change_type TEXT DEFAULT 'direct' CHECK (change_type IN ('direct', 'workflow', 'aria')),
  change_request_id UUID REFERENCES config_change_requests(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ach_bank ON agent_config_history(bank_id, created_at DESC);

-- Seed permissions
INSERT INTO config_permissions (id, resource, action, allowed_roles, requires_approval, approval_role) VALUES
  ('perm-risk-weight', 'bank_agent_config', 'update_risk_weights', '{admin,compliance,bsa_officer}', true, 'bsa_officer'),
  ('perm-escalation', 'bank_agent_config', 'update_escalation_thresholds', '{admin,compliance,bsa_officer}', true, 'bsa_officer'),
  ('perm-mandate', 'treasury_mandates', 'create_mandate', '{admin,treasury}', false, NULL),
  ('perm-mandate-edit', 'treasury_mandates', 'update_mandate', '{admin,treasury}', false, NULL),
  ('perm-concord-rules', 'bank_agent_config', 'update_compliance_rules', '{admin,compliance,bsa_officer}', true, 'bsa_officer'),
  ('perm-lockup-duration', 'bank_agent_config', 'update_lockup_duration', '{admin,treasury}', false, NULL),
  ('perm-agent-prompt', 'bank_agent_config', 'update_agent_prompt', '{admin}', true, 'admin'),
  ('perm-risk-rules', 'risk_rules', 'update_rules', '{admin,compliance,bsa_officer}', true, 'bsa_officer')
ON CONFLICT (id) DO NOTHING;
