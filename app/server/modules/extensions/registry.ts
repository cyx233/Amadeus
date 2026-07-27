import type { Express, Router, RequestHandler } from 'express';

import { projectsDb } from '@/modules/database/index.js';

import type { PlatformExtensionManifest } from './platform-extension.js';
import { taskmasterExtension } from './taskmaster.extension.js';

/**
 * PLATFORM EXTENSION REGISTRY
 * ===========================
 *
 * Single place the core wires platform extensions. Each manifest carries its
 * identity / detection / mcp / panel; the composition root (index.ts) injects
 * the concrete router + MCP-client shutdown (those live in routes/ and the
 * taskmaster-mcp module, outside this module's boundary). The core names no
 * extension beyond assembling this wiring.
 *
 * Adding an extension = append its manifest here + provide its wiring in
 * index.ts (+ its frontend panel in src/extensions/registry.ts).
 *
 * See .local/platform-extension-registry-design.md.
 */

const MANIFESTS: PlatformExtensionManifest[] = [
  taskmasterExtension,
];

/**
 * Runtime wiring the composition root supplies per extension id: the Express
 * router to mount, and (optional) the resident MCP client's teardown.
 */
export interface ExtensionWiring {
  router?: Router;
  mcpShutdown?: () => Promise<void>;
}

let wiringById: Record<string, ExtensionWiring> = {};

/**
 * Mount each extension's router at /api/ext/<id> (auth-guarded) plus the shared
 * discovery endpoint GET /api/ext/active?projectId= → which extensions are
 * active (detected) for that project, with their panel descriptors. The
 * frontend uses that to decide which extension panels to render.
 */
export function mountExtensions(
  app: Express,
  authenticateToken: RequestHandler,
  wiring: Record<string, ExtensionWiring>,
): void {
  wiringById = wiring;

  for (const manifest of MANIFESTS) {
    const router = wiring[manifest.id]?.router;
    if (router) {
      app.use(`/api/ext/${manifest.id}`, authenticateToken, router);
    }
  }

  app.get('/api/ext/active', authenticateToken, async (req, res) => {
    try {
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : '';
      const projectPath = projectId ? projectsDb.getProjectPathById(projectId) : null;

      // No project → nothing project-scoped is active.
      if (!projectPath) {
        res.json({ active: [] });
        return;
      }

      const results = await Promise.all(
        MANIFESTS.map(async (manifest) => ({
          manifest,
          active: await manifest.detect(projectPath).catch(() => false),
        })),
      );

      res.json({
        active: results
          .filter((r) => r.active)
          .map((r) => ({ id: r.manifest.id, title: r.manifest.title, panel: r.manifest.panel ?? null })),
      });
    } catch (error) {
      console.error('[extensions] /active failed:', error instanceof Error ? error.message : error);
      res.status(500).json({ error: 'Failed to resolve active extensions' });
    }
  });
}

/** Tear down every extension's resident MCP client (called on server shutdown). */
export async function shutdownExtensions(): Promise<void> {
  await Promise.all(
    MANIFESTS.map(async (manifest) => {
      const mcpShutdown = wiringById[manifest.id]?.mcpShutdown;
      if (!mcpShutdown) return;
      try {
        await mcpShutdown();
      } catch (err) {
        console.error(`[extensions] ${manifest.id} shutdown failed:`, err instanceof Error ? err.message : err);
      }
    }),
  );
}
