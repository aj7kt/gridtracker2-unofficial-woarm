// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// Multi-Mode Decoder (Settings -> Features -> Service): every CW signal (or FT8) in the receiver's passband decoded, in its window
// (gt_mmdecoder.html, lib/mmd/mmDecoder.js). The audio is the mode's Input Device's (the window's menu); it is only opened while the window is
// showing, and decoded there (an AudioWorklet running cwdecoder.wasm), so nothing of it runs in the main window. Here: the setting,
// the Toggle Multi-Mode Decoder button, the window, and its rigs through Rig Control

GT.mmDecoderHandle = null;
GT.mmDecoderInitialized = false;
GT.mmDecoderShowPending = false;
// Follow BirdWatch's VFO (mmDecoderFollowVfoSync): the id of BirdWatch's downlink VFO while every mode reads it, else null
GT.mmdFollowVfo = null;

function mmDecoderInit()
{
  if (!GT.settings.MMD) GT.settings.MMD = { enable: false, span: 4000, minHz: 250, maxHz: 0 };
  // The band scan's seconds at each step, and the CW decoder's Wide Filter, from before they were taken out
  delete GT.settings.MMD.scanDwell;
  delete GT.settings.MMD.wideFilter;
  // One Waterfall Speed for every decoder: at first the one the mode shown had (each mode had its own before), then the modes' let go
  if (!(GT.settings.MMD.fallSpeed > 0))
  {
    const was = Number(GT.settings.MMD[(GT.settings.MMD.viewMode || "cw") + "FallSpeed"]);
    GT.settings.MMD.fallSpeed = was > 0 ? was : 1;
  }
  for (const mode of ["cw", "ft8", "ft4", "sstv", "packet", "sat", "psk31", "rtty", "olivia"]) delete GT.settings.MMD[mode + "FallSpeed"];
  if (!["normal", "deep"].includes(GT.settings.MMD.ft8Depth)) GT.settings.MMD.ft8Depth = "normal";
  // FT8's and FT4's time skew, from when it was kept as a setting (it's kept for the session only now: the window's DEC.skewKept)
  delete GT.settings.MMD.ft8Skew;
  delete GT.settings.MMD.ft4Skew;
  // Nothing is sent to the rig unless Rig Control (the window's Settings, Decoders) is turned on; each mode's Set Frequency and Set Mode
  // (Decoders) are on unless turned off
  if (typeof GT.settings.MMD.rigControl != "boolean") GT.settings.MMD.rigControl = false;
  for (const key of ["ft8SetMode", "ft4SetMode", "cwSetMode", "sstvSetMode", "packetSetMode", "psk31SetMode", "rttySetMode", "ft8SetFreq", "ft4SetFreq", "cwSetFreq", "sstvSetFreq", "packetSetFreq", "psk31SetFreq", "rttySetFreq"])
  {
    if (typeof GT.settings.MMD[key] != "boolean") GT.settings.MMD[key] = true;
  }
  // FT8's USB or Data and SSB's Enable Data, from before (now each VFO's SSB Data, Rig Control): one that was on taken up by the FT8
  // mode's VFO
  if (GT.settings.MMD.ssbData === true || GT.settings.MMD.ft8Data === true)
  {
    const v = rigVfoById((GT.settings.MMD.vfos || {}).ft8) || rigVfos()[0];
    if (v) v.ssbData = true;
  }
  delete GT.settings.MMD.ssbData;
  delete GT.settings.MMD.ft8Data;
  // FT8's or FT4's decodes to GridTracker as an instance, "MMD" (mmDecoderInstanceTick): off unless turned on, and one of the two at most
  if (typeof GT.settings.MMD.ft8Instance != "boolean") GT.settings.MMD.ft8Instance = false;
  if (typeof GT.settings.MMD.ft4Instance != "boolean") GT.settings.MMD.ft4Instance = false;
  if (GT.settings.MMD.ft8Instance) GT.settings.MMD.ft4Instance = false;
  if (!GT.settings.MMD.vfos || typeof GT.settings.MMD.vfos != "object") GT.settings.MMD.vfos = {};
  // Common VFO, new: None until one is picked (no rig read or tuned before the user says which)
  const vfos = GT.settings.MMD.vfos;
  if (!("common" in vfos)) vfos.common = "";
  mmDecoderRender();
  // Made hidden at startup like the other windows, so the main process puts it where it was (and shows it, if it was open at exit)
  if (GT.settings.MMD.enable) mmDecoderOpen(false);
  nodeTimers.setInterval(mmDecoderFollowVfoSync, 1000);
  nodeTimers.setInterval(mmDecoderInstanceTick, 1000);
}

