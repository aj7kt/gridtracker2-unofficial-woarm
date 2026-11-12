// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// BirdWatch's element sets (TLE), the Telemetry tab of its settings window: AMSAT's daily file, local files and remote
// addresses the user adds. A local file is watched while BirdWatch is on, so what's shown (and used) follows the file
// when it is changed, replaced or deleted. A remote one is loaded when added and can be refreshed every 24 hours
// (birdWatchSync.js). Add TLE has a Local / Remote / TLE selector with the + at its right: Local opens a file chooser; TLE
// is two lines typed or pasted, checked before the +; Remote
// shows an address (https:// to start) with its username and password under it, which can be blank and can be changed
// later. A remote source refreshes every 24 hours unless that's unticked. An http(s):// address is loaded as a web address, an ftp:// one by FTP.
// Settings: GT.settings.BirdWatch.tle (see defaults.js)

// A changed local file is read once it has been quiet this long (ms): each new change starts the wait again
// What the kinds are called in a row
const TLE_TYPE_NAMES = { http: "HTTP", ftp: "FTP" };

const TLE_WATCH_DELAY = 3000;

// The shape of an element set, defined once so every one has the same fields in the same order. A set read from a file or typed
// text (birdWatchTleSet) is { norad, name, line1, line2, epoch }; the entry in the list in memory (birdWatchTleEntry) is that plus
// where it came from and what it is:
//   norad          the catalog number (a Number)
//   name           the name line before its two lines, "" when there is none
//   line1, line2   the two lines
//   epoch          when the element set is for, in ms since 1970
//   group          the source group it came from: "override", "amsat", "local", "remote", "typed" or "satnogs" (the fallback)
//   source         the name of that source, as the Telemetry tab lists it
//   amsat          true for an amateur satellite: one AMSAT's lists have (its daily element sets or its frequency list),
//                  whichever source this element set came from
function birdWatchTleSet(norad, name, line1, line2, epoch)
{
  return { norad: norad, name: name, line1: line1, line2: line2, epoch: epoch };
}

function birdWatchTleEntry(set, group, source, amsat)
{
  return { norad: set.norad, name: set.name, line1: set.line1, line2: set.line2, epoch: set.epoch, group: group, source: source, amsat: amsat };
}

// The catalog numbers AMSAT lists as amateur satellites: its daily element sets (dailytle.txt) and its frequency list
// (amsat-all-frequencies.json), both in the satellite data. Read again only when one of the files changes
GT.birdWatchAmsat = { stamp: "", norads: new Set() };

function birdWatchAmsatNorads()
{
  const A = GT.birdWatchAmsat;
  try
  {
    const tle = path.join(satDir(), "dailytle.txt");
    const frequencies = path.join(satDir(), "amsat-all-frequencies.json");
    const stamp = [tle, frequencies].map((file) => { const stat = fs.statSync(file); return stat.mtimeMs + ":" + stat.size; }).join("|");
    if (stamp != A.stamp)
    {
      const norads = new Set();
      for (const match of fs.readFileSync(tle, "utf8").matchAll(/^1 (\d{5})/gm)) norads.add(Number(match[1]));
      for (const item of JSON.parse(fs.readFileSync(frequencies, "utf8"))) if (Number(item.norad_id) > 0) norads.add(Number(item.norad_id));
      A.norads = norads;
      A.stamp = stamp;
    }
  }
  catch (e)
  {
    // The files are not there (yet): what was known is kept
  }
  return A.norads;
}

// The TLEs in use, in memory: one for each satellite, the winner by precedence (the typed overrides, then AMSAT, Local and
// Remote in the order of TLE Precedence). Kept up to date as sources change: birdWatchTleGet(norad), birdWatchTleList()
GT.birdWatchTles = {
  map: new Map(),
  version: 0,
  built: 0,
  timer: null,
  parsed: new Map(),
  listeners: []
};

GT.birdWatchTle = {
  watchers: new Map(),
  timers: new Map(),
  busy: new Set(),
  showLogin: new Set(),
  editing: new Set(),
  // A satellite's TLE being edited from the Satellites tab: a typed TLE that only exists once it is saved (Cancel throws it away)
  drafts: [],
  noticeTimer: null,
  fileSelector: null
};

function birdWatchTleSettings()
{
  return GT.settings.BirdWatch.tle;
}

// A source can be turned off (Enable unticked) without being deleted: it is then not watched, not loaded and not refreshed,
// and not one of birdWatchTleFiles
function birdWatchTleEnabled(source)
{
  return source.enabled;
}

// ---- Precedence: when a satellite is in more than one source, the first source group that has it is the one used

const TLE_GROUPS = "alrm";
const TLE_GROUP_NAMES = { a: () => "AMSAT", l: () => I18N("birdWatch.tle.mode.local.label"), r: () => I18N("birdWatch.tle.mode.remote.label"), m: () => I18N("birdWatch.tle.mode.tle.label") };

// The order chosen, as letters
function birdWatchTleOrder()
{
  return birdWatchTleSettings().precedence;
}

