// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Multi-Mode Decoder window (gt_mmdecoder.html): the Input Device's audio decoded while the window shows (an AudioWorklet running
// cwdecoder.wasm, mmdWorklet.js), the waterfall of the receiver's passband with the signals found marked over it, and a line of decoded
// text for each signal, a CQ and the call after it picked out. The window is the main window's (services/mmDecoder.js): it widens the
// rig's filter while decoding here, and gives each signal's frequency on the air from Rig Control

const CW_FALL_ROWS = 160;
// A callsign, as GT has told one for years: GridTracker2.js's CALLSIGN_REGEXP (the roster keeps a copy too, processRosterFiltering.js)
const CALLSIGN_REGEXP = /^([A-Z0-9]+\/){0,1}([0-9][A-Z]{1,2}[0-9]|[A-Z]{1,2}[0-9])([A-Z0-9]+)(\/[A-Z0-9/]+){0,1}$/;
const CW_TEXT_KEEP = 400;
// A signal no longer found stays listed this long after its last character (ms)
const CW_GONE_MS = 120000;
// A row is a CQ row this long after its last CQ (ms)
const CW_CQ_MS = 90000;
// A row's text read again (the decoder corrected it) is shown so for this long (ms)
const CW_REVISED_MS = 1500;
// The guard lines over the waterfall either side of the signal under the mouse (Hz from it: about its filter's width), and how near the
// mouse on the waterfall must be to a signal to pick it (Hz)
const CW_GUARD_HZ = 50;
const CW_PICK_HZ = 40;
// Min Freq and Max Freq (the scale's [ and ]): Min's default and floor (Hz of audio; under 150 is hum; Max is the span's top until
// dragged), how close they may come, and how near the mouse must be to one to drag it (CSS pixels)
const CW_RANGE_MIN = 250;
const CW_RANGE_FLOOR = 150;
// Bandwidth: the span decoded (Hz from 0), as its menu shows it; 44.1k, 48k and 96k are the whole of a stream at that sample rate (half
// of it is the spectrum it carries)
const CW_BANDWIDTHS = [[2500, "2.5k"], [3000, "3k"], [3500, "3.5k"], [4000, "4k"], [4500, "4.5k"], [10000, "10k"], [22050, "44.1k"], [24000, "48k"], [48000, "96k"]];
const CW_RANGE_GAP = 100;
const CW_BRACKET_GRAB = 7;
// A signal found again after the rig has moved, within this of where a listed one was (Hz on the air), goes on in that one's row
const CW_SAME_SIGNAL_HZ = 40;
// The scan: each band (Hz, its edges) and the CW part of it scanned; the audio heard at each step (Hz), the steps overlapping a little
const CW_BANDS = [
  [1800000, 2000000, 1800000, 1840000],
  [3500000, 4000000, 3500000, 3570000],
  [7000000, 7300000, 7000000, 7040000],
  [10100000, 10150000, 10100000, 10130000],
  [14000000, 14350000, 14000000, 14070000],
  [18068000, 18168000, 18068000, 18095000],
  [21000000, 21450000, 21000000, 21070000],
  [24890000, 24990000, 24890000, 24915000],
  [28000000, 29700000, 28000000, 28070000],
  [50000000, 54000000, 50000000, 50100000]
];
const CW_SCAN_AUDIO = [250, 3000];
const CW_SCAN_OVERLAP = 250;
const CW_SCAN_DWELLS = [5, 10, 15, 20, 30];
// After the viewer tunes the rig, how long it waits for Rig Control to read the new frequency back (ms)
const CW_TUNE_SETTLE_MS = 2500;
// FT8 mode: the worklet's 12 kHz audio kept this long (s), each 15 s period decoded once this much past its end (ms: the last chunk in),
// the audio searched (Hz, as WSJT-X's default), and at most this many lines kept
const FT8_RATE = 12000;
const FT8_KEEP_S = 40;
const FT8_PERIOD_MS = 15000;
const FT8_LATE_MS = 500;
// Each period is first decoded early, this far into it (ms), as WSJT-X does: most messages are all there by then, and they are shown
// about 3 s sooner. Decoded again at its end, only the messages new then are added (late starters, and weak ones under those found)
const FT8_EARLY_MS = 11800;
// The time a decode may take: the early decode until this far into its period (ms), the full one this long; the candidates left when it
// runs out are the weakest (they are tried strongest first)
const FT8_EARLY_DEADLINE_MS = 14500;
const FT8_FULL_BUDGET_MS = 8000;
// The FT8 focus's span about the place right-clicked (Hz below, above): the signals whose lowest tone is up to 60 below and 15 above it
// (ft8wasm.c), 50 Hz wide
const FT8_FOCUS_SPAN = [60, 65];
const FT8_AUDIO = [100, 4000];
const FT8_ROWS_MAX = 5000;
// The FT8 list scrolls virtually, as the rosters do (renderRoster.js): only the lines in view, and this many either side, are in the page
const FT8_VIRTUAL_BUFFER = 20;
const FT8_PASSES = 3;
// The audio reaches the viewer about this long after it was heard (ms: measured against WSJT-X, whose DT came out this much less), so
// each sample is taken as heard this much earlier; and FT8 sends start half a second into the period, which WSJT-X's DT counts from (s)
const FT8_LATENCY_MS = 300;
const FT8_DT_ZERO = 0.5;
// The mouse wheel's smallest step (Hz), and the turn that makes one step (pixels: a notch of an ordinary wheel)
const CW_WHEEL_MIN_HZ = 1000;
const CW_WHEEL_NOTCH = 100;

const CW = {
  generation: 0,  // a start under way is the newest one; an older one that finishes stops what it opened
  running: false,
  stream: null,
  ctx: null,
  node: null,
  wasm: null,     // cwdecoder.wasm's bytes, read once
  bins: 0,
  binHz: 0,
  span: 4000,     // the span decoded (Hz), as the decoder took it: as much of the Bandwidth chosen as the input carries
  rangeShare: null, // Min and Max as shares of the span, kept while the Bandwidth changes: { min, max }
  device: "",
  // id -> { id, freq (Hz in the audio), air (Hz on the air, null without a rig), wpm, key, alive, text, txStart (where its transmission
  // under way begins in text), last, cqAt, revisedAt (its text last read again) }
  signals: {},
  dirty: false,
  palette: null,
  rowImage: null,
  flipped: false, // the waterfall and scale drawn turned round (mmdFlip)
  seq: 0,         // the retunes told to the worklet: its rows carry the number of the last one it had
  tuned: null,    // the rig's dial (Hz on the air) and mode as last seen
  expect: null,   // the dial this viewer tuned to, until Rig Control reads it back: { freq, until }
  scan: null,     // the band scan under way: { steps (dials), index, timer, low, high }
  hoverRow: null, // the signal whose row is under the mouse (its id): guard lines on the waterfall
  hoverFall: null, // the signal under the mouse on the waterfall: its row shaded, and guard lines
  focus: null,    // the signal pinned (a right-click): its guard lines kept, its row always listed
  mode: "cw",     // what is decoded: "cw" or "ft8" (the Mode menu)
  ft8: null,      // FT8 mode: { X (ft8.wasm), ring, total (samples ever), endWall (ms: when the newest was heard), next (the period to decode, ms) }
  // The FT8 list: every line, the newest first ({ utc, snr, dt, freq, message, first: the first of its period }); the slice in the page,
  // the measured heights it is laid out by, and a redraw waiting for the next frame
  ft8Lines: [],
  ft8Slice: { first: 0, last: 0 },
  ft8RowHeight: 18,
  ft8HeaderHeight: 22,
  ft8ScrollQueued: false,
  brackets: null, // where the scale's [ and ] are drawn (canvas pixels: { left, right })
  dragging: null  // the bracket being dragged: "left" or "right"
};

