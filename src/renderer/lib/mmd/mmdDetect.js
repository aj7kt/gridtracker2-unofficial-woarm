// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// Detect Modes (the button beside Test Signals): the modes decoded here listened for at once, and each signal named once it is known: by
// its own decoder decoding it (each a copy of its mode's: CW from the worklet's own decoder, SSTV from sstvWorker.js, a plugin's modes
// from its own: its registration's detect, detectAudio and detectRaw: PSK31, PSK63, PSK125, QPSK31, RTTY, MFSK, DominoEX and THOR, Packet,
// FT8, FT4), so a name is only given to what really decodes. Olivia and Contestia aren't looked for (their decoder needs the submode, and
// a search of every one costs too much): an RSID's label (mmdRsid.js) names them, and every mode, as always.
// The mode it was in waits meanwhile (its decoder hears nothing, its list is hidden): the signals found are listed in its place (mode,
// frequency, dB, what was heard) and labelled on the waterfall. A click on one (either) decodes it: Detect Modes off, its mode chosen and
// aimed at it (CW's signal pinned; a plugin's: its detectBefore and detectAfter, Packet's HF place locked). Detect Modes off by its
// button: the mode it was in goes on

// A signal found stays listed this long after it was last heard (ms)
const DETECT_KEEP_MS = 120000;
// Two finds of a mode this close (Hz) are the same signal (a plugin's mode: its detect's sameHz)
const DETECT_SAME_HZ = { cw: 40, sstv: 300 };
// A click this near a found signal's frequency (Hz) picks it
const DETECT_PICK_HZ = 80;
// CW: a signal is named once it has copied this many characters, its speed sane, and a word CW's operators send among them, or the same
// call-shaped token twice (noise or another mode read as CW gives a call-like jumble now and then, seldom the same one again)
const DETECT_CW_CHARS = 8;
const DETECT_CW_WORDS = /\b(CQ|DE|TU|TNX|QRZ|QSL|QTH|RST|5NN|599|73|TEST|NAME|UR|BK|AGN|PSE)\b/;
const DETECT_CW_CALL = /\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{3,7}\b/g;
// SSTV: a picture is named once this many of its lines were looked at, at least this share of them with a clear sync pulse
const DETECT_SSTV_LINES = 12;
const DETECT_SSTV_SYNCS = 0.75;
// Each mode's label colour (the waterfall's labels, the list's Mode; a plugin's mode: its detect's color)
const DETECT_COLORS = { cw: "#ffe066", sstv: "#d68cff" };
// Another mode's decoder reads a signal after a fashion now and then (RTTY's a run of one letter on MFSK's tones, PSK31's a jumble on
// PSK63's, CW's a few letters on DominoEX's): where two signals found overlap (their bandwidths, by this share), only the one whose text
// reads best is shown, the more particular mode where they read alike. The text's quality: the share of its characters in words (two
// characters or more, a vowel or a digit, no letter three times running, and from four characters up more different ones than half its
// length: RTTY's "MMVVIV" on MFSK's tones isn't a word). A plugin's mode: its detect's rank (FT8's and FT4's 10), and with checked its
// text reads perfectly (a decode checked by its CRC is that mode: FT8's, FT4's)
const DETECT_OVERLAP = 0.8;
// (a plugin's mode: its detect's rank: FT8's 10, Packet's 8, DominoEX / THOR's and MFSK's 7, PSK's 6, RTTY's 4)
const DETECT_RANK = { sstv: 9, cw: 3 };
const DETECT_ALIKE = 0.1;
// Operators' words with no vowel, words all the same
const DETECT_HAM_WORDS = new Set(["CQ", "QTH", "QSL", "QST", "QRZ", "QRM", "QRN", "QRP", "QSB", "QSY", "RST", "TNX", "TKS", "PWR", "WX", "HW", "SK", "KN", "BK", "DX", "CW", "FB", "GM", "GN", "GL", "HR", "NR", "PSK", "RTTY", "SSB", "BTW"]);
// A mode's text read worse than its floor isn't shown at all (a plugin's detect's floor: PSK's and RTTY's 0.5; CW's has its own test,
// the others print no false text)

const DETECT = {
  on: false,
  // Its own decoders: workers by name (sstv), the rate each was set up for
  workers: {},
  rates: {},
  // The signals found: by key, { key, mode, label, hz (audio), snr, text, at, sub (what picking it needs) }
  found: new Map(),
  // SSTV's pictures begun, by id: { name, shift } (named once their lines show sync pulses)
  sstvPics: {},
  listKey: null
};

// A mode's own: its label colour, how near two of its finds are the same signal (Hz), its rank where two overlap, whether its decodes are
// checked (the core's tables, else a plugin's detect: mmdPluginHost.js)
function mmdDetectColor(mode)
{
  const spec = mmdPluginDetectSpec(mode);
  return DETECT_COLORS[mode] || (spec && spec.color) || "#ffffff";
}