// The element sets in use, in the order they win: the typed overrides first, always; then AMSAT's, the local files, the
// remote ones and the manual (typed) TLEs in the order chosen (TLE Precedence), each group with its sources in the order
// they were added; last, always, SatNOGS's, for a satellite none of them has (birdWatchSatnogsSets). A source that isn't enabled
// isn't in it
function birdWatchTleOrdered()
{
  const settings = birdWatchTleSettings();
  const on = settings.sources.filter(birdWatchTleEnabled);
  const list = [];
  for (const source of on.filter((s) => s.kind == "tle" && s.override)) list.push({ file: satTleSourceFile(source), group: "override", name: source.name || "NORAD " + source.norad, source: source });
  for (const letter of birdWatchTleOrder())
  {
    if (letter == "a" && settings.amsat) list.push({ file: path.join(satDir(), "dailytle.txt"), group: "amsat", name: "AMSAT TLE", source: null });
    if (letter == "l") for (const source of on.filter((s) => s.kind == "local")) list.push({ file: source.path, group: "local", name: birdWatchTleBreadcrumb(source.path), source: source });
    if (letter == "r") for (const source of on.filter((s) => s.kind == "remote")) list.push({ file: satTleSourceFile(source), group: "remote", name: source.url, source: source });
    if (letter == "m") for (const source of on.filter((s) => s.kind == "tle" && !s.override)) list.push({ file: satTleSourceFile(source), group: "typed", name: source.name || "NORAD " + source.norad, source: source });
  }
  list.push({ file: path.join(satDir(), "satnogs-tle.json"), group: "satnogs", name: "SatNOGS TLE", source: null });
  return list;
}

// ---- SatNOGS's element sets (satnogs-tle.json, birdWatchSync.js): the fallback, so a satellite AMSAT doesn't list yet (a new one, on a
// temporary catalog number) is tracked with its transmitters. Only the satellites a ham can hear: those with a live transmitter whose
// downlink is on an amateur satellite band (BIRD_WATCH_SATNOGS_BANDS), and not re-entered. Each is filed under SatNOGS's own catalog number
// (norad_cat_id), its lines renumbered to it where they carry another (a temporary number's real one), and named as SatNOGS names it.
// Read again only when one of its files changes

// The amateur satellite service's downlink bands (Hz)
const BIRD_WATCH_SATNOGS_BANDS = [[28.0e6, 29.7e6], [144.0e6, 146.0e6], [435.0e6, 438.0e6], [2400e6, 2450e6], [5830e6, 5850e6], [10450e6, 10500e6], [24048e6, 24050e6]];

GT.birdWatchSatnogsTle = { stamp: "", sets: [] };

function birdWatchSatnogsSets(file)
{
  const C = GT.birdWatchSatnogsTle;
  try
  {
    const files = [file, path.join(satDir(), "transmitters.json"), path.join(satDir(), "satellites.json")];
    const stamp = files.map((f) => { const stat = fs.statSync(f); return stat.mtimeMs + ":" + stat.size; }).join("|");
    if (stamp == C.stamp) return C.sets;
    const heard = new Set();
    for (const t of JSON.parse(fs.readFileSync(files[1], "utf8")))
    {
      const hz = Number(t.downlink_low);
      if (t && t.alive && BIRD_WATCH_SATNOGS_BANDS.some(([low, high]) => hz >= low && hz <= high)) heard.add(t.sat_id);
    }
    const sets = [];
    for (const item of JSON.parse(fs.readFileSync(file, "utf8")))
    {
      const norad = Number(item && item.norad_cat_id);
      if (!(norad > 0 && norad <= 99999) || !heard.has(item.sat_id) || typeof item.tle1 != "string" || typeof item.tle2 != "string") continue;
      const info = birdWatchSatInfo(norad);
      if (info && info.status == "re-entered") continue;
      const name = (info && info.name) || String(item.tle0 || "").replace(/^0 /, "").trim();
      const set = birdWatchTleParse(name + "\n" + item.tle1.trim() + "\n" + item.tle2.trim())[0];
      if (set) sets.push(set.norad == norad ? set : birdWatchTleRenumbered(set, norad));
    }
    C.sets = sets;
    C.stamp = stamp;
  }
  catch (e)
  {
    // Not fetched yet (it isn't shipped), or unreadable: none
    C.sets = [];
    C.stamp = "";
  }
  return C.sets;
}

// An element set under another catalog number: both lines' numbers changed to it, their checksums written again
function birdWatchTleRenumbered(set, norad)
{
  const id = String(norad).padStart(5, "0");
  const fix = (line) =>
  {
    const body = line.slice(0, 2) + id + line.slice(7, 68);
    return body + birdWatchTleChecksum(body);
  };
  return birdWatchTleSet(norad, set.name, fix(set.line1), fix(set.line2), set.epoch);
}

// The element set files in use, for whatever uses them, first to win first
function birdWatchTleFiles()
{
  return birdWatchTleOrdered().map((entry) => entry.file);
}

// TLE Precedence: a choice of every order of AMSAT, Local, Remote and Manual, and the one chosen
function birdWatchTlePermutations(letters)
{
  if (letters.length <= 1) return [letters];
  return [...letters].flatMap((letter, i) => birdWatchTlePermutations(letters.slice(0, i) + letters.slice(i + 1)).map((rest) => letter + rest));
}

function birdWatchTlePrecedenceRender()
{
  const orders = birdWatchTlePermutations(TLE_GROUPS);
  birdWatchTlePrecedence.replaceChildren(...orders.map((order) =>
  {
    const option = document.createElement("option");
    option.value = order;
    option.textContent = [...order].map((letter) => TLE_GROUP_NAMES[letter]()).join(", ");
    return option;
  }));
  birdWatchTlePrecedence.value = birdWatchTleOrder();
}

function birdWatchTleSetPrecedence()
{
  birdWatchTleSettings().precedence = birdWatchTlePrecedence.value;
  birdWatchTleDirty();
}

// ---- The list in memory

