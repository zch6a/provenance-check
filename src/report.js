// @ts-check
/**
 * The report page: report.html?src=<image URL> (from the right-click menu), or report.html alone to check a file
 * from this computer. A URL's file is fetched once more, without cookies, from the site it came from; that copy is
 * what is checked and shown. Nothing is sent anywhere else.
 */
import { readCredentials } from "./c2pa.js";
import { explain } from "./explain.js";
import { hasC2paMarker, sniffType } from "./file-type.js";
import { clean, renderMessage, renderReport } from "./render.js";

const MAX_BYTES = 250 * 1024 * 1024;
const root = /** @type {HTMLElement} */ (document.getElementById("report"));
const picker = /** @type {HTMLElement} */ (document.getElementById("picker"));
const input = /** @type {HTMLInputElement} */ (document.getElementById("file"));

/** @param {number} n */
function mb(n) { return `${Math.round(n / 1024 / 1024)} MB`; }
/** @param {string} url */
function shorten(url) { return url.length > 120 ? `${url.slice(0, 117)}…` : url; }

/** Each check gets a number; only the newest may write the page (a file dropped while another is being read wins). */
let current = 0;
/** The preview's object URL, freed when the next report replaces it. */
let previewUrl = /** @type {string | null} */ (null);

/** @param {File} file */
async function checkFile(file) {
  const run = ++current;
  picker.hidden = true;
  if (file.size > MAX_BYTES) return renderMessage(root, "Too large", `${file.name} is ${mb(file.size)}; provenance-check reads files up to ${mb(MAX_BYTES)}.`);
  await check(run, file, file.name, file.type, null);
}

/** @param {string} address */
async function checkUrl(address) {
  const run = ++current;
  let url;
  try { url = new URL(address, location.href); } catch { return renderMessage(root, "Cannot read this address", shorten(address)); }
  if (url.protocol === "blob:") {
    return renderMessage(root, "This image exists only inside the page",
      "Its address (blob:) cannot be opened from outside that page. Save the image to your computer and check the file instead.", [againButton()]);
  }
  if (/^https?:$/.test(url.protocol) && !(await allowed(url))) return askPermission(url);
  if (run !== current) return;
  renderMessage(root, "Reading the image…", shorten(url.href));
  let response;
  try {
    // Without cookies: the site learns no more than that someone fetched the file. A site that only gives the file
    // to signed-in visitors answers 401/403, and the page says to save the file and check it instead.
    response = await fetch(url.href, { credentials: "omit" });
  } catch (e) {
    return run === current && renderMessage(root, "Could not fetch the image", `${shorten(url.href)}: ${String(e)}`, [againButton()]);
  }
  if (response.status === 401 || response.status === 403) {
    return run === current && renderMessage(root, "The site gives this file only to signed-in visitors",
      "provenance-check fetches files without your cookies. Save the image to your computer and check the file instead.", [againButton()]);
  }
  if (!response.ok) return run === current && renderMessage(root, "Could not fetch the image", `${shorten(url.href)} answered ${response.status}.`, [againButton()]);
  const blob = await readLimited(response);
  if (run !== current) return;
  if (!blob) return renderMessage(root, "Too large", `provenance-check reads files up to ${mb(MAX_BYTES)}.`);
  // The host the copy came from: where the site redirected the request, if it did.
  let from = url.host;
  try { if (response.url) from = new URL(response.url).host; } catch { /* keep the requested host */ }
  await check(run, blob, nameOf(url), (response.headers.get("content-type") ?? blob.type).split(";")[0], from);
}

/** The body, counting bytes as they come (a size header can be missing or be the compressed size); null past the limit. @param {Response} response */
async function readLimited(response) {
  if (!response.body) return response.blob();
  const reader = response.body.getReader();
  /** @type {Uint8Array[]} */
  const parts = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) { await reader.cancel(); return null; }
    parts.push(value);
  }
  return new Blob(/** @type {BlobPart[]} */ (parts), { type: response.headers.get("content-type") ?? "" });
}

/** A file name for the report: the last part of the path, decoded when it can be. @param {URL} url */
function nameOf(url) {
  if (url.protocol === "data:") return "the image (from a data: address)";
  const raw = url.pathname.split("/").pop() || url.hostname;
  try { return decodeURIComponent(raw); } catch { return raw; } // not UTF-8 (an old Latin-1 name): as it is
}

/** @param {number} run @param {Blob} blob @param {string} name @param {string} type @param {string | null} host where it was fetched from */
async function check(run, blob, name, type, host) {
  renderMessage(root, "Checking…", name);
  // A file the browser has no type for (a .heic on Windows, a server that says application/octet-stream): from its bytes.
  if (!type || type === "application/octet-stream") type = sniffType(new Uint8Array(await blob.slice(0, 16).arrayBuffer()), name) || type;
  if (run !== current) return;
  let read;
  /** @type {string | null} */
  let damaged = null;
  try {
    read = await readCredentials(blob, type);
  } catch (e) {
    const text = String(e instanceof Error ? e.message : e);
    if (run !== current) return;
    if (/UnsupportedType|unsupported/i.test(text)) {
      return renderMessage(root, "This kind of file cannot carry Content Credentials here", `${name} (${type || "unknown type"}) is not a format the C2PA library reads.`, [againButton()]);
    }
    // Damaged credentials only if there are credentials: a truncated picture or a file with the wrong name says
    // nothing about Content Credentials.
    if (!(await carriesC2pa(blob))) {
      return run === current && renderMessage(root, "Could not read this file", `${name}: the file is incomplete or not what its type says (${clean(text)}). It carries no Content Credentials that could be read.`, [againButton()]);
    }
    if (run !== current) return;
    read = { store: null, remoteUrl: null };
    damaged = text;
  }
  if (run !== current) return;
  // The library says "none" when it cannot find the credentials' container; if the bytes still carry one, they are damaged.
  if (!damaged && !read.store && !read.remoteUrl && (await carriesC2pa(blob))) damaged = "C2PA data is present but its container could not be found";
  if (run !== current) return;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = /^image\//.test(type) ? URL.createObjectURL(blob) : null;
  const report = explain(read.store, { remoteUrl: read.remoteUrl, damaged, fetchedFrom: host });
  renderReport(root, report, { name, previewUrl });
  document.title = `${clean(report.headline)} · provenance-check`;
}

/**
 * Whether the bytes hold a C2PA container ("jumd" description box labelled "c2pa"), even if the library could not
 * read it. The start and the end of big files are enough: that is where formats put it.
 * @param {Blob} blob
 */
async function carriesC2pa(blob) {
  const LIMIT = 32 * 1024 * 1024;
  const parts = blob.size <= 2 * LIMIT ? [blob] : [blob.slice(0, LIMIT), blob.slice(blob.size - LIMIT)];
  for (const part of parts) if (hasC2paMarker(new Uint8Array(await part.arrayBuffer()))) return true;
  return false;
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
    "To read the image's credentials, provenance-check downloads it once more, without your cookies, from the site it came from. Nothing is sent anywhere else. The browser asks you to allow this for the site the first time.",
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

// Start only now, with everything above defined (a check that begins without awaiting anything must find them).
input.addEventListener("change", () => { if (input.files?.[0]) checkFile(input.files[0]); });
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f) checkFile(f);
});
const src = new URLSearchParams(location.search).get("src");
if (src) checkUrl(src);
else picker.hidden = false;
