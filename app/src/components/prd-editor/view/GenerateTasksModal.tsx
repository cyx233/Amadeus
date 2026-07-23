import { Loader2, Sparkles, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '../../../shared/view/ui';

type GenerateTasksModalProps = {
  isOpen: boolean;
  fileName: string;
  onClose: () => void;
  // Kicks off generation for this PRD (streams progress in a separate modal).
  onGenerate: () => void;
  // Generation reads the saved file from disk, so it's only enabled once the
  // PRD has been saved (no unsaved edits pending).
  canGenerate: boolean;
  generating: boolean;
};

export default function GenerateTasksModal({
  isOpen,
  fileName,
  onClose,
  onGenerate,
  canGenerate,
  generating,
}: GenerateTasksModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        wrapperClassName="z-[300]"
        className="z-[300] w-full max-w-md rounded-lg border border-gray-200 bg-white p-0 shadow-xl dark:border-gray-700 dark:bg-gray-800"
      >
        <DialogTitle>Generate Tasks from PRD</DialogTitle>
        <div className="flex items-center justify-between border-b border-gray-200 p-6 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/50">
              <Sparkles className="h-4 w-4 text-purple-600 dark:text-purple-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Generate Tasks from PRD</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            TaskMaster will parse <span className="font-mono text-xs">{fileName}</span> and generate a task set
            (its own tag, kept separate from other PRDs). This takes up to a couple of minutes.
          </p>

          {!canGenerate && (
            <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
              Save the PRD first — generation reads the saved file.
            </p>
          )}

          <button
            onClick={onGenerate}
            disabled={!canGenerate || generating}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {generating ? 'Generating…' : 'Generate Tasks'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
