import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, X, Loader2, Folder, Search, Upload } from 'lucide-react';
import {
  UncontrolledTreeEnvironment,
  Tree,
  type TreeEnvironmentRef,
  type TreeItem,
  type TreeRef,
  type TreeViewState,
} from 'react-complex-tree';

import { cn } from '../../../lib/utils';
import { ICON_SIZE_CLASS, getFileIconData } from '../constants/fileIcons';
import { FileTreeDataProvider, ROOT_ITEM_INDEX } from '../data/FileTreeDataProvider';
import { useFileTreeOperations } from '../hooks/useFileTreeOperations';
import { useFileTreeViewMode } from '../hooks/useFileTreeViewMode';
import { useFileTreeUpload } from '../hooks/useFileTreeUpload';
import type { FileTreeImageSelection, FileTreeItemData } from '../types/types';
import { isImageFile } from '../utils/fileTreeUtils';
import { Project } from '../../../types/app';
import { Input } from '../../../shared/view/ui';

import FileContextMenu from './FileContextMenu';
import FileTreeDetailedColumns from './FileTreeDetailedColumns';
import FileTreeEmptyState from './FileTreeEmptyState';
import FileTreeHeader from './FileTreeHeader';
import FileTreeLoadingState from './FileTreeLoadingState';
import FileTreeRow from './FileTreeRow';
import FileTreeUploadProgress from './FileTreeUploadProgress';
import ImageViewer from './ImageViewer';

type FileTreeItem = TreeItem<FileTreeItemData>;

const TREE_ID = 'project-files';

type FileTreeProps = {
  selectedProject: Project | null;
  onFileOpen?: (filePath: string) => void;
};

