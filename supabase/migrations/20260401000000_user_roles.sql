-- Add role field to user_profiles for role-based auth (Task 151)
-- Valid roles: treasury, compliance, bsa_officer, executive, admin
-- Default: admin (preserves current super-admin behavior)

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'admin';
