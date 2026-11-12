// Builds the extension into dist/ (load it unpacked from there): the scripts bundled with esbuild, the static
// files, and the C2PA library's worker and WebAssembly binary, which ship inside the extension.
import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// dist/ by default; tests build into a folder of their own (DIST=...), since test files run at the same time.
const dist = process.env.DIST ? resolve(process.env.DIST) : join(root, "dist");
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
// The reader's worker: the network guard first, then c2pa-web's worker (src/worker.js).
await build({
  entryPoints: [join(root, "src", "worker.js")],
  outfile: join(dist, "vendor", "c2pa_worker.js"),
  bundle: true,
  format: "esm",
  target: "chrome116",
  logLevel: "warning",
});
cpSync(join(root, "static"), dist, { recursive: true });
cpSync(join(web, "dist", "resources", "c2pa_bg.wasm"), join(dist, "vendor", "c2pa_bg.wasm"));
// The licenses of what is bundled (the packages carry no license comments for esbuild to keep).
const notices = ["provenance-check bundles the following, under their licenses.\n"];
for (const name of ["@contentauth/c2pa-web", "@contentauth/c2pa-utilities", "@contentauth/c2pa-wasm", "highgain"]) {
  // (Not require.resolve: some packages do not export their package.json.)
  const dir = [join(web, "node_modules", name), join(root, "node_modules", name)].find((d) => existsSync(join(d, "package.json")));
  if (!dir) throw new Error(`${name} not found in node_modules`);
  const meta = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const license = ["LICENSE", "LICENSE.md", "LICENSE.txt", "license"].map((f) => join(dir, f)).find((f) => existsSync(f));
  notices.push(`\n=== ${meta.name} ${meta.version} (${meta.license ?? "see below"}) ===\n\n${license ? readFileSync(license, "utf8").trim() : `License: ${meta.license}`}\n`);
}
notices.push("\n=== c2pa_bg.wasm ===\n\nBuilt from c2pa-rs (https://github.com/contentauth/c2pa-rs, MIT or Apache-2.0) and its Rust dependencies, as published in @contentauth/c2pa-web.\n");
writeFileSync(join(dist, "THIRD_PARTY_LICENSES.txt"), notices.join(""));
// The version lives in package.json; the manifest follows it.
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
manifest.version = pkg.version;
writeFileSync(join(dist, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`built ${pkg.name} ${pkg.version} into dist/`);
