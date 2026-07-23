/**
 * Model-preference resolution — the model-id-agnostic layer. Features ask for a
 * model by *feature name* and get back a concrete { provider, model }, resolved
 * across two orthogonal axes, each with a global fallback + per-feature override:
 *
 *   provider = feature-override (feature:<f>:provider)
 *            ?? global default   (global:provider)
 *            ?? 'claude'
 *   model    = feature-override (feature:<f>:model)
 *            ?? provider default (provider:<p>:model)
 *            ?? that provider catalog's own DEFAULT
 *
 * Keys are centralized here so routes/consumers never hand-build them.
 */

import { modelPreferencesDb } from '../../database/index.js';
import { providerModelsService } from './provider-models.service.js';

export const CHAT_PROVIDERS = ['claude', 'cursor', 'codex', 'opencode'];
const FALLBACK_PROVIDER = 'claude';

// Features that resolve a model independently and can be overridden per-feature.
// (chat isn't here: it's provider-pinned by the agent the user picks. task-gen
// isn't here either: TaskMaster is a self-contained tool with its own rich model
// selector — `init` / `models --setup` with many providers + custom ids — so we
// don't reconstruct or drive it; deep config stays in TaskMaster's own channel.)
// `id` is the key namespace; `label` is for the UI.
export const MODEL_FEATURES = [
  { id: 'commit-message', label: 'Commit message generation' },
];

// Key builders — the single place that knows the KV layout.
export const prefKeys = {
  globalProvider: () => 'global:provider',
  providerModel: (provider) => `provider:${provider}:model`,
  featureProvider: (feature) => `feature:${feature}:provider`,
  featureModel: (feature) => `feature:${feature}:model`,
};

async function catalogDefaultSentinel(provider) {
  const catalog = (await providerModelsService.getProviderModels(provider)).models;
  return catalog.DEFAULT;
}

/**
 * Resolve the { provider, model } a feature should use.
 *
 * `model` is null when the user hasn't chosen a concrete model — i.e. it would
 * resolve to the provider's catalog DEFAULT, which for some providers (claude)
 * is a sentinel like 'default' meaning "use the tool's own configured default",
 * not a real model id. Callers treat null as "don't pass a model / inherit the
 * provider's own default", so no consumer needs to know provider-specific
 * sentinels.
 *
 * @param {number} userId
 * @param {string} feature  e.g. 'commit-message', 'chat', 'task-gen'
 * @param {{ provider?: string }} [opts]  pin the provider (e.g. chat already
 *   knows which agent the user picked); skips provider resolution.
 * @returns {Promise<{ provider: string, model: string | null }>}
 */
export async function resolveModel(userId, feature, opts = {}) {
  const prefs = modelPreferencesDb.getAll(userId);

  const provider = opts.provider
    || prefs[prefKeys.featureProvider(feature)]
    || prefs[prefKeys.globalProvider()]
    || FALLBACK_PROVIDER;

  // Only an explicit choice counts as a concrete model. Falling through to the
  // catalog DEFAULT means "no explicit choice" → null.
  const chosen = prefs[prefKeys.featureModel(feature)] || prefs[prefKeys.providerModel(provider)];
  const sentinel = await catalogDefaultSentinel(provider);
  const model = chosen && chosen !== sentinel ? chosen : null;

  return { provider, model };
}
