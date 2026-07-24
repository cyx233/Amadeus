/**
 * Typed helpers for routes behind `authenticateToken`.
 *
 * `authenticateToken` (server/middleware/auth) is fail-closed: a missing or
 * invalid token never reaches the handler (401/403). So on a protected route
 * `req.user` is guaranteed present at runtime — but Express's base `Request`
 * type doesn't know that, which is why call sites used to cast or reach for
 * `req.user?.id as number`.
 *
 * These carry the guarantee into the type system:
 * - `AuthenticatedRequest` — a Request whose `user` is non-optional.
 * - `getAuthUser(req)` — returns the user, throwing a 401-tagged AppError if
 *   it is somehow absent (e.g. a route mounted without the middleware). This
 *   is fail-closed by construction: no silent `undefined` flows downstream.
 */

import type { Request } from 'express';

import type { AuthenticatedUser } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

/** A request on a route guarded by `authenticateToken`: `user` is present. */
export type AuthenticatedRequest = Request & { user: AuthenticatedUser };

/**
 * Resolve the authenticated user from a protected-route request. Throws a
 * 401-tagged AppError if `user` is missing — which should be impossible behind
 * `authenticateToken`, so hitting it means a route was mounted without auth.
 * Fail-closed: callers get a real user or an error, never `undefined`.
 */
export function getAuthUser(req: Request): AuthenticatedUser {
  const user = (req as AuthenticatedRequest).user;
  if (!user || user.id === undefined || user.id === null) {
    throw new AppError('Authenticated user is required', {
      code: 'AUTHENTICATION_REQUIRED',
      statusCode: 401,
    });
  }
  return user;
}
