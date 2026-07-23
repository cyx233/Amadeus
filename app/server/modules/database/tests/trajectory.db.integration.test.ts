import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { runMigrations } from '@/modules/database/migrations.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'trajectory-db-'));
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

type ColumnInfo = {
  name: string;
  type: string;
  notnull: number;
  pk: number;
};

test('migration creates the trajectory table with the expected columns', async () => {
  await withIsolatedDatabase(() => {
    const db = getConnection();

    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'trajectory'")
      .get();
    assert.ok(table, 'trajectory table should exist after initialization');

    const columns = db.prepare('PRAGMA table_info(trajectory)').all() as ColumnInfo[];
    const byName = new Map(columns.map((column) => [column.name, column]));

    assert.deepEqual(
      columns.map((column) => column.name).sort(),
      ['created_at', 'files', 'id', 'scripts', 'session_id', 'title', 'tools'],
    );

    // id is the INTEGER PRIMARY KEY AUTOINCREMENT rowid alias.
    assert.equal(byName.get('id')?.pk, 1);
    assert.equal(byName.get('id')?.type, 'INTEGER');

    // session_id and created_at are NOT NULL; the JSON-array columns are nullable.
    assert.equal(byName.get('session_id')?.notnull, 1);
    assert.equal(byName.get('created_at')?.notnull, 1);
    assert.equal(byName.get('tools')?.notnull, 0);
    assert.equal(byName.get('files')?.notnull, 0);
    assert.equal(byName.get('scripts')?.notnull, 0);
    assert.equal(byName.get('title')?.notnull, 0);
  });
});

test('migration creates the trajectory indexes', async () => {
  await withIsolatedDatabase(() => {
    const db = getConnection();

    const indexes = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'trajectory'")
        .all() as { name: string }[]
    ).map((index) => index.name);

    assert.ok(
      indexes.includes('idx_trajectory_created_at'),
      'idx_trajectory_created_at should exist',
    );
    assert.ok(
      indexes.includes('idx_trajectory_session_id'),
      'idx_trajectory_session_id should exist',
    );
  });
});

test('created_at defaults to a UTC datetime string when a row is inserted', async () => {
  await withIsolatedDatabase(() => {
    const db = getConnection();

    db.prepare(
      `INSERT INTO trajectory (session_id, title, tools, files, scripts)
       VALUES (?, ?, ?, ?, ?)`
    ).run('session-1', 'Fix login bug', '["Edit"]', '["/app/login.ts"]', '[]');

    const row = db
      .prepare('SELECT session_id, created_at FROM trajectory WHERE session_id = ?')
      .get('session-1') as { session_id: string; created_at: string } | undefined;

    assert.ok(row, 'inserted row should be readable');
    assert.match(
      row?.created_at ?? '',
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
      'created_at should default to a SQLite datetime string',
    );
  });
});

test('running migrations twice is idempotent', async () => {
  await withIsolatedDatabase(() => {
    const db = getConnection();

    // initializeDatabase() already ran the migrations once; a second explicit
    // pass must not throw (e.g. duplicate-table/index errors) so container
    // restarts stay safe.
    assert.doesNotThrow(() => {
      runMigrations(db);
      runMigrations(db);
    });

    const trajectoryTables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'trajectory'")
        .all() as { name: string }[]
    ).length;
    assert.equal(trajectoryTables, 1, 'trajectory table should exist exactly once');
  });
});
