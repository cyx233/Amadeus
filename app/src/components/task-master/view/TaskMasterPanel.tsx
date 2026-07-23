import { useCallback, useEffect, useRef, useState } from 'react';
import PRDEditor from '../../prd-editor';
import { api } from '../../../utils/api';
import { useTaskMaster } from '../context/TaskMasterContext';
import { useProjectPrdFiles } from '../hooks/useProjectPrdFiles';
import type { PrdFile, TaskId, TaskMasterTask, TaskSelection } from '../types';
import TaskBoard from './TaskBoard';
import TaskDetailModal from './TaskDetailModal';

type TaskMasterPanelProps = {
  isVisible: boolean;
};

const PRD_SAVE_MESSAGE = 'PRD saved successfully!';

export default function TaskMasterPanel({ isVisible }: TaskMasterPanelProps) {
  const { tasks, currentProject, refreshTasks } = useTaskMaster();

  const [selectedTask, setSelectedTask] = useState<TaskMasterTask | null>(null);
  const [isTaskDetailOpen, setIsTaskDetailOpen] = useState(false);

  // Keep the open modal's task in sync with the refreshed list: a status change
  // calls refreshTasks(), which replaces `tasks`, but `selectedTask` is a
  // separate snapshot. Re-derive it (matched by id + sourceTag, since ids repeat
  // across tags) so the modal shows the new status instead of the stale one.
  useEffect(() => {
    if (!selectedTask) return;
    const fresh = tasks.find(
      (task) => String(task.id) === String(selectedTask.id) && task.sourceTag === selectedTask.sourceTag,
    );
    if (fresh && fresh !== selectedTask) {
      setSelectedTask(fresh);
    }
  }, [tasks, selectedTask]);

  const [isPrdEditorOpen, setIsPrdEditorOpen] = useState(false);
  const [selectedPrd, setSelectedPrd] = useState<PrdFile | null>(null);

  const [prdNotification, setPrdNotification] = useState<string | null>(null);
  const notificationTimeoutRef = useRef<number | null>(null);

  const { prdFiles, refreshPrdFiles } = useProjectPrdFiles({ projectId: currentProject?.projectId });

  const showPrdNotification = useCallback((message: string) => {
    if (notificationTimeoutRef.current) {
      window.clearTimeout(notificationTimeoutRef.current);
    }

    setPrdNotification(message);

    notificationTimeoutRef.current = window.setTimeout(() => {
      setPrdNotification(null);
      notificationTimeoutRef.current = null;
    }, 3000);
  }, []);

  const refreshPrdData = useCallback(
    async (showNotification = false) => {
      await refreshPrdFiles();
      if (showNotification) {
        showPrdNotification(PRD_SAVE_MESSAGE);
      }
    },
    [refreshPrdFiles, showPrdNotification],
  );

  useEffect(() => {
    return () => {
      if (notificationTimeoutRef.current) {
        window.clearTimeout(notificationTimeoutRef.current);
      }
    };
  }, []);

  const handleTaskClick = useCallback(
    (taskSelection: TaskSelection) => {
      const selectedId = String(taskSelection.id);

      if (!taskSelection.title) {
        const fullTask = tasks.find((task) => String(task.id) === selectedId) ?? null;
        if (fullTask) {
          setSelectedTask(fullTask);
          setIsTaskDetailOpen(true);
        }
        return;
      }

      setSelectedTask(taskSelection as TaskMasterTask);
      setIsTaskDetailOpen(true);
    },
    [tasks],
  );

  // Drag-and-drop status change: dropping a card on a column sets that status.
  // Same path as the modal dropdown (set_task_status via the update-task route),
  // then refresh so the board reflects it. sourceTag keeps the write on the right
  // per-PRD tag when several are merged into the view.
  const handleTaskStatusChange = useCallback(
    async (taskId: TaskId, status: string, sourceTag?: string) => {
      if (!currentProject?.projectId) return;
      try {
        const payload: Record<string, unknown> = { status };
        if (sourceTag) payload.tag = sourceTag;
        const response = await api.taskmaster.updateTask(currentProject.projectId, taskId, payload);
        if (!response.ok) {
          const errorPayload = (await response.json()) as { message?: string };
          throw new Error(errorPayload.message ?? 'Failed to update task status');
        }
        await refreshTasks();
      } catch (error) {
        console.error('Failed to update task status:', error);
        alert(error instanceof Error ? error.message : 'Failed to update task status');
      }
    },
    [currentProject?.projectId, refreshTasks],
  );

  return (
    <>
      <div className={`h-full ${isVisible ? 'block' : 'hidden'}`}>
        <div className="flex h-full flex-col overflow-hidden">
          <TaskBoard
            tasks={tasks}
            onTaskClick={handleTaskClick}
            onTaskStatusChange={handleTaskStatusChange}
            showParentTasks
            className="flex-1 overflow-y-auto p-4"
            currentProject={currentProject}
            onTaskCreated={refreshTasks}
            onShowPRDEditor={(prd) => {
              setSelectedPrd(prd ?? null);
              setIsPrdEditorOpen(true);
            }}
            existingPRDs={prdFiles}
            onRefreshPRDs={(showNotification = false) => {
              void refreshPrdData(showNotification);
            }}
          />
        </div>
      </div>

      <TaskDetailModal
        task={selectedTask}
        isOpen={isTaskDetailOpen}
        onClose={() => {
          setIsTaskDetailOpen(false);
          setSelectedTask(null);
        }}
        onStatusChange={() => {
          void refreshTasks();
        }}
        onTaskClick={handleTaskClick}
      />

      {isPrdEditorOpen && (
        <PRDEditor
          project={currentProject}
          projectPath={currentProject?.fullPath || currentProject?.path}
          onClose={() => {
            setIsPrdEditorOpen(false);
            setSelectedPrd(null);
          }}
          isNewFile={!selectedPrd?.isExisting}
          file={{
            name: selectedPrd?.name || 'prd.txt',
            content: selectedPrd?.content || '',
            isExisting: selectedPrd?.isExisting,
          }}
          onSave={async () => {
            setIsPrdEditorOpen(false);
            setSelectedPrd(null);
            await refreshPrdData(true);
            await refreshTasks();
          }}
        />
      )}

      {prdNotification && (
        <div className="animate-in slide-in-from-bottom-2 fixed bottom-4 right-4 z-50 duration-300">
          <div className="flex items-center gap-3 rounded-lg bg-green-600 px-4 py-3 text-white shadow-lg">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="font-medium">{prdNotification}</span>
          </div>
        </div>
      )}
    </>
  );
}
