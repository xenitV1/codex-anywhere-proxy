/**
 * codex-anywhere — Conditional debug logging
 *
 * Enable via config.toml `debug = true`, or DEBUG=1 / CODEX_PROXY_DEBUG=1.
 */

import { PROXY_DEBUG } from "./config.js";

export const DEBUG =
  PROXY_DEBUG ||
  process.env.DEBUG === "1" ||
  process.env.CODEX_PROXY_DEBUG === "1";

export function proxyLog(...args: unknown[]): void {
  if (DEBUG) console.log(...args);
}
