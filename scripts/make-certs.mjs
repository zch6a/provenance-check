// Makes the TEST-ONLY certificates in test/fixtures/certs with openssl: a CA and a signer it issued (EC P-256).
// Run once; the results are committed so that tests do not depend on openssl. Never use them for anything real.
import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "test", "fixtures", "certs");
const cnf = join(root, "scripts", "certs.cnf");
const openssl = process.platform === "win32" && existsSync("C:/Program Files/Git/mingw64/bin/openssl.exe")
  ? "C:/Program Files/Git/mingw64/bin/openssl.exe" : "openssl";
const run = (/** @type {string[]} */ args) => execFileSync(openssl, args, { cwd: out, stdio: ["ignore", "pipe", "inherit"] });

mkdirSync(out, { recursive: true });
run(["ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", "ca.key"]);
run(["req", "-new", "-x509", "-key", "ca.key", "-out", "ca.pem", "-days", "3650", "-sha256", "-config", cnf, "-extensions", "ca_ext"]);
run(["ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", "signer-ec.key"]);
run(["pkcs8", "-topk8", "-nocrypt", "-in", "signer-ec.key", "-out", "signer.key"]);
rmSync(join(out, "signer-ec.key"));
run(["req", "-new", "-key", "signer.key", "-out", "signer.csr", "-subj", "/CN=Example Test Studio (not trusted)/O=provenance-check tests"]);
run(["x509", "-req", "-in", "signer.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-out", "signer.pem", "-days", "3650", "-sha256",
  "-extfile", cnf, "-extensions", "signer_ext"]);
for (const f of ["signer.csr", "ca.srl"]) rmSync(join(out, f), { force: true });
writeFileSync(join(out, "README.md"), "TEST ONLY. Made by scripts/make-certs.mjs for the tests of provenance-check. These keys are public\n" +
  "and on no trust list: never use them to sign anything real.\n");
const cert = new X509Certificate(readFileSync(join(out, "signer.pem")));
console.log(`subject: ${cert.subject.replace(/\n/g, ", ")}\nissuer: ${cert.issuer.replace(/\n/g, ", ")}\nvalid to: ${cert.validTo}\nextended key usage: ${cert.keyUsage}`);
