import type { LucideIcon } from 'lucide-react';

export type FileTreeViewMode = 'simple' | 'compact' | 'detailed';

export type FileTreeItemType = 'file' | 'directory';

export interface FileTreeNode {
  name: string;
  type: FileTreeItemType;
  path: string;
  size?: number;
  modified?: string;
  permissionsRwx?: string;
  hasChildren?: boolean;
  children?: FileTreeNode[];
  [key: string]: unknown;
}

// The data payload react-complex-tree's TreeItem<T> carries. The tree's
// TreeItemIndex (a stable token minted by FileTreeDataProvider) is a
// different identifier from `path` — path changes on rename/move, the index
// never does. See FileTreeDataProvider.ts for why that distinction matters.
export interface FileTreeItemData {
  name: string;
  type: FileTreeItemType;
  path: string;
  size?: number;
  modified?: string;
  permissionsRwx?: string;
}

export interface FileTreeImageSelection {
  name: string;
  path: string;
  projectPath?: string;
  // DB projectId; used by ImageViewer to build the raw content URL.
  projectId: string;
}

export interface FileIconData {
  icon: LucideIcon;
  color: string;
}

export type FileIconMap = Record<string, FileIconData>;
