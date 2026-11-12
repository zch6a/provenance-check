// Makes the signed test images in test/fixtures from synthetic sources, with the reference library (c2pa-rs as
// WASM) and the TEST-ONLY certificates. Run after changing the cases; the results are committed.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

import { testSigner } from "./cose.mjs";
import { BytesBlob, readStore, wasm } from "./wasm-node.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fx = join(root, "test", "fixtures");
const signer = testSigner(join(fx, "certs"));
const IPTC = "http://cv.iptc.org/newscodes/digitalsourcetype/";

/** A small synthetic PNG: a diagonal gradient. */
function gradientPng(w = 160, h = 100) {
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) row.set([Math.round((255 * x) / w), Math.round((255 * y) / h), 160], 1 + x * 3);
    rows.push(row);
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (/** @type {Buffer} */ b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (/** @type {string} */ type, /** @type {Buffer} */ data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}

/**
 * @param {object} manifest @param {string} type @param {Buffer} source @param {{format: string, bytes: Buffer, json: object}[]} [ingredients]
 * @param {string} [remoteUrl] credentials stored at this URL instead of in the file
 */
async function sign(manifest, type, source, ingredients = [], remoteUrl) {
  const builder = wasm.WasmBuilder.fromJson(JSON.stringify(manifest));
  if (remoteUrl) { builder.setRemoteUrl(remoteUrl); builder.setNoEmbed(true); }
  for (const ing of ingredients) await builder.addIngredientFromBlob(JSON.stringify(ing.json), ing.format, new BytesBlob(ing.bytes, ing.format));
  const out = await builder.sign(signer, null, type, new BytesBlob(source, type));
  builder.free();
  return Buffer.from(out);
}

const generator = (/** @type {string} */ name) => [{ name, version: "1.0" }];
const landscape = readFileSync(join(fx, "source", "landscape.jpg"));
const png = gradientPng();
writeFileSync(join(fx, "source", "gradient.png"), png);

const cases = {
  "ai-generated.png": await sign({
    claim_generator_info: generator("Example Image Generator"), title: "A gradient, generated",
    assertions: [{ label: "c2pa.actions", data: { actions: [{ action: "c2pa.created", digitalSourceType: `${IPTC}trainedAlgorithmicMedia`, softwareAgent: { name: "Example Image Model" } }] } }],
  }, "image/png", png),
  "camera.jpg": await sign({
    claim_generator_info: generator("Example Camera Firmware"), title: "landscape.jpg",
    assertions: [{ label: "c2pa.actions", data: { actions: [{ action: "c2pa.created", digitalSourceType: `${IPTC}digitalCapture` }] } }],
  }, "image/jpeg", landscape),
};
cases["edited.jpg"] = await sign({
  claim_generator_info: generator("Example Photo Editor"), title: "landscape, edited",
  assertions: [{ label: "c2pa.actions", data: { actions: [
    { action: "c2pa.opened", parameters: { ingredientIds: ["parent"] } },
    { action: "c2pa.color_adjustments" },
    { action: "c2pa.cropped" },
  ] } }],
}, "image/jpeg", landscape, [{ format: "image/jpeg", bytes: cases["camera.jpg"], json: { title: "camera.jpg", relationship: "parentOf", label: "parent" } }]);
// Signed, then one byte of the picture changed: the signature still checks, the picture's hash does not.
const tampered = Buffer.from(cases["camera.jpg"]);
tampered[tampered.length - 200] ^= 0xff;
cases["tampered.jpg"] = tampered;
cases["no-credentials.jpg"] = landscape;
// Text that a careless page would run as HTML: the report must show it as text.
cases["hostile-text.jpg"] = await sign({
  claim_generator_info: generator("<b>Bold Tool</b>"), title: "<img src=x onerror=\"document.title='pwned'\">Holiday",
  assertions: [{ label: "c2pa.actions", data: { actions: [{ action: "c2pa.created", digitalSourceType: `${IPTC}digitalCapture`, softwareAgent: { name: "<script>alert(1)</script>" } }] } }],
}, "image/jpeg", landscape);
// Credentials stored elsewhere: the file only points to them. Following the pointer would tell that server which
// image is being looked at, so the extension does not.
cases["remote-credentials.jpg"] = await sign({
  claim_generator_info: generator("Example Camera Firmware"), title: "landscape.jpg",
  assertions: [{ label: "c2pa.actions", data: { actions: [{ action: "c2pa.created", digitalSourceType: `${IPTC}digitalCapture` }] } }],
}, "image/jpeg", landscape, [], "https://credentials.example.invalid/landscape.c2pa");

for (const [name, bytes] of Object.entries(cases)) {
  writeFileSync(join(fx, name), bytes);
  const type = name.endsWith(".png") ? "image/png" : "image/jpeg";
  let line;
  try {
    const store = await readStore(join(fx, name), type);
    const status = store ? (store.validation_status ?? []).map((/** @type {{code: string}} */ s) => s.code) : "no credentials";
    line = `${store?.validation_state ?? ""}  ${JSON.stringify(status)}`;
  } catch (e) {
    line = `reading throws: ${String(e).slice(0, 160)}`;
  }
  console.log(`${name.padEnd(24)} ${String(bytes.length).padStart(7)} B  ${line}`);
}
