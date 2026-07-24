import jwt from 'jsonwebtoken';
import type { NextFunction, ParamsDictionary, Request, Response } from 'express-serve-static-core';

import { userDb, appConfigDb } from '../modules/database/index.js';
import { IS_PLATFORM } from '../constants/config.js';
import type { AuthenticatedUser, AuthenticatedWebSocketUser } from '../shared/types.js';

// Use env var if set, otherwise auto-generate a unique secret per installation.
// In the multi-user gateway deployment, JWT_SECRET is injected via env so the
// auth entrypoint and every backend container verify the same tokens.
const JWT_SECRET = process.env.JWT_SECRET || appConfigDb.getOrCreateJwtSecret();

// Name of the cookie the auth entrypoint sets so the nginx gateway can route
// by identity (browsers send cookies on the first HTML request; Bearer tokens
// in localStorage are not available then).
const AUTH_COOKIE_NAME = 'amadeus_token';

// jwt.verify()'s declared return type is `Jwt | JwtPayload | string` since the
// library supports arbitrary payloads, but `generateToken` below is the only
// place this app ever signs a token, and it always embeds { userId, username }.
// So any successfully verified token is guaranteed to carry this shape at
// runtime, and every call site below is a direct cast rather than a guard —
// asserting a fact this module itself enforces, not validating untrusted input.
type JwtUserPayload = { userId: number; username: string; exp?: number; iat?: number };

// Minimal cookie parser (avoids adding cookie-parser for one header).
function readTokenFromCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === AUTH_COOKIE_NAME) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

// Generic over `P` (Express's route-params shape) rather than typed as a
// bare `RequestHandler`: app.get/put/etc. infer each route's params type
// from the literal path string (e.g. `:projectId` -> `{ projectId: string
// }`) whenever every handler passed to that call shares a compatible
// params generic. A bare `RequestHandler` pins a concrete `P =
// ParamsDictionary` (whose values are `string | string[]`), which —
// mixed into the same handler array as the route's own inferred, narrower
// `{ projectId: string }` — widens `req.params.*` back to `string |
// string[]` for every route this middleware is chained onto. Leaving `P`
// generic (default `ParamsDictionary`, same as Express's own default) lets
// each call site's inference win instead of overriding it — and, unlike
// `RequestHandler<any>`, still catches a typo'd param name at the call site
// (verified: `req.params.projectIdTypo` on a route with no such param is a
// real type error here, but silently `any` under the old annotation).
function validateApiKey<P = ParamsDictionary>(req: Request<P>, res: Response, next: NextFunction): void {
  // Skip API key validation if not configured
  if (!process.env.API_KEY) {
    next();
    return;
  }

  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.API_KEY) {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }
  next();
}

// JWT authentication middleware. Generic over `P` for the same reason as
// validateApiKey above — see that comment.
async function authenticateToken<P = ParamsDictionary>(
  req: Request<P> & { user?: AuthenticatedUser },
  res: Response,
  next: NextFunction
): Promise<void> {
  // Platform mode:  use single database user
  if (IS_PLATFORM) {
    try {
      const user = userDb.getFirstUser();
      if (!user) {
        res.status(500).json({ error: 'Platform mode: No user found in database' });
        return;
      }
      req.user = user;
      next();
      return;
    } catch (error) {
      console.error('Platform mode error:', error);
      res.status(500).json({ error: 'Platform mode: Failed to fetch user' });
      return;
    }
  }

  // Normal OSS JWT validation
  const authHeader = req.headers['authorization'];
  let token: string | null = (authHeader && authHeader.split(' ')[1]) || null; // Bearer TOKEN

  // Also check query param for SSE endpoints (EventSource can't set headers).
  // Express types this as string | ParsedQs | (string|ParsedQs)[] (a client
  // can send `?token[]=a&token[]=b`), but jwt.verify (below) throws its own
  // JsonWebTokenError for a non-string input and that throw is caught by the
  // same try/catch either way — so asserting `string` here changes nothing
  // observable, it just moves the "not a string" rejection from inside
  // jwt.verify to the same place. A `typeof` guard instead would skip this
  // assignment and fall through to the cookie check below, which is NOT what
  // the original did (a truthy non-string query token was consumed here,
  // full stop) — so this stays a cast, not a narrowing check.
  if (!token && req.query.token) {
    token = req.query.token as string;
  }

  // Also accept the gateway cookie so the auth entrypoint's /api/auth/user can
  // serve as nginx's auth_request verifier (cookie is sent automatically).
  if (!token) {
    token = readTokenFromCookie(req.headers['cookie']);
  }

  if (!token) {
    res.status(401).json({ error: 'Access denied. No token provided.' });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtUserPayload;

    // Verify user still exists and is active
    const user = userDb.getUserById(decoded.userId);
    if (!user) {
      res.status(401).json({ error: 'Invalid token. User not found.' });
      return;
    }

    // Auto-refresh: if token is past halfway through its lifetime, issue a new one
    if (decoded.exp && decoded.iat) {
      const now = Math.floor(Date.now() / 1000);
      const halfLife = (decoded.exp - decoded.iat) / 2;
      if (now > decoded.iat + halfLife) {
        const newToken = generateToken(user);
        res.setHeader('X-Refreshed-Token', newToken);
      }
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(403).json({ error: 'Invalid token' });
    return;
  }
}

// Generate JWT token
const generateToken = (user: Pick<AuthenticatedUser, 'id' | 'username'>): string => {
  return jwt.sign(
    {
      userId: user.id,
      username: user.username
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
};

// WebSocket authentication function
const authenticateWebSocket = (token: string | null): AuthenticatedWebSocketUser | null => {
  // Platform mode: bypass token validation, return first user
  if (IS_PLATFORM) {
    try {
      const user = userDb.getFirstUser();
      if (user) {
        return { id: user.id, userId: user.id, username: user.username };
      }
      return null;
    } catch (error) {
      console.error('Platform mode WebSocket error:', error);
      return null;
    }
  }

  // Normal OSS JWT validation
  if (!token) {
    return null;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtUserPayload;
    // Verify user actually exists in database (matches REST authenticateToken behavior)
    const user = userDb.getUserById(decoded.userId);
    if (!user) {
      return null;
    }
    return { userId: user.id, username: user.username };
  } catch (error) {
    console.error('WebSocket token verification error:', error);
    return null;
  }
};

export {
  validateApiKey,
  authenticateToken,
  generateToken,
  authenticateWebSocket,
  JWT_SECRET,
  AUTH_COOKIE_NAME
};
