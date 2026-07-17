import { AlertTriangle, Save } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '../../../shared/view/ui';

type OverwriteConfirmModalProps = {
  isOpen: boolean;
  fileName: string;
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function OverwriteConfirmModal({
  isOpen,
  fileName,
  saving,
  onCancel,
  onConfirm,
}: OverwriteConfirmModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        wrapperClassName="z-[300]"
        className="z-[300] w-full max-w-md rounded-lg border border-gray-200 bg-white p-0 shadow-xl dark:border-gray-700 dark:bg-gray-800"
      >
        <DialogTitle>File Already Exists</DialogTitle>
        <div className="p-6">
          <div className="mb-4 flex items-center">
            <div className="mr-3 rounded-full bg-yellow-100 p-2 dark:bg-yellow-900">
              <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">File Already Exists</h3>
          </div>

          <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">
            A PRD named "{fileName}" already exists. Do you want to overwrite it?
          </p>

          <div className="flex justify-end gap-3">
            <button
              onClick={onCancel}
              disabled={saving}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={saving}
              className="flex items-center gap-2 rounded-md bg-yellow-600 px-4 py-2 text-sm text-white transition-colors hover:bg-yellow-700 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              <span>{saving ? 'Saving...' : 'Overwrite'}</span>
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
