# Security

provenance-check reads files made by strangers, inside a browser extension that can be allowed to fetch images
from sites. Both are part of its threat model.

## What it does

- **Reads locally.** The C2PA reference library (c2pa-rs, as WebAssembly) ships inside the extension and the
  package; nothing is uploaded.
- **No network for the reader.** A guard installed before the library loads refuses every request except the
  extension's own files and `blob:`/`data:` addresses, in the extension's worker and on the command line. This
  matters because some credentials make the library contact an address the file's maker chose (the issuer of a CAWG
  identity statement); remote manifests and certificate revocation (OCSP) are turned off in the settings as well.
- **One fetch, without cookies.** For an image on a web page, the extension downloads it once more from its own
  site (following that site's redirects; the report names the host the copy came from), without the user's
  cookies, and only after the user allowed that site (an optional host permission, asked for when needed). No script
  runs inside web pages.
- **Hostile text stays text.** Text from credentials is set with `textContent`, never parsed as HTML; characters
  that reorder text (right-to-left overrides and isolates) are shown as U+FFFD; long text is cut. On the command
  line, control characters (terminal escape sequences, bells) are replaced as well, in file names too, and `--json`
  writes C1 controls and invisible characters as `\u` escapes.
- **Bounded input.** Files up to 250 MB: refused by their size before they are read, and checked again after
  (a download is counted as it arrives).

## What it does not protect against

- **Signers it cannot verify.** Without a trust list every signer shows as "not verified": anyone can make a
  certificate with any name. The report says so; it does not make a name true.
- **Bugs in the C2PA library.** A file crafted to exploit c2pa-rs runs inside the WebAssembly sandbox of an
  extension page (or of the Node process on the command line). Keep the extension updated.
- **What the site sends.** The checked copy is the one the site sent to provenance-check, which a site can choose
  to differ from what it showed; the report says which copy it checked.

## Reporting a vulnerability

Please open a private security advisory on GitHub (Security → Report a vulnerability) rather than a public issue.
Include the file that shows the problem if you can (a synthetic one is best) and what the report said.
