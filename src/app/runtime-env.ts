// Runtime environment detection — overrides Vite build-time env vars
// when the hostname indicates staging. This allows a single SWA build
// to serve both coda.solsticenetwork.xyz (prod) and coda-staging.solsticenetwork.xyz (staging).

const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
const isStaging = hostname.includes('staging') || hostname === 'localhost' || hostname === '127.0.0.1';

// In staging, force Supabase auth and no server base URL (reads via Supabase client).
// In production, use the build-time values from the SWA workflow.
export const RUNTIME_AUTH_PROVIDER: 'azure' | 'supabase' = isStaging
  ? 'supabase'
  : (import.meta.env.VITE_AUTH_PROVIDER as 'azure' | 'supabase') || 'supabase';

export const RUNTIME_SERVER_BASE_URL: string | undefined = isStaging
  ? undefined
  : import.meta.env.VITE_SERVER_BASE_URL || undefined;

export const RUNTIME_IS_PRODUCTION = !isStaging && !!RUNTIME_SERVER_BASE_URL;
