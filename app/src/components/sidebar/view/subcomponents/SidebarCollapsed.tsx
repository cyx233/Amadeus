import { Settings, FolderOpen } from 'lucide-react';
import type { TFunction } from 'i18next';

type SidebarCollapsedProps = {
  onExpand: () => void;
  onShowSettings: () => void;
  expanded?: boolean;
  t: TFunction;
};

export default function SidebarCollapsed({
  onExpand,
  onShowSettings,
  expanded = false,
  t,
}: SidebarCollapsedProps) {
  return (
    <div className="flex h-full w-12 flex-col items-center gap-1 border-r border-border/40 bg-background/80 py-3 backdrop-blur-sm">
      <button
        onClick={onExpand}
        className="group flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-accent/80"
        aria-label="Toggle sidebar"
        title="Toggle sidebar"
      >
        <FolderOpen className={`h-4 w-4 transition-colors ${expanded ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'}`} />
      </button>

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
