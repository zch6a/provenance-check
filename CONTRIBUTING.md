# Contributing

Thanks for helping. Two things matter more here than in most projects: what the report says is read as a verdict
about an image, and the extension runs with access to the pages people look at.

## Say what the credentials state, never more

The report says what the signer states, and every time what that does not prove. A new message must not turn a
statement into a fact ("made by Example News" for a signer nobody verified), and must not read absence as evidence
(no credentials is the normal case online). Words for AI go by IPTC's definitions: only the "trained algorithmic"
source types are generative AI. When in doubt, say less.

## Nothing leaves the computer

The reader runs behind a network guard (`src/network-guard.js`), installed before the C2PA library loads, in the
extension's worker and on the command line. Do not add a request: not for remote manifests, revocation (OCSP),
identity issuers, fonts, analytics or updates. The extension's only fetch is the image itself, once, without
cookies, from the site it came from, after the user allowed that site. `test/privacy.test.js` and the real-Chrome
test (`scripts/extension-e2e.mjs`) check this; a change that needs the network needs a discussion first.

## Text from credentials is hostile

Titles, tool names and labels are written by whoever made the file. In the page they are set with `textContent`
only, through `clean()` (`src/render.js`); on the command line through `src/text.js`, which also removes control
characters. Never build HTML or terminal output from them in another way.

## Test images are synthetic

All test images are made by `scripts/make-fixtures.mjs`, signed with a test-only certificate. Do not add real
photos or real people's credentials. `npm run fixtures` re-signs all of them (new signatures, so the files change):
run it only when a fixture has to change, and commit the result.

## Before a pull request

```bash
npm ci
npm test          # reports, privacy, the command line, the built extension, the Agent Skill
npm run check     # type-check (JSDoc + tsc)
npm run build
```

The real-Chrome test runs too when Chrome is installed. Use plain words in messages and docs, in English; the
Chinese README follows the English one.
