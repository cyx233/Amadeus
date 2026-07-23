import VoiceSettingsTab from './VoiceSettingsTab';
import TasksSettingsTab from './tasks-settings/TasksSettingsTab';
import BrowserUseSettingsTab from './browser-use-settings/BrowserUseSettingsTab';

// Groups the single-toggle feature settings (voice, tasks, browser automation)
// under one tab instead of a top-level entry each. The child tabs are
// self-contained (each sources its own state), so this is just a stack.
export default function FeaturesSettingsTab() {
  return (
    <div className="space-y-8">
      <TasksSettingsTab />
      <VoiceSettingsTab />
      <BrowserUseSettingsTab />
    </div>
  );
}
