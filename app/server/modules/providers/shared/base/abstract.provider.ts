import type {
  IProvider,
  IProviderAgent,
  IProviderAuth,
  IProviderMcp,
  IProviderModels,
  IProviderSessionSynchronizer,
  IProviderSkills,
  IProviderSessions,
} from '@/shared/interfaces.js';
import type { LLMProvider } from '@/shared/types.js';

/**
 * Shared provider base.
 *
 * Concrete providers must expose auth/MCP handlers and implement message
 * normalization/history loading because those behaviors depend on native
 * SDK/CLI formats.
 */
export abstract class AbstractProvider implements IProvider {
  readonly id: LLMProvider;
  abstract readonly models: IProviderModels;
  abstract readonly mcp: IProviderMcp;
  abstract readonly auth: IProviderAuth;
  abstract readonly skills: IProviderSkills;
  abstract readonly sessions: IProviderSessions;
  abstract readonly sessionSynchronizer: IProviderSessionSynchronizer;
  abstract readonly agent: IProviderAgent;

  protected constructor(id: LLMProvider) {
    this.id = id;
  }
}
