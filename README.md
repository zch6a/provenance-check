<div align="center">

# provenance-check

**Right-click an image, see what its Content Credentials say.** Who signed it, with what tool, whether AI made
it, what was edited, and whether the file changed since it was signed. In plain words, with what that does
*not* prove. Read on your computer with the C2PA reference library; nothing is uploaded.

<a href="https://github.com/zch6a/provenance-check/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/zch6a/provenance-check/actions/workflows/ci.yml/badge.svg"></a>
<img alt="Manifest V3" src="https://img.shields.io/badge/Chrome%20%2F%20Edge-Manifest%20V3-2d5bd7">
<a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue"></a>

**English** · [简体中文](README.zh-CN.md)

</div>

---

<img src="docs/report-edited.png" alt="The report for an edited test image: credentials intact, signer not verified, what was done, what it was made from" width="760">

## What it tells you

[Content Credentials](https://contentcredentials.org) (the C2PA standard) are signed records that cameras,
editors and AI image generators can attach to a file. provenance-check reads them and says:

- **Whether the file changed since it was signed.** "Intact", or "These Content Credentials do not match this
  file", with what changed (the picture, part of the credentials, the signature).
- **Who signed it**, and whether that signer can be confirmed (see [trust](#what-it-does-not-do-yet)).
- **Whether AI was involved**, as the credentials state it: made by generative AI, edited with it, or made
  from a file that was; or that they say nothing about AI.
- **How it was made and changed**: the source (a camera, generative AI, a screenshot ...), the tool, the edits
  (cropped, colours adjusted ...), and the files it was made from, each with its own signer.
- **What that does not prove**, every time: credentials record what the signer states; they do not show that
  a scene is real. And no credentials at all is the normal case online, not a sign of a fake.

<img src="docs/report-tampered.png" alt="The report for a tampered test image: the credentials do not match, the picture changed after it was signed" width="760">

## Use

- On a web page, right-click an image (or a video or audio) and choose **Check Content Credentials**. The report
  opens in a new tab. The first time for a site, the browser asks you to let provenance-check fetch images from
  it (or from all sites).
- To check a file on your computer, click the toolbar icon, then **Check a file…**, and drop the file in.
- On the command line (Node 18.3 or later), the same reader and the same report, in plain text or `--json`:

  ```bash
  npx -y github:zch6a/provenance-check photo.jpg
  ```

  For the test image that was changed after it was signed (`test/fixtures/tampered.jpg`), shortened:

  ```text
  ✗ These Content Credentials do not match this file
    tampered.jpg
    Something changed after the credentials were signed, or the signature itself is wrong. ...

  What the credentials claim (not reliable for this file):
    Signed by: Example Test Studio (not trusted)
    ...
    Source: a camera (digital capture)

  What is wrong:
    ✗ The picture changed after it was signed.
  ```

  Local files only, several at once. Exit code 0 when checked, 1 when a file's credentials do not match it, 2 when
  a file could not be checked (2 wins over 1; `--json` has the result of each file).

## Ask your AI assistant

provenance-check comes with an Agent Skill. In Claude Code:

```text
/plugin marketplace add zch6a/provenance-check
/plugin install provenance-check@provenance-check
```

Then ask "is this image AI-generated?" or "where does this photo come from?". The assistant checks the file's
Content Credentials and answers from them, honestly: a signer that is not verified is a name, not a fact; no
credentials says nothing either way; and it will not guess "AI or not" from how an image looks. Assistants that
read Agent Skills from a folder: copy [`plugin/skills/provenance-check`](plugin/skills/provenance-check/SKILL.md)
into theirs.

## Install

Not in the Chrome Web Store yet. From a release: download `provenance-check-<version>.zip` from
[Releases](https://github.com/zch6a/provenance-check/releases) (from 0.5.0 on) and unzip it. Or from the source
(Node 18.3 or later):

```bash
git clone https://github.com/zch6a/provenance-check
cd provenance-check
npm ci
npm run build
```

Then open `chrome://extensions` (or `edge://extensions`), turn on **Developer mode**, choose **Load unpacked**
and pick the unzipped folder (or `dist`). Chrome and Edge 116 or later.

## Private by design

- The image is read **on your computer**, by the C2PA reference library ([c2pa-rs](https://github.com/contentauth/c2pa-rs),
  compiled to WebAssembly) that ships inside the extension. Nothing is uploaded, no account, no telemetry.
- The only request it makes is downloading the image once more, **without your cookies**, from the site it came
  from, and only after you allowed that site. If that site redirects the request elsewhere (an image server), the
  browser follows it, and shows the file only if the other site allows it or you allowed all sites; the report names
  the host the copy came from. That copy is what is checked and shown (a site can send different visitors different
  files). An image written into the page itself (`data:`) is read without any request; it is handed to the report
  page inside the extension, not in the tab's address, so it does not end up in your history.
- The reader runs in a worker that **cannot reach the network**. Some credentials carry an identity statement
  (CAWG) whose issuer the C2PA library would look up on its own, at an address the file's maker chose: that would
  tell them who opened which image. The worker refuses any request outside the extension. A test in a real
  Chrome watches its requests while it reads such a file, and checks that it really is watching: a control build
  without the guard, read the same way, is seen trying the issuer's address.
- It does **not** follow credentials that a file only points to by URL ("remote manifests"): doing so would tell
  that server which image you are looking at. The report says where they are, and leaves the choice to you.
  It does not look up certificate revocation (OCSP) either. Tests check that reading fetches nothing.
- It asks for one permission (the right-click menu). Access to a site's images is optional and asked for when
  needed; no script runs inside web pages.
- Text from credentials (titles, tool names) is written by whoever made the file. The report shows it as text,
  never as HTML; characters that reorder text (which can make "holiday[RLO]gpj.exe" look like "holidayexe.jpg") are
  shown as "�" (U+FFFD); a test image with HTML in its title checks that.

## What it does not do (yet)

- **Trust.** It does not yet check signers against the C2PA trust list, so every signer shows as "not verified":
  the report tells you who signed, and you judge the name. (Anyone can make a certificate called "Famous News
  Agency"; the trust list is what tells the real one apart.)
- It reads what is inside the file: not invisible watermarks or fingerprints that lead to credentials stored
  elsewhere. An identity statement (who made it, signed separately) is shown as present but not verified: checking
  it would mean contacting its issuer.
- It cannot tell whether an image *without* credentials was made by AI. Nothing reliable can.
- Images that exist only inside a page (`blob:` addresses), images opened from your disk (`file:`) and addresses
  with a user name and password are not fetched: save the image (or choose the file) and check the file. Files up
  to 250 MB.
- In a private window it runs as a separate instance (Chrome's "split" mode), so the report opens in that window;
  extensions run there only if you allow it in Chrome's extension settings.
- Firefox: not yet (it needs a different background script setup).

## Other tools

Other browser extensions read Content Credentials, among them "C2PA Content Credentials", Digimarc's (open
source, on the older C2PA-JS library) and Adobe's Content Authenticity, and
[contentcredentials.org/verify](https://contentcredentials.org/verify) checks files you upload. provenance-check
is for people who want the check done locally, the result in plain words with its limits, and a small
open-source code base they can read: MIT, a few hundred lines on top of the reference library.

## Status

0.6, in development ([changes](CHANGELOG.md)). Tested with synthetic images signed for the tests by the reference library with a test-only
certificate (`test/fixtures`, made by `scripts/make-fixtures.mjs`): an AI-generated image, a camera image, an
edit with its history, a tampered copy, one without credentials, one with credentials stored elsewhere, one with
HTML in its texts, two with identity statements. The built extension is also loaded into a real Chrome (a fresh
profile, no network) and checked end to end: a local file, a `data:` image, the permission question, the popup, and
the reader's worker making no request. The report page is checked in a browser with the real WebAssembly reader.

## Develop

```bash
npm ci
npm test            # the reports for the test images, privacy (nothing fetched), the command line, the built
                    # extension, the package contents, the Agent Skill
npm run check       # type-check the JavaScript (JSDoc types, tsc)
npm run build       # into dist/
node scripts/serve.mjs   # the report page outside the extension: http://localhost:5180/dist/report.html?src=/test/fixtures/edited.jpg
```

`npm run fixtures` remakes the test images (`scripts/cose.mjs` signs them; the library's WebAssembly build
expects the signer to return a complete COSE signature). `scripts/screenshot.mjs` takes the screenshots above.

How to contribute (and what must not change): [CONTRIBUTING.md](CONTRIBUTING.md). The threat model and how to
report a vulnerability: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). It bundles [c2pa-web](https://github.com/contentauth/c2pa-js) (MIT, Adobe) and what it depends on;
the build writes their licenses to `dist/THIRD_PARTY_LICENSES.txt`.
