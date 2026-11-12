// Screenshots of the report page for the README: headless Chrome over the DevTools protocol, waiting until the
// report is on the page. Needs the dev server (node scripts/serve.mjs) and Chrome; uses only test images.
// node scripts/screenshot.mjs <fixture> <out.png> [width] [height] [light|dark]
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [fixture = "edited.jpg", out = "docs/report.png", w = "1000", h = "900", scheme = "light"] = process.argv.slice(2);
const chrome = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(existsSync);
if (!chrome) throw new Error("Chrome not found");
const profile = mkdtempSync(join(tmpdir(), "pc-shot-"));
const port = 9333;
// No proxy and no name lookups except the local dev server: the page must not reach anything else.
const proc = spawn(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-proxy-server", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${w},${h}`, "about:blank"], { stdio: "ignore" });

try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((/** @type {{type: string}} */ t) => t.type === "page"); } catch { /* not up yet */ }
  }
  if (!target) throw new Error("Chrome did not start");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  /** @type {Map<number, (v: any) => void>} */
  const waiting = new Map();
  ws.addEventListener("message", (e) => { const m = JSON.parse(String(e.data)); waiting.get(m.id)?.(m.result); waiting.delete(m.id); });
  const send = (/** @type {string} */ method, /** @type {object} */ params = {}) => new Promise((r) => { waiting.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
  await send("Page.navigate", { url: `http://localhost:5180/dist/report.html?src=/test/fixtures/${fixture}` });
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const r = await send("Runtime.evaluate", { expression: "document.querySelector('.verdict') !== null", returnByValue: true });
    if (r?.result?.value) break;
  }
  await new Promise((r) => setTimeout(r, 300));
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(out, Buffer.from(shot.data, "base64"));
  ws.close();
  console.log(`wrote ${out}`);
} finally {
  proc.kill();
  await new Promise((r) => setTimeout(r, 500));
  rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
}
