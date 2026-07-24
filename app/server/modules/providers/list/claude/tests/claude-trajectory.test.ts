import assert from 'node:assert/strict';
import test from 'node:test';

import { extractClaudeToolTrajectory } from '@/modules/providers/list/claude/claude-trajectory.js';
import type { LLMProvider, NormalizedMessage } from '@/shared/types.js';

/**
 * Builds a normalized Claude `tool_use` event. Arguments live on `toolInput`
 * (where both the live SDK path and the history parser land Claude's raw tool
 * `input`), so tests populate that field.
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

test('Edit / Write / Read extract file_path into files', () => {
  for (const tool of ['Edit', 'Write', 'Read']) {
    const result = extractClaudeToolTrajectory(makeToolEvent(tool, { file_path: `/repo/${tool}.ts` }));
    assert.equal(result?.tool, tool);
    assert.deepEqual(result?.files, [`/repo/${tool}.ts`]);
    assert.equal(result?.script, undefined);
  }
});

test('Write preserves the exact file_path value (no trimming of the path itself)', () => {
  const result = extractClaudeToolTrajectory(
    makeToolEvent('Write', { file_path: '  /repo/spaced path.ts  ', content: 'x' }),
  );
  assert.deepEqual(result?.files, ['  /repo/spaced path.ts  ']);
});

test('MultiEdit extracts its single file_path (edits array is ignored)', () => {
  const result = extractClaudeToolTrajectory(
    makeToolEvent('MultiEdit', {
      file_path: '/repo/multi.ts',
      edits: [
        { old_string: 'a', new_string: 'b' },
        { old_string: 'c', new_string: 'd' },
      ],
    }),
  );
  assert.equal(result?.tool, 'MultiEdit');
  assert.deepEqual(result?.files, ['/repo/multi.ts']);
});

test('NotebookEdit extracts notebook_path into files', () => {
  const result = extractClaudeToolTrajectory(
    makeToolEvent('NotebookEdit', { notebook_path: '/repo/analysis.ipynb', new_source: 'print(1)' }),
  );
  assert.equal(result?.tool, 'NotebookEdit');
  assert.deepEqual(result?.files, ['/repo/analysis.ipynb']);
});

test('a file_path array yields every non-empty string entry', () => {
  const result = extractClaudeToolTrajectory(
    makeToolEvent('Edit', { file_path: ['/repo/a.ts', '', '   ', '/repo/b.ts', 42] }),
  );
  assert.deepEqual(result?.files, ['/repo/a.ts', '/repo/b.ts']);
});

test('Bash captures command as script with empty files', () => {
  const result = extractClaudeToolTrajectory(makeToolEvent('Bash', { command: 'npm run build' }));
  assert.equal(result?.tool, 'Bash');
  assert.deepEqual(result?.files, []);
  assert.equal(result?.script, 'npm run build');
});

test('Bash with a blank command reports no script', () => {
  const result = extractClaudeToolTrajectory(makeToolEvent('Bash', { command: '   ' }));
  assert.equal(result?.tool, 'Bash');
  assert.deepEqual(result?.files, []);
  assert.equal(result?.script, undefined);
});

test('an unrelated tool reports its name with empty files and no script', () => {
  const result = extractClaudeToolTrajectory(makeToolEvent('Grep', { pattern: 'TODO', path: '/repo' }));
  assert.equal(result?.tool, 'Grep');
  assert.deepEqual(result?.files, []);
  assert.equal(result?.script, undefined);
});

test('an event without a tool name returns null', () => {
  assert.equal(extractClaudeToolTrajectory(makeToolEvent(undefined)), null);
});

test('missing or malformed toolInput does not throw and yields empty files', () => {
  assert.doesNotThrow(() => {
    assert.deepEqual(extractClaudeToolTrajectory(makeToolEvent('Edit'))?.files, []);
    assert.deepEqual(extractClaudeToolTrajectory(makeToolEvent('Write', { file_path: 42 }))?.files, []);
    assert.deepEqual(extractClaudeToolTrajectory(makeToolEvent('Read', 'not-an-object'))?.files, []);
    assert.deepEqual(extractClaudeToolTrajectory(makeToolEvent('Bash', []))?.files, []);
    assert.equal(extractClaudeToolTrajectory({} as NormalizedMessage), null);
    assert.equal(extractClaudeToolTrajectory(undefined as unknown as NormalizedMessage), null);
    assert.equal(extractClaudeToolTrajectory(null as unknown as NormalizedMessage), null);
  });
});
