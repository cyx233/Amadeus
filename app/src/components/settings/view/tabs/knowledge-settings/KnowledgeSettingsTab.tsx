import { useTranslation } from 'react-i18next';

import RagGlobalToggle from '../../RagGlobalToggle';

/**
 * Knowledge (RAG) settings tab. Currently the deployment-wide RAG on/off switch;
 * a natural home for future retrieval knobs (ingest, top-k, retrieval mode).
 */
export default function KnowledgeSettingsTab() {
  const { t } = useTranslation('settings');

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          {t(
            'knowledgeSettings.intro',
            'Sessions can retrieve indexed workspace knowledge (LightRAG) as background context. Enable it here, then opt in per session from the chat composer.'
          )}
        </p>
      </div>

      <RagGlobalToggle />
    </div>
  );
}
