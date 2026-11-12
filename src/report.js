// @ts-check
/**
 * The report page: report.html?src=<image URL> (from the right-click menu), report.html?handoff=<id> (a data:
 * image, handed over by the background script instead of in the address), or report.html alone to check a file from
 * this computer. A URL's file is fetched once more, without cookies, from the site it came from; that copy is what is
 * checked and shown. Nothing is sent anywhere else.
 *
 * Every check runs through one guarded path: whatever fails (a download cut off, a folder dropped instead of a file,
 * the reader itself), the page ends on a message with a way to go on, never on "Checking…". A newer check cancels
 * the older one's download and is the only one that may write the page.
 */
import { readCredentials, resetReader } from "./c2pa.js";
import { explain } from "./explain.js";
import { hasC2paMarker, sniffType } from "./file-type.js";
import { clean, renderMessage, renderReport } from "./render.js";

const MAX_BYTES = 250 * 1024 * 1024;
const root = /** @type {HTMLElement} */ (document.getElementById("report"));
const picker = /** @type {HTMLElement} */ (document.getElementById("picker"));
const input = /** @type {HTMLInputElement} */ (document.getElementById("file"));
const TITLE = "provenance-check";

/** @param {number} n */
function mb(n) { return `${Math.round(n / 1024 / 1024)} MB`; }
/** An address to show: without a user name or password, and shortened. @param {URL | string} address */
function shown(address) {
  let text = String(address);
  try {
    const u = new URL(String(address));
    u.username = "";
    u.password = "";
    text = u.href;
  } catch { /* not a URL: as it is */ }
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

/** Each check gets a number; only the newest may write the page. */
let current = 0;
/** Cancels the download of the check before. */
let controller = /** @type {AbortController | null} */ (null);
/** The preview's object URL, freed when the next check starts. */
let previewUrl = /** @type {string | null} */ (null);

/** A new check: the one before is cancelled, its preview freed, the title reset. */
function begin() {
  controller?.abort();
  controller = new AbortController();
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  document.title = TITLE;
  return { run: ++current, signal: controller.signal };
}
/** @param {number} run */
const live = (run) => run === current;

/** A message in place of the report, if this check is still the newest. @param {number} run @param {string} title @param {string} text @param {Node[]} [extra] */
function show(run, title, text, extra = [againButton()]) {
  if (live(run)) renderMessage(root, title, text, extra);
}

/** Runs a check; anything it throws ends in a message. @param {number} run @param {() => Promise<void>} work */
async function guarded(run, work) {
  try {
    await work();
  } catch (e) {
    if (/** @type {{name?: string}} */ (e)?.name === "AbortError") return; // a newer check took over
    show(run, "Something went wrong", `provenance-check could not finish this check: ${clean(String(e instanceof Error ? e.message : e))}`);
  }
}

/** @param {File} file */
function checkFile(file) {
  const { run } = begin();
  picker.hidden = true;
  return guarded(run, async () => {
    if (file.size > MAX_BYTES) return show(run, "Too large", `${file.name} is ${mb(file.size)}; provenance-check reads files up to ${mb(MAX_BYTES)}.`);
    await check(run, file, file.name, file.type, null);
  });
}

/** @param {string} address */
function checkUrl(address) {
  const { run, signal } = begin();
  picker.hidden = true;
  return guarded(run, async () => {
    let url;
    try { url = new URL(address, location.href); } catch { return show(run, "Cannot read this address", shown(address)); }
    if (url.username || url.password) {
      // fetch() refuses such addresses, and the password must not be shown, nor stay in this tab's address (and
      // history): say so without it.
      try { history.replaceState(null, "", location.pathname); } catch { /* not in a page with history */ }
      return show(run, "This address contains a user name or password",
        `${shown(url)}: provenance-check does not send them. Save the image to your computer and check the file instead.`);
    }
    if (url.protocol === "blob:") {
      return show(run, "This image exists only inside the page",
        "Its address (blob:) cannot be opened from outside that page. Save the image to your computer and check the file instead.");
    }
    if (url.protocol === "file:") {
      return show(run, "This image is a file on this computer",
        "The browser does not let extensions read files by their address. Choose it with “Check a file from this computer”.");
    }
    if (url.protocol !== "data:" && !/^https?:$/.test(url.protocol)) {
      return show(run, "Cannot read this address", `${shown(url)}: provenance-check reads images from web addresses (https:, http:) and data: addresses.`);
    }
    if (url.protocol !== "data:" && !(await allowed(url))) {
      if (live(run)) askPermission(url);
      return;
    }
    if (!live(run)) return;
    renderMessage(root, "Reading the image…", shown(url));
    let response;
    try {
      // Without cookies: the site learns no more than that someone fetched the file. A site that only gives the file
      // to signed-in visitors answers 401/403, and the page says to save the file and check it instead.
      response = await fetch(url.href, { credentials: "omit", signal });
    } catch (e) {
      if (signal.aborted) return;
      // With permission for this site only, a redirect to another one (an image CDN) is refused by the browser.
      const extra = [againButton()];
      if (/^https?:$/.test(url.protocol) && !(await allowedEverywhere())) extra.push(allowAllButton(url));
      return show(run, "Could not fetch the image",
        `${shown(url)}: ${clean(String(e))}. If the site sends its images from another address (a redirect, an image server), allowing all sites helps; or save the image and check the file.`, extra);
    }
    if (response.status === 401 || response.status === 403) {
      return show(run, "The site gives this file only to signed-in visitors",
        "provenance-check fetches files without your cookies. Save the image to your computer and check the file instead.");
    }
    if (!response.ok) return show(run, "Could not fetch the image", `${shown(url)} answered ${response.status}.`);
    let blob;
    try {
      blob = await readLimited(response, signal);
    } catch (e) {
      if (signal.aborted) return;
      return show(run, "The download was cut off", `${shown(url)}: ${clean(String(e))}. Try again, or save the image and check the file.`);
    }
    if (!blob) return show(run, "Too large", `provenance-check reads files up to ${mb(MAX_BYTES)}.`);
    // The host the copy came from: where the site redirected the request, if it did.
    let from = url.protocol === "data:" ? null : url.host;
    try { if (response.url && from) from = new URL(response.url).host; } catch { /* keep the requested host */ }
    await check(run, blob, nameOf(url), response.headers.get("content-type") ?? blob.type, from);
  });
}

/** The body, counting bytes as they come (a size header can be missing or be the compressed size); null past the limit. @param {Response} response @param {AbortSignal} signal */
async function readLimited(response, signal) {
  if (!response.body) return response.blob();
  const reader = response.body.getReader();
  /** @type {Uint8Array[]} */
  const parts = [];
  let total = 0;
  for (;;) {
    if (signal.aborted) { await reader.cancel(); throw new DOMException("replaced by a newer check", "AbortError"); }
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

/** Whether a reader error is the C2PA library's verdict on the file (its errors read "C2pa(...)") rather than a failure of the reader. @param {string} text */
const aboutTheFile = (text) => /^C2pa\(/.test(text);

/** @param {number} run @param {Blob} blob @param {string} name @param {string} type @param {string | null} host where it was fetched from */
async function check(run, blob, name, type, host) {
  if (!live(run)) return;
  renderMessage(root, "Checking…", name);
  let head;
  try {
    head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  } catch {
    // A folder dropped instead of a file, or a file that changed or went away since it was chosen.
    return show(run, "Could not read this file", `${name}: a folder cannot be checked, and a file must still be where it was when it was chosen.`);
  }
  if (!live(run)) return;
  // The type as the browser or the server gave it, when it names a picture, video or sound; otherwise from the bytes.
  type = type.split(";")[0].trim().toLowerCase();
  if (!/^(image|video|audio)\//.test(type) && type !== "application/c2pa") type = sniffType(head, name) || type;
  let read;
  /** @type {string | null} */
  let damaged = null;
  try {
    read = await readCredentials(blob, type);
  } catch (e) {
    const text = String(e instanceof Error ? e.message : e);
    if (!live(run)) return;
    if (/UnsupportedType|unsupported/i.test(text)) {
      return show(run, "This kind of file cannot carry Content Credentials here", `${name} (${type || "unknown type"}) is not a format the C2PA library reads.`);
    }
    if (!aboutTheFile(text)) {
      // The reader failed (its worker stopped, it ran out of memory): that says nothing about the file. The next
      // check starts a new reader.
      resetReader();
      return show(run, "provenance-check could not read this file", `Its reader failed (${clean(text)}). This is a problem in provenance-check, not a finding about the file. Try again.`);
    }
    // Damaged credentials only if there are credentials: a truncated picture or a file with the wrong name says
    // nothing about Content Credentials.
    if (!(await carriesC2pa(blob))) {
      return show(run, "Could not read this file", `${name}: the file is incomplete or not what its type says (${clean(text)}). It carries no Content Credentials that could be read.`);
    }
    read = { store: null, remoteUrl: null };
    damaged = text;
  }
  if (!live(run)) return;
  // The library says "none" when it cannot find the credentials' container; if the bytes still carry one, they are damaged.
  if (!damaged && !read.store && !read.remoteUrl && (await carriesC2pa(blob))) damaged = "C2PA data is present but its container could not be found";
  if (!live(run)) return;
  previewUrl = /^image\//.test(type) ? URL.createObjectURL(blob) : null;
  const report = explain(read.store, { remoteUrl: read.remoteUrl, damaged, fetchedFrom: host });
  renderReport(root, report, { name, previewUrl });
  document.title = `${clean(report.headline)} · ${TITLE}`;
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

/** Web sites in general (not file:, which `<all_urls>` would add). */
const ALL_SITES = ["*://*/*"];

/** Host permission for the image's site: asked the first time, per site (or for all sites, if the user prefers). @param {URL} url */
async function allowed(url) {
  if (typeof chrome === "undefined" || !chrome.permissions) return true; // outside the extension (development)
  return chrome.permissions.contains({ origins: [`${url.origin}/*`] });
}
async function allowedEverywhere() {
  if (typeof chrome === "undefined" || !chrome.permissions) return true;
  return chrome.permissions.contains({ origins: ALL_SITES });
}

/** @param {URL} url */
function allowAllButton(url, className = "secondary") {
  return button("Allow all sites", async () => {
    if (await chrome.permissions.request({ origins: ALL_SITES })) checkUrl(url.href);
  }, className);
}

/** @param {URL} url */
function askPermission(url) {
  const one = button(`Allow ${url.hostname}`, async () => {
    if (await chrome.permissions.request({ origins: [`${url.origin}/*`] })) checkUrl(url.href);
  });
  renderMessage(root, `Fetch this image from ${url.hostname}?`,
    "To read the image's credentials, provenance-check downloads it once more, without your cookies, from the site it came from. Nothing is sent anywhere else. The browser asks you to allow this for the site the first time.",
    [one, allowAllButton(url)]);
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
  return button("Check a file from this computer", () => {
    root.replaceChildren();
    picker.hidden = false;
    input.value = ""; // choosing the same file again must still start a check
    input.click();
  }, "secondary");
}

/** What the right-click menu could not pass in the address (see background.js). */
async function fromHandoff(/** @type {string} */ id) {
  const { run } = begin();
  picker.hidden = true;
  await guarded(run, async () => {
    const src = typeof chrome !== "undefined" && chrome.runtime?.sendMessage ? await chrome.runtime.sendMessage({ take: id }) : null;
    if (!live(run)) return;
    if (typeof src !== "string") {
      return show(run, "The image could not be handed over",
        "The browser stopped holding it before this page opened. Right-click the image again, or save it and check the file.");
    }
    await checkUrl(src); // a check of its own, newer than this one
  });
}

// Start only now, with everything above defined (a check that begins without awaiting anything must find them).
input.addEventListener("change", () => { if (input.files?.[0]) checkFile(input.files[0]); });
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f) checkFile(f);
});
const params = new URLSearchParams(location.search);
const src = params.get("src");
const handoff = params.get("handoff");
if (params.get("problem") === "no-address") {
  renderMessage(root, "The browser did not pass this image's address",
    "That happens with very large images written into the page itself. Save the image to your computer and check the file instead.", [againButton()]);
} else if (handoff) fromHandoff(handoff);
else if (src) checkUrl(src);
else picker.hidden = false;
