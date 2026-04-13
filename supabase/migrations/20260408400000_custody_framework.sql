-- Task 165: Digital Asset Custody + Collateral Framework
-- Proof of reserves attestations

CREATE TABLE IF NOT EXISTS proof_of_reserves (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bank_id UUID NOT NULL,
  asset_type TEXT NOT NULL,
  balance NUMERIC NOT NULL,
  usd_equivalent NUMERIC,
  attestation_hash TEXT,
  provider TEXT DEFAULT 'mock',
  fetched_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_por_bank ON proof_of_reserves(bank_id, fetched_at DESC);
