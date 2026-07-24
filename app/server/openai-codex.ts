/**
 * OpenAI Codex SDK Integration
 * =============================
 *
 * This module provides integration with the OpenAI Codex SDK for non-interactive
 * chat sessions. It mirrors the pattern used in claude-sdk.js for consistency.
 *
 * ## Usage
 *
 * - queryCodex(command, options, ws) - Execute a prompt with streaming via WebSocket
 * - abortCodexSession(sessionId) - Cancel an active session
 * - isCodexSessionActive(sessionId) - Check if a session is running
 */

import type { ApprovalMode, SandboxMode, Thread, ThreadEvent } from '@openai/codex-sdk';
import { Codex } from '@openai/codex-sdk';

import { buildCodexInputItems, normalizeImageDescriptors } from './shared/image-attachments.js';
import { notifyRunFailed, notifyRunStopped } from './services/notification-orchestrator.js';
import { sessionsService } from './modules/providers/services/sessions.service.js';
import { providerAuthService } from './modules/providers/services/provider-auth.service.js';
import { providerModelsService } from './modules/providers/services/provider-models.service.js';
import { createCompleteMessage, createNormalizedMessage } from './shared/utils.js';

/**
 * The writer a provider runtime sends normalized messages through. Both
 * shapes it may take (`ChatSessionWriter` for websocket chat, and a
 * possible SSE stream writer — checked for but no longer wired up since the
 * headless /api/agent route it served was removed) are covered as a loose
 * union; `sendMessage` feature-detects between them at the call site.
 */
type CodexWriter = {
  send: (data: unknown) => void;
  setSessionId?: (sessionId: string) => void;
  userId?: number | string | null;
  isSSEStreamWriter?: boolean;
  isWebSocketWriter?: boolean;
};

type SpawnCodexOptions = {
  sessionId?: string | null;
  sessionSummary?: string;
  cwd?: string;
  projectPath?: string;
  model?: string;
  effort?: string;
  images?: unknown;
  permissionMode?: string;
};

type ActiveCodexSession = {
  thread: Thread;
  codex: Codex;
  status: 'running' | 'aborted' | 'completed';
  abortController: AbortController;
  startedAt: string;
};

const activeCodexSessions = new Map<string, ActiveCodexSession>();

function readUsageNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Reads token usage off a `turn.completed` event. The SDK's own `Usage` type
 * only declares input/output/reasoning token counts, but real payloads carry
 * extra undocumented fields (`info`, `model_context_window`,
 * `total_token_usage`) this reaches for — so `event` stays loosely typed
 * here rather than pinned to the SDK's `TurnCompletedEvent`.
 */
function extractCodexTokenBudget(event: unknown) {
  const e = event as Record<string, any> | null | undefined;
  const info = e?.info || e?.payload?.info || e?.usage?.info;
  const usage = info?.total_token_usage || e?.usage?.total_token_usage || e?.usage;
  if (!usage || typeof usage !== 'object') {
    return null;
  }

  const inputTokens = readUsageNumber(usage.input_tokens);
  const outputTokens = readUsageNumber(usage.output_tokens);
  const used = readUsageNumber(usage.total_tokens) || inputTokens + outputTokens;

  return {
    used,
    total: readUsageNumber(info?.model_context_window || e?.usage?.model_context_window) || 200000,
    inputTokens,
    outputTokens,
    breakdown: {
      input: inputTokens,
      output: outputTokens,
    },
  };
}

