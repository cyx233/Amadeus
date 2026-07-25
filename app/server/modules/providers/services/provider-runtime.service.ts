/**
 * Provider runtime dispatch — the single source for "given a provider, which
 * agent runtime runs it". One-shot generation (text-generation.service.ts)
 * resolves the runner here instead of hand-writing an
 * `if provider === 'claude' … else if …` switch. (Interactive chat wires the
 * same `IProviderAgent.run` methods in directly as websocket spawnFns; see
 * server/index.ts.)
 *
 * Every runner shares the same shape: fn(message, options, writer), where
 * options carries { projectPath, cwd, sessionId, model, effort, permissionMode,
 * skipPermissions }. Callers pass only what a given flow needs.
 */

import { providerRegistry } from '@/modules/providers/provider.registry.js';
import type { AnyRecord } from '@/shared/types.js';

type ProviderRunner = (command: string, options: AnyRecord, writer: unknown) => Promise<void>;

/**
 * The streaming agent runtime for a provider, or undefined if unknown.
 *
 * Unlike `providerRegistry.resolveProvider`, this returns `undefined` rather
 * than throwing on an unrecognized provider — preserved from before this was
 * routed through `IProviderAgent`, so the one existing caller
 * (text-generation.service.ts) keeps its own explicit "unsupported provider"
 * error rather than surfacing `providerRegistry`'s `AppError` shape.
 */
export function getProviderRunner(provider: string): ProviderRunner | undefined {
  try {
    const agent = providerRegistry.resolveProvider(provider).agent;
    return agent.run.bind(agent);
  } catch {
    return undefined;
  }
}
