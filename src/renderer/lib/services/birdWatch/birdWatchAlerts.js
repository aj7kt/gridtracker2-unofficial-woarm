// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// BirdWatch pass alerts (BirdWatch settings, Alerts): a tracked satellite about to rise is announced a few minutes before its AOS, and
// when it rises, by voice (the Audio Alerts' speech settings), in the traffic list, and with Pushover or Simplepush (Settings,
// Online). Only passes that climb high enough are announced, and each only once

const BIRD_WATCH_ALERT_KEEP_MS = 24 * 3600000;
// Worked out again (the element sets rebuilt, the station moved), a pass's AOS can move by a second: one announced is the same pass when
// its satellite matches and it rises within this long of it
const BIRD_WATCH_ALERT_SAME_MS = 2 * 60000;

function birdWatchAlertsUpdate()
{
  const A = GT.settings.BirdWatch.alerts;
  if (!A.enable) return;
  const T = GT.birdWatchTrack;
  // Each satellite's announcements of a kind ("norad|soon", "norad|rising"): [{ aos, at (when it was announced) }], kept a day
  const done = T.alerted || (T.alerted = new Map());
  const now = Date.now();
  for (const [key, list] of done)
  {
    const kept = list.filter((x) => now - x.at <= BIRD_WATCH_ALERT_KEEP_MS);
    if (kept.length) done.set(key, kept);
    else done.delete(key);
  }
  // True the first time a pass is announced this way (it is noted then)
  const first = (key, aos) =>
  {
    const list = done.get(key) || [];
    if (list.some((x) => Math.abs(x.aos - aos) < BIRD_WATCH_ALERT_SAME_MS)) return false;
    list.push({ aos: aos, at: now });
    done.set(key, list);
    return true;
  };

  for (const norad of GT.settings.BirdWatch.tracked)
  {
    const sat = T.last.get(norad);
    if (!sat || sat.error) continue;
    const pass = birdWatchWantPasses(norad);
    // A pass that was already under way when its list was made is not announced (BirdWatch was only just turned on)
    if (!pass || pass.inProgress || pass.maxEl < A.minElevation) continue;
    const toAos = pass.aos - now;
    if (toAos > 0 && toAos <= A.minutes * 60000 && first(norad + "|soon", pass.aos))
    {
      birdWatchAlertSend(birdWatchAlertMessage("soon", birdWatchAlertName(norad), Math.max(1, Math.round(toAos / 60000)), Math.round(pass.maxEl)));
    }
    if (A.atAos && toAos <= 0 && sat.up && first(norad + "|rising", pass.aos))
    {
      birdWatchAlertSend(birdWatchAlertMessage("rising", birdWatchAlertName(norad), null, Math.round(pass.aosAz)));
    }
  }
}

function birdWatchAlertName(norad)
{
  const tle = birdWatchTleGet(norad);
  return tle ? tle.name : String(norad);
}

// The built-in wording (translated), as the user's own is written: {N} the name, {T} the minutes, {D} the degrees (the max elevation
// before AOS, the azimuth as it rises)
function birdWatchAlertBuiltIn(kind, minutes = 2)
{
  const key = kind == "rising" ? "birdWatch.alerts.rising" : minutes == 1 ? "birdWatch.alerts.soon.one" : "birdWatch.alerts.soon";
  return I18N(key).replace("{name}", "{N}").replace("{n}", "{T}").replace("{el}", "{D}").replace("{az}", "{D}");
}

// An announcement: the user's wording (settings.BirdWatch.alerts soonText / risingText) or, when there is none, the built-in one; its
// tokens filled in
function birdWatchAlertMessage(kind, name, minutes, degrees)
{
  const A = GT.settings.BirdWatch.alerts;
  const own = String((kind == "rising" ? A.risingText : A.soonText) || "").trim();
  const text = own || birdWatchAlertBuiltIn(kind, minutes);
  return text.split("{N}").join(name).split("{T}").join(minutes === null ? "" : String(minutes)).split("{D}").join(String(degrees));
}

// One announcement, by each way that is turned on
function birdWatchAlertSend(message)
{
  const A = GT.settings.BirdWatch.alerts;
  if (A.speech) birdWatchSpeak(message);
  if (A.traffic) addEvent("birdwatch", "<font style='color:cyan'>" + htmlEntities(message) + "</font>");
  if (A.push && !GT.settings.map.offlineMode) birdWatchAlertPushSend("BirdWatch - " + formatCallsign(GT.settings.app.myCall), message);
}

// The voice, rate and volume of the Audio Alerts' speech, and its mute
function birdWatchSpeak(text)
{
  if (GT.settings.audio.alertMute != 0 || !GT.speechAvailable) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = GT.localeString;
  if (GT.settings.audio.speechVoice > 0) utterance.voice = GT.voices[GT.settings.audio.speechVoice - 1];
  utterance.rate = GT.settings.audio.speechRate;
  utterance.pitch = GT.settings.audio.speechPitch;
  utterance.volume = GT.settings.audio.speechVolume;
  window.speechSynthesis.speak(utterance);
}

