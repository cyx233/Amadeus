import express from 'express';
import { readTodos, addTodo, updateTodo, removeTodo } from '../utils/todo-store.js';

// User-level global TODO list (see utils/todo-store.js). Pure CRUD, no LLM.
// The frontend TodoPanel calls these; the agent uses the in-process MCP tools
// wired up in claude-sdk.js — both hit the same store.
const router = express.Router();

router.get('/', async (_req, res) => {
  try {
    res.json({ todos: await readTodos() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) return res.status(400).json({ error: 'text is required' });
    res.json({ todo: await addTodo(text) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const todo = await updateTodo(req.params.id, req.body ?? {});
    if (!todo) return res.status(404).json({ error: 'not found' });
    res.json({ todo });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const ok = await removeTodo(req.params.id);
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