// The element sets in a text: [birdWatchTleSet], one for each satellite (the newest if a file has
// it twice). A line 0 before the two lines is the name, if there is one
function birdWatchTleParse(text)
{
  const lines = text.split(/\r?\n/).map((line) => line.trimEnd());
  const checksum = (line) =>
  {
    let total = 0;
    for (let i = 0; i < 68; i++) total += /\d/.test(line[i]) ? Number(line[i]) : (line[i] == "-" ? 1 : 0);
    return total % 10 == Number(line[68]);
  };
  const sets = new Map();
  for (let i = 0; i < lines.length - 1; i++)
  {
    const one = lines[i];
    const two = lines[i + 1];
    if (!/^1 \d{5}/.test(one) || !/^2 \d{5}/.test(two) || one.length != 69 || two.length != 69 || one.slice(2, 7) != two.slice(2, 7) || !checksum(one) || !checksum(two)) continue;
    const before = i > 0 ? lines[i - 1].trim() : "";
    const year = Number(one.slice(18, 20));
    const epoch = Date.UTC(year < 57 ? 2000 + year : 1900 + year, 0, 1) + (Number(one.slice(20, 32)) - 1) * 86400000;
    const norad = Number(one.slice(2, 7));
    const known = sets.get(norad);
    if (!known || epoch > known.epoch) sets.set(norad, birdWatchTleSet(norad, /^[12] \d{5}/.test(before) ? "" : before, one, two, epoch));
    i++;
  }
  return [...sets.values()];
}

// A source's element sets: a file is read again only when it changed (its time and size), a typed TLE is its own text
function birdWatchTleSetsOf(entry)
{
  const L = GT.birdWatchTles;
  if (entry.group == "satnogs") return birdWatchSatnogsSets(entry.file);
  if (entry.source && entry.source.kind == "tle")
  {
    const s = entry.source;
    return birdWatchTleParse((s.name ? s.name + "\n" : "") + s.line1 + "\n" + s.line2);
  }
  try
  {
    const stat = fs.statSync(entry.file);
    const key = stat.mtimeMs + ":" + stat.size;
    const known = L.parsed.get(entry.file);
    if (known && known.key == key) return known.sets;
    const sets = birdWatchTleParse(fs.readFileSync(entry.file, "utf8"));
    L.parsed.set(entry.file, { key: key, sets: sets });
    return sets;
  }
  catch (e)
  {
    L.parsed.delete(entry.file);
    return [];
  }
}

// The list again, from the sources in order: the first to have a satellite has it. Only while BirdWatch is on. The same as before
// (most renders of the Telemetry tab change nothing): the listeners aren't told, so the tracker keeps the passes and the Skeds it has.
// An element set for the real number a SatNOGS satellite on a temporary one follows (birdWatchSatFollows) is that satellite's, under its
// temporary number (where its transmitters are), so it is listed once
function birdWatchTleRebuild()
{
  const L = GT.birdWatchTles;
  L.timer = null;
  const map = new Map();
  if (GT.settings.BirdWatch.enable)
  {
    const amsat = birdWatchAmsatNorads();
    const follows = birdWatchSatFollows();
    const db = GT.birdWatchDb ? GT.birdWatchDb.map : new Map();
    for (const entry of birdWatchTleOrdered())
    {
      for (let set of birdWatchTleSetsOf(entry))
      {
        const as = follows.get(set.norad);
        // (AMSAT may list it by either number: a SatNOGS one on a temporary number by the real one it follows)
        const info = db.get(as !== undefined ? as : set.norad);
        const amateur = amsat.has(set.norad) || (as !== undefined && amsat.has(as)) || (!!info && amsat.has(Number(info.norad_follow_id)));
        if (as !== undefined) set = birdWatchTleRenumbered(set, as);
        if (!map.has(set.norad)) map.set(set.norad, birdWatchTleEntry(set, entry.group, entry.name, amateur));
      }
    }
  }
  const same = map.size == L.map.size && [...map.values()].every((e) =>
  {
    const known = L.map.get(e.norad);
    return !!known && known.line1 == e.line1 && known.line2 == e.line2 && known.name == e.name && known.group == e.group && known.source == e.source && known.amsat == e.amsat;
  });
  L.built = Date.now();

  if (typeof birdWatchTleListStatus != "undefined") birdWatchTleListStatus.textContent = I18N("birdWatch.tle.sets.label").replace("{n}", map.size);
  if (same) return;
  L.map = map;
  L.version++;
  for (const listener of L.listeners)
  {
    try
    {
      listener(L.map, L.version);
    }
    catch (e)
    {
      console.warn("BirdWatch TLE listener: " + e.message);
    }
  }
}

// Something that the list is made of changed (a source, a file, the precedence): rebuilt in a moment, once for a burst of changes
function birdWatchTleDirty()
{
  const L = GT.birdWatchTles;
  if (L.timer) return;
  L.timer = nodeTimers.setTimeout(birdWatchTleRebuild, 150);
}

// The TLE in use for a satellite (a birdWatchTleEntry) or null
function birdWatchTleGet(norad)
{
  return GT.birdWatchTles.map.get(Number(norad)) || null;
}

// All of them, by catalog number
function birdWatchTleList()
{
  return [...GT.birdWatchTles.map.values()].sort((a, b) => a.norad - b.norad);
}

// fn(map, version) is called each time the list is rebuilt
function birdWatchTleListen(fn)
{
  GT.birdWatchTles.listeners.push(fn);
}

// The element sets in a file: how many, or an error
function birdWatchTleReadFile(file)
{
  try
  {
    const sets = satTleCount(fs.readFileSync(file, "utf8"));
    return { count: sets.valid, error: sets.valid < 1 ? "no element sets in the file" : "" };
  }
  catch (e)
  {
    return { count: 0, error: e.code == "ENOENT" ? "missing" : e.message };
  }
}

function birdWatchTleLocalUpdate(source)
{
  const result = birdWatchTleReadFile(source.path);
  source.count = result.count;
  source.error = result.error;
  source.loaded = Date.now();
}

// Called when a source's element sets changed (the file, a load): the window shows it; whatever uses them can follow here
function birdWatchTleChanged()
{
  birdWatchTleRender();
}

