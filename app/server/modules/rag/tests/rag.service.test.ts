import assert from 'node:assert/strict';
import test from 'node:test';

import { retrieveContext, wrapKnowledge } from '@/modules/rag/rag.service.js';

// Note: the global on/off setting (setRagGloballyEnabled/isRagGloballyEnabled)
// is DB-backed (appConfigDb → better-sqlite3), which needs the native binding
// only present in the Docker image, so its round-trip is verified in the
// end-to-end check rather than here. These tests cover the pure retrieval logic.

// Swap global.fetch for the duration of a callback.
async function withFetch(
  impl: typeof fetch,
  run: () => Promise<void>
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

const jsonResponse = (body: unknown, ok = true): Response =>
  ({ ok, json: async () => body }) as Response;

test('retrieveContext returns the response text on a 200 with content', async () => {
  await withFetch(
    (async () => jsonResponse({ response: '  relevant workspace context  ' })) as typeof fetch,
    async () => {
      assert.equal(await retrieveContext('why X?'), 'relevant workspace context');
    }
  );
});

test('retrieveContext returns null on empty query without calling fetch', async () => {
  let called = false;
  await withFetch(
    (async () => {
      called = true;
      return jsonResponse({ response: 'x' });
    }) as typeof fetch,
    async () => {
      assert.equal(await retrieveContext('   '), null);
      assert.equal(called, false);
    }
  );
});

test('retrieveContext returns null on non-200', async () => {
  await withFetch(
    (async () => jsonResponse({ response: 'x' }, false)) as typeof fetch,
    async () => {
      assert.equal(await retrieveContext('q'), null);
    }
  );
});

test('retrieveContext returns null on empty/whitespace response body', async () => {
  await withFetch(
    (async () => jsonResponse({ response: '   ' })) as typeof fetch,
    async () => {
      assert.equal(await retrieveContext('q'), null);
    }
  );
});

test('retrieveContext returns null (never throws) on network error / abort', async () => {
  await withFetch(
    (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch,
    async () => {
      assert.equal(await retrieveContext('q'), null);
    }
  );
});

test('wrapKnowledge wraps context in a workspace_knowledge block', () => {
  const wrapped = wrapKnowledge('some ctx');
  assert.ok(wrapped.startsWith('<workspace_knowledge>'));
  assert.ok(wrapped.trimEnd().endsWith('</workspace_knowledge>'));
  assert.ok(wrapped.includes('some ctx'));
});
