// Rebuilds src/renderer/lib/third-party/satellite.js and tle.js from their npm packages (plain global scripts, CRLF).
// Usage (repo root): node tools/build_satellite_libs.js [write] [--tle=5.0.3] [--satellite=6.0.2]
// Dry run unless "write": prints sizes and whether each file differs from the one in third-party/.
//
// - Downloads tle.js and satellite.js with "npm pack" into a fresh OS temp folder (not the project; package.json and
//   node_modules are untouched) and unpacks them with tar.
// - satellite.js: its own browser build, dist/satellite.js, unchanged (defines the global "satellite").
// - tle.js: ships only ES-module source (src/), so it is bundled with esbuild (fetched by npx) into one IIFE defining
//   the global "tlejs". Its "satellite.js" imports are pointed at a shim that reads the global "satellite", so
//   third-party/satellite.js must be loaded before third-party/tle.js.
// - Each file gets "/* eslint-disable */" and a header with version, source and full licence text.
// Pick a satellite.js version that matches tle.js's dependency range (checked below).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const args = process.argv.slice(2);
const write = args.includes("write");
const opt = (name, def) => (args.find((a) => a.startsWith(`--${name}=`)) || `=${def}`).split("=")[1];
const tleVersion = opt("tle", "5.0.3");
const satVersion = opt("satellite", "6.0.2");
const ESBUILD = "esbuild@0.25.10";
const outDir = "src/renderer/lib/third-party";
const fail = (msg) =>
{
  console.log(msg + " - nothing written");
  process.exit(1);
};
if (!fs.existsSync(outDir)) fail("run from the repo root");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gt-satlibs-"));
const run = (cmd, cwd = tmp) => execSync(cmd, { cwd, stdio: ["ignore", "pipe", "inherit"] }).toString();

// Download and unpack
run(`npm pack tle.js@${tleVersion} satellite.js@${satVersion} --pack-destination "${tmp}" --silent`);
const unpack = (tgz, dir) =>
{
  fs.mkdirSync(path.join(tmp, dir));
  run(`tar -xzf "${path.join(tmp, tgz)}" -C "${path.join(tmp, dir)}"`);
  return path.join(tmp, dir, "package");
};
const tlePkg = unpack(`tle.js-${tleVersion}.tgz`, "tle");
const satPkg = unpack(`satellite.js-${satVersion}.tgz`, "satellite");

// tle.js's satellite.js range must allow the chosen version (it uses ^major)
const wanted = JSON.parse(fs.readFileSync(path.join(tlePkg, "package.json"), "utf8")).dependencies["satellite.js"];
if (!wanted.startsWith("^" + satVersion.split(".")[0] + ".")) fail(`tle.js ${tleVersion} wants satellite.js ${wanted}, not ${satVersion}`);

// The functions tle.js imports from satellite.js, re-exported from the global
const tleSources = fs.readdirSync(path.join(tlePkg, "src")).filter((f) => f.endsWith(".js"));
const imported = new Set();
for (const f of tleSources)
{
  const src = fs.readFileSync(path.join(tlePkg, "src", f), "utf8");
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]satellite\.js['"]/g))
  {
    m[1].split(",").map((n) => n.trim()).filter(Boolean).forEach((n) => imported.add(n));
  }
}
if (!imported.size) fail("found no satellite.js imports in tle.js");
const build = path.join(tmp, "build");
fs.mkdirSync(build);
fs.writeFileSync(path.join(build, "satellite-global.js"),
  "const s = globalThis.satellite;\n" + [...imported].map((n) => `export const ${n} = s.${n};`).join("\n") + "\n");

// Bundle tle.js
const esbuildArgs = "--bundle --format=iife --global-name=tlejs --alias:satellite.js=./satellite-global.js --target=es2020";
run(`npx --yes ${ESBUILD} "${path.join(tlePkg, "src", "index.js")}" ${esbuildArgs} --outfile="${path.join(build, "tle.bundle.js")}" --log-level=warning`, build);

// Headers and CRLF
const nl = "\r\n";
const crlf = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, nl);
const licence = (f) => fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n").trim().split("\n").map((l) => (" * " + l).trimEnd()).join("\n");
const licenceFile = (dir) => path.join(dir, fs.readdirSync(dir).find((f) => /^licen[cs]e(\.md|\.txt)?$/i.test(f)));

const satellite = `/* eslint-disable */
/*!
 * satellite.js ${satVersion} - SGP4/SDP4 satellite propagation (https://github.com/shashwatak/satellite-js)
 * npm package satellite.js@${satVersion}, file dist/satellite.js, unmodified below this header.
 * Defines the global "satellite". Load before tle.js. Built by tools/build_satellite_libs.js.
 *
${licence(licenceFile(satPkg))}
 */
` + fs.readFileSync(path.join(satPkg, "dist", "satellite.js"), "utf8");

const tle = `/* eslint-disable */
/*!
 * tle.js ${tleVersion} - satellite TLE parsing and orbit helpers (https://github.com/davidcalhoun/tle.js)
 * npm package tle.js@${tleVersion} (ES-module source in src/), bundled to one plain script with ${ESBUILD.replace("@", " ")}:
 *   esbuild src/index.js ${esbuildArgs}
 * where satellite-global.js re-exports the functions tle.js uses (${[...imported].join(", ")})
 * from the global "satellite" (third-party/satellite.js), which must be loaded first.
 * Defines the global "tlejs" (e.g. tlejs.getLatLngObj(tle), tlejs.getSatelliteInfo(...)). Built by tools/build_satellite_libs.js.
 *
${licence(licenceFile(tlePkg))}
 */
` + fs.readFileSync(path.join(build, "tle.bundle.js"), "utf8");

const files = { "satellite.js": crlf(satellite), "tle.js": crlf(tle) };
for (const [name, text] of Object.entries(files))
{
  const f = path.join(outDir, name);
  const old = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null;
  const state = old === null ? "new" : old === text ? "unchanged" : "changed";
  console.log(`${name}: ${text.length} chars, ${text.split(nl).length} lines (${state})`);
  if (write && state !== "unchanged") fs.writeFileSync(f, text);
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(write ? "written" : "dry run");