function mmdInit()
{
  renderI18n();
  document.title = I18N("cwViewer.title");
  CW.palette = mmdPalette();
  window.addEventListener("resize", mmdResize);
  mmdSplitInit();
  window.addEventListener("beforeunload", () => mmdStop());
  // Shown and hidden by the main process: decoding only while it shows (the Input Device is let go while hidden)
  electron.ipcRenderer.on("windowPlaced", (event, visible) => mmdVisible(visible));
  electron.ipcRenderer.on("windowVisible", (event, visible) => mmdVisible(visible));
  nodeTimers.setInterval(mmdRender, 250);
  // A click on a signal's row tunes the rig to it; the scan's button and its seconds at each step
  cwRows.addEventListener("click", (event) =>
  {
    const row = event.target.closest("tr[data-id]");
    const signal = row && CW.signals[row.dataset.id];
    if (signal && signal.air != null) mmdTuneTo(signal.air);
  });
  // The mouse over a row puts guard lines round its signal on the waterfall; over a signal on the waterfall, its row is shaded as well
  cwRows.addEventListener("mouseover", (event) =>
  {
    const row = event.target.closest("tr[data-id]");
    mmdHover("hoverRow", row ? Number(row.dataset.id) : null);
  });
  cwRows.addEventListener("mouseleave", () => mmdHover("hoverRow", null));
  cwOverlay.addEventListener("mousemove", (event) => mmdHover("hoverFall", mmdSignalAt(event.offsetX / cwOverlay.clientWidth)));
  cwOverlay.addEventListener("mouseleave", () => mmdHover("hoverFall", null));
  // The scale's [ and ] (Min Freq and Max Freq) dragged
  cwScale.addEventListener("mousemove", (event) =>
  {
    if (CW.dragging) return;
    const side = mmdBracketAt(event.offsetX);
    cwScale.style.cursor = side ? "ew-resize" : "";
    mmdRangeTip(side);
  });
  cwScale.addEventListener("mouseleave", () => { if (!CW.dragging) mmdRangeTip(null); });
  cwScale.addEventListener("mousedown", (event) =>
  {
    CW.dragging = mmdBracketAt(event.offsetX);
    if (CW.dragging) event.preventDefault();
  });
  window.addEventListener("mousemove", (event) =>
  {
    if (!CW.dragging) return;
    const box = cwScale.getBoundingClientRect();
    // The button let go where the window didn't hear it (outside it): the drag is over
    if (!(event.buttons & 1))
    {
      CW.dragging = null;
      mmdRangeTip(null);
      return;
    }
    mmdBracketMove(CW.dragging, (event.clientX - box.left) / box.width);
  });
  window.addEventListener("mouseup", (event) =>
  {
    if (!CW.dragging) return;
    CW.dragging = null;
    // Still on the bracket: its Hz stays shown
    const box = cwScale.getBoundingClientRect();
    const over = event.clientY >= box.top && event.clientY <= box.bottom ? mmdBracketAt(event.clientX - box.left) : null;
    mmdRangeTip(over);
  });
  // The mouse wheel over the waterfall tunes the rig up (wheel up) or down by its tuning step, else by half the span
  cwOverlay.addEventListener("wheel", mmdWheel, { passive: false });
  // A right-click on a signal on the waterfall, or on its row, pins it; on the pinned one, lets it go
  cwOverlay.addEventListener("contextmenu", (event) =>
  {
    const hz = mmdAudioAt(event.offsetX / cwOverlay.clientWidth);
    if (CW.mode == "ft8") mmdFt8Focus(hz);
    else mmdFocus(mmdSignalNear(hz));
  });
  // FT8: a right-click on a message focuses on its signal (its lowest tone is its Freq, the signal 50 Hz wide)
  ft8Rows.addEventListener("contextmenu", (event) =>
  {
    const row = event.target.closest("tr[data-freq]");
    if (row) mmdFt8Focus(Number(row.dataset.freq) + 25);
  });
  cwRows.addEventListener("contextmenu", (event) =>
  {
    const row = event.target.closest("tr[data-id]");
    if (row && row.dataset.id in CW.signals) mmdFocus(Number(row.dataset.id));
  });
  // The FT8 list's virtual scrolling: its slice redrawn as it scrolls or the window changes size
  ft8List.addEventListener("scroll", mmdFt8Scrolled, { passive: true });
  window.addEventListener("resize", mmdFt8Scrolled);
  // Mode: CW or FT8
  cwMode.value = GT.settings.cwDecoder.viewMode == "ft8" ? "ft8" : "cw";
  cwMode.onchange = () => mmdModeSet(cwMode.value);
  mmdModeSet(cwMode.value);
  // Bandwidth: the decoder started again with it
  const bandwidth = mmdBandwidth();
  for (const [hz, label] of CW_BANDWIDTHS) cwBandwidth.add(new Option(label, hz, false, hz == bandwidth));
  cwBandwidth.onchange = () =>
  {
    // The brackets keep their places as shares of the span: rescaled once the decoder says what span it took (mmdMessage, "ready")
    CW.rangeShare = { min: mmdMinHz() / CW.span, max: mmdMaxHz() / CW.span };
    GT.settings.cwDecoder.span = Number(cwBandwidth.value);
    mmDecoderRestart();
  };
  const dwell = GT.settings.cwDecoder.scanDwell || 10;
  for (const seconds of CW_SCAN_DWELLS) cwDwell.add(new Option(seconds + " s", seconds, false, seconds == dwell));
  cwDwell.onchange = () => { GT.settings.cwDecoder.scanDwell = Number(cwDwell.value); };
  cwClearButton.textContent = I18N("cwViewer.clear.label");
  mmdScanButton();
  mmdResize();
  window.opener.mmDecoderReady();
  // Loaded again while showing (a reload): windowPlaced only comes once, so the window is asked
  try
  {
    if (window.require("@electron/remote").getCurrentWindow().isVisible()) mmdVisible(true);
  }
  catch (e)
  {
    // Told by windowPlaced instead
  }
}

function mmdVisible(visible)
{
  if (visible && GT.settings.cwDecoder.enable) mmdStart();
  else mmdStop();
}

function mmDecoderIsRunning()
{
  return CW.running;
}

// Another Input Device picked (Settings -> Audio): started again with it, if listening
function mmDecoderRestart()
{
  if (!CW.running) return;
  mmdStop();
  mmdStart();
}

function mmdStatus(text, error = false)
{
  cwStatus.textContent = text;
  cwStatus.className = error ? "cwError" : "";
}

async function mmdStart()
{
  if (CW.running) return;
  const generation = ++CW.generation;
  CW.running = true;
  mmdStatus(I18N("cwViewer.status.starting"));
  let stream = null;
  let ctx = null;
  try
  {
    if (!CW.wasm) CW.wasm = fs.readFileSync(NodeURL.fileURLToPath(new URL("lib/mmd/cwdecoder.wasm", location.href)));
    // The Input Device by its id, else by its name (ids can change), else the default
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind == "audioinput");
    const device = devices.find((d) => d.deviceId == GT.settings.app.inputCard) || devices.find((d) => d.label == GT.settings.app.inputCardName) ||
      devices.find((d) => d.deviceId == "default") || devices[0];
    if (!device) throw new Error(I18N("cwViewer.status.noDevice"));
    // The rig's audio as it is: no echo cancelling, noise suppression or level riding, which would chop and pump the keying
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: device.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }
    });
    // At the input's own sample rate, so an SDR's wide stream isn't brought down to the output's first (any rate it won't take: the default)
    const rate = (stream.getAudioTracks()[0].getSettings() || {}).sampleRate;
    try
    {
      ctx = new AudioContext(rate > 0 ? { latencyHint: "playback", sampleRate: rate } : { latencyHint: "playback" });
    }
    catch (e)
    {
      ctx = new AudioContext({ latencyHint: "playback" });
    }
    await ctx.audioWorklet.addModule("lib/mmd/mmdWorklet.js");
    if (generation != CW.generation) throw null;
    const node = new AudioWorkletNode(ctx, "cw-decoder", { numberOfInputs: 1, numberOfOutputs: 0, processorOptions: { wasm: new Uint8Array(CW.wasm), span: mmdBandwidth() } });
    node.port.onmessage = (event) => mmdMessage(event.data, generation);
    ctx.createMediaStreamSource(stream).connect(node);
    CW.stream = stream;
    CW.ctx = ctx;
    CW.node = node;
    CW.device = device.label || device.deviceId;
    cwDevice.textContent = CW.device;
    cwDevice.title = CW.device;
    mmdStatus(I18N("cwViewer.status.listening"));
    window.opener.mmDecoderWideSet(true);
  }
  catch (e)
  {
    if (stream) stream.getTracks().forEach((track) => track.stop());
    if (ctx) ctx.close().catch(() => {});
    // Stopped (or started again) while starting: nothing to say
    if (generation != CW.generation) return;
    CW.running = false;
    mmdStatus(I18N("cwViewer.status.failed") + " " + ((e && e.message) || String(e)), true);
  }
}

