import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { dataDir } from '@/shared/utils.js';

// User-level global TODO list, stored in <data-dir>/todo.json (persistent
// volume). Not per-project — a personal scratchpad shared by the REST route
// (routes/todos.js) and the in-process MCP tools the agent uses (claude-sdk.js).
const TODO_FILE = dataDir('todo.json');

export async function readTodos() {
  try {
    const raw = await fs.readFile(TODO_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data.todos) ? data.todos : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function writeTodos(todos) {
  await fs.mkdir(path.dirname(TODO_FILE), { recursive: true });
  await fs.writeFile(TODO_FILE, JSON.stringify({ todos }, null, 2));
}

export async function addTodo(text) {
  const todos = await readTodos();
  const todo = { id: crypto.randomUUID(), text, done: false, createdAt: new Date().toISOString() };
  todos.push(todo);
  await writeTodos(todos);
  return todo;
}

export async function updateTodo(id, { text, done }) {
  const todos = await readTodos();
  const todo = todos.find((t) => t.id === id);
  if (!todo) return null;
  if (typeof text === 'string') todo.text = text.trim();
  if (typeof done === 'boolean') todo.done = done;
  await writeTodos(todos);
  return todo;
}

export async function removeTodo(id) {
  const todos = await readTodos();
  const next = todos.filter((t) => t.id !== id);
  if (next.length === todos.length) return false;
  await writeTodos(next);
  return true;
}