// ---- Watching the local files: one watcher for each folder (not each file: editors replace files, which a watch on the
// file itself loses), only while BirdWatch is on. Events, not polling
function birdWatchTleWatchUpdate()
{
  const W = GT.birdWatchTle;
  const wanted = new Map();
  if (GT.settings.BirdWatch.enable)
  {
    for (const source of birdWatchTleSettings().sources)
    {
      if (source.kind != "local" || !birdWatchTleEnabled(source)) continue;
      const dir = path.dirname(source.path);
      if (!wanted.has(dir)) wanted.set(dir, new Set());
      wanted.get(dir).add(path.basename(source.path).toLowerCase());
    }
  }

  for (const [dir, watcher] of W.watchers)
  {
    if (!wanted.has(dir))
    {
      watcher.close();
      W.watchers.delete(dir);
    }
  }

  for (const [dir, names] of wanted)
  {
    if (W.watchers.has(dir)) continue;
    try
    {
      const watcher = fs.watch(dir, { persistent: false }, (event, filename) =>
      {
        if (!filename) return;
        const name = String(filename).toLowerCase();
        for (const source of birdWatchTleSettings().sources)
        {
          if (source.kind == "local" && birdWatchTleEnabled(source) && path.dirname(source.path) == dir && path.basename(source.path).toLowerCase() == name) birdWatchTleLocalChanged(source);
        }
      });
      watcher.on("error", () =>
      {
        watcher.close();
        W.watchers.delete(dir);
      });
      W.watchers.set(dir, watcher);
    }
    catch (e)
    {
      console.warn("BirdWatch: can't watch " + dir + ": " + e.message);
    }
  }

  // The files may have changed while nothing was watching
  if (GT.settings.BirdWatch.enable)
  {
    for (const source of birdWatchTleSettings().sources) if (source.kind == "local" && birdWatchTleEnabled(source)) birdWatchTleLocalUpdate(source);
  }
  birdWatchTleDirty();
}

// A saving program writes a file in several steps, and a tool may rewrite it for a while: wait until it settles
function birdWatchTleLocalChanged(source)
{
  const W = GT.birdWatchTle;
  nodeTimers.clearTimeout(W.timers.get(source.id));
  W.timers.set(source.id, nodeTimers.setTimeout(() =>
  {
    W.timers.delete(source.id);
    birdWatchTleLocalUpdate(source);
    birdWatchTleChanged();
  }, TLE_WATCH_DELAY));
}

// ---- The tab

function birdWatchTleStatus(source)
{
  if (GT.birdWatchTle.busy.has(source.id)) return "…";
  if (source.error == "missing") return I18N("birdWatch.tle.missing.label");
  if (source.error) return source.error;
  if (!source.loaded) return I18N("birdWatch.tle.notLoaded.label");
  return I18N("birdWatch.tle.sets.label").replace("{n}", source.count);
}

// The Enable box at the start of a source's row: "Enable" in white, the name after it in its own color
function birdWatchTleEnableBox(source)
{
  const label = document.createElement("label");
  label.className = "birdTleEnable";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = birdWatchTleEnabled(source);
  box.onclick = () => birdWatchTleSetEnabled(source, box.checked);
  label.append(box, " " + I18N("birdWatch.tle.enable.label"));
  return label;
}

// Turned on again, a local file is watched again, and a remote one that is out of date is loaded now
function birdWatchTleSetEnabled(source, on)
{
  source.enabled = on;
  if (source.kind == "local") birdWatchTleWatchUpdate();
  if (on && source.kind == "remote" && satSyncAllowed() && (!source.loaded || source.error || Date.now() - source.loaded > 24 * 3600 * 1000)) birdWatchTleLoad(source);
  birdWatchTleRender();
}

function birdWatchTleButton(text, hover, onclick)
{
  const button = document.createElement("div");
  button.className = "button birdTleButton";
  button.textContent = text;
  button.title = hover;
  button.onclick = onclick;
  return button;
}

// A local file's path for the list: the end of it, at most 30 characters, starting at a folder and with "..." in front when
// there was more (...\taglo\Downloads\ALL.TXT). The row's hover has the whole path
function birdWatchTleBreadcrumb(filePath)
{
  const LIMIT = 30;
  if (filePath.length <= LIMIT) return filePath;
  const tail = filePath.slice(-LIMIT);
  const folder = tail.search(/[\\/]/);
  return "..." + (folder > 0 ? tail.slice(folder) : tail);
}

// A manual TLE's editor, in its row: the form, with the values it has (a satellite's own catalog number stays)
function birdWatchTleTypedEditor(source)
{
  const form = birdWatchTleFormElement({
    name: source.name,
    line1: source.line1,
    line2: source.line2,
    fixedNorad: true,
    onSave: (text) => birdWatchTleSaveEdit(source, text),
    onCancel: () =>
    {
      GT.birdWatchTle.editing.delete(source.id);
      GT.birdWatchTle.drafts = GT.birdWatchTle.drafts.filter((draft) => draft !== source);
      birdWatchTleRender();
    }
  });
  form.dataset.id = source.id;
  return form;
}

// A typed TLE's row: the satellite, and the date of its element set
function birdWatchTleTypedRow(source)
{
  if (GT.birdWatchTle.editing.has(source.id)) return birdWatchTleTypedEditor(source);
  const row = document.createElement("div");
  row.className = "birdTleRow";
  const name = document.createElement("span");
  name.className = "birdTleName";
  name.textContent = source.name || "NORAD " + source.norad;
  name.title = source.line1 + "\n" + source.line2;
  const epoch = document.createElement("span");
  epoch.className = "birdTleStatus";
  const year = Number(source.line1.slice(18, 20));
  epoch.textContent = new Date(Date.UTC(year < 57 ? 2000 + year : 1900 + year, 0, 1) + (Number(source.line1.slice(20, 32)) - 1) * 86400000).toLocaleDateString();
  row.append(birdWatchTleEnableBox(source));
  if (source.override)
  {
    const badge = document.createElement("span");
    badge.className = "birdTleOverride";
    badge.textContent = I18N("birdWatch.tle.override.label");
    row.append(badge);
  }
  row.append(name, epoch);
  if (!birdWatchTleEnabled(source)) row.classList.add("birdTleOff");
  row.append(birdWatchTleButton("✎", I18N("birdWatch.tle.edit.hover"), () =>
  {
    GT.birdWatchTle.editing.add(source.id);
    birdWatchTleRender();
  }));
  row.append(birdWatchTleButton("✕", I18N("birdWatch.tle.remove.hover"), () => birdWatchTleRemove(source)));
  return row;
}

