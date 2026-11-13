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
  // The plugins (services/mmdPlugins.js): found and taken up before the window opens
  mmdPluginsFind();
  // One Waterfall Speed for every decoder: 1, as heard, until one is picked
  if (!(GT.settings.MMD.fallSpeed > 0)) GT.settings.MMD.fallSpeed = 1;
  // Nothing is sent to the rig unless Rig Control (the window's Settings, Decoders) is turned on; each mode's Set Frequency and Set Mode
  // (Decoders) are on unless turned off
  if (typeof GT.settings.MMD.rigControl != "boolean") GT.settings.MMD.rigControl = false;
  // (a plugin's from its plugin.json's settings: services/mmdPlugins.js)
  for (const key of ["cwSetMode", "sstvSetMode", "wwvSetMode", "cwSetFreq", "sstvSetFreq", "wwvSetFreq"])
  {
    if (typeof GT.settings.MMD[key] != "boolean") GT.settings.MMD[key] = true;
  }
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
  // On: the window loaded (hidden) if it isn't yet, as at startup, or told, so its mode is listened to with it closed
  if (GT.settings.MMD.enable)
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
  // Off: the window is hidden and stops its audio, in every mode (and puts the filter back); the instance
  // closes (mmDecoderInstanceTick)
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

// (each plugin's mode added as it's found: mmdPluginTake)
const MMD_INPUT_MODES = ["cw", "sstv", "sat", "wwv"];

