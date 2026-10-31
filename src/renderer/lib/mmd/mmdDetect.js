// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// Detect Modes (the button beside Test Signals): every mode decoded here but FT8 and FT4 listened for at once, and each signal named once
// it is known: by its own decoder decoding it (each a copy of its mode's: CW from the worklet's own decoder, PSK31 and RTTY from two
// keyWorker.js, Packet from packetWorker.js, SSTV from sstvWorker.js), so a name is only given to what really decodes. Olivia and
// Contestia aren't looked for (their decoder needs the submode, and a search of every one costs too much): an RSID's label (mmdRsid.js)
// names them, and every mode, as always.
// The mode it was in waits meanwhile (its decoder hears nothing, its list is hidden): the signals found are listed in its place (mode,
// frequency, dB, what was heard) and labelled on the waterfall. A click on one (either) decodes it: Detect Modes off, its mode chosen and
// aimed at it (CW's signal pinned, Packet's HF place locked). Detect Modes off by its button: the mode
// it was in goes on

// A signal found stays listed this long after it was last heard (ms)
const DETECT_KEEP_MS = 120000;
// Two finds of a mode this close (Hz) are the same signal
const DETECT_SAME_HZ = { cw: 40, psk31: 30, rtty: 60, packet: 150, sstv: 300 };
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
const DETECT_COLORS = { cw: "#ffe066", psk31: "#7dff7d", rtty: "#66e0ff", packet: "#ffa64d", sstv: "#d68cff" };

const DETECT = {
  on: false,
  // Its own decoders: workers (and the rate each was set up for), and what PSK31's and RTTY's channels are (by id)
  psk: null,
  rtty: null,
  packet: null,
  sstv: null,
  rates: {},
  channels: { psk: {}, rtty: {} },
  // The signals found: by key, { key, mode, label, hz (audio), snr, text, at, sub (what picking it needs) }
  found: new Map(),
  // SSTV's pictures begun, by id: { name, shift } (named once their lines show sync pulses)
  sstvPics: {},
  listKey: ""
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
  DETECT.listKey = "";
  DETECT.channels = { psk: {}, rtty: {} };
  DETECT.sstvPics = {};
  for (const w of [DETECT.psk, DETECT.rtty, DETECT.packet, DETECT.sstv]) if (w) w.postMessage({ type: "reset" });
  // A test signal playing stops (it was the last mode's)
  mmdTestStop();
  // The mode's own list hidden, the signals found listed in its place
  for (const el of [cwList, ft8List, packetList, sstvView, satList]) el.style.display = "none";
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

// Off: next is the mode it goes to (the one it was in, or the one picked). The CW signals the worklet decoded meanwhile go, unless CW is
// where it goes or was (they're its own then)
function mmdDetectStop(next)
{
  DETECT.on = false;
  detectList.style.display = "none";
  cwDetectButton.classList.remove("cwTestOn");
  for (const w of [DETECT.psk, DETECT.rtty, DETECT.packet, DETECT.sstv]) if (w) w.postMessage({ type: "reset" });
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
  if (!DETECT[name])
  {
    DETECT[name] = new Worker(file);
    DETECT[name].onmessage = (event) => mmdDetectMessage(name, event.data);
  }
  if (rate && DETECT.rates[name] != rate)
  {
    DETECT.rates[name] = rate;
    DETECT[name].postMessage({ type: "init", rate });
    if (config) DETECT[name].postMessage(config);
  }
  return DETECT[name];
}

// The input's own samples: PSK31's, RTTY's and Packet's decoders (each its own copy)
function mmdDetectRawAudio(data)
{
  const range = { minHz: mmdMinHz(), maxHz: mmdMaxHz() };
  const psk = mmdDetectWorker("psk", "lib/mmd/keyWorker.js", data.rate, Object.assign({ type: "config", mode: "psk31" }, range));
  const rtty = mmdDetectWorker("rtty", "lib/mmd/keyWorker.js", data.rate, Object.assign({ type: "config", mode: "rtty" }, range));
  const packet = mmdDetectWorker("packet", "lib/mmd/packetWorker.js", data.rate, { type: "hf", min: range.minHz, max: range.maxHz, lock: null });
  const a = data.samples.slice(), b = data.samples.slice();
  psk.postMessage({ type: "audio", samples: a }, [a.buffer]);
  rtty.postMessage({ type: "audio", samples: b }, [b.buffer]);
  packet.postMessage({ type: "audio", samples: data.samples }, [data.samples.buffer]);
}

// The 12 kHz audio: SSTV's decoder
function mmdDetectAudio12(data)
{
  mmdDetectWorker("sstv", "lib/mmd/sstvWorker.js", 0, null).postMessage({ type: "audio", samples: data.samples }, [data.samples.buffer]);
}

function mmdDetectMessage(name, m)
{
  if (!DETECT.on) return;
  if (name == "psk" || name == "rtty")
  {
    const channels = DETECT.channels[name];
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
      if (name == "psk") mmdDetectFound("psk31", "PSK31", c.freq, c.snr, c.text, {});
      else
      {
        const baud = c.baud > 0 ? c.baud : 45.45;
        mmdDetectFound("rtty", "RTTY " + Math.floor(baud) + "/" + c.shift, c.freq, c.snr, c.text, {});
      }
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

// An RSID heard (mmdRsid.js): PSK31's and RTTY's decoders here leave its place alone a moment, as the mode's own do (keyWorker.js)
function mmdDetectRsid(freq)
{
  if (!DETECT.on) return;
  for (const w of [DETECT.psk, DETECT.rtty]) if (w) w.postMessage({ type: "rsid", freq });
}

// A signal named: a new line, or the one there already (the same mode, near enough) brought up to date
function mmdDetectFound(mode, label, hz, snr, text, sub)
{
  if (!(hz > 0)) return;
  const near = DETECT_SAME_HZ[mode] || 50;
  let f = null;
  for (const g of DETECT.found.values()) if (g.mode == mode && Math.abs(g.hz - hz) < near) f = g;
  if (!f)
  {
    f = { key: mode + ":" + Math.round(hz) + ":" + Date.now(), mode };
    DETECT.found.set(f.key, f);
  }
  Object.assign(f, { label, hz, snr: snr != null ? snr : f.snr, text: String(text || "").trim().slice(-60), at: Date.now(), sub });
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
  const list = [...DETECT.found.values()].sort((a, b) => a.hz - b.hz);
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
  const list = [...DETECT.found.values()].sort((a, b) => a.hz - b.hz);
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
  for (const f of DETECT.found.values()) if (Math.abs(f.hz - hz) < DETECT_PICK_HZ && (!best || Math.abs(f.hz - hz) < Math.abs(best.hz - hz))) best = f;
  if (best) mmdDetectPick(best);
  return !!best;
}

// A signal picked: its mode chosen (which turns Detect Modes off: mmdModeSet), and aimed at it
function mmdDetectPick(f)
{
  cwMode.value = f.mode;
  mmdModeSet(f.mode);
  if (f.mode == "cw") mmdFocus(DEC.signals[f.sub.id] ? f.sub.id : mmdSignalNear(f.hz));
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
