import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ClipboardPaste, Copy, CopyPlus, Download, FileText, FolderPlus, Pencil, Search, Trash2, type LucideIcon } from 'lucide-react';
import type { TreeItem } from 'react-complex-tree';

import { cn } from '../../../lib/utils';
import { usePaletteOps } from '../../../contexts/PaletteOpsContext';
import type { FileTreeItemData } from '../types/types';

type FileTreeItem = TreeItem<FileTreeItemData>;

type ContextMenuAction = {
  key: string;
  label: string;
  icon?: LucideIcon;
  onSelect?: () => void;
  isDanger?: boolean;
  isDisabled?: boolean;
  shortcut?: string;
  showDividerBefore?: boolean;
};

const CONTEXT_MENU_WIDTH = 200;
const CONTEXT_MENU_HEIGHT = 300;
const VIEWPORT_PADDING = 10;

function calculateViewportSafePosition(clientX: number, clientY: number) {
  // Keep the context menu inside the visible viewport.
  const safeX =
    clientX + CONTEXT_MENU_WIDTH > window.innerWidth
      ? window.innerWidth - CONTEXT_MENU_WIDTH - VIEWPORT_PADDING
      : clientX;
  const safeY =
    clientY + CONTEXT_MENU_HEIGHT > window.innerHeight
      ? window.innerHeight - CONTEXT_MENU_HEIGHT - VIEWPORT_PADDING
      : clientY;

  return { x: Math.max(VIEWPORT_PADDING, safeX), y: Math.max(VIEWPORT_PADDING, safeY) };
}

