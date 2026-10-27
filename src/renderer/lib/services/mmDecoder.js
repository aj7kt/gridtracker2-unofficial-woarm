// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// Multi-Mode Decoder (Settings -> Features -> Service): every CW signal (or FT8) in the receiver's passband decoded, in its window
// (gt_mmdecoder.html, lib/mmd/mmDecoder.js). The audio is the Input Device's (Settings -> Audio); it is only opened while the window is
// showing, and decoded there (an AudioWorklet running cwdecoder.wasm), so nothing of it runs in the main window. Here: the setting,
// the Toggle Multi-Mode Decoder button, the window, and the rig's wide filter through Rig Control

GT.mmDecoderHandle = null;
GT.mmDecoderInitialized = false;
GT.mmDecoderShowPending = false;
// The wide filter (mmDecoderWideFollow): wanted while the Multi-Mode Decoder decodes; each mode's filter as it was before it was widened, by mode
// ({ CW: 9 } a CI-V width, { USB: 2400 } a rigctld passband), put back when the rig is next in that mode; a mode being asked about
GT.cwWideOn = false;
GT.cwWideSaved = {};
GT.cwWideAsking = null;

// The CI-V filter width asked for: 40, the widest (3.6 kHz in CW and SSB on the IC-7300, 705, 9700, 7610)
const CW_CIV_WIDEST = 40;
const CW_RIGCTLD_WIDEST = 3600;
// The modes whose filter can be widened for the decoder (CW heard as tones; SSB hears CW too, as tones at the carrier's offset)
const CW_WIDE_MODES = ["CW", "CW-R", "USB", "LSB"];

function mmDecoderInit()
{
  if (!GT.settings.cwDecoder) GT.settings.cwDecoder = { enable: false, wideFilter: true, scanDwell: 10, span: 4000, minHz: 250, maxHz: 0 };
  if (!(GT.settings.cwDecoder.cwFallSpeed > 0)) GT.settings.cwDecoder.cwFallSpeed = 1;
  if (!(GT.settings.cwDecoder.ft8FallSpeed > 0)) GT.settings.cwDecoder.ft8FallSpeed = 1;
  mmDecoderRender();
  // Made hidden at startup like the other windows, so the main process puts it where it was (and shows it, if it was open at exit)
  if (GT.settings.cwDecoder.enable) mmDecoderOpen(false);
  nodeTimers.setInterval(mmDecoderWideFollow, 1000);
  nodeTimers.setInterval(mmDecoderAskStep, CW_STEP_ASK_MS);
}

// The rig's tuning step (the Multi-Mode Decoder's mouse wheel tunes by it), asked again every few seconds while the viewer decodes, so a step
// changed on the rig (TS) is followed: an Icom over CI-V (10) or rigctld (n). Not before a CI-V rig is known to answer (an NG back would
// be read as it having no second VFO: rig.js)
const CW_STEP_ASK_MS = 4000;

function mmDecoderAskStep()
{
  if (!mmDecoderRunning()) return;
  const kind = mmDecoderWideKind();
  const R = GT.rig;
  if (kind == "civ" && R.dual !== null) rigWrite(R, rigCivFrame(rigCivAddress(R), 0x10));
  else if (kind == "rigctld") rigWrite(R, "+n\n");
}

// The rig's tuning step in Hz, null when it isn't known (or Rig Control can't ask it)
function mmDecoderTuningStep()
{
  return mmDecoderWideKind() && GT.rig.tuningStep > 0 ? GT.rig.tuningStep : null;
}

function mmDecoderRender()
{
  mmDecoderEnable.checked = GT.settings.cwDecoder.enable;
  mmDecoderWide.checked = GT.settings.cwDecoder.wideFilter;
  for (const [slider, key] of [[cwFallSpeed, "cwFallSpeed"], [ft8FallSpeed, "ft8FallSpeed"]])
  {
    slider.value = GT.settings.cwDecoder[key];
    window[slider.id + "Td"].textContent = GT.settings.cwDecoder[key] + "×";
  }
  mmDecoderBoxTr.style.display = GT.settings.cwDecoder.enable ? "" : "none";
  mmDecoderButton.style.display = GT.settings.cwDecoder.enable ? "" : "none";
}

