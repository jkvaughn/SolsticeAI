// Admin Supabase client with service role key for server-side operations
import { createClient } from "jsr:@supabase/supabase-js@2.49.8";

let _client: ReturnType<typeof createClient> | null = null;

export function getAdminClient() {
  if (!_client) {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }
    _client = createClient(url, key);
  }
  return _client;
}
