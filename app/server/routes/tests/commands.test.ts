import assert from 'node:assert/strict';
import test from 'node:test';

import { executeModelsCommand } from '../commands.js';
import { providerModelsService } from '../../modules/providers/services/provider-models.service.js';
import type { ModelCommandData } from '../../../shared/command-types.js';

// The service methods are stubbed per test; cast the stubs to the real method
// types so assignment typechecks without restating their full signatures.
type GetProviderModels = typeof providerModelsService.getProviderModels;
type GetCurrentActiveModel = typeof providerModelsService.getCurrentActiveModel;

test('models command returns available models only for the active provider', async () => {
  const originalGetProviderModels = providerModelsService.getProviderModels;
  const originalGetCurrentActiveModel = providerModelsService.getCurrentActiveModel;
  let getCurrentActiveModelCalls = 0;

  providerModelsService.getProviderModels = (async () => ({
    models: {
      OPTIONS: [{ value: 'gpt-5.4', label: 'gpt-5.4' }],
      DEFAULT: 'gpt-5.4',
    },
    cache: {
      updatedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-04T00:00:00.000Z',
      source: 'fresh',
    },
  })) as GetProviderModels;
  providerModelsService.getCurrentActiveModel = (async () => {
    getCurrentActiveModelCalls += 1;
    return { model: 'gpt-5.3-codex' };
  }) as GetCurrentActiveModel;

  try {
    // `model` isn't part of CommandContext (executeModelsCommand reads provider/
    // sessionId); the old .js test passed it as a no-op extra prop.
    const result = await executeModelsCommand([], {
      provider: 'codex',
    });

    assert.equal(result.type, 'builtin');
    assert.equal(result.action, 'models');
    // Narrow the discriminated union so `data` is ModelCommandData. Its fields
    // are all optional in the type; the command under test populates them, so
    // assert presence then read (`!`) — a failed assert is the test failing.
    if (result.action !== 'models') throw new Error('expected models result');
    const data: ModelCommandData = result.data;
    assert.ok(data.current && data.available && data.availableModels);
    assert.equal(data.current.provider, 'codex');
    assert.equal(data.current.model, 'gpt-5.4');
    assert.deepEqual(Object.keys(data.available), ['codex']);
    assert.deepEqual(data.available.codex, data.availableModels);
    assert.ok(data.availableModels.includes('gpt-5.4'));
    assert.equal(data.available.claude, undefined);
    assert.equal(data.available.cursor, undefined);
    assert.equal(getCurrentActiveModelCalls, 0);
  } finally {
    providerModelsService.getProviderModels = originalGetProviderModels;
    providerModelsService.getCurrentActiveModel = originalGetCurrentActiveModel;
  }
});

test('models command falls back to claude for unsupported providers', async () => {
  const originalGetProviderModels = providerModelsService.getProviderModels;
  const originalGetCurrentActiveModel = providerModelsService.getCurrentActiveModel;

  providerModelsService.getProviderModels = (async () => ({
    models: {
      OPTIONS: [{ value: 'default', label: 'Default (recommended)' }],
      DEFAULT: 'default',
    },
    cache: {
      updatedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-04T00:00:00.000Z',
      source: 'fresh',
    },
  })) as GetProviderModels;
  providerModelsService.getCurrentActiveModel = (async () => ({
    model: 'default',
  })) as GetCurrentActiveModel;

  try {
    const result = await executeModelsCommand([], {
      provider: 'unknown-provider',
    });

    if (result.action !== 'models') throw new Error('expected models result');
    const data: ModelCommandData = result.data;
    assert.ok(data.current && data.available);
    assert.equal(data.current.provider, 'claude');
    assert.deepEqual(Object.keys(data.available), ['claude']);
  } finally {
    providerModelsService.getProviderModels = originalGetProviderModels;
    providerModelsService.getCurrentActiveModel = originalGetCurrentActiveModel;
  }
});
