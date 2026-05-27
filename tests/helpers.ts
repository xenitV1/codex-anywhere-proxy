/**
 * codex-anywhere — Test Helpers
 *
 * Shared test utilities: assertions, config, API helpers.
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";

// ─── Config ────────────────────────────────────────────────────────
let UPSTREAM_BASE_URL = "https://openrouter.ai/api/v1";
export let API_KEY = "";
let TEST_PORT = 8790;

const envPath = join(dirname(import.meta.url.replace("file://", "")), "..", ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) {
      const k = m[1].trim();
      const v = m[2].trim();
      if (k === "UPSTREAM_BASE_URL") UPSTREAM_BASE_URL = v;
      if (k === "API_KEY") API_KEY = v;
      if (k === "TEST_PORT") TEST_PORT = parseInt(v, 10) || 8790;
    }
  }
}

export const PROXY_URL = process.env.PROXY_URL || `http://localhost:${TEST_PORT}`;

export function pickModel(): string {
  const url = UPSTREAM_BASE_URL.toLowerCase();
  if (url.includes("z.ai")) return "glm-5-turbo";
  if (url.includes("openrouter")) return "deepseek/deepseek-chat-v3-0324";
  if (url.includes("deepseek")) return "deepseek-chat";
  if (url.includes("groq")) return "llama-3.3-70b-versatile";
  if (url.includes("together")) return "meta-llama/Llama-3.3-70B-Instruct-Turbo";
  if (url.includes("mistral")) return "mistral-small-latest";
  if (url.includes("ollama")) return "qwen3:8b";
  return "gpt-4o";
}

export const MODEL = process.env.TEST_MODEL || pickModel();

// ─── Counters ──────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
let skipped = 0;

export function getResults() {
  return { passed, failed, skipped };
}

export function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ ${msg}`);
    failed++;
  }
}

export function assertEqual(actual: any, expected: any, msg: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ ${msg}`);
    console.error(`    expected: ${JSON.stringify(expected)}`);
    console.error(`    actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

export function skip(msg: string) {
  console.log(`  ⊘ ${msg}`);
  skipped++;
}

// ─── API Helpers ───────────────────────────────────────────────────
export async function responsesRequest(body: Record<string, any>): Promise<Response> {
  return fetch(`${PROXY_URL}/v1/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function parseSSE(text: string): { event: string; data: any }[] {
  const events: { event: string; data: any }[] = [];
  let currentEvent = "";
  let currentData = "";
  for (const line of text.split("\n")) {
    if (line.startsWith("event: ")) {
      currentEvent = line.slice(7).trim();
    } else if (line.startsWith("data: ")) {
      currentData = line.slice(6).trim();
      if (currentData !== "[DONE]") {
        try {
          events.push({ event: currentEvent, data: JSON.parse(currentData) });
        } catch {
          events.push({ event: currentEvent, data: currentData });
        }
      }
      currentEvent = "";
      currentData = "";
    }
  }
  return events;
}

export function extractText(data: any): string {
  return data.output?.find((o: any) => o.type === "message")
    ?.content?.[0]?.text || "";
}
