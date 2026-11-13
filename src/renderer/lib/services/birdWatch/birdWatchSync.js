// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// BirdWatch data, kept in Ginternal\sat\. A copy ships with the release (resources/data/sat, made by
// tools/sat_update.js; src/main/index.js puts it in Ginternal\sat when that's missing or older), so it works offline on a
// fresh install. While BirdWatch is on and GridTracker2 is online, the files are kept up to date, silently:
//   modes.json, satellites.json, transmitters.json                SatNOGS DB (db.satnogs.org), CC BY-SA 4.0
//   amsat-active-frequencies.json, amsat-all-frequencies.json     AMSAT list, mirrored by github.com/palewire/amateur-satellite-database (MIT)
//   dailytle.txt                                                  AMSAT's daily element sets (TLE) of the amateur satellites (amsat.org/tle/current)
//   satnogs-tle.json                                              SatNOGS DB's element sets of its satellites (Space-Track's), the fallback for a
//                                                                 satellite no other source has (birdWatchTle.js). Not shipped: only fetched here
//   version.json                                                  the date (YYYYMMDD) of the newest data; sync.json: a hash of each file
// Each file is kept as it was sent and replaced only when it changed. One pass about every 24 hours, started a while after
// startup (not at once, and spread out, so thousands of copies don't call at the same moment): seven requests, one second
// apart. A pass that fails tries again later, further apart each time. Nothing is shown.

const SATNOGS_API = "https://db.satnogs.org/api/";
const AMSAT_DATA = "https://raw.githubusercontent.com/palewire/amateur-satellite-database/main/data/";
const AMSAT_TLE = "https://www.amsat.org/tle/current/dailytle.txt";
const SAT_SYNC_INTERVAL = 24 * 3600 * 1000;
const SAT_REQUEST_GAP = 1000;

GT.satSync = {
  timer: null,
  running: false,
  failures: 0
};

function satDir()
{
  return path.join(GT.appData, "sat");
}

// The copy is kept up to date only while BirdWatch is on and we're online
function satSyncAllowed()
{
  return GT.settings.BirdWatch.enable == true && GT.settings.map.offlineMode == false;
}

function satSyncState()
{
  try
  {
    const state = JSON.parse(fs.readFileSync(path.join(satDir(), "sync.json"), "utf8"));
    if (state && typeof state == "object")
    {
      return { lastSync: 0, files: {}, ...state };
    }
  }
  catch (e)
  {
    // None yet, or unreadable: start again
  }
  return { lastSync: 0, files: {} };
}

// The date (YYYYMMDD) of the data in Ginternal\sat, 0 when there is none
function satDataVersion()
{
  try
  {
    return parseInt(JSON.parse(fs.readFileSync(path.join(satDir(), "version.json"), "utf8")).version) || 0;
  }
  catch (e)
  {
    return 0;
  }
}

// Written whole under another name and renamed, so a stop in the middle never leaves half a file
async function satWriteFile(file, data)
{
  const temp = file + ".tmp";
  await fs.promises.writeFile(temp, data);
  await fs.promises.rename(temp, file);
}

const satPause = (ms) => new Promise((resolve) => nodeTimers.setTimeout(resolve, ms));

function satCheckAllowed()
{
  if (!satSyncAllowed()) throw new Error("stopped");
}

// ---- Scheduling: one timer, never a poll. Called when BirdWatch is switched, at startup and when going on or off line

function birdWatchSyncUpdate()
{
  const S = GT.satSync;
  if (!satSyncAllowed())
  {
    // A pass in progress stops at its next step
    nodeTimers.clearTimeout(S.timer);
    S.timer = null;
    return;
  }
  if (S.timer || S.running) return;

  // The data is as new as the last pass, or as the copy that came with the release
  const state = satSyncState();
  const version = String(satDataVersion());
  const shipped = version.length == 8 ? Date.UTC(version.slice(0, 4), version.slice(4, 6) - 1, version.slice(6, 8)) : 0;
  const wait = Math.max(state.lastSync, shipped) + SAT_SYNC_INTERVAL - Date.now();
  // A list wanted that has never been fetched (one added in an update, as SatNOGS's element sets were, or ticked on): due now, not a day on
  const missing = satSyncNames().some((name) => !fs.existsSync(path.join(satDir(), name + (SAT_LISTS[name].text ? ".txt" : ".json"))));
  let delay;
  if (state.lastSync == 0 && shipped == 0) delay = 10 * 1000;
  else if (wait > 0 && !missing) delay = wait + Math.random() * 30 * 60 * 1000;
  else delay = 60 * 1000 + Math.random() * 4 * 60 * 1000;
  S.timer = nodeTimers.setTimeout(satSyncRun, delay);
}

