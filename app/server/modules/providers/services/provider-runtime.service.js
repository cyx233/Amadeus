/**
 * Provider runtime dispatch — the single source for "given a provider, which
 * agent runtime runs it". Both chat sends (routes/agent.js) and one-shot
 * generation (text-generation.service.js) resolve the runner here instead of
 * each hand-writing an `if provider === 'claude' … else if …` switch.
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
