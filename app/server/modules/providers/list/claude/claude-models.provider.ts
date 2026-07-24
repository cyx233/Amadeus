import { readFile } from 'node:fs/promises';
import os from 'node:os';

import { query } from '@anthropic-ai/claude-agent-sdk';

import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderChangeActiveModelInput,
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
  ProviderSessionActiveModelChange,
} from '@/shared/types.js';
import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import {
  buildDefaultProviderCurrentActiveModel,
  writeProviderSessionActiveModelChange,
} from '@/shared/utils.js';

export const CLAUDE_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'default',
      label: 'Default (recommended)',
      description: 'Use the Claude Code default model (currently Sonnet 4.6)',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'max' },
        ],
      },
    },
    {
      value: 'fable',
      label: 'Fable',
      description: 'Fable 5 · Most capable for your hardest and longest-running tasks · Uses your limits ~2× faster than Opus',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
        ],
      },
    },
    {
      value: "sonnet",
      label: "Sonnet",
      description: "Sonnet 4.6 · Best for everyday tasks · $3/$15 per Mtok",
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'max' },
        ],
      },
    },
    {
      value: 'sonnet[1m]',
      label: 'Sonnet (1M context)',
      description: 'Sonnet 4.6 for long sessions · $3/$15 per Mtok',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'max' },
        ],
      },
    },
    {
      value: 'opus',
      label: 'Opus',
      description: 'Opus 4.8 · Best for everyday, complex tasks · ~2× usage vs Sonnet',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
        ],
      },
    },
    {
      value: 'opus[1m]',
      label: 'Opus 4.8 (1M context)',
      description: 'Opus 4.8 with 1M context · Most capable for complex work · $5/$25 per Mtok',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
        ],
      },
    },
    {
      value: 'haiku',
      label: 'Haiku',
      description: 'Haiku 4.5 · Fastest for quick answers · $1/$5 per Mtok',
    },
  ],
  DEFAULT: 'default',
};

export const findClaudeModelOption = (model: string | undefined | null): ProviderModelOption | null => {
  const normalizedModel = typeof model === 'string' ? model.trim() : '';
  if (!normalizedModel) {
    return null;
  }

  return CLAUDE_FALLBACK_MODELS.OPTIONS.find((option) => option.value === normalizedModel) ?? null;
};
type ClaudeInitEvent = {
  sessionId?: string;
  session_id?: string;
  type?: string;
  subtype?: string;
  model?: string;
  message?: {
    content?: unknown;
    model?: string;
  };
};

const ANSI_PATTERN = new RegExp(
  '[\\u001B\\u009B][[\\]()#;?]*(?:'
  + '(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]'
  + '|(?:[\\dA-PR-TZcf-ntqry=><~]))',
  'g',
);

const extractClaudeEventModel = (event: ClaudeInitEvent, sessionId: string): string | null => {
  const eventSessionId = event.sessionId ?? event.session_id;
  if (eventSessionId && eventSessionId !== sessionId) {
    return null;
  }

  const contentModel = extractClaudeModelFromMessageContent(event.message?.content);
  if (contentModel) {
    return contentModel;
  }

  const isRealModel = (value?: string): value is string =>
    Boolean(value && value !== '<synthetic>');

  const directModel = event.model?.trim();
  if (isRealModel(directModel)) {
    return directModel;
  }

  const messageModel = event.message?.model?.trim();
  return isRealModel(messageModel) ? messageModel : null;
};

const stripAnsi = (value: string): string => value.replace(ANSI_PATTERN, '');

