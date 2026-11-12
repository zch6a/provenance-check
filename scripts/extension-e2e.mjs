// The built extension, loaded into a real Chrome (headless, a fresh temporary profile), checked end to end:
// its report page under the extension's own CSP, the packaged worker and WASM, the file picker, a data: image,
// and the permission question for a site's image. Needs Chrome; run `npm run build` first.
// node scripts/extension-e2e.mjs   (exit code 0 when everything held)
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = process.env.DIST ?? join(root, "dist");
const fx = join(root, "test", "fixtures");
const chrome = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => p && existsSync(p));
if (!chrome) { console.log("skip: Chrome not found"); process.exit(0); }
if (!existsSync(join(dist, "manifest.json"))) throw new Error("run npm run build first");

const profile = mkdtempSync(join(tmpdir(), "pc-e2e-"));
// --remote-debugging-pipe: commands on fd 3, answers on fd 4, each JSON message ended by a NUL byte.
// No proxy, and every host name resolves to nothing: whatever this test does, it cannot reach the internet.
const proc = spawn(chrome, ["--headless=new", "--disable-gpu", "--remote-debugging-pipe", "--enable-unsafe-extension-debugging", `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "--no-proxy-server", "--host-resolver-rules=MAP * ~NOTFOUND", "about:blank"],
  { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
const toChrome = /** @type {import("node:stream").Writable} */ (proc.stdio[3]);
const fromChrome = /** @type {import("node:stream").Readable} */ (proc.stdio[4]);
let id = 0;
/** @type {string[]} what the pages threw or logged, shown when a check fails */
const pageLog = [];
/** @type {string[]} every request the watched workers started */
const workerRequests = [];
/** @type {Map<number, {resolve: (v: any) => void, reject: (e: Error) => void}>} */
const waiting = new Map();
let buffer = "";
fromChrome.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let end;
  while ((end = buffer.indexOf("\0")) >= 0) {
    const msg = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    if (msg.method === "Target.attachedToTarget" && msg.params.targetInfo?.type === "worker") {
      // The reader's worker: watch its requests (Network.enable on its own session).
      toChrome.write(JSON.stringify({ id: ++id, method: "Network.enable", params: {}, sessionId: msg.params.sessionId }) + "\0");
    }
    if (msg.method === "Network.requestWillBeSent") workerRequests.push(msg.params.request.url);
    if (msg.method === "Runtime.exceptionThrown") pageLog.push(`exception: ${msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text}`);
    if (msg.method === "Runtime.consoleAPICalled") pageLog.push(`console.${msg.params.type}: ${msg.params.args?.map((/** @type {any} */ a) => a.value ?? a.description).join(" ")}`);
    const w = waiting.get(msg.id);
    if (!w) continue;
    waiting.delete(msg.id);
    if (msg.error) w.reject(new Error(`${msg.error.message} ${msg.error.data ?? ""}`)); else w.resolve(msg.result);
  }
});
/** @param {string} method @param {object} [params] @param {string} [sessionId] @returns {Promise<any>} */
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  waiting.set(++id, { resolve, reject });
  toChrome.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0");
});
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/** @type {string[]} */
const failures = [];
let lastText = "";
const check = (/** @type {boolean} */ ok, /** @type {string} */ what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${ok ? "" : `\n     page said: ${lastText.slice(0, 400).replace(/\n/g, " | ")}\n     page log: ${pageLog.slice(-5).join(" || ").slice(0, 600)}`}`);
  if (!ok) failures.push(what);
};

