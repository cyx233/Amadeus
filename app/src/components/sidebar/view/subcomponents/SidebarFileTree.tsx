import { useEffect, useState, useCallback, useRef } from 'react';
import { Folder, File, ChevronRight, ChevronDown, Plus, FolderPlus, Trash2, Pencil } from 'lucide-react';
import { authenticatedFetch } from '../../../../utils/api';
import type { Project } from '../../../../types/app';

type FileNode = {
  name: string;
  type: 'file' | 'directory';
  path: string;
  children?: FileNode[];
};

type ContextMenu = { x: number; y: number; node: FileNode | null };

type SidebarFileTreeProps = {
  selectedProject: Project | null;
};

export default function SidebarFileTree({ selectedProject }: SidebarFileTreeProps) {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [creating, setCreating] = useState<{ parentPath: string; type: 'file' | 'directory' } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const openFile = useCallback((path: string) => {
    const fn = (window as any).__amadeus_openFile;
    if (fn) fn(path);
  }, []);

  const fetchFiles = useCallback(() => {
    if (!selectedProject?.projectId) { setFiles([]); return; }
    setLoading(true);
    authenticatedFetch(`/api/projects/${selectedProject.projectId}/files`)
      .then(res => res.ok ? res.json() : [])
      .then((data: FileNode[]) => {
        setFiles(data);
        const topDirs = data.filter(n => n.type === 'directory').map(n => n.path);
        setExpanded(prev => new Set([...prev, ...topDirs]));
      })
      .catch(() => setFiles([]))
      .finally(() => setLoading(false));
  }, [selectedProject?.projectId]);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);

  const toggle = useCallback((path: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  const handleCreate = useCallback(async (parentPath: string, name: string, type: 'file' | 'directory') => {
    if (!selectedProject?.projectId || !name.trim()) return;
    await authenticatedFetch(`/api/projects/${selectedProject.projectId}/files/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: parentPath || undefined, name: name.trim(), type }),
    });
    setCreating(null);
    fetchFiles();
  }, [selectedProject?.projectId, fetchFiles]);

  const handleDelete = useCallback(async (node: FileNode) => {
    if (!selectedProject?.projectId) return;
    if (!confirm(`Delete ${node.name}?`)) return;
    await authenticatedFetch(`/api/projects/${selectedProject.projectId}/files`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: node.path, type: node.type }),
    });
    fetchFiles();
  }, [selectedProject?.projectId, fetchFiles]);

  const handleRename = useCallback(async (oldPath: string, newName: string) => {
    if (!selectedProject?.projectId || !newName.trim()) { setRenaming(null); return; }
    await authenticatedFetch(`/api/projects/${selectedProject.projectId}/files/rename`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPath, newName: newName.trim() }),
    });
    setRenaming(null);
    fetchFiles();
  }, [selectedProject?.projectId, fetchFiles]);

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [contextMenu]);

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
    <div className="space-y-0.5 text-[13px]" onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, node: null }); }}>
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 pb-1">
        <button
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => setCreating({ parentPath: '', type: 'file' })}
          title="New File"
        >
          <Plus className="h-3 w-3" />
        </button>
        <button
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => setCreating({ parentPath: '', type: 'directory' })}
          title="New Folder"
        >
          <FolderPlus className="h-3 w-3" />
        </button>
      </div>
      {files.map(node => (
        <TreeNode
          key={node.path}
          node={node}
          expanded={expanded}
          onToggle={toggle}
          onFileOpen={openFile}
          onContextMenu={(e, n) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, node: n }); }}
          renaming={renaming}
          onRename={handleRename}
          creating={creating}
          onCreate={handleCreate}
          depth={0}
        />
      ))}

      {creating && !creating.parentPath && (
        <InlineInput
          placeholder={creating.type === 'file' ? 'filename' : 'folder name'}
          onSubmit={(name) => handleCreate('', name, creating.type)}
          onCancel={() => setCreating(null)}
        />
      )}

      {contextMenu && (
        <ContextMenuPopup
          x={contextMenu.x}
          y={contextMenu.y}
          node={contextMenu.node}
          projectId={selectedProject?.projectId}
          onNewFile={(parentPath) => { setCreating({ parentPath, type: 'file' }); setContextMenu(null); }}
          onNewFolder={(parentPath) => { setCreating({ parentPath, type: 'directory' }); setContextMenu(null); }}
          onRename={(path) => { setRenaming(path); setContextMenu(null); }}
          onDelete={(node) => { handleDelete(node); setContextMenu(null); }}
        />
      )}
    </div>
  );
}

function TreeNode({ node, expanded, onToggle, onFileOpen, onContextMenu, renaming, onRename, creating, onCreate, depth }: {
  node: FileNode;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onFileOpen: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void;
  renaming: string | null;
  onRename: (oldPath: string, newName: string) => void;
  creating: { parentPath: string; type: 'file' | 'directory' } | null;
  onCreate: (parentPath: string, name: string, type: 'file' | 'directory') => void;
  depth: number;
}) {
  const isDir = node.type === 'directory';
  const isOpen = expanded.has(node.path);
  const isRenaming = renaming === node.path;

  return (
    <>
      <button
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-accent/50"
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        onClick={() => isDir ? onToggle(node.path) : onFileOpen(node.path)}
        onContextMenu={(e) => onContextMenu(e, node)}
      >
        {isDir ? (
          isOpen ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />
        ) : (
          <File className="h-3 w-3 text-muted-foreground" />
        )}
        {isRenaming ? (
          <InlineInput
            defaultValue={node.name}
            onSubmit={(name) => onRename(node.path, name)}
            onCancel={() => onRename(node.path, node.name)}
          />
        ) : (
          <span className={isDir ? 'font-medium text-foreground' : 'text-foreground/80'}>
            {node.name}
          </span>
        )}
      </button>
      {isDir && isOpen && (
        <>
          {creating && creating.parentPath === node.path && (
            <div style={{ paddingLeft: `${8 + (depth + 1) * 12}px` }}>
              <InlineInput
                placeholder={creating.type === 'file' ? 'filename' : 'folder name'}
                onSubmit={(name) => onCreate(node.path, name, creating.type)}
                onCancel={() => onCreate(node.path, '', creating.type)}
              />
            </div>
          )}
          {node.children?.map(child => (
            <TreeNode
              key={child.path}
              node={child}
              expanded={expanded}
              onToggle={onToggle}
              onFileOpen={onFileOpen}
              onContextMenu={onContextMenu}
              renaming={renaming}
              onRename={onRename}
              creating={creating}
              onCreate={onCreate}
              depth={depth + 1}
            />
          ))}
        </>
      )}
    </>
  );
}

function InlineInput({ defaultValue = '', placeholder = '', onSubmit, onCancel }: {
  defaultValue?: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);

  return (
    <input
      ref={ref}
      className="w-full rounded border border-primary bg-background px-1 py-0.5 text-xs text-foreground outline-none"
      defaultValue={defaultValue}
      placeholder={placeholder}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSubmit((e.target as HTMLInputElement).value);
        if (e.key === 'Escape') onCancel();
      }}
      onBlur={(e) => onSubmit(e.target.value)}
    />
  );
}

function ContextMenuPopup({ x, y, node, projectId, onNewFile, onNewFolder, onRename, onDelete }: {
  x: number;
  y: number;
  node: FileNode | null;
  projectId?: string;
  onNewFile: (parentPath: string) => void;
  onNewFolder: (parentPath: string) => void;
  onRename: (path: string) => void;
  onDelete: (node: FileNode) => void;
}) {
  const parentPath = node?.type === 'directory' ? node.path : '';

  const handleDownload = () => {
    if (!node || !projectId) return;
    const url = node.type === 'file'
      ? `/api/projects/${projectId}/files/download?path=${encodeURIComponent(node.path)}`
      : `/api/projects/${projectId}/download`;
    window.open(url, '_blank');
  };

  return (
    <div
      className="fixed z-50 min-w-[140px] rounded-md border border-border bg-popover p-1 shadow-md"
      style={{ left: x, top: y }}
    >
      <ContextMenuItem icon={<Plus className="h-3 w-3" />} label="New File" onClick={() => onNewFile(parentPath)} />
      <ContextMenuItem icon={<FolderPlus className="h-3 w-3" />} label="New Folder" onClick={() => onNewFolder(parentPath)} />
      {node && (
        <>
          <div className="my-1 border-t border-border" />
          <ContextMenuItem icon={<Pencil className="h-3 w-3" />} label="Rename" onClick={() => onRename(node.path)} />
          <ContextMenuItem icon={<Trash2 className="h-3 w-3" />} label="Delete" className="text-destructive" onClick={() => onDelete(node)} />
          {node.type === 'file' && (
            <ContextMenuItem icon={<File className="h-3 w-3" />} label="Download" onClick={handleDownload} />
          )}
        </>
      )}
    </div>
  );
}

function ContextMenuItem({ icon, label, onClick, className = '' }: { icon: React.ReactNode; label: string; onClick: () => void; className?: string }) {
  return (
    <button
      className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs transition-colors hover:bg-accent ${className}`}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}
