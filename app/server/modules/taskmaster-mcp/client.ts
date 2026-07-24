/**
 * TASK-MASTER MCP CLIENT (singleton)
 * ==================================
 *
 * task-master's CLI cold-starts ~3.5s per invocation (bundle load + config
 * init), so spawning it per request made local operations (set-status, remove,
 * deps) painfully slow — and set-status needed a second spawn (`tags use`)
 * because the CLI has no --tag flag.
 *
 * task-master ships a `task-master-ai` MCP server (fastmcp, stdio transport)
 * whose tools take `projectRoot` per call (so ONE process serves every project)
 * and accept `tag` natively (so no active-tag switching). We keep it resident
 * and talk JSON-RPC over stdio: the cold start is paid once, each later call is
 * a few ms.
 *
 * Lazy: the process is spawned on first use. Crash-resilient: if the child dies
 * the client is torn down and the next call re-spawns (with one retry).
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const CALL_TIMEOUT_MS = 60_000; // parse_prd/expand call AI; generous ceiling.

let clientPromise: Promise<Client> | null = null; // in-flight or resolved connection (dedupes concurrent starts)

async function connect(): Promise<Client> {
    const transport = new StdioClientTransport({
        command: 'task-master-ai',
        args: [],
        env: {
            // Inherit the server's env (Bedrock creds, AWS_CONFIG_FILE, etc. set by
            // the entrypoint) so AI-backed tools work the same as the CLI did.
            ...process.env,
            // Default MCP mode ('core') exposes only read/status tools. We drive
            // add/remove/update/deps too, so expose the full tool set.
            TASK_MASTER_TOOLS: 'all',
        },
        stderr: 'inherit',
        // No `spawn` option here: StdioServerParameters doesn't declare one, and
        // the SDK's own stdio transport unconditionally imports and uses
        // cross-spawn internally (confirmed in its compiled source) — a
        // caller-supplied spawn implementation is never read. The original .js
        // passed `spawn: rawSpawn` here; it was always dead.
    });

    const client = new Client({ name: 'amadeus', version: '1.0.0' }, { capabilities: {} });

    // If the transport closes (child crashed/exited), drop the cached client so
    // the next getClient() re-spawns.
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

/**
 * Call a task-master MCP tool and return its structured result.
 * @param name  tool name, e.g. 'set_task_status'
 * @param args  tool arguments (must include projectRoot)
 * @returns the tool's parsed JSON payload
 */
export async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    // One transparent retry: covers the case where the resident process died
    // between calls (onclose cleared the cache, but a call already had the stale
    // client). Second failure propagates.
    for (let attempt = 0; attempt < 2; attempt++) {
        let client: Client;
        try {
            client = await getClient();
            const result = await client.callTool(
                { name, arguments: args },
                undefined,
                { timeout: CALL_TIMEOUT_MS },
            );
            return parseToolResult(name, result);
        } catch (err) {
            // Reset so the next attempt/request re-spawns a fresh process.
            clientPromise = null;
            if (attempt === 1) throw err;
        }
    }
}

type CallToolResult = Awaited<ReturnType<Client['callTool']>>;

/**
 * task-master MCP tools return { content: [{ type:'text', text:'<json>' }] }
 * where the JSON is FastMCP's { data, error } envelope. Unwrap to the payload
 * and surface tool-level errors as thrown Errors (so routes 5xx cleanly).
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

    // FastMCP envelope: { success, data, error } or { result: {...} }.
    const envelope = payload as { success?: boolean; data?: unknown; result?: unknown; error?: { message?: string } } | null;
    if (envelope && envelope.success === false) {
        throw new Error(envelope.error?.message || `MCP tool ${name} failed`);
    }
    return envelope?.data ?? envelope?.result ?? envelope;
}

/** Cleanly stop the resident process (called on server shutdown). */
export async function shutdown(): Promise<void> {
    if (!clientPromise) return;
    const pending = clientPromise;
    clientPromise = null;
    try {
        const client = await pending;
        await client.close();
    } catch {
        // Best-effort: process is going away regardless.
    }
}