function mmdDetectSameHz(mode)
{
  const spec = mmdPluginDetectSpec(mode);
  return DETECT_SAME_HZ[mode] || (spec && Number(spec.sameHz)) || 50;
}

function mmdDetectRank(mode)
{
  const spec = mmdPluginDetectSpec(mode);
  return DETECT_RANK[mode] || (spec && Number(spec.rank)) || 0;
}

function mmdDetectChecked(mode)
{
  const spec = mmdPluginDetectSpec(mode);
  return !!(spec && spec.checked === true);
}

function mmdDetectFloor(mode)
{
  const spec = mmdPluginDetectSpec(mode);
  return (spec && Number(spec.floor)) || 0;
}

function mmdDetectOn()
{
  return DETECT.on;
}

// The button
function mmdDetectToggle()
{
  if (DETECT.on)
  {
    mmdDetectStop(DEC.mode);
    // The mode it was in goes on
    mmdModeSet(DEC.mode);
  }
  else mmdDetectStart();
}

function mmdDetectStart()
{
  DETECT.on = true;
  DETECT.found.clear();
  DETECT.listKey = null;
  DETECT.sstvPics = {};
  mmdDetectResetAll();
  // A test signal playing stops (it was the last mode's); a picture being sent, or Tune, too (its Send tab is hidden meanwhile, and the
  // status line is Detect Modes', mmdSstvTx.js)
  mmdTestStop();
  if (mmdSstvTxKeying()) mmdSstvTxStop(I18N("sstvTx.status.stopped"));
  // The mode's own list hidden, the signals found listed in its place
  for (const el of [cwList, sstvView, satList].concat(MMD_PLUGINS.lists)) el.style.display = "none";
  detectList.style.display = "";
  cwDetectButton.classList.add("cwTestOn");
  // Every stream the decoders here need: the input's own samples, the 12 kHz audio (SSTV), and CW decoded by the worklet
  if (DEC.node)
  {
    DEC.node.port.postMessage({ type: "raw", on: true });
    DEC.node.port.postMessage({ type: "ft8", on: true });
    DEC.node.port.postMessage({ type: "decode", on: true });
  }
  mmdDetectRender();
  mmdOverlay();
}

// Clear (mmdClear), while it's on: the signals found forgotten, its decoders listening afresh
function mmdDetectClear()
{
  if (!DETECT.on) return;
  DETECT.found.clear();
  DETECT.sstvPics = {};
  DETECT.listKey = null;
  mmdDetectResetAll();
  mmdDetectRender();
}

// Off: next is the mode it goes to (the one it was in, or the one picked). The CW signals the worklet decoded meanwhile go, unless CW is
// where it goes or was (they're its own then)
function mmdDetectStop(next)
{
  DETECT.on = false;
  detectList.style.display = "none";
  cwDetectButton.classList.remove("cwTestOn");
  mmdDetectResetAll();
  if (next != "cw" && DEC.mode != "cw")
  {
    for (const id in DEC.signals) if (Number(id) < MMD_CW_ID_MAX) delete DEC.signals[id];
    DEC.focus = null;
  }
  DETECT.found.clear();
  mmdOverlay();
}

// ---- Its decoders

function mmdDetectWorker(name, file, rate, config)
{
  const W = DETECT.workers;
  if (!W[name])
  {
    W[name] = new Worker(file);
    W[name].onmessage = (event) => mmdDetectMessage(name, event.data);
  }
  if (rate && DETECT.rates[name] != rate)
  {
    DETECT.rates[name] = rate;
    W[name].postMessage({ type: "init", rate });
    if (config) W[name].postMessage(config);
  }
  return W[name];
}

// Every decoder here listening afresh
function mmdDetectResetAll()
{
  for (const name in DETECT.workers) DETECT.workers[name].postMessage({ type: "reset" });
  // (the plugins' own: their registrations' detectReset)
  mmdPluginsEach("detectReset");
}

// The input's own samples: the plugins' detect decoders (the keyboard modes', Packet's: their registrations' detectRaw, each copying
// them into its own)
function mmdDetectRawAudio(data)
{
  mmdPluginsEach("detectRaw", data);
}

// The 12 kHz audio: the plugins' detect decoders (FT8's and FT4's: their registrations' detectAudio, each copying it into its own),
// then SSTV's
function mmdDetectAudio12(data)
{
  mmdPluginsEach("detectAudio", data);
  mmdDetectWorker("sstv", "lib/mmd/sstvWorker.js", 0, null).postMessage({ type: "audio", samples: data.samples }, [data.samples.buffer]);
}