function birdWatchTleRow(source)
{
  if (source.kind == "tle") return birdWatchTleTypedRow(source);
  const W = GT.birdWatchTle;
  const remote = source.kind == "remote";
  const wrap = document.createElement("div");
  const row = document.createElement("div");
  row.className = "birdTleRow";

  const kind = document.createElement("span");
  kind.className = "birdTleKind";
  kind.textContent = remote ? TLE_TYPE_NAMES[satSourceType(source)] : "";
  const name = document.createElement("span");
  name.className = "birdTleName";
  name.textContent = remote ? source.url : birdWatchTleBreadcrumb(source.path);
  // A local file: the whole path, and that changes in it are picked up
  name.title = remote ? source.url : source.path + "\n" + I18N("birdWatch.tle.watch.hover");
  const status = document.createElement("span");
  status.className = "birdTleStatus" + (source.error ? " birdTleError" : "");
  status.textContent = birdWatchTleStatus(source);
  status.title = status.textContent;
  row.append(birdWatchTleEnableBox(source));
  if (remote) row.append(kind);
  row.append(name, status);
  if (!birdWatchTleEnabled(source)) row.classList.add("birdTleOff");

  if (remote)
  {
    // Every 24 hours: once it has been loaded
    const label = document.createElement("label");
    label.className = "birdTleRefresh";
    const refresh = document.createElement("input");
    refresh.type = "checkbox";
    refresh.checked = source.refresh == true;
    refresh.disabled = !source.loaded || source.error != "";
    refresh.onclick = () => { source.refresh = refresh.checked; };
    label.append(refresh, " " + I18N("birdWatch.tle.refresh.label"));
    row.append(label);
    row.append(birdWatchTleButton("🔑", I18N("birdWatch.tle.login.hover"), () =>
    {
      if (W.showLogin.has(source.id)) W.showLogin.delete(source.id);
      else W.showLogin.add(source.id);
      birdWatchTleRender();
    }));
    row.append(birdWatchTleButton("↻", I18N("birdWatch.tle.reload.hover"), () => birdWatchTleLoad(source)));
  }
  row.append(birdWatchTleButton("✕", I18N("birdWatch.tle.remove.hover"), () => birdWatchTleRemove(source)));
  wrap.append(row);

  if (remote && W.showLogin.has(source.id))
  {
    const login = document.createElement("div");
    login.className = "birdTleLogin";
    const field = (key, type, labelKey) =>
    {
      const label = document.createElement("label");
      label.textContent = I18N(labelKey) + " ";
      const input = document.createElement("input");
      input.type = type;
      input.className = "inputTextValue";
      input.size = 14;
      input.value = source[key] || "";
      // Not the browser's saved logins: only what's typed here is the source's
      input.autocomplete = "new-password";
      input.readOnly = true;
      input.onfocus = () => { input.readOnly = false; };
      input.oninput = () => { source[key] = input.value; };
      label.append(input);
      // A password has the show / hide button every other password in Settings has
      if (type == "password") stylePasswordInput(input);
      return label;
    };
    login.append(field("user", "text", "birdWatch.tle.user.label"), field("pass", "password", "birdWatch.tle.pass.label"));
    wrap.append(login);
  }
  return wrap;
}

function birdWatchTleRender()
{
  if (typeof birdWatchTleLocalList == "undefined") return;
  const settings = birdWatchTleSettings();

  birdWatchTlePrecedenceRender();
  birdWatchTleDirty();
  birdWatchTleAmsat.checked = settings.amsat;
  birdWatchTleAmsatEnable.lastChild.textContent = " " + I18N("birdWatch.tle.enable.label");
  let amsat = I18N("birdWatch.tle.off.label");
  if (settings.amsat)
  {
    const file = path.join(satDir(), "dailytle.txt");
    try
    {
      const sets = satTleCount(fs.readFileSync(file, "utf8")).valid;
      amsat = I18N("birdWatch.tle.sets.label").replace("{n}", sets) + " · " + fs.statSync(file).mtime.toLocaleDateString();
    }
    catch (e)
    {
      amsat = I18N("birdWatch.tle.notLoaded.label");
    }
  }
  birdWatchTleAmsatStatus.textContent = amsat;

  // Each list, in its own box, only while it has something in it
  for (const kind of ["local", "remote", "tle"])
  {
    const rows = (kind == "tle" ? GT.birdWatchTle.drafts : []).concat(settings.sources.filter((s) => s.kind == kind)).map(birdWatchTleRow);
    const name = { local: "Local", remote: "Remote", tle: "Typed" }[kind];
    document.getElementById("birdWatchTle" + name + "List").replaceChildren(...rows);
    document.getElementById("birdWatchTle" + name + "Box").style.display = rows.length ? "" : "none";
  }
}

// Use AMSAT TLE: ticked, the daily file is fetched now and with each pass; unticked, it isn't fetched at all
function birdWatchTleSetAmsat()
{
  birdWatchTleSettings().amsat = birdWatchTleAmsat.checked;
  birdWatchTleRender();
  if (birdWatchTleAmsat.checked && satSyncAllowed())
  {
    fs.promises.mkdir(satDir(), { recursive: true })
      .then(() => satSyncList("dailytle", satSyncState()))
      .catch((e) => console.warn("BirdWatch AMSAT TLE: " + e.message))
      .then(birdWatchTleRender);
  }
}

