// Builds the Multi-Mode Decoder's test signals (its Test Signals menu, mmdTest.js): each a mono 16 bit WAV at 12000 Hz in
// resources/test-signals/, listed in resources/test-signals/index.json. Each mode's signals come from its module in tools/test_signals/
// (each exports build(common) giving a list of { file, modes, signals, rsid, sync, description, samples }); files downloaded (sources and
// licenses in resources/test-signals/README.md) are listed by tools/test_signals/downloaded.js and kept as they are.
// Dry run (lists what it would write, with sizes) unless "write". Usage (repo root): node tools/make_test_signals.js [write] [module ...]
// (only the modules named are built again; the others' entries are kept from index.json). A mode that is a plugin (PLUGIN_MODULES) has
// its signals in its own folder instead: plugins/mmd/<id>/test-signals/, with an index.json of its own
const fs = require("fs");
const path = require("path");
const common = require("./test_signals/common.js");

const write = process.argv.includes("write");
const only = process.argv.slice(2).filter((a) => a != "write");
const appDir = path.join(__dirname, "..", "resources", "test-signals");
const modulesDir = path.join(__dirname, "test_signals");
// The modules whose mode is a plugin: its id (plugins/mmd/<id>)
const PLUGIN_MODULES = { navtex: "navtex", wefax: "wefax", ft8: "ftx", psk31: "keyboard", rtty: "keyboard", mfsk: "keyboard", thor: "keyboard", hell: "hell", olivia: "olivia", packet: "packet" };
const dirOf = (name) => (PLUGIN_MODULES[name] ? path.join(__dirname, "..", "plugins", "mmd", PLUGIN_MODULES[name], "test-signals") : appDir);
const modules = fs.readdirSync(modulesDir).filter((f) => f.endsWith(".js") && f != "common.js").map((f) => f.slice(0, -3)).sort();

// Each file's name in the Test Signals menu (modes and submodes, the same in every language), before its signal count
const NAMES = {
  "cw-5.wav": "CW",
  "psk31-5.wav": "BPSK31",
  "rtty-5.wav": "RTTY 45/170",
  "rtty-variants.wav": "RTTY 50/75 Baud, 425/850 Hz",
  "mfsk-3.wav": "MFSK16 / MFSK32",
  "navtex.wav": "NAVTEX",
  "olivia-3.wav": "Olivia / Contestia",
  "olivia-16-500-wikimedia.wav": "Olivia 16/500",
  "olivia-32-1000-wikimedia.wav": "Olivia 32/1000",
  "mixed-rsid.wav": "CW + PSK31 + RTTY + Olivia",
  "ft8-5.wav": "FT8",
  "ft4-5.wav": "FT4",
  "sstv-robot36.wav": "Robot 36",
  "packet-aprs.wav": "APRS, AFSK 1200",
  "packet-hf300.wav": "HF Packet, 300 Baud",
  "sat-genesis-ssdv.wav": "GENESIS SSDV",
  "sat-funcube.wav": "FUNcube",
  "sat-ax100.wav": "AX100"
};

// Recordings with no RSID to set the decoder: the Olivia submode and centre (audio Hz) they're decoded at, set while they play
const OLIVIA = {
  "olivia-16-500-wikimedia.wav": { submode: "olivia 16/500", center: 1500 },
  "olivia-32-1000-wikimedia.wav": { submode: "olivia 32/1000", center: 1000 }
};

// Each folder's entries (index.json's, by folder), and its old ones (kept for the modules not built again)
const indexes = {};
const indexOf = (dir) =>
{
  if (!indexes[dir])
  {
    const file = path.join(dir, "index.json");
    indexes[dir] = { file, old: fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")).signals : [], entries: [] };
  }
  return indexes[dir];
};
indexOf(appDir);
let total = 0;
for (const name of modules)
{
  const dir = dirOf(name);
  const index = indexOf(dir);
  const entries = index.entries;
  if (only.length && !only.includes(name))
  {
    for (const e of index.old.filter((e) => e.module == name)) entries.push(e);
    continue;
  }
  const built = require(path.join(modulesDir, name + ".js")).build(common);
  for (const b of built)
  {
    if (!/^[a-z0-9-]+\.wav$/.test(b.file)) throw new Error(name + ": bad file name " + b.file);
    if (Object.values(indexes).some((i) => i.entries.some((e) => e.file == b.file))) throw new Error(name + ": " + b.file + " twice");
    let bytes;
    if (b.samples)
    {
      bytes = common.wav(b.samples);
      if (write)
      {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, b.file), bytes);
      }
    }
    else bytes = fs.readFileSync(path.join(dir, b.file));
    total += bytes.length;
    console.log((b.samples ? "built " : "kept  ") + b.file.padEnd(34) + (bytes.length / 1024).toFixed(0).padStart(6) + " KB  " + b.modes.join(",") + "  " + b.signals + " signal(s)" + (b.rsid ? ", RSID" : "") + (b.sync ? ", from a " + b.sync + " period" : ""));
    const entry = { file: b.file, module: name, name: b.name || NAMES[b.file] || "", modes: b.modes, signals: b.signals, rsid: !!b.rsid, sync: b.sync || null, description: b.description, source: b.source || "generated" };
    if (b.olivia || OLIVIA[b.file]) entry.olivia = b.olivia || OLIVIA[b.file];
    entries.push(entry);
  }
}
const count = Object.values(indexes).reduce((n, i) => n + i.entries.length, 0);
console.log("total " + (total / 1024 / 1024).toFixed(2) + " MB in " + count + " files" + (write ? "" : " (dry run: nothing written)"));
if (write)
{
  for (const dir in indexes)
  {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(indexes[dir].file, JSON.stringify({ rate: common.RATE, signals: indexes[dir].entries }, null, 2).replace(/\n/g, "\r\n") + "\r\n");
  }
}
