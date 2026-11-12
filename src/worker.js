// @ts-check
// The reader's worker: the network guard, then c2pa-web's own worker. ES modules run their imports in order, so the
// guard is in place before the library's code runs.
import "./worker-guard.js";
import "@contentauth/c2pa-web/c2pa_worker";
