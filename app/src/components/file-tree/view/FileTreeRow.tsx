import type { HTMLProps, ReactNode } from 'react';
import { Folder, FolderOpen } from 'lucide-react';
import type { TreeItem, TreeItemRenderContext } from 'react-complex-tree';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../lib/utils';
import { ICON_SIZE_CLASS, getFileIconData } from '../constants/fileIcons';
import { formatFileSize, formatRelativeTime } from '../utils/fileTreeUtils';
import type { FileTreeItemData, FileTreeViewMode } from '../types/types';

type FileTreeRowProps = {
  item: TreeItem<FileTreeItemData>;
  depth: number;
  viewMode: FileTreeViewMode;
  context: TreeItemRenderContext<never>;
  title: ReactNode;
  arrow: ReactNode;
  children: ReactNode | null;
};

function FileTreeIcon({ item, isOpen }: { item: TreeItem<FileTreeItemData>; isOpen: boolean }) {
  if (item.data.type === 'directory') {
    return isOpen ? (
      <FolderOpen className="h-4 w-4 flex-shrink-0 text-blue-500" />
    ) : (
      <Folder className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
    );
  }

  const { icon: Icon, color } = getFileIconData(item.data.name);
  return <Icon className={cn(ICON_SIZE_CLASS, color)} />;
}

// While renaming, `title` is the library's own <form><input></form> (see
// TreeItemRenamingInput) — the interactive wrapper must be a plain <div>,
// not a <button>, or a click inside the rename input bubbles up into the
// button's own click handler (toggle-expand/select/primary-action), same as
// react-complex-tree's own default renderItem does. Split into two branches
// (rather than one component picking its tag name dynamically) since <div>
// and <button> don't share a compatible HTML attribute type in React's own
// definitions (e.g. `type`), which a dynamic tag can't express cleanly.
function TitleContainer({
  isRenaming,
  interactiveElementProps,
  className,
  children,
}: {
  isRenaming: boolean;
  interactiveElementProps: HTMLProps<any>;
  className: string;
  children: ReactNode;
}) {
  if (isRenaming) {
    return (
      <div {...interactiveElementProps} className={className}>
        {children}
      </div>
    );
  }

  return (
    <button {...interactiveElementProps} type="button" className={className}>
      {children}
    </button>
  );
}

// Same <li> (context.itemContainerWithChildrenProps) -> <div>
// (itemContainerWithoutChildrenProps) -> [arrow, interactiveElementProps
// title button] -> children structure the library's own default renderItem
// uses (see node_modules/react-complex-tree's createDefaultRenderers) —
// deviating from it risks losing keyboard/drag wiring that lives on those
// exact prop bags, so only the row's inner layout (icon, columns per
// viewMode) is custom here.
export default function FileTreeRow({ item, depth, viewMode, context, title, arrow, children }: FileTreeRowProps) {
  const { t } = useTranslation();
  const isDirectory = item.data.type === 'directory';

  const nameClassName = cn(
    'text-[13px] leading-tight truncate',
    isDirectory ? 'font-medium text-foreground' : 'text-foreground/90',
  );

  const rowClassName = cn(
    viewMode === 'detailed'
      ? 'grid grid-cols-12 gap-2 py-[3px] pr-2 items-center rounded-sm transition-colors duration-100'
      : viewMode === 'compact'
      ? 'flex items-center justify-between py-[3px] pr-2 rounded-sm transition-colors duration-100'
      : 'flex items-center gap-1.5 py-[3px] pr-2 rounded-sm transition-colors duration-100',
    context.isSelected ? 'bg-accent' : 'hover:bg-accent/60',
    context.isDraggingOver && 'bg-primary/10',
    context.isSearchMatching && 'outline outline-1 outline-primary/50',
    isDirectory && context.isExpanded && 'border-l-2 border-primary/30',
    (isDirectory && !context.isExpanded) || !isDirectory ? 'border-l-2 border-transparent' : '',
  );

  const titleButtonClassName = cn(
    'flex min-w-0 flex-1 items-center gap-1.5 bg-transparent text-left focus:outline-none',
    context.isFocused && 'ring-1 ring-inset ring-primary/40 rounded-sm',
  );

  const nameAndIcon = (
    <>
      <FileTreeIcon item={item} isOpen={Boolean(context.isExpanded)} />
      <span className={nameClassName}>{title}</span>
    </>
  );

  return (
    <li {...context.itemContainerWithChildrenProps} className="select-none">
      <div
        {...context.itemContainerWithoutChildrenProps}
        className={rowClassName}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
      >
        {arrow}
        {viewMode === 'detailed' ? (
          <>
            <TitleContainer
              isRenaming={Boolean(context.isRenaming)}
              interactiveElementProps={context.interactiveElementProps}
              className={cn(titleButtonClassName, 'col-span-5')}
            >
              {nameAndIcon}
            </TitleContainer>
            <div className="col-span-2 min-w-0 truncate whitespace-nowrap text-sm tabular-nums text-muted-foreground">
              {item.data.type === 'file' ? formatFileSize(item.data.size) : ''}
            </div>
            <div className="col-span-3 min-w-0 truncate whitespace-nowrap text-sm text-muted-foreground">{formatRelativeTime(item.data.modified, t)}</div>
            <div className="col-span-2 min-w-0 truncate whitespace-nowrap font-mono text-sm text-muted-foreground">{item.data.permissionsRwx || ''}</div>
          </>
        ) : viewMode === 'compact' ? (
          <>
            <TitleContainer
              isRenaming={Boolean(context.isRenaming)}
              interactiveElementProps={context.interactiveElementProps}
              className={titleButtonClassName}
            >
              {nameAndIcon}
            </TitleContainer>
            <div className="ml-2 flex flex-shrink-0 items-center gap-3 whitespace-nowrap text-sm text-muted-foreground">
              {item.data.type === 'file' && (
                <>
                  <span className="tabular-nums">{formatFileSize(item.data.size)}</span>
                  <span className="font-mono">{item.data.permissionsRwx}</span>
                </>
              )}
            </div>
          </>
        ) : (
          <TitleContainer
            isRenaming={Boolean(context.isRenaming)}
            interactiveElementProps={context.interactiveElementProps}
            className={titleButtonClassName}
          >
            {nameAndIcon}
          </TitleContainer>
        )}
      </div>
      {children}
    </li>
  );
}
