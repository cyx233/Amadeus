/**
 * Secret storage helpers for credentials the backend persists itself.
 *
 * Two distinct treatments, by access pattern:
 *
 * - `hashApiKey` — for the app's own `ck_` API keys. They are looked up by
 *   value and never shown again, i.e. they behave like passwords. We store a
 *   SHA-256 digest and compare digests; the plaintext key is never persisted,
 *   so a leaked DB reveals nothing usable. No salt is needed because the keys
 *   are 256-bit random tokens (no dictionary/guessing surface).
 *
 * - `encryptSecret`/`decryptSecret` — for service tokens (GitHub/GitLab/…) that
 *   must be handed back to `git` in cleartext, so hashing won't do. Encrypted
 *   with AES-256-GCM under a key derived from the same JWT_SECRET the auth layer
 *   uses. `decryptSecret` returns legacy plaintext unchanged so existing rows
 *   keep working (lazy migration: re-encrypted on next write).
 */

import crypto from 'node:crypto';

const ENC_PREFIX = 'enc.v1.'; // marks AES-GCM ciphertext so we can detect legacy plaintext

let cachedKey: Buffer | null = null;

/**
 * Resolves the root secret. JWT_SECRET is injected as an env var in every
 * deployment (the multi-user gateway sets it per-container; single-user dev
 * sets it too), so we read it from the environment and keep this helper free
 * of any database dependency. Falls back to a fixed dev-only string with a
 * warning if unset, so a misconfigured local run degrades loudly rather than
 * crashing — production always has JWT_SECRET.
 */
function resolveSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  console.warn(
    '[secret-crypto] JWT_SECRET is not set — using an insecure fallback key. ' +
    'Set JWT_SECRET so stored credentials are protected.'
  );
  return 'amadeus-insecure-dev-fallback';
}

/** Derives a stable 32-byte AES key from the root secret. */
function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  // Domain separation so the encryption key is not the raw JWT secret.
  cachedKey = crypto.createHash('sha256').update(`amadeus.cred.v1:${resolveSecret()}`).digest();
  return cachedKey;
}

/** SHA-256 hex digest of an API key. Deterministic so it can be looked up by value. */
export function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey, 'utf8').digest('hex');
}

/** Encrypts a secret with AES-256-GCM. Output: `enc.v1.<iv>.<tag>.<ciphertext>` (base64url parts). */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString('base64url')}.${tag.toString('base64url')}.${ct.toString('base64url')}`;
}

/**
 * Decrypts a value produced by `encryptSecret`. Values without the `enc.v1.`
 * prefix are treated as legacy plaintext and returned unchanged (lazy migration).
 */
export function decryptSecret(stored: string): string {
  if (!stored.startsWith(ENC_PREFIX)) return stored; // legacy plaintext
  const [ivB64, tagB64, ctB64] = stored.slice(ENC_PREFIX.length).split('.');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getKey(),
    Buffer.from(ivB64, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/** True if a stored value is already AES-GCM ciphertext (not legacy plaintext). */
export function isEncrypted(stored: string): boolean {
  return stored.startsWith(ENC_PREFIX);
}
