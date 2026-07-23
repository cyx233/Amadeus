import { useEffect, useState } from 'react';
import { Loader2, Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Dialog, DialogContent, DialogTitle } from '../../../../shared/view/ui';
import { api } from '../../../../utils/api';
import { useTaskMaster } from '../../context/TaskMasterContext';

type CreateTaskModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export default function CreateTaskModal({ isOpen, onClose }: CreateTaskModalProps) {
  const { t } = useTranslation('tasks');
  const { currentProject, availableTags, selectedTags, selectTag, refreshTasks } = useTaskMaster();

  const [prompt, setPrompt] = useState('');
  const [priority, setPriority] = useState('medium');
  // TaskMaster's reserved default tag is 'master'; we surface it as "Default".
  const [tag, setTag] = useState('master');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default the target set to whatever's currently in view, so "add task" lands
  // where the user is looking. Reset the form each time the dialog opens.
  useEffect(() => {
    if (isOpen) {
      setTag(selectedTags[0] ?? 'master');
      setPrompt('');
      setPriority('medium');
      setError(null);
    }
  }, [isOpen, selectedTags]);

  // master always available as "Default"; merge in any real tags.
  const tagOptions = Array.from(new Set(['master', ...availableTags]));

  const handleSubmit = async () => {
    if (!currentProject?.projectId || !prompt.trim()) return;
    try {
      setIsSubmitting(true);
      setError(null);
      const response = await api.taskmaster.addTask(currentProject.projectId, {
        prompt: prompt.trim(),
        title: undefined,
        description: undefined,
        priority,
        dependencies: undefined,
        // omit tag for master so we hit TaskMaster's default path
        tag: tag === 'master' ? undefined : tag,
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
        throw new Error(data.message || data.error || 'Failed to add task');
      }
      selectTag(tag); // jump the board to the set we just added to
      await refreshTasks();
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to add task');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md overflow-hidden border-gray-200 bg-white p-0 dark:border-gray-700 dark:bg-gray-800">
        <DialogTitle>{t('createTask.title', 'Add Task')}</DialogTitle>
        <div className="flex items-center justify-between border-b border-gray-200 p-6 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/50">
              <Sparkles className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {t('createTask.title', 'Add Task')}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          {/* AI-generated task: TaskMaster expands the prompt into a full task. */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('createTask.promptLabel', 'Describe the task')}
            </label>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={t('createTask.promptPlaceholder', 'e.g. Add profile image uploads with validation')}
              rows={3}
              autoFocus
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('createTask.tagLabel', 'Task set')}
              </label>
              <select
                value={tag}
                onChange={(event) => setTag(event.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
              >
                {tagOptions.map((tagName) => (
                  <option key={tagName} value={tagName}>
                    {tagName === 'master' ? t('tags.default', 'Default') : tagName}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('createTask.priorityLabel', 'Priority')}
              </label>
              <select
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
              >
                <option value="high">{t('priorities.high', 'High')}</option>
                <option value="medium">{t('priorities.medium', 'Medium')}</option>
                <option value="low">{t('priorities.low', 'Low')}</option>
              </select>
            </div>
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          {/* Tip: chatting with the agent gives richer, context-aware tasks. */}
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-200">
            {t(
              'createTask.tip',
              'Tip: for richer, context-aware tasks, ask the agent in chat — it can research and break work down with implementation detail.',
            )}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
            >
              {t('actions.cancel', 'Cancel')}
            </button>
            <button
              onClick={() => { void handleSubmit(); }}
              disabled={isSubmitting || !prompt.trim()}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {t('createTask.submit', 'Generate task')}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
