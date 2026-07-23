import { useEffect, useRef } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import type { GenerateProgress } from '../../hooks/useGenerateTasks';

type GenerateProgressModalProps = {
  progress: GenerateProgress;
  onStop: () => void;
  onClose: () => void;
};

// Live parse-prd output + a Stop control. Rendered via portal so it overlays
// regardless of where it's mounted (toolbar or PRD editor).
export default function GenerateProgressModal({ progress, onStop, onClose }: GenerateProgressModalProps) {
  const { t } = useTranslation('tasks');
  const running = progress.status === 'running';
  const logRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to the newest line as progress streams in.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [progress.lines]);

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center gap-2 border-b border-gray-200 p-4 dark:border-gray-700">
          {running ? (
            <Loader2 className="h-4 w-4 animate-spin text-purple-600" />
          ) : progress.status === 'done' ? (
            <Check className="h-4 w-4 text-green-600" />
          ) : (
            <X className="h-4 w-4 text-red-600" />
          )}
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900 dark:text-white">
            {t('tags.generateTasks', 'Generate tasks from this PRD')} — {progress.prdName}
          </h3>
        </div>

        <div
          ref={logRef}
          className="max-h-72 overflow-y-auto bg-gray-50 p-3 font-mono text-xs text-gray-700 dark:bg-gray-900 dark:text-gray-300"
        >
          {progress.lines.length === 0 ? (
            <div className="text-gray-400">{t('tags.starting', 'Starting…')}</div>
          ) : (
            progress.lines.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap break-words">
                {line}
              </div>
            ))
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 p-3 dark:border-gray-700">
          {running ? (
            <button
              onClick={onStop}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
            >
              {t('actions.stop', 'Stop')}
            </button>
          ) : (
            <button
              onClick={onClose}
              className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
            >
              {t('actions.close', 'Close')}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
