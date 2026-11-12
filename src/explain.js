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
 * @typedef {{title?: string, format?: string, relationship?: string, active_manifest?: string, label?: string,
 *   validation_results?: {activeManifest?: {failure?: Status[]}}, validation_status?: Status[]}} Ingredient
 * @typedef {{claim_generator?: string, claim_generator_info?: {name?: string, version?: string}[], title?: string, format?: string,
 *   assertions?: Assertion[], ingredients?: Ingredient[], signature_info?: {common_name?: string, issuer?: string, time?: string, alg?: string},
 *   label?: string}} Manifest
 * @typedef {{success?: Status[], informational?: Status[], failure?: Status[]}} Results
 * @typedef {{active_manifest?: string, manifests?: Record<string, Manifest>, validation_status?: Status[], validation_state?: string,
 *   validation_results?: {activeManifest?: Results, ingredientDeltas?: {uri?: string, validationDeltas?: Results}[]}}} ManifestStore
 * @typedef {"trusted" | "valid" | "invalid" | "remote" | "none"} Verdict
 * @typedef {{level: "generated" | "partly" | "not-stated", words: string}} AiStatement
 * @typedef {{title: string, how: string, signer: string | null, hasCredentials: boolean, problems: string[], recorded: string[]}} HistoryItem
 * @typedef {{verdict: Verdict, headline: string, summary: string, facts: {label: string, value: string}[], ai: AiStatement | null,
 *   actions: string[], history: HistoryItem[], problems: string[], notes: string[], technical: {state: string, codes: Status[]}}} Report
 */

/** IPTC digital source types are written with either the http or the https scheme; both mean the same term. */
const IPTC = /^https?:\/\/cv\.iptc\.org\/newscodes\/digitalsourcetype\//;

/**
 * Where the content came from, by IPTC digital source type, and whether that means generative AI. Only the
 * "trained algorithmic" types are AI in the generative sense; algorithmicMedia is IPTC's term for algorithms that
 * were *not* trained on examples, and "synthetic" is not necessarily AI.
 */
