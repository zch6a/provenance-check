// @ts-check
// Text from credentials is shown safely: no reordering tricks, no endless lines. (That it is never parsed as HTML is
// checked by build.test.js and in the browser.)
import assert from "node:assert/strict";
import { test } from "node:test";

import { clean } from "../src/render.js";

test("characters that reorder text are made visible, so a name cannot pretend to be another", () => {
  assert.equal(clean("holiday‮gpj.exe"), "holiday�gpj.exe");
  assert.equal(clean("Adobe⁧ Photoshop⁩"), "Adobe� Photoshop�");
  assert.equal(clean("normal text, ünïcödé, 中文"), "normal text, ünïcödé, 中文");
});

test("very long text is cut, with how much was left out", () => {
  const out = clean("x".repeat(5000));
  assert.equal(out, `${"x".repeat(400)}… (4600 more characters)`);
});
