import { useEffect, useState } from 'react';

import { api } from '../utils/api';

import { getExtensionPanel } from './registry';

/**
 * An extension that is active (detected) for the current project AND has a
 * frontend panel registered — i.e. renderable as a bottom-panel tab.
 */
export interface ActiveExtension {
  id: string;
  title: string;
  panelLabel: string;
}

type ActiveExtensionResponse = {
  active?: Array<{
    id: string;
    title?: string;
    panel?: { label?: string } | null;
  }>;
};

/**
 * Fetches which platform extensions are active for `projectId` (GET
 * /api/ext/active) and keeps only those the frontend can render (a panel is
 * registered + the backend advertised a panel). MainContent turns these into
 * bottom-panel tabs. Empty until a project is selected / the fetch resolves.
 */
export function useActiveExtensions(projectId: string | undefined): ActiveExtension[] {
  const [extensions, setExtensions] = useState<ActiveExtension[]>([]);

  useEffect(() => {
    if (!projectId) {
      setExtensions([]);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await api.get(`/ext/active?projectId=${encodeURIComponent(projectId)}`);
        if (!res.ok) {
          if (!cancelled) setExtensions([]);
          return;
        }
        const body = (await res.json()) as ActiveExtensionResponse;
        if (cancelled) return;

        const renderable = (body.active ?? [])
          .filter((e) => e.panel && getExtensionPanel(e.id))
          .map((e) => ({
            id: e.id,
            title: e.title ?? e.id,
            panelLabel: e.panel?.label ?? e.title ?? e.id,
          }));
        setExtensions(renderable);
      } catch {
        if (!cancelled) setExtensions([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return extensions;
}
