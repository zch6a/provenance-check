// The c2pa WASM build (the reference implementation, c2pa-rs) in Node, for making and checking test images.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { blockNetwork } from "../src/network-guard.js";
import { READ_SETTINGS_JSON } from "../src/settings.js";

// The same guard as in the extension's reader worker: nothing leaves this process while test images are read, and
// what the library tried to fetch is noted here (the privacy tests look at it).
/** @type {string[]} */
export const networkAttempts = [];
blockNetwork(/** @type {any} */ (globalThis), (url) => networkAttempts.push(url));

// The WASM build reads Blobs with FileReaderSync, which browsers have in workers and Node does not. A Blob that
// keeps its bytes (and so do its slices) lets a small stand-in read them synchronously.
export class BytesBlob extends Blob {
  /** @param {Uint8Array} bytes @param {string} [type] */
  constructor(bytes, type = "") {
    super([bytes], { type });
    this.bytes = Buffer.from(bytes);
  }
  /** @param {number} [start] @param {number} [end] @param {string} [type] */
  slice(start = 0, end = this.size, type = "") {
    const n = this.size;
    const at = (/** @type {number} */ i) => (i < 0 ? Math.max(n + i, 0) : Math.min(i, n));
    return new BytesBlob(this.bytes.subarray(at(start), Math.max(at(start), at(end))), type);
  }
}
globalThis.FileReaderSync ??= class {
  /** @param {Blob} blob */
  readAsArrayBuffer(blob) {
    if (!(blob instanceof BytesBlob)) throw new Error("only BytesBlob can be read synchronously here");
    const b = blob.bytes;
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  }
};

const require = createRequire(import.meta.url);
const pkgDir = require.resolve("@contentauth/c2pa-wasm/package.json").replace(/package\.json$/, "");
/** @type {typeof import("@contentauth/c2pa-wasm")} */
export const wasm = await import(pathToFileURL(`${pkgDir}pkg/c2pa.js`).href);
wasm.initSync({ module: readFileSync(`${pkgDir}pkg/c2pa_bg.wasm`) });

/** The manifest store of an image, read with the extension's settings; null when it has none. @param {string} file @param {string} type */
export async function readStore(file, type) {
  let reader;
  try {
    reader = await wasm.WasmReader.fromBlob(type, new BytesBlob(readFileSync(file), type), READ_SETTINGS_JSON);
  } catch (e) {
    if (/JumbfNotFound|ManifestNotFound|no.*manifest/i.test(String(e))) return null;
    throw e;
  }
  try {
    return reader.manifestStore();
  } finally {
    reader.free();
  }
}
