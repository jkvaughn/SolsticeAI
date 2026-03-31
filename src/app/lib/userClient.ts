/**
 * userClient.ts — Enterprise user API client
 *
 * Wraps callServer from supabaseClient with X-User-Email header.
 * Uses the same URL, auth, queueing, and retry logic as all other API calls.
 */

import { callServer } from '../supabaseClient';

// NOTE: callServer already prepends serverBaseUrl which includes the route prefix.
// Routes here should NOT include /make-server-49d15288/ — just the path after it.

/**
 * Send a GET request to a user-scoped server route.
 * For mutations, use userCallServerPost.
 */
export async function userCallServer<T = unknown>(
  route: string,
  email: string,
): Promise<T> {
  const fullRoute = route;
  return callServer<T>(fullRoute, undefined, 3, {
    headers: { 'X-User-Email': email },
  });
}

/**
 * Send a POST request to a user-scoped server route (for updates/mutations).
 */
export async function userCallServerPost<T = unknown>(
  route: string,
  email: string,
  body: Record<string, unknown>,
): Promise<T> {
  const fullRoute = route;
  return callServer<T>(fullRoute, body, 3, {
    headers: { 'X-User-Email': email },
  });
}
