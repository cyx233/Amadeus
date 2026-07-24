import { collectToolPaths } from '@/modules/providers/shared/trajectory/tool-trajectory.js';
import type { ExtractedToolMetadata, NormalizedMessage } from '@/shared/types.js';
import { readObjectRecord } from '@/shared/utils.js';

/**
 * Claude-specific trajectory decoding.
 *
 * Kept as a pure function beside the other per-capability Claude modules
 * (`claude-auth`, `claude-models`, …) rather than inlined into the sessions
 * provider: the provider class stays a thin shim that just wires this into the
 * `IProviderSessions` contract, and the decoding logic is independently
 * testable (and trivially relocatable) without constructing a provider.
 */

/** Claude tools whose normalized input names the touched file under `file_path`. */
const FILE_PATH_TOOLS = new Set(['Edit', 'Write', 'Read', 'MultiEdit']);

/** Claude tools that name their file under `notebook_path` instead. */
const NOTEBOOK_PATH_TOOLS = new Set(['NotebookEdit']);

/** Claude tool that runs a shell command captured as the turn's script. */
const COMMAND_TOOL = 'Bash';

/**
 * Decodes trajectory metadata from a normalized Claude `tool_use` event.
 *
 * Claude's tool arguments land on `toolInput` (both the live SDK path and the
 * history parser map the raw `input` block there). File-operating tools name
 * their target under `file_path` (`NotebookEdit` uses `notebook_path`), and
 * `Bash` carries the command under `command`. Any other tool degrades to its
 * name with no files.
 *
 * Returns `null` for events without a tool name (nothing to record) and never
 * throws on missing or malformed input — unknown shapes yield empty `files`.
 */
export function extractClaudeToolTrajectory(event: NormalizedMessage): ExtractedToolMetadata | null {
  const tool = event?.toolName;
  if (!tool) {
    return null;
  }

  const input = readObjectRecord(event.toolInput);
  const files: string[] = [];
  let script: string | undefined;

  if (input) {
    if (FILE_PATH_TOOLS.has(tool)) {
      files.push(...collectToolPaths(input.file_path));
    } else if (NOTEBOOK_PATH_TOOLS.has(tool)) {
      files.push(...collectToolPaths(input.notebook_path));
    } else if (tool === COMMAND_TOOL && typeof input.command === 'string' && input.command.trim()) {
      script = input.command;
    }
  }

  const result: ExtractedToolMetadata = { tool, files };
  if (script !== undefined) {
    result.script = script;
  }
  return result;
}
