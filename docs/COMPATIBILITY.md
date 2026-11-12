# What 1.x keeps stable

provenance-check follows semantic versioning from 1.0.0. Within 1.x, what is listed here keeps working as described,
so scripts, assistants and people can rely on it. Anything that changes it goes into 2.0, with a note in the
[changelog](../CHANGELOG.md).

## Stable

**The command line.** `provenance-check <file>...`, `--json`, `-h`/`--help`, `-v`/`--version`. Local files only;
nothing is fetched. New options may be added.

**Exit status.**

| | |
|---|---|
| 0 | every file was checked, and none has credentials that do not match it |
| 1 | every file was checked, and at least one has credentials that do not match it (`invalid`) |
| 2 | a file could not be checked (missing, unreadable, empty, too large, a format the library does not read, the reader failed), or the usage was wrong; 2 wins over 1 |

**`--json`.** One object: `{schema, version, results}`, `schema` is 1. One result per file, in the order given:
`{file, type, report}` when it was checked, `{file, error}` when not. Within schema 1, fields are not removed and do
not change meaning; new fields may appear, so read the ones you know and ignore the rest. C1 control characters and
invisible characters in strings are written as `\u` escapes (the values are unchanged).

The report: `verdict`, `headline`, `summary`, `facts` (each `{label, value}`), `ai` (`null`, or
`{level, words}`), `actions` (strings), `history` (each `{title, how, signer, hasCredentials, problems,
recorded}`), `problems` (strings), `notes` (strings), `technical` (`{state, codes}`).

**Verdicts.** `trusted` (intact, the signer on a trust list in use), `valid` (intact, the signer not verified),
`invalid` (something changed after signing, in the file, its credentials or the credentials of a file it was made
from; or the credentials are damaged), `remote` (the file points to credentials stored elsewhere, not fetched),
`none` (no Content Credentials). New verdicts are not added within 1.x.

**AI levels.** `generated` (the credentials state generative AI made it), `partly` (used on it, or it was made from
a file whose credentials say so), `not-stated`. Only IPTC's "trained algorithmic" source types count as generative
AI.

**Privacy.** Within 1.x, reading never makes a network request (remote manifests, revocation and identity issuers
are not contacted), the extension asks for no permission beyond the right-click menu and optional access to web
sites, and text from credentials is never parsed as HTML.

## Not stable

- **The words.** Headlines, summaries, fact labels, problems and notes are reworded between releases (and may be
  translated). Decide on `verdict`, `ai.level` and the presence of `problems`, never on the text.
- `technical.codes`: what the C2PA library reports, which changes with the library.
- The plain-text layout of the command line, and the report page's layout.
- Which formats can be read: the C2PA library's list, which grows.
- The limits (250 MB), and the extension's minimum Chrome version.
