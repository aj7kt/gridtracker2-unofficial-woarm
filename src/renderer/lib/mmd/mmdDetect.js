// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// Detect Modes (the button beside Test Signals): the modes decoded here listened for at once, and each signal named once it is known: by
// its own decoder decoding it (each a copy of its mode's: CW from the worklet's own decoder, PSK31, PSK63, PSK125, QPSK31 and RTTY each
// from a keyWorker.js, MFSK16 and MFSK32 from mfskWorker.js, DominoEX and THOR (every speed) from thorWorker.js, Packet from
// packetWorker.js, SSTV from sstvWorker.js, FT8 and FT4 each from an ft8Worker.js), so a name is only given to what really decodes. Olivia and
// Contestia aren't looked for (their decoder needs the submode, and a search of every one costs too much): an RSID's label (mmdRsid.js)
// names them, and every mode, as always.
// The mode it was in waits meanwhile (its decoder hears nothing, its list is hidden): the signals found are listed in its place (mode,
// frequency, dB, what was heard) and labelled on the waterfall. A click on one (either) decodes it: Detect Modes off, its mode chosen and
// aimed at it (CW's signal pinned, Packet's HF place locked). Detect Modes off by its button: the mode
// it was in goes on

// A signal found stays listed this long after it was last heard (ms)
const DETECT_KEEP_MS = 120000;
// Two finds of a mode this close (Hz) are the same signal
const DETECT_SAME_HZ = { cw: 40, psk31: 30, rtty: 60, mfsk: 60, thor: 80, packet: 150, sstv: 300, ft8: 20, ft4: 30 };
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
// Each mode's label colour (the waterfall's labels, the list's Mode)
const DETECT_COLORS = { cw: "#ffe066", psk31: "#7dff7d", rtty: "#66e0ff", mfsk: "#ff8cc6", thor: "#b0ff4d", packet: "#ffa64d", sstv: "#d68cff", ft8: "#4dffc3", ft4: "#9999ff" };
// FT8 and FT4: each period of the 12 kHz audio decoded the Normal way as it ends (its period, ms), each message a station found in the
// middle of its tones (its width, Hz). A decode is checked (its CRC), so it is that mode: it reads best wherever it overlaps another
const DETECT_FTX = { ft8: { periodMs: FT8_PERIOD_MS, width: 50 }, ft4: { periodMs: FT4_PERIOD_MS, width: 250 / 3 } };
// The keyboard modes' decoders here: each its worker's name, file and config; the mode it names (the Mode menu's) and its submode
// there (sub: the channel's, for DominoEX / THOR); its label
const DETECT_KEYS = [
  { name: "psk", file: "lib/mmd/keyWorker.js", config: { mode: "psk31" }, mode: "psk31", sub: () => "psk31", label: () => "PSK31" },
  { name: "psk63", file: "lib/mmd/keyWorker.js", config: { mode: "psk63" }, mode: "psk31", sub: () => "psk63", label: () => "PSK63" },
  { name: "psk125", file: "lib/mmd/keyWorker.js", config: { mode: "psk125" }, mode: "psk31", sub: () => "psk125", label: () => "PSK125" },
  { name: "qpsk31", file: "lib/mmd/keyWorker.js", config: { mode: "qpsk31" }, mode: "psk31", sub: () => "qpsk31", label: () => "QPSK31" },
  { name: "rtty", file: "lib/mmd/keyWorker.js", config: { mode: "rtty" }, mode: "rtty", sub: () => null, label: (c) => "RTTY " + Math.floor(c.baud > 0 ? c.baud : 45.45) + "/" + c.shift },
  { name: "mfsk16", file: "lib/mmd/mfskWorker.js", config: { mode: "mfsk16" }, mode: "mfsk", sub: () => "mfsk16", label: () => "MFSK16" },
  { name: "mfsk32", file: "lib/mmd/mfskWorker.js", config: { mode: "mfsk32" }, mode: "mfsk", sub: () => "mfsk32", label: () => "MFSK32" },
  { name: "thor", file: "lib/mmd/thorWorker.js", config: { mode: "any", baud: "all" }, mode: "thor", sub: (c) => c.mode + " " + c.submode, label: (c) => (c.mode == "thor" ? "THOR " : "DominoEX ") + c.submode }
];
const DETECT_KEY_NAMES = DETECT_KEYS.map((k) => k.name);
// Another mode's decoder reads a signal after a fashion now and then (RTTY's a run of one letter on MFSK's tones, PSK31's a jumble on
// PSK63's, CW's a few letters on DominoEX's): where two signals found overlap (their bandwidths, by this share), only the one whose text
// reads best is shown, the more particular mode where they read alike. The text's quality: the share of its characters in words (two
// characters or more, a vowel or a digit, no letter three times running, and from four characters up more different ones than half its
// length: RTTY's "MMVVIV" on MFSK's tones isn't a word)
const DETECT_OVERLAP = 0.8;
const DETECT_RANK = { ft8: 10, ft4: 10, sstv: 9, packet: 8, thor: 7, mfsk: 7, psk31: 6, rtty: 4, cw: 3 };
const DETECT_ALIKE = 0.1;
// Operators' words with no vowel, words all the same
const DETECT_HAM_WORDS = new Set(["CQ", "QTH", "QSL", "QST", "QRZ", "QRM", "QRN", "QRP", "QSB", "QSY", "RST", "TNX", "TKS", "PWR", "WX", "HW", "SK", "KN", "BK", "DX", "CW", "FB", "GM", "GN", "GL", "HR", "NR", "PSK", "RTTY", "SSB", "BTW"]);
// PSK's and RTTY's text read worse than this isn't shown at all (theirs alone: CW's has its own test, the others print no false text)
const DETECT_FLOOR = { psk31: 0.5, rtty: 0.5 };

