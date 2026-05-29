/**
 * codex-anywhere — Converter Unit Tests
 *
 * Tests responsesInputToChatMessages and responsesToolsToChatTools
 * without requiring a running proxy or API key.
 */

import { responsesInputToChatMessages, responsesToolsToChatTools, chatToResponses } from "../src/converters.js";
import { assert, assertEqual, getResults } from "./helpers.js";

export async function run() {
  console.log("Test 1: Basic text input");
  {
    const msgs = responsesInputToChatMessages({ input: ["Hello"] });
    assertEqual(msgs.length, 1, "One message");
    assertEqual(msgs[0].role, "user", "Role is user");
    assert(typeof msgs[0].content === "string", "content is string");
    assertEqual(msgs[0].content, "Hello", "content matches");
  }

  console.log("Test 2: Instructions → system message");
  {
    const msgs = responsesInputToChatMessages({ instructions: "Be helpful", input: ["Hi"] });
    assertEqual(msgs.length, 2, "Two messages");
    assertEqual(msgs[0].role, "system", "First is system");
    assert(typeof msgs[0].content === "string", "instructions content is string");
  }

  console.log("Test 3: Instructions as array → must be string");
  {
    const msgs = responsesInputToChatMessages({
      instructions: [{ type: "text", text: "Be helpful" }],
      input: ["Hi"],
    });
    assertEqual(msgs[0].role, "system", "First is system");
    assert(typeof msgs[0].content === "string", "instructions content is string (not array)");
    assert(!Array.isArray(msgs[0].content), "instructions content is NOT array");
  }

  console.log("Test 4: Message with input_text content");
  {
    const msgs = responsesInputToChatMessages({
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Hello" }] }],
    });
    assertEqual(msgs.length, 1, "One message");
    assert(typeof msgs[0].content === "string", "content is string");
    assertEqual(msgs[0].content, "Hello", "text extracted");
  }

  console.log("Test 5: Message with input_image — no text");
  {
    const msgs = responsesInputToChatMessages({
      input: [{ type: "message", role: "user", content: [{ type: "input_image", image_url: "data:image/png;base64,abc" }] }],
    });
    assertEqual(msgs.length, 1, "Message NOT dropped");
    assert(typeof msgs[0].content === "string", "content is string");
    assert(msgs[0].content.includes("image"), "content mentions image");
    assert(!msgs[0].content.includes("data:image"), "base64 data stripped");
  }

  console.log("Test 6: Message with mixed text + image");
  {
    const msgs = responsesInputToChatMessages({
      input: [{
        type: "message", role: "user",
        content: [
          { type: "input_text", text: "Look at this: " },
          { type: "input_image", image_url: "data:image/png;base64,abc" },
        ],
      }],
    });
    assertEqual(msgs.length, 1, "One message");
    assert(typeof msgs[0].content === "string", "content is string");
    assert(msgs[0].content.startsWith("Look at this:"), "text preserved");
    assert(msgs[0].content.includes("image"), "image placeholder added");
  }

  console.log("Test 7: function_call — content must be string, not null");
  {
    const msgs = responsesInputToChatMessages({
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "read file" }] },
        { type: "function_call", call_id: "call_1", name: "read_file", arguments: '{"path":"x"}' },
      ],
    });
    const fc = msgs.find((m: any) => m.tool_calls);
    assert(!!fc, "Found function_call message");
    assertEqual(fc.role, "assistant", "Role is assistant");
    assert(typeof fc.content === "string", "content is string (not null)");
    assert(fc.content !== null, "content is NOT null");
    assert(!Array.isArray(fc.content), "content is NOT array");
  }

  console.log("Test 8: function_call_output — output as string");
  {
    const msgs = responsesInputToChatMessages({
      input: [
        { type: "function_call", call_id: "c1", name: "tool", arguments: "{}" },
        { type: "function_call_output", call_id: "c1", output: "result text" },
      ],
    });
    const tool = msgs.find((m: any) => m.role === "tool");
    assert(!!tool, "Found tool message");
    assert(typeof tool.content === "string", "content is string");
    assertEqual(tool.content, "result text", "output preserved");
  }

  console.log("Test 9: function_call_output — output as array (edge case)");
  {
    const msgs = responsesInputToChatMessages({
      input: [
        { type: "function_call", call_id: "c1", name: "tool", arguments: "{}" },
        { type: "function_call_output", call_id: "c1", output: [{ type: "text", text: "array result" }] },
      ],
    });
    const tool = msgs.find((m: any) => m.role === "tool");
    assert(!!tool, "Found tool message");
    assert(typeof tool.content === "string", "content is string (not array)");
    assert(!Array.isArray(tool.content), "content is NOT array");
  }

  console.log("Test 10: function_call_output — output as undefined");
  {
    const msgs = responsesInputToChatMessages({
      input: [
        { type: "function_call", call_id: "c1", name: "tool", arguments: "{}" },
        { type: "function_call_output", call_id: "c1" },
      ],
    });
    const tool = msgs.find((m: any) => m.role === "tool");
    assert(!!tool, "Found tool message");
    assert(typeof tool.content === "string", "content is string");
  }

  console.log("Test 11: Consecutive assistant message + function_call — must merge");
  {
    const msgs = responsesInputToChatMessages({
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "Let me check." }] },
        { type: "function_call", call_id: "c1", name: "read_file", arguments: "{}" },
        { type: "function_call_output", call_id: "c1", output: "file contents" },
      ],
    });
    // Should be: user, assistant (merged with tool_calls), tool — NOT two assistant messages
    const assistantMsgs = msgs.filter((m: any) => m.role === "assistant");
    assertEqual(assistantMsgs.length, 1, "Only ONE assistant message (merged)");
    assertEqual(assistantMsgs[0].content, "Let me check.", "Text preserved");
    assert(!!assistantMsgs[0].tool_calls, "Has tool_calls");
    assertEqual(assistantMsgs[0].tool_calls.length, 1, "One tool call");
  }

  console.log("Test 12: Multiple function_calls in sequence — must merge");
  {
    const msgs = responsesInputToChatMessages({
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] },
        { type: "function_call", call_id: "c1", name: "read_file", arguments: "{}" },
        { type: "function_call", call_id: "c2", name: "list_dir", arguments: "{}" },
        { type: "function_call_output", call_id: "c1", output: "file" },
        { type: "function_call_output", call_id: "c2", output: "dir" },
      ],
    });
    const assistantMsgs = msgs.filter((m: any) => m.role === "assistant");
    assertEqual(assistantMsgs.length, 1, "Only ONE assistant message");
    assertEqual(assistantMsgs[0].tool_calls.length, 2, "Two tool calls merged");
  }

  console.log("Test 13: Developer role → system");
  {
    const msgs = responsesInputToChatMessages({
      input: [{ type: "message", role: "developer", content: [{ type: "input_text", text: "Be concise" }] }],
    });
    assertEqual(msgs[0].role, "system", "Developer → system");
  }

  console.log("Test 14: Empty input fallback");
  {
    const msgs = responsesInputToChatMessages({ input: [] });
    assert(msgs.length > 0, "Has fallback message");
  }

  console.log("Test 15: All content fields are strings — no arrays anywhere");
  {
    const msgs = responsesInputToChatMessages({
      instructions: "Be helpful",
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "hello" }] },
        { type: "message", role: "user", content: [
          { type: "input_text", text: "view image" },
          { type: "input_image", image_url: "data:image/png;base64,abc" },
        ]},
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "checking" }] },
        { type: "function_call", call_id: "c1", name: "read", arguments: "{}" },
        { type: "function_call_output", call_id: "c1", output: "done" },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "result" }] },
      ],
    });
    for (let i = 0; i < msgs.length; i++) {
      assert(typeof msgs[i].content === "string", `msg[${i}].content is string`);
      assert(!Array.isArray(msgs[i].content), `msg[${i}].content is NOT array`);
      assert(msgs[i].content !== null, `msg[${i}].content is NOT null`);
    }
  }

  console.log("Test 16: tools conversion — namespace tools");
  {
    const { tools, toolNamespaces } = responsesToolsToChatTools([
      { type: "namespace", name: "multi_agent_v1", tools: [
        { type: "function", name: "spawn_agent", parameters: { type: "object", properties: {} } },
      ]},
    ], true);
    assert(!!tools, "Has tools");
    assertEqual(tools.length, 1, "One flattened tool");
    assertEqual(tools[0].function.name, "spawn_agent", "Tool name");
    assertEqual(toolNamespaces["spawn_agent"], "multi_agent_v1", "Namespace mapped");
  }

  console.log("Test 17: tools conversion — filter non-function types");
  {
    const { tools } = responsesToolsToChatTools([
      { type: "function", name: "my_func", parameters: {} },
      { type: "web_search" },
      { type: "image_generation" },
      { type: "local_shell" },
    ], true);
    assertEqual(tools.length, 1, "Only function tool kept");
    assertEqual(tools[0].function.name, "my_func", "Function tool name");
  }

  console.log("Test 18: chatToResponses — restores namespace on function_call");
  {
    const resp = chatToResponses({
      id: "chat-1",
      choices: [{ message: { tool_calls: [{ id: "tc1", function: { name: "spawn_agent", arguments: "{}" } }] } }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    }, { spawn_agent: "multi_agent_v1" });
    const fc = resp.output.find((o: any) => o.type === "function_call");
    assert(!!fc, "Found function_call");
    assertEqual(fc.namespace, "multi_agent_v1", "Namespace restored");
  }
}
