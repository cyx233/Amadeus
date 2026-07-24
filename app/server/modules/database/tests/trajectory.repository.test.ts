import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { trajectoryDb } from '@/modules/database/repositories/trajectory.db.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'trajectory-repo-'));
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
 * Overwrites `created_at` on the most recently inserted row so recency-window
 * behavior is testable deterministically. `insertTrajectory` intentionally
 * leaves `created_at` to the column default (there is no API to set it), so
 * tests reach past the repository to age a row via raw SQL against the same DB.
 */
function ageLastInsertedRow(offsetModifier: string): void {
  const db = getConnection();
  db.prepare(
    `UPDATE trajectory
     SET created_at = datetime('now', ?)
     WHERE id = (SELECT MAX(id) FROM trajectory)`
  ).run(offsetModifier);
}

const HOUR_MS = 60 * 60 * 1000;

test('queryByFileOverlap ranks rows by descending file-overlap count', async () => {
  await withIsolatedDatabase(() => {
    trajectoryDb.insertTrajectory({
      sessionId: 's-low',
      title: 'one overlap',
      tools: ['Read'],
      files: ['/app/a.ts', '/app/unrelated.ts'],
      scripts: [],
    });
    trajectoryDb.insertTrajectory({
      sessionId: 's-high',
      title: 'two overlaps',
      tools: ['Edit'],
      files: ['/app/a.ts', '/app/b.ts', '/app/c.ts'],
      scripts: [],
    });

    const results = trajectoryDb.queryByFileOverlap(['/app/a.ts', '/app/b.ts'], 24 * HOUR_MS, 3);

    assert.equal(results.length, 2);
    assert.equal(results[0]?.session_id, 's-high', 'row with two overlaps ranks first');
    assert.equal(results[1]?.session_id, 's-low', 'row with one overlap ranks second');
  });
});

test('queryByFileOverlap breaks overlap ties by recency (newest first)', async () => {
  await withIsolatedDatabase(() => {
    trajectoryDb.insertTrajectory({
      sessionId: 's-older',
      title: 'older, one overlap',
      tools: [],
      files: ['/app/a.ts'],
      scripts: [],
    });
    ageLastInsertedRow('-2 hours');

    trajectoryDb.insertTrajectory({
      sessionId: 's-newer',
      title: 'newer, one overlap',
      tools: [],
      files: ['/app/a.ts'],
      scripts: [],
    });
    ageLastInsertedRow('-1 hours');

    const results = trajectoryDb.queryByFileOverlap(['/app/a.ts'], 24 * HOUR_MS, 3);

    assert.equal(results.length, 2);
    assert.equal(results[0]?.session_id, 's-newer', 'newer row wins the overlap tie');
    assert.equal(results[1]?.session_id, 's-older');
  });
});

test('queryByFileOverlap excludes rows older than the recency window', async () => {
  await withIsolatedDatabase(() => {
    trajectoryDb.insertTrajectory({
      sessionId: 's-stale',
      title: 'outside the window',
      tools: [],
      files: ['/app/a.ts'],
      scripts: [],
    });
    ageLastInsertedRow('-48 hours');

    trajectoryDb.insertTrajectory({
      sessionId: 's-fresh',
      title: 'inside the window',
      tools: [],
      files: ['/app/a.ts'],
      scripts: [],
    });

    const results = trajectoryDb.queryByFileOverlap(['/app/a.ts'], 24 * HOUR_MS, 3);

    assert.equal(results.length, 1, 'the 48h-old row is outside a 24h window');
    assert.equal(results[0]?.session_id, 's-fresh');
  });
});

test('queryByFileOverlap limits results to topK', async () => {
  await withIsolatedDatabase(() => {
    for (let index = 0; index < 5; index += 1) {
      trajectoryDb.insertTrajectory({
        sessionId: `s-${index}`,
        title: `row ${index}`,
        tools: [],
        files: ['/app/shared.ts'],
        scripts: [],
      });
    }

    const results = trajectoryDb.queryByFileOverlap(['/app/shared.ts'], 24 * HOUR_MS, 3);

    assert.equal(results.length, 3, 'topK caps the result count even when more rows match');
  });
});

test('queryByFileOverlap returns [] when nothing overlaps (no error)', async () => {
  await withIsolatedDatabase(() => {
    trajectoryDb.insertTrajectory({
      sessionId: 's-1',
      title: 'no shared files',
      tools: ['Read'],
      files: ['/app/other.ts'],
      scripts: [],
    });

    const results = trajectoryDb.queryByFileOverlap(['/app/current.ts'], 24 * HOUR_MS, 3);

    assert.deepEqual(results, []);
  });
});

test('queryByFileOverlap returns [] for empty currentFiles or non-positive topK', async () => {
  await withIsolatedDatabase(() => {
    trajectoryDb.insertTrajectory({
      sessionId: 's-1',
      title: 'has a file',
      tools: [],
      files: ['/app/a.ts'],
      scripts: [],
    });

    assert.deepEqual(trajectoryDb.queryByFileOverlap([], 24 * HOUR_MS, 3), []);
    assert.deepEqual(trajectoryDb.queryByFileOverlap(['/app/a.ts'], 24 * HOUR_MS, 0), []);
  });
});

test('insertTrajectory round-trips tools/files/scripts arrays through JSON', async () => {
  await withIsolatedDatabase(() => {
    trajectoryDb.insertTrajectory({
      sessionId: 's-roundtrip',
      title: 'serialization check',
      tools: ['Read', 'Edit', 'Bash'],
      files: ['/app/a.ts', '/app/b with space.ts', '/app/"quoted".ts'],
      scripts: ['npm test', 'git commit -m "wip"'],
    });

    const [row] = trajectoryDb.queryByFileOverlap(['/app/a.ts'], 24 * HOUR_MS, 3);

    assert.ok(row, 'the inserted row is recalled');
    assert.equal(row?.title, 'serialization check');
    assert.deepEqual(row?.tools, ['Read', 'Edit', 'Bash']);
    assert.deepEqual(row?.files, ['/app/a.ts', '/app/b with space.ts', '/app/"quoted".ts']);
    assert.deepEqual(row?.scripts, ['npm test', 'git commit -m "wip"']);
  });
});

test('queryByFileOverlap counts distinct shared files, not duplicates', async () => {
  await withIsolatedDatabase(() => {
    // A row that lists the same path twice must not out-rank a row that shares
    // two genuinely distinct files.
    trajectoryDb.insertTrajectory({
      sessionId: 's-duplicate',
      title: 'same file twice',
      tools: [],
      files: ['/app/a.ts', '/app/a.ts'],
      scripts: [],
    });
    trajectoryDb.insertTrajectory({
      sessionId: 's-distinct',
      title: 'two distinct files',
      tools: [],
      files: ['/app/a.ts', '/app/b.ts'],
      scripts: [],
    });

    const results = trajectoryDb.queryByFileOverlap(['/app/a.ts', '/app/b.ts'], 24 * HOUR_MS, 3);

    assert.equal(results[0]?.session_id, 's-distinct', 'two distinct overlaps outrank a duplicated one');
  });
});