function mmdStop()
{
  mmdScanStop();
  // FT8: what was heard is let go (the periods decoded stay listed)
  if (CW.ft8) CW.ft8.total = 0;
  CW.generation++;
  const wasRunning = CW.running;
  CW.running = false;
  if (CW.node) CW.node.port.onmessage = null;
  if (CW.stream) CW.stream.getTracks().forEach((track) => track.stop());
  if (CW.ctx) CW.ctx.close().catch(() => {});
  CW.stream = null;
  CW.ctx = null;
  CW.node = null;
  if (wasRunning)
  {
    try
    {
      window.opener.mmDecoderWideSet(false);
    }
    catch (e)
    {
      // The main window is closing
    }
  }
  mmdStatus("");
}

// ---- From the worklet

function mmdMessage(data, generation)
{
  if (generation != CW.generation) return;
  if (data.type == "ready")
  {
    if (!data.ok)
    {
      mmdStatus(I18N("cwViewer.status.failed") + " " + (data.error || "WASM"), true);
      return;
    }
    CW.bins = data.bins;
    CW.binHz = data.binHz;
    CW.span = data.span;
    // After a Bandwidth change: Min and Max at the same shares of the new span (Max at the top stays the top), in 10 Hz steps
    if (CW.rangeShare)
    {
      GT.settings.cwDecoder.minHz = Math.max(CW_RANGE_FLOOR, Math.round((CW.rangeShare.min * CW.span) / 10) * 10);
      GT.settings.cwDecoder.maxHz = CW.rangeShare.max >= 0.999 ? 0 : Math.round((CW.rangeShare.max * CW.span) / 10) * 10;
      CW.rangeShare = null;
    }
    // Less than the Bandwidth chosen: all the input's sample rate carries
    if (data.span < mmdBandwidth() * 0.95)
    {
      mmdStatus(I18N("cwViewer.status.listening") + " · " + I18N("cwViewer.bandwidth.limited").replace("{span}", (data.span / 1000).toFixed(1)).replace("{rate}", (data.sampleRate / 1000).toFixed(1)));
    }
    mmdResize();
    // The audio to decode, from Settings
    mmdRange();
    // FT8 mode: the worklet sends the 12 kHz audio
    if (CW.mode == "ft8") CW.node.port.postMessage({ type: "ft8", on: true });
    return;
  }
  if (data.type == "ft8audio")
  {
    if (CW.mode == "ft8") mmdFt8Audio(data);
    return;
  }
  if (data.type != "row") return;
  mmdFallRow(data.row);
  const now = Date.now();
  // The channels' table: only from after the last retune, and once Rig Control has read back where the rig was tuned to (until then the
  // audio's frequencies would be put on the old dial)
  if (data.seq == CW.seq && !CW.expect)
  {
    const seen = {};
    for (let i = 0; i < data.channels.length; i += 8)
    {
      if (!data.channels[i + 5]) continue;
      const id = data.channels[i];
      seen[id] = true;
      const freq = data.channels[i + 1];
      const air = window.opener.mmDecoderAirHz(freq);
      // A signal new to the viewer, where one listed before the rig moved was: it is that one, found again
      if (!(id in CW.signals) && air != null)
      {
        const before = Object.values(CW.signals).find((signal) => !signal.alive && signal.air != null && Math.abs(signal.air - air) < CW_SAME_SIGNAL_HZ);
        if (before)
        {
          delete CW.signals[before.id];
          // Pinned, it stays pinned
          if (CW.focus === before.id) CW.focus = id;
          before.id = id;
          CW.signals[id] = before;
        }
      }
      const signal = mmdSignal(id);
      signal.freq = freq;
      signal.air = air;
      signal.snr = data.channels[i + 3];
      signal.wpm = data.channels[i + 2];
      signal.key = data.channels[i + 4] > 0;
      signal.alive = true;
    }
    for (const id in CW.signals) if (!seen[id]) CW.signals[id].alive = false;
  }
  // The characters: each to its signal's row (decoded before a retune too: the signals that were there). A 1 starts a transmission (where
  // its text begins is kept); below 0, the transmission was read again with what the decoder has learned since, and its text takes the
  // place of what came for it (cwdecoder.c, txRevise)
  for (let i = 0; i < data.events.length; i += 2)
  {
    if (!(data.events[i] in CW.signals) && data.seq != CW.seq) continue;
    const signal = mmdSignal(data.events[i]);
    const code = data.events[i + 1];
    if (code == 1)
    {
      if (signal.text != "" && !signal.text.endsWith(" ")) mmdText(signal, signal.text + " ");
      signal.txStart = signal.text.length;
      continue;
    }
    if (code < 0)
    {
      const revised = (data.revisions[-code - 1] || "").replace(/ +/g, " ");
      const before = signal.text.slice(0, signal.txStart);
      mmdText(signal, before + (before == "" || before.endsWith(" ") ? revised.replace(/^ /, "") : revised));
      signal.revisedAt = now;
      if (/(^| )CQ( |$)/.test(revised)) signal.cqAt = now;
      continue;
    }
    const c = String.fromCharCode(code);
    // One space between words, none before the first
    if (c == " " && (signal.text == "" || signal.text.endsWith(" "))) continue;
    mmdText(signal, signal.text + c);
    signal.last = now;
    if (/(^| )CQ $/.test(signal.text)) signal.cqAt = now;
  }
  CW.dirty = true;
}

// A signal's text, its oldest characters let go past CW_TEXT_KEEP (where its transmission starts moves with them)
function mmdText(signal, text)
{
  const drop = Math.max(0, text.length - CW_TEXT_KEEP);
  signal.text = text.slice(drop);
  signal.txStart = Math.max(0, signal.txStart - drop);
}

function mmdSignal(id)
{
  if (!(id in CW.signals)) CW.signals[id] = { id: id, freq: 0, air: null, snr: 0, wpm: 0, key: false, alive: true, text: "", txStart: 0, last: Date.now(), cqAt: 0, revisedAt: 0 };
  return CW.signals[id];
}

// ---- The waterfall

// Black through blue, cyan and yellow to white
function mmdPalette()
{
  const stops = [[0, 0, 0, 0], [70, 0, 0, 140], [130, 0, 160, 220], [190, 240, 230, 0], [235, 255, 80, 0], [255, 255, 255, 255]];
  const palette = new Uint8ClampedArray(256 * 3);
  for (let v = 0; v < 256; v++)
  {
    let s = 0;
    while (s < stops.length - 2 && v > stops[s + 1][0]) s++;
    const [v0, r0, g0, b0] = stops[s];
    const [v1, r1, g1, b1] = stops[s + 1];
    const t = (v - v0) / (v1 - v0);
    palette[v * 3] = r0 + (r1 - r0) * t;
    palette[v * 3 + 1] = g0 + (g1 - g0) * t;
    palette[v * 3 + 2] = b0 + (b1 - b0) * t;
  }
  return palette;
}

// The bar between the waterfall and the decoded lines, dragged up or down: the waterfall's height, kept as its share of the window
// (GT.settings.cwDecoder.fallShare) so it is the same after a restart or when the window changes size
const MMD_FALL_SHARE = [0.08, 0.85];

function mmdSplitInit()
{
  mmdSplitApply();
  mmdSplit.addEventListener("mousedown", (event) =>
  {
    if (event.button != 0) return;
    event.preventDefault();
    const top = cwFallBox.getBoundingClientRect().top;
    const move = (e) =>
    {
      // The button let go outside the window: the drag ends
      if (!(e.buttons & 1)) return up();
      const share = (e.clientY - top) / window.innerHeight;
      GT.settings.cwDecoder.fallShare = Math.min(MMD_FALL_SHARE[1], Math.max(MMD_FALL_SHARE[0], share));
      mmdSplitApply();
    };
    const up = () =>
    {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  });
}

function mmdSplitApply()
{
  const share = GT.settings.cwDecoder.fallShare;
  cwFallBox.style.flex = share > 0 ? "0 0 " + Math.round(share * window.innerHeight) + "px" : "";
  mmdOverlay();
}

function mmdResize()
{
  if (GT.settings.cwDecoder.fallShare > 0) cwFallBox.style.flex = "0 0 " + Math.round(GT.settings.cwDecoder.fallShare * window.innerHeight) + "px";
  // The waterfall's pixels are its bins and rows (drawn stretched to the window); the scale's are the screen's
  if (CW.bins > 0 && (cwFall.width != CW.bins || cwFall.height != CW_FALL_ROWS))
  {
    cwFall.width = CW.bins;
    cwFall.height = CW_FALL_ROWS;
    const ctx = cwFall.getContext("2d");
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, cwFall.width, cwFall.height);
    CW.rowImage = ctx.createImageData(CW.bins, 1);
    // Its period lines went with what was on it
    if (CW.periodMarks) CW.periodMarks.length = 0;
  }
  const ratio = window.devicePixelRatio || 1;
  cwScale.width = Math.max(1, Math.round(cwScale.clientWidth * ratio));
  cwScale.height = Math.max(1, Math.round(cwScale.clientHeight * ratio));
  CW.dirty = true;
}

