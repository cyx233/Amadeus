import type { ComponentType } from 'react';
import {
  Bell,
  Cpu,
  Info,
  KeyRound,
  Palette,
  SlidersHorizontal,
  UserCog,
} from 'lucide-react';

import type {
  AgentCategory,
  AgentProvider,
  CodeEditorSettingsState,
  CursorPermissionsState,
  ProjectSortOrder,
  SettingsMainTab,
} from '../types/types';

export type SettingsMainTabMeta = {
  id: SettingsMainTab;
  label: string;
  keywords: string;
  icon: ComponentType<{ className?: string }>;
};

export const SETTINGS_MAIN_TABS: SettingsMainTabMeta[] = [
  // Account holds account/password, Git identity, and the AI agents — merged
  // from the former Git and Agents tabs.
  { id: 'account', label: 'Account', keywords: 'account password security git github commits agents subagents claude cursor codex opencode login permissions mcp', icon: UserCog },
  { id: 'appearance', label: 'Appearance', keywords: 'appearance theme dark light language', icon: Palette },
  { id: 'api', label: 'API Tokens', keywords: 'api tokens auth keys', icon: KeyRound },
  // Voice, Tasks/TaskMaster, and Browser automation merged into one Features tab.
  { id: 'features', label: 'Features', keywords: 'features voice tasks taskmaster browser playwright chromium automation', icon: SlidersHorizontal },
  // Model defaults + per-feature overrides (two linked sections).
  { id: 'models', label: 'Model Preference', keywords: 'model default provider override commit message task generation claude opus sonnet haiku bedrock', icon: Cpu },
  { id: 'notifications', label: 'Notifications', keywords: 'notifications alerts push', icon: Bell },
  { id: 'about', label: 'About', keywords: 'about version info', icon: Info },
];

export const AGENT_PROVIDERS: AgentProvider[] = ['claude', 'cursor', 'codex', 'opencode'];
export const AGENT_CATEGORIES: AgentCategory[] = ['account', 'permissions', 'mcp'];

export const DEFAULT_PROJECT_SORT_ORDER: ProjectSortOrder = 'name';
export const DEFAULT_SAVE_STATUS = null;
export const DEFAULT_CODE_EDITOR_SETTINGS: CodeEditorSettingsState = {
  wordWrap: false,
  showMinimap: true,
  lineNumbers: true,
  fontSize: '14',
};

export const DEFAULT_CURSOR_PERMISSIONS: CursorPermissionsState = {
  allowedCommands: [],
  disallowedCommands: [],
  skipPermissions: false,
};
