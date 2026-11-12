// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// Audio: speech and voices, sound cards, media file checks (moved from GridTracker2.js)

function voiceChangedValue()
{
  GT.settings.audio.speechVoice = Number(alertVoiceInput.value) + 1;
  changeSpeechValues();
}

function timedGetVoices()
{
  try {
    GT.voices = window.speechSynthesis.getVoices();
    if (GT.voices.length > 0 &&  GT.speechAvailable == false)
    {
      alertVoiceInput.title = I18N("gt.audio.selectVoice");
      for (let i = 0; i < GT.voices.length; i++)
      {
        let option = document.createElement("option");
        option.value = i;
        option.text = GT.voices[i].name;
        if (GT.voices[i].default)
        {
          option.selected = true;
        }
        alertVoiceInput.appendChild(option);
      }
      alertVoiceInput.oninput = voiceChangedValue;
      voicesDiv.appendChild(alertVoiceInput);

      if (GT.settings.audio.speechVoice > 0)
      {
        alertVoiceInput.value = GT.settings.audio.speechVoice - 1;
      }

      let msg = new SpeechSynthesisUtterance("\n");
      msg.lang = GT.localeString;
      window.speechSynthesis.speak(msg);

      GT.speechAvailable = true;
    }
    else
    {
      // try again in 10 seconds
      nodeTimers.setTimeout(timedGetVoices, 10000);
    }
  }
  catch (e)
  {
    // try again in 30 seconds
    nodeTimers.setTimeout(timedGetVoices, 30000);
  }
}

function initSpeech()
{
  nodeTimers.setTimeout(timedGetVoices, 1000);
}

function initSoundCards()
{
  navigator.mediaDevices.ondevicechange = (event) =>
  {
    updateSoundCards();
  }
  updateSoundCards();
  setAudioView();
  loadAlerts();
}

function updateSoundCards()
{
  navigator.mediaDevices
    .enumerateDevices()
    .then(gotAudioDevices)
    .catch(errorCallback);
}

function errorCallback(e) { }

function gotAudioDevices(deviceInfos)
{
  soundCardDiv.innerHTML = "";
  let newSelect = document.createElement("select");
  newSelect.id = "soundCardInput";
  newSelect.title = I18N("gt.audio.selectSoundCard");

  let foundCards = {};
  for (let i = 0; i != deviceInfos.length; ++i)
  {
    let deviceInfo = deviceInfos[i];
    if (deviceInfo.kind == "audiooutput")
    {
      let option = document.createElement("option");
      option.value = deviceInfo.deviceId;
      option.text = deviceInfo.label || "Speaker " + (newSelect.length + 1);
      newSelect.appendChild(option);
      foundCards[deviceInfo.deviceId] = option.text;
    }
  }

  if (GT.settings.app.soundcards != null)
  {
    if (!(GT.settings.app.soundCard in foundCards))
    {
      if (GT.settings.app.soundCardName != null)
      {
        let foundId = false;
        // Search the found cards by name and see if we can find the right deviceId
        for (let deviceId in foundCards)
        {
          if (foundCards[deviceId] == GT.settings.app.soundCardName)
          {
            // Found it!
            GT.settings.app.soundCard = deviceId;
            foundId = true;
            break;
          }
        }
        if (foundId == false)
        {
          audioCardWarn(true);
        }
      }
      else
      {
        audioCardWarn(true);
      }
    }
    else
    {
      // Scan for differences
      let warn = false
      for (let soundcard in GT.settings.app.soundcards)
      {
        if (!(soundcard in foundCards))
        {
          warn = true;
          break;
        }
      }
      if (warn == false)
      {
        for (let soundcard in foundCards)
          {
            if (!(soundcard in GT.settings.app.soundcards))
            {
              warn = true;
              break;
            }
          }
      }
      if (warn == true)
      {
        audioCardWarn(false);
      }
    }
  }

  GT.settings.app.soundcards = Object.assign({}, foundCards);

  if (GT.settings.app.soundCard in GT.settings.app.soundcards) GT.settings.app.soundCardName = GT.settings.app.soundcards[GT.settings.app.soundCard];
  
  newSelect.oninput = soundCardChangedValue;
  soundCardDiv.appendChild(newSelect);
  soundCardInput.value = GT.settings.app.soundCard;

  // The Multi-Mode Decoder's Input Devices, checked the same way
  mmDecoderInputsCheck(deviceInfos);
}