const extractTaggedContent = (content: string, tagName: string): string | null => {
  const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<${escapedTagName}>([\\s\\S]*?)<\\/${escapedTagName}>`).exec(content);
  return match ? match[1] : null;
};

const extractClaudeModelFromTextContent = (content: string): string | null => {
  const localCommandStdout = extractTaggedContent(content, 'local-command-stdout');
  if (localCommandStdout !== null) {
    const cleanedStdout = stripAnsi(localCommandStdout).replace(/\s+/g, ' ').trim();
    const changedModel = /(?:set|changed|switched)\s+model\s+to\s+(.+?)\.?$/i.exec(cleanedStdout);
    if (changedModel?.[1]?.trim()) {
      return changedModel[1].trim();
    }
  }

  const modelTag = extractTaggedContent(content, 'model')?.trim();
  return modelTag || null;
};

const extractClaudeModelFromMessageContent = (content: unknown): string | null => {
  if (typeof content === 'string') {
    return extractClaudeModelFromTextContent(content);
  }

  if (!Array.isArray(content)) {
    return null;
  }

  for (const part of content) {
    if (!part || typeof part !== 'object' || !('text' in part) || typeof part.text !== 'string') {
      continue;
    }

    const model = extractClaudeModelFromTextContent(part.text);
    if (model) {
      return model;
    }
  }

  return null;
};

const readClaudeSessionModelFromJsonl = async (
  sessionId: string,
  jsonlPath: string,
): Promise<ProviderCurrentActiveModel | null> => {
  const content = await readFile(jsonlPath, 'utf8');
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const event = JSON.parse(lines[index]) as ClaudeInitEvent;
      const model = extractClaudeEventModel(event, sessionId);
      if (model) {
        return { model };
      }
    } catch {
      // Skip malformed JSONL lines that can happen during concurrent writes.
    }
  }

  return null;
};

// Map the SDK's ModelInfo[] (from query().supportedModels()) into our catalog.
// The SDK reports exactly the models this auth/provider can use — including the
// account's real Bedrock ids — so this is the single source of truth instead of
// a hard-coded list. `value` is what we pass back as `--model`.
function toModelsDefinition(models: SupportedModelInfo[]): ProviderModelsDefinition {
  const OPTIONS: ProviderModelOption[] = [];
  for (const m of models) {
    const value = typeof m?.value === 'string' ? m.value.trim() : '';
    if (!value) continue;
    const option: ProviderModelOption = {
      value,
      label: m.displayName || value,
      description: m.description || undefined,
    };
    if (m.supportsEffort && Array.isArray(m.supportedEffortLevels) && m.supportedEffortLevels.length > 0) {
      option.effort = { default: 'high', values: m.supportedEffortLevels.map((v) => ({ value: v })) };
    }
    OPTIONS.push(option);

    // The SDK lists Opus only at its 200K context (value 'opus' →
    // us.anthropic.claude-opus-4-8), even though Bedrock accepts the same id
    // with a [1m] suffix for the 1M window (verified: the run reports
    // contextWindow=1000000). It never surfaces that as a pickable option, so
    // synthesize it next to the base entry — otherwise there's no way to select
    // 1M Opus. Only for Bedrock-style full ids that don't already carry [1m].
    const resolved = typeof m?.resolvedModel === 'string' ? m.resolvedModel : '';
    if (
      resolved.startsWith('us.anthropic.claude-opus')
      && !resolved.includes('[1m]')
      && !value.includes('[1m]')
    ) {
      const oneMValue = `${resolved}[1m]`;
      // Guard against dupes: several aliases ('default', 'opus') can resolve to
      // the same opus id, and each would otherwise synthesize the same [1m]
      // option. Only add it if nothing (listed OR already synthesized) has it.
      const alreadyPresent = models.some((other) => other?.value === oneMValue)
        || OPTIONS.some((o) => o.value === oneMValue);
      if (!alreadyPresent) {
        OPTIONS.push({
          value: oneMValue,
          label: 'Opus (1M context)',
          description: '1M token context window',
          effort: option.effort,
        });
      }
    }
  }
  // Prefer the SDK's own default sentinel ('default') when present; else the first option.
  const DEFAULT = OPTIONS.some((o) => o.value === 'default') ? 'default' : (OPTIONS[0]?.value ?? 'default');
  return { OPTIONS, DEFAULT };
}

type SupportedModelInfo = {
  value?: string;
  resolvedModel?: string;
  displayName?: string;
  description?: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: string[];
};

export class ClaudeProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    // Ask the CLI what models this account actually has (via the Agent SDK), so
    // the catalog matches `/model` exactly. Runs a throwaway query() purely to
    // read supportedModels() — it never sends a prompt. On any failure (spawn,
    // auth, older SDK without the method) fall back to the static list so the
    // picker still works.
    let queryInstance: ReturnType<typeof query> | undefined;
    try {
      queryInstance = query({
        prompt: 'models',
        options: {
          cwd: os.tmpdir(),
          settingSources: ['project', 'user', 'local'],
          pathToClaudeCodeExecutable: resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH),
        },
      });
      const supported = (await queryInstance.supportedModels()) as SupportedModelInfo[] | undefined;
      if (Array.isArray(supported) && supported.length > 0) {
        return toModelsDefinition(supported);
      }
    } catch (error) {
      console.warn('[Claude models] supportedModels() failed, using fallback list:', (error as Error)?.message || error);
    } finally {
      try { queryInstance?.close?.(); } catch { /* best-effort */ }
    }
    return CLAUDE_FALLBACK_MODELS;
  }

  async getCurrentActiveModel(sessionId?: string): Promise<ProviderCurrentActiveModel> {
    if (!sessionId?.trim()) {
      return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
    }

    try {
      const transcript = sessionsDb.getSessionTranscript(sessionId);
      const activeModel = transcript
        ? await readClaudeSessionModelFromJsonl(transcript.providerSessionId, transcript.jsonlPath)
        : null;
      if (activeModel?.model) {
        return activeModel;
      }
    } catch {
      // Fall through to the provider default when the session-backed lookup fails.
    }

    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }

  async changeActiveModel(
    input: ProviderChangeActiveModelInput,
  ): Promise<ProviderSessionActiveModelChange> {
    return writeProviderSessionActiveModelChange('claude', input);
  }
}
