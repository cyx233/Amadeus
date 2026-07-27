/**
 * RESIDENT STDIO MCP CLIENT FACTORY
 * =================================
 *
 * Generalized from the original taskmaster-mcp client: many MCP CLIs cold-start
 * slowly (bundle load + config init), so spawning per request is painful. This
 * keeps ONE process resident per (command) and talks JSON-RPC over stdio: the
 * cold start is paid once, each later call is a few ms.
 *
 * Lazy: spawned on first use. Crash-resilient: if the child dies the client is
 * torn down and the next call re-spawns (with one transparent retry).
 *
 * Each PlatformExtension with an `mcp` manifest gets one of these; the extension
 * registry owns the instances and their shutdown.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const CALL_TIMEOUT_MS = 60_000; // AI-backed tools (parse/expand) need a generous ceiling.

export interface McpClientOptions {
  command: string;
  args?: string[];
  /** Extra env merged over process.env for the spawned server. */
  env?: Record<string, string>;
}

export interface ResidentMcpClient {
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  shutdown(): Promise<void>;
}

type CallToolResult = Awaited<ReturnType<Client['callTool']>>;

/**
 * FastMCP tools return { content: [{ type:'text', text:'<json>' }] } where the
 * JSON is a { success, data, error } envelope. Unwrap to the payload and surface
 * tool-level errors as thrown Errors (so routes 5xx cleanly).
 */
function parseToolResult(name: string, result: CallToolResult): unknown {
  const textPart = Array.isArray(result?.content)
    ? result.content.find((c) => c.type === 'text')
    : null;

  if (result?.isError) {
    throw new Error(textPart?.text || `MCP tool ${name} reported an error`);
  }

  if (!textPart?.text) {
    return null; // some tools return no body on success
  }

  let payload: unknown;
  try {
    payload = JSON.parse(textPart.text);
  } catch {
    return textPart.text; // non-JSON text (rare) — hand it back raw
  }

  const envelope = payload as { success?: boolean; data?: unknown; result?: unknown; error?: { message?: string } } | null;
  if (envelope && envelope.success === false) {
    throw new Error(envelope.error?.message || `MCP tool ${name} failed`);
  }
  return envelope?.data ?? envelope?.result ?? envelope;
}

export function createResidentMcpClient(options: McpClientOptions): ResidentMcpClient {
  let clientPromise: Promise<Client> | null = null; // in-flight or resolved (dedupes concurrent starts)

  async function connect(): Promise<Client> {
    // Inherit the server's env (Bedrock creds, AWS_CONFIG_FILE, etc.) so
    // AI-backed tools work the same as the CLI did, then layer manifest env.
    // process.env is Record<string, string | undefined>; the transport wants
    // string values only, so drop undefined keys.
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === 'string') env[k] = v;
    }
    Object.assign(env, options.env ?? {});

    const transport = new StdioClientTransport({
      command: options.command,
      args: options.args ?? [],
      env,
      stderr: 'inherit',
    });

    const client = new Client({ name: 'amadeus', version: '1.0.0' }, { capabilities: {} });

    // If the transport closes (child crashed/exited), drop the cached client so
    // the next call re-spawns.
    transport.onclose = () => {
      if (clientPromise) {
        clientPromise = null;
      }
    };

    await client.connect(transport);
    return client;
  }

  function getClient(): Promise<Client> {
    if (!clientPromise) {
      clientPromise = connect().catch((err) => {
        clientPromise = null; // failed start shouldn't stick; allow retry
        throw err;
      });
    }
    return clientPromise;
  }

  return {
    async callTool(name, args) {
      // One transparent retry: covers the resident process dying between calls
      // (onclose cleared the cache, but a call already held the stale client).
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const client = await getClient();
          const result = await client.callTool({ name, arguments: args }, undefined, { timeout: CALL_TIMEOUT_MS });
          return parseToolResult(name, result);
        } catch (err) {
          clientPromise = null; // re-spawn a fresh process next attempt/request
          if (attempt === 1) throw err;
        }
      }
    },
    async shutdown() {
      if (!clientPromise) return;
      const pending = clientPromise;
      clientPromise = null;
      try {
        const client = await pending;
        await client.close();
      } catch {
        // Best-effort: process is going away regardless.
      }
    },
  };
}
