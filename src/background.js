// @ts-check
/** The right-click menu: "Check Content Credentials" on an image, video or audio opens the report in a new tab. */

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "check", title: "Check Content Credentials", contexts: ["image", "video", "audio"] });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "check" || !info.srcUrl) return;
  const url = new URL(chrome.runtime.getURL("report.html"));
  url.searchParams.set("src", info.srcUrl);
  chrome.tabs.create({ url: url.href, ...(tab?.index !== undefined ? { index: tab.index + 1 } : {}), ...(tab?.id !== undefined ? { openerTabId: tab.id } : {}) });
});
