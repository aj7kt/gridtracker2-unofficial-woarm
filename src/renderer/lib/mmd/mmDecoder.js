// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Multi-Mode Decoder window (gt_mmdecoder.html): the Input Device's audio decoded while the window shows (an AudioWorklet running
// cwdecoder.wasm, mmdWorklet.js), the waterfall of the receiver's passband with the signals found marked over it, and a line of decoded
// text for each signal, a CQ and the call after it picked out. The window is the main window's (services/mmDecoder.js): it widens the
// rig's filter while decoding here, and gives each signal's frequency on the air from Rig Control

// The waterfall's rows: one a screen pixel (CSS), as many as it can be tall (MMD_FALL_SHARE's top of the window's height), at least
// this many; the box shows the newest of them, so making it taller uncovers older rows (mmdResize)
const CW_FALL_ROWS_MIN = 160;
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
// The Frequency menu (Rig Control connected): each mode's usual frequencies, from the band plans' (mmdBands.js, mmdBandFreqs); a mode
// with none shows no menu
// The modes there are (the Mode menu)
const MMD_MODES = ["cw", "ft8", "ft4", "sstv", "wefax", "hell", "packet", "sat", "psk31", "rtty", "mfsk", "thor", "navtex", "olivia", "wspr"];
// After the viewer tunes the rig, how long it waits for Rig Control to read the new frequency back (ms)
const CW_TUNE_SETTLE_MS = 2500;
// The rig read back within this of what BirdWatch's Doppler last sent VFO-A (Hz on the air; the rig may round it): its move, not a
// retune. It keeps a satellite's signal at the same pitch, so what was found goes on
const CW_DOPPLER_HZ = 200;
// ... of the last this many it sent
const CW_DOPPLER_STEPS = 4;
// FT8 mode: the worklet's 12 kHz audio kept this long (s), each 15 s period decoded once this much past its end (ms: the last chunk in),
// the audio searched (Hz, as WSJT-X's default), and at most this many lines kept
const FT8_RATE = 12000;
const FT8_KEEP_S = 40;
const FT8_PERIOD_MS = 15000;
// FT4's period (the same decoder: mmdFtx)
const FT4_PERIOD_MS = 7500;
// The other modes' waterfall: a line on the UTC clock every so often (s: the window's UTC menu, 0 none; mmdPeriodRow)
const MMD_UTC_STEPS = [0, 10, 15, 30, 60];
// FT4's decode, as it is the Normal way only, is given this long at most (ms)
const FT4_BUDGET_MS = 4000;
const FT8_LATE_MS = 500;
// Each period is first decoded early, this far into it (ms), as WSJT-X does: most messages are all there by then, and they are shown
// about 3 s sooner. Decoded again at its end, only the messages new then are added (late starters, and weak ones under those found)
const FT8_EARLY_MS = 11800;
// The time a decode may take: the early decode until this far into its period (ms), the full one this long; the candidates left when it
// runs out are the weakest (they are tried strongest first)
const FT8_EARLY_DEADLINE_MS = 14500;
const FT8_FULL_BUDGET_MS = 8000;
// The FT8 and FT4 focus: 50 Hz wide, centred where it was right-clicked (any frequency); the signals whose middle is in it are searched
// harder (ft8wasm.c)
const FTX_FOCUS_HALF = 25;
// The known signals' marks on the scale (FT8, FT4): those decoded in the last two periods (both sides of a QSO)
const FTX_MARK_PERIODS = 2;
// Slot Finder (FT8, FT4): the clearest place to transmit, from what was heard in the last this many periods of each (even and odd) and
// the one under way, between [ and ] (the user's own range), with this much clear either side of it (Hz)
const FTX_SLOT_PERIODS = 2;
const FTX_SLOT_GUARD_HZ = 4;
// A waterfall bin is busy in a period when it was this far over its noise floor (dB; a row's byte is 5 dB under the floor at 0, 40 dB
// over at 255) in this share of the period's rows or more; the period under way counts once this far into it (ms)
const FTX_SLOT_BUSY_LEVEL = Math.round(((6 + 5) * 255) / 45);
const FTX_SLOT_BUSY_SHARE = 0.2;
const FTX_SLOT_UNDER_WAY_MS = 2000;
// Time skew (FT8, FT4): the wheel moves it this much a notch (ms), with Shift this much; the period last heard whole is decoded on the new
// timing once the wheel has rested this long (ms)
const FTX_SKEW_STEP_MS = 100;
const FTX_SKEW_BIG_MS = 1000;
const FTX_SKEW_SETTLE_MS = 600;
const FT8_AUDIO = [100, 4000];
const FT8_ROWS_MAX = 5000;
// The FT8 list scrolls virtually, as the rosters do (renderRoster.js): only the lines in view, and this many either side, are in the page
const FT8_VIRTUAL_BUFFER = 20;
const FT8_PASSES = 3;
// The audio reaches the viewer about this long after it was heard (ms: measured against WSJT-X, whose DT came out this much less), so
// each sample is taken as heard this much earlier; and FT8 sends start half a second into the period, which WSJT-X's DT counts from (s)
const FT8_LATENCY_MS = 300;
const FT8_DT_ZERO = 0.5;

const DEC = {
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
  hoverRow: null, // the signal whose row is under the mouse (its id): guard lines on the waterfall
  hoverFall: null, // the signal under the mouse on the waterfall: its row shaded, and guard lines
  focus: null,    // the signal pinned (a right-click): its guard lines kept, its row always listed
  mode: "cw",     // what is decoded: "cw", "ft8", "ft4", "sstv", "packet", "sat" (Sat Data), "psk31" (with its submodes), "rtty", "mfsk", "thor" (DominoEX / THOR), "navtex", "hell" (Feld-Hell), "wefax", "olivia" or "wspr" (the Mode menu)
  shown: false,   // the window is showing (mmdVisible): listening, and the waterfall drawn; hidden, only FT8 or FT4 (mmdListen)
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
  DEC.palette = mmdPalette();
  window.addEventListener("resize", mmdResize);
  mmdSplitInit();
  window.addEventListener("beforeunload", () =>
  {
    // A picture being sent stops, the rig unkeyed at once
    mmdSstvTxStop("", true);
    mmdStop();
  });
  // Shown and hidden by the main process: decoding only while it shows (the Input Device is let go while hidden)
  electron.ipcRenderer.on("windowPlaced", (event, visible) => mmdVisible(visible));
  electron.ipcRenderer.on("windowVisible", (event, visible) => mmdVisible(visible));
  nodeTimers.setInterval(mmdRender, 250);
  // The mouse over a row puts guard lines round its signal on the waterfall; over a signal on the waterfall, its row is shaded as well
  cwRows.addEventListener("mouseover", (event) =>
  {
    const row = event.target.closest("tr[data-id]");
    mmdHover("hoverRow", row ? Number(row.dataset.id) : null);
  });
  cwRows.addEventListener("mouseleave", () => mmdHover("hoverRow", null));
  cwOverlay.addEventListener("mousemove", (event) =>
  {
    mmdHover("hoverFall", mmdSignalAt(event.offsetX / cwOverlay.clientWidth));
    // FT8 and FT4: over the focus, it can be dragged
    if (!DEC.focusDrag) cwOverlay.style.cursor = mmdFocusAt(event.offsetX) ? "ew-resize" : "";
    // Over an RSID of a mode decoded here, it can be clicked (mmdRsid.js)
    if (!DEC.focusDrag && !cwOverlay.style.cursor) mmdRsidHover(event.offsetX, event.offsetY);
  });
  cwOverlay.addEventListener("mouseleave", () => mmdHover("hoverFall", null));
  // The left button on the waterfall. CW, PSK31 and RTTY: a click on a signal pins it, on the pinned one lets it go. FT8 and FT4: pressed
  // outside the focus puts it there, inside takes hold of it; held, it drags it along the waterfall, kept where it is let go. Let go
  // without moving, inside the focus: the focus lets go
  cwOverlay.addEventListener("mousedown", (event) =>
  {
    if (event.button != 0) return;
    // An RSID of a mode decoded here: that mode, its transmission decoded from its start (mmdRsid.js)
    const rsid = mmdRsidAt(event.offsetX, event.offsetY);
    if (rsid && mmdRsidModeOf(rsid.name))
    {
      mmdRsidPick(rsid);
      event.preventDefault();
      return;
    }
    const hz = mmdAudioAt(event.offsetX / cwOverlay.clientWidth);
    // Detect Modes: a signal found there decoded (its mode chosen)
    if (mmdDetectClickAt(hz))
    {
      event.preventDefault();
      return;
    }
    if (!mmdFtx())
    {
      if (DEC.mode == "cw" || mmdKeyMode()) mmdFocus(mmdSignalNear(hz));
      // Olivia: the signal looked for there
      else if (mmdOliviaMode()) mmdOliviaTune(hz);
      // Feld-Hell: the signal there read (or, inside its band, found again)
      else if (mmdHellMode()) mmdHellTune(hz);
      // Packet: HF packet locked on there (or let go, inside the lock)
      else if (DEC.mode == "packet") mmdPacketLock(hz);
      return;
    }
    if (hz == null) return;
    const inside = mmdFocusAt(event.offsetX);
    if (!inside)
    {
      DEC.ft8Focus = Math.round(hz);
      mmdOverlay();
    }
    DEC.focusDrag = { offset: DEC.ft8Focus - hz, x: event.clientX, moved: false, inside: inside };
    event.preventDefault();
  });
  window.addEventListener("mousemove", (event) =>
  {
    if (!DEC.focusDrag) return;
    // The button let go where the window didn't hear it (outside it): the drag is over
    if (!(event.buttons & 1) || !mmdFtx())
    {
      DEC.focusDrag = null;
      return;
    }
    if (Math.abs(event.clientX - DEC.focusDrag.x) >= 3) DEC.focusDrag.moved = true;
    if (!DEC.focusDrag.moved) return;
    const box = cwOverlay.getBoundingClientRect();
    const hz = mmdAudioAt(Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)));
    if (hz == null) return;
    const span = DEC.bins * DEC.binHz;
    DEC.ft8Focus = Math.round(Math.min(span - FTX_FOCUS_HALF, Math.max(FTX_FOCUS_HALF, hz + DEC.focusDrag.offset)));
    mmdOverlay();
  });
  window.addEventListener("mouseup", (event) =>
  {
    if (!DEC.focusDrag || event.button != 0) return;
    if (!DEC.focusDrag.moved && DEC.focusDrag.inside) mmdFt8Focus(0);
    DEC.focusDrag = null;
  });
  // The scale's [ and ] (Min Freq and Max Freq) dragged
  cwScale.addEventListener("mousemove", (event) =>
  {
    if (DEC.dragging) return;
    const side = mmdBracketAt(event.offsetX);
    cwScale.style.cursor = side ? "ew-resize" : "";
    mmdRangeTip(side);
  });
  cwScale.addEventListener("mouseleave", () => { if (!DEC.dragging) mmdRangeTip(null); });
  cwScale.addEventListener("mousedown", (event) =>
  {
    DEC.dragging = mmdBracketAt(event.offsetX);
    if (DEC.dragging) event.preventDefault();
  });
  window.addEventListener("mousemove", (event) =>
  {
    if (!DEC.dragging) return;
    const box = cwScale.getBoundingClientRect();
    // The button let go where the window didn't hear it (outside it): the drag is over
    if (!(event.buttons & 1))
    {
      DEC.dragging = null;
      mmdRangeTip(null);
      return;
    }
    mmdBracketMove(DEC.dragging, (event.clientX - box.left) / box.width);
  });
  window.addEventListener("mouseup", (event) =>
  {
    if (!DEC.dragging) return;
    DEC.dragging = null;
    // Still on the bracket: its Hz stays shown
    const box = cwScale.getBoundingClientRect();
    const over = event.clientY >= box.top && event.clientY <= box.bottom ? mmdBracketAt(event.clientX - box.left) : null;
    mmdRangeTip(over);
  });
  // A right-click on the scale or the waterfall tunes nothing (the rig is tuned by the wheel on the waterfall, unlocked: mmdTuneWheel).
  // FT8 and FT4: a right-click on the waterfall turns the time skew on or off, the wheel moves it while it's on (mmdSkewWheel, before
  // the tuning)
  cwScale.addEventListener("contextmenu", (event) => event.preventDefault());
  cwOverlay.addEventListener("contextmenu", (event) =>
  {
    event.preventDefault();
    if (mmdFtx()) mmdSkewToggle();
  });
  cwOverlay.addEventListener("wheel", mmdSkewWheel, { passive: false });
  // The tuning lock on the divider (a click locks or unlocks it, and doesn't drag the divider), and the wheel on the waterfall
  cwTuneLock.addEventListener("mousedown", (event) => event.stopPropagation());
  cwTuneLock.addEventListener("click", mmdTuneLockClick);
  cwOverlay.addEventListener("wheel", mmdTuneWheel, { passive: false });
  // A middle-click on the waterfall locks or unlocks it too (its press kept from starting the browser's autoscroll)
  cwOverlay.addEventListener("mousedown", (event) =>
  {
    if (event.button == 1) event.preventDefault();
  });
  cwOverlay.addEventListener("auxclick", (event) =>
  {
    if (event.button != 1) return;
    event.preventDefault();
    mmdTuneLockClick(event);
  });
  // A click on a row: FT8 and FT4, the focus on its signal (its lowest tone is its Freq; centred on its middle); CW, PSK31 and RTTY, its
  // signal pinned (the pinned one's: let go). Not when the mouse selected text in it (to copy)
  const selecting = () => String(window.getSelection()).length > 0;
  ft8Rows.addEventListener("click", (event) =>
  {
    const row = event.target.closest("tr[data-freq]");
    if (row && !selecting()) mmdFt8Focus(Number(row.dataset.freq) + mmdFtxWidth() / 2);
  });
  cwRows.addEventListener("click", (event) =>
  {
    const row = event.target.closest("tr[data-id]");
    if (row && row.dataset.id in DEC.signals && !selecting()) mmdFocus(Number(row.dataset.id));
  });
  // A right-click on a row: Delete (mmdSignalDelete)
  cwRows.addEventListener("contextmenu", (event) =>
  {
    const row = event.target.closest("tr[data-id]");
    if (!row || !(row.dataset.id in DEC.signals)) return;
    event.preventDefault();
    const id = row.dataset.id;
    const remote = window.require("@electron/remote");
    const menu = remote.Menu.buildFromTemplate([{ label: I18N("cwViewer.picture.delete.label"), click: () => mmdSignalDelete(id) }]);
    menu.popup({ window: remote.getCurrentWindow() });
  });
  // The FT8 list's virtual scrolling: its slice redrawn as it scrolls or the window changes size
  ft8List.addEventListener("scroll", mmdFt8Scrolled, { passive: true });
  window.addEventListener("resize", mmdFt8Scrolled);
  // Mode: CW, FT8 or SSTV
  mmdSstvInit();
  mmdSstvTxInit();
  mmdScopeInit();
  mmdPacketInit();
  mmdDetectInit();
  mmdNavtexInit();
  cwMode.value = MMD_MODES.includes(GT.settings.MMD.viewMode) ? GT.settings.MMD.viewMode : "cw";
  cwMode.onchange = () => mmdModeSet(cwMode.value);
  mmdModeSet(cwMode.value);
  // Bandwidth: the decoder started again with it
  const bandwidth = mmdBandwidth();
  for (const [hz, label] of CW_BANDWIDTHS) cwBandwidth.add(new Option(label, hz, false, hz == bandwidth));
  cwBandwidth.onchange = () =>
  {
    // The brackets keep their places as shares of the span: rescaled once the decoder says what span it took (mmdMessage, "ready")
    DEC.rangeShare = { min: mmdMinHz() / DEC.span, max: mmdMaxHz() / DEC.span };
    GT.settings.MMD.span = Number(cwBandwidth.value);
    mmDecoderRestart();
  };
  // UTC: the other modes' lines on the UTC clock (Off, 10s, 15s, 30s, 1m); changed, drawn again on the new step down the whole waterfall
  cwUtc.value = mmdUtcStep();
  cwUtc.onchange = () =>
  {
    GT.settings.MMD.utcLines = Number(cwUtc.value);
    mmdPeriodRow(0);
  };
  mmdLevelInit();
  navigator.mediaDevices.addEventListener("devicechange", mmdInputs);
  cwFreqs.onchange = () =>
  {
    const [hz, mode] = (mmdBandFreqs(DEC.mode) || [])[Number(cwFreqs.value)] || [];
    if (!hz) return;
    // What the mode allows (Settings: Rig Control, then the mode's Set Frequency and Set Mode, each on its own): the frequency, the
    // mode (CW's CW, SSTV's the frequency's sideband, FT8's USB ...; USB and LSB as the data mode with the VFO's SSB Data, Rig Control),
    // both, or nothing
    const S = GT.settings.MMD;
    const setFreq = S.rigControl === true && S[DEC.mode + "SetFreq"] === true;
    const setMode = S.rigControl === true && S[DEC.mode + "SetMode"] === true;
    if (!setFreq && !setMode) return;
    // Picked here: a bar on the waterfall even within the band (another band's goes on as the rig is tuned, mmdBandFollow)
    const band = mmdBandOf(hz);
    if (setFreq && band && band == (DEC.band || mmdBandOf(mmdDial())) && hz != mmdDial()) mmdBandMark(band, hz);
    const vfo = window.opener.mmDecoderVfo();
    mmdTuneDial(setFreq ? hz : null, setMode ? mode : null, ["USB", "LSB"].includes(mode) ? !!vfo && vfo.ssbData === true : undefined);
  };
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

