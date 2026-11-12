// @ts-check
/**
 * No network for the C2PA reader. The library can reach out while it reads a file: remote manifests and OCSP
 * (turned off in settings.js), and the issuer of a CAWG identity statement, a did:web address chosen by whoever
 * made the file, which no setting turns off. Any of these would tell a server which image you are looking at. The
 * reader's worker installs this guard before the library loads: requests to anything but the extension's own
 * files (the WASM binary) and to blob:/data: addresses are refused.
 */

/**
 * @param {{fetch?: typeof fetch, location?: {href: string, origin: string}, XMLHttpRequest?: unknown, WebSocket?: unknown, EventSource?: unknown}} scope
 * @param {(url: string) => void} [onBlocked] told about each refused request (for tests)
 */
export function blockNetwork(scope, onBlocked = () => {}) {
  const real = scope.fetch?.bind(scope);
  // Scheme and host, not URL.origin: for chrome-extension: and moz-extension: addresses some URL implementations say
  // "null", which would match nothing (or everything).
  const key = (/** @type {URL} */ u) => `${u.protocol}//${u.host}`;
  let own = null;
  try { own = scope.location?.href ? key(new URL(scope.location.href)) : null; } catch { own = null; }
  const allowed = (/** @type {URL} */ u) => u.protocol === "blob:" || u.protocol === "data:" || (own !== null && u.host !== "" && key(u) === own);
  /** @param {RequestInfo | URL} input @param {RequestInit} [init] */
  scope.fetch = (input, init) => {
    let url;
    try {
      url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, scope.location?.href);
    } catch {
      return Promise.reject(new TypeError("provenance-check: not a URL"));
    }
    if (allowed(url) && real) return real(input, init);
    onBlocked(url.href);
    return Promise.reject(new TypeError(`provenance-check: the C2PA reader may not use the network (${url.origin})`));
  };
  const refuse = (/** @type {string} */ what) => function () { onBlocked(what); throw new TypeError(`provenance-check: no ${what} from the C2PA reader`); };
  for (const name of /** @type {const} */ (["XMLHttpRequest", "WebSocket", "EventSource"])) if (name in scope) scope[name] = refuse(name);
}
