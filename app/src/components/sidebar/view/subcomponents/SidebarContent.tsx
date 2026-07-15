import { ScrollArea } from '../../../../shared/view/ui';
import type { Project } from '../../../../types/app';
import type { ReleaseInfo } from '../../../../types/sharedTypes';

import SidebarFooter from './SidebarFooter';
import SidebarFileTree from './SidebarFileTree';
import SidebarHeader from './SidebarHeader';

type SidebarContentProps = {
  isLoading: boolean;
  projects: Project[];
  selectedProject: Project | null;
  onProjectSelect: (project: Project) => void;
  searchFilter: string;
  onSearchFilterChange: (value: string) => void;
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
};

export default function SidebarContent({
  isLoading,
  projects,
  selectedProject,
  onProjectSelect,
  searchFilter,
  onSearchFilterChange,
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
}: SidebarContentProps) {
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
      <div className="flex-shrink-0 border-b border-border/40 px-3 py-2">
        <select
          className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-primary"
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
      </div>

      {/* File tree */}
      <ScrollArea className="flex-1 overflow-y-auto overscroll-contain px-1 py-1">
        <SidebarFileTree selectedProject={selectedProject} />
      </ScrollArea>

      <SidebarFooter
        updateAvailable={updateAvailable}
        restartRequired={restartRequired}
        releaseInfo={releaseInfo}
        latestVersion={latestVersion}
        currentVersion={currentVersion}
        onShowVersionModal={onShowVersionModal}
        onShowSettings={onShowSettings}
      />
    </div>
  );
}