// The frequency always rises from left to right: the waterfall and scale are turned round while the rig's sideband runs the audio the
// other way to the frequency on the air (LSB, CW-R). What is on the waterfall already is turned round with it
function mmdFlip()
{
  const low = window.opener.mmDecoderAirHz(0);
  const high = window.opener.mmDecoderAirHz(1000);
  const flip = low != null && high != null && high < low;
  if (flip == CW.flipped) return;
  CW.flipped = flip;
  if (CW.bins > 0)
  {
    const copy = document.createElement("canvas");
    copy.width = cwFall.width;
    copy.height = cwFall.height;
    copy.getContext("2d").drawImage(cwFall, 0, 0);
    const ctx = cwFall.getContext("2d");
    ctx.save();
    ctx.translate(cwFall.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(copy, 0, 0);
    ctx.restore();
  }
  CW.dirty = true;
}

// The Waterfall Speed of the mode shown (Settings, Multi-Mode Decoder: CW Decoder's or FT8 Decoder's): how many of the waterfall's rows
// each row heard takes, 1 as it comes
function mmdFallSpeed()
{
  const speed = Number(CW.mode == "ft8" ? GT.settings.cwDecoder.ft8FallSpeed : GT.settings.cwDecoder.cwFallSpeed);
  return speed > 0 ? speed : 1;
}

// A row heard onto the waterfall at its speed: slower, rows are kept back and the next drawn is their strongest; faster, a row is drawn
// more than once
function mmdFallRow(row)
{
  if (!CW.rowImage || row.length != CW.bins) return;
  mmdFlip();
  if (!CW.fallHeld || CW.fallHeld.length != row.length) CW.fallHeld = new Uint8Array(row.length);
  const held = CW.fallHeld;
  for (let k = 0; k < row.length; k++) held[k] = Math.max(held[k], row[k]);
  CW.fallOwed = (CW.fallOwed || 0) + mmdFallSpeed();
  const count = Math.min(CW_FALL_ROWS, Math.floor(CW.fallOwed));
  CW.fallOwed -= count;
  if (count > 0)
  {
    const ctx = cwFall.getContext("2d");
    // Down count rows, the newest on top
    ctx.drawImage(cwFall, 0, 0, CW.bins, CW_FALL_ROWS - count, 0, count, CW.bins, CW_FALL_ROWS - count);
    const pixels = CW.rowImage.data;
    for (let k = 0; k < held.length; k++)
    {
      const p = held[k] * 3;
      const i = (CW.flipped ? held.length - 1 - k : k) * 4;
      pixels[i] = CW.palette[p];
      pixels[i + 1] = CW.palette[p + 1];
      pixels[i + 2] = CW.palette[p + 2];
      pixels[i + 3] = 255;
    }
    for (let y = 0; y < count; y++) ctx.putImageData(CW.rowImage, 0, y);
    held.fill(0);
  }
  mmdPeriodRow(count);
}

// FT8 mode: where each 15 s period starts on the waterfall (rows ago, and its start), moved down with the rows drawn (drawn); drawn
// by mmdOverlay as a line with the period coming in labelled above it
function mmdPeriodRow(drawn)
{
  const marks = CW.periodMarks || (CW.periodMarks = []);
  const had = marks.length;
  if (CW.mode != "ft8")
  {
    marks.length = 0;
    CW.lastPeriod = null;
    if (had) mmdOverlay();
    return;
  }
  for (const mark of marks) mark.age += drawn;
  while (marks.length && marks[0].age >= CW_FALL_ROWS) marks.shift();
  // The row was heard about FT8_LATENCY_MS ago
  const period = Math.floor((Date.now() - FT8_LATENCY_MS) / FT8_PERIOD_MS);
  if (CW.lastPeriod != null && period != CW.lastPeriod) marks.push({ age: 0, start: period * FT8_PERIOD_MS });
  CW.lastPeriod = period;
  if (had || marks.length) mmdOverlay();
}

// ---- The signal under the mouse: guard lines on the waterfall, its row shaded

function mmdHover(which, id)
{
  if (CW[which] === id) return;
  CW[which] = id;
  mmdOverlay();
  if (which == "hoverFall")
  {
    // Its row shaded now, not at the next redraw
    for (const row of cwRows.querySelectorAll("tr[data-id]")) row.classList.toggle("cwLinked", Number(row.dataset.id) === id);
  }
}

// A place across the waterfall (0 to 1, left to right) as an audio frequency, the waterfall turned round or not
function mmdAudioAt(position)
{
  return (CW.flipped ? 1 - position : position) * CW.bins * CW.binHz;
}

// The signal being decoded nearest a place across the waterfall, within CW_PICK_HZ; its id or null
function mmdSignalAt(position)
{
  if (!(CW.bins > 0)) return null;
  const hz = mmdAudioAt(position);
  let best = null;
  for (const id in CW.signals)
  {
    const signal = CW.signals[id];
    if (signal.alive && Math.abs(signal.freq - hz) < CW_PICK_HZ && (!best || Math.abs(signal.freq - hz) < Math.abs(best.freq - hz))) best = signal;
  }
  return best ? best.id : null;
}

// The signal nearest an audio frequency within CW_PICK_HZ, decoded now or heard before the rig moved (where its frequency is still in the
// passband); its id or null
function mmdSignalNear(hz)
{
  let best = null, bestOff = CW_PICK_HZ;
  for (const id in CW.signals)
  {
    const at = mmdAudioOf(CW.signals[id]);
    if (at != null && Math.abs(at - hz) < bestOff)
    {
      best = CW.signals[id].id;
      bestOff = Math.abs(at - hz);
    }
  }
  return best;
}

// Where a signal is in the passband now (Hz of audio): its own while it is decoded; a signal heard before the rig moved, from its
// frequency on the air (the rig's dial and sideband taken back off), when that is still in the passband; else null
function mmdAudioOf(signal)
{
  if (signal.alive) return signal.freq;
  if (signal.air == null) return null;
  const low = window.opener.mmDecoderAirHz(0);
  const high = window.opener.mmDecoderAirHz(1000);
  if (low == null || high == null || low == high) return null;
  const hz = ((signal.air - low) * 1000) / (high - low);
  return hz >= 0 && hz <= CW.bins * CW.binHz ? hz : null;
}

// The guard lines either side of a signal: light green for the one whose row is under the mouse and the one under it on the waterfall,
// light red (kept) for the one the decoder is focused on
function mmdOverlay()
{
  const ratio = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(cwOverlay.clientWidth * ratio));
  const h = Math.max(1, Math.round(cwOverlay.clientHeight * ratio));
  if (cwOverlay.width != w || cwOverlay.height != h)
  {
    cwOverlay.width = w;
    cwOverlay.height = h;
  }
  const ctx = cwOverlay.getContext("2d");
  ctx.clearRect(0, 0, w, h);
  if (!(CW.bins > 0)) return;
  const span = CW.bins * CW.binHz;
  const x = (hz) => (CW.flipped ? 1 - hz / span : hz / span) * w;
  // Outside Min Freq and Max Freq, not decoded: dimmed
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  for (const [from, to] of [[0, mmdMinHz()], [mmdMaxHz(), span]])
  {
    if (to <= from) continue;
    const a = x(from), b = x(Math.min(to, span));
    ctx.fillRect(Math.min(a, b), 0, Math.abs(b - a), h);
  }
  // FT8 mode: a mid-gray line where each period started, its UTC above it on the right (clear of a ] dimming the left or right edge)
  if (CW.mode == "ft8" && CW.periodMarks)
  {
    ctx.strokeStyle = "#808080";
    ctx.lineWidth = Math.max(1, Math.round(ratio));
    ctx.fillStyle = "#c8c8c8";
    ctx.font = Math.round(11 * ratio) + "px sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    for (const mark of CW.periodMarks)
    {
      const y = Math.round(((mark.age + 1) / CW_FALL_ROWS) * h) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.fillText(new Date(mark.start).toISOString().slice(11, 19), w - 4 * ratio, y - 2 * ratio);
    }
  }
  const marks = [...new Set([CW.hoverRow, CW.hoverFall])].filter((id) => id != null && id !== CW.focus).map((id) => [id, "154, 255, 154"]);
  if (CW.focus != null) marks.push([CW.focus, "255, 154, 154"]);
  // FT8: the place searched harder (light red), as wide as the signals it can find there (FT8_FOCUS_SPAN)
  if (CW.mode == "ft8" && CW.ft8Focus) marks.push([null, "255, 154, 154", CW.ft8Focus]);
  for (const [id, rgb, at] of marks)
  {
    const signal = id == null ? null : CW.signals[id];
    const hz = at || (signal ? mmdAudioOf(signal) : null);
    if (hz == null) continue;
    const a = x(hz - (at ? FT8_FOCUS_SPAN[0] : CW_GUARD_HZ));
    const b = x(hz + (at ? FT8_FOCUS_SPAN[1] : CW_GUARD_HZ));
    const left = Math.min(a, b);
    const right = Math.max(a, b);
    ctx.fillStyle = "rgba(" + rgb + ", 0.12)";
    ctx.fillRect(left, 0, right - left, h);
    ctx.strokeStyle = "rgb(" + rgb + ")";
    ctx.lineWidth = 2 * ratio;
    ctx.beginPath();
    ctx.moveTo(left, 0);
    ctx.lineTo(left, h);
    ctx.moveTo(right, 0);
    ctx.lineTo(right, h);
    ctx.stroke();
  }
}

