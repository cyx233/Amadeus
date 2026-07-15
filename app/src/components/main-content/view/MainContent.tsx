import React, { useCallback, useEffect, useState } from 'react';

import ChatInterface from '../../chat/view/ChatInterface';
import StandaloneShell from '../../standalone-shell/view/StandaloneShell';
import GitPanel from '../../git-panel/view/GitPanel';
import type { MainContentProps } from '../types/types';
import { useTaskMaster } from '../../../contexts/TaskMasterContext';
import { usePaletteOpsRegister } from '../../../contexts/PaletteOpsContext';
import { useTasksSettings } from '../../../contexts/TasksSettingsContext';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useEditorSidebar } from '../../code-editor/hooks/useEditorSidebar';
import EditorSidebar from '../../code-editor/view/EditorSidebar';
import type { Project } from '../../../types/app';
import { TaskMasterPanel } from '../../task-master';

import MainContentStateView from './subcomponents/MainContentStateView';
import ErrorBoundary from './ErrorBoundary';

type TaskMasterContextValue = {
  currentProject?: Project | null;
  setCurrentProject?: ((project: Project) => void) | null;
};

type TasksSettingsContextValue = {
  tasksEnabled: boolean;
  isTaskMasterInstalled: boolean | null;
  isTaskMasterReady: boolean | null;
};

function MainContent({
  selectedProject,
  selectedSession,
  activeTab: _activeTab,
  setActiveTab: _setActiveTab,
  ws,
  sendMessage,
  isMobile,
  onMenuClick,
  isLoading,
  onInputFocusChange,
  onSessionProcessing,
  onSessionIdle,
  processingSessions,
  onNavigateToSession,
  onSessionEstablished,
  onShowSettings,
  externalMessageUpdate,
  newSessionTrigger,
}: MainContentProps) {
  const { preferences } = useUiPreferences();
  const { showRawParameters, showThinking, sendByCtrlEnter } = preferences;

  const { currentProject, setCurrentProject } = useTaskMaster() as TaskMasterContextValue;
  const { tasksEnabled } = useTasksSettings() as TasksSettingsContextValue;
  const [bottomPanel, setBottomPanel] = useState<'terminal' | 'tasks' | 'git' | null>(null);

  const {
    editingFile,
    editorWidth,
    editorExpanded,
    hasManualWidth,
    resizeHandleRef,
    handleFileOpen,
    handleCloseEditor,
    handleToggleEditorExpand,
    handleResizeStart,
  } = useEditorSidebar({
    selectedProject,
    isMobile,
  });

  // Listen for file-open events from sidebar file tree
  useEffect(() => {
    const handler = (e: Event) => {
      const path = (e as CustomEvent).detail?.path;
      if (path) handleFileOpen(path);
    };
    window.addEventListener('amadeus:file-open', handler);
    return () => window.removeEventListener('amadeus:file-open', handler);
  }, [handleFileOpen]);

  useEffect(() => {
    const selectedProjectId = selectedProject?.projectId;
    const currentProjectId = currentProject?.projectId;
    if (selectedProject && selectedProjectId !== currentProjectId) {
      setCurrentProject?.(selectedProject);
    }
  }, [selectedProject, currentProject?.projectId, setCurrentProject]);

  usePaletteOpsRegister({
    openFile: (filePath: string) => handleFileOpen(filePath),
    openFileInEditor: (filePath: string) => handleFileOpen(filePath),
  });

  if (isLoading) {
    return <MainContentStateView mode="loading" isMobile={isMobile} onMenuClick={onMenuClick} />;
  }

  if (!selectedProject) {
    return <MainContentStateView mode="empty" isMobile={isMobile} onMenuClick={onMenuClick} />;
  }

  return (
    <div className="flex h-full flex-col">
      {/* Top: Editor (left) + Chat (right) — fixed three-column with sidebar */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Editor */}
        <EditorSidebar
          editingFile={editingFile}
          isMobile={isMobile}
          editorExpanded={editorExpanded}
          editorWidth={editorWidth}
          hasManualWidth={hasManualWidth}
          resizeHandleRef={resizeHandleRef}
          onResizeStart={handleResizeStart}
          onCloseEditor={handleCloseEditor}
          onToggleEditorExpand={handleToggleEditorExpand}
          projectPath={selectedProject?.path}
          fillSpace={true}
        />

        {/* Chat — always visible */}
        <div className="flex min-w-[300px] max-w-[480px] flex-1 flex-col overflow-hidden border-l border-border/60">
          <ErrorBoundary showDetails>
            <ChatInterface
              selectedProject={selectedProject}
              selectedSession={selectedSession}
              ws={ws}
              sendMessage={sendMessage}
              onFileOpen={handleFileOpen}
              onInputFocusChange={onInputFocusChange}
              onSessionProcessing={onSessionProcessing}
              onSessionIdle={onSessionIdle}
              processingSessions={processingSessions}
              onNavigateToSession={onNavigateToSession}
              onSessionEstablished={onSessionEstablished}
              onShowSettings={onShowSettings}
              showRawParameters={showRawParameters}
              showThinking={showThinking}
              sendByCtrlEnter={sendByCtrlEnter}
              externalMessageUpdate={externalMessageUpdate}
              newSessionTrigger={newSessionTrigger}
              onShowAllTasks={() => setBottomPanel('tasks')}
            />
          </ErrorBoundary>
        </div>
      </div>

      {/* Bottom panel: Terminal / Tasks / Git */}
      <div className="flex-shrink-0 border-t border-border/60">
        {/* Panel tab bar */}
        <div className="flex items-center gap-0 bg-card/50 px-2">
          {(['terminal', 'tasks', 'git'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setBottomPanel(prev => prev === tab ? null : tab)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                bottomPanel === tab
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab === 'terminal' ? 'Terminal' : tab === 'tasks' ? 'Tasks' : 'Git'}
            </button>
          ))}
        </div>

        {/* Panel content */}
        {bottomPanel && (
          <div className="h-[250px] overflow-hidden">
            {bottomPanel === 'terminal' && (
              <StandaloneShell
                project={selectedProject}
                session={selectedSession}
                showHeader={false}
                isActive={true}
              />
            )}
            {bottomPanel === 'tasks' && (
              <TaskMasterPanel isVisible={true} />
            )}
            {bottomPanel === 'git' && (
              <GitPanel selectedProject={selectedProject} isMobile={isMobile} onFileOpen={handleFileOpen} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default React.memo(MainContent);
