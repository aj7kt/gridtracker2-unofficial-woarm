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
//   <data>\Ginternal\plugins\mmd\<id>.gt2e: installed paid ones (kind "commercial", from the commercial-plugins repo's tools/pack.js): the
//   .asar encrypted with the plugin's own content key (AES-256-GCM, format GT2E1), signed by the commercial key (<id>.gt2e.sig, over the
//   encrypted bytes), its guide beside it unencrypted (<id>.pdf). Loaded only with a good signature and a license for it (MMD.licenses:
//   tokens, mmdLicenseOf) whose call sign is this GridTracker2's (their base calls: mmdBaseCall); then decrypted and read in memory
//   (mmdPluginArchive). Nothing decrypted is ever written to disk. A dev run also takes the dev keys in GT_PAID_DEV_KEYS' folder (the
//   commercial-plugins repo's keys/: dev-signing-public.txt, dev-license-public.txt)
// Every plugin record reads its files with read(name) (a Buffer): from its folder or .asar, or from its decrypted archive
// Each is then checked: its id the same as its file's or folder's, its api one the decoder supports (MMD_PLUGIN_API), its
// minAppVersion not newer than this GridTracker2. One that isn't loaded: one Event Viewer line saying why. One the user turned off
// (MMD.pluginsDisabled) is found but not loaded, with no line.
// Each one found and loadable: its strings merged into GT.i18n (its own keys only, never the app's: its locale's, else English), its
// settings' defaults into GT.settings.MMD where missing, each of its modes (one, or its plugin.json's modes: FT8 / FT4's two) into the
// Input Device modes (starting on another mode's input, its rig.inputFrom) and its names for GridTracker's instance (rig.instanceModes)

// The decoder's host api versions a plugin may be written for (lib/mmd/mmdPluginHost.js, MMD_HOST_API)
const MMD_PLUGIN_API = { min: 1, max: 3 };
// The free-plugin key: the public half of the key CI signs the free plugins with (its private half is the GitLab variable
// MMD_FREE_SIGNING_KEY)
const MMD_PLUGIN_FREE_KEY = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAhPceOF/fPIWg9TiZvJG/iVcwVxSSB3mybNzbKoMqWms=\n-----END PUBLIC KEY-----\n";
// The commercial key: the public half of the key the commercial-plugins repo's CI signs the paid plugins and their lists with
// (COMMERCIAL_SIGNING_KEY there); the license key: the public half of the one license tokens are signed with
const MMD_PLUGIN_COMMERCIAL_KEY = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAOTv0WZ77G4TSJyFZPDBVYPDxW0yxmQZYy8K2CxLqlWs=\n-----END PUBLIC KEY-----\n";
const MMD_LICENSE_KEY = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAZWUXy0zyDqYiZppgNAY0xtpd5iRLxwB382J4wRK0WGs=\n-----END PUBLIC KEY-----\n";
// The encrypted file's start: "GT2E", format 1; then its IV (12 bytes), the ciphertext, the GCM tag (16 bytes)
const MMD_GT2E_MAGIC = Buffer.from([0x47, 0x54, 0x32, 0x45, 0x01]);

GT.mmdPlugins = [];
// The paid plugins installed here but not loaded, each id's reason (its i18n key: mmd.plugin.noLicense, otherCall, locked)
GT.mmdPaidLocked = {};

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

// A dev run's dev key for paid plugins (name: dev-signing-public.txt, dev-license-public.txt in GT_PAID_DEV_KEYS' folder) as pem, else null
function mmdPaidDevKey(name)
{
  const dir = process.env.GT_PAID_DEV_KEYS;
  if (!dir || !mmdPluginsDevFolder()) return null;
  try
  {
    const b64 = fs.readFileSync(path.join(dir, name), "utf8").trim();
    return /^[A-Za-z0-9+/=]+$/.test(b64) ? "-----BEGIN PUBLIC KEY-----\n" + b64 + "\n-----END PUBLIC KEY-----\n" : null;
  }
  catch (e)
  {
    return null;
  }
}

