// The Agent Skill (plugin/skills/provenance-check/SKILL.md) and the Claude Code plugin around it: the format, that
// every command it gives works on the test images, and that the fields and verdicts it explains are the real ones.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SKILL = readFileSync(join(ROOT, "plugin", "skills", "provenance-check", "SKILL.md"), "utf8").replace(/\r\n/g, "\n");
const PREFIX = "npx -y github:zch6a/provenance-check";

function frontmatter() {
  const m = SKILL.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m?.[1], "the frontmatter starts on the first line");
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([a-z-]+):\s*(.*)$/);
    if (kv?.[1]) out[kv[1]] = kv[2] ?? "";
  }
  return out;
}

test("the skill's frontmatter: portable fields only, within the limits", () => {
  const fm = frontmatter();
  assert.equal(fm.name, "provenance-check");
  const allowed = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);
  for (const k of Object.keys(fm)) assert.ok(allowed.has(k), `${k} is a field every skill host accepts`);
  const description = fm.description ?? "";
  assert.ok(description.length > 100 && description.length <= 1536);
  assert.doesNotMatch(description, /[<>]/);
  assert.ok((fm.compatibility ?? "").length <= 500);
});

test("the plugin and its marketplace agree, and follow the package version", () => {
  const market = JSON.parse(readFileSync(join(ROOT, ".claude-plugin", "marketplace.json"), "utf8"));
  const plugin = JSON.parse(readFileSync(join(ROOT, "plugin", ".claude-plugin", "plugin.json"), "utf8"));
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  assert.equal(market.plugins?.[0]?.name, plugin.name);
  assert.ok(existsSync(join(ROOT, market.plugins[0].source, ".claude-plugin", "plugin.json")));
  assert.equal(plugin.version, pkg.version);
  assert.equal(pkg.bin?.["provenance-check"], "src/cli.js", "npx github:zch6a/provenance-check runs the command line");
});

test("every command the skill gives works, with the fields and verdicts it explains", () => {
  const commands = [...SKILL.matchAll(/```bash\n([\s\S]*?)```/g)]
    .flatMap((m) => (m[1] ?? "").split("\n"))
    .filter((l) => l.startsWith(PREFIX))
    .map((l) => l.slice(PREFIX.length).trim().split(/\s+/));
  assert.deepEqual(commands, [["photo.jpg"], ["photo.jpg", "--json"]]);
  const run = (/** @type {string[]} */ args) => spawnSync(process.execPath, [join(ROOT, "src", "cli.js"), ...args], { encoding: "utf8" });
  const images = ["camera.jpg", "ai-generated.png", "tampered.jpg", "remote-credentials.jpg", "no-credentials.jpg"].map((f) => join(ROOT, "test", "fixtures", f));
  const text = run(commands[0]?.map((a) => (a === "photo.jpg" ? images[0] : a)) ?? []);
  assert.equal(text.status, 0, text.stderr);
  const json = run(["--json", ...images]);
  assert.equal(json.status, 1, "the tampered image: exit 1, as the skill says");
  const data = JSON.parse(json.stdout);
  for (const k of ["schema", "version", "results"]) assert.ok(k in data, k);
  const verdicts = data.results.map((/** @type {any} */ r) => r.report.verdict);
  assert.deepEqual(verdicts, ["valid", "valid", "invalid", "remote", "none"]);
  for (const v of verdicts) assert.match(SKILL, new RegExp(`^- \`${v}\`:`, "m"), `the skill explains ${v}`);
  for (const r of data.results) {
    for (const k of ["file", "type", "report"]) assert.ok(k in r, k);
    for (const k of ["verdict", "headline", "summary", "facts", "ai", "actions", "history", "problems", "notes"]) {
      assert.ok(k in r.report, k);
      assert.ok(SKILL.includes(`\`${k}\``), `the skill names the field ${k}`);
    }
  }
  const ai = data.results[1].report.ai;
  assert.equal(ai.level, "generated");
  for (const level of ["generated", "partly", "not-stated"]) assert.match(SKILL, new RegExp(`\`${level}\``), level);
});
