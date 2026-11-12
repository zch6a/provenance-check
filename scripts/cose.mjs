// A C2PA claim signer for making test images: the c2pa WASM build hands the claim to the signer and expects
// a whole COSE_Sign1 back (it handles no certificates itself), so this builds one. ES256 with the test
// certificates in test/fixtures/certs. Test tooling only; not part of the extension.
import { createPrivateKey, sign as cryptoSign, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";

/** Minimal CBOR encoding (RFC 8949) of what COSE needs: integers, byte and text strings, arrays, maps, tags, null. */
export function cbor(value) {
  const head = (/** @type {number} */ major, /** @type {number} */ n) => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 0x100) return Buffer.from([(major << 5) | 24, n]);
    if (n < 0x10000) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b; }
    const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(n, 1); return b;
  };
  if (value === null) return Buffer.from([0xf6]);
  if (typeof value === "number") return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === "string") { const s = Buffer.from(value, "utf8"); return Buffer.concat([head(3, s.length), s]); }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.concat([head(2, value.length), Buffer.from(value)]);
  if (Array.isArray(value)) return Buffer.concat([head(4, value.length), ...value.map(cbor)]);
  if (value instanceof Tagged) return Buffer.concat([head(6, value.tag), cbor(value.value)]);
  if (value instanceof Map) return Buffer.concat([head(5, value.size), ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)])]);
  throw new Error(`cannot encode ${typeof value}`);
}

export class Tagged {
  /** @param {number} tag @param {unknown} value */
  constructor(tag, value) { this.tag = tag; this.value = value; }
}

/**
 * A SignerDefinition for WasmBuilder.sign: COSE_Sign1 (tag 18) with the payload detached, the algorithm and the
 * certificate chain (x5chain, label 33) in the protected header, and an empty unprotected header that the
 * library pads.
 * @param {string} certDir
 */
export function testSigner(certDir) {
  const key = createPrivateKey(readFileSync(`${certDir}/signer.key`));
  const der = (/** @type {string} */ f) => new X509Certificate(readFileSync(`${certDir}/${f}`)).raw;
  const chain = [der("signer.pem"), der("ca.pem")];
  return {
    alg: "es256",
    reserveSize: 10000,
    sign: async (/** @type {Uint8Array} */ claim) => {
      const protectedHeader = cbor(new Map([[1, -7], [33, chain]]));
      const toBeSigned = cbor(["Signature1", protectedHeader, Buffer.alloc(0), Buffer.from(claim)]);
      const signature = cryptoSign("sha256", toBeSigned, { key, dsaEncoding: "ieee-p1363" });
      // In this mode the library reserves exactly `reserveSize` bytes for the signature and does not pad it: a
      // shorter one moves everything after it, and the image's hash no longer matches. C2PA pads with a "pad"
      // byte string in the unprotected header.
      return new Uint8Array(padded(protectedHeader, signature, 10000));
    },
  };
}

/** COSE_Sign1 of exactly `size` bytes. @param {Buffer} protectedHeader @param {Buffer} signature @param {number} size */
function padded(protectedHeader, signature, size) {
  const encode = (/** @type {number} */ n) => cbor(new Tagged(18, [protectedHeader, new Map([["pad", Buffer.alloc(n)]]), null, signature]));
  let n = Math.max(0, size - encode(0).length);
  for (let i = 0; i < 4; i++) {
    const len = encode(n).length;
    if (len === size) return encode(n);
    n = Math.max(0, n + size - len);
  }
  throw new Error(`cannot pad the signature to ${size} bytes`);
}
