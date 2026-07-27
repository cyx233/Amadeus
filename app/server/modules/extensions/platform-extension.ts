import type { Router } from 'express';

/**
 * A "platform extension" — a capability that plugs into the platform's own
 * backend/UI (as opposed to an agent tool, which registers via the CLI's
 * ~/.claude.json mcpServers and needs no platform code). TaskMaster is the first
 * one. See .local/platform-extension-registry-design.md.
 *
 * The core wires extensions ONLY through this manifest: the registry mounts
 * `routes`, builds `mcp` clients, runs `detect`, and (frontend) renders `panel`.
 * Adding a second extension is one manifest — the core names no extension.
 */
export interface PlatformExtensionManifest {
  /** Stable id; also the URL segment: routes mount at /api/ext/<id>. */
  id: string;

  /** Human label for the UI panel/tab. */
  title: string;

  /**
   * Whether this extension is active for a given project. "Invisible"
   * activation = detection (a marker in the project), not manual setup.
   * e.g. TaskMaster: does `<projectPath>/.taskmaster` exist.
   */
  detect(projectPath: string): Promise<boolean>;

  /** Express router mounted (auth-guarded) at /api/ext/<id>. Optional. */
  routes?: Router;

  /**
   * A resident stdio MCP server the extension's own backend calls. Optional.
   * The registry builds one lazy, crash-resilient client per manifest and
   * tears it down on shutdown.
   */
  mcp?: {
    command: string;
    args?: string[];
    /** Extra env merged over process.env for the spawned server. */
    env?: Record<string, string>;
  };

  /**
   * Frontend panel descriptor. The backend only echoes this (via
   * GET /api/ext/active) so the frontend panel registry knows what to render;
   * the actual component lives in src/extensions/registry.ts keyed by `id`.
   */
  panel?: {
    /** Bottom-panel tab label. */
    label: string;
  };
}
