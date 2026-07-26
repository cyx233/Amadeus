import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TreeItem, TreeItemIndex } from 'react-complex-tree';

import { api } from '../../../utils/api';
import { copyTextToClipboard } from '../../../utils/clipboard';
import type { FileTreeDataProvider } from '../data/FileTreeDataProvider';
import type { FileTreeItemData } from '../types/types';
import type { Project } from '../../../types/app';

type FileTreeItem = TreeItem<FileTreeItemData>;

// Invalid filename characters
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/;
const RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

export type ToastMessage = {
  message: string;
  type: 'success' | 'error';
};

export type DeleteConfirmation = {
  isOpen: boolean;
  // Right-click on an unselected item passes just that one item; right-click
  // (or a delete shortcut) on a multi-selection passes the whole selection —
  // the tree's data model treats both as "the set of items to delete."
  items: FileTreeItem[];
};

export type UseFileTreeOperationsOptions = {
  selectedProject: Project | null;
  dataProvider: FileTreeDataProvider | null;
  onRefresh: () => void;
  showToast: (message: string, type: 'success' | 'error') => void;
};

export type UseFileTreeOperationsResult = {
  // Delete operations
  deleteConfirmation: DeleteConfirmation;
  handleStartDelete: (items: FileTreeItem[]) => void;
  handleCancelDelete: () => void;
  handleConfirmDelete: () => Promise<void>;

  // Create operations
  isCreating: boolean;
  newItemParent: string;
  newItemType: 'file' | 'directory';
  newItemName: string;
  handleStartCreate: (parentPath: string, type: 'file' | 'directory') => void;
  handleCancelCreate: () => void;
  handleConfirmCreate: () => Promise<void>;
  setNewItemName: (name: string) => void;

  // Other operations
  handleCopyPath: (item: FileTreeItem) => Promise<void>;
  handleDownload: (item: FileTreeItem) => Promise<void>;

  // Clipboard (copy/paste) — items are captured by index, not by the
  // FileTreeItem snapshot at copy time, so a paste always targets each
  // source's current path even if it was renamed or moved after being
  // copied. Survives a paste (like a real OS clipboard) so Ctrl+V repeated
  // against the same or different target directories keeps working, each
  // one landing on a fresh auto-renamed "name (copy N)" via the backend's
  // collision handling — only replaced by the next Ctrl+C.
  clipboard: TreeItemIndex[] | null;
  handleCopyToClipboard: (items: FileTreeItem[]) => void;
  handlePaste: (targetDirIndex: TreeItemIndex) => Promise<void>;

  // Loading state
  operationLoading: boolean;

  // Validation — also used by the view layer's rename/create input forms
  // (react-complex-tree owns the rename lifecycle itself; this hook no
  // longer holds renamingItem/renameValue state) before submitting, so a
  // bad name never reaches the API.
  validateFilename: (name: string) => string | null;
};

