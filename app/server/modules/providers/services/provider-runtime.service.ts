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

import type { AnyRecord, LLMProvider } from '../../../shared/types.js';
import { queryClaudeSDK } from '../../../claude-sdk.js';
import { spawnCursor } from '../../../cursor-cli.js';
import { queryCodex } from '../../../openai-codex.js';
import { spawnOpenCode } from '../../../opencode-cli.js';

/**
 * Common shape every provider runtime exports. `options`/`writer` stay loose
 * here: each runtime declares its own concrete `Spawn*Options`/`*Writer`
 * types (they differ per provider — e.g. only Claude has `toolsSettings`),
 * and callers of `getProviderRunner` (currently one-shot generation) only
 * ever pass the small subset every runtime actually reads. Each entry below
 * is cast to this common shape since every runtime's real writer parameter
 * is necessarily narrower than `unknown`.
 */
type ProviderRunner = (command: string, options: AnyRecord, writer: unknown) => Promise<void>;

const PROVIDER_RUNNERS: Record<LLMProvider, ProviderRunner> = {
  claude: queryClaudeSDK as ProviderRunner,
  cursor: spawnCursor as ProviderRunner,
  codex: queryCodex as ProviderRunner,
  opencode: spawnOpenCode as ProviderRunner,
};

/** The streaming agent runtime for a provider, or undefined if unknown. */
export function getProviderRunner(provider: string): ProviderRunner | undefined {
  return provider in PROVIDER_RUNNERS ? PROVIDER_RUNNERS[provider as LLMProvider] : undefined;
}
