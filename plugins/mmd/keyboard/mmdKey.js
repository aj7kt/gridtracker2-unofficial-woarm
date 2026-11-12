// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The keyboard modes plugin (plugin.json beside this file): PSK31 (with PSK63, PSK125 and QPSK31, its submodes), RTTY, MFSK (MFSK16,
// MFSK32) and DominoEX / THOR. The input's own samples (the worklet's raw stream, input "raw") go to the mode's worker, which finds every
// signal of the mode in the passband and decodes each on its own: keyWorker.js (PSK's carriers; RTTY's tone pairs 170, 425 or 850 Hz
// apart, at 45.45, 50 or 75 baud), mfskWorker.js, thorWorker.js (each speed, or every one). Here each is a signal of CW's list (cwList:
// its line, its marks on the waterfall, hovered and pinned as CW's; host.channels, signalText), its text added as it comes; the WPM
// column shows its baud (RTTY's as read, the others' their own). A mode with submodes has its menu in the row under the second line
// (cwKeySub). Detect Modes' own decoders of these modes are here too (detectRaw)

// Each mode: its worker; its submodes ([value, name, baud shown]; the default, else the first) and the setting keeping the one picked;
// what the worker is told of it
const KEY_MODES = {
  psk31: {
    worker: "keyWorker.js",
    setting: "pskSubmode",
    subs: [["psk31", "PSK31", 31], ["psk63", "PSK63", 63], ["psk125", "PSK125", 125], ["qpsk31", "QPSK31", 31]],
    config: (sub) => ({ mode: sub })
  },
  rtty: {
    worker: "keyWorker.js",
    baud: 45,
    config: () => ({ mode: "rtty" })
  },
  mfsk: {
    worker: "mfskWorker.js",
    setting: "mfskSubmode",
    subs: [["mfsk16", "MFSK16", 16], ["mfsk32", "MFSK32", 31]],
    config: (sub) => ({ mode: sub })
  },
  thor: {
    worker: "thorWorker.js",
    setting: "thorSubmode",
    def: "dominoex 11",
    subs: [4, 5, 8, 11, 16, 22, "all"].map((b) => ["dominoex " + b, "DominoEX " + (b == "all" ? "" : b), b == "all" ? 0 : b])
      .concat([4, 5, 8, 11, 16, 22, "all"].map((b) => ["thor " + b, "THOR " + (b == "all" ? "" : b), b == "all" ? 0 : b])),
    config: (sub) =>
    {
      const [mode, baud] = sub.split(" ");
      return { mode, baud: baud == "all" ? "all" : Number(baud) };
    }
  }
};
// An RSID's mode name (rsidWorker.js) for a mode and submode here
const KEY_RSID_NAMES = {
  "BPSK31": ["psk31", "psk31"], "BPSK63": ["psk31", "psk63"], "BPSK125": ["psk31", "psk125"], "QPSK31": ["psk31", "qpsk31"],
  "RTTY 45": ["rtty", null], "MFSK16": ["mfsk", "mfsk16"], "MFSK32": ["mfsk", "mfsk32"]
};
for (const b of [4, 5, 8, 11, 16, 22])
{
  KEY_RSID_NAMES["DominoEX " + b] = ["thor", "dominoex " + b];
  KEY_RSID_NAMES["THOR" + b] = ["thor", "thor " + b];
}
// Detect Modes' decoders of these modes: each its worker's name, file and config; the mode it names (the Mode menu's) and its submode
// there (sub: the channel's, for DominoEX / THOR); its label
const KEY_DETECTORS = [
  { name: "psk", file: "keyWorker.js", config: { mode: "psk31" }, mode: "psk31", sub: () => "psk31", label: () => "PSK31" },
  { name: "psk63", file: "keyWorker.js", config: { mode: "psk63" }, mode: "psk31", sub: () => "psk63", label: () => "PSK63" },
  { name: "psk125", file: "keyWorker.js", config: { mode: "psk125" }, mode: "psk31", sub: () => "psk125", label: () => "PSK125" },
  { name: "qpsk31", file: "keyWorker.js", config: { mode: "qpsk31" }, mode: "psk31", sub: () => "qpsk31", label: () => "QPSK31" },
  { name: "rtty", file: "keyWorker.js", config: { mode: "rtty" }, mode: "rtty", sub: () => null, label: (c) => "RTTY " + Math.floor(c.baud > 0 ? c.baud : 45.45) + "/" + c.shift },
  { name: "mfsk16", file: "mfskWorker.js", config: { mode: "mfsk16" }, mode: "mfsk", sub: () => "mfsk16", label: () => "MFSK16" },
  { name: "mfsk32", file: "mfskWorker.js", config: { mode: "mfsk32" }, mode: "mfsk", sub: () => "mfsk32", label: () => "MFSK32" },
  { name: "thor", file: "thorWorker.js", config: { mode: "any", baud: "all" }, mode: "thor", sub: (c) => c.mode + " " + c.submode, label: (c) => (c.mode == "thor" ? "THOR " : "DominoEX ") + c.submode }
];
// Detect Modes' spec of each mode: its label colour, how near two finds are the same signal (Hz), its rank where two overlap, its
// signal's width (Hz: PSK's by its decoder, RTTY's from its shift, MFSK's by its speed, DominoEX's and THOR's 18 tones a baud apart, twice
// that at 4, 5 and 8), and for PSK and RTTY the floor its text must read over to be shown (another mode read as theirs gives a jumble)
const KEY_DETECT = {
  psk31: { color: "#7dff7d", sameHz: 30, rank: 6, floor: 0.5, width: (f) => ({ psk: 62, psk63: 125, psk125: 250, qpsk31: 62 })[f.by] || 62 },
  rtty: { color: "#66e0ff", sameHz: 60, rank: 4, floor: 0.5, width: (f) => (Number(String(f.label).split("/")[1]) || 170) + 100 },
  mfsk: { color: "#ff8cc6", sameHz: 60, rank: 7, width: (f) => (f.by == "mfsk32" ? 630 : 316) },
  thor: {
    color: "#b0ff4d", sameHz: 80, rank: 7, width: (f) =>
    {
      const baud = Number(String(f.sub && f.sub.key).split(" ")[1]) || 11;
      return 18 * baud * (baud <= 8 ? 2 : 1);
    }
  }
};

