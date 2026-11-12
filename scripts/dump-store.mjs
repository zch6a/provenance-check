// Prints the manifest store of a test image (to see the shape the explanation reads). Thumbnails left out.
import { readStore } from "./wasm-node.mjs";

const f = process.argv[2];
const store = await readStore(f, f.endsWith(".png") ? "image/png" : "image/jpeg");
console.log(JSON.stringify(store, (k, v) => (k === "thumbnail" || (v instanceof Uint8Array) ? "[...]" : v), 2));
