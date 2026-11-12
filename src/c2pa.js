// @ts-check
/**
 * Reading Content Credentials in the extension with the reference library (c2pa-rs, compiled to WebAssembly and
 * run in a worker). The WASM binary and the worker ship inside the extension: nothing is downloaded.
 */
import { Context, Reader, createC2pa } from "@contentauth/c2pa-web";

import { remoteManifestUrl } from "./explain.js";
import { READ_SETTINGS } from "./settings.js";

/** A file inside the extension (or next to the page, when the report runs outside it, as in development). @param {string} path */
export function packaged(path) {
  return typeof chrome !== "undefined" && chrome.runtime?.getURL ? chrome.runtime.getURL(path) : new URL(path, location.href).href;
}

/** @type {Promise<import("@contentauth/c2pa-web").C2pa> | null} */
let sdk = null;

function c2pa() {
  // workerSrc: extension pages may not start workers from blob: URLs, so the worker is a packaged file. A start that
  // fails is not kept: the next check tries again (a kept rejection would fail every later file in this tab).
  sdk ??= createC2pa({ wasmSrc: packaged("vendor/c2pa_bg.wasm"), workerSrc: new URL(packaged("vendor/c2pa_worker.js")) })
    .catch((e) => { sdk = null; throw e; });
  return sdk;
}

/** After the reader failed (its worker stopped, it ran out of memory): the next check starts a new one. */
export function resetReader() {
  sdk = null;
}

/**
 * The manifest store of a file (null when it has no Content Credentials), or the URL of credentials it only
 * points to (not fetched).
 * @param {Blob} blob
 * @param {string} [type] the file's format (MIME type); the library guesses from the bytes without one
 * @returns {Promise<{store: import("./explain.js").ManifestStore | null, remoteUrl: string | null}>}
 */
export async function readCredentials(blob, type) {
  let reader;
  try {
    reader = await Reader.fromBlob(await c2pa(), type || blob.type || undefined, blob, new Context(READ_SETTINGS));
  } catch (e) {
    const remoteUrl = remoteManifestUrl(e);
    if (remoteUrl) return { store: null, remoteUrl };
    throw e;
  }
  if (!reader) return { store: null, remoteUrl: null };
  try {
    return { store: /** @type {import("./explain.js").ManifestStore} */ (await reader.manifestStore()), remoteUrl: null };
  } finally {
    await reader.free();
  }
}
