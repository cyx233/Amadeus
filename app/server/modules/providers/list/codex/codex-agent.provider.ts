import {
  abortCodexSession,
  isCodexSessionActive,
  queryCodex,
} from '@/openai-codex.js';
import type { IProviderAgent } from '@/shared/interfaces.js';
import type { AnyRecord } from '@/shared/types.js';

/**
 * Wraps openai-codex.ts's module-level run/abort/isActive functions to
 * satisfy `IProviderAgent`. No state lives on this class — openai-codex.ts
 * owns its own module-level session map, exactly as it did before this
 * wrapper existed.
 */
export class CodexProviderAgent implements IProviderAgent {
  run(command: string, options: AnyRecord, writer: unknown): Promise<void> {
    return queryCodex(command, options, writer as Parameters<typeof queryCodex>[2]);
  }

  abort(providerSessionId: string): boolean {
    return abortCodexSession(providerSessionId);
  }

  isActive(providerSessionId: string): boolean {
    return isCodexSessionActive(providerSessionId);
  }
}
