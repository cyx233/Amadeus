import { useCallback, useEffect, useState } from 'react';

import { api } from '../../../utils/api';

export type ModelOption = { value: string; label?: string; description?: string };
export type ProviderModels = {
  provider: string;
  current: string; // provider's default model (provider:<p>:model or catalog default)
  defaultModel: string; // catalog DEFAULT
  options: ModelOption[];
};
export type FeaturePref = {
  id: string;
  label: string;
  provider: string | null; // null = follow global
  model: string | null; // null = follow provider default
};

type ModelsResponse = {
  globalProvider: string;
  chatProviders: string[];
  providers: ProviderModels[];
  features: FeaturePref[];
};

/**
 * Shared model-preference state for the Model Preference + Feature Preference
 * tabs. Fetches once; mutations PUT and optimistically update local state so all
 * (interrelated) dropdowns re-render live without a refetch. Mirrors the
 * backend's two-axis resolution client-side so "Default" labels show the value a
 * feature would actually resolve to as the defaults change.
 */
export function useModelPreferences() {
  const [data, setData] = useState<ModelsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.user.getModels();
      if (!res.ok) throw new Error('Failed to load model preferences');
      setData((await res.json()) as ModelsResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load model preferences');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const providerModels = useCallback(
    (provider: string): ProviderModels | undefined => data?.providers.find((p) => p.provider === provider),
    [data],
  );

  // Client-side mirror of backend resolveModel for a feature.
  const resolveFeature = useCallback(
    (featureId: string): { provider: string; model: string } => {
      const empty = { provider: data?.globalProvider ?? 'claude', model: '' };
      if (!data) return empty;
      const feature = data.features.find((f) => f.id === featureId);
      const provider = feature?.provider || data.globalProvider || 'claude';
      const model = feature?.model || providerModels(provider)?.current || providerModels(provider)?.defaultModel || '';
      return { provider, model };
    },
    [data, providerModels],
  );

  // --- mutations: PUT + optimistic local update ---

  const setGlobalProvider = useCallback(async (provider: string) => {
    setData((d) => (d ? { ...d, globalProvider: provider } : d));
    await api.user.updateModel({ globalProvider: provider });
  }, []);

  const setProviderModel = useCallback(async (provider: string, model: string) => {
    setData((d) => (d
      ? { ...d, providers: d.providers.map((p) => (p.provider === provider ? { ...p, current: model } : p)) }
      : d));
    await api.user.updateModel({ provider, model });
  }, []);

  const setFeatureProvider = useCallback(async (feature: string, provider: string | null) => {
    setData((d) => (d
      ? { ...d, features: d.features.map((f) => (f.id === feature ? { ...f, provider, model: null } : f)) }
      : d));
    // Changing provider clears the model override (it belonged to the old provider).
    if (provider === null) {
      await api.user.updateModel({ feature, clear: 'provider' });
    } else {
      await api.user.updateModel({ feature, provider });
    }
    await api.user.updateModel({ feature, clear: 'model' });
  }, []);

  const setFeatureModel = useCallback(async (feature: string, provider: string, model: string | null) => {
    setData((d) => (d
      ? { ...d, features: d.features.map((f) => (f.id === feature ? { ...f, model } : f)) }
      : d));
    if (model === null) {
      await api.user.updateModel({ feature, clear: 'model' });
    } else {
      await api.user.updateModel({ feature, provider, model });
    }
  }, []);

  return {
    data,
    loading,
    error,
    providerModels,
    resolveFeature,
    setGlobalProvider,
    setProviderModel,
    setFeatureProvider,
    setFeatureModel,
  };
}
