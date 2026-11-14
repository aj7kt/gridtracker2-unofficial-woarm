// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Multi-Mode Decoder's Settings panel (gt_mmdecoder.html, #mmdSettings), opened by Settings on its top line as the Call Roster's
// are. General (the tab shown at first): the waterfall's speed and how it is drawn, Rig Control (whether the decoder may send the rig
// anything at all), Follow BirdWatch, RSID, Common Input Device and Common VFO (each with its menu: on, each decoder's own is hidden and
// kept). Decoders: each decoder's own settings, the same rows in each (its Input Device and VFO; what it may send the rig, shown with Rig
// Control on: Set Frequency and Set Mode, each on its own; then its own: SSTV's Save Pictures and folder; a plugin's in its own box,
// FT8's Depth; SSTV's Original Size). Band Plans (mmdBands.js). All in GT.settings.MMD, read as used

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
  cwSetModeValue.checked = S.cwSetMode === true;
  sstvSetModeValue.checked = S.sstvSetMode === true;
  wwvSetModeValue.checked = S.wwvSetMode === true;
  // (Sat Data has no Set Mode; a plugin's mode's own: its Set Mode box, every mode's in MMD_MODES with one)
  for (const mode of MMD_MODES) if (!["cw", "sstv", "wwv"].includes(mode) && window[mode + "SetModeValue"]) window[mode + "SetModeValue"].checked = S[mode + "SetMode"] === true;
  sstvSaveValue.checked = S.sstvSave === true;
  sstvFolderTr.style.display = S.sstvSave === true ? "" : "none";
  // Original Size (mmdPicSetOriginalSize: the picture's right-click has it too)
  sstvOriginalSizeValue.checked = S.sstvOriginalSize === true;
  sstvNoVisValue.checked = S.sstvNoVis === true;
  mmdShortFolder(sstvFolderText, window.opener.mmDecoderSstvFolder(), "settings.sstvDecoder.folder.hover");
  // The plugins' own boxes (their registrations' settingsRender: FT8's Depth, NAVTEX's Set Mode and Save Messages)
  mmdPluginsEach("settingsRender", S);
}

// A save folder shown short, as … and its last two folders (its parent's and its own); the whole path in its tooltip, under what it is
function mmdShortFolder(el, folder, hoverKey)
{
  const parts = String(folder || "").split(/[\\/]+/).filter(Boolean);
  const text = parts.length > 2 ? "…" + path.sep + parts.slice(-2).join(path.sep) : String(folder || "");
  if (el.textContent != text) el.textContent = text;
  el.title = I18N(hoverKey) + "\n" + folder;
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
    // (a plugin's mode without a box of its own)
    if (!select) continue;
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
  // The SDR servers' VFOs among the Input Devices (added, removed, renamed, another server type), and the VFOs whose rig carries audio
  // (FlexRadio, Icom LAN) among the Input and Output Devices (set to or from such a protocol, renamed, Rig Control turned on or off)
  const spies = typeof opener.rigIqVfos == "function" ? opener.rigIqVfos().map((v) => v.id + "=" + opener.rigVfoLabel(v) + "=" + v.protocol).join("|") : "";
  const rigAudio = typeof opener.netAudioDevices == "function" ? opener.netAudioDevices("in").concat(opener.netAudioDevices("out")).filter((d) => d.id.startsWith("rig:")).map((d) => d.id + "=" + d.label).join("|") : "";
  const key = rigAudio ? spies + "#" + rigAudio : spies;
  if (key !== DEC.spyKey)
  {
    DEC.spyKey = key;
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

// Follow BirdWatch: on, the transmitter BirdWatch follows now sets the mode at once (mmdFollowBirdWatch); on or off, the VFO menus (and
// the Frequency menu) show at once whose VFO is read: BirdWatch's, or each mode's own again
function mmdSetFollowBirdWatch()
{
  GT.settings.MMD.followBirdWatch = mmdFollowBirdWatchValue.checked;
  DEC.followedUuid = undefined;
  window.opener.mmDecoderFollowVfoSync();
  mmdSettingsRender();
  mmdTop();
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
    if (!select) continue;
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

// The SSTV Decoder's Save Pictures: each picture as it ends (mmdSstv.js); its Folder shown while it is on
function mmdSetSstvSave()
{
  GT.settings.MMD.sstvSave = sstvSaveValue.checked;
  mmdSettingsRender();
}

// The SSTV Decoder's Start Without VIS: told to its worker at once (mmdSstvConfig)
function mmdSetSstvNoVis()
{
  GT.settings.MMD.sstvNoVis = sstvNoVisValue.checked;
  mmdSstvConfig();
  mmdSettingsRender();
}

// A kind of picture's saving folder (the picture view's kinds, mmdPictures.js: "sstv" Save Pictures', a plugin's: "wefax" Save Charts')
function mmdPicturesFolder(kind)
{
  return PICS.kinds[kind] ? PICS.kinds[kind].folder() : "";
}

// Another folder picked for a kind's saving: MMD.<kind>Folder (sstvFolder, wefaxFolder)
function mmdSetPicturesFolderChoose(kind)
{
  const remote = window.require("@electron/remote");
  const folders = remote.dialog.showOpenDialogSync(remote.getCurrentWindow(), { defaultPath: mmdPicturesFolder(kind), properties: ["openDirectory", "createDirectory"] });
  if (!folders || !folders.length) return;
  GT.settings.MMD[kind + "Folder"] = folders[0];
  mmdSettingsRender();
}

// A mode's saving folder opened (made first, if nothing has been saved yet)
function mmdSetPicturesFolderOpen(kind)
{
  const folder = mmdPicturesFolder(kind);
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
