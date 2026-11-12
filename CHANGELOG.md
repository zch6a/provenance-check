# Changelog

## 0.6.0 — 2026-11-12

Polishing round 4: an independent review of the extension side found twelve problems. All fixed or answered.

- **A failure of the reader read as a verdict.** Any error from the reader (its worker stopping, memory running
  out) made an intact file read "This file's Content Credentials are damaged … altered after it was signed", and a
  reader that failed to start was kept, so every later file in the tab failed the same way. Only the C2PA library's
  own errors count as being about the file now; anything else says it is a problem in provenance-check, and the next
  check starts a new reader. The same on the command line.
- **The page could stay on "Reading the image…" or "Checking…" for good**: a download cut off, a folder dropped
  instead of a file. Every check now runs through one guarded path and ends on a message with a way on; a newer check
  cancels the older one's download.
- **Large `data:` images did nothing**, and every `data:` image was written in full into the tab's address and the
  browser history: they are handed to the report page inside the extension now. No address from the menu gets a
  message instead of silence.
- **The release workflow gave a write token to dependency and test code.** Build and test run with a read-only
  token and no install scripts; a separate job that runs nothing of the project uploads the tested zip. Both
  workflows pin their actions to commits; CI is read-only.
- **The real-Chrome check of the worker's requests could pass without watching**: it now checks that the worker
  was attached and watched, and a control build without the network guard must be seen trying the did:web issuer.
- Addresses with a user name and password are refused without showing the password (and it is taken out of the
  tab's address); `file:` addresses point to the file picker; a redirect to another site after a per-site
  permission says so and offers "Allow all sites"; the optional permission no longer includes `file:` (`*://*/*`
  instead of `<all_urls>`); in private windows the extension runs as its own instance ("split").
- Smaller: the permission question could replace a newer check's result; the tab title and the preview stayed from
  the previous file after an error; "Too large" had no way on; choosing the same file again did nothing; a server
  type such as `binary/octet-stream` (or in capitals) got no preview.
- The command line reads files where the library asks instead of whole: a 150 MB video costs a few hundred bytes of
  reading, not its size in memory.

## 0.5.0 — 2026-11-12

Polishing round 3.

- **A release zip**: every version tag builds the extension and attaches `provenance-check-<version>.zip` to its
  GitHub release, so it can be loaded without Node or a build. Made by `scripts/zip.mjs`, a small ZIP writer with no
  dependencies, reproducible (sorted entries, a fixed timestamp: the same build gives the same bytes); the release
  notes are the version's CHANGELOG section, and the release refuses a tag that is not the package version.
- **The "Check a file" page could not be used with the keyboard**: its file input was `hidden` inside a label,
  which left the page with no focusable element at all. The input is now only visually hidden, and the button shows
  a focus ring.

## 0.4.0 — 2026-11-12

Polishing round 2: an independent review of 0.3.0 found eight problems, three of them in the report itself. All
fixed, each with a test that fails on 0.3.0.

- **The credentials of the file an image was made from, altered, read as "intact".** The reader reports problems
  with an ingredient under `ingredientAssertionURI`; the code looked for a `uri` field that the library never
  writes (the unit test built its fake result the same wrong way), and judged the verdict on the image's own
  signature only. Writing a different signer's name into the embedded history of `edited.jpg` gave "Content
  Credentials intact" while the library said Invalid. Now any integrity failure in an ingredient makes the report
  invalid, says which file it was made from is affected, and appears in that history entry.
- **Credentials stored at an address containing "manifests" read as "No Content Credentials"** on the command line:
  the "not found" match was loose (`no.*manifest`) and ran before the remote address was read. Now the library's
  exact "not found" errors only, as c2pa-web does.
- **A broken file without C2PA was called "damaged Content Credentials"** (a truncated PNG, a text file named .gif):
  damaged now needs a C2PA container in the bytes; anything else is "could not read this file", in the extension
  and on the command line (exit 2).
- Command line: a file that exists but cannot be opened (locked, no permission) is an error for that file instead
  of a crash; the file name in an error line goes through the same terminal cleaning as credential text; `--json`
  escapes C1 controls and invisible characters; empty and 1–3-byte files say so; AVI and `.c2pa` sidecars are
  recognised, and a file whose type the bytes do not settle is left to the library instead of refused; the size
  limit is checked again after reading; half the memory for a large file (no second copy).
- Text from credentials: zero-width characters (look-alikes such as "pay…pal"), line and paragraph separators and
  Unicode tag characters are shown as "�" too; long text is cut on whole characters (an emoji at the cut left half
  of itself).
- The report says which host the checked copy came from after redirects. Node 18.3 or later (`parseArgs`).
- Test files kept real right-to-left override characters (from earlier rounds); now written as escapes.
- `CONTRIBUTING.md`, `SECURITY.md`, and a test that the installed package holds the command line and everything it
  imports.

## 0.3.0 — 2026-11-12

- **A command line**: `npx -y github:zch6a/provenance-check photo.jpg` (or `--json`). The same reader, settings,
  network guard and report as the extension, in plain text; local files only, several at once; exit code 0 checked,
  1 credentials that do not match, 2 a file that could not be checked. Text from credentials is made safe for a
  terminal too: escape sequences and other control characters, and characters that reorder text, are shown as "�".
- **An Agent Skill and a Claude Code plugin** (`/plugin marketplace add zch6a/provenance-check`): ask the assistant
  whether an image is AI-generated or where it comes from; it reads the credentials and explains each verdict with
  what it does not prove. A test runs every command the skill gives on the test images.
- The file's format is read from its bytes when the browser or the server gives none (or `application/octet-stream`),
  so such a file is no longer refused.

## 0.2.0 — 2026-11-12

Polishing round 1: an independent review found 15 problems, and loading the real extension into Chrome found one
more. All fixed, each with a test.

- **Privacy**: an identity statement (CAWG) from a `did:web` issuer made the C2PA library contact that address while
  reading the file, which no setting turns off. The reader's worker now loads a network guard first and refuses any
  request outside the extension; a test in a real Chrome watches the worker's requests.
- An identity statement whose issuer is not on a trust list no longer makes a file "tampered". Validation results
  are sorted into trust, identity and integrity; only integrity failures make a file invalid, and informational
  results never do.
- AI: only *trained* algorithms count as generative AI (`algorithmicMedia` and `compositeSynthetic` no longer do);
  source types written with `https://` are recognised; custom actions are shown as their labels.
- The image is downloaded without cookies and revalidated (a cached old copy could be checked forever); the report
  says which copy it checked. Files over 250 MB are refused while downloading, also without a size header.
- `data:` images failed in the real extension (a helper used before it was defined); a non-UTF-8 file name hung the
  page; damaged credentials read as "no credentials".
- Text that reorders characters (right-to-left overrides) is made visible; very long text is cut and wraps.
- Ingredient problems found by the reader are kept apart from what the editing tool recorded.
- "Signed on" says whether the timestamp is trusted.
- The licenses of the bundled packages ship in `dist/THIRD_PARTY_LICENSES.txt`.

## 0.1.0 — 2026-11-12

First version.
