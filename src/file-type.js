// @ts-check
/**
 * What kind of file the bytes are (the C2PA library needs the format to read it), and whether they hold a C2PA
 * container at all. Pure functions on bytes: the same in the extension's report page and on the command line.
 */

/** @param {Uint8Array} b @param {number} at @param {string} text */
function is(b, at, text) {
  if (b.length < at + text.length) return false;
  for (let i = 0; i < text.length; i++) if (b[at + i] !== text.charCodeAt(i)) return false;
  return true;
}

/** File name extensions, for formats the bytes alone do not settle. */
const BY_EXTENSION = /** @type {Record<string, string>} */ ({
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", tif: "image/tiff",
  tiff: "image/tiff", dng: "image/x-adobe-dng", avif: "image/avif", heic: "image/heic", heif: "image/heif",
  svg: "image/svg+xml", mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", m4a: "audio/mp4",
  mp3: "audio/mpeg", wav: "audio/wav", avi: "video/x-msvideo", pdf: "application/pdf", c2pa: "application/c2pa",
});

/**
 * The MIME type of a file from its first bytes, else from its name; "" when neither says (the library then decides
 * from the bytes itself: it reads the format from them, the type is a hint).
 * @param {Uint8Array} head the first bytes (16 are enough)
 * @param {string} [name]
 */
export function sniffType(head, name = "") {
  const b = head;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && is(b, 1, "PNG")) return "image/png";
  if (is(b, 0, "GIF8")) return "image/gif";
  if (is(b, 0, "RIFF") && is(b, 8, "WEBP")) return "image/webp";
  if (is(b, 0, "RIFF") && is(b, 8, "WAVE")) return "audio/wav";
  if (is(b, 0, "RIFF") && is(b, 8, "AVI ")) return "video/x-msvideo";
  if (is(b, 0, "%PDF")) return "application/pdf";
  if (is(b, 0, "ID3") || (b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0)) return "audio/mpeg"; // an MPEG frame sync (JPEG's FF D8 is not one)
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  if ((is(b, 0, "II*\0") || is(b, 0, "MM\0*"))) return ext === "dng" ? "image/x-adobe-dng" : "image/tiff";
  if (is(b, 4, "ftyp")) {
    const brand = String.fromCharCode(...b.subarray(8, 12));
    if (/^avi[fs]$/.test(brand)) return "image/avif";
    if (/^(heic|heix|heim|heis|mif1|msf1)$/.test(brand)) return "image/heic";
    if (brand === "qt  ") return "video/quicktime";
    if (/^M4A/.test(brand)) return "audio/mp4";
    return "video/mp4";
  }
  return BY_EXTENSION[ext] ?? "";
}

/**
 * Whether the bytes hold a C2PA container: a JUMBF description box ("jumd") labelled "c2pa", even one the library
 * could not read (then the credentials are damaged, not absent).
 * @param {Uint8Array} bytes
 */
export function hasC2paMarker(bytes) {
  for (let i = 0; i + 8 < bytes.length; i++) {
    if (bytes[i] === 0x6a && bytes[i + 1] === 0x75 && bytes[i + 2] === 0x6d && bytes[i + 3] === 0x64) { // "jumd"
      for (let j = i + 4; j < Math.min(i + 48, bytes.length - 4); j++) {
        if (bytes[j] === 0x63 && bytes[j + 1] === 0x32 && bytes[j + 2] === 0x70 && bytes[j + 3] === 0x61) return true; // "c2pa"
      }
    }
  }
  return false;
}
