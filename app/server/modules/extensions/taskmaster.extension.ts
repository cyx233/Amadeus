import { stat } from 'node:fs/promises';
import path from 'node:path';

import type { PlatformExtensionManifest } from './platform-extension.js';

/**
 * TaskMaster — the first platform extension. Declares its identity, activation
 * detection (`.taskmaster/` present), MCP command, and bottom-panel descriptor.
 *
 * The concrete Express router and the resident MCP client's shutdown are NOT
 * imported here: `routes/` is outside the module boundary, and wiring them in
 * belongs to the composition root (index.ts), which injects them into the
 * registry at mount time. The manifest stays pure metadata + detection.
 */
export const taskmasterExtension: PlatformExtensionManifest = {
  id: 'taskmaster',
  title: 'Task Master',

  async detect(projectPath: string): Promise<boolean> {
    try {
      const s = await stat(path.join(projectPath, '.taskmaster'));
      return s.isDirectory();
    } catch {
      return false;
    }
  },

  mcp: { command: 'task-master-ai', env: { TASK_MASTER_TOOLS: 'all' } },

  panel: { label: 'Tasks' },
};