export default function FileTree({ selectedProject, onFileOpen }: FileTreeProps) {
  const { t } = useTranslation();
  const [selectedImage, setSelectedImage] = useState<FileTreeImageSelection | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const newItemInputRef = useRef<HTMLInputElement>(null);
  // setSearch lives on the Tree instance's own imperative handle, not as a
  // top-level UncontrolledTreeEnvironment prop — this ref is how the header's
  // search button starts a search from outside the tree.
  const treeRef = useRef<TreeRef<FileTreeItemData>>(null);
  // UncontrolledTreeEnvironment's own imperative handle — its
  // dragAndDropContext.draggingItems is how the upload hook's outer
  // drag/drop handlers (bound on the container div wrapping this whole
  // environment) tell a tree-internal node drag (a move) apart from an OS
  // file being dragged in (an upload) — the browser fires the same
  // dragenter/dragover/drop events for both, so without this check they'd
  // collide (the upload overlay flashing during a node drag, and
  // handleDrop trying to read real File objects out of the tree's internal
  // drag payload).
  const treeEnvironmentRef = useRef<TreeEnvironmentRef<FileTreeItemData>>(null);
  const isTreeInternalDrag = useCallback(
    () => Boolean(treeEnvironmentRef.current?.dragAndDropContext.draggingItems?.length),
    [],
  );

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
  }, []);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const { viewMode, changeViewMode } = useFileTreeViewMode();

  // One provider instance per project — it owns the index<->path mapping, so
  // switching projects must start a fresh mapping rather than reusing a
  // stale one keyed to the previous project's paths. Deliberately keyed only
  // on projectId (not the whole selectedProject object): a new object with
  // the same id — e.g. the parent re-fetching project metadata — must NOT
  // rebuild the provider and lose everything it has already indexed.
  const dataProvider = useMemo(
    () => (selectedProject ? new FileTreeDataProvider(selectedProject.projectId) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedProject?.projectId],
  );

  // react-complex-tree has no built-in "initial load" concept — each item
  // fetches independently on first render. Root is special-cased here so the
  // tree can show a loading state up front and an empty state if the
  // project genuinely has nothing, matching what the old useFileTreeData-
  // driven UI showed before this rewrite.
  const [rootStatus, setRootStatus] = useState<'loading' | 'empty' | 'ready'>('loading');

  useEffect(() => {
    if (!dataProvider) return;
    setRootStatus('loading');
    let cancelled = false;

    dataProvider.getTreeItem(ROOT_ITEM_INDEX).then((rootItem) => {
      if (cancelled) return;
      setRootStatus((rootItem.children?.length ?? 0) > 0 ? 'ready' : 'empty');
    });

    return () => {
      cancelled = true;
    };
  }, [dataProvider]);

  const [viewState, setViewState] = useState<TreeViewState<never>>({});
  const treeViewState = viewState[TREE_ID];

  const selectedItems = useMemo(
    () =>
      (treeViewState?.selectedItems ?? [])
        .map((index) => dataProvider?.getNodeForIndex(index))
        .filter((node): node is NonNullable<typeof node> => Boolean(node))
        .map((node): FileTreeItem => ({
          index: node.index,
          isFolder: node.type === 'directory',
          data: { name: node.name, type: node.type, path: node.path, size: node.size, modified: node.modified, permissionsRwx: node.permissionsRwx },
        })),
    [treeViewState?.selectedItems, dataProvider],
  );

  const refreshFiles = useCallback(async () => {
    if (!dataProvider) return;
    // invalidateChildren itself emits the change notification that makes
    // UncontrolledTreeEnvironment re-fetch and re-render — no separate
    // setViewState nudge needed (see invalidateChildren's own comment for
    // why that emit has to happen for a refresh to be visible at all).
    dataProvider.invalidateChildren(ROOT_ITEM_INDEX);
    // Re-invalidate every directory currently expanded so a refresh picks up
    // changes at any depth the user has drilled into, not just the root —
    // mirrors the old useFileTreeData rehydration behavior this replaces.
    for (const index of treeViewState?.expandedItems ?? []) {
      dataProvider.invalidateChildren(index);
    }

    const rootItem = await dataProvider.getTreeItem(ROOT_ITEM_INDEX);
    setRootStatus((rootItem.children?.length ?? 0) > 0 ? 'ready' : 'empty');
  }, [dataProvider, treeViewState?.expandedItems]);

  const operations = useFileTreeOperations({
    selectedProject,
    dataProvider,
    onRefresh: refreshFiles,
    showToast,
  });

  const upload = useFileTreeUpload({
    selectedProject,
    onRefresh: refreshFiles,
    showToast,
    isTreeInternalDrag,
  });
  const operationLoading = operations.operationLoading || upload.operationLoading;

  useEffect(() => {
    if (operations.isCreating && newItemInputRef.current) {
      newItemInputRef.current.focus();
      newItemInputRef.current.select();
    }
  }, [operations.isCreating]);

  const handlePrimaryAction = useCallback(
    (item: FileTreeItem) => {
      if (item.data.type === 'directory') {
        return;
      }

      if (isImageFile(item.data.name) && selectedProject) {
        setSelectedImage({
          name: item.data.name,
          path: item.data.path,
          projectPath: selectedProject.path,
          projectId: selectedProject.projectId,
        });
        return;
      }

      onFileOpen?.(item.data.path);
    },
    [onFileOpen, selectedProject],
  );

  const handleStartCreateAtRoot = useCallback(
    (type: 'file' | 'directory') => operations.handleStartCreate('', type),
    [operations],
  );

  const collapseAll = useCallback(() => {
    setViewState((previous) => ({
      ...previous,
      [TREE_ID]: { ...previous[TREE_ID], expandedItems: [] },
    }));
  }, []);

  // Ctrl/Cmd+C and Ctrl/Cmd+V for the tree — react-complex-tree has no
  // built-in copy/paste keyboard binding (only rename/select/navigate), so
  // this is bound at the tree container level rather than through the
  // library's keyboardBindings config. Guarded on the active element so a
  // real text selection (rename input, new-item input, the tree's own
  // search box, or any input elsewhere on the page) keeps using the
  // browser's native copy/paste instead of being hijacked.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;

      if (e.key === 'c' || e.key === 'C') {
        if (selectedItems.length === 0) return;
        e.preventDefault();
        operations.handleCopyToClipboard(selectedItems);
      } else if (e.key === 'v' || e.key === 'V') {
        if (!operations.clipboard || !dataProvider) return;
        e.preventDefault();
        const targetDir = dataProvider.resolvePasteTargetDir(treeViewState?.focusedItem);
        void operations.handlePaste(targetDir);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [dataProvider, operations, selectedItems, treeViewState?.focusedItem]);

  if (!dataProvider) {
    return null;
  }

  return (
    <div
      ref={upload.treeRef}
      className="relative flex h-full flex-col bg-background"
      onDragEnter={upload.handleDragEnter}
      onDragOver={upload.handleDragOver}
      onDragLeave={upload.handleDragLeave}
      onDrop={upload.handleDrop}
    >
      {upload.isDragOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center border-2 border-dashed border-blue-500 bg-blue-500/10">
          <div className="flex items-center gap-3 rounded-lg bg-background/95 px-6 py-4 shadow-lg">
            <Upload className="h-6 w-6 text-blue-500" />
            <span className="text-sm font-medium">{t('fileTree.dropToUpload', 'Drop files to upload')}</span>
          </div>
        </div>
      )}

      <FileTreeHeader
        viewMode={viewMode}
        onViewModeChange={changeViewMode}
        onUploadFiles={upload.handleFileSelect}
        onNewFile={() => handleStartCreateAtRoot('file')}
        onNewFolder={() => handleStartCreateAtRoot('directory')}
        onRefresh={refreshFiles}
        onCollapseAll={collapseAll}
        onStartSearch={() => treeRef.current?.setSearch('')}
        operationLoading={operationLoading}
        isUploading={upload.uploadProgress?.status === 'uploading'}
        uploadProgress={upload.uploadProgress?.progress ?? null}
      />

      <FileTreeUploadProgress upload={upload.uploadProgress} />

      {viewMode === 'detailed' && <FileTreeDetailedColumns />}

      <div className="flex-1 overflow-auto px-2 py-1">
        {operations.isCreating && (
          <div
            className="mb-1 flex items-center gap-1.5 py-[3px] pr-2"
            style={{ paddingLeft: `${(operations.newItemParent.split('/').length - 1) * 16 + 4}px` }}
          >
            {operations.newItemType === 'directory' ? (
              <Folder className={cn(ICON_SIZE_CLASS, 'text-blue-500')} />
            ) : (
              <span className="ml-[18px]">{(() => {
                const { icon: Icon, color } = getFileIconData(operations.newItemName);
                return <Icon className={cn(ICON_SIZE_CLASS, color)} />;
              })()}</span>
            )}
            <Input
              ref={newItemInputRef}
              type="text"
              value={operations.newItemName}
              onChange={(e) => operations.setNewItemName(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') operations.handleConfirmCreate();
                if (e.key === 'Escape') operations.handleCancelCreate();
              }}
              onBlur={() => {
                setTimeout(() => {
                  if (operations.isCreating) operations.handleConfirmCreate();
                }, 100);
              }}
              className="h-6 flex-1 text-sm"
              disabled={operationLoading}
            />
          </div>
        )}

        {rootStatus === 'loading' && <FileTreeLoadingState />}
        {rootStatus === 'empty' && (
          <FileTreeEmptyState
            icon={Folder}
            title={t('fileTree.noFilesFound', 'No files found')}
            description={t('fileTree.checkProjectPath', 'Check if the project path is accessible')}
          />
        )}
        {/* Mounting only once the root's children are known to be non-empty
            is cheap, not wasteful: the getTreeItem call in the rootStatus
            effect above already populated the provider's node map, so this
            mount's own getTreeItem(root) call is a cache hit, not a
            second fetch. */}
        {rootStatus === 'ready' && (
        <UncontrolledTreeEnvironment<FileTreeItemData>
          ref={treeEnvironmentRef}
          dataProvider={dataProvider}
          getItemTitle={(item) => item.data.name}
          viewState={viewState}
          canDragAndDrop
          canDropOnFolder
          // The filesystem has no ordering concept, so a same-directory drag
          // is never treated as a real reorder (dataProvider.onChangeItemChildren
          // ignores the new order when nothing was actually added — see there
          // for why). This stays true anyway: with it false, the library never
          // computes the between-items gap above the first / below the last
          // top-level row, which is the ONLY drop target that resolves to the
          // tree root — so root would be permanently undroppable otherwise.
          canReorderItems
          canSearch
          canSearchByStartingTyping
          doesSearchMatchItem={(search, item) =>
            item.data.name.toLowerCase().includes(search.toLowerCase())
          }
          onExpandItem={(item) =>
            setViewState((previous) => ({
              ...previous,
              [TREE_ID]: {
                ...previous[TREE_ID],
                expandedItems: [...(previous[TREE_ID]?.expandedItems ?? []), item.index],
              },
            }))
          }
          onCollapseItem={(item) =>
            setViewState((previous) => ({
              ...previous,
              [TREE_ID]: {
                ...previous[TREE_ID],
                expandedItems: (previous[TREE_ID]?.expandedItems ?? []).filter((id) => id !== item.index),
              },
            }))
          }
          onSelectItems={(items) =>
            setViewState((previous) => ({
              ...previous,
              [TREE_ID]: { ...previous[TREE_ID], selectedItems: items },
            }))
          }
          onFocusItem={(item) =>
            setViewState((previous) => ({
              ...previous,
              [TREE_ID]: { ...previous[TREE_ID], focusedItem: item.index },
            }))
          }
          onPrimaryAction={handlePrimaryAction}
          onDrop={(_items, target) => {
            // The actual move happens in dataProvider.onChangeItemChildren
            // (react-complex-tree calls it as part of completing this drop);
            // this only surfaces failures the provider throws (partial
            // multi-selection move failures) as a toast.
            void target;
          }}
          renderItemArrow={({ item, context }) => (
            <span
              {...context.arrowProps}
              className={cn(
                'flex h-4 w-4 flex-shrink-0 items-center justify-center text-muted-foreground/70 transition-transform duration-150',
                context.isExpanded && 'rotate-90',
                !item.isFolder && 'invisible',
              )}
            >
              {item.isFolder && <ChevronRightIcon />}
            </span>
          )}
          renderItemTitle={({ title }) => <>{title}</>}
          renderItem={({ item, depth, children, title, arrow, context }) => (
            <FileContextMenu
              item={item}
              selectedItems={selectedItems}
              onStartRename={context.startRenamingItem}
              onDelete={(items) => operations.handleStartDelete(items)}
              onNewFile={(path) => operations.handleStartCreate(path, 'file')}
              onNewFolder={(path) => operations.handleStartCreate(path, 'directory')}
              onCopyPath={operations.handleCopyPath}
              onDownload={operations.handleDownload}
              onCopy={(items) => operations.handleCopyToClipboard(items)}
              canPaste={Boolean(operations.clipboard)}
              onPaste={() => void operations.handlePaste(dataProvider.resolvePasteTargetDir(item.index))}
            >
              <FileTreeRow item={item} depth={depth} viewMode={viewMode} context={context} title={title} arrow={arrow}>
                {children}
              </FileTreeRow>
            </FileContextMenu>
          )}
          renderRenameInput={({ inputProps, inputRef, formProps }) => (
            <form {...formProps} className="flex-1">
              <Input ref={inputRef} {...inputProps} className="h-6 flex-1 text-sm" disabled={operationLoading} />
            </form>
          )}
          renderSearchInput={({ inputProps }) => (
            <div className="flex items-center gap-1.5 border-b border-border bg-background px-3 py-1.5">
              <Search className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
              <Input
                {...inputProps}
                placeholder={t('fileTree.searchPlaceholder', 'Search files and folders...')}
                className="h-6 flex-1 border-0 px-0 text-sm shadow-none focus-visible:ring-0"
              />
            </div>
          )}
          renderItemsContainer={({ children, containerProps }) => (
            <ul {...containerProps} className="relative">
              {children}
            </ul>
          )}
          renderTreeContainer={({ children, containerProps }) => (
            <div {...containerProps}>{children}</div>
          )}
        >
          <Tree ref={treeRef} treeId={TREE_ID} rootItem={ROOT_ITEM_INDEX} treeLabel={t('fileTree.files', 'Files')} />
        </UncontrolledTreeEnvironment>
        )}
      </div>

      {selectedImage && (
        <ImageViewer
          file={selectedImage}
          onClose={() => setSelectedImage(null)}
        />
      )}

      {/* Delete Confirmation Dialog — portaled to body so `fixed` positions against
          the viewport, not the blur-filtered sidebar ancestor (which would clip it). */}
      {operations.deleteConfirmation.isOpen && operations.deleteConfirmation.items.length > 0 && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
          <div className="mx-4 max-w-sm rounded-lg border border-border bg-background p-4 shadow-lg">
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-full bg-red-100 p-2 dark:bg-red-900/30">
                <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h3 className="font-medium text-foreground">
                  {operations.deleteConfirmation.items.length === 1
                    ? t('fileTree.delete.title', 'Delete {{type}}', {
                        type: operations.deleteConfirmation.items[0].data.type === 'directory' ? 'Folder' : 'File',
                      })
                    : t('fileTree.delete.titleMultiple', 'Delete {{count}} items', {
                        count: operations.deleteConfirmation.items.length,
                      })}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {operations.deleteConfirmation.items.length === 1
                    ? operations.deleteConfirmation.items[0].data.name
                    : operations.deleteConfirmation.items.map((deleteItem) => deleteItem.data.name).join(', ')}
                </p>
              </div>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              {operations.deleteConfirmation.items.length === 1 && operations.deleteConfirmation.items[0].data.type === 'directory'
                ? t('fileTree.delete.folderWarning', 'This folder and all its contents will be permanently deleted.')
                : t('fileTree.delete.fileWarning', 'This will be permanently deleted.')}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={operations.handleCancelDelete}
                disabled={operationLoading}
                className="rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-accent"
              >
                {t('common.cancel', 'Cancel')}
              </button>
              <button
                onClick={operations.handleConfirmDelete}
                disabled={operationLoading}
                className="flex items-center gap-2 rounded-md bg-red-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {operationLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('fileTree.delete.confirm', 'Delete')}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Toast Notification — portaled for the same reason as the dialog above. */}
      {toast && createPortal(
        <div
          className={cn(
            'fixed bottom-4 right-4 z-[9999] px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 animate-in slide-in-from-bottom-2',
            toast.type === 'success'
              ? 'bg-green-600 text-white'
              : 'bg-red-600 text-white'
          )}
        >
          {toast.type === 'success' ? (
            <Check className="h-4 w-4" />
          ) : (
            <X className="h-4 w-4" />
          )}
          <span className="text-sm">{toast.message}</span>
        </div>,
        document.body,
      )}
    </div>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3l5 5-5 5" />
    </svg>
  );
}
