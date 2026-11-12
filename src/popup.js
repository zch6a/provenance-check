// @ts-check
/** The toolbar popup: how to check an image, and a way to check a file from this computer. */

document.getElementById("open")?.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("report.html") });
  window.close();
});
