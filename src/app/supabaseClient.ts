import { createClient } from '@supabase/supabase-js';

// ============================================================
// Environment configuration — reads from Vite env vars.
// Set these in .env (local), .env.staging, or .env.production.
// ============================================================
const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const publicAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const functionName = import.meta.env.VITE_SUPABASE_FUNCTION_NAME;

if (!projectId || !publicAnonKey || !functionName) {
  throw new Error(
    `Missing required environment variables. Check your .env file:\n` +
    `  VITE_SUPABASE_PROJECT_ID=${projectId ? '✓' : 'MISSING'}\n` +
    `  VITE_SUPABASE_ANON_KEY=${publicAnonKey ? '✓' : 'MISSING'}\n` +
    `  VITE_SUPABASE_FUNCTION_NAME=${functionName ? '✓' : 'MISSING'}`
  );
}

const supabaseUrl = `https://${projectId}.supabase.co`;
// Production can override the server URL to point at Azure Container Apps
// instead of Supabase Edge Functions (different RPC endpoint).
import { RUNTIME_SERVER_BASE_URL, RUNTIME_IS_PRODUCTION } from './runtime-env';
const serverBaseUrl = RUNTIME_SERVER_BASE_URL
  || `${supabaseUrl}/functions/v1/${functionName}`;

// ============================================================
// Request throttling — only needed for Supabase Edge Functions
// which return 429s under concurrent load. Production (Azure
// Container App) handles concurrent requests fine — no queue.
// ============================================================
const isProduction = RUNTIME_IS_PRODUCTION;
const REQUEST_GAP_MS = 350; // staging only

let requestQueue: Promise<void> = Promise.resolve();

function queuedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // Production: direct fetch, no queue, full parallelism
  if (isProduction) return fetch(input, init);

  // Staging: serialize with 350ms gap to avoid Supabase 429s
  return new Promise<Response>((resolve, reject) => {
    requestQueue = requestQueue
      .then(() => sleep(REQUEST_GAP_MS))
      .then(() => fetch(input, init))
      .then(resolve, reject);
  });
}

// Singleton Supabase client — uses the throttled fetch wrapper
export const supabase = createClient(supabaseUrl, publicAnonKey, {
  global: {
    fetch: queuedFetch as unknown as typeof fetch,
  },
});

// Sleep helper
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Helper to call Edge Functions (server routes) with proper auth
// Also runs through the global request queue via queuedFetch.
// Retries network errors and 5xx with backoff. Does NOT retry 429s —
// the platform's fetch wrapper already handles 429 retries transparently.
// By default uses publicAnonKey for the Supabase gateway. Pass
// `{ authenticated: true }` in options to send the user's JWT instead
// (for routes that validate the user via supabase.auth.getUser).
export async function callServer<T = unknown>(
  route: string,
  body?: Record<string, unknown> | unknown,
  maxRetries = 3,
  options?: { authenticated?: boolean; headers?: Record<string, string> },
): Promise<T> {
  const url = `${serverBaseUrl}${route}`;
  const requestId = `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  console.log(`[callServer:${requestId}] → ${route}`, body ? JSON.stringify(body).slice(0, 500) : '(no body)');

  // Default to publicAnonKey; only use user JWT when explicitly requested
  let authToken = publicAnonKey;
  if (options?.authenticated) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        authToken = session.access_token;
      }
    } catch {
      // Fall back to publicAnonKey if session retrieval fails
    }
  }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      console.log(`[callServer:${requestId}] Attempt ${attempt + 1}/${maxRetries + 1} for ${route}`);
    }

    let response: Response;
    try {
      response = await queuedFetch(url, {
        method: body ? 'POST' : 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
          ...(options?.headers || {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (fetchErr) {
      const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      // Retry network errors (Failed to fetch, connection refused, timeout, etc.)
      if (attempt < maxRetries) {
        const delayMs = 1000 * Math.pow(2, attempt); // 1s → 2s → 4s
        console.warn(`[callServer:${requestId}] Network error on ${route}: ${msg} — retry ${attempt + 1}/${maxRetries} in ${delayMs}ms`);
        await sleep(delayMs);
        continue;
      }
      console.error(`[callServer:${requestId}] Network/fetch error on ${route} after ${maxRetries} retries: ${msg}`);
      throw new Error(`Network error calling ${route}: ${msg}`);
    }

    console.log(`[callServer:${requestId}] ← ${route} status=${response.status} ${response.statusText}`);

    // Retry only on 5xx server errors (NOT 429 — platform handles those)
    // But skip retries for non-transient errors (e.g. insufficient SOL balance)
    if (response.status >= 500 && attempt < maxRetries) {
      // Peek at error body before deciding to retry
      let bodyPreview = '';
      try {
        bodyPreview = await response.clone().text();
      } catch { /* ignore */ }

      const nonRetryablePatterns = [
        'insufficient_sol', 'Insufficient SOL', 'does not exist',
        'already burned', 'token account', 'mint authority',
        'Settlement failed', 'Reversal failed', 'Invalid JWT',
      ];
      const isNonRetryable = nonRetryablePatterns.some(p => bodyPreview.includes(p));

      if (isNonRetryable) {
        console.warn(`[callServer:${requestId}] Non-retryable 500 on ${route} — skipping retry: ${bodyPreview.slice(0, 200)}`);
        // Fall through to error handling below (don't retry)
      } else {
        const delayMs = 1000 * Math.pow(2, attempt); // 1s → 2s → 4s
        console.warn(`[callServer:${requestId}] ${response.status} on ${route} — retry ${attempt + 1}/${maxRetries} in ${delayMs}ms | body: ${bodyPreview.slice(0, 300)}`);
        await sleep(delayMs);
        continue;
      }
    }

    if (!response.ok) {
      let errorMessage: string;
      let rawBody: string | undefined;
      try {
        rawBody = await response.text();
        console.error(`[callServer:${requestId}] Error response body for ${route}:`, rawBody);
        try {
          const errorData = JSON.parse(rawBody);
          errorMessage = errorData.error || errorData.message || `Server error: ${response.status}`;
        } catch {
          errorMessage = `Server error: ${response.status} ${response.statusText} — body: ${rawBody?.slice(0, 300)}`;
        }
      } catch (_e) {
        errorMessage = `Server error: ${response.status} ${response.statusText}`;
      }
      throw new Error(errorMessage);
    }

    const responseBody = await response.json();
    console.log(`[callServer:${requestId}] ✓ ${route} response:`, JSON.stringify(responseBody).slice(0, 500));
    return responseBody as T;
  }

  throw new Error(`Failed ${route} after ${maxRetries} retries (network errors or 5xx)`);
}

export { projectId, publicAnonKey, supabaseUrl, serverBaseUrl };