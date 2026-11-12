# Polish log

## Development — 2026-11-12 (0.1.0)

**What it is for.** Content Credentials (C2PA) are signed records that cameras, editors and AI generators attach to files. Extensions that read them exist ("C2PA Content Credentials", Digimarc's open-source one on the older C2PA-JS library, Adobe's Content Authenticity, others). provenance-check aims at three things together: the check runs locally on the reference library, the result is in plain words with what it does not prove (no credentials is normal; valid credentials are the signer's statement, not proof), and the code is small enough to read.

**Design**
- **The reference library, not a reimplementation**: `@contentauth/c2pa-web` 0.15.5 (c2pa-rs compiled to WebAssembly, run in a worker), pinned to a release more than two weeks old. Verification is the library's; this code turns its result into words (`src/explain.js`, a pure function, tested on what the library returns for each test image).
- **Verdicts from the library's validation state**: trusted, valid (intact, signer not on a trust list in use), invalid (something changed: each failure code in words), remote (credentials only pointed to), none. AI is read from the IPTC digital source type of the "created" action, AI used in later edits, and AI-generated ingredients, recursively.
- **Permissions**: the context menu only. Host access is optional and asked per site (or all sites) from the report page at the moment it is needed; no content scripts. The image is fetched once more from where the page got it, from the cache when possible.
- **Nothing else goes out**: remote manifest fetching is on by default in the library and is turned off (following a URL inside an image would tell that server what you are looking at); OCSP stays off; no trust list is fetched. The settings live in one module that the extension and the tests share.
- **Text from credentials is hostile input** in a page with extension privileges: set only with `textContent`; a test fails on `innerHTML` and the like in `src/`.

**Found while building**
- The WASM signer hands the claim to JavaScript and expects a complete COSE_Sign1 back (it handles no certificates), which the docs do not say; found in its Rust source (`direct_cose_handling` is hardcoded true). `scripts/cose.mjs` builds one: a minimal CBOR encoder, ES256 with Node's crypto, the certificate chain in the protected header.
- The first signed images all failed with "data hash exclusion does not match the manifest location": in that mode the library reserves exactly `reserveSize` bytes for the signature and does not pad a shorter one, so everything after it moved. Now padded with a `pad` entry to exactly that size.
- The WASM build reads Blobs with `FileReaderSync`, which Node lacks: a Blob subclass that keeps its bytes (and its slices') and a small stand-in, for the tests only.
- `c2pa-node` 0.9.11 downloads a native binary from GitHub in its install script, which hung for over ten minutes here; dropped. Making and reading test images uses the same WASM build as the extension.
- c2pa-web starts its worker from a given URL only if it is `https:`; otherwise from a `blob:` or `data:` URL, which an extension page's CSP forbids. The build patches that one check to also accept `chrome-extension:`, `moz-extension:` and `http://localhost` (development), and fails if the check's text changes.
- Headless Chrome's `--virtual-time-budget` screenshot fired before the worker finished; `scripts/screenshot.mjs` drives Chrome over the DevTools protocol and waits for the report.
- A bug in my first `explain`: the AI statement and the "Source" came from the first action that named a source, so an edit with generative AI made the whole image "made by generative AI". Only the "created" action says how it was made; a test with the library's result shape caught it.

**Tests** (18): every test image read by the reference library with the extension's settings and explained (AI-generated, camera, edited with its parent, tampered, no credentials, credentials stored elsewhere, HTML in the texts); trust, revocation, unknown failure codes and AI edits from the library's result shapes; privacy (reading fetches nothing; with the library's defaults it *would* fetch the remote manifest, so the test means something; the shared settings are the ones the extension passes); the built extension (permissions, CSP, packaged worker and WASM, the worker check patched, no `innerHTML`, no web addresses in our code). Checked by hand in the browser pane with the real WASM reader: every test image, the hostile texts shown as text, no request outside localhost.

**Open for the polishing rounds**
- Trust: the C2PA trust list (bundled, not fetched), so that real signers can show as verified.
- Firefox (MV3 there uses background scripts, not a service worker), a release zip, and the Chrome Web Store listing text.
- Real-world files: credentials from cameras, Adobe tools and AI generators (needs public, openly licensed samples; ask before downloading).
- Video and audio: fetched whole today, up to 250 MB.
