import { useEffect, useCallback, useState, useRef } from 'react';
import { MessageSquare, Plus, MoreVertical, Archive, Trash2, RotateCcw } from 'lucide-react';
import { ScrollArea } from '../../../../shared/view/ui';
import { authenticatedFetch } from '../../../../utils/api';
import type { Project, ProjectSession } from '../../../../types/app';

import SidebarFileTree from './SidebarFileTree';
import SidebarHeader from './SidebarHeader';

type SidebarContentProps = {
  isLoading: boolean;
  projects: Project[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: ProjectSession) => void;
  onNewSession: () => void;
  searchFilter: string;
  onSearchFilterChange: (value: string) => void;
  onRefresh: () => Promise<void> | void;
  isRefreshing: boolean;
  onCreateProject: () => void;
  onCollapseSidebar: () => void;
};

export default function SidebarContent({
  isLoading,
  projects,
  selectedProject,
  selectedSession,
  onProjectSelect,
  onSessionSelect,
  onNewSession,
  searchFilter,
  onSearchFilterChange,
  onRefresh,
  isRefreshing,
  onCreateProject,
  onCollapseSidebar,
}: SidebarContentProps) {
  // ponytail: auto-select first project on load
  useEffect(() => {
    if (!selectedProject && projects.length > 0) {
      onProjectSelect(projects[0]);
    }
  }, [selectedProject, projects, onProjectSelect]);

  // Always read sessions from the latest projects array to avoid stale references
  const currentProject = projects.find(p => p.projectId === selectedProject?.projectId);
  const sessions = currentProject?.sessions ?? [];
  const projectSelectRef = useRef<HTMLSelectElement>(null);
  const [projectMenu, setProjectMenu] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [archivedProjects, setArchivedProjects] = useState<Array<{ projectId: string; displayName?: string; path?: string }>>([]);

  const getActiveProject = useCallback(() => {
    const id = projectSelectRef.current?.value;
    return projects.find(p => p.projectId === id) ?? selectedProject;
  }, [projects, selectedProject]);

  const handleArchiveProject = useCallback(async () => {
    const project = getActiveProject();
    if (!project) return;
    const name = project.displayName || project.fullPath?.split('/').pop() || 'project';
    if (!confirm(`Archive "${name}"? You can restore it later.`)) return;
    await authenticatedFetch(`/api/projects/${project.projectId}`, { method: 'DELETE' });
    setProjectMenu(false);
    await onRefresh();
  }, [getActiveProject, onRefresh]);

  const handleDeleteProject = useCallback(async () => {
    const project = getActiveProject();
    if (!project) return;
    const name = project.displayName || project.fullPath?.split('/').pop() || 'project';
    if (!confirm(`Permanently delete "${name}" and all its sessions? This cannot be undone.`)) return;
    await authenticatedFetch(`/api/projects/${project.projectId}?force=true`, { method: 'DELETE' });
    setProjectMenu(false);
    await onRefresh();
  }, [getActiveProject, onRefresh]);

  const handleShowArchived = useCallback(async () => {
    const res = await authenticatedFetch('/api/projects/archived');
    if (res.ok) {
      const json = await res.json();
      // API wraps in { success, data: { projects } }
      setArchivedProjects(json?.data?.projects ?? []);
    }
    setShowArchived(true);
    setProjectMenu(false);
  }, []);

  const handleRestore = useCallback(async (projectId: string) => {
    await authenticatedFetch(`/api/projects/${projectId}/restore`, { method: 'POST' });
    setShowArchived(false);
    await onRefresh();
  }, [onRefresh]);

  // Close project menu on outside click
  useEffect(() => {
    if (!projectMenu) return;
    const close = () => setProjectMenu(false);
    const id = setTimeout(() => document.addEventListener('click', close), 0);
    return () => { clearTimeout(id); document.removeEventListener('click', close); };
  }, [projectMenu]);

  return (
    <div className="flex h-full w-full flex-col bg-background/80 backdrop-blur-sm select-none">
      <SidebarHeader
        isLoading={isLoading}
        searchFilter={searchFilter}
        onSearchFilterChange={onSearchFilterChange}
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
        onCreateProject={onCreateProject}
        onCollapseSidebar={onCollapseSidebar}
      />

      {/* Project selector */}
      <div className="flex flex-shrink-0 items-center gap-1 border-b border-border/40 px-3 py-2">
        <select
          ref={projectSelectRef}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-primary"
          value={selectedProject?.projectId || ''}
          onChange={(e) => {
            const project = projects.find(p => p.projectId === e.target.value);
            if (project) onProjectSelect(project);
          }}
        >
          {projects.length === 0 && <option value="">No projects</option>}
          {projects.map(p => (
            <option key={p.projectId} value={p.projectId}>
              {p.displayName || p.fullPath?.split('/').pop()}
            </option>
          ))}
        </select>
        {selectedProject && (
          <div className="relative flex-shrink-0">
            <button
              onClick={() => setProjectMenu(prev => !prev)}
              className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Project actions"
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </button>
            {projectMenu && (
              <div className="absolute right-0 top-8 z-50 min-w-[140px] rounded-md border border-border bg-popover p-1 shadow-md">
                <button className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent" onClick={() => { window.open(`/api/projects/${getActiveProject()?.projectId}/download`, '_blank'); setProjectMenu(false); }}>
                  <Archive className="h-3 w-3" /> Download
                </button>
                <div className="my-1 border-t border-border" />
                <button className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent" onClick={handleArchiveProject}>
                  <Archive className="h-3 w-3" /> Archive
                </button>
                <button className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10" onClick={handleDeleteProject}>
                  <Trash2 className="h-3 w-3" /> Delete
                </button>
                <div className="my-1 border-t border-border" />
                <button className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent" onClick={handleShowArchived}>
                  <RotateCcw className="h-3 w-3" /> View archived
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Archived projects modal */}
      {showArchived && (
        <div className="flex-shrink-0 border-b border-border/40 bg-muted/30 px-3 py-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Archived</span>
            <button onClick={() => setShowArchived(false)} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
          </div>
          {archivedProjects.length === 0 ? (
            <p className="text-xs text-muted-foreground/60">No archived projects</p>
          ) : (
            archivedProjects.map(p => (
              <div key={p.projectId} className="flex items-center justify-between py-0.5">
                <span className="truncate text-xs text-foreground">{p.displayName || p.path?.split('/').pop()}</span>
                <button onClick={() => handleRestore(p.projectId)} className="text-xs text-primary hover:underline">Restore</button>
              </div>
            ))
          )}
        </div>
      )}

      {/* File tree + Sessions: split pane */}
      <SplitPane
        top={
          <div className="px-1 py-1">
            <SidebarFileTree selectedProject={selectedProject} />
          </div>
        }
        bottom={
          <div className="px-1 pb-1">
            {sessions.map(s => (
              <div
                key={s.id}
                className={`group flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-accent/50 ${
                  selectedSession?.id === s.id ? 'bg-accent text-foreground' : 'text-muted-foreground'
                }`}
              >
                <button className="flex min-w-0 flex-1 items-center gap-1.5" onClick={() => onSessionSelect(s)}>
                  <MessageSquare className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">{s.summary || s.title || s.name || 'Untitled'}</span>
                </button>
                <button
                  className="hidden h-4 w-4 flex-shrink-0 items-center justify-center rounded text-muted-foreground hover:text-destructive group-hover:flex"
                  title="Delete session"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!confirm('Delete this session?')) return;
                    await authenticatedFetch(`/api/providers/sessions/${s.id}?force=true`, { method: 'DELETE' });
                    await onRefresh();
                  }}
                >
                  <Trash2 className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
            {sessions.length === 0 && (
              <p className="px-2 py-1 text-xs text-muted-foreground/60">No sessions yet</p>
            )}
          </div>
        }
        bottomHeader={
          <div className="flex items-center justify-between px-3 py-1">
            <span className="text-xs font-medium text-muted-foreground">Sessions</span>
            <button
              onClick={onNewSession}
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              title="New session"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
        }
      />
    </div>
  );
}

function SplitPane({ top, bottom, bottomHeader }: {
  top: React.ReactNode;
  bottom: React.ReactNode;
  bottomHeader: React.ReactNode;
}) {
  const [splitPercent, setSplitPercent] = useState(60);
  const containerRef = useRef<HTMLDivElement>(null);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const startY = e.clientY;
    const startPercent = splitPercent;
    const h = container.getBoundingClientRect().height;
    const onMove = (ev: MouseEvent) => {
      const delta = ((ev.clientY - startY) / h) * 100;
      setSplitPercent(Math.max(20, Math.min(80, startPercent + delta)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [splitPercent]);

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 flex-col">
      <div className="overflow-y-auto" style={{ height: `${splitPercent}%` }}>
        {top}
      </div>
      <div
        onMouseDown={onDragStart}
        className="h-1 flex-shrink-0 cursor-row-resize border-t border-border/40 bg-border/20 transition-colors hover:bg-primary/40"
      />
      <div className="flex min-h-0 flex-col" style={{ height: `${100 - splitPercent}%` }}>
        <div className="flex-shrink-0">{bottomHeader}</div>
        <div className="flex-1 overflow-y-auto">{bottom}</div>
      </div>
    </div>
  );
}
