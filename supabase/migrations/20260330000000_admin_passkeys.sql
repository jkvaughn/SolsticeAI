-- Admin Passkeys — WebAuthn credential storage for production MFA
-- Target: Azure Postgres (coda-prod-pgdb-o1jyyxla)
-- Apply via: psql "$DATABASE_URL" < supabase/migrations/20260330000000_admin_passkeys.sql
-- Passkeys are production-only — no local Supabase migration needed.

CREATE TABLE IF NOT EXISTS admin_passkeys (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  transports TEXT[],
  device_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_admin_passkeys_email ON admin_passkeys(email);
