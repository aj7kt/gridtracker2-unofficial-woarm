// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Multi-Mode Decoder's plugins ("MMD Plugin Loader Design"): each mode a plugin, a folder with a plugin.json at its top (the repo's
// plugins/mmd/<id>/), packed as <id>.asar and signed (<id>.asar.sig beside it: an Ed25519 signature over the .asar's bytes, as base64).
// Found once at startup (mmDecoderInit), checked, and listed in GT.mmdPlugins for the decoder window, which adds each one's parts and
// runs its scripts (lib/mmd/mmdPluginHost.js). No plugin code runs here.
// Where they're found, the first copy of an id winning:
//   a dev run (not installed): the repo's plugins/mmd/<id>/ folders, unpacked and unsigned (no repacking after each edit)
//   <data>\Ginternal\plugins\mmd\<id>.asar: installed ones, each loaded only with a good signature by the free-plugin key (on a dev run,
//   by the repo's dev key too, plugins/dev-key-public.txt: what tools/mmd_plugin_pack.js signs with on a developer's machine. Never trusted by an
//   installed GridTracker2)
// Each is then checked: its id the same as its file's or folder's, its api one the decoder supports (MMD_PLUGIN_API), its
// minAppVersion not newer than this GridTracker2. One that isn't loaded: one Event Viewer line saying why. One the user turned off
// (MMD.pluginsDisabled) is found but not loaded, with no line.
// Each one found and loadable: its strings merged into GT.i18n (its own keys only, never the app's: its locale's, else English), its
// settings' defaults into GT.settings.MMD where missing, each of its modes (one, or its plugin.json's modes: FT8 / FT4's two) into the
// Input Device modes (starting on another mode's input, its rig.inputFrom) and its names for GridTracker's instance (rig.instanceModes)

// The decoder's host api versions a plugin may be written for (lib/mmd/mmdPluginHost.js, MMD_HOST_API)
const MMD_PLUGIN_API = { min: 1, max: 1 };
// The free-plugin key: the public half of the key CI signs the free plugins with (its private half is the GitLab variable
// MMD_FREE_SIGNING_KEY)
const MMD_PLUGIN_FREE_KEY = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAZRrWLnaNIEvMys2cT3ndbQHL5fM+unYNkWsAnepx9pI=\n-----END PUBLIC KEY-----\n";

GT.mmdPlugins = [];

// Installed plugins' folder
function mmdPluginsFolder()
{
  return path.join(GT.appData, "plugins", "mmd");
}

// The repo's folder of them on a dev run (resources' sibling), else null
function mmdPluginsDevFolder()
{
  if (electron.ipcRenderer.sendSync("isPackaged")) return null;
  return path.join(path.dirname(resourcesPath), "plugins", "mmd");
}

// The keys an installed plugin's signature is checked against (pem): the free-plugin key, and on a dev run the repo's dev key
function mmdPluginKeys()
{
  const keys = [MMD_PLUGIN_FREE_KEY];
  const dev = mmdPluginsDevFolder();
  if (dev)
  {
    try
    {
      keys.push(fs.readFileSync(path.join(path.dirname(dev), "dev-key-public.txt"), "utf8"));
    }
    catch (e)
    {
      // None made
    }
  }
  return keys;
}

// Whether an .asar's signature (file + ".sig", base64) is good by one of keys (pem). The bytes read as they are (original-fs: the
// archive as a file, not as the folder Electron shows it as)
function mmdPluginSigned(file, keys)
{
  const ofs = require("original-fs");
  try
  {
    return mmdPluginSignedBytes(ofs.readFileSync(file), ofs.readFileSync(file + ".sig", "utf8"), keys);
  }
  catch (e)
  {
    return false;
  }
}

// Whether data (bytes) is signed by one of keys (pem): sigText the signature as base64
function mmdPluginSignedBytes(data, sigText, keys)
{
  const crypto = require("crypto");
  const sig = Buffer.from(String(sigText).trim(), "base64");
  if (sig.length != 64) return false;
  for (const pem of keys)
  {
    try
    {
      if (crypto.verify(null, data, crypto.createPublicKey(pem), sig)) return true;
    }
    catch (e)
    {
      // Not a key
    }
  }
  return false;
}

