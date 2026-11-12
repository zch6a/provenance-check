// The extension's own pages, read as files: what keyboard and screen-reader users depend on.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const page = (/** @type {string} */ name) => readFileSync(join(ROOT, "static", name), "utf8");

test("the file picker can be reached with the keyboard", () => {
  // A `hidden` input inside a label is out of the tab order, and the label itself cannot take focus: the page had
  // no focusable element at all. The input is only visually hidden now, and the label shows the focus.
  const input = page("report.html").match(/<input[^>]*id="file"[^>]*>/)?.[0] ?? "";
  assert.ok(input, "the report page has the file input");
  assert.doesNotMatch(input, /\shidden(\s|>|=)/, "not removed from the tab order");
  assert.match(input, /class="visually-hidden"/);
  const css = page("style.css");
  assert.match(css, /\.visually-hidden\s*\{[^}]*clip:/);
  assert.match(css, /\.button:focus-within\s*\{[^}]*outline:/, "the label shows where the focus is");
  assert.match(css, /button:focus-visible/);
});

test("every page has a language, a title and a top heading; the report is announced when it changes", () => {
  for (const name of ["report.html", "popup.html"]) {
    const html = page(name);
    assert.match(html, /<html lang="en">/, name);
    assert.match(html, /<title>[^<]+<\/title>/, name);
    assert.match(html, /<h1>/, name);
  }
  assert.match(page("report.html"), /id="report" aria-live="polite"/);
});