const KEY = {
  host: null,   // the decoder's host (mmdPluginHost.js), from init
  workers: {},  // by file: { worker, rate (it was set up for), config (what it was last told) }
  // Detect Modes': workers by name (KEY_DETECTORS'), the rate each was set up for, and their channels (by name, by id)
  detect: { workers: {}, rates: {}, channels: {} }
};

// One of these modes (the one showing, by default; a hook can come before init)
function mmdKeyMode(mode)
{
  if (mode == null) mode = KEY.host ? KEY.host.mode() : "";
  return Object.hasOwn(KEY_MODES, mode);
}

// The mode's submode picked ([value, name, baud]), else null (a mode with none)
function mmdKeySub(mode = KEY.host.mode())
{
  const m = KEY_MODES[mode];
  if (!m || !m.subs) return null;
  const value = KEY.host.get(m.setting);
  return m.subs.find((s) => s[0] == value) || m.subs.find((s) => s[0] == m.def) || m.subs[0];
}

// The mode's name as shown ("PSK63", "DominoEX 11", "RTTY")
function mmdKeyName(mode = KEY.host.mode())
{
  const sub = mmdKeySub(mode);
  if (sub) return sub[1].trim();
  return mode == "rtty" ? "RTTY" : mode.toUpperCase();
}

// The mode's worker, set up for the input's rate, told the mode and the audio decoded (Min Freq and Max Freq) whenever they change
function mmdKeyLoad(rate, mode = KEY.host.mode())
{
  const H = KEY.host;
  const m = KEY_MODES[mode];
  const w = KEY.workers[m.worker] || (KEY.workers[m.worker] = { worker: null, rate: 0, config: "" });
  if (!w.worker)
  {
    w.worker = new Worker(H.workerUrl(m.worker));
    w.worker.onmessage = (event) => H.guard(() => mmdKeyMessage(m.worker, event.data));
  }
  if (w.rate != rate)
  {
    w.rate = rate;
    w.config = "";
    w.worker.postMessage({ type: "init", rate });
  }
  const sub = mmdKeySub(mode);
  const range = H.range();
  const message = Object.assign({ type: "config" }, m.config(sub ? sub[0] : null), { minHz: range.minHz, maxHz: range.maxHz });
  const config = JSON.stringify(message);
  if (w.config != config)
  {
    w.config = config;
    w.worker.postMessage(message);
  }
  return w.worker;
}

// A tenth of a second of the input's samples from the worklet
function mmdKeyAudio(data)
{
  mmdKeyLoad(data.rate).postMessage({ type: "audio", samples: data.samples }, [data.samples.buffer]);
}

