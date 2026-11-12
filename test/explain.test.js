// @ts-check
// The report for each test image, read by the reference library (c2pa-rs as WASM) with the extension's settings.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { readStore } from "../scripts/wasm-node.mjs";
import { explain, remoteManifestUrl } from "../src/explain.js";

const FX = fileURLToPath(new URL("./fixtures/", import.meta.url));
/** @param {string} name */
async function reportFor(name) {
  const type = name.endsWith(".png") ? "image/png" : "image/jpeg";
  try {
    return explain(await readStore(join(FX, name), type));
  } catch (e) {
    const remoteUrl = remoteManifestUrl(e);
    if (remoteUrl) return explain(null, { remoteUrl });
    throw e;
  }
}
/** @param {import("../src/explain.js").Report} r @param {string} label */
const fact = (r, label) => r.facts.find((f) => f.label === label)?.value;

test("an AI-generated image: intact, signer not verified, and the AI statement in words", async () => {
  const r = await reportFor("ai-generated.png");
  assert.equal(r.verdict, "valid");
  assert.match(r.headline, /intact, signed by "Example Test Studio \(not trusted\)" \(signer not verified\)/);
  assert.equal(r.ai?.level, "generated");
  assert.match(r.ai?.words ?? "", /made by generative AI/);
  assert.equal(fact(r, "Made with"), "Example Image Generator 1.0");
  assert.equal(fact(r, "Source"), "generative AI");
  assert.deepEqual(r.actions, ["created (Example Image Model)"]);
  assert.equal(fact(r, "Signed on"), "no trusted time recorded");
  assert.ok(r.notes.some((n) => /do not prove/.test(n)));
  assert.ok(r.notes.some((n) => /trust list/.test(n)));
  assert.deepEqual(r.problems, []);
});

test("a camera image: the source, and no AI stated", async () => {
  const r = await reportFor("camera.jpg");
  assert.equal(r.verdict, "valid");
  assert.equal(fact(r, "Source"), "a camera (digital capture)");
  assert.equal(r.ai?.level, "not-stated");
  assert.match(r.ai?.words ?? "", /do not state that AI was used/);
});

test("an edited image: what was done, and what it was made from", async () => {
  const r = await reportFor("edited.jpg");
  assert.equal(r.verdict, "valid");
  assert.deepEqual(r.actions, ["opened an existing file", "adjusted colours", "cropped"]);
  assert.equal(r.history.length, 1);
  assert.deepEqual(r.history[0], { title: "camera.jpg", how: "edited from", signer: "Example Test Studio (not trusted)", hasCredentials: true, problems: [] });
  assert.equal(fact(r, "Made with"), "Example Photo Editor 1.0");
});

test("a tampered image: the credentials do not match, and why", async () => {
  const r = await reportFor("tampered.jpg");
  assert.equal(r.verdict, "invalid");
  assert.equal(r.headline, "These Content Credentials do not match this file");
  assert.deepEqual(r.problems, ["The picture changed after it was signed."]);
  assert.ok(r.technical.codes.some((c) => c.code === "assertion.dataHash.mismatch"));
});

test("an image without credentials: none, and that this says nothing about the image", async () => {
  const r = await reportFor("no-credentials.jpg");
  assert.equal(r.verdict, "none");
  assert.match(r.summary, /says nothing about whether the image is real/);
});

test("credentials stored elsewhere: where, and that they were not fetched", async () => {
  const r = await reportFor("remote-credentials.jpg");
  assert.equal(r.verdict, "remote");
  assert.equal(fact(r, "Stored at"), "https://credentials.example.invalid/landscape.c2pa");
  assert.match(r.summary, /does not fetch them: that would tell credentials\.example\.invalid which image/);
});

test("text in the credentials is kept as text (the page sets it with textContent)", async () => {
  const r = await reportFor("hostile-text.jpg");
  assert.equal(fact(r, "Title"), "<img src=x onerror=\"document.title='pwned'\">Holiday");
  assert.equal(fact(r, "Made with"), "<b>Bold Tool</b> 1.0");
  assert.deepEqual(r.actions, ["created (<script>alert(1)</script>)"]);
});

test("trust, expiry, revocation and AI edits, from the library's own result shapes", () => {
  const base = (/** @type {object} */ extra) => ({
    active_manifest: "m", validation_state: "Valid",
    manifests: { m: { claim_generator_info: [{ name: "Tool", version: "2" }], signature_info: { common_name: "News Org", issuer: "News Org Inc", time: "2026-03-04T05:06:07+00:00" },
      assertions: [{ label: "c2pa.actions.v2", data: { actions: [
        { action: "c2pa.opened" },
        { action: "c2pa.edited", digitalSourceType: "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia" },
      ] } }] } },
    ...extra,
  });
  const trusted = explain(base({ validation_state: "Trusted" }));
  assert.equal(trusted.verdict, "trusted");
  assert.equal(trusted.headline, 'Content Credentials signed by "News Org"');
  assert.equal(fact(trusted, "Signed on"), "2026-03-04 05:06:07 UTC");
  assert.equal(trusted.ai?.level, "partly");
  assert.deepEqual(trusted.actions, ["opened an existing file", "edited with generative AI"]);
  assert.ok(!trusted.notes.some((n) => /trust list/.test(n)));
  const revoked = explain(base({ validation_state: "Invalid", validation_results: { activeManifest: { failure: [{ code: "signingCredential.revoked" }] } } }));
  assert.equal(revoked.verdict, "invalid");
  assert.deepEqual(revoked.problems, ["The signer's certificate was revoked."]);
  const unknown = explain(base({ validation_results: { activeManifest: { failure: [{ code: "something.new", explanation: "a new check failed" }] } } }));
  assert.equal(unknown.verdict, "invalid", "a failure the code does not know is still a failure");
  assert.deepEqual(unknown.problems, ["a new check failed (something.new)"]);
});

test("made from an AI-generated file: said, even though this step did not use AI", () => {
  const r = explain({
    active_manifest: "edit", validation_state: "Valid",
    manifests: {
      edit: { assertions: [{ label: "c2pa.actions", data: { actions: [{ action: "c2pa.cropped" }] } }], ingredients: [{ title: "gen.png", relationship: "parentOf", active_manifest: "gen" }] },
      gen: { assertions: [{ label: "c2pa.actions", data: { actions: [{ action: "c2pa.created", digitalSourceType: "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia" }] } }] },
    },
  });
  assert.equal(r.ai?.level, "partly");
  assert.match(r.ai?.words ?? "", /made from a file whose credentials state it was AI-generated/);
  assert.equal(r.headline, "Content Credentials intact, signed by an unnamed signer (signer not verified)");
});
