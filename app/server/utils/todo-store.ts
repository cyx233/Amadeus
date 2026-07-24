import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

import { dataDir } from '@/shared/utils.js';

// User-level global TODO list, stored in <data-dir>/todo.json (persistent
// volume). Not per-project — a personal scratchpad shared by the REST route
// (routes/todos.js) and the in-process MCP tools the agent uses (claude-sdk.js).
const TODO_FILE = dataDir('todo.json');

export type Todo = {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
};

export async function readTodos(): Promise<Todo[]> {
  try {
    const raw = await fs.readFile(TODO_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data.todos) ? data.todos : [];
  } catch (error) {
    if ((error as { code?: string })?.code === 'ENOENT') return [];
    throw error;
  }
}

export async function writeTodos(todos: Todo[]): Promise<void> {
  await fs.mkdir(path.dirname(TODO_FILE), { recursive: true });
  await fs.writeFile(TODO_FILE, JSON.stringify({ todos }, null, 2));
}

export async function addTodo(text: string): Promise<Todo> {
  const todos = await readTodos();
  const todo: Todo = { id: crypto.randomUUID(), text, done: false, createdAt: new Date().toISOString() };
  todos.push(todo);
  await writeTodos(todos);
  return todo;
}

export async function updateTodo(
  id: string,
  { text, done }: { text?: string; done?: boolean },
): Promise<Todo | null> {
  const todos = await readTodos();
  const todo = todos.find((t) => t.id === id);
  if (!todo) return null;
  if (typeof text === 'string') todo.text = text.trim();
  if (typeof done === 'boolean') todo.done = done;
  await writeTodos(todos);
  return todo;
}

export async function removeTodo(id: string): Promise<boolean> {
  const todos = await readTodos();
  const next = todos.filter((t) => t.id !== id);
  if (next.length === todos.length) return false;
  await writeTodos(next);
  return true;
}
