// @ts-check
/**
 * What an image's Content Credentials say, in plain words: a pure function from the manifest store the reference
 * library (c2pa-rs) returns to a report. No DOM, no network: the same in the extension and in the tests.
 *
 * The verdict follows the library's validation state:
 * - "trusted": intact, and the signer's certificate chains to a trust anchor in use;
 * - "valid": intact (nothing changed since signing), but the signer is not on a trust list in use;
 * - "invalid": something changed after signing, or the signature itself is wrong;
 * - "remote": the file only points to credentials stored elsewhere, which are not fetched;
 * - "none": no Content Credentials at all, which says nothing about the image.
 * Everything the credentials say is what the signer states; the report says so.
 */

/**
 * @typedef {{code: string, url?: string, explanation?: string}} Status
 * @typedef {{label: string, data?: any}} Assertion
 * @typedef {{title?: string, format?: string, relationship?: string, active_manifest?: string,
 *   validation_results?: {activeManifest?: {failure?: Status[]}}, validation_status?: Status[]}} Ingredient
 * @typedef {{claim_generator?: string, claim_generator_info?: {name?: string, version?: string}[], title?: string, format?: string,
 *   assertions?: Assertion[], ingredients?: Ingredient[], signature_info?: {common_name?: string, issuer?: string, time?: string, alg?: string},
 *   label?: string}} Manifest
 * @typedef {{active_manifest?: string, manifests?: Record<string, Manifest>, validation_status?: Status[], validation_state?: string,
 *   validation_results?: {activeManifest?: {success?: Status[], informational?: Status[], failure?: Status[]}}}} ManifestStore
 * @typedef {"trusted" | "valid" | "invalid" | "remote" | "none"} Verdict
 * @typedef {{level: "generated" | "partly" | "not-stated", words: string}} AiStatement
 * @typedef {{title: string, how: string, signer: string | null, hasCredentials: boolean, problems: string[]}} HistoryItem
 * @typedef {{verdict: Verdict, headline: string, summary: string, facts: {label: string, value: string}[], ai: AiStatement | null,
 *   actions: string[], history: HistoryItem[], problems: string[], notes: string[], technical: {state: string, codes: Status[]}}} Report
 */

const IPTC = "http://cv.iptc.org/newscodes/digitalsourcetype/";

/** Where the content came from, by IPTC digital source type, and whether that means AI made it. */
const SOURCES = /** @type {Record<string, {words: string, ai?: "generated" | "partly"}>} */ ({
  trainedAlgorithmicMedia: { words: "generative AI", ai: "generated" },
  algorithmicMedia: { words: "an algorithm (not trained on examples)", ai: "generated" },
  compositeWithTrainedAlgorithmicMedia: { words: "a composite that includes generative-AI elements", ai: "partly" },
  compositeSynthetic: { words: "a composite that includes synthetic elements", ai: "partly" },
  digitalCapture: { words: "a camera (digital capture)" },
  computationalCapture: { words: "a camera, with computational processing" },
  negativeFilm: { words: "a scanned film negative" },
  positiveFilm: { words: "a scanned slide" },
  print: { words: "a scanned print" },
  screenCapture: { words: "a screenshot or screen recording" },
  digitalArt: { words: "digital art made by a person" },
  composite: { words: "a composite of other material" },
  minorHumanEdits: { words: "material with minor edits by a person" },
  humanEdits: { words: "material edited by a person" },
  dataDrivenMedia: { words: "data turned into an image (a chart, a map)" },
  virtualRecording: { words: "a recording of a virtual scene" },
});

