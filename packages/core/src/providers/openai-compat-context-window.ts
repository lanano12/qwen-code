/**
 * @license
 * Copyright 2026 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AuthType,
  type ContentGeneratorConfig,
  type ContentGeneratorConfigSources,
} from '../core/contentGenerator.js';
import { fetchWithPolicy } from '../utils/fetch.js';
import { createDebugLogger } from '../utils/debugLogger.js';

const debugLogger = createDebugLogger('OPENAI_CONTEXT_WINDOW');

const PROBE_TIMEOUT_MS = 1500;
const PROBE_MAX_BYTES = 256 * 1024;
const LIVE_SOURCE_DETAIL = 'live from OpenAI-compatible /models';

function asPositiveInt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

/**
 * Serving context from an OpenAI-compatible model listing entry.
 * Prefers llama.cpp `meta.n_ctx` (loaded KV slot), not `n_ctx_train`.
 */
export function contextWindowFromOpenAIModelEntry(
  item: unknown,
): number | undefined {
  if (!item || typeof item !== 'object') {
    return undefined;
  }
  const record = item as Record<string, unknown>;
  const meta =
    record['meta'] && typeof record['meta'] === 'object'
      ? (record['meta'] as Record<string, unknown>)
      : undefined;
  return (
    asPositiveInt(meta?.['n_ctx']) ??
    asPositiveInt(meta?.['context_length']) ??
    asPositiveInt(record['context_length']) ??
    asPositiveInt(record['max_model_len'])
  );
}

function modelIdsMatch(servedId: string, requestedId: string): boolean {
  return servedId === requestedId || servedId.endsWith(`/${requestedId}`);
}

export function contextWindowFromOpenAIModelList(
  payload: unknown,
  modelId: string,
): number | undefined {
  if (!payload || typeof payload !== 'object' || !('data' in payload)) {
    return undefined;
  }
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length === 0) {
    return undefined;
  }

  const requested = modelId.trim();
  const exact = data.find((item) => {
    if (!item || typeof item !== 'object' || !('id' in item)) {
      return false;
    }
    const id = (item as { id?: unknown }).id;
    if (typeof id === 'string' && modelIdsMatch(id.trim(), requested)) {
      return true;
    }
    const aliases = (item as { aliases?: unknown }).aliases;
    return (
      Array.isArray(aliases) &&
      aliases.some(
        (alias) =>
          typeof alias === 'string' && modelIdsMatch(alias.trim(), requested),
      )
    );
  });
  if (exact) {
    return contextWindowFromOpenAIModelEntry(exact);
  }
  if (data.length === 1) {
    return contextWindowFromOpenAIModelEntry(data[0]);
  }
  return undefined;
}

function shouldKeepUserContextWindow(
  sources: ContentGeneratorConfigSources | undefined,
): boolean {
  const kind = sources?.['contextWindowSize']?.kind;
  return kind === 'settings' || kind === 'cli';
}

/**
 * Replace a name-guessed context window with the serving runtime's n_ctx
 * when the OpenAI-compatible `/models` listing reports one (llama.cpp).
 * Honors an explicit settings/CLI override. Failures are silent.
 */
export async function applyLiveOpenAICompatContextWindow(
  generatorConfig: ContentGeneratorConfig,
  sources?: ContentGeneratorConfigSources,
): Promise<boolean> {
  if (generatorConfig.authType !== AuthType.USE_OPENAI) {
    return false;
  }
  if (shouldKeepUserContextWindow(sources)) {
    return false;
  }
  if (sources?.['contextWindowSize']?.detail === LIVE_SOURCE_DETAIL) {
    return true;
  }

  const baseUrl = generatorConfig.baseUrl?.trim();
  if (!baseUrl) {
    return false;
  }

  try {
    const modelsUrl = `${baseUrl.replace(/\/+$/, '')}/models`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    const apiKey = generatorConfig.apiKey?.trim();
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    const result = await fetchWithPolicy(modelsUrl, {
      timeoutMs: PROBE_TIMEOUT_MS,
      maxBytes: PROBE_MAX_BYTES,
      maxRedirects: 2,
      headers,
    });
    if (
      result.kind !== 'response' ||
      result.status < 200 ||
      result.status >= 300
    ) {
      return false;
    }

    const nCtx = contextWindowFromOpenAIModelList(
      JSON.parse(result.body.toString('utf8')),
      generatorConfig.model,
    );
    if (!nCtx) {
      return false;
    }

    generatorConfig.contextWindowSize = nCtx;
    if (sources) {
      sources['contextWindowSize'] = {
        kind: 'computed',
        detail: LIVE_SOURCE_DETAIL,
      };
    }
    debugLogger.debug(
      `Using live context window ${nCtx} from ${modelsUrl} for ${generatorConfig.model}`,
    );
    return true;
  } catch (error: unknown) {
    debugLogger.debug(
      'Live context-window probe failed:',
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}
