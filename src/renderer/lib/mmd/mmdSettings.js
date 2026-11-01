// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Multi-Mode Decoder's Settings panel (gt_mmdecoder.html, #mmdSettings), opened by Settings on its top line as the Call Roster's
// are. General (the tab shown at first): the waterfall's speed and how it is drawn, Rig Control (whether the decoder may send the rig
// anything at all), Follow BirdWatch, RSID, Common Input Device and Common VFO (each with its menu: on, each decoder's own is hidden and
// kept). Decoders: each decoder's own settings, the same rows in each (its Input Device and VFO; what it may send the rig, shown with Rig
// Control on: Set Frequency and Set Mode, each on its own; then its own: FT8's Depth, FT8's and FT4's Send Decodes To Call Roster; SSTV's Save Pictures and folder). Band Plans (mmdBands.js). All in GT.settings.MMD, read as used

function mmdSettingsShow(show)
{
  mmdSettings.style.display = show ? "flex" : "none";
  if (show)
  {
    mmdSettingsRender();
    // (Band Plans, when that tab is the one open: mmdBands.js)
    mmdBandsRender();
  }
}

// Settings on the top line: opens the panel, or closes it when it is open
function mmdSettingsToggle()
{
  mmdSettingsShow(mmdSettings.style.display != "flex");
}

function mmdSettingsRender()
{
  const S = GT.settings.MMD;
  mmdRigControlValue.checked = S.rigControl === true;
  mmdFollowBirdWatchValue.checked = S.followBirdWatch === true;
  mmdRsidValue.checked = S.rsid !== false;
  // Common Input Device: its menu under it, and each decoder's own Input Device hidden while it is on
  const commonInput = S.commonInput !== false;
  mmdCommonInputValue.checked = commonInput;
  mmdCommonInputRow.style.display = commonInput ? "" : "none";
  for (const row of document.querySelectorAll(".mmdInputRow")) row.style.display = commonInput ? "none" : "";
  // Common Output Device (the modes that transmit) the same
  window.opener.mmDecoderOutputs();
  const commonOutput = S.commonOutput !== false;
  mmdCommonOutputValue.checked = commonOutput;
  mmdCommonOutputRow.style.display = commonOutput ? "" : "none";
  for (const row of document.querySelectorAll(".mmdOutputRow")) row.style.display = commonOutput ? "none" : "";
  // What each mode may send the rig: only with Rig Control on. Common VFO the same (its menu under it, each decoder's own VFO hidden
  // while it is on)
  const commonVfo = S.commonVfo !== false;
  mmdCommonVfoValue.checked = commonVfo;
  for (const row of document.querySelectorAll(".mmdRigRow")) row.style.display = S.rigControl === true ? "" : "none";
  if (!commonVfo) mmdCommonVfoRow.style.display = "none";
  else for (const row of document.querySelectorAll(".mmdVfoRow")) row.style.display = "none";
  // (Sat Data has no frequencies of its own: no Set Frequency)
  for (const mode of MMD_MODES) if (window[mode + "SetFreqValue"]) window[mode + "SetFreqValue"].checked = S[mode + "SetFreq"] === true;
  mmdFallSpeedValue.value = S.fallSpeed;
  mmdFallSpeedTd.textContent = S.fallSpeed + "×";
  // How the waterfall is drawn (mmdFallView.js)
  mmdFallViewRender();
  mmdVfosRender();
  mmdInputsRender();
  mmdOutputsRender();
  ft8DepthSelect.value = S.ft8Depth;
  ft8SendDecodesValue.checked = S.ft8SendDecodes === true;
  ft4SendDecodesValue.checked = S.ft4SendDecodes === true;
  mmdInstanceNoteRender();
  ft8SetModeValue.checked = S.ft8SetMode;
  ft4SetModeValue.checked = S.ft4SetMode === true;
  cwSetModeValue.checked = S.cwSetMode === true;
  sstvSetModeValue.checked = S.sstvSetMode === true;
  packetSetModeValue.checked = S.packetSetMode === true;
  psk31SetModeValue.checked = S.psk31SetMode === true;
  rttySetModeValue.checked = S.rttySetMode === true;
  mfskSetModeValue.checked = S.mfskSetMode === true;
  thorSetModeValue.checked = S.thorSetMode === true;
  navtexSetModeValue.checked = S.navtexSetMode === true;
  hellSetModeValue.checked = S.hellSetMode === true;
  wefaxSetModeValue.checked = S.wefaxSetMode === true;
  wsprSetModeValue.checked = S.wsprSetMode === true;
  sstvSaveValue.checked = S.sstvSave === true;
  navtexSaveValue.checked = S.navtexSave === true;
  sstvFolderTr.style.display = S.sstvSave === true ? "" : "none";
  sstvFolderText.textContent = window.opener.mmDecoderSstvFolder();
}

