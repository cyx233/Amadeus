import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

// WORKSPACES_ROOT is captured as a module-load-time const, so it must be set
// BEFORE importing the module under test. Root the temp dir under /var/tmp:
// os.tmpdir() is /tmp, which is itself a FORBIDDEN_WORKSPACE_PATH, and /var/tmp
// is the explicitly-exempted writable location.
await mkdir('/var/tmp', { recursive: true });
const WORKSPACES_ROOT = await mkdtemp('/var/tmp/vwp-root-');
process.env.WORKSPACES_ROOT = WORKSPACES_ROOT;

const { validateWorkspacePath } = await import('@/shared/utils.js');

test.after(async () => {
  await rm(WORKSPACES_ROOT, { recursive: true, force: true });
});

test('relative path (bare name) resolves under WORKSPACES_ROOT, not the server cwd', async () => {
  // Regression: the server runs from /opt, so path.resolve(cwd, name) used to
  // land in /opt and trip the system-dir guard. A bare name must go to the
  // workspace root.
  const result = await validateWorkspacePath('my-new-project');
  assert.equal(result.valid, true, result.error);
  assert.equal(result.resolvedPath, path.join(WORKSPACES_ROOT, 'my-new-project'));
});

test('nested relative path resolves under WORKSPACES_ROOT', async () => {
  const result = await validateWorkspacePath('group/sub-project');
  assert.equal(result.valid, true, result.error);
  assert.equal(result.resolvedPath, path.join(WORKSPACES_ROOT, 'group', 'sub-project'));
});

test('absolute path inside WORKSPACES_ROOT is accepted', async () => {
  const abs = path.join(WORKSPACES_ROOT, 'existing');
  await mkdir(abs, { recursive: true });
  const result = await validateWorkspacePath(abs);
  assert.equal(result.valid, true, result.error);
  assert.equal(result.resolvedPath, abs);
});

test('system directory /opt is rejected', async () => {
  const result = await validateWorkspacePath('/opt/foo');
  assert.equal(result.valid, false);
  assert.match(result.error ?? '', /system directory|system-critical/i);
});

test('absolute path outside WORKSPACES_ROOT is rejected', async () => {
  // A non-system dir that is simply not under the workspace root.
  const outside = await mkdtemp('/var/tmp/vwp-outside-');
  try {
    const result = await validateWorkspacePath(outside);
    assert.equal(result.valid, false);
    assert.match(result.error ?? '', /within the allowed workspace root/i);
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

test('empty path is rejected', async () => {
  const result = await validateWorkspacePath('');
  assert.equal(result.valid, false);
  assert.match(result.error ?? '', /required/i);
});