// input: about the Multi-Mode Decoder's Input Devices. A warning already showing (the Output Device's, or an Input Device's) is kept, the
// new one under it
function audioCardWarn(didSetDefault, input = false)
{
  if (GT.settings.app.warnOnSoundcardsChange)
  {
    const key = input ? (didSetDefault ? "settings.audio.inputDefaultSet.label" : "settings.audio.inputDevicesChanged.label") : (didSetDefault == false ? "settings.audio.devicesChanged.label" : "settings.audio.deviceDefaultSet.label");
    if (warnSoundcardDiv.style.display != "block") GT.soundcardWarnings = [];
    const text = I18N(key);
    if (!GT.soundcardWarnings.includes(text)) GT.soundcardWarnings.push(text);
    warnSoundcardHtml.innerHTML = GT.soundcardWarnings.join("<br>");
    warnSoundcardDiv.style.display = "block";
  }
}

function soundCardChangedValue()
{
  GT.settings.app.soundCard = soundCardInput.value;
  if (GT.settings.app.soundCard in GT.settings.app.soundcards) GT.settings.app.soundCardName = GT.settings.app.soundcards[GT.settings.app.soundCard];
  playTestFile();
}

function mediaCheck()
{
  GT.LoTWLogFile = path.join(GT.appData, "LoTW_QSL.adif");
  GT.QrzLogFile = path.join(GT.appData, "qrz.adif");
  GT.clublogLogFile = path.join(GT.appData, "clublog.adif");

  logEventMedia.appendChild(newOption("none", I18N("settings.OAMS.message.newAlert.none")));

  alertMediaSelect.appendChild(newOption("none", I18N("alerts.addNew.SelectFile")));

  GT.mediaFiles = [ ...fs.readdirSync(GT.extraMediaDir), ...fs.readdirSync(GT.gtMediaDir) ];

  GT.mediaFiles.forEach((filename) =>
  {
    let noExt = path.parse(filename).name;
    logEventMedia.appendChild(newOption(filename, noExt));
    alertMediaSelect.appendChild(newOption(filename, noExt));

  });

  // data/modes.json: per mode { group, color, parentMode }. group is LoTW's mode group: DATA, PHONE, CW or IMAGE (SSTV, FAX, ATV);
  // GT.modes / GT.modes_phone keep their mode -> bool shape (digital: DATA, phone: PHONE). parentMode: a submode's ADIF mode (FT4:
  // MFSK, USB: SSB). A submode with no color of its own is shown in its parent's (applyModeColorSettings), and isn't in the Mode
  // filter or Mode Colors
  const modeData = requireJson("data/modes.json");
  GT.modes = {};
  GT.modes_phone = {};
  GT.modeColors = {};
  GT.modeGroup = {};
  GT.modeParent = {};
  GT.modeParentColor = {};
  for (const key in modeData)
  {
    const entry = modeData[key];
    GT.modes[key] = entry.group == "DATA";
    GT.modes_phone[key] = entry.group == "PHONE";
    GT.modeGroup[key] = entry.group;
    if (entry.parentMode) GT.modeParent[key] = entry.parentMode;
    if (entry.color)
    {
      GT.modeColors[key] = entry.color;
      gtModeFilter.appendChild(newOption(key));
    }
    else GT.modeParentColor[key] = true;
  }
  // Feeds name JS8 "JS8CALL"
  GT.modeColors.JS8CALL = GT.modeColors.JS8;

  let appName = I18N("settings.about.AppName");
  let gtName = electron.ipcRenderer.sendSync("getAppName");
  if (gtName.length > 0)
  {
    appName += " - " + gtName;
  }
  appTitle.innerHTML = aboutTitle.innerHTML = loadTitle.innerHTML = appName;
}

function newOption(value, text = null, selected = null)
{
  if (text == null) text = value;
  let option = document.createElement("option");
  option.value = value;
  option.text = text;
  if (selected != null) option.selected = selected;
  return option;
}