// Each mode's VFO menu, and Common VFO's: Rig Control's by their names, and None. With Follow BirdWatch, BirdWatch's downlink VFO, named so,
// and not to be changed. Also from the main window as VFOs are added, removed or renamed (rigSettingsRender): a menu is made again only
// when its choices changed, so one open isn't closed under the mouse
function mmdVfosRender()
{
  const opener = window.opener;
  const choices = [["", opener.I18N("settings.rig.vfo.none.label")]].concat(opener.rigVfos().map((v) => [v.id, opener.rigVfoLabel(v)]));
  const followed = opener.GT.mmdFollowVfo;
  for (const mode of MMD_MODES.concat("common"))
  {
    const select = window[mode + "VfoSelect"];
    const options = choices.map(([value, text]) => [value, value && value === followed ? opener.I18N("settings.mmDecoder.vfo.birdWatch.label").replace("{vfo}", text) : text]);
    const key = options.map(([value, text]) => value + "=" + text).join("|");
    if (select.dataset.key != key)
    {
      select.dataset.key = key;
      select.innerHTML = "";
      for (const [value, text] of options) select.appendChild(new Option(text, value));
    }
    // Its own pick ("common", or the mode's), unless BirdWatch's is followed
    const v = followed ? opener.rigVfoById(followed) : opener.mmDecoderVfoOwn(mode);
    select.value = v ? v.id : "";
    select.disabled = !!followed;
    select.title = opener.I18N(followed ? "settings.mmDecoder.vfo.birdWatch.hover" : mode == "common" ? "settings.mmDecoder.commonVfoSelect.hover" : "settings.mmDecoder.vfo.hover");
  }
  // The SDR servers' VFOs among the Input Devices (added, removed, renamed, another server type)
  const spies = typeof opener.rigIqVfos == "function" ? opener.rigIqVfos().map((v) => v.id + "=" + opener.rigVfoLabel(v) + "=" + v.protocol).join("|") : "";
  if (spies !== DEC.spyKey)
  {
    DEC.spyKey = spies;
    mmdInputs();
  }
}

// Rig Control (on top): off, the decoder sends the rig nothing; the Frequency menu follows
function mmdSetRigControl()
{
  GT.settings.MMD.rigControl = mmdRigControlValue.checked;
  mmdSettingsRender();
  mmdTop();
}

// Follow BirdWatch: on, the transmitter BirdWatch follows now sets the mode at once (mmdFollowBirdWatch)
function mmdSetFollowBirdWatch()
{
  GT.settings.MMD.followBirdWatch = mmdFollowBirdWatchValue.checked;
  DEC.followedUuid = undefined;
}

// RSID: on, every mode's input goes to the RSID finder too (mmdRsid.js); off, the RSIDs drawn go
function mmdSetRsid()
{
  GT.settings.MMD.rsid = mmdRsidValue.checked;
  if (!mmdRsidOn()) DEC.rsidMarks = [];
  mmdRsidReset();
  if (DEC.node) DEC.node.port.postMessage({ type: "raw", on: mmdRawMode() || mmdRsidOn() });
  mmdOverlay();
}

// A mode's Set Frequency and Set Mode (each on its own): what picking one of its frequencies in the Frequency menu sends the rig
function mmdSetRigSend(mode)
{
  GT.settings.MMD[mode + "SetFreq"] = window[mode + "SetFreqValue"].checked;
  GT.settings.MMD[mode + "SetMode"] = window[mode + "SetModeValue"].checked;
  mmdSettingsRender();
  mmdTop();
}

// Each mode's Input Device menu, and Common Input Device's: the audio inputs there are (DEC.inputDevices, read by mmdInputs), its own pick
// ("common", or the mode's; one that isn't there: the first, as it would be heard)
function mmdInputsRender()
{
  const devices = DEC.inputDevices || [];
  for (const mode of MMD_MODES.concat("common"))
  {
    const select = window[mode + "InputSelect"];
    select.length = 0;
    for (const d of devices) select.add(new Option(mmdInputLabel(d), d.deviceId));
    const device = window.opener.mmDecoderInputFindOwn(mode, devices) || devices[0];
    if (device) select.value = device.deviceId;
  }
}

// An Input Device picked (a mode's own, or the common one): the decoder goes to it when it is the one heard now (started on it, if the
// last couldn't be opened)
function mmdSetInput(mode)
{
  const select = window[mode + "InputSelect"];
  const option = select.options[select.selectedIndex];
  window.opener.mmDecoderInputSet(mode, select.value, option ? option.text : null);
  if (mode != window.opener.mmDecoderInputKey(DEC.mode)) return;
  mmdInputs().then(() =>
  {
    if (!DEC.running) mmdListen();
  });
}

