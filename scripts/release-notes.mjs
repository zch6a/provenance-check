// The release notes for a version: its section of CHANGELOG.md, printed for `gh release create --notes-file`.
//   node scripts/release-notes.mjs 0.4.0
import { readFileSync } from "node:fs";

export function notes(/** @type {string} */ changelog, /** @type {string} */ version) {
  const lines = changelog.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((l) => l.startsWith(`## ${version} `) || l === `## ${version}`);
  if (start < 0) throw new Error(`CHANGELOG.md has no section for ${version}`);
  const end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
}

if (process.argv[2]) {
  process.stdout.write(`${notes(readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8"), process.argv[2].replace(/^v/, ""))}\n`);
}
