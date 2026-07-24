/**
 * Provider-agnostic one-shot text generation.
 *
 * The single entry point for features that need "prompt in → text out" (e.g.
 * commit messages) without caring which agent/model runs it. Callers pass their
 * feature name; this layer owns everything provider-specific:
 *   - resolve { provider, model } from Model Preference (resolveModel)
 *   - dispatch to that provider's query implementation
 *   - collect the assistant text from its stream
 *   - bound it with a timeout
 * Nothing above this leaks provider knowledge (no "if provider === 'claude'").
 */

import { getProviderRunner } from './provider-runtime.service.js';
import { resolveModel } from './model-preference.service.js';

const DEFAULT_TIMEOUT_MS = 60_000;

// A one-shot just concatenates whatever assistant text a streaming provider
// emits. Text lands in different fields across providers (stream_delta.content,
// cursor-output, assistant blocks, plain text), so grab the common ones.
function collectText(data: unknown, append: (text: string) => void): void {
  const parsedValue = typeof data === 'string'
    ? (() => { try { return JSON.parse(data); } catch { return null; } })()
    : data;
  if (!parsedValue || typeof parsedValue !== 'object') return;
  const parsed = parsedValue as Record<string, unknown>;
  for (const field of ['output', 'text', 'content', 'delta']) {
    const value = parsed[field];
    if (typeof value === 'string' && value) append(value);
  }
  const message = parsed.message as { content?: unknown } | undefined;
  const msgContent = message?.content;
  if (Array.isArray(msgContent)) {
    for (const block of msgContent as Array<{ type?: string; text?: unknown }>) {
      if (block?.type === 'text' && typeof block.text === 'string') append(block.text);
    }
  }
}

/**
 * Generate text once for a feature, provider- and model-agnostically.
 * @param {object} args
 * @param {number} args.userId
 * @param {string} args.feature       e.g. 'commit-message'
 * @param {string} args.prompt
 * @param {string} [args.cwd]
 * @param {string} [args.provider]    explicit provider pin (else from prefs)
 * @param {number} [args.timeoutMs]
 * @returns {Promise<{ text: string, provider: string, model: string|null }>}
 *   text is '' on failure/timeout — callers decide the fallback.
 */
export async function generateOnce({
  userId,
  feature,
  prompt,
  cwd,
  provider: providerPin,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: {
  userId: number;
  feature: string;
  prompt: string;
  cwd?: string;
  provider?: string;
  timeoutMs?: number;
}): Promise<{ text: string; provider: string; model: string | null }> {
  const { provider, model } = await resolveModel(userId, feature, { provider: providerPin });
  const modelArg = model ?? undefined; // null = use the provider's own default

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);

  try {
    // All providers run through the shared streaming runner — no per-provider
    // special-casing. Each creates its own session (a short-lived "git message"
    // session shows up like any other); we accept that for symmetry rather than
    // maintaining a claude-only in-memory path plus per-CLI isolation.
    const runner = getProviderRunner(provider);
    if (!runner) throw new Error(`Unsupported provider for one-shot generation: ${provider}`);
    let text = '';
    const writer = { send: (d: unknown) => collectText(d, (t: string) => { text += t; }), setSessionId: () => {} };
    const opts = { cwd, model: modelArg, skipPermissions: true, permissionMode: 'bypassPermissions' };
    const timeout = new Promise((_, reject) => {
      abort.signal.addEventListener('abort', () => reject(new Error(`${feature} generation timed out`)));
    });
    await Promise.race([runner(prompt, opts, writer), timeout]);
    return { text, provider, model };
  } finally {
    clearTimeout(timer);
  }
}
