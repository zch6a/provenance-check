// @ts-check
// The built extension: what it asks for, what it ships, and what its pages may run.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(ROOT, "dist");
execFileSync(process.execPath, [join(ROOT, "scripts", "build.mjs")], { stdio: "ignore" });
const manifest = JSON.parse(readFileSync(join(DIST, "manifest.json"), "utf8"));

test("it asks only for the right-click menu; access to a site's images is asked for when needed", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["contextMenus"]);
  assert.deepEqual(manifest.optional_host_permissions, ["<all_urls>"]);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.content_scripts, undefined, "no script runs in web pages");
});

test("its pages run only the extension's own scripts (and its WebAssembly)", () => {
  assert.equal(manifest.content_security_policy.extension_pages, "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'");
});

test("the version follows package.json, and everything the pages load is in the package", () => {
  assert.equal(manifest.version, JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version);
  for (const f of ["background.js", "report.html", "report.js", "popup.html", "popup.js", "style.css", "vendor/c2pa_worker.js", "vendor/c2pa_bg.wasm",
    ...Object.values(/** @type {Record<string, string>} */ (manifest.icons))]) assert.ok(existsSync(join(DIST, f)), f);
});

test("the C2PA library starts its worker from the packaged file (its https-only check accepts the extension's URL)", () => {
  const report = readFileSync(join(DIST, "report.js"), "utf8");
  assert.match(report, /protocol === "chrome-extension:"/);
  assert.match(report, /protocol === "moz-extension:"/);
});

test("no script of ours fetches anything but the image, and no page uses innerHTML", () => {
  const src = join(ROOT, "src");
  for (const f of readdirSync(src)) {
    const code = readFileSync(join(src, f), "utf8");
    assert.doesNotMatch(code, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, f);
    assert.doesNotMatch(code, /https?:\/\/(?!cv\.iptc\.org)/, `${f} names no web address (except the IPTC vocabulary it matches)`);
    if (f !== "report.js") assert.doesNotMatch(code, /\bfetch\(/, `${f} does not fetch`);
  }
});