// Each transmitting mode's Output Device menu, and Common Output Device's: Same Sound Card As Input (none picked: the output on the input's
// sound card, mmdOutputFind), then the audio outputs there are (DEC.outputDevices, read by mmdInputs); its own pick
function mmdOutputsRender()
{
  const devices = DEC.outputDevices || [];
  for (const mode of MMD_TX_MODES.concat("common"))
  {
    const select = window[mode + "OutputSelect"];
    if (!select) continue;
    select.length = 0;
    select.add(new Option(I18N("settings.mmDecoder.output.auto"), ""));
    for (const d of devices) select.add(new Option(mmdInputLabel(d), d.deviceId));
    const device = window.opener.mmDecoderOutputFindOwn(mode, devices);
    select.value = device ? device.deviceId : "";
  }
  if (typeof mmdSstvTxOutputRender == "function") mmdSstvTxOutputRender();
}

// An Output Device picked (a mode's own, or the common one)
function mmdSetOutput(mode)
{
  const select = window[mode + "OutputSelect"];
  const option = select.options[select.selectedIndex];
  window.opener.mmDecoderOutputSet(mode, select.value, option ? option.text : null);
  mmdOutputsRender();
}

// Common Output Device on or off
function mmdSetCommonOutput()
{
  GT.settings.MMD.commonOutput = mmdCommonOutputValue.checked;
  mmdSettingsRender();
}

// Common Input Device on or off: the decoder goes to the input it now hears (the common one, or the mode's own)
function mmdSetCommonInput()
{
  GT.settings.MMD.commonInput = mmdCommonInputValue.checked;
  mmdSettingsRender();
  mmdInputs().then(() =>
  {
    if (!DEC.running) mmdListen();
  });
}

// Common VFO on or off: the VFO read (the frequency shown) and tuned from now on
function mmdSetCommonVfo()
{
  GT.settings.MMD.commonVfo = mmdCommonVfoValue.checked;
  mmdSettingsRender();
  mmdTop();
}

// A mode's VFO, or the common one ("" none): what it reads from now on
function mmdSetVfo(mode)
{
  GT.settings.MMD.vfos[mode] = window[mode + "VfoSelect"].value;
  mmdSettingsRender();
  mmdTop();
}

// Waterfall Speed, every decoder's: read as each row is drawn
function mmdSetFallSpeed()
{
  GT.settings.MMD.fallSpeed = Number(mmdFallSpeedValue.value);
  mmdSettingsRender();
}

// The FT8 Decoder's Depth: read as each period is sent to decode
function mmdSetFt8Depth()
{
  GT.settings.MMD.ft8Depth = ft8DepthSelect.value == "deep" ? "deep" : "normal";
}

// FT8's or FT4's Send Decodes To Call Roster (mode "ft8" or "ft4"): on, in that mode its decodes go into the Call Roster too, not only
// the map (GridTracker's instance "MMD", services/mmDecoder.js)
function mmdSetSendDecodes(mode)
{
  GT.settings.MMD[mode + "SendDecodes"] = window[mode + "SendDecodesValue"].checked;
  mmdSettingsRender();
}

// Each one's note, while it is on but its decodes can't go yet: Rig Control isn't reading that mode's VFO's dial
function mmdInstanceNoteRender()
{
  for (const mode of ["ft8", "ft4"])
  {
    const waiting = GT.settings.MMD[mode + "SendDecodes"] === true && !(window.opener.mmDecoderVfoRead(mode).up);
    window[mode + "InstanceNoteTr"].style.display = waiting ? "" : "none";
  }
}


// The SSTV Decoder's Save Pictures: each picture as it ends (mmdSstv.js); its Folder shown while it is on
function mmdSetSstvSave()
{
  GT.settings.MMD.sstvSave = sstvSaveValue.checked;
  mmdSettingsRender();
}

// NAVTEX's Save Messages: each complete message saved as text as it comes (mmdNavtex.js)
function mmdSetNavtexSave()
{
  GT.settings.MMD.navtexSave = navtexSaveValue.checked;
  mmdSettingsRender();
}

function mmdSetSstvFolderChoose()
{
  const remote = window.require("@electron/remote");
  const folders = remote.dialog.showOpenDialogSync(remote.getCurrentWindow(), { defaultPath: window.opener.mmDecoderSstvFolder(), properties: ["openDirectory", "createDirectory"] });
  if (!folders || !folders.length) return;
  GT.settings.MMD.sstvFolder = folders[0];
  mmdSettingsRender();
}

// The folder opened (made first, if no picture has been saved yet)
function mmdSetSstvFolderOpen()
{
  const folder = window.opener.mmDecoderSstvFolder();
  try
  {
    fs.mkdirSync(folder, { recursive: true });
  }
  catch (e)
  {
    // Opened as it is, or the system says why not
  }
  electron.shell.openPath(folder);
}