function mmDecoderEnableChanged()
{
  GT.settings.cwDecoder.enable = mmDecoderEnable.checked;
  mmDecoderRender();
  // Off: the window is hidden, which stops its audio (and puts the filter back)
  if (!GT.settings.cwDecoder.enable && GT.mmDecoderInitialized) electron.ipcRenderer.send("hideWin", "gt_mmdecoder");
}

// Waterfall Speed, CW's and FT8's: the window reads them as it draws each row
function mmDecoderFallSpeedChanged()
{
  GT.settings.cwDecoder.cwFallSpeed = Number(cwFallSpeed.value);
  GT.settings.cwDecoder.ft8FallSpeed = Number(ft8FallSpeed.value);
  mmDecoderRender();
}

function mmDecoderWideChanged()
{
  GT.settings.cwDecoder.wideFilter = mmDecoderWide.checked;
  mmDecoderWideSet(GT.settings.cwDecoder.wideFilter && mmDecoderRunning());
}

// The Input Device was changed (Settings -> Audio): a Multi-Mode Decoder that is listening starts again with it
function mmDecoderInputChanged()
{
  try
  {
    if (GT.mmDecoderInitialized && GT.mmDecoderHandle.window.mmDecoderRestart) GT.mmDecoderHandle.window.mmDecoderRestart();
  }
  catch (e)
  {
    // The window is going away
  }
}

function mmDecoderRunning()
{
  try
  {
    return GT.mmDecoderInitialized && GT.mmDecoderHandle.window.mmDecoderIsRunning();
  }
  catch (e)
  {
    return false;
  }
}

// ---- The window

function mmDecoderOpen(show = true)
{
  if (GT.mmDecoderHandle == null)
  {
    // The page tells when it is ready (mmDecoderReady)
    GT.mmDecoderShowPending = show;
    GT.mmDecoderHandle = window.open("gt_mmdecoder.html", "gt_mmdecoder");
  }
  else if (GT.mmDecoderInitialized)
  {
    electron.ipcRenderer.send(show ? "showWin" : "hideWin", "gt_mmdecoder");
  }
  else if (show) GT.mmDecoderShowPending = true;
}

function mmDecoderReady()
{
  GT.mmDecoderInitialized = true;
  if (!GT.mmDecoderShowPending) return;
  GT.mmDecoderShowPending = false;
  electron.ipcRenderer.send("showWin", "gt_mmdecoder");
}

// The Toggle Multi-Mode Decoder button
function toggleMmDecoder()
{
  if (!GT.settings.cwDecoder.enable) return;
  if (!GT.mmDecoderInitialized)
  {
    mmDecoderOpen(true);
    return;
  }
  electron.ipcRenderer.send("toggleWin", "gt_mmdecoder");
}

// ---- The wide filter: wanted from the Multi-Mode Decoder as it starts decoding (true) and not as it stops (false), and when the setting changes.
// Rig Control's VFO-A rig, an Icom over CI-V (its filter's width, 1A 03) or rigctld (the mode's passband); other protocols are left as
// they are. The rig keeps a filter for each mode, so each CW or SSB mode it is in while decoding is widened, its own filter kept first;
// each is put back once decoding stops, as soon as the rig is in that mode again (at once for the mode it is in)

// Whether the rig can be widened (and is connected): "civ", "rigctld" or null
function mmDecoderWideKind()
{
  const R = GT.rig;
  if (!R || R.status != "connected" || !R.protocol) return null;
  const protocol = GT.settings.rig.protocol;
  if (protocol == "civ" || protocol == "rigctld") return protocol;
  return null;
}

