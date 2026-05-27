/**
 * codex-anywhere — Session Usage Tracking
 *
 * Tracks cumulative token usage across the proxy session.
 */

export interface SessionUsage {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalReasoningTokens: number;
  requestCount: number;
  lastModel: string;
  lastRequestAt: number;
}

export const sessionUsage: SessionUsage = {
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalReasoningTokens: 0,
  requestCount: 0,
  lastModel: "",
  lastRequestAt: 0,
};

export function updateSessionUsage(usage: any, model: string) {
  if (!usage) return;
  sessionUsage.totalInputTokens += usage.prompt_tokens || 0;
  sessionUsage.totalOutputTokens += usage.completion_tokens || 0;
  sessionUsage.totalReasoningTokens += usage.completion_tokens_details?.reasoning_tokens || 0;
  sessionUsage.requestCount++;
  sessionUsage.lastModel = model;
  sessionUsage.lastRequestAt = Date.now();
}
