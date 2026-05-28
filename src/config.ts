/**
 * codex-anywhere — Configuration
 *
 * Reads config from ~/.codex-proxy/config.toml first,
 * falls back to .env for backward compatibility.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const INSTALL_DIR = join(homedir(), ".codex-proxy");
const CONFIG_FILE = join(INSTALL_DIR, "config.toml");

interface ProxyConfig {
  upstream: string;
  apiKey: string;
  port: number;
  filterNonFunctionTools: boolean;
  debug: boolean;
  modelsFilter: string;
  modelsExclude: string;
  /** Models selected by user during install/config */
  availableModels: string[];
  /** Currently active model */
  activeModel: string;
  /** Context window for active model */
  contextWindow: number;
  /** Model aliases: codex_name -> upstream_name */
  modelAliases: Record<string, string>;
}

/**
 * Minimal TOML parser — handles [sections], key = "value", key = 123, key = ["a","b"]
 */
function parseToml(text: string): Record<string, any> {
  const result: Record<string, any> = {};
  let current: Record<string, any> = result;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    // [section]
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      const sectionName = sectionMatch[1].trim();
      result[sectionName] = result[sectionName] || {};
      current = result[sectionName];
      continue;
    }

    // key = value
    const kvMatch = line.match(/^([\w.-]+)\s*=\s*(.+)$/);
    if (kvMatch) {
      const key = kvMatch[1].trim();
      let val: any = kvMatch[2].trim();

      // Remove inline comment
      const commentIdx = val.indexOf(" #");
      if (commentIdx > 0) val = val.slice(0, commentIdx).trim();

      // String
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1);
      }
      // Number
      else if (/^\d+$/.test(val)) {
        val = parseInt(val, 10);
      }
      // Boolean
      else if (val === "true") {
        val = true;
      } else if (val === "false") {
        val = false;
      }
      // Array of strings: ["a", "b", "c"]
      else if (val.startsWith("[") && val.endsWith("]")) {
        val = val.slice(1, -1)
          .split(",")
          .map(s => s.trim().replace(/^"|"$/g, ""))
          .filter(Boolean);
      }

      current[key] = val;
    }
  }

  return result;
}

function readTomlConfig(): ProxyConfig {
  const defaults: ProxyConfig = {
    upstream: "",
    apiKey: "",
    port: 8765,
    filterNonFunctionTools: true,
    debug: false,
    modelsFilter: "",
    modelsExclude: "",
    availableModels: [],
    activeModel: "",
    modelAliases: {},
    contextWindow: 200000,
  };

  if (!existsSync(CONFIG_FILE)) return defaults;

  try {
    const text = readFileSync(CONFIG_FILE, "utf-8");
    const parsed = parseToml(text);
    const proxy = parsed.proxy || {};
    const models = parsed.models || {};

    // Parse [aliases] section: key = "value" pairs
    const aliases = parsed.aliases || {};
    const modelAliases: Record<string, string> = {};
    for (const [key, val] of Object.entries(aliases)) {
      if (typeof val === "string") modelAliases[key] = val;
    }

    return {
      upstream: proxy.upstream || defaults.upstream,
      apiKey: proxy.api_key || defaults.apiKey,
      port: proxy.port || defaults.port,
      filterNonFunctionTools: proxy.filter_non_function_tools !== false,
      debug: proxy.debug === true,
      modelsFilter: proxy.models_filter || defaults.modelsFilter,
      modelsExclude: proxy.models_exclude || defaults.modelsExclude,
      availableModels: Array.isArray(models.available) ? models.available : defaults.availableModels,
      activeModel: models.active || defaults.activeModel,
      modelAliases,
      contextWindow: models.context_window || defaults.contextWindow,
    };
  } catch {
    return defaults;
  }
}

function readEnvFallback() {
  // Load .env into process.env if not already set
  try {
    for (const dir of [process.cwd(), INSTALL_DIR]) {
      const ep = join(dir, ".env");
      if (existsSync(ep)) {
        for (const line of readFileSync(ep, "utf-8").split("\n")) {
          const t = line.trim();
          if (!t || t.startsWith("#")) continue;
          const eq = t.indexOf("=");
          if (eq === -1) continue;
          const k = t.slice(0, eq).trim();
          if (!process.env[k]) process.env[k] = t.slice(eq + 1).trim();
        }
        break;
      }
    }
  } catch {}
}

// ─── Load config ─────────────────────────────────────────────────────
const tomlConfig = readTomlConfig();

// Fall back to .env if config.toml has no values
readEnvFallback();

/** Test mode: .env overrides config.toml (set by test.ts) */
const TEST_MODE = process.env.CODEX_PROXY_TEST === "1";

function configOrEnv(tomlVal: string, envVal: string | undefined, fallback: string): string {
  if (TEST_MODE && envVal) return envVal;
  return tomlVal || envVal || fallback;
}

// ─── Exports ─────────────────────────────────────────────────────────
export const CONFIG_FILE_PATH = CONFIG_FILE;
export const UPSTREAM = configOrEnv(
  tomlConfig.upstream,
  process.env.UPSTREAM_BASE_URL,
  "https://openrouter.ai/api/v1",
);
export const KEY = configOrEnv(
  tomlConfig.apiKey,
  process.env.API_KEY || process.env.OPENAI_API_KEY,
  "",
);
export const PORT = parseInt(process.env.PORT || String(tomlConfig.port), 10) || 8765;
export const FILTER_NON_FUNCTION_TOOLS = tomlConfig.filterNonFunctionTools;
export const PROXY_DEBUG = tomlConfig.debug;
export const MODELS_FILTER = configOrEnv(tomlConfig.modelsFilter, process.env.MODELS_FILTER, "");
export const MODELS_EXCLUDE = configOrEnv(tomlConfig.modelsExclude, process.env.MODELS_EXCLUDE, "");
export const AVAILABLE_MODELS = tomlConfig.availableModels;
export const ACTIVE_MODEL = tomlConfig.activeModel;
export const CONTEXT_WINDOW = tomlConfig.contextWindow;
export const MODEL_ALIASES = tomlConfig.modelAliases;

/**
 * Resolve a model name: if it's an alias, return the upstream model name.
 * Otherwise return the name as-is.
 */
export function resolveModel(model: string): string {
  return tomlConfig.modelAliases[model] || model;
}
