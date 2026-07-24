import { promises as fs } from 'fs';
import path from 'path';

// cross-spawn: drop-in spawn with Windows .cmd/PATHEXT resolution.
import spawn from 'cross-spawn';
import express from 'express';

import { getAuthUser } from '../shared/authed.js';
import type {
  GitStatusResponse,
  GitBranchesResponse,
  GitCommitsResponse,
  GitReposResponse,
} from '../../shared/git-types.js';
import { projectsDb } from '../modules/database/index.js';
import { generateOnce } from '../modules/providers/services/text-generation.service.js';

const router = express.Router();
const COMMIT_DIFF_CHARACTER_LIMIT = 500_000;

type SpawnResult = { stdout: string; stderr: string };

/**
 * Error thrown by `spawnAsync` when a git command exits non-zero. Carries the
 * exit code and captured streams so callers can classify failures (many route
 * handlers branch on `stderr`/`message` to produce friendly errors).
 */
class GitCommandError extends Error {
  code: number | null;
  stdout: string;
  stderr: string;

  constructor(message: string, code: number | null, stdout: string, stderr: string) {
    super(message);
    this.name = 'GitCommandError';
    this.code = code;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

function spawnAsync(
  command: string,
  args: string[],
  options: { cwd?: string } = {},
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      shell: false,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new GitCommandError(`Command failed: ${command} ${args.join(' ')}`, code, stdout, stderr));
    });
  });
}

// Input validation helpers (defense-in-depth)
function validateCommitRef(commit: string): string {
  // Allow hex hashes, HEAD, HEAD~N, HEAD^N, tag names, branch names
  if (!/^[a-zA-Z0-9._~^{}@\/-]+$/.test(commit)) {
    throw new Error('Invalid commit reference');
  }
  return commit;
}

function validateBranchName(branch: string): string {
  if (!/^[a-zA-Z0-9._\/-]+$/.test(branch)) {
    throw new Error('Invalid branch name');
  }
  return branch;
}

function validateFilePath(file: string, projectPath?: string): string {
  if (!file || file.includes('\0')) {
    throw new Error('Invalid file path');
  }
  // Prevent path traversal: resolve the file relative to the project root
  // and ensure the result stays within the project directory
  if (projectPath) {
    const resolved = path.resolve(projectPath, file);
    const normalizedRoot = path.resolve(projectPath) + path.sep;
    if (!resolved.startsWith(normalizedRoot) && resolved !== path.resolve(projectPath)) {
      throw new Error('Invalid file path: path traversal detected');
    }
  }
  return file;
}

function validateRemoteName(remote: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(remote)) {
    throw new Error('Invalid remote name');
  }
  return remote;
}

function validateProjectPath(projectPath: string): string {
  if (!projectPath || projectPath.includes('\0')) {
    throw new Error('Invalid project path');
  }
  const resolved = path.resolve(projectPath);
  // Must be an absolute path after resolution
  if (!path.isAbsolute(resolved)) {
    throw new Error('Invalid project path: must be absolute');
  }
  // Block obviously dangerous paths
  if (resolved === '/' || resolved === path.sep) {
    throw new Error('Invalid project path: root directory not allowed');
  }
  return resolved;
}

/**
 * Resolve the absolute project directory for a given DB `projectId`.
 *
 * After the projectName → projectId migration, every git endpoint receives
 * the DB primary key (`project` query/body param). The legacy filesystem
 * resolver that walked Claude's JSONL history is no longer used here; the
 * path comes straight from the `projects` table and is then sanity-checked
 * by `validateProjectPath` before any `git` command runs against it.
 */
// Resolve the git cwd from a project root + optional client-picked repo. The
// repo must resolve to the project dir itself or a subdirectory — reject any
// path that escapes it (traversal guard). Pure so it can be unit-tested.
export function resolveRepoWithinProject(validatedProjectPath: string, repoOverride?: string | null): string {
  if (!repoOverride) {
    return validatedProjectPath;
  }
  const resolvedRepo = validateProjectPath(repoOverride);
  const projectRootWithSep = validatedProjectPath + path.sep;
  if (resolvedRepo !== validatedProjectPath && !resolvedRepo.startsWith(projectRootWithSep)) {
    throw new Error('Invalid repo path: must be inside the project directory');
  }
  return resolvedRepo;
}

async function getActualProjectPath(projectIdInput: unknown, repoOverrideInput?: unknown): Promise<string> {
  // Inputs arrive straight from req.query/req.body, so coerce to strings here.
  const projectId = queryString(projectIdInput);
  const repoOverride = queryString(repoOverrideInput) || undefined;
  const projectPath = await projectsDb.getProjectPathById(projectId);
  if (!projectPath) {
    throw new Error(`Unable to resolve project path for "${projectId}"`);
  }
  // A project can contain several git repos (e.g. a Brazil workspace with many
  // packages). The client picks one via ?repo=; use it as the git cwd.
  return resolveRepoWithinProject(validateProjectPath(projectPath), repoOverride);
}

// Directories that never contain repos we care about — skip while scanning.
const REPO_SCAN_IGNORED_DIRS = new Set([
  'node_modules', '.build', 'build', 'dist', 'target', '.git', 'env', 'venv', '.venv',
]);
const REPO_SCAN_MAX_DEPTH = 4;

/**
 * Find every git repository inside a project directory (VSCode-style). Walks
 * up to REPO_SCAN_MAX_DEPTH levels, treating any directory containing `.git`
 * as a repo root and not descending into it further. Returns absolute paths,
 * project root first when it is itself a repo.
 */
export async function discoverGitRepos(projectPath: string): Promise<string[]> {
  const repos: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    let hasGit = false;
    try {
      await fs.access(path.join(dir, '.git'));
      hasGit = true;
    } catch {
      // not a repo root
    }
    if (hasGit) {
      repos.push(dir);
      return; // don't descend into a repo (submodules aside — keep it simple)
    }
    if (depth >= REPO_SCAN_MAX_DEPTH) {
      return;
    }
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || REPO_SCAN_IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      await walk(path.join(dir, entry.name), depth + 1);
    }
  }

  await walk(validateProjectPath(projectPath), 0);
  return repos;
}

// Helper function to validate git repository
async function validateGitRepository(projectPath: string): Promise<void> {
  try {
    // Check if directory exists
    await fs.access(projectPath);
  } catch {
    throw new Error(`Project path not found: ${projectPath}`);
  }

  try {
    // Allow any directory that is inside a work tree (repo root or nested folder).
    const { stdout: insideWorkTreeOutput } = await spawnAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: projectPath });
    const isInsideWorkTree = insideWorkTreeOutput.trim() === 'true';
    if (!isInsideWorkTree) {
      throw new Error('Not inside a git work tree');
    }

    // Ensure git can resolve the repository root for this directory.
    await spawnAsync('git', ['rev-parse', '--show-toplevel'], { cwd: projectPath });
  } catch {
    throw new Error('Not a git repository. This directory does not contain a .git folder. Initialize a git repository with "git init" to use source control features.');
  }
}