function mmdDetectMessage(name, m)
{
  if (!DETECT.on) return;
  if (name == "sstv")
  {
    // A VIS code heard starts a picture; it's SSTV once enough of its lines have their sync pulse (a VIS read from another mode's tones
    // has few). Named at its tones' middle (1200 to 2300 Hz), where its sender was found
    if (m.type == "start") DETECT.sstvPics[m.id] = { name: m.name, shift: m.shift || 0 };
    else if (m.type == "status" && DETECT.sstvPics[m.id] && m.measured >= DETECT_SSTV_LINES && m.syncs >= DETECT_SSTV_SYNCS * m.measured)
    {
      const p = DETECT.sstvPics[m.id];
      mmdDetectFound("sstv", "SSTV " + p.name, 1750 + p.shift, m.snr, p.name, {});
    }
  }
}

// An RSID heard (mmdRsid.js): the plugins' decoders here leave its place alone a moment, as the mode's own do (the keyboard modes':
// their registration's detectRsid)
function mmdDetectRsid(freq)
{
  if (!DETECT.on) return;
  mmdPluginsEach("detectRsid", freq);
}

// A signal named: a new line, or the one there already (the same decoder, near enough) brought up to date. by: the decoder here that
// named it (PSK63's and PSK31's are each their own), else the mode
function mmdDetectFound(mode, label, hz, snr, text, sub, by = mode)
{
  if (!(hz > 0)) return;
  const near = mmdDetectSameHz(mode);
  let f = null;
  for (const g of DETECT.found.values()) if ((g.by || g.mode) == by && Math.abs(g.hz - hz) < near) f = g;
  if (!f)
  {
    f = { key: mode + ":" + Math.round(hz) + ":" + Date.now(), mode };
    DETECT.found.set(f.key, f);
  }
  Object.assign(f, { label, hz, snr: snr != null ? snr : f.snr, text: String(text || "").trim().slice(-60), at: Date.now(), sub, by });
}

// The share of a text's characters in words (DETECT_OVERLAP's note)
function mmdDetectQuality(text)
{
  let all = 0, good = 0;
  for (const word of String(text || "").split(/\s+/))
  {
    if (!word) continue;
    all += word.length;
    if (word.length >= 2 && (/[AEIOUYaeiouy0-9]/.test(word) || DETECT_HAM_WORDS.has(word.toUpperCase().replace(/[.,?!]+$/, ""))) && !/(.)\1\1/.test(word) && (word.length < 4 || new Set(word.toUpperCase()).size * 2 > word.length)) good += word.length;
  }
  return all ? good / all : 0;
}

// The bandwidth a signal found takes (Hz)
function mmdDetectWidth(f)
{
  // (a plugin's mode: its detect's width, a number or worked out from the find: DominoEX's from its speed, RTTY's from its shift)
  const spec = mmdPluginDetectSpec(f.mode);
  if (spec && typeof spec.width == "function")
  {
    const width = Number(mmdPluginGuard(mmdPluginOf(f.mode) || {}, () => spec.width(f)));
    if (width > 0) return width;
  }
  else if (spec && Number(spec.width) > 0) return Number(spec.width);
  const widths = { cw: 50, sstv: 1100 };
  return widths[f.mode] || 100;
}

// The signals found that are shown (DETECT_OVERLAP's note), by frequency
function mmdDetectShown()
{
  const list = [...DETECT.found.values()].filter((f) => !(mmdDetectQuality(f.text) < mmdDetectFloor(f.mode)));
  // (a mode's checked decodes read best, FT8's and FT4's: often of calls and reports that aren't words)
  for (const f of list) f.quality = mmdDetectChecked(f.mode) ? 1 : mmdDetectQuality(f.text);
  const better = (a, b) => Math.abs(a.quality - b.quality) > DETECT_ALIKE ? a.quality > b.quality : mmdDetectRank(a.mode) > mmdDetectRank(b.mode);
  return list.filter((f) => !list.some((g) => g != f && g.by != f.by && Math.abs(g.hz - f.hz) < DETECT_OVERLAP * (mmdDetectWidth(f) + mmdDetectWidth(g)) / 2 && better(g, f)))
    .sort((a, b) => a.hz - b.hz);
}

// ---- Each render (mmdRender, 4 a second): CW's signals looked at, the list and the waterfall's labels
function mmdDetectTick()
{
  if (!DETECT.on) return;
  const now = Date.now();
  // CW: the worklet's signals (CW's ids) that read like CW
  for (const id in DEC.signals)
  {
    if (Number(id) >= MMD_CW_ID_MAX) continue;
    const s = DEC.signals[id];
    const text = s.text.trim();
    if (!s.alive || s.wpm < 8 || s.wpm > 50 || text.replace(/ /g, "").length < DETECT_CW_CHARS) continue;
    const calls = text.match(DETECT_CW_CALL) || [];
    if (!DETECT_CW_WORDS.test(text) && calls.length == new Set(calls).size) continue;
    mmdDetectFound("cw", "CW " + Math.round(s.wpm) + " WPM", s.freq, s.snr, text, { id: s.id });
  }
  for (const [key, f] of DETECT.found) if (now - f.at > DETECT_KEEP_MS) DETECT.found.delete(key);
  mmdDetectRender();
  mmdOverlay();
}

