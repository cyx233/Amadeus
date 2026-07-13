import { type ReactNode } from 'react';
import { Activity, Archive, Folder, MessageSquare, RotateCcw, Search, Trash2 } from 'lucide-react';
import type { TFunction } from 'i18next';

import { ScrollArea } from '../../../../shared/view/ui';
import type { Project } from '../../../../types/app';
import type { ReleaseInfo } from '../../../../types/sharedTypes';
import type { ConversationSearchResults, SearchProgress } from '../../hooks/useSidebarController';
import type { ArchivedProjectListItem, ArchivedSessionListItem, SidebarSearchMode } from '../../types/types';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import { getAllSessions } from '../../utils/utils';

import SidebarFooter from './SidebarFooter';
import SidebarHeader from './SidebarHeader';
import SidebarProjectList, { type SidebarProjectListProps } from './SidebarProjectList';

function HighlightedSnippet({ snippet, highlights }: { snippet: string; highlights: { start: number; end: number }[] }) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const h of highlights) {
    if (h.start > cursor) {
      parts.push(snippet.slice(cursor, h.start));
    }
    parts.push(
      <mark key={h.start} className="rounded-sm bg-yellow-200 px-0.5 text-foreground dark:bg-yellow-800">
        {snippet.slice(h.start, h.end)}
      </mark>
    );
    cursor = h.end;
  }
  if (cursor < snippet.length) {
    parts.push(snippet.slice(cursor));
  }
  return (
    <span className="min-w-0 flex-1 break-words text-xs leading-relaxed text-muted-foreground">
      {parts}
    </span>
  );
}

type ArchivedSessionGroup = {
  key: string;
  projectId: string | null;
  projectDisplayName: string;
  projectPath: string | null;
  isProjectArchived: boolean;
  sessions: ArchivedSessionListItem[];
  latestActivity: string | null;
};

/**
 * Groups archived sessions by project metadata so the archive view preserves
 * the same mental model as the active sidebar: projects first, then sessions.
 */
function groupArchivedSessionsByProject(sessions: ArchivedSessionListItem[]): ArchivedSessionGroup[] {
  const groups = new Map<string, ArchivedSessionGroup>();

  for (const session of sessions) {
    const key = session.projectId ?? session.projectPath ?? `session:${session.sessionId}`;
    const existingGroup = groups.get(key);

    if (existingGroup) {
      existingGroup.sessions.push(session);
      if (!existingGroup.latestActivity || (session.lastActivity && session.lastActivity > existingGroup.latestActivity)) {
        existingGroup.latestActivity = session.lastActivity;
      }
      continue;
    }

    groups.set(key, {
      key,
      projectId: session.projectId,
      projectDisplayName: session.projectDisplayName,
      projectPath: session.projectPath,
      isProjectArchived: session.isProjectArchived,
      sessions: [session],
      latestActivity: session.lastActivity,
    });
  }

  return [...groups.values()].sort((groupA, groupB) => {
    const a = groupA.latestActivity ?? '';
    const b = groupB.latestActivity ?? '';
    return b.localeCompare(a);
  });
}

function formatCompactArchivedAge(dateString: string | null): string {
  if (!dateString) {
    return '';
  }

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const diffInMinutes = Math.floor(Math.max(0, Date.now() - date.getTime()) / (1000 * 60));
  if (diffInMinutes < 1) {
    return '<1m';
  }
  if (diffInMinutes < 60) {
    return `${diffInMinutes}m`;
  }

  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) {
    return `${diffInHours}hr`;
  }

  return `${Math.floor(diffInHours / 24)}d`;
}

type SidebarContentProps = {
  isPWA: boolean;
  isMobile: boolean;
  isLoading: boolean;
  projects: Project[];
  runningSessionsCount: number;
  archivedProjects: ArchivedProjectListItem[];
  archivedSessions: ArchivedSessionListItem[];
  archivedSessionsCount: number;
  isArchivedSessionsLoading: boolean;
  searchFilter: string;
  onSearchFilterChange: (value: string) => void;
  onClearSearchFilter: () => void;
  searchMode: SidebarSearchMode;
  onSearchModeChange: (mode: SidebarSearchMode) => void;
  conversationResults: ConversationSearchResults | null;
  isSearching: boolean;
  searchProgress: SearchProgress | null;
  onRestoreArchivedProject: (projectId: string) => void;
  onArchivedSessionClick: (session: ArchivedSessionListItem) => void;
  onRestoreArchivedSession: (sessionId: string) => void;
  onDeleteArchivedSession: (session: ArchivedSessionListItem) => void;
  // Conversation result clicks pass back the DB projectId (or null when the
  // server couldn't resolve it). Consumers must handle the null case.
  onConversationResultClick: (projectId: string | null, sessionId: string, provider: string, messageTimestamp?: string | null, messageSnippet?: string | null) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onCreateProject: () => void;
  onCollapseSidebar: () => void;
  updateAvailable: boolean;
  restartRequired: boolean;
  releaseInfo: ReleaseInfo | null;
  latestVersion: string | null;
  currentVersion: string;
  onShowVersionModal: () => void;
  onShowSettings: () => void;
  projectListProps: SidebarProjectListProps;
  t: TFunction;
};

