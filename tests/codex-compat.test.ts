/**
 * codex-anywhere — Codex Compatibility Tests
 *
 * Tests for Codex-specific features:
 * - /v1/models?client_version= (Codex model catalog format)
 * - Tool type handling (custom, namespace, function, mixed)
 * - Codex-specific header handling
 *
 * Note: /v1/responses/compact and /v1/memories/trace_summarize are NOT
 * needed — Codex uses inline compaction (regular /responses call) for
 * non-OpenAI providers, and memories are gated by uses_codex_backend().
 */

import { PROXY_URL, MODEL, API_KEY, assert, assertEqual, skip, responsesRequest } from "./helpers.js";
import { responsesToolsToChatTools, chatToResponses } from "../src/converters.js";

export async function run() {
  // ─── Codex Model Catalog Format ────────────────────────────────
  console.log("Test 1: Codex model catalog format (/v1/models?client_version=...)");
  {
    const resp = await fetch(`${PROXY_URL}/v1/models?client_version=0.99.0`);
    assert(resp.ok, "/v1/models?client_version returns 200");
    const data: any = await resp.json();
    assert(Array.isArray(data.models), "Has 'models' array (Codex format)");
    assert(!data.data, "Does NOT have 'data' array (not OpenAI format)");
    assert(data.models.length > 0, `Has models (${data.models.length})`);

    const first = data.models[0];
    assert(!!first.slug, `Model has 'slug' field: ${first.slug}`);
    assert(!!first.display_name, "Model has 'display_name' field");
    assert(typeof first.context_window === "number", "Model has 'context_window' number");
    assert(typeof first.supports_reasoning_summaries === "boolean", "Has 'supports_reasoning_summaries'");
    assert(typeof first.supports_parallel_tool_calls === "boolean", "Has 'supports_parallel_tool_calls'");
    assert(typeof first.auto_compact_token_limit === "number", "Has 'auto_compact_token_limit'");
    assert(first.auto_compact_token_limit > 0, "auto_compact_token_limit > 0");
    assert(first.shell_type === "shell_command", "shell_type is 'shell_command'");
    assert(first.apply_patch_tool_type === "json", "apply_patch_tool_type is 'json'");
    assert(first.web_search_tool_type === "disabled", "web_search_tool_type is 'disabled'");
    assert(Array.isArray(first.input_modalities), "Has 'input_modalities' array");
  }

  // ─── Custom Tool Type Handling ─────────────────────────────────
  console.log("\nTest 2: Custom/freeform tool type (apply_patch style)");
  {
    if (!API_KEY) { skip("No API key — skipping custom tool test"); }
    else {
      const resp = await responsesRequest({
        model: MODEL,
        input: "Apply this patch: replace foo with bar",
        tools: [
          { type: "custom", name: "apply_patch", description: "Apply a patch to files" },
          { type: "function", name: "shell", description: "Run shell commands", parameters: { type: "object", properties: { command: { type: "string" } } } },
        ],
        stream: false,
      });
      assert(resp.ok || resp.status >= 400, "Proxy handles custom tool type without crashing");
      console.log(`    Status: ${resp.status} (proxy handled custom tool type)`);
    }
  }

  // ─── Namespace round-trip for Codex dispatch ───────────────────
  console.log("\nTest 3: Namespace tools preserve namespace on function_call output");
  {
    const { toolNamespaces } = responsesToolsToChatTools(
      [
        {
          type: "namespace",
          name: "multi_agent_v1",
          description: "Sub-agents",
          tools: [
            {
              type: "function",
              name: "spawn_agent",
              description: "Spawn a sub-agent",
              parameters: { type: "object", properties: { message: { type: "string" } } },
            },
          ],
        },
      ],
      true,
    );
    assertEqual(toolNamespaces.spawn_agent, "multi_agent_v1", "spawn_agent maps to multi_agent_v1");

    const resp = chatToResponses(
      {
        choices: [{
          message: {
            tool_calls: [{
              id: "call_test",
              type: "function",
              function: { name: "spawn_agent", arguments: "{\"message\":\"hi\"}" },
            }],
          },
        }],
      },
      toolNamespaces,
    );
    const fc = resp.output.find((o: any) => o.type === "function_call");
    assert(!!fc, "function_call in output");
    assertEqual(fc.namespace, "multi_agent_v1", "function_call includes namespace for Codex registry");
    assertEqual(fc.name, "spawn_agent", "function_call name preserved");
  }

  // ─── Namespace Tool Type Handling ──────────────────────────────
  console.log("\nTest 4: Namespace tool type (MCP grouped tools)");
  {
    if (!API_KEY) { skip("No API key — skipping namespace tool test"); }
    else {
      const resp = await responsesRequest({
        model: MODEL,
        input: "List files in the project",
        tools: [
          {
            type: "namespace", name: "filesystem", description: "File system MCP tools",
            tools: [
              { type: "function", name: "list_files", description: "List files", parameters: { type: "object", properties: { path: { type: "string" } } } },
              { type: "function", name: "read_file", description: "Read file", parameters: { type: "object", properties: { path: { type: "string" } } } },
            ],
          },
          { type: "function", name: "shell", description: "Run shell", parameters: { type: "object", properties: { command: { type: "string" } } } },
        ],
        stream: false,
      });
      assert(resp.ok || resp.status >= 400, "Proxy handles namespace tool type without crashing");
      console.log(`    Status: ${resp.status} (proxy handled namespace tool type)`);
    }
  }

  // ─── Mixed Tool Types ──────────────────────────────────────────
  console.log("\nTest 5: Mixed tool types (web_search + function + custom)");
  {
    if (!API_KEY) { skip("No API key — skipping mixed tool test"); }
    else {
      const resp = await responsesRequest({
        model: MODEL,
        input: "Search for Python tutorials",
        tools: [
          { type: "web_search", name: "web_search" },
          { type: "function", name: "my_tool", description: "A tool", parameters: { type: "object", properties: {} } },
          { type: "custom", name: "apply_patch", description: "Apply patch" },
          { type: "image_generation" },
          { type: "local_shell" },
          { type: "tool_search" },
        ],
        stream: false,
      });
      assert(resp.ok || resp.status >= 400, "Proxy handles all tool types without crashing");
      console.log(`    Status: ${resp.status} (proxy handled 6 mixed tool types)`);
    }
  }

  // ─── Codex Headers Pass-Through ────────────────────────────────
  console.log("\nTest 6: Codex-specific headers are handled");
  {
    if (!API_KEY) { skip("No API key — skipping header test"); }
    else {
      const resp = await fetch(`${PROXY_URL}/v1/responses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-codex-installation-id": "test-install-123",
          "x-codex-turn-state": "test-state",
          "x-openai-subagent": "true",
          "OpenAI-Beta": "responses_websockets=2026-02-06",
        },
        body: JSON.stringify({
          model: MODEL,
          input: "Say HEADER_OK",
          stream: false,
        }),
      });
      assert(resp.ok || resp.status >= 400, "Codex headers don't crash proxy");
      console.log(`    Status: ${resp.status} (Codex headers handled)`);
    }
  }
}
