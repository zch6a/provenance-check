// What `npx github:zch6a/provenance-check` installs: the files list in package.json must hold the command line and
// every module it imports (a missing one would break the command for everyone while every test here still passes),
// and the WebAssembly reader must be a direct dependency.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

/** Local modules `entry` imports, transitively, as paths relative to the project. @param {string} entry */
function localImports(entry) {
  const seen = new Set([entry]);
  const queue = [entry];
  while (queue.length) {
    const rel = /** @type {string} */ (queue.shift());
    const text = readFileSync(join(ROOT, rel), "utf8");
    for (const m of text.matchAll(/^\s*(?:import|export)\s[^"']*?from\s+["'](\.{1,2}\/[^"']+)["']|^\s*import\s+["'](\.{1,2}\/[^"']+)["']/gm)) {
      const next = normalize(join(dirname(rel), /** @type {string} */ (m[1] ?? m[2]))).replace(/\\/g, "/");
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return [...seen];
}

test("the package holds the command line and everything it imports", () => {
  const out = execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: ROOT, encoding: "utf8", shell: process.platform === "win32", env: { ...process.env, npm_config_loglevel: "silent" },
  });
  const files = new Set(JSON.parse(out)[0].files.map((/** @type {{path: string}} */ f) => f.path.replace(/\\/g, "/")));
  const bin = pkg.bin["provenance-check"];
  const needed = [...localImports(bin), "package.json"]; // cli.js reads its version from package.json
  assert.ok(needed.length >= 6, needed.join(", "));
  for (const f of needed) assert.ok(files.has(f), `${f} is installed`);
  assert.ok(!files.has("test/fixtures/edited.jpg"), "test images are not installed");
  assert.ok(readFileSync(join(ROOT, bin), "utf8").startsWith("#!/usr/bin/env node"), "the command has a shebang");
});

test("the WebAssembly reader is a direct dependency, at the version c2pa-web was built against", () => {
  const web = JSON.parse(readFileSync(join(ROOT, "node_modules", "@contentauth", "c2pa-web", "package.json"), "utf8"));
  assert.equal(pkg.dependencies["@contentauth/c2pa-wasm"], web.dependencies["@contentauth/c2pa-wasm"]);
});
