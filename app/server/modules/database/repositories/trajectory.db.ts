/**
 * Trajectory ("working memory") repository.
 *
 * Persists one lightweight row per agent turn — title, tool names, files
 * touched, scripts run (metadata only, never content) — and recalls
 * task-relevant past turns by file overlap within a recency window.
 *
 * Cross-user isolation is structural, not query-based: every method goes
 * through `getConnection()`, which is the per-user container's own SQLite
 * connection. There is no `user_id` column and no shared table, so a query can
 * never reach another user's rows by construction. That is why these methods
 * take no `db` argument — callers cannot accidentally hand in a shared DB.
 *
 * `tools`/`files`/`scripts` are stored as JSON-encoded TEXT (SQLite has no
 * array type); this module is the single (de)serialization boundary, so callers
 * only ever see `string[]`.
 */

import { getConnection } from '@/modules/database/connection.js';
import type { TrajectoryRow } from '@/shared/types.js';

/**
 * The domain shape a caller supplies to record one turn. `title` may be empty
 * when the provider offers nothing to name the turn; the array fields are
 * whatever the capture seam accumulated (possibly empty for providers without a
 * wired file extractor — recall degrades gracefully rather than failing).
 */
export interface TrajectoryInsert {
  sessionId: string;
  title: string;
  tools: string[];
  files: string[];
  scripts: string[];
}

/** Raw SQLite row shape before JSON columns are parsed into `string[]`. */
type TrajectoryDbRow = {
  id: number;
  session_id: string;
  title: string | null;
  tools: string | null;
  files: string | null;
  scripts: string | null;
  created_at: string;
};

/**
 * Parses a JSON-array TEXT column into a `string[]`, tolerating NULL, malformed
 * JSON, and non-array/non-string contents. Capture must never break a turn, so
 * a corrupt row degrades to `[]` instead of throwing at the read boundary.
 */
function parseStringArray(value: string | null): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : [];
  } catch {
    return [];
  }
}

/** Hydrates a raw SQLite row into the parsed `TrajectoryRow` domain shape. */
function hydrateRow(row: TrajectoryDbRow): TrajectoryRow {
  return {
    id: row.id,
    session_id: row.session_id,
    title: row.title,
    tools: parseStringArray(row.tools),
    files: parseStringArray(row.files),
    scripts: parseStringArray(row.scripts),
    created_at: row.created_at,
  };
}

export const trajectoryDb = {
  /**
   * Records one turn. `tools`/`files`/`scripts` are JSON-serialized here so the
   * rest of the app only ever deals in `string[]`. `created_at` is left to the
   * column default (`datetime('now')`, UTC) so every row is timestamped by the
   * same clock the recency query reads from.
   */
  insertTrajectory(row: TrajectoryInsert): void {
    const db = getConnection();
    db.prepare(
      `INSERT INTO trajectory (session_id, title, tools, files, scripts)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      row.sessionId,
      row.title,
      JSON.stringify(row.tools ?? []),
      JSON.stringify(row.files ?? []),
      JSON.stringify(row.scripts ?? [])
    );
  },

  /**
   * Recalls related past turns, ranked by how many of `currentFiles` they
   * touched, restricted to the recency window, capped at `topK`.
   *
   * Scoring runs in TypeScript rather than SQL: the recency window already
   * bounds the candidate rows (and trajectory rows are tiny), so fetching the
   * window and computing the intersection in app code is simpler and needs no
   * JSON1 extension. The recency filter stays in SQL against the bare
   * `created_at` column so the `idx_trajectory_created_at` index is usable.
   * Overlap counts *distinct* shared files, so a row that lists the same path
   * twice cannot inflate its own rank.
   *
   * Returns `[]` (never throws) for empty `currentFiles`, non-positive `topK`,
   * or when no windowed row shares a file — a no-match is a normal result.
   *
   * @param currentFiles   Files the current task touches; the overlap target.
   * @param recencyWindowMs How far back to consider rows, in milliseconds.
   * @param topK           Maximum rows to return, best-overlap first.
   */
  queryByFileOverlap(
    currentFiles: string[],
    recencyWindowMs: number,
    topK: number
  ): TrajectoryRow[] {
    if (!currentFiles || currentFiles.length === 0 || topK <= 0) {
      return [];
    }

    const db = getConnection();

    // Compute the cutoff relative to SQLite's own clock (the same clock that
    // stamps created_at) to avoid JS/SQLite timezone or skew mismatches. The
    // modifier is a bound parameter, so the computed number cannot inject SQL.
    const windowSeconds = Math.max(0, Math.ceil(recencyWindowMs / 1000));
    const cutoffModifier = `-${windowSeconds} seconds`;

    const rows = db
      .prepare(
        `SELECT id, session_id, title, tools, files, scripts, created_at
         FROM trajectory
         WHERE created_at >= datetime('now', ?)
         ORDER BY created_at DESC`
      )
      .all(cutoffModifier) as TrajectoryDbRow[];

    const currentSet = new Set(currentFiles);

    const scored = rows
      .map((row) => {
        const hydrated = hydrateRow(row);
        let overlap = 0;
        for (const file of new Set(hydrated.files)) {
          if (currentSet.has(file)) {
            overlap += 1;
          }
        }
        return { hydrated, overlap };
      })
      .filter((entry) => entry.overlap > 0);

    // Rank by overlap desc, breaking ties by recency desc. created_at is a
    // sortable UTC 'YYYY-MM-DD HH:MM:SS' string, so lexical compare == chrono.
    scored.sort((a, b) => {
      if (b.overlap !== a.overlap) {
        return b.overlap - a.overlap;
      }
      if (a.hydrated.created_at === b.hydrated.created_at) {
        return 0;
      }
      return a.hydrated.created_at < b.hydrated.created_at ? 1 : -1;
    });

    return scored.slice(0, topK).map((entry) => entry.hydrated);
  },
};
