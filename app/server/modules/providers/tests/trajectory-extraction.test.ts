import assert from 'node:assert/strict';
import test from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { CodexSessionsProvider } from '@/modules/providers/list/codex/codex-sessions.provider.js';
import { CursorSessionsProvider } from '@/modules/providers/list/cursor/cursor-sessions.provider.js';
import { OpenCodeSessionsProvider } from '@/modules/providers/list/opencode/opencode-sessions.provider.js';
import type { IProviderSessions } from '@/shared/interfaces.js';
import type { LLMProvider, NormalizedMessage } from '@/shared/types.js';

/**
 * Contract-level checks for `IProviderSessions.extractToolTrajectory`: that each
 * provider shim wires extraction correctly. Claude's exhaustive decoding cases
 * live in `list/claude/tests/claude-trajectory.test.ts` (the pure function this
 * shim delegates to); here we only assert the wiring and the graceful-
 * degradation contract shared by the not-yet-decoded providers.
 */
function makeToolEvent(
  toolName: string | undefined,
  toolInput?: unknown,
  provider: LLMProvider = 'claude',
): NormalizedMessage {
  return {
    id: 'msg-1',
    sessionId: 'session-1',
    timestamp: '2026-07-24T00:00:00.000Z',
    provider,
    kind: 'tool_use',
    toolName,
    toolInput,
  };
}

test('Claude shim delegates to real decoding (surfaces file paths)', () => {
  const result = new ClaudeSessionsProvider().extractToolTrajectory(
    makeToolEvent('Edit', { file_path: '/repo/x.ts' }),
  );
  assert.equal(result?.tool, 'Edit');
  assert.deepEqual(result?.files, ['/repo/x.ts']);
});

// ---------------------------------------------------------------------------
// Codex / Cursor / OpenCode — graceful degradation (tool name only)
// ---------------------------------------------------------------------------

const degradingProviders: Array<{ provider: LLMProvider; sessions: IProviderSessions }> = [
  { provider: 'codex', sessions: new CodexSessionsProvider() },
  { provider: 'cursor', sessions: new CursorSessionsProvider() },
  { provider: 'opencode', sessions: new OpenCodeSessionsProvider() },
];

for (const { provider, sessions } of degradingProviders) {
  test(`${provider}: records the tool name only, with empty files and no script`, () => {
    // Even with a file_path present, providers without a wired decoder must not
    // surface files — recall degrades gracefully rather than guessing.
    const result = sessions.extractToolTrajectory(
      makeToolEvent('Edit', { file_path: '/repo/x.ts' }, provider),
    );
    assert.equal(result?.tool, 'Edit');
    assert.deepEqual(result?.files, []);
    assert.equal(result?.script, undefined);
  });

  test(`${provider}: returns null for events without a tool name and never throws`, () => {
    assert.doesNotThrow(() => {
      assert.equal(sessions.extractToolTrajectory(makeToolEvent(undefined, undefined, provider)), null);
      assert.equal(sessions.extractToolTrajectory({} as NormalizedMessage), null);
      assert.equal(sessions.extractToolTrajectory(null as unknown as NormalizedMessage), null);
    });
  });
}
