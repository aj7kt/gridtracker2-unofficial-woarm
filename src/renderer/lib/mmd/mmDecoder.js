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
// (A callsign: first.js's CALLSIGN_REGEXP)
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
// The modes there are (the Mode menu; each plugin's added as it loads, mmdPluginLoad)
const MMD_MODES = ["cw", "sstv", "wwv", "sat"];
// The Mode menu's last entry, Get More... (not a mode: picking it says where more decoders will come from, the mode stays)
const MMD_MORE = "_more";
// CW's signals (the worklet's channels) have ids under this; the other modes' signals in its list are above (a plugin's:
// MMD_PLUGIN_ID_BASE up, mmdPluginHost.js)
const MMD_CW_ID_MAX = 100000;
// (The modes whose list shows an SNR under 0, measured over a band wider than the signal's own filter: a plugin's in its registration's
// snrWide, MFSK's, DominoEX / THOR's, Olivia's)
// After the viewer tunes the rig, how long it waits for Rig Control to read the new frequency back (ms)
const CW_TUNE_SETTLE_MS = 2500;
// The rig read back within this of what BirdWatch's Doppler last sent VFO-A (Hz on the air; the rig may round it): its move, not a
// retune. It keeps a satellite's signal at the same pitch, so what was found goes on
const CW_DOPPLER_HZ = 200;
// ... of the last this many it sent
const CW_DOPPLER_STEPS = 4;
// The worklet's 12 kHz stream (its "ft8" stream, named for the mode it was made for: the audio12 input of WWV, SSTV and the plugins'
// modes, host.rate12): its rate
const FT8_RATE = 12000;
// The other modes' waterfall: a line on the UTC clock every so often (s: the window's UTC menu, 0 none; mmdPeriodRow)
const MMD_UTC_STEPS = [0, 10, 15, 30, 60];
// Time skew (a mode whose registration has skew: FT8's, FT4's): the wheel moves it this much a notch (ms), with Shift this much; the
// period last heard whole is decoded on the new timing once the wheel has rested this long (ms)
const MMD_SKEW_STEP_MS = 100;
const MMD_SKEW_BIG_MS = 1000;
const MMD_SKEW_SETTLE_MS = 600;
// The 12 kHz audio reaches the viewer about this long after it was heard (ms: measured against WSJT-X, whose DT came out this much less),
// so each sample is taken as heard this much earlier (host.heardAt)
const FT8_LATENCY_MS = 300;

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
  mode: "cw",     // what is decoded: "cw", "sstv", "sat" (Sat Data), "wwv" (WWV and WWVH) or a plugin's ("psk31", "rtty", "mfsk", "thor", "packet", "hell", "olivia", "ft8", "navtex" ...) (the Mode menu)
  shown: false,   // the window is showing (mmdVisible): listening, and the waterfall drawn; hidden, it listens all the same (mmdListen)
  bandFocus: 0,   // a mode with a focus (its registration's focusHalf: FT8's, FT4's): where it is (audio Hz), 0 none
  offTime: null,  // the time skew (a mode with skew: FT8's, FT4's), while it's on: { shift (ms) }
  brackets: null, // where the scale's [ and ] are drawn (canvas pixels: { left, right })
  dragging: null  // the bracket being dragged: "left" or "right"
};