/** Transform a Codex SDK thread event into this module's WebSocket message shape. */
function transformCodexEvent(event: ThreadEvent): Record<string, unknown> {
  // Map SDK event types to a consistent format
  switch (event.type) {
    case 'item.started':
    case 'item.updated':
    case 'item.completed':
      const item = event.item;
      if (!item) {
        return { type: event.type, item: null };
      }

      // Transform based on item type
      switch (item.type) {
        case 'agent_message':
          return {
            type: 'item',
            itemType: 'agent_message',
            message: {
              role: 'assistant',
              content: item.text
            }
          };

        case 'reasoning':
          return {
            type: 'item',
            itemType: 'reasoning',
            message: {
              role: 'assistant',
              content: item.text,
              isReasoning: true
            }
          };

        case 'command_execution':
          return {
            type: 'item',
            itemType: 'command_execution',
            command: item.command,
            output: item.aggregated_output,
            exitCode: item.exit_code,
            status: item.status
          };

        case 'file_change':
          return {
            type: 'item',
            itemType: 'file_change',
            changes: item.changes,
            status: item.status
          };

        case 'mcp_tool_call':
          return {
            type: 'item',
            itemType: 'mcp_tool_call',
            server: item.server,
            tool: item.tool,
            arguments: item.arguments,
            result: item.result,
            error: item.error,
            status: item.status
          };

        case 'web_search':
          return {
            type: 'item',
            itemType: 'web_search',
            query: item.query
          };

        case 'todo_list':
          return {
            type: 'item',
            itemType: 'todo_list',
            items: item.items
          };

        case 'error':
          return {
            type: 'item',
            itemType: 'error',
            message: {
              role: 'error',
              content: item.message
            }
          };

        default: {
          // Defensive fallback for any future item type the SDK adds —
          // unreachable against the current ThreadItem union.
          const unknownItem = item as { type: string };
          return {
            type: 'item',
            itemType: unknownItem.type,
            item: unknownItem
          };
        }
      }

    case 'turn.started':
      return {
        type: 'turn_started'
      };

    case 'turn.completed':
      return {
        type: 'turn_complete',
        usage: event.usage
      };

    case 'turn.failed':
      return {
        type: 'turn_failed',
        error: event.error
      };

    case 'thread.started':
      return {
        type: 'thread_started',
        threadId: event.thread_id
      };

    case 'error':
      return {
        type: 'error',
        message: event.message
      };

    default: {
      // Defensive fallback for any future event type the SDK adds that this
      // switch doesn't know about yet — unreachable against the current
      // ThreadEvent union, hence the cast.
      const unknownEvent = event as { type: string };
      return {
        type: unknownEvent.type,
        data: unknownEvent
      };
    }
  }
}

/** Map the UI's permission mode ('default' | 'acceptEdits' | 'bypassPermissions') to Codex SDK thread options. */
function mapPermissionModeToCodexOptions(permissionMode: string | undefined): { sandboxMode: SandboxMode; approvalPolicy: ApprovalMode } {
  switch (permissionMode) {
    case 'acceptEdits':
      return {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'never'
      };
    case 'bypassPermissions':
      return {
        sandboxMode: 'danger-full-access',
        approvalPolicy: 'never'
      };
    case 'default':
    default:
      return {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'untrusted'
      };
  }
}

/**
 * Execute a Codex query with streaming
 */
