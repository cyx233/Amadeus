import express from 'express';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// User-level global TODO list, stored in ~/.cloudcli/todo.json (persistent
// volume). Not per-project — a personal scratchpad shared across all projects.
// Pure CRUD, no LLM: the agent can also drive it via these same endpoints.
const router = express.Router();

const TODO_FILE = path.join(os.homedir(), '.cloudcli', 'todo.json');

async function readTodos() {
  try {
    const raw = await fs.readFile(TODO_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data.todos) ? data.todos : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeTodos(todos) {
  await fs.mkdir(path.dirname(TODO_FILE), { recursive: true });
  await fs.writeFile(TODO_FILE, JSON.stringify({ todos }, null, 2));
}

// List all todos
router.get('/', async (_req, res) => {
  try {
    res.json({ todos: await readTodos() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add a todo
router.post('/', async (req, res) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) return res.status(400).json({ error: 'text is required' });
    const todos = await readTodos();
    const todo = { id: crypto.randomUUID(), text, done: false, createdAt: new Date().toISOString() };
    todos.push(todo);
    await writeTodos(todos);
    res.json({ todo });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update a todo (text and/or done)
router.put('/:id', async (req, res) => {
  try {
    const todos = await readTodos();
    const todo = todos.find((t) => t.id === req.params.id);
    if (!todo) return res.status(404).json({ error: 'not found' });
    if (typeof req.body?.text === 'string') todo.text = req.body.text.trim();
    if (typeof req.body?.done === 'boolean') todo.done = req.body.done;
    await writeTodos(todos);
    res.json({ todo });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a todo
router.delete('/:id', async (req, res) => {
  try {
    const todos = await readTodos();
    const next = todos.filter((t) => t.id !== req.params.id);
    if (next.length === todos.length) return res.status(404).json({ error: 'not found' });
    await writeTodos(next);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
