/**
 * codex-anywhere — Responses API Handler
 *
 * Handles POST /v1/responses requests, converts to chat/completions,
 * forwards to upstream, and converts response back.
 */

import type { IncomingMessage, ServerResponse } from "http";
import { UPSTREAM, KEY, FILTER_NON_FUNCTION_TOOLS, ACTIVE_MODEL, AVAILABLE_MODELS } from "./config.js";
import { getModelInfo } from "./models.js";
import { updateSessionUsage } from "./session.js";
import { responsesInputToChatMessages, responsesToolsToChatTools, chatToResponses } from "./converters.js";
import { streamChatToResponses } from "./streaming.js";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

export async function handleResponsesRequest(
  req: IncomingMessage,
  res: ServerResponse,
) {
  const body = JSON.parse(await readBody(req));
  const authHeader = req.headers.authorization || "";
  const apiKey = authHeader.replace("Bearer ", "") || KEY;

  const chatMessages = responsesInputToChatMessages(body);
  const tools = responsesToolsToChatTools(body.tools, FILTER_NON_FUNCTION_TOOLS);
  const requestedModel = body.model || "default";
  const stream = body.stream !== false;

  // ── Model mapping ──
  // If the requested model is not in our available models list,
  // fall back to the active model. This handles spawn_agent sending
  // OpenAI model names (o3, gpt-4.1, etc.) to non-OpenAI providers.
  const available = AVAILABLE_MODELS.length > 0 ? AVAILABLE_MODELS : [ACTIVE_MODEL];
  let model = requestedModel;
  if (!available.includes(requestedModel) && ACTIVE_MODEL) {
    console.log(`[MODEL] Mapping unknown model "${requestedModel}" → "${ACTIVE_MODEL}"`);
    model = ACTIVE_MODEL;
  }

  const chatRequest: Record<string, unknown> = {
    model,
    messages: chatMessages,
    stream,
    stream_options: { include_usage: true },
    ...(tools && tools.length > 0 ? { tools } : {}),
    ...(body.temperature != null ? { temperature: body.temperature } : {}),
  };

  console.log(
    `[PROXY] model=${model} msgs=${chatMessages.length} ` +
    `tools=${tools?.length || 0} stream=${stream}`
  );
  if (tools?.length) {
    console.log(`[TOOLS] ${tools.map(t => t.function?.name || t.name).join(", ")}`);
  }
  const info = getModelInfo(model);
  if (info) {
    const compactAt = Math.floor(info.context_window * 0.9);
    console.log(
      `[MODEL] ${model}: context=${formatTokens(info.context_window)} ` +
      `output=${formatTokens(info.max_output)} compact_at=${formatTokens(compactAt)} ` +
      `reasoning=${info.reasoning} tool_call=${info.tool_call}`
    );
  } else {
    console.log(`[MODEL] ${model}: unknown — add to models.dev or MODELS_JSON`);
  }

  // Strip Codex-specific headers that upstream providers won't understand.
  // Codex sends these to OpenAI; non-OpenAI providers may reject them.
  const upstreamHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };

  const upstreamResp = await fetch(
    `${UPSTREAM.replace(/\/$/, "")}/chat/completions`,
    { method: "POST", headers: upstreamHeaders, body: JSON.stringify(chatRequest) },
  );

  if (!upstreamResp.ok) {
    const errText = await upstreamResp.text();
    console.error(`[UPSTREAM ${upstreamResp.status}] ${errText.slice(0, 300)}`);
    res.writeHead(upstreamResp.status, { "Content-Type": "application/json" });
    res.end(errText);
    return;
  }

  if (!stream) {
    const chatResult = await upstreamResp.json();
    const resp = chatToResponses(chatResult);
    updateSessionUsage(chatResult.usage, model);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(resp));
    return;
  }

  streamChatToResponses(upstreamResp, res, model);
}

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}
