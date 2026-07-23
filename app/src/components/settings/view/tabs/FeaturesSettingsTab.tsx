import VoiceSettingsTab from './VoiceSettingsTab';
import BrowserUseSettingsTab from './browser-use-settings/BrowserUseSettingsTab';

// Groups the single-toggle feature settings (voice, browser automation) under
// one tab. TaskMaster is a core feature (always on), so it has no settings here.
// The child tabs are self-contained (each sources its own state).
export default function FeaturesSettingsTab() {
  return (
    <div className="space-y-8">
      <VoiceSettingsTab />
      <BrowserUseSettingsTab />
    </div>
  );
}
