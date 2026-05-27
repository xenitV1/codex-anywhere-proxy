/**
 * codex-anywhere — Real API Tests
 *
 * Non-streaming real API tests: simple, instructions, multi-turn,
 * tool calling, round-trip, temperature, auth, empty input.
 */

import { PROXY_URL, MODEL, API_KEY, assert, skip, responsesRequest, extractText } from "./helpers.js";

export async function run() {
  // Non-streaming simple request
  console.log("Test 1: Real API — non-streaming request");
  {
    const resp = await responsesRequest({
      model: MODEL,
      input: "Reply with exactly: PONG",
      stream: false,
    });
    assert(resp.ok, `Upstream responded OK (status ${resp.status})`);
    if (resp.ok) {
      const data: any = await resp.json();
      assert(data.object === "response", "object is 'response'");
      assert(data.status === "completed", "status is 'completed'");
      assert(Array.isArray(data.output), "Has output array");
      assert(data.output.length > 0, "Output is not empty");

      const text = extractText(data);
      assert(text.length > 0, `Got text response (${text.length} chars)`);
      console.log(`    Response: "${text.slice(0, 80)}${text.length > 80 ? "..." : ""}"`);

      assert(data.usage != null, "Has usage data");
      if (data.usage) {
        assert(data.usage.input_tokens > 0, `input_tokens > 0 (${data.usage.input_tokens})`);
        assert(data.usage.output_tokens > 0, `output_tokens > 0 (${data.usage.output_tokens})`);
        assert(data.usage.total_tokens > 0, `total_tokens > 0 (${data.usage.total_tokens})`);
      }
      assert(!!data.model, `Has model field: ${data.model}`);
    } else {
      const err = await resp.text();
      console.error(`    Error: ${err.slice(0, 200)}`);
    }
  }

  // System instructions
  console.log("\nTest 2: Real API — system instructions");
  {
    const resp = await responsesRequest({
      model: MODEL,
      instructions: "You are a calculator. Only respond with numbers and operators. No words.",
      input: "What is 2+2?",
      stream: false,
    });
    assert(resp.ok, "Request with instructions OK");
    if (resp.ok) {
      const data: any = await resp.json();
      const text = extractText(data);
      assert(text.length > 0, `Got response (${text.length} chars)`);
      console.log(`    Response: "${text.slice(0, 80)}${text.length > 80 ? "..." : ""}"`);
      assert(text.includes("4"), "Response contains '4'");
    }
  }

  // Multi-turn conversation
  console.log("\nTest 3: Real API — multi-turn conversation");
  {
    const resp = await responsesRequest({
      model: MODEL,
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "My name is TestUser." }] },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "Nice to meet you, TestUser!" }] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "What is my name? Reply with just the name." }] },
      ],
      stream: false,
    });
    assert(resp.ok, "Multi-turn request OK");
    if (resp.ok) {
      const data: any = await resp.json();
      const text = extractText(data);
      assert(text.length > 0, `Got multi-turn response (${text.length} chars)`);
      console.log(`    Response: "${text.slice(0, 80)}${text.length > 80 ? "..." : ""}"`);
      assert(text.toLowerCase().includes("testuser"), "Response recalls the name 'TestUser'");
    }
  }

  // Tool calling
  console.log("\nTest 4: Real API — tool calling");
  {
    const resp = await responsesRequest({
      model: MODEL,
      input: "What is the weather in Istanbul right now?",
      tools: [{
        type: "function",
        name: "get_weather",
        description: "Get current weather for a city",
        parameters: {
          type: "object",
          properties: { city: { type: "string", description: "City name" } },
          required: ["city"],
        },
      }],
      stream: false,
    });
    assert(resp.ok, "Tool call request OK");
    if (resp.ok) {
      const data: any = await resp.json();
      assert(Array.isArray(data.output), "Has output array");

      const funcCall = data.output?.find((o: any) => o.type === "function_call");
      const textMsg = data.output?.find((o: any) => o.type === "message");

      if (funcCall) {
        assert(funcCall.name === "get_weather", `Tool name: ${funcCall.name}`);
        assert(!!funcCall.call_id, `Has call_id: ${funcCall.call_id}`);
        assert(!!funcCall.arguments, "Has arguments");
        console.log(`    Tool call: get_weather(${funcCall.arguments})`);
      } else if (textMsg) {
        const text = textMsg.content?.[0]?.text || "";
        console.log(`    Model responded with text instead: "${text.slice(0, 60)}..."`);
        skip("Model did not trigger tool call (provider-dependent)");
      }
      assert(data.output.length > 0, "Has some output");
    }
  }

  // String input shorthand
  console.log("\nTest 5: String input shorthand");
  {
    const resp = await responsesRequest({
      model: MODEL,
      input: "Say OK",
      stream: false,
    });
    assert(resp.ok, "String input accepted");
    if (resp.ok) {
      const data: any = await resp.json();
      const text = extractText(data);
      assert(text.length > 0, `Got response for string input (${text.length} chars)`);
    }
  }

  // Multiple sequential requests
  console.log("\nTest 6: Multiple sequential requests");
  {
    const prompts = ["Say A", "Say B", "Say C"];
    const results: string[] = [];
    for (const prompt of prompts) {
      const resp = await responsesRequest({
        model: MODEL,
        input: prompt,
        stream: false,
      });
      if (resp.ok) {
        const data: any = await resp.json();
        results.push(extractText(data));
      }
    }
    assert(results.length === 3, "All 3 requests completed");
    assert(results.every((r) => r.length > 0), "All responses non-empty");
  }

  // Function call round-trip
  console.log("\nTest 7: Function call round-trip (with function_call_output)");
  {
    const resp1 = await responsesRequest({
      model: MODEL,
      input: "Get the weather in Tokyo using the weather tool.",
      tools: [{
        type: "function",
        name: "get_weather",
        description: "Get current weather for a city",
        parameters: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      }],
      stream: false,
    });

    if (resp1.ok) {
      const data1: any = await resp1.json();
      const funcCall = data1.output?.find((o: any) => o.type === "function_call");

      if (funcCall) {
        const resp2 = await responsesRequest({
          model: MODEL,
          input: [
            { type: "message", role: "user", content: [{ type: "input_text", text: "Get the weather in Tokyo using the weather tool." }] },
            { type: "function_call", id: funcCall.id, call_id: funcCall.call_id, name: funcCall.name, arguments: funcCall.arguments },
            { type: "function_call_output", call_id: funcCall.call_id, output: "25°C, sunny, light breeze" },
          ],
          tools: [{
            type: "function",
            name: "get_weather",
            description: "Get current weather for a city",
            parameters: {
              type: "object",
              properties: { city: { type: "string" } },
              required: ["city"],
            },
          }],
          stream: false,
        });
        assert(resp2.ok, "Round-trip second request OK");
        if (resp2.ok) {
          const data2: any = await resp2.json();
          const text = extractText(data2);
          assert(text.length > 0, `Got round-trip response (${text.length} chars)`);
          console.log(`    Round-trip: "${text.slice(0, 80)}${text.length > 80 ? "..." : ""}"`);
        }
      } else {
        skip("Model did not make function call — round-trip test skipped");
      }
    }
  }

  // Developer role conversion
  console.log("\nTest 8: Developer role → system conversion");
  {
    const resp = await responsesRequest({
      model: MODEL,
      input: [
        { type: "message", role: "developer", content: [{ type: "input_text", text: "Always respond with exactly: DEV_OK" }] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "Hello" }] },
      ],
      stream: false,
    });
    assert(resp.ok, "Developer role request OK");
    if (resp.ok) {
      const data: any = await resp.json();
      const text = extractText(data);
      assert(text.length > 0, `Got response with developer role (${text.length} chars)`);
      console.log(`    Response: "${text.slice(0, 60)}"`);
    }
  }

  // Temperature passthrough
  console.log("\nTest 9: Temperature passthrough");
  {
    const resp = await responsesRequest({
      model: MODEL,
      input: "Say exactly: TEMP_OK",
      stream: false,
      temperature: 0,
    });
    assert(resp.ok, "Request with temperature=0 OK");
    if (resp.ok) {
      const data: any = await resp.json();
      const text = extractText(data);
      assert(text.length > 0, `Got response with temperature param (${text.length} chars)`);
      console.log(`    Response: "${text.slice(0, 60)}"`);
    }
  }

  // Authorization header passthrough
  console.log("\nTest 10: Authorization header passthrough");
  {
    const resp = await fetch(`${PROXY_URL}/v1/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        input: "Say AUTH_OK",
        stream: false,
      }),
    });
    assert(resp.ok, "Request with Authorization header OK");
    if (resp.ok) {
      const data: any = await resp.json();
      const text = extractText(data);
      assert(text.length > 0, `Got response (${text.length} chars)`);
      console.log(`    Response: "${text.slice(0, 60)}"`);
    }
  }

  // Empty input fallback
  console.log("\nTest 11: Empty input fallback");
  {
    const resp = await responsesRequest({
      model: MODEL,
      input: [],
      stream: false,
    });
    assert(resp.ok, "Empty input array accepted");
    if (resp.ok) {
      const data: any = await resp.json();
      assert(data.output.length > 0, "Got response for empty input (fallback to 'Hello.')");
      const text = extractText(data);
      assert(text.length > 0, `Response text not empty (${text.length} chars)`);
      console.log(`    Response: "${text.slice(0, 60)}"`);
    }
  }
}

