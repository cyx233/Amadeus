import {
  abortClaudeSDKSession,
  isClaudeSDKSessionActive,
  queryClaudeSDK,
} from '@/claude-sdk.js';
import type { IProviderAgent } from '@/shared/interfaces.js';
import type { AnyRecord } from '@/shared/types.js';

/**
 * Wraps claude-sdk.ts's module-level run/abort/isActive functions to satisfy
 * `IProviderAgent`. No state lives on this class — claude-sdk.ts owns its own
 * module-level session map, exactly as it did before this wrapper existed.
 */
export class ClaudeProviderAgent implements IProviderAgent {
  run(command: string, options: AnyRecord, writer: unknown): Promise<void> {
    return queryClaudeSDK(command, options, writer as Parameters<typeof queryClaudeSDK>[2]);
  }

  abort(providerSessionId: string): Promise<boolean> {
    return abortClaudeSDKSession(providerSessionId);
  }

  isActive(providerSessionId: string): boolean {
    return isClaudeSDKSessionActive(providerSessionId);
  }
}
