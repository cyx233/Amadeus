import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../utils/api';
import type { Project } from '../../../types/app';
import type { FileTreeNode } from '../types/types';

type UseFileTreeDataResult = {
  files: FileTreeNode[];
  loading: boolean;
  refreshFiles: () => void;
  loadDirChildren: (dirPath: string) => Promise<void>;
  loadingDirs: Set<string>;
};

// Immutable tree update: return a new tree where the node whose `path` matches
// `targetPath` has its `children` replaced. Only clones nodes along the path to
// the target (siblings/subtrees are reused by reference).
function setChildrenAtPath(
  nodes: FileTreeNode[],
  targetPath: string,
  children: FileTreeNode[],
): FileTreeNode[] {
  return nodes.map((node) => {
    if (node.path === targetPath) {
      return { ...node, children };
    }
    if (node.children && node.children.length > 0) {
      const updatedChildren = setChildrenAtPath(node.children, targetPath, children);
      if (updatedChildren !== node.children) {
        return { ...node, children: updatedChildren };
      }
    }
    return node;
  });
}

export function useFileTreeData(selectedProject: Project | null): UseFileTreeDataResult {
  const [files, setFiles] = useState<FileTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(() => new Set());
  const abortControllerRef = useRef<AbortController | null>(null);

  const refreshFiles = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  useEffect(() => {
    // File-tree requests use the DB projectId; the backend resolves it to the
    // project's absolute path through the projects table.
    const projectId = selectedProject?.projectId;

    if (!projectId) {
      setFiles([]);
      setLoading(false);
      return;
    }

    // Abort previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    // Track mount state so aborted or late responses do not enqueue stale state updates.
    let isActive = true;

    const fetchFiles = async () => {
      if (isActive) {
        setLoading(true);
      }
      try {
        const response = await api.getFiles(projectId, { signal: abortControllerRef.current!.signal });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('File fetch failed:', response.status, errorText);
          if (isActive) {
            setFiles([]);
          }
          return;
        }

        const data = (await response.json()) as FileTreeNode[];
        if (isActive) {
          setFiles(data);
        }
      } catch (error) {
        if ((error as { name?: string }).name === 'AbortError') {
          return;
        }

        console.error('Error fetching files:', error);
        if (isActive) {
          setFiles([]);
        }
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    };

    void fetchFiles();

    return () => {
      isActive = false;
      abortControllerRef.current?.abort();
    };
  }, [selectedProject?.projectId, refreshKey]);

  const loadDirChildren = useCallback(
    async (dirPath: string) => {
      const projectId = selectedProject?.projectId;
      if (!projectId) {
        return;
      }

      setLoadingDirs((previous) => {
        const next = new Set(previous);
        next.add(dirPath);
        return next;
      });

      try {
        const response = await api.getDirChildren(projectId, dirPath);

        if (!response.ok) {
          const errorText = await response.text();
          console.error('Directory children fetch failed:', response.status, errorText);
          return;
        }

        const children = (await response.json()) as FileTreeNode[];
        setFiles((previous) => setChildrenAtPath(previous, dirPath, children));
      } catch (error) {
        console.error('Error fetching directory children:', error);
      } finally {
        setLoadingDirs((previous) => {
          const next = new Set(previous);
          next.delete(dirPath);
          return next;
        });
      }
    },
    [selectedProject?.projectId],
  );

  return {
    files,
    loading,
    refreshFiles,
    loadDirChildren,
    loadingDirs,
  };
}
