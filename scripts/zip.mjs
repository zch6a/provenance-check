// The release zip: the built extension (dist/, or $DIST) as provenance-check-<version>.zip, to load in Chrome or Edge
// without building, and the file a store listing takes. No dependencies: a small ZIP writer on node:zlib.
// Reproducible: entries sorted, one fixed timestamp, no extra fields, so the same build gives the same bytes.
//
//   node scripts/zip.mjs [out.zip]     (default: release/provenance-check-<version>.zip)
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

// CRC-32 (the ZIP polynomial), by table: node:zlib has crc32 only from Node 20.15, and the tests run on Node 18 too.
const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
/** @param {Uint8Array} data */
export function crc32(data) {
  let c = 0xffffffff;
  for (const byte of data) c = /** @type {number} */ (TABLE[(c ^ byte) & 0xff]) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = process.env.DIST ?? join(root, "dist");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const out = process.argv[2] ?? join(root, "release", `provenance-check-${pkg.version}.zip`);

/** Every file under `dir`, as forward-slash paths relative to it, sorted. @param {string} dir @returns {string[]} */
function files(dir) {
  /** @type {string[]} */
  const list = [];
  const walk = (/** @type {string} */ d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else list.push(relative(dir, p).replace(/\\/g, "/"));
    }
  };
  walk(dir);
  return list.sort();
}

// 1980-01-01 00:00, the earliest DOS date: a fixed time, so the zip depends only on the files.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

/** @param {{name: string, data: Buffer}[]} entries */
export function zip(entries) {
  /** @type {Buffer[]} */
  const parts = [];
  /** @type {Buffer[]} */
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const packed = deflateRawSync(data, { level: 9 });
    const stored = packed.length >= data.length; // already compressed (PNG, WASM): store it as it is
    const body = stored ? data : packed;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4); // made by: 2.0, MS-DOS attributes
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(0x0800, 8);
    head.writeUInt16LE(stored ? 0 : 8, 10);
    head.writeUInt16LE(DOS_TIME, 12);
    head.writeUInt16LE(DOS_DATE, 14);
    head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(body.length, 20);
    head.writeUInt32LE(data.length, 24);
    head.writeUInt16LE(nameBytes.length, 28);
    head.writeUInt32LE(offset, 42);
    central.push(head, nameBytes);
    parts.push(local, nameBytes, body);
    offset += local.length + nameBytes.length + body.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const names = files(dist);
  if (!names.includes("manifest.json")) throw new Error(`${dist} holds no built extension: run npm run build first`);
  const manifest = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
  if (manifest.version !== pkg.version) throw new Error(`dist/ was built for ${manifest.version}, the package is ${pkg.version}: build again`);
  const bytes = zip(names.map((name) => ({ name, data: readFileSync(join(dist, name)) })));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, bytes);
  console.log(`wrote ${relative(process.cwd(), out)} (${names.length} files, ${Math.round(bytes.length / 1024)} KB)`);
}
