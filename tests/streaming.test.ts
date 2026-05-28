/**
 * codex-anywhere — Streaming Tests
 *
 * Streaming real API tests: text streaming, streaming tool calls.
 */

import { MODEL, assert, responsesRequest, parseSSE } from "./helpers.js";

export async function run() {
  // Streaming request
  console.log("Test 1: Real API — streaming request");
  {
    const resp = await responsesRequest({
      model: MODEL,
      input: "Say hello in 3 words.",
      stream: true,
    });
    assert(resp.ok, `Stream request OK (status ${resp.status})`);
    if (resp.ok) {
      const body = await resp.text();
      const events = parseSSE(body);
      assert(events.length > 0, `Received SSE events (${events.length})`);

      const eventTypes = events.map((e) => e.event);
      assert(eventTypes[0] === "response.created", "response.created is first event");
      assert(eventTypes.includes("response.completed"), "Has response.completed event");
      assert(eventTypes.includes("response.output_text.delta"), "Has response.output_text.delta events");

      const deltas = events.filter((e) => e.event === "response.output_text.delta");
      const fullText = deltas.map((d) => d.data?.delta || "").join("");
      assert(fullText.length > 0, `Streamed text (${fullText.length} chars)`);
      console.log(`    Streamed: "${fullText.slice(0, 80)}${fullText.length > 80 ? "..." : ""}"`);

      const completed = events.find((e) => e.event === "response.completed");
      assert(!!completed, "Has response.completed");
      if (completed) {
        const usage = completed.data?.response?.usage;
        assert(!!usage, "Completed event has usage");
        if (usage) {
          assert(usage.input_tokens > 0, `Stream usage input_tokens > 0 (${usage.input_tokens})`);
          assert(usage.output_tokens > 0, `Stream usage output_tokens > 0 (${usage.output_tokens})`);
        }
      }
    }
  }

  // Streaming with tool call
  console.log("\nTest 2: Real API — streaming with tool call");
  {
    const resp = await responsesRequest({
      model: MODEL,
      input: "Calculate 15 * 37 using the calculator tool.",
      tools: [{
        type: "function",
        name: "calculate",
        description: "Perform a math calculation",
        parameters: {
          type: "object",
          properties: {
            expression: { type: "string", description: "Math expression to evaluate" },
          },
          required: ["expression"],
        },
      }],
      stream: true,
    });
    assert(resp.ok, "Streaming tool call request OK");
    if (resp.ok) {
      const body = await resp.text();
      const events = parseSSE(body);
      assert(events.length > 0, `Received SSE events (${events.length})`);

      const completed = events.find((e) => e.event === "response.completed");
      if (completed) {
        const output = completed.data?.response?.output || [];
        const funcCall = output.find((o: any) => o.type === "function_call");
        const toolDoneIdx = events.findIndex((e) =>
          e.event === "response.output_item.done" &&
          e.data?.item?.type === "function_call",
        );
        const completedIdx = events.findIndex((e) => e.event === "response.completed");
        if (toolDoneIdx >= 0 && completedIdx >= 0) {
          assert(toolDoneIdx < completedIdx, "tool output_item.done before response.completed");
        }
        if (funcCall) {
          assert(funcCall.name === "calculate", `Tool name: ${funcCall.name}`);
          console.log(`    Streaming tool call: calculate(${funcCall.arguments})`);
        } else {
          console.log(`    Model responded with text instead of tool call in stream`);
          // not a failure — provider dependent
        }
      }
    }
  }
}
