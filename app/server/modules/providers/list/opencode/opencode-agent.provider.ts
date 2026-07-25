import {
  abortOpenCodeSession,
  isOpenCodeSessionActive,
  spawnOpenCode,
} from '@/opencode-cli.js';
import type { IProviderAgent } from '@/shared/interfaces.js';
import type { AnyRecord } from '@/shared/types.js';

/**
 * Wraps opencode-cli.ts's module-level run/abort/isActive functions to
 * satisfy `IProviderAgent`. No state lives on this class — opencode-cli.ts
 * owns its own module-level session map, exactly as it did before this
 * wrapper existed.
 */
export class OpenCodeProviderAgent implements IProviderAgent {
  run(command: string, options: AnyRecord, writer: unknown): Promise<void> {
    return spawnOpenCode(command, options, writer as Parameters<typeof spawnOpenCode>[2]);
  }

  abort(providerSessionId: string): boolean {
    return abortOpenCodeSession(providerSessionId);
  }

  isActive(providerSessionId: string): boolean {
    return isOpenCodeSessionActive(providerSessionId);
  }
}