// ---- Download

// One HTTP or HTTPS request (a GET unless a method and body are given). Resolves { buffer }; rejects on anything else (with
// retryAfter in ms when the server asks us to wait). A login (Authorization) goes only to the server it was given for: not on to
// another host, port or scheme a redirect points to (as browsers and curl do)
function satRequest(url, { timeout = 60000, maxBytes = 64 * 1024 * 1024, method = "GET", headers: extra = {}, body = null } = {})
{
  return new Promise((resolve, reject) =>
  {
    let redirects = 0;
    const origin = new URL(url).origin;
    const go = (target) =>
    {
      const u = new URL(target);
      const headers = { "User-Agent": gtUserAgent, "Accept-Encoding": "gzip", ...extra };
      if (u.origin != origin) delete headers.Authorization;
      const secure = u.protocol == "https:";
      const req = window.require(secure ? "https" : "http").request({ method: method, host: u.hostname, port: Number(u.port) || (secure ? 443 : 80), path: u.pathname + u.search, headers: headers }, (res) =>
      {
        const status = res.statusCode;
        if (status >= 300 && status < 400 && res.headers.location && redirects++ < 3)
        {
          res.resume();
          go(new URL(res.headers.location, target).href);
          return;
        }
        if (status != 200)
        {
          res.resume();
          const error = new Error("HTTP " + status + " " + u.pathname);
          const retryAfter = parseInt(res.headers["retry-after"]);
          if (retryAfter > 0) error.retryAfter = retryAfter * 1000;
          reject(error);
          return;
        }
        const chunks = [];
        let size = 0;
        res.on("data", (data) =>
        {
          size += data.length;
          if (size > maxBytes) req.destroy(new Error("reply too large"));
          else chunks.push(data);
        });
        res.on("end", () =>
        {
          try
          {
            let buffer = Buffer.concat(chunks);
            if (res.headers["content-encoding"] == "gzip") buffer = window.require("zlib").gunzipSync(buffer);
            resolve({ buffer: buffer });
          }
          catch (e)
          {
            reject(e);
          }
        });
        res.on("error", reject);
      });
      req.on("error", reject);
      req.setTimeout(timeout, () => req.destroy(new Error("no reply from server")));
      req.end(body);
    };
    go(url);
  });
}

// ---- The lists

// Keep these rules the same as in tools/sat_update.js
const SAT_LISTS = {
  "modes": { url: SATNOGS_API + "modes/?format=json", minimum: 10, check: (item) => typeof item.id == "number" && typeof item.name == "string" },
  "satellites": { url: SATNOGS_API + "satellites/?format=json", minimum: 500, check: (item) => typeof item.sat_id == "string" },
  "transmitters": { url: SATNOGS_API + "transmitters/?format=json", minimum: 500, check: (item) => typeof item.uuid == "string" && typeof item.sat_id == "string" },
  "amsat-active-frequencies": { url: AMSAT_DATA + "amsat-active-frequencies.json", minimum: 100, check: (item) => typeof item.name == "string" },
  "amsat-all-frequencies": { url: AMSAT_DATA + "amsat-all-frequencies.json", minimum: 1000, check: (item) => typeof item.name == "string" },
  // Not JSON: element sets, a name line and two element lines for each satellite (about 100; they age in days)
  "dailytle": { url: AMSAT_TLE, text: true, minimum: 50 },
  // SatNOGS's element sets, one for each of its satellites (filed under its own catalog number, norad_cat_id; the lines may carry another:
  // a temporary number's real one). Not in tools/sat_update.js: Space-Track's data isn't shipped with the release, each copy fetches it
  "satnogs-tle": { url: SATNOGS_API + "tle/?format=json", minimum: 500, check: (item) => typeof item.tle1 == "string" && typeof item.tle2 == "string" && typeof item.sat_id == "string" && Number(item.norad_cat_id) > 0 }
};

// The lists a pass fetches: all of them, AMSAT's and SatNOGS's element sets only when the Telemetry tab says to use them
function satSyncNames()
{
  const tle = GT.settings.BirdWatch.tle;
  return Object.keys(SAT_LISTS).filter((name) => (name != "dailytle" || tle.amsat) && (name != "satnogs-tle" || tle.satnogs !== false));
}

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