function getGitErrorDetails(error: unknown): string {
  const e = error as { message?: string; stderr?: string; stdout?: string } | null;
  return `${e?.message || ''} ${e?.stderr || ''} ${e?.stdout || ''}`;
}

/** Narrow an unknown catch binding to its message string. */
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Coerce an Express query value (`string | string[] | ParsedQs | …`) to a
 * plain string. Repeated `?x=a&x=b` params collapse to the first; objects and
 * absent values become ''. Route handlers pass user input straight into the
 * validators/`git` cwd, which all expect a string.
 */
function queryString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return '';
}

function isMissingHeadRevisionError(error: unknown): boolean {
  const errorDetails = getGitErrorDetails(error).toLowerCase();
  return errorDetails.includes('unknown revision')
    || errorDetails.includes('ambiguous argument')
    || errorDetails.includes('needed a single revision')
    || errorDetails.includes('bad revision');
}

async function getCurrentBranchName(projectPath: string): Promise<string> {
  try {
    // symbolic-ref works even when the repository has no commits.
    const { stdout } = await spawnAsync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: projectPath });
    const branchName = stdout.trim();
    if (branchName) {
      return branchName;
    }
  } catch (error) {
    // Fall back to rev-parse for detached HEAD and older git edge cases.
  }

  const { stdout } = await spawnAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: projectPath });
  return stdout.trim();
}

async function repositoryHasCommits(projectPath: string): Promise<boolean> {
  try {
    await spawnAsync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: projectPath });
    return true;
  } catch (error) {
    if (isMissingHeadRevisionError(error)) {
      return false;
    }
    throw error;
  }
}

async function getRepositoryRootPath(projectPath: string): Promise<string> {
  const { stdout } = await spawnAsync('git', ['rev-parse', '--show-toplevel'], { cwd: projectPath });
  return stdout.trim();
}

function normalizeRepositoryRelativeFilePath(filePath: string): string {
  return String(filePath)
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .trim();
}

function parseStatusFilePaths(statusOutput: string): string[] {
  return statusOutput
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim())
    .map((line) => {
      const statusPath = line.substring(3);
      const renamedFilePath = statusPath.split(' -> ')[1];
      return normalizeRepositoryRelativeFilePath(renamedFilePath || statusPath);
    })
    .filter(Boolean);
}

function buildFilePathCandidates(projectPath: string, repositoryRootPath: string, filePath: string): string[] {
  const normalizedFilePath = normalizeRepositoryRelativeFilePath(filePath);
  const projectRelativePath = normalizeRepositoryRelativeFilePath(path.relative(repositoryRootPath, projectPath));
  const candidates = [normalizedFilePath];

  if (
    projectRelativePath
    && projectRelativePath !== '.'
    && !normalizedFilePath.startsWith(`${projectRelativePath}/`)
  ) {
    candidates.push(`${projectRelativePath}/${normalizedFilePath}`);
  }

  return Array.from(new Set(candidates.filter(Boolean)));
}

async function resolveRepositoryFilePath(
  projectPath: string,
  filePathInput: unknown,
): Promise<{ repositoryRootPath: string; repositoryRelativeFilePath: string }> {
  const filePath = queryString(filePathInput);
  validateFilePath(filePath);

  const repositoryRootPath = await getRepositoryRootPath(projectPath);
  const candidateFilePaths = buildFilePathCandidates(projectPath, repositoryRootPath, filePath);

  for (const candidateFilePath of candidateFilePaths) {
    const { stdout } = await spawnAsync('git', ['status', '--porcelain', '--', candidateFilePath], { cwd: repositoryRootPath });
    if (stdout.trim()) {
      return {
        repositoryRootPath,
        repositoryRelativeFilePath: candidateFilePath,
      };
    }
  }

  // If the caller sent a bare filename (e.g. "hello.ts"), recover it from changed files.
  const normalizedFilePath = normalizeRepositoryRelativeFilePath(filePath);
  if (!normalizedFilePath.includes('/')) {
    const { stdout: repositoryStatusOutput } = await spawnAsync('git', ['status', '--porcelain'], { cwd: repositoryRootPath });
    const changedFilePaths = parseStatusFilePaths(repositoryStatusOutput);
    const suffixMatches = changedFilePaths.filter(
      (changedFilePath) => changedFilePath === normalizedFilePath || changedFilePath.endsWith(`/${normalizedFilePath}`),
    );

    if (suffixMatches.length === 1) {
      return {
        repositoryRootPath,
        repositoryRelativeFilePath: suffixMatches[0],
      };
    }
  }

  return {
    repositoryRootPath,
    repositoryRelativeFilePath: candidateFilePaths[0],
  };
}

// Get git status for a project
/**
 * Parses `git status --porcelain=v1 -z` output into the response shape the
 * git panel consumes. NUL-separated entries carry no path quoting, so names
 * with spaces/unicode survive intact (the plain porcelain output quotes and
 * escapes them, which broke the old line-based parser).
 *
 * `staged` lists paths with index-side changes. The UI renders its "Staged"
 * section from this list so it always mirrors the real git index (including
 * files staged outside the app, e.g. via VSCode or the terminal).
 *
 * Exported for tests.
 */
export function parseGitStatusOutput(statusOutput: string) {
  const modified = [];
  const added = [];
  const deleted = [];
  const untracked = [];
  const staged = [];

  const statusEntries = statusOutput.split('\0');
  for (let entryIndex = 0; entryIndex < statusEntries.length; entryIndex++) {
    const entry = statusEntries[entryIndex];
    if (!entry || entry.length < 4) continue;

    // Porcelain v1: X = index (staged) status, Y = worktree (unstaged) status.
    const indexStatus = entry[0];
    const worktreeStatus = entry[1];
    const file = entry.slice(3);

    // Renames/copies carry the original path as the following NUL entry;
    // the UI tracks the post-rename path only.
    if (indexStatus === 'R' || indexStatus === 'C') {
      entryIndex += 1;
    }

    if (indexStatus === '?') {
      untracked.push(file);
      continue;
    }
    if (indexStatus === '!') {
      continue; // ignored files are never reported
    }

    const isConflict =
      indexStatus === 'U' || worktreeStatus === 'U' ||
      (indexStatus === 'A' && worktreeStatus === 'A') ||
      (indexStatus === 'D' && worktreeStatus === 'D');
    if (isConflict) {
      // Merge conflicts must be resolved in the worktree first; surface them
      // as modified and never as staged.
      modified.push(file);
      continue;
    }

    if (indexStatus !== ' ') {
      staged.push(file);
    }

    if (indexStatus === 'D' || worktreeStatus === 'D') {
      deleted.push(file);
    } else if (indexStatus === 'A' || worktreeStatus === 'A') {
      added.push(file);
    } else {
      modified.push(file);
    }
  }

  return { modified, added, deleted, untracked, staged };
}