export async function queryCodex(command: string, options: SpawnCodexOptions = {}, ws: CodexWriter): Promise<void> {
  const {
    sessionId,
    sessionSummary,
    cwd,
    projectPath,
    model,
    effort,
    images,
    permissionMode = 'default'
  } = options;

  // options.model is the final model, resolved upstream by the caller keyed by
  // the app session id; the runtime never re-resolves (sessionId here is the
  // provider-native resume id, not the override's key).
  const resolvedModel = model;

  const workingDirectory = cwd || projectPath || process.cwd();
  const { sandboxMode, approvalPolicy } = mapPermissionModeToCodexOptions(permissionMode);
  const catalog = (await providerModelsService.getProviderModels('codex')).models;
  const selectedModel = catalog.OPTIONS.find((option) => option.value === resolvedModel) || null;
  const allowedEfforts = selectedModel?.effort?.values?.map((value) => value.value) || [];
  const resolvedEffort = typeof effort === 'string' && effort !== 'default' && allowedEfforts.includes(effort)
    ? effort
    : undefined;

  let codex: Codex | undefined;
  let thread: Thread | undefined;
  let capturedSessionId: string | null | undefined = sessionId;
  let sessionCreatedSent = false;
  let terminalFailure: Error | string | { message: string } | null = null;
  const abortController = new AbortController();

  try {
    codex = new Codex();

    const threadOptions = {
      workingDirectory,
      skipGitRepoCheck: true,
      sandboxMode,
      approvalPolicy,
      model: resolvedModel,
      modelReasoningEffort: resolvedEffort as import('@openai/codex-sdk').ModelReasoningEffort | undefined,
    };

    if (sessionId) {
      thread = codex.resumeThread(sessionId, threadOptions);
    } else {
      thread = codex.startThread(threadOptions);
    }

    // Narrowed locals: same objects as the outer `thread`/`codex`, captured
    // here (right after both are definitely assigned above) so the closure
    // below doesn't see the outer bindings' `| undefined` from before the
    // thread was started.
    const startedThread = thread;
    const startedCodex = codex;
    const registerSession = (id: string | null) => {
      if (!id) {
        return;
      }
      activeCodexSessions.set(id, {
        thread: startedThread,
        codex: startedCodex,
        status: 'running',
        abortController,
        startedAt: new Date().toISOString()
      });
    };

    if (capturedSessionId) {
      registerSession(capturedSessionId);
    }

    // Execute with streaming. Turns with image attachments send structured
    // input items so Codex reads the images from their local asset paths.
    const turnInput = normalizeImageDescriptors(images).length > 0
      ? buildCodexInputItems(command, images, workingDirectory)
      : command;
    const streamedTurn = await thread.runStreamed(turnInput, {
      signal: abortController.signal
    });

    for await (const event of streamedTurn.events) {
      // Capture thread/session id lazily from the stream (Codex emits this asynchronously).
      if (event.type === 'thread.started') {
        const discoveredSessionId: string | null = event.thread_id || null;
        if (discoveredSessionId && !capturedSessionId) {
          capturedSessionId = discoveredSessionId;
          registerSession(capturedSessionId);

          if (ws.setSessionId && typeof ws.setSessionId === 'function') {
            ws.setSessionId(capturedSessionId);
          }

          if (!sessionId && !sessionCreatedSent) {
            sessionCreatedSent = true;
            sendMessage(ws, createNormalizedMessage({ kind: 'session_created', newSessionId: capturedSessionId, sessionId: capturedSessionId, provider: 'codex' }));
          }
        }
      }

      // Check if session was aborted
      if (abortController.signal.aborted) {
        break;
      }
      if (capturedSessionId) {
        const session = activeCodexSessions.get(capturedSessionId);
        if (session?.status === 'aborted') {
          break;
        }
      }

      if (event.type === 'item.started' || event.type === 'item.updated') {
        continue;
      }

      const transformed = transformCodexEvent(event);

      // Normalize the transformed event into NormalizedMessage(s) via adapter
      const normalizedMsgs = sessionsService.normalizeMessage('codex', transformed, capturedSessionId || sessionId || null);
      for (const msg of normalizedMsgs) {
        sendMessage(ws, msg);
      }

      if (event.type === 'turn.failed' && !terminalFailure) {
        terminalFailure = event.error || new Error('Turn failed');
        notifyRunFailed({
          userId: ws?.userId || null,
          provider: 'codex',
          sessionId: capturedSessionId || sessionId || null,
          sessionName: sessionSummary,
          error: terminalFailure
        });
      }

      // Extract and send token usage if available (normalized to match Claude format)
      if (event.type === 'turn.completed') {
        const tokenBudget = extractCodexTokenBudget(event);
        if (tokenBudget) {
          sendMessage(ws, createNormalizedMessage({ kind: 'status', text: 'token_budget', tokenBudget, sessionId: capturedSessionId || sessionId || null, provider: 'codex' }));
        }
      }
    }

    // Send the terminal completion event — skipped for aborted runs, whose
    // terminal `complete` (aborted: true) was already sent by abort-session.
    const runSession = capturedSessionId ? activeCodexSessions.get(capturedSessionId) : null;
    const runAborted = runSession?.status === 'aborted' || abortController.signal.aborted;
    if (!runAborted) {
      sendMessage(ws, createCompleteMessage({
        provider: 'codex',
        sessionId: capturedSessionId || sessionId || null,
        actualSessionId: capturedSessionId || thread.id || sessionId || null,
        exitCode: terminalFailure ? 1 : 0,
      }));
      if (!terminalFailure) {
        notifyRunStopped({
          userId: ws?.userId || null,
          provider: 'codex',
          sessionId: capturedSessionId || sessionId || null,
          sessionName: sessionSummary,
          stopReason: 'completed'
        });
      }
    }

  } catch (error) {
    const errObj = error as { name?: string; message?: string } | null;
    const session = capturedSessionId ? activeCodexSessions.get(capturedSessionId) : null;
    const wasAborted =
      session?.status === 'aborted' ||
      errObj?.name === 'AbortError' ||
      String(errObj?.message || '').toLowerCase().includes('aborted');

    if (!wasAborted) {
      console.error('[Codex] Error:', error);

      // Check if Codex SDK is available for a clearer error message
      const installed = await providerAuthService.isProviderInstalled('codex');
      const errorContent = !installed
        ? 'Codex CLI is not configured. Please set up authentication first.'
        : errObj?.message;

      sendMessage(ws, createNormalizedMessage({ kind: 'error', content: errorContent, sessionId: capturedSessionId || sessionId || null, provider: 'codex' }));
      sendMessage(ws, createCompleteMessage({
        provider: 'codex',
        sessionId: capturedSessionId || sessionId || null,
        exitCode: 1,
      }));
      if (!terminalFailure) {
        notifyRunFailed({
          userId: ws?.userId || null,
          provider: 'codex',
          sessionId: capturedSessionId || sessionId || null,
          sessionName: sessionSummary,
          error
        });
      }
    }

  } finally {
    // Update session status
    if (capturedSessionId) {
      const session = activeCodexSessions.get(capturedSessionId);
      if (session) {
        session.status = session.status === 'aborted' ? 'aborted' : 'completed';
      }
    }
  }
}

