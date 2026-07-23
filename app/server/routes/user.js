import express from 'express';
// cross-spawn: drop-in spawn with Windows .cmd/PATHEXT resolution.
import spawn from 'cross-spawn';
import { userDb, modelPreferencesDb } from '../modules/database/index.js';
import { authenticateToken } from '../middleware/auth.js';
import { getSystemGitConfig } from '../utils/gitConfig.js';
import { providerModelsService } from '../modules/providers/services/provider-models.service.js';
import { CHAT_PROVIDERS, MODEL_FEATURES, prefKeys } from '../modules/providers/services/model-preference.service.js';

const router = express.Router();

function spawnAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });
    child.on('error', (error) => { reject(error); });
    child.on('close', (code) => {
      if (code === 0) { resolve({ stdout, stderr }); return; }
      const error = new Error(`Command failed: ${command} ${args.join(' ')}`);
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

router.get('/git-config', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    let gitConfig = userDb.getGitConfig(userId);

    // If database is empty, try to get from system git config
    if (!gitConfig || (!gitConfig.git_name && !gitConfig.git_email)) {
      const systemConfig = await getSystemGitConfig();

      // If system has values, save them to database for this user
      if (systemConfig.git_name || systemConfig.git_email) {
        userDb.updateGitConfig(userId, systemConfig.git_name, systemConfig.git_email);
        gitConfig = systemConfig;
        console.log(`Auto-populated git config from system for user ${userId}: ${systemConfig.git_name} <${systemConfig.git_email}>`);
      }
    }

    res.json({
      success: true,
      gitName: gitConfig?.git_name || null,
      gitEmail: gitConfig?.git_email || null
    });
  } catch (error) {
    console.error('Error getting git config:', error);
    res.status(500).json({ error: 'Failed to get git configuration' });
  }
});

// Apply git config globally via git config --global
router.post('/git-config', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { gitName, gitEmail } = req.body;

    if (!gitName || !gitEmail) {
      return res.status(400).json({ error: 'Git name and email are required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(gitEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    userDb.updateGitConfig(userId, gitName, gitEmail);

    try {
      await spawnAsync('git', ['config', '--global', 'user.name', gitName]);
      await spawnAsync('git', ['config', '--global', 'user.email', gitEmail]);
      console.log(`Applied git config globally: ${gitName} <${gitEmail}>`);
    } catch (gitError) {
      console.error('Error applying git config:', gitError);
    }

    res.json({
      success: true,
      gitName,
      gitEmail
    });
  } catch (error) {
    console.error('Error updating git config:', error);
    res.status(500).json({ error: 'Failed to update git configuration' });
  }
});

router.post('/complete-onboarding', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    userDb.completeOnboarding(userId);

    res.json({
      success: true,
      message: 'Onboarding completed successfully'
    });
  } catch (error) {
    console.error('Error completing onboarding:', error);
    res.status(500).json({ error: 'Failed to complete onboarding' });
  }
});

router.get('/onboarding-status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const hasCompleted = userDb.hasCompletedOnboarding(userId);

    res.json({
      success: true,
      hasCompletedOnboarding: hasCompleted
    });
  } catch (error) {
    console.error('Error checking onboarding status:', error);
    res.status(500).json({ error: 'Failed to check onboarding status' });
  }
});

// Model Preference: two orthogonal axes (provider + model), each with a global
// fallback and optional per-feature override — the single source of truth that
// keeps features model-id agnostic. Keys are owned by the model-preference
// service (prefKeys); catalogs come from providerModelsService.
async function providerCatalog(provider, bypassCache = false) {
  const catalog = (await providerModelsService.getProviderModels(provider, { bypassCache })).models;
  return {
    provider,
    defaultModel: catalog.DEFAULT,
    options: catalog.OPTIONS.map((o) => ({ value: o.value, label: o.label, description: o.description })),
    allowed: new Set(catalog.OPTIONS.map((o) => o.value)),
  };
}

// GET /api/user/models — current selections + catalogs for each provider.
// Shape: { globalProvider, providers: [{provider, current, defaultModel, options}] }.
// `current` is the provider's default model (provider:<p>:model or catalog default).
// ?refresh=1 bypasses the model-catalog cache (e.g. after logging into a provider
// so its newly-available models show up instead of the stale cached list).
router.get('/models', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const bypassCache = req.query.refresh === '1' || req.query.refresh === 'true';
    const prefs = modelPreferencesDb.getAll(userId);
    const providers = await Promise.all(CHAT_PROVIDERS.map(async (provider) => {
      const cat = await providerCatalog(provider, bypassCache);
      return {
        provider,
        current: prefs[prefKeys.providerModel(provider)] || cat.defaultModel,
        defaultModel: cat.defaultModel,
        options: cat.options,
      };
    }));
    // Per-feature overrides (for the Feature Preference tab). Empty override =
    // inherits the defaults above; surface null so the UI can show "Default".
    const features = MODEL_FEATURES.map((f) => ({
      id: f.id,
      label: f.label,
      provider: prefs[prefKeys.featureProvider(f.id)] || null,
      model: prefs[prefKeys.featureModel(f.id)] || null,
    }));

    res.json({
      globalProvider: prefs[prefKeys.globalProvider()] || CHAT_PROVIDERS[0],
      chatProviders: CHAT_PROVIDERS,
      providers,
      features,
    });
  } catch (error) {
    console.error('Error reading model preferences:', error);
    res.status(500).json({ error: 'Failed to read model preferences' });
  }
});

// PUT /api/user/models — set one preference key. Body is one of:
//   { globalProvider }                          -> global default provider
//   { provider, model }                         -> that provider's default model
//   { feature, provider }                       -> a feature's provider override
//   { feature, model, provider }                -> a feature's model override (provider names the catalog to validate against)
router.put('/models', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { globalProvider, provider, model, feature, clear } = req.body;

    // Clear a per-feature override → revert to the defaults.
    if (feature && (clear === 'provider' || clear === 'model')) {
      const key = clear === 'provider' ? prefKeys.featureProvider(feature) : prefKeys.featureModel(feature);
      modelPreferencesDb.unset(userId, key);
      return res.json({ success: true });
    }

    if (typeof globalProvider === 'string') {
      if (!CHAT_PROVIDERS.includes(globalProvider)) {
        return res.status(400).json({ error: `Unknown provider: ${globalProvider}` });
      }
      modelPreferencesDb.set(userId, prefKeys.globalProvider(), globalProvider);
      return res.json({ success: true });
    }

    // Provider must be a known chat provider for anything model-related below.
    if (typeof provider !== 'string' || !CHAT_PROVIDERS.includes(provider)) {
      return res.status(400).json({ error: `Unknown provider: ${provider}` });
    }

    if (typeof model === 'string' && model.trim()) {
      const cat = await providerCatalog(provider);
      if (!cat.allowed.has(model)) {
        return res.status(400).json({ error: `Unknown model for ${provider}: ${model}` });
      }
      // feature present → per-feature model override; else provider default.
      const key = feature ? prefKeys.featureModel(feature) : prefKeys.providerModel(provider);
      modelPreferencesDb.set(userId, key, model);
      return res.json({ success: true });
    }

    // feature + provider (no model) → per-feature provider override.
    if (feature) {
      modelPreferencesDb.set(userId, prefKeys.featureProvider(feature), provider);
      return res.json({ success: true });
    }

    return res.status(400).json({ error: 'Nothing to update' });
  } catch (error) {
    console.error('Error saving model preference:', error);
    res.status(500).json({ error: 'Failed to save model preference' });
  }
});


export default router;
