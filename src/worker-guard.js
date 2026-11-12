// @ts-check
// Installed first in the reader's worker (see worker.js): the C2PA library loads after this has run.
import { blockNetwork } from "./network-guard.js";

blockNetwork(/** @type {any} */ (globalThis));