/**
 * Abort an active Codex session
 * @param {string} sessionId - Session ID to abort
 * @returns {boolean} - Whether abort was successful
 */
export function abortCodexSession(sessionId: string): boolean {
  const session = activeCodexSessions.get(sessionId);

  if (!session) {
    return false;
  }

  session.status = 'aborted';
  try {
    session.abortController?.abort();
  } catch (error) {
    console.warn(`[Codex] Failed to abort session ${sessionId}:`, error);
  }

  return true;
}

/**
 * Check if a session is active
 * @param {string} sessionId - Session ID to check
 * @returns {boolean} - Whether session is active
 */
export function isCodexSessionActive(sessionId: string): boolean {
  const session = activeCodexSessions.get(sessionId);
  return session?.status === 'running';
}

/**
 * Helper to send message via WebSocket or writer
 * @param {WebSocket|object} ws - WebSocket or response writer
 * @param {object} data - Data to send
 */
function sendMessage(ws: CodexWriter, data: unknown): void {
  try {
    if (ws.isSSEStreamWriter || ws.isWebSocketWriter) {
      // Writer handles stringification (SSEStreamWriter or WebSocketWriter)
      ws.send(data);
    } else if (typeof ws.send === 'function') {
      // Raw WebSocket - stringify here
      ws.send(JSON.stringify(data));
    }
  } catch (error) {
    console.error('[Codex] Error sending message:', error);
  }
}

// Clean up old completed sessions periodically
setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 minutes

  for (const [id, session] of activeCodexSessions.entries()) {
    if (session.status !== 'running') {
      const startedAt = new Date(session.startedAt).getTime();
      if (now - startedAt > maxAge) {
        activeCodexSessions.delete(id);
      }
    }
  }
}, 5 * 60 * 1000); // Every 5 minutes