// A frequency on the air as the viewer shows them all, MHz.kHz.10s of Hz: 14.034.77
function mmdFreq(hz)
{
  return (Math.round(hz / 10) / 1e5).toFixed(5).replace(/(\.\d{3})/, "$1.");
}

// The frequency on the air of an audio frequency (Rig Control connected), else the audio's in Hz
function mmdFreqText(audioHz)
{
  const air = window.opener.mmDecoderAirHz(audioHz);
  return air == null ? Math.round(audioHz) + " Hz" : mmdFreq(air);
}

// The scale: a longer tick with its frequency every 500 Hz of audio, or more where the span is wide (so the labels keep 80 pixels apart),
// and four shorter ones between; each signal found as a mark (green while keyed)
function mmdScale()
{
  const ctx = cwScale.getContext("2d");
  const w = cwScale.width;
  const h = cwScale.height;
  const ratio = window.devicePixelRatio || 1;
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, w, h);
  if (!(CW.bins > 0)) return;
  const span = CW.bins * CW.binHz;
  const x = (hz) => (CW.flipped ? 1 - hz / span : hz / span) * w;
  ctx.strokeStyle = "#777";
  ctx.fillStyle = "#bbb";
  ctx.font = Math.round(10 * ratio) + "px Sans-Serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const majorHz = [500, 1000, 2000, 5000, 10000, 20000].find((step) => (step / span) * w >= 80 * ratio) || 20000;
  // FT8: a tick every 100 Hz (where they are 3 pixels apart or more)
  const minorHz = CW.mode == "ft8" && (100 / span) * w >= 3 * ratio ? 100 : majorHz / 5;
  for (let hz = minorHz; hz < span; hz += minorHz)
  {
    const major = hz % majorHz == 0;
    ctx.beginPath();
    ctx.moveTo(Math.round(x(hz)) + 0.5, h);
    ctx.lineTo(Math.round(x(hz)) + 0.5, h - (major ? 6 : 3) * ratio);
    ctx.stroke();
    if (major) ctx.fillText(mmdFreqText(hz), x(hz), 1 * ratio);
  }
  // Min Freq and Max Freq as [ and ], bold cyan, to drag: [ the left edge of what is decoded, ] the right (the waterfall turned round in
  // LSB and CW-R puts Max on the left)
  const a = x(mmdMinHz()), b = x(mmdMaxHz());
  CW.brackets = { left: Math.min(a, b), right: Math.max(a, b) };
  ctx.fillStyle = "cyan";
  ctx.font = "bold " + Math.round(16 * ratio) + "px Sans-Serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText("[", CW.brackets.left, h / 2);
  ctx.textAlign = "right";
  ctx.fillText("]", CW.brackets.right, h / 2);
  for (const id in CW.signals)
  {
    const signal = CW.signals[id];
    if (!signal.alive) continue;
    const sx = x(signal.freq);
    ctx.fillStyle = signal.key ? "#3f3" : "#cc3";
    ctx.beginPath();
    ctx.moveTo(sx, h);
    ctx.lineTo(sx - 4 * ratio, h - 7 * ratio);
    ctx.lineTo(sx + 4 * ratio, h - 7 * ratio);
    ctx.closePath();
    ctx.fill();
  }
}

// ---- The decoded text