export function useFileTreeOperations({
  selectedProject,
  dataProvider,
  onRefresh,
  showToast,
}: UseFileTreeOperationsOptions): UseFileTreeOperationsResult {
  const { t } = useTranslation();

  // State
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteConfirmation>({
    isOpen: false,
    items: [],
  });
  const [isCreating, setIsCreating] = useState(false);
  const [newItemParent, setNewItemParent] = useState('');
  const [newItemType, setNewItemType] = useState<'file' | 'directory'>('file');
  const [newItemName, setNewItemName] = useState('');
  const [operationLoading, setOperationLoading] = useState(false);

  // Validation
  const validateFilename = useCallback((name: string): string | null => {
    if (!name || !name.trim()) {
      return t('fileTree.validation.emptyName', 'Filename cannot be empty');
    }
    if (INVALID_FILENAME_CHARS.test(name)) {
      return t('fileTree.validation.invalidChars', 'Filename contains invalid characters');
    }
    if (RESERVED_NAMES.test(name)) {
      return t('fileTree.validation.reserved', 'Filename is a reserved name');
    }
    if (/^\.+$/.test(name)) {
      return t('fileTree.validation.dotsOnly', 'Filename cannot be only dots');
    }
    return null;
  }, [t]);

  // Delete operations
  const handleStartDelete = useCallback((items: FileTreeItem[]) => {
    if (items.length === 0) return;
    setDeleteConfirmation({ isOpen: true, items });
  }, []);

  const handleCancelDelete = useCallback(() => {
    setDeleteConfirmation({ isOpen: false, items: [] });
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    const { items } = deleteConfirmation;
    if (items.length === 0 || !selectedProject) return;

    setOperationLoading(true);
    try {
      const results = await Promise.all(
        items.map(async (item) => {
          const response = await api.deleteFile(selectedProject.projectId, {
            path: item.data.path,
            type: item.data.type,
          });
          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error((data as { error?: string }).error || `Failed to delete ${item.data.name}`);
          }
        }),
      );

      showToast(
        items.length === 1
          ? (items[0].data.type === 'directory'
            ? t('fileTree.toast.folderDeleted', 'Folder deleted')
            : t('fileTree.toast.fileDeleted', 'File deleted'))
          : t('fileTree.toast.itemsDeleted', '{{count}} items deleted', { count: results.length }),
        'success'
      );
      onRefresh();
      handleCancelDelete();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setOperationLoading(false);
    }
  }, [deleteConfirmation, selectedProject, showToast, t, onRefresh, handleCancelDelete]);

  // Create operations
  const handleStartCreate = useCallback((parentPath: string, type: 'file' | 'directory') => {
    setNewItemParent(parentPath || '');
    setNewItemType(type);
    setNewItemName(type === 'file' ? 'untitled.txt' : 'new-folder');
    setIsCreating(true);
  }, []);

  const handleCancelCreate = useCallback(() => {
    setIsCreating(false);
    setNewItemParent('');
    setNewItemName('');
  }, []);

  const handleConfirmCreate = useCallback(async () => {
    if (!selectedProject) return;

    const error = validateFilename(newItemName);
    if (error) {
      showToast(error, 'error');
      return;
    }

    setOperationLoading(true);
    try {
      const response = await api.createFile(selectedProject.projectId, {
        path: newItemParent,
        type: newItemType,
        name: newItemName,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create');
      }

      showToast(
        newItemType === 'file'
          ? t('fileTree.toast.fileCreated', 'File created successfully')
          : t('fileTree.toast.folderCreated', 'Folder created successfully'),
        'success'
      );
      onRefresh();
      handleCancelCreate();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setOperationLoading(false);
    }
  }, [selectedProject, newItemParent, newItemType, newItemName, validateFilename, showToast, t, onRefresh, handleCancelCreate]);

  // Copy path to clipboard
  const handleCopyPath = useCallback(async (item: FileTreeItem) => {
    // navigator.clipboard is undefined outside secure contexts (e.g. a LAN IP
    // over plain HTTP, how this app is commonly reached) — calling
    // .writeText on it throws synchronously, before any .catch can attach.
    // copyTextToClipboard guards that and falls back to execCommand('copy').
    const didCopy = await copyTextToClipboard(item.data.path);
    showToast(
      didCopy
        ? t('fileTree.toast.pathCopied', 'Path copied to clipboard')
        : t('fileTree.toast.copyFailed', 'Failed to copy path'),
      didCopy ? 'success' : 'error',
    );
  }, [showToast, t]);

  const triggerBrowserDownload = useCallback((blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = fileName;

    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    URL.revokeObjectURL(url);
  }, []);

  // Download a single file
  const downloadSingleFile = useCallback(async (item: FileTreeItem) => {
    if (!selectedProject) return;

    // Use the binary streaming endpoint so downloads preserve raw bytes.
    const response = await api.readFileBlob(selectedProject.projectId, item.data.path);

    if (!response.ok) {
      throw new Error('Failed to download file');
    }

    const blob = await response.blob();
    triggerBrowserDownload(blob, item.data.name);
  }, [selectedProject, triggerBrowserDownload]);

  // Download a folder as a server-built tar.gz. The backend streams the whole
  // subtree via `tar`, so the archive is complete regardless of which nodes the
  // lazily-loaded tree has expanded (the old client-side zip only saw loaded
  // children and silently dropped the rest).
  const downloadFolderAsZip = useCallback(async (folder: FileTreeItem) => {
    if (!selectedProject) return;

    const response = await api.downloadFolder(selectedProject.projectId, folder.data.path);
    if (!response.ok) {
      throw new Error('Failed to download folder');
    }
    const blob = await response.blob();
    triggerBrowserDownload(blob, `${folder.data.name}.tar.gz`);

    showToast(t('fileTree.toast.folderDownloaded', 'Folder downloaded'), 'success');
  }, [selectedProject, showToast, t, triggerBrowserDownload]);

  // Download file or folder
  const handleDownload = useCallback(async (item: FileTreeItem) => {
    if (!selectedProject) return;

    setOperationLoading(true);
    try {
      if (item.data.type === 'directory') {
        await downloadFolderAsZip(item);
      } else {
        await downloadSingleFile(item);
      }
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setOperationLoading(false);
    }
  }, [selectedProject, showToast, downloadFolderAsZip, downloadSingleFile]);

  // Copy/paste clipboard. Holds indices, not paths — pasteItems on the
  // provider re-resolves each index's CURRENT path at paste time, so
  // renaming or moving a copied item before pasting it still works.
  const [clipboard, setClipboard] = useState<TreeItemIndex[] | null>(null);

  const handleCopyToClipboard = useCallback((items: FileTreeItem[]) => {
    if (items.length === 0) return;
    setClipboard(items.map((item) => item.index));
    showToast(
      items.length === 1
        ? t('fileTree.toast.itemCopied', 'Copied')
        : t('fileTree.toast.itemsCopied', '{{count}} items copied', { count: items.length }),
      'success',
    );
  }, [showToast, t]);

  const handlePaste = useCallback(async (targetDirIndex: TreeItemIndex) => {
    if (!clipboard || clipboard.length === 0 || !dataProvider) return;

    setOperationLoading(true);
    try {
      await dataProvider.pasteItems(clipboard, targetDirIndex);
      showToast(
        clipboard.length === 1
          ? t('fileTree.toast.itemPasted', 'Pasted')
          : t('fileTree.toast.itemsPasted', '{{count}} items pasted', { count: clipboard.length }),
        'success',
      );
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setOperationLoading(false);
    }
  }, [clipboard, dataProvider, showToast, t]);

  return {
    // Delete operations
    deleteConfirmation,
    handleStartDelete,
    handleCancelDelete,
    handleConfirmDelete,

    // Create operations
    isCreating,
    newItemParent,
    newItemType,
    newItemName,
    handleStartCreate,
    handleCancelCreate,
    handleConfirmCreate,
    setNewItemName,

    // Other operations
    handleCopyPath,
    handleDownload,

    // Clipboard (copy/paste)
    clipboard,
    handleCopyToClipboard,
    handlePaste,

    // Loading state
    operationLoading,

    // Validation
    validateFilename,
  };
}