function mmDecoderWideSet(on)
{
  GT.cwWideOn = on && GT.settings.cwDecoder.wideFilter;
  mmDecoderWideFollow();
}

function mmDecoderCivWidth(R, width)
{
  rigWrite(R, rigCivFrame(rigCivAddress(R), 0x1a, [0x03, (Math.floor(width / 10) << 4) | (width % 10)]));
}

// Every second, and as decoding starts and stops: the mode the rig is in widened (wanted) or put back (not wanted, and widened before)
function mmDecoderWideFollow()
{
  const kind = mmDecoderWideKind();
  if (!kind || GT.cwWideAsking) return;
  const R = GT.rig;
  const mode = R.mode;
  if (!GT.cwWideOn)
  {
    if (!(mode in GT.cwWideSaved)) return;
    const saved = GT.cwWideSaved[mode];
    delete GT.cwWideSaved[mode];
    if (kind == "civ") mmDecoderCivWidth(R, saved);
    else rigWrite(R, "+M " + mode + " " + saved + "\n");
    return;
  }
  if (!CW_WIDE_MODES.includes(mode) || mode in GT.cwWideSaved) return;
  if (kind == "civ")
  {
    // The width as it is first (and the CW pitch, for the viewer's frequencies), then the widest once it has answered. A rig not known to
    // have a second VFO yet isn't asked: an NG back would be read as it not having one (rig.js)
    if (R.dual === null) return;
    R.filterWidth = null;
    GT.cwWideAsking = mode;
    rigWrite(R, rigCivFrame(rigCivAddress(R), 0x1a, [0x03]));
    rigWrite(R, rigCivFrame(rigCivAddress(R), 0x14, [0x09]));
    nodeTimers.setTimeout(() =>
    {
      GT.cwWideAsking = null;
      // Still in the mode asked about (its answer is that mode's filter), and still wanted
      if (R.status != "connected" || R.filterWidth == null || R.mode != mode || !GT.cwWideOn) return;
      GT.cwWideSaved[mode] = R.filterWidth;
      if (R.filterWidth != CW_CIV_WIDEST) mmDecoderCivWidth(R, CW_CIV_WIDEST);
    }, 800);
  }
  else
  {
    // The passband comes with the mode, read every second
    if (!(R.passband > 0)) return;
    GT.cwWideSaved[mode] = R.passband;
    if (R.passband < CW_RIGCTLD_WIDEST) rigWrite(R, "+M " + mode + " " + CW_RIGCTLD_WIDEST + "\n");
  }
}

// The viewer's line about the filter: "on", "off" (the setting), "none" (the rig can't, or isn't connected), "mode" (not a CW or SSB
// mode), "pending" (being asked)
function mmDecoderWideState()
{
  if (!GT.settings.cwDecoder.wideFilter) return "off";
  if (!mmDecoderWideKind()) return "none";
  if (!CW_WIDE_MODES.includes(GT.rig.mode)) return "mode";
  return GT.cwWideOn && GT.rig.mode in GT.cwWideSaved ? "on" : "pending";
}

// An audio frequency in the receiver's passband as the frequency on the air (Hz), from Rig Control's VFO-A: USB adds it to the dial, LSB
// takes it off; in CW the dial is the frequency heard at the CW pitch (CW-R the other way). Null without a connected rig, or in another mode
function mmDecoderAirHz(audioHz)
{
  const R = GT.rig;
  if (!R || R.status != "connected" || !(R.freq > 0)) return null;
  const dial = R.freq - rigOffset("a");
  const pitch = R.cwPitch || 600;
  switch (R.mode)
  {
    case "USB":
    case "PKTUSB":
    case "USB-D":
      return dial + audioHz;
    case "LSB":
    case "PKTLSB":
    case "LSB-D":
      return dial - audioHz;
    case "CW":
      return dial + audioHz - pitch;
    case "CW-R":
    case "CWR":
      return dial - (audioHz - pitch);
    default:
      return null;
  }
}
