import type { TreeDataProvider, TreeItem, TreeItemIndex } from 'react-complex-tree';

import { api } from '../../../utils/api';
import type { FileTreeItemData, FileTreeItemType, FileTreeNode } from '../types/types';

// `TreeConfiguration.rootItem` (consumed by <Tree rootItem={...}>) is typed
// `string`, narrower than the general TreeItemIndex (string | number) used
// everywhere else — kept as a literal so it satisfies both.
export const ROOT_ITEM_INDEX = 'root';

type IndexedNode = {
  index: TreeItemIndex;
  path: string;
  name: string;
  type: FileTreeItemType;
  size?: number;
  modified?: string;
  permissionsRwx?: string;
  // undefined = not fetched yet; string[] (possibly empty) = fetched.
  children?: TreeItemIndex[];
  // Backend's cheap peek — drives whether an unfetched directory renders an
  // expand arrow at all. Independent of whether `children` has been loaded.
  hasChildren?: boolean;
  // Set for every node except root. Lets a caller resolve "the directory a
  // given item lives in" (e.g. paste's target when the focused item is a
  // file, not a folder) in O(1) instead of scanning every node's children.
  parentIndex?: TreeItemIndex;
};

let nextSyntheticIndex = 0;

// react-complex-tree requires a TreeItemIndex to stay stable across rename
// and move (its built-in onDrop/onRenameItem handlers re-fetch the SAME
// index after the operation completes; viewState's expandedItems/
// selectedItems are keyed by index too). Absolute path can't be that index —
// rename and move are exactly the operations that change it. So indices are
// opaque tokens minted once per node and never reassigned; only the path each
// token maps to is updated in place when a node moves.
function mintIndex(): TreeItemIndex {
  nextSyntheticIndex += 1;
  return `n${nextSyntheticIndex}`;
}

function toIndexedNode(node: FileTreeNode, index: TreeItemIndex): IndexedNode {
  return {
    index,
    path: node.path,
    name: node.name,
    type: node.type,
    size: node.size,
    modified: node.modified,
    permissionsRwx: node.permissionsRwx,
    hasChildren: node.hasChildren,
    // A directory whose `children` key is present (even []) has been fetched
    // by the backend at this depth; absent means "not fetched" — do not
    // collapse that distinction to [] here.
    children: node.type === 'directory' && node.children !== undefined ? [] : undefined,
  };
}

function toTreeItem(node: IndexedNode): TreeItem<FileTreeItemData> {
  return {
    index: node.index,
    isFolder: node.type === 'directory',
    // A folder with unfetched children still needs to render an expand arrow
    // when the backend's cheap hasChildren peek says there's something
    // there; react-complex-tree treats `children: undefined` as "ask
    // getTreeItem again," which is exactly the on-demand fetch we want.
    children: node.children,
    data: {
      name: node.name,
      type: node.type,
      path: node.path,
      size: node.size,
      modified: node.modified,
      permissionsRwx: node.permissionsRwx,
    },
  };
}

export class FileTreeDataProvider implements TreeDataProvider<FileTreeItemData> {
  private projectId: string;
  private nodesByIndex = new Map<TreeItemIndex, IndexedNode>();
  private indexByPath = new Map<string, TreeItemIndex>();
  private changeListeners = new Set<(changedItemIds: TreeItemIndex[]) => void>();
  // In-flight loads for a directory's children, de-duped by path so a
  // double-click or a re-render mid-fetch doesn't issue two requests for the
  // same directory (mirrors the old useFileTreeData's loadingDirs guard).
  private pendingChildFetches = new Map<string, Promise<void>>();

  constructor(projectId: string) {
    this.projectId = projectId;
    this.nodesByIndex.set(ROOT_ITEM_INDEX, {
      index: ROOT_ITEM_INDEX,
      path: '',
      name: '',
      type: 'directory',
      children: undefined,
      hasChildren: true,
    });
  }

  // ---- TreeDataProvider interface -----------------------------------

  async getTreeItem(itemId: TreeItemIndex): Promise<TreeItem<FileTreeItemData>> {
    await this.ensureChildrenLoaded(itemId);
    const node = this.nodesByIndex.get(itemId);
    if (!node) {
      throw new Error(`Unknown file tree item: ${String(itemId)}`);
    }
    return toTreeItem(node);
  }

