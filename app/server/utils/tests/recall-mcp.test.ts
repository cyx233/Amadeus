import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { trajectoryDb } from '@/modules/database/repositories/trajectory.db.js';
import {
  RECALL_TOP_K,
  RECENCY_WINDOW_MS,
  recallMcpServer,
  recallRelatedWork,
  recallTool,
} from '@/utils/recall-mcp.js';
import type { TrajectoryRow } from '@/shared/types.js';

// A stand-in repository row. The recall tool never reads `id`/`session_id`, so
// tests give them fixed placeholders and focus on the fields it maps out.
function makeRow(overrides: Partial<TrajectoryRow>): TrajectoryRow {
  return {
    id: 1,
    session_id: 'session-1',
    title: 'untitled',
    tools: [],
    files: [],
    scripts: [],
    created_at: '2026-07-26 00:00:00',
    ...overrides,
  };
}

// --- Unit tests: recall logic against a mocked repository -------------------

test('recallRelatedWork passes the repo order through and maps rows to DTOs', (t) => {
  const rows: TrajectoryRow[] = [
    makeRow({ id: 10, session_id: 's-a', title: 'first', tools: ['Edit'], files: ['a.ts', 'b.ts'], scripts: ['npm test'], created_at: '2026-07-26 03:00:00' }),
    makeRow({ id: 11, session_id: 's-b', title: 'second', tools: ['Read'], files: ['a.ts'], scripts: [], created_at: '2026-07-26 02:00:00' }),
    makeRow({ id: 12, session_id: 's-c', title: 'third', tools: ['Bash'], files: ['a.ts', 'c.ts'], scripts: ['ls'], created_at: '2026-07-26 01:00:00' }),
  ];
  const query = t.mock.method(trajectoryDb, 'queryByFileOverlap', () => rows);

  const result = recallRelatedWork({ current_files: ['a.ts'] });

  // Order is preserved exactly as the repo returned it (ranking lives in the repo).
  assert.deepEqual(
    result.matches,
    [
      { title: 'first', tools: ['Edit'], files: ['a.ts', 'b.ts'], scripts: ['npm test'], created_at: '2026-07-26 03:00:00' },
      { title: 'second', tools: ['Read'], files: ['a.ts'], scripts: [], created_at: '2026-07-26 02:00:00' },
      { title: 'third', tools: ['Bash'], files: ['a.ts', 'c.ts'], scripts: ['ls'], created_at: '2026-07-26 01:00:00' },
    ],
  );
  // Internal columns are not leaked to the agent.
  for (const match of result.matches) {
    assert.equal('id' in match, false);
    assert.equal('session_id' in match, false);
  }

  // The tool passes the config-tunable window and top-K straight through.
  assert.equal(query.mock.callCount(), 1);
  assert.deepEqual(query.mock.calls[0].arguments, [['a.ts'], RECENCY_WINDOW_MS, RECALL_TOP_K]);
});

test('recallRelatedWork coerces a null title to an empty string', (t) => {
  t.mock.method(trajectoryDb, 'queryByFileOverlap', () => [makeRow({ title: null, files: ['a.ts'] })]);

  const result = recallRelatedWork({ current_files: ['a.ts'] });

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].title, '');
});

test('recallRelatedWork returns an empty result (not an error) on no matches', (t) => {
  t.mock.method(trajectoryDb, 'queryByFileOverlap', () => []);

  const result = recallRelatedWork({ current_files: ['nothing-overlaps.ts'] });

  assert.deepEqual(result, { matches: [] });
});

test('recallRelatedWork tolerates malformed current_files without throwing', (t) => {
  const query = t.mock.method(trajectoryDb, 'queryByFileOverlap', () => []);

  // Each of these must not throw and must feed a sanitized string[] to the repo.
  assert.deepEqual(recallRelatedWork({}), { matches: [] });
  assert.deepEqual(recallRelatedWork({ current_files: undefined }), { matches: [] });
  assert.deepEqual(recallRelatedWork({ current_files: 'a.ts' }), { matches: [] });
  assert.deepEqual(recallRelatedWork({ current_files: 42 }), { matches: [] });
  assert.deepEqual(recallRelatedWork({ current_files: ['a.ts', 7, null, 'b.ts'] as unknown }), { matches: [] });

  // Non-array inputs collapse to []; mixed arrays keep only the string entries.
  assert.deepEqual(query.mock.calls[0].arguments[0], []);
  assert.deepEqual(query.mock.calls[1].arguments[0], []);
  assert.deepEqual(query.mock.calls[2].arguments[0], []);
  assert.deepEqual(query.mock.calls[3].arguments[0], []);
  assert.deepEqual(query.mock.calls[4].arguments[0], ['a.ts', 'b.ts']);
});

