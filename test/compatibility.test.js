// docs/COMPATIBILITY.md against what the command line really gives: the fields, verdicts and AI levels it promises
// for 1.x are exactly the ones produced (a field added without the document, or promised and missing, fails).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DOC = readFileSync(join(ROOT, "docs", "COMPATIBILITY.md"), "utf8").replace(/\r\n/g, "\n");
const FX = join(ROOT, "test", "fixtures");
const run = (/** @type {string[]} */ args) => spawnSync(process.execPath, [join(ROOT, "src", "cli.js"), ...args], { encoding: "utf8" });

/** The backticked names in the paragraph that starts with `start`. @param {string} start */
function named(start) {
  const para = DOC.split("\n\n").find((p) => p.startsWith(start));
  assert.ok(para, `the document has "${start}"`);
  return para;
}

test("the report fields the document promises are exactly the ones given", () => {
  const files = readdirSync(FX).filter((f) => /\.(jpe?g|png)$/i.test(f)).map((f) => join(FX, f));
  const data = JSON.parse(run([...files, "--json"]).stdout);
  assert.equal(data.schema, 1);
  const reports = data.results.map((/** @type {any} */ r) => r.report).filter(Boolean);
  assert.ok(reports.length >= 8);
  const keys = new Set(reports.flatMap((/** @type {object} */ r) => Object.keys(r)));
  const para = named("The report:");
  const promised = [...para.matchAll(/`(\w+)`(?= \(| \w|,|\.| \()/g)].map((m) => m[1]);
  const top = ["verdict", "headline", "summary", "facts", "ai", "actions", "history", "problems", "notes", "technical"];
  assert.deepEqual([...keys].sort(), [...top].sort(), "the fields given");
  for (const k of top) assert.ok(promised.includes(k), `the document names ${k}`);
  const history = reports.flatMap((/** @type {any} */ r) => r.history);
  assert.ok(history.length > 0);
  const historyKeys = new Set(history.flatMap((/** @type {object} */ h) => Object.keys(h)));
  for (const k of historyKeys) assert.match(para, new RegExp(`\\b${k}\\b`), `history.${k} is in the document`);
});

test("the verdicts and AI levels are the ones listed", () => {
  const explain = readFileSync(join(ROOT, "src", "explain.js"), "utf8");
  const verdicts = /** @type {string[]} */ (explain.match(/@typedef \{([^}]*)\} Verdict/)?.[1]?.match(/"(\w+)"/g)?.map((s) => s.slice(1, -1)));
  assert.deepEqual(verdicts?.sort(), ["invalid", "none", "remote", "trusted", "valid"]);
  for (const v of verdicts) assert.match(named("**Verdicts.**"), new RegExp(`\`${v}\``), v);
  const levels = explain.match(/level: "generated" \| "partly" \| "not-stated"/);
  assert.ok(levels, "the AI levels in the code");
  for (const l of ["generated", "partly", "not-stated"]) assert.match(named("**AI levels.**"), new RegExp(`\`${l}\``), l);
});

test("the exit codes are the ones in the table", () => {
  assert.equal(run([join(FX, "camera.jpg")]).status, 0);
  assert.equal(run([join(FX, "tampered.jpg")]).status, 1);
  assert.equal(run([join(FX, "tampered.jpg"), join(FX, "nope.jpg")]).status, 2, "2 wins over 1");
  assert.match(DOC, /\| 0 \| every file was checked/);
  assert.match(DOC, /2 wins over 1/);
});