export default function FileContextMenu({
  children,
  item,
  // The full current selection, used for "Delete" and "Copy" so a
  // right-click on an already-selected multi-item set targets all of them.
  // Every other action (rename, copy path, download) targets `item` alone —
  // see FileTree.tsx's useFileTreeOperations wiring for why those stay
  // single-target.
  selectedItems,
  onStartRename,
  onDelete,
  onNewFile,
  onNewFolder,
  onCopyPath,
  onDownload,
  onCopy,
  canPaste,
  onPaste,
  className = '',
}: {
  children: ReactNode;
  item: FileTreeItem;
  selectedItems: FileTreeItem[];
  onStartRename?: () => void;
  onDelete?: (items: FileTreeItem[]) => void;
  onNewFile?: (path: string) => void;
  onNewFolder?: (path: string) => void;
  onCopyPath?: (item: FileTreeItem) => void;
  onDownload?: (item: FileTreeItem) => void;
  onCopy?: (items: FileTreeItem[]) => void;
  canPaste?: boolean;
  onPaste?: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const { searchInFolder } = usePaletteOps();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement>(null);

  const closeContextMenu = useCallback(() => {
    setIsMenuOpen(false);
  }, []);

  const openContextMenuAtCursor = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    setMenuPosition(calculateViewportSafePosition(event.clientX, event.clientY));
    setIsMenuOpen(true);
  }, []);

  const runMenuActionAndClose = useCallback((action?: () => void) => {
    closeContextMenu();
    action?.();
  }, [closeContextMenu]);

  // Right-clicking an item that's part of the current multi-selection
  // deletes/copies the whole selection; right-clicking an unselected item
  // targets just that one — the same "right-click on selection vs. on a
  // single item" convention most file managers use.
  const deleteTargets = useMemo(
    () => (selectedItems.some((selected) => selected.index === item.index) ? selectedItems : [item]),
    [item, selectedItems],
  );
  const copyTargets = deleteTargets;

  const menuActions = useMemo<ContextMenuAction[]>(() => {
    if (item.data.type === 'file') {
      return [
        {
          key: 'rename',
          icon: Pencil,
          label: t('fileTree.context.rename', 'Rename'),
          onSelect: onStartRename,
        },
        {
          key: 'delete',
          icon: Trash2,
          label: deleteTargets.length > 1
            ? t('fileTree.context.deleteCount', 'Delete {{count}} items', { count: deleteTargets.length })
            : t('fileTree.context.delete', 'Delete'),
          onSelect: () => onDelete?.(deleteTargets),
          isDanger: true,
        },
        {
          key: 'copy',
          icon: CopyPlus,
          label: copyTargets.length > 1
            ? t('fileTree.context.copyCount', 'Copy {{count}} items', { count: copyTargets.length })
            : t('fileTree.context.copy', 'Copy'),
          onSelect: () => onCopy?.(copyTargets),
          showDividerBefore: true,
        },
        {
          key: 'copyPath',
          icon: Copy,
          label: t('fileTree.context.copyPath', 'Copy Path'),
          onSelect: () => onCopyPath?.(item),
        },
        {
          key: 'download',
          icon: Download,
          label: t('fileTree.context.download', 'Download'),
          onSelect: () => onDownload?.(item),
        },
      ];
    }

    return [
      {
        key: 'newFile',
        icon: FileText,
        label: t('fileTree.context.newFile', 'New File'),
        onSelect: () => onNewFile?.(item.data.path),
      },
      {
        key: 'newFolder',
        icon: FolderPlus,
        label: t('fileTree.context.newFolder', 'New Folder'),
        onSelect: () => onNewFolder?.(item.data.path),
      },
      {
        key: 'paste',
        icon: ClipboardPaste,
        label: t('fileTree.context.paste', 'Paste'),
        onSelect: onPaste,
        isDisabled: !canPaste,
      },
      {
        key: 'rename',
        icon: Pencil,
        label: t('fileTree.context.rename', 'Rename'),
        onSelect: onStartRename,
        showDividerBefore: true,
      },
      {
        key: 'delete',
        icon: Trash2,
        label: deleteTargets.length > 1
          ? t('fileTree.context.deleteCount', 'Delete {{count}} items', { count: deleteTargets.length })
          : t('fileTree.context.delete', 'Delete'),
        onSelect: () => onDelete?.(deleteTargets),
        isDanger: true,
      },
      {
        key: 'searchInFolder',
        icon: Search,
        label: t('fileTree.context.searchInFolder', 'Search in folder'),
        onSelect: () => searchInFolder(item.data.path),
        showDividerBefore: true,
      },
      {
        key: 'copy',
        icon: CopyPlus,
        label: copyTargets.length > 1
          ? t('fileTree.context.copyCount', 'Copy {{count}} items', { count: copyTargets.length })
          : t('fileTree.context.copy', 'Copy'),
        onSelect: () => onCopy?.(copyTargets),
      },
      {
        key: 'copyPath',
        icon: Copy,
        label: t('fileTree.context.copyPath', 'Copy Path'),
        onSelect: () => onCopyPath?.(item),
      },
      {
        key: 'download',
        icon: Download,
        label: t('fileTree.context.download', 'Download'),
        onSelect: () => onDownload?.(item),
      },
    ];
  }, [item, copyTargets, deleteTargets, canPaste, onCopy, onCopyPath, onDelete, onDownload, onNewFile, onNewFolder, onPaste, onStartRename, searchInFolder, t]);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    const handleOutsideMouseDown = (event: MouseEvent) => {
      const menuElement = menuRef.current;
      if (menuElement && !menuElement.contains(event.target as Node)) {
        closeContextMenu();
      }
    };

    const handleEscapeKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeContextMenu();
      }
    };

    document.addEventListener('mousedown', handleOutsideMouseDown);
    document.addEventListener('keydown', handleEscapeKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleOutsideMouseDown);
      document.removeEventListener('keydown', handleEscapeKeyDown);
    };
  }, [closeContextMenu, isMenuOpen]);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    // Arrow key support keeps the menu accessible without a mouse. This is
    // scoped to navigating this popup's own buttons while it's open — a
    // separate interaction surface from the tree's own keyboard navigation
    // (which react-complex-tree owns whenever this menu is closed).
    const handleKeyboardMenuNavigation = (event: KeyboardEvent) => {
      const menuItems = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])');
      if (!menuItems || menuItems.length === 0) {
        return;
      }

      const activeElement = document.activeElement as HTMLElement | null;
      const currentIndex = Array.from(menuItems).findIndex((menuItem) => menuItem === activeElement);

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        const nextIndex = currentIndex < menuItems.length - 1 ? currentIndex + 1 : 0;
        menuItems[nextIndex]?.focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        const previousIndex = currentIndex > 0 ? currentIndex - 1 : menuItems.length - 1;
        menuItems[previousIndex]?.focus();
      } else if (event.key === 'Enter' || event.key === ' ') {
        if (activeElement?.hasAttribute('role')) {
          event.preventDefault();
          activeElement.click();
        }
      }
    };

    document.addEventListener('keydown', handleKeyboardMenuNavigation);

    return () => {
      document.removeEventListener('keydown', handleKeyboardMenuNavigation);
    };
  }, [isMenuOpen]);

  return (
    <>
      <div onContextMenu={openContextMenuAtCursor} className={cn('contents', className)}>
        {children}
      </div>

      {isMenuOpen && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={t('fileTree.context.menuLabel', 'File context menu')}
          // Portaled to body: the sidebar's backdrop-blur creates a stacking
          // context that would otherwise trap this behind the editor overlay,
          // regardless of z-index. `fixed` positions against the viewport.
          style={{ position: 'fixed', left: menuPosition.x, top: menuPosition.y, zIndex: 10000 }}
          className={cn(
            'min-w-[180px] py-1 px-1',
            'bg-popover border border-border rounded-lg shadow-lg',
            'animate-in fade-in-0 zoom-in-95',
          )}
        >
          {menuActions.map((action) => (
            <Fragment key={action.key}>
              {action.showDividerBefore && <div className="mx-2 my-1 h-px bg-border" />}
              <button
                role="menuitem"
                tabIndex={action.isDisabled ? -1 : 0}
                disabled={action.isDisabled}
                onClick={() => runMenuActionAndClose(action.onSelect)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2 text-sm text-left rounded-md transition-colors',
                  'focus:outline-none focus:bg-accent',
                  action.isDisabled
                    ? 'opacity-50 cursor-not-allowed'
                    : action.isDanger
                    ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950'
                    : 'hover:bg-accent',
                )}
              >
                {action.icon && <action.icon className="h-4 w-4 flex-shrink-0" />}
                <span className="flex-1">{action.label}</span>
                {action.shortcut && <span className="font-mono text-xs text-muted-foreground">{action.shortcut}</span>}
              </button>
            </Fragment>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
