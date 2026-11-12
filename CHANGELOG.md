# Changelog

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
