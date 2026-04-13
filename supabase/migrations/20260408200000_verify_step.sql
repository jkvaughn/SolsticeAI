-- Task 158: Pipeline Verify Step
-- Add verify_result JSONB column to transactions table for account verification data.
-- check_type is TEXT so no constraint change needed for VERIFY type support.

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS verify_result JSONB;
