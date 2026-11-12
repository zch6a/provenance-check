// @ts-check
/**
 * The C2PA reference library (c2pa-rs, its WebAssembly build) in Node: for the command line and the tests. It reads
 * with the extension's settings, behind the same network guard as the extension's reader worker, installed before
 * the library loads: nothing leaves this process while a file is read.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { remoteManifestUrl } from "./explain.js";
import { hasC2paMarker } from "./file-type.js";
import { blockNetwork } from "./network-guard.js";
import { READ_SETTINGS_JSON } from "./settings.js";

/** What the library tried to fetch (and was refused), for the privacy tests. @type {string[]} */
export const networkAttempts = [];
blockNetwork(/** @type {any} */ (globalThis), (url) => networkAttempts.push(url));

// The WASM build reads Blobs with FileReaderSync, which browsers have in workers and Node does not. A Blob that
// keeps a view of its bytes (in `data`: Blob has a bytes() method of its own), as its slices do, lets a small
// stand-in read them synchronously.
export class BytesBlob extends Blob {
  /** @param {Uint8Array} bytes @param {string} [type] */
  constructor(bytes, type = "") {
    super([/** @type {BlobPart} */ (bytes)], { type });
    // A view, not a copy: the Blob already holds one copy of a file that may be 250 MB.
    this.data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  /** @param {number} [start] @param {number} [end] @param {string} [type] */
  slice(start = 0, end = this.size, type = "") {
    const n = this.size;
    const at = (/** @type {number} */ i) => (i < 0 ? Math.max(n + i, 0) : Math.min(i, n));
    return new BytesBlob(this.data.subarray(at(start), Math.max(at(start), at(end))), type);
  }
}
/** @type {any} */ (globalThis).FileReaderSync ??= class {
  /** @param {Blob} blob */
  readAsArrayBuffer(blob) {
    if (!(blob instanceof BytesBlob)) throw new Error("only BytesBlob can be read synchronously here");
    const b = blob.data;
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  }
};

const require = createRequire(import.meta.url);
const pkgDir = require.resolve("@contentauth/c2pa-wasm/package.json").replace(/package\.json$/, "");
/** @type {any} */
export const wasm = await import(pathToFileURL(`${pkgDir}pkg/c2pa.js`).href);
wasm.initSync({ module: readFileSync(`${pkgDir}pkg/c2pa_bg.wasm`) });

/**
 * The library's error when a file has no credentials, matched exactly (c2pa-web does the same). A looser match would
 * also catch other errors whose text merely mentions a manifest: the URL of remote credentials
 * (cdn.canon.example/manifests/...) made a file with remote credentials read as one with none.
 * @param {unknown} e
 */
const notFound = (e) => /^C2pa\((JumbfNotFound|ManifestNotFound)\)$/.test(String(e));

/**
 * The manifest store of a file, read with the extension's settings; null when it has none. Throws on anything
 * else (a remote manifest, damaged credentials, an unsupported format).
 * @param {Uint8Array | string} bytesOrPath @param {string} type
 * @returns {Promise<import("./explain.js").ManifestStore | null>}
 */
export async function readStore(bytesOrPath, type) {
  const bytes = typeof bytesOrPath === "string" ? readFileSync(bytesOrPath) : bytesOrPath;
  let reader;
  try {
    reader = await wasm.WasmReader.fromBlob(type, new BytesBlob(bytes, type), READ_SETTINGS_JSON);
  } catch (e) {
    if (notFound(e)) return null;
    throw e;
  }
  try {
    return reader.manifestStore();
  } finally {
    reader.free();
  }
}

/**
 * What `explain()` needs about a file, the way the extension's report page gets it: the store, or where remote
 * credentials are, or why they are damaged. Damaged only when the bytes carry a C2PA container: a file the library
 * cannot parse at all (a truncated PNG, a text file named .gif) is an error (`unreadable`), not damaged credentials.
 * An unsupported format is an error too (`unsupported`).
 * @param {Uint8Array} bytes @param {string} type
 * @returns {Promise<{store: import("./explain.js").ManifestStore | null, remoteUrl: string | null, damaged: string | null}>}
 */
export async function readCredentials(bytes, type) {
  try {
    const store = await readStore(bytes, type);
    // The library says "none" when it cannot find the credentials' container; if the bytes still carry one, they are damaged.
    if (!store && hasC2paMarker(bytes)) return { store: null, remoteUrl: null, damaged: "C2PA data is present but its container could not be found" };
    return { store, remoteUrl: null, damaged: null };
  } catch (e) {
    const remoteUrl = remoteManifestUrl(e);
    if (remoteUrl) return { store: null, remoteUrl, damaged: null };
    const text = String(e instanceof Error ? e.message : e);
    if (/UnsupportedType|unsupported/i.test(text)) throw Object.assign(new Error(text), { unsupported: true });
    if (!hasC2paMarker(bytes)) throw Object.assign(new Error(text), { unreadable: true });
    return { store: null, remoteUrl: null, damaged: text };
  }
}
