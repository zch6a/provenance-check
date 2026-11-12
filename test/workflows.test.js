// The GitHub workflows, read as text: the token that can write to the repository is only where nothing of the
// project or its dependencies runs, and every action is pinned to a commit.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { interpret } from "../src/node-reader.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const workflow = (/** @type {string} */ name) => readFileSync(join(ROOT, ".github", "workflows", name), "utf8").replace(/\r\n/g, "\n");

/** The jobs of a workflow, as their text. @param {string} text */
function jobs(text) {
  const body = text.slice(text.indexOf("\njobs:\n") + 7);
  /** @type {Record<string, string>} */
  const out = {};
  for (const part of body.split(/\n(?=  [a-z][\w-]*:\n)/)) {
    const name = part.match(/^ {2}([a-z][\w-]*):/)?.[1];
    if (name) out[name] = part;
  }
  return out;
}

test("release: write access only in the job that runs no project code", () => {
  const text = workflow("release.yml");
  assert.match(text, /^permissions:\n {2}contents: read$/m, "read-only by default");
  const { build, publish } = jobs(text);
  assert.ok(build && publish, "a build job and a publish job");
  assert.match(build, /contents: read/);
  assert.doesNotMatch(build, /contents: write/);
  assert.match(build, /persist-credentials: false/, "the checkout keeps no token");
  assert.match(build, /npm ci --ignore-scripts/);
  assert.match(build, /npm test/, "what is released is what was tested");
  assert.match(build, /unzip -q "release\/provenance-check-/, "the zip itself is unpacked");
  assert.match(build, /DIST="\$RUNNER_TEMP\/unzipped" node scripts\/extension-e2e\.mjs/, "and checked in Chrome");
  assert.match(build, /! grep -q '\^skip:'/, "a missing Chrome fails the release instead of skipping");
  assert.ok(build.indexOf("extension-e2e") < build.indexOf("upload-artifact"), "before it is handed to the publish job");
  assert.match(publish, /contents: write/);
  assert.match(publish, /needs: build/);
  assert.doesNotMatch(publish, /checkout|npm |node /, "the publish job runs nothing of the project or its dependencies");
});

test("CI is read-only, and every action in every workflow is pinned to a commit", () => {
  assert.match(workflow("ci.yml"), /^permissions:\n {2}contents: read$/m);
  for (const name of ["ci.yml", "release.yml"]) {
    for (const [, ref] of workflow(name).matchAll(/uses: ([^\s#]+)/g)) {
      assert.match(String(ref), /@[0-9a-f]{40}$/, `${name}: ${ref} is pinned to a commit`);
    }
  }
});

test("a failure of the reader itself is never read as a verdict on the file", async () => {
  const fail = (/** @type {unknown} */ e) => () => Promise.reject(e);
  await assert.rejects(interpret(fail(new Error("RuntimeError: unreachable")), () => true), (e) => /** @type {any} */ (e).internal === true);
  await assert.rejects(interpret(fail(new RangeError("Array buffer allocation failed")), () => false), (e) => /** @type {any} */ (e).internal === true);
  // The library's own errors stay what they were: damaged when the bytes carry C2PA, unreadable when not.
  const damaged = await interpret(fail("C2pa(InvalidAsset(\"x\"))"), () => true);
  assert.equal(damaged.damaged, 'C2pa(InvalidAsset("x"))');
  await assert.rejects(interpret(fail("C2pa(InvalidAsset(\"x\"))"), () => false), (e) => /** @type {any} */ (e).unreadable === true);
});