function mmDecoderRender()
{
  mmDecoderEnable.checked = GT.settings.MMD.enable;
  mmDecoderButton.style.display = GT.settings.MMD.enable ? "" : "none";
}

function mmDecoderEnableChanged()
{
  GT.settings.MMD.enable = mmDecoderEnable.checked;
  mmDecoderRender();
  // On with its FT8 or FT4 instance on: the window loaded (hidden) if it isn't yet, or told, so that mode is decoded for the instance whatever
  // the window shows (as at startup)
  if (GT.settings.MMD.enable && mmDecoderInstanceMode())
  {
    if (GT.mmDecoderHandle == null) mmDecoderOpen(false);
    else if (GT.mmDecoderInitialized)
    {
      try
      {
        GT.mmDecoderHandle.window.mmdListen();
      }
      catch (e)
      {
        // Not loaded: it listens as it loads
      }
    }
  }
  // Off: the window is hidden and stops its audio, even with its instance on (and puts the filter back)
  if (!GT.settings.MMD.enable && GT.mmDecoderInitialized)
  {
    electron.ipcRenderer.send("hideWin", "gt_mmdecoder");
    try
    {
      GT.mmDecoderHandle.window.mmdListen();
    }
    catch (e)
    {
      // Not loaded: not listening
    }
  }
}

// The decoders' own settings are in the window's Settings panel (lib/mmd/mmdSettings.js)

// The SSTV Decoder's Save Pictures folder: the one chosen, else "SSTV Pictures" beside GridTracker's own folders (as Backup Logs)
function mmDecoderSstvFolder()
{
  return GT.settings.MMD.sstvFolder || path.join(path.dirname(GT.appData), "SSTV Pictures");
}

// ---- Input Devices: each mode's own (the window's Input Device menu), { id, name } in MMD.inputs, found by its id, else by its
// name (ids can change), as the Output Device is. inputCards: the audio inputs last seen ({ id: name }), so a change is warned of as the
// Output Device's are (Settings -> Audio, Warning On Change)

const MMD_INPUT_MODES = ["cw", "ft8", "ft4", "sstv", "packet", "sat", "psk31", "rtty", "olivia"];

function mmDecoderInputs()
{
  const S = GT.settings.MMD;
  if (!S.inputs || typeof S.inputs != "object") S.inputs = {};
  // Packet, new: on the input FT8 listens to (a rig's data audio)
  if (!S.inputs.packet && S.inputs.ft8) S.inputs.packet = Object.assign({}, S.inputs.ft8);
  // FT4, new: on FT8's input (the same rig audio); Sat Data on Packet's (a satellite's data audio), PSK31 and RTTY on CW's (the HF rig's)
  if (!S.inputs.ft4 && S.inputs.ft8) S.inputs.ft4 = Object.assign({}, S.inputs.ft8);
  if (!S.inputs.sat && S.inputs.packet) S.inputs.sat = Object.assign({}, S.inputs.packet);
  for (const mode of ["psk31", "rtty", "olivia"]) if (!S.inputs[mode] && S.inputs.cw) S.inputs[mode] = Object.assign({}, S.inputs.cw);
  // The one Input Device of before (Settings -> Audio): each mode starts on it. A mode with none picked hears the first in the list
  // (the window's mmdInputFind)
  for (const mode of MMD_INPUT_MODES)
  {
    if (!S.inputs[mode] && GT.settings.app.inputCard) S.inputs[mode] = { id: GT.settings.app.inputCard, name: GT.settings.app.inputCardName || null };
  }
  delete GT.settings.app.inputCard;
  delete GT.settings.app.inputCardName;
  // Common Input Device, new: on the input of the mode shown (else FT8's, CW's), so turning it on changes nothing heard
  if (!S.inputs.common)
  {
    const from = S.inputs[S.viewMode] || S.inputs.ft8 || S.inputs.cw;
    if (from) S.inputs.common = Object.assign({}, from);
  }
  return S.inputs;
}

