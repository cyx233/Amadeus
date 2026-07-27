/**
 * TASK-MASTER MCP CLIENT
 * ======================
 *
 * task-master ships a `task-master-ai` MCP server (fastmcp, stdio) whose tools
 * take `projectRoot` per call (so ONE resident process serves every project)
 * and accept `tag` natively. We keep it resident to amortize its ~3.5s cold
 * start; each later call is a few ms.
 *
 * The resident-client mechanics (lazy spawn, crash-retry, envelope parsing) now
 * live in the shared MCP factory; this module is just the task-master instance,
 * kept so routes/taskmaster.ts (and the extension manifest) import a stable
 * `callTool`/`shutdown` pair.
 */

import { createResidentMcpClient } from '@/modules/extensions/index.js';

const client = createResidentMcpClient({
  command: 'task-master-ai',
  // Default MCP mode ('core') exposes only read/status tools; we drive
  // add/remove/update/deps too, so expose the full set.
  env: { TASK_MASTER_TOOLS: 'all' },
});

/**
 * Call a task-master MCP tool and return its structured result.
 * @param name  tool name, e.g. 'set_task_status'
 * @param args  tool arguments (must include projectRoot)
 */
export function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  return client.callTool(name, args);
}

/** Cleanly stop the resident process (called on server shutdown). */
export function shutdown(): Promise<void> {
  return client.shutdown();
}