// Listening starts again (the mode chosen, a retune, Clear): every signal let go
function mmdKeyReset()
{
  for (const file in KEY.workers) if (KEY.workers[file].worker) KEY.workers[file].worker.postMessage({ type: "reset" });
}

// An RSID heard: the mode's worker leaves its place alone a moment, so its tones aren't taken for a signal
function mmdKeyRsid(freq)
{
  if (!mmdKeyMode()) return;
  const m = KEY_MODES[KEY.host.mode()];
  const w = KEY.workers[m.worker];
  if (w && w.worker) w.worker.postMessage({ type: "rsid", freq });
}

// The submode menu in the row under the second line: this mode's, hidden for a mode with none
function mmdKeyMenu()
{
  const m = KEY_MODES[KEY.host.mode()];
  const subs = (m && m.subs) || null;
  cwKeyBox.style.display = subs ? "" : "none";
  if (!subs) return;
  cwKeySub.innerHTML = "";
  const picked = mmdKeySub();
  for (const [value, name] of subs) cwKeySub.add(new Option(value.endsWith(" all") ? name + KEY.host.t("cwViewer.key.allSpeeds") : name, value, false, value == picked[0]));
}

// A submode picked (the menu, or an RSID's): the list's signals of the last one go (host.listRefresh), the worker listens afresh
function mmdKeySubSet(value)
{
  const m = KEY_MODES[KEY.host.mode()];
  if (!m || !m.subs || !m.subs.some((s) => s[0] == value)) return;
  KEY.host.set(m.setting, value);
  cwKeySub.value = value;
  KEY.host.listRefresh();
  mmdKeyReset();
}

function mmdKeyPicked()
{
  KEY.host.guard(() => mmdKeySubSet(cwKeySub.value));
}

function mmdKeyMessage(file, m)
{
  if (!mmdKeyMode() || KEY_MODES[KEY.host.mode()].worker != file) return;
  const H = KEY.host;
  if (m.type == "channels")
  {
    // The baud: the worker's (RTTY's as read, PSK's its own), DominoEX's and THOR's speed, else the submode's
    const sub = mmdKeySub();
    const fallback = sub ? sub[2] : KEY_MODES[H.mode()].baud;
    H.channels(m.list.map((c) => Object.assign({}, c, { baud: c.baud > 0 ? c.baud : c.submode > 0 ? c.submode : 0, wpm: null, receiving: false })), fallback);
  }
  // Lines run on: a new line as a space, one space between words
  else if (m.type == "text") H.signalText(m.id, m.text);
}

// The mode and submode for an RSID's mode name ([mode, submode or null]), else null
function mmdKeyRsidMode(name)
{
  return KEY_RSID_NAMES[name] || null;
}

// One of its RSIDs clicked, before its mode is chosen: its submode picked with it (where another mode is showing); false when the mode
// decodes it already (that mode, and that submode or none)
function mmdKeyRsidBefore(mark, sub)
{
  const mode = (mmdKeyRsidMode(mark.name) || [])[0];
  const showing = KEY.host.mode() == mode;
  const real = sub && KEY_MODES[mode].subs ? sub : null;
  if (real && !showing) KEY.host.set(KEY_MODES[mode].setting, real);
  return !(showing && !(real && mmdKeySub()[0] != real));
}

// ... after: its submode set (already showing), the RSID's own tones not taken for a signal, the audio kept since it decoded
function mmdKeyRsidAfter(mark, sub, chunks, switched)
{
  const mode = KEY.host.mode();
  if (!switched && sub && KEY_MODES[mode].subs) mmdKeySubSet(sub);
  if (chunks.length) mmdKeyLoad(chunks[0].rate, mode).postMessage({ type: "rsid", freq: mark.freq });
  for (const chunk of chunks) mmdKeyAudio(chunk);
}

// ---- Detect Modes: each of KEY_DETECTORS its own worker, every signal of it found; one named once it has printed text cleanly

function mmdKeyDetectWorker(k, rate)
{
  const H = KEY.host;
  const D = KEY.detect;
  if (!D.workers[k.name])
  {
    D.workers[k.name] = new Worker(H.workerUrl(k.file));
    D.workers[k.name].onmessage = (event) => H.guard(() => mmdKeyDetectMessage(k, event.data));
  }
  if (D.rates[k.name] != rate)
  {
    const range = H.range();
    D.rates[k.name] = rate;
    D.workers[k.name].postMessage({ type: "init", rate });
    D.workers[k.name].postMessage(Object.assign({ type: "config" }, k.config, { minHz: range.minHz, maxHz: range.maxHz }));
  }
  return D.workers[k.name];
}

