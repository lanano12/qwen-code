/**
 * @license
 * Copyright 2026 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AuthType,
  type ContentGeneratorConfig,
} from '../core/contentGenerator.js';
import {
  applyLiveOpenAICompatContextWindow,
  contextWindowFromOpenAIModelEntry,
  contextWindowFromOpenAIModelList,
} from './openai-compat-context-window.js';

const { fetchWithPolicyMock } = vi.hoisted(() => ({
  fetchWithPolicyMock: vi.fn(),
}));

vi.mock('../utils/fetch.js', () => ({
  fetchWithPolicy: fetchWithPolicyMock,
}));

function llamaCppListing(nCtx = 32768) {
  return {
    object: 'list',
    data: [
      {
        id: 'qwen3.8-flash-next',
        aliases: ['qwen3.8-flash-next'],
        object: 'model',
        owned_by: 'llamacpp',
        meta: {
          n_ctx: nCtx,
          n_ctx_train: 262144,
          n_params: 176943899520,
        },
      },
    ],
  };
}

describe('contextWindowFromOpenAIModelEntry', () => {
  it('prefers llama.cpp serving n_ctx over n_ctx_train', () => {
    expect(
      contextWindowFromOpenAIModelEntry({
        id: 'm',
        meta: { n_ctx: 32768, n_ctx_train: 262144 },
      }),
    ).toBe(32768);
  });

  it('accepts vLLM max_model_len and Ollama-style context_length', () => {
    expect(contextWindowFromOpenAIModelEntry({ max_model_len: 8192 })).toBe(
      8192,
    );
    expect(contextWindowFromOpenAIModelEntry({ context_length: '4096' })).toBe(
      4096,
    );
  });

  it('ignores non-positive and non-integer values', () => {
    expect(contextWindowFromOpenAIModelEntry({ meta: { n_ctx: 0 } })).toBe(
      undefined,
    );
    expect(contextWindowFromOpenAIModelEntry({ meta: { n_ctx: 1.5 } })).toBe(
      undefined,
    );
    expect(contextWindowFromOpenAIModelEntry({})).toBe(undefined);
  });
});

describe('contextWindowFromOpenAIModelList', () => {
  it('matches the requested id and ignores n_ctx_train', () => {
    expect(
      contextWindowFromOpenAIModelList(llamaCppListing(), 'qwen3.8-flash-next'),
    ).toBe(32768);
  });

  it('matches an alias when the requested id is not the primary id', () => {
    expect(
      contextWindowFromOpenAIModelList(
        {
          data: [
            {
              id: '/models/foo.gguf',
              aliases: ['qwen3.8-flash-next'],
              meta: { n_ctx: 16384 },
            },
          ],
        },
        'qwen3.8-flash-next',
      ),
    ).toBe(16384);
  });

  it('uses the sole listed model when the id is unknown', () => {
    expect(
      contextWindowFromOpenAIModelList(llamaCppListing(65536), 'other-alias'),
    ).toBe(65536);
  });

  it('returns undefined when several models are listed and none match', () => {
    expect(
      contextWindowFromOpenAIModelList(
        {
          data: [
            { id: 'a', meta: { n_ctx: 1024 } },
            { id: 'b', meta: { n_ctx: 2048 } },
          ],
        },
        'c',
      ),
    ).toBeUndefined();
  });
});

describe('applyLiveOpenAICompatContextWindow', () => {
  beforeEach(() => {
    fetchWithPolicyMock.mockReset();
  });

  function config(
    overrides: Partial<ContentGeneratorConfig> = {},
  ): ContentGeneratorConfig {
    return {
      model: 'qwen3.8-flash-next',
      authType: AuthType.USE_OPENAI,
      apiKey: 'local',
      baseUrl: 'http://127.0.0.1:8008/v1',
      contextWindowSize: 1_000_000,
      ...overrides,
    };
  }

  it('replaces a name-guessed 1M window with llama.cpp n_ctx', async () => {
    fetchWithPolicyMock.mockResolvedValue({
      kind: 'response',
      status: 200,
      statusText: 'OK',
      contentType: 'application/json',
      contentDisposition: '',
      body: Buffer.from(JSON.stringify(llamaCppListing())),
      finalUrl: 'http://127.0.0.1:8008/v1/models',
    });
    const generatorConfig = config();
    const sources = {
      contextWindowSize: {
        kind: 'computed' as const,
        detail: 'auto-detected from model',
      },
    };

    await expect(
      applyLiveOpenAICompatContextWindow(generatorConfig, sources),
    ).resolves.toBe(true);
    expect(generatorConfig.contextWindowSize).toBe(32768);
    expect(sources.contextWindowSize.detail).toContain('live from');
    expect(fetchWithPolicyMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8008/v1/models',
      expect.objectContaining({
        timeoutMs: 1500,
        headers: expect.objectContaining({
          Authorization: 'Bearer local',
        }),
      }),
    );
  });

  it('does not override an explicit settings context window', async () => {
    const generatorConfig = config({ contextWindowSize: 16_000 });
    await expect(
      applyLiveOpenAICompatContextWindow(generatorConfig, {
        contextWindowSize: {
          kind: 'settings',
          detail: 'model.generationConfig.contextWindowSize',
        },
      }),
    ).resolves.toBe(false);
    expect(generatorConfig.contextWindowSize).toBe(16_000);
    expect(fetchWithPolicyMock).not.toHaveBeenCalled();
  });

  it('skips when there is no base URL', async () => {
    const generatorConfig = config({ baseUrl: undefined });
    await expect(
      applyLiveOpenAICompatContextWindow(generatorConfig),
    ).resolves.toBe(false);
    expect(fetchWithPolicyMock).not.toHaveBeenCalled();
  });

  it('leaves the guessed window in place when the probe fails', async () => {
    fetchWithPolicyMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const generatorConfig = config();
    await expect(
      applyLiveOpenAICompatContextWindow(generatorConfig),
    ).resolves.toBe(false);
    expect(generatorConfig.contextWindowSize).toBe(1_000_000);
  });
});
