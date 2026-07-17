import { useEffect, useState, useCallback } from 'react';
import { Plus, Trash2, RefreshCw } from 'lucide-react';
import { authenticatedFetch } from '../../../../utils/api';

// User-level global TODO (persisted in ~/.cloudcli/todo.json on the server).
// Not tied to any project — a personal scratchpad. The agent can drive the
// same /api/todos endpoints.
type Todo = { id: string; text: string; done: boolean; createdAt?: string };

export default function TodoPanel() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authenticatedFetch('/api/todos');
      if (res.ok) {
        const data = await res.json();
        setTodos(Array.isArray(data.todos) ? data.todos : []);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const add = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    await authenticatedFetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    await load();
  }, [input, load]);

  const toggle = useCallback(async (todo: Todo) => {
    await authenticatedFetch(`/api/todos/${todo.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done: !todo.done }),
    });
    await load();
  }, [load]);

  const remove = useCallback(async (id: string) => {
    await authenticatedFetch(`/api/todos/${id}`, { method: 'DELETE' });
    await load();
  }, [load]);

  const pending = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);

  return (
    <div className="flex h-full w-full flex-col bg-background/80 backdrop-blur-sm select-none">
      <div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
        <span className="text-sm font-medium text-foreground">TODO</span>
        <button
          onClick={() => void load()}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Add box */}
      <div className="flex gap-1 border-b border-border/40 px-3 py-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void add(); }}
          placeholder="Add a todo…"
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground outline-none focus:border-primary"
        />
        <button
          onClick={() => void add()}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Add"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-1 py-1">
        {todos.length === 0 && (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground/60">No todos yet</p>
        )}
        {[...pending, ...done].map((todo) => (
          <div key={todo.id} className="group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent/50">
            <input
              type="checkbox"
              checked={todo.done}
              onChange={() => void toggle(todo)}
              className="h-3.5 w-3.5 flex-shrink-0 cursor-pointer"
            />
            <span className={`min-w-0 flex-1 truncate text-sm ${todo.done ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
              {todo.text}
            </span>
            <button
              onClick={() => void remove(todo.id)}
              className="hidden h-4 w-4 flex-shrink-0 items-center justify-center rounded text-muted-foreground hover:text-destructive group-hover:flex"
              title="Delete"
            >
              <Trash2 className="h-2.5 w-2.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