/** C2PA actions in words. */
const ACTIONS = /** @type {Record<string, string>} */ ({
  "c2pa.created": "created",
  "c2pa.opened": "opened an existing file",
  "c2pa.placed": "placed another file into it",
  "c2pa.edited": "edited",
  "c2pa.edited.metadata": "edited its metadata",
  "c2pa.color_adjustments": "adjusted colours",
  "c2pa.cropped": "cropped",
  "c2pa.resized": "resized",
  "c2pa.orientation": "rotated or flipped",
  "c2pa.filtered": "applied a filter",
  "c2pa.drawing": "drew on it",
  "c2pa.removed": "removed something",
  "c2pa.converted": "converted it to another format",
  "c2pa.transcoded": "re-encoded it",
  "c2pa.repackaged": "repackaged it",
  "c2pa.published": "published it",
  "c2pa.watermarked": "added a watermark",
  "c2pa.redacted": "redacted part of the credentials",
  "c2pa.unknown": "made changes it did not describe",
});

/** Validation codes that are about trust, not about the file having changed. */
const TRUST_ONLY = new Set(["signingCredential.untrusted", "timeStamp.untrusted", "signingCredential.ocsp.skipped", "signingCredential.ocsp.inaccessible"]);

/** Failure codes in words: what they mean for the person looking at the file. */
const PROBLEMS = /** @type {Record<string, string>} */ ({
  "assertion.dataHash.mismatch": "The picture changed after it was signed.",
  "assertion.bmffHash.mismatch": "The video or audio changed after it was signed.",
  "assertion.boxesHash.mismatch": "The file's content changed after it was signed.",
  "assertion.collectionHash.mismatch": "Part of the file changed after it was signed.",
  "assertion.hashedURI.mismatch": "Part of the credentials was changed after signing.",
  "assertion.hashedURI.missing": "Part of the credentials is missing.",
  "assertion.missing": "Part of the credentials is missing.",
  "assertion.cbor.invalid": "Part of the credentials is damaged.",
  "assertion.json.invalid": "Part of the credentials is damaged.",
  "assertion.action.ingredientMismatch": "The edit history does not match the files it names.",
  "claimSignature.mismatch": "The signature does not match the credentials: they were altered after signing.",
  "claimSignature.missing": "The credentials are not signed.",
  "claimSignature.outsideValidity": "It was signed outside the period the signer's certificate was valid.",
  "claim.missing": "The credentials are incomplete.",
  "claim.malformed": "The credentials are damaged.",
  "manifest.missing": "The credentials are incomplete.",
  "manifest.inaccessible": "The credentials could not be read.",
  "signingCredential.invalid": "The signer's certificate cannot be used for signing.",
  "signingCredential.revoked": "The signer's certificate was revoked.",
  "signingCredential.expired": "The signer's certificate had expired.",
  "timeStamp.mismatch": "The recorded signing time does not match.",
  "timeStamp.outsideValidity": "The signing time is outside the timestamp certificate's validity.",
  "ingredient.manifest.missing": "Credentials of a file it was made from are missing.",
  "ingredient.hashedURI.mismatch": "A file it was made from changed after it was used.",
});

/**
 * The URL of credentials a file only points to, from the library's error when it was told not to fetch them.
 * @param {unknown} error
 * @returns {string | null}
 */
export function remoteManifestUrl(error) {
  return String(error instanceof Error ? error.message : error).match(/RemoteManifestUrl\("([^"]+)"\)/)?.[1] ?? null;
}

/**
 * @param {ManifestStore | null} store the manifest store, or null when the file has no Content Credentials
 * @param {{remoteUrl?: string | null}} [extra] where the file says its credentials are, when they are not in it
 * @returns {Report}
 */
