// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// BirdWatch pass export (a button in the Pass Timeline): the next three days of passes of the tracked satellites that climb at least
// the Alerts' lowest max elevation, as an iCalendar (.ics) file for a phone or desktop calendar, each with a reminder before it rises.
// Saved with the same file dialog as the SOTA chaser export

const BIRD_WATCH_EXPORT_HOURS = 72;

function birdWatchExportPasses()
{
  const T = GT.birdWatchTrack;
  if (!T || !T.worker) return;
  T.exporting = { wanted: new Set(GT.settings.birdWatch.tracked), lists: new Map() };
  for (const norad of T.exporting.wanted) T.worker.postMessage({ type: "passes", id: "export", norad: norad, hours: BIRD_WATCH_EXPORT_HOURS });
}

// From the tracker: each satellite's passes arrive; with all of them the file is made
function birdWatchExportCollect(m)
{
  const T = GT.birdWatchTrack;
  if (m.id != "export" || !T.exporting || !T.exporting.wanted.has(m.norad)) return;
  T.exporting.lists.set(m.norad, m.passes || []);
  T.exporting.wanted.delete(m.norad);
  if (T.exporting.wanted.size > 0) return;
  const lists = T.exporting.lists;
  T.exporting = null;
  birdWatchExportSave(lists);
}

function birdWatchIcsTime(ms)
{
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

function birdWatchIcsText(text)
{
  return String(text).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function birdWatchIcs(lists)
{
  const A = GT.settings.birdWatch.alerts;
  const stamp = birdWatchIcsTime(Date.now());
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//GridTracker2//BirdWatch//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  let count = 0;
  const events = [];
  for (const [norad, passes] of lists)
  {
    const tle = birdWatchTleGet(norad);
    const name = tle ? tle.name : String(norad);
    for (const pass of passes)
    {
      if (pass.maxEl < A.minElevation || pass.inProgress) continue;
      events.push({ name, norad, pass });
    }
  }
  events.sort((a, b) => a.pass.aos - b.pass.aos);
  for (const { name, norad, pass } of events)
  {
    count++;
    lines.push(
      "BEGIN:VEVENT",
      "UID:" + norad + "-" + Math.round(pass.aos / 1000) + "@gridtracker2",
      "DTSTAMP:" + stamp,
      "DTSTART:" + birdWatchIcsTime(pass.aos),
      "DTEND:" + birdWatchIcsTime(pass.los),
      "SUMMARY:" + birdWatchIcsText(name + " pass (max " + Math.round(pass.maxEl) + "°)"),
      "DESCRIPTION:" + birdWatchIcsText(
        "AOS " + Math.round(pass.aosAz) + "° - LOS " + Math.round(pass.losAz) + "°\nMax elevation " + pass.maxEl.toFixed(1) + "°\nDuration " + toDHMS((pass.los - pass.aos) / 1000) + (pass.visible ? "\nVisible pass" : "")),
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "DESCRIPTION:" + birdWatchIcsText(name + " rises in " + A.minutes + " minutes"),
      "TRIGGER:-PT" + A.minutes + "M",
      "END:VALARM",
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return { text: lines.join("\r\n") + "\r\n", count: count };
}

function birdWatchExportSave(lists)
{
  const ics = birdWatchIcs(lists);
  if (ics.count == 0)
  {
    addLastTraffic("<font style='color:yellow'>" + I18N("birdWatch.export.none") + "</font>");
    return;
  }
  const result = electron.ipcRenderer.sendSync("saveTextFile", {
    title: I18N("birdWatch.export.title"),
    defaultPath: "BirdWatch_" + new Date().toISOString().slice(0, 10) + ".ics",
    content: ics.text,
    filters: [{ name: "iCalendar", extensions: ["ics"] }, { name: "All Files", extensions: ["*"] }]
  });
  if (result && result.error)
  {
    addLastTraffic("<font style='color:red'>" + htmlEntities(result.error) + "</font>");
    return;
  }
  if (result) addLastTraffic("<font style='color:white'>" + htmlEntities(I18N("birdWatch.export.saved").replace("{n}", ics.count).replace("{file}", result)) + "</font>");
}
