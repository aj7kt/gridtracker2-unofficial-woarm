// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Multi-Mode Decoder's Log QSO buttons and menu items (shown with Log QSO on: Settings -> Logging, adifLog.logQso, off unless turned
// on). The decoder only says what it heard: each request goes down to the main window (window.opener.logQsoShow, logQso.js), which
// opens the Log QSO window (gt_logqso.html) filled in with it, and logs the QSO typed there as every QSO GridTracker logs is. The
// requests (logQsoCore.js fills in the form):
// - a row's right-click, Log QSO... (CW, PSK, RTTY, MFSK, DominoEX / THOR, Olivia), or an SSTV picture's: its call (the decoded text's),
//   its frequency on the air, time on its first character (the picture's start), the mode and submode decoded;
// - Log QSO on the second line, in those modes and Feld-Hell: the pinned row's (SSTV: the picture shown; Olivia: its signal), else
//   blank but for the mode, the frequency and the time;
// - Log Phone QSO on the top line, shown while Rig Control reads the decoder's VFO in a voice mode (or one it doesn't know), whatever
//   mode is shown: the rig's frequency and mode, time on when it opened; the call and park of the last Feed Roster spot clicked while
//   the rig is still on it (the main window's logQso.js).
// All times UTC

// (A plugin's mode: its submode, the signal it decodes with none pinned, and where and since when it hears one with no signal of its own:
// its registration's logQso, mmdPluginHost.js)
const LOGQSO = {};

function mmdLogQsoOn()
{
  return window.opener.logQsoOn();
}

// The modes it is in on the second line (logQsoCore.js: LOG_QSO_MODES)
function mmdLogQsoModeOk(mode = DEC.mode)
{
  return LOG_QSO_MODES.includes(mode);
}

// Four times a second (mmdRender): Log QSO on the second line in its modes, Log Phone QSO on the top line while the rig is in a voice
// mode
function mmdLogQsoTick()
{
  const on = mmdLogQsoOn();
  const bar = on && mmdLogQsoModeOk() ? "" : "none";
  if (cwLogQsoBox.style.display != bar) cwLogQsoBox.style.display = bar;
  let phone = "none";
  if (on)
  {
    const read = window.opener.mmDecoderVfoRead();
    const kind = read.up ? logQsoPhoneMode(read.mode).kind : "none";
    if (kind == "voice" || kind == "unknown") phone = "";
  }
  if (cwLogPhoneButton.style.display != phone) cwLogPhoneButton.style.display = phone;
}

// The mode showing's own for Log QSO (its registration's logQso: { sub, signalId, airHz, firstAt }), else {}
function mmdLogQsoOwn()
{
  const own = mmdPluginActive("logQso");
  return own && typeof own == "object" ? own : {};
}

// A row's right-click (mmDecoder.js): Log QSO... first, in its modes with it on
function mmdLogQsoMenu(id)
{
  if (!mmdLogQsoOn() || !mmdLogQsoModeOk()) return [];
  return [{ label: I18N("logQso.menu.label"), click: () => mmdLogQsoFromSignal(Number(id)) }, { type: "separator" }];
}

// An SSTV picture's right-click (the picture view, mmdPictures.js): Log QSO... first, with it on (not another kind's: WEFAX's charts)
function mmdLogQsoPictureMenu(pic)
{
  if (!mmdLogQsoOn() || !pic || pic.kind != "sstv") return [];
  return [{ label: I18N("logQso.menu.label"), click: () => mmdLogQsoFromPicture(pic) }, { type: "separator" }];
}

// A request to the main window: the Log QSO window opened, filled in with what the decoder heard (f: logQsoCore.js's fields)
function mmdLogQsoSend(f)
{
  if (f) window.opener.logQsoShow({ fields: f });
}

// The mode's submode as the window keeps it ("psk63", "dominoex 11", "olivia 8/500", "x5": a plugin's, its logQso's sub), else ""
function mmdLogQsoSub()
{
  return String(mmdLogQsoOwn().sub || "");
}

function mmdLogQsoMyCall()
{
  return String(GT.settings.app.myRawCall || GT.settings.app.myCall || "");
}

// A row's signal (its id): its call, frequency on the air, time on and mode
function mmdLogQsoFromSignal(id)
{
  const signal = DEC.signals[id];
  if (!signal || !mmdLogQsoModeOk()) return;
  mmdLogQsoSend(logQsoPrefillDigital({
    mmdMode: DEC.mode, sub: mmdLogQsoSub(), speed: signal.wpm, text: signal.text, firstAt: signal.firstAt || signal.last,
    airHz: signal.air, dialHz: mmdDial(), now: Date.now(), myCall: mmdLogQsoMyCall()
  }));
}

// An SSTV picture: its start, its mode in the comment, the frequency it came in on
function mmdLogQsoFromPicture(pic)
{
  mmdLogQsoSend(logQsoPrefillDigital({
    mmdMode: "sstv", now: Date.now(), myCall: mmdLogQsoMyCall(), pictureName: pic.name, pictureAt: pic.at, pictureDial: pic.dial, dialHz: mmdDial()
  }));
}

// Log QSO on the second line: the pinned row (SSTV the picture shown; a plugin's mode its logQso's signal: Olivia's), else the mode,
// the frequency (a plugin's logQso's airHz and firstAt: Feld-Hell's signal's) and the time alone
function mmdLogQsoFromBar()
{
  if (!mmdLogQsoModeOk()) return;
  if (mmdSstvMode())
  {
    const pic = mmdPicShown();
    if (pic && pic.kind == "sstv")
    {
      mmdLogQsoFromPicture(pic);
      return;
    }
  }
  const own = mmdLogQsoOwn();
  const id = DEC.focus != null && DEC.focus in DEC.signals ? DEC.focus : own.signalId != null && own.signalId in DEC.signals ? own.signalId : null;
  if (id != null)
  {
    mmdLogQsoFromSignal(id);
    return;
  }
  mmdLogQsoSend(logQsoPrefillDigital({
    mmdMode: DEC.mode, sub: mmdLogQsoSub(), now: Date.now(), myCall: mmdLogQsoMyCall(), dialHz: mmdDial(),
    airHz: own.airHz > 0 ? own.airHz : null, firstAt: own.firstAt || 0
  }));
}

// Log Phone QSO on the top line: the decoder's VFO's frequency and voice mode (the main window adds the last Feed Roster spot clicked,
// while the rig is still on it)
function mmdLogQsoPhone()
{
  const read = window.opener.mmDecoderVfoRead();
  window.opener.logQsoShow({ phone: { rigMode: read.up ? read.mode : "", dialHz: read.up ? read.freq : 0, spot: window.opener.logQsoLastSpot(), fromSpot: false } });
}