function mmdEscape(text)
{
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// A CQ picked out, and every word GT takes for a callsign
function mmdTextHtml(text)
{
  return text.split(" ").map((word) =>
  {
    if (word == "CQ") return "<span class='cwCq'>CQ</span>";
    if (CALLSIGN_REGEXP.test(word)) return "<span class='cwCall'>" + mmdEscape(word) + "</span>";
    return mmdEscape(word);
  }).join(" ");
}

// Text worth listing: a word of three or more characters that isn't made only of the letters noise makes (E, T, I, A, N, M, S: the
// shortest codes). A signal whose text is all noise's isn't listed (its mark still shows on the scale)
function mmdPlausible(text)
{
  return text.split(" ").some((word) => word.length >= 3 && /[^ETIANMS]/.test(word));
}

// Four times a second: the status line, the scale, and the list (when anything changed). One signal no longer found goes after a while
function mmdRender()
{
  mmdTop();
  if (!CW.dirty) return;
  CW.dirty = false;
  mmdScale();
  // The guard lines follow their signal (and the waterfall turning round)
  mmdOverlay();
  const now = Date.now();
  for (const id in CW.signals)
  {
    const signal = CW.signals[id];
    if (!signal.alive && now - signal.last > CW_GONE_MS) delete CW.signals[id];
  }
  // By the frequency on the air (LSB and CW-R turn the audio's round), else the audio's. Each keeps the one it was last heard on, so the
  // rows of signals the rig has moved away from stay where they were
  const order = (signal) => (signal.air == null ? signal.freq : signal.air);
  // The focused signal is listed whatever its text looks like
  const shown = Object.values(CW.signals).filter((signal) => signal.id === CW.focus || mmdPlausible(signal.text)).sort((a, b) => order(a) - order(b));
  const hover = I18N("cwViewer.row.tunePin.hover");
  cwEmpty.style.display = shown.length ? "none" : "";
  // As many of the latest characters as the text column holds
  const charWidth = cwMeasure.getBoundingClientRect().width / 10 || 8;
  const textWidth = Math.max(40, cwTable.clientWidth - 80 - 36 - 36 - 24);
  const fit = Math.max(10, Math.floor(textWidth / charWidth));
  // Each signal's row kept from one redraw to the next and only what changed in it written: a row made again would lose the mouse's
  // hover (its shading flickered)
  const rows = new Map([...cwRows.children].map((row) => [row.dataset.id, row]));
  let before = null;
  for (const signal of shown)
  {
    const cq = signal.cqAt && now - signal.cqAt < CW_CQ_MS;
    let text = signal.text.slice(-fit);
    // Not starting part way through a word
    if (text.length < signal.text.length && text.indexOf(" ") > 0) text = text.slice(text.indexOf(" ") + 1);
    const freq = signal.air == null ? Math.round(signal.freq) + " Hz" : mmdFreq(signal.air);
    const classes = ((cq ? "cwCqRow" : "") + (signal.id === CW.hoverFall ? " cwLinked" : "") + (signal.id === CW.focus ? " cwFocused" : "")).trim();
    let row = rows.get(String(signal.id));
    if (row) rows.delete(String(signal.id));
    else
    {
      row = document.createElement("tr");
      row.dataset.id = signal.id;
      row.innerHTML = "<td class='cwFreq'></td><td class='cwDb'></td><td class='cwWpm'></td><td class='cwText'></td>";
    }
    if (row.className != classes) row.className = classes;
    // The hint (and the pointer, #cwRows tr[title]) only where a click can tune
    if (signal.air == null) row.removeAttribute("title");
    else if (row.title != hover) row.title = hover;
    const [freqCell, dbCell, wpmCell, textCell] = row.children;
    const wpm = signal.wpm > 0 ? String(Math.round(signal.wpm)) : "";
    // Its signal over the noise as last measured (dB, in its own filter)
    const db = signal.snr > 0 ? String(Math.round(signal.snr)) : "";
    if (freqCell.textContent != freq) freqCell.textContent = freq;
    if (dbCell.textContent != db) dbCell.textContent = db;
    if (wpmCell.textContent != wpm) wpmCell.textContent = wpm;
    const textClass = "cwText" + (now - signal.revisedAt < CW_REVISED_MS ? " cwRevised" : "");
    if (textCell.className != textClass) textCell.className = textClass;
    const html = mmdTextHtml(text);
    if (row.cwHtml !== html)
    {
      textCell.innerHTML = html;
      row.cwHtml = html;
    }
    // In order, moved only when out of place
    const at = before ? before.nextSibling : cwRows.firstChild;
    if (row !== at) cwRows.insertBefore(row, at);
    before = row;
  }
  for (const row of rows.values()) row.remove();
}

// The rig as Rig Control reads it, and the wide filter's state. Without Rig Control: the audio decoded (the [ to the Bandwidth), and
// nothing of the wide filter
function mmdTop()
{
  mmdFlip();
  const R = GT.rig;
  const connected = R && R.status == "connected" && R.freq > 0;
  const rig = connected ? mmdFreq(R.freq - window.opener.rigOffset("a")) + " " + (R.mode || "") : mmdMinHz() + " Hz - " + mmdBandwidth() / 1000 + " kHz";
  if (cwRig.textContent != rig) cwRig.textContent = rig;
  const state = CW.running && connected ? window.opener.mmDecoderWideState() : "off";
  const wide = state == "off" ? "" : I18N("cwViewer.wide." + state);
  if (cwWide.textContent != wide) cwWide.textContent = wide;
  cwWide.style.color = state == "on" ? "lightgreen" : "orange";
  mmdFollowRig();
  // The scale's frequencies follow the rig
  CW.dirty = true;
}

// ---- Tuning: a click on a signal, and the band scan

// The rig's dial as on the air (Rig Control's VFO-A, its converter's offset taken off), null while it isn't connected
function mmdDial()
{
  const R = GT.rig;
  return R && R.status == "connected" && R.freq > 0 ? R.freq - window.opener.rigOffset("a") : null;
}

// The rig moved, or its mode changed: by this viewer (it tuned the rig, and the worklet was told then) or not (the dial turned: the worklet
// is told now, and a scan stops). Once Rig Control reads back where this viewer tuned, the channels' frequencies are taken on it again
function mmdFollowRig()
{
  const dial = mmdDial();
  if (dial == null) return;
  const mode = GT.rig.mode;
  if (CW.expect && (Math.abs(dial - CW.expect.freq) < 2 || Date.now() > CW.expect.until))
  {
    CW.expect = null;
    CW.tuned = { freq: dial, mode: mode };
    return;
  }
  if (CW.expect) return;
  if (CW.tuned && (CW.tuned.freq != dial || CW.tuned.mode != mode))
  {
    mmdScanStop();
    mmdRetune();
  }
  CW.tuned = { freq: dial, mode: mode };
}

// Clear: every signal and its text forgotten, the waterfall blanked, and the decoder started afresh (as after a retune) on what the
// passband holds now. A scan goes on
function mmdClear()
{
  mmdRetune();
  CW.signals = {};
  CW.hoverRow = null;
  CW.hoverFall = null;
  CW.focus = null;
  if (CW.bins > 0)
  {
    const ctx = cwFall.getContext("2d");
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, cwFall.width, cwFall.height);
  }
  cwRows.innerHTML = "";
  CW.ft8Lines = [];
  ft8List.scrollTop = 0;
  mmdFt8Render();
  CW.dirty = true;
  mmdOverlay();
}

// A signal pinned (its id), or let go when it is the pinned one (or null): its guard lines kept light red and its row always listed,
// while the rig moves too (the lines come back whenever its frequency is in the passband)
function mmdFocus(id)
{
  CW.focus = id == null || id === CW.focus ? null : id;
  CW.dirty = true;
  mmdOverlay();
}

// The audio decoded (Settings, Min Freq and Max Freq) to the worklet; the waterfall dimmed outside it (mmdOverlay)
function mmdRange()
{
  if (CW.node) CW.node.port.postMessage({ type: "range", min: mmdMinHz(), max: mmdMaxHz() });
  CW.dirty = true;
  mmdOverlay();
}

// The Bandwidth chosen (Hz)
function mmdBandwidth()
{
  return GT.settings.cwDecoder.span > 0 ? GT.settings.cwDecoder.span : 4000;
}

// Min Freq and Max Freq: Max 0 (or past the span) is the span's top
function mmdMinHz()
{
  const min = GT.settings.cwDecoder.minHz > 0 ? GT.settings.cwDecoder.minHz : CW_RANGE_MIN;
  return Math.min(min, CW.span - CW_RANGE_GAP);
}

function mmdMaxHz()
{
  const max = GT.settings.cwDecoder.maxHz;
  return max > 0 && max < CW.span ? Math.max(max, mmdMinHz() + CW_RANGE_GAP) : CW.span;
}

// The scale's [ or ] under the mouse (x in the scale's CSS pixels, within a few of one): "left", "right" or null
function mmdBracketAt(x)
{
  if (!CW.brackets) return null;
  const ratio = window.devicePixelRatio || 1;
  const px = x * ratio;
  const near = CW_BRACKET_GRAB * ratio;
  if (Math.abs(px - CW.brackets.left) <= near) return "left";
  if (Math.abs(px - CW.brackets.right) <= near) return "right";
  return null;
}

// A bracket dragged to a place across the scale (0 to 1): the left one is Min Freq, the right one Max Freq (the other way round while the
// waterfall is turned round), in 10 Hz steps, kept CW_RANGE_GAP apart, Min over CW_RANGE_FLOOR; Max dragged to the span's top is kept
// as the top (0), so a wider Bandwidth chosen later is decoded to its top too. The decoder told as it moves
function mmdBracketMove(side, position)
{
  const hz = Math.round(mmdAudioAt(Math.max(0, Math.min(1, position))) / 10) * 10;
  const isMin = (side == "left") != CW.flipped;
  if (isMin) GT.settings.cwDecoder.minHz = Math.max(CW_RANGE_FLOOR, Math.min(hz, mmdMaxHz() - CW_RANGE_GAP));
  else
  {
    const max = Math.max(hz, mmdMinHz() + CW_RANGE_GAP);
    GT.settings.cwDecoder.maxHz = max >= CW.span - 10 ? 0 : max;
  }
  mmdRange();
  mmdScale();
  mmdRangeTip(side);
}

// The Hz of the [ or ] ("left", "right") under the mouse or being dragged, by it on the scale; null hides it. The scale's own hint gives
// way to it meanwhile (a tooltip doesn't change while the mouse stays on the same element)
function mmdRangeTip(side)
{
  if (!side || !CW.brackets)
  {
    cwRangeTip.style.display = "none";
    if (cwScale.dataset.hint) cwScale.title = cwScale.dataset.hint;
    return;
  }
  if (!cwScale.dataset.hint) cwScale.dataset.hint = cwScale.title;
  cwScale.title = "";
  const isMin = (side == "left") != CW.flipped;
  cwRangeTip.textContent = Math.round(isMin ? mmdMinHz() : mmdMaxHz()) + " Hz";
  cwRangeTip.style.display = "block";
  // Beside the bracket, below the scale, kept inside the window
  const ratio = window.devicePixelRatio || 1;
  const box = cwScale.getBoundingClientRect();
  const x = box.left + (side == "left" ? CW.brackets.left : CW.brackets.right) / ratio;
  const width = cwRangeTip.offsetWidth;
  cwRangeTip.style.left = Math.max(2, Math.min(window.innerWidth - width - 2, x - width / 2)) + "px";
  cwRangeTip.style.top = box.bottom + 2 + "px";
}

