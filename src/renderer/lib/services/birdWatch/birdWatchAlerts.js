// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// BirdWatch pass alerts (BirdWatch settings, Alerts): a tracked satellite about to rise is announced a few minutes before its AOS, and
// when it rises, by voice (the Audio Alerts' speech settings), in the traffic list, and with Pushover or Simplepush (Settings,
// Online). Only passes that climb high enough are announced, and each only once

const BIRD_WATCH_ALERT_KEEP_MS = 24 * 3600000;

function birdWatchAlertsUpdate()
{
  const A = GT.settings.birdWatch.alerts;
  if (!A.enable) return;
  const T = GT.birdWatchTrack;
  const done = T.alerted || (T.alerted = new Map());
  const now = Date.now();
  for (const [key, when] of done) if (now - when > BIRD_WATCH_ALERT_KEEP_MS) done.delete(key);

  for (const norad of GT.settings.birdWatch.tracked)
  {
    const sat = T.last.get(norad);
    if (!sat || sat.error) continue;
    const pass = birdWatchWantPasses(norad);
    // A pass that was already under way when its list was made is not announced (BirdWatch was only just turned on)
    if (!pass || pass.inProgress || pass.maxEl < A.minElevation) continue;
    const key = norad + "|" + Math.round(pass.aos / 1000);
    const toAos = pass.aos - now;
    if (toAos > 0 && toAos <= A.minutes * 60000 && !done.has(key + "|soon"))
    {
      done.set(key + "|soon", now);
      const minutes = Math.max(1, Math.round(toAos / 60000));
      birdWatchAlertSend(norad, I18N(minutes == 1 ? "birdWatch.alerts.soon.one" : "birdWatch.alerts.soon").replace("{n}", minutes).replace("{el}", Math.round(pass.maxEl)));
    }
    if (A.atAos && toAos <= 0 && sat.up && !done.has(key + "|rising"))
    {
      done.set(key + "|rising", now);
      birdWatchAlertSend(norad, I18N("birdWatch.alerts.rising").replace("{az}", Math.round(pass.aosAz)));
    }
  }
}

// One announcement, by each way that is turned on
function birdWatchAlertSend(norad, text)
{
  const A = GT.settings.birdWatch.alerts;
  const tle = birdWatchTleGet(norad);
  const message = text.replace("{name}", tle ? tle.name : norad);
  if (A.speech) birdWatchSpeak(message);
  if (A.traffic) addLastTraffic("<font style='color:cyan'>" + htmlEntities(message) + "</font>");
  if (A.push && !GT.settings.map.offlineMode) birdWatchAlertPush("BirdWatch - " + formatCallsign(GT.settings.app.myCall), message);
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
function birdWatchAlertPush(title, message)
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
  const A = GT.settings.birdWatch.alerts;
  birdWatchAlertEnable.checked = A.enable;
  birdWatchAlertMinutes.value = A.minutes;
  birdWatchAlertMinutesText.textContent = A.minutes;
  birdWatchAlertMinEl.value = A.minElevation;
  birdWatchAlertMinElText.textContent = A.minElevation + "°";
  birdWatchAlertAtAos.checked = A.atAos;
  birdWatchAlertSpeech.checked = A.speech;
  birdWatchAlertTraffic.checked = A.traffic;
  birdWatchAlertPush.checked = A.push;
}

function birdWatchAlertsChange()
{
  const A = GT.settings.birdWatch.alerts;
  A.enable = birdWatchAlertEnable.checked;
  A.minutes = Number(birdWatchAlertMinutes.value);
  A.minElevation = Number(birdWatchAlertMinEl.value);
  A.atAos = birdWatchAlertAtAos.checked;
  A.speech = birdWatchAlertSpeech.checked;
  A.traffic = birdWatchAlertTraffic.checked;
  A.push = birdWatchAlertPush.checked;
  birdWatchAlertMinutesText.textContent = A.minutes;
  birdWatchAlertMinElText.textContent = A.minElevation + "°";
}

// Sounds the way it will (by voice and in the traffic list; not pushed to the phone), for the satellite selected or the first tracked
function birdWatchAlertTest()
{
  const A = GT.settings.birdWatch.alerts;
  const norad = GT.birdWatchTrack && GT.birdWatchTrack.selected ? GT.birdWatchTrack.selected : GT.settings.birdWatch.tracked[0];
  const tle = norad ? birdWatchTleGet(norad) : null;
  const message = I18N("birdWatch.alerts.soon").replace("{n}", A.minutes).replace("{el}", 45).replace("{name}", tle ? tle.name : "ISS");
  if (A.speech) birdWatchSpeak(message);
  addLastTraffic("<font style='color:cyan'>" + htmlEntities(message) + "</font>");
}
