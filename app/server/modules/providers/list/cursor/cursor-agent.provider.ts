import {
  abortCursorSession,
  isCursorSessionActive,
  spawnCursor,
} from '@/cursor-cli.js';
import type { IProviderAgent } from '@/shared/interfaces.js';
import type { AnyRecord } from '@/shared/types.js';

/**
 * Wraps cursor-cli.ts's module-level run/abort/isActive functions to satisfy
 * `IProviderAgent`. No state lives on this class — cursor-cli.ts owns its own
 * module-level session map, exactly as it did before this wrapper existed.
 */
export class CursorProviderAgent implements IProviderAgent {
  run(command: string, options: AnyRecord, writer: unknown): Promise<void> {
    return spawnCursor(command, options, writer as Parameters<typeof spawnCursor>[2]);
  }

  abort(providerSessionId: string): boolean {
    return abortCursorSession(providerSessionId);
  }

  isActive(providerSessionId: string): boolean {
    return isCursorSessionActive(providerSessionId);
  }
}
