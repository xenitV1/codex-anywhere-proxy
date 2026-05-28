/**
 * codex-anywhere — Package version (read once from package.json)
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

let version = "0.0.0";
try {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  version = JSON.parse(readFileSync(pkgPath, "utf-8")).version || version;
} catch {}

export const VERSION = version;
