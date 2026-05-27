/**
 * codex-anywhere — Model Catalog
 *
 * Fetches model metadata from models.dev, filters by upstream provider,
 * and provides model lookup. Supports custom models via MODELS_JSON env.
 *
 * Filtering strategy:
 * 1. Auto-detect provider from UPSTREAM_BASE_URL → show only that provider's models
 * 2. MODELS_FILTER env var → comma-separated allowlist of model name patterns
 * 3. MODELS_JSON env var → custom model definitions (always included)
 * 4. BUILTIN_MODELS → hardcoded fallback (only matching provider)
 */

import { readFileSync, existsSync } from "fs";
import { UPSTREAM as CONFIG_UPSTREAM } from "./config.js";

export interface ModelInfo {
  context_window: number;
  max_output: number;
  reasoning: boolean;
  tool_call: boolean;
  cost_input?: number;
  cost_output?: number;
  provider_name?: string;
}

interface ModelsCache {
  /** All models from all providers (unfiltered) */
  allModels: Record<string, ModelInfo>;
  /** Models filtered for the current upstream provider */
  filteredModels: Record<string, ModelInfo>;
  /** Provider metadata from models.dev */
  providers: Record<string, { name: string; models: string[]; api?: string }>;
  fetchedAt: number;
}

const BUILTIN_MODELS: Record<string, ModelInfo> = {
  "glm-5.1":           { context_window: 200000, max_output: 131072, reasoning: true, tool_call: true, provider_name: "Z.AI" },
  "glm-5":             { context_window: 204800, max_output: 131072, reasoning: true, tool_call: true, provider_name: "Z.AI" },
  "glm-5-turbo":       { context_window: 200000, max_output: 131072, reasoning: true, tool_call: true, provider_name: "Z.AI" },
  "glm-4.7":           { context_window: 204800, max_output: 131072, reasoning: true, tool_call: true, provider_name: "Z.AI" },
  "gpt-4o":            { context_window: 128000, max_output: 16384, reasoning: false, tool_call: true, provider_name: "OpenAI" },
  "gpt-4.1":           { context_window: 1047576, max_output: 32768, reasoning: false, tool_call: true, provider_name: "OpenAI" },
  "deepseek-chat":     { context_window: 64000, max_output: 8192, reasoning: false, tool_call: true, provider_name: "DeepSeek" },
  "deepseek-reasoner": { context_window: 64000, max_output: 8192, reasoning: true, tool_call: true, provider_name: "DeepSeek" },
};

const MODELS_CACHE_TTL = 5 * 60 * 1000;
let modelsCache: ModelsCache = {
  allModels: { ...BUILTIN_MODELS },
  filteredModels: {},
  providers: {},
  fetchedAt: 0,
};

/**
 * Detect which models.dev provider matches the given upstream URL.
 * Returns provider IDs (can be multiple, e.g. "zai" + "zai-coding-plan").
 */
function detectProviders(
  upstream: string,
  providers: Record<string, { name: string; models: string[]; api?: string }>,
): string[] {
  const upstreamNorm = upstream.toLowerCase().replace(/\/+$/, "");

  // Direct match: provider's api field matches upstream
  for (const [pid, prov] of Object.entries(providers)) {
    if (prov.api) {
      const provApi = prov.api.toLowerCase().replace(/\/+$/, "");
      if (upstreamNorm === provApi || upstreamNorm.startsWith(provApi)) {
        // Find all related providers with same base (e.g. "zai" + "zai-coding-plan")
        const base = provApi;
        return Object.entries(providers)
          .filter(([, p]) => p.api && p.api.toLowerCase().replace(/\/+$/, "").startsWith(base))
          .map(([pid]) => pid);
      }
    }
  }

  // Domain-based match for local providers (no models.dev entry)
  try {
    const url = new URL(upstream);
    const host = url.hostname.toLowerCase();
    // Local providers — no filtering needed, return empty = show all
    if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") {
      return [];
    }
  } catch {}

  // No match found — show all models (e.g. OpenRouter aggregator)
  return [];
}

/**
 * Filter models based on detected provider and/or MODELS_FILTER env var.
 */
function filterModels(
  allModels: Record<string, ModelInfo>,
  providerIds: string[],
  providerModels: Record<string, string[]>,
): Record<string, ModelInfo> {
  const modelsFilter = process.env.MODELS_FILTER;
  const modelsExclude = process.env.MODELS_EXCLUDE;

  // MODELS_FILTER: comma-separated allowlist of model name substrings
  if (modelsFilter) {
    const patterns = modelsFilter.split(",").map(p => p.trim().toLowerCase()).filter(Boolean);
    const filtered: Record<string, ModelInfo> = {};
    for (const [id, info] of Object.entries(allModels)) {
      if (patterns.some(p => id.toLowerCase().includes(p))) {
        filtered[id] = info;
      }
    }
    return applyExclude(filtered, modelsExclude);
  }

  // No provider detected → show all (OpenRouter, unknown providers)
  if (providerIds.length === 0) {
    return applyExclude({ ...allModels }, modelsExclude);
  }

  // Filter to only matched provider(s)' models
  const allowedModels = new Set<string>();
  for (const pid of providerIds) {
    for (const mid of providerModels[pid] || []) {
      allowedModels.add(mid);
    }
  }

  const filtered: Record<string, ModelInfo> = {};
  for (const [id, info] of Object.entries(allModels)) {
    if (allowedModels.has(id)) {
      filtered[id] = info;
    }
  }

  // Always include BUILTIN_MODELS that match the detected provider
  for (const [id, info] of Object.entries(BUILTIN_MODELS)) {
    // Include if it matches the provider or if nothing matched yet
    if (allowedModels.has(id) || Object.keys(filtered).length === 0) {
      filtered[id] = info;
    }
  }

  return applyExclude(filtered, modelsExclude);
}