// A version "2.261110.1" (or "1.0.0") as numbers, compared part by part: below 0 when a is older than b
function mmdPluginVersionCompare(a, b)
{
  const pa = String(a || "0").split(".").map((n) => parseInt(n) || 0);
  const pb = String(b || "0").split(".").map((n) => parseInt(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++)
  {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

// Why a plugin's manifest can't be loaded here (its i18n key), else null
function mmdPluginProblem(m, id)
{
  if (!m || typeof m != "object" || m.id != id || !/^[a-z][a-z0-9]*$/.test(id)) return "mmd.plugin.badManifest";
  if (!(m.api >= MMD_PLUGIN_API.min && m.api <= MMD_PLUGIN_API.max)) return "mmd.plugin.badApi";
  if (m.minAppVersion && mmdPluginVersionCompare(gtVersionStr, m.minAppVersion) < 0) return "mmd.plugin.newerApp";
  return null;
}

// A plugin not loaded: one Event Viewer line, its name (else its file's) and why
function mmdPluginNotLoaded(name, key)
{
  const text = I18N("mmd.plugin.notLoaded").replace("{name}", name).replace("{reason}", I18N(key));
  addEvent("mmd", "<font style='color:var(--gt-error)'>" + htmlEntities(text) + "</font>");
}

// A plugin's modes (the Mode menu's values it decodes), each { id, label, group ("ham" or "utility"), inputFrom, instanceModes, bands (the
// band plans' name for it), fallScale, freqGrouping }. Its plugin.json's modes: [{ id, menu, rig, bands, features }], each field it
// leaves out the plugin's own (menu, rig, bands.mode, features); without modes, one mode named as the plugin is (NAVTEX's, WSPR's)
function mmdPluginModesOf(m, id)
{
  const list = Array.isArray(m.modes) && m.modes.length ? m.modes : [{ id }];
  const pluginBands = m.bands ? m.bands.mode || m.name : null;
  return list.filter((d) => d && /^[a-z][a-z0-9]*$/.test(String(d.id))).map((d) =>
  {
    const menu = d.menu || m.menu || {};
    const rig = d.rig || m.rig || {};
    const features = d.features || m.features || {};
    return {
      id: String(d.id),
      label: String(menu.label || m.name || d.id),
      // (its label's string key: shown translated, menu.i18n)
      i18n: menu.i18n ? String(menu.i18n) : "",
      group: menu.group == "utility" ? "utility" : "ham",
      inputFrom: rig.inputFrom ? String(rig.inputFrom) : "",
      instanceModes: Array.isArray(rig.instanceModes) ? rig.instanceModes.map(String) : null,
      bands: m.bands ? String(d.bands || pluginBands) : null,
      fallScale: typeof features.fallScale == "number" ? features.fallScale : null,
      freqGrouping: features.freqGrouping || ""
    };
  });
}

// The modes of every plugin loaded (not disabled)
function mmdPluginModeIds()
{
  return (GT.mmdPlugins || []).filter((p) => !p.disabled).flatMap((p) => p.modes.map((d) => d.id));
}

// Every plugin there is (mmDecoderInit, before the decoder window opens): GT.mmdPlugins, each { id, name, version, kind, manifest, modes
// (mmdPluginModesOf), base (its folder, or its .asar's path), url (base as a file URL), dev, disabled }
function mmdPluginsFind()
{
  // Manage Decoders...'s installs, updates and removals first, before any plugin file is opened
  mmdPluginsApplyPending();
  const S = GT.settings.MMD;
  if (!Array.isArray(S.pluginsDisabled)) S.pluginsDisabled = [];
  const found = [];
  const add = (id, base, dev) =>
  {
    if (found.some((p) => p.id == id)) return;
    let m = null;
    try
    {
      m = JSON.parse(fs.readFileSync(path.join(base, "plugin.json"), "utf8"));
    }
    catch (e)
    {
      m = null;
    }
    const problem = mmdPluginProblem(m, id);
    if (problem)
    {
      mmdPluginNotLoaded((m && m.name) || path.basename(base), problem);
      return;
    }
    found.push({ id, name: String(m.name || id), version: String(m.version || ""), kind: m.kind == "commercial" ? "commercial" : "free", manifest: m, modes: mmdPluginModesOf(m, id), base, url: require("url").pathToFileURL(base).href, dev, disabled: S.pluginsDisabled.includes(id) });
  };
  const dev = mmdPluginsDevFolder();
  if (dev)
  {
    try
    {
      for (const e of fs.readdirSync(dev, { withFileTypes: true }))
      {
        if (e.isDirectory() && fs.existsSync(path.join(dev, e.name, "plugin.json"))) add(e.name, path.join(dev, e.name), true);
      }
    }
    catch (e)
    {
      // No folder
    }
  }
  const folder = mmdPluginsFolder();
  let files = [];
  try
  {
    files = require("original-fs").readdirSync(folder).filter((f) => /\.asar$/i.test(f));
  }
  catch (e)
  {
    // None installed
  }
  if (files.length)
  {
    const keys = mmdPluginKeys();
    for (const file of files)
    {
      const id = file.replace(/\.asar$/i, "");
      if (found.some((p) => p.id == id)) continue;
      const full = path.join(folder, file);
      if (!mmdPluginSigned(full, keys)) mmdPluginNotLoaded(file, "mmd.plugin.notSigned");
      else add(id, full, false);
    }
  }
  GT.mmdPlugins = found;
  for (const p of found) if (!p.disabled) mmdPluginTake(p);
}

// Whether a setting is a plugin's own: its name starting with the plugin's id or one of its modes' (FT8 / FT4's ft8Depth, ft4SetMode),
// or one its plugin.json's settings name that isn't the decoder's own (the keyboard modes' pskSubmode)
function mmdPluginOwnKey(p, key)
{
  if ([p.id].concat(p.modes.map((d) => d.id)).some((prefix) => String(key).startsWith(prefix))) return true;
  const settings = p.manifest.settings && typeof p.manifest.settings == "object" ? p.manifest.settings : {};
  return Object.hasOwn(settings, key) && !Object.hasOwn(def_settings.MMD, key);
}

// A mode's names for GridTracker's instance (its plugin.json's rig.instanceModes), each "{setting}" in them that setting's value
// ("{setting:first}" its first word, "{setting:join}" its spaces taken out): DominoEX / THOR's ["{thorSubmode:join}", "{thorSubmode:first}"]
function mmdPluginInstanceNames(names, S)
{
  return names.map((name) => name.replace(/\{(\w+)(?::(first|join))?\}/g, (all, key, how) =>
  {
    const value = String(S[key] == null ? "" : S[key]);
    return how == "first" ? value.split(" ")[0] : how == "join" ? value.replace(/ /g, "") : value;
  }));
}

// One plugin taken up here: its strings, settings, and each of its modes' Input Device and instance names
function mmdPluginTake(p)
{
  const m = p.manifest;
  mmdPluginI18n(p);
  const S = GT.settings.MMD;
  const settings = m.settings && typeof m.settings == "object" ? m.settings : {};
  // (its own settings, the decoder window's host lets it read and set: p.ownKeys)
  p.ownKeys = Object.keys(settings).filter((key) => mmdPluginOwnKey(p, key));
  for (const key of p.ownKeys) if (S[key] === undefined) S[key] = settings[key];
  for (const d of p.modes)
  {
    if (!MMD_INPUT_MODES.includes(d.id)) MMD_INPUT_MODES.push(d.id);
    if (d.instanceModes && !Object.hasOwn(MMD_INSTANCE_MODES, d.id))
    {
      const names = d.instanceModes;
      MMD_INSTANCE_MODES[d.id] = (S) => mmdPluginInstanceNames(names, S);
    }
  }
}

// Its strings into GT.i18n: its locale's file (in its i18n folder), else English's; only keys the app hasn't
function mmdPluginI18n(p)
{
  const dir = p.manifest.i18n;
  if (!dir) return;
  for (const locale of [GT.settings.app.locale, "en"])
  {
    try
    {
      const strings = JSON.parse(fs.readFileSync(path.join(p.base, dir, locale + ".json"), "utf8"));
      for (const key in strings) if (!(key in GT.i18n)) GT.i18n[key] = strings[key];
      return;
    }
    catch (e)
    {
      // Not that locale's: the next
    }
  }
}

// The locale read again (i18n.js: tools/reload_i18n.js): each plugin's strings back in
function mmdPluginsI18n()
{
  for (const p of GT.mmdPlugins || []) if (!p.disabled) mmdPluginI18n(p);
}

// ---- Manage Decoders... (the decoder window's mmdGetMore.js shows it; the downloads and files are done here). The download server
// (tools/mmd_plugin_pack.js --publish, CI's upload-gtserv) has each plugin under a name its bytes alone have, and for each app version a
// signed list of them, <version>/plugins.json + .sig: this GridTracker2 reads its own version's only, so a test build's plugins are never
// offered to an older one. Nothing is used before its signature is checked: the list's, then each download's size, SHA-256 and its own
// signature. An install, update or removal waits in the plugins folder (<id>.asar.new + <id>.asar.sig.new, or <id>.remove) and is done
// at the next start, before any plugin file is opened (mmdPluginsApplyPending): a plugin's .asar is never replaced while it is in use
const MMD_STORE_URL = "https://download2.gridtracker.org/plugins/mmd/";
// The largest list, and the largest plugin, taken (bytes)
const MMD_STORE_LIST_MAX = 1024 * 1024;
const MMD_STORE_PLUGIN_MAX = 200 * 1024 * 1024;

// Where the lists and plugins come from: the download server; on a dev run the environment's GT_PLUGIN_STORE may name another (a URL, or
// a folder: tools/mmd_plugin_pack.js --publish's plugins/out/site/plugins/mmd/), so Manage Decoders... can be tried before anything is published
function mmdStoreBase()
{
  const other = process.env.GT_PLUGIN_STORE;
  if (other && mmdPluginsDevFolder()) return other;
  return MMD_STORE_URL;
}

// A file of the store (its path below the base, "/" separated), as a URL or a path
function mmdStoreWhere(rel)
{
  const base = mmdStoreBase();
  if (/^https?:\/\//i.test(base)) return base.replace(/\/?$/, "/") + rel;
  return path.join(base, ...rel.split("/"));
}

// A file of the store's bytes (at most max of them): a promise. An HTTP answer other than 200 fails with err.status set (404: not there)
function mmdStoreGet(rel, max)
{
  const where = mmdStoreWhere(rel);
  return new Promise((resolve, reject) =>
  {
    if (!/^https?:\/\//i.test(where))
    {
      try
      {
        const data = require("original-fs").readFileSync(where);
        if (data.length > max) throw new Error("too large");
        resolve(data);
      }
      catch (e)
      {
        if (e.code == "ENOENT") e.status = 404;
        reject(e);
      }
      return;
    }
    const req = require(where.startsWith("https:") ? "https" : "http").get(where, { headers: { "User-Agent": gtUserAgent } }, (res) =>
    {
      if (res.statusCode != 200)
      {
        res.resume();
        const e = new Error("HTTP " + res.statusCode);
        e.status = res.statusCode;
        reject(e);
        return;
      }
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) =>
      {
        size += chunk.length;
        if (size > max) req.destroy(new Error("too large"));
        else chunks.push(chunk);
      });
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("error", reject);
    // (no data for 30 seconds: given up)
    req.setTimeout(30000, () => req.destroy(new Error("no reply from the server")));
  });
}

// This version's list: a promise of its plugins, each { id, name, version, kind, api, minAppVersion, modes (their names), file, size,
// sha256 } as published, and its state here (mmdStoreState). Fails with err.status 404 when there is no list for this version, and when
// the list isn't signed by the free-plugin key (a dev run's dev key too) or isn't this version's
async function mmdStoreList()
{
  const rel = gtVersionStr + "/plugins.json";
  const list = await mmdStoreGet(rel, MMD_STORE_LIST_MAX);
  const sig = await mmdStoreGet(rel + ".sig", 4096);
  if (!mmdPluginSignedBytes(list, sig.toString("utf8"), mmdPluginKeys())) throw new Error(I18N("mmd.store.notSigned"));
  const data = JSON.parse(list.toString("utf8"));
  if (!data || data.format != 1 || data.app != gtVersionStr || !Array.isArray(data.plugins)) throw new Error(I18N("mmd.store.badList"));
  const plugins = data.plugins.filter((e) => e && /^[a-z][a-z0-9]*$/.test(e.id) && typeof e.version == "string" && typeof e.file == "string" &&
    new RegExp("^" + e.id + "/[A-Za-z0-9._-]+\\.asar$").test(e.file) && !e.file.includes("..") && Number.isInteger(e.size) && e.size > 0 &&
    e.size <= MMD_STORE_PLUGIN_MAX && /^[0-9a-f]{64}$/.test(e.sha256) && e.kind == "free" && e.api >= MMD_PLUGIN_API.min && e.api <= MMD_PLUGIN_API.max &&
    !(e.minAppVersion && mmdPluginVersionCompare(gtVersionStr, e.minAppVersion) < 0));
  for (const e of plugins)
  {
    e.name = String(e.name || e.id);
    e.modes = Array.isArray(e.modes) ? e.modes.map(String) : [];
    e.state = mmdStoreState(e.id, e.version);
    Object.assign(e, mmdStoreEnabledOf(e.id));
  }
  return plugins;
}

// The plugins installed here (loaded or turned off; not a dev run's own folders) that list hasn't: Manage Decoders... can remove them too
function mmdStoreInstalledOthers(list)
{
  return (GT.mmdPlugins || []).filter((p) => !p.dev && !list.some((e) => e.id == p.id)).map((p) => Object.assign({ id: p.id, name: p.name, version: p.version, modes: p.modes.map((d) => d.label), state: mmdStoreState(p.id, null) }, mmdStoreEnabledOf(p.id)));
}

// A plugin's Enabled: { found (found at startup, so it can be turned on or off), enabled (as set now: MMD.pluginsDisabled), wasEnabled (as
// it was at startup: loaded) }. A change is taken at the next start, as an install is
function mmdStoreEnabledOf(id)
{
  const p = (GT.mmdPlugins || []).find((x) => x.id == id);
  const disabled = GT.settings.MMD.pluginsDisabled || [];
  return { found: !!p, enabled: !disabled.includes(id), wasEnabled: !!p && !p.disabled };
}

// A plugin turned on or off (from the next start): MMD.pluginsDisabled; its Enabled again (mmdStoreEnabledOf)
function mmdStoreSetEnabled(id, on)
{
  const S = GT.settings.MMD;
  if (!Array.isArray(S.pluginsDisabled)) S.pluginsDisabled = [];
  S.pluginsDisabled = S.pluginsDisabled.filter((x) => x != id);
  if (!on) S.pluginsDisabled.push(id);
  return mmdStoreEnabledOf(id);
}

// A plugin's state here: "dev" (a dev run's own folder, which an installed one can't replace), "installPending" / "removePending" (done at
// the next start), "update" (listed newer than the one loaded), "installed", else "install". listed: the list's version, null if unlisted
function mmdStoreState(id, listed)
{
  const ofs = require("original-fs");
  const file = path.join(mmdPluginsFolder(), id);
  const loaded = (GT.mmdPlugins || []).find((p) => p.id == id);
  if (loaded && loaded.dev) return "dev";
  if (ofs.existsSync(file + ".asar.new")) return "installPending";
  if (ofs.existsSync(file + ".remove")) return "removePending";
  if (loaded) return listed && mmdPluginVersionCompare(listed, loaded.version) > 0 ? "update" : "installed";
  return "install";
}

// One of the list's plugins downloaded and checked (its size, SHA-256 and its own signature), then left to be installed at the next start:
// a promise of its new state
async function mmdStoreInstall(e)
{
  const crypto = require("crypto");
  const ofs = require("original-fs");
  const bytes = await mmdStoreGet(e.file, e.size);
  if (bytes.length != e.size || crypto.createHash("sha256").update(bytes).digest("hex") != e.sha256) throw new Error(I18N("mmd.store.badDownload"));
  const sig = (await mmdStoreGet(e.file + ".sig", 4096)).toString("utf8");
  if (!mmdPluginSignedBytes(bytes, sig, mmdPluginKeys())) throw new Error(I18N("mmd.store.notSigned"));
  const folder = mmdPluginsFolder();
  const file = path.join(folder, e.id);
  ofs.mkdirSync(folder, { recursive: true });
  // The signature first, then the plugin under a name of its own until it is whole: a half-written one is never taken
  ofs.writeFileSync(file + ".asar.sig.new", sig);
  ofs.writeFileSync(file + ".asar.part", bytes);
  ofs.renameSync(file + ".asar.part", file + ".asar.new");
  mmdStoreForget(file + ".remove");
  return mmdStoreState(e.id, e.version);
}

// An installed plugin left to be removed at the next start (anything waiting to be installed for it let go): its new state
function mmdStoreRemove(id)
{
  const file = path.join(mmdPluginsFolder(), id);
  mmdStoreUndo(id);
  require("original-fs").writeFileSync(file + ".remove", "");
  return mmdStoreState(id, null);
}

// What waits to be done for a plugin at the next start, let go: its state again (listed: the list's version, else null)
function mmdStoreUndo(id, listed = null)
{
  const file = path.join(mmdPluginsFolder(), id);
  for (const f of [".asar.new", ".asar.sig.new", ".asar.part", ".remove"]) mmdStoreForget(file + f);
  return mmdStoreState(id, listed);
}

// A file deleted, if it is there
function mmdStoreForget(file)
{
  try
  {
    require("original-fs").unlinkSync(file);
  }
  catch (e)
  {
    // Not there
  }
}

// At startup (mmdPluginsFind), before any plugin is opened: each removal done (its .asar and .sig deleted), then each install or update
// (its .asar.new and .asar.sig.new in place of the .asar and .sig), once its signature is checked again; one that fails is let go
function mmdPluginsApplyPending()
{
  const ofs = require("original-fs");
  const folder = mmdPluginsFolder();
  let names;
  try
  {
    names = ofs.readdirSync(folder);
  }
  catch (e)
  {
    return;
  }
  for (const name of names)
  {
    const m = /^([a-z][a-z0-9]*)\.remove$/.exec(name);
    if (!m) continue;
    for (const f of [".asar", ".asar.sig", ".remove"]) mmdStoreForget(path.join(folder, m[1] + f));
  }
  let keys = null;
  for (const name of names)
  {
    const m = /^([a-z][a-z0-9]*)\.asar\.new$/.exec(name);
    if (!m) continue;
    const file = path.join(folder, m[1]);
    try
    {
      keys = keys || mmdPluginKeys();
      if (mmdPluginSignedBytes(ofs.readFileSync(file + ".asar.new"), ofs.readFileSync(file + ".asar.sig.new", "utf8"), keys))
      {
        ofs.renameSync(file + ".asar.new", file + ".asar");
        ofs.renameSync(file + ".asar.sig.new", file + ".asar.sig");
        continue;
      }
    }
    catch (e)
    {
      // Not whole: let go
    }
    mmdStoreForget(file + ".asar.new");
    mmdStoreForget(file + ".asar.sig.new");
  }
  for (const name of names) if (/\.asar\.part$/.test(name)) mmdStoreForget(path.join(folder, name));
}