const DETECT = {
  on: false,
  // Its own decoders: workers by name (the keyboard modes' as DETECT_KEYS names them, packet, sstv), the rate each was set up for, and
  // what the keyboard modes' channels are (by worker, by id)
  workers: {},
  rates: {},
  channels: {},
  // The signals found: by key, { key, mode, label, hz (audio), snr, text, at, sub (what picking it needs) }
  found: new Map(),
  // SSTV's pictures begun, by id: { name, shift } (named once their lines show sync pulses)
  sstvPics: {},
  // FT8's and FT4's decoders: by mode, { worker, ring, total (samples ever), endWall (ms: when the newest was heard), next (the period
  // to decode, ms) }
  ftx: {},
  listKey: null
};

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
  DETECT.channels = {};
  DETECT.sstvPics = {};
  mmdDetectResetAll();
  // A test signal playing stops (it was the last mode's); a picture being sent, or Tune, too (its Send tab is hidden meanwhile, and the
  // status line is Detect Modes', mmdSstvTx.js)
  mmdTestStop();
  if (mmdSstvTxKeying()) mmdSstvTxStop(I18N("sstvTx.status.stopped"));
  // The mode's own list hidden, the signals found listed in its place
  for (const el of [cwList, ft8List, packetList, sstvView, satList, hellView, navtexList, wsprList]) el.style.display = "none";
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
  DETECT.channels = {};
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
    for (const id in DEC.signals) if (Number(id) < KEY_ID_BASE) delete DEC.signals[id];
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
  for (const mode in DETECT.ftx) DETECT.ftx[mode].total = 0;
}

// The input's own samples: the keyboard modes' and Packet's decoders (each its own copy)
function mmdDetectRawAudio(data)
{
  const range = { minHz: mmdMinHz(), maxHz: mmdMaxHz() };
  for (const k of DETECT_KEYS)
  {
    const samples = data.samples.slice();
    mmdDetectWorker(k.name, k.file, data.rate, Object.assign({ type: "config" }, k.config, range)).postMessage({ type: "audio", samples }, [samples.buffer]);
  }
  const packet = mmdDetectWorker("packet", "lib/mmd/packetWorker.js", data.rate, { type: "hf", min: range.minHz, max: range.maxHz, lock: null });
  packet.postMessage({ type: "audio", samples: data.samples }, [data.samples.buffer]);
}

// The 12 kHz audio: FT8's and FT4's decoders (copied into theirs first), then SSTV's
function mmdDetectAudio12(data)
{
  mmdDetectFtxAudio(data);
  mmdDetectWorker("sstv", "lib/mmd/sstvWorker.js", 0, null).postMessage({ type: "audio", samples: data.samples }, [data.samples.buffer]);
}