// The output of an input's own sound card (its deviceId), else null: the same device group, not one of the system's aliases
async function mmdInputSink(device)
{
  try
  {
    if (!device || !device.groupId) return null;
    const outputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind == "audiooutput" && d.groupId == device.groupId);
    const own = outputs.find((d) => d.deviceId && d.deviceId != "default" && d.deviceId != "communications");
    return own ? own.deviceId : null;
  }
  catch (e)
  {
    return null;
  }
}

// Shown or hidden by the main process. Hidden is the window closed (main/index.js hides it): a picture being sent, or Tune, stops and the
// rig is unkeyed, as their Stop is in this window (mmdSstvTx.js)
function mmdVisible(visible)
{
  DEC.shown = !!visible;
  if (!DEC.shown && mmdSstvTxKeying()) mmdSstvTxStop(I18N("sstvTx.status.stopped"));
  mmdListen();
}

// Listening while the window shows; with it closed too in FT8, FT4 and WSPR, whose decodes go on to GridTracker's instance MMD
// (services/mmDecoder.js: the map, and FT8's and FT4's the Call Roster with Send Decodes To Call Roster on). The main window is told
// whether it listens unseen
function mmdListen()
{
  const want = GT.settings.MMD.enable && (DEC.shown || mmdFtx() || mmdWsprMode());
  if (want && !DEC.running) mmdStart();
  else if (!want && DEC.running) mmdStop();
  mmdInstanceSay();
}

// Listening in FT8 or FT4: its decodes are the instance's (mmdFt8Decode, mmdFt8Decoded), on the map; in the Call Roster too with Send
// Decodes To Call Roster on (services/mmDecoder.js)
function mmdInstanceMain()
{
  return DEC.running && mmdFtx();
}

// The main window told whether the window listens while it isn't shown (the button's green dot)
function mmdInstanceSay()
{
  try
  {
    window.opener.mmDecoderInstanceHidden(DEC.running && !DEC.shown);
  }
  catch (e)
  {
    // The main window going away
  }
}

function mmDecoderIsRunning()
{
  return DEC.running;
}

// Started again (another Input Device or Bandwidth), if listening
function mmDecoderRestart()
{
  if (!DEC.running) return;
  mmdStop();
  mmdStart();
}

// This mode's Input Device among the audio inputs (window.opener.mmDecoderInputFind), else (none picked, or the one picked not there) the
// first in the list
function mmdInputFind(devices)
{
  return window.opener.mmDecoderInputFind(DEC.mode, devices) || devices[0];
}

// The audio inputs there are (DEC.inputDevices), and this mode's Input Device among them (DEC.input: one that isn't there is the first
// heard instead, and stays picked until another is). Read again as the mode or the devices change, each mode's Input Device menu (the
// window's Settings, Decoders) filled from them; a decoder listening to another than this mode's starts again
async function mmdInputs()
{
  const devices = await mmdInputDevices();
  DEC.inputDevices = devices;
  DEC.outputDevices = await mmdOutputDevices();
  const device = mmdInputFind(devices);
  DEC.input = device || null;
  mmdInputsRender();
  mmdOutputsRender();
  if (!device) return;
  mmdSwApply();
  mmdLevelAsk();
  if (DEC.running && DEC.deviceId && device.deviceId != DEC.deviceId) mmDecoderRestart();
}

// ---- The audio's levels: SW, a gain inside the decoder, each mode's own (MMD.swGain, dB); HW, the Input Device's own recording
// level, the system's (the main process, inputLevel.js), set so the sound card's converter isn't driven into clipping, the peak of what it
// hands over shown beside them. Their button shows them; the sliders and the peak meter show while the mouse is over the button (or them)

const MMD_LEVEL_HOLD_MS = 1500;
const MMD_LEVEL_FLOOR_DB = -60;
const MMD_LEVEL_HIDE_MS = 250;
const MMD_SW_MAX_DB = 20;
const MMD = { levelBusy: false, levelWanted: null, levelShown: false, levelHide: null, peak: -Infinity, peakAt: 0, hw: null };

// This mode's SW gain (dB)
function mmdSwDb()
{
  const gains = GT.settings.MMD.swGain;
  const db = gains && Number(gains[DEC.mode]);
  return Number.isFinite(db) ? Math.max(-MMD_SW_MAX_DB, Math.min(MMD_SW_MAX_DB, db)) : 0;
}

// The SW gain onto the audio (as the mode or the slider changes), and shown
function mmdSwApply()
{
  // (Silent while a test signal plays or waits for its period: the decoder hears the test alone, mmdTest.js; and while a picture is
  // sent, mmdSstvTx.js)
  if (DEC.gainNode) DEC.gainNode.gain.value = TEST.source || mmdSstvTxActive() ? 0 : Math.pow(10, mmdSwDb() / 20);
  mmdLevelShow(MMD.hw);
}

function mmdSwPicked()
{
  window.opener.mmDecoderSwGainSet(DEC.mode, Number(cwSwSlider.value));
  mmdSwApply();
}

// The audio inputs there are, then the I/Q of each VFO that is an SDR server (Rig Control: rigIq.js; SPY Server, SDR++ Server), as
// { deviceId: "iq:" and its VFO's id, label "SPY Server: VFO-C (HF+)", spyVfo: the VFO's id }
async function mmdInputDevices()
{
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind == "audioinput");
  const opener = window.opener;
  const sdrs = typeof opener.rigIqVfos == "function" ? opener.rigIqVfos() : [];
  // Then the network's (Network Audio's streams, and the VFOs whose rig gives its audio over the LAN: mmdNetAudio.js)
  return devices.concat(sdrs.map((v) => ({ deviceId: "iq:" + v.id, label: I18N("cwViewer.input.iq").replace("{name}", opener.rigIqName(v)).replace("{vfo}", opener.rigVfoLabel(v)), kind: "audioinput", spyVfo: v.id })), mmdNetInputDevices());
}

// The modes that transmit (each with an Output Device of its own in Settings, Decoders: the main window's MMD_OUTPUT_MODES)
const MMD_TX_MODES = ["sstv"];

// The audio outputs there are (enumerateDevices' audiooutput ones), then the network's (mmdNetAudio.js)
async function mmdOutputDevices()
{
  return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind == "audiooutput").concat(mmdNetOutputDevices());
}

// The Output Device a mode sends to (mmdSstvTx.js), among those there are (DEC.outputDevices): the one picked (the common one or its own,
// window.opener.mmDecoderOutputFind), else the output on the same sound card as the input heard (the part of the names in brackets: an
// input "Microphone (USB Audio CODEC)" and an output "Speakers (USB Audio CODEC)"), else null
function mmdOutputFind(mode)
{
  const outputs = DEC.outputDevices || [];
  const picked = window.opener.mmDecoderOutputFind(mode, outputs);
  if (picked) return picked;
  // A rig's own audio over the LAN heard (FlexRadio DAX, Icom LAN): the same rig's, where it takes audio to send
  if (DEC.input && DEC.input.netAudio)
  {
    const same = outputs.find((d) => d.netAudio && d.netAudio == DEC.input.netAudio && d.netAudio.startsWith("rig:"));
    return same || null;
  }
  const input = DEC.input ? mmdInputLabel(DEC.input) : "";
  const card = (label) => (/\(([^()]*)\)/.exec(label) || [])[1];
  const name = card(input);
  if (!name) return null;
  // The device itself before Windows' "Default - " and "Communications - " names for it
  const same = outputs.filter((d) => card(d.label || "") == name);
  return same.find((d) => !/^(Default|Communications) - /.test(d.label || "")) || same[0] || null;
}

// This mode's Input Device as the system knows it: its label, and whether it is the system's default input (a SPY Server's I/Q: none,
// it has no level of the system's)
function mmdLevelDevice()
{
  const input = DEC.input;
  if (!input || input.spyVfo || input.netAudio) return null;
  const label = mmdInputLabel(input);
  const def = (DEC.inputDevices || []).find((d) => d.deviceId == "default");
  return { label: label, isDefault: input.deviceId == "default" || (def != null && mmdInputLabel(def) == "Default - " + label) };
}

// An audio input's name (one the system hasn't named: by its place in the list)
function mmdInputLabel(device)
{
  return device.label || "Microphone " + ((DEC.inputDevices || []).indexOf(device) + 1);
}

// The level read, or set (0..1) and read back: shown on the button, which is hidden when the system has no level to give. Sets while one
// is under way wait, and only the last is sent
async function mmdLevelAsk(level = null)
{
  if (level != null) MMD.levelWanted = level;
  if (MMD.levelBusy) return;
  MMD.levelBusy = true;
  try
  {
    for (;;)
    {
      const want = MMD.levelWanted;
      MMD.levelWanted = null;
      const device = mmdLevelDevice();
      const got = device ? await electron.ipcRenderer.invoke("inputLevel", want == null ? "get" : "set", device.label, device.isDefault, want) : null;
      mmdLevelShow(got);
      if (MMD.levelWanted == null) break;
    }
  }
  catch (e)
  {
    mmdLevelShow(null);
  }
  MMD.levelBusy = false;
}

// The button: the SW gain when it isn't 0 dB, and the HW level when the system has one (else its column is hidden)
function mmdLevelShow(level)
{
  const known = typeof level == "number" && level >= 0;
  MMD.hw = known ? level : null;
  cwHwCol.style.display = known ? "" : "none";
  const db = mmdSwDb();
  const sw = (db > 0 ? "+" : "") + db + " dB";
  cwSwText.textContent = sw;
  if (document.activeElement != cwSwSlider) cwSwSlider.value = db;
  const parts = db != 0 ? [sw] : [];
  if (known)
  {
    const percent = Math.round(level * 100);
    parts.push(percent + "%");
    cwLevelText.textContent = percent + "%";
    // Not moved under the mouse while it drags
    if (document.activeElement != cwLevelSlider) cwLevelSlider.value = percent;
  }
  cwLevelButton.textContent = parts.length ? parts.join("  ") : sw;
  // Its tooltip names the Input Device they are of (picked in the window's Settings, Decoders)
  cwLevelButton.title = I18N("cwViewer.levels.hover") + (DEC.input ? "\n" + mmdInputLabel(DEC.input) : "");
  cwLevelButton.style.display = DEC.inputDevices && DEC.inputDevices.length ? "" : "none";
}

// The slider and meter shown under the button (read again: the level may have been changed in the system's settings), or hidden
function mmdLevelPop(show)
{
  clearTimeout(MMD.levelHide);
  if (show == MMD.levelShown) return;
  MMD.levelShown = show;
  if (!show)
  {
    cwLevelPop.style.display = "none";
    if (document.activeElement == cwLevelSlider) cwLevelSlider.blur();
    return;
  }
  cwLevelPop.style.display = "block";
  const at = cwLevelButton.getBoundingClientRect();
  cwLevelPop.style.top = Math.round(at.bottom + 2) + "px";
  cwLevelPop.style.left = Math.round(Math.min(at.left + at.width / 2 - cwLevelPop.offsetWidth / 2, window.innerWidth - cwLevelPop.offsetWidth - 2)) + "px";
  MMD.peak = -Infinity;
  mmdLevelAsk();
  requestAnimationFrame(mmdLevelMeter);
}

// Not while the slider is dragged (the mouse may stray off it): once it is let go
function mmdLevelLeave()
{
  if (MMD.dragging) return;
  clearTimeout(MMD.levelHide);
  MMD.levelHide = setTimeout(() => mmdLevelPop(false), MMD_LEVEL_HIDE_MS);
}

// The peak meter, while shown: the loudest sample of the last frame, the highest held a moment; green, yellow within 6 dB of full scale,
// red within 1 dB (the converter at its limit)
function mmdLevelMeter()
{
  if (!MMD.levelShown) return;
  let db = -Infinity;
  if (DEC.analyser)
  {
    const data = new Float32Array(DEC.analyser.fftSize);
    DEC.analyser.getFloatTimeDomainData(data);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v));
    db = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  }
  const now = Date.now();
  if (db >= MMD.peak || now - MMD.peakAt > MMD_LEVEL_HOLD_MS)
  {
    MMD.peak = db;
    MMD.peakAt = now;
  }
  const shown = Math.max(MMD_LEVEL_FLOOR_DB, Math.min(0, MMD.peak));
  cwPeakFill.style.height = ((shown - MMD_LEVEL_FLOOR_DB) / -MMD_LEVEL_FLOOR_DB) * 100 + "%";
  cwPeakFill.style.backgroundColor = MMD.peak > -1 ? "red" : MMD.peak > -6 ? "yellow" : "lightgreen";
  cwPeakText.textContent = MMD.peak > MMD_LEVEL_FLOOR_DB ? MMD.peak.toFixed(1) + " dBFS" : "—";
  requestAnimationFrame(mmdLevelMeter);
}

function mmdLevelInit()
{
  cwLevelButton.onmouseenter = () => mmdLevelPop(true);
  cwLevelButton.onmouseleave = mmdLevelLeave;
  cwLevelPop.onmouseenter = () => clearTimeout(MMD.levelHide);
  cwLevelPop.onmouseleave = mmdLevelLeave;
  cwLevelSlider.oninput = () => mmdLevelAsk(Number(cwLevelSlider.value) / 100);
  cwSwSlider.oninput = mmdSwPicked;
  cwSwSlider.onwheel = (event) =>
  {
    event.preventDefault();
    cwSwSlider.value = Number(cwSwSlider.value) + (event.deltaY < 0 ? 1 : -1);
    mmdSwPicked();
  };
  cwSwSlider.onpointerdown = () => { MMD.dragging = true; };
  cwLevelSlider.onpointerdown = () => { MMD.dragging = true; };
  window.addEventListener("pointerup", () =>
  {
    if (!MMD.dragging) return;
    MMD.dragging = false;
    if (!cwLevelPop.matches(":hover") && !cwLevelButton.matches(":hover")) mmdLevelLeave();
  });
  // The wheel over the slider steps it
  cwLevelSlider.onwheel = (event) =>
  {
    event.preventDefault();
    cwLevelSlider.value = Number(cwLevelSlider.value) + (event.deltaY < 0 ? 1 : -1);
    cwLevelSlider.oninput();
  };
}

function mmdStatus(text, error = false)
{
  DEC.status = { text: text, error: error };
  mmdStatusShow();
}

// The status where it goes: FT8's, FT4's and WSPR's on the divider, left of their place in the period; an error, and the other modes',
// at the top right
function mmdStatusShow()
{
  const S = DEC.status || { text: "", error: false };
  const onSplit = !S.error && (mmdFtx() || mmdWsprMode());
  const top = onSplit ? "" : S.text;
  const split = onSplit ? S.text : "";
  if (cwStatus.textContent != top) cwStatus.textContent = top;
  const className = S.error ? "cwError" : "";
  if (cwStatus.className != className) cwStatus.className = className;
  if (cwSplitStatus.textContent != split) cwSplitStatus.textContent = split;
}

