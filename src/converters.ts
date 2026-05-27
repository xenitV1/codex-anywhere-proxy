/**
 * codex-anywhere — API Format Converters
 *
 * Converts between OpenAI Responses API and Chat Completions API formats.
 */

export function responsesInputToChatMessages(body: Record<string, any>): any[] {
  const messages: any[] = [];
  if (body.instructions) {
    messages.push({ role: "system", content: body.instructions });
  }
  for (const item of body.input || []) {
    if (typeof item === "string") {
      messages.push({ role: "user", content: item });
    } else if (item.type === "message") {
      const role = item.role === "developer" ? "system" : item.role;
      let content = "";
      if (Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c.type === "input_text" || c.type === "output_text" || c.type === "text") {
            content += c.text || "";
          }
        }
      } else if (typeof item.content === "string") {
        content = item.content;
      }
      if (content) messages.push({ role, content });
    } else if (item.type === "function_call") {
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: [{
          id: item.call_id || item.id,
          type: "function",
          function: { name: item.name, arguments: item.arguments || "{}" },
        }],
      });
    } else if (item.type === "function_call_output") {
      messages.push({ role: "tool", content: item.output, tool_call_id: item.call_id });
    }
  }
  if (messages.length === 0) messages.push({ role: "user", content: "Hello." });
  return messages;
}

/**
 * Convert Responses API tools to chat/completions function tools.
 *
 * Handles:
 * - "function" type → standard function tool
 * - "custom" / freeform (e.g. apply_patch) → function tool with string parameter
 * - "namespace" (MCP grouped tools) → flattened to individual function tools
 * - "web_search", "image_generation", "local_shell", "tool_search" → filtered out
 *   (these are OpenAI Responses API built-ins with no chat/completions equivalent)
 */
/**
 * Tool names that are handled client-side by Codex CLI.
 * For these tools, we strip the "model" parameter from the tool definition
 * because Codex tries to validate the model against its available_models list
 * (which is empty for non-OpenAI providers). Without a model param,
 * Codex inherits the parent model automatically.
 */
const CODEX_AGENT_TOOLS = new Set([
  "spawn_agent",
]);

/**
 * Tool names that Codex manages locally and should have their
 * output_schema stripped to avoid confusing non-OpenAI providers.
 */
const CODEX_LOCAL_TOOLS = new Set([
  "spawn_agent",
  "send_input",
  "send_message",
  "followup_task",
  "wait_agent",
  "close_agent",
  "resume_agent",
  "list_agents",
]);

export function responsesToolsToChatTools(tools: any[] | undefined, filterNonFunction: boolean): any[] | undefined {
  if (!tools || tools.length === 0) return undefined;

  const result: any[] = [];

  for (const t of tools) {
    const type = t.type || "function";

    // Standard function tool — pass through
    if (type === "function") {
      const fnDef: any = {
        name: t.name,
        description: t.description,
        parameters: t.parameters ? JSON.parse(JSON.stringify(t.parameters)) : undefined,
      };

      // Strip "model" parameter from Codex agent tools so they inherit
      // the parent model instead of sending an unknown model name.
      if (CODEX_AGENT_TOOLS.has(t.name) && fnDef.parameters?.properties) {
        delete fnDef.parameters.properties.model;
        if (fnDef.parameters.required) {
          fnDef.parameters.required = fnDef.parameters.required.filter(r => r !== "model");
        }
      }

      result.push({
        type: "function",
        function: fnDef,
      });
      continue;
    }

    // Freeform/custom tool (apply_patch) → convert to function with string input
    if (type === "custom") {
      result.push({
        type: "function",
        function: {
          name: t.name || "custom_tool",
          description: t.description || "Custom tool",
          parameters: {
            type: "object",
            properties: {
              input: { type: "string", description: "Tool input" },
            },
            required: ["input"],
          },
        },
      });
      continue;
    }

    // Namespace tool (MCP grouped tools) → flatten to individual functions
    if (type === "namespace" && Array.isArray(t.tools)) {
      for (const subTool of t.tools) {
        if (subTool.type === "function" || !subTool.type) {
          result.push({
            type: "function",
            function: {
              name: subTool.name,
              description: subTool.description || t.description || "",
              parameters: subTool.parameters || { type: "object", properties: {} },
            },
          });
        }
      }
      continue;
    }

    // Non-function types that can't be translated: web_search, image_generation,
    // local_shell, tool_search — filter out when filterNonFunction is true
    if (!filterNonFunction) {
      // If filtering is disabled, try to pass as-is (will likely be ignored by upstream)
      result.push({
        type: "function",
        function: {
          name: t.name || type,
          description: t.description || `${type} tool`,
          parameters: t.parameters || { type: "object", properties: {} },
        },
      });
    }
    // When filterNonFunction is true (default), these are silently dropped
  }

  return result.length > 0 ? result : undefined;
}

export function chatToResponses(chatResult: Record<string, any>): Record<string, any> {
  const msg = chatResult.choices?.[0]?.message;
  const output: any[] = [];
  if (msg?.content) {
    output.push({ type: "message", role: "assistant", content: [{ type: "output_text", text: msg.content }] });
  }
  if (msg?.tool_calls) {
    for (const tc of msg.tool_calls) {
      output.push({ type: "function_call", id: tc.id, call_id: tc.id, name: tc.function.name, arguments: tc.function.arguments });
    }
  }
  const inputTokens = chatResult.usage?.prompt_tokens || 0;
  const outputTokens = chatResult.usage?.completion_tokens || 0;
  const reasoningTokens = chatResult.usage?.completion_tokens_details?.reasoning_tokens || 0;
  return {
    id: chatResult.id || "resp-" + Date.now(),
    object: "response",
    status: "completed",
    output,
    model: chatResult.model,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      output_tokens_details: { reasoning_tokens: reasoningTokens },
      total_tokens: chatResult.usage?.total_tokens || 0,
    },
  };
}
