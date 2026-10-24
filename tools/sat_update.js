// Updates the satellite data GridTracker2 ships for BirdWatch (resources/data/sat/), so a fresh install has it offline.
// Run it before releasing. Once installed, the app keeps its own copy in Ginternal\sat\ (birdWatchSync.js fetches the same
// files while BirdWatch is on and we're online) and replaces it with the shipped copy when that one is newer
// (src/main/index.js, like dxcc-info.json); version.json (a YYYYMMDD date) says how new each is.
//   modes.json, satellites.json, transmitters.json     SatNOGS DB (db.satnogs.org/api), CC BY-SA 4.0
//   amsat-active-frequencies.json, amsat-all-frequencies.json   AMSAT list as mirrored by github.com/palewire/amateur-satellite-database (MIT)
//   dailytle.txt                                       AMSAT's daily element sets (TLE), amsat.org/tle/current
// Usage (repo root):
//   node tools/sat_update.js            dry run: what changed since the shipped copy
//   node tools/sat_update.js write      writes resources/data/sat/*.json (CRLF, like the rest of the repo) and version.json
// Nothing is written unless every file came back as a real list. Six requests, one second apart.
const fs = require("fs");
const path = require("path");
const https = require("https");
const zlib = require("zlib");
const crypto = require("crypto");

const outDir = path.resolve(__dirname, "../resources/data/sat");
const write = process.argv[2] === "write";
const SATNOGS = "https://db.satnogs.org/api/";
const AMSAT = "https://raw.githubusercontent.com/palewire/amateur-satellite-database/main/data/";

// Element sets (TLE) in a text: how many are complete and correct (two lines of 69 characters, the same catalog number
// on both, and the checksum at the end of each), and how many "1 " lines are not
function satTleCount(text)
{
  const lines = text.split(/\r?\n/).map((line) => line.trimEnd());
  const sum = (line) =>
  {
    let total = 0;
    for (let i = 0; i < 68; i++) total += /\d/.test(line[i]) ? Number(line[i]) : (line[i] == "-" ? 1 : 0);
    return total % 10 == Number(line[68]);
  };
  let valid = 0;
  let bad = 0;
  for (let i = 0; i < lines.length; i++)
  {
    if (!/^1 \d{5}/.test(lines[i])) continue;
    const two = lines[i + 1] || "";
    if (lines[i].length == 69 && two.length == 69 && /^2 \d{5}/.test(two) && lines[i].slice(2, 7) == two.slice(2, 7) && sum(lines[i]) && sum(two)) valid++;
    else bad++;
  }
  return { valid: valid, bad: bad };
}

// Keep these rules the same as SAT_LISTS in src/renderer/lib/services/birdWatch/birdWatchSync.js
const lists = {
  "modes": { url: SATNOGS + "modes/?format=json", minimum: 10, check: (item) => typeof item.id == "number" && typeof item.name == "string" },
  "satellites": { url: SATNOGS + "satellites/?format=json", minimum: 500, check: (item) => typeof item.sat_id == "string" },
  "transmitters": { url: SATNOGS + "transmitters/?format=json", minimum: 500, check: (item) => typeof item.uuid == "string" && typeof item.sat_id == "string" },
  "amsat-active-frequencies": { url: AMSAT + "amsat-active-frequencies.json", minimum: 100, check: (item) => typeof item.name == "string" },
  "amsat-all-frequencies": { url: AMSAT + "amsat-all-frequencies.json", minimum: 1000, check: (item) => typeof item.name == "string" },
  "dailytle": { url: "https://www.amsat.org/tle/current/dailytle.txt", text: true, minimum: 50 }
};

function get(url)
{
  return new Promise((resolve, reject) =>
  {
    const u = new URL(url);
    https.get({ host: u.hostname, path: u.pathname + u.search, headers: { "User-Agent": "GridTracker2 release tool", "Accept-Encoding": "gzip" } }, (res) =>
    {
      if (res.statusCode != 200)
      {
        res.resume();
        reject(new Error("HTTP " + res.statusCode + " " + url));
        return;
      }
      const chunks = [];
      res.on("data", (d) => chunks.push(d));
      res.on("end", () =>
      {
        const buffer = Buffer.concat(chunks);
        resolve(res.headers["content-encoding"] == "gzip" ? zlib.gunzipSync(buffer) : buffer);
      });
      res.on("error", reject);
    }).on("error", reject);
  });
}

const sha = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

(async () =>
{
  const fresh = {};
  for (const [name, rule] of Object.entries(lists))
  {
    const buffer = await get(rule.url);
    let list;
    if (rule.text)
    {
      const counted = satTleCount(buffer.toString("utf8"));
      if (counted.valid < rule.minimum || counted.bad > counted.valid / 10) throw new Error(name + " is not the element sets expected");
      list = { length: counted.valid };
    }
    else
    {
      list = JSON.parse(buffer.toString("utf8"));
      if (!Array.isArray(list) || list.length < rule.minimum || !list.every(rule.check)) throw new Error(name + " is not the list expected");
    }
    // JSON never holds a raw line break inside a value, so converting them is safe
    const text = buffer.toString("utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
    fresh[name] = { text: text, count: list.length, ext: rule.text ? ".txt" : ".json" };
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  let changed = 0;
  for (const [name, entry] of Object.entries(fresh))
  {
    const file = path.join(outDir, name + entry.ext);
    const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    const same = before !== null && sha(Buffer.from(before)) == sha(Buffer.from(entry.text));
    let was = "";
    if (before !== null) { try { was = ` (was ${entry.ext == ".txt" ? satTleCount(before).valid : JSON.parse(before).length})`; } catch (e) { was = " (was unreadable)"; } }
    console.log(`${name.padEnd(28)} ${String(entry.count).padStart(5)} entries${was}  ${before === null ? "new" : same ? "unchanged" : "CHANGED"}`);
    if (!same) changed++;
  }

  if (!write)
  {
    console.log(changed ? `${changed} file(s) would change. Run with "write".` : "Nothing changed.");
    return;
  }
  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, entry] of Object.entries(fresh)) fs.writeFileSync(path.join(outDir, name + entry.ext), entry.text);
  const now = new Date();
  const version = now.getUTCFullYear() * 10000 + (now.getUTCMonth() + 1) * 100 + now.getUTCDate();
  fs.writeFileSync(path.join(outDir, "version.json"), `{ "version": ${version} }\r\n`);
  console.log(`written to resources/data/sat, version ${version}`);
})().catch((e) =>
{
  console.error("FAILED, nothing written: " + e.message);
  process.exit(1);
});
