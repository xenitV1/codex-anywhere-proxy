/**
 * codex-anywhere — Conditional debug logging
 *
 * Set DEBUG=1 or CODEX_PROXY_DEBUG=1 to enable verbose proxy logs.
 */

export const DEBUG =
  process.env.DEBUG === "1" || process.env.CODEX_PROXY_DEBUG === "1";

export function proxyLog(...args: unknown[]): void {
  if (DEBUG) console.log(...args);
}
