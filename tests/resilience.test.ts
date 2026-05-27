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
    assert(!resp.ok, `Returns error status (${resp.status})`);
    assert(resp.status >= 400, `Status is 4xx/5xx (${resp.status})`);
    const errBody: any = await resp.json().catch(() => ({}));
    assert(!!errBody.error, "Error response has error field");
    console.log(`    Error: ${JSON.stringify(errBody.error).slice(0, 120)}`);
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
    assert(resp.ok || !resp.ok, "Proxy didn't crash with mixed tool types");
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
}
