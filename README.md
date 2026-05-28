<div align="center">

<img src="image.png" alt="codex-proxy" width="715" />

# codex-proxy

**Use [Codex CLI](https://github.com/openai/codex) with any OpenAI-compatible API provider.**

No OpenAI account needed. No fork needed. Keep getting Codex updates.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/codex-anywhere-proxy.svg)](https://www.npmjs.com/package/codex-anywhere-proxy)

</div>

---

## How it works

```
Codex CLI  ──Responses API──▸  codex-proxy  ──chat/completions──▸  Your provider
```

Codex CLI uses the OpenAI **Responses API** format, which only OpenAI serves natively.
This lightweight proxy translates Responses API ↔ chat/completions in real-time,
letting you use Codex with any provider that speaks OpenAI's API format.

## Features

- **Any provider** — Works with any OpenAI chat/completions compatible API
- **Interactive setup** — `npx codex-anywhere-proxy install` guides you through provider, API key, and model selection
- **Provider-aware model catalog** — Auto-detects your provider and shows only its models (prevents sub-agent model errors)
- **CLI management** — `start`, `stop`, `restart`, `status`, `config`, `models`, `logs` commands
- **Streaming** — Full SSE streaming with real-time token output
- **Tool calls** — Function, custom (apply_patch), and namespace (MCP) tool support
- **Sub-agents** — Codex sub-agents work through the proxy
- **Context tracking** — Usage data relayed to Codex for built-in context tracking & auto-compaction
- **Cross-platform** — Linux, macOS, Windows

## Requirements

- [Node.js](https://nodejs.org) 18+ (for the CLI, comes with most systems)
- [Bun](https://bun.sh) runtime (auto-installed by the CLI if missing)
- [Codex CLI](https://github.com/openai/codex) v0.134+

## Quick start

```bash
npx codex-anywhere-proxy install
```

That's it. The CLI will:

1. Check/install Bun
2. Ask which provider you use (Z.AI, DeepSeek, OpenAI, OpenRouter, Ollama, etc.)
3. Ask for your API key
4. Ask which model to use
5. Configure Codex CLI automatically
6. Start the proxy (with auto-start via systemd/launchd)

Then just run:

```bash
codex
```

## CLI commands

```bash
npx codex-anywhere-proxy install    # First-time setup (interactive)
codex-proxy config     # Change provider, API key, or model
codex-proxy start      # Start the proxy
codex-proxy stop       # Stop the proxy
codex-proxy restart    # Restart the proxy
codex-proxy status     # Show proxy status and stats
codex-proxy models     # List available models
codex-proxy logs       # Tail proxy logs
codex-proxy version    # Show version
```

### Global install (optional)

If you install globally, you can drop the `npx`:

```bash
npm i -g codex-anywhere-proxy
codex-proxy install
codex-proxy status
```

## Supported providers

Any provider that implements the **OpenAI Chat Completions API** (`/v1/chat/completions`) works. The install wizard includes presets for:

| Provider | URL | Default model |
|---|---|---|
| Z.AI / GLM | `api.z.ai/api/coding/paas/v4` | `glm-5.1` |
| Zhipu AI | `open.bigmodel.cn/api/coding/paas/v4` | `glm-5.1` |
| DeepSeek | `api.deepseek.com/v1` | `deepseek-chat` |
| OpenAI | `api.openai.com/v1` | `gpt-4.1` |
| OpenRouter | `openrouter.ai/api/v1` | `deepseek/deepseek-chat-v3-0324` |
| Ollama (local) | `localhost:11434/v1` | `qwen3:8b` |
| Custom | _any URL_ | _any model_ |

Models that only serve proprietary APIs (e.g. Anthropic native, Google Gemini native) will **not** work.

## Configuration

All configuration is stored in `~/.codex-proxy/config.toml`. Edit it directly or use `codex-proxy config`.

```toml
[proxy]
upstream = "https://api.z.ai/api/coding/paas/v4"
api_key = "your-api-key"
port = 8765

[models]
available = ["glm-4.5-air", "glm-4.7", "glm-5-turbo", "glm-5.1", "glm-5v-turbo"]
active = "glm-5.1"
context_window = 200000
```

### Model selection

During `install` or `config`, the proxy fetches filtered models from [models.dev](https://models.dev) and presents an interactive selector:

1. Provider detected → only that provider's models shown
2. Use **↑/↓** arrows to navigate, **Space** to toggle, **Enter** to confirm
3. Pick your active model (the one Codex uses by default)

### Model catalog filtering

The proxy fetches model metadata from [models.dev](https://models.dev) (2478+ models, 135+ providers) and filters the catalog so Codex only sees models available on **your** provider. This is critical for sub-agents — if the LLM sees GPT models while using Z.AI, it may pick a GPT model for a sub-agent, which fails.

**Auto-detection (default):** The proxy matches your `upstream` URL against models.dev provider URLs and shows only that provider's models. No configuration needed.

**Custom models:** If your model isn't in models.dev, set `MODELS_JSON` in `~/.codex-proxy/config.toml` or as an env var pointing to a JSON file:

```env
MODELS_JSON=/path/to/my-models.json
```

```json
{
  "my-custom-model": {
    "context_window": 128000,
    "max_output": 8192,
    "reasoning": false,
    "tool_call": true
  }
}
```

## Context tracking & Auto-compaction

The proxy relays usage data from your provider back to Codex, so Codex can:

- **Show token usage** after each response (e.g. `tokens used: 11.624`)
- **Auto-compact** when context approaches the limit

To enable auto-compaction, add to `~/.codex/config.toml`:

```toml
model_auto_compact_token_limit = 180000
```

This triggers compaction at 90% of a 200k context window. Adjust based on your model.

## Testing

```bash
git clone https://github.com/xenitV1/codex-anywhere-proxy.git
cd codex-anywhere-proxy

# Run integration tests (requires API key in .env)
bun run test.ts

# Quick health check
curl http://localhost:8765/health
```

## Troubleshooting

### "Missing environment variable: OPENAI_API_KEY"

Run `codex-proxy config` to set your API key. Or edit `~/.codex-proxy/config.toml` directly.

### Sub-agents fail with "Unknown model"

The LLM picked a model that doesn't exist on your provider. Run `codex-proxy config` to verify your provider is set correctly. The proxy auto-filters the model catalog based on your `UPSTREAM_BASE_URL`.

### "401 Unauthorized"

Check that your `API_KEY` is correct: `codex-proxy config`.

### Port 8765 already in use

Change `port` in `~/.codex-proxy/config.toml` and update `base_url` in `~/.codex/config.toml`.

### Proxy crashes or hangs

```bash
codex-proxy logs     # View logs
codex-proxy restart  # Restart
```

## Why not fork Codex?

| Fork | codex-anywhere-proxy |
|---|---|
| Merge conflicts on every update | Modular, works with any Codex version |
| Need to maintain patches | Proxy is runtime-agnostic |
| `codex update` breaks custom code | `codex update` works normally |
| Complex setup | One command: `npx codex-anywhere-proxy install` |

## Updating

```bash
# Update CLI
npx codex-anywhere-proxy@latest install

# Update Codex CLI (proxy doesn't care)
codex update
```

## Platform support

| Platform | Auto-start | Runtime |
|---|---|---|
| Linux | systemd | Bun |
| macOS | launchd | Bun |
| Windows (WSL) | systemd | Bun |
| Windows (native) | Manual | Bun |

## License

MIT