// ---- Shown

// The list in the mode's place: by frequency, each its mode (in its colour), frequency (on the air where the rig is read, else audio),
// dB and what was heard; a click on one decodes it
function mmdDetectRender()
{
  const list = mmdDetectShown();
  const opener = window.opener;
  const html = list.map((f) =>
  {
    const air = opener.mmDecoderAirHz(f.hz);
    const freq = air == null ? Math.round(f.hz) + " Hz" : mmdFreq(air);
    const db = f.snr != null && f.snr > -30 ? String(Math.round(f.snr)) : "";
    return "<tr data-key='" + mmdEscape(f.key) + "' title=\"" + mmdEscape(I18N("cwViewer.detect.pick.hover")).replace(/"/g, "&quot;") + "\"><td style='color:" + mmdDetectColor(f.mode) + "'>" + mmdEscape(f.label) +
      "</td><td class='ft8Num'>" + freq + "</td><td class='ft8Num'>" + db + "</td><td>" + mmdEscape(f.text) + "</td></tr>";
  }).join("");
  if (html != DETECT.listKey)
  {
    DETECT.listKey = html;
    detectRows.innerHTML = html;
  }
  detectEmpty.style.display = list.length ? "none" : "";
  mmdStatus(I18N("cwViewer.detect.status").replace("{count}", list.length));
}

// On the waterfall (mmdOverlay): each signal found, a line at its frequency and its name in a box at the top in its colour, the boxes
// stepped down where they would cover each other
function mmdDetectDraw(ctx, x, ratio, w, h)
{
  if (!DETECT.on) return;
  const list = mmdDetectShown();
  const rows = [];
  for (const f of list)
  {
    const at = Math.round(x(f.hz)) + 0.5;
    const color = mmdDetectColor(f.mode);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, Math.round(ratio));
    ctx.setLineDash([3 * ratio, 3 * ratio]);
    ctx.beginPath();
    ctx.moveTo(at, 0);
    ctx.lineTo(at, h);
    ctx.stroke();
    ctx.setLineDash([]);
    // The first row of labels it fits in
    ctx.font = "bold " + Math.round(11 * ratio) + "px sans-serif";
    const half = ctx.measureText(f.label).width / 2 + 8 * ratio;
    let level = 0;
    while (rows[level] != null && rows[level] > at - half) level++;
    rows[level] = at + half;
    mmdOverlayLabel(ctx, f.label, at, (4 + level * 22) * ratio, "center", 11, ratio, w, color);
  }
}

// A click on the waterfall (audio hz) while it's on: the signal found nearest, if near enough, decoded; true when one was
function mmdDetectClickAt(hz)
{
  if (!DETECT.on || hz == null) return false;
  let best = null;
  for (const f of mmdDetectShown()) if (Math.abs(f.hz - hz) < DETECT_PICK_HZ && (!best || Math.abs(f.hz - hz) < Math.abs(best.hz - hz))) best = f;
  if (best) mmdDetectPick(best);
  return !!best;
}

// A signal picked: its mode chosen (which turns Detect Modes off: mmdModeSet), and aimed at it
function mmdDetectPick(f)
{
  // (a plugin's mode, before it's chosen: its submode picked with it, PSK63, MFSK32, THOR 16 ...: its registration's detectBefore)
  const def = mmdPluginOf(f.mode);
  mmdPluginCall(def, "detectBefore", f);
  cwMode.value = f.mode;
  mmdModeSet(f.mode);
  if (f.mode == "cw") mmdFocus(DEC.signals[f.sub.id] ? f.sub.id : mmdSignalNear(f.hz));
  // A mode with a focus (FT8, FT4): the focus on its station
  else if (mmdFocusHalf())
  {
    DEC.bandFocus = Math.round(f.hz);
    mmdOverlay();
  }
  // (a plugin's: aimed at it, Packet's HF place locked: its detectAfter)
  mmdPluginCall(def, "detectAfter", f);
}

function mmdDetectInit()
{
  detectRows.addEventListener("click", (event) =>
  {
    const row = event.target.closest("tr[data-key]");
    const f = row ? DETECT.found.get(row.dataset.key) : null;
    if (f && String(window.getSelection()).length == 0) mmdDetectPick(f);
  });
}