const SOURCES = /** @type {Record<string, {words: string, ai?: "generated" | "partly"}>} */ ({
  trainedAlgorithmicMedia: { words: "generative AI", ai: "generated" },
  algorithmicMedia: { words: "an algorithm that was not trained on examples (not generative AI)" },
  compositeWithTrainedAlgorithmicMedia: { words: "a composite that includes generative-AI elements", ai: "partly" },
  compositeSynthetic: { words: "a composite with synthetic (computer-made) elements, not necessarily AI" },
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

/**
 * What a validation code is about:
 * - "trust": whether a signer (or a timestamp authority, or an identity statement's issuer) is on a trust list in
 *   use, or could be looked up; not about the file having changed. provenance-check uses no trust list yet and looks
 *   nothing up, so these come up for nearly every file.
 * - "identity": a CAWG identity statement (who made it, as a separately signed claim) that does not check out. The
 *   file itself may well be intact.
 * - "integrity": the file or its credentials changed after signing, or the signature is wrong.
 * @param {string} code
 * @returns {"trust" | "identity" | "integrity"}
 */
export function kindOf(code) {
  if (/^(signingCredential\.(untrusted|ocsp\.)|timeStamp\.untrusted)/.test(code)) return "trust";
  if (/^cawg\./.test(code)) return /untrusted|did_unavailable|ocsp|revocation/.test(code) ? "trust" : "identity";
  return "integrity";
}

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
 * @param {{remoteUrl?: string | null, damaged?: string | null, fetchedFrom?: string | null}} [extra] where the file says
 *   its credentials are, when they are not in it; why its credentials could not be read, when they are damaged; the
 *   site the checked copy was downloaded from
 * @returns {Report}
 */
export function explain(store, extra = {}) {
  if (!store && extra.damaged) {
    return {
      verdict: "invalid",
      headline: "This file's Content Credentials are damaged",
      summary: "The file contains C2PA data, but it cannot be read: it was damaged or altered after it was signed. Nothing it claims can be relied on for this file.",
      facts: [], ai: null, actions: [], history: [], problems: ["The credentials could not be read."],
      notes: ["A file can be damaged by an editor or an upload that rewrote it without understanding the credentials, not only by someone tampering with it."],
      technical: { state: "damaged", codes: [{ code: "read.error", explanation: extra.damaged }] },
    };
  }
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
  const all = failuresOf(store);
  const integrity = all.filter((s) => kindOf(s.code) === "integrity");
  const identity = all.filter((s) => kindOf(s.code) === "identity");
  const state = store.validation_state ?? (integrity.length ? "Invalid" : "Valid");
  // The library calls a file "Invalid" when any check failed; only a failure about the file or its signature makes
  // it "invalid" here. (An "Invalid" state with no failure listed at all stays invalid: better safe.)
  /** @type {Verdict} */
  const verdict = integrity.length || (state === "Invalid" && !all.length) ? "invalid" : state === "Trusted" ? "trusted" : "valid";
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
  const codes = new Set([...(store.validation_results?.activeManifest?.success ?? []), ...all].map((s) => s.code));
  if (time && !Number.isNaN(time.getTime())) {
    const when = time.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
    facts.push({ label: "Signed on", value: `${when} ${codes.has("timeStamp.trusted") ? "(trusted timestamp)" : "(from a timestamp whose authority is not verified)"}` });
  } else facts.push({ label: "Signed on", value: "no timestamp recorded" });
  if (tool) facts.push({ label: "Made with", value: tool });
  // How it was made is what the "created" action says; a source on a later action (an edit with generative AI)
  // is about that edit.
  const source = acts.find((a) => a.name === "c2pa.created" && a.source)?.source;
  if (source) facts.push({ label: "Source", value: SOURCES[source]?.words ?? source });
  if (manifest.title) facts.push({ label: "Title", value: manifest.title });
  const hasIdentity = (manifest.assertions ?? []).some((a) => /^cawg\.identity/.test(a.label));
  if (hasIdentity) {
    facts.push({ label: "Identity statement", value: identity.length ? "attached, but it does not check out" : "attached (CAWG), not verified against a trust list" });
  }

  const notes = ["Content Credentials record what the signer states about how the file was made. They do not prove that what it shows is real or that the statements are true."];
  if (verdict === "valid") notes.push("provenance-check does not yet check signers against the C2PA trust list. Judge the signer's name for yourself.");
  if (!time) notes.push("No timestamp: when it was signed is not recorded in a way that can be checked.");
  if (extra.fetchedFrom) notes.push(`This is the copy downloaded from ${extra.fetchedFrom}, shown above. A site can send different visitors different files.`);
  if (hasIdentity) notes.push("The identity statement says who made it, signed separately. provenance-check does not contact its issuer (that would tell them which image you are looking at), so it cannot confirm it.");

  return {
    verdict, headline, summary, facts, ai,
    actions: acts.map((a) => a.words),
    history: (manifest.ingredients ?? []).map((ing) => historyItem(store, ing)),
    problems: unique([
      ...integrity.map((s) => PROBLEMS[s.code] ?? `${s.explanation ?? s.code} (${s.code})`),
      ...identity.map((s) => `The identity statement attached to it does not check out: ${s.explanation ?? s.code} (${s.code})`),
    ]),
    notes,
    technical: { state, codes: statuses(store) },
  };
}

/** The active manifest's validation results, failures then the informational ones, for the technical details. @param {ManifestStore} store @returns {Status[]} */
function statuses(store) {
  const r = store.validation_results?.activeManifest;
  if (r) return [...(r.failure ?? []), ...(r.informational ?? [])];
  return store.validation_status ?? [];
}

/** Only the failures (informational entries are never a failure). @param {ManifestStore} store @returns {Status[]} */
function failuresOf(store) {
  const r = store.validation_results?.activeManifest;
  return r ? (r.failure ?? []) : (store.validation_status ?? []);
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
      // A custom action ("com.example.verified") is shown as the label it is, not turned into a sentence that reads
      // like a statement of fact.
      let words = ACTIONS[name] ?? (name.startsWith("c2pa.") ? name.slice(5).replace(/[._]/g, " ") : `"${name}" (a custom action, not defined by C2PA)`);
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

/**
 * An ingredient: what it was, who signed it, and its problems. Two sources, kept apart: what the reader found now
 * (the "ingredient deltas" of this validation), and what the tool that made the file recorded about it when it was
 * used (which that tool wrote, and could have written anything into).
 * @param {ManifestStore} store @param {Ingredient} ing @returns {HistoryItem}
 */
function historyItem(store, ing) {
  const child = ing.active_manifest ? store.manifests?.[ing.active_manifest] : undefined;
  const words = (/** @type {Status} */ s) => PROBLEMS[s.code] ?? s.explanation ?? s.code;
  const deltas = (store.validation_results?.ingredientDeltas ?? [])
    .filter((d) => ing.label && store.active_manifest && d.uri?.includes(store.active_manifest) && d.uri.endsWith(`/${ing.label}`))
    .flatMap((d) => d.validationDeltas?.failure ?? []);
  const recorded = (ing.validation_results?.activeManifest?.failure ?? ing.validation_status ?? []);
  return {
    title: ing.title || "an untitled file",
    how: ing.relationship === "parentOf" ? "edited from" : ing.relationship === "inputTo" ? "used as input" : "includes",
    signer: child?.signature_info?.common_name || child?.signature_info?.issuer || null,
    hasCredentials: Boolean(child),
    problems: unique(deltas.filter((s) => kindOf(s.code) !== "trust").map(words)),
    recorded: unique(recorded.filter((s) => kindOf(s.code) !== "trust").map(words)),
  };
}

/** @template T @param {T[]} xs */
const unique = (xs) => [...new Set(xs)];
