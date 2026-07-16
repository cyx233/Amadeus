/**
 * Git credential synchronization.
 *
 * Bridges the app's stored GitHub tokens (saved via Settings → API Settings →
 * GitHub, persisted in the `user_credentials` table) into the OS-level git that
 * actually runs `git push`/`pull`/`fetch` in `server/routes/git.js`.
 *
 * Strategy ("credential store"): we configure git *globally* so both the app's
 * git endpoints AND an interactive shell in the container pick the token up
 * automatically — a real "configure once, works everywhere" experience:
 *
 *   1. `git config --global credential.helper store`
 *        → git reads/writes `~/.git-credentials`.
 *   2. Write `https://<token>@github.com` into `~/.git-credentials`.
 *   3. `git config --global url."https://github.com/".insteadOf git@github.com:`
 *        → SSH remotes (`git@github.com:owner/repo.git`) are transparently
 *          rewritten to HTTPS, so repos cloned with SSH URLs still work in this
 *          container (which has no `ssh` binary).
 *
 * Because `~/.git-credentials` and `~/.gitconfig` live in the container HOME,
 * which is NOT on the persisted `~/.claude` volume, this must run on every
 * server start (to rebuild the files) in addition to whenever a token is
 * added/removed/toggled.
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

// cross-spawn: drop-in spawn with Windows .cmd/PATHEXT resolution.
import spawn from 'cross-spawn';

import { credentialsDb, userDb } from '../modules/database/index.js';

const GITHUB_TOKEN_TYPE = 'github_token';
const GIT_CREDENTIALS_FILE = path.join(os.homedir(), '.git-credentials');

// Managed block markers so we only ever touch the lines we own and leave any
// user- or tool-authored credentials in the file intact.
const BLOCK_BEGIN = '# >>> amadeus-managed github credential >>>';
const BLOCK_END = '# <<< amadeus-managed github credential <<<';

function runGit(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { shell: false });
    let stderr = '';
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const error = new Error(`git ${args.join(' ')} failed (exit ${code}): ${stderr.trim()}`);
      error.code = code;
      reject(error);
    });
  });
}

/**
 * Reads `~/.git-credentials` and returns its lines with any previously
 * app-managed block stripped out. Missing file → empty list.
 */
async function readForeignCredentialLines() {
  let raw;
  try {
    raw = await fs.readFile(GIT_CREDENTIALS_FILE, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const lines = raw.split(/\r?\n/);
  const kept = [];
  let insideManagedBlock = false;
  for (const line of lines) {
    if (line === BLOCK_BEGIN) {
      insideManagedBlock = true;
      continue;
    }
    if (line === BLOCK_END) {
      insideManagedBlock = false;
      continue;
    }
    if (!insideManagedBlock && line.trim() !== '') {
      kept.push(line);
    }
  }
  return kept;
}

async function writeCredentialsFile(foreignLines, managedEntry) {
  const parts = [...foreignLines];
  if (managedEntry) {
    parts.push(BLOCK_BEGIN, managedEntry, BLOCK_END);
  }
  const content = parts.length > 0 ? `${parts.join('\n')}\n` : '';
  // 0600: the file contains a bearer token in plaintext.
  await fs.writeFile(GIT_CREDENTIALS_FILE, content, { mode: 0o600 });
  await fs.chmod(GIT_CREDENTIALS_FILE, 0o600).catch(() => {});
}

/**
 * Resolves the token whose value should back git operations.
 *
 * This is a single-user platform (one container per user), so the active token
 * is unambiguous: the most-recent active `github_token` for the first/only user
 * in the database — the same user `authenticateToken` resolves for every
 * request in platform mode.
 */
function resolveActiveToken() {
  const user = userDb.getFirstUser();
  if (!user) {
    return null;
  }
  return credentialsDb.getActiveCredential(user.id, GITHUB_TOKEN_TYPE);
}

/**
 * Rewrites `~/.git-credentials` and global git config from the currently
 * active stored GitHub token. Safe to call repeatedly; never throws (logs and
 * returns a status so callers on the request path don't fail the response).
 *
 * @returns {Promise<{ configured: boolean, reason?: string }>}
 */
export async function syncGitCredentials() {
  try {
    const token = resolveActiveToken();
    const foreignLines = await readForeignCredentialLines();

    if (!token) {
      // No active token: remove our managed block but leave the rest of the
      // file (and any foreign credentials) untouched.
      await writeCredentialsFile(foreignLines, null);
      return { configured: false, reason: 'no-active-token' };
    }

    // A GitHub PAT is used as the password with an arbitrary (non-empty)
    // username. Encode both so tokens containing URL-reserved characters don't
    // corrupt the credential line.
    const managedEntry = `https://${encodeURIComponent('x-access-token')}:${encodeURIComponent(token)}@github.com`;
    await writeCredentialsFile(foreignLines, managedEntry);

    // Global git config: credential store + SSH→HTTPS rewrite. Both idempotent.
    await runGit(['config', '--global', 'credential.helper', 'store']);
    await runGit([
      'config', '--global',
      'url.https://github.com/.insteadOf', 'git@github.com:',
    ]);

    return { configured: true };
  } catch (error) {
    console.error('[git-credentials] Failed to sync git credentials:', error.message);
    return { configured: false, reason: error.message };
  }
}