function mmDecoderInputs()
{
  const S = GT.settings.MMD;
  if (!S.inputs || typeof S.inputs != "object") S.inputs = {};
  // A plugin's mode, new: on the input of the mode its plugin.json names (rig.inputFrom: NAVTEX's, PSK's, CW's; FT4's, FT8's)
  for (const p of GT.mmdPlugins || [])
  {
    if (p.disabled) continue;
    for (const d of p.modes) if (d.inputFrom && !S.inputs[d.id] && S.inputs[d.inputFrom]) S.inputs[d.id] = Object.assign({}, S.inputs[d.inputFrom]);
  }
  // (a mode with none picked hears the first in the list: the window's mmdInputFind)
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
    const missing = (key) => mmDecoderInputs()[key] && !/^(iq|spy|net|rig):/.test(String(mmDecoderInputs()[key].id)) && !mmDecoderInputFindOwn(key, inputs);
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

// Each second, and from the window as it draws: GT.mmdFollowVfo made what is wanted now. Its id, or null. Changed (BirdWatch started or
// stopped following, Follow BirdWatch turned on or off): the window's VFO menus drawn again, so they show whose VFO is read
function mmDecoderFollowVfoSync()
{
  const v = mmDecoderFollowVfoWanted();
  const id = v ? v.id : null;
  const changed = id !== GT.mmdFollowVfo;
  GT.mmdFollowVfo = id;
  if (changed && GT.mmDecoderInitialized)
  {
    try
    {
      GT.mmDecoderHandle.window.mmdVfosRender();
    }
    catch (e)
    {
      // Not loaded: its menus are made as it opens
    }
  }
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

// ---- The Multi-Mode Decoder as a GridTracker instance, "MMD": open while the decoder is on (Settings -> Features -> Service), its window
// shown or not, in the window's Mode (the last one picked, kept across restarts: MMD.viewMode) as data/modes.json names it
// (mmDecoderInstanceModeName), on that mode's VFO's dial as Rig Control reads it (none read: 0, band "OOB"). FT8's and FT4's
// decodes go to GridTracker as a WSJT-X instance's would (the Call Roster, the map, alerts) with that mode's Send Decodes To Call Roster
// on (the window's Settings, Decoders), already read (wsjtInstanceOpen, wsjtInstanceStatus and wsjtInstanceDispatch in wsjtxUdp.js). It
// has no address, so nothing is sent back to it (it can't be answered). A Status as it starts (once its dial has settled:
// mmDecoderInstanceSettled), when the dial, mode, call or grid changes,
// around each period's decode and every 15 s; a Close when it stops

const MMD_INSTANCE_ID = "MMD";
const MMD_INSTANCE_HEARTBEAT_MS = 15000;
// The instance opened once its VFO's band has been the same this long (mmDecoderInstanceSettled), or its VFO not read after this long
const MMD_INSTANCE_SETTLE_MS = 2000;
const MMD_INSTANCE_SETTLE_MAX_MS = 15000;
// live: the instance is open, in mode (its data/modes.json name); hidden: the window listens while it isn't shown (the button's green
// dot); decoding: a period is being decoded (Status' Decoding); waitSince, settleBand, settleSince: waiting to open, since when, and the
// band its VFO has read since when
GT.mmdInstance = { live: false, mode: "", hidden: false, sentAt: 0, key: "", decoding: false, waitSince: 0, settleBand: "", settleSince: 0 };

// Each Multi-Mode Decoder mode's names, from its submode's own to its parent mode's: the first in data/modes.json is the instance's mode.
// S: the decoder's settings (a plugin's with the submode picked: "psk63", "dominoex 11", "x5", "olivia 8/500" ...)
const MMD_INSTANCE_MODES = {
  cw: () => ["CW"],
  sstv: () => ["SSTV"],
  // Sat Data (FUNcube BPSK, AX.100, GENESIS): no mode of its own in modes.json
  sat: () => ["DATA"]
  // (a plugin's from its plugin.json's rig.instanceModes: services/mmdPlugins.js)
};

// The instance's mode: the window's Mode (and its submode) as data/modes.json names it; null for one it has no name for
function mmDecoderInstanceModeName(mode = GT.settings.MMD.viewMode)
{
  const names = Object.hasOwn(MMD_INSTANCE_MODES, mode) ? MMD_INSTANCE_MODES[mode](GT.settings.MMD) : [];
  // Only modes with a color of their own (as before submodes were listed: THOR16, OLIVIA 8/500, NAVTEX are named THOR, OLIVIA, TOR)
  return names.map((name) => String(name || "").toUpperCase()).find((name) => GT.modes && Object.hasOwn(GT.modes, name) && !Object.hasOwn(GT.modeParentColor || {}, name)) || null;
}

// From the window, as it starts or stops listening, or shows and hides: whether it listens while it isn't shown
function mmDecoderInstanceHidden(hidden)
{
  GT.mmdInstance.hidden = !!hidden;
  mmDecoderInstanceTick();
}

// Each second (mmDecoderInit), and as it changes: the instance opened, kept up or closed
function mmDecoderInstanceTick()
{
  const I = GT.mmdInstance;
  const S = GT.settings.MMD;
  const mode = S.enable === true ? mmDecoderInstanceModeName() : null;
  if (!mode)
  {
    mmDecoderInstanceClose();
    mmDecoderBackgroundRender();
    return;
  }
  const read = mmDecoderInstanceRead();
  if (!I.live && !mmDecoderInstanceSettled(read))
  {
    mmDecoderBackgroundRender();
    return;
  }
  const key = mode + "|" + Math.round(read.freq) + "|" + read.mode + "|" + mmDecoderInstanceCall() + "|" + mmDecoderInstanceGrid();
  if (!I.live || key != I.key || Date.now() - I.sentAt >= MMD_INSTANCE_HEARTBEAT_MS) mmDecoderInstanceStatus(read, mode, key);
  // Into the Call Roster only in a mode with its Send Decodes To Call Roster on (FT8's, FT4's); seen by it at all only with one of them on
  mmDecoderInstanceRoster(S[S.viewMode + "SendDecodes"] === true);
  mmDecoderInstanceRosterSeen();
  mmDecoderBackgroundRender();
}

// Whether the instance can open: only once its dial has settled, so its first Status (its started event, and the band / mode event
// while it's the active instance) has its real band, not "OOB" while its VFO isn't read yet, then the band it gets to. No VFO (Rig
// Control off in the window's Settings, or none picked): at once, its band is "OOB" for good. Else once the VFO's band has been the same
// for MMD_INSTANCE_SETTLE_MS (past a rig tuned from its old dial to the mode's), or the VFO not read after MMD_INSTANCE_SETTLE_MAX_MS
function mmDecoderInstanceSettled(read)
{
  const I = GT.mmdInstance;
  if (!mmDecoderVfo()) return true;
  const now = Date.now();
  if (!I.waitSince) I.waitSince = now;
  const band = read.freq > 0 ? formatBand(read.freq / 1000000) : "";
  if (band != I.settleBand || !I.settleSince)
  {
    I.settleBand = band;
    I.settleSince = now;
  }
  if (band && now - I.settleSince >= MMD_INSTANCE_SETTLE_MS) return true;
  return now - I.waitSince >= MMD_INSTANCE_SETTLE_MAX_MS;
}

// The instance's dial: the window's Mode's VFO as Rig Control reads it; no VFO, or its frequency not known, 0 (its band "OOB")
function mmDecoderInstanceRead()
{
  const read = mmDecoderVfoRead(GT.settings.MMD.viewMode);
  return read.up && read.freq > 0 ? read : { freq: 0, mode: "" };
}

function mmDecoderInstanceCall()
{
  return String(GT.settings.app.myRawCall || GT.settings.app.myCall || "").trim();
}

function mmDecoderInstanceGrid()
{
  return String(GT.settings.app.myRawGrid || GT.settings.app.myGrid || "").trim();
}

// A Status: the mode's VFO's dial, the mode (its data/modes.json name), your call and grid, nothing transmitted
function mmDecoderInstanceStatus(read, mode, key)
{
  const I = GT.mmdInstance;
  const freq = Math.round(read.freq);
  const message = {
    magic_key: 0xadbccbda, schema_number: 2, type: 1, Id: MMD_INSTANCE_ID,
    Frequency: freq, Band: formatBand(freq / 1000000), MO: mode, DXcall: "", Report: "", TxMode: mode,
    TxEnabled: 0, Transmitting: 0, Decoding: I.decoding ? 1 : 0, RxDF: 0, TxDF: 0,
    DEcall: mmDecoderInstanceCall(), DEgrid: mmDecoderInstanceGrid(), DXgrid: "", TxWatchdog: 0, Submode: "", Fastmode: 0,
    SopMode: 0, FreqTol: -1, TRP: -1, ConfName: MMD_INSTANCE_ID, TxMessage: "", TxSymbols: ""
  };
  const instance = wsjtInstanceOpen(MMD_INSTANCE_ID, null);
  mmDecoderInstanceRosterSeen();
  wsjtInstanceStatus(instance, message);
  wsjtInstanceDispatch(instance, message, null);
  I.live = true;
  I.waitSince = 0;
  I.settleSince = 0;
  I.mode = mode;
  I.sentAt = Date.now();
  I.key = key || "";
}

// From the window: a period being decoded (true) or done (false), said with a Status
function mmDecoderInstanceDecoding(on)
{
  const I = GT.mmdInstance;
  I.decoding = !!on;
  if (!I.live) return;
  mmDecoderInstanceStatus(mmDecoderInstanceRead(), I.mode, I.key);
}

// From the window: a period's messages in a mode decoded as WSJT-X's are (a plugin's: FT8's, FT4's; mode; start: the period's start, ms
// UTC; each line [dB, DT, audio Hz, message]; modeChar: WSJT-X's for the mode, FT8's "~", FT4's "+"), as Decodes (the map, alerts), in
// the instance's mode only; into the Call Roster too with that mode's Send Decodes To Call Roster on (wsjtx.js: the instance's noRoster)
function mmDecoderInstanceDecodes(mode, start, lines, modeChar)
{
  const I = GT.mmdInstance;
  const S = GT.settings.MMD;
  if (!I.live || !(MMD_INSTANCE_ID in GT.instances) || mode != S.viewMode || typeof modeChar != "string" || !modeChar) return;
  const instance = GT.instances[MMD_INSTANCE_ID];
  const status = instance.status;
  if (!status) return;
  mmDecoderInstanceRoster(S[mode + "SendDecodes"] === true);
  for (const line of lines)
  {
    const text = String(line[3] || "").trim();
    if (!text) continue;
    const message = {
      magic_key: 0xadbccbda, schema_number: 2, type: 2, Id: MMD_INSTANCE_ID,
      NW: 1, TM: Number(start) % 86400000, SR: Math.round(Number(line[0]) || 0), DT: Math.round((Number(line[1]) || 0) * 10) / 10,
      DF: Math.round(Number(line[2]) || 0), MO: modeChar, Msg: text, LC: 0, OA: 0,
      OF: status.Frequency, OC: status.DEcall, OG: status.DEgrid, OM: status.MO, OB: status.Band, SP: status.SopMode
    };
    wsjtInstanceDispatch(instance, message, null);
  }
}

// The distance from your location to a grid's center, in the distance unit of Settings (rounded), and that unit ("km", "mi" ...); the
// window's WSPR list. A grid that isn't one, or no locator: null
function mmDecoderGridDistance(grid)
{
  const unit = String(distanceUnit.value || "KM").toLowerCase();
  if (!/^[A-R]{2}[0-9]{2}([A-X]{2})?$/i.test(String(grid || ""))) return { distance: null, unit };
  const LL = squareToCenter(grid);
  const d = mmDecoderDistance(LL.a, LL.o);
  return { distance: d ? d.distance : null, unit };
}

// How far a place is from you, in km (for a model) and in the distance unit of Settings (rounded) to show: { km, distance, unit };
// null without a locator or a place. The Multi-Mode Decoder's plugins (the WEFAX Auto-Tune's path)
function mmDecoderDistance(lat, lon)
{
  const a = Number(lat), o = Number(lon);
  if (!Number.isFinite(a) || !Number.isFinite(o) || !Number.isFinite(GT.myLat) || !Number.isFinite(GT.myLon)) return null;
  const unit = String(distanceUnit.value || "KM");
  const angle = MyCircle.distance(GT.myLat, GT.myLon, a, o);
  return { km: angle * MyCircle.validateRadius("KM"), distance: Math.round(angle * MyCircle.validateRadius(unit)), unit: unit.toLowerCase() };
}

// From the window: a WSPR period's stations (start: the period's start, ms UTC; each { snr, dt, freq (audio Hz), air (Hz on the air, or
// null), drift, call, grid, power }), as WSJT-X's WSPR decodes (the map; wsjtx.js, handleWsjtxWSPR). A hashed call (<...>) isn't known:
// not sent. Only in the instance's mode
function mmDecoderInstanceWspr(start, list)
{
  const I = GT.mmdInstance;
  if (!I.live || !(MMD_INSTANCE_ID in GT.instances) || GT.settings.MMD.viewMode != "wspr") return;
  const instance = GT.instances[MMD_INSTANCE_ID];
  const status = instance.status;
  if (!status) return;
  for (const d of list)
  {
    if (!d.call || d.call.startsWith("<")) continue;
    const message = {
      magic_key: 0xadbccbda, schema_number: 2, type: 10, Id: MMD_INSTANCE_ID,
      NW: 1, TM: Number(start) % 86400000, SR: Math.round(Number(d.snr) || 0), DT: Number(d.dt) || 0, Frequency: d.air > 0 ? Math.round(d.air) : 0,
      Drift: Math.round(Number(d.drift) || 0), Callsign: d.call, Grid: d.grid || "", Power: Number(d.power) || 0, OA: 0,
      OF: status.Frequency, OC: status.DEcall, OG: status.DEgrid, OM: status.MO, OB: status.Band
    };
    wsjtInstanceDispatch(instance, message, null);
  }
}

// The Call Roster sees the instance (its instance selector, its count, its RX / Decode indicator: wsjtx.js) only while one of the modes'
// Send Decodes To Call Roster is on (a plugin's mode's <mode>SendDecodes: FT8's, FT4's). instanceCount counts the instances that can be in
// the roster (wsjtInstanceOpen counts each new one, handleClosed takes one off for canRoster's): kept so as this changes
function mmDecoderInstanceRosterSeen()
{
  const instance = GT.instances[MMD_INSTANCE_ID];
  if (!instance) return;
  const S = GT.settings.MMD;
  const seen = mmdPluginModeIds().some((mode) => S[mode + "SendDecodes"] === true);
  instance.hideFromRoster = !seen;
  if (instance.canRoster === seen) return;
  instance.canRoster = seen;
  GT.instanceCount += seen ? 1 : -1;
  updateRosterInstances();
}

// The instance's decodes into the Call Roster (on) or the map only: turned off, the calls it put there go
function mmDecoderInstanceRoster(on)
{
  const instance = GT.instances[MMD_INSTANCE_ID];
  if (!instance || instance.noRoster === !on) return;
  instance.noRoster = !on;
  if (on) return;
  let removed = false;
  for (const hash in GT.callRoster)
  {
    if (GT.callRoster[hash].callObj.instance == MMD_INSTANCE_ID)
    {
      delete GT.callRoster[hash];
      removed = true;
    }
  }
  if (removed) goProcessRoster();
}

// The instance closed (as a WSJT-X that quits: it is let go)
function mmDecoderInstanceClose()
{
  const I = GT.mmdInstance;
  // (waiting to open: waited again from the start when it's next wanted)
  I.waitSince = 0;
  I.settleSince = 0;
  if (!I.live) return;
  I.live = false;
  I.key = "";
  I.decoding = false;
  if (MMD_INSTANCE_ID in GT.instances)
  {
    const instance = GT.instances[MMD_INSTANCE_ID];
    wsjtInstanceDispatch(instance, { magic_key: 0xadbccbda, schema_number: 2, type: 6, Id: MMD_INSTANCE_ID }, null);
  }
  addEvent("mmd", "<font style='color:var(--gt-label)'>" + htmlEntities(I18N("mmd.instance.event.stopped")) + "</font>");
}

// The Toggle Multi-Mode Decoder button while the instance is open and the window listens closed: a green dot on it, and its tooltip says so
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
  // (a follow left from another satellite than the one selected isn't BirdWatch's now)
  if (typeof birdWatchStickyPrevious != "function" || !GT.rigDoppler || !birdWatchPanelShown()) return null;
  if (!GT.birdWatchTrack || GT.birdWatchTrack.selected != GT.rigDoppler.norad) return null;
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