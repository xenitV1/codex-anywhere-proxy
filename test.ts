/**
 * codex-anywhere — Test Entry Point
 *
 * Spawns a dedicated test proxy on TEST_PORT (default 8790),
 * runs all test suites, then shuts it down.
 *
 * Run: bun run test.ts
 */

import { spawn } from "child_process";
import { PROXY_URL, MODEL, API_KEY, getResults } from "./tests/helpers.js";
import { run as runEndpoints } from "./tests/endpoints.test.js";
import { run as runApi } from "./tests/api.test.js";
import { run as runStreaming } from "./tests/streaming.test.js";
import { run as runResilience } from "./tests/resilience.test.js";
import { run as runCodexCompat } from "./tests/codex-compat.test.js";

// ─── Spawn test proxy on TEST_PORT ─────────────────────────────
const testPort = parseInt(new URL(PROXY_URL).port, 10);
const proxyProc = spawn("bun", ["run", "proxy.ts"], {
  env: { ...process.env, PORT: String(testPort) },
  stdio: ["ignore", "pipe", "pipe"],
});
let proxyReady = false;

proxyProc.stderr?.on("data", (d: Buffer) => {
  const msg = d.toString();
  if (!proxyReady && msg.includes("Loaded")) proxyReady = true;
  // Silence normal output; show errors
  if (msg.includes("ERROR") || msg.includes("EADDRINUSE")) console.error("[proxy]", msg.trim());
});

// Wait for proxy to be ready
console.log(`Starting test proxy on port ${testPort}...`);
for (let i = 0; i < 30; i++) {
  const health = await fetch(`${PROXY_URL}/health`).catch(() => null);
  if (health?.ok) break;
  await new Promise(r => setTimeout(r, 500));
}

const healthCheck = await fetch(`${PROXY_URL}/health`).catch(() => null);
if (!healthCheck?.ok) {
  console.error(`❌ Test proxy failed to start on port ${testPort}.`);
  proxyProc.kill();
  process.exit(1);
}

console.log("\n🚀 codex-anywhere — Real API Integration Tests");
console.log(`   Proxy:    ${PROXY_URL}`);
console.log(`   Model:    ${MODEL}`);
console.log(`   API Key:  ${API_KEY ? "✓ configured" : "✗ missing"}\n`);

try {
  console.log("═══ Endpoint Tests ═══");
  await runEndpoints();

  console.log("\n═══ Real API Tests ═══");
  await runApi();

  console.log("\n═══ Streaming Tests ═══");
  await runStreaming();

  console.log("\n═══ Resilience Tests ═══");
  await runResilience();

  console.log("\n═══ Codex Compatibility Tests ═══");
  await runCodexCompat();
} catch (err) {
  console.error("\n❌ Unexpected error:", err);
  process.exit(1);
}

// ─── Summary ────────────────────────────────────────────────────────
const { passed, failed, skipped } = getResults();

console.log("\n" + "═".repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
console.log("═".repeat(50) + "\n");

if (failed > 0) {
  console.error("❌ Some tests failed!");
  proxyProc.kill();
  process.exit(1);
} else {
  console.log("✅ All tests passed!");
  proxyProc.kill();
  process.exit(0);
}
