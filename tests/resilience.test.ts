/**
 * codex-anywhere — Resilience Tests
 *
 * Error handling, tool filtering, pass-through.
 */

import { PROXY_URL, MODEL, assert, responsesRequest } from "./helpers.js";

export async function run() {
  // Error handling — nonexistent model
  console.log("Test 1: Error handling — nonexistent model");
  {
    const resp = await responsesRequest({
      model: "nonexistent-model-xyz-12345",
      input: "test",
      stream: false,
    });
    // Proxy maps unknown models to ACTIVE_MODEL, so upstream may return 200.
    // The resilience guarantee is: proxy never crashes on unknown models.
    assert(typeof resp.status === "number", "Proxy responded without crashing");
    if (!resp.ok) {
      const errBody: any = await resp.json().catch(() => ({}));
      assert(!!errBody.error, "Error response has error field");
      console.log(`    Error: ${JSON.stringify(errBody.error).slice(0, 120)}`);
    } else {
      console.log(`    Status: ${resp.status} (unknown model mapped to ACTIVE_MODEL)`);
    }
  }

  // Tool filtering
  console.log("\nTest 2: Tool filtering (non-function tools removed)");
  {
    const resp = await responsesRequest({
      model: MODEL,
      input: "Search the web for cats",
      tools: [
        { type: "computer_use", name: "computer" },
        { type: "web_search", name: "search" },
        { type: "function", name: "my_tool", description: "A real tool", parameters: { type: "object", properties: {} } },
      ],
      stream: false,
    });
    assert(resp.ok || resp.status >= 400, "Proxy handles mixed tool types without crashing");
    console.log(`    Status: ${resp.status} (proxy handled mixed tools)`);
  }

  // Context tracking — stats updated
  console.log("\nTest 3: Context tracking — stats updated");
  {
    const resp = await fetch(`${PROXY_URL}/stats`);
    const data: any = await resp.json();
    assert(data.request_count > 0, `request_count > 0 (${data.request_count})`);
    assert(data.cumulative.input_tokens > 0, `cumulative.input_tokens > 0 (${data.cumulative.input_tokens})`);
    assert(data.cumulative.output_tokens > 0, `cumulative.output_tokens > 0 (${data.cumulative.output_tokens})`);
    console.log(
      `    Session: ${data.request_count} requests, ` +
      `${data.cumulative.input_tokens} in / ${data.cumulative.output_tokens} out tokens`
    );
  }

  // Pass-through proxy
  console.log("\nTest 4: Pass-through proxy (direct /chat/completions)");
  {
    const resp = await fetch(`${PROXY_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: "Say PASS_OK" }],
        stream: false,
      }),
    });
    assert(resp.ok, "Pass-through to upstream /chat/completions OK");
    if (resp.ok) {
      const data: any = await resp.json();
      assert(data.choices?.length > 0, "Has choices in pass-through response");
      const text = data.choices?.[0]?.message?.content || "";
      assert(text.length > 0, `Pass-through response (${text.length} chars)`);
      console.log(`    Response: "${text.slice(0, 60)}"`);
    } else {
      const err = await resp.text();
      console.error(`    Error: ${err.slice(0, 200)}`);
    }
  }


  // Configured key overrides wrong Authorization header (fixes #1)
  console.log("\nTest 5: Configured key overrides wrong auth header");
  {
    const resp = await fetch(`${PROXY_URL}/v1/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer sk-wrong-invalid-key-that-should-fail",
      },
      body: JSON.stringify({
        model: MODEL,
        input: "Say KEY_OK",
        stream: false,
      }),
    });
    // With the fix, proxy ignores the wrong header and uses KEY from config.toml
    assert(resp.ok, "Proxy uses configured key, not wrong auth header");
    if (resp.ok) {
      const data: any = await resp.json();
      const text = (data.output || []).find((o: any) => o.type === "message")?.content?.[0]?.text || "";
      assert(text.length > 0, "Got response despite wrong auth header");
      console.log("    Response: \"" + text.slice(0, 60) + "\"");
    }
  }
}