// Fetches a list (a SatNOGS or AMSAT one, or the element sets) and keeps it when it differs from the copy on disk. Only a reply that is a real list replaces it.
// Returns the list
async function satSyncList(name, state)
{
  satCheckAllowed();
  const rule = SAT_LISTS[name];
  const file = path.join(satDir(), name + (rule.text ? ".txt" : ".json"));
  const reply = await satRequest(rule.url);
  let list;
  if (rule.text)
  {
    list = satTleCount(reply.buffer.toString("utf8"));
    if (list.valid < rule.minimum || list.bad > list.valid / 10) throw new Error(name + " is not the element sets expected");
  }
  else
  {
    try
    {
      list = JSON.parse(reply.buffer.toString("utf8"));
    }
    catch (e)
    {
      throw new Error(name + " is not JSON");
    }
    if (!Array.isArray(list) || list.length < rule.minimum || !list.every(rule.check)) throw new Error(name + " is not the list expected");
  }

  const hash = window.require("crypto").createHash("sha256").update(reply.buffer).digest("hex");
  const known = state.files[name];
  if (!known || known.sha256 != hash || !fs.existsSync(file))
  {
    await satWriteFile(file, reply.buffer);
  }
  state.files[name] = { sha256: hash, bytes: reply.buffer.length, checked: Date.now(), changed: known && known.sha256 == hash ? known.changed : Date.now() };
  await satWriteFile(path.join(satDir(), "sync.json"), JSON.stringify(state));
  return list;
}

// ---- The user's own remote element sets (Telemetry tab)

const SAT_TLE_FOLDER = "tle";

// Where a source's element sets are: a local one is the file the user chose, a remote one is kept in Ginternal\sat\tle
function satTleSourceFile(source)
{
  return source.kind == "local" ? source.path : path.join(satDir(), SAT_TLE_FOLDER, source.id + ".txt");
}

// A file from an FTP server (passive mode, no encryption): logs in (anonymously unless there is a login), asks for the
// file, and resolves { buffer }
function satFtpGet(address, user, pass, { timeout = 30000, maxBytes = 20 * 1024 * 1024 } = {})
{
  return new Promise((resolve, reject) =>
  {
    const net = window.require("net");
    const u = new URL(address);
    const control = net.connect({ host: u.hostname, port: Number(u.port) || 21 });
    let data = null;
    let done = false;
    let text = "";
    let waiting = null;
    const replies = [];

    const finish = (error, result) =>
    {
      if (done) return;
      done = true;
      control.destroy();
      if (data) data.destroy();
      if (error) reject(error);
      else resolve(result);
    };
    control.setTimeout(timeout, () => finish(new Error("no reply from server")));
    control.on("error", (e) => finish(e));
    control.on("close", () => finish(new Error("the server closed the connection")));

    // A reply is one line "250 text", or lines "250-" up to "250 "
    control.on("data", (chunk) =>
    {
      text += chunk.toString("latin1");
      const lines = text.split("\r\n");
      text = lines.pop();
      for (const line of lines)
      {
        if (!/^\d{3} /.test(line)) continue;
        replies.push(line);
        if (waiting) waiting(replies.shift());
      }
    });
    const next = () => new Promise((resolve) =>
    {
      if (replies.length) resolve(replies.shift());
      else waiting = (line) => { waiting = null; resolve(line); };
    });
    const send = (command) => control.write(command + "\r\n");
    const expect = async (codes) =>
    {
      const line = await next();
      if (!codes.includes(line.slice(0, 3))) throw new Error("FTP: " + line);
      return line;
    };

    (async () =>
    {
      await expect(["220"]);
      send("USER " + (user || "anonymous"));
      const afterUser = await expect(["230", "331"]);
      if (afterUser.startsWith("331"))
      {
        send("PASS " + (pass || "gridtracker@"));
        await expect(["230"]);
      }
      send("TYPE I");
      await expect(["200"]);
      send("PASV");
      const pasv = /(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)/.exec(await expect(["227"]));
      if (!pasv) throw new Error("FTP: no data port");
      // The server's own address, as it is on the way in (not the one it reports from behind a router)
      const chunks = [];
      let size = 0;
      const finished = new Promise((resolve, reject2) =>
      {
        data = net.connect({ host: u.hostname, port: Number(pasv[5]) * 256 + Number(pasv[6]) });
        data.setTimeout(timeout, () => reject2(new Error("no data from server")));
        data.on("data", (chunk) =>
        {
          size += chunk.length;
          if (size > maxBytes) reject2(new Error("reply too large"));
          else chunks.push(chunk);
        });
        data.on("end", resolve);
        data.on("error", reject2);
      });
      send("RETR " + decodeURIComponent(u.pathname));
      await expect(["125", "150"]);
      await finished;
      await expect(["226", "250"]);
      send("QUIT");
      finish(null, { buffer: Buffer.concat(chunks) });
    })().catch((e) => finish(e));
  });
}

