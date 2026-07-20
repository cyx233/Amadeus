import { useEffect, useRef, useState } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { api } from '../../../../utils/api';
import type { Project } from '../../../../types/app';

// VS Code-style project-wide content search (ripgrep-backed). Matches are
// grouped by file; clicking a line opens the file via the global opener.
type Match = { line: number; text: string };
type FileResult = { file: string; matches: Match[] };

export default function SearchPanel({ selectedProject }: { selectedProject: Project | null }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FileResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const reqSeq = useRef(0);

  const projectId = selectedProject?.projectId ?? null;

  useEffect(() => {
    const q = query.trim();
    if (!projectId || q.length < 2) {
      setResults([]);
      setTruncated(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    const seq = ++reqSeq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await api.searchProject(projectId, q);
        if (seq !== reqSeq.current) return; // stale
        const data = res.ok ? await res.json() : { results: [] };
        setResults(Array.isArray(data.results) ? data.results : []);
        setTruncated(Boolean(data.truncated));
      } catch {
        if (seq === reqSeq.current) setResults([]);
      } finally {
        if (seq === reqSeq.current) setLoading(false);
      }
    }, 250); // debounce
    return () => clearTimeout(timer);
  }, [query, projectId]);

  if (!selectedProject) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground/60">
        Select a project to search its files
      </div>
    );
  }

  const totalMatches = results.reduce((n, r) => n + r.matches.length, 0);

  return (
    <div className="flex h-full w-full flex-col bg-background/80 backdrop-blur-sm">
      <div className="border-b border-border/40 px-3 py-2">
        <span className="text-sm font-medium text-foreground">Search</span>
      </div>
      <div className="border-b border-border/40 px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          {loading && (
            <Loader2 className="absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search in files…"
            autoFocus
            className="w-full rounded-md border border-border bg-background py-1 pl-8 pr-8 text-sm text-foreground outline-none focus:border-primary"
          />
        </div>
        {query.trim().length >= 2 && !loading && (
          <p className="mt-1.5 text-[11px] text-muted-foreground/70">
            {totalMatches} match{totalMatches === 1 ? '' : 'es'} in {results.length} file{results.length === 1 ? '' : 's'}
            {truncated ? ' (truncated)' : ''}
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-1 py-1">
        {query.trim().length < 2 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground/60">Type at least 2 characters to search.</p>
        ) : (!loading && results.length === 0) ? (
          <p className="px-2 py-3 text-xs text-muted-foreground/60">No matches.</p>
        ) : (
          results.map((r) => (
            <div key={r.file} className="mb-1">
              <div className="truncate px-2 py-1 text-xs font-medium text-foreground/80" title={r.file}>
                {r.file}
              </div>
              {r.matches.map((m, i) => (
                <button
                  key={`${r.file}:${m.line}:${i}`}
                  onClick={() => (window as any).__amadeus_openFile?.(r.file, { line: m.line })}
                  className="flex w-full items-baseline gap-2 rounded px-2 py-0.5 text-left hover:bg-accent/50"
                  title={`${r.file}:${m.line}`}
                >
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/60">{m.line}</span>
                  <span className="truncate font-mono text-xs text-muted-foreground">{m.text.trim()}</span>
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