function birdWatchTleAddLocal()
{
  const W = GT.birdWatchTle;
  if (!W.fileSelector)
  {
    W.fileSelector = document.createElement("input");
    W.fileSelector.type = "file";
    W.fileSelector.multiple = true;
    W.fileSelector.accept = ".txt,.tle,.3le,.dat,.tl,.all";
    W.fileSelector.onchange = () =>
    {
      for (const file of W.fileSelector.files)
      {
        const filePath = webUtils.getPathForFile(file);
        if (birdWatchTleSettings().sources.some((s) => s.kind == "local" && s.path == filePath)) continue;
        const source = { id: window.require("crypto").randomBytes(4).toString("hex"), kind: "local", enabled: true, path: filePath, loaded: 0, count: 0, error: "" };
        birdWatchTleLocalUpdate(source);
        birdWatchTleSettings().sources.push(source);
      }
      W.fileSelector.value = "";
      birdWatchTleWatchUpdate();
      birdWatchTleRender();
    };
  }
  W.fileSelector.click();
}

// The address as a kind of source: a web address (http or https) or an FTP one. Returns null when it isn't either
function birdWatchTleAddress(text)
{
  try
  {
    const address = new URL(text);
    if (address.protocol == "https:" || address.protocol == "http:") return { type: "http", url: address.href };
    if (address.protocol == "ftp:") return { type: "ftp", url: address.href };
  }
  catch (e)
  {
    // Not an address
  }
  return null;
}

// Add TLE: Local, Remote, TLE or Manual. Remote shows the address and, under it, the login; TLE shows a text for the two lines and,
// under it, whether they're a valid TLE; Manual shows the form of a TLE's values, with a save of its own; the + is at the right of the others
function birdWatchTleModeChanged()
{
  const mode = birdWatchTleMode.value;
  birdWatchTleUrl.style.display = mode == "remote" ? "" : "none";
  birdWatchTleLoginLine.style.display = mode == "remote" ? "" : "none";
  birdWatchTleText.style.display = mode == "tle" ? "" : "none";
  birdWatchTleMessage.style.display = mode == "tle" ? "" : "none";
  birdWatchTleManual.style.display = mode == "manual" ? "" : "none";
  birdWatchTleAddButton.style.display = mode == "manual" ? "none" : "";
  if (mode == "manual" && !birdWatchTleManual.firstChild) birdWatchTleManualReset();
  birdWatchTleNotice.style.display = "none";
  const key = { local: "birdWatch.tle.addLocal.hover", remote: "birdWatch.tle.addRemote.hover", tle: "birdWatch.tle.addTle.hover" }[mode];
  if (key)
  {
    birdWatchTleAddButton.title = I18N(key);
    birdWatchTleAddButton.setAttribute("data-i18n", key);
  }
  if (mode == "remote" && birdWatchTleUrl.value.trim() == "") birdWatchTleUrl.value = "https://";
  if (mode == "tle") birdWatchTleTextChanged();
  else birdWatchTleAddButton.classList.remove("birdTleDisabled");
}

function birdWatchTleAddClicked()
{
  if (birdWatchTleMode.value == "remote") birdWatchTleAddRemote();
  else if (birdWatchTleMode.value == "tle") birdWatchTleAddTyped();
  else birdWatchTleAddLocal();
}

// ---- A TLE typed or pasted: the two lines, with a name line before them if you like

// Is the text a TLE? { state: "empty" | "partial" | "bad" | "ok", message, name, norad, line1, line2 }
function birdWatchTleValidate(text)
{
  const lines = text.split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim() != "");
  if (lines.length == 0) return { state: "empty", message: I18N("birdWatch.tle.check.lines.label") };
  if (lines.length < 2 || lines.length > 3) return { state: "partial", message: I18N("birdWatch.tle.check.lines.label") };

  const name = lines.length == 3 ? lines[0].trim() : "";
  const line1 = lines[lines.length - 2];
  const line2 = lines[lines.length - 1];
  const bad = (key) => ({ state: "bad", message: I18N(key) });
  if (line1.length != 69 || line2.length != 69 || !/^1 \d{5}/.test(line1) || !/^2 \d{5}/.test(line2)) return bad("birdWatch.tle.check.format.label");

  const checksum = (line) =>
  {
    let total = 0;
    for (let i = 0; i < 68; i++) total += /\d/.test(line[i]) ? Number(line[i]) : (line[i] == "-" ? 1 : 0);
    return total % 10 == Number(line[68]);
  };
  if (!checksum(line1) || !checksum(line2)) return bad("birdWatch.tle.check.checksum.label");
  if (line1.slice(2, 7) != line2.slice(2, 7)) return bad("birdWatch.tle.check.satellite.label");

  const norad = Number(line1.slice(2, 7));
  return { state: "ok", name: name, norad: norad, line1: line1, line2: line2, message: I18N("birdWatch.tle.check.ok.label").replace("{name}", name || "NORAD " + norad) };
}

// As it's typed: the text's border and the line under it say whether it's a TLE, and the + waits until it is
function birdWatchTleTextChanged()
{
  const result = birdWatchTleValidate(birdWatchTleText.value);
  birdWatchTleMessage.textContent = result.message;
  birdWatchTleMessage.className = "birdTleMessage" + (result.state == "ok" ? " birdTleOk" : result.state == "bad" ? " birdTleBad" : "");
  birdWatchTleText.classList.toggle("birdTleTextOk", result.state == "ok");
  birdWatchTleText.classList.toggle("birdTleTextBad", result.state == "bad");
  birdWatchTleAddButton.classList.toggle("birdTleDisabled", result.state != "ok");
  birdWatchTleText.title = I18N("birdWatch.tle.check.lines.label");
}