/**
 * Remove models matching MODELS_EXCLUDE patterns from the filtered set.
 */
function applyExclude(
  models: Record<string, ModelInfo>,
  exclude?: string,
): Record<string, ModelInfo> {
  if (!exclude) return models;
  const patterns = exclude.split(",").map(p => p.trim().toLowerCase()).filter(Boolean);
  if (patterns.length === 0) return models;
  const result: Record<string, ModelInfo> = {};
  for (const [id, info] of Object.entries(models)) {
    if (!patterns.some(p => id.toLowerCase().includes(p))) {
      result[id] = info;
    }
  }
  return result;
}

async function fetchModelsDev(): Promise<void> {
  const upstream = CONFIG_UPSTREAM;
  try {
    const resp = await fetch("https://models.dev/api.json", { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return;
    const data = await resp.json() as Record<string, any>;

    const allModels: Record<string, ModelInfo> = {};
    const providers: Record<string, { name: string; models: string[]; api?: string }> = {};

    for (const [pid, prov] of Object.entries(data)) {
      const provModels: string[] = [];
      for (const [mid, m] of Object.entries(prov.models || {})) {
        const limit = (m as any).limit || {};
        const ctx = limit.context || 0;
        if (ctx === 0) continue;
        allModels[mid] = {
          context_window: ctx,
          max_output: limit.output || 0,
          reasoning: (m as any).reasoning || false,
          tool_call: (m as any).tool_call || false,
          cost_input: (m as any).cost?.input,
          cost_output: (m as any).cost?.output,
          provider_name: prov.name,
        };
        provModels.push(mid);
      }
      if (provModels.length > 0) {
        providers[pid] = {
          name: prov.name,
          models: provModels,
          api: prov.api,
        };
      }
    }

    // BUILTIN_MODELS always available as fallback
    for (const [k, v] of Object.entries(BUILTIN_MODELS)) {
      allModels[k] = v;
    }

    // MODELS_JSON: user-defined custom models (always included)
    const customPath = process.env.MODELS_JSON;
    if (customPath && existsSync(customPath)) {
      try {
        const custom = JSON.parse(readFileSync(customPath, "utf-8"));
        for (const [k, v] of Object.entries(custom)) {
          allModels[k] = v as ModelInfo;
        }
      } catch {}
    }

    // Detect provider and filter models
    const providerIds = detectProviders(upstream, providers);
    const providerModelIds: Record<string, string[]> = {};
    for (const [pid, prov] of Object.entries(providers)) {
      providerModelIds[pid] = prov.models;
    }
    const filteredModels = filterModels(allModels, providerIds, providerModelIds);

    modelsCache = { allModels, filteredModels, providers, fetchedAt: Date.now() };

    const filterInfo = providerIds.length > 0
      ? `provider=${providerIds.join("+")}`
      : (process.env.MODELS_FILTER ? `filter=${process.env.MODELS_FILTER}` : "all");
    const modelNames = Object.keys(filteredModels).sort();
    console.log(
      `[MODELS] Loaded ${modelNames.length} models ` +
      `(${Object.keys(allModels).length} total, ${filterInfo})`
    );
    console.log(`[MODELS] Available: ${modelNames.join(", ")}`);
  } catch (e) {
    console.error("[MODELS] Failed to fetch models.dev:", (e as Error).message);
  }
}

export function startModelsRefresh() {
  fetchModelsDev();
  setInterval(() => {
    if (Date.now() - modelsCache.fetchedAt > MODELS_CACHE_TTL) {
      fetchModelsDev();
    }
  }, 60_000);
}

export function getModelInfo(model: string): ModelInfo | undefined {
  const m = modelsCache.filteredModels;
  if (m[model]) return m[model];
  const lower = model.toLowerCase();
  for (const [id, info] of Object.entries(m)) {
    if (id.toLowerCase() === lower) return info;
  }
  const suffix = model.split("/").pop() || "";
  if (m[suffix]) return m[suffix];
  const lowerSuffix = suffix.toLowerCase();
  for (const [id, info] of Object.entries(m)) {
    if (id.toLowerCase() === lowerSuffix) return info;
  }
  return undefined;
}

/** Returns models filtered for the current upstream provider. */
export function getAllModels(): Record<string, ModelInfo> {
  return modelsCache.filteredModels;
}

/** Returns all models (unfiltered). Used by /models?q= search endpoint. */
export function getAllModelsUnfiltered(): Record<string, ModelInfo> {
  return modelsCache.allModels;
}
