import { callServer } from '../supabaseClient';

/**
 * Admin-gated server call — attaches X-Admin-Email header for
 * backend `requireAdmin()` validation. Used by AdminConsole,
 * SetupPageContent, DangerZoneContent, etc.
 *
 * Optionally accepts extra headers (e.g. X-Reauth-Token for Phase 2).
 */
export function adminCallServer<T = unknown>(
  route: string,
  body?: Record<string, unknown> | unknown,
  maxRetries = 3,
  email?: string | null,
  extraHeaders?: Record<string, string>,
) {
  return callServer<T>(route, body, maxRetries, {
    headers: {
      ...(email ? { 'X-Admin-Email': email } : {}),
      ...extraHeaders,
    },
  });
}