// ---- Overrides: a typed TLE can stand in for the same satellite's TLE in another enabled source (and only a typed one can)

// Where a satellite is already, in the AMSAT file or an enabled local or remote source (the first by precedence): { source: its name } or null
function birdWatchTleFind(norad)
{
  const scan = (file) =>
  {
    try
    {
      return fs.readFileSync(file, "utf8").split(/\r?\n/).some((line) => /^1 \d{5}/.test(line) && Number(line.slice(2, 7)) == norad);
    }
    catch (e)
    {
      return false;
    }
  };
  // The first of AMSAT, the local and the remote sources that has it, in the order of TLE Precedence; then SatNOGS's (JSON: its sets)
  for (const entry of birdWatchTleOrdered())
  {
    if (entry.group == "satnogs" ? birdWatchSatnogsSets(entry.file).some((set) => set.norad == norad) : entry.group != "typed" && entry.group != "override" && scan(entry.file)) return { source: entry.name };
  }
  return null;
}

// The satellites a typed override stands in for, for whatever uses the element sets: use these TLEs, not the others' for them
function birdWatchTleOverrides()
{
  return new Set(birdWatchTleSettings().sources.filter((s) => s.kind == "tle" && s.override && birdWatchTleEnabled(s)).map((s) => s.norad));
}

// The address is AMSAT's own element sets, which are built in
function birdWatchTleIsAmsat(address)
{
  try
  {
    const url = new URL(address);
    return /(^|\.)amsat\.org$/i.test(url.hostname) && /^\/tle\//i.test(url.pathname);
  }
  catch (e)
  {
    return false;
  }
}

// A line under the add row that goes by itself
function birdWatchTleNoticeShow(text)
{
  birdWatchTleNotice.textContent = text;
  birdWatchTleNotice.style.display = "";
  nodeTimers.clearTimeout(GT.birdWatchTle.noticeTimer);
  GT.birdWatchTle.noticeTimer = nodeTimers.setTimeout(() => { birdWatchTleNotice.style.display = "none"; }, 8000);
}

// Kept as a file with the others (Ginternal\sat\tle), for whatever uses the element sets
function birdWatchTleSaveTypedFile(source)
{
  fs.promises.mkdir(path.join(satDir(), SAT_TLE_FOLDER), { recursive: true })
    .then(() => satWriteFile(satTleSourceFile(source), (source.name ? source.name + "\n" : "") + source.line1 + "\n" + source.line2 + "\n"))
    .catch((e) => console.warn("BirdWatch: TLE not saved: " + e.message));
}

// The edited text replaces the TLE in its place (it can be another satellite's: a TLE that was already there for that
// satellite is replaced)
function birdWatchTleSaveEdit(source, text)
{
  const result = birdWatchTleValidate(text);
  if (result.state != "ok") return;
  const settings = birdWatchTleSettings();
  // A draft (edited from the Satellites tab) becomes a typed TLE now
  if (GT.birdWatchTle.drafts.includes(source))
  {
    GT.birdWatchTle.drafts = GT.birdWatchTle.drafts.filter((draft) => draft !== source);
    settings.sources.push(source);
  }
  const found = birdWatchTleFind(result.norad);
  if (found && !source.override && result.norad != source.norad && !window.confirm(I18N("birdWatch.tle.exists.label").replace("{norad}", result.norad).replace("{source}", found.source))) return;
  for (const other of settings.sources.filter((s) => s.kind == "tle" && s !== source && s.norad == result.norad)) birdWatchTleRemove(other);
  source.override = found != null;
  source.name = result.name;
  source.norad = result.norad;
  source.line1 = result.line1;
  source.line2 = result.line2;
  source.loaded = Date.now();
  GT.birdWatchTle.editing.delete(source.id);
  birdWatchTleSaveTypedFile(source);
  birdWatchTleRender();
}

// From a tracked satellite's row (Satellites tab): its TLE in the editor of the Telemetry tab, with the focus in it. Saved, it is a typed
// TLE that overrides the one the satellite had; one that is typed already is edited as it is
function birdWatchTleEditSatellite(norad)
{
  const W = GT.birdWatchTle;
  let source = birdWatchTleSettings().sources.find((s) => s.kind == "tle" && s.norad == norad) || W.drafts.find((s) => s.norad == norad);
  if (!source)
  {
    const tle = birdWatchTleGet(norad);
    if (!tle) return;
    source = { id: window.require("crypto").randomBytes(4).toString("hex"), kind: "tle", enabled: true, name: tle.name, norad: norad, line1: tle.line1, line2: tle.line2, override: true, loaded: Date.now(), count: 1, error: "" };
    W.drafts.push(source);
  }
  W.editing.add(source.id);
  showBirdWatchSettings("birdWatchTelemetryDiv");
  const form = birdWatchTleTypedList.querySelector("[data-id=\"" + source.id + "\"]");
  if (!form) return;
  form.focusFirst();
  // Into view in the tab (not scrollIntoView: that can scroll the whole page)
  const tab = birdWatchTelemetryDiv;
  const bounds = tab.getBoundingClientRect();
  const box = form.getBoundingClientRect();
  if (box.bottom > bounds.bottom) tab.scrollTop += box.bottom - bounds.bottom + 6;
  if (box.top < bounds.top) tab.scrollTop -= bounds.top - box.top + 6;
}

