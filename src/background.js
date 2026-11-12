// @ts-check
/**
 * The right-click menu: "Check Content Credentials" on an image, video or audio opens the report in a new tab.
 *
 * A web image's address goes to the report page in its own address. A data: image does not: it can be megabytes
 * (more than an address may hold, and it would be written into the browser's history in full), so it is kept here
 * for a minute and the report page asks for it by a random id. Only the extension's own report page can ask: no
 * web page can reach this listener (the manifest lets none connect).
 */

/** data: images waiting for their report page, by id. @type {Map<string, string>} */
const pending = new Map();
const HOLD_MS = 60_000;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "check", title: "Check Content Credentials", contexts: ["image", "video", "audio"] });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "check") return;
  const url = new URL(chrome.runtime.getURL("report.html"));
  if (!info.srcUrl) {
    // The browser passes no address for some images (very large ones written into the page): say so, not nothing.
    url.searchParams.set("problem", "no-address");
  } else if (info.srcUrl.startsWith("data:")) {
    const id = crypto.randomUUID();
    pending.set(id, info.srcUrl);
    setTimeout(() => pending.delete(id), HOLD_MS);
    url.searchParams.set("handoff", id);
  } else {
    url.searchParams.set("src", info.srcUrl);
  }
  chrome.tabs.create({ url: url.href, ...(tab?.index !== undefined ? { index: tab.index + 1 } : {}), ...(tab?.id !== undefined ? { openerTabId: tab.id } : {}) })
    .catch(() => chrome.tabs.create({ url: url.href })); // the opener tab is gone, or in another window: open it anyway
});

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  // Only the extension's own report page.
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL("report.html"))) return;
  const id = /** @type {{take?: unknown}} */ (message)?.take;
  if (typeof id !== "string") return;
  reply(pending.get(id) ?? null);
  pending.delete(id);
});
