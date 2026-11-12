// @ts-check
// The real extension in a real Chrome (scripts/extension-e2e.mjs): skipped where Chrome is not installed.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

test("the built extension works in Chrome: local file, data: image, permission question, popup, service worker", { timeout: 180_000 }, (t) => {
  const DIST = mkdtempSync(join(tmpdir(), "pc-e2e-build-"));
  try {
    spawnSync(process.execPath, [join(ROOT, "scripts", "build.mjs")], { stdio: "ignore", env: { ...process.env, DIST } });
    const r = spawnSync(process.execPath, [join(ROOT, "scripts", "extension-e2e.mjs")], { encoding: "utf8", timeout: 170_000, env: { ...process.env, DIST } });
    if (/^skip:/m.test(r.stdout)) return t.skip("Chrome not found");
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    rmSync(DIST, { recursive: true, force: true, maxRetries: 5 });
  }
});

