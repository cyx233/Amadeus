import assert from 'node:assert/strict';
import test from 'node:test';

// A stable secret so key derivation is deterministic across the run.
process.env.JWT_SECRET = 'test-secret-for-crypto-unit';

const { hashApiKey, encryptSecret, decryptSecret, isEncrypted } = await import(
  '@/shared/secret-crypto.js'
);

test('hashApiKey is deterministic and hides the plaintext', () => {
  const key = 'ck_deadbeef';
  const h = hashApiKey(key);
  assert.equal(h, hashApiKey(key), 'same input -> same hash');
  assert.notEqual(h, key, 'hash is not the plaintext');
  assert.equal(h.length, 64, 'sha256 hex is 64 chars');
  assert.notEqual(hashApiKey('ck_other'), h, 'different input -> different hash');
});

test('encrypt/decrypt round-trips', () => {
  const secret = 'ghp_abc123SECRETtoken';
  const enc = encryptSecret(secret);
  assert.ok(isEncrypted(enc), 'ciphertext carries the enc.v1 marker');
  assert.notEqual(enc, secret, 'ciphertext differs from plaintext');
  assert.equal(decryptSecret(enc), secret, 'decrypt recovers the original');
});

test('encryption is non-deterministic (random IV)', () => {
  const a = encryptSecret('same');
  const b = encryptSecret('same');
  assert.notEqual(a, b, 'each encryption uses a fresh IV');
  assert.equal(decryptSecret(a), decryptSecret(b));
});

test('decryptSecret passes legacy plaintext through unchanged', () => {
  // Rows written before encryption have no enc.v1 prefix.
  assert.equal(decryptSecret('ghp_legacyPlaintext'), 'ghp_legacyPlaintext');
  assert.equal(isEncrypted('ghp_legacyPlaintext'), false);
});

test('tampered ciphertext fails the GCM auth tag', () => {
  const enc = encryptSecret('tamper-me');
  // Flip a char in the ciphertext body (last segment).
  const parts = enc.split('.');
  parts[parts.length - 1] = parts[parts.length - 1].slice(0, -1) +
    (parts[parts.length - 1].slice(-1) === 'A' ? 'B' : 'A');
  assert.throws(() => decryptSecret(parts.join('.')), 'auth tag mismatch throws');
});
