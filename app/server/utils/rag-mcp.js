import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { retrieveContext } from '@/modules/rag/index.js';

// In-process MCP server exposing workspace knowledge-base search to the agent.
// This is the *soft* complement to the deterministic pre-retrieval injection in
// chat-websocket.service: injection guarantees background on every turn, while
// this tool lets the agent actively dig deeper when it wants more. Registered
// only when the session has RAG enabled (see claude-sdk.js). Claude-only —
// the other runtimes are external CLIs that can't host an in-process MCP server.
const ok = (payload) => ({ content: [{ type: 'text', text: JSON.stringify(payload) }] });

export const ragMcpServer = createSdkMcpServer({
  name: 'rag',
  version: '1.0.0',
  tools: [
    tool(
      'rag_search',
      "Search this workspace's knowledge base (LightRAG) for background context "
        + '— past decisions, architecture, how something was done before. Use when '
        + 'you need workspace knowledge beyond the files in the current context.',
      { query: z.string().describe('What to look up in the workspace knowledge base') },
      async ({ query }) => {
        const result = await retrieveContext(query);
        return ok(result ? { result } : { result: null, note: 'No relevant workspace knowledge found.' });
      }
    ),
  ],
});
