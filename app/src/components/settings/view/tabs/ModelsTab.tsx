import { useModelPreferences } from '../../hooks/useModelPreferences';

const providerLabel: Record<string, string> = {
  claude: 'Claude',
  cursor: 'Cursor',
  codex: 'Codex',
  opencode: 'OpenCode',
};

const selectClass =
  'rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground disabled:opacity-50';

/**
 * Models tab: two linked sections sharing one preference state so dropdowns
 * update live across them.
 *   1. Defaults — global provider + each provider's default model.
 *   2. Feature overrides — per-feature provider/model; "Default" follows (1).
 */
export default function ModelsTab() {
  const {
    data, loading, error, refreshing, refresh,
    providerModels, resolveFeature,
    setGlobalProvider, setProviderModel, setFeatureProvider, setFeatureModel,
  } = useModelPreferences();

  if (loading) return <div className="text-muted-foreground">Loading…</div>;
  if (error || !data) return <div className="text-red-500">{error ?? 'Failed to load'}</div>;

  return (
    <div className="space-y-10">
      {/* --- Section 1: defaults --- */}
      <section className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Model Preference</h2>
            <p className="text-xs text-muted-foreground">The provider and model used by default.</p>
          </div>
          {/* Model lists are cached; refresh after logging into a provider so its
              newly-available models appear. */}
          <button
            type="button"
            onClick={() => { void refresh(); }}
            disabled={refreshing}
            className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted disabled:opacity-50"
          >
            {refreshing ? 'Refreshing…' : 'Refresh models'}
          </button>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium text-foreground" htmlFor="global-provider">Default provider</label>
          <select
            id="global-provider"
            value={data.globalProvider}
            onChange={(e) => { void setGlobalProvider(e.target.value); }}
            className={`${selectClass} w-full max-w-sm`}
          >
            {data.chatProviders.map((p) => (
              <option key={p} value={p}>{providerLabel[p] ?? p}</option>
            ))}
          </select>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-medium text-foreground">Default model per provider</h3>
          {data.providers.map((p) => (
            <div key={p.provider} className="flex items-center justify-between gap-4">
              <label className="text-sm text-foreground" htmlFor={`model-${p.provider}`}>
                {providerLabel[p.provider] ?? p.provider}
              </label>
              <select
                id={`model-${p.provider}`}
                value={p.current}
                onChange={(e) => { void setProviderModel(p.provider, e.target.value); }}
                className={selectClass}
              >
                {p.options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label || o.value}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </section>

      {/* --- Section 2: per-feature overrides --- */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Feature Preference</h2>
          <p className="text-xs text-muted-foreground">
            Override the provider/model for a specific feature. &quot;Default&quot; follows the settings above.
          </p>
        </div>

        {data.features.map((f) => {
          const resolved = resolveFeature(f.id);
          const activeProvider = f.provider || resolved.provider;
          const catalog = providerModels(activeProvider);
          const resolvedLabel = catalog?.options.find((o) => o.value === resolved.model)?.label || resolved.model;

          return (
            <div key={f.id} className="space-y-3 rounded-lg border border-border/70 bg-background/60 p-4">
              <h3 className="text-sm font-medium text-foreground">{f.label}</h3>
              <div className="flex flex-wrap items-center gap-4">
                <div className="space-y-1">
                  <label className="block text-xs text-muted-foreground" htmlFor={`fp-${f.id}`}>Provider</label>
                  <select
                    id={`fp-${f.id}`}
                    value={f.provider ?? ''}
                    onChange={(e) => { void setFeatureProvider(f.id, e.target.value || null); }}
                    className={selectClass}
                  >
                    <option value="">Default ({providerLabel[resolved.provider] ?? resolved.provider})</option>
                    {data.chatProviders.map((p) => (
                      <option key={p} value={p}>{providerLabel[p] ?? p}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="block text-xs text-muted-foreground" htmlFor={`fm-${f.id}`}>Model</label>
                  <select
                    id={`fm-${f.id}`}
                    value={f.model ?? ''}
                    onChange={(e) => { void setFeatureModel(f.id, activeProvider, e.target.value || null); }}
                    className={selectClass}
                  >
                    <option value="">Default ({resolvedLabel})</option>
                    {catalog?.options.map((o) => (
                      <option key={o.value} value={o.value}>{o.label || o.value}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