export function explain(store, extra = {}) {
  if (!store && extra.remoteUrl) {
    let host = extra.remoteUrl;
    try { host = new URL(extra.remoteUrl).host; } catch { /* keep the text as it is */ }
    return {
      verdict: "remote",
      headline: "Credentials stored elsewhere, not checked",
      summary: `This file says its Content Credentials are kept at ${host}. provenance-check does not fetch them: that would tell ${host} which image you are looking at. The file itself carries none to check.`,
      facts: [{ label: "Stored at", value: extra.remoteUrl }], ai: null, actions: [], history: [], problems: [],
      notes: ["To see them, open that address yourself if you trust the site, or use a verifier you are comfortable sharing the image with."],
      technical: { state: "remote", codes: [] },
    };
  }
  const manifest = store?.active_manifest ? store.manifests?.[store.active_manifest] : undefined;
  if (!store || !manifest) {
    return {
      verdict: "none",
      headline: "No Content Credentials",
      summary: "This file carries no C2PA data. That is common: most images have none, and many sites remove it when they process uploads. It says nothing about whether the image is real or edited.",
      facts: [], ai: null, actions: [], history: [], problems: [],
      notes: ["Some images point to credentials stored elsewhere, or carry an invisible watermark that leads to them; provenance-check reads only what is inside the file."],
      technical: { state: "none", codes: [] },
    };
  }
  const failures = statuses(store).filter((s) => !TRUST_ONLY.has(s.code));
  const state = store.validation_state ?? (failures.length ? "Invalid" : "Valid");
  /** @type {Verdict} */
  const verdict = state === "Invalid" || failures.length ? "invalid" : state === "Trusted" ? "trusted" : "valid";
  const signer = manifest.signature_info?.common_name || manifest.signature_info?.issuer || null;
  const issuer = manifest.signature_info?.issuer && manifest.signature_info.issuer !== signer ? manifest.signature_info.issuer : null;
  const time = manifest.signature_info?.time ? new Date(manifest.signature_info.time) : null;
  const tool = generator(manifest);
  const acts = actionsOf(manifest);
  const ai = aiStatement(store, manifest, acts);

  const who = signer ? `"${signer}"` : "an unnamed signer";
  const headline = {
    trusted: `Content Credentials signed by ${who}`,
    valid: `Content Credentials intact, signed by ${who} (signer not verified)`,
    invalid: "These Content Credentials do not match this file",
  }[verdict];
  const summary = {
    trusted: `The file has not changed since ${who} signed it, and the signer's certificate is on the trust list in use.`,
    valid: `The file has not changed since it was signed by ${who}. Who that is cannot be confirmed: the signer's certificate is not on a trust list provenance-check uses, so anyone could have made credentials that look like this.`,
    invalid: "Something changed after the credentials were signed, or the signature itself is wrong. What they say cannot be relied on for this file.",
  }[verdict];

  /** @type {{label: string, value: string}[]} */
  const facts = [];
  if (signer) facts.push({ label: "Signed by", value: signer });
  if (issuer) facts.push({ label: "Organisation", value: issuer });
  facts.push({ label: "Signed on", value: time && !Number.isNaN(time.getTime()) ? time.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC") : "no trusted time recorded" });
  if (tool) facts.push({ label: "Made with", value: tool });
  // How it was made is what the "created" action says; a source on a later action (an edit with generative AI)
  // is about that edit.
  const source = acts.find((a) => a.name === "c2pa.created" && a.source)?.source;
  if (source) facts.push({ label: "Source", value: SOURCES[source]?.words ?? source });
  if (manifest.title) facts.push({ label: "Title", value: manifest.title });

  const notes = ["Content Credentials record what the signer states about how the file was made. They do not prove that what it shows is real or that the statements are true."];
  if (verdict === "valid") notes.push("provenance-check does not yet check signers against the C2PA trust list. Judge the signer's name for yourself.");
  if (!time) notes.push("No trusted timestamp: when it was signed is not recorded in a way that can be checked.");

  return {
    verdict, headline, summary, facts, ai,
    actions: acts.map((a) => a.words),
    history: (manifest.ingredients ?? []).map((ing) => historyItem(store, ing)),
    problems: unique(failures.map((s) => PROBLEMS[s.code] ?? `${s.explanation ?? s.code} (${s.code})`)),
    notes,
    technical: { state, codes: statuses(store) },
  };
}

/** The active manifest's validation results: failures first, as the library lists them. @param {ManifestStore} store @returns {Status[]} */
function statuses(store) {
  const r = store.validation_results?.activeManifest;
  if (r) return [...(r.failure ?? []), ...(r.informational ?? [])];
  return store.validation_status ?? [];
}

/** "Example Photo Editor 1.0", from claim_generator_info (or the older claim_generator string). @param {Manifest} m */
function generator(m) {
  const info = m.claim_generator_info?.[0];
  if (info?.name) return `${info.name}${info.version ? ` ${info.version}` : ""}`;
  return m.claim_generator?.split(" ")[0]?.replace(/\//, " ") || null;
}

/** @param {Manifest} m @returns {{name: string, words: string, source: string | null, agent: string | null}[]} */
function actionsOf(m) {
  const out = [];
  for (const a of m.assertions ?? []) {
    if (!/^c2pa\.actions(\.v\d+)?$/.test(a.label)) continue;
    for (const act of a.data?.actions ?? []) {
      const name = String(act.action ?? "");
      const source = typeof act.digitalSourceType === "string" ? act.digitalSourceType.replace(IPTC, "") : null;
      const agent = typeof act.softwareAgent === "string" ? act.softwareAgent : act.softwareAgent?.name ?? null;
      let words = ACTIONS[name] ?? name.replace(/^c2pa\./, "").replace(/[._]/g, " ");
      if (source && name !== "c2pa.created" && SOURCES[source]?.ai) words += " with generative AI";
      if (agent) words += ` (${agent})`;
      out.push({ name, words, source, agent });
    }
  }
  return out;
}

/** @param {ManifestStore} store @param {Manifest} m @param {{name: string, source: string | null}[]} acts @returns {AiStatement} */
function aiStatement(store, m, acts) {
  const created = acts.find((a) => a.name === "c2pa.created" && a.source)?.source ?? null;
  if (created && SOURCES[created]?.ai === "generated") return { level: "generated", words: `The signer states it was made by ${SOURCES[created].words}.` };
  if (acts.some((a) => a.source && SOURCES[a.source]?.ai)) return { level: "partly", words: "The signer states that generative AI was used on it." };
  if (ingredientsMadeByAi(store, m, new Set())) return { level: "partly", words: "It was made from a file whose credentials state it was AI-generated." };
  return { level: "not-stated", words: created ? "The credentials do not state that AI was used." : "The credentials say nothing either way about AI." };
}

/** @param {ManifestStore} store @param {Manifest} m @param {Set<string>} seen */
function ingredientsMadeByAi(store, m, seen) {
  for (const ing of m.ingredients ?? []) {
    const label = ing.active_manifest;
    if (!label || seen.has(label)) continue;
    seen.add(label);
    const child = store.manifests?.[label];
    if (!child) continue;
    if (actionsOf(child).some((a) => a.source && SOURCES[a.source]?.ai)) return true;
    if (ingredientsMadeByAi(store, child, seen)) return true;
  }
  return false;
}

/** @param {ManifestStore} store @param {Ingredient} ing @returns {HistoryItem} */
function historyItem(store, ing) {
  const child = ing.active_manifest ? store.manifests?.[ing.active_manifest] : undefined;
  const failures = (ing.validation_results?.activeManifest?.failure ?? ing.validation_status ?? []).filter((s) => !TRUST_ONLY.has(s.code));
  return {
    title: ing.title || "an untitled file",
    how: ing.relationship === "parentOf" ? "edited from" : ing.relationship === "inputTo" ? "used as input" : "includes",
    signer: child?.signature_info?.common_name || child?.signature_info?.issuer || null,
    hasCredentials: Boolean(child),
    problems: unique(failures.map((s) => PROBLEMS[s.code] ?? s.explanation ?? s.code)),
  };
}

/** @template T @param {T[]} xs */
const unique = (xs) => [...new Set(xs)];
