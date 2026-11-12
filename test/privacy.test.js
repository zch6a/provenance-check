// @ts-check
// Nothing is fetched while reading credentials: not remote manifests, not revocation status, not trust lists.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { BytesBlob, wasm } from "../scripts/wasm-node.mjs";
import { READ_SETTINGS, READ_SETTINGS_JSON } from "../src/settings.js";

const FX = fileURLToPath(new URL("./fixtures/", import.meta.url));

/** Reads a fixture with these settings, recording every fetch the library tries. @param {string} name @param {string | null} settings */
async function fetchesWhileReading(name, settings) {
  /** @type {string[]} */
  const tried = [];
  const real = globalThis.fetch;
  globalThis.fetch = /** @type {typeof fetch} */ (async (/** @type {any} */ input) => {
    tried.push(String(input?.url ?? input));
    throw new TypeError("network disabled in this test");
  });
  try {
    const reader = await wasm.WasmReader.fromBlob("image/jpeg", new BytesBlob(readFileSync(`${FX}${name}`), "image/jpeg"), settings);
    reader.free();
  } catch {
    // a remote-only file cannot be read without its manifest; what matters here is what was fetched
  } finally {
    globalThis.fetch = real;
  }
  return tried;
}

test("credentials stored elsewhere are not fetched with the extension's settings", async () => {
  assert.deepEqual(await fetchesWhileReading("remote-credentials.jpg", READ_SETTINGS_JSON), []);
});

test("...and the library would fetch them with its defaults, so the test above means something", async () => {
  const tried = await fetchesWhileReading("remote-credentials.jpg", null);
  assert.ok(tried.some((u) => u.includes("credentials.example.invalid")), `tried: ${JSON.stringify(tried)}`);
});

test("reading signed images fetches nothing (no revocation lookups, no trust lists)", async () => {
  for (const f of ["camera.jpg", "edited.jpg", "tampered.jpg"]) assert.deepEqual(await fetchesWhileReading(f, READ_SETTINGS_JSON), [], f);
});

test("the settings the extension passes are the ones the tests read with", async () => {
  const { settingsToJson } = await import("@contentauth/c2pa-utilities");
  const extension = JSON.parse(await settingsToJson(/** @type {any} */ (READ_SETTINGS)));
  assert.deepEqual(extension.verify, JSON.parse(READ_SETTINGS_JSON).verify);
});
