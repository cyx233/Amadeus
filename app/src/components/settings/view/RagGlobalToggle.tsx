import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { authenticatedFetch } from '../../../utils/api';

import SettingsCard from './SettingsCard';
import SettingsRow from './SettingsRow';
import SettingsSection from './SettingsSection';
import SettingsToggle from './SettingsToggle';

/**
 * Deployment-wide RAG kill switch. Self-contained (own fetch/state) so it can be
 * dropped into any settings tab without threading through the settings controller.
 * When off, the per-session RAG toggle in the chat composer is hidden and no
 * retrieval happens anywhere.
 */
export default function RagGlobalToggle() {
  const { t } = useTranslation('settings');
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    authenticatedFetch('/api/settings/rag')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.settings) setEnabled(data.settings.enabled === true);
      })
      .catch(() => { /* leave off */ })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const handleChange = (value: boolean) => {
    setEnabled(value); // optimistic
    authenticatedFetch('/api/settings/rag', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: value }),
    }).catch(() => setEnabled(!value)); // revert on failure
  };

  return (
    <SettingsSection title={t('ragSettings.title', 'Workspace knowledge (RAG)')}>
      <SettingsCard>
        <SettingsRow
          label={t('ragSettings.enable.label', 'Enable RAG retrieval')}
          description={t(
            'ragSettings.enable.description',
            'Let sessions retrieve indexed workspace knowledge. Turn on per session from the chat composer.'
          )}
        >
          <SettingsToggle
            checked={enabled}
            onChange={handleChange}
            disabled={!loaded}
            ariaLabel={t('ragSettings.enable.label', 'Enable RAG retrieval')}
          />
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  );
}
