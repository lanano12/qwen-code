/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { fetchWithPolicy } from '../utils/fetch.js';
import { contextWindowFromOpenAIModelEntry } from './openai-compat-context-window.js';
import type { ModelSpec } from './types.js';

const DISCOVERY_TIMEOUT_MS = 5000;
const DISCOVERY_MAX_BYTES = 1024 * 1024;
const MAX_MODEL_ID_LENGTH = 256;
// The wizard joins ids with commas and renders them raw, so a served id with
// a comma or a code point in the Unicode C (other) category would split into
// bogus models or poison the TUI.
const UNSAFE_MODEL_ID_CHARS = /[,\p{C}\p{Zl}\p{Zp}]/u;

interface DiscoverProviderModelsOptions {
  baseUrl: string;
  apiKey: string;
  staticModels: readonly ModelSpec[];
  signal?: AbortSignal;
}

interface DiscoveredModel {
  id: string;
  contextWindowSize?: number;
}

function readDiscoveredModels(value: unknown): DiscoveredModel[] | null {
  if (!value || typeof value !== 'object' || !('data' in value)) {
    return null;
  }
  const data = (value as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    return null;
  }

  const models: DiscoveredModel[] = [];
  const seen = new Set<string>();
  for (const item of data) {
    if (!item || typeof item !== 'object' || !('id' in item)) {
      return null;
    }
    const id = (item as { id?: unknown }).id;
    if (typeof id !== 'string') {
      return null;
    }
    const trimmedId = id.trim();
    if (
      trimmedId &&
      trimmedId.length <= MAX_MODEL_ID_LENGTH &&
      !UNSAFE_MODEL_ID_CHARS.test(trimmedId) &&
      !seen.has(trimmedId)
    ) {
      seen.add(trimmedId);
      const contextWindowSize = contextWindowFromOpenAIModelEntry(item);
      models.push(
        contextWindowSize
          ? { id: trimmedId, contextWindowSize }
          : { id: trimmedId },
      );
    }
  }
  return models.length > 0 ? models : null;
}

function mergeModelSpecs(
  discovered: DiscoveredModel[],
  staticModels: readonly ModelSpec[],
): ModelSpec[] {
  const discoveredIds = new Set(discovered.map((model) => model.id));
  const liveById = new Map(discovered.map((model) => [model.id, model]));
  const knownModels = staticModels
    .filter((model) => discoveredIds.has(model.id))
    .map((model) => {
      const liveWindow = liveById.get(model.id)?.contextWindowSize;
      return liveWindow ? { ...model, contextWindowSize: liveWindow } : model;
    });
  const knownIds = new Set(knownModels.map((model) => model.id));
  return [
    ...knownModels,
    ...discovered
      .filter((model) => !knownIds.has(model.id))
      .map((model) =>
        model.contextWindowSize
          ? { id: model.id, contextWindowSize: model.contextWindowSize }
          : { id: model.id },
      ),
  ];
}

export async function discoverProviderModels({
  baseUrl,
  apiKey,
  staticModels,
  signal,
}: DiscoverProviderModelsOptions): Promise<ModelSpec[] | null> {
  const normalizedBaseUrl = baseUrl.trim();
  const normalizedApiKey = apiKey.trim();
  if (!normalizedBaseUrl || !normalizedApiKey) {
    return null;
  }

  try {
    const modelsUrl = `${normalizedBaseUrl.replace(/\/+$/, '')}/models`;
    const result = await fetchWithPolicy(modelsUrl, {
      timeoutMs: DISCOVERY_TIMEOUT_MS,
      maxBytes: DISCOVERY_MAX_BYTES,
      maxRedirects: 2,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${normalizedApiKey}`,
      },
      signal,
    });
    if (
      result.kind !== 'response' ||
      result.status < 200 ||
      result.status >= 300
    ) {
      return null;
    }

    const models = readDiscoveredModels(
      JSON.parse(result.body.toString('utf8')),
    );
    return models ? mergeModelSpecs(models, staticModels) : null;
  } catch {
    return null;
  }
}
