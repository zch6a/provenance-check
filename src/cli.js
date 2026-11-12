#!/usr/bin/env node
// @ts-check
/**
 * provenance-check on the command line: what a file's Content Credentials say, read on this computer with the
 * same reader, settings and network guard as the extension. Local files only; nothing is fetched or uploaded.
 *
 *   provenance-check photo.jpg [more files]   the report in plain words
 *   provenance-check photo.jpg --json         the same reports as JSON (schema 1)
 *
 * Exit code: 0 every file was read and none has credentials that fail to match it; 1 at least one does ("invalid");
 * 2 a file could not be checked (missing, too large, a format the library does not read) or the usage was wrong.
 */
import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { parseArgs } from "node:util";

import { explain } from "./explain.js";
import { sniffType } from "./file-type.js";
import { readCredentials } from "./node-reader.js";
import { reportText } from "./text.js";

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const MAX_BYTES = 250 * 1024 * 1024;

const HELP = `provenance-check ${VERSION}: what a file's Content Credentials (C2PA) say, read on this computer.

Usage:
  provenance-check <file>...          the report in plain words
  provenance-check <file>... --json   as JSON

Who signed it, with what tool, whether AI was involved, what was edited, whether the file changed since it was
signed, and what that does not prove. Nothing is uploaded and nothing is fetched (not even credentials a file
only points to by URL). Signers are not checked against a trust list yet: they show as "not verified".

Exit code: 0 checked, 1 credentials that do not match the file, 2 a file could not be checked.`;

/** @param {string} file */
function head(file) {
  const fd = openSync(file, "r");
  try {
    const b = Buffer.alloc(16);
    return b.subarray(0, readSync(fd, b, 0, 16, 0));
  } finally {
    closeSync(fd);
  }
}

/**
 * @param {string} file
 * @returns {Promise<{file: string, type: string, report: import("./explain.js").Report} | {file: string, error: string}>}
 */
async function check(file) {
  let size;
  try {
    const st = statSync(file);
    if (!st.isFile()) return { file, error: "not a file" };
    size = st.size;
  } catch (e) {
    return { file, error: /** @type {NodeJS.ErrnoException} */ (e).code === "ENOENT" ? "no such file" : String(e) };
  }
  if (size > MAX_BYTES) return { file, error: `larger than ${MAX_BYTES / 1024 / 1024} MB` };
  const type = sniffType(head(file), file);
  if (!type) return { file, error: "not a format the C2PA library reads" };
  try {
    const read = await readCredentials(readFileSync(file), type);
    return { file, type, report: explain(read.store, { remoteUrl: read.remoteUrl, damaged: read.damaged }) };
  } catch (e) {
    if (/** @type {{unsupported?: boolean}} */ (e).unsupported) return { file, error: `not a format the C2PA library reads (${type})` };
    return { file, error: String(e instanceof Error ? e.message : e) };
  }
}

/** @param {string[]} argv @returns {Promise<number>} */
export async function main(argv) {
  let args;
  try {
    args = parseArgs({ args: argv, allowPositionals: true, options: { json: { type: "boolean" }, help: { type: "boolean", short: "h" }, version: { type: "boolean", short: "v" } } });
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : e}\n\n${HELP}\n`);
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
    process.stdout.write(`${JSON.stringify({ schema: 1, version: VERSION, results }, null, 2)}\n`);
  } else {
    const blocks = results.map((r) => ("error" in r ? `! ${r.file}: ${r.error}` : reportText(r.report, r.file)));
    process.stdout.write(`${blocks.join("\n\n")}\n`);
  }
  if (results.some((r) => "error" in r)) return 2;
  return results.some((r) => "report" in r && r.report.verdict === "invalid") ? 1 : 0;
}

process.exitCode = await main(process.argv.slice(2));
