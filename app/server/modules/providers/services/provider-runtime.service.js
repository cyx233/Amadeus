/**
 * Provider runtime dispatch — the single source for "given a provider, which
 * agent runtime runs it". One-shot generation (text-generation.service.js)
 * resolves the runner here instead of hand-writing an
 * `if provider === 'claude' … else if …` switch. (Interactive chat wires the
 * same runners in directly as websocket spawnFns; see server/index.js.)
 *
 * Every runner shares the same shape: fn(message, options, writer), where
 * options carries { projectPath, cwd, sessionId, model, effort, permissionMode,
 * skipPermissions }. Callers pass only what a given flow needs.
 */

import { queryClaudeSDK } from '../../../claude-sdk.js';
import { spawnCursor } from '../../../cursor-cli.js';
import { queryCodex } from '../../../openai-codex.js';
import { spawnOpenCode } from '../../../opencode-cli.js';

const PROVIDER_RUNNERS = {
  claude: queryClaudeSDK,
  cursor: spawnCursor,
  codex: queryCodex,
  opencode: spawnOpenCode,
};

/** The streaming agent runtime for a provider, or undefined if unknown. */
export function getProviderRunner(provider) {
  return PROVIDER_RUNNERS[provider];
}