// FT8's or FT4's decoder here (ft8.wasm in its own ft8Worker.js, as the mode's own: mmdFt8Load)
function mmdDetectFtxLoad(mode)
{
  if (DETECT.ftx[mode]) return DETECT.ftx[mode];
  const bytes = fs.readFileSync(NodeURL.fileURLToPath(new URL("lib/mmd/ft8.wasm", location.href)));
  const worker = new Worker("lib/mmd/ft8Worker.js");
  const prefixes = Object.keys(GT.prefixToDXCC || {}).filter((prefix) => /^[A-Z0-9]+$/.test(prefix)).join("\n");
  worker.postMessage({ type: "init", wasm: bytes, audio: FT8_AUDIO, passes: FT8_PASSES, prefixes: prefixes });
  const F = { worker: worker, ring: new Float32Array(FT8_KEEP_S * FT8_RATE), total: 0, endWall: 0, next: 0 };
  worker.onmessage = (event) => mmdDetectFtxDecoded(mode, event.data);
  DETECT.ftx[mode] = F;
  return F;
}

// A chunk of the 12 kHz audio into each one's ring, with when its last sample was heard (as mmdFt8Audio); each period heard to its end
// decoded
function mmdDetectFtxAudio(data)
{
  if (!DEC.ctx) return;
  const stamp = DEC.ctx.getOutputTimestamp();
  const endWall = performance.timeOrigin + stamp.performanceTime + (data.end - stamp.contextTime) * 1000 - FT8_LATENCY_MS;
  const n = data.samples.length;
  for (const mode in DETECT_FTX)
  {
    let F;
    try
    {
      F = mmdDetectFtxLoad(mode);
    }
    catch (e)
    {
      continue;
    }
    const periodMs = DETECT_FTX[mode].periodMs;
    const size = F.ring.length;
    for (let i = 0; i < n; i++) F.ring[(F.total + i) % size] = data.samples[i];
    // Heard from scratch: the first period decoded is the first that starts after the audio does
    if (F.total == 0) F.next = Math.ceil((endWall - (n / FT8_RATE) * 1000) / periodMs) * periodMs;
    F.total += n;
    F.endWall = endWall;
    while (F.endWall >= F.next + periodMs + FT8_LATE_MS)
    {
      mmdDetectFtxDecode(mode, F, F.next, periodMs);
      F.next += periodMs;
    }
  }
}

// The period starting at start out of the ring, to the worker
function mmdDetectFtxDecode(mode, F, start, periodMs)
{
  const first = F.total - Math.round(((F.endWall - start) / 1000) * FT8_RATE);
  const count = Math.round((periodMs / 1000) * FT8_RATE);
  if (first < 0 || first < F.total - F.ring.length) return;
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) samples[i] = F.ring[(first + i) % F.ring.length];
  const ft4 = mode == "ft4";
  const myCall = (GT.settings.app.myCall || "").trim().toUpperCase();
  F.worker.postMessage({ type: "decode", start: start, samples: samples, more: false, myCall: myCall, focus: 0, shift: 0, deadline: Date.now() + (ft4 ? FT4_BUDGET_MS : FT8_FULL_BUDGET_MS), plain: true, ft4: ft4 }, [samples.buffer]);
}

// A period's messages: each a station found ([dB, DT, audio Hz of its lowest tone, message])
function mmdDetectFtxDecoded(mode, data)
{
  if (!DETECT.on || data.type != "decoded") return;
  const label = mode.toUpperCase();
  for (const line of data.text.split("\n").filter(Boolean))
  {
    const [snr, , freq, message] = line.split("\t");
    if (!message) continue;
    mmdDetectFound(mode, label, Number(freq) + DETECT_FTX[mode].width / 2, Number(snr), message, {});
  }
}

