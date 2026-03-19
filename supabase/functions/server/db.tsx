// Direct Postgres connection for Azure production.
// No Supabase fallback — fails fast if DATABASE_URL is missing.

import postgres from "npm:postgres";

const DATABASE_URL = Deno.env.get("DATABASE_URL");
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required — Supabase is not used in production");
}

const sql = postgres(DATABASE_URL, { max: 10 });

export default sql;