async function mmdStart()
{
  if (DEC.running) return;
  const generation = ++DEC.generation;
  DEC.running = true;
  mmdStatus(I18N("cwViewer.status.starting"));
  // SSTV hears the audio from here on (a picture under way when it stopped can't go on)
  mmdSstvReset();
  let stream = null;
  let ctx = null;
  try
  {
    if (!DEC.wasm) DEC.wasm = fs.readFileSync(NodeURL.fileURLToPath(new URL("lib/mmd/cwdecoder.wasm", location.href)));
    // This mode's Input Device by its id, else by its name (ids can change), else the default
    const devices = await mmdInputDevices();
    // (Stopped or started again meanwhile: nothing opened for it, so it can't take an SDR server's I/Q from the newer start)
    if (generation != DEC.generation) throw null;
    const device = mmdInputFind(devices);
    if (!device) throw new Error(I18N("cwViewer.status.noDevice"));
    let rate = null;
    if (device.spyVfo)
    {
      // An SDR server's I/Q: at a rate covering the Bandwidth above the VFO's frequency (rigIq.js), the decoder run at it. Not
      // connected yet (just started, or the server away): tried again in a moment
      rate = window.opener.rigIqStart(device.spyVfo, 2 * mmdBandwidth(), (iq, at) => mmdSpyIq(iq, at, generation));
      if (!(rate > 0))
      {
        DEC.spyVfo = device.spyVfo;
        mmdSpyRetry(generation);
        const wait = new Error(I18N("cwViewer.status.spyWait").replace("{vfo}", mmdInputLabel(device)));
        wait.spyWait = true;
        throw wait;
      }
      DEC.spyVfo = device.spyVfo;
      DEC.spyRate = rate;
    }
    else if (device.netAudio)
    {
      // A network stream (mmdNetAudio.js): at its own rate, known once its first audio comes
      rate = await mmdNetStart(device, generation);
    }
    else
    {
      // The rig's audio as it is: no echo cancelling, noise suppression or level riding, which would chop and pump the keying
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: device.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }
      });
      // At the input's own sample rate, so an SDR's wide stream isn't brought down to the output's first (any rate it won't take: the default)
      rate = (stream.getAudioTracks()[0].getSettings() || {}).sampleRate;
    }
    // On the input's own clock: an audio context runs on its output device's, and an input on another clock (the rig's USB sound card,
    // the computer's own output) has blocks of its samples dropped or doubled now and then to keep up. Nothing is played, but the context
    // is put on the output of the input's own sound card (the same device group) where it has one, so no sample is lost: a weather fax's
    // lines and an SSTV picture's stay straight. With none, or one that won't open: the default output, as before
    const sink = device.spyVfo || device.netAudio ? null : await mmdInputSink(device);
    const options = { latencyHint: "playback" };
    if (rate > 0) options.sampleRate = rate;
    try
    {
      ctx = new AudioContext(sink ? Object.assign({ sinkId: sink }, options) : options);
    }
    catch (e)
    {
      try
      {
        ctx = new AudioContext(options);
      }
      catch (e2)
      {
        ctx = new AudioContext({ latencyHint: "playback" });
      }
    }
    DEC.sinkId = sink && ctx.sinkId == sink ? sink : null;
    await ctx.audioWorklet.addModule("lib/mmd/mmdWorklet.js");
    if (generation != DEC.generation) throw null;
    const node = new AudioWorkletNode(ctx, "cw-decoder", { numberOfInputs: 1, numberOfOutputs: 0, processorOptions: { wasm: new Uint8Array(DEC.wasm), span: mmdBandwidth() } });
    node.port.onmessage = (event) => mmdMessage(event.data, generation);
    // A SPY Server's I/Q made into the audio above its frequency (mmdWorklet.js, iq-usb), else the sound card's
    let source;
    if (device.spyVfo)
    {
      source = new AudioWorkletNode(ctx, "iq-usb", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
      DEC.spyNode = source;
    }
    else if (device.netAudio) source = mmdNetNode(ctx);
    else source = ctx.createMediaStreamSource(stream);
    // The SW level (mmdLevel): this mode's gain, before the decoder
    const gain = ctx.createGain();
    source.connect(gain);
    gain.connect(node);
    DEC.gainNode = gain;
    mmdSwApply();
    // The peak meter beside the levels (mmdLevel): what the sound card hands over, before anything is done to it
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    DEC.analyser = analyser;
    DEC.stream = stream;
    DEC.ctx = ctx;
    DEC.node = node;
    // The waterfall's spectrum, as its settings say (mmdFallView.js)
    mmdFallViewApply();
    DEC.deviceId = device.deviceId;
    DEC.device = device.label || device.deviceId;
    mmdStatus(I18N("cwViewer.status.listening"));
    mmdTestRender();
    mmdInstanceSay();
  }
  catch (e)
  {
    if (stream) stream.getTracks().forEach((track) => track.stop());
    if (ctx) ctx.close().catch(() => {});
    // (Stopped meanwhile: mmdStop let go of its SDR server's I/Q and its network stream, and one started since is the new start's: an
    // SDR server's rig has one listener, rigIq.js)
    if (generation == DEC.generation)
    {
      mmdSpyStop();
      mmdNetStop();
    }
    // Stopped (or started again) while starting: nothing to say
    if (generation != DEC.generation) return;
    DEC.running = false;
    // Waiting for a SPY Server: said as it is (tried again by itself), not as a failure
    if (e && e.spyWait) mmdStatus(e.message);
    else mmdStatus(I18N("cwViewer.status.failed") + " " + ((e && e.message) || String(e)), true);
    mmdInstanceSay();
  }
}

function mmdStop()
{
  // FT8: what was heard is let go (the periods decoded stay listed)
  if (DEC.ft8) DEC.ft8.total = 0;
  mmdWsprStop();
  // A test signal playing ends with it
  mmdTestStop();
  DEC.generation++;
  DEC.running = false;
  if (DEC.node) DEC.node.port.onmessage = null;
  if (DEC.stream) DEC.stream.getTracks().forEach((track) => track.stop());
  if (DEC.ctx) DEC.ctx.close().catch(() => {});
  mmdSpyStop();
  mmdNetStop();
  DEC.stream = null;
  DEC.ctx = null;
  DEC.node = null;
  DEC.gainNode = null;
  DEC.analyser = null;
  DEC.deviceId = null;
  mmdStatus("");
  mmdTestRender();
  mmdInstanceSay();
}

// ---- An SDR server's I/Q as the Input Device (Rig Control's SPY Server or SDR++ Server VFO, rigIq.js): its samples from the main window into the
// worklet's iq-usb, which makes them the audio above the VFO's frequency

const MMD_SPY_RETRY_MS = 3000;

// The server's samples, from the decoder started (generation) only. Come at another rate (the server connected again, another device
// behind it): the decoder started again at it
function mmdSpyIq(iq, rate, generation)
{
  if (generation != DEC.generation || !DEC.spyNode) return;
  if (rate != DEC.spyRate)
  {
    DEC.spyRate = rate;
    setTimeout(mmDecoderRestart, 0);
    return;
  }
  // Copied into this window's own array, handed over
  const samples = new Float32Array(iq);
  DEC.spyNode.port.postMessage(samples, [samples.buffer]);
}

// Not connected yet: the start tried again in a moment, while it is still wanted and nothing else started meanwhile
function mmdSpyRetry(generation)
{
  clearTimeout(DEC.spyRetry);
  DEC.spyRetry = setTimeout(() =>
  {
    if (generation == DEC.generation && !DEC.running) mmdListen();
  }, MMD_SPY_RETRY_MS);
}

// The server's stream turned off (this decoder's), its node let go
function mmdSpyStop()
{
  if (DEC.spyVfo)
  {
    try
    {
      window.opener.rigIqStop(DEC.spyVfo);
    }
    catch (e)
    {
      // The main window going away
    }
  }
  DEC.spyVfo = null;
  DEC.spyNode = null;
}

// ---- From the worklet

