// Builds src/renderer/lib/mmd/ft8.wasm (the Multi-Mode Decoder's FT8 mode) from src/wasm/ft8/ (ft8wasm.c and ft8_lib beside it, MIT) with Emscripten.
// Usage (repo root): node tools/build_ft8_wasm.js [write] [--emsdk=C:\path\to\emsdk] [--out=file.wasm] [--profile]
// Dry run unless "write": builds into an OS temp folder and says whether the result differs from the one in lib/mmd/. --out writes the
// build to that file only, for trying a change offline; --profile (with --out) keeps function names for a CPU profile.
//
// - Needs the Emscripten SDK installed and activated, found as tools/build_cw_wasm.js finds it (--emsdk=, else EMSDK, else ~/emsdk).
// - A standalone module with no JavaScript glue. ft8_lib's logging and number formatting bring in WASI's fd_write, fd_seek, fd_close and
//   proc_exit: the viewer answers them (mmDecoder.js, mmdFt8Load).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const args = process.argv.slice(2);
const write = args.includes("write");
const opt = (name, def) => (args.find((a) => a.startsWith(`--${name}=`)) || `=${def}`).split("=").slice(1).join("=");
const srcDir = "src/wasm/ft8";
const lib = path.join(srcDir, "ft8_lib");
const outFile = "src/renderer/lib/mmd/ft8.wasm";
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
const env = { ...process.env, EMSDK: emsdk, EM_CONFIG: path.join(emsdk, ".emscripten") };
const newest = (dir, file) =>
{
  if (!fs.existsSync(dir)) return null;
  return fs.readdirSync(dir).sort().reverse().map((d) => path.join(dir, d, file)).find((f) => fs.existsSync(f)) || null;
};
const python = newest(path.join(emsdk, "python"), process.platform == "win32" ? "python.exe" : "bin/python3");
const node = newest(path.join(emsdk, "node"), process.platform == "win32" ? "bin/node.exe" : "bin/node");
if (python) env.EMSDK_PYTHON = python;
if (node) env.EMSDK_NODE = node;

const exportsList = ["ft8_init", "ft8_input", "ft8_output", "ft8_decode", "ft8_set_passes", "ft8_set_mycall", "ft8_set_focus", "ft8_mycall_buffer", "ft8_begin", "ft8_pass_candidates", "ft8_try", "ft8_records", "ft8_accept",
  "ft8_subtract_records", "ft8_subtract", "ft8_next_pass", "ft8_given", "ft8_set_period", "ft8_note", "ft8_failures",
  "ft8_failure_count", "ft8_remember", "ft8_set_prefixes", "ft8_prefix_buffer", "ft8_set_budget",
  "ft8_time_up", "ft8_set_plain", "ft8_set_ft4", "malloc", "free"];
// Test builds (--define=FT8_STATS=1) also export ft8_probe and ft8_probe_known (ft8wasm.c)
if (process.argv.some((x) => x.startsWith("--define=FT8_STATS"))) exportsList.push("ft8_probe", "ft8_probe_known", "ft8_known_buffer", "ft8_fine_sync", "ft8_sub_stats", "ft8_phase_text", "ft8_tau", "ft8_osd_bp", "ft8_ap_bp");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gt-ft8wasm-"));
const built = path.join(tmp, "ft8.wasm");
const sources = ["ft8/decode.c", "ft8/message.c", "ft8/text.c", "ft8/ldpc.c", "ft8/crc.c", "ft8/constants.c", "ft8/encode.c", "common/monitor.c", "fft/kiss_fft.c", "fft/kiss_fftr.c"].map((f) => path.join(lib, f));
const flags = [
  path.join(srcDir, "ft8wasm.c"), ...sources,
  "-I" + lib,
  "-O3", "-DNDEBUG",
  // --define=NAME=VALUE (any number): to try other search settings (ft8wasm.c's MAX_CANDIDATES, MIN_SCORE, LDPC_ITERATIONS) with --out
  ...args.filter((a) => a.startsWith("--define=")).map((a) => "-D" + a.slice("--define=".length)),
  "-sSTANDALONE_WASM", "--no-entry",
  "-sEXPORTED_FUNCTIONS=" + exportsList.map((f) => "_" + f).join(","),
  "-sINITIAL_MEMORY=64MB", "-sALLOW_MEMORY_GROWTH=0", "-sSTACK_SIZE=1MB", "-sFILESYSTEM=0",
  // --profile (with --out only): function names kept, for node --cpu-prof
  ...(args.includes("--profile") ? ["--profiling-funcs"] : []),
  "-o", built
];
if (args.includes("--profile") && !opt("out", "")) fail("--profile needs --out=");
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
// --out=<file.wasm>: written there only, for trying a change offline (never into lib/mmd/)
const outOnly = opt("out", "");
if (outOnly)
{
  fs.writeFileSync(outOnly, bytes);
  console.log("written to " + outOnly);
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