// Common Input Device (the window's Settings, Decoders; on unless turned off): every mode hears the one picked for all (MMD.inputs.common),
// each mode's own kept for when it is turned off. Where a mode's input is: "common", or the mode
function mmDecoderInputKey(mode)
{
  return GT.settings.MMD.commonInput !== false ? "common" : mode;
}

// The Input Device a mode hears, among the audio inputs there are (enumerateDevices' audioinput ones, and the SPY Server I/Q the window
// lists): the common one or its own (mmDecoderInputKey)
function mmDecoderInputFind(mode, inputs)
{
  return mmDecoderInputFindOwn(mmDecoderInputKey(mode), inputs);
}

// The one picked under key ("common" or a mode, as its own menu shows it): by its id, else by its name (its id then taken), else null
function mmDecoderInputFindOwn(key, inputs)
{
  const pick = mmDecoderInputs()[key];
  if (!pick) return null;
  const byId = inputs.find((d) => d.deviceId == pick.id);
  if (byId) return byId;
  const byName = pick.name ? inputs.find((d) => d.label == pick.name) : null;
  if (byName) pick.id = byName.deviceId;
  return byName || null;
}

// Picked in the window's menu: a mode's own, or the common one ("common")
function mmDecoderInputSet(mode, id, name)
{
  if (MMD_INPUT_MODES.includes(mode) || mode == "common") mmDecoderInputs()[mode] = { id: String(id), name: name || null };
}

// ---- Output Devices (the modes that transmit: SSTV's Send Picture), as the Input Devices: Common Output Device (the window's Settings,
// General; on unless turned off) is the one every such mode sends to (MMD.outputs.common), each mode's own (MMD.outputs.sstv) kept for
// when it is off. { id, name }; none picked ("" or missing): the output on the same sound card as the input heard (the window's
// mmdOutputFind)

const MMD_OUTPUT_MODES = ["sstv"];

function mmDecoderOutputs()
{
  const S = GT.settings.MMD;
  if (!S.outputs || typeof S.outputs != "object") S.outputs = {};
  if (typeof S.commonOutput != "boolean") S.commonOutput = true;
  return S.outputs;
}

// Where a mode's output is: "common", or the mode
function mmDecoderOutputKey(mode)
{
  mmDecoderOutputs();
  return GT.settings.MMD.commonOutput !== false ? "common" : mode;
}

// The one picked under key ("common" or a mode) among the audio outputs there are: by its id, else by its name (its id then taken), else
// null (none picked, or the one picked not there)
function mmDecoderOutputFindOwn(key, outputs)
{
  const pick = mmDecoderOutputs()[key];
  if (!pick || !pick.id) return null;
  const byId = outputs.find((d) => d.deviceId == pick.id);
  if (byId) return byId;
  const byName = pick.name ? outputs.find((d) => d.label == pick.name) : null;
  if (byName) pick.id = byName.deviceId;
  return byName || null;
}

function mmDecoderOutputFind(mode, outputs)
{
  return mmDecoderOutputFindOwn(mmDecoderOutputKey(mode), outputs);
}

// Picked in the window's menu: a mode's own, or the common one ("common"); id "" is none picked (the input's sound card)
function mmDecoderOutputSet(mode, id, name)
{
  if (MMD_OUTPUT_MODES.includes(mode) || mode == "common") mmDecoderOutputs()[mode] = { id: String(id || ""), name: id ? name || null : null };
}

// A mode's SW level (the window's levels): a gain inside the decoder, in dB, kept here (MMD.swGain, by mode)
function mmDecoderSwGainSet(mode, db)
{
  const S = GT.settings.MMD;
  if (!S.swGain || typeof S.swGain != "object") S.swGain = {};
  if (MMD_INPUT_MODES.includes(mode) && Number.isFinite(Number(db))) S.swGain[mode] = Number(db);
}