function mmdMessage(data, generation)
{
  if (generation != DEC.generation) return;
  if (data.type == "ready")
  {
    if (!data.ok)
    {
      mmdStatus(I18N("cwViewer.status.failed") + " " + (data.error || "WASM"), true);
      return;
    }
    DEC.bins = data.bins;
    DEC.binHz = data.binHz;
    DEC.span = data.span;
    // After a Bandwidth change: Min and Max at the same shares of the new span (Max at the top stays the top), in 10 Hz steps
    if (DEC.rangeShare)
    {
      GT.settings.MMD.minHz = Math.max(CW_RANGE_FLOOR, Math.round((DEC.rangeShare.min * DEC.span) / 10) * 10);
      GT.settings.MMD.maxHz = DEC.rangeShare.max >= 0.999 ? 0 : Math.round((DEC.rangeShare.max * DEC.span) / 10) * 10;
      DEC.rangeShare = null;
      mmdRangeKeep();
    }
    // Less than the Bandwidth chosen: all the input's sample rate carries
    if (data.span < mmdBandwidth() * 0.95)
    {
      mmdStatus(I18N("cwViewer.status.listening") + " · " + I18N("cwViewer.bandwidth.limited").replace("{span}", (data.span / 1000).toFixed(1)).replace("{rate}", (data.sampleRate / 1000).toFixed(1)));
    }
    mmdResize();
    // A new worklet (the input started again) counts retunes from 0: given the viewer's count, or its rows would all read as from before
    // a retune and be let go
    DEC.node.port.postMessage({ type: "retune", seq: DEC.seq });
    // The audio to decode, from Settings
    mmdRange();
    // FT8 mode: the worklet sends the 12 kHz audio (Detect Modes too, for SSTV)
    if (mmdFt8StreamWanted() || mmdDetectOn()) DEC.node.port.postMessage({ type: "ft8", on: true });
    // Packet, Sat Data, PSK31 and RTTY: the input's own samples (FSK 9600 needs its full rate); every mode with RSID on; Detect Modes
    if (mmdRawMode() || mmdRsidOn() || mmdDetectOn()) DEC.node.port.postMessage({ type: "raw", on: true });
    // CW decoded in CW mode only (the waterfall's rows in every mode), and while Detect Modes is on
    DEC.node.port.postMessage({ type: "decode", on: DEC.mode == "cw" || mmdDetectOn() });
    return;
  }
  // The 12 kHz audio (the worklet's FT8 stream): FT8's periods, or SSTV's pictures
  if (data.type == "ft8audio")
  {
    // Detect Modes on: its own decoders hear it, the mode's wait
    if (mmdDetectOn()) mmdDetectAudio12(data);
    else if (mmdFtx()) mmdFt8Audio(data);
    else if (mmdWsprMode()) mmdWsprAudio(data);
    else if (mmdSstvMode()) mmdSstvAudio(data);
    return;
  }
  // The input's own samples: RSID's (first: the mode's own worker is handed them), Packet's ...
  if (data.type == "rawaudio")
  {
    mmdRsidAudio(data);
    if (mmdDetectOn()) mmdDetectRawAudio(data);
    else if (DEC.mode == "packet") mmdPacketAudio(data);
    else if (DEC.mode == "sat") mmdSatAudio(data);
    else if (mmdKeyMode()) mmdKeyAudio(data);
    else if (mmdOliviaMode()) mmdOliviaAudio(data);
    else if (mmdHellMode()) mmdHellAudio(data);
    return;
  }
  if (data.type != "row") return;
  // Slot Finder reads the row before the waterfall has it (only what was heard since the last retune)
  if (data.seq == DEC.seq) mmdSlotRow(data.row);
  mmdFallRow(data.row, data.view);
  const now = Date.now();
  // The channels' table: only from after the last retune, and once Rig Control has read back where the rig was tuned to (until then the
  // audio's frequencies would be put on the old dial)
  if (data.seq == DEC.seq && !DEC.expect)
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
      if (!(id in DEC.signals) && air != null)
      {
        const before = Object.values(DEC.signals).find((signal) => !signal.alive && signal.air != null && Math.abs(signal.air - air) < CW_SAME_SIGNAL_HZ);
        if (before)
        {
          delete DEC.signals[before.id];
          // Pinned, it stays pinned
          if (DEC.focus === before.id) DEC.focus = id;
          before.id = id;
          DEC.signals[id] = before;
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
    // (Olivia's signal isn't one of the worklet's: oliviaWorker.js keeps it, mmdOlivia.js)
    for (const id in DEC.signals) if (!seen[id] && id != OLIVIA_ID) DEC.signals[id].alive = false;
  }
  // The characters: each to its signal's row (decoded before a retune too: the signals that were there). A 1 starts a transmission (where
  // its text begins is kept); below 0, the transmission was read again with what the decoder has learned since, and its text takes the
  // place of what came for it (cwdecoder.c, txRevise)
  for (let i = 0; i < data.events.length; i += 2)
  {
    if (!(data.events[i] in DEC.signals) && data.seq != DEC.seq) continue;
    const signal = mmdSignal(data.events[i]);
    const code = data.events[i + 1];
    if (code == 1)
    {
      if (signal.text != "" && !signal.text.endsWith(" ")) mmdText(signal, signal.text + " ");
      signal.txStart = signal.text.length;
      signal.deleted = false;
      continue;
    }
    if (code < 0)
    {
      // Deleted part way through the transmission: what it read again of it doesn't bring it back
      if (signal.deleted) continue;
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
  DEC.dirty = true;
}

// A signal's text, its oldest characters let go past CW_TEXT_KEEP (where its transmission starts moves with them)
function mmdText(signal, text)
{
  const drop = Math.max(0, text.length - CW_TEXT_KEEP);
  signal.text = text.slice(drop);
  signal.txStart = Math.max(0, signal.txStart - drop);
}

// A row deleted (its right-click): its text gone and the signal let go if pinned. A signal still sending is listed again with what it
// sends next (what came before isn't brought back by the transmission under way being read again: the revisions, below)
function mmdSignalDelete(id)
{
  const signal = DEC.signals[id];
  if (!signal) return;
  signal.text = "";
  signal.txStart = 0;
  signal.cqAt = 0;
  signal.deleted = true;
  if (DEC.focus == signal.id) mmdFocus(null);
  DEC.dirty = true;
}

function mmdSignal(id)
{
  if (!(id in DEC.signals)) DEC.signals[id] = { id: id, freq: 0, air: null, snr: 0, wpm: 0, key: false, alive: true, text: "", txStart: 0, last: Date.now(), cqAt: 0, revisedAt: 0 };
  return DEC.signals[id];
}

// ---- The waterfall

// The waterfall's colours, 256 of them from black (the noise) up: Classic, black through blue, cyan and yellow to white; or another of
// MMD_PALETTES (mmdFallView.js: the Palette menu), each its colours evenly spaced
function mmdPalette(name = "classic")
{
  const hex = MMD_PALETTES[name];
  const stops = hex
    ? hex.map((h, i) => [Math.round((i * 255) / (hex.length - 1)), parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)])
    : [[0, 0, 0, 0], [70, 0, 0, 140], [130, 0, 160, 220], [190, 240, 230, 0], [235, 255, 80, 0], [255, 255, 255, 255]];
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

// The divider under the waterfall (the rig's frequency on it), dragged up or down: the waterfall's height, kept as its share of the window
// (GT.settings.MMD.fallShare) so it is the same after a restart or when the window changes size. The place grabbed stays under
// the mouse
const MMD_FALL_SHARE = [0.08, 0.85];

function mmdSplitInit()
{
  mmdSplitApply();
  mmdSplit.addEventListener("mousedown", mmdSplitDrag);
}

function mmdSplitDrag(event)
{
  if (event.button != 0) return;
  event.preventDefault();
  const box = cwFallBox.getBoundingClientRect();
  const grab = event.clientY - box.bottom;
  const move = (e) =>
  {
    // The button let go outside the window: the drag ends
    if (!(e.buttons & 1)) return up();
    const share = (e.clientY - grab - box.top) / window.innerHeight;
    GT.settings.MMD.fallShare = Math.min(MMD_FALL_SHARE[1], Math.max(MMD_FALL_SHARE[0], share));
    mmdSplitApply();
  };
  const up = () =>
  {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
}

function mmdSplitApply()
{
  const share = GT.settings.MMD.fallShare;
  cwFallBox.style.flex = share > 0 ? "0 0 " + Math.round(share * window.innerHeight) + "px" : "";
  mmdOverlay();
  mmdSstvDraw();
  mmdSstvTxDraw();
}

function mmdResize()
{
  if (GT.settings.MMD.fallShare > 0) cwFallBox.style.flex = "0 0 " + Math.round(GT.settings.MMD.fallShare * window.innerHeight) + "px";
  // The waterfall's pixels are its bins (stretched to the window's width) and its rows (one a CSS pixel, the box showing the newest);
  // the scale's are the screen's
  const rows = Math.max(CW_FALL_ROWS_MIN, Math.ceil(window.innerHeight * MMD_FALL_SHARE[1]));
  if (DEC.bins > 0 && (cwFall.width != DEC.bins || cwFall.height != rows))
  {
    // Only taller or shorter (the window resized): what is on it is kept, from the top (another span: it starts again)
    const keep = cwFall.width == DEC.bins && DEC.rowImage ? document.createElement("canvas") : null;
    if (keep)
    {
      keep.width = cwFall.width;
      keep.height = cwFall.height;
      keep.getContext("2d").drawImage(cwFall, 0, 0);
    }
    cwFall.width = DEC.bins;
    cwFall.height = rows;
    const ctx = cwFall.getContext("2d");
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, cwFall.width, cwFall.height);
    if (keep) ctx.drawImage(keep, 0, 0);
    DEC.rowImage = ctx.createImageData(DEC.bins, 1);
    // Its period lines went with what was on it
    if (!keep && DEC.periodMarks) DEC.periodMarks.length = 0;
  }
  cwFall.style.height = cwFall.height + "px";
  const ratio = window.devicePixelRatio || 1;
  cwScale.width = Math.max(1, Math.round(cwScale.clientWidth * ratio));
  cwScale.height = Math.max(1, Math.round(cwScale.clientHeight * ratio));
  DEC.dirty = true;
}


// The frequency always rises from left to right: the waterfall and scale are turned round while the rig's sideband runs the audio the
// other way to the frequency on the air (LSB, CW-R). What is on the waterfall already is turned round with it
function mmdFlip()
{
  const low = window.opener.mmDecoderAirHz(0);
  const high = window.opener.mmDecoderAirHz(1000);
  const flip = low != null && high != null && high < low;
  if (flip == DEC.flipped) return;
  DEC.flipped = flip;
  // The rows queued were coloured the old way round
  DEC.fallQueue = [];
  if (DEC.bins > 0)
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
  DEC.dirty = true;
}

// The Waterfall Speed (the window's Settings, Decoders: every decoder's): how many of the waterfall's rows each row heard takes, 1 as it
// comes
function mmdFallSpeed()
{
  const speed = Number(GT.settings.MMD.fallSpeed);
  return speed > 0 ? speed : 1;
}

// A row heard onto the waterfall at its speed: slower, rows are kept back and the next drawn is their strongest; faster, a row is drawn
// more than once. The rows to draw are queued (coloured) and drawn at an even pace with the screen (mmdFallDrain): they come with the
// audio's blocks, unevenly (40 and 60 ms apart), and at a speed below 1 some bring none
function mmdFallRow(decoderRow, view)
{
  // Not drawn while the window is closed (listening for FT8's instance only)
  if (!DEC.shown) return;
  if (!DEC.rowImage || decoderRow.length != DEC.bins) return;
  mmdFlip();
  // Its levels by the waterfall's Style, from the worklet's spectrum for it (mmdFallView.js)
  const row = mmdFallLevels(view, decoderRow);
  if (!DEC.fallHeld || DEC.fallHeld.length != row.length) DEC.fallHeld = new Uint8Array(row.length);
  const held = DEC.fallHeld;
  for (let k = 0; k < row.length; k++) held[k] = Math.max(held[k], row[k]);
  DEC.fallOwed = (DEC.fallOwed || 0) + mmdFallSpeed();
  const count = Math.min(cwFall.height, Math.floor(DEC.fallOwed));
  DEC.fallOwed -= count;
  // How far apart rows come (ms, smoothed): the pace they are drawn at
  const now = performance.now();
  if (DEC.fallArrived)
  {
    const gap = Math.min(250, now - DEC.fallArrived);
    DEC.fallGap = DEC.fallGap ? DEC.fallGap * 0.95 + gap * 0.05 : gap;
  }
  DEC.fallArrived = now;
  const queue = DEC.fallQueue || (DEC.fallQueue = []);
  if (count > 0)
  {
    const pixels = new Uint8ClampedArray(DEC.bins * 4);
    for (let k = 0; k < held.length; k++)
    {
      const p = held[k] * 3;
      const i = (DEC.flipped ? held.length - 1 - k : k) * 4;
      pixels[i] = DEC.palette[p];
      pixels[i + 1] = DEC.palette[p + 1];
      pixels[i + 2] = DEC.palette[p + 2];
      pixels[i + 3] = 255;
    }
    for (let y = 0; y < count; y++) queue.push(pixels);
    if (queue.length > cwFall.height) queue.splice(0, queue.length - cwFall.height);
    held.fill(0);
  }
  if (!DEC.fallLoop)
  {
    DEC.fallLoop = true;
    requestAnimationFrame(mmdFallDrain);
  }
  // The window not drawn (hidden: no frames come): the rows go on as they come
  if (now - (DEC.fallDrainAt || 0) > 250) mmdFallDraw(queue.length);
}

// Each frame: the queued rows drawn at the pace they come (the speed's rows per row heard, over the time between rows heard), and a little
// faster while more than a few are waiting, so the waterfall moves evenly and keeps up
function mmdFallDrain(time)
{
  const queue = DEC.fallQueue || [];
  const dt = Math.min(100, time - (DEC.fallFrameAt || time));
  DEC.fallFrameAt = time;
  DEC.fallDrainAt = performance.now();
  const rate = DEC.fallGap > 0 ? mmdFallSpeed() / DEC.fallGap : 0;
  DEC.fallDue = (DEC.fallDue || 0) + rate * dt;
  const target = 2 + rate * 100;
  if (queue.length > target) DEC.fallDue += (queue.length - target) * 0.1;
  const count = Math.min(queue.length, Math.floor(DEC.fallDue));
  DEC.fallDue -= count;
  // Nothing waiting: no credit kept for later (it would come out in a jump)
  if (queue.length == count) DEC.fallDue = Math.min(DEC.fallDue, 1);
  mmdFallDraw(count);
  requestAnimationFrame(mmdFallDrain);
}

// The oldest count queued rows onto the waterfall: everything down count rows, the newest on top
function mmdFallDraw(count)
{
  const queue = DEC.fallQueue || [];
  if (count <= 0 || !DEC.rowImage) return;
  const rows = cwFall.height;
  const take = queue.splice(0, count).filter((pixels) => pixels.length == DEC.bins * 4);
  if (take.length == 0) return;
  const n = Math.min(rows, take.length);
  const ctx = cwFall.getContext("2d");
  ctx.drawImage(cwFall, 0, 0, DEC.bins, rows - n, 0, n, DEC.bins, rows - n);
  for (let i = take.length - n; i < take.length; i++)
  {
    DEC.rowImage.data.set(take[i]);
    ctx.putImageData(DEC.rowImage, 0, take.length - 1 - i);
  }
  mmdPeriodRow(n);
  mmdBandRow(n);
  mmdRsidRow(n);
}

// A band change: where on the waterfall the rig went to another band (rows ago), with the band and the dial it went to; moved down with the
// rows drawn, let go once off the bottom. Drawn by mmdOverlay in every mode
function mmdBandMark(band, dial)
{
  const marks = DEC.bandMarks || (DEC.bandMarks = []);
  marks.push({ age: 0, band: band, dial: dial });
  mmdOverlay();
}

function mmdBandRow(drawn)
{
  const marks = DEC.bandMarks;
  if (!marks || !marks.length || !drawn) return;
  for (const mark of marks) mark.age += drawn;
  while (marks.length && marks[0].age >= cwFall.height) marks.shift();
  mmdOverlay();
}

// The band a dial is in ("" unknown). formatBand (GridTracker's) goes by whole MHz, so a weather fax on 7.795 MHz would read 40m: the
// HF and 6m bands' edges (the widest of the ITU regions') are checked here, OOB outside them
const MMD_BAND_EDGES = {
  "160m": [1.8, 2.0], "80m": [3.5, 4.0], "60m": [5.25, 5.45], "40m": [7.0, 7.3], "30m": [10.1, 10.15], "20m": [14.0, 14.35],
  "17m": [18.068, 18.168], "15m": [21.0, 21.45], "12m": [24.89, 24.99], "10m": [28.0, 29.7], "6m": [50.0, 54.0]
};

function mmdBandOf(dial)
{
  if (!(dial > 0)) return "";
  const band = window.opener.formatBand(dial / 1e6) || "";
  const edges = MMD_BAND_EDGES[band];
  return edges && (dial < edges[0] * 1e6 || dial > edges[1] * 1e6) ? "OOB" : band;
}

// The rig on a dial: a bar on the waterfall when that is another band than it was on (known, both)
function mmdBandFollow(dial)
{
  const band = mmdBandOf(dial);
  // Not followed yet (just opened): the band the rig is on now, before it goes to dial
  const was = DEC.band || mmdBandOf(mmdDial());
  if (was && band && band != was) mmdBandMark(band, dial);
  if (band) DEC.band = band;
}

// FT8 mode: where each 15 s period starts on the waterfall (rows ago, and its start), moved down with the rows drawn (drawn); drawn
// by mmdOverlay as a line with the period coming in labelled above it. The other modes: on the UTC clock as the UTC menu has it, the
// same way
function mmdPeriodRow(drawn)
{
  const marks = DEC.periodMarks || (DEC.periodMarks = []);
  const had = marks.length;
  const periodMs = mmdPeriodMs();
  mmdFallRowsCount(drawn);
  // Lines of another step (FT8's 15 s, FT4's 7.5 s, the UTC menu's, or none): drawn again on this one down the whole waterfall, where
  // its speed says each time is (mmdOffTimeMarks; the speed measured on the old lines before they go)
  if (DEC.periodMarksMs !== periodMs)
  {
    mmdFallRowsPerMs();
    DEC.periodMarksMs = periodMs;
    marks.length = 0;
    DEC.lastPeriod = null;
    if (periodMs) mmdOffTimeMarks();
    mmdOverlay();
    return;
  }
  if (!periodMs) return;
  for (const mark of marks) mark.age += drawn;
  while (marks.length && marks[0].age >= cwFall.height) marks.shift();
  // The row was heard about FT8_LATENCY_MS ago; with the time skew on, the skewed periods (orange, with the skew)
  const shift = mmdFtxShift();
  const period = Math.floor((Date.now() - FT8_LATENCY_MS - shift) / periodMs);
  if (DEC.lastPeriod != null && period != DEC.lastPeriod) marks.push({ age: 0, start: period * periodMs + shift, off: !!DEC.offTime, shift: shift });
  DEC.lastPeriod = period;
  if (had || marks.length) mmdOverlay();
}

// ---- The signal under the mouse: guard lines on the waterfall, its row shaded

function mmdHover(which, id)
{
  if (DEC[which] === id) return;
  DEC[which] = id;
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
  return (DEC.flipped ? 1 - position : position) * DEC.bins * DEC.binHz;
}

// The signal being decoded nearest a place across the waterfall, within CW_PICK_HZ; its id or null
function mmdSignalAt(position)
{
  if (!(DEC.bins > 0)) return null;
  const hz = mmdAudioAt(position);
  let best = null;
  for (const id in DEC.signals)
  {
    const signal = DEC.signals[id];
    if (signal.alive && Math.abs(signal.freq - hz) < CW_PICK_HZ && (!best || Math.abs(signal.freq - hz) < Math.abs(best.freq - hz))) best = signal;
  }
  return best ? best.id : null;
}

// The signal nearest an audio frequency within CW_PICK_HZ, decoded now or heard before the rig moved (where its frequency is still in the
// passband); its id or null
function mmdSignalNear(hz)
{
  let best = null, bestOff = CW_PICK_HZ;
  for (const id in DEC.signals)
  {
    const at = mmdAudioOf(DEC.signals[id]);
    if (at != null && Math.abs(at - hz) < bestOff)
    {
      best = DEC.signals[id].id;
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
  return hz >= 0 && hz <= DEC.bins * DEC.binHz ? hz : null;
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
  if (!(DEC.bins > 0)) return;
  const span = DEC.bins * DEC.binHz;
  const x = (hz) => (DEC.flipped ? 1 - hz / span : hz / span) * w;
  // Outside Min Freq and Max Freq, not decoded: dimmed
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  for (const [from, to] of [[0, mmdMinHz()], [mmdMaxHz(), span]])
  {
    if (to <= from) continue;
    const a = x(from), b = x(Math.min(to, span));
    ctx.fillRect(Math.min(a, b), 0, Math.abs(b - a), h);
  }
  // FT8 and FT4 modes: a mid-gray line where each period started, its UTC above it on the right (clear of a ] dimming the left or right
  // edge); orange, with the time skew in a box above it, where a skewed one started. The other modes: the same gray lines, on the UTC menu's step
  // A light palette's background (Paper): the period lines and their UTC drawn dark instead of light
  const light = DEC.palette && 0.299 * DEC.palette[0] + 0.587 * DEC.palette[1] + 0.114 * DEC.palette[2] > 128;
  if (DEC.periodMarks)
  {
    ctx.lineWidth = Math.max(1, Math.round(ratio));
    ctx.font = Math.round(11 * ratio) + "px sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    for (const mark of DEC.periodMarks)
    {
      // A row a CSS pixel (mmdResize); one below the box isn't drawn. With the skew on, its orange lines alone
      const y = Math.round((mark.age + 1) * ratio) + 0.5;
      if (y > h || (DEC.offTime && !mark.off)) continue;
      ctx.strokeStyle = mark.off ? "orange" : light ? "#505050" : "#808080";
      ctx.fillStyle = mark.off ? "orange" : light ? "#202020" : "#c8c8c8";
      ctx.lineWidth = Math.max(1, Math.round((mark.off ? 2 : 1) * ratio));
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      // A skewed period's skew in its own box just above its line, and its UTC (to a tenth of a second) on the box's left, orange on a dark
      // shadow
      if (mark.off)
      {
        const box = mmdOverlayLabel(ctx, mmdSkewText(mark.shift), w - 4 * ratio, Math.max(0, y - 22 * ratio), "right", 12, ratio, w);
        ctx.save();
        ctx.font = "bold " + Math.round(12 * ratio) + "px sans-serif";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.shadowColor = "black";
        ctx.shadowBlur = 3 * ratio;
        ctx.fillStyle = "orange";
        ctx.fillText(new Date(mark.start).toISOString().slice(11, 21), box.left - 6 * ratio, box.top + box.height / 2);
        ctx.restore();
      }
      else ctx.fillText(new Date(mark.start).toISOString().slice(11, 19), w - 4 * ratio, y - 2 * ratio);
      ctx.font = Math.round(11 * ratio) + "px sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
    }
  }
  // Every mode: a cyan line where the rig went to another band, the band and dial above it on the left (what is above the line was heard there)
  if (DEC.bandMarks && DEC.bandMarks.length)
  {
    ctx.strokeStyle = "cyan";
    ctx.lineWidth = Math.max(2, Math.round(2 * ratio));
    ctx.fillStyle = "cyan";
    ctx.font = "bold " + Math.round(11 * ratio) + "px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    const marks = DEC.bandMarks;
    for (let i = 0; i < marks.length; i++)
    {
      const y = Math.round((marks[i].age + 1) * ratio);
      if (y > h) continue;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      // Its label only where it fits under the next change's line (bands changed in quick succession: the newest labelled)
      const next = marks[i + 1];
      if (!next || y - Math.round((next.age + 1) * ratio) >= 15 * ratio) ctx.fillText(marks[i].band + "  " + mmdFreq(marks[i].dial), 4 * ratio, y - 3 * ratio);
    }
  }
  // SSTV mode: where a picture's tones belong, to tune by (dashed): its sync pulses (1200 Hz, orange), black (1500 Hz) and white (2300 Hz);
  // moved to where the newest picture's sender was found, when it was off. WEFAX the same, black and white only
  if (mmdSstvMode())
  {
    const shift = mmdSstvShift();
    ctx.lineWidth = Math.max(1, Math.round(ratio));
    ctx.setLineDash([4 * ratio, 4 * ratio]);
    for (const [hz, color] of [[1200, "rgba(255, 165, 0, 0.8)"], [1500, "rgba(200, 200, 200, 0.6)"], [2300, "rgba(200, 200, 200, 0.6)"]].slice(DEC.mode == "wefax" ? 1 : 0))
    {
      const at = Math.round(x(hz + shift)) + 0.5;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(at, 0);
      ctx.lineTo(at, h);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  // Every mode: the RSIDs heard (mmdRsid.js)
  mmdRsidDraw(ctx, x, ratio, w, h);
  // Olivia mode: the band its signal is looked for in (mmdOlivia.js)
  mmdOliviaDraw(ctx, x, ratio, w, h);
  // Packet mode: where HF packet was heard, and the place locked on (mmdPacket.js)
  mmdPacketDraw(ctx, x, ratio, w, h);
  // Feld-Hell mode: the band read (mmdHell.js)
  mmdHellDraw(ctx, x, ratio, w, h);
  // Detect Modes: the signals found, named (mmdDetect.js)
  mmdDetectDraw(ctx, x, ratio, w, h);
  // FT8 and FT4, Slot Finder: the clearest places to transmit, each shaded in its period's colour (Even + Odd green, Even light blue, Odd
  // cyan) with dashed edges a signal's width apart, its Hz (its lowest tone, as WSJT-X's Tx) and its period in a box at the bottom, each
  // box higher than the one before so they can't cover each other
  const slotRgb = { both: "80, 255, 80", even: "120, 180, 255", odd: "0, 255, 255" };
  for (const [index, slot] of (mmdFtx() && DEC.ftxSlots ? DEC.ftxSlots : []).entries())
  {
    const a = x(slot.freq), b = x(slot.freq + mmdFtxWidth());
    const left = Math.min(a, b), right = Math.max(a, b);
    const rgb = slotRgb[slot.period];
    ctx.fillStyle = "rgba(" + rgb + ", 0.10)";
    ctx.fillRect(left, 0, right - left, h);
    ctx.strokeStyle = "rgba(" + rgb + ", 0.8)";
    ctx.lineWidth = Math.max(1, Math.round(ratio));
    ctx.setLineDash([4 * ratio, 4 * ratio]);
    ctx.beginPath();
    ctx.moveTo(Math.round(left) + 0.5, 0);
    ctx.lineTo(Math.round(left) + 0.5, h);
    ctx.moveTo(Math.round(right) + 0.5, 0);
    ctx.lineTo(Math.round(right) + 0.5, h);
    ctx.stroke();
    ctx.setLineDash([]);
    const text = I18N("cwViewer.ft8.slot.label").replace("{hz}", slot.freq).replace("{period}", I18N("cwViewer.ft8.slot." + slot.period));
    mmdOverlayLabel(ctx, text, (left + right) / 2, h - (19 + index * 22) * ratio, "center", 11, ratio, w, "rgb(" + rgb + ")");
  }
  // A signal's guard lines (hovered, pinned) only in the modes that list signals (CW, PSK31, RTTY, Olivia): the others' waterfalls show
  // none of CW's kept signals
  const listed = DEC.mode == "cw" || mmdKeyMode() || mmdOliviaMode();
  const marks = listed ? [...new Set([DEC.hoverRow, DEC.hoverFall])].filter((id) => id != null && id !== DEC.focus).map((id) => [id, "154, 255, 154"]) : [];
  if (listed && DEC.focus != null) marks.push([DEC.focus, "255, 154, 154"]);
  // FT8 and FT4: the place searched harder (light red, FTX_FOCUS_HALF either side)
  if (mmdFtx() && DEC.ft8Focus) marks.push([null, "255, 154, 154", DEC.ft8Focus]);
  for (const [id, rgb, at] of marks)
  {
    const signal = id == null ? null : DEC.signals[id];
    const hz = at || (signal ? mmdAudioOf(signal) : null);
    if (hz == null) continue;
    const a = x(hz - (at ? FTX_FOCUS_HALF : CW_GUARD_HZ));
    const b = x(hz + (at ? FTX_FOCUS_HALF : CW_GUARD_HZ));
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

// A label on the waterfall: bold orange text (px CSS pixels; or color's) on a dark box with an edge the same, its top at y; align "center"
// about x, "right" ending at x. Kept inside the width w. Its box ({ left, top, height })
function mmdOverlayLabel(ctx, text, x, y, align, px, ratio, w, color = "orange")
{
  ctx.font = "bold " + Math.round(px * ratio) + "px sans-serif";
  const padX = 6 * ratio, padY = 3 * ratio;
  const boxW = ctx.measureText(text).width + 2 * padX;
  const boxH = Math.round(px * ratio) + 2 * padY;
  let left = align == "center" ? x - boxW / 2 : x - boxW;
  left = Math.max(2 * ratio, Math.min(w - boxW - 2 * ratio, left));
  ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
  ctx.fillRect(left, y, boxW, boxH);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, Math.round(ratio));
  ctx.strokeRect(left + 0.5, y + 0.5, boxW - 1, boxH - 1);
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(text, left + padX, y + padY);
  return { left: left, top: y, height: boxH };
}

// A frequency on the air as the viewer shows them all, MHz.kHz.10s of Hz: 14.034.77
function mmdFreq(hz)
{
  return (Math.round(hz / 10) / 1e5).toFixed(5).replace(/(\.\d{3})/, "$1.");
}

// The scale: a longer tick with its audio frequency in Hz every 500 Hz, or more where the span is wide (so the labels keep 80 pixels apart),
// and four shorter ones between; each signal found as a mark (green while keyed)
function mmdScale()
{
  const ctx = cwScale.getContext("2d");
  const w = cwScale.width;
  const h = cwScale.height;
  const ratio = window.devicePixelRatio || 1;
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, w, h);
  if (!(DEC.bins > 0)) return;
  const span = DEC.bins * DEC.binHz;
  const x = (hz) => (DEC.flipped ? 1 - hz / span : hz / span) * w;
  ctx.strokeStyle = "#777";
  ctx.fillStyle = "#bbb";
  ctx.font = Math.round(10 * ratio) + "px Sans-Serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const majorHz = [500, 1000, 2000, 5000, 10000, 20000].find((step) => (step / span) * w >= 80 * ratio) || 20000;
  // FT8 and FT4: a tick every 100 Hz (where they are 3 pixels apart or more)
  const minorHz = mmdFtx() && (100 / span) * w >= 3 * ratio ? 100 : majorHz / 5;
  for (let hz = minorHz; hz < span; hz += minorHz)
  {
    const major = hz % majorHz == 0;
    ctx.beginPath();
    ctx.moveTo(Math.round(x(hz)) + 0.5, h);
    ctx.lineTo(Math.round(x(hz)) + 0.5, h - (major ? 6 : 3) * ratio);
    ctx.stroke();
    if (major) ctx.fillText(Math.round(hz) + " Hz", x(hz), 1 * ratio);
  }
  // Min Freq and Max Freq as [ and ], bold cyan, to drag: [ the left edge of what is decoded, ] the right (the waterfall turned round in
  // LSB and CW-R puts Max on the left)
  const a = x(mmdMinHz()), b = x(mmdMaxHz());
  DEC.brackets = { left: Math.min(a, b), right: Math.max(a, b) };
  ctx.fillStyle = "cyan";
  ctx.font = "bold " + Math.round(16 * ratio) + "px Sans-Serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText("[", DEC.brackets.left, h / 2);
  ctx.textAlign = "right";
  ctx.fillText("]", DEC.brackets.right, h / 2);
  // FT8 and FT4: each signal decoded in the last two periods, yellow at its middle (its line's Freq is its lowest tone); drawn again as the
  // oldest of them goes
  DEC.ftxMarksUntil = 0;
  if (mmdFtx())
  {
    const periodMs = mmdFtxPeriodMs();
    const since = Date.now() - (FTX_MARK_PERIODS + 1) * periodMs;
    const half = mmdFtxWidth() / 2;
    ctx.fillStyle = "#ee3";
    for (const line of DEC.ft8Lines)
    {
      if (!(line.start >= since)) break;
      const until = line.start + (FTX_MARK_PERIODS + 1) * periodMs;
      if (!DEC.ftxMarksUntil || until < DEC.ftxMarksUntil) DEC.ftxMarksUntil = until;
      const sx = x(Number(line.freq) + half);
      ctx.beginPath();
      ctx.moveTo(sx, h);
      ctx.lineTo(sx - 4 * ratio, h - 7 * ratio);
      ctx.lineTo(sx + 4 * ratio, h - 7 * ratio);
      ctx.closePath();
      ctx.fill();
    }
  }
  for (const id in DEC.signals)
  {
    const signal = DEC.signals[id];
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

// A CQ picked out, and every word GT takes for a callsign (CW's lines; FT8's are plain)
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
  mmdFollowBirdWatch();
  mmdTop();
  mmdPeriodProgress();
  // SSTV's Send: its Power the band's, as the rig moves (mmdSstvTx.js)
  if (DEC.mode == "sstv" && sstvSendBody.style.display != "none") mmdSstvTxPowerRender();
  // The rig's band scope: wanted (or not) of Rig Control, shown or hidden
  mmdScopeTick();
  // WEFAX's Auto-Tune: the next chart tuned for when it's time (mmdWefaxAuto.js)
  mmdWefaxAutoTick();
  // NAVTEX's list: its Receiving blocks as their text comes (mmdNavtex.js)
  mmdNavtexRender();
  // Detect Modes: its signals found, listed and labelled
  mmdDetectTick();
  // Slot Finder's places, drawn again when they move
  const slots = mmdFtxSlots();
  if (JSON.stringify(slots) != JSON.stringify(DEC.ftxSlots))
  {
    DEC.ftxSlots = slots;
    mmdOverlay();
  }
  // The oldest FT8 or FT4 mark due to go
  if (DEC.ftxMarksUntil && Date.now() >= DEC.ftxMarksUntil) DEC.dirty = true;
  if (!DEC.dirty) return;
  DEC.dirty = false;
  mmdScale();
  // The guard lines follow their signal (and the waterfall turning round)
  mmdOverlay();
  const now = Date.now();
  for (const id in DEC.signals)
  {
    const signal = DEC.signals[id];
    if (!signal.alive && now - signal.last > CW_GONE_MS) delete DEC.signals[id];
  }
  // By the frequency on the air (LSB and CW-R turn the audio's round), else the audio's. Each keeps the one it was last heard on, so the
  // rows of signals the rig has moved away from stay where they were
  const order = (signal) => (signal.air == null ? signal.freq : signal.air);
  // The focused signal is listed whatever its text looks like
  const shown = Object.values(DEC.signals).filter((signal) => signal.id === DEC.focus || mmdPlausible(signal.text)).sort((a, b) => order(a) - order(b));
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
    const classes = ((cq ? "cwCqRow" : "") + (signal.id === DEC.hoverFall ? " cwLinked" : "") + (signal.id === DEC.focus ? " cwFocused" : "")).trim();
    let row = rows.get(String(signal.id));
    if (row) rows.delete(String(signal.id));
    else
    {
      row = document.createElement("tr");
      row.dataset.id = signal.id;
      row.innerHTML = "<td class='cwFreq'></td><td class='cwDb'></td><td class='cwWpm'></td><td class='cwText'></td>";
    }
    if (row.className != classes) row.className = classes;
    if (row.title != hover) row.title = hover;
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

// The rig as Rig Control reads it (its frequency in the Frequency menu)
function mmdTop()
{
  mmdFlip();
  mmdFreqsShow(window.opener.mmDecoderVfoRead().up);
  mmdFollowRig();
  // The scale and the signals' frequencies on the air follow the rig (its sideband turns the scale round)
  DEC.dirty = true;
}

// Frequency: the rig's frequency with its band and its mode, read only (14.230.000 (20m) USB: the frequency light green, the band yellow, the
// mode orange); no rig (VFO-A not connected): the audio decoded, from the [ to the Bandwidth, in cyan. Beside it the Frequencies menu,
// each as the viewer shows them with its band: the one the rig is on picked, else -
function mmdFreqsShow(connected)
{
  const mode = window.opener.mmDecoderVfoRead().mode;
  const dial = mmdDial(), band = connected ? mmdBandOf(dial) : null;
  const parts = connected ? [[window.opener.formatDialFreq(dial), "cwFreqHz"], [band ? " (" + band + ")" : "", "cwFreqBand"], [mode ? " " + mode : "", "cwFreqMode"]] : [[mmdMinHz() + " Hz - " + mmdBandwidth() / 1000 + " kHz", ""]];
  mmdTuneLockShow(connected);
  const text = parts.map(([t]) => t).join("");
  if (cwFreqText.textContent != text)
  {
    cwFreqText.replaceChildren();
    for (const [t, className] of parts)
    {
      if (!t) continue;
      const span = document.createElement("span");
      span.textContent = t;
      if (className) span.className = className;
      cwFreqText.appendChild(span);
    }
  }
  // A menu only where a pick may send the rig something (Rig Control, and the mode's Set Frequency or Set Mode)
  const S = GT.settings.MMD;
  const allowed = S.rigControl === true && (S[DEC.mode + "SetFreq"] === true || S[DEC.mode + "SetMode"] === true);
  const list = connected && allowed ? mmdBandFreqs(DEC.mode) : null;
  cwFreqs.style.display = list ? "" : "none";
  if (!list) return;
  // Filled again for another mode, or the band plans edited (mmdBands.js)
  if (cwFreqs.dataset.mode != DEC.mode + "|" + BANDS.version)
  {
    cwFreqs.dataset.mode = DEC.mode + "|" + BANDS.version;
    cwFreqs.length = 0;
    const off = new Option("-", "");
    off.hidden = true;
    cwFreqs.add(off);
    // (WEFAX's and NAVTEX's as (frequency) and their station, no band: theirs are outside the amateur bands)
    const notes = BANDS_NOTE_MODES.includes(DEC.mode);
    list.forEach(([hz, , note], i) => cwFreqs.add(new Option(notes ? "(" + mmdFreq(hz) + ")" + (note ? " " + note : "") : mmdBandFreq(hz), i)));
  }
  // Grayed out while BirdWatch follows a satellite with the rig (nothing is sent to it then), saying why
  const locked = window.opener.mmDecoderRigLocked();
  if (cwFreqs.disabled != locked)
  {
    cwFreqs.disabled = locked;
    cwFreqs.title = I18N(locked ? "cwViewer.freqs.locked.hover" : "cwViewer.freqs.hover");
  }
  const at = list.findIndex(([hz]) => Math.abs(hz - dial) < 5);
  const value = at < 0 ? "" : String(at);
  if (cwFreqs.value != value) cwFreqs.value = value;
}

// A frequency on the air with its band: 14.230.00 (20m); off the bands, the frequency alone
function mmdFreqBand(hz)
{
  const band = mmdBandOf(hz);
  return mmdFreq(hz) + (band ? " (" + band + ")" : "");
}

// The band first, as the Frequency menu shows them: 20m (14.230.00); off the bands, the frequency alone
function mmdBandFreq(hz)
{
  const band = mmdBandOf(hz);
  return band ? band + " (" + mmdFreq(hz) + ")" : mmdFreq(hz);
}

// ---- Tuning: from the Frequency menu only (clicks and the wheel on the waterfall never tune the rig)

// The rig's dial as on the air (the mode's Rig Control VFO, its converter's offset taken off), null while it isn't read
function mmdDial()
{
  return window.opener.mmDecoderVfoRead().freq;
}

// The rig moved, or its mode changed: by this viewer (it tuned the rig, and the worklet was told then) or not (the dial turned: the worklet
// is told now). Once Rig Control reads back where this viewer tuned, the channels' frequencies are taken on it again
function mmdFollowRig()
{
  const dial = mmdDial();
  if (dial == null) return;
  const mode = window.opener.mmDecoderVfoRead().mode;
  // Tuned here, the band's bar went on as it was sent (mmdTuneDial)
  if (!DEC.expect) mmdBandFollow(dial);
  if (DEC.expect && (Math.abs(dial - DEC.expect.freq) < 2 || Date.now() > DEC.expect.until))
  {
    DEC.expect = null;
    DEC.tuned = { freq: dial, mode: mode };
    return;
  }
  if (DEC.expect) return;
  // BirdWatch's Doppler steps: the dial read back near one of the last few it sent (a rig read a step late, as the Doppler moves fast near
  // the pass's middle, is still one), so each decoder goes on with what it found (each follows what is left of the drift itself)
  const doppler = GT.rigDoppler;
  const sent = DEC.dopplerSent || (DEC.dopplerSent = []);
  if (doppler && doppler.rx && doppler.sentRx > 0 && sent[sent.length - 1] !== doppler.sentRx)
  {
    sent.push(doppler.sentRx);
    if (sent.length > CW_DOPPLER_STEPS) sent.shift();
  }
  const followed = !!(doppler && doppler.rx) && sent.some((hz) => Math.abs(dial - hz) <= CW_DOPPLER_HZ);
  if (DEC.tuned && (DEC.tuned.freq != dial || DEC.tuned.mode != mode) && !(followed && DEC.tuned.mode == mode))
  {
    // The dial turned (the same mode): what the waterfall had heard moved with it, so it stays where it was on the air
    if (DEC.tuned.mode == mode) mmdFallShift(dial - DEC.tuned.freq);
    mmdRetune();
  }
  DEC.tuned = { freq: dial, mode: mode };
}

// Clear: every signal and its text forgotten, the waterfall blanked, and the decoder started afresh (as after a retune) on what the
// passband holds now
function mmdClear()
{
  // (The time skew stays as it is: the rig hasn't moved)
  mmdRetune(true);
  DEC.signals = {};
  DEC.hoverRow = null;
  DEC.hoverFall = null;
  DEC.focus = null;
  if (DEC.bins > 0)
  {
    const ctx = cwFall.getContext("2d");
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, cwFall.width, cwFall.height);
  }
  DEC.fallQueue = [];
  DEC.rsidMarks = [];
  cwRows.innerHTML = "";
  DEC.ft8Lines = [];
  ft8List.scrollTop = 0;
  mmdFt8Render();
  mmdSstvClear();
  mmdPacketClear();
  mmdSatClear();
  mmdKeyReset();
  mmdOliviaReset();
  mmdHellClear();
  mmdNavtexClear();
  mmdWsprClear();
  // Detect Modes' list (and its decoders) too, while it's on
  mmdDetectClear();
  DEC.dirty = true;
  mmdOverlay();
}

// A signal pinned (its id), or let go when it is the pinned one (or null): its guard lines kept light red and its row always listed,
// while the rig moves too (the lines come back whenever its frequency is in the passband)
function mmdFocus(id)
{
  DEC.focus = id == null || id === DEC.focus ? null : id;
  DEC.dirty = true;
  mmdOverlay();
}

// The audio decoded (Settings, Min Freq and Max Freq) to the worklet; the waterfall dimmed outside it (mmdOverlay)
function mmdRange()
{
  if (DEC.node) DEC.node.port.postMessage({ type: "range", min: mmdMinHz(), max: mmdMaxHz() });
  // HF packet is looked for between them too
  mmdPacketHf();
  DEC.dirty = true;
  mmdOverlay();
}

// The Bandwidth chosen (Hz)
function mmdBandwidth()
{
  return GT.settings.MMD.span > 0 ? GT.settings.MMD.span : 4000;
}

// Min Freq and Max Freq, each mode's own (MMD.ranges: { cw: { minHz, maxHz } }): MMD.minHz and maxHz are the mode shown's, kept in its
// entry as they change
function mmdRangeKeep()
{
  const S = GT.settings.MMD;
  if (!S.ranges || typeof S.ranges != "object") S.ranges = {};
  // The mode MMD.minHz and maxHz are now (at startup the one last shown, whose they were when GridTracker closed)
  if (!DEC.rangeMode) DEC.rangeMode = MMD_MODES.includes(S.viewMode) ? S.viewMode : "cw";
  S.ranges[DEC.rangeMode] = { minHz: S.minHz, maxHz: S.maxHz };
}

// Another mode shown: its own Min Freq and Max Freq; one with none yet starts with the mode it came from's (copied)
function mmdRangeOfMode(mode)
{
  const S = GT.settings.MMD;
  if (!S.ranges || typeof S.ranges != "object") S.ranges = {};
  const own = S.ranges[mode];
  if (own && typeof own == "object")
  {
    S.minHz = own.minHz;
    S.maxHz = own.maxHz;
  }
  else S.ranges[mode] = { minHz: S.minHz, maxHz: S.maxHz };
  DEC.rangeMode = mode;
}

// Min Freq and Max Freq: Max 0 (or past the span) is the span's top
function mmdMinHz()
{
  const min = GT.settings.MMD.minHz > 0 ? GT.settings.MMD.minHz : CW_RANGE_MIN;
  return Math.min(min, DEC.span - CW_RANGE_GAP);
}

function mmdMaxHz()
{
  const max = GT.settings.MMD.maxHz;
  return max > 0 && max < DEC.span ? Math.max(max, mmdMinHz() + CW_RANGE_GAP) : DEC.span;
}

// The scale's [ or ] under the mouse (x in the scale's CSS pixels, within a few of one): "left", "right" or null
function mmdBracketAt(x)
{
  if (!DEC.brackets) return null;
  const ratio = window.devicePixelRatio || 1;
  const px = x * ratio;
  const near = CW_BRACKET_GRAB * ratio;
  if (Math.abs(px - DEC.brackets.left) <= near) return "left";
  if (Math.abs(px - DEC.brackets.right) <= near) return "right";
  return null;
}

// A bracket dragged to a place across the scale (0 to 1): the left one is Min Freq, the right one Max Freq (the other way round while the
// waterfall is turned round), in 10 Hz steps, kept CW_RANGE_GAP apart, Min over CW_RANGE_FLOOR; Max dragged to the span's top is kept
// as the top (0), so a wider Bandwidth chosen later is decoded to its top too. The decoder told as it moves
function mmdBracketMove(side, position)
{
  const hz = Math.round(mmdAudioAt(Math.max(0, Math.min(1, position))) / 10) * 10;
  const isMin = (side == "left") != DEC.flipped;
  if (isMin) GT.settings.MMD.minHz = Math.max(CW_RANGE_FLOOR, Math.min(hz, mmdMaxHz() - CW_RANGE_GAP));
  else
  {
    const max = Math.max(hz, mmdMinHz() + CW_RANGE_GAP);
    GT.settings.MMD.maxHz = max >= DEC.span - 10 ? 0 : max;
  }
  // (This mode's own)
  mmdRangeKeep();
  mmdRange();
  mmdScale();
  mmdRangeTip(side);
}

// The Hz of the [ or ] ("left", "right") under the mouse or being dragged, by it on the scale; null hides it. The scale's own hint gives
// way to it meanwhile (a tooltip doesn't change while the mouse stays on the same element)
function mmdRangeTip(side)
{
  if (!side || !DEC.brackets)
  {
    cwRangeTip.style.display = "none";
    if (cwScale.dataset.hint) cwScale.title = cwScale.dataset.hint;
    return;
  }
  if (!cwScale.dataset.hint) cwScale.dataset.hint = cwScale.title;
  cwScale.title = "";
  const isMin = (side == "left") != DEC.flipped;
  cwRangeTip.textContent = Math.round(isMin ? mmdMinHz() : mmdMaxHz()) + " Hz";
  cwRangeTip.style.display = "block";
  // Beside the bracket, below the scale, kept inside the window
  const ratio = window.devicePixelRatio || 1;
  const box = cwScale.getBoundingClientRect();
  const x = box.left + (side == "left" ? DEC.brackets.left : DEC.brackets.right) / ratio;
  const width = cwRangeTip.offsetWidth;
  cwRangeTip.style.left = Math.max(2, Math.min(window.innerWidth - width - 2, x - width / 2)) + "px";
  cwRangeTip.style.top = box.bottom + 2 + "px";
}

// The dial moved by deltaHz (the same mode): the waterfall's history slid across by as much, so each signal heard stays at its frequency
// on the air (the waterfall always rises left to right on the air); what slid out of the passband is gone, the side uncovered black. A
// move past its whole width (another band) leaves it black. The RSIDs' labels move with it
function mmdFallShift(deltaHz)
{
  if (!(DEC.bins > 0) || !(DEC.binHz > 0) || !deltaHz) return;
  const px = Math.round(deltaHz / DEC.binHz);
  if (!px) return;
  const w = cwFall.width, h = cwFall.height;
  const ctx = cwFall.getContext("2d");
  const copy = document.createElement("canvas");
  copy.width = w;
  copy.height = h;
  if (Math.abs(px) < w) copy.getContext("2d").drawImage(cwFall, 0, 0);
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, w, h);
  if (Math.abs(px) < w) ctx.drawImage(copy, -px, 0);
  // An audio frequency is the other way round from the air's in USB (the waterfall unflipped), the same way in LSB (flipped)
  const audio = (DEC.flipped ? 1 : -1) * px * DEC.binHz;
  for (const mark of DEC.rsidMarks || []) mark.freq += audio;
  mmdOverlay();
}

// The worklet lets go of what it found (another part of the band is in the passband now); the signals listed stay, at their frequencies.
// FT8: the audio heard so far isn't decoded with what comes after (a period heard partly on 20m and partly on 40m would give 20m's
// signals as 40m's): the period under way is decoded from here on only (mmdFt8Decode). SSTV: a picture coming in ends here (it is kept
// as far as it got). The waterfall stays (slid across where the dial moved: mmdFallShift). keepSkew: Clear's, the time skew left on
function mmdRetune(keepSkew = false)
{
  DEC.seq++;
  if (DEC.node) DEC.node.port.postMessage({ type: "retune", seq: DEC.seq });
  // The time skew off: it was the station's on that frequency
  if (!keepSkew) mmdOffTimeStop(false);
  const F = DEC.ft8;
  if (F && F.total > 0)
  {
    F.cutTotal = F.total;
    // An early decode of the period under way was of the old frequency: the full one is a fresh decode, not more of it
    if (F.early == F.next) F.early = null;
  }
  mmdWsprRetune();
  if (mmdSstvMode()) mmdSstvReset();
  if (mmdHellMode()) mmdHellReset();
  if (DEC.mode == "packet") mmdPacketReset();
  if (DEC.mode == "sat") mmdSatReset();
  if (mmdKeyMode()) mmdKeyReset();
  if (mmdOliviaMode()) mmdOliviaReset();
  mmdRsidReset();
  for (const id in DEC.signals) DEC.signals[id].alive = false;
  // Slot Finder starts again on what is heard here
  mmdSlotReset();
  DEC.dirty = true;
}

// The tuning lock before the frequency on the divider: there with a rig read and Rig Control on (the window's Settings, Decoders). Gold
// and closed while locked (GT.settings.MMD.tuneLocked, or held so while BirdWatch follows a satellite with the rig: mmDecoderRigLocked),
// grey and open while unlocked: the wheel on the waterfall then tunes the rig (mmdTuneWheel)
const MMD_LOCK_CLOSED_SVG = "<svg viewBox='0 0 12 14' fill='none' stroke='currentColor' stroke-width='1.6'><path d='M3.5 6.5V4.3a2.5 2.5 0 0 1 5 0v2.2'/><rect x='1.5' y='6.5' width='9' height='6.8' rx='1.2' fill='currentColor' stroke='none'/></svg>";
const MMD_LOCK_OPEN_SVG = "<svg viewBox='0 0 12 14' fill='none' stroke='currentColor' stroke-width='1.6'><path d='M3.5 6.5V3.3a2.5 2.5 0 0 1 5 0v0.6'/><rect x='1.5' y='6.5' width='9' height='6.8' rx='1.2' fill='currentColor' stroke='none'/></svg>";

function mmdTuneLockShow(connected)
{
  const shown = connected && GT.settings.MMD.rigControl === true;
  const held = shown && window.opener.mmDecoderRigLocked();
  const locked = held || GT.settings.MMD.tuneLocked !== false;
  const state = shown ? (locked ? "locked" : "unlocked") + (held ? " held" : "") : "";
  if (cwTuneLock.dataset.state === state) return;
  cwTuneLock.dataset.state = state;
  cwTuneLock.style.display = shown ? "" : "none";
  cwTuneLock.className = state;
  cwTuneLock.innerHTML = locked ? MMD_LOCK_CLOSED_SVG : MMD_LOCK_OPEN_SVG;
  cwTuneLock.title = I18N(held ? "cwViewer.freqs.locked.hover" : locked ? "cwViewer.tuneLock.locked.hover" : "cwViewer.tuneLock.unlocked.hover");
}

// The lock clicked: locked or unlocked (not while BirdWatch holds it)
function mmdTuneLockClick(event)
{
  event.stopPropagation();
  if (GT.settings.MMD.rigControl !== true || window.opener.mmDecoderRigLocked()) return;
  GT.settings.MMD.tuneLocked = GT.settings.MMD.tuneLocked === false;
  mmdTuneLockShow(mmdDial() != null);
}

// The wheel on the waterfall, unlocked: the rig's dial up (wheel up) or down MMD_WHEEL_HZ a step, on that step's grid (Shift: ten
// times as far, Ctrl: a tenth), counted from where it was last sent while the rig hasn't caught up yet (DEC.expect). Not while FT8's or
// FT4's time skew is on: the wheel moves that (mmdSkewWheel)
const MMD_WHEEL_HZ = 10;

function mmdTuneWheel(event)
{
  const S = GT.settings.MMD;
  if (S.tuneLocked !== false || S.rigControl !== true || window.opener.mmDecoderRigLocked() || !event.deltaY) return;
  if (DEC.offTime && mmdFtx()) return;
  const dial = mmdDial();
  if (dial == null) return;
  event.preventDefault();
  const step = event.shiftKey ? MMD_WHEEL_HZ * 10 : event.ctrlKey ? MMD_WHEEL_HZ / 10 : MMD_WHEEL_HZ;
  const from = DEC.expect && Date.now() < DEC.expect.until ? DEC.expect.freq : dial;
  const to = Math.round((from + (event.deltaY < 0 ? step : -step)) / step) * step;
  if (mmdTuneDial(to)) mmdTuneToast(cwTuneToast, to - from, to, true);
}

// A tuning shown over its waterfall (el: the wheel's on the waterfall, a click's on the band scope) on a raised white label: the
// frequency tuned to (to, Hz on the air: 7.074.000), and under it, twice the size, the change ("+30 Hz"); add: the wheel's, counted on
// from the change still shown (its running total while the wheel goes on). Held MMD_TOAST_HOLD_MS after the last change, then faded
// out over MMD_TOAST_FADE_MS
const MMD_TOAST_HOLD_MS = 400;
const MMD_TOAST_FADE_MS = 1000;

function mmdTuneToast(el, hz, to, add)
{
  el.toastTotal = (add && el.toastShown ? el.toastTotal : 0) + hz;
  el.toastShown = true;
  const freq = document.createElement("div");
  freq.className = "mmdTuneToastFreq";
  freq.textContent = window.opener.formatDialFreq(to);
  const change = document.createElement("div");
  change.className = "mmdTuneToastChange";
  change.textContent = mmdHzChange(el.toastTotal);
  el.replaceChildren(freq, change);
  el.style.transition = "none";
  el.style.opacity = "1";
  clearTimeout(el.toastTimer);
  el.toastTimer = setTimeout(() =>
  {
    el.style.transition = "opacity " + MMD_TOAST_FADE_MS + "ms";
    el.style.opacity = "0";
    el.toastTimer = setTimeout(() =>
    {
      el.toastShown = false;
    }, MMD_TOAST_FADE_MS);
  }, MMD_TOAST_HOLD_MS);
}

// A change of frequency with its sign: "+30 Hz", "-850 Hz"; a kHz or more in kHz, "+12.35 kHz"
function mmdHzChange(hz)
{
  const size = Math.abs(Math.round(hz));
  return (hz < 0 ? "-" : "+") + (size < 1000 ? size + " Hz" : (size / 1000).toFixed(3).replace(/\.?0+$/, "") + " kHz");
}

// The rig's dial to dial (Hz on the air) through Rig Control, in mode when given (data: its data variant, true, or plain, false);
// true when it was sent
function mmdTuneDial(dial, mode, data)
{
  // Never while BirdWatch follows a satellite with the rig (window.opener.mmDecoderRigLocked), nor without Rig Control (Settings,
  // Decoders): nothing at all is sent to it then
  if (mmdDial() == null || window.opener.mmDecoderRigLocked() || GT.settings.MMD.rigControl !== true) return false;
  // On the mode's VFO
  const spec = { rxVfo: window.opener.mmDecoderVfo().id };
  // The frequency (dial null: the mode alone)
  if (dial != null)
  {
    dial = Math.round(dial);
    // What the waterfall had heard moved with the dial (not when the mode changes too: mmdFlip turns it round for that)
    const before = mmdDial();
    if (before != null && (!mode || mode == window.opener.mmDecoderVfoRead().mode)) mmdFallShift(dial - before);
    DEC.expect = { freq: dial, until: Date.now() + CW_TUNE_SETTLE_MS };
    mmdBandFollow(dial);
    mmdRetune();
    spec.rx = dial;
  }
  if (mode)
  {
    spec.mode = mode;
    spec.data = data;
  }
  return spec.rx || spec.mode ? window.opener.rigTune(spec) : false;
}

// ---- FT8 mode: ft8_lib (ft8.wasm, built from src/wasm/ft8 by tools/build_ft8_wasm.js) decodes each 15 s period once it has been heard,
// from the worklet's 12 kHz audio. The waterfall goes on as in CW mode; the FT8 lines take the CW lines' place.
// SSTV mode (mmdSstv.js) the same, from the same 12 kHz audio: its pictures take the CW lines' place

function mmdModeSet(mode)
{
  // Another mode: the time skew off (FT8's and FT4's periods differ), and nothing focused, pinned, hovered or dragged in the last carried
  // into it (CW's pinned signal, FT8's or FT4's focus)
  const next = MMD_MODES.includes(mode) ? mode : "cw";
  // A mode chosen (or a signal Detect Modes found picked) ends Detect Modes
  if (mmdDetectOn()) mmdDetectStop(next);
  if (DEC.mode != next)
  {
    mmdOffTimeStop();
    DEC.focus = null;
    DEC.hoverRow = null;
    DEC.hoverFall = null;
    DEC.ft8Focus = 0;
    DEC.focusDrag = null;
    // Min Freq and Max Freq: the last mode's kept, this one's own (or the last one's, copied, the first time)
    mmdRangeKeep();
    mmdRangeOfMode(next);
    if (DEC.bins > 0)
    {
      mmdRange();
      mmdScale();
    }
  }
  DEC.mode = next;
  GT.settings.MMD.viewMode = DEC.mode;
  const ft8 = mmdFtx(), sstv = mmdSstvMode(), hell = mmdHellMode(), packet = DEC.mode == "packet", sat = DEC.mode == "sat", key = mmdKeyMode();
  const olivia = mmdOliviaMode();
  // CW's list shows the keyboard modes' (PSK31, RTTY, MFSK, DominoEX / THOR) and Olivia's signals too (mmdKey.js, mmdOlivia.js), the WPM column their baud; changing between them,
  // the other's signals go
  const listed = (DEC.mode == "cw" || key || olivia) && !mmdNavtexMode();
  const own = (mode) => mmdKeyMode(mode) || mmdOliviaMode(mode);
  if (DEC.listedMode != DEC.mode && (own(DEC.mode) || own(DEC.listedMode)))
  {
    DEC.signals = {};
    DEC.focus = null;
    cwRows.innerHTML = "";
  }
  DEC.listedMode = DEC.mode;
  if (key) mmdKeyListed();
  cwWpmHead.textContent = I18N(key || olivia ? "cwViewer.packet.header.baud" : "cwViewer.header.wpm");
  // The empty list's "No CW decoded yet" names the mode (PSK63, RTTY, DominoEX 11, Olivia ...)
  cwEmpty.textContent = I18N("cwViewer.empty").replace("CW", key ? mmdKeyName() : olivia ? "Olivia" : "CW");
  // The last mode's status (FT8's decodes, Packet's frames ...) gone
  if (DEC.running) mmdStatus(I18N("cwViewer.status.listening"));
  cwList.style.display = listed ? "" : "none";
  // NAVTEX: its messages in their own list (mmdNavtex.js)
  navtexList.style.display = mmdNavtexMode() ? "" : "none";
  if (mmdNavtexMode())
  {
    NAVTEX.listKey = null;
    mmdNavtexRender();
  }
  // Another mode: the SSTV view back on Receive, and a picture being sent (or still being built to be) stopped (mmdSstvTx.js); WEFAX has
  // no Send
  sstvTxTab.style.display = sstvRxTab.style.display = DEC.mode == "wefax" ? "none" : "";
  if (DEC.mode != "sstv")
  {
    if (mmdSstvTxKeying()) mmdSstvTxStop(I18N("sstvTx.status.stopped"));
    mmdSstvTxShow(false);
  }
  satList.style.display = sat ? "" : "none";
  wsprList.style.display = mmdWsprMode() ? "" : "none";
  // WSPR: listened for afresh (its list kept)
  mmdWsprStop();
  ft8List.style.display = ft8 ? "" : "none";
  sstvView.style.display = sstv ? "" : "none";
  packetList.style.display = packet ? "" : "none";
  hellView.style.display = hell ? "" : "none";
  // (FT8's, FT4's and WSPR's lines are their periods': no UTC menu)
  cwUtcBox.style.display = ft8 || mmdWsprMode() ? "none" : "";
  cwSlotBox.style.display = ft8 ? "" : "none";
  if (ft8) cwSlot.checked = GT.settings.MMD[DEC.mode + "SlotFinder"] === true;
  // PSK31, MFSK, DominoEX / THOR and Olivia: the submode menu on the second line
  if (key) mmdKeyMenu();
  else cwKeyBox.style.display = "none";
  cwOliviaBox.style.display = olivia ? "" : "none";
  if (olivia) mmdOliviaMenu();
  // Feld-Hell: its submode and Trim; WEFAX: its line rate, index of cooperation, Start Now and Stop
  cwHellBox.style.display = hell ? "" : "none";
  if (hell) mmdHellMenu();
  // The submode menus' row, while one of them is shown
  cwSubBar.style.display = [cwHellBox, cwKeyBox, cwOliviaBox].some((box) => box.style.display != "none") ? "" : "none";
  cwWefaxBar.style.display = DEC.mode == "wefax" ? "" : "none";
  if (DEC.mode == "wefax") mmdWefaxMenu();
  mmdFreqsShow(mmdDial() != null);
  // This mode's Input Device (the decoder started again on it, if it was listening to another)
  mmdInputs();
  if (DEC.ft8) DEC.ft8.total = 0;
  // SSTV starts listening afresh (what it had heard before is gone)
  if (sstv)
  {
    mmdSstvReset();
    mmdSstvStrip();
    mmdSstvDraw();
    mmdSstvHead();
  }
  if (hell) mmdHellReset();
  // Packet, Sat Data, the keyboard modes and Olivia: listened for afresh too, their lists kept
  if (packet) mmdPacketReset();
  if (sat) mmdSatReset();
  if (key) mmdKeyReset();
  if (olivia) mmdOliviaReset();
  if (DEC.node)
  {
    DEC.node.port.postMessage({ type: "ft8", on: mmdFt8StreamWanted() });
    DEC.node.port.postMessage({ type: "raw", on: mmdRawMode() || mmdRsidOn() });
    // CW decoded in CW mode only: FT8, SSTV and Packet decode their own audio, so the CW engine makes the waterfall's rows alone (back in
    // CW, carriers are found afresh)
    DEC.node.port.postMessage({ type: "decode", on: DEC.mode == "cw" });
  }
  // The scale's ticks and the waterfall's marks differ by mode
  DEC.dirty = true;
  mmdOverlay();
  // A test signal of the last mode's stops; the button shows this mode's
  mmdTestModeChanged();
  // The waterfall's Resolution By Mode is this mode's (mmdFallView.js)
  mmdFallViewApply();
  // The GridTracker instance follows the mode (services/mmDecoder.js), and a closed window listens only in FT8, FT4 and WSPR
  mmdListen();
}

// Follow BirdWatch (Settings, Decoders): as BirdWatch's rig starts following another transmitter, the decoder takes its mode, once (the
// Mode menu can still be changed after); one with no mode here (voice ...) leaves it as it is
function mmdFollowBirdWatch()
{
  // Every mode reading BirdWatch's downlink VFO, or each its own again: the settings' VFO menus show which
  const vfo = window.opener.mmDecoderFollowVfoSync();
  if (vfo !== DEC.followVfo)
  {
    DEC.followVfo = vfo;
    mmdSettingsRender();
  }
  // Follow BirdWatch itself shown only while BirdWatch is on with its Satellite Tracking toggled on (off, nothing is followed: its
  // setting is kept as it is)
  const birdWatch = window.opener.birdWatchPanelShown();
  if (birdWatch !== DEC.birdWatchShown)
  {
    DEC.birdWatchShown = birdWatch;
    mmdFollowBirdWatchValue.parentElement.style.display = birdWatch ? "" : "none";
  }
  if (GT.settings.MMD.followBirdWatch !== true || !birdWatch) return;
  const followed = window.opener.mmDecoderBirdWatchMode();
  const uuid = followed ? followed.uuid : null;
  if (uuid === DEC.followedUuid) return;
  DEC.followedUuid = uuid;
  if (!followed || !followed.mode || followed.mode == DEC.mode) return;
  cwMode.value = followed.mode;
  mmdModeSet(followed.mode);
}
// The modes decoded from the input's own samples (the worklet's raw stream): Packet, Sat Data, the keyboard modes (mmdKey.js) and Olivia
function mmdRawMode(mode = DEC.mode)
{
  return mode == "packet" || mode == "sat" || mmdKeyMode(mode) || mmdOliviaMode(mode) || mmdHellMode(mode);
}

// The worklet's 12 kHz stream: FT8's, FT4's, WSPR's and SSTV's
function mmdFt8StreamWanted()
{
  return mmdFtx() || mmdWsprMode() || mmdSstvMode();
}

// FT8 or FT4 (the same decoder, ft8Worker.js: FT4 decoded the Normal way only), and the period of the one decoded (ms)
function mmdFtx(mode = DEC.mode)
{
  return mode == "ft8" || mode == "ft4";
}

function mmdFtxPeriodMs()
{
  return DEC.mode == "ft4" ? FT4_PERIOD_MS : FT8_PERIOD_MS;
}

// The other modes' UTC lines: every this many seconds (the UTC menu, 30 unless set), 0 none
function mmdUtcStep()
{
  const step = GT.settings.MMD.utcLines;
  return MMD_UTC_STEPS.includes(step) ? step : 30;
}

// FT8, FT4 and WSPR, while listening: how far into its period the decoder is, at the divider's right, "[ s / period ]" (the seconds
// padded to the period's width, so the bracket stays put); else nothing
function mmdPeriodProgress()
{
  let text = "";
  if (DEC.running && (mmdFtx() || mmdWsprMode()))
  {
    const periodMs = mmdPeriodMs();
    const shift = mmdFtx() ? mmdFtxShift() : 0;
    const into = (((Date.now() - FT8_LATENCY_MS - shift) % periodMs) + periodMs) % periodMs;
    const total = periodMs / 1000;
    text = "[ " + String(Math.floor(into / 1000)).padStart(String(Math.floor(total)).length, " ") + " / " + total + " ]";
  }
  if (cwPeriodText.textContent != text) cwPeriodText.textContent = text;
  // (The mode changed: the status moved with it)
  mmdStatusShow();
}

// The waterfall's lines: every this many ms (FT8's, FT4's and WSPR's periods, the other modes' UTC menu), 0 none
function mmdPeriodMs()
{
  if (mmdWsprMode()) return WSPR_PERIOD_MS;
  return mmdFtx() ? mmdFtxPeriodMs() : mmdUtcStep() * 1000;
}

// ft8.wasm in its worker (ft8Worker.js), once: a period's decode takes up to about half a second, which would stop the waterfall
function mmdFt8Load()
{
  if (DEC.ft8) return DEC.ft8;
  const bytes = fs.readFileSync(NodeURL.fileURLToPath(new URL("lib/mmd/ft8.wasm", location.href)));
  const worker = new Worker("lib/mmd/ft8Worker.js");
  // Three passes: after each, the signals decoded taken out of the audio and the period searched again for the ones they covered
  // GridTracker's callsign prefixes, for the decoder to tell a real call from noise
  const prefixes = Object.keys(GT.prefixToDXCC || {}).filter((prefix) => /^[A-Z0-9]+$/.test(prefix)).join("\n");
  worker.postMessage({ type: "init", wasm: bytes, audio: FT8_AUDIO, passes: FT8_PASSES, prefixes: prefixes });
  const F = { worker: worker, ring: new Float32Array(FT8_KEEP_S * FT8_RATE), total: 0, endWall: 0, next: 0 };
  worker.onmessage = (event) => mmdFt8Decoded(F, event.data);
  DEC.ft8 = F;
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
  const stamp = DEC.ctx.getOutputTimestamp();
  const endWall = performance.timeOrigin + stamp.performanceTime + (data.end - stamp.contextTime) * 1000 - FT8_LATENCY_MS;
  const n = data.samples.length;
  const size = F.ring.length;
  for (let i = 0; i < n; i++) F.ring[(F.total + i) % size] = data.samples[i];
  const periodMs = mmdFtxPeriodMs();
  // Heard from scratch: the first period to decode is the first that starts after the audio does
  if (F.total == 0)
  {
    const shift = mmdFtxShift();
    F.next = Math.ceil((endWall - (n / FT8_RATE) * 1000 - shift) / periodMs) * periodMs + shift;
    F.cutTotal = 0;
  }
  F.total += n;
  F.endWall = endWall;
  while (F.endWall >= F.next + periodMs + FT8_LATE_MS)
  {
    mmdFt8Decode(F, F.next, periodMs);
    F.next += periodMs;
  }
  // The early decode is Deep's (Depth Normal: each period once, when it ends)
  if (!mmdFt8Plain() && F.early != F.next && F.endWall >= F.next + FT8_EARLY_MS + FT8_LATE_MS) mmdFt8Decode(F, F.next, FT8_EARLY_MS);
}

// The FT8 Decoder's Depth (Settings) is Normal: ft8_lib as it comes (ft8wasm.c, ft8_set_plain); FT4 always is
function mmdFt8Plain()
{
  return GT.settings.MMD.ft8Depth == "normal" || DEC.mode == "ft4";
}

// The period starting at start (ms, on a 15 s boundary, or skewed: mmdFtxShift) out of the ring and sent to the worker to decode, the
// first heard ms of it (FT8_EARLY_MS, or all of it). All of it after an early decode: only the messages new since then
function mmdFt8Decode(F, start, heard)
{
  const first = F.total - Math.round(((F.endWall - start) / 1000) * FT8_RATE);
  const count = Math.round((heard / 1000) * FT8_RATE);
  if (first < 0 || first < F.total - F.ring.length) return;
  // A period heard partly before the rig last moved (mmdRetune) and partly after: what came before is silence here, only what the new
  // frequency gave is decoded. One heard wholly before is decoded as it was heard
  const samples = new Float32Array(count);
  const cut = first + count > (F.cutTotal || 0) ? F.cutTotal || 0 : 0;
  for (let i = 0; i < count; i++) samples[i] = first + i < cut ? 0 : F.ring[(first + i) % F.ring.length];
  const periodMs = mmdFtxPeriodMs();
  const more = heard == periodMs && F.early == start;
  if (heard < periodMs) F.early = start;
  // The periods decoded whole lately (not decoded again when the timing moves: mmdOffTimeAlign)
  if (heard == periodMs) F.decoded = (F.decoded || []).concat(start).slice(-8);
  const myCall = (GT.settings.app.myCall || "").trim().toUpperCase();
  // Done by its deadline: the early decode before the period ends, the full one well before the next period's early decode
  const deadline = heard < periodMs ? start + FT8_EARLY_DEADLINE_MS : Date.now() + (DEC.mode == "ft4" ? FT4_BUDGET_MS : FT8_FULL_BUDGET_MS);
  const plain = mmdFt8Plain();
  // The focus is Deep's in FT8, and FT4's (always decoded the Normal way, with one more pass at the focus)
  const focus = !plain || DEC.mode == "ft4" ? DEC.ft8Focus || 0 : 0;
  F.worker.postMessage({ type: "decode", start: start, samples: samples, more: more, myCall: myCall, focus: focus, shift: mmdFtxShift(), deadline: deadline, plain: plain, ft4: DEC.mode == "ft4" }, [samples.buffer]);
  // GridTracker's instance (if open) says it is decoding
  if (mmdInstanceMain()) window.opener.mmDecoderInstanceDecoding(true);
}

// A period's messages back from the worker (one line each, ft8wasm.c's ft8_decode)
function mmdFt8Decoded(F, data)
{
  // (Not one to go on with: GridTracker's instance no longer decoding it, its Status says so)
  const dropped = () =>
  {
    if (GT.mmdInstance && GT.mmdInstance.decoding) window.opener.mmDecoderInstanceDecoding(false);
  };
  if (data.type == "error")
  {
    dropped();
    mmdStatus(I18N("cwViewer.status.failed") + " FT8: " + data.message, true);
    return;
  }
  // Switched to CW meanwhile, or cleared, or from FT8 to FT4 or back (the period is the other mode's): not shown, nor sent on
  if (DEC.ft8 != F || !mmdFtx() || !!data.ft4 != (DEC.mode == "ft4"))
  {
    dropped();
    return;
  }
  F.periodCount = (data.more ? F.periodCount : 0) + Math.max(0, data.count);
  const lines = data.text.split("\n").filter(Boolean).map((line) => line.split("\t"));
  // Decoded skewed (shift ms): DT from the usual timing, shown orange
  const shift = data.shift || 0;
  mmdFt8Rows(data.start, lines, data.more, shift);
  // To GridTracker's instance (if open) as its Decodes, in the usual period, DT as shown (from half a second into it), then its decoding
  // done. A message sent in the last period and a half isn't sent again: a period decoded again (the time skew moved, or taken off) gives
  // what was decoded the first time once more, while a station's next transmission comes two periods on
  const periodMs = mmdFtxPeriodMs();
  const sent = DEC.ft8Sent || (DEC.ft8Sent = new Map());
  for (const [message, at] of sent) if (data.start - at > 2 * periodMs || at - data.start > 2 * periodMs) sent.delete(message);
  const fresh = lines.filter(([snr, dt, freq, message]) =>
  {
    const at = sent.get(message || "");
    if (at !== undefined && Math.abs(data.start - at) < 1.5 * periodMs) return false;
    sent.set(message || "", data.start);
    return true;
  });
  // (A period heard while a test signal played stays in the window: mmdTest.js)
  if (mmdInstanceMain())
  {
    if (!mmdTestHeard(data.start, data.start + periodMs)) window.opener.mmDecoderInstanceDecodes(DEC.mode, data.start - shift, fresh.map(([snr, dt, freq, message]) => [Number(snr), Number(dt) - FT8_DT_ZERO + shift / 1000, Number(freq), message || ""]));
    window.opener.mmDecoderInstanceDecoding(false);
  }
  // (Not listening any more, the mode the same: stopped meanwhile, a restart that failed)
  else dropped();
  const utc = new Date(data.start).toISOString().slice(11, 19);
  // (FT4's the same, the mode's name in it swapped)
  const status = I18N("cwViewer.ft8.status").replace("{count}", F.periodCount).replace("{utc}", utc);
  mmdStatus(DEC.mode == "ft4" ? status.replace("FT8", "FT4") : status);
}

// A period's lines on top of the list (UTC, dB, DT, Freq, Message; a line above the period's first), the oldest let go past
// FT8_ROWS_MAX; more: lines new at the period's end, added under its early ones. Scrolled down the list, the view is moved down by as
// much, so the lines being read stay put. shift: decoded skewed (ms), their DT from the usual timing
function mmdFt8Rows(start, lines, more, shift = 0)
{
  const utc = new Date(start).toISOString().slice(11, 19).replace(/:/g, "");
  let at = 0;
  if (more) while (at < DEC.ft8Lines.length && DEC.ft8Lines[at].utc == utc) at++;
  // DT as WSJT-X shows it: from half a second into the period
  const added = lines.map(([snr, dt, freq, message, how], index) => ({ start: start, utc: utc, snr: snr, dt: (Number(dt) - FT8_DT_ZERO + shift / 1000).toFixed(1), offTime: shift != 0, freq: freq, message: message || "", how: how || "", first: index == 0 && at == 0 }));
  if (added.length == 0) return;
  // Their marks on the scale
  DEC.dirty = true;
  DEC.ft8Lines = DEC.ft8Lines.slice(0, at).concat(added, DEC.ft8Lines.slice(at)).slice(0, FT8_ROWS_MAX);
  if (ft8List.scrollTop > 0) ft8List.scrollTop += added.length * DEC.ft8RowHeight;
  mmdFt8Render();
}

// FT8 and FT4: the place clicked (Hz of audio; inside the focus again, or 0, lets go), searched harder each period (ft8wasm.c,
// ft8_set_focus)
function mmdFt8Focus(hz)
{
  DEC.ft8Focus = !hz || (DEC.ft8Focus && Math.abs(DEC.ft8Focus - hz) < FTX_FOCUS_HALF) ? 0 : Math.round(hz);
  mmdOverlay();
}

// ---- Time skew: for a station whose clock is off (a DXpedition's with no time source), its periods starting seconds from everyone
// else's. A right-click on the waterfall turns it on (+0.0 s) or off; while it's on, the wheel moves it, the period lines are orange where
// the skewed periods start, the skew shown above each, and every period is decoded on that timing (stations on time no longer are, as
// expected)

// The skew (ms, either way), 0 while it's off
function mmdFtxShift()
{
  return DEC.offTime ? DEC.offTime.shift : 0;
}

// On at the mode's skew as last set this session (DEC.skewKept; 0 at first, and again after a restart), or off (kept for next time)
function mmdSkewToggle()
{
  if (DEC.offTime) mmdOffTimeStop();
  else
  {
    DEC.offTime = { shift: Math.round(mmdOffTimeShiftOf((DEC.skewKept || {})[DEC.mode] || 0, mmdFtxPeriodMs())) };
    mmdSkewMoved();
  }
}

// As the skew is shown: +4.3 s
function mmdSkewText(shift)
{
  return (shift >= 0 ? "+" : "-") + (Math.abs(shift) / 1000).toFixed(1) + " s";
}

// The wheel on the waterfall while the skew is on: up later, down earlier, FTX_SKEW_STEP_MS a notch (FTX_SKEW_BIG_MS with Shift), round
// past half a period either way
function mmdSkewWheel(event)
{
  if (!DEC.offTime || !mmdFtx()) return;
  event.preventDefault();
  const step = (event.shiftKey ? FTX_SKEW_BIG_MS : FTX_SKEW_STEP_MS) * (event.deltaY < 0 ? 1 : -1);
  DEC.offTime.shift = Math.round(mmdOffTimeShiftOf(DEC.offTime.shift + step, mmdFtxPeriodMs()) / FTX_SKEW_STEP_MS) * FTX_SKEW_STEP_MS;
  // Kept as the mode's for the session (turned on again, it comes back here)
  DEC.skewKept = DEC.skewKept || {};
  DEC.skewKept[DEC.mode] = DEC.offTime.shift;
  mmdSkewMoved();
}

// The skew turned on or moved: its lines redrawn at once, and the period last heard whole decoded on it once the wheel has rested
// (FTX_SKEW_SETTLE_MS)
function mmdSkewMoved()
{
  if (DEC.periodMarks) DEC.periodMarks = DEC.periodMarks.filter((m) => !m.off);
  mmdOffTimeMarks();
  mmdOverlay();
  if (DEC.skewTimer) nodeTimers.clearTimeout(DEC.skewTimer);
  DEC.skewTimer = nodeTimers.setTimeout(() =>
  {
    DEC.skewTimer = null;
    if (DEC.offTime && DEC.ft8 && DEC.ft8.total > 0 && mmdFtx()) mmdOffTimeAlign(DEC.ft8);
  }, FTX_SKEW_SETTLE_MS);
}

// The waterfall's speed: rows a ms, from the oldest period line, else as last measured (null until one has gone a second down)
function mmdFallRowsPerMs()
{
  const now = Date.now() - FT8_LATENCY_MS;
  const ref = (DEC.periodMarks || []).find((m) => m.age > 0 && now - m.start > 1000);
  if (ref) DEC.fallRowsPerMs = ref.age / (now - ref.start);
  return DEC.fallRowsPerMs || null;
}

// The waterfall's speed with no lines on it to go by (the UTC menu off): the rows drawn over each 10 s
function mmdFallRowsCount(drawn)
{
  const now = Date.now();
  const seen = DEC.fallSeen || (DEC.fallSeen = { rows: 0, at: now });
  seen.rows += drawn;
  if (now - seen.at < 10000) return;
  if (seen.rows > 0 && !(DEC.periodMarks && DEC.periodMarks.length)) DEC.fallRowsPerMs = seen.rows / (now - seen.at);
  DEC.fallSeen = { rows: 0, at: now };
}

// Where a period starting at start (ms) is from the usual timing: from minus half a period to half of one (ms)
function mmdOffTimeShiftOf(start, periodMs)
{
  const s = ((start % periodMs) + periodMs) % periodMs;
  return s > periodMs / 2 ? s - periodMs : s;
}

// The periods decoded moved to the timing now (mmdFtxShift): the last one heard whole is decoded next (not one decoded already); not
// back (the rig moved), the one under way
function mmdOffTimeAlign(F, back = true)
{
  const periodMs = mmdFtxPeriodMs();
  const shift = mmdFtxShift();
  let next = Math.floor((F.endWall - FT8_LATE_MS - shift) / periodMs) * periodMs + shift - (back ? periodMs : 0);
  while (F.decoded && F.decoded.includes(next)) next += periodMs;
  F.next = next;
  F.early = null;
  DEC.dirty = true;
  mmdOffTimeMarks();
  mmdOverlay();
}

// The period lines moved to the timing now: the change itself draws none (DEC.lastPeriod set to it), and its periods already on the
// waterfall are lined at once, each where the waterfall's speed says its time is: with the skew on, orange (so the transmissions heard so
// far can be lined up with); turned off, the usual gray ones back everywhere. Also the lines of a new step (mmdPeriodRow)
function mmdOffTimeMarks()
{
  const marks = DEC.periodMarks || (DEC.periodMarks = []);
  const periodMs = mmdPeriodMs();
  const shift = mmdFtxShift();
  const off = !!DEC.offTime;
  const now = Date.now() - FT8_LATENCY_MS;
  DEC.lastPeriod = Math.floor((now - shift) / periodMs);
  const rowsPerMs = mmdFallRowsPerMs();
  if (!rowsPerMs || !(cwFall.height > 0)) return;
  for (let k = DEC.lastPeriod; ; k--)
  {
    const start = k * periodMs + shift;
    const age = Math.round((now - start) * rowsPerMs);
    if (age >= cwFall.height) break;
    if (age < 0 || marks.some((m) => m.off == off && Math.abs(m.start - start) < periodMs / 10)) continue;
    marks.push({ age: age, start: start, off: off, shift: shift });
  }
  // Oldest first, as mmdPeriodRow keeps them
  marks.sort((a, b) => b.age - a.age);
}

// The skew off (its value kept for next time: mmdSkewToggle), back to the usual timing, its orange lines taken off the waterfall: a right-click on
// the waterfall, a retune (back false: what was heard before it isn't decoded again), another mode
function mmdOffTimeStop(back = true)
{
  if (!DEC.offTime) return;
  // The waterfall's speed measured while the orange lines are still there (the gray ones go back by it: mmdOffTimeMarks)
  mmdFallRowsPerMs();
  DEC.offTime = null;
  if (DEC.periodMarks) DEC.periodMarks = DEC.periodMarks.filter((m) => !m.off);
  if (DEC.skewTimer)
  {
    nodeTimers.clearTimeout(DEC.skewTimer);
    DEC.skewTimer = null;
  }
  if (DEC.ft8 && DEC.ft8.total > 0) mmdOffTimeAlign(DEC.ft8, back);
  else mmdOffTimeMarks();
  mmdOverlay();
}

// FT8 and FT4: whether the waterfall's x (CSS pixels) is inside the focus
function mmdFocusAt(offsetX)
{
  if (!mmdFtx() || !DEC.ft8Focus) return false;
  const hz = mmdAudioAt(offsetX / cwOverlay.clientWidth);
  return hz != null && Math.abs(hz - DEC.ft8Focus) <= FTX_FOCUS_HALF;
}

// A signal's width (Hz): FT8's 8 tones 6.25 Hz apart, FT4's 4 tones 20.8 Hz apart
function mmdFtxWidth()
{
  return DEC.mode == "ft4" ? 250 / 3 : 50;
}

// Slot Finder's box on the second line: the mode's own (FT8's, FT4's), read four times a second (mmdRender)
function mmdSetSlotFinder()
{
  if (mmdFtx()) GT.settings.MMD[DEC.mode + "SlotFinder"] = cwSlot.checked;
}

// Slot Finder from the waterfall: each row's bins counted while over FTX_SLOT_BUSY_LEVEL, by period (the time skew's while it is on);
// as each period ends, its busy bins kept for its parity (the last FTX_SLOT_PERIODS of each). Only in FT8 and FT4 with Slot Finder on
function mmdSlotRow(row)
{
  if (!mmdFtx() || GT.settings.MMD[DEC.mode + "SlotFinder"] !== true || !(DEC.binHz > 0))
  {
    if (DEC.slot && DEC.slot.binHz) mmdSlotReset();
    return;
  }
  const periodMs = mmdFtxPeriodMs();
  const now = Date.now() - FT8_LATENCY_MS;
  const index = Math.floor((now - mmdFtxShift()) / periodMs);
  let S = DEC.slot;
  // Started afresh: another mode, span or period length
  if (!S || S.binHz != DEC.binHz || S.bins != row.length || S.periodMs != periodMs)
  {
    S = DEC.slot = { since: S ? S.since : Date.now(), binHz: DEC.binHz, bins: row.length, periodMs: periodMs, done: [[], []], index: index, startedAt: now, rows: 0, hits: new Uint16Array(row.length) };
  }
  if (index != S.index)
  {
    // A period heard for at least half of it is kept
    if (S.rows && now - S.startedAt >= periodMs / 2 - FT8_LATENCY_MS)
    {
      const list = S.done[S.index % 2];
      list.unshift(mmdSlotMask(S));
      list.length = Math.min(list.length, FTX_SLOT_PERIODS);
    }
    S.index = index;
    S.startedAt = now;
    S.rows = 0;
    S.hits.fill(0);
  }
  S.rows++;
  for (let k = 0; k < row.length; k++) if (row[k] >= FTX_SLOT_BUSY_LEVEL) S.hits[k]++;
}

// A period's busy bins so far (1 busy)
function mmdSlotMask(S)
{
  const mask = new Uint8Array(S.bins);
  const need = Math.max(1, S.rows * FTX_SLOT_BUSY_SHARE);
  for (let k = 0; k < S.bins; k++) mask[k] = S.hits[k] >= need ? 1 : 0;
  return mask;
}

// Heard afresh (a retune, Clear, Slot Finder off): the periods kept let go, and the decodes from before now no longer counted
function mmdSlotReset()
{
  DEC.slot = { since: Date.now() };
}

// Slot Finder (FT8's and FT4's own, on unless turned off): the clearest places to transmit, from the signals decoded lately in each period
// (even: the first of each pair, WSJT-X's Tx even/1st; odd). A slot is open where a signal fits with FTX_SLOT_GUARD_HZ clear either side
// of it (from the signals and the edges of the range between [ and ]); every open one is as good, and the one nearest the middle of the
// range is taken. The one open in both periods first, as "both"; then each period's own (where it isn't that one). [{ freq (Hz, its
// lowest tone, as WSJT-X's Tx), period ("both", "even" or "odd") }], empty when off, nothing was decoded lately, or no slot is open
function mmdFtxSlots()
{
  if (!mmdFtx() || GT.settings.MMD[DEC.mode + "SlotFinder"] !== true) return [];
  const periodMs = mmdFtxPeriodMs();
  const width = mmdFtxWidth();
  const low = mmdMinHz();
  const top = mmdMaxHz();
  if (top - low < width) return [];
  const S = DEC.slot;
  const busy = [[], []];
  let heard = [false, false];
  // What the waterfall heard: each period's busy bins as runs of Hz, the last FTX_SLOT_PERIODS of each and the one under way (once far
  // enough into it)
  if (S && S.binHz)
  {
    const masks = [0, 1].map((parity) => S.done[parity].slice());
    if (S.rows && Date.now() - S.startedAt >= FTX_SLOT_UNDER_WAY_MS) masks[S.index % 2].push(mmdSlotMask(S));
    for (const parity of [0, 1])
    {
      for (const mask of masks[parity])
      {
        heard[parity] = true;
        for (let k = 0; k < mask.length; k++)
        {
          if (!mask[k]) continue;
          let end = k;
          while (end + 1 < mask.length && mask[end + 1]) end++;
          busy[parity].push([k * S.binHz, (end + 1) * S.binHz]);
          k = end;
        }
      }
    }
  }
  // And every signal decoded in those periods (since the last retune), even where the waterfall shows little: newest first, the period's
  // parity from its start (a skewed one's too)
  const since = Math.max(Date.now() - (2 * FTX_SLOT_PERIODS + 1) * periodMs, (S ? S.since : 0) - periodMs);
  for (const line of DEC.ft8Lines)
  {
    if (!(line.start >= since)) break;
    const freq = Number(line.freq);
    const parity = Math.round(line.start / periodMs) % 2;
    busy[parity].push([freq, freq + width]);
    heard[parity] = true;
  }
  // Nothing heard yet in either period
  if (!heard[0] && !heard[1]) return [];
  // The open slot nearest the middle, as its lowest tone, or null: in each gap, the lowest tones that keep the guard either side, the
  // one of them nearest the middle
  const middle = (low + top) / 2;
  const guard = FTX_SLOT_GUARD_HZ;
  const nearest = (signals) =>
  {
    let best = null;
    let from = low;
    for (const [start, end] of signals.sort((p, q) => p[0] - q[0]).concat([[top, top]]))
    {
      const first = from + guard;
      const last = Math.min(start, top) - guard - width;
      if (last >= first)
      {
        const freq = Math.min(last, Math.max(first, middle - width / 2));
        const off = Math.abs(freq + width / 2 - middle);
        if (!best || off < best.off) best = { off: off, freq: Math.round(freq) };
      }
      from = Math.max(from, end);
    }
    return best ? best.freq : null;
  };
  // Even's and odd's own too, each where it isn't the one open in both (overlapping it, in the same gap a few Hz along: only "both" shown)
  const both = nearest(busy[0].concat(busy[1]));
  const slots = both == null ? [] : [{ freq: both, period: "both" }];
  for (const [period, signals] of [["even", busy[0]], ["odd", busy[1]]])
  {
    const freq = nearest(signals);
    if (freq != null && (both == null || Math.abs(freq - both) >= width)) slots.push({ freq: freq, period: period });
  }
  return slots;
}

function mmdFt8Line(line)
{
  return "<tr data-freq='" + Number(line.freq) + "'" + (line.first ? " class='ft8First'" : "") + "><td class='ft8Num'>" + line.utc + "</td><td class='ft8Num'>" + mmdEscape(line.snr) +
    "</td><td class='ft8Num" + (line.offTime ? " ft8OffTime" : "") + "'>" + mmdEscape(line.dt) + "</td><td class='ft8Num'>" + mmdEscape(line.freq) + "</td><td>" + mmdEscape(line.message) + (line.how ? " <span class='ft8How' title=\"" + mmdEscape(I18N("cwViewer.ft8.how." + line.how + ".hover")).replace(/"/g, "&quot;") + "\">" + mmdEscape(line.how) + "</span>" : "") + "</td></tr>";
}

// The lines in view now ({ shownFirst, shownLast }) and the slice to draw, with the buffer ({ first, last }); last indexes are exclusive
function mmdFt8Range()
{
  const count = DEC.ft8Lines.length;
  const viewTop = ft8List.scrollTop - DEC.ft8HeaderHeight;
  const shownFirst = Math.max(0, Math.min(count, Math.floor(viewTop / DEC.ft8RowHeight)));
  const shownLast = Math.max(shownFirst, Math.min(count, Math.ceil((viewTop + ft8List.clientHeight) / DEC.ft8RowHeight)));
  return { shownFirst, shownLast, first: Math.max(0, shownFirst - FT8_VIRTUAL_BUFFER), last: Math.min(count, shownLast + FT8_VIRTUAL_BUFFER) };
}

// The slice drawn between two spacer rows standing in for the lines above and below it; the heights measured from what was drawn
function mmdFt8Render()
{
  const { first, last } = mmdFt8Range();
  DEC.ft8Slice = { first, last };
  const lines = DEC.ft8Lines;
  const spacer = (height) => "<tr class='virtualSpacer' style='height:" + height + "px;'><td colspan='5'></td></tr>";
  let html = first > 0 ? spacer(first * DEC.ft8RowHeight) : "";
  for (let i = first; i < last; i++) html += mmdFt8Line(lines[i]);
  if (last < lines.length) html += spacer((lines.length - last) * DEC.ft8RowHeight);
  ft8Rows.innerHTML = html;
  ft8Empty.style.display = lines.length ? "none" : "";
  if (ft8Table.tHead) DEC.ft8HeaderHeight = ft8Table.tHead.getBoundingClientRect().height;
  let height = 0, count = 0;
  for (const row of ft8Rows.rows)
  {
    if (row.className == "virtualSpacer") continue;
    height += row.getBoundingClientRect().height;
    count++;
  }
  if (count > 0) DEC.ft8RowHeight = height / count;
}

// Scrolling or resizing: a redraw once the slice no longer covers the view (at most once a frame)
function mmdFt8Scrolled()
{
  if (DEC.ft8ScrollQueued) return;
  DEC.ft8ScrollQueued = true;
  window.requestAnimationFrame(() =>
  {
    DEC.ft8ScrollQueued = false;
    const { shownFirst, shownLast } = mmdFt8Range();
    if (shownFirst < DEC.ft8Slice.first || shownLast > DEC.ft8Slice.last) mmdFt8Render();
  });
}
