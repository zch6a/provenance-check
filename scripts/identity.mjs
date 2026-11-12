// CAWG identity statements for test images (test tooling only): an X.509 one signed with the test certificate, and
// an "identity claims aggregation" one whose issuer is a did:web address, the kind the library resolves over the
// network (and the extension must not). Shapes as the library's WASM builder expects them (IdentityAssertionDefinition).
import { createPrivateKey, sign as cryptoSign, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";

import { cbor, Tagged } from "./cose.mjs";

/** The signer payload the identity signature covers, as CBOR. @param {{referencedAssertions: {url: string, hash: Uint8Array, alg?: string}[], sigType: string, roles?: string[]}} p */
function signerPayload(p) {
  const m = new Map([
    ["referenced_assertions", p.referencedAssertions.map((r) => new Map([["url", r.url], ...(r.alg ? [["alg", r.alg]] : []), ["hash", Buffer.from(r.hash)]]))],
    ["sig_type", p.sigType],
  ]);
  if (p.roles?.length) m.set("roles", p.roles);
  return cbor(m);
}

/** An X.509 identity statement (cawg.x509.cose) signed with the test signer. @param {string} certDir */
export function x509Identity(certDir) {
  const key = createPrivateKey(readFileSync(`${certDir}/signer.key`));
  const chain = ["signer.pem", "ca.pem"].map((f) => new X509Certificate(readFileSync(`${certDir}/${f}`)).raw);
  return {
    sigType: "cawg.x509.cose", reserveSize: 8000, referencedAssertions: ["c2pa.actions.v2"], roles: [],
    sign: async (/** @type {any} */ p) => {
      const prot = cbor(new Map([[1, -7], [33, chain]]));
      const payload = signerPayload(p);
      const sig = cryptoSign("sha256", cbor(["Signature1", prot, Buffer.alloc(0), payload]), { key, dsaEncoding: "ieee-p1363" });
      return new Uint8Array(cbor(new Tagged(18, [prot, new Map(), payload, sig])));
    },
  };
}

/**
 * An identity claims aggregation statement from a did:web issuer. Its signature is not real: reading it makes the
 * library try to fetch the issuer's DID document (https://<host>/<path>/did.json), which is what tests look for.
 * @param {string} did e.g. "did:web:tracker.example.invalid:image-4711"
 */
export function icaIdentity(did) {
  return {
    sigType: "cawg.identity_claims_aggregation", reserveSize: 6000, referencedAssertions: ["c2pa.actions.v2"], roles: [],
    sign: async (/** @type {any} */ p) => {
      const vc = {
        "@context": ["https://www.w3.org/ns/credentials/v2", "https://cawg.io/identity/1.1/ica/context/"],
        type: ["VerifiableCredential", "IdentityClaimsAggregationCredential"],
        issuer: did,
        validFrom: "2025-01-01T00:00:00Z",
        credentialSubject: {
          id: `${did}:user`,
          verifiedIdentities: [{ type: "cawg.social_media", name: "Test", username: "test", uri: "https://social.example.invalid/test",
            verifiedAt: "2025-01-01T00:00:00Z", provider: { id: "https://social.example.invalid", name: "Example" } }],
          c2paAsset: {
            referenced_assertions: p.referencedAssertions.map((/** @type {any} */ r) => ({ url: r.url, hash: Buffer.from(r.hash).toString("base64"), ...(r.alg ? { alg: r.alg } : {}) })),
            sig_type: p.sigType, roles: p.roles,
          },
        },
      };
      const prot = cbor(new Map([[1, -8], [3, "application/vc"]])); // EdDSA, a verifiable credential inside
      return new Uint8Array(cbor(new Tagged(18, [prot, new Map(), Buffer.from(JSON.stringify(vc)), Buffer.alloc(64, 1)])));
    },
  };
}
