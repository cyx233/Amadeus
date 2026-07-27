import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { trajectoryDb } from '@/modules/database/repositories/trajectory.db.js';
import type { TrajectoryRow } from '@/shared/types.js';

// In-process MCP server exposing "trajectory / working memory" recall to the
// agent. Pull-only by design (PRD §4): the agent calls this when it judges a
// task may relate to recent past work — nothing is force-injected — so recall
// never bloats context and stale trajectories can't silently pollute a turn.
//
// Same trajectory table the per-turn capture seam writes to; this is the read
// side. Every query runs against the per-user container's own SQLite DB (via
// `trajectoryDb` -> `getConnection()`), so cross-user isolation is structural.

/**
 * Hard recency window (PRD §4 "Recall"): recall only considers turns from the
 * last N milliseconds, so stale trajectories can't mislead a new task. Tunable
 * via `CLOUDCLI_RECALL_RECENCY_WINDOW_MS`; defaults to 7 days. A malformed or
 * non-positive override falls back to the default rather than feeding NaN into
 * the recency query.
 */
export const RECENCY_WINDOW_MS = ((): number => {
  const fallback = 7 * 24 * 60 * 60 * 1000; // 7 days
  const raw = process.env.CLOUDCLI_RECALL_RECENCY_WINDOW_MS;
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
})();

/**
 * Top-K matches recall returns (PRD §4: "return top-K = 3"). Deliberately small
 * so recall surfaces only the most relevant past turns, never a context dump.
 */
export const RECALL_TOP_K = 3;

/**
 * Agent-facing shape of one recalled turn. Deliberately drops the row's internal
 * `id`/`session_id`; `title` is coerced from the row's nullable column to a
 * string so the tool result is uniform. Metadata only — never file content.
 */
export type RecallMatch = {
  title: string;
  tools: string[];
  files: string[];
  scripts: string[];
  created_at: string;
};

function rowToMatch(row: TrajectoryRow): RecallMatch {
  return {
    title: row.title ?? '',
    tools: row.tools,
    files: row.files,
    scripts: row.scripts,
    created_at: row.created_at,
  };
}

/**
 * Core recall logic, factored out of the tool wrapper so it is unit-testable
 * without the MCP layer.
 *
 * Ranks past turns by how many of `current_files` they touched, within
 * `RECENCY_WINDOW_MS`, capped at `RECALL_TOP_K`. Input is defended here — a
 * missing, non-array, or mixed-type `current_files` degrades to the string
 * entries it can find (or none) rather than throwing — so the agent can never
 * break the tool with a malformed argument. A no-match is a normal result:
 * returns `{ matches: [] }`, not an error (PRD §4 edge cases).
 */
export function recallRelatedWork(input: { current_files?: unknown }): { matches: RecallMatch[] } {
  const currentFiles = Array.isArray(input?.current_files)
    ? input.current_files.filter((entry): entry is string => typeof entry === 'string')
    : [];

  const rows = trajectoryDb.queryByFileOverlap(currentFiles, RECENCY_WINDOW_MS, RECALL_TOP_K);
  return { matches: rows.map(rowToMatch) };
}

const ok = (payload: unknown): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(payload) }],
});

const RECALL_TOOL_DESCRIPTION = [
  'Recall your own recent past work related to the files you are about to touch.',
  `Returns up to ${RECALL_TOP_K} past turns that touched the same files (most file-overlap first,`,
  'within roughly the last week), each with its title, the tools used, the files touched,',
  'and the shell commands run — metadata only, never file contents.',
  'Call this when starting a task on files that may relate to recent past work, to regain',
  'continuity without asking the user to re-explain what was done before.',
  'This is a fast, local, per-user lookup; an empty result simply means no related past work was found.',
].join(' ');

/** Exported so tests can assert schema/registration and invoke the handler directly. */
export const recallTool = tool(
  'recall_related_work',
  RECALL_TOOL_DESCRIPTION,
  {
    current_files: z
      .array(z.string())
      .describe(
        'Paths of the files the current task involves, as they appear in your file tools. '
        + 'Recall ranks past turns by how many of these paths they touched. '
        + 'An empty list is allowed and simply returns no matches.',
      ),
  },
  async ({ current_files }) => ok(recallRelatedWork({ current_files })),
);

export const recallMcpServer = createSdkMcpServer({
  name: 'recall',
  version: '1.0.0',
  tools: [recallTool],
});
