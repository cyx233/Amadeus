import React, { useCallback, useEffect, useRef, useState } from 'react';

import ChatInterface from '../../chat/view/ChatInterface';
import StandaloneShell from '../../standalone-shell/view/StandaloneShell';
import GitPanel from '../../git-panel/view/GitPanel';
import type { MainContentProps } from '../types/types';
import { useTaskMaster } from '../../../contexts/TaskMasterContext';
import { usePaletteOpsRegister } from '../../../contexts/PaletteOpsContext';
import { useTasksSettings } from '../../../contexts/TasksSettingsContext';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useEditorSidebar } from '../../code-editor/hooks/useEditorSidebar';
import CodeEditor from '../../code-editor/view/CodeEditor';
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
  const [bottomHeight, setBottomHeight] = useState(250);
  const [chatWidth, setChatWidth] = useState(400);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const bottomDragRef = useRef<{ startY: number; startH: number } | null>(null);

  const {
    editingFile,
    handleFileOpen,
    handleCloseEditor,
    handleToggleEditorExpand,
  } = useEditorSidebar({
    selectedProject,
    isMobile,
  });

  // Expose handleFileOpen globally for sidebar file tree
  useEffect(() => {
    (window as any).__amadeus_openFile = handleFileOpen;
    return () => { delete (window as any).__amadeus_openFile; };
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

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: chatWidth };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = dragRef.current.startX - ev.clientX;
      setChatWidth(Math.max(280, Math.min(700, dragRef.current.startWidth + delta)));
    };
    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [chatWidth]);

  const onBottomDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    bottomDragRef.current = { startY: e.clientY, startH: bottomHeight };
    const onMove = (ev: MouseEvent) => {
      if (!bottomDragRef.current) return;
      const delta = bottomDragRef.current.startY - ev.clientY;
      setBottomHeight(Math.max(100, Math.min(500, bottomDragRef.current.startH + delta)));
    };
    const onUp = () => { bottomDragRef.current = null; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [bottomHeight]);

  if (isLoading) {
    return <MainContentStateView mode="loading" isMobile={isMobile} onMenuClick={onMenuClick} />;
  }

  if (!selectedProject) {
    return <MainContentStateView mode="empty" isMobile={isMobile} onMenuClick={onMenuClick} />;
  }

  return (
    <div className="flex h-full flex-col">
      {/* Top: Editor (left) + Chat (right) */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Editor */}
        <div className="flex min-w-[200px] flex-1 flex-col overflow-hidden">
          {editingFile ? (
            <CodeEditor
              file={editingFile}
              onClose={handleCloseEditor}
              projectPath={selectedProject?.path}
              isSidebar={true}
              isExpanded={false}
              onToggleExpand={handleToggleEditorExpand}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Select a file from the sidebar
            </div>
          )}
        </div>

        {/* Resize handle */}
        <div
          onMouseDown={onDragStart}
          className="group relative w-1.5 flex-shrink-0 cursor-col-resize bg-border/40 transition-colors hover:bg-primary/60"
          title="Drag to resize"
        >
          <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-primary opacity-0 transition-opacity group-hover:opacity-100" />
        </div>

        {/* Chat — always visible */}
        <div className="flex flex-col overflow-hidden" style={{ width: `${chatWidth}px`, minWidth: '280px' }}>
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
      <div className="flex-shrink-0">
        {/* Resize handle (only when panel open) */}
        {bottomPanel && (
          <div
            onMouseDown={onBottomDragStart}
            className="h-1 cursor-row-resize bg-border/40 transition-colors hover:bg-primary/60"
          />
        )}

        {/* Panel tab bar */}
        <div className="flex items-center gap-0 border-t border-border/60 bg-card/50 px-2">
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
          <div className="overflow-hidden" style={{ height: `${bottomHeight}px` }}>
            {bottomPanel === 'terminal' && (
              <StandaloneShell
                project={selectedProject}
                session={null}
                isPlainShell={true}
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