function mmdDetectMessage(name, m)
{
  if (!DETECT.on) return;
  const k = DETECT_KEYS.find((d) => d.name == name);
  if (k)
  {
    const channels = DETECT.channels[name] || (DETECT.channels[name] = {});
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
      mmdDetectFound(k.mode, k.label(c), c.freq, c.snr, c.text, { key: k.sub(c) }, name);
    }
  }
  else if (name == "packet" && m.type == "frame")
  {
    // HF 300 baud where it was heard; AFSK 1200 midway between its tones; 9600 (FM's flat audio) mid-passband
    const hz = m.hz > 0 ? m.hz : m.baud == 1200 ? 1700 : (mmdMinHz() + mmdMaxHz()) / 2;
    mmdDetectFound("packet", "Packet " + m.baud, hz, null, m.src + ">" + m.dst, { baud: m.baud, hz: m.hz > 0 ? m.hz : null });
  }
  else if (name == "sstv")
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

// An RSID heard (mmdRsid.js): the keyboard modes' decoders here leave its place alone a moment, as the mode's own do (mmdKey.js)
function mmdDetectRsid(freq)
{
  if (!DETECT.on) return;
  for (const name of DETECT_KEY_NAMES) if (DETECT.workers[name]) DETECT.workers[name].postMessage({ type: "rsid", freq });
}

// A signal named: a new line, or the one there already (the same decoder, near enough) brought up to date. by: the decoder here that
// named it (PSK63's and PSK31's are each their own), else the mode
function mmdDetectFound(mode, label, hz, snr, text, sub, by = mode)
{
  if (!(hz > 0)) return;
  const near = DETECT_SAME_HZ[mode] || 50;
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
  if (f.mode == "thor")
  {
    // 18 tones, a baud apart (twice that at 4, 5 and 8)
    const baud = Number(String(f.sub.key).split(" ")[1]) || 11;
    return 18 * baud * (baud <= 8 ? 2 : 1);
  }
  if (f.mode == "rtty") return (Number(f.label.split("/")[1]) || 170) + 100;
  if (DETECT_FTX[f.mode]) return DETECT_FTX[f.mode].width;
  const widths = { psk: 62, psk63: 125, psk125: 250, qpsk31: 62, mfsk16: 316, mfsk32: 630, cw: 50, packet: 400, sstv: 1100 };
  return widths[f.by] || widths[f.mode] || 100;
}

// The signals found that are shown (DETECT_OVERLAP's note), by frequency
function mmdDetectShown()
{
  const list = [...DETECT.found.values()].filter((f) => !(mmdDetectQuality(f.text) < (DETECT_FLOOR[f.mode] || 0)));
  // (FT8's and FT4's read best: checked decodes, often of calls and reports that aren't words)
  for (const f of list) f.quality = DETECT_FTX[f.mode] ? 1 : mmdDetectQuality(f.text);
  const better = (a, b) => Math.abs(a.quality - b.quality) > DETECT_ALIKE ? a.quality > b.quality : (DETECT_RANK[a.mode] || 0) > (DETECT_RANK[b.mode] || 0);
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
    if (Number(id) >= KEY_ID_BASE) continue;
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
    return "<tr data-key='" + mmdEscape(f.key) + "' title=\"" + mmdEscape(I18N("cwViewer.detect.pick.hover")).replace(/"/g, "&quot;") + "\"><td style='color:" + DETECT_COLORS[f.mode] + "'>" + mmdEscape(f.label) +
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
    ctx.strokeStyle = DETECT_COLORS[f.mode];
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
    mmdOverlayLabel(ctx, f.label, at, (4 + level * 22) * ratio, "center", 11, ratio, w, DETECT_COLORS[f.mode]);
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
  // A keyboard mode's submode (PSK63, MFSK32, THOR 16 ...) picked with it
  if (f.sub && f.sub.key && KEY_MODES[f.mode] && KEY_MODES[f.mode].subs) GT.settings.MMD[KEY_MODES[f.mode].setting] = f.sub.key;
  cwMode.value = f.mode;
  mmdModeSet(f.mode);
  if (f.mode == "cw") mmdFocus(DEC.signals[f.sub.id] ? f.sub.id : mmdSignalNear(f.hz));
  // FT8 and FT4: the focus on its station
  else if (DETECT_FTX[f.mode])
  {
    DEC.ft8Focus = Math.round(f.hz);
    mmdOverlay();
  }
  else if (f.mode == "packet" && f.sub.hz)
  {
    PACKET.lock = null;
    mmdPacketLock(f.sub.hz);
  }
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