export default function SidebarContent({
  isPWA,
  isMobile,
  isLoading,
  projects,
  runningSessionsCount,
  archivedProjects,
  archivedSessions,
  archivedSessionsCount,
  isArchivedSessionsLoading,
  searchFilter,
  onSearchFilterChange,
  onClearSearchFilter,
  searchMode,
  onSearchModeChange,
  conversationResults,
  isSearching,
  searchProgress,
  onRestoreArchivedProject,
  onArchivedSessionClick,
  onRestoreArchivedSession,
  onDeleteArchivedSession,
  onConversationResultClick,
  onRefresh,
  isRefreshing,
  onCreateProject,
  onCollapseSidebar,
  updateAvailable,
  restartRequired,
  releaseInfo,
  latestVersion,
  currentVersion,
  onShowVersionModal,
  onShowSettings,
  projectListProps,
  t,
}: SidebarContentProps) {
  const showConversationSearch = searchMode === 'conversations' && searchFilter.trim().length >= 2;
  const hasPartialResults = conversationResults && conversationResults.results.length > 0;
  const groupedArchivedSessions = groupArchivedSessionsByProject(archivedSessions);

  return (
    <div
      className="flex h-full flex-col bg-background/80 backdrop-blur-sm md:w-72 md:select-none"
      style={{}}
    >
      <SidebarHeader
        isPWA={isPWA}
        isMobile={isMobile}
        isLoading={isLoading}
        projectsCount={projects.length}
        runningSessionsCount={runningSessionsCount}
        archivedSessionsCount={archivedSessionsCount}
        isArchivedSessionsLoading={isArchivedSessionsLoading}
        searchFilter={searchFilter}
        onSearchFilterChange={onSearchFilterChange}
        onClearSearchFilter={onClearSearchFilter}
        searchMode={searchMode}
        onSearchModeChange={onSearchModeChange}
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
        onCreateProject={onCreateProject}
        onCollapseSidebar={onCollapseSidebar}
        t={t}
      />

      {/* Project selector dropdown */}
      <div className="flex-shrink-0 border-b border-border/40 px-3 py-2">
        <select
          className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-primary"
          value={projectListProps.selectedProject?.projectId || ''}
          onChange={(e) => {
            const project = projects.find(p => p.projectId === e.target.value);
            if (project) projectListProps.onProjectSelect(project);
          }}
        >
          {projects.length === 0 && <option value="">No projects</option>}
          {projects.map(p => (
            <option key={p.projectId} value={p.projectId}>
              {p.displayName || p.fullPath?.split('/').pop()}
            </option>
          ))}
        </select>
      </div>

      {/* File system view for the selected project */}
      <ScrollArea className="flex-1 overflow-y-auto overscroll-contain px-2 py-2">
        {projectListProps.selectedProject ? (
          <div className="space-y-0.5">
            <div className="px-2 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {projectListProps.selectedProject.displayName}
            </div>
            {/* Predefined folder shortcuts */}
            {['tasks', 'todos', 'src', 'docs'].map(dir => (
              <button
                key={dir}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent/50"
                onClick={() => {
                  // Switch to files tab — user can navigate from there
                  const event = new CustomEvent('amadeus:open-path', { detail: { path: dir } });
                  window.dispatchEvent(event);
                }}
              >
                <Folder className="h-3.5 w-3.5 text-muted-foreground" />
                <span>{dir}/</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="px-4 py-8 text-center">
            <Folder className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No project selected</p>
          </div>
        )}
      </ScrollArea>

      <SidebarFooter
        updateAvailable={updateAvailable}
        restartRequired={restartRequired}
        releaseInfo={releaseInfo}
        latestVersion={latestVersion}
        currentVersion={currentVersion}
        onShowVersionModal={onShowVersionModal}
        onShowSettings={onShowSettings}
        t={t}
      />
    </div>
  );
}
