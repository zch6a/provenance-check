// Builds the extension into dist/ (load it unpacked from there): the scripts bundled with esbuild, the static
// files, and the C2PA library's worker and WebAssembly binary, which ship inside the extension.
import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const require = createRequire(import.meta.url);
const web = dirname(require.resolve("@contentauth/c2pa-web/package.json"));

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, "vendor"), { recursive: true });
/**
 * c2pa-web starts its worker from a given URL only if it is https:, else from a blob: or data: URL, which an
 * extension page's security policy does not allow. The worker ships inside the extension (chrome-extension: or
 * moz-extension:), as trustworthy as https: here, so that one check also accepts those (and http: on localhost,
 * for trying the page outside the extension). The build fails if the check is not found as expected.
 * @type {import("esbuild").Plugin}
 */
const workerUrlCheck = {
  name: "c2pa-worker-url",
  setup(b) {
    b.onLoad({ filter: /c2pa-web[\\/]dist[\\/]c2pa-[\w-]+\.js$/ }, (args) => {
      const code = readFileSync(args.path, "utf8");
      const check = /if \((\w+)\.protocol !== "https:"\)\s*throw new Error\(\s*`Worker source URL must use https/;
      const m = code.match(check);
      if (!m) throw new Error(`c2pa-web changed: the worker URL check was not found in ${args.path}; see scripts/build.mjs`);
      const v = m[1];
      const allowed = `if (!(${v}.protocol === "https:" || ${v}.protocol === "chrome-extension:" || ${v}.protocol === "moz-extension:" || (${v}.protocol === "http:" && ${v}.hostname === "localhost")))\n    throw new Error(\`Worker source URL must use https`;
      return { contents: code.replace(check, allowed), loader: "js" };
    });
  },
};

await build({
  entryPoints: ["background", "report", "popup"].map((n) => join(root, "src", `${n}.js`)),
  outdir: dist,
  bundle: true,
  format: "esm",
  target: "chrome116",
  legalComments: "eof",
  logLevel: "warning",
  plugins: [workerUrlCheck],
});
cpSync(join(root, "static"), dist, { recursive: true });
cpSync(join(web, "dist", "c2pa_worker.js"), join(dist, "vendor", "c2pa_worker.js"));
cpSync(join(web, "dist", "resources", "c2pa_bg.wasm"), join(dist, "vendor", "c2pa_bg.wasm"));
// The version lives in package.json; the manifest follows it.
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
manifest.version = pkg.version;
writeFileSync(join(dist, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`built ${pkg.name} ${pkg.version} into dist/`);