function mmdInit()
{
  // The plugins' parts of the window and their modes (mmdPluginHost.js), before its strings are drawn
  mmdPluginsLoad();
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
    // A mode with a focus (FT8's, FT4's): over it, it can be dragged
    if (!DEC.focusDrag) cwOverlay.style.cursor = mmdFocusAt(event.offsetX) ? "ew-resize" : "";
    // Over an RSID of a mode decoded here, it can be clicked (mmdRsid.js)
    if (!DEC.focusDrag && !cwOverlay.style.cursor) mmdRsidHover(event.offsetX, event.offsetY);
  });
  cwOverlay.addEventListener("mouseleave", () => mmdHover("hoverFall", null));
  // The left button on the waterfall. CW, PSK31 and RTTY: a click on a signal pins it, on the pinned one lets it go. A mode with a focus
  // (its registration's focusHalf: FT8's, FT4's): pressed outside the focus puts it there, inside takes hold of it; held, it drags it along
  // the waterfall, kept where it is let go. Let go without moving, inside the focus: the focus lets go
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
    // Every mode without a focus: its own click (CW's and the keyboard modes' pin the signal there, Olivia's and Feld-Hell's look for
    // theirs there, Packet's locks on there: their registrations' tune, mmdPluginHost.js)
    if (!mmdFocusHalf())
    {
      mmdPluginActive("tune", hz);
      return;
    }
    if (hz == null) return;
    const inside = mmdFocusAt(event.offsetX);
    if (!inside)
    {
      DEC.bandFocus = Math.round(hz);
      mmdOverlay();
    }
    DEC.focusDrag = { offset: DEC.bandFocus - hz, x: event.clientX, moved: false, inside: inside };
    event.preventDefault();
  });
  window.addEventListener("mousemove", (event) =>
  {
    if (!DEC.focusDrag) return;
    // The button let go where the window didn't hear it (outside it): the drag is over
    const half = mmdFocusHalf();
    if (!(event.buttons & 1) || !half)
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
    DEC.bandFocus = Math.round(Math.min(span - half, Math.max(half, hz + DEC.focusDrag.offset)));
    mmdOverlay();
  });
  window.addEventListener("mouseup", (event) =>
  {
    if (!DEC.focusDrag || event.button != 0) return;
    if (!DEC.focusDrag.moved && DEC.focusDrag.inside) mmdBandFocusSet(0);
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
  // A mode with a time skew (FT8, FT4): a right-click on the waterfall turns it on or off, the wheel moves it while it's on
  // (mmdSkewWheel, before the tuning)
  cwScale.addEventListener("contextmenu", (event) => event.preventDefault());
  cwOverlay.addEventListener("contextmenu", (event) =>
  {
    event.preventDefault();
    if (mmdSkewMode()) mmdSkewToggle();
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
  // A click on a row: CW, PSK31 and RTTY, its signal pinned (the pinned one's: let go). Not when the mouse selected text in it (to copy)
  const selecting = () => String(window.getSelection()).length > 0;
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
    // (Log QSO... first, with Log QSO on: mmdLogQso.js)
    const menu = remote.Menu.buildFromTemplate(mmdLogQsoMenu(id).concat([{ label: I18N("cwViewer.picture.delete.label"), click: () => mmdSignalDelete(id) }]));
    menu.popup({ window: remote.getCurrentWindow() });
  });
  // The picture view (mmdPictures.js), the modes set up (their registrations' init: mmdPluginHost.js), the scope and Detect Modes
  mmdPicInit();
  mmdPluginsInit();
  mmdScopeInit();
  mmdDetectInit();
  cwMode.value = MMD_MODES.includes(GT.settings.MMD.viewMode) ? GT.settings.MMD.viewMode : "cw";
  cwMode.onchange = () =>
  {
    // Get More... (the menu's last): the mode stays, and a note says where more decoders will come from
    if (cwMode.value == MMD_MORE)
    {
      cwMode.value = DEC.mode;
      mmdGetMore();
      return;
    }
    mmdModeSet(cwMode.value);
    mmdTuneForMode();
  };
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
    if (hz) mmdTuneToFreq(hz, mode);
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

// Get More... in the Mode menu: the decoders to download for this version (mmdGetMore.js)
function mmdGetMore()
{
  mmdGetMoreOpen();
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

// Listening whenever the decoder is on (the main window's Settings), in every mode, shown or not: hidden, nothing is drawn (the waterfall,
// mmdFallRow), but every mode decodes as it does on screen, its decodes going on to GridTracker's instance MMD (services/mmDecoder.js:
// the map, and FT8's and FT4's the Call Roster with Send Decodes To Call Roster on), its pictures, charts and messages kept and saved as
// set. The main window is told whether it listens unseen (the button's green dot)
function mmdListen()
{
  const want = !!GT.settings.MMD.enable;
  if (want && !DEC.running) mmdStart();
  else if (!want && DEC.running) mmdStop();
  mmdInstanceSay();
}

// Listening in a mode whose decodes are the instance's (its registration's instance: FT8's, FT4's; host.instanceDecodes), on the map; in
// the Call Roster too with its Send Decodes To Call Roster on (services/mmDecoder.js)
function mmdInstanceMain()
{
  return DEC.running && mmdPluginFlag("instance") === true;
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
// window.opener.mmDecoderOutputFind), else the output on the same sound card as the input heard: on Windows the part of the names in
// brackets (an input "Microphone (USB Audio CODEC)" and an output "Speakers (USB Audio CODEC)"); else (Linux: PipeWire and PulseAudio
// name a card's input and output alike, without brackets, "USB Audio Device Analog Stereo") the output in the input's device group, else
// the one of its name; else null
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
  if (name)
  {
    // The device itself before Windows' "Default - " and "Communications - " names for it
    const same = outputs.filter((d) => card(d.label || "") == name);
    const found = same.find((d) => !/^(Default|Communications) - /.test(d.label || "")) || same[0];
    if (found) return found;
  }
  if (!DEC.input) return null;
  // A sound card's own output, not one of the system's aliases for the default
  const own = (d) => d.deviceId && d.deviceId != "default" && d.deviceId != "communications";
  if (DEC.input.groupId)
  {
    const group = outputs.find((d) => own(d) && d.groupId == DEC.input.groupId);
    if (group) return group;
  }
  return (input && outputs.find((d) => own(d) && d.label == input)) || null;
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
  nodeTimers.clearTimeout(MMD.levelHide);
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
  nodeTimers.clearTimeout(MMD.levelHide);
  MMD.levelHide = nodeTimers.setTimeout(() => mmdLevelPop(false), MMD_LEVEL_HIDE_MS);
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
  cwLevelPop.onmouseenter = () => nodeTimers.clearTimeout(MMD.levelHide);
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

// The status where it goes: FT8's, FT4's and WSPR's on the divider, left of their place in the period; an error (error true, or
// "warning" for one in the warning color), and the other modes', at the top right
function mmdStatusShow()
{
  const S = DEC.status || { text: "", error: false };
  const onSplit = !S.error && mmdPluginPeriodMs() > 0;
  const top = onSplit ? "" : S.text;
  const split = onSplit ? S.text : "";
  if (cwStatus.textContent != top) cwStatus.textContent = top;
  const className = S.error == "warning" ? "cwWarning" : S.error ? "cwError" : "";
  if (cwStatus.className != className) cwStatus.className = className;
  if (cwSplitStatus.textContent != split) cwSplitStatus.textContent = split;
}

async function mmdStart()
{
  if (DEC.running) return;
  const generation = ++DEC.generation;
  DEC.running = true;
  mmdStatus(I18N("cwViewer.status.starting"));
  // The modes hear the audio from here on (SSTV: a picture under way when it stopped can't go on: their registrations' start)
  mmdPluginsEach("start");
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
    // "interactive", not "playback": measured 2026-11-11 on an IC-7300's USB codec, every "playback" context (20 ms buffers) missed a
    // render callback together every 10 to 20 s, whatever it ran, and the input it held was lost (about 20 ms of audio each time: WWV's
    // timing stepped, every mode lost samples); "interactive" contexts beside them, the decoder's full worklet in one, lost none
    const options = { latencyHint: "interactive" };
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
        ctx = new AudioContext({ latencyHint: "interactive" });
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
  // The modes' own (FT8's and WSPR's periods, WWV's count of samples: their registrations' stop)
  mmdPluginsEach("stop");
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
    nodeTimers.setTimeout(mmDecoderRestart, 0);
    return;
  }
  // Copied into this window's own array, handed over
  const samples = new Float32Array(iq);
  DEC.spyNode.port.postMessage(samples, [samples.buffer]);
}

// Not connected yet: the start tried again in a moment, while it is still wanted and nothing else started meanwhile
function mmdSpyRetry(generation)
{
  nodeTimers.clearTimeout(DEC.spyRetry);
  DEC.spyRetry = nodeTimers.setTimeout(() =>
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
    // A mode of the 12 kHz audio: the worklet sends it (Detect Modes too, for SSTV and the plugins' detect decoders)
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
    // (else the mode's that decodes it: FT8's and FT4's, WSPR's, WWV's, SSTV's and WEFAX's)
    else if (mmdPluginInput() == "audio12") mmdPluginActive("audio", data);
    return;
  }
  // The input's own samples: RSID's (first: the mode's own worker is handed them), Packet's ...
  if (data.type == "rawaudio")
  {
    mmdRsidAudio(data);
    if (mmdDetectOn()) mmdDetectRawAudio(data);
    // (else the mode's that decodes it: Packet's, Sat Data's, the keyboard modes', Olivia's, Feld-Hell's)
    else if (mmdPluginInput() == "raw") mmdPluginActive("audio", data);
    return;
  }
  if (data.type != "row") return;
  // The mode's own look at the row before the waterfall has it (FT8's and FT4's Slot Finder: its registration's fallRow), only what was
  // heard since the last retune
  if (data.seq == DEC.seq) mmdPluginActive("fallRow", data.row);
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
        const before = Object.values(DEC.signals).find((signal) => signal.id < MMD_CW_ID_MAX && !signal.alive && signal.air != null && Math.abs(signal.air - air) < CW_SAME_SIGNAL_HZ);
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
    // Only CW's own: a plugin's (MMD_PLUGIN_ID_BASE up: PSK's, Olivia's, NAVTEX's) are their workers' to say (marked gone here with each
    // row, between their workers' word, they flickered)
    for (const id in DEC.signals) if (!seen[id] && Number(id) < MMD_CW_ID_MAX) DEC.signals[id].alive = false;
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
  // When its text began (Log QSO's time on: mmdLogQso.js), again after it was emptied (Delete)
  if (!signal.text && text) signal.firstAt = Date.now();
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
  // (the modes' views drawn again for their new size: their registrations' layout)
  mmdPluginsEach("layout");
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
  // Not drawn while the window is closed (the modes go on decoding)
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

// The main window's band names by whole MHz (from 1 MHz up its formatBand goes by the whole MHz only; under it, 630m and 2200m, by the
// frequency): asked once each, as the scope's guard bands ask for hundreds of frequencies at a time (mmdScopeGuards)
const MMD_BAND_NAMES = new Map();

function mmdBandOf(dial)
{
  if (!(dial > 0)) return "";
  const mhz = Math.floor(dial / 1e6);
  let band;
  if (mhz < 1) band = window.opener.formatBand(dial / 1e6) || "";
  else
  {
    if (!MMD_BAND_NAMES.has(mhz)) MMD_BAND_NAMES.set(mhz, window.opener.formatBand(dial / 1e6) || "");
    band = MMD_BAND_NAMES.get(mhz);
  }
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

// A mode decoded in periods (FT8's, FT4's, WSPR's: its registration's periodMs): where each period starts on the waterfall (rows ago,
// and its start), moved down with the rows drawn (drawn); drawn by mmdOverlay as a line with the period coming in labelled above it. The
// other modes: on the UTC clock as the UTC menu has it, the same way
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
  const shift = mmdSkewShift();
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
  // A mode decoded in periods: a mid-gray line where each period started, its UTC above it on the right (clear of a ] dimming the left or
  // right edge); orange, with the time skew in a box above it, where a skewed one started. The other modes: the same gray lines, on the
  // UTC menu's step
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
  // The mode's own marks under the RSIDs (SSTV's and WEFAX's tones), the RSIDs heard in every mode (mmdRsid.js), the mode's marks over
  // them (Olivia's band, Packet's HF signals and lock, Feld-Hell's band, WWV's carrier and pulses, FT8's and FT4's Slot Finder): their
  // registrations' drawBack and draw
  mmdPluginsEach("drawBack", ctx, x, ratio, w, h);
  mmdRsidDraw(ctx, x, ratio, w, h);
  mmdPluginsEach("draw", ctx, x, ratio, w, h);
  // Detect Modes: the signals found, named (mmdDetect.js)
  mmdDetectDraw(ctx, x, ratio, w, h);
  // A signal's guard lines (hovered, pinned) only in the modes that list signals (CW; a plugin's in CW's list, cwList: PSK31, RTTY,
  // Olivia) or hear them (a plugin's with signals: NAVTEX's stations): the others' waterfalls show none of CW's kept signals
  const listed = DEC.mode == "cw" || mmdPluginFlag("cwList") === true || mmdPluginSignals();
  const marks = listed ? [...new Set([DEC.hoverRow, DEC.hoverFall])].filter((id) => id != null && id !== DEC.focus).map((id) => [id, "154, 255, 154"]) : [];
  if (listed && DEC.focus != null) marks.push([DEC.focus, "255, 154, 154"]);
  // A mode with a focus (FT8's, FT4's): the place searched harder (light red, its focusHalf either side)
  const focusHalf = mmdFocusHalf();
  if (focusHalf && DEC.bandFocus) marks.push([null, "255, 154, 154", DEC.bandFocus]);
  for (const [id, rgb, at] of marks)
  {
    const signal = id == null ? null : DEC.signals[id];
    const hz = at || (signal ? mmdAudioOf(signal) : null);
    if (hz == null) continue;
    const a = x(hz - (at ? focusHalf : CW_GUARD_HZ));
    const b = x(hz + (at ? focusHalf : CW_GUARD_HZ));
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
  // A mode with ticks of its own (its registration's scaleMinorHz: FT8's and FT4's every 100 Hz), where they are 3 pixels apart or more
  const ownMinor = Number(mmdPluginFlag("scaleMinorHz")) || 0;
  const minorHz = ownMinor > 0 && majorHz % ownMinor == 0 && (ownMinor / span) * w >= 3 * ratio ? ownMinor : majorHz / 5;
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
  // The mode's own marks (FT8's and FT4's signals decoded lately: its registration's drawScale), drawn again when it says (ms)
  DEC.scaleUntil = Number(mmdPluginActive("drawScale", ctx, x, ratio, w, h)) || 0;
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
  // The rig's band scope: wanted (or not) of Rig Control, shown or hidden
  mmdScopeTick();
  // The modes' own (SSTV Send's Power, WEFAX's Auto-Tune, NAVTEX's list, WWV's view: their registrations' tick)
  mmdPluginsEach("tick");
  // Log QSO's buttons, shown where they can be used (mmdLogQso.js)
  mmdLogQsoTick();
  // Detect Modes: its signals found, listed and labelled
  mmdDetectTick();
  // The mode's scale marks due to be drawn again (drawScale)
  if (DEC.scaleUntil && Date.now() >= DEC.scaleUntil) DEC.dirty = true;
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
    // Its signal over the noise as last measured (dB, in its own filter). MFSK's (over its 16 tones), DominoEX / THOR's and Olivia's
    // (in 2500 Hz, as WSJT-X's) are mostly under 0: shown down to their floor (-30, too weak to measure) once their worker has measured
    // one (snrSeen: a signal made by its text first has the 0 it starts with)
    const snrWide = mmdPluginFlag("snrWide");
    const wide = Array.isArray(snrWide) && snrWide.includes(DEC.mode);
    const db = (wide ? signal.snrSeen === true && signal.snr > -30 : signal.snr > 0) ? String(Math.round(signal.snr)) : "";
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
    cwFreqs.replaceChildren();
    const off = new Option("-", "");
    off.hidden = true;
    cwFreqs.add(off);
    // (WEFAX's and NAVTEX's as (frequency) and their station, no band: theirs are outside the amateur bands; the others as band (frequency)
    // and their note: Calling, DXpedition (Fox/Hound), IARU R3 ...)
    const notes = BANDS_NOTE_MODES.includes(DEC.mode);
    const options = list.map(([hz, , note], i) => new Option((notes ? "(" + mmdFreq(hz) + ")" : mmdBandFreq(hz)) + (note ? " " + note : ""), i));
    // A mode's grouped by the station's location (BANDS_PLACE_MODES, WEFAX's: its note after the call sign, "NMC Point Reyes, CA (8682)"),
    // the locations in alphabetical order, each one's frequencies lowest first; one with no location stays above the groups
    if (BANDS_PLACE_MODES.includes(DEC.mode))
    {
      const groups = new Map();
      list.forEach(([, , note], i) =>
      {
        const place = note.replace(/^\S+\s+/, "").split(" (")[0].trim();
        if (!note.includes(" ") || !place) cwFreqs.add(options[i]);
        else
        {
          if (!groups.has(place)) groups.set(place, []);
          groups.get(place).push(options[i]);
        }
      });
      for (const place of [...groups.keys()].sort((a, b) => a.localeCompare(b)))
      {
        const group = document.createElement("optgroup");
        group.label = place;
        group.append(...groups.get(place));
        cwFreqs.appendChild(group);
      }
    }
    else options.forEach((option) => cwFreqs.add(option));
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
  // Every mode's own lists and pictures (their registrations' clear)
  mmdPluginsEach("clear");
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
  // The modes told (HF packet is looked for between them too: their registrations' range)
  mmdPluginsEach("range");
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
// A mode decoded in periods doesn't decode the audio heard so far with what comes after (a period heard partly on 20m and partly on 40m
// would give 20m's signals as 40m's: FT8's, WSPR's retune). SSTV: a picture coming in ends here (it is kept as far as it got). The
// waterfall stays (slid across where the dial moved: mmdFallShift). keepSkew: Clear's, the time skew left on
function mmdRetune(keepSkew = false)
{
  DEC.seq++;
  if (DEC.node) DEC.node.port.postMessage({ type: "retune", seq: DEC.seq });
  // The time skew off: it was the station's on that frequency
  if (!keepSkew) mmdOffTimeStop(false);
  // The modes told (FT8's and WSPR's period under way not decoded, Slot Finder starting again on what is heard here, the mode showing
  // listening afresh: their registrations' retune)
  mmdPluginsEach("retune");
  mmdRsidReset();
  for (const id in DEC.signals) DEC.signals[id].alive = false;
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
// times as far, Ctrl: a tenth), counted from where it was last sent while the rig hasn't caught up yet (DEC.expect). Not while the time
// skew is on (FT8's, FT4's): the wheel moves that (mmdSkewWheel)
const MMD_WHEEL_HZ = 10;

function mmdTuneWheel(event)
{
  const S = GT.settings.MMD;
  if (S.tuneLocked !== false || S.rigControl !== true || window.opener.mmDecoderRigLocked() || !event.deltaY) return;
  if (DEC.offTime && mmdSkewMode()) return;
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
  nodeTimers.clearTimeout(el.toastTimer);
  el.toastTimer = nodeTimers.setTimeout(() =>
  {
    el.style.transition = "opacity " + MMD_TOAST_FADE_MS + "ms";
    el.style.opacity = "0";
    el.toastTimer = nodeTimers.setTimeout(() =>
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

// One of the mode's frequencies (the Frequency menu's: Hz, its rig mode) tuned to as the mode allows (Settings: Rig Control, then the
// mode's Set Frequency and Set Mode, each on its own): the frequency, the mode (CW's CW, SSTV's the frequency's sideband, FT8's USB ...;
// USB and LSB as the data mode with the VFO's SSB Data, Rig Control), both, or nothing
function mmdTuneToFreq(hz, mode)
{
  const S = GT.settings.MMD;
  const setFreq = S.rigControl === true && S[DEC.mode + "SetFreq"] === true;
  const setMode = S.rigControl === true && S[DEC.mode + "SetMode"] === true;
  if (!setFreq && !setMode) return;
  // Picked here: a bar on the waterfall even within the band (another band's goes on as the rig is tuned, mmdBandFollow)
  const band = mmdBandOf(hz);
  if (setFreq && band && band == (DEC.band || mmdBandOf(mmdDial())) && hz != mmdDial()) mmdBandMark(band, hz);
  const vfo = window.opener.mmDecoderVfo();
  mmdTuneDial(setFreq ? hz : null, setMode ? mode : null, ["USB", "LSB"].includes(mode) ? !!vfo && vfo.ssbData === true : undefined);
}

// A mode picked in the Mode menu with its Set Frequency on: the rig tuned to the mode's main frequency on the band it's on (Band Plans'
// Main: FT8's 14.074 on 20m, not its DXpedition one), else its nearest there; with none on that band, the band of its nearest
// frequency, its main one there the same way (and the rig's mode set, with Set Mode). Already on one of the mode's frequencies: left
// there. Not for a mode picked any other way (an RSID, Detect Modes, Follow BirdWatch): the signal is where the rig is
function mmdTuneForMode()
{
  const S = GT.settings.MMD;
  if (S.rigControl !== true || S[DEC.mode + "SetFreq"] !== true || window.opener.mmDecoderRigLocked()) return;
  const list = mmdBandFreqs(DEC.mode);
  const dial = mmdDial();
  if (!list || dial == null) return;
  if (list.some(([hz]) => Math.abs(hz - dial) < 5)) return;
  const nearest = (l) => l.reduce((a, b) => (Math.abs(b[0] - dial) < Math.abs(a[0] - dial) ? b : a));
  // (out of the bands, "OOB", is no band)
  const onBand = (band) => (band && band != "OOB" ? list.filter(([hz]) => mmdBandOf(hz) == band) : []);
  let pick = onBand(mmdBandOf(dial));
  if (!pick.length)
  {
    const near = nearest(list);
    pick = onBand(mmdBandOf(near[0]));
    if (!pick.length) pick = [near];
  }
  const [hz, mode] = pick.find((f) => f[3]) || nearest(pick);
  mmdTuneToFreq(hz, mode);
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

// ---- The mode: each one's list, view or pictures in the CW lines' place (its registration's shown), the waterfall going on as in CW
// mode

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
    DEC.bandFocus = 0;
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
  // CW's list: CW's, and a plugin's with cwList (the keyboard modes', Olivia's)
  const listed = DEC.mode == "cw" || mmdPluginFlag("cwList") === true;
  mmdListRefresh();
  // The last mode's status (FT8's decodes, Packet's frames ...) gone
  if (DEC.running) mmdStatus(I18N("cwViewer.status.listening"));
  cwList.style.display = listed ? "" : "none";
  // Every mode's own lists, views and bars shown, or hidden (their registrations' shown, mmdPluginHost.js: FT8's and FT4's list and Slot
  // Finder, NAVTEX's list, SSTV's view and Send, WEFAX's bar, Sat Data's, WSPR's, Packet's lists, WWV's and Feld-Hell's views, the submode
  // menus)
  const active = mmdPluginOf();
  for (const def of MMD_PLUGINS.list) mmdPluginCall(def, "shown", def === active);
  // The picture view, in a mode with pictures (SSTV's, a plugin's: WEFAX's), after them all (mmdPictures.js)
  mmdPicShowView();
  // (the lines of a mode decoded in periods, FT8's, FT4's and WSPR's, are its periods': no UTC menu)
  cwUtcBox.style.display = mmdPluginPeriodMs() > 0 ? "none" : "";
  // The submode menus' row (the plugins' subBar items: PSK's, Olivia's, Feld-Hell's), while one of them is shown
  cwSubBar.style.display = [...cwSubBar.children].some((box) => box.style.display != "none") ? "" : "none";
  mmdFreqsShow(mmdDial() != null);
  // This mode's Input Device (the decoder started again on it, if it was listening to another)
  mmdInputs();
  // The mode listens afresh (its lists kept; FT8's periods from the next; SSTV's saved pictures in its strip the first time: its
  // registration's entered)
  mmdPluginActive("entered");
  if (DEC.node)
  {
    DEC.node.port.postMessage({ type: "ft8", on: mmdFt8StreamWanted() });
    DEC.node.port.postMessage({ type: "raw", on: mmdRawMode() || mmdRsidOn() });
    // CW decoded in CW mode only: the other modes decode their own audio, so the CW engine makes the waterfall's rows alone (back in
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
  // The GridTracker instance follows the mode (services/mmDecoder.js)
  mmdListen();
}

// CW's list, as the mode (and a plugin's submode: its registration's listKey) is now: shared by CW's signals and those of the plugins'
// modes with cwList (the keyboard modes', Olivia's), another's signals go when they change (a plugin's with signals too: NAVTEX's
// stations, in its own list); the WPM column their baud; the empty list's "No CW decoded yet" names the mode (PSK63, DominoEX 11 ...: its
// listName)
function mmdListRefresh()
{
  const cwList = (mode) => mmdPluginFlag("cwList", mode) === true;
  const own = (mode) => cwList(mode) || mmdPluginSignals(mode);
  const key = DEC.mode + "|" + (mmdPluginActive("listKey") || "");
  if (DEC.listedKey != null && DEC.listedKey != key && (own(DEC.mode) || own(DEC.listedMode)))
  {
    DEC.signals = {};
    DEC.focus = null;
    cwRows.innerHTML = "";
    DEC.dirty = true;
  }
  DEC.listedKey = key;
  DEC.listedMode = DEC.mode;
  cwWpmHead.textContent = I18N(cwList(DEC.mode) ? "cwViewer.packet.header.baud" : "cwViewer.header.wpm");
  cwEmpty.textContent = I18N("cwViewer.empty").replace("CW", (cwList(DEC.mode) && mmdPluginActive("listName")) || "CW");
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
  // (a mode not here: one of a plugin not installed, or turned off, FT8's ...: left as it is)
  if (!followed || !followed.mode || followed.mode == DEC.mode || !MMD_MODES.includes(followed.mode)) return;
  cwMode.value = followed.mode;
  mmdModeSet(followed.mode);
}
// The modes decoded from the input's own samples (the worklet's raw stream): Sat Data, a plugin's (Packet, the keyboard modes, Olivia
// and Feld-Hell): their registrations' input "raw", mmdPluginHost.js
function mmdRawMode(mode = DEC.mode)
{
  return mmdPluginInput(mode) == "raw";
}

// The worklet's 12 kHz stream: WWV's, SSTV's and the plugins' modes' (FT8's, FT4's, WSPR's, WEFAX's: their registrations' input "audio12")
function mmdFt8StreamWanted()
{
  return mmdPluginInput() == "audio12";
}

// The other modes' UTC lines: every this many seconds (the UTC menu, 30 unless set), 0 none
function mmdUtcStep()
{
  const step = GT.settings.MMD.utcLines;
  return MMD_UTC_STEPS.includes(step) ? step : 30;
}

// A mode decoded in periods (FT8, FT4 and WSPR), while listening: how far into its period the decoder is, at the divider's right,
// "[ s / period ]" (the seconds padded to the period's width, so the bracket stays put); else nothing
function mmdPeriodProgress()
{
  let text = "";
  if (DEC.running && mmdPluginPeriodMs() > 0)
  {
    const periodMs = mmdPeriodMs();
    // (FT8's and FT4's periods shifted by the time skew: their registration's periodShift)
    const shift = Number(mmdPluginActive("periodShift")) || 0;
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
  return mmdPluginPeriodMs() || mmdUtcStep() * 1000;
}

// ---- Time skew (a mode whose registration has skew: FT8's, FT4's): for a station whose clock is off (a DXpedition's with no time
// source), its periods starting seconds from everyone else's. A right-click on the waterfall turns it on (+0.0 s) or off; while it's on,
// the wheel moves it, the period lines are orange where the skewed periods start, the skew shown above each, and every period is decoded
// on that timing (its registration's skewAlign; stations on time no longer are, as expected)

// Whether the mode showing's periods can be skewed
function mmdSkewMode()
{
  return mmdPluginFlag("skew") === true;
}

// The skew (ms, either way), 0 while it's off
function mmdSkewShift()
{
  return DEC.offTime ? DEC.offTime.shift : 0;
}

// On at the mode's skew as last set this session (DEC.skewKept; 0 at first, and again after a restart), or off (kept for next time)
function mmdSkewToggle()
{
  if (DEC.offTime) mmdOffTimeStop();
  else
  {
    DEC.offTime = { shift: Math.round(mmdOffTimeShiftOf((DEC.skewKept || {})[DEC.mode] || 0, mmdPeriodMs())) };
    mmdSkewMoved();
  }
}

// As the skew is shown: +4.3 s
function mmdSkewText(shift)
{
  return (shift >= 0 ? "+" : "-") + (Math.abs(shift) / 1000).toFixed(1) + " s";
}

// The wheel on the waterfall while the skew is on: up later, down earlier, MMD_SKEW_STEP_MS a notch (MMD_SKEW_BIG_MS with Shift), round
// past half a period either way
function mmdSkewWheel(event)
{
  if (!DEC.offTime || !mmdSkewMode()) return;
  event.preventDefault();
  const step = (event.shiftKey ? MMD_SKEW_BIG_MS : MMD_SKEW_STEP_MS) * (event.deltaY < 0 ? 1 : -1);
  DEC.offTime.shift = Math.round(mmdOffTimeShiftOf(DEC.offTime.shift + step, mmdPeriodMs()) / MMD_SKEW_STEP_MS) * MMD_SKEW_STEP_MS;
  // Kept as the mode's for the session (turned on again, it comes back here)
  DEC.skewKept = DEC.skewKept || {};
  DEC.skewKept[DEC.mode] = DEC.offTime.shift;
  mmdSkewMoved();
}

// The skew turned on or moved: its lines redrawn at once, and the period last heard whole decoded on it once the wheel has rested
// (MMD_SKEW_SETTLE_MS)
function mmdSkewMoved()
{
  if (DEC.periodMarks) DEC.periodMarks = DEC.periodMarks.filter((m) => !m.off);
  mmdOffTimeMarks();
  mmdOverlay();
  if (DEC.skewTimer) nodeTimers.clearTimeout(DEC.skewTimer);
  DEC.skewTimer = nodeTimers.setTimeout(() =>
  {
    DEC.skewTimer = null;
    if (DEC.offTime && mmdSkewMode()) mmdOffTimeAlign(true);
  }, MMD_SKEW_SETTLE_MS);
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

// The periods decoded moved to the timing now (mmdSkewShift): the mode's own (its registration's skewAlign: the last one heard whole is
// decoded next, not one decoded already; not back, the rig moved, the one under way), then the period lines
function mmdOffTimeAlign(back = true)
{
  mmdPluginActive("skewAlign", back);
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
  const shift = mmdSkewShift();
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
  if (mmdSkewMode()) mmdOffTimeAlign(back);
  else mmdOffTimeMarks();
  mmdOverlay();
}

// ---- The focus (a mode whose registration has focusHalf: FT8's, FT4's): a place on the waterfall its decoder searches harder, put by
// the left button there (dragged while held), or a click on one of its rows (host.bandFocusSet)

// Its half-width (Hz) in the mode showing, 0 in a mode with none
function mmdFocusHalf()
{
  return Number(mmdPluginFlag("focusHalf")) || 0;
}

// Whether the waterfall's x (CSS pixels) is inside the focus
function mmdFocusAt(offsetX)
{
  const half = mmdFocusHalf();
  if (!half || !DEC.bandFocus) return false;
  const hz = mmdAudioAt(offsetX / cwOverlay.clientWidth);
  return hz != null && Math.abs(hz - DEC.bandFocus) <= half;
}

// The focus put at hz (audio Hz; inside it again, or 0, lets it go)
function mmdBandFocusSet(hz)
{
  const half = mmdFocusHalf();
  DEC.bandFocus = !hz || !half || (DEC.bandFocus && Math.abs(DEC.bandFocus - hz) < half) ? 0 : Math.round(hz);
  mmdOverlay();
}

// CW in the decoder's mode registry (mmdPluginHost.js): the mode still built into this file, the worklet's own decoder (no input of its
// own)
mmdRegisterMode({
  id: "cw",
  name: "CW",
  modes: ["cw"],
  // (a click: the signal there pinned)
  tune: (hz) => mmdFocus(mmdSignalNear(hz))
});
