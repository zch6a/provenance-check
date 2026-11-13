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

## Round 1 — 2026-11-12 (0.2.0)

**The real extension in a real Chrome.** Chrome 157 no longer takes `--load-extension`; the DevTools command `Extensions.loadUnpacked` over `--remote-debugging-pipe` does. `scripts/extension-e2e.mjs` loads the built extension into a fresh temporary profile and checks its own pages under its own CSP: a local file through the picker, a `data:` image, the permission question for a site's image, the popup, the service worker (`test/extension.test.js` runs it; skipped where Chrome is missing). It found a bug the browser-pane checks could not: **every `data:` image failed** with "shorten is not a function". The page started checking at load, before the helpers at the bottom of the module were defined; for an http image the first `await` (the permission check) had hidden it. Now the page starts after everything is defined.

**An independent review** (README and code only; 23 minutes; throwaway profiles) found 15 problems, 14 reproduced. One slip on its side, recorded here because it matters for later reviews: its first try at mapping test host names to a local server went out through the system proxy and reached an outside parking site once (no personal data). Every later run used `--no-proxy-server` and `MAP * ~NOTFOUND`; the e2e script now always launches Chrome that way.

- **Critical: a hostile image made the extension contact a server of its maker's choosing while reading it.** An identity statement (CAWG identity claims aggregation) names its issuer as a `did:web` address; the library resolves it (`https://<host>/<path>/did.json`) whatever the settings, from the extension's origin, before any host permission matters (CORS blocks reading the answer, not sending the request). A path unique to each image tells the server who opened which one. No library setting turns this off. Now the reader's worker is our own bundle: a network guard (`src/network-guard.js`) runs first and refuses every request but the extension's own files and blob:/data:, then c2pa-web's worker loads. Tests: in Node the library's attempt is recorded and refused (and a unit test of the guard); in Chrome the e2e attaches to the worker and records every request it starts while reading such a file (none; with the library's own worker swapped back in, the test sees the did.json request, so it is a real check).
- **High: an identity statement whose issuer is not on a trust list made the file "tampered"** ("These Content Credentials do not match this file"): only the main signature's trust codes were treated as trust. Validation results are now sorted by `kindOf()` into trust, identity and integrity; only integrity failures make a file invalid. While rewriting it, a latent bug of mine: informational results were counted as failures, so any informational code not on the list would have turned a file "invalid".
- **Medium**: the site could serve the extension a different file than the page showed (the request is easy to tell apart), and `cache: "force-cache"` kept checking an old copy forever while cookies (even `SameSite=Strict`) were sent. Now: default cache rules, no cookies (a site that wants a signed-in visitor gets a clear message), and the report says it checked the copy downloaded from that site, shown in the preview. The README no longer promises the browser's cache.
- **Medium, AI wording**: `https://` IPTC source types were not recognised (AI missed); `algorithmicMedia` (IPTC: *not* trained) and `compositeSynthetic` were called generative AI. Only trained algorithms count now; the others are described as what they are. Custom actions ("com.example.verified_by_c2pa_trust_list") read like statements of fact; now shown as their labels, marked custom.
- **Medium**: a Latin-1 percent-escaped file name threw in `decodeURIComponent` and left the page on "Reading…" forever.
- **Low**: the 250 MB limit trusted Content-Length (missing when chunked, compressed size when gzipped): bytes are now counted while downloading. On an invalid verdict the AI box had no caveat. Ingredient problems came from what the editing tool recorded (it could write anything): the reader's own ingredient results are shown as problems, the recorded ones apart, marked as such. Right-to-left override characters could make "holiday[RLO]gpj.exe" read "holidayexe.jpg": they are now shown as U+FFFD (also in the tab title); a 20,000-character title overflowed the page by 210,000 px: text over 400 characters is cut, everything wraps. Damaged credentials (a flipped byte in the container) read as "no credentials" and other damage as raw Rust errors: now "This file's Content Credentials are damaged", with the library's message in the technical details. "Signed on" did not say whether the time was trusted. The README said c2pa-web's license was kept in the built files: it was not (no license comments to keep); the build now writes `THIRD_PARTY_LICENSES.txt`. Object URLs were never freed; a file dropped during a check could be overwritten by the older result.

Held up, per the reviewer: no HTML injection anywhere (only `textContent`, the only attribute set is the preview's blob URL); remote manifests and OCSP never fetched; a byte-flip fuzz of a signed image found no way to keep "valid" after changing the picture or the signed claim; the worker-URL patch loosens nothing in practice; the manifest stays minimal.

A slip of mine in the docs, caught before committing: the Python script that edited the README wrote a real right-to-left override character into the sentence warning about them; replaced by "[RLO]".

**Tests**: 33 (+15): identity statements (X.509, did:web), https IPTC, algorithmic and synthetic sources, custom actions, informational results, trusted timestamps, ingredient results, damaged credentials, the downloaded-copy note, text cleaning, the guard, and the real-Chrome run (now also the did:web case).

**Open**
- Trust lists (C2PA conformance list in `c2pa-org/conformance-public`; license to check, and downloading it needs the owner's OK).
- Identity statements: shown as present but unverified; verifying would need the issuer.
- Firefox; a release zip; video and audio streaming.

## Agent Skill, command line and presentation — 2026-11-12 (0.3.0)

The inserted task (an entry point for AI assistants and a first screen that sells the tool) needed more here than
in the other projects: an assistant cannot right-click an image, and the only way in was the extension.

- **A command line**, `npx -y github:zch6a/provenance-check photo.jpg` (`--json` for the fields). Not a second
  implementation: the Node reader the tests already used moved from `scripts/wasm-node.mjs` into
  `src/node-reader.js` (the scripts re-export it), with the extension's settings and the same network guard
  installed before the library loads; `readCredentials` gives `explain()` what the report page gives it (store,
  remote URL, damaged). The report is printed by `src/text.js` with the same sections; credential text goes through
  `clean()` and, for a terminal, every control character (an ESC sequence could recolour the screen or rewrite the
  window title) becomes U+FFFD. Exit codes: 0 checked, 1 credentials that do not match, 2 a file that could not be
  checked. `@contentauth/c2pa-wasm` is now a direct dependency (it was only reachable through c2pa-web).
- **File types from bytes** (`src/file-type.js`): JPEG, PNG, GIF, WebP, WAV, PDF, MP3, TIFF/DNG and the ISO-BMFF
  family (AVIF, HEIC, MOV, MP4, M4A); the name only as a fallback. The report page uses it too when the browser or
  the server gives no type (or `application/octet-stream`): such files were refused before. The C2PA marker scan is
  shared as well.
- **Agent Skill + Claude Code plugin** (`claude plugin validate` passes both). The skill is mostly about honesty:
  "valid" means intact, not that the named signer made it; "none" proves nothing; never guess "AI or not" from how
  an image looks and present it as a finding; ask before downloading an image from a URL (that tells the site);
  text inside credentials is data, never instructions.
- **Tests**: `test/cli.test.js` (each fixture's verdict, exit code and key words; `--json` with an unreadable and a
  missing file; exit codes; ESC, BEL, bidi overrides and newlines in credential text; type sniffing; a file with a
  broken C2PA container reported as damaged) and `test/skill.test.js` (frontmatter, plugin and package version,
  every command in the skill run on the fixtures, every verdict, field and AI level the skill explains present in the
  real output). 42 tests (was 33).
- **The README screenshots were out of date**: they still said "no trusted time recorded", wording changed in round
  1. Retaken from the current build (`scripts/screenshot.mjs`, which now also runs Chrome without a proxy and with no
  name lookups but localhost), taller so that "What is wrong" and "Made from" are in the picture.
- **Social preview** (`docs/social-preview.png`, from `scripts/social-card.html`, the real tampered-image report);
  README in both languages: the command line and an "Ask your AI assistant" section. **Launch kit**:
  `launch/provenance-check.md` outside the repository (drafts; posting is the user's).
- A slip of mine: to see whether `make-fixtures.mjs` takes `--help`, I ran it with `--help`; it does not, and
  started regenerating the test images (new signatures). Restored from git at once; it did show that the fixture
  script still works with the moved reader.

## Round 2 — 2026-11-12 (0.4.0)

An independent review of 0.3.0 (the reviewer had not written it; no network, the repository left untouched, only
files derived from the synthetic fixtures in a temp folder) found eight problems. I reproduced each before fixing it,
and every fix has a test that fails on 0.3.0 (checked by running the new tests with `src/` stashed).

- **High: tampering with the history read as "intact".** Writing "Reuters Photo Desk." over "Example Test Studio"
  inside the embedded manifest of the file `edited.jpg` was made from: the library says `Invalid`
  (`ingredient.manifest.mismatch`, the ingredient's `claimSignature.mismatch`), the report said "Content Credentials
  intact" and listed the ingredient as "signed by Reuters Photo Desk.". Two mistakes: the reader's ingredient results
  are under `ingredientAssertionURI`, and the code read `uri`, a field c2pa-rs never writes. Round 1's unit test
  built its fake result with the same wrong field, so it passed; and the verdict looked at the image's own signature
  only. 7 of 240 random byte flips hit the same hole. Now ingredient integrity failures (and any integrity code in
  the library's overall list that the code does not place) make the report invalid, are named with the file they
  are about, and appear in that history entry. The unit test now uses the library's real field, and a test reads
  the tampered file through the real library.
- **High: remote credentials read as "none"** on the command line when their address contained "no…manifest"
  (`cdn.canon.invalid/manifests/…`): the not-found check was a loose regex run before the remote URL was read. Now
  only the library's exact `C2pa(JumbfNotFound)` / `C2pa(ManifestNotFound)`, as c2pa-web compares them.
- **High: any unreadable file was "damaged Content Credentials"**, in the extension too: a text file named .gif, a
  PNG cut to 90%, nine formats in all. Damaged now needs a C2PA container in the bytes; anything else is "could not
  read this file" (exit 2).
- **Medium**: a locked or unreadable file crashed the command line with a stack trace and exit 1 (which means "does
  not match"), losing the other files' results; the file name in an error line was printed raw (escape sequences,
  bells and right-to-left overrides reached the terminal, against what SECURITY.md said); AVI and `.c2pa` sidecars
  were refused although the library reads them (it detects the format from the bytes; the type is a hint), and so
  was every file whose type the bytes do not settle.
- **Low**: zero-width characters, line and paragraph separators and tag characters were not hidden; `clean()` cut
  at 400 UTF-16 units and could leave half an emoji; `--json` printed C1 controls and bidi characters raw (JSON only
  escapes U+0000 to U+001F); the size limit was checked only before reading; a 240 MB file used ~8× its size in
  memory (one copy removed); `parseArgs` needs Node 18.3, not 18; the report named the requested host even after a
  redirect to another; exit code 2 hides 1 (now documented, `--json` has each result).
- Not changed, and why: a file whose comment happens to contain the bytes "jumd…c2pa" is called damaged (crafted
  files only); following redirects stays (CDNs redirect images), the report now names where the copy came from.
- **Held up, per the reviewer**: the network guard is installed before the WebAssembly loads, and the glue calls
  `fetch` at call time, so the guard is the one used (the did:web fixture logged two refused requests, none got
  through; no fixture, truncation or fuzzed file made a request); 240 fuzzed signed files caused no crash, panic or
  hang; HTML in credentials stays text; the README example output matches; the manifest asks for one permission.
- **A pitfall of the editing tools, again**: writing `\u2028` and similar escapes into JavaScript, my editor turned
  them into the real characters twice (a real U+2028 inside a regex literal broke `cli.js`; the new test file got
  real bidi controls). A script now scans every source and test file and writes such characters back as escapes;
  it also found real right-to-left overrides that had been sitting in `cli.test.js` and `render.test.js` since
  earlier rounds (GitHub warns about them).
- An existing privacy test caught a slip of mine: a comment I wrote held a web address, which the test forbids in
  source; reworded.
- **Docs and engineering**: `CONTRIBUTING.md` (what must not change: say only what the credentials state, nothing
  leaves the computer, hostile text, synthetic test images), `SECURITY.md` (threat model; every claim checked against
  the code, two corrected after the review), README links to both, the Develop section lists what `npm test`
  covers; `test/package.test.js`: the installed package holds the command line and everything it imports (checked
  to fail when the files list drops `src/`), and the WebAssembly reader is pinned to the version c2pa-web uses.
  `npm audit` against the public registry: 0 vulnerabilities (the configured mirror has no audit endpoint).

**Tests**: 51 (was 42); one runs only on Linux and macOS (a file without read permission).

**Open**
- Trust lists (needs the owner's OK to download the C2PA trust list).
- Firefox; a release zip; streaming for large video and audio instead of reading them whole.

## Round 3 — 2026-11-12 (0.5.0)

- **Function / experience**: installing meant cloning, `npm ci` and a build. Now each version tag makes a GitHub
  release with the built extension as a zip (`.github/workflows/release.yml`: tests, build, `scripts/zip.mjs`, the
  version's CHANGELOG section as notes, `gh release upload --clobber` when re-run; a tag that is not the package
  version fails). The ZIP writer is 80 lines on `node:zlib`, no dependency; its own CRC-32 because `zlib.crc32` only
  exists from Node 20.15 and the tests run on 18. Reproducible: sorted entries, the earliest DOS date, no extra
  fields; already-compressed files (PNG, WASM) are stored. Checked by Windows' own Expand-Archive (14 files, the WASM
  byte-identical) and in the tests by a small reader with `inflateRawSync`, CRCs against zlib's where it has one,
  and `unzip -t` where the system has it (Linux, macOS CI).
- **Accessibility, found by looking for it**: on the "Check a file" page, Tab reached nothing. The file input had the
  `hidden` attribute inside its label, and a label cannot take focus: a keyboard-only user could not check a local
  file at all. Confirmed in a browser (no focusable element), fixed with a visually-hidden input and a focus ring on
  the button (checked: Tab lands on the input, the outline shows), and `test/pages.test.js` (fails on the old page):
  the input stays in the tab order; every page has a language, a title and a top heading; the report region is
  announced when it changes.
- **Firefox: not done, on purpose.** It needs a different background setup (`background.scripts` instead of a
  service worker), a gecko id and testing in a real Firefox; none is installed here, and installing one is a
  download that needs the owner's OK. A Firefox build that nobody ran would be a claim the README cannot make.
- **Still open**: the C2PA trust list (needs the owner's OK to download), Firefox, reading big video and audio in
  parts instead of whole.

**Tests**: 57 (was 51); one runs only on Linux and macOS.

## Round 4 — 2026-11-12 (0.6.0)

Round 2's review covered the command line and the verdicts; this round's independent review covered the extension
side and the release tooling (no network; the reviewer ran the real `report.js` against a small fake DOM with
stubbed `fetch`, permissions and reader to reach the error paths, and `npm test` with its offline Chrome). Twelve
findings; all fixed or answered.

- **High: a failure of the reader read as a verdict.** A stubbed reader throwing `RuntimeError: unreachable` made the
  intact `camera.jpg` read "This file's Content Credentials are damaged … altered after it was signed"; and
  `sdk ??= createC2pa(...)` kept a rejected start, so one failure mislabelled every later file in the tab. Only the
  library's own errors (`C2pa(...)`) are about the file now; anything else says it is a problem in provenance-check,
  and the reader is started anew (a failed start is not kept). The same rule on the command line (`interpret()`,
  tested).
- **High: stuck pages.** A download cut off partway, a folder dropped, or a file that changed after it was picked
  left "Reading the image…" or "Checking…" for good (unhandled rejections). Rewritten: every check runs through one
  guarded path that ends on a message with a way on; each check has an AbortController, so a newer one cancels the
  older download; the permission question checks it is still the newest check (it could replace a newer result).
- **High: the release workflow handed a write token to dependency and test code** (job-wide `contents: write`, the
  token kept in `.git/config` by checkout, then `npm ci` with install scripts and `npm test`). Now a build job with a
  read-only token, `persist-credentials: false` and `npm ci --ignore-scripts` tests, builds and zips; a publish job
  with write access only downloads that artifact and calls `gh`. Actions pinned to commits (looked up with the
  GitHub API), CI read-only too. `test/workflows.test.js` keeps it so.
- **Medium: large `data:` images did nothing**: the image went into `report.html?src=` and, percent-encoded, past
  Chrome's 2 MB address limit (and every `data:` image was written into the browser history in full). The background
  script now keeps a `data:` image for a minute and the report page asks for it by a random id over the extension's
  own messaging (only its report page; no web page can connect). No new permission. An image the menu gives no
  address for gets a message instead of silence.
- **Medium: the Chrome test of the worker's requests could pass without watching anything** (Network.enable's reply
  was not checked, nothing asserted a worker was attached). Now it counts attached and enabled workers, and a
  **control build** (`PC_UNGUARDED_WORKER=1`, named "TEST CONTROL … do not use") read the same way must be seen
  trying `https://tracker.example.invalid/image-4711/did.json`. It is: so "no request" in the real build is the
  guard's doing, and the README can say the test watches.
- **Medium**: after a per-site grant, a redirect to another site failed with "Failed to fetch": the message now says
  why and offers "Allow all sites"; the docs say precisely what happens to redirects (README, SECURITY).
- **Low**: `file:` images went to `fetch` (which cannot read them): now pointed to the file picker; the optional
  permission `<all_urls>` included `file://`, now `*://*/*`; addresses with a user name and password showed the
  password in messages: refused without it, and taken out of the tab's address; the tab title and the preview's
  object URL survived an error; "Too large" had no way on; choosing the same file again did nothing; a server type
  like `binary/octet-stream` or in capitals got no preview; private windows: `"incognito": "split"` (Chrome's
  default "spanning" would open the report in a normal window, or fail).
- **Held up, per the reviewer**: no HTML from untrusted data anywhere; the preview is a `blob:` of the downloaded
  copy (an SVG in `<img>` runs nothing); no web page can reach the extension; the zip holds exactly the 14 built
  files, byte-identical after Expand-Archive and tar; no API newer than Chrome 116 in the bundles.
- **Also this round (mine)**: the command line reads a file where the library asks (`FileBlob`, slices read with
  `readSync`) instead of whole: the same reports for every fixture (tested), a 150 MB video checked with well under
  100 MB of memory (tested; the library read 112 bytes of a 200 MB one in the experiment). And the v0.5.0 release
  zip that GitHub built on Linux has the same SHA-256 as the one built here on Windows.
- Not done: the hand-off of a `data:` image from a real right-click is not driven in the Chrome test (the context
  menu cannot be clicked there); the unknown-id path is.

**Tests**: 63 (was 57); one runs only on Linux and macOS.

## Round 5 — 2026-11-12 (1.0.0): the last round of the first cycle

- **The file people download, tested.** Until now the Chrome check ran on `dist/`; what is published is the zip.
  Unzipped the 0.6.0 zip and ran the whole Chrome check on it (all passed), and made that a step of the release:
  every zip is unpacked and checked in Chrome before the publish job gets it, and a runner without Chrome fails
  the release instead of skipping (`test/workflows.test.js` keeps the step and its order). The 0.6.0 release ran
  the new two-job workflow for real: build 36 s with a read-only token, publish 9 s.
- **`docs/COMPATIBILITY.md`**: what 1.x keeps (the command line's options and exit codes, `--json` schema 1 and the
  report's fields, the five verdicts, the AI levels, that reading never makes a request, the permissions) and what
  it does not (the words, `technical.codes`, layouts, the list of formats, limits). `test/compatibility.test.js`
  checks the document against the command line's real output: a report field added without the document, or a
  promised one missing, fails. Shipped in the package.
- **Every README claim read against the code.** Two were wrong: "a few hundred lines on top of the reference
  library" (counted: about 920 lines of code without comments, now said so), and "what changed" left out the
  credentials of a file it was made from (round 2's finding). The Status section now says what is tested, the two
  reviews, and the reproducible zips; both languages.
- Not in 1.0, and said so in the README and the changelog: the C2PA trust list (needs the owner's OK to download),
  Firefox (needs a real Firefox to test).

**Tests**: 66 (was 63); one runs only on Linux and macOS. **First cycle complete for provenance-check: 5/5.**

## Summary

provenance-check reads an image's Content Credentials on the user's computer, with the C2PA reference library, and
says in plain words what they state and what that does not prove: in Chrome and Edge (right-click), on the command
line, and through an Agent Skill.

What mattered most, in hindsight:
- **Saying no more than the credentials do.** "Intact" is not "made by the named signer"; no credentials proves
  nothing; only IPTC's "trained algorithmic" types are generative AI; a reader failure is not a verdict.
- **Nothing leaves the computer, proven.** A network guard in the reader's worker, because a CAWG identity
  statement makes the library contact an address chosen by the file's maker and no setting stops it; a real-Chrome
  test that watches the worker, with a control build that must be seen making the request.
- **Two reviews by someone who had not written it** found what my own tests could not, because the tests shared my
  assumptions: a field name the library never writes (so altered history read "intact"), a loose regex, error paths
  that ended in a false verdict or a page stuck on "Checking…", a release token within reach of dependency code.
- **Text from files is hostile**: HTML, bidi overrides, zero-width look-alikes, terminal escapes.

Rounds: development (0.1, 18 tests) → 1 first review, real Chrome, the network guard (0.2, 33) → Agent Skill and a
command line (0.3, 42) → 2 review of the reader and the command line (0.4, 51) → 3 release zip, keyboard access
(0.5, 57) → 4 review of the extension and the release, reading files in parts (0.6, 63) → 5 the zip itself tested,
compatibility promise, claims checked (1.0, 66).

Still open: the C2PA trust list; Firefox; identity statements verified (would mean contacting their issuer).

## Lockfile - 2026-11-13

`package-lock.json` recorded the 38 download URLs from this machine's npm mirror (`registry.npmmirror.com`) instead of the public registry, so CI and anyone installing fetched from a mirror they never chose. Every `resolved` URL now points at `registry.npmjs.org`; nothing else changed (same versions, and the integrity hashes still match because the tarballs are identical). Checked: `npm ci --ignore-scripts`, `npm run check` and the tests pass; `npm audit` against the public registry finds 0 vulnerabilities.

### 2026-11-14 — Chinese README: AI tone

- 7 places changed in README.zh-CN.md: 6 decorative dashes rewritten as commas, full stops or plain sentences, and 1 sentence with a long attributive and a three-item 顿号 list (who can attach Content Credentials) restructured.
- The checks follow the findings of lieflat-less-ai-tone (shiujan, CC BY-NC 4.0): its findings applied, its text not copied.
- Left as they were: colon-led lists, headings, must-be-complete enumerations (what the report says, the test fixtures), and the "希望……" sentence in Other tools.
