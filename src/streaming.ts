/**
 * codex-anywhere — Streaming SSE Converter
 *
 * Converts upstream chat/completions SSE stream to Responses API events.
 */

import type { ServerResponse } from "http";
import { updateSessionUsage, sessionUsage } from "./session.js";

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function streamChatToResponses(
  upstreamResp: Response,
  res: ServerResponse,
  model: string,
) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const respId = `resp_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const itemId = `msg_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const fcBaseId = `fc_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;

  let sentCreated = false;
  let sentItemAdded = false;
  let textContent = "";
  let usage: Record<string, any> | null = null;
  const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
  let outputIndex = 0;

  function ensureCreated() {
    if (!sentCreated) {
      sentCreated = true;
      res.write(sse("response.created", {
        type: "response.created",
        response: { id: respId, object: "response", status: "in_progress", model, output: [] },
      }));
    }
  }

  function ensureItemAdded() {
    if (!sentItemAdded) {
      sentItemAdded = true;
      res.write(sse("response.output_item.added", {
        type: "response.output_item.added",
        output_index: outputIndex,
        item: { type: "message", id: itemId, role: "assistant", content: [], status: "in_progress" },
      }));
      res.write(sse("response.content_part.added", {
        type: "response.content_part.added",
        output_index: outputIndex,
        content_index: 0,
        part: { type: "output_text", text: "" },
      }));
    }
  }

  function sendCompletion() {
    if (sentItemAdded) {
      res.write(sse("response.output_item.done", {
        type: "response.output_item.done",
        output_index: outputIndex,
        item: {
          type: "message",
          id: itemId,
          role: "assistant",
          content: textContent ? [{ type: "output_text", text: textContent }] : [],
          status: "completed",
        },
      }));
    }

    const toolBaseIndex = outputIndex + (textContent ? 1 : 0);
    for (const [idx, tc] of toolCalls) {
      const toolIndex = toolBaseIndex + idx;
      res.write(sse("response.output_item.added", {
        type: "response.output_item.added",
        output_index: toolIndex,
        item: {
          type: "function_call",
          id: `${fcBaseId}_${idx}`,
          call_id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
          status: "in_progress",
        },
      }));
      res.write(sse("response.output_item.done", {
        type: "response.output_item.done",
        output_index: toolIndex,
        item: {
          type: "function_call",
          id: `${fcBaseId}_${idx}`,
          call_id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
          status: "completed",
        },
      }));
    }

    updateSessionUsage(usage, model);

    const inputTokens = usage?.prompt_tokens || 0;
    const outputTokens = usage?.completion_tokens || 0;
    const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens || 0;
    const totalTokens = usage?.total_tokens || 0;

    res.write(sse("response.completed", {
      type: "response.completed",
      response: {
        id: respId,
        object: "response",
        status: "completed",
        model,
        output: [
          ...(textContent ? [{
            type: "message",
            id: itemId,
            role: "assistant",
            content: [{ type: "output_text", text: textContent }],
            status: "completed",
          }] : []),
          ...[...toolCalls.values()].map((tc, i) => ({
            type: "function_call",
            id: `${fcBaseId}_${i}`,
            call_id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
            status: "completed",
          })),
        ],
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          output_tokens_details: { reasoning_tokens: reasoningTokens },
          total_tokens: totalTokens,
        },
      },
    }));

    console.log(
      `[PROXY] tokens: input=${inputTokens} output=${outputTokens} ` +
      `(reasoning=${reasoningTokens}) total=${totalTokens} | ` +
      `text=${textContent.length}chars tools=${toolCalls.size}`
    );
    console.log(
      `[PROXY] Session: input=${sessionUsage.totalInputTokens} ` +
      `output=${sessionUsage.totalOutputTokens} ` +
      `reasoning=${sessionUsage.totalReasoningTokens} ` +
      `requests=${sessionUsage.requestCount}`
    );
  }

  const reader = upstreamResp.body!.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = "";

  (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { sendCompletion(); res.end(); return; }

        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split("\n");
        sseBuffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") { sendCompletion(); res.end(); return; }

          try {
            const parsed = JSON.parse(data);
            if (parsed.usage) usage = parsed.usage;
            const choice = parsed.choices?.[0];
            if (!choice) continue;

            const delta = choice.delta || {};
            ensureCreated();

            if (delta.content) {
              ensureItemAdded();
              textContent += delta.content;
              res.write(sse("response.output_text.delta", {
                type: "response.output_text.delta",
                output_index: outputIndex,
                content_index: 0,
                delta: delta.content,
              }));
            }

            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!toolCalls.has(idx)) {
                  toolCalls.set(idx, {
                    id: tc.id || `call_${idx}`,
                    name: "",
                    arguments: "",
                  });
                }
                const existing = toolCalls.get(idx)!;
                if (tc.function?.name) existing.name = tc.function.name;
                if (tc.function?.arguments) existing.arguments += tc.function.arguments;
              }
            }
          } catch {
            // Skip malformed
          }
        }
      }
    } catch (err) {
      console.error("[STREAM ERROR]", err);
      sendCompletion();
      res.end();
    }
  })();
}
