/**
 * Slash-command API contracts — shared between the backend command routes
 * (server/routes/commands.ts, which produce them) and the chat composer hooks
 * (which consume them). Keeping the shapes here lets the compiler enforce that
 * both sides agree, instead of the two hand-maintaining parallel copies that
 * drift apart (the frontend used to `as SlashCommand[]` the /list response and
 * redeclare each *CommandData).
 *
 * Self-contained by design: like git-types, this file imports nothing, so both
 * the frontend (src/) and backend (server/) can consume it without either
 * side's type tree leaking across the boundary. Provider ids are plain strings
 * here; each layer narrows to its own LLMProvider union at the edges.
 */

/** One command surfaced by GET/POST /list (built-in or custom .md file). */
export type SlashCommandInfo = {
  name: string;
  description: string;
  namespace: string;
  /** Absolute path of the backing .md file; absent for built-ins. */
  path?: string;
  relativePath?: string;
  metadata: Record<string, unknown>;
};

/** POST /api/commands/list response. */
export type CommandListResponse = {
  builtIn: SlashCommandInfo[];
  custom: SlashCommandInfo[];
  count: number;
};

// --- POST /api/commands/execute : discriminated union on type/action ---------

export type ModelCommandData = {
  current?: {
    provider?: string;
    providerLabel?: string;
    model?: string;
  };
  available?: Record<string, string[]>;
  availableModels?: string[];
  availableOptions?: Array<{
    value: string;
    label?: string;
    description?: string;
  }>;
  defaultModel?: string;
  cache?: { updatedAt: string; expiresAt: string; source: 'memory' | 'disk' | 'fresh' };
  message?: string;
};

export type CostCommandData = {
  tokenUsage?: { used?: number; total?: number };
  tokenBreakdown?: { input?: number; output?: number };
  provider?: string;
  model?: string;
};

export type StatusCommandData = {
  version?: string;
  packageName?: string;
  uptime?: string;
  uptimeSeconds?: number;
  model?: string;
  provider?: string;
  nodeVersion?: string;
  platform?: string;
  pid?: number;
  memoryUsage?: {
    rssMb?: number;
    heapUsedMb?: number;
    heapTotalMb?: number;
  };
};

export type HelpCommandData = {
  content?: string;
  format?: string;
  commands?: Array<{
    name: string;
    description?: string;
    namespace?: string;
  }>;
};

export type MemoryCommandData = {
  path?: string;
  exists?: boolean;
  error?: string;
  message?: string;
};

export type ConfigCommandData = {
  message?: string;
};

/** A built-in command result: `type: 'builtin'` + an action-tagged data blob. */
export type BuiltinCommandResult =
  | { type: 'builtin'; action: 'models'; data: ModelCommandData }
  | { type: 'builtin'; action: 'cost'; data: CostCommandData }
  | { type: 'builtin'; action: 'status'; data: StatusCommandData }
  | { type: 'builtin'; action: 'help'; data: HelpCommandData }
  | { type: 'builtin'; action: 'memory'; data: MemoryCommandData }
  | { type: 'builtin'; action: 'config'; data: ConfigCommandData };

/** A custom (.md) command result: the processed file content + parse flags. */
export type CustomCommandResult = {
  type: 'custom';
  content: string;
  metadata: Record<string, unknown>;
  hasFileIncludes: boolean;
  hasBashCommands: boolean;
};

/**
 * POST /api/commands/execute response. The `command` field (echoed command
 * name) is attached by the route on top of the handler's own result.
 */
export type CommandExecuteResponse = (BuiltinCommandResult | CustomCommandResult) & {
  command?: string;
};
