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

import { generateTextOnce } from '../../../claude-sdk.js';
import { spawnCursor } from '../../../cursor-cli.js';
import { queryCodex } from '../../../openai-codex.js';
import { spawnOpenCode } from '../../../opencode-cli.js';

import { resolveModel } from './model-preference.service.js';

const DEFAULT_TIMEOUT_MS = 60_000;

// A one-shot just concatenates whatever assistant text a streaming provider
// emits. Text lands in different fields across providers (stream_delta.content,
// cursor-output, assistant blocks, plain text), so grab the common ones.
function collectText(data, append) {
  const parsed = typeof data === 'string'
    ? (() => { try { return JSON.parse(data); } catch { return null; } })()
    : data;
  if (!parsed || typeof parsed !== 'object') return;
  for (const field of ['output', 'text', 'content', 'delta']) {
    if (typeof parsed[field] === 'string' && parsed[field]) append(parsed[field]);
  }
  const msgContent = parsed.message?.content;
  if (Array.isArray(msgContent)) {
    for (const block of msgContent) {
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
export async function generateOnce({ userId, feature, prompt, cwd, provider: providerPin, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const { provider, model } = await resolveModel(userId, feature, { provider: providerPin });
  const modelArg = model ?? undefined; // null = use the provider's own default

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);

  try {
    let text = '';
    if (provider === 'claude') {
      // claude uniquely has an SDK one-shot mode that leaves no session record.
      text = await generateTextOnce(prompt, { cwd, model: modelArg, signal: abort.signal });
    } else {
      // External CLIs: stream to a writer and collect. Each always creates its
      // own session (no in-memory mode), which is unavoidable for these tools.
      const writer = { send: (d) => collectText(d, (t) => { text += t; }), setSessionId: () => {} };
      const opts = { cwd, model: modelArg, skipPermissions: true, permissionMode: 'bypassPermissions' };
      const runner = provider === 'cursor' ? spawnCursor
        : provider === 'codex' ? queryCodex
        : provider === 'opencode' ? spawnOpenCode
        : null;
      if (!runner) throw new Error(`Unsupported provider for one-shot generation: ${provider}`);
      const timeout = new Promise((_, reject) => {
        abort.signal.addEventListener('abort', () => reject(new Error(`${feature} generation timed out`)));
      });
      await Promise.race([runner(prompt, opts, writer), timeout]);
    }
    return { text, provider, model };
  } finally {
    clearTimeout(timer);
  }
}
