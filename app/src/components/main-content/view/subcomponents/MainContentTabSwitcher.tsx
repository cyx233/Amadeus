import { CheckSquare, ListTodo, Folder, Terminal, GitBranch, MessageSquare, type LucideIcon } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import { Tooltip, PillBar, Pill } from '../../../../shared/view/ui';
import type { AppTab } from '../../../../types/app';

type MainContentTabSwitcherProps = {
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  shouldShowTasksTab: boolean;
  shouldShowBrowserTab: boolean;
};

type BuiltInTab = {
  kind: 'builtin';
  id: AppTab;
  labelKey: string;
  label?: string;
  icon: LucideIcon;
};

const BASE_TABS: BuiltInTab[] = [
  { kind: 'builtin', id: 'chat',  labelKey: 'tabs.chat',  icon: MessageSquare },
  { kind: 'builtin', id: 'tasks', labelKey: 'tabs.tasks', label: 'Tasks', icon: CheckSquare },
  { kind: 'builtin', id: 'git',   labelKey: 'tabs.git',   icon: GitBranch },
  { kind: 'builtin', id: 'shell', labelKey: 'tabs.shell', icon: Terminal },
];

export default function MainContentTabSwitcher({
  activeTab,
  setActiveTab,
  shouldShowTasksTab: _,
  shouldShowBrowserTab: __,
}: MainContentTabSwitcherProps) {
  const { t } = useTranslation();

  return (
    <PillBar>
      {BASE_TABS.map((tab) => {
        const isActive = tab.id === activeTab;
        const displayLabel = tab.label || t(tab.labelKey);

        return (
          <Tooltip key={tab.id} content={displayLabel} position="bottom">
            <Pill
              isActive={isActive}
              onClick={() => setActiveTab(tab.id)}
              className="px-2.5 py-[5px]"
            >
              <tab.icon className="h-3.5 w-3.5" strokeWidth={isActive ? 2.2 : 1.8} />
              <span className="hidden lg:inline">{displayLabel}</span>
            </Pill>
          </Tooltip>
        );
      })}
    </PillBar>
  );
}
