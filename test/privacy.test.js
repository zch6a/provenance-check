// @ts-check
// Nothing is fetched while reading credentials: not remote manifests, not revocation status, not trust lists, not
// the issuer of an identity statement.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { BytesBlob, networkAttempts, wasm } from "../scripts/wasm-node.mjs";
import { blockNetwork } from "../src/network-guard.js";
import { READ_SETTINGS, READ_SETTINGS_JSON } from "../src/settings.js";

const FX = fileURLToPath(new URL("./fixtures/", import.meta.url));

/** What the library tries to fetch while reading a fixture with these settings (the guard refuses all of it). @param {string} name @param {string | null} settings */
async function attemptsWhileReading(name, settings) {
  networkAttempts.length = 0;
  try {
    const reader = await wasm.WasmReader.fromBlob("image/jpeg", new BytesBlob(readFileSync(`${FX}${name}`), "image/jpeg"), settings);
    reader.free();
  } catch {
    // a remote-only file cannot be read without its manifest; what matters here is what was tried
  }
  return [...networkAttempts];
}

test("credentials stored elsewhere are not even asked for with the extension's settings", async () => {
  assert.deepEqual(await attemptsWhileReading("remote-credentials.jpg", READ_SETTINGS_JSON), []);
});

test("...the library would ask for them with its defaults, so the test above means something", async () => {
  const tried = await attemptsWhileReading("remote-credentials.jpg", null);
  assert.ok(tried.some((u) => u.includes("credentials.example.invalid")), `tried: ${JSON.stringify(tried)}`);
});

test("an identity statement's did:web issuer: the library tries to resolve it, whatever the settings, and the guard refuses", async () => {
  const tried = await attemptsWhileReading("identity-did-web.jpg", READ_SETTINGS_JSON);
  assert.deepEqual(tried, ["https://tracker.example.invalid/image-4711/did.json"], "this is why the reader's worker has a network guard");
});

test("reading signed images tries nothing else (no revocation lookups, no trust lists)", async () => {
  for (const f of ["camera.jpg", "edited.jpg", "tampered.jpg", "identity-x509.jpg"]) assert.deepEqual(await attemptsWhileReading(f, READ_SETTINGS_JSON), [], f);
});

test("the guard: the extension's own files and blob:/data: pass, anything else is refused", async () => {
  /** @type {string[]} */
  const passed = [];
  /** @type {string[]} */
  const refused = [];
  const scope = {
    location: { href: "chrome-extension://abc/vendor/c2pa_worker.js", origin: "chrome-extension://abc" },
    fetch: /** @type {any} */ (async (/** @type {any} */ u) => { passed.push(String(u)); return new Response("ok"); }),
    XMLHttpRequest: class {},
    WebSocket: class {},
  };
  blockNetwork(scope, (u) => refused.push(u));
  await scope.fetch("chrome-extension://abc/vendor/c2pa_bg.wasm");
  await scope.fetch("blob:chrome-extension://abc/1234");
  await scope.fetch("data:application/octet-stream;base64,AA==");
  await assert.rejects(scope.fetch("https://tracker.example.invalid/x/did.json"), /may not use the network/);
  await assert.rejects(scope.fetch(new URL("http://127.0.0.1:8080/")), /may not use the network/);
  assert.throws(() => new /** @type {any} */ (scope.XMLHttpRequest)(), /no XMLHttpRequest/);
  assert.throws(() => new /** @type {any} */ (scope.WebSocket)("wss://x.example.invalid"), /no WebSocket/);
  assert.equal(passed.length, 3);
  assert.deepEqual(refused, ["https://tracker.example.invalid/x/did.json", "http://127.0.0.1:8080/", "XMLHttpRequest", "WebSocket"]);
});

test("the settings the extension passes are the ones the tests read with", async () => {
  const { settingsToJson } = await import("@contentauth/c2pa-utilities");
  const extension = JSON.parse(await settingsToJson(/** @type {any} */ (READ_SETTINGS)));
  assert.deepEqual(extension.verify, JSON.parse(READ_SETTINGS_JSON).verify);
});