// The worklet lets go of what it found (another part of the band is in the passband now); the signals listed stay, at their frequencies
function mmdRetune()
{
  CW.seq++;
  if (CW.node) CW.node.port.postMessage({ type: "retune", seq: CW.seq });
  for (const id in CW.signals) CW.signals[id].alive = false;
  CW.dirty = true;
}

// The rig's dial to dial (Hz on the air) through Rig Control; true when it was sent
function mmdTuneDial(dial)
{
  if (mmdDial() == null) return false;
  dial = Math.round(dial);
  CW.expect = { freq: dial, until: Date.now() + CW_TUNE_SETTLE_MS };
  mmdRetune();
  return window.opener.rigTune({ rx: dial });
}

// The mouse wheel over the waterfall: the rig a step up (wheel up) or down, the rig's tuning step (mmDecoderTuningStep) or, not known,
// half the span; never under CW_WHEEL_MIN_HZ (the rig's 10 Hz would barely move the waterfall). Turns in quick succession add up from the
// dial last sent (Rig Control reads the new one back only once a second); the scan stops. Ctrl and the wheel are the window's zoom, left
// alone
function mmdWheel(event)
{
  // Not in FT8 mode: a period's signals are all on one dial frequency
  if (event.ctrlKey || event.deltaY == 0 || CW.mode == "ft8") return;
  event.preventDefault();
  // A step for each notch's worth of turning (CW_WHEEL_NOTCH pixels): a wheel that scrolls smoothly, or a touchpad, sends many small
  // turns for one. Lines and pages as pixels
  const pixels = event.deltaY * (event.deltaMode == 1 ? 33 : event.deltaMode == 2 ? CW_WHEEL_NOTCH * 3 : 1);
  CW.wheelTurn = (CW.wheelTurn || 0) + pixels;
  const notches = Math.trunc(CW.wheelTurn / CW_WHEEL_NOTCH);
  if (notches == 0) return;
  CW.wheelTurn -= notches * CW_WHEEL_NOTCH;
  const dial = CW.expect ? CW.expect.freq : mmdDial();
  if (dial == null) return;
  const step = Math.max(CW_WHEEL_MIN_HZ, window.opener.mmDecoderTuningStep() || CW.span / 2);
  mmdScanStop();
  // Wheel up (below 0) tunes up
  mmdTuneDial(Math.round((dial - notches * step) / step) * step);
}

// A signal clicked: the rig tuned to hear it at the CW pitch (in CW and CW-R the dial is the frequency heard at the pitch; in USB and LSB
// the signal is put the pitch above or below the dial). A scan stops
function mmdTuneTo(air)
{
  const R = GT.rig;
  if (mmdDial() == null) return;
  const pitch = R.cwPitch || 600;
  const dial = { CW: air, "CW-R": air, CWR: air, USB: air - pitch, "USB-D": air - pitch, PKTUSB: air - pitch, LSB: air + pitch, "LSB-D": air + pitch, PKTLSB: air + pitch }[R.mode];
  if (dial === undefined) return;
  mmdScanStop();
  mmdTuneDial(dial);
}

// The audio frequency heard at a dial of 0 for an audio frequency, by mode (as mmDecoderAirHz): where each step's audio falls on the air
function mmdAirOffset(audioHz)
{
  const pitch = GT.rig.cwPitch || 600;
  switch (GT.rig.mode)
  {
    case "CW":
      return audioHz - pitch;
    case "CW-R":
    case "CWR":
      return pitch - audioHz;
    case "USB":
    case "USB-D":
    case "PKTUSB":
      return audioHz;
    case "LSB":
    case "LSB-D":
    case "PKTLSB":
      return -audioHz;
    default:
      return null;
  }
}

// The scan: the CW part of the band the rig is on, in steps of what the passband hears (a little overlapping), each listened to for the
// seconds chosen, round and round until stopped. It stops when the button is pressed again, a signal is clicked, the dial is turned, or
// the viewer stops listening
function mmdScanToggle()
{
  if (CW.scan) mmdScanStop();
  else mmdScanStart();
}

function mmdScanStart()
{
  const dial = mmdDial();
  const lowOffset = mmdAirOffset(CW_SCAN_AUDIO[0]);
  const highOffset = mmdAirOffset(CW_SCAN_AUDIO[1]);
  if (!CW.running || dial == null || lowOffset == null)
  {
    cwScanInfo.textContent = I18N("cwViewer.scan.noRig");
    return;
  }
  const band = CW_BANDS.find((b) => dial >= b[0] && dial <= b[1]);
  if (!band)
  {
    cwScanInfo.textContent = I18N("cwViewer.scan.noBand");
    return;
  }
  // The dial that puts the passband's low edge at a frequency
  const below = Math.min(lowOffset, highOffset);
  const width = CW_SCAN_AUDIO[1] - CW_SCAN_AUDIO[0];
  const steps = [];
  for (let start = band[2]; start < band[3]; start += width - CW_SCAN_OVERLAP) steps.push(start - below);
  CW.scan = { steps: steps, index: 0, timer: null, low: band[2], high: band[3] };
  mmdScanButton();
  mmdScanStep();
}

function mmdScanStep()
{
  const scan = CW.scan;
  if (!scan) return;
  if (!mmdTuneDial(scan.steps[scan.index]))
  {
    mmdScanStop();
    return;
  }
  scan.index = (scan.index + 1) % scan.steps.length;
  scan.timer = nodeTimers.setTimeout(mmdScanStep, (GT.settings.cwDecoder.scanDwell || 10) * 1000);
}

function mmdScanStop()
{
  if (!CW.scan) return;
  if (CW.scan.timer) nodeTimers.clearTimeout(CW.scan.timer);
  CW.scan = null;
  mmdScanButton();
}

function mmdScanButton()
{
  cwScanButton.textContent = I18N(CW.scan ? "cwViewer.scan.stop.label" : "cwViewer.scan.start.label");
  cwScanButton.classList.toggle("cwScanning", !!CW.scan);
  cwScanInfo.textContent = CW.scan ? I18N("cwViewer.scan.status").replace("{low}", (CW.scan.low / 1000).toFixed(0)).replace("{high}", (CW.scan.high / 1000).toFixed(0)) : "";
}

// ---- FT8 mode: ft8_lib (ft8.wasm, built from src/wasm/ft8 by tools/build_ft8_wasm.js) decodes each 15 s period once it has been heard,
// from the worklet's 12 kHz audio. The waterfall goes on as in CW mode; the FT8 lines take the CW lines' place, and the scan is put away

function mmdModeSet(mode)
{
  CW.mode = mode == "ft8" ? "ft8" : "cw";
  GT.settings.cwDecoder.viewMode = CW.mode;
  const ft8 = CW.mode == "ft8";
  cwList.style.display = ft8 ? "none" : "";
  ft8List.style.display = ft8 ? "" : "none";
  for (const el of [cwScanButton, cwDwell, cwScanInfo]) el.style.display = ft8 ? "none" : "";
  if (ft8) mmdScanStop();
  if (CW.ft8) CW.ft8.total = 0;
  if (CW.node) CW.node.port.postMessage({ type: "ft8", on: ft8 });
  // The scale's ticks and the waterfall's marks differ by mode
  CW.dirty = true;
  mmdOverlay();
}

// ft8.wasm in its worker (ft8Worker.js), once: a period's decode takes up to about half a second, which would stop the waterfall
function mmdFt8Load()
{
  if (CW.ft8) return CW.ft8;
  const bytes = fs.readFileSync(NodeURL.fileURLToPath(new URL("lib/mmd/ft8.wasm", location.href)));
  const worker = new Worker("lib/mmd/ft8Worker.js");
  // Three passes: after each, the signals decoded taken out of the audio and the period searched again for the ones they covered
  // GridTracker's callsign prefixes, for the decoder to tell a real call from noise
  const prefixes = Object.keys(GT.prefixToDXCC || {}).filter((prefix) => /^[A-Z0-9]+$/.test(prefix)).join("\n");
  worker.postMessage({ type: "init", wasm: bytes, audio: FT8_AUDIO, passes: FT8_PASSES, prefixes: prefixes });
  const F = { worker: worker, ring: new Float32Array(FT8_KEEP_S * FT8_RATE), total: 0, endWall: 0, next: 0 };
  worker.onmessage = (event) => mmdFt8Decoded(F, event.data);
  CW.ft8 = F;
  return F;
}

