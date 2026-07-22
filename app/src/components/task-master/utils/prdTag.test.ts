import assert from 'node:assert/strict';
import test from 'node:test';

import { prdNameToTag } from './prdTag';

test('prdNameToTag strips extension, lowercases, and slugifies', () => {
  assert.equal(prdNameToTag('prd.txt'), 'prd');
  assert.equal(prdNameToTag('PRD.md'), 'prd');
  assert.equal(prdNameToTag('Feature X.md'), 'feature-x');
  assert.equal(prdNameToTag('auth v2.txt'), 'auth-v2');
  assert.equal(prdNameToTag('my_doc.md'), 'my_doc'); // underscores kept
  assert.equal(prdNameToTag('a..b--c.md'), 'a-b-c'); // collapse repeats
});

test('prdNameToTag never returns the reserved master tag', () => {
  assert.equal(prdNameToTag('master.md'), 'master-prd');
  assert.equal(prdNameToTag('MASTER.txt'), 'master-prd');
});

test('prdNameToTag falls back for empty/punctuation-only names', () => {
  assert.equal(prdNameToTag(''), 'prd');
  assert.equal(prdNameToTag('...md'), 'prd');
  assert.equal(prdNameToTag('   .txt'), 'prd');
});
