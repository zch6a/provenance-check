// @ts-check
/**
 * The C2PA reference library (c2pa-rs, its WebAssembly build) in Node: for the command line and the tests. It reads
 * with the extension's settings, behind the same network guard as the extension's reader worker, installed before
 * the library loads: nothing leaves this process while a file is read.
 */
import { closeSync, fstatSync, openSync, readFileSync, readSync } from "node:fs";
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
/**
 * A file on disk as a Blob, read only where the library asks: its slices are read with readSync when the library
 * reads them. A 200 MB video without credentials costs about a hundred bytes of reading this way, instead of the
 * whole file in memory (several times over, through the Blob and its copies).
 */
export class FileBlob extends Blob {
  /** @param {number} fd @param {number} start @param {number} end @param {string} [type] */
  constructor(fd, start, end, type = "") {
    super([], { type });
    this.fd = fd;
    this.start = start;
    this.end = end;
  }
  get size() { return this.end - this.start; }
  /** @param {number} [start] @param {number} [end] @param {string} [type] */
  slice(start = 0, end = this.size, type = "") {
    const n = this.size;
    const at = (/** @type {number} */ i) => (i < 0 ? Math.max(n + i, 0) : Math.min(i, n));
    return new FileBlob(this.fd, this.start + at(start), this.start + Math.max(at(start), at(end)), type);
  }
  /** The bytes of this slice, read now. */
  readBytes() {
    const b = Buffer.alloc(this.size);
    let done = 0;
    while (done < b.length) {
      const n = readSync(this.fd, b, done, b.length - done, this.start + done);
      if (n === 0) break; // the file got shorter: what is there
      done += n;
    }
    return b.subarray(0, done);
  }
}

/** @type {any} */ (globalThis).FileReaderSync ??= class {
  /** @param {Blob} blob */
  readAsArrayBuffer(blob) {
    const b = blob instanceof BytesBlob ? blob.data : blob instanceof FileBlob ? blob.readBytes() : null;
    if (!b) throw new Error("only BytesBlob and FileBlob can be read synchronously here");
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
  return readBlob(new BytesBlob(bytes, type), type);
}

/** @param {Blob} blob @param {string} type @returns {Promise<import("./explain.js").ManifestStore | null>} */
async function readBlob(blob, type) {
  let reader;
  try {
    reader = await wasm.WasmReader.fromBlob(type, blob, READ_SETTINGS_JSON);
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
  return interpret(() => readStore(bytes, type), () => hasC2paMarker(bytes));
}

/**
 * The same, for a file on disk, read only where the library asks (see FileBlob). The search for a C2PA container
 * that the library could not read looks at the first and last 32 MB, as the extension does: formats put it there.
 * @param {string} path @param {string} type
 */
export async function readCredentialsFromFile(path, type) {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const file = new FileBlob(fd, 0, size, type);
    const LIMIT = 32 * 1024 * 1024;
    const marker = () => (size <= 2 * LIMIT ? [file] : [file.slice(0, LIMIT), file.slice(size - LIMIT)]).some((part) => hasC2paMarker(part.readBytes()));
    return await interpret(() => readBlob(file, type), marker);
  } finally {
    closeSync(fd);
  }
}

/**
 * How a read ends, for explain(): the store, remote credentials, or damaged ones; or an error flagged `unsupported`
 * (a format the library does not read), `unreadable` (the library could not parse a file that carries no C2PA) or
 * `internal` (the reader itself failed).
 * @param {() => Promise<import("./explain.js").ManifestStore | null>} read
 * @param {() => boolean} carriesC2pa
 * @returns {Promise<{store: import("./explain.js").ManifestStore | null, remoteUrl: string | null, damaged: string | null}>}
 */
export async function interpret(read, carriesC2pa) {
  try {
    const store = await read();
    // The library says "none" when it cannot find the credentials' container; if the bytes still carry one, they are damaged.
    if (!store && carriesC2pa()) return { store: null, remoteUrl: null, damaged: "C2PA data is present but its container could not be found" };
    return { store, remoteUrl: null, damaged: null };
  } catch (e) {
    const remoteUrl = remoteManifestUrl(e);
    if (remoteUrl) return { store: null, remoteUrl, damaged: null };
    const text = String(e instanceof Error ? e.message : e);
    if (/UnsupportedType|unsupported/i.test(text)) throw Object.assign(new Error(text), { unsupported: true });
    // Only the library's own errors ("C2pa(...)") are about the file; anything else is the reader failing (out of
    // memory, a bug), which must not read as a verdict on the file.
    if (!/^C2pa\(/.test(text)) throw Object.assign(new Error(text), { internal: true });
    if (!carriesC2pa()) throw Object.assign(new Error(text), { unreadable: true });
    return { store: null, remoteUrl: null, damaged: text };
  }
}
