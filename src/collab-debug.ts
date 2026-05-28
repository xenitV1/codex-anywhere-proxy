/**
 * Collab / multi-agent tool diagnostics (spawn_agent, wait_agent, …).
 *
 * Enable verbose logs: config.toml debug=true, or DEBUG=1 / CODEX_PROXY_DEBUG=1
 * Namespace missing on spawn_agent always logs a warning (even without debug).
 */

import { DEBUG, proxyLog } from "./debug.js";

/** Tools registered under multi_agent_v1 namespace in Codex. */
export const COLLAB_TOOL_NAMES = new Set([
  "spawn_agent",
  "send_input",
  "send_message",
  "followup_task",
  "wait_agent",
  "close_agent",
  "resume_agent",
  "list_agents",
]);

const SPAWN_AGENT = "spawn_agent";

export function isCollabTool(name: string): boolean {
  return COLLAB_TOOL_NAMES.has(name);
}

function truncate(s: string, max = 400): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `…(+${s.length - max} chars)`;
}

/** Parse spawn_agent arguments for logs; never throws. */
export function summarizeSpawnAgentArgs(argumentsJson: string): Record<string, unknown> {
  const raw = argumentsJson?.trim();
  if (!raw) return { _empty: true };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const summary: Record<string, unknown> = {};
    for (const key of [
      "agent_type",
      "task_name",
      "message",
      "fork_context",
      "fork_turns",
      "model",
      "items",
    ]) {
      if (key in parsed) {
        const v = parsed[key];
        if (typeof v === "string") {
          summary[key] = truncate(v, 120);
        } else {
          summary[key] = v;
        }
      }
    }
    if (Object.keys(summary).length === 0) {
      summary._keys = Object.keys(parsed);
    }
    return summary;
  } catch (err) {
    return { _parse_error: String(err), _raw_preview: truncate(raw, 200) };
  }
}

/** Log namespace map built from Codex request tools. */
export function logCollabToolsRequest(
  codexTools: unknown[] | undefined,
  toolNamespaces: Record<string, string>,
  flatToolNames: string[],
): void {
  if (!DEBUG) return;

  const collabInRequest = (codexTools || []).filter((t: any) => {
    if (t?.type === "namespace" && t?.name === "multi_agent_v1") return true;
    if (t?.type === "function" && isCollabTool(t?.name)) return true;
    return false;
  });

  if (collabInRequest.length === 0 && !Object.keys(toolNamespaces).some((n) => isCollabTool(n))) {
    return;
  }

  proxyLog("[COLLAB] ── request tool conversion ──");
  for (const t of collabInRequest as any[]) {
    if (t.type === "namespace") {
      const subs = (t.tools || []).map((s: any) => s.name).filter(Boolean);
      proxyLog(`[COLLAB]   codex namespace "${t.name}" → flat tools: ${subs.join(", ") || "(none)"}`);
    } else if (t.type === "function" && isCollabTool(t.name)) {
      proxyLog(`[COLLAB]   codex function "${t.name}" (direct, not namespaced in request)`);
    }
  }

  const collabMappings = Object.entries(toolNamespaces).filter(([n]) => isCollabTool(n));
  if (collabMappings.length > 0) {
    proxyLog("[COLLAB]   namespace restore map (upstream flat name → codex namespace):");
    for (const [name, ns] of collabMappings) {
      proxyLog(`[COLLAB]     ${name} → "${ns}"`);
    }
  } else if (flatToolNames.some((n) => isCollabTool(n))) {
    proxyLog(
      "[COLLAB]   ⚠ collab tools sent upstream but NO namespace map — " +
      "Codex will likely return unsupported call: spawn_agent",
    );
  }

  const flatCollab = flatToolNames.filter((n) => isCollabTool(n));
  if (flatCollab.length) {
    proxyLog(`[COLLAB]   upstream flat tool names: ${flatCollab.join(", ")}`);
  }
}

export interface CollabFunctionCallLog {
  phase: "added" | "done";
  elapsedMs: number;
  name: string;
  callId: string;
  fcItemId: string;
  outputIndex: number;
  namespace?: string;
  arguments?: string;
  upstreamToolIndex?: number;
}

/**
 * Log a function_call item being sent to Codex.
 * spawn_agent without namespace → always warn (root cause of unsupported call).
 */