// The audio devices there are (audio.js: at startup and on each change), the Input Devices checked as the Output Device is: warned of when
// one picked isn't there (the default heard instead, the pick kept), or the inputs aren't those last seen
function mmDecoderInputsCheck(deviceInfos)
{
  const inputs = deviceInfos.filter((d) => d.kind == "audioinput");
  const found = {};
  for (const d of inputs) found[d.deviceId] = d.label;
  const S = GT.settings.MMD;
  if (S.enable && S.inputCards)
  {
    // An Input Device picked and in use (the common one, or each mode's own) that isn't there; one with none picked hears the first in
    // the list. An SDR server's I/Q isn't a sound card: not looked for here
    const keys = S.commonInput !== false ? ["common"] : MMD_INPUT_MODES;
    const missing = (key) => mmDecoderInputs()[key] && !/^(iq|spy):/.test(String(mmDecoderInputs()[key].id)) && !mmDecoderInputFindOwn(key, inputs);
    if (keys.some(missing)) audioCardWarn(true, true);
    else if (Object.keys(S.inputCards).some((id) => !(id in found)) || Object.keys(found).some((id) => !(id in S.inputCards))) audioCardWarn(false, true);
  }
  S.inputCards = found;
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

// The Toggle Multi-Mode Decoder button: a click shows or hides the window, a right click (toggle false) shows it
function toggleMmDecoder(toggle = true)
{
  if (!GT.settings.MMD.enable) return;
  if (!GT.mmDecoderInitialized || !toggle)
  {
    mmDecoderOpen(true);
    return;
  }
  electron.ipcRenderer.send("toggleWin", "gt_mmdecoder");
}

// ---- The Rig Control VFO each mode reads and tunes (the window's Settings, Decoders: settings.MMD.vfos), the mode shown's used: picked
// ("" none), else the first VFO. With Follow BirdWatch, BirdWatch's downlink VFO instead (each mode's own kept as it is)

function mmDecoderVfo(mode = GT.settings.MMD.viewMode)
{
  // Rig Control off (the window's Settings, Decoders): no VFO at all, the decoder has nothing to do with the rigs (audio frequencies only)
  if (GT.settings.MMD.rigControl !== true) return null;
  const followed = GT.mmdFollowVfo ? rigVfoById(GT.mmdFollowVfo) : null;
  if (followed) return followed;
  return mmDecoderVfoOwn(mmDecoderVfoKey(mode));
}

// Common VFO (the window's Settings, Decoders; on unless turned off): every mode reads and tunes the one picked for all (MMD.vfos.common),
// each mode's own kept for when it is turned off. Where a mode's VFO is: "common", or the mode
function mmDecoderVfoKey(mode)
{
  return GT.settings.MMD.commonVfo !== false ? "common" : mode;
}

// The VFO picked under key ("common" or a mode, as its own menu shows it): none picked, the first VFO; "" none
function mmDecoderVfoOwn(key)
{
  const picked = (GT.settings.MMD.vfos || {})[key];
  if (picked === undefined) return rigVfos()[0] || null;
  return rigVfoById(picked);
}

// Follow BirdWatch (the window's Settings, Decoders) with Rig Control, while BirdWatch is in use with its own Rig Control on: BirdWatch's
// downlink VFO, every mode's; else null
function mmDecoderFollowVfoWanted()
{
  const S = GT.settings;
  if (S.MMD.followBirdWatch !== true || S.MMD.rigControl !== true || !S.Rigs.enable || !birdWatchPanelShown() || S.BirdWatch.autoRig === false) return null;
  return rigRoleVfo("rx");
}

// Each second, and from the window as it draws: GT.mmdFollowVfo made what is wanted now. Its id, or null
function mmDecoderFollowVfoSync()
{
  const v = mmDecoderFollowVfoWanted();
  GT.mmdFollowVfo = v ? v.id : null;
  return GT.mmdFollowVfo;
}

// What the decoder's VFO reads (the mode shown's, or another mode's): { v, R: its rig, up, freq: its dial on the air (its converter's
// offset taken off), mode }
function mmDecoderVfoRead(mode = GT.settings.MMD.viewMode)
{
  const v = mmDecoderVfo(mode);
  const read = rigVfoRead(v);
  return { v: v, R: read.R, up: read.up, freq: read.up ? read.dial - rigOffset(v) : null, mode: read.mode };
}

// ---- BirdWatch (on, its tracking toggled on) is following a satellite (birdWatchDopplerFollow: not with tracking toggled off, or the
// satellite no longer selected, though GT.rigDoppler is kept)
function mmDecoderBirdWatchFollowing()
{
  const D = GT.rigDoppler;
  const T = GT.birdWatchTrack;
  return !!(GT.settings.BirdWatch && birdWatchPanelShown() && D && T && T.selected == D.norad && (D.rx || D.tx || D.mode));
}

// BirdWatch follows the satellite on a VFO of the decoder's VFO's rig: meanwhile the Multi-Mode Decoder sends that rig nothing at all,
// neither a frequency nor a mode (mmdTuneDial). A rig BirdWatch doesn't use is the decoder's to tune
function mmDecoderRigLocked()
{
  if (!mmDecoderBirdWatchFollowing()) return false;
  const R = rigVfoLink(mmDecoderVfo());
  if (!R) return false;
  return ["rx", "tx"].some((side) => rigVfoLink(rigRoleVfo(side)) === R);
}

// The satellite a frame was heard through (Packet mode's list): the one BirdWatch follows, while it does on the decoder's VFO's rig (or
// the decoder has no VFO); null otherwise
function mmDecoderSatellite()
{
  if (!mmDecoderBirdWatchFollowing()) return null;
  const v = mmDecoderVfo();
  const R = v ? rigVfoLink(v) : null;
  if (R && !["rx", "tx"].some((side) => rigVfoLink(rigRoleVfo(side)) === R)) return null;
  const tle = birdWatchTleGet(GT.rigDoppler.norad);
  return tle ? tle.name : null;
}

// BirdWatch follows the satellite on the decoder's VFO itself: its Frequency menu isn't shown at all
function mmDecoderRigShared()
{
  if (!mmDecoderRigLocked()) return false;
  const v = mmDecoderVfo();
  const D = GT.rigDoppler;
  return (D.rx && rigRoleVfo("rx") === v) || (D.tx && rigRoleVfo("tx") === v);
}

// An audio frequency in the receiver's passband as the frequency on the air (Hz), from the decoder's VFO: USB adds it to the dial, LSB
// takes it off; in CW the dial is the frequency heard at the CW pitch, taken as 600 Hz (it isn't asked of the rig: only the VFO is read;
// a rig set to another pitch shows CW signals that much off), CW-R the other way. Null without a VFO read, or in another mode
function mmDecoderAirHz(audioHz)
{
  const read = mmDecoderVfoRead();
  if (!read.up) return null;
  const dial = read.freq;
  const pitch = 600;
  switch (read.mode)
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

// ---- The FT8 (or FT4) decoder as a GridTracker instance, "MMD" (the window's Settings, Decoders, FT8 or FT4: Enable GridTracker Instance,
// one of the two): its decodes go to GridTracker as a WSJT-X instance's would (the Call Roster, the map, alerts), already read
// (wsjtInstanceOpen, wsjtInstanceStatus and wsjtInstanceDispatch in wsjtxUdp.js). Only while that mode is listened to (the window in that
// mode, else by its background decoder, mmdFt8Background.js: whatever the window shows, and with it closed) and Rig Control reads that
// mode's VFO's dial: without it a decode's band isn't known. It has no address, so nothing is sent back to it (it can't be answered). A
// Status as it starts, when the dial, mode, call or grid changes, around each period's decode and every 15 s; a Close once it has stopped
// for a few seconds (not for a moment: the input started again)

const MMD_INSTANCE_ID = "MMD";
const MMD_INSTANCE_HEARTBEAT_MS = 15000;
const MMD_INSTANCE_CLOSE_MS = 3000;
// wanted: the window listens to the instance's mode with its setting on (mode: "ft8" or "ft4"); hidden: not shown in the window in that
// mode (the button shows it listens); live: the instance is open; decoding: a period is being decoded (Status' Decoding)
GT.mmdInstance = { wanted: false, mode: "ft8", hidden: false, live: false, unwantedAt: 0, sentAt: 0, key: "", decoding: false };

// The instance's mode: "ft8" or "ft4" (whichever Enable GridTracker Instance is on), null with neither
function mmDecoderInstanceMode()
{
  const S = GT.settings.MMD;
  return S.ft8Instance === true ? "ft8" : S.ft4Instance === true ? "ft4" : null;
}

// From the window, as it starts or stops listening, changes mode or shows and hides: on, the mode listened to ("ft8" or "ft4"), else null
function mmDecoderInstanceWanted(on, hidden)
{
  const I = GT.mmdInstance;
  const wanted = (on == "ft8" || on == "ft4") && GT.settings.MMD[on + "Instance"] === true;
  if (wanted) I.mode = on;
  if (I.wanted && !wanted) I.unwantedAt = Date.now();
  I.wanted = wanted;
  I.hidden = !!hidden;
  mmDecoderInstanceTick();
}

// Each second (mmDecoderInit), and as it changes: the instance opened, kept up or closed
function mmDecoderInstanceTick()
{
  const I = GT.mmdInstance;
  const read = I.wanted ? mmDecoderVfoRead(I.mode) : null;
  if (!read || !read.up)
  {
    if (I.live && (I.wanted || Date.now() - I.unwantedAt >= MMD_INSTANCE_CLOSE_MS)) mmDecoderInstanceClose();
    mmDecoderBackgroundRender();
    return;
  }
  const key = I.mode + "|" + Math.round(read.freq) + "|" + read.mode + "|" + mmDecoderInstanceCall() + "|" + mmDecoderInstanceGrid();
  if (!I.live || key != I.key || Date.now() - I.sentAt >= MMD_INSTANCE_HEARTBEAT_MS) mmDecoderInstanceStatus(read, key);
  mmDecoderBackgroundRender();
}

function mmDecoderInstanceCall()
{
  return String(GT.settings.app.myRawCall || GT.settings.app.myCall || "").trim();
}

function mmDecoderInstanceGrid()
{
  return String(GT.settings.app.myRawGrid || GT.settings.app.myGrid || "").trim();
}

// A Status: the mode's VFO's dial, FT8 or FT4, your call and grid, nothing transmitted
function mmDecoderInstanceStatus(read, key)
{
  const I = GT.mmdInstance;
  const freq = Math.round(read.freq);
  const message = {
    magic_key: 0xadbccbda, schema_number: 2, type: 1, Id: MMD_INSTANCE_ID,
    Frequency: freq, Band: formatBand(freq / 1000000), MO: I.mode == "ft4" ? "FT4" : "FT8", DXcall: "", Report: "", TxMode: I.mode == "ft4" ? "FT4" : "FT8",
    TxEnabled: 0, Transmitting: 0, Decoding: I.decoding ? 1 : 0, RxDF: 0, TxDF: 0,
    DEcall: mmDecoderInstanceCall(), DEgrid: mmDecoderInstanceGrid(), DXgrid: "", TxWatchdog: 0, Submode: "", Fastmode: 0,
    SopMode: 0, FreqTol: -1, TRP: -1, ConfName: MMD_INSTANCE_ID, TxMessage: "", TxSymbols: ""
  };
  const instance = wsjtInstanceOpen(MMD_INSTANCE_ID, null);
  wsjtInstanceStatus(instance, message);
  wsjtInstanceDispatch(instance, message, null);
  if (!I.live) addEvent("app", "<font style='color:lightgreen'>" + htmlEntities(I18N("mmd.instance.event.started").replace("{freq}", formatDialFreq(freq))) + "</font>");
  I.live = true;
  I.sentAt = Date.now();
  I.key = key || "";
}

// From the window: a period being decoded (true) or done (false), said with a Status
function mmDecoderInstanceDecoding(on)
{
  const I = GT.mmdInstance;
  I.decoding = !!on;
  if (!I.live) return;
  const read = mmDecoderVfoRead(I.mode);
  if (read.up) mmDecoderInstanceStatus(read, I.key);
}

// From the window: a period's messages (start: the period's start, ms UTC; each line [dB, DT, audio Hz, message]), as Decodes
function mmDecoderInstanceDecodes(start, lines)
{
  const I = GT.mmdInstance;
  if (!I.live || !(MMD_INSTANCE_ID in GT.instances)) return;
  const instance = GT.instances[MMD_INSTANCE_ID];
  const status = instance.status;
  if (!status) return;
  for (const line of lines)
  {
    const text = String(line[3] || "").trim();
    if (!text) continue;
    const message = {
      magic_key: 0xadbccbda, schema_number: 2, type: 2, Id: MMD_INSTANCE_ID,
      NW: 1, TM: Number(start) % 86400000, SR: Math.round(Number(line[0]) || 0), DT: Math.round((Number(line[1]) || 0) * 10) / 10,
      DF: Math.round(Number(line[2]) || 0), MO: I.mode == "ft4" ? "+" : "~", Msg: text, LC: 0, OA: 0,
      OF: status.Frequency, OC: status.DEcall, OG: status.DEgrid, OM: status.MO, OB: status.Band, SP: status.SopMode
    };
    wsjtInstanceDispatch(instance, message, null);
  }
}

// The instance closed (as a WSJT-X that quits: it is let go)
function mmDecoderInstanceClose()
{
  const I = GT.mmdInstance;
  if (!I.live) return;
  I.live = false;
  I.key = "";
  I.decoding = false;
  if (MMD_INSTANCE_ID in GT.instances)
  {
    const instance = GT.instances[MMD_INSTANCE_ID];
    wsjtInstanceDispatch(instance, { magic_key: 0xadbccbda, schema_number: 2, type: 6, Id: MMD_INSTANCE_ID }, null);
  }
  addEvent("app", "<font style='color:white'>" + htmlEntities(I18N("mmd.instance.event.stopped")) + "</font>");
}

// The Toggle Multi-Mode Decoder button while the instance is open with the window closed: a green dot on it, and its tooltip says so
function mmDecoderBackgroundRender()
{
  const I = GT.mmdInstance;
  const background = I.live && I.hidden;
  if (mmDecoderButton.classList.contains("mmdBackground") == background) return;
  mmDecoderButton.classList.toggle("mmdBackground", background);
  mmDecoderButton.title = I18N(background ? "mmd.instance.background.hover" : "gt.button.cwViewer.hover");
}

// ---- Follow BirdWatch (the window's Settings, Decoders): the decoder's mode follows the transmitter BirdWatch's rig follows, from its
// SatNOGS mode. { uuid, mode, baud, satnogs (its SatNOGS mode as it is) }: mode null for one the decoder has no mode for (voice, or a framing it doesn't read); null when
// nothing is followed, and while BirdWatch is off or its Satellite Tracking is toggled off (Follow BirdWatch isn't shown then either)
function mmDecoderBirdWatchMode()
{
  if (typeof birdWatchStickyPrevious != "function" || !GT.rigDoppler || !birdWatchPanelShown()) return null;
  const t = birdWatchStickyPrevious();
  if (!t) return null;
  return { uuid: t.uuid, mode: mmDecoderModeOf(t.mode), baud: Number(t.baud) || 0, satnogs: t.mode || "" };
}

// A SatNOGS transmitter's mode as the decoder's: CW, SSTV, FT8, FT4; AFSK, AX.25 and G3RUH (and the FSK, GMSK and GFSK that are mostly
// AX.25) as Packet; BPSK, AX.100 and GENESIS as Sat Data; else null
function mmDecoderModeOf(mode)
{
  const m = String(mode || "").toUpperCase().trim();
  if (m == "CW") return "cw";
  if (m == "SSTV") return "sstv";
  if (m == "FT8") return "ft8";
  if (m == "FT4") return "ft4";
  if (/^AFSK\b/.test(m) || /AX\.25|G3RUH/.test(m) || ["FSK", "GMSK", "GFSK"].includes(m)) return "packet";
  if (/^BPSK\b/.test(m) || /AX\.100|GENESIS/.test(m)) return "sat";
  return null;
}