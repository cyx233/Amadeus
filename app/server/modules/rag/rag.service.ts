/**
 * RAG (retrieval-augmented generation) service.
 *
 * The single server-side entry point for talking to LightRAG. Used two ways:
 *  - deterministic pre-retrieval: the chat handler prepends retrieved context to
 *    the user message before the agent runs (see chat-websocket.service), so the
 *    agent can't skip it — this is the "hard" RAG the soft skills couldn't give.
 *  - the optional `rag_search` MCP tool (claude only) for agent-driven deep dives.
 *
 * Retrieval is best-effort: any failure (LightRAG down, timeout, empty KB) returns
 * null and the caller proceeds without context. It must never block or break chat.
 */

import { appConfigDb } from '@/modules/database/index.js';

const RAG_SETTINGS_KEY = 'rag_settings';
const DEFAULT_TIMEOUT_MS = 4000;

// LightRAG is a shared container; backends reach it at this compose hostname
// (dev overrides via LIGHTRAG_URL=http://localhost:9621, host networking).
const LIGHTRAG_URL = process.env.LIGHTRAG_URL || 'http://lightrag:9621';

type RagSettings = {
  /** Master kill switch. Default on; a deployment can disable RAG entirely. */
  enabled: boolean;
};

const DEFAULT_SETTINGS: RagSettings = { enabled: true };

/** Reads the global RAG settings (mirrors browser-use readSettings). */
export function getRagSettings(): RagSettings {
  try {
    const raw = appConfigDb.get(RAG_SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<RagSettings>;
    // Absent key defaults to enabled (on unless explicitly turned off).
    return { enabled: parsed.enabled !== false };
  } catch (error: any) {
    console.warn('[RAG] Failed to read settings:', error?.message || error);
    return DEFAULT_SETTINGS;
  }
}

/** True when RAG is globally enabled for this deployment. */
export function isRagGloballyEnabled(): boolean {
  return getRagSettings().enabled;
}

/** Persists the global RAG on/off switch. */
export function setRagGloballyEnabled(enabled: boolean): RagSettings {
  const normalized: RagSettings = { enabled: enabled === true };
  appConfigDb.set(RAG_SETTINGS_KEY, JSON.stringify(normalized));
  return normalized;
}

/**
 * Retrieves workspace context for a query from LightRAG. Returns the retrieved
 * text, or null on any failure / empty result (never throws — graceful
 * degradation so chat is never blocked by a RAG outage).
 *
 * Prefers `only_need_context: true` (raw retrieved chunks, skips LightRAG's own
 * internal LLM synthesis — faster/cheaper, and the agent's model can synthesize
 * itself). Falls back to `.response` when a deployment ignores that flag.
 */
export async function retrieveContext(
  query: string,
  options: { timeoutMs?: number } = {}
): Promise<string | null> {
  const trimmed = (query || '').trim();
  if (!trimmed) return null;

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${LIGHTRAG_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: trimmed, mode: 'hybrid', only_need_context: true }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { response?: unknown; context?: unknown };
    // LightRAG returns the answer/context under `.response`; some builds echo a
    // separate `.context`. Take whichever is a non-empty string.
    const text =
      (typeof data.response === 'string' && data.response) ||
      (typeof data.context === 'string' && data.context) ||
      '';
    const cleaned = text.trim();
    // LightRAG answers "no relevant context"-style misses with boilerplate; a
    // short/empty body isn't worth injecting.
    return cleaned.length > 0 ? cleaned : null;
  } catch {
    // Timeout (AbortError) or network error — degrade silently.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Wraps retrieved context in a tagged block for prompt injection. The preamble
 * tells the agent this is background it may use or ignore, so a stale/irrelevant
 * hit doesn't derail the turn.
 */
export function wrapKnowledge(context: string): string {
  return [
    '<workspace_knowledge>',
    'The following was retrieved from this workspace\'s knowledge base. Use it if',
    'relevant to the request; ignore it if not.',
    '',
    context,
    '</workspace_knowledge>',
  ].join('\n');
}
