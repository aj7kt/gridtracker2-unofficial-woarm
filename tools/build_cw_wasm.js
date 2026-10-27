// Builds src/renderer/lib/mmd/cwdecoder.wasm (the CW Decoder's DSP, run in the Multi-Mode Decoder's AudioWorklet) from src/wasm/cwdecoder/
// (cwdecoder.c and the kissFFT files beside it) with Emscripten.
// Usage (repo root): node tools/build_cw_wasm.js [write] [--emsdk=C:\path\to\emsdk]
// Dry run unless "write": builds into an OS temp folder and says whether the result differs from the one in lib/mmd/.
//
// - Needs the Emscripten SDK installed and activated (emsdk install latest, emsdk activate latest). It is found by --emsdk=, else
//   the EMSDK environment variable, else an "emsdk" folder in the home folder.
// - A standalone module with no JavaScript glue: mmdWorklet.js instantiates it itself (its memory and the exports listed below).
// - The .wasm is the same on every platform, so nothing native is shipped.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const args = process.argv.slice(2);
const write = args.includes("write");
const opt = (name, def) => (args.find((a) => a.startsWith(`--${name}=`)) || `=${def}`).split("=").slice(1).join("=");
const srcDir = "src/wasm/cwdecoder";
const outFile = "src/renderer/lib/mmd/cwdecoder.wasm";
const fail = (msg) =>
{
  console.log(msg + " - nothing written");
  process.exit(1);
};
if (!fs.existsSync(srcDir)) fail("run from the repo root");

const emsdk = opt("emsdk", process.env.EMSDK || path.join(os.homedir(), "emsdk"));
const emscripten = path.join(emsdk, "upstream", "emscripten");
// Windows: emcc.exe in newer releases, emcc.bat in older ones
const emcc = (process.platform == "win32" ? ["emcc.exe", "emcc.bat"] : ["emcc"]).map((f) => path.join(emscripten, f)).find((f) => fs.existsSync(f)) || path.join(emscripten, "emcc");
if (!fs.existsSync(emcc)) fail(`emcc not found in ${emscripten} (install and activate emsdk, or pass --emsdk=)`);

// emsdk's own Python and Node, as its environment script would set them
const env = { ...process.env, EMSDK: emsdk, EM_CONFIG: path.join(emsdk, ".emscripten") };
const newest = (dir, file) =>
{
  if (!fs.existsSync(dir)) return null;
  const found = fs.readdirSync(dir).sort().reverse().map((d) => path.join(dir, d, file)).find((f) => fs.existsSync(f));
  return found || null;
};
const python = newest(path.join(emsdk, "python"), process.platform == "win32" ? "python.exe" : "bin/python3");
const node = newest(path.join(emsdk, "node"), process.platform == "win32" ? "bin/node.exe" : "bin/node");
if (python) env.EMSDK_PYTHON = python;
if (node) env.EMSDK_NODE = node;

// --debug=<file.wasm>: a build with CW_DEBUG (one channel's levels and key each tick: cw_debug_watch, cw_debug, cw_debug_count) written to
// that file only, for tuning offline; never to lib/mmd/
const debugOut = opt("debug", "");
const exportsList = ["cw_init", "cw_input", "cw_process", "cw_row", "cw_row_bins", "cw_bin_hz", "cw_channels", "cw_events", "cw_event_count", "cw_events_clear", "cw_retune", "cw_revision_text", "cw_set_range", "cw_span", "cw_max_channels", "malloc", "free"]
  .concat(debugOut ? ["cw_debug_watch", "cw_debug", "cw_debug_count"] : []);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gt-cwwasm-"));
const built = path.join(tmp, "cwdecoder.wasm");
const flags = [
  path.join(srcDir, "cwdecoder.c"),
  path.join(srcDir, "kissfft", "kiss_fft.c"),
  path.join(srcDir, "kissfft", "kiss_fftr.c"),
  "-O3", "-DNDEBUG", "-Dkiss_fft_scalar=float", ...(debugOut ? ["-DCW_DEBUG"] : []),
  "-sSTANDALONE_WASM", "--no-entry",
  "-sEXPORTED_FUNCTIONS=" + exportsList.map((f) => "_" + f).join(","),
  "-sINITIAL_MEMORY=32MB", "-sALLOW_MEMORY_GROWTH=0", "-sSTACK_SIZE=256KB", "-sFILESYSTEM=0",
  "-sERROR_ON_UNDEFINED_SYMBOLS=1",
  "-o", built
];
try
{
  execFileSync(emcc, flags, { env, stdio: ["ignore", "inherit", "inherit"], shell: process.platform == "win32" });
}
catch (e)
{
  fail("emcc failed");
}

const bytes = fs.readFileSync(built);
const mod = new WebAssembly.Module(bytes);
console.log(`built ${bytes.length} bytes`);
console.log("imports: " + (WebAssembly.Module.imports(mod).map((i) => i.module + "." + i.name).join(", ") || "none"));
const missing = exportsList.filter((f) => !WebAssembly.Module.exports(mod).some((e) => e.name == f));
if (missing.length) fail("missing exports: " + missing.join(", "));
if (debugOut)
{
  fs.writeFileSync(debugOut, bytes);
  console.log("debug build written to " + debugOut);
  process.exit(0);
}
const same = fs.existsSync(outFile) && Buffer.compare(fs.readFileSync(outFile), bytes) == 0;
console.log(`${outFile}: ${same ? "unchanged" : fs.existsSync(outFile) ? "differs" : "new"}`);
if (write && !same)
{
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, bytes);
  console.log("written");
}
fs.rmSync(tmp, { recursive: true, force: true });
