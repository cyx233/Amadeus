/**
 * Model-preferences repository — a per-user key/value store backing Amadeus's
 * model-id-agnostic resolution. Two orthogonal axes, each with a global fallback
 * and optional per-feature override:
 *   global:provider            -> default provider for every feature
 *   provider:<name>:model      -> default model for that provider
 *   feature:<name>:provider    -> a feature's provider override
 *   feature:<name>:model       -> a feature's model override
 * The repo is pure KV; resolution logic lives in the model-preference service
 * (it needs the provider catalogs for the final DEFAULT fallback).
 */

import { getConnection } from '@/modules/database/connection.js';

type PrefRow = {
  pref_key: string;
  pref_value: string;
};

export const modelPreferencesDb = {
  get(userId: number, key: string): string | undefined {
    const db = getConnection();
    const row = db
      .prepare('SELECT pref_value FROM model_preferences WHERE user_id = ? AND pref_key = ?')
      .get(userId, key) as { pref_value: string } | undefined;
    return row?.pref_value;
  },

  getAll(userId: number): Record<string, string> {
    const db = getConnection();
    const rows = db
      .prepare('SELECT pref_key, pref_value FROM model_preferences WHERE user_id = ?')
      .all(userId) as PrefRow[];
    return Object.fromEntries(rows.map((r) => [r.pref_key, r.pref_value]));
  },

  set(userId: number, key: string, value: string): void {
    const db = getConnection();
    db.prepare(
      `INSERT INTO model_preferences (user_id, pref_key, pref_value, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, pref_key) DO UPDATE SET pref_value = excluded.pref_value, updated_at = CURRENT_TIMESTAMP`
    ).run(userId, key, value);
  },

  /** Clear an override (revert to fallback). */
  unset(userId: number, key: string): void {
    const db = getConnection();
    db.prepare('DELETE FROM model_preferences WHERE user_id = ? AND pref_key = ?').run(userId, key);
  },
};
