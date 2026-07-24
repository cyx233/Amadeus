import type { ExtractedToolMetadata, NormalizedMessage } from '@/shared/types.js';

/**
 * Shared trajectory-extraction helpers for provider session shims.
 *
 * `extractToolTrajectory` lives on `IProviderSessions` because decoding a
 * provider's native tool-input shape is the shim's job. Providers that haven't
 * taught the shim their file-path shape yet delegate to
 * `toolNameOnlyTrajectory`, which still records the tool name so a captured turn
 * lists which tools ran — recall just won't match on files (overlap score 0)
 * rather than erroring. This keeps the phased rollout's "degrade gracefully"
 * guarantee type-enforced: every provider must return something, and the cheap
 * default is one call away.
 */

/**
 * The graceful-degradation default: report the tool name with no files or
 * script. Returns `null` for events without a tool name (nothing to record) and
 * never throws on missing or malformed input.
 */
export function toolNameOnlyTrajectory(event: NormalizedMessage): ExtractedToolMetadata | null {
  const tool = event?.toolName;
  if (!tool) {
    return null;
  }

  return { tool, files: [] };
}

/**
 * Pulls file paths from a normalized tool-input field.
 *
 * Accepts a single string or an array of strings — the latter guards against
 * variant/batched shapes even though today's file tools emit one path per call.
 * The original path value is preserved; `trim()` only decides whether a
 * candidate is non-empty.
 */
export function collectToolPaths(value: unknown): string[] {
  if (typeof value === 'string') {
    return value.trim() ? [value] : [];
  }
  if (Array.isArray(value)) {
    return value.filter(
      (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
    );
  }
  return [];
}
