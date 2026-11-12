// The release zip (scripts/zip.mjs): what goes in comes out, byte for byte; the same files give the same zip; and the
// script refuses a dist/ built for another version. Read back by a small parser here, and by the system's unzip
// where there is one.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as zlib from "node:zlib";

import { crc32, zip } from "../scripts/zip.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

/** The entries of a zip, from its central directory. @param {Buffer} z */
function unzip(z) {
  const end = z.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = z.readUInt16LE(end + 10);
  let at = z.readUInt32LE(end + 16);
  /** @type {Map<string, Buffer>} */
  const out = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(z.readUInt32LE(at), 0x02014b50);
    const method = z.readUInt16LE(at + 10);
    const crc = z.readUInt32LE(at + 16);
    const size = z.readUInt32LE(at + 20);
    const nameLength = z.readUInt16LE(at + 28);
    const local = z.readUInt32LE(at + 42);
    const name = z.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    const start = local + 30 + z.readUInt16LE(local + 26) + z.readUInt16LE(local + 28);
    const body = z.subarray(start, start + size);
    const data = method === 8 ? zlib.inflateRawSync(body) : Buffer.from(body);
    assert.equal(crc32(data), crc, `${name}: CRC`);
    out.set(name, data);
    at += 46 + nameLength + z.readUInt16LE(at + 30) + z.readUInt16LE(at + 32);
  }
  return out;
}

const require = createRequire(import.meta.url);
const wasm = readFileSync(require.resolve("@contentauth/c2pa-wasm/package.json").replace(/package\.json$/, "pkg/c2pa_bg.wasm"));
const entries = [
  { name: "manifest.json", data: Buffer.from(JSON.stringify({ manifest_version: 3, version: pkg.version })) },
  { name: "report.js", data: Buffer.from("console.log('a report');\n".repeat(200)) },
  { name: "vendor/c2pa_bg.wasm", data: wasm },
  { name: "icons/16.png", data: readFileSync(join(ROOT, "static", "icons", "16.png")) },
  { name: "empty.txt", data: Buffer.alloc(0) },
];

test("what goes in comes out, byte for byte, compressed where that helps", () => {
  const z = zip(entries);
  const back = unzip(z);
  assert.deepEqual([...back.keys()], entries.map((e) => e.name));
  for (const e of entries) assert.ok(back.get(e.name)?.equals(e.data), e.name);
  assert.ok(z.length < entries.reduce((n, e) => n + e.data.length, 0), "smaller than the files");
});

test("CRC-32 agrees with zlib's, where Node has one", { skip: typeof (/** @type {any} */ (zlib)).crc32 !== "function" && "node:zlib has no crc32 before Node 20.15" }, () => {
  for (const e of entries) assert.equal(crc32(e.data), (/** @type {any} */ (zlib)).crc32(e.data) >>> 0, e.name);
});

test("the same files give the same zip; the script refuses a dist/ of another version", () => {
  assert.ok(zip(entries).equals(zip(entries)), "reproducible");
  const dir = mkdtempSync(join(tmpdir(), "provenance-zip-"));
  try {
    const dist = join(dir, "dist");
    for (const e of entries) {
      mkdirSync(join(dist, e.name, ".."), { recursive: true });
      writeFileSync(join(dist, e.name), e.data);
    }
    const out = join(dir, "out.zip");
    const ok = spawnSync(process.execPath, [join(ROOT, "scripts", "zip.mjs"), out], { encoding: "utf8", env: { ...process.env, DIST: dist } });
    assert.equal(ok.status, 0, ok.stderr);
    assert.deepEqual([...unzip(readFileSync(out)).keys()], [...entries.map((e) => e.name)].sort());
    const tool = spawnSync("unzip", ["-tq", out], { encoding: "utf8" });
    if (!tool.error) assert.equal(tool.status, 0, `unzip -t: ${tool.stdout}${tool.stderr}`);

    writeFileSync(join(dist, "manifest.json"), JSON.stringify({ version: "0.0.1" }));
    const stale = spawnSync(process.execPath, [join(ROOT, "scripts", "zip.mjs"), out], { encoding: "utf8", env: { ...process.env, DIST: dist } });
    assert.notEqual(stale.status, 0);
    assert.match(stale.stderr, /built for 0\.0\.1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the release notes: the CHANGELOG section of this version, which must exist before a tag", async () => {
  const { notes } = await import("../scripts/release-notes.mjs");
  const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
  const text = notes(changelog, pkg.version);
  assert.ok(text.length > 100, "a section with content for the package version");
  assert.doesNotMatch(text, /^## /m, "only that section");
  assert.throws(() => notes(changelog, "99.0.0"), /no section for 99\.0\.0/);
});