// The keys a paid plugin (and the paid list) is checked against, and the keys a license token is: the built-in ones, a dev run's too
function mmdPaidKeys()
{
  return [MMD_PLUGIN_COMMERCIAL_KEY, mmdPaidDevKey("dev-signing-public.txt")].filter(Boolean);
}

function mmdLicenseKeys()
{
  return [MMD_LICENSE_KEY, mmdPaidDevKey("dev-license-public.txt")].filter(Boolean);
}

// A call sign's base call: upper case, its parts split at "/", the longest with a letter and a digit (VE3/N0TTL/P: N0TTL), else "".
// The same as the commercial-plugins repo's tools/license.js
function mmdBaseCall(call)
{
  let best = "";
  for (const p of String(call || "").trim().toUpperCase().split("/"))
  {
    if (/^[A-Z0-9]{3,}$/.test(p) && /[A-Z]/.test(p) && /[0-9]/.test(p) && p.length > best.length) best = p;
  }
  return best;
}

// A license token read: its data ({ format: 1, call, plugins: { id: content key as base64 }, issued, id }) if its signature is the license
// key's, else null. A token: GT2L1.<payload, base64url JSON>.<signature, base64url, over "GT2L1.<payload>">
function mmdLicenseRead(token)
{
  const m = /^GT2L1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(token || "").replace(/\s+/g, ""));
  if (!m) return null;
  const crypto = require("crypto");
  const sig = Buffer.from(m[2], "base64url");
  const signed = Buffer.from("GT2L1." + m[1], "ascii");
  if (sig.length != 64 || !mmdLicenseKeys().some((pem) =>
  {
    try
    {
      return crypto.verify(null, signed, crypto.createPublicKey(pem), sig);
    }
    catch (e)
    {
      return false;
    }
  })) return null;
  try
  {
    const data = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8"));
    if (!data || data.format != 1 || !mmdBaseCall(data.call) || !data.plugins || typeof data.plugins != "object") return null;
    return data;
  }
  catch (e)
  {
    return null;
  }
}

// The license for a plugin here: { status: "ok" (one for this call sign: key, its content key), "otherCall" (only for other call signs:
// call, the first one's), or "none" }. The licenses are MMD.licenses' tokens (saved with the settings, so copied with them)
function mmdLicenseOf(id)
{
  const mine = mmdBaseCall(GT.settings.app.myCall);
  let other = null;
  for (const token of Array.isArray(GT.settings.MMD.licenses) ? GT.settings.MMD.licenses : [])
  {
    const data = mmdLicenseRead(token);
    if (!data || typeof data.plugins[id] != "string") continue;
    const key = Buffer.from(data.plugins[id], "base64");
    if (key.length != 32) continue;
    if (mine && mmdBaseCall(data.call) == mine) return { status: "ok", key, call: data.call };
    other = other || data.call;
  }
  return other ? { status: "otherCall", call: other } : { status: "none" };
}

// A license token entered (Manage Decoders..., Enter License): added to MMD.licenses (one already there with the same id replaced). Its
// { plugins (their ids), call, matches (its call sign is this GridTracker2's) }, else throws why
function mmdLicenseAdd(text)
{
  const token = String(text || "").replace(/\s+/g, "");
  const data = mmdLicenseRead(token);
  if (!data) throw new Error(I18N("mmd.license.bad"));
  const S = GT.settings.MMD;
  if (!Array.isArray(S.licenses)) S.licenses = [];
  S.licenses = S.licenses.filter((t) =>
  {
    const d = mmdLicenseRead(t);
    return t != token && !(d && data.id && d.id == data.id);
  });
  S.licenses.push(token);
  return { plugins: Object.keys(data.plugins), call: data.call, matches: mmdBaseCall(data.call) == mmdBaseCall(GT.settings.app.myCall) };
}

