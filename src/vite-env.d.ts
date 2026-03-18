/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_PROJECT_ID: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_SUPABASE_FUNCTION_NAME: string;
  readonly VITE_MAPBOX_TOKEN: string;
  readonly VITE_SOLANA_EXPLORER_URL?: string;
  readonly VITE_SOLANA_CLUSTER?: string;
  readonly VITE_SOLANA_FAUCET_URL?: string;
  readonly VITE_AUTH_PROVIDER?: 'azure' | 'supabase';
  readonly VITE_USE_SUPABASE_REALTIME?: 'true' | 'false';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
