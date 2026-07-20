import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDeviceSettings } from '../../../hooks/useDeviceSettings';
import { useVersionCheck } from '../../../hooks/useVersionCheck';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useSidebarController } from '../hooks/useSidebarController';
import { useTaskMaster } from '../../../contexts/TaskMasterContext';
import { usePaletteOps } from '../../../contexts/PaletteOpsContext';
import { useAuth } from '../../auth/context/AuthContext';
import GitPanel from '../../git-panel/view/GitPanel';
import type { Project } from '../../../types/app';
import type { MCPServerStatus, SidebarProps } from '../types/types';

import SidebarCollapsed, { type SidebarView } from './subcomponents/SidebarCollapsed';
import SidebarContent from './subcomponents/SidebarContent';
import TodoPanel from './subcomponents/TodoPanel';
import SidebarModals from './subcomponents/SidebarModals';

type TaskMasterSidebarContext = {
  setCurrentProject: (project: Project) => void;
  mcpServerStatus: MCPServerStatus;
};

function Sidebar({
  projects,
  selectedProject,
  selectedSession,
  activeSessions,
  attentionSessionIds: _attentionSessionIds,
  onProjectSelect,
  onSessionSelect,
  onNewSession,
  onSessionDelete,
  onLoadMoreSessions,
  onProjectDelete,
  isLoading,
  loadingProgress: _loadingProgress,
  onRefresh,
  onShowSettings,
  showSettings,
  settingsInitialTab,
  onCloseSettings,
  isMobile,
  expandedWidth = 288,
}: SidebarProps & { expandedWidth?: number }) {
  const { t } = useTranslation(['sidebar', 'common']);
  const [activeView, setActiveView] = useState<SidebarView>('explorer');
  const { isPWA } = useDeviceSettings({ trackMobile: false });
  const { updateAvailable, restartRequired, latestVersion, currentVersion, releaseInfo, installMode } = useVersionCheck(
    'siteboon',
    'claudecodeui',
  );
  const { preferences, setPreference } = useUiPreferences();
  const { sidebarVisible } = preferences;
  const { setCurrentProject } = useTaskMaster() as TaskMasterSidebarContext;
  const paletteOps = usePaletteOps();
  const { logout } = useAuth();

  const {
    isSidebarCollapsed,
    showNewProject,
    isRefreshing,
    searchFilter,
    deleteConfirmation,
    sessionDeleteConfirmation,
    showVersionModal,
    confirmDeleteSession,
    confirmDeleteProject,
    handleProjectSelect,
    refreshProjects,
    collapseSidebar: handleCollapseSidebar,
    expandSidebar: handleExpandSidebar,
    setShowNewProject,
    setSearchFilter,
    setDeleteConfirmation,
    setSessionDeleteConfirmation,
    setShowVersionModal,
  } = useSidebarController({
    projects,
    selectedProject,
    selectedSession,
    activeSessions,
    isLoading,
    isMobile,
    t,
    onRefresh,
    onProjectSelect,
    onSessionSelect,
    onSessionDelete,
    onLoadMoreSessions,
    onProjectDelete,
    setCurrentProject,
    setSidebarVisible: (visible) => setPreference('sidebarVisible', visible),
    sidebarVisible,
  });

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.classList.toggle('pwa-mode', isPWA);
    document.body.classList.toggle('pwa-mode', isPWA);
  }, [isPWA]);

  return (
    <div className="flex h-full flex-shrink-0">
      {/* Activity bar — always visible */}
      <SidebarCollapsed
        activeView={isSidebarCollapsed ? null : activeView}
        onSelectView={(view) => {
          if (!isSidebarCollapsed && view === activeView) {
            handleCollapseSidebar();
          } else {
            setActiveView(view);
            if (isSidebarCollapsed) handleExpandSidebar();
          }
        }}
        onShowSettings={onShowSettings}
        onLogout={logout}
        t={t}
      />

      {/* Panel — toggled */}
      {!isSidebarCollapsed && (
        <div className="h-full border-r border-border/40" style={{ width: `${expandedWidth}px` }}>
          {activeView === 'explorer' && (
            <SidebarContent
              isLoading={isLoading}
              projects={projects}
              selectedProject={selectedProject}
              selectedSession={selectedSession}
              onProjectSelect={handleProjectSelect}
              onSessionSelect={onSessionSelect}
              onNewSession={() => { if (selectedProject) onNewSession(selectedProject); }}
              searchFilter={searchFilter}
              onSearchFilterChange={setSearchFilter}
              onRefresh={() => refreshProjects()}
              isRefreshing={isRefreshing}
              onCreateProject={() => setShowNewProject(true)}
              onCollapseSidebar={handleCollapseSidebar}
            />
          )}
          {activeView === 'git' && (
            <GitPanel
              selectedProject={selectedProject}
              compact={true}
              onFileOpen={(filePath, diffInfo) => (window as any).__amadeus_openFile?.(filePath, diffInfo)}
            />
          )}
          {activeView === 'todo' && (
            <TodoPanel />
          )}
        </div>
      )}

      <SidebarModals
        projects={projects}
        showSettings={showSettings}
        settingsInitialTab={settingsInitialTab}
        onCloseSettings={onCloseSettings}
        showNewProject={showNewProject}
        onCloseNewProject={() => setShowNewProject(false)}
        onProjectCreated={() => { void paletteOps.refreshProjects(); }}
        deleteConfirmation={deleteConfirmation}
        onCancelDeleteProject={() => setDeleteConfirmation(null)}
        onConfirmDeleteProject={confirmDeleteProject}
        sessionDeleteConfirmation={sessionDeleteConfirmation}
        onCancelDeleteSession={() => setSessionDeleteConfirmation(null)}
        onConfirmDeleteSession={confirmDeleteSession}
        showVersionModal={showVersionModal}
        onCloseVersionModal={() => setShowVersionModal(false)}
        releaseInfo={releaseInfo}
        currentVersion={currentVersion}
        latestVersion={latestVersion}
        installMode={installMode}
        t={t}
      />

    </div>
  );
}

export default Sidebar;
