import { useEffect, useState, useCallback } from 'react';
import { Folder, File, ChevronRight, ChevronDown } from 'lucide-react';
import { authenticatedFetch } from '../../../../utils/api';
import type { Project } from '../../../../types/app';

type FileNode = {
  name: string;
  type: 'file' | 'directory';
  path: string;
  children?: FileNode[];
};

type SidebarFileTreeProps = {
  selectedProject: Project | null;
  onFileOpen?: (path: string) => void;
};

export default function SidebarFileTree({ selectedProject, onFileOpen: onFileOpenProp }: SidebarFileTreeProps) {
  // If no onFileOpen prop, dispatch a global event that MainContent listens for
  const onFileOpen = onFileOpenProp || ((path: string) => {
    window.dispatchEvent(new CustomEvent('amadeus:file-open', { detail: { path } }));
  });
  const [files, setFiles] = useState<FileNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedProject?.projectId) { setFiles([]); return; }
    setLoading(true);
    authenticatedFetch(`/api/projects/${selectedProject.projectId}/files`)
      .then(res => res.ok ? res.json() : [])
      .then((data: FileNode[]) => {
        setFiles(data);
        // Auto-expand top-level directories
        const topDirs = data.filter(n => n.type === 'directory').map(n => n.path);
        setExpanded(new Set(topDirs));
      })
      .catch(() => setFiles([]))
      .finally(() => setLoading(false));
  }, [selectedProject?.projectId]);

  const toggle = useCallback((path: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  if (!selectedProject) {
    return (
      <div className="px-4 py-8 text-center">
        <Folder className="mx-auto mb-2 h-6 w-6 text-muted-foreground/40" />
        <p className="text-xs text-muted-foreground">Select a project</p>
      </div>
    );
  }

  if (loading) {
    return <div className="px-4 py-4 text-xs text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-0.5 text-[13px]">
      {files.map(node => (
        <TreeNode key={node.path} node={node} expanded={expanded} onToggle={toggle} onFileOpen={onFileOpen} depth={0} />
      ))}
    </div>
  );
}

function TreeNode({ node, expanded, onToggle, onFileOpen, depth }: {
  node: FileNode;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onFileOpen?: (path: string) => void;
  depth: number;
}) {
  const isDir = node.type === 'directory';
  const isOpen = expanded.has(node.path);

  return (
    <>
      <button
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-accent/50"
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        onClick={() => isDir ? onToggle(node.path) : onFileOpen?.(node.path)}
      >
        {isDir ? (
          isOpen ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />
        ) : (
          <File className="h-3 w-3 text-muted-foreground" />
        )}
        <span className={isDir ? 'font-medium text-foreground' : 'text-foreground/80'}>
          {node.name}
        </span>
      </button>
      {isDir && isOpen && node.children?.map(child => (
        <TreeNode key={child.path} node={child} expanded={expanded} onToggle={onToggle} onFileOpen={onFileOpen} depth={depth + 1} />
      ))}
    </>
  );
}