// --- Registration / schema test: the agent-facing MCP tool ------------------

test('recall tool is registered on the recall MCP server with the expected schema', () => {
  // Server identity the SDK exposes to the agent runtime.
  assert.equal(recallMcpServer.type, 'sdk');
  assert.equal(recallMcpServer.name, 'recall');
  assert.ok(recallMcpServer.instance, 'server should carry a live MCP instance');

  // Tool identity + a non-empty description (the agent uses it to decide when to call).
  assert.equal(recallTool.name, 'recall_related_work');
  assert.equal(typeof recallTool.description, 'string');
  assert.ok(recallTool.description.length > 0);

  // Input schema declares the single `current_files` argument.
  assert.deepEqual(Object.keys(recallTool.inputSchema), ['current_files']);
});

test('recall tool handler returns a JSON CallToolResult wrapping the matches', async (t) => {
  t.mock.method(trajectoryDb, 'queryByFileOverlap', () => [makeRow({ title: 'wrapped', files: ['a.ts'] })]);

  const result = await recallTool.handler({ current_files: ['a.ts'] }, undefined);

  assert.equal(result.content[0].type, 'text');
  const payload = JSON.parse((result.content[0] as { text: string }).text);
  assert.equal(payload.matches.length, 1);
  assert.equal(payload.matches[0].title, 'wrapped');
  assert.deepEqual(payload.matches[0].files, ['a.ts']);
});

// --- Integration smoke test: real per-user SQLite through the tool ----------

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'recall-mcp-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

/**
 * Inserts a trajectory row, then rewrites its `created_at` to `now + modifier`
 * so recency-window and recency-tiebreak behavior is deterministic (the repo
 * intentionally offers no API to set `created_at`).
 */
function insertAged(row: Parameters<typeof trajectoryDb.insertTrajectory>[0], modifier: string): void {
  trajectoryDb.insertTrajectory(row);
  const db = getConnection();
  db.prepare(
    `UPDATE trajectory SET created_at = datetime('now', ?) WHERE id = last_insert_rowid()`,
  ).run(modifier);
}

test('recall tool returns real top-3 rows ranked by overlap then recency, excluding stale ones', async () => {
  await withIsolatedDatabase(async () => {
    // Two overlap-2 rows (recency breaks their tie), one overlap-1 row, and a
    // stale overlap-2 row that the recency window must drop.
    insertAged({ sessionId: 's1', title: 'older overlap-2', tools: ['Edit'], files: ['a.ts', 'b.ts'], scripts: [] }, '-3 minutes');
    insertAged({ sessionId: 's2', title: 'newer overlap-2', tools: ['Write'], files: ['a.ts', 'b.ts', 'c.ts'], scripts: [] }, '-1 minutes');
    insertAged({ sessionId: 's3', title: 'overlap-1', tools: ['Read'], files: ['a.ts'], scripts: [] }, '-2 minutes');
    insertAged({ sessionId: 's4', title: 'stale overlap-2', tools: ['Edit'], files: ['a.ts', 'b.ts'], scripts: [] }, '-30 days');

    const result = recallRelatedWork({ current_files: ['a.ts', 'b.ts'] });

    assert.equal(result.matches.length, 3);
    assert.deepEqual(
      result.matches.map((m) => m.title),
      ['newer overlap-2', 'older overlap-2', 'overlap-1'],
    );
    // The stale row is excluded by the recency window even though it overlaps.
    assert.equal(result.matches.some((m) => m.title === 'stale overlap-2'), false);
  });
});

test('recall tool returns an empty result against a real DB when nothing overlaps', async () => {
  await withIsolatedDatabase(async () => {
    insertAged({ sessionId: 's1', title: 'unrelated', tools: ['Edit'], files: ['x.ts'], scripts: [] }, '-1 minutes');

    assert.deepEqual(recallRelatedWork({ current_files: ['a.ts'] }), { matches: [] });
  });
});