// The input's own samples, each decoder its own copy
function mmdKeyDetectRaw(data)
{
  for (const k of KEY_DETECTORS)
  {
    const samples = data.samples.slice();
    mmdKeyDetectWorker(k, data.rate).postMessage({ type: "audio", samples }, [samples.buffer]);
  }
}

function mmdKeyDetectMessage(k, m)
{
  const H = KEY.host;
  if (!H.detectOn()) return;
  const channels = KEY.detect.channels[k.name] || (KEY.detect.channels[k.name] = {});
  if (m.type == "channels")
  {
    const seen = {};
    for (const c of m.list)
    {
      seen[c.id] = true;
      channels[c.id] = Object.assign(channels[c.id] || { text: "" }, c);
    }
    for (const id in channels) if (!seen[id]) delete channels[id];
  }
  else if (m.type == "text")
  {
    // Text goes out only from a channel decoding cleanly: it is that mode
    const c = channels[m.id];
    if (!c) return;
    c.text = (c.text + String(m.text).replace(/[\r\n]+/g, " ")).replace(/ {2,}/g, " ").slice(-60);
    if (c.text.trim().length < 3) return;
    H.detectFound(k.mode, k.label(c), c.freq, c.snr, c.text, { key: k.sub(c) }, k.name);
  }
}

// Listening afresh (Detect Modes started, Clear, stopped): its decoders reset, the channels forgotten
function mmdKeyDetectReset()
{
  for (const name in KEY.detect.workers) KEY.detect.workers[name].postMessage({ type: "reset" });
  KEY.detect.channels = {};
}

// An RSID heard: its decoders leave the place alone a moment
function mmdKeyDetectRsid(freq)
{
  for (const name in KEY.detect.workers) KEY.detect.workers[name].postMessage({ type: "rsid", freq });
}

// The keyboard modes in the decoder's mode registry: PSK31, RTTY, MFSK and DominoEX / THOR (KEY_MODES) from the input's own samples,
// their signals in CW's list
mmdRegisterMode({
  id: "keyboard",
  name: "PSK / RTTY / MFSK / DominoEX / THOR",
  modes: Object.keys(KEY_MODES),
  input: "raw",
  cwList: true,
  // (MFSK's and DominoEX / THOR's dB measured wider than their filter: shown under 0 too)
  snrWide: ["mfsk", "thor"],
  detect: KEY_DETECT,
  init: (host) =>
  {
    KEY.host = host;
  },
  // CW's list: named as the mode (and submode) is, starting afresh with another submode
  listName: () => mmdKeyName(),
  listKey: () =>
  {
    const sub = mmdKeySub();
    return sub ? sub[0] : "";
  },
  audio: (data) => mmdKeyAudio(data),
  // (a click: the signal there pinned, as CW's)
  tune: (hz) => KEY.host.focusNear(hz),
  // Its submode menu in the row under the second line
  shown: (on) =>
  {
    if (on && KEY.host) mmdKeyMenu();
    else cwKeyBox.style.display = "none";
  },
  entered: () => mmdKeyReset(),
  clear: () => mmdKeyReset(),
  retune: () =>
  {
    if (mmdKeyMode()) mmdKeyReset();
  },
  rsidMode: (name) => mmdKeyRsidMode(name),
  rsidHeard: (name, freq) => mmdKeyRsid(freq),
  rsidBefore: (mark, sub) => mmdKeyRsidBefore(mark, sub),
  rsidAfter: (mark, sub, chunks, switched) => mmdKeyRsidAfter(mark, sub, chunks, switched),
  detectRaw: (data) => mmdKeyDetectRaw(data),
  detectReset: () => mmdKeyDetectReset(),
  detectRsid: (freq) => mmdKeyDetectRsid(freq),
  // A signal Detect Modes found picked: its submode picked with it (PSK63, MFSK32, THOR 16 ...)
  detectBefore: (f) =>
  {
    const m = KEY_MODES[f.mode];
    if (f.sub && f.sub.key && m && m.subs) KEY.host.set(m.setting, f.sub.key);
  },
  logQso: () =>
  {
    const sub = mmdKeySub();
    return { sub: sub ? sub[0] : "" };
  }
});
