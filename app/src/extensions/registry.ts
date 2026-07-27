import { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';

/**
 * FRONTEND PLATFORM-EXTENSION PANEL REGISTRY
 * ==========================================
 *
 * Maps an extension id (the same id the backend manifest declares) to its
 * bottom-panel React component, lazily loaded so an extension's UI only enters
 * the bundle graph when rendered. MainContent renders a tab per ACTIVE extension
 * (from GET /api/ext/active) using this registry — the core no longer hardcodes
 * `bottomPanel === 'tasks'`.
 *
 * Adding an extension's UI = one entry here (its backend manifest + wiring are
 * the other half). See .local/platform-extension-registry-design.md.
 */

/** Every extension panel receives the same minimal contract. */
export interface ExtensionPanelProps {
  /** Kept mounted while the tab is inactive (some panels preserve state). */
  isVisible: boolean;
}

type ExtensionPanel = LazyExoticComponent<ComponentType<ExtensionPanelProps>>;

const PANELS: Record<string, ExtensionPanel> = {
  taskmaster: lazy(() => import('../components/task-master/view/TaskMasterPanel')),
};

/** The panel component for an extension id, or null if the frontend has none. */
export function getExtensionPanel(id: string): ExtensionPanel | null {
  return PANELS[id] ?? null;
}