// Pushover and Simplepush as the Call Roster's alerts use them: their daily schedules are kept
// (Not named birdWatchAlertPush: that is the Alerts tab's checkbox, which a function of the same name would hide)
function birdWatchAlertPushSend(title, message)
{
  const msg = GT.settings.msg;
  if (msg.msgPushover && (!msg.msgPushoverDailySchedule || isWithinScheduledMinutes(msg.msgPushoverScheduleStart, msg.msgPushoverScheduleEnd)))
  {
    getPostBuffer("https://api.pushover.net/1/messages.json", null, null, "https", 443, { user: msg.msgPushoverUserKey, token: msg.msgPushoverToken, title: title, message: message }, 5000);
  }
  if (msg.msgSimplepush && (!msg.msgSimplepushDailySchedule || isWithinScheduledMinutes(msg.msgSimplepushScheduleStart, msg.msgSimplepushScheduleEnd)))
  {
    getPostJSONBuffer(
      "https://api.simplepu.sh/v1/" + (msg.msgSimplepushNotifyOnly ? "notifications" : "tasks") + "/json",
      null, false, "https", 443, { title: title, content: message, contentFormat: "markdown" }, 5000, undefined, undefined, { "API-Token": msg.msgSimplepushApiKey }
    );
  }
}

// ---- The Alerts tab

function birdWatchAlertsRender()
{
  const A = GT.settings.BirdWatch.alerts;
  birdWatchAlertEnable.checked = A.enable;
  birdWatchAlertMinutes.value = A.minutes;
  birdWatchAlertMinutesText.textContent = A.minutes;
  birdWatchAlertMinEl.value = A.minElevation;
  birdWatchAlertMinElText.textContent = A.minElevation + "°";
  birdWatchAlertAtAos.checked = A.atAos;
  birdWatchAlertSpeech.checked = A.speech;
  birdWatchAlertTraffic.checked = A.traffic;
  birdWatchAlertPush.checked = A.push;
  // The wording boxes: the user's own, the built-in one as the placeholder; the rising one only while it is announced
  birdWatchAlertSoonText.value = A.soonText || "";
  birdWatchAlertSoonText.placeholder = birdWatchAlertBuiltIn("soon");
  birdWatchAlertRisingText.value = A.risingText || "";
  birdWatchAlertRisingText.placeholder = birdWatchAlertBuiltIn("rising");
  birdWatchAlertMutual.checked = A.mutual === true;
  birdWatchAlertMutualText.value = A.mutualText || "";
  birdWatchAlertMutualText.placeholder = birdWatchSkedAlertBuiltIn();
  birdWatchAlertRowsShow();
}

// The rows under the two announcements (their data-for): the passes' own only while Announce Upcoming Passes is on (the rising wording
// only while that is announced), the mutual wording only while Announce Mutual Passes is, the minutes and the ways while either is
function birdWatchAlertRowsShow()
{
  const A = GT.settings.BirdWatch.alerts;
  for (const row of birdWatchAlertEnable.closest("table").rows)
  {
    const kind = row.dataset.for;
    if (!kind) continue;
    const shown = kind == "pass" ? A.enable && (row !== birdWatchAlertRisingTextTr || A.atAos) : kind == "mutual" ? A.mutual === true : A.enable || A.mutual === true;
    row.style.display = shown ? "" : "none";
  }
}

function birdWatchAlertsChange()
{
  const A = GT.settings.BirdWatch.alerts;
  A.enable = birdWatchAlertEnable.checked;
  A.minutes = Number(birdWatchAlertMinutes.value);
  A.minElevation = Number(birdWatchAlertMinEl.value);
  A.atAos = birdWatchAlertAtAos.checked;
  A.speech = birdWatchAlertSpeech.checked;
  A.traffic = birdWatchAlertTraffic.checked;
  A.push = birdWatchAlertPush.checked;
  A.soonText = birdWatchAlertSoonText.value.trim();
  A.risingText = birdWatchAlertRisingText.value.trim();
  A.mutual = birdWatchAlertMutual.checked;
  A.mutualText = birdWatchAlertMutualText.value.trim();
  birdWatchAlertMinutesText.textContent = A.minutes;
  birdWatchAlertMinElText.textContent = A.minElevation + "°";
  birdWatchAlertRowsShow();
}

// Sounds the way it will (by voice, in the traffic list, and pushed with Pushover / Simplepush while that is on), for the satellite
// selected or the first tracked
function birdWatchAlertTest()
{
  const A = GT.settings.BirdWatch.alerts;
  const norad = GT.birdWatchTrack && GT.birdWatchTrack.selected ? GT.birdWatchTrack.selected : GT.settings.BirdWatch.tracked[0];
  const message = birdWatchAlertMessage("soon", norad ? birdWatchAlertName(norad) : "ISS", A.minutes, 45);
  if (A.speech) birdWatchSpeak(message);
  addEvent("birdwatch", "<font style='color:cyan'>" + htmlEntities(message) + "</font>");
  if (A.push && !GT.settings.map.offlineMode) birdWatchAlertPushSend("BirdWatch - " + formatCallsign(GT.settings.app.myCall), message);
}