// A chunk of 12 kHz audio from the worklet: into the ring, with when its last sample was heard (the audio clock's end as the wall clock,
// by the context's own timestamp); then each period heard to its end is decoded
function mmdFt8Audio(data)
{
  let F;
  try
  {
    F = mmdFt8Load();
  }
  catch (e)
  {
    mmdStatus(I18N("cwViewer.status.failed") + " FT8: " + e.message, true);
    return;
  }
  const stamp = CW.ctx.getOutputTimestamp();
  const endWall = performance.timeOrigin + stamp.performanceTime + (data.end - stamp.contextTime) * 1000 - FT8_LATENCY_MS;
  const n = data.samples.length;
  const size = F.ring.length;
  for (let i = 0; i < n; i++) F.ring[(F.total + i) % size] = data.samples[i];
  // Heard from scratch: the first period to decode is the first that starts after the audio does
  if (F.total == 0) F.next = Math.ceil((endWall - (n / FT8_RATE) * 1000) / FT8_PERIOD_MS) * FT8_PERIOD_MS;
  F.total += n;
  F.endWall = endWall;
  while (F.endWall >= F.next + FT8_PERIOD_MS + FT8_LATE_MS)
  {
    mmdFt8Decode(F, F.next, FT8_PERIOD_MS);
    F.next += FT8_PERIOD_MS;
  }
  if (F.early != F.next && F.endWall >= F.next + FT8_EARLY_MS + FT8_LATE_MS) mmdFt8Decode(F, F.next, FT8_EARLY_MS);
}

// The period starting at start (ms, on a 15 s boundary) out of the ring and sent to the worker to decode, the first heard ms of it
// (FT8_EARLY_MS, or all of it). All of it after an early decode: only the messages new since then
function mmdFt8Decode(F, start, heard)
{
  const first = F.total - Math.round(((F.endWall - start) / 1000) * FT8_RATE);
  const count = Math.round((heard / 1000) * FT8_RATE);
  if (first < 0 || first < F.total - F.ring.length) return;
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) samples[i] = F.ring[(first + i) % F.ring.length];
  const more = heard == FT8_PERIOD_MS && F.early == start;
  if (heard < FT8_PERIOD_MS) F.early = start;
  const myCall = (GT.settings.app.myCall || "").trim().toUpperCase();
  // Done by its deadline: the early decode before the period ends, the full one well before the next period's early decode
  const deadline = heard < FT8_PERIOD_MS ? start + FT8_EARLY_DEADLINE_MS : Date.now() + FT8_FULL_BUDGET_MS;
  F.worker.postMessage({ type: "decode", start: start, samples: samples, more: more, myCall: myCall, focus: CW.ft8Focus || 0, deadline: deadline }, [samples.buffer]);
}

// A period's messages back from the worker (one line each, ft8wasm.c's ft8_decode)
function mmdFt8Decoded(F, data)
{
  if (data.type == "error")
  {
    mmdStatus(I18N("cwViewer.status.failed") + " FT8: " + data.message, true);
    return;
  }
  // Switched to CW meanwhile, or cleared: not shown
  if (CW.ft8 != F || CW.mode != "ft8") return;
  F.periodCount = (data.more ? F.periodCount : 0) + Math.max(0, data.count);
  const lines = data.text.split("\n").filter(Boolean).map((line) => line.split("\t"));
  mmdFt8Rows(data.start, lines, data.more);
  const utc = new Date(data.start).toISOString().slice(11, 19);
  mmdStatus(I18N("cwViewer.ft8.status").replace("{count}", F.periodCount).replace("{utc}", utc));
}

// A period's lines on top of the list (UTC, dB, DT, Freq, Message; a line above the period's first), the oldest let go past
// FT8_ROWS_MAX; more: lines new at the period's end, added under its early ones. Scrolled down the list, the view is moved down by as
// much, so the lines being read stay put
function mmdFt8Rows(start, lines, more)
{
  const utc = new Date(start).toISOString().slice(11, 19).replace(/:/g, "");
  let at = 0;
  if (more) while (at < CW.ft8Lines.length && CW.ft8Lines[at].utc == utc) at++;
  // DT as WSJT-X shows it: from half a second into the period
  const added = lines.map(([snr, dt, freq, message, how], index) => ({ utc: utc, snr: snr, dt: (Number(dt) - FT8_DT_ZERO).toFixed(1), freq: freq, message: message || "", how: how || "", first: index == 0 && at == 0 }));
  if (added.length == 0) return;
  CW.ft8Lines = CW.ft8Lines.slice(0, at).concat(added, CW.ft8Lines.slice(at)).slice(0, FT8_ROWS_MAX);
  if (ft8List.scrollTop > 0) ft8List.scrollTop += added.length * CW.ft8RowHeight;
  mmdFt8Render();
}

// FT8: the place right-clicked (Hz of audio; again, or 0, lets go), searched harder each period (ft8wasm.c, ft8_set_focus)
function mmdFt8Focus(hz)
{
  CW.ft8Focus = !hz || (CW.ft8Focus && Math.abs(CW.ft8Focus - hz) < FT8_FOCUS_SPAN[1]) ? 0 : Math.round(hz);
  mmdOverlay();
}

function mmdFt8Line(line)
{
  return "<tr data-freq='" + Number(line.freq) + "'" + (line.first ? " class='ft8First'" : "") + "><td class='ft8Num'>" + line.utc + "</td><td class='ft8Num'>" + mmdEscape(line.snr) +
    "</td><td class='ft8Num'>" + mmdEscape(line.dt) + "</td><td class='ft8Num'>" + mmdEscape(line.freq) + "</td><td>" + mmdTextHtml(line.message) + (line.how ? " <span class='ft8How' title=\"" + mmdEscape(I18N("cwViewer.ft8.how." + line.how + ".hover")).replace(/"/g, "&quot;") + "\">" + mmdEscape(line.how) + "</span>" : "") + "</td></tr>";
}

// The lines in view now ({ shownFirst, shownLast }) and the slice to draw, with the buffer ({ first, last }); last indexes are exclusive
function mmdFt8Range()
{
  const count = CW.ft8Lines.length;
  const viewTop = ft8List.scrollTop - CW.ft8HeaderHeight;
  const shownFirst = Math.max(0, Math.min(count, Math.floor(viewTop / CW.ft8RowHeight)));
  const shownLast = Math.max(shownFirst, Math.min(count, Math.ceil((viewTop + ft8List.clientHeight) / CW.ft8RowHeight)));
  return { shownFirst, shownLast, first: Math.max(0, shownFirst - FT8_VIRTUAL_BUFFER), last: Math.min(count, shownLast + FT8_VIRTUAL_BUFFER) };
}

// The slice drawn between two spacer rows standing in for the lines above and below it; the heights measured from what was drawn
function mmdFt8Render()
{
  const { first, last } = mmdFt8Range();
  CW.ft8Slice = { first, last };
  const lines = CW.ft8Lines;
  const spacer = (height) => "<tr class='virtualSpacer' style='height:" + height + "px;'><td colspan='5'></td></tr>";
  let html = first > 0 ? spacer(first * CW.ft8RowHeight) : "";
  for (let i = first; i < last; i++) html += mmdFt8Line(lines[i]);
  if (last < lines.length) html += spacer((lines.length - last) * CW.ft8RowHeight);
  ft8Rows.innerHTML = html;
  ft8Empty.style.display = lines.length ? "none" : "";
  if (ft8Table.tHead) CW.ft8HeaderHeight = ft8Table.tHead.getBoundingClientRect().height;
  let height = 0, count = 0;
  for (const row of ft8Rows.rows)
  {
    if (row.className == "virtualSpacer") continue;
    height += row.getBoundingClientRect().height;
    count++;
  }
  if (count > 0) CW.ft8RowHeight = height / count;
}

// Scrolling or resizing: a redraw once the slice no longer covers the view (at most once a frame)
function mmdFt8Scrolled()
{
  if (CW.ft8ScrollQueued) return;
  CW.ft8ScrollQueued = true;
  window.requestAnimationFrame(() =>
  {
    CW.ft8ScrollQueued = false;
    const { shownFirst, shownLast } = mmdFt8Range();
    if (shownFirst < CW.ft8Slice.first || shownLast > CW.ft8Slice.last) mmdFt8Render();
  });
}
