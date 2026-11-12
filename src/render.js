// @ts-check
/**
 * The report as a page. Everything in Content Credentials was written by whoever made the file, and this page
 * runs with the extension's privileges: text from them is only ever set with textContent, never parsed as HTML.
 */

/**
 * Characters that change how text reads without being seen: those that reorder it (right-to-left overrides and
 * isolates, which can make "holiday\u202Egpj.exe" read as "holidayexe.jpg"), invisible ones that make look-alikes
 * ("pay\u200Bpal"), line and paragraph separators, and Unicode tag characters (hidden text). Joiners (U+200C, U+200D)
 * stay: scripts and emoji need them.
 */
const HIDDEN = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C\u200B\u2060-\u2064\uFEFF\u2028\u2029\u{E0000}-\u{E007F}]/gu;
const MAX = 400;

/**
 * Text from credentials, made safe to read: the characters above are shown as "\uFFFD", and very long text is cut
 * (on whole characters, so an emoji at the cut does not leave half of itself).
 * @param {string} text
 */
export function clean(text) {
  const chars = [...String(text).replace(HIDDEN, "\uFFFD")];
  return chars.length > MAX ? `${chars.slice(0, MAX).join("")}… (${chars.length - MAX} more characters)` : chars.join("");
}

/** @param {string} tag @param {string} [className] @param {string} [text] */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = clean(text);
  return node;
}

const BADGE = { trusted: "✓", valid: "✓", invalid: "✗", remote: "↗", none: "–" };

/**
 * @param {HTMLElement} root
 * @param {import("./explain.js").Report} report
 * @param {{name: string, previewUrl?: string | null}} file
 */
export function renderReport(root, report, file) {
  root.replaceChildren();
  const head = el("section", `verdict verdict-${report.verdict}`);
  head.append(el("span", "badge", BADGE[report.verdict]), el("h1", "", report.headline));
  head.append(el("p", "summary", report.summary));
  root.append(head);

  const body = el("div", "body");
  if (file.previewUrl) {
    const img = /** @type {HTMLImageElement} */ (el("img", "preview"));
    img.src = file.previewUrl;
    img.alt = "";
    body.append(img);
  }
  const details = el("div", "details");
  details.append(el("p", "file", file.name));

  if (report.ai) details.append(section(report.verdict === "invalid" ? "AI (as the credentials claim, not reliable for this file)" : "AI", [el("p", `ai ai-${report.ai.level}`, report.ai.words)]));
  if (report.facts.length) {
    const dl = el("dl", "facts");
    for (const f of report.facts) dl.append(el("dt", "", f.label), el("dd", "", f.value));
    /** @type {Partial<Record<import("./explain.js").Verdict, string>>} */
    const titles = { invalid: "What the credentials claim (not reliable for this file)", remote: "Where they are" };
    const title = titles[report.verdict] ?? "What the credentials say";
    details.append(section(title, [dl]));
  }
  if (report.actions.length) details.append(section("What was done", [list(report.actions)]));
  if (report.history.length) {
    const items = report.history.map((h) => {
      const li = el("li", "", `${h.how} ${h.title}`);
      li.append(el("span", "muted", h.hasCredentials ? ` · signed by ${h.signer ?? "an unnamed signer"}` : " · no credentials of its own"));
      for (const p of h.problems) li.append(el("div", "problem", p));
      for (const p of h.recorded) li.append(el("div", "muted", `recorded when it was used: ${p}`));
      return li;
    });
    const ul = el("ul");
    ul.append(...items);
    details.append(section("Made from", [ul]));
  }
  if (report.problems.length) details.append(section("What is wrong", [list(report.problems, "problem")]));
  details.append(section("Keep in mind", [list(report.notes, "note")]));

  if (report.technical.codes.length) {
    const more = /** @type {HTMLDetailsElement} */ (el("details", "technical"));
    more.append(el("summary", "", `Technical details (${report.technical.state})`));
    more.append(list(report.technical.codes.map((c) => `${c.code}${c.explanation ? `: ${c.explanation}` : ""}`)));
    details.append(more);
  }
  body.append(details);
  root.append(body);
}

/** @param {string} title @param {Node[]} children */
function section(title, children) {
  const s = el("section", "part");
  s.append(el("h2", "", title), ...children);
  return s;
}

/** @param {string[]} items @param {string} [className] */
function list(items, className) {
  const ul = el("ul", className);
  for (const t of items) ul.append(el("li", "", t));
  return ul;
}

/** A message in place of the report (loading, an error, a question). @param {HTMLElement} root @param {string} title @param {string} text @param {Node[]} [extra] */
export function renderMessage(root, title, text, extra = []) {
  root.replaceChildren();
  const s = el("section", "message");
  s.append(el("h1", "", title), el("p", "", text), ...extra);
  root.append(s);
}
