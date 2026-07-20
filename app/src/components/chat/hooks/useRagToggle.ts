import { useCallback, useEffect, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';

/**
 * Per-composer RAG opt-in state plus the deployment-wide gate.
 *
 * `globalEnabled` is the master switch (Settings → global RAG). When it's off,
 * the composer toggle is hidden and no per-session opt-in is offered. `ragEnabled`
 * is the user's per-new-session choice, sent in the POST /api/providers/sessions
 * body at first prompt and then persisted on the session row server-side.
 */
export function useRagToggle(): {
  globalEnabled: boolean;
  ragEnabled: boolean;
  toggleRag: () => void;
} {
  const [globalEnabled, setGlobalEnabled] = useState(false);
  const [ragEnabled, setRagEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    authenticatedFetch('/api/settings/rag')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.settings) setGlobalEnabled(data.settings.enabled === true);
      })
      .catch(() => { /* leave off on error */ });
    return () => { cancelled = true; };
  }, []);

  const toggleRag = useCallback(() => setRagEnabled((v) => !v), []);

  return { globalEnabled, ragEnabled, toggleRag };
}