  async getTreeItems(itemIds: TreeItemIndex[]): Promise<TreeItem<FileTreeItemData>[]> {
    return Promise.all(itemIds.map((id) => this.getTreeItem(id)));
  }

  onDidChangeTreeData(listener: (changedItemIds: TreeItemIndex[]) => void) {
    this.changeListeners.add(listener);
    return {
      dispose: () => {
        this.changeListeners.delete(listener);
      },
    };
  }

  async onRenameItem(item: TreeItem<FileTreeItemData>, name: string): Promise<void> {
    const node = this.nodesByIndex.get(item.index);
    if (!node) {
      throw new Error(`Unknown file tree item: ${String(item.index)}`);
    }

    const response = await api.renameFile(this.projectId, { oldPath: node.path, newName: name });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error || 'Failed to rename');
    }

    const { newPath } = (await response.json()) as { newPath: string };
    this.applyPathPrefixChange(node.path, newPath);
    this.emitChange([item.index]);
  }

  // Called by react-complex-tree after a drop completes with the target
  // parent's full new children list. We don't trust it as the literal new
  // order (the filesystem has no ordering concept — see canReorderItems:
  // false in FileTree.tsx) — we only care which indices are NEW relative to
  // what this parent had before, since those are the items that just got
  // dropped here. Handles multi-select drops: `newChildrenIndices` can
  // contain more than one new entry in a single call.
  async onChangeItemChildren(itemId: TreeItemIndex, newChildrenIndices: TreeItemIndex[]): Promise<void> {
    const parent = this.nodesByIndex.get(itemId);
    if (!parent) {
      throw new Error(`Unknown file tree item: ${String(itemId)}`);
    }

    const previousChildren = new Set(parent.children ?? []);
    const incomingChildren = new Set(newChildrenIndices);
    const droppedInIndices = newChildrenIndices.filter((id) => !previousChildren.has(id));

    const failures: unknown[] = [];
    if (droppedInIndices.length > 0) {
      await Promise.all(
        droppedInIndices.map(async (childIndex) => {
          const child = this.nodesByIndex.get(childIndex);
          if (!child) return;

          try {
            const response = await api.moveFile(this.projectId, {
              sourcePath: child.path,
              targetParentPath: parent.path,
            });
            if (!response.ok) {
              const body = await response.json().catch(() => ({}));
              throw new Error((body as { error?: string }).error || 'Failed to move');
            }
            const { newPath } = (await response.json()) as { newPath: string };
            this.applyPathPrefixChange(child.path, newPath);
            child.parentIndex = itemId;
          } catch (error) {
            // A partially-successful multi-drop must not roll back items that
            // already moved — the filesystem operation isn't transactional,
            // and "undoing" a completed move would itself just be another
            // move the user didn't ask for. Surface the failure to the
            // caller (FileTree.tsx's onDrop) and leave successful moves as-is.
            failures.push(error);
          }
        }),
      );
    }

    // Remove any child that's no longer present (moved out to a different
    // parent) from every OTHER parent that used to hold it — the backend
    // move already relocated the file; this only fixes up in-memory parent
    // children arrays that would otherwise still list a moved-away child.
    for (const node of this.nodesByIndex.values()) {
      if (node.index === itemId || !node.children) continue;
      if (node.children.some((childIndex) => incomingChildren.has(childIndex) && droppedInIndices.includes(childIndex))) {
        node.children = node.children.filter((childIndex) => !droppedInIndices.includes(childIndex));
      }
    }

    // Only adopt the incoming order/membership when the member SET actually
    // changed (something added and/or removed). canReorderItems is on (see
    // FileTree.tsx for why — it's the only way to make the tree root a
    // reachable drop target), so same-directory drags now also reach here
    // with an identical member set in a new order — the library reporting a
    // pure visual reorder with no matching UncontrolledTreeEnvironment "move
    // out" call. The filesystem has no ordering concept to persist for that
    // case, so skip adopting it: keep the existing children order rather
    // than a new one that would silently revert on the next fetch and look
    // like the drag "undid itself." A real cross-parent move — even the
    // "moved OUT, nothing added" side of it, where droppedInIndices is also
    // empty — still needs the membership change applied, hence comparing
    // sets rather than checking droppedInIndices alone.
    const sameMembership =
      previousChildren.size === incomingChildren.size &&
      [...previousChildren].every((id) => incomingChildren.has(id));
    if (!sameMembership) {
      parent.children = newChildrenIndices;
    }
    this.emitChange([itemId, ...droppedInIndices]);

    if (failures.length > 0) {
      throw new Error(`${failures.length} item(s) failed to move`);
    }
  }

  // ---- Internals -------------------------------------------------------

  private emitChange(changedItemIds: TreeItemIndex[]): void {
    for (const listener of this.changeListeners) {
      listener(changedItemIds);
    }
  }

  private async ensureChildrenLoaded(itemId: TreeItemIndex): Promise<void> {
    const node = this.nodesByIndex.get(itemId);
    if (!node || node.type !== 'directory' || node.children !== undefined) {
      return;
    }

    const existingFetch = this.pendingChildFetches.get(node.path);
    if (existingFetch) {
      await existingFetch;
      return;
    }

    const fetchPromise = this.fetchChildren(node);
    this.pendingChildFetches.set(node.path, fetchPromise);
    try {
      await fetchPromise;
    } finally {
      this.pendingChildFetches.delete(node.path);
    }
  }

  private async fetchChildren(node: IndexedNode): Promise<void> {
    // Root uses the depth-1 root listing; any other directory uses the
    // ?path= variant — same backend function/depth math either way (see
    // server/index.ts getFileTree, maxDepth is always 1 from this route).
    const response = node.index === ROOT_ITEM_INDEX
      ? await api.getFiles(this.projectId)
      : await api.getDirChildren(this.projectId, node.path);

    if (!response.ok) {
      node.children = [];
      return;
    }

    const children = (await response.json()) as FileTreeNode[];
    node.children = children.map((child) => this.registerNode(child, node.index));
  }

  // Assigns a stable index to a node discovered from a backend response,
  // reusing an existing index if this path is already known (e.g. the
  // backend's depth-2 grandchildren were already indexed by an earlier
  // fetch of a different directory, or a previous fetch of this same
  // directory before a refresh). Recurses into any children the backend
  // included inline (getFileTree returns two real levels per call).
  private registerNode(node: FileTreeNode, parentIndex: TreeItemIndex): TreeItemIndex {
    const existingIndex = this.indexByPath.get(node.path);
    const index = existingIndex ?? mintIndex();

    const indexed = toIndexedNode(node, index);
    indexed.parentIndex = parentIndex;
    // Preserve a deeper `children` array already known for this path (from
    // an earlier on-demand fetch) if this particular response didn't itself
    // carry inline children for it — only true for depth-2 nodes that came
    // back as a `hasChildren`-only peek.
    if (indexed.children === undefined) {
      const previous = this.nodesByIndex.get(index);
      if (previous?.children !== undefined) {
        indexed.children = previous.children;
      }
    }

    this.nodesByIndex.set(index, indexed);
    this.indexByPath.set(node.path, index);

    if (node.type === 'directory' && node.children) {
      indexed.children = node.children.map((child) => this.registerNode(child, index));
    }

    return index;
  }

  // After a rename/move, `oldPath` becomes `newPath` for the node itself,
  // and every descendant's recorded path must have its `oldPath` prefix
  // swapped for `newPath` — indices are untouched throughout (see mintIndex
  // for why), only the path each index maps to changes.
  private applyPathPrefixChange(oldPath: string, newPath: string): void {
    const oldPrefix = `${oldPath}/`;

    for (const [path, index] of [...this.indexByPath.entries()]) {
      let updatedPath: string | null = null;
      if (path === oldPath) {
        updatedPath = newPath;
      } else if (path.startsWith(oldPrefix)) {
        updatedPath = newPath + path.slice(oldPath.length);
      }

      if (updatedPath !== null) {
        this.indexByPath.delete(path);
        this.indexByPath.set(updatedPath, index);
        const node = this.nodesByIndex.get(index);
        if (node) {
          node.path = updatedPath;
        }
      }
    }
  }

  getNodeForIndex(index: TreeItemIndex): IndexedNode | undefined {
    return this.nodesByIndex.get(index);
  }

  // Root's path is '' but it's never routed through registerNode (it's
  // hardcoded in the constructor), so it has no indexByPath entry — special-
  // cased here rather than seeding indexByPath with an empty-string key.
  getIndexForPath(path: string): TreeItemIndex | undefined {
    if (path === '') {
      return ROOT_ITEM_INDEX;
    }
    return this.indexByPath.get(path);
  }

  // Paste's target directory: `itemIndex` itself if it's already a folder
  // (matches "right-click a folder -> Paste" / focus a folder and hit
  // Ctrl+V), otherwise its parent (matches focusing a plain file and
  // hitting Ctrl+V, which every desktop file manager treats as "paste next
  // to this file," not "paste inside this file"). Falls back to root when
  // there's nothing focused/selected to anchor on.
  resolvePasteTargetDir(itemIndex: TreeItemIndex | undefined): TreeItemIndex {
    if (itemIndex === undefined) {
      return ROOT_ITEM_INDEX;
    }
    const node = this.nodesByIndex.get(itemIndex);
    if (!node) {
      return ROOT_ITEM_INDEX;
    }
    if (node.type === 'directory') {
      return itemIndex;
    }
    return node.parentIndex ?? ROOT_ITEM_INDEX;
  }

  // Paste: copies each source onto targetParentIndex's current path. Takes
  // indices rather than the FileTreeItem snapshots the caller's clipboard
  // holds, and re-reads `.path` from nodesByIndex here rather than trusting
  // a path captured at copy-time — a source renamed or moved after being
  // copied (but before paste) is followed to its current location, the same
  // way onChangeItemChildren's moves are. Unlike a move, a failed item is
  // simply skipped (nothing to roll back — the source was never touched).
  async pasteItems(sourceIndices: TreeItemIndex[], targetParentIndex: TreeItemIndex): Promise<void> {
    const targetParent = this.nodesByIndex.get(targetParentIndex);
    if (!targetParent) {
      throw new Error(`Unknown file tree item: ${String(targetParentIndex)}`);
    }

    let failureCount = 0;
    await Promise.all(
      sourceIndices.map(async (sourceIndex) => {
        const source = this.nodesByIndex.get(sourceIndex);
        if (!source) {
          failureCount += 1;
          return;
        }

        try {
          const response = await api.copyFile(this.projectId, {
            sourcePath: source.path,
            targetParentPath: targetParent.path,
          });
          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error((body as { error?: string }).error || 'Failed to copy');
          }
        } catch {
          failureCount += 1;
        }
      }),
    );

    // invalidateChildren emits its own change notification.
    this.invalidateChildren(targetParentIndex);

    if (failureCount > 0) {
      throw new Error(`${failureCount} item(s) failed to copy`);
    }
  }

  // Invalidates a directory's cached children so the next getTreeItem
  // re-fetches from the backend — used after create/delete, which change a
  // directory's contents outside of react-complex-tree's own onRenameItem/
  // onChangeItemChildren hooks. Must emitChange, not just clear the local
  // cache: UncontrolledTreeEnvironment keeps its OWN snapshot of every
  // item (populated once on mount, then only ever updated by
  // onDidChangeTreeData) — clearing node.children here is invisible to it
  // until something calls emitChange, which is the only thing that makes it
  // re-call getTreeItem and pick up the refetch. Without this, the refresh
  // button silently no-ops: the provider's internal maps end up correct
  // after the next getTreeItem call, but the tree keeps rendering its
  // stale pre-refresh snapshot — including now-wrong `data.path` values for
  // anything that moved outside the tree's own drag/rename/paste flows —
  // until something else (e.g. a full page reload) remounts the tree.
  invalidateChildren(index: TreeItemIndex): void {
    const node = this.nodesByIndex.get(index);
    if (node) {
      node.children = undefined;
      this.emitChange([index]);
    }
  }
}
