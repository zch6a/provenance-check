// @ts-check
/**
 * The report page: report.html?src=<image URL> (from the right-click menu), or report.html alone to check a file
 * from this computer. The image is fetched once more from where the page got it (from the browser's cache when it
 * can be), read here, and never sent anywhere else.
 */
import { readCredentials } from "./c2pa.js";
import { explain } from "./explain.js";
import { renderMessage, renderReport } from "./render.js";

const MAX_BYTES = 250 * 1024 * 1024;
const root = /** @type {HTMLElement} */ (document.getElementById("report"));
const picker = /** @type {HTMLElement} */ (document.getElementById("picker"));
const input = /** @type {HTMLInputElement} */ (document.getElementById("file"));
const params = new URLSearchParams(location.search);
const src = params.get("src");

input.addEventListener("change", () => { if (input.files?.[0]) checkFile(input.files[0]); });
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f) checkFile(f);
});

if (src) checkUrl(src);
else picker.hidden = false;

/** @param {File} file */
async function checkFile(file) {
  picker.hidden = true;
  if (file.size > MAX_BYTES) return renderMessage(root, "Too large", `${file.name} is ${mb(file.size)}; provenance-check reads files up to ${mb(MAX_BYTES)}.`);
  await check(file, file.name, file.type);
}

/** @param {string} url */
async function checkUrl(url) {
  let parsed;
  try { parsed = new URL(url, location.href); } catch { return renderMessage(root, "Cannot read this address", url); }
  url = parsed.href;
  if (parsed.protocol === "blob:") {
    return renderMessage(root, "This image exists only inside the page",
      "Its address (blob:) cannot be opened from outside that page. Save the image to your computer and check the file instead.", [againButton()]);
  }
  if (/^https?:$/.test(parsed.protocol) && !(await allowed(parsed))) return askPermission(parsed);
  renderMessage(root, "Reading the image…", shorten(url));
  let response;
  try {
    response = await fetch(url, { cache: "force-cache", credentials: "include" });
  } catch (e) {
    return renderMessage(root, "Could not fetch the image", `${shorten(url)}: ${String(e)}`, [againButton()]);
  }
  if (!response.ok) return renderMessage(root, "Could not fetch the image", `${shorten(url)} answered ${response.status}.`, [againButton()]);
  const size = Number(response.headers.get("content-length") ?? 0);
  if (size > MAX_BYTES) return renderMessage(root, "Too large", `This file is ${mb(size)}; provenance-check reads files up to ${mb(MAX_BYTES)}.`);
  const blob = await response.blob();
  const name = decodeURIComponent(parsed.pathname.split("/").pop() || parsed.hostname);
  await check(blob, name, (response.headers.get("content-type") ?? blob.type).split(";")[0]);
}

/** @param {Blob} blob @param {string} name @param {string} type */
async function check(blob, name, type) {
  renderMessage(root, "Checking…", name);
  let read;
  try {
    read = await readCredentials(blob, type);
  } catch (e) {
    const text = String(e instanceof Error ? e.message : e);
    const unsupported = /UnsupportedType|unsupported/i.test(text);
    return renderMessage(root, unsupported ? "This kind of file cannot carry Content Credentials here" : "The credentials could not be read",
      unsupported ? `${name} (${type || "unknown type"}) is not a format the C2PA library reads.` : `${name}: ${text}`, [againButton()]);
  }
  const preview = /^image\//.test(type) ? URL.createObjectURL(blob) : null;
  const report = explain(read.store, { remoteUrl: read.remoteUrl });
  renderReport(root, report, { name, previewUrl: preview });
  document.title = `${report.headline} · provenance-check`;
}

/** Host permission for the image's site: asked the first time, per site (or for all sites, if the user prefers). @param {URL} url */
async function allowed(url) {
  if (typeof chrome === "undefined" || !chrome.permissions) return true; // outside the extension (development)
  return chrome.permissions.contains({ origins: [`${url.origin}/*`] });
}

/** @param {URL} url */
function askPermission(url) {
  const one = button(`Allow ${url.hostname}`, async () => {
    if (await chrome.permissions.request({ origins: [`${url.origin}/*`] })) checkUrl(url.href);
  });
  const all = button("Allow all sites", async () => {
    if (await chrome.permissions.request({ origins: ["<all_urls>"] })) checkUrl(url.href);
  }, "secondary");
  renderMessage(root, `Fetch this image from ${url.hostname}?`,
    "To read the image's credentials, provenance-check fetches it once more from the site it came from (usually from your browser's cache). Nothing is sent anywhere else. The browser asks you to allow this for the site the first time.",
    [one, all]);
}

/** @param {string} label @param {() => void} onClick @param {string} [className] */
function button(label, onClick, className = "") {
  const b = document.createElement("button");
  b.textContent = label;
  if (className) b.className = className;
  b.addEventListener("click", onClick);
  return b;
}

function againButton() {
  return button("Check a file from this computer", () => { root.replaceChildren(); picker.hidden = false; input.click(); }, "secondary");
}

/** @param {number} n */
const mb = (n) => `${Math.round(n / 1024 / 1024)} MB`;
/** @param {string} url */
const shorten = (url) => (url.length > 120 ? `${url.slice(0, 117)}…` : url);
