import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseGitLogWithStats, parseGitStatusOutput, resolveRepoWithinProject, discoverGitRepos } from './git.js';

// Builds `git status --porcelain=v1 -z` output: NUL-separated entries with a
// trailing NUL, exactly as git emits it.
const porcelain = (...entries) => entries.join('\0') + '\0';

test('parseGitStatusOutput buckets files and reports index-side staging', () => {
  const output = porcelain(
    'M  staged-modified.ts',
    ' M unstaged-modified.ts',
    'MM staged-and-unstaged.ts',
    'A  staged-new.ts',
    'D  staged-deleted.ts',
    ' D unstaged-deleted.ts',
    '?? untracked.ts',
  );

  const result = parseGitStatusOutput(output);

  assert.deepEqual(result.modified, ['staged-modified.ts', 'unstaged-modified.ts', 'staged-and-unstaged.ts']);
  assert.deepEqual(result.added, ['staged-new.ts']);
  assert.deepEqual(result.deleted, ['staged-deleted.ts', 'unstaged-deleted.ts']);
  assert.deepEqual(result.untracked, ['untracked.ts']);
  // Only index-side (X) changes count as staged.
  assert.deepEqual(result.staged, [
    'staged-modified.ts',
    'staged-and-unstaged.ts',
    'staged-new.ts',
    'staged-deleted.ts',
  ]);
});

test('parseGitStatusOutput keeps paths with spaces intact (-z output has no quoting)', () => {
  const result = parseGitStatusOutput(porcelain('M  src/my folder/some file.ts'));
  assert.deepEqual(result.modified, ['src/my folder/some file.ts']);
  assert.deepEqual(result.staged, ['src/my folder/some file.ts']);
});

test('parseGitStatusOutput tracks the post-rename path and skips the original', () => {
  const output = porcelain('R  renamed-to.ts', 'renamed-from.ts', ' M other.ts');
  const result = parseGitStatusOutput(output);

  assert.deepEqual(result.modified, ['renamed-to.ts', 'other.ts']);
  assert.deepEqual(result.staged, ['renamed-to.ts']);
  // The pre-rename path is metadata, not a change entry.
  assert.equal(JSON.stringify(result).includes('renamed-from.ts'), false);
});

test('parseGitStatusOutput never reports merge conflicts as staged', () => {
  const output = porcelain('UU conflicted.ts', 'AA both-added.ts', 'DD both-deleted.ts');
  const result = parseGitStatusOutput(output);

  assert.deepEqual(result.modified, ['conflicted.ts', 'both-added.ts', 'both-deleted.ts']);
  assert.deepEqual(result.staged, []);
});

test('parseGitStatusOutput handles empty output', () => {
  assert.deepEqual(parseGitStatusOutput(''), {
    modified: [],
    added: [],
    deleted: [],
    untracked: [],
    staged: [],
  });
});

// Builds one `git log --pretty=format:%H%x1f%P%x1f%D%x1f%an%x1f%ae%x1f%ad%x1f%s` line.
const US = '';
const logLine = (hash, parents, refs, subject) =>
  [hash, parents, refs, 'Alice', 'a@x.com', '2026-07-06T10:00:00+03:00', subject].join(US);

test('parseGitLogWithStats parses commits with parents, refs, and shortstat lines', () => {
  const output = [
    logLine('c3', 'c2', 'HEAD -> main, origin/main, tag: v1.0', 'feat: add | pipes | to subject'),
    ' 3 files changed, 10 insertions(+), 2 deletions(-)',
    '',
    logLine('c2', 'c1 c0', '', 'Merge branch feature'),
    '',
    logLine('c0', '', '', 'initial commit'),
    ' 1 file changed, 1 insertion(+)',
  ].join('\n');

  const commits = parseGitLogWithStats(output);

  assert.equal(commits.length, 3);
  assert.deepEqual(commits[0].parents, ['c2']);
  assert.deepEqual(commits[0].refs, ['HEAD -> main', 'origin/main', 'tag: v1.0']);
  // Pipes in the subject survive because fields are joined with .
  assert.equal(commits[0].message, 'feat: add | pipes | to subject');
  assert.equal(commits[0].stats, '3 files changed, 10 insertions(+), 2 deletions(-)');

  // Merge commit: two parents, no shortstat line.
  assert.deepEqual(commits[1].parents, ['c1', 'c0']);
  assert.equal(commits[1].stats, '');

  // Root commit: no parents.
  assert.deepEqual(commits[2].parents, []);
  assert.equal(commits[2].stats, '1 file changed, 1 insertion(+)');
});

test('parseGitLogWithStats handles empty output', () => {
  assert.deepEqual(parseGitLogWithStats(''), []);
});

test('resolveRepoWithinProject returns project root when no repo override', () => {
  assert.equal(resolveRepoWithinProject('/home/u/proj', undefined), '/home/u/proj');
  assert.equal(resolveRepoWithinProject('/home/u/proj', null), '/home/u/proj');
});

test('resolveRepoWithinProject allows the root and nested subdirs', () => {
  assert.equal(resolveRepoWithinProject('/home/u/proj', '/home/u/proj'), '/home/u/proj');
  assert.equal(resolveRepoWithinProject('/home/u/proj', '/home/u/proj/src/pkg'), '/home/u/proj/src/pkg');
});

test('resolveRepoWithinProject rejects traversal / sibling escapes', () => {
  assert.throws(() => resolveRepoWithinProject('/home/u/proj', '/home/u/other'), /must be inside/);
  assert.throws(() => resolveRepoWithinProject('/home/u/proj', '/home/u/proj/../secret'), /must be inside/);
  // '/home/u/proj-evil' must not pass just because it shares the prefix
  assert.throws(() => resolveRepoWithinProject('/home/u/proj', '/home/u/proj-evil'), /must be inside/);
});

// Mirrors the real case: a Brazil-style workspace whose root is NOT a repo but
// whose src/ packages each are. Scanning stops at each repo root (nested repos
// inside a package are that package's business — submodules/vendored), skips
// node_modules, and never descends into an already-found repo.
test('discoverGitRepos finds package repos under a non-repo root', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'gitscan-'));
  try {
    await fs.mkdir(path.join(base, 'src', 'PkgA', '.git'), { recursive: true });
    await fs.mkdir(path.join(base, 'src', 'PkgB', '.git'), { recursive: true });
    // buried inside node_modules — must be ignored
    await fs.mkdir(path.join(base, 'node_modules', 'dep', '.git'), { recursive: true });
    // nested INSIDE PkgA — must NOT be surfaced (we stop at PkgA)
    await fs.mkdir(path.join(base, 'src', 'PkgA', 'vendor', '.git'), { recursive: true });

    const repos = await discoverGitRepos(base);
    const rel = repos.map((r) => path.relative(base, r)).sort();

    assert.deepEqual(rel, [path.join('src', 'PkgA'), path.join('src', 'PkgB')].sort());
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

// When the root itself is a repo, that's the single repo — don't scan inside it
// for more (matches VSCode's default, avoids surfacing submodules as siblings).
test('discoverGitRepos returns just the root when the root is a repo', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'gitscan-'));
  try {
    await fs.mkdir(path.join(base, '.git'), { recursive: true });
    await fs.mkdir(path.join(base, 'src', 'sub', '.git'), { recursive: true });

    const repos = await discoverGitRepos(base);
    assert.deepEqual(repos, [base]);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});
