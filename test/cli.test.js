// The command line: the reports for the test images, exit codes, JSON, text from credentials made safe for a
// terminal, and file types from bytes. Synthetic test images only (test/fixtures, made by scripts/make-fixtures.mjs).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { hasC2paMarker, sniffType } from "../src/file-type.js";
import { reportText } from "../src/text.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI = join(ROOT, "src", "cli.js");
const fixture = (/** @type {string} */ name) => join(ROOT, "test", "fixtures", name);
const run = (/** @type {string[]} */ args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });

test("each test image: the verdict, the exit code and the words that matter", () => {
  const cases = [
    ["edited.jpg", 0, /intact, signed by "Example Test Studio \(not trusted\)" \(signer not verified\)/, /cropped/],
    ["ai-generated.png", 0, /intact/, /made by generative AI/],
    ["tampered.jpg", 1, /do not match this file/, /The picture changed after it was signed\./],
    ["no-credentials.jpg", 0, /No Content Credentials/, /says nothing about whether the image is real/],
    ["remote-credentials.jpg", 0, /stored elsewhere, not checked/, /credentials\.example\.invalid/],
    ["identity-did-web.jpg", 0, /intact/, /Identity statement/],
  ];
  for (const [name, code, head, body] of cases) {
    const r = run([fixture(String(name))]);
    assert.equal(r.status, code, `${name}: ${r.stderr}`);
    assert.match(r.stdout.split("\n")[0] ?? "", /** @type {RegExp} */ (head), String(name));
    assert.match(r.stdout, /** @type {RegExp} */ (body), String(name));
  }
});

test("--json: one result per file, the report the extension shows, errors per file", () => {
  const r = run([fixture("edited.jpg"), fixture("tampered.jpg"), join(ROOT, "package.json"), "no-such-file.jpg", "--json"]);
  assert.equal(r.status, 2, "a file that could not be checked wins");
  const data = JSON.parse(r.stdout);
  assert.equal(data.schema, 1);
  assert.match(data.version, /^\d+\.\d+\.\d+$/);
  const [edited, tampered, pkg, missing] = data.results;
  assert.equal(edited.type, "image/jpeg");
  assert.equal(edited.report.verdict, "valid");
  for (const k of ["headline", "summary", "facts", "ai", "actions", "history", "problems", "notes", "technical"]) assert.ok(k in edited.report, k);
  assert.equal(tampered.report.verdict, "invalid");
  assert.match(pkg.error, /not a format/);
  assert.equal(missing.error, "no such file");
});

test("exit codes: 1 when any file's credentials do not match, 2 without a file, 0 for --help", () => {
  assert.equal(run([fixture("camera.jpg"), fixture("tampered.jpg")]).status, 1);
  const none = run([]);
  assert.equal(none.status, 2);
  assert.match(none.stderr, /Usage/);
  assert.equal(run(["--help"]).status, 0);
  assert.equal(run(["--nope"]).status, 2);
});

test("text from credentials cannot drive the terminal or reorder what is read", () => {
  const out = run([fixture("hostile-text.jpg")]).stdout;
  assert.match(out, /<img src=x/, "HTML is shown as the text it is");
  const report = /** @type {import("../src/explain.js").Report} */ ({
    verdict: "valid", headline: "signed by \u001b[31mBank\u001b[0m", summary: "s", ai: null, actions: [], history: [], problems: [],
    facts: [{ label: "Title", value: "holiday\u202Egpj.exe\u0007\nNext line" }], notes: [], technical: { state: "Valid", codes: [] },
  });
  const text = reportText(report, "file\u001b]0;title\u0007.jpg");
  assert.doesNotMatch(text, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202A-\u202E]/, "no escape, bell or bidi control is printed");
  assert.match(text, /holiday�gpj\.exe� Next line/);
});

test("file types from bytes, the name only as a fallback", () => {
  const b = (/** @type {number[]} */ ...xs) => Uint8Array.from(xs);
  const ascii = (/** @type {string} */ s, at = 0) => { const u = new Uint8Array(16); for (let i = 0; i < s.length; i++) u[at + i] = s.charCodeAt(i); return u; };
  assert.equal(sniffType(b(0xff, 0xd8, 0xff, 0xe0)), "image/jpeg");
  assert.equal(sniffType(b(0x89, 0x50, 0x4e, 0x47)), "image/png");
  const webp = ascii("RIFF"); webp.set(ascii("WEBP").subarray(0, 4), 8);
  assert.equal(sniffType(webp), "image/webp");
  const wav = ascii("RIFF"); wav.set(ascii("WAVE").subarray(0, 4), 8);
  assert.equal(sniffType(wav), "audio/wav");
  const ftyp = (/** @type {string} */ brand) => { const u = ascii("ftyp", 4); u.set(ascii(brand).subarray(0, 4), 8); return u; };
  assert.equal(sniffType(ftyp("avif")), "image/avif");
  assert.equal(sniffType(ftyp("heic")), "image/heic");
  assert.equal(sniffType(ftyp("qt  ")), "video/quicktime");
  assert.equal(sniffType(ftyp("isom")), "video/mp4");
  assert.equal(sniffType(ascii("ID3")), "audio/mpeg");
  assert.equal(sniffType(ascii("%PDF-1.7")), "application/pdf");
  assert.equal(sniffType(ascii("II*\0"), "x.dng"), "image/x-adobe-dng");
  assert.equal(sniffType(ascii("<svg"), "logo.svg"), "image/svg+xml");
  assert.equal(sniffType(ascii("{\"a\":1}"), "data.json"), "");
});

test("a file carrying a C2PA container the library cannot read is reported as damaged, not as having none", () => {
  const dir = mkdtempSync(join(tmpdir(), "provenance-cli-"));
  try {
    // A JPEG start, then a broken JUMBF box: "jumd" followed by the "c2pa" label, and nothing a reader can use.
    const bytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1"),
      Buffer.from("....jumd....c2pa....", "latin1"), Buffer.from([0xff, 0xd9])]);
    assert.ok(hasC2paMarker(bytes));
    const f = join(dir, "broken.jpg");
    writeFileSync(f, bytes);
    const r = run([f, "--json"]);
    const res = JSON.parse(r.stdout).results[0];
    assert.equal(res.report?.verdict, "invalid", JSON.stringify(res));
    assert.match(res.report.headline, /damaged/);
    assert.equal(r.status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
