// Round 2's independent review: each finding, reproduced on the real library with files derived from the synthetic
// fixtures (in memory, or in a temp folder), so that it cannot come back.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { explain } from "../src/explain.js";
import { readCredentials } from "../src/node-reader.js";
import { clean } from "../src/render.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const fixture = (/** @type {string} */ name) => readFileSync(join(ROOT, "test", "fixtures", name));
const CLI = join(ROOT, "src", "cli.js");
const run = (/** @type {string[]} */ args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });

/** Replace the first occurrence of `from` with `to` (same length, so every offset in the file stays valid). */
function patch(/** @type {Buffer} */ bytes, /** @type {string} */ from, /** @type {string} */ to) {
  assert.equal(from.length, to.length);
  const out = Buffer.from(bytes);
  const at = out.indexOf(from, 0, "latin1");
  assert.ok(at >= 0, `${from} is in the file`);
  out.write(to, at, "latin1");
  return out;
}

const temp = () => mkdtempSync(join(tmpdir(), "provenance-review2-"));

test("the credentials of the file it was made from altered: not intact (finding 1)", async () => {
  // A different signer's name written into the ingredient's embedded manifest, the file's own signature untouched.
  const bytes = patch(fixture("edited.jpg"), "Example Test Studio", "Reuters Photo Desk.");
  const read = await readCredentials(bytes, "image/jpeg");
  assert.equal(read.store?.validation_state, "Invalid", "the library says so");
  const report = explain(read.store);
  assert.equal(report.verdict, "invalid");
  assert.match(report.headline, /do not match/);
  assert.ok(report.problems.some((p) => /made from \(camera\.jpg\)/.test(p) && /changed after it was used/.test(p)), report.problems.join(" | "));
  assert.ok(report.history[0]?.problems.length, "and the history item says what is wrong with it");
});

test("remote credentials at an address that mentions manifests: still remote, not none (finding 2)", async () => {
  const original = "https://credentials.example.invalid/landscape.c2pa";
  const moved = "https://cdn.canon.invalid/manifests/landscape.c2pa";
  const read = await readCredentials(patch(fixture("remote-credentials.jpg"), original, moved), "image/jpeg");
  assert.equal(read.remoteUrl, moved);
  assert.equal(explain(read.store, read).verdict, "remote");
});

test("a broken file without C2PA is an error, not damaged credentials (finding 3)", () => {
  const dir = temp();
  try {
    writeFileSync(join(dir, "junk.gif"), "hello, this is text, not a picture");
    const png = readFileSync(join(ROOT, "test", "fixtures", "source", "gradient.png"));
    writeFileSync(join(dir, "cut.png"), png.subarray(0, Math.floor(png.length * 0.9)));
    for (const name of ["junk.gif", "cut.png"]) {
      const r = run([join(dir, name), "--json"]);
      assert.equal(r.status, 2, `${name}: could not be checked`);
      const res = JSON.parse(r.stdout).results[0];
      assert.ok(!res.report, `${name}: no report, so no "damaged" verdict`);
      assert.match(res.error, /could not read it/);
    }
    // A signed file cut short still is damaged or invalid: it does carry credentials.
    const signed = fixture("camera.jpg");
    writeFileSync(join(dir, "cut.jpg"), signed.subarray(0, Math.floor(signed.length * 0.6)));
    const cut = JSON.parse(run([join(dir, "cut.jpg"), "--json"]).stdout).results[0];
    assert.equal(cut.report?.verdict, "invalid", JSON.stringify(cut));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a file that cannot be opened: an error for that file, the others still checked (finding 4)", { skip: (process.platform === "win32" || process.getuid?.() === 0) && "needs a POSIX permission that a non-root user cannot override" }, () => {
  const dir = temp();
  try {
    const locked = join(dir, "locked.jpg");
    writeFileSync(locked, fixture("tampered.jpg"));
    chmodSync(locked, 0o000);
    const r = run([locked, join(ROOT, "test", "fixtures", "edited.jpg"), "--json"]);
    assert.equal(r.status, 2);
    const [a, b] = JSON.parse(r.stdout).results;
    assert.equal(a.error, "not allowed to read it");
    assert.equal(b.report.verdict, "valid");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a file name with escape sequences and bidi controls is printed safely, in text and in JSON (findings 5, 7)", () => {
  const name = "evil\u001b]0;PWNED\u0007\u001b[31mRED\u202Egpj.exe\u009b2J";
  const text = run([name]);
  assert.equal(text.status, 2);
  assert.doesNotMatch(text.stdout, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202A-\u202E]/);
  assert.match(text.stdout, /no such file/);
  const json = run([name, "--json"]);
  assert.doesNotMatch(json.stdout, /[\u007f-\u009f\u202A-\u202E]/, "no raw C1 or bidi character in the JSON text");
  assert.equal(JSON.parse(json.stdout).results[0].file, name, "the JSON value itself is unchanged");
});

test("formats the library reads are not refused; empty files say so (finding 6)", () => {
  const dir = temp();
  try {
    const avi = Buffer.alloc(64);
    avi.write("RIFF", 0);
    avi.writeUInt32LE(56, 4);
    avi.write("AVI LIST", 8);
    writeFileSync(join(dir, "plain.avi"), avi);
    writeFileSync(join(dir, "empty.jpg"), "");
    const r = run([join(dir, "plain.avi"), join(dir, "empty.jpg"), "--json"]);
    const [a, e] = JSON.parse(r.stdout).results;
    assert.equal(a.type, "video/x-msvideo");
    assert.equal(a.report?.verdict, "none", JSON.stringify(a));
    assert.equal(e.error, "empty file");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("clean(): invisible and line-breaking characters, tag characters, and a cut on whole characters (finding 7)", () => {
  assert.equal(clean("pay\u200Bpal\u2028x\u2029y\uFEFF"), "pay�pal�x�y�");
  assert.equal(clean("a\u{E0041}\u{E0042}b"), "a��b");
  assert.equal(clean("\u{1F468}\u200D\u{1F469}"), "\u{1F468}\u200D\u{1F469}", "joiners stay: emoji need them");
  const cut = clean(`${"x".repeat(399)}\u{1F600}tail`);
  assert.ok(cut.startsWith(`${"x".repeat(399)}\u{1F600}…`), "the emoji at the cut is whole");
  assert.doesNotMatch(cut, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/, "no lone surrogate");
});
