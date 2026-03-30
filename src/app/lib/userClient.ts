/**
 * userClient.ts — Enterprise user API client
 *
 * Unlike adminClient (which wraps callServer and is limited to POST/GET),
 * this provides explicit HTTP method control (GET, PUT, POST, DELETE) for
 * user profile, preferences, session, and audit endpoints.
 *
 * Reads the same VITE_* env vars as supabaseClient.ts to build the
 * server URL. Sends X-User-Email on every request for backend identity.
 */

// Build the server base URL from the same env vars as supabaseClient.ts
const serverBaseUrl =
  import.meta.env.VITE_SERVER_BASE_URL ||
  `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/${import.meta.env.VITE_SUPABASE_FUNCTION_NAME}`;

const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Route prefix — must match the Hono app mount in index.tsx
const PREFIX = 'make-server-49d15288';

/**
 * Send a request to a user-scoped server route.
 *
 * @param route   - Path after the prefix, e.g. "/user/profile"
 * @param email   - Authenticated user's email (sent as X-User-Email header)
 * @param method  - HTTP method (default GET)
 * @param body    - Optional JSON body (sent for POST/PUT/DELETE when provided)
 * @returns Parsed JSON response typed as T
 *
 * @example
 *   const profile = await userCallServer<UserProfile>('/user/profile', email);
 *   await userCallServer('/user/preferences', email, 'PUT', { theme: 'dark' });
 */
export async function userCallServer<T = unknown>(
  route: string,
  email: string,
  method: 'GET' | 'PUT' | 'POST' | 'DELETE' = 'GET',
  body?: Record<string, unknown>,
): Promise<T> {
  const url = `${serverBaseUrl}/${PREFIX}${route}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-User-Email': email,
    'Authorization': `Bearer ${anonKey}`,
  };

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(
      (err as { error?: string; message?: string }).error ||
      (err as { error?: string; message?: string }).message ||
      `Request failed: ${res.status}`,
    );
  }

  return res.json() as Promise<T>;
}
