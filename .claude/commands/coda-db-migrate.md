---
name: coda-db-migrate
description: Apply database migrations to both Azure Postgres (production) and Supabase (staging)
triggers:
  - run migration
  - apply migration
  - db migrate
  - migrate database
---

# CODA Database Migration

Apply SQL migrations to both production (Azure Postgres) and staging (Supabase).

## Steps

### 1. Find pending migrations
```bash
ls -la supabase/migrations/*.sql
```
Ask user which migration file(s) to apply if multiple are pending.

### 2. Apply to Supabase (staging)
```bash
# Repair any out-of-sync migration history first
supabase migration repair --status applied <TIMESTAMP> --linked

# Then push new migrations
supabase db push --linked
```
If `db push` fails with "already exists", mark older migrations as applied and retry.

### 3. Apply to Azure Postgres (production)
```bash
az postgres flexible-server execute \
  --name coda-prod-pgdb-o1jyyxla \
  --admin-user codaadmin \
  --admin-password 'EDPWRE9xCXZPWiKRJWbFxkeT' \
  --database-name coda \
  --file-path <MIGRATION_FILE>
```

### 4. Verify
- Check tables exist in both environments
- Report which tables/indexes were created
- Note: Container App may need redeployment if backend references new tables

## Connection details
- **Azure Postgres**: `coda-prod-pgdb-o1jyyxla.postgres.database.azure.com` / `codaadmin` / `coda`
- **Supabase**: Project `daekdqzghrjneftpvnfy` (linked)