// What a source loads by: the kind the user chose, HTTP (a web address) or FTP
function satSourceType(source)
{
  return source.type == "ftp" ? "ftp" : "http";
}

// Loads a remote source and keeps what came as its copy, by its kind, with the login if there is one: HTTP basic
// authentication, or FTP's user and password (anonymous without). Throws on failure
async function satFetchSource(source)
{
  let reply;
  if (satSourceType(source) == "ftp")
  {
    const url = new URL(source.url);
    reply = await satFtpGet(source.url, source.user || decodeURIComponent(url.username), source.pass || decodeURIComponent(url.password));
  }
  else
  {
    const headers = source.user ? { Authorization: "Basic " + Buffer.from(source.user + ":" + (source.pass || "")).toString("base64") } : {};
    reply = await satRequest(source.url, { headers: headers });
  }

  const sets = satTleCount(reply.buffer.toString("utf8"));
  if (sets.valid < 1 || sets.bad > sets.valid / 10) throw new Error(source.user ? "no element sets in the reply (check the login)" : "no element sets in the reply");
  await fs.promises.mkdir(path.join(satDir(), SAT_TLE_FOLDER), { recursive: true });
  await satWriteFile(satTleSourceFile(source), reply.buffer);
  source.loaded = Date.now();
  source.count = sets.valid;
  source.error = "";
}

// ---- One pass

async function satSyncRun()
{
  const S = GT.satSync;
  S.timer = null;
  if (S.running || !satSyncAllowed()) return;
  S.running = true;
  let next = SAT_SYNC_INTERVAL + Math.random() * 2 * 3600 * 1000;

  try
  {
    await fs.promises.mkdir(satDir(), { recursive: true });
    const state = satSyncState();

    const names = satSyncNames();
    for (let i = 0; i < names.length; i++)
    {
      if (i > 0) await satPause(SAT_REQUEST_GAP);
      await satSyncList(names[i], state);
      // The Telemetry tab's AMSAT and SatNOGS lines show what was just fetched, even while that tab is open
      if (typeof birdWatchTleRender == "function") birdWatchTleRender();
    }

    // The user's remote element sets that are to be refreshed every 24 hours. One that fails doesn't fail the pass
    for (const source of GT.settings.BirdWatch.tle.sources)
    {
      if (source.kind != "remote" || !source.enabled || !source.refresh || Date.now() - source.loaded < SAT_SYNC_INTERVAL - 3600 * 1000) continue;
      satCheckAllowed();
      await satPause(SAT_REQUEST_GAP);
      try
      {
        await satFetchSource(source);
      }
      catch (e)
      {
        source.error = e.message;
      }
      birdWatchTleChanged();
    }

    // AMSAT's element sets may be new: the TLEs in use are looked at again
    if (typeof birdWatchTleDirty == "function") birdWatchTleDirty();

    // The lists are current: the data is as new as today
    const now = new Date();
    const version = now.getUTCFullYear() * 10000 + (now.getUTCMonth() + 1) * 100 + now.getUTCDate();
    await satWriteFile(path.join(satDir(), "version.json"), JSON.stringify({ version: version }));
    state.lastSync = Date.now();
    await satWriteFile(path.join(satDir(), "sync.json"), JSON.stringify(state));
    S.failures = 0;
  }
  catch (e)
  {
    if (e.message == "stopped")
    {
      // BirdWatch was switched off (or we went offline) in the middle: nothing more to do until it's on again
      S.running = false;
      return;
    }
    S.failures++;
    console.warn("BirdWatch data not updated: " + e.message);
    // 30 minutes, then an hour, two... never beyond a day; and longer if the server asked for it
    next = Math.min(SAT_SYNC_INTERVAL, 30 * 60 * 1000 * Math.pow(2, S.failures - 1));
    if (e.retryAfter) next = Math.max(next, Math.min(SAT_SYNC_INTERVAL, e.retryAfter));
  }

  S.running = false;
  if (satSyncAllowed()) S.timer = nodeTimers.setTimeout(satSyncRun, next);
}
