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
// (chat isn't here: it's provider-pinned by the agent the user picks, not a
// fixed feature.) `id` is the key namespace; `label` is for the UI.
export const MODEL_FEATURES = [
  { id: 'commit-message', label: 'Commit message generation' },
  { id: 'task-gen', label: 'Task generation (TaskMaster)' },
];

// Key builders — the single place that knows the KV layout.
export const prefKeys = {
  globalProvider: () => 'global:provider',
  providerModel: (provider) => `provider:${provider}:model`,
  featureProvider: (feature) => `feature:${feature}:provider`,
  featureModel: (feature) => `feature:${feature}:model`,
};

async function catalogDefault(provider) {
  const catalog = (await providerModelsService.getProviderModels(provider)).models;
  return catalog.DEFAULT;
}

/**
 * Resolve the { provider, model } a feature should use.
 * @param {number} userId
 * @param {string} feature  e.g. 'commit-message', 'chat', 'task-gen'
 * @param {{ provider?: string }} [opts]  pin the provider (e.g. chat already
 *   knows which agent the user picked); skips provider resolution.
 */
export async function resolveModel(userId, feature, opts = {}) {
  const prefs = modelPreferencesDb.getAll(userId);

  const provider = opts.provider
    || prefs[prefKeys.featureProvider(feature)]
    || prefs[prefKeys.globalProvider()]
    || FALLBACK_PROVIDER;

  const model = prefs[prefKeys.featureModel(feature)]
    || prefs[prefKeys.providerModel(provider)]
    || await catalogDefault(provider);

  return { provider, model };
}