// A paid plugin's file decrypted (bytes: GT2E1, AAD its first 5 bytes and the plugin's id, so one renamed to another id fails): the
// .asar's bytes, else throws
function mmdPaidDecrypt(id, bytes, key)
{
  if (bytes.length < 33 || !bytes.subarray(0, 5).equals(MMD_GT2E_MAGIC)) throw new Error("not a GT2E1 file");
  const decipher = require("crypto").createDecipheriv("aes-256-gcm", key, bytes.subarray(5, 17));
  decipher.setAAD(Buffer.concat([MMD_GT2E_MAGIC, Buffer.from(id, "utf8")]));
  decipher.setAuthTag(bytes.subarray(bytes.length - 16));
  return Buffer.concat([decipher.update(bytes.subarray(17, bytes.length - 16)), decipher.final()]);
}

// An .asar read in memory (bytes): { has(name), read(name) } of its files by their paths in it ("/" or "\" separated). Its layout: a
// pickle holding the header's size (8 bytes), the header (a pickle of its JSON: size, length, text), then the files' bytes, each entry's
// offset from there. Never outside the archive: ".." and unpacked entries aren't its files
function mmdPluginArchive(bytes)
{
  if (bytes.length < 16) throw new Error("not an archive");
  const headerSize = bytes.readUInt32LE(4);
  if (8 + headerSize > bytes.length) throw new Error("not an archive");
  const jsonLength = bytes.readUInt32LE(12);
  if (16 + jsonLength > 8 + headerSize) throw new Error("not an archive");
  const header = JSON.parse(bytes.toString("utf8", 16, 16 + jsonLength));
  const start = 8 + headerSize;
  const entry = (name) =>
  {
    let node = header;
    for (const part of String(name).split(/[\\/]+/).filter((x) => x && x != "."))
    {
      if (part == ".." || !node.files || !Object.hasOwn(node.files, part)) return null;
      node = node.files[part];
    }
    return node && !node.files && !node.unpacked && Number.isInteger(node.size) ? node : null;
  };
  return {
    has: (name) => !!entry(name),
    read: (name) =>
    {
      const e = entry(name);
      if (!e) throw Object.assign(new Error("no file " + name + " in the plugin"), { code: "ENOENT" });
      const from = start + Number(e.offset);
      if (!(from >= start && from + e.size <= bytes.length)) throw new Error("bad archive entry " + name);
      return bytes.subarray(from, from + e.size);
    }
  };
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
// (mmdPluginModesOf), base (its folder, or its .asar's or .gt2e's path), url (base as a file URL), read(name) (one of its files, a Buffer),
// encrypted (a paid one, read from memory: no file of it can be opened by path), guideFile (its guide's path, else null), dev, disabled }
function mmdPluginsFind()
{
  // Manage Decoders...'s installs, updates and removals first, before any plugin file is opened
  mmdPluginsApplyPending();
  const S = GT.settings.MMD;
  if (!Array.isArray(S.pluginsDisabled)) S.pluginsDisabled = [];
  if (!Array.isArray(S.licenses)) S.licenses = [];
  GT.mmdPaidLocked = {};
  const found = [];
  // (paid: { read, guideFile } from its decrypted archive, and its kind must say so)
  const add = (id, base, dev, paid = null) =>
  {
    if (found.some((p) => p.id == id)) return;
    const read = paid ? paid.read : (name) => fs.readFileSync(path.join(base, name));
    let m = null;
    try
    {
      m = JSON.parse(read("plugin.json").toString("utf8"));
    }
    catch (e)
    {
      m = null;
    }
    const problem = mmdPluginProblem(m, id) || (paid && m.kind != "commercial" ? "mmd.plugin.badManifest" : null);
    if (problem)
    {
      mmdPluginNotLoaded((m && m.name) || path.basename(base), problem);
      return;
    }
    const guideFile = !m.guide ? null : paid ? paid.guideFile : path.join(base, m.guide);
    found.push({ id, name: String(m.name || id), version: String(m.version || ""), kind: m.kind == "commercial" ? "commercial" : "free", manifest: m, modes: mmdPluginModesOf(m, id), base, url: require("url").pathToFileURL(base).href, read, encrypted: !!paid, guideFile, dev, disabled: S.pluginsDisabled.includes(id) });
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
    files = require("original-fs").readdirSync(folder);
  }
  catch (e)
  {
    // None installed
  }
  const asars = files.filter((f) => /\.asar$/i.test(f));
  if (asars.length)
  {
    const keys = mmdPluginKeys();
    for (const file of asars)
    {
      const id = file.replace(/\.asar$/i, "");
      if (found.some((p) => p.id == id)) continue;
      const full = path.join(folder, file);
      if (!mmdPluginSigned(full, keys)) mmdPluginNotLoaded(file, "mmd.plugin.notSigned");
      else add(id, full, false);
    }
  }
  for (const file of PAID_DECODERS_LEFT_OUT ? [] : files.filter((f) => /^[a-z][a-z0-9]*\.gt2e$/.test(f)))
  {
    const id = file.replace(/\.gt2e$/, "");
    if (found.some((p) => p.id == id)) continue;
    const paid = mmdPaidOpen(id, path.join(folder, file));
    if (paid.problem)
    {
      GT.mmdPaidLocked[id] = paid.problem;
      // (one turned off: found, no line; it's only opened when it's on)
      if (!S.pluginsDisabled.includes(id)) mmdPluginNotLoaded(file, paid.problem);
    }
    else add(id, path.join(folder, file), false, paid);
  }
  GT.mmdPlugins = found;
  for (const p of found) if (!p.disabled) mmdPluginTake(p);
  // The call sign watched: a paid plugin whose license is for another one from now on is turned off (mmdPaidCallCheck)
  GT.mmdPaidCall = mmdBaseCall(GT.settings.app.myCall);
  if (found.some((p) => p.encrypted && !p.disabled) && !GT.mmdPaidCallTimer) GT.mmdPaidCallTimer = nodeTimers.setInterval(mmdPaidCallCheck, 2000);
}

// A paid plugin installed (file: its .gt2e) opened: { read, guideFile } from its decrypted archive, else { problem } (its i18n key).
// Its signature is checked before anything of it is decrypted. (One turned off is opened too, so it's found and can be turned on again)
function mmdPaidOpen(id, file)
{
  const ofs = require("original-fs");
  const license = mmdLicenseOf(id);
  let bytes;
  try
  {
    bytes = ofs.readFileSync(file);
    if (!mmdPluginSignedBytes(bytes, ofs.readFileSync(file + ".sig", "utf8"), mmdPaidKeys())) return { problem: "mmd.plugin.notSigned" };
  }
  catch (e)
  {
    return { problem: "mmd.plugin.notSigned" };
  }
  if (license.status == "none") return { problem: "mmd.plugin.noLicense" };
  if (license.status == "otherCall") return { problem: "mmd.plugin.otherCall" };
  try
  {
    const archive = mmdPluginArchive(mmdPaidDecrypt(id, bytes, license.key));
    const guideFile = path.join(path.dirname(file), id + ".pdf");
    return { read: archive.read, guideFile: ofs.existsSync(guideFile) ? guideFile : null };
  }
  catch (e)
  {
    return { problem: "mmd.plugin.locked" };
  }
}

// Every 2 seconds while a paid plugin is loaded: the call sign changed (Settings, or WSJT-X's), each paid plugin whose license isn't for the
// new one turned off now in the decoder window (its hooks no longer called, its Mode menu entries grayed, one Event Viewer line). Its code
// stays loaded until the next start, which checks it again; one changed back is loaded again then
function mmdPaidCallCheck()
{
  const call = mmdBaseCall(GT.settings.app.myCall);
  if (call == GT.mmdPaidCall) return;
  GT.mmdPaidCall = call;
  for (const p of GT.mmdPlugins || [])
  {
    if (!p.encrypted || p.disabled || p.licenseLost || mmdLicenseOf(p.id).status == "ok") continue;
    p.licenseLost = true;
    GT.mmdPaidLocked[p.id] = "mmd.plugin.otherCall";
    let told = false;
    try
    {
      if (GT.mmDecoderInitialized) told = GT.mmDecoderHandle.window.mmdPluginsLicenseLost(p.id) === true;
    }
    catch (e)
    {
      told = false;
    }
    // (the window not open yet: it leaves the plugin out as it loads, p.licenseLost; the line said here)
    if (!told) mmdPluginNotLoaded(p.name, "mmd.plugin.otherCall");
  }
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
      const strings = JSON.parse(p.read(dir + "/" + locale + ".json").toString("utf8"));
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
// Unofficial WoARM build: the free plugins from this project's GitHub Pages site, signed by its own key (MMD_PLUGIN_FREE_KEY)
const MMD_STORE_URL = "https://aj7kt.github.io/gridtracker2-unofficial-woarm/plugins/mmd/";
// The paid plugins' store (the commercial-plugins repo's deploy): the same layout, its lists and plugins signed by the commercial key, each
// plugin a .gt2e (+ .sig) and its guide a .pdf (its size and SHA-256 in the list). Installed only once a license for it is entered
const MMD_PAID_STORE_URL = "https://tagloomis.com/plugins/mmd/";
// Unofficial WoARM build: paid plugins are left out. Their store is never asked (mmdStoreGet, mmdStoreList), and installed ones
// (.gt2e) aren't looked for at startup, so no license is ever asked for or used. The code is kept
const PAID_DECODERS_LEFT_OUT = true;
// The largest list, and the largest plugin, taken (bytes)
const MMD_STORE_LIST_MAX = 1024 * 1024;
const MMD_STORE_PLUGIN_MAX = 200 * 1024 * 1024;

// Where the lists and plugins come from: the download server; on a dev run the environment's GT_PLUGIN_STORE may name another (a URL, or
// a folder: tools/mmd_plugin_pack.js --publish's plugins/out/site/plugins/mmd/), so Manage Decoders... can be tried before anything is published.
// The paid ones': tagloomis.com, on a dev run GT_PAID_STORE's (the commercial-plugins repo's pack.js --publish: out/site/plugins/mmd/)
function mmdStoreBase(paid = false)
{
  const other = process.env[paid ? "GT_PAID_STORE" : "GT_PLUGIN_STORE"];
  if (other && mmdPluginsDevFolder()) return other;
  return paid ? MMD_PAID_STORE_URL : MMD_STORE_URL;
}

// A file of the store (its path below the base, "/" separated), as a URL or a path
function mmdStoreWhere(rel, paid = false)
{
  const base = mmdStoreBase(paid);
  if (/^https?:\/\//i.test(base)) return base.replace(/\/?$/, "/") + rel;
  return path.join(base, ...rel.split("/"));
}

// A file of the store's bytes (at most max of them; paid: the paid store's): a promise. An HTTP answer other than 200 fails with err.status
// set (404: not there)
function mmdStoreGet(rel, max, paid = false)
{
  if (paid && PAID_DECODERS_LEFT_OUT) return Promise.reject(Object.assign(new Error("paid plugins are left out"), { status: 404 }));
  const where = mmdStoreWhere(rel, paid);
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

// This version's lists, the free one and the paid one: a promise of their plugins, each { id, name, version, kind, api, minAppVersion,
// modes (their names), file, size, sha256 } as published (a paid one's also encryption, buy: its page, guide: { file, size, sha256 }), its
// state here (mmdStoreState) and a paid one's license (mmdLicenseOf's status). Fails only when neither list can be had: with err.status 404
// when there is none for this version; a list not signed by its key (a dev run's dev key too) or not this version's is a failure
async function mmdStoreList()
{
  const lists = await Promise.allSettled([mmdStoreListOf(false), PAID_DECODERS_LEFT_OUT ? Promise.reject(Object.assign(new Error("left out"), { status: 404 })) : mmdStoreListOf(true)]);
  if (lists[0].status == "rejected" && lists[1].status == "rejected") throw lists[0].reason;
  if (lists[1].status == "rejected" && lists[1].reason && lists[1].reason.status != 404) console.log("paid plugin list: " + lists[1].reason.message);
  const free = lists[0].status == "fulfilled" ? lists[0].value : [];
  const paid = lists[1].status == "fulfilled" ? lists[1].value.filter((e) => !free.some((f) => f.id == e.id)) : [];
  const plugins = free.concat(paid);
  for (const e of plugins)
  {
    e.name = String(e.name || e.id);
    e.modes = Array.isArray(e.modes) ? e.modes.map(String) : [];
    e.state = mmdStoreState(e.id, e.version);
    if (e.kind == "commercial") e.license = mmdLicenseOf(e.id).status;
    Object.assign(e, mmdStoreEnabledOf(e.id));
  }
  return plugins;
}

// One of the lists (paid: the paid store's), its plugins as published, those this GridTracker2 can't take left out
async function mmdStoreListOf(paid)
{
  const rel = gtVersionStr + "/plugins.json";
  const list = await mmdStoreGet(rel, MMD_STORE_LIST_MAX, paid);
  const sig = await mmdStoreGet(rel + ".sig", 4096, paid);
  if (!mmdPluginSignedBytes(list, sig.toString("utf8"), paid ? mmdPaidKeys() : mmdPluginKeys())) throw new Error(I18N("mmd.store.notSigned"));
  const data = JSON.parse(list.toString("utf8"));
  if (!data || data.format != 1 || data.app != gtVersionStr || !Array.isArray(data.plugins)) throw new Error(I18N("mmd.store.badList"));
  const ext = paid ? "gt2e" : "asar";
  const hashed = (f, re, max) => f && typeof f.file == "string" && re.test(f.file) && !f.file.includes("..") && Number.isInteger(f.size) && f.size > 0 && f.size <= max && /^[0-9a-f]{64}$/.test(f.sha256);
  return data.plugins.filter((e) => e && /^[a-z][a-z0-9]*$/.test(e.id) && typeof e.version == "string" &&
    hashed(e, new RegExp("^" + e.id + "/[A-Za-z0-9._-]+\\." + ext + "$"), MMD_STORE_PLUGIN_MAX) &&
    (paid ? e.kind == "commercial" && e.encryption == "GT2E1" && typeof e.buy == "string" && /^https:\/\/tagloomis\.com\//.test(e.buy) &&
      (e.guide == null || hashed(e.guide, new RegExp("^" + e.id + "/[A-Za-z0-9._-]+\\.pdf$"), MMD_STORE_PLUGIN_MAX)) : e.kind == "free") &&
    e.api >= MMD_PLUGIN_API.min && e.api <= MMD_PLUGIN_API.max && !(e.minAppVersion && mmdPluginVersionCompare(gtVersionStr, e.minAppVersion) < 0));
}

// The plugins installed here (loaded or turned off; not a dev run's own folders) that list hasn't: Manage Decoders... can remove them too
// (a paid one installed but not loaded, GT.mmdPaidLocked, too: by its id, as nothing of it could be read)
function mmdStoreInstalledOthers(list)
{
  const others = (GT.mmdPlugins || []).filter((p) => !p.dev && !list.some((e) => e.id == p.id)).map((p) => Object.assign({ id: p.id, name: p.name, version: p.version, kind: p.kind, modes: p.modes.map((d) => d.label), state: mmdStoreState(p.id, null) }, mmdStoreEnabledOf(p.id)));
  for (const id in GT.mmdPaidLocked || {})
  {
    if (list.some((e) => e.id == id) || others.some((e) => e.id == id)) continue;
    others.push(Object.assign({ id, name: id, version: "", kind: "commercial", modes: [], state: mmdStoreState(id, null), license: mmdLicenseOf(id).status }, mmdStoreEnabledOf(id)));
  }
  return others;
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
  if (ofs.existsSync(file + ".asar.new") || ofs.existsSync(file + ".gt2e.new")) return "installPending";
  if (ofs.existsSync(file + ".remove")) return "removePending";
  if (loaded) return listed && mmdPluginVersionCompare(listed, loaded.version) > 0 ? "update" : "installed";
  // (a paid one here that wasn't loaded: no license for this call sign; it can be removed, or loaded once one is entered)
  if (ofs.existsSync(file + ".gt2e")) return "locked";
  return "install";
}

// One of the list's plugins downloaded and checked (its size, SHA-256 and its own signature; a paid one's guide its size and SHA-256), then
// left to be installed at the next start: a promise of its new state. A paid one only with a license for this call sign
async function mmdStoreInstall(e)
{
  const crypto = require("crypto");
  const ofs = require("original-fs");
  const paid = e.kind == "commercial";
  if (paid && mmdLicenseOf(e.id).status != "ok") throw new Error(I18N("mmd.license.needed"));
  const ext = paid ? ".gt2e" : ".asar";
  const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
  const bytes = await mmdStoreGet(e.file, e.size, paid);
  if (bytes.length != e.size || sha(bytes) != e.sha256) throw new Error(I18N("mmd.store.badDownload"));
  const sig = (await mmdStoreGet(e.file + ".sig", 4096, paid)).toString("utf8");
  if (!mmdPluginSignedBytes(bytes, sig, paid ? mmdPaidKeys() : mmdPluginKeys())) throw new Error(I18N("mmd.store.notSigned"));
  const guide = paid && e.guide ? await mmdStoreGet(e.guide.file, e.guide.size, true) : null;
  if (guide && (guide.length != e.guide.size || sha(guide) != e.guide.sha256)) throw new Error(I18N("mmd.store.badDownload"));
  const folder = mmdPluginsFolder();
  const file = path.join(folder, e.id);
  ofs.mkdirSync(folder, { recursive: true });
  // The guide and the signature first, then the plugin under a name of its own until it is whole: a half-written one is never taken
  if (guide) ofs.writeFileSync(file + ".pdf.new", guide);
  ofs.writeFileSync(file + ext + ".sig.new", sig);
  ofs.writeFileSync(file + ext + ".part", bytes);
  ofs.renameSync(file + ext + ".part", file + ext + ".new");
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
  for (const f of [".asar.new", ".asar.sig.new", ".asar.part", ".gt2e.new", ".gt2e.sig.new", ".gt2e.part", ".pdf.new", ".remove"]) mmdStoreForget(file + f);
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

// At startup (mmdPluginsFind), before any plugin is opened: each removal done (its .asar or .gt2e, its .sig and a paid one's guide deleted),
// then each install or update (its .asar.new or .gt2e.new and its .sig.new in place of the old ones; a paid one's .pdf.new for its guide),
// once its signature is checked again; one that fails is let go
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
    for (const f of [".asar", ".asar.sig", ".gt2e", ".gt2e.sig", ".pdf", ".remove"]) mmdStoreForget(path.join(folder, m[1] + f));
  }
  for (const name of names)
  {
    const m = /^([a-z][a-z0-9]*)\.(asar|gt2e)\.new$/.exec(name);
    if (!m) continue;
    const file = path.join(folder, m[1]);
    const ext = "." + m[2];
    try
    {
      if (mmdPluginSignedBytes(ofs.readFileSync(file + ext + ".new"), ofs.readFileSync(file + ext + ".sig.new", "utf8"), m[2] == "gt2e" ? mmdPaidKeys() : mmdPluginKeys()))
      {
        ofs.renameSync(file + ext + ".new", file + ext);
        ofs.renameSync(file + ext + ".sig.new", file + ext + ".sig");
        // (a paid one's guide: the new one, else none: an update without one leaves none behind)
        if (m[2] == "gt2e")
        {
          mmdStoreForget(file + ".pdf");
          if (ofs.existsSync(file + ".pdf.new")) ofs.renameSync(file + ".pdf.new", file + ".pdf");
        }
        continue;
      }
    }
    catch (e)
    {
      // Not whole: let go
    }
    for (const f of [ext + ".new", ext + ".sig.new", ".pdf.new"]) mmdStoreForget(file + f);
  }
  for (const name of names) if (/\.(asar|gt2e)\.part$/.test(name)) mmdStoreForget(path.join(folder, name));
}
