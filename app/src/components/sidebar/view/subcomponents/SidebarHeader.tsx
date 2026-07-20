import { PanelLeftClose, Plus, RefreshCw } from 'lucide-react';

import { Button } from '../../../../shared/view/ui';
import { CLOUDCLI_WORDMARK_FONT_FAMILY } from '../../../../constants/branding';

type SidebarHeaderProps = {
  isLoading: boolean;
  onRefresh: () => void;
  isRefreshing: boolean;
  onCreateProject: () => void;
  onCollapseSidebar: () => void;
};

export default function SidebarHeader({
  isLoading,
  onRefresh,
  isRefreshing,
  onCreateProject,
  onCollapseSidebar,
}: SidebarHeaderProps) {
  return (
    <div className="flex-shrink-0">
      <div className="px-3 pb-2 pt-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-primary/90 shadow-sm">
              <svg className="h-3.5 w-3.5 text-primary-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <h1 className="truncate text-sm font-bold tracking-tight text-foreground" style={{ fontFamily: CLOUDCLI_WORDMARK_FONT_FAMILY }}>
              Amadeus
            </h1>
          </div>

          <div className="flex flex-shrink-0 items-center gap-0.5">
            <Button variant="ghost" size="sm" className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground" onClick={onRefresh} disabled={isRefreshing} title="Refresh">
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground" onClick={onCollapseSidebar} title="Hide sidebar">
              <PanelLeftClose className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {!isLoading && (
          <div className="mt-2.5 flex items-center justify-end">
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 rounded-lg px-2 text-muted-foreground hover:bg-accent/80 hover:text-foreground" onClick={onCreateProject} title="New project">
              <Plus className="h-4 w-4" />
              <span className="text-xs">New project</span>
            </Button>
          </div>
        )}
      </div>
      <div className="nav-divider" />
    </div>
  );
}
