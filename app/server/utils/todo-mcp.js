import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { readTodos, addTodo, updateTodo, removeTodo } from './todo-store.js';

// In-process MCP server exposing the user-level global TODO to the agent.
// Same store as the REST route / sidebar panel — "加到待办" writes here.
const ok = (payload) => ({ content: [{ type: 'text', text: JSON.stringify(payload) }] });

export const todoMcpServer = createSdkMcpServer({
  name: 'todo',
  version: '1.0.0',
  tools: [
    tool('todo_list', 'List the user\'s global TODO items.', {}, async () => ok({ todos: await readTodos() })),
    tool('todo_add', 'Add an item to the user\'s global TODO list.',
      { text: z.string().describe('The todo text') },
      async ({ text }) => ok({ todo: await addTodo(text.trim()) })),
    tool('todo_update', 'Update a TODO item\'s text and/or done status.',
      { id: z.string(), text: z.string().optional(), done: z.boolean().optional() },
      async ({ id, text, done }) => {
        const todo = await updateTodo(id, { text, done });
        return todo ? ok({ todo }) : ok({ error: 'not found' });
      }),
    tool('todo_remove', 'Delete a TODO item by id.',
      { id: z.string() },
      async ({ id }) => ok({ success: await removeTodo(id) })),
  ],
});