try {
  const { id: ext } = await send("Extensions.loadUnpacked", { path: dist });
  check(/^[a-p]{32}$/.test(ext), `the extension loads (${ext})`);

  /** Opens a page and returns a session to evaluate in it. @param {string} url */
  async function open(url) {
    const { targetId } = await send("Target.createTarget", { url });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Runtime.enable", {}, sessionId);
    return { sessionId, targetId };
  }
  /** @param {string} sessionId @param {string} expression */
  const evaluate = async (sessionId, expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId)).result?.value;
  /** Waits until the page has loaded and has its file input (slow machines need longer than a fixed pause). @param {string} sessionId */
  async function ready(sessionId) {
    for (let i = 0; i < 150; i++) {
      if (await evaluate(sessionId, "document.readyState === 'complete' && document.getElementById('file') !== null").catch(() => false)) return;
      await sleep(100);
    }
    throw new Error("the page did not load");
  }
  /** Picks a file in the page's file input, as a person would. @param {string} sessionId @param {string} file */
  async function pick(sessionId, file) {
    await ready(sessionId);
    await send("DOM.enable", {}, sessionId);
    const { root } = await send("DOM.getDocument", {}, sessionId);
    const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector: "#file" }, sessionId);
    await send("DOM.setFileInputFiles", { nodeId, files: [file] }, sessionId);
  }
  /** Waits until the report (or a message) is on the page; returns its text. @param {string} sessionId */
  async function reportText(sessionId) {
    for (let i = 0; i < 100; i++) {
      const t = await evaluate(sessionId, "document.querySelector('.verdict') ? document.getElementById('report').innerText : (document.querySelector('.message h1')?.textContent ?? '')");
      if (t && !/^(Checking|Reading)/.test(t)) return (lastText = String(t));
      await sleep(200);
    }
    return (lastText = `(still waiting) ${await evaluate(sessionId, "document.getElementById('report').innerText")}`);
  }

  // 1. A file from this computer, through the picker: the whole reading path, no network.
  const page = await open(`chrome-extension://${ext}/report.html`);
  await pick(page.sessionId, join(fx, "edited.jpg"));
  let text = await reportText(page.sessionId);
  check(/Content Credentials intact/.test(text) && /edited from camera\.jpg/.test(text), "a local file is read in the extension (packaged worker and WASM under its CSP)");

  // 2. A data: image (no host permission needed): the tampered test image.
  const data = `data:image/jpeg;base64,${readFileSync(join(fx, "tampered.jpg")).toString("base64")}`;
  const p2 = await open(`chrome-extension://${ext}/report.html?src=${encodeURIComponent(data)}`);
  text = await reportText(p2.sessionId);
  check(/do not match this file/.test(text) && /The picture changed after it was signed/.test(text), "a data: image is read, and the tampering is reported");

  // 3. A site's image without permission: the page asks first, and fetches nothing.
  const p3 = await open(`chrome-extension://${ext}/report.html?src=${encodeURIComponent("https://images.example.invalid/photo.jpg")}`);
  text = await reportText(p3.sessionId);
  check(/Fetch this image from images\.example\.invalid\?/.test(text), "a site's image: permission is asked for first");

  // 4. An identity statement from a did:web issuer: the reader's worker must not try to resolve it. The worker is
  // attached as it starts, and every request it begins is recorded; the network guard refuses before any begins.
  const p5 = await open(`chrome-extension://${ext}/report.html`);
  await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, p5.sessionId);
  await pick(p5.sessionId, join(fx, "identity-did-web.jpg"));
  text = await reportText(p5.sessionId);
  const outside = workerRequests.filter((u) => !u.startsWith("chrome-extension:") && !u.startsWith("blob:") && !u.startsWith("data:"));
  check(/Content Credentials intact/.test(text) && /Identity statement/.test(text), "an identity statement from a did:web issuer: intact, said so");
  check(outside.length === 0, `the reader's worker started no request outside the extension (saw: ${outside.join(", ") || "none"})`);

  // 5. The popup and the background service worker.
  const p4 = await open(`chrome-extension://${ext}/popup.html`);
  let popup = false;
  for (let i = 0; i < 50 && !popup; i++) { popup = await evaluate(p4.sessionId, "document.getElementById('open') !== null"); if (!popup) await sleep(100); }
  check(popup, "the popup opens");
  const { targetInfos } = await send("Target.getTargets");
  check(targetInfos.some((/** @type {{type: string, url: string}} */ t) => t.type === "service_worker" && t.url.includes(ext)), "the background service worker runs");
} catch (e) {
  failures.push(String(e));
  console.log(`FAIL ${e}`);
} finally {
  proc.kill();
  await sleep(800);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
}
process.exit(failures.length ? 1 : 0);
