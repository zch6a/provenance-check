// @ts-check
/**
 * The report as plain text, for the command line: the same sections as the extension's report page. Text from the
 * credentials goes through clean() here too (characters that reorder text become U+FFFD, long text is cut), and
 * control characters are dropped so that a title cannot move the cursor or recolour the terminal.
 */
import { clean } from "./render.js";

const BADGE = { trusted: "✓", valid: "✓", invalid: "✗", remote: "↗", none: "–" };

/** Text from a file or from credentials, safe to print in a terminal. @param {string} text */
export function safe(text) {
  // eslint-disable-next-line no-control-regex
  return clean(text).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "\uFFFD").replace(/\n/g, " ");
}

/**
 * @param {import("./explain.js").Report} report
 * @param {string} name the file, as the user gave it
 * @returns {string}
 */
export function reportText(report, name) {
  const out = [`${BADGE[report.verdict]} ${safe(report.headline)}`, `  ${safe(name)}`, `  ${safe(report.summary)}`];
  /** @param {string} title @param {string[]} lines */
  const part = (title, lines) => {
    if (lines.length) out.push("", `${title}:`, ...lines.map((l) => `  ${l}`));
  };
  const invalid = report.verdict === "invalid";
  if (report.ai) part(invalid ? "AI (as the credentials claim, not reliable for this file)" : "AI", [safe(report.ai.words)]);
  /** @type {Partial<Record<import("./explain.js").Verdict, string>>} */
  const titles = { invalid: "What the credentials claim (not reliable for this file)", remote: "Where they are" };
  part(titles[report.verdict] ?? "What the credentials say", report.facts.map((f) => `${safe(f.label)}: ${safe(f.value)}`));
  part("What was done", report.actions.map((a) => `- ${safe(a)}`));
  part("Made from", report.history.flatMap((h) => [
    `- ${safe(h.how)} ${safe(h.title)} · ${h.hasCredentials ? `signed by ${safe(h.signer ?? "an unnamed signer")}` : "no credentials of its own"}`,
    ...h.problems.map((p) => `    ✗ ${safe(p)}`),
    ...h.recorded.map((p) => `    recorded when it was used: ${safe(p)}`),
  ]));
  part("What is wrong", report.problems.map((p) => `✗ ${safe(p)}`));
  part("Keep in mind", report.notes.map((n) => `- ${safe(n)}`));
  return out.join("\n");
}
