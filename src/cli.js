#!/usr/bin/env node
// @ts-check
/**
 * provenance-check on the command line: what a file's Content Credentials say, read on this computer with the
 * same reader, settings and network guard as the extension. Local files only; nothing is fetched or uploaded.
 *
 *   provenance-check photo.jpg [more files]   the report in plain words
 *   provenance-check photo.jpg --json         the same reports as JSON (schema 1)
 *
 * Exit code: 0 every file was checked and none has credentials that fail to match it; 1 at least one does
 * ("invalid") and every file was checked; 2 a file could not be checked (missing, unreadable, empty, too large, not a
 * format the library reads) or the usage was wrong. 2 wins over 1: look at each result to see both.
 */
import { readFileSync, statSync } from "node:fs";
import { parseArgs } from "node:util";

import { explain } from "./explain.js";
import { sniffType } from "./file-type.js";
import { readCredentials } from "./node-reader.js";
import { reportText, safe } from "./text.js";

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const MAX_BYTES = 250 * 1024 * 1024;

const HELP = `provenance-check ${VERSION}: what a file's Content Credentials (C2PA) say, read on this computer.

Usage:
  provenance-check <file>...          the report in plain words
  provenance-check <file>... --json   as JSON

Who signed it, with what tool, whether AI was involved, what was edited, whether the file changed since it was
signed, and what that does not prove. Nothing is uploaded and nothing is fetched (not even credentials a file
only points to by URL). Signers are not checked against a trust list yet: they show as "not verified".

Exit code: 0 checked; 1 credentials that do not match a file; 2 a file could not be checked (this wins over 1).`;

/** @param {unknown} e */
const message = (e) => {
  const code = /** @type {NodeJS.ErrnoException} */ (e)?.code;
  if (code === "ENOENT") return "no such file";
  if (code === "EACCES" || code === "EPERM") return "not allowed to read it";
  if (code === "EBUSY") return "another program has it locked";
  return String(e instanceof Error ? e.message : e);
};

/**
 * @param {string} file
 * @returns {Promise<{file: string, type: string, report: import("./explain.js").Report} | {file: string, error: string}>}
 */
async function check(file) {
  let bytes;
  try {
    const st = statSync(file);
    if (!st.isFile()) return { file, error: "not a file" };
    if (st.size > MAX_BYTES) return { file, error: `larger than ${MAX_BYTES / 1024 / 1024} MB` };
    bytes = readFileSync(file);
  } catch (e) {
    return { file, error: message(e) };
  }
  // Again after reading: a file that grew in between is not read past the limit's purpose.
  if (bytes.length > MAX_BYTES) return { file, error: `larger than ${MAX_BYTES / 1024 / 1024} MB` };
  if (bytes.length < 4) return { file, error: bytes.length ? "too short to be a picture, video or sound file" : "empty file" };
  // From the bytes, else the name; with neither, the library decides from the bytes itself.
  const type = sniffType(bytes.subarray(0, 16), file);
  try {
    const read = await readCredentials(bytes, type);
    return { file, type: type || "unknown", report: explain(read.store, { remoteUrl: read.remoteUrl, damaged: read.damaged }) };
  } catch (e) {
    const flags = /** @type {{unsupported?: boolean, unreadable?: boolean}} */ (e);
    if (flags.unsupported) return { file, error: `not a format the C2PA library reads${type ? ` (${type})` : ""}` };
    if (flags.unreadable) return { file, error: `could not read it: the file is incomplete or not what it seems (${message(e)}); it carries no Content Credentials that could be read` };
    return { file, error: message(e) };
  }
}

/**
 * JSON with everything that could fool a terminal or a reader escaped: JSON itself escapes only U+0000 to U+001F,
 * so C1 controls (U+009B is a terminal's CSI) and the characters clean() hides are written as \u escapes. The JSON
 * value is unchanged.
 * @param {unknown} value
 */
function jsonText(value) {
  return JSON.stringify(value, null, 2).replace(/[\u007f-\u009f\u061c\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2060-\u2069\ufeff]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** @param {string[]} argv @returns {Promise<number>} */
export async function main(argv) {
  let args;
  try {
    args = parseArgs({ args: argv, allowPositionals: true, options: { json: { type: "boolean" }, help: { type: "boolean", short: "h" }, version: { type: "boolean", short: "v" } } });
  } catch (e) {
    process.stderr.write(`${safe(e instanceof Error ? e.message : String(e))}\n\n${HELP}\n`);
    return 2;
  }
  if (args.values.help) return process.stdout.write(`${HELP}\n`), 0;
  if (args.values.version) return process.stdout.write(`${VERSION}\n`), 0;
  if (!args.positionals.length) {
    process.stderr.write(`${HELP}\n`);
    return 2;
  }
  const results = [];
  for (const file of args.positionals) results.push(await check(file));
  if (args.values.json) {
    process.stdout.write(`${jsonText({ schema: 1, version: VERSION, results })}\n`);
  } else {
    // A file name comes from the user's shell, possibly from a glob over an untrusted archive: safe() too.
    const blocks = results.map((r) => ("error" in r ? `! ${safe(r.file)}: ${safe(r.error)}` : reportText(r.report, r.file)));
    process.stdout.write(`${blocks.join("\n\n")}\n`);
  }
  if (results.some((r) => "error" in r)) return 2;
  return results.some((r) => "report" in r && r.report.verdict === "invalid") ? 1 : 0;
}

process.exitCode = await main(process.argv.slice(2));
