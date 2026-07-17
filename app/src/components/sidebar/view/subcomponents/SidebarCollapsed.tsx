import { Settings, FolderOpen, GitBranch, ListTodo } from 'lucide-react';
import type { TFunction } from 'i18next';

export type SidebarView = 'explorer' | 'git' | 'todo';

type SidebarCollapsedProps = {
  activeView: SidebarView | null;
  onSelectView: (view: SidebarView) => void;
  onShowSettings: () => void;
  t: TFunction;
};

const VIEWS: Array<{ id: SidebarView; icon: typeof FolderOpen; title: string }> = [
  { id: 'explorer', icon: FolderOpen, title: 'Explorer' },
  { id: 'git', icon: GitBranch, title: 'Source Control' },
  { id: 'todo', icon: ListTodo, title: 'TODO' },
];

export default function SidebarCollapsed({
  activeView,
  onSelectView,
  onShowSettings,
  t,
}: SidebarCollapsedProps) {
  return (
    <div className="flex h-full w-12 flex-col items-center gap-1 border-r border-border/40 bg-background/80 py-3 backdrop-blur-sm">
      {VIEWS.map(({ id, icon: Icon, title }) => (
        <button
          key={id}
          onClick={() => onSelectView(id)}
          className={`group flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-accent/80 ${
            activeView === id ? 'bg-accent/60' : ''
          }`}
          aria-label={title}
          title={title}
        >
          <Icon className={`h-4 w-4 transition-colors ${activeView === id ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'}`} />
        </button>
      ))}

      <div className="flex-1" />

      <button
        onClick={onShowSettings}
        className="group flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-accent/80"
        aria-label={t('actions.settings')}
        title={t('actions.settings')}
      >
        <Settings className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
      </button>
    </div>
  );
}