export function logCollabFunctionCall(ctx: CollabFunctionCallLog): void {
  const { name, namespace, phase, elapsedMs, callId, fcItemId, outputIndex, arguments: args } = ctx;
  if (!isCollabTool(name)) return;

  const registryKey = namespace ? `${namespace}.${name}` : name;
  const codexExpects = name === SPAWN_AGENT
    ? 'ToolName::namespaced("multi_agent_v1", "spawn_agent") when Collab v1'
    : `namespaced handler for "${name}"`;

  if (name === SPAWN_AGENT && !namespace) {
    console.warn(
      `[COLLAB] ⚠ spawn_agent output_item.${phase} WITHOUT namespace (+${elapsedMs}ms) ` +
      `call_id=${callId} — Codex registry lookup will use plain "${name}" and likely respond ` +
      `"unsupported call: spawn_agent". Expected: ${codexExpects}. ` +
      "Fix: ensure namespace tool defs in request are mapped in toolNamespaces.",
    );
  }

  if (!DEBUG) return;

  const header =
    `[COLLAB] +${elapsedMs}ms ${name} ${phase} ` +
    `idx=${outputIndex} call_id=${callId} fc_id=${fcItemId}`;
  proxyLog(header);
  proxyLog(`[COLLAB]   codex registry key: "${registryKey}" (expects: ${codexExpects})`);
  if (namespace) {
    proxyLog(`[COLLAB]   namespace: "${namespace}" ✓`);
  } else {
    proxyLog(`[COLLAB]   namespace: (missing) ✗`);
  }

  if (phase === "done" && args !== undefined) {
    if (name === SPAWN_AGENT) {
      proxyLog(`[COLLAB]   arguments summary: ${JSON.stringify(summarizeSpawnAgentArgs(args))}`);
      proxyLog(`[COLLAB]   arguments length: ${args.length} chars`);
    } else {
      proxyLog(`[COLLAB]   arguments: ${truncate(args, 300)}`);
    }
  }
}

/** Non-streaming response: log collab tool_calls returned by upstream. */
export function logCollabNonStreamResponse(
  chatResult: Record<string, any>,
  toolNamespaces: Record<string, string>,
  elapsedMs: number,
): void {
  const toolCalls = chatResult.choices?.[0]?.message?.tool_calls;
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return;

  const collab = toolCalls.filter((tc: any) => isCollabTool(tc?.function?.name));
  if (collab.length === 0) return;

  for (const tc of collab) {
    const name = tc.function?.name as string;
    const ns = toolNamespaces[name];
    if (name === SPAWN_AGENT && !ns) {
      console.warn(
        `[COLLAB] ⚠ non-stream spawn_agent WITHOUT namespace (+${elapsedMs}ms) ` +
        `call_id=${tc.id} — Codex will likely return unsupported call: spawn_agent`,
      );
    }
    if (!DEBUG) continue;
    proxyLog(
      `[COLLAB] +${elapsedMs}ms non-stream ${name} call_id=${tc.id} ` +
      `namespace=${ns ? `"${ns}"` : "MISSING"}`,
    );
    if (name === SPAWN_AGENT && tc.function?.arguments) {
      proxyLog(
        `[COLLAB]   arguments: ${JSON.stringify(summarizeSpawnAgentArgs(tc.function.arguments))}`,
      );
    }
  }
}

/** End-of-stream summary for parallel collab tool calls. */
export function logCollabToolsSummary(
  elapsedMs: number,
  toolCalls: Iterable<{ name: string; id: string; done: boolean; arguments: string }>,
  toolNamespaces: Record<string, string>,
): void {
  const collab = [...toolCalls].filter((t) => isCollabTool(t.name));
  if (collab.length === 0) return;

  const spawnCalls = collab.filter((t) => t.name === SPAWN_AGENT);
  const missingNs = spawnCalls.filter(() => !toolNamespaces[SPAWN_AGENT]);

  if (missingNs.length > 0) {
    console.warn(
      `[COLLAB] ⚠ stream completed with ${spawnCalls.length} spawn_agent call(s) but ` +
      `toolNamespaces has no entry for spawn_agent — all will fail in Codex CLI.`,
    );
  }

  if (!DEBUG) return;

  proxyLog(`[COLLAB] ── stream summary +${elapsedMs}ms ──`);
  proxyLog(`[COLLAB]   collab tool calls: ${collab.length}`);
  for (const t of collab) {
    const ns = toolNamespaces[t.name];
    proxyLog(
      `[COLLAB]   - ${t.name} call_id=${t.id} done=${t.done} ` +
      `namespace=${ns ? `"${ns}"` : "MISSING"} args_len=${t.arguments.length}`,
    );
  }
  if (Object.keys(toolNamespaces).length > 0) {
    proxyLog(
      `[COLLAB]   full namespace map: ${JSON.stringify(toolNamespaces)}`,
    );
  }
}