function birdWatchTleAddTyped(overrideConfirmed = false)
{
  const result = birdWatchTleValidate(birdWatchTleText.value);
  if (result.state != "ok") return;

  // Already in an enabled source? Say so, and ask: the answer is an override, or nothing is added
  const found = birdWatchTleFind(result.norad);
  if (found && !overrideConfirmed)
  {
    birdWatchTleMessage.textContent = I18N("birdWatch.tle.exists.label").replace("{norad}", result.norad).replace("{source}", found.source);
    birdWatchTleMessage.className = "birdTleMessage birdTleBad";
    birdWatchTleMessage.append(
      birdWatchTleButton(I18N("birdWatch.tle.override.label"), I18N("birdWatch.tle.override.label"), () => birdWatchTleAddTyped(true)),
      birdWatchTleButton(I18N("birdWatch.tle.cancel.hover"), I18N("birdWatch.tle.cancel.hover"), () => birdWatchTleTextChanged())
    );
    birdWatchTleAddButton.classList.add("birdTleDisabled");
    return;
  }

  birdWatchTleCommitTyped(result, found);
  birdWatchTleText.value = "";
  birdWatchTleTextChanged();
}

// The TLE as a source of its own: an override when the satellite is in another enabled source (found)
function birdWatchTleCommitTyped(result, found)
{
  // One for each satellite: a newer set of the same one replaces it
  const settings = birdWatchTleSettings();
  for (const old of settings.sources.filter((s) => s.kind == "tle" && s.norad == result.norad)) birdWatchTleRemove(old);
  const source = { id: window.require("crypto").randomBytes(4).toString("hex"), kind: "tle", enabled: true, name: result.name, norad: result.norad, line1: result.line1, line2: result.line2, override: found != null, loaded: Date.now(), count: 1, error: "" };
  settings.sources.push(source);

  birdWatchTleSaveTypedFile(source);
  birdWatchTleRender();
}

// Add > Manual: the form with nothing in it
function birdWatchTleManualReset()
{
  birdWatchTleManual.replaceChildren(birdWatchTleFormElement({ onSave: birdWatchTleManualAdd, onCancel: birdWatchTleManualReset }));
}

// The form's TLE: added, as an override when the satellite is already in an enabled source (and that is asked first)
function birdWatchTleManualAdd(text)
{
  const result = birdWatchTleValidate(text);
  if (result.state != "ok") return;
  const found = birdWatchTleFind(result.norad);
  if (found && !window.confirm(I18N("birdWatch.tle.exists.label").replace("{norad}", result.norad).replace("{source}", found.source))) return;
  birdWatchTleCommitTyped(result, found);
  birdWatchTleManualReset();
}

// An address without a login in it (https://user:pass@host/file): shown and kept without
function birdWatchTleCleanUrl(address)
{
  try
  {
    const url = new URL(address);
    url.username = "";
    url.password = "";
    return url.href;
  }
  catch (e)
  {
    return address;
  }
}

// The add row's password box emptied, hidden again, and its show / hide button gone
function birdWatchTleClearPassword()
{
  const input = birdWatchTlePass;
  if (input.type == "text" && input.nextElementSibling) input.nextElementSibling.click();
  input.value = "";
  input.dispatchEvent(new Event("input"));
}

function birdWatchTleAddRemote()
{
  const settings = birdWatchTleSettings();
  const address = birdWatchTleAddress(birdWatchTleUrl.value.trim());
  if (!address) return;

  // AMSAT's element sets are built in: ticking Enable on its line is how to use them
  if (birdWatchTleIsAmsat(address.url))
  {
    birdWatchTleNoticeShow(I18N(settings.amsat ? "birdWatch.tle.aborted.label" : "birdWatch.tle.amsatEnable.label"));
    return;
  }

  // The login: the username and password boxes if there is anything in them, else a user:pass@ in the address. Either
  // way the address is kept (and shown) without it
  let user = birdWatchTleUser.value.trim();
  let pass = birdWatchTlePass.value;
  if (!user && !pass)
  {
    const inUrl = new URL(address.url);
    try
    {
      user = decodeURIComponent(inUrl.username);
      pass = decodeURIComponent(inUrl.password);
    }
    catch (e)
    {
      user = inUrl.username;
      pass = inUrl.password;
    }
  }
  const url = birdWatchTleCleanUrl(address.url);
  if (settings.sources.some((s) => s.kind == "remote" && s.url == url)) return;

  const source = {
    id: window.require("crypto").randomBytes(4).toString("hex"), kind: "remote", enabled: true, type: address.type, url: url,
    user: user, pass: pass, refresh: true, loaded: 0, count: 0, error: ""
  };
  birdWatchTleUrl.value = "https://";
  birdWatchTleUser.value = "";
  birdWatchTleClearPassword();
  settings.sources.push(source);
  birdWatchTleLoad(source);
}

// Loads a remote source now (not again within a minute, unless it failed)
async function birdWatchTleLoad(source)
{
  const W = GT.birdWatchTle;
  if (W.busy.has(source.id) || !satSyncAllowed() || !birdWatchTleEnabled(source)) return;
  if (!source.error && source.loaded && Date.now() - source.loaded < 60 * 1000) return;

  W.busy.add(source.id);
  birdWatchTleRender();
  try
  {
    await satFetchSource(source);
    W.showLogin.delete(source.id);
  }
  catch (e)
  {
    source.error = e.message;
    // The address wants a login: its fields open
    if (/HTTP 40[13]|login/i.test(e.message)) W.showLogin.add(source.id);
  }
  W.busy.delete(source.id);
  birdWatchTleRender();
}

function birdWatchTleRemove(source)
{
  const settings = birdWatchTleSettings();
  settings.sources = settings.sources.filter((s) => s !== source);
  GT.birdWatchTle.showLogin.delete(source.id);
  GT.birdWatchTle.editing.delete(source.id);
  if (source.kind != "local") fs.promises.unlink(satTleSourceFile(source)).catch(() => {});
  birdWatchTleWatchUpdate();
  birdWatchTleRender();
}
