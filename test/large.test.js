// The command line reads files where the library asks (src/node-reader.js, FileBlob), not whole: the same answers
// as reading the bytes, and a large video is not loaded into memory. Synthetic files only.
import assert from "node:assert/strict";
import { closeSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { explain } from "../src/explain.js";
import { sniffType } from "../src/file-type.js";
import { readCredentials, readCredentialsFromFile } from "../src/node-reader.js";

const FX = fileURLToPath(new URL("./fixtures/", import.meta.url));

test("reading from disk gives the same report as reading the bytes, for every test image", async () => {
  const files = readdirSync(FX).filter((f) => /\.(jpe?g|png)$/i.test(f));
  assert.ok(files.length >= 8);
  for (const f of files) {
    const bytes = readFileSync(join(FX, f));
    const type = sniffType(bytes.subarray(0, 16), f);
    const inMemory = await readCredentials(bytes, type);
    const fromDisk = await readCredentialsFromFile(join(FX, f), type);
    assert.deepEqual(explain(fromDisk.store, fromDisk), explain(inMemory.store, inMemory), f);
  }
});

test("a 150 MB video is checked without loading it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "provenance-large-"));
  try {
    const file = join(dir, "big.mp4");
    const size = 150 * 1024 * 1024;
    const fd = openSync(file, "w");
    const ftyp = Buffer.alloc(32);
    ftyp.writeUInt32BE(32, 0);
    ftyp.write("ftypisom", 4);
    const mdat = Buffer.alloc(8);
    mdat.writeUInt32BE(size + 8, 0);
    mdat.write("mdat", 4);
    writeSync(fd, ftyp);
    writeSync(fd, mdat);
    const chunk = Buffer.alloc(8 * 1024 * 1024);
    for (let n = 0; n < size; n += chunk.length) writeSync(fd, chunk);
    closeSync(fd);
    globalThis.gc?.();
    const before = process.memoryUsage().rss;
    const read = await readCredentialsFromFile(file, "video/mp4");
    const grew = process.memoryUsage().rss - before;
    assert.equal(explain(read.store, read).verdict, "none");
    // Reading it whole would need its size at least once; the marker search reads the first and last 32 MB.
    assert.ok(grew < 100 * 1024 * 1024, `memory grew by ${Math.round(grew / 1024 / 1024)} MB for a 150 MB file`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