// List every git repo inside a project (VSCode-style multi-root). The client
// uses this to populate the repo picker; each git call then passes ?repo=.
router.get('/repos', async (req, res) => {
  const { project } = req.query;

  if (!project) {
    return res.status(400).json({ error: 'Project id is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.query.repo || req.body?.repo);
    const repoPaths = await discoverGitRepos(projectPath);

    const repos = await Promise.all(repoPaths.map(async (repoPath) => {
      let branch: string | null = null;
      try {
        branch = await getCurrentBranchName(repoPath);
      } catch {
        // brand-new repo with no commits/branch yet
      }
      const relativePath = path.relative(projectPath, repoPath);
      return {
        path: repoPath,
        // '' for the project root itself; otherwise the subdir label
        name: relativePath || path.basename(repoPath),
        isRoot: repoPath === projectPath,
        branch,
      };
    }));

    const response: GitReposResponse = { repos };
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
  }
});

router.get('/status', async (req, res) => {
  const { project, repo } = req.query;

  if (!project) {
    return res.status(400).json({ error: 'Project id is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, repo);

    // Validate git repository
    await validateGitRepository(projectPath);

    const branch = await getCurrentBranchName(projectPath);
    const hasCommits = await repositoryHasCommits(projectPath);

    const { stdout: statusOutput } = await spawnAsync('git', ['status', '--porcelain=v1', '-z'], { cwd: projectPath });
    const { modified, added, deleted, untracked, staged } = parseGitStatusOutput(statusOutput);

    const response: GitStatusResponse = {
      branch,
      hasCommits,
      modified,
      added,
      deleted,
      untracked,
      staged
    };
    res.json(response);
  } catch (error) {
    console.error('Git status error:', error);
    res.json({
      error: errorMessage(error).includes('not a git repository') || errorMessage(error).includes('Project directory is not a git repository')
        ? errorMessage(error)
        : 'Git operation failed',
      details: errorMessage(error).includes('not a git repository') || errorMessage(error).includes('Project directory is not a git repository')
        ? errorMessage(error)
        : `Failed to get git status: ${errorMessage(error)}`
    });
  }
});

// Get diff for a specific file
router.get('/diff', async (req, res) => {
  const { project, file } = req.query;
  
  if (!project || !file) {
    return res.status(400).json({ error: 'Project id and file path are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.query.repo || req.body?.repo);
    
    // Validate git repository
    await validateGitRepository(projectPath);

    const {
      repositoryRootPath,
      repositoryRelativeFilePath,
    } = await resolveRepositoryFilePath(projectPath, file);

    // Check if file is untracked or deleted
    const { stdout: statusOutput } = await spawnAsync(
      'git',
      ['status', '--porcelain', '--', repositoryRelativeFilePath],
      { cwd: repositoryRootPath },
    );
    const isUntracked = statusOutput.startsWith('??');
    const isDeleted = statusOutput.trim().startsWith('D ') || statusOutput.trim().startsWith(' D');

    let diff;
    if (isUntracked) {
      // For untracked files, show the entire file content as additions
      const filePath = path.join(repositoryRootPath, repositoryRelativeFilePath);
      const stats = await fs.stat(filePath);

      if (stats.isDirectory()) {
        // For directories, show a simple message
        diff = `Directory: ${repositoryRelativeFilePath}\n(Cannot show diff for directories)`;
      } else {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        const lines = fileContent.split('\n');
        diff = `--- /dev/null\n+++ b/${repositoryRelativeFilePath}\n@@ -0,0 +1,${lines.length} @@\n` +
               lines.map(line => `+${line}`).join('\n');
      }
    } else if (isDeleted) {
      // For deleted files, show the entire file content from HEAD as deletions
      const { stdout: fileContent } = await spawnAsync(
        'git',
        ['show', `HEAD:${repositoryRelativeFilePath}`],
        { cwd: repositoryRootPath },
      );
      const lines = fileContent.split('\n');
      diff = `--- a/${repositoryRelativeFilePath}\n+++ /dev/null\n@@ -1,${lines.length} +0,0 @@\n` +
             lines.map(line => `-${line}`).join('\n');
    } else {
      // Get diff for tracked files
      // First check for unstaged changes (working tree vs index)
      const { stdout: unstagedDiff } = await spawnAsync(
        'git',
        ['diff', '--', repositoryRelativeFilePath],
        { cwd: repositoryRootPath },
      );

      if (unstagedDiff) {
        // Send the raw unified diff (full `diff --git`/`index`/`---`/`+++`/`@@`
        // headers). The client parses it with a real diff library, which needs
        // the file/hunk headers to align lines — stripping them made a tracked
        // file's diff parse as one giant add/delete block (all red/green).
        diff = unstagedDiff;
      } else {
        // If no unstaged changes, check for staged changes (index vs HEAD)
        const { stdout: stagedDiff } = await spawnAsync(
          'git',
          ['diff', '--cached', '--', repositoryRelativeFilePath],
          { cwd: repositoryRootPath },
        );
        diff = stagedDiff || '';
      }
    }

    res.json({ diff });
  } catch (error) {
    console.error('Git diff error:', error);
    res.json({ error: errorMessage(error) });
  }
});

// Get file content with diff information for CodeEditor
router.get('/file-with-diff', async (req, res) => {
  const { project, file } = req.query;

  if (!project || !file) {
    return res.status(400).json({ error: 'Project id and file path are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.query.repo || req.body?.repo);

    // Validate git repository
    await validateGitRepository(projectPath);

    const {
      repositoryRootPath,
      repositoryRelativeFilePath,
    } = await resolveRepositoryFilePath(projectPath, file);

    // Check file status
    const { stdout: statusOutput } = await spawnAsync(
      'git',
      ['status', '--porcelain', '--', repositoryRelativeFilePath],
      { cwd: repositoryRootPath },
    );
    const isUntracked = statusOutput.startsWith('??');
    const isDeleted = statusOutput.trim().startsWith('D ') || statusOutput.trim().startsWith(' D');

    let currentContent = '';
    let oldContent = '';

    if (isDeleted) {
      // For deleted files, get content from HEAD
      const { stdout: headContent } = await spawnAsync(
        'git',
        ['show', `HEAD:${repositoryRelativeFilePath}`],
        { cwd: repositoryRootPath },
      );
      oldContent = headContent;
      currentContent = headContent; // Show the deleted content in editor
    } else {
      // Get current file content
      const filePath = path.join(repositoryRootPath, repositoryRelativeFilePath);
      const stats = await fs.stat(filePath);

      if (stats.isDirectory()) {
        // Cannot show content for directories
        return res.status(400).json({ error: 'Cannot show diff for directories' });
      }

      currentContent = await fs.readFile(filePath, 'utf-8');

      if (!isUntracked) {
        // Get the old content from HEAD for tracked files
        try {
          const { stdout: headContent } = await spawnAsync(
            'git',
            ['show', `HEAD:${repositoryRelativeFilePath}`],
            { cwd: repositoryRootPath },
          );
          oldContent = headContent;
        } catch (error) {
          // File might be newly added to git (staged but not committed)
          oldContent = '';
        }
      }
    }

    res.json({
      currentContent,
      oldContent,
      isDeleted,
      isUntracked
    });
  } catch (error) {
    console.error('Git file-with-diff error:', error);
    res.json({ error: errorMessage(error) });
  }
});

// Create initial commit
router.post('/initial-commit', async (req, res) => {
  const { project } = req.body;

  if (!project) {
    return res.status(400).json({ error: 'Project id is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.query.repo || req.body?.repo);

    // Validate git repository
    await validateGitRepository(projectPath);

    // Check if there are already commits
    try {
      await spawnAsync('git', ['rev-parse', 'HEAD'], { cwd: projectPath });
      return res.status(400).json({ error: 'Repository already has commits. Use regular commit instead.' });
    } catch (error) {
      // No HEAD - this is good, we can create initial commit
    }

    // Add all files
    await spawnAsync('git', ['add', '.'], { cwd: projectPath });

    // Create initial commit
    const { stdout } = await spawnAsync('git', ['commit', '-m', 'Initial commit'], { cwd: projectPath });

    res.json({ success: true, output: stdout, message: 'Initial commit created successfully' });
  } catch (error) {
    console.error('Git initial commit error:', error);

    // Handle the case where there's nothing to commit
    if (errorMessage(error).includes('nothing to commit')) {
      return res.status(400).json({
        error: 'Nothing to commit',
        details: 'No files found in the repository. Add some files first.'
      });
    }

    res.status(500).json({ error: errorMessage(error) });
  }
});

// Commit changes
router.post('/commit', async (req, res) => {
  const { project, message, files } = req.body;
  
  if (!project || !message || !files || files.length === 0) {
    return res.status(400).json({ error: 'Project name, commit message, and files are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.query.repo || req.body?.repo);
    
    // Validate git repository
    await validateGitRepository(projectPath);
    const repositoryRootPath = await getRepositoryRootPath(projectPath);
    
    // Stage selected files
    for (const file of files) {
      const { repositoryRelativeFilePath } = await resolveRepositoryFilePath(projectPath, file);
      await spawnAsync('git', ['add', '--', repositoryRelativeFilePath], { cwd: repositoryRootPath });
    }

    // Commit with message
    const { stdout } = await spawnAsync('git', ['commit', '-m', message], { cwd: repositoryRootPath });
    
    res.json({ success: true, output: stdout });
  } catch (error) {
    console.error('Git commit error:', error);
    res.status(500).json({ error: errorMessage(error) });
  }
});

// Stage files (git add). Mirrors what the UI shows as the "Staged" section,
// so the app's staging state and the real git index never drift apart.
router.post('/stage', async (req, res) => {
  const { project, files } = req.body;

  if (!project || !Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'Project id and files are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.query.repo || req.body?.repo);
    await validateGitRepository(projectPath);
    const repositoryRootPath = await getRepositoryRootPath(projectPath);

    for (const file of files) {
      const { repositoryRelativeFilePath } = await resolveRepositoryFilePath(projectPath, file);
      await spawnAsync('git', ['add', '--', repositoryRelativeFilePath], { cwd: repositoryRootPath });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Git stage error:', error);
    res.status(500).json({ error: errorMessage(error) });
  }
});

// Unstage files (remove from the index, keep the worktree changes)
router.post('/unstage', async (req, res) => {
  const { project, files } = req.body;

  if (!project || !Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'Project id and files are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.query.repo || req.body?.repo);
    await validateGitRepository(projectPath);
    const repositoryRootPath = await getRepositoryRootPath(projectPath);
    const hasCommits = await repositoryHasCommits(projectPath);

    for (const file of files) {
      const { repositoryRelativeFilePath } = await resolveRepositoryFilePath(projectPath, file);
      if (hasCommits) {
        await spawnAsync('git', ['reset', 'HEAD', '--', repositoryRelativeFilePath], { cwd: repositoryRootPath });
      } else {
        // No HEAD to reset against before the first commit; dropping the
        // index entry is the only way to unstage while keeping the file.
        await spawnAsync('git', ['rm', '--cached', '-r', '--force', '--', repositoryRelativeFilePath], { cwd: repositoryRootPath });
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Git unstage error:', error);
    res.status(500).json({ error: errorMessage(error) });
  }
});

// Revert latest local commit (keeps changes staged)
router.post('/revert-local-commit', async (req, res) => {
  const { project } = req.body;

  if (!project) {
    return res.status(400).json({ error: 'Project id is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.query.repo || req.body?.repo);
    await validateGitRepository(projectPath);

    try {
      await spawnAsync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: projectPath });
    } catch (error) {
      return res.status(400).json({
        error: 'No local commit to revert',
        details: 'This repository has no commit yet.',
      });
    }

    try {
      // Soft reset rewinds one commit while preserving all file changes in the index.
      await spawnAsync('git', ['reset', '--soft', 'HEAD~1'], { cwd: projectPath });
    } catch (error) {
      const errorDetails = getGitErrorDetails(error);
      const isInitialCommit = errorDetails.includes('HEAD~1') &&
        (errorDetails.includes('unknown revision') || errorDetails.includes('ambiguous argument'));

      if (!isInitialCommit) {
        throw error;
      }

      // Initial commit has no parent; deleting HEAD uncommits it and keeps files staged.
      await spawnAsync('git', ['update-ref', '-d', 'HEAD'], { cwd: projectPath });
    }

    res.json({
      success: true,
      output: 'Latest local commit reverted successfully. Changes were kept staged.',
    });
  } catch (error) {
    console.error('Git revert local commit error:', error);
    res.status(500).json({ error: errorMessage(error) });
  }
});

// Get list of branches
router.get('/branches', async (req, res) => {
  const { project } = req.query;
  
  if (!project) {
    return res.status(400).json({ error: 'Project id is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.query.repo || req.body?.repo);
    
    // Validate git repository
    await validateGitRepository(projectPath);
    
    // Get all branches
    const { stdout } = await spawnAsync('git', ['branch', '-a'], { cwd: projectPath });

    const rawLines = stdout
      .split('\n')
      .map(b => b.trim())
      .filter(b => b && !b.includes('->'));

    // Local branches (may start with '* ' for current)
    const localBranches = rawLines
      .filter(b => !b.startsWith('remotes/'))
      .map(b => (b.startsWith('* ') ? b.substring(2) : b));

    // Remote branches — strip 'remotes/<remote>/' prefix
    const remoteBranches = rawLines
      .filter(b => b.startsWith('remotes/'))
      .map(b => b.replace(/^remotes\/[^/]+\//, ''))
      .filter(name => !localBranches.includes(name)); // skip if already a local branch

    // Backward-compat flat list (local + unique remotes, deduplicated)
    const branches = [...localBranches, ...remoteBranches]
      .filter((b, i, arr) => arr.indexOf(b) === i);

    const response: GitBranchesResponse = { branches, localBranches, remoteBranches };
    res.json(response);
  } catch (error) {
    console.error('Git branches error:', error);
    res.json({ error: errorMessage(error) });
  }
});

// Checkout branch
router.post('/checkout', async (req, res) => {
  const { project, branch } = req.body;
  
  if (!project || !branch) {
    return res.status(400).json({ error: 'Project id and branch are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.query.repo || req.body?.repo);
    
    // Checkout the branch
    validateBranchName(branch);
    const { stdout } = await spawnAsync('git', ['checkout', branch], { cwd: projectPath });
    
    res.json({ success: true, output: stdout });
  } catch (error) {
    console.error('Git checkout error:', error);
    res.status(500).json({ error: errorMessage(error) });
  }
});

// Create new branch
router.post('/create-branch', async (req, res) => {
  const { project, branch } = req.body;
  
  if (!project || !branch) {
    return res.status(400).json({ error: 'Project id and branch name are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.query.repo || req.body?.repo);
    
    // Create and checkout new branch
    validateBranchName(branch);
    const { stdout } = await spawnAsync('git', ['checkout', '-b', branch], { cwd: projectPath });
    
    res.json({ success: true, output: stdout });
  } catch (error) {
    console.error('Git create branch error:', error);
    res.status(500).json({ error: errorMessage(error) });
  }
});

// Delete a local branch
router.post('/delete-branch', async (req, res) => {
  const { project, branch } = req.body;

  if (!project || !branch) {
    return res.status(400).json({ error: 'Project id and branch name are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.query.repo || req.body?.repo);
    await validateGitRepository(projectPath);

    // Safety: cannot delete the currently checked-out branch
    const { stdout: currentBranch } = await spawnAsync('git', ['branch', '--show-current'], { cwd: projectPath });
    if (currentBranch.trim() === branch) {
      return res.status(400).json({ error: 'Cannot delete the currently checked-out branch' });
    }

    const { stdout } = await spawnAsync('git', ['branch', '-d', branch], { cwd: projectPath });
    res.json({ success: true, output: stdout });
  } catch (error) {
    console.error('Git delete branch error:', error);
    res.status(500).json({ error: errorMessage(error) });
  }
});

// Fields are joined with the ASCII unit separator so pipes (or anything else
// typed into a commit subject) cannot break parsing.
const GIT_LOG_FIELD_SEPARATOR = '\u001f';
const GIT_LOG_PRETTY_FORMAT = '%H%x1f%P%x1f%D%x1f%an%x1f%ae%x1f%ad%x1f%s';

/**
 * Parses `git log --shortstat` output produced with GIT_LOG_PRETTY_FORMAT.
 *
 * Each commit is one format line (hash, parent hashes, ref decorations,
 * author, email, date, subject) optionally followed by its `--shortstat`
 * summary line ("N files changed, ..."). Parents and refs feed the commit
 * graph rendered by the History view; merge commits carry no shortstat line,
 * so their `stats` stays empty.
 *
 * Exported for tests.
 */
export function parseGitLogWithStats(stdout: string) {
  const commits = [];

  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;

    if (line.includes(GIT_LOG_FIELD_SEPARATOR)) {
      const [hash, parents, refs, author, email, date, ...messageParts] = line.split(GIT_LOG_FIELD_SEPARATOR);
      commits.push({
        hash,
        parents: parents ? parents.split(' ').filter(Boolean) : [],
        // `%D` decorations, e.g. "HEAD -> main", "origin/main", "tag: v1.0".
        refs: refs ? refs.split(', ').filter(Boolean) : [],
        author,
        email,
        date,
        message: messageParts.join(GIT_LOG_FIELD_SEPARATOR),
        stats: ''
      });
      continue;
    }

    if (commits.length > 0 && /files? changed/.test(line)) {
      commits[commits.length - 1].stats = line.trim();
    }
  }

  return commits;
}

// Get recent commits (across all branches, in graph order)
router.get('/commits', async (req, res) => {
  const { project, limit = 10 } = req.query;

  if (!project) {
    return res.status(400).json({ error: 'Project id is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.query.repo || req.body?.repo);
    await validateGitRepository(projectPath);
    const parsedLimit = Number.parseInt(String(limit), 10);
    const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 100)
      : 10;

    // Branches/remotes/tags (not --all, which would drag in refs/stash) with
    // `--topo-order` guarantee children appear before their parents across
    // every branch, which the frontend lane-assignment relies on.
    // `--shortstat` replaces the previous per-commit `git show --stat` calls.
    const { stdout } = await spawnAsync(
      'git',
      [
        'log',
        '--branches',
        '--remotes',
        '--tags',
        '--topo-order',
        '--shortstat',
        `--pretty=format:${GIT_LOG_PRETTY_FORMAT}`,
        '--date=iso-strict',
        '-n', String(safeLimit)
      ],
      { cwd: projectPath },
    );

    const response: GitCommitsResponse = { commits: parseGitLogWithStats(stdout) };
    res.json(response);
  } catch (error) {
    console.error('Git commits error:', error);
    res.json({ error: errorMessage(error) });
  }
});

// Get diff for a specific commit
router.get('/commit-diff', async (req, res) => {
  const { project, commit } = req.query;
  
  if (!project || !commit) {
    return res.status(400).json({ error: 'Project id and commit hash are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.query.repo || req.body?.repo);

    // Validate commit reference (defense-in-depth)
    const commitRef = validateCommitRef(queryString(commit));

    // Get diff for the commit
    const { stdout } = await spawnAsync(
      'git', ['show', commitRef],
      { cwd: projectPath }
    );

    const isTruncated = stdout.length > COMMIT_DIFF_CHARACTER_LIMIT;
    const diff = isTruncated
      ? `${stdout.slice(0, COMMIT_DIFF_CHARACTER_LIMIT)}\n\n... Diff truncated to keep the UI responsive ...`
      : stdout;

    res.json({ diff, isTruncated });
  } catch (error) {
    console.error('Git commit diff error:', error);
    res.json({ error: errorMessage(error) });
  }
});

// Generate commit message based on staged changes using AI
router.post('/generate-commit-message', async (req, res) => {
  const { project, files } = req.body;

  if (!project || !files || files.length === 0) {
    return res.status(400).json({ error: 'Project id and files are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.query.repo || req.body?.repo);
    await validateGitRepository(projectPath);
    const repositoryRootPath = await getRepositoryRootPath(projectPath);

    // Get diff for selected files
    let diffContext = '';
    for (const file of files) {
      try {
        const { repositoryRelativeFilePath } = await resolveRepositoryFilePath(projectPath, file);
        const { stdout } = await spawnAsync(
          'git', ['diff', 'HEAD', '--', repositoryRelativeFilePath],
          { cwd: repositoryRootPath }
        );
        if (stdout) {
          diffContext += `\n--- ${repositoryRelativeFilePath} ---\n${stdout}`;
        }
      } catch (error) {
        console.error(`Error getting diff for ${file}:`, error);
      }
    }

    // If no diff found, might be untracked files
    if (!diffContext.trim()) {
      // Try to get content of untracked files
      for (const file of files) {
        try {
          const { repositoryRelativeFilePath } = await resolveRepositoryFilePath(projectPath, file);
          const filePath = path.join(repositoryRootPath, repositoryRelativeFilePath);
          const stats = await fs.stat(filePath);

          if (!stats.isDirectory()) {
            const content = await fs.readFile(filePath, 'utf-8');
            diffContext += `\n--- ${repositoryRelativeFilePath} (new file) ---\n${content.substring(0, 1000)}\n`;
          } else {
            diffContext += `\n--- ${repositoryRelativeFilePath} (new directory) ---\n`;
          }
        } catch (error) {
          console.error(`Error reading file ${file}:`, error);
        }
      }
    }

    // Generate commit message using the resolved provider + model. Run it from
    // the PROJECT ROOT, not the picked repo subdir: the agent keys its session
    // (and sidebar project) off cwd, so a subdir cwd would spawn a phantom
    // project like "-...-EventOperator-src-EKSEventController". The diff is
    // already in the prompt, so the agent doesn't need to sit in the repo.
    const projectRootPath = await projectsDb.getProjectPathById(project);
    const message = await generateCommitMessageWithAI(getAuthUser(req).id, files, diffContext, projectRootPath || projectPath);

    res.json({ message });
  } catch (error) {
    console.error('Generate commit message error:', error);
    res.status(500).json({ error: errorMessage(error) });
  }
});

/**
 * Generates a commit message via the provider-agnostic one-shot layer.
 * @param {number} userId
 * @param {Array<string>} files - List of changed files
 * @param {string} diffContext - Git diff content
 * @param {string} projectPath - Project ROOT dir, used as the agent cwd (not the
 *   git repo subdir) so the one-shot session lands under the existing project
 *   instead of creating a phantom project keyed to a nested repo path.
 * @returns {Promise<string>} Generated commit message
 */
async function generateCommitMessageWithAI(
  userId: number,
  files: string[],
  diffContext: string,
  projectPath: string,
): Promise<string> {
  const prompt = `Generate a conventional commit message for these changes.

REQUIREMENTS:
- Format: type(scope): subject
- Include body explaining what changed and why
- Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore
- Subject under 50 chars, body wrapped at 72 chars
- Focus on user-facing changes, not implementation details
- Consider what's being added AND removed
- Return ONLY the commit message (no markdown, explanations, or code blocks)

FILES CHANGED:
${files.map((f: string) => `- ${f}`).join('\n')}

DIFFS:
${diffContext.substring(0, 4000)}

Generate the commit message:`;

  try {
    // The provider layer owns model resolution, dispatch, text collection, and
    // the timeout — this route stays model-id/provider agnostic.
    const { text } = await generateOnce({ userId, feature: 'commit-message', prompt, cwd: projectPath });
    return cleanCommitMessage(text) || 'chore: update files';
  } catch (error) {
    console.error('Error generating commit message with AI:', error);
    // Fallback to a simple message (also covers the timeout/abort path).
    return `chore: update ${files.length} file${files.length !== 1 ? 's' : ''}`;
  }
}

/**
 * Cleans the AI-generated commit message by removing markdown, code blocks, and extra formatting
 * @param {string} text - Raw AI response
 * @returns {string} Clean commit message
 */
function cleanCommitMessage(text: string): string {
  if (!text || !text.trim()) {
    return '';
  }

  let cleaned = text.trim();

  // Remove markdown code blocks
  cleaned = cleaned.replace(/```[a-z]*\n/g, '');
  cleaned = cleaned.replace(/```/g, '');

  // Remove markdown headers
  cleaned = cleaned.replace(/^#+\s*/gm, '');

  // Remove leading/trailing quotes
  cleaned = cleaned.replace(/^["']|["']$/g, '');

  // If there are multiple lines, take everything (subject + body)
  // Just clean up extra blank lines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  // Remove any explanatory text before the actual commit message
  // Look for conventional commit pattern and start from there
  const conventionalCommitMatch = cleaned.match(/(feat|fix|docs|style|refactor|perf|test|build|ci|chore)(\(.+?\))?:.+/s);
  if (conventionalCommitMatch) {
    cleaned = cleaned.substring(cleaned.indexOf(conventionalCommitMatch[0]));
  }

  return cleaned.trim();
}

// Get remote status (ahead/behind commits with smart remote detection)
router.get('/remote-status', async (req, res) => {
  const { project } = req.query;
  
  if (!project) {
    return res.status(400).json({ error: 'Project id is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.query.repo || req.body?.repo);
    await validateGitRepository(projectPath);

    const branch = await getCurrentBranchName(projectPath);
    const hasCommits = await repositoryHasCommits(projectPath);

    const { stdout: remoteOutput } = await spawnAsync('git', ['remote'], { cwd: projectPath });
    const remotes = remoteOutput.trim().split('\n').filter(r => r.trim());
    const hasRemote = remotes.length > 0;
    const fallbackRemoteName = hasRemote
      ? (remotes.includes('origin') ? 'origin' : remotes[0])
      : null;

    // Repositories initialized with `git init` can have a branch but no commits.
    // Return a non-error state so the UI can show the initial-commit workflow.
    if (!hasCommits) {
      return res.json({
        hasRemote,
        hasUpstream: false,
        branch,
        remoteName: fallbackRemoteName,
        ahead: 0,
        behind: 0,
        isUpToDate: false,
        message: 'Repository has no commits yet'
      });
    }

    // Check if there's a remote tracking branch (smart detection)
    let trackingBranch;
    let remoteName;
    try {
      const { stdout } = await spawnAsync('git', ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`], { cwd: projectPath });
      trackingBranch = stdout.trim();
      remoteName = trackingBranch.split('/')[0]; // Extract remote name (e.g., "origin/main" -> "origin")
    } catch (error) {
      return res.json({
        hasRemote,
        hasUpstream: false,
        branch,
        remoteName: fallbackRemoteName,
        message: 'No remote tracking branch configured'
      });
    }

    // Get ahead/behind counts
    const { stdout: countOutput } = await spawnAsync(
      'git', ['rev-list', '--count', '--left-right', `${trackingBranch}...HEAD`],
      { cwd: projectPath }
    );
    
    const [behind, ahead] = countOutput.trim().split('\t').map(Number);

    res.json({
      hasRemote: true,
      hasUpstream: true,
      branch,
      remoteBranch: trackingBranch,
      remoteName,
      ahead: ahead || 0,
      behind: behind || 0,
      isUpToDate: ahead === 0 && behind === 0
    });
  } catch (error) {
    console.error('Git remote status error:', error);
    res.json({ error: errorMessage(error) });
  }
});

// Fetch from remote (using smart remote detection)
router.post('/fetch', async (req, res) => {
  const { project } = req.body;
  
  if (!project) {
    return res.status(400).json({ error: 'Project id is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.query.repo || req.body?.repo);
    await validateGitRepository(projectPath);

    // Get current branch and its upstream remote
    const branch = await getCurrentBranchName(projectPath);

    let remoteName = 'origin'; // fallback
    try {
      const { stdout } = await spawnAsync('git', ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`], { cwd: projectPath });
      remoteName = stdout.trim().split('/')[0]; // Extract remote name
    } catch (error) {
      // No upstream, try to fetch from origin anyway
      console.log('No upstream configured, using origin as fallback');
    }

    validateRemoteName(remoteName);
    const { stdout } = await spawnAsync('git', ['fetch', remoteName], { cwd: projectPath });

    res.json({ success: true, output: stdout || 'Fetch completed successfully', remoteName });
  } catch (error) {
    console.error('Git fetch error:', error);
    res.status(500).json({ 
      error: 'Fetch failed', 
      details: errorMessage(error).includes('Could not resolve hostname') 
        ? 'Unable to connect to remote repository. Check your internet connection.'
        : errorMessage(error).includes('fatal: \'origin\' does not appear to be a git repository')
        ? 'No remote repository configured. Add a remote with: git remote add origin <url>'
        : errorMessage(error)
    });
  }
});

// Pull from remote (fetch + merge using smart remote detection)
router.post('/pull', async (req, res) => {
  const { project } = req.body;
  
  if (!project) {
    return res.status(400).json({ error: 'Project id is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.query.repo || req.body?.repo);
    await validateGitRepository(projectPath);

    // Get current branch and its upstream remote
    const branch = await getCurrentBranchName(projectPath);

    let remoteName = 'origin'; // fallback
    let remoteBranch = branch; // fallback
    try {
      const { stdout } = await spawnAsync('git', ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`], { cwd: projectPath });
      const tracking = stdout.trim();
      remoteName = tracking.split('/')[0]; // Extract remote name
      remoteBranch = tracking.split('/').slice(1).join('/'); // Extract branch name
    } catch (error) {
      // No upstream, use fallback
      console.log('No upstream configured, using origin/branch as fallback');
    }

    validateRemoteName(remoteName);
    validateBranchName(remoteBranch);
    const { stdout } = await spawnAsync('git', ['pull', remoteName, remoteBranch], { cwd: projectPath });

    res.json({
      success: true,
      output: stdout || 'Pull completed successfully',
      remoteName,
      remoteBranch
    });
  } catch (error) {
    console.error('Git pull error:', error);

    // Enhanced error handling for common pull scenarios
    const message = errorMessage(error);
    let errorTitle = 'Pull failed';
    let details = message;

    if (message.includes('CONFLICT')) {
      errorTitle = 'Merge conflicts detected';
      details = 'Pull created merge conflicts. Please resolve conflicts manually in the editor, then commit the changes.';
    } else if (message.includes('Please commit your changes or stash them')) {
      errorTitle = 'Uncommitted changes detected';
      details = 'Please commit or stash your local changes before pulling.';
    } else if (message.includes('Could not resolve hostname')) {
      errorTitle = 'Network error';
      details = 'Unable to connect to remote repository. Check your internet connection.';
    } else if (message.includes('fatal: \'origin\' does not appear to be a git repository')) {
      errorTitle = 'Remote not configured';
      details = 'No remote repository configured. Add a remote with: git remote add origin <url>';
    } else if (message.includes('diverged')) {
      errorTitle = 'Branches have diverged';
      details = 'Your local branch and remote branch have diverged. Consider fetching first to review changes.';
    }

    res.status(500).json({
      error: errorTitle,
      details: details
    });
  }
});

// Push commits to remote repository
router.post('/push', async (req, res) => {
  const { project } = req.body;
  
  if (!project) {
    return res.status(400).json({ error: 'Project id is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.query.repo || req.body?.repo);
    await validateGitRepository(projectPath);

    // Get current branch and its upstream remote
    const branch = await getCurrentBranchName(projectPath);

    let remoteName = 'origin'; // fallback
    let remoteBranch = branch; // fallback
    try {
      const { stdout } = await spawnAsync('git', ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`], { cwd: projectPath });
      const tracking = stdout.trim();
      remoteName = tracking.split('/')[0]; // Extract remote name
      remoteBranch = tracking.split('/').slice(1).join('/'); // Extract branch name
    } catch (error) {
      // No upstream, use fallback
      console.log('No upstream configured, using origin/branch as fallback');
    }

    validateRemoteName(remoteName);
    validateBranchName(remoteBranch);
    const { stdout } = await spawnAsync('git', ['push', remoteName, remoteBranch], { cwd: projectPath });

    res.json({
      success: true,
      output: stdout || 'Push completed successfully',
      remoteName,
      remoteBranch
    });
  } catch (error) {
    console.error('Git push error:', error);
    
    // Enhanced error handling for common push scenarios
    const message = errorMessage(error);
    let errorTitle = 'Push failed';
    let details = message;

    if (message.includes('rejected')) {
      errorTitle = 'Push rejected';
      details = 'The remote has newer commits. Pull first to merge changes before pushing.';
    } else if (message.includes('non-fast-forward')) {
      errorTitle = 'Non-fast-forward push';
      details = 'Your branch is behind the remote. Pull the latest changes first.';
    } else if (message.includes('Could not resolve hostname')) {
      errorTitle = 'Network error';
      details = 'Unable to connect to remote repository. Check your internet connection.';
    } else if (message.includes('fatal: \'origin\' does not appear to be a git repository')) {
      errorTitle = 'Remote not configured';
      details = 'No remote repository configured. Add a remote with: git remote add origin <url>';
    } else if (message.includes('Permission denied')) {
      errorTitle = 'Authentication failed';
      details = 'Permission denied. Check your credentials or SSH keys.';
    } else if (message.includes('no upstream branch')) {
      errorTitle = 'No upstream branch';
      details = 'No upstream branch configured. Use: git push --set-upstream origin <branch>';
    }

    res.status(500).json({
      error: errorTitle,
      details: details
    });
  }
});

// Publish branch to remote (set upstream and push)
router.post('/publish', async (req, res) => {
  const { project, branch } = req.body;
  
  if (!project || !branch) {
    return res.status(400).json({ error: 'Project id and branch are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.query.repo || req.body?.repo);
    await validateGitRepository(projectPath);

    // Validate branch name
    validateBranchName(branch);

    // Get current branch to verify it matches the requested branch
    const currentBranchName = await getCurrentBranchName(projectPath);

    if (currentBranchName !== branch) {
      return res.status(400).json({
        error: `Branch mismatch. Current branch is ${currentBranchName}, but trying to publish ${branch}`
      });
    }

    // Check if remote exists
    let remoteName = 'origin';
    try {
      const { stdout } = await spawnAsync('git', ['remote'], { cwd: projectPath });
      const remotes = stdout.trim().split('\n').filter(r => r.trim());
      if (remotes.length === 0) {
        return res.status(400).json({
          error: 'No remote repository configured. Add a remote with: git remote add origin <url>'
        });
      }
      remoteName = remotes.includes('origin') ? 'origin' : remotes[0];
    } catch (error) {
      return res.status(400).json({
        error: 'No remote repository configured. Add a remote with: git remote add origin <url>'
      });
    }

    // Publish the branch (set upstream and push)
    validateRemoteName(remoteName);
    const { stdout } = await spawnAsync('git', ['push', '--set-upstream', remoteName, branch], { cwd: projectPath });
    
    res.json({ 
      success: true, 
      output: stdout || 'Branch published successfully', 
      remoteName,
      branch
    });
  } catch (error) {
    console.error('Git publish error:', error);
    
    // Enhanced error handling for common publish scenarios
    const message = errorMessage(error);
    let errorTitle = 'Publish failed';
    let details = message;

    if (message.includes('rejected')) {
      errorTitle = 'Publish rejected';
      details = 'The remote branch already exists and has different commits. Use push instead.';
    } else if (message.includes('Could not resolve hostname')) {
      errorTitle = 'Network error';
      details = 'Unable to connect to remote repository. Check your internet connection.';
    } else if (message.includes('Permission denied')) {
      errorTitle = 'Authentication failed';
      details = 'Permission denied. Check your credentials or SSH keys.';
    } else if (message.includes('fatal:') && message.includes('does not appear to be a git repository')) {
      errorTitle = 'Remote not configured';
      details = 'Remote repository not properly configured. Check your remote URL.';
    }

    res.status(500).json({
      error: errorTitle,
      details: details
    });
  }
});

// Discard changes for a specific file
router.post('/discard', async (req, res) => {
  const { project, file } = req.body;
  
  if (!project || !file) {
    return res.status(400).json({ error: 'Project id and file path are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.query.repo || req.body?.repo);
    await validateGitRepository(projectPath);
    const {
      repositoryRootPath,
      repositoryRelativeFilePath,
    } = await resolveRepositoryFilePath(projectPath, file);

    // Check file status to determine correct discard command
    const { stdout: statusOutput } = await spawnAsync(
      'git',
      ['status', '--porcelain', '--', repositoryRelativeFilePath],
      { cwd: repositoryRootPath },
    );

    if (!statusOutput.trim()) {
      return res.status(400).json({ error: 'No changes to discard for this file' });
    }

    const status = statusOutput.substring(0, 2);

    if (status === '??') {
      // Untracked file or directory - delete it
      const filePath = path.join(repositoryRootPath, repositoryRelativeFilePath);
      const stats = await fs.stat(filePath);

      if (stats.isDirectory()) {
        await fs.rm(filePath, { recursive: true, force: true });
      } else {
        await fs.unlink(filePath);
      }
    } else if (status.includes('M') || status.includes('D')) {
      // Modified or deleted file - restore from HEAD
      await spawnAsync('git', ['restore', '--', repositoryRelativeFilePath], { cwd: repositoryRootPath });
    } else if (status.includes('A')) {
      // Added file - unstage it
      await spawnAsync('git', ['reset', 'HEAD', '--', repositoryRelativeFilePath], { cwd: repositoryRootPath });
    }
    
    res.json({ success: true, message: `Changes discarded for ${repositoryRelativeFilePath}` });
  } catch (error) {
    console.error('Git discard error:', error);
    res.status(500).json({ error: errorMessage(error) });
  }
});

// Delete untracked file
router.post('/delete-untracked', async (req, res) => {
  const { project, file } = req.body;
  
  if (!project || !file) {
    return res.status(400).json({ error: 'Project id and file path are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.query.repo || req.body?.repo);
    await validateGitRepository(projectPath);
    const {
      repositoryRootPath,
      repositoryRelativeFilePath,
    } = await resolveRepositoryFilePath(projectPath, file);

    // Check if file is actually untracked
    const { stdout: statusOutput } = await spawnAsync(
      'git',
      ['status', '--porcelain', '--', repositoryRelativeFilePath],
      { cwd: repositoryRootPath },
    );
    
    if (!statusOutput.trim()) {
      return res.status(400).json({ error: 'File is not untracked or does not exist' });
    }

    const status = statusOutput.substring(0, 2);
    
    if (status !== '??') {
      return res.status(400).json({ error: 'File is not untracked. Use discard for tracked files.' });
    }

    // Delete the untracked file or directory
    const filePath = path.join(repositoryRootPath, repositoryRelativeFilePath);
    const stats = await fs.stat(filePath);

    if (stats.isDirectory()) {
      // Use rm with recursive option for directories
      await fs.rm(filePath, { recursive: true, force: true });
      res.json({ success: true, message: `Untracked directory ${repositoryRelativeFilePath} deleted successfully` });
    } else {
      await fs.unlink(filePath);
      res.json({ success: true, message: `Untracked file ${repositoryRelativeFilePath} deleted successfully` });
    }
  } catch (error) {
    console.error('Git delete untracked error:', error);
    res.status(500).json({ error: errorMessage(error) });
  }
});

export default router;
