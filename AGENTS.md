# codex-proxy — Repository Guidelines

## AGENTS.md Maintenance Rule

This project uses a hierarchical AGENTS.md system.

**When you modify files in a directory that has an AGENTS.md, you MUST update that AGENTS.md to reflect the changes.** This includes: adding/removing files, changing public APIs, modifying types, altering behavior, or updating configuration. Outdated AGENTS.md files are worse than none.

Do NOT duplicate root-level conventions in nested AGENTS.md files. Each file is self-contained for its directory.

## Nested AGENTS.md Map

No nested AGENTS.md files. This project is small enough for a single root file.

**Resolution rule:** This file is the sole source of agent instructions.

## Project Overview

codex-proxy is a lightweight HTTP proxy that lets [Codex CLI](https://github.com/openai/codex) work with **any** OpenAI-compatible API provider — not just OpenAI. It translates the Responses API format (which Codex uses) to/from the Chat Completions API format (which all other providers use) in real-time.

```
Codex CLI  --Responses API-->  codex-proxy  --chat/completions-->  Your provider
```

## Project Structure

```
proxy.ts              (12 lines)   Entry point — imports startServer from src/server.ts
bin/
  cli.cjs             (~350 lines) Node.js CLI — install, config, start, stop, status, models, logs (npx compatible)
src/
  config.ts           (34 lines)   Loads .env, exports UPSTREAM, KEY, PORT, FILTER_NON_FUNCTION_TOOLS
  converters.ts      (159 lines)   Responses API <-> Chat Completions format converters
  handler.ts          (98 lines)   POST /v1/responses handler — main proxy logic
  models.ts          (260 lines)   Model catalog from models.dev + builtin fallback + MODELS_EXCLUDE
  routes.ts          (199 lines)   HTTP route handlers (health, stats, models, context, pass-through)
  server.ts          (114 lines)   HTTP server setup, route wiring, startup banner
  session.ts          (33 lines)   In-memory session token usage tracking
  streaming.ts       (225 lines)   SSE stream converter (chat/completions chunks -> Responses API events)
test.ts               (88 lines)   Test runner — spawns dedicated proxy on TEST_PORT, runs all suites
tests/
  helpers.ts         (117 lines)   Test utilities: assertions, config, API helpers, SSE parser
  endpoints.test.ts  (127 lines)   Health, stats, models, context, search endpoint tests
  api.test.ts        (297 lines)   Real API tests: non-streaming, streaming, multi-turn, tools
  streaming.test.ts   (87 lines)   Streaming-specific tests: SSE event sequence, tool call streaming
  resilience.test.ts  (80 lines)   Error handling, tool filtering, pass-through, context tracking
  codex-compat.test.ts(132 lines)  Codex-specific: model catalog format, custom/namespace tools, headers
```

## Build, Test, and Development Commands

```bash
# Install (interactive — provider, API key, model selection)
npx codex-anywhere-proxy install

# Or run directly from source
npx codex-anywhere-proxy install
```

No build step required. Bun runs TypeScript directly via ESM.

## Coding Style

- **Language:** TypeScript, strict mode
- **Runtime:** Bun (not Node). No bundler needed.
- **Module system:** ESM with `.js` extension imports (`import { X } from "./module.js"`)
- **No framework:** Plain `http.createServer()` — no Express, Hono, or Fastify
- **No dependencies:** Zero npm dependencies in production. `@types/node` is dev-only.
- **Naming:** camelCase for functions/variables, PascalCase for interfaces/types
- **Exports:** Named exports only, no default exports
- **Types:** `Record<string, any>` for untyped API payloads (OpenAI format is dynamic)
- **Error handling:** Try/catch with JSON error responses, never throw unhandled

## Architecture

### Data Flow (main proxy path)

1. Codex CLI sends `POST /v1/responses` (Responses API format)
2. `server.ts` routes to `handler.ts:handleResponsesRequest()`
3. `converters.ts:responsesInputToChatMessages()` converts input to chat messages array
4. `converters.ts:responsesToolsToChatTools()` converts/filters tools
5. Request forwarded to upstream provider as `POST /chat/completions`
6. If streaming: `streaming.ts:streamChatToResponses()` converts SSE chunks in real-time
7. If non-streaming: `converters.ts:chatToResponses()` converts the JSON response
8. `session.ts` accumulates token usage for `/stats` endpoint

### Tool Type Handling

The proxy handles 7 tool types that Codex may send:

| Type | Action | Reason |
|------|--------|--------|
| `function` | Pass through | Standard, all providers support |
| `custom` (e.g. apply_patch) | Convert to function with string param | Codex built-in, no chat/completions equivalent |
| `namespace` (MCP) | Flatten sub-tools to individual functions | Grouped tools, providers expect flat list |
| `web_search` | Filter out (when FILTER_NON_FUNCTION_TOOLS=true) | OpenAI-only built-in |
| `image_generation` | Filter out | OpenAI-only built-in |
| `local_shell` | Filter out | Codex-only, handled client-side |
| `tool_search` | Filter out | OpenAI-only built-in |

### Model Catalog

- Fetched from `models.dev/api.json` on startup, refreshed every 5 minutes
- Builtin fallback for 8 common models (GLM, GPT, DeepSeek)
- Custom models via `MODELS_JSON` env var (path to JSON file)
- Case-insensitive and slug-suffix matching in `getModelInfo()`

### Key Design Decision: No Compact/Memories Endpoints

Codex CLI has `/v1/responses/compact` and `/v1/memories/trace_summarize` endpoints, but source code analysis confirmed:
- **Compact:** Non-OpenAI providers use inline compaction (a regular `/responses` call with full history). The separate compact endpoint is OpenAI-only.
- **Memories:** Gated by `uses_codex_backend()` check. Proxy does not implement these endpoints.

## Testing

- **Framework:** Custom test runner (no Vitest/Jest). `tests/helpers.ts` provides assertions, skip, and API helpers.
- **Isolation:** `test.ts` spawns a dedicated proxy on `TEST_PORT` (default 8790 from `.env`), runs all suites, then kills it. No need to manually start/stop the proxy.
- **Real API:** Tests make actual HTTP requests to the configured upstream provider. Requires valid `API_KEY` in `.env`.
- **Test structure:** Each test file exports a single `run()` function. Assertions use `assert()` / `assertEqual()` / `skip()` from helpers.
- **Skipping:** Tests requiring an API key call `skip()` when `API_KEY` is empty. Tests always pass when no key is configured.
- **Test suites:** endpoints (9 tests), api (11 tests), streaming (2 tests), resilience (4 tests), codex-compat (5 tests).

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `UPSTREAM_BASE_URL` | _(set by CLI)_ | Provider's API base URL |
| `API_KEY` | _(set by CLI)_ | Provider API key (also reads `OPENAI_API_KEY`) |
| `PORT` | `8765` | Proxy listen port |
| `TEST_PORT` | `8790` | Test proxy port (used by test.ts) |
| `FILTER_NON_FUNCTION_TOOLS` | `true` | Filter web_search, image_generation, etc. |
| `MODELS_FILTER` | _(auto)_ | Comma-separated model name patterns (unset = auto-detect from UPSTREAM_BASE_URL) |
| `MODELS_EXCLUDE` | _(none)_ | Comma-separated patterns to exclude from model catalog |
| `MODELS_JSON` | _(none)_ | Path to custom model definitions JSON |

### Config Loading (`src/config.ts`)

Reads `.env` from CWD first, then `~/.codex-proxy/.env` as fallback. First found wins. Uses top-level `await import("fs")` — Bun supports this natively.

## Commit Conventions

```
feat: description       — New feature
fix: description        — Bug fix
chore: description      — Maintenance, cleanup, tooling
refactor: description   — Code restructuring without behavior change
```

Examples from this repo:
- `feat: full Codex CLI compatibility layer (v1.2.0)`
- `fix: forward content-type header in pass-through route`
- `chore: remove dead compact and memories endpoints`

## Adding New Features

### Adding a new route

1. Add handler function in `src/routes.ts` (follow existing pattern: `export function handleX(res: ServerResponse)`)
2. Wire it in `src/server.ts` (match pathname, call handler)
3. Add tests in `tests/endpoints.test.ts` or create new test file
4. Import new test file in `test.ts`

### Adding support for a new tool type

1. Add case in `src/converters.ts:responsesToolsToChatTools()` switch
2. Decide: convert to function, or filter out
3. Add test case in `tests/codex-compat.test.ts` (mixed tools test)

### Adding a new provider

No code changes needed. Users set `UPSTREAM_BASE_URL` and `API_KEY` in `.env`. If the provider's model names aren't in models.dev, add them to `BUILTIN_MODELS` in `src/models.ts` or use `MODELS_JSON` env var.

## CLI (bin/cli.cjs)

Node.js CLI (`bin/cli.cjs`) — npx compatible, zero dependencies. Manages the full lifecycle:

| Command | What it does |
|---------|-------------|
| `install` | Full setup: checks Bun, copies proxy files, interactive provider/API key/model config, creates systemd/launchd service |
| `config` | Reconfigure provider, API key, or model (restarts proxy if running) |
| `start` | Starts proxy (tries systemctl/launchd first, falls back to direct Bun) |
| `stop` | Stops proxy (tries systemctl/launchd first, falls back to PID/port kill) |
| `restart` | Stop + start |
| `status` | Health check + stats from running proxy |
| `models` | Lists available models from proxy `/models` endpoint |
| `logs` | Tails `~/.codex-proxy/proxy.log` |

The CLI copies `proxy.ts`, `src/`, and `package.json` from the package directory to `~/.codex-proxy/`. It creates `~/.codex/config.toml` with codex-proxy provider config and sets up systemd (Linux) or launchd (macOS) for auto-start.
