/**
 * codex-anywhere — Endpoint Tests
 *
 * Tests for /health, /stats, /models, /model/:name, /context, model 404.
 */

import { PROXY_URL, MODEL, assert, assertEqual } from "./helpers.js";

export async function run() {
  // Health check
  console.log("Test 1: Health check");
  {
    const resp = await fetch(`${PROXY_URL}/health`);
    assert(resp.ok, "Returns 200");
    const data: any = await resp.json();
    assertEqual(data.status, "ok", "Status is 'ok'");
    assertEqual(data.version, "1.2.0", "Version is 1.2.0");
    assert("upstream" in data, "Has upstream field");
    assert("hasApiKey" in data, "Has hasApiKey field");
    assertEqual(data.hasApiKey, true, "hasApiKey is true");
  }

  // Stats endpoint
  console.log("\nTest 2: Stats endpoint");
  {
    const resp = await fetch(`${PROXY_URL}/stats`);
    assert(resp.ok, "/stats returns 200");
    const data: any = await resp.json();
    assert("cumulative" in data, "Has cumulative object");
    assert("request_count" in data, "Has request_count");
    assert("model" in data, "Has model field");
  }

  // Models catalog
  console.log("\nTest 3: Models catalog");
  {
    const resp = await fetch(`${PROXY_URL}/models`);
    assert(resp.ok, "/models returns 200");
    const data: any = await resp.json();
    assert("total" in data, "Has total count");
    assert(Array.isArray(data.models), "Has models array");
    assert(data.total > 0, `Has models (${data.total})`);
  }

  // Single model info
  console.log("\nTest 4: Single model info (/model/:name)");
  {
    const resp = await fetch(`${PROXY_URL}/model/${MODEL}`);
    assert(resp.ok, `/model/${MODEL} returns 200`);
    const data: any = await resp.json();
    assert(data.context_window > 0, "Has context_window > 0");
    assert(data.compact_threshold > 0, "Has compact_threshold > 0");
    assert(data.compact_threshold < data.context_window, "compact_threshold < context_window");
    assert(!!data.codex_config, "Has codex_config snippet");
    assert(
      data.codex_config.includes("model_context_window"),
      "codex_config includes model_context_window"
    );
  }

  // Models search
  console.log("\nTest 5: Models search");
  {
    const resp = await fetch(`${PROXY_URL}/models?q=glm`);
    assert(resp.ok, "/models?q=glm returns 200");
    const data: any = await resp.json();
    assert(data.models.length > 0, "Search returns results for 'glm'");
    assert(
      data.models.every((m: any) => m.id.toLowerCase().includes("glm")),
      "All results match 'glm'"
    );
  }

  // /context endpoint
  console.log("\nTest 6: /context endpoint");
  {
    const resp = await fetch(`${PROXY_URL}/context?model=${MODEL}`);
    assert(resp.ok, `/context?model=${MODEL} returns 200`);
    const data: any = await resp.json();
    assertEqual(data.model, MODEL, `Model is ${MODEL}`);
    assert(data.context_window > 0, `context_window > 0 (${data.context_window})`);
    assert(data.compact_threshold > 0, "compact_threshold > 0");
    assert(typeof data.used_tokens === "number", "Has used_tokens");
    assert("usage_percent" in data, "Has usage_percent");
    assert("visual" in data, "Has visual bar");
    assert("breakdown" in data, "Has breakdown");
    assert(data.breakdown.input_tokens >= 0, "breakdown has input_tokens");
    assert(data.breakdown.output_tokens >= 0, "breakdown has output_tokens");
    console.log(`    Context: ${data.usage_percent} used, ${data.used_tokens} tokens`);
  }

  // Compact threshold = 90%
  console.log("\nTest 7: Compact threshold = 90% of context window");
  {
    const resp = await fetch(`${PROXY_URL}/model/${MODEL}`);
    const data: any = await resp.json();
    const expectedCompact = Math.floor(data.context_window * 0.9);
    assertEqual(
      data.compact_threshold,
      expectedCompact,
      `compact_threshold = ${expectedCompact} (90% of ${data.context_window})`
    );
  }

  // Model not found 404
  console.log("\nTest 8: /model/:name — unknown model returns 404");
  {
    const resp = await fetch(`${PROXY_URL}/model/definitely-not-a-real-model-xyz-999`);
    assertEqual(resp.status, 404, "Returns 404 for unknown model");
    const data: any = await resp.json();
    assert(!!data.error, "Has error message");
    assert(data.error.includes("not found"), `Error says 'not found': "${data.error.slice(0, 80)}"`);
  }

  // v1 prefix routes
  console.log("\nTest 9: /v1/ prefixed routes");
  {
    const healthResp = await fetch(`${PROXY_URL}/health`);
    assert(healthResp.ok, "/health works");

    const statsResp = await fetch(`${PROXY_URL}/v1/stats`);
    assert(statsResp.ok, "/v1/stats works");

    const modelsResp = await fetch(`${PROXY_URL}/v1/models`);
    assert(modelsResp.ok, "/v1/models works");
  }
}
