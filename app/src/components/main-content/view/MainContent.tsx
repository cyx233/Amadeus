import React, { useCallback, useEffect, useRef, useState } from 'react';

import ChatInterface from '../../chat/view/ChatInterface';
import StandaloneShell from '../../standalone-shell/view/StandaloneShell';
import { TaskMasterPanel } from '../../task-master';
import type { MainContentProps } from '../types/types';
import { useTaskMaster } from '../../../contexts/TaskMasterContext';
import { usePaletteOpsRegister } from '../../../contexts/PaletteOpsContext';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useEditorSidebar } from '../../code-editor/hooks/useEditorSidebar';
import CodeEditor from '../../code-editor/view/CodeEditor';
import type { Project } from '../../../types/app';

import MainContentStateView from './subcomponents/MainContentStateView';
import ErrorBoundary from './ErrorBoundary';

type TaskMasterContextValue = {
  currentProject?: Project | null;
  setCurrentProject?: ((project: Project) => void) | null;
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
  const [bottomPanel, setBottomPanel] = useState<'terminal' | 'tasks' | null>(null);
  const [bottomHeight, setBottomHeight] = useState(250);
  const [chatPercent, setChatPercent] = useState(50);
  const bottomDragRef = useRef<{ startY: number; startH: number } | null>(null);

  const {
    editingFile,
    handleFileOpen,
    handleCloseEditor,
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

  const containerRef = useRef<HTMLDivElement>(null);
  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const startX = e.clientX;
    const startPercent = chatPercent;
    const containerWidth = container.getBoundingClientRect().width;
    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX;
      const deltaPercent = (delta / containerWidth) * 100;
      setChatPercent(Math.max(20, Math.min(80, startPercent + deltaPercent)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [chatPercent]);

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
      <div ref={containerRef} className="flex min-h-0 flex-1 overflow-hidden">
        {/* Editor */}
        <div className="flex flex-col overflow-hidden" style={{ width: `${100 - chatPercent}%`, minWidth: '20%' }}>
          {editingFile ? (
            <CodeEditor
              file={editingFile}
              onClose={handleCloseEditor}
              projectPath={selectedProject?.path}
              isSidebar={true}
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
        <div className="flex flex-col overflow-hidden" style={{ width: `${chatPercent}%`, minWidth: '20%' }}>
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

        {/* Terminal tab bar */}
        <div className="flex items-center border-t border-border/60 bg-card/50 px-2">
          <button
            onClick={() => setBottomPanel(prev => prev === 'terminal' ? null : 'terminal')}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              bottomPanel === 'terminal'
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Terminal
          </button>
          <button
            onClick={() => setBottomPanel(prev => prev === 'tasks' ? null : 'tasks')}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              bottomPanel === 'tasks'
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Tasks
          </button>
          {bottomPanel && (
            <button
              onClick={() => setBottomPanel(null)}
              className="ml-auto px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              title="Close panel"
            >
              ✕
            </button>
          )}
        </div>

        {/* Terminal content */}
        {bottomPanel === 'terminal' && (
          <div className="overflow-hidden" style={{ height: `${bottomHeight}px` }}>
            <StandaloneShell
              project={selectedProject}
              session={null}
              isPlainShell={true}
              showHeader={false}
              isActive={true}
            />
          </div>
        )}

        {/* Tasks content */}
        {bottomPanel === 'tasks' && (
          <div className="overflow-hidden" style={{ height: `${bottomHeight}px` }}>
            <TaskMasterPanel isVisible={true} />
          </div>
        )}
      </div>
    </div>
  );
}

export default React.memo(MainContent);
