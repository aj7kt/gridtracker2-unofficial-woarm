// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// WEFAX's Auto-Tune (its checkbox on the WEFAX row; this session's only, off at each start): the stations' published chart schedules
// (resources/data/wefax-schedule.json) say which chart starts next and where; the rig is tuned there (through Rig Control, as the Frequency
// menu tunes it) a little before, the chart's start tone starts the picture as always, and once it is over the next chart anywhere is
// tuned for. Nothing is ever sent but the frequency and USB; tuning the rig by hand (its dial, the Frequency menu) turns it off.
// A station with several frequencies on the air then: the one that copied last time, else one suited to the hour (lower at night, higher
// by day, the receiver's local time), and one whose chart never started (no start tone heard) is passed over for a while

// Tuned this long before a chart starts (ms), and a chart started this long ago is still waited for (its start tone and phasing take
// about 35 s)
const WEFAX_AUTO_LEAD_MS = 90000;
const WEFAX_AUTO_LATE_MS = 20000;
// A chart whose start tone hasn't come this long after its time: its frequency is passed over for WEFAX_AUTO_SKIP_MS
const WEFAX_AUTO_MISS_MS = 4 * 60000;
const WEFAX_AUTO_SKIP_MS = 6 * 3600000;
// The rig read back further than this from where it was tuned (Hz), once it has had time to get there: tuned by hand
const WEFAX_AUTO_MOVED_HZ = 100;
const WEFAX_AUTO_SETTLE_MS = 5000;
// The frequency suited to the hour (kHz): at night (19:00 to 07:00, local), and by day
const WEFAX_AUTO_NIGHT_KHZ = 8000;
const WEFAX_AUTO_DAY_KHZ = 13000;
// Looked at this often (ms)
const WEFAX_AUTO_TICK_MS = 5000;

const WEFAX_AUTO = {
  on: false,
  data: null,      // the schedule file, read once
  next: null,      // the chart tuned for: { at (ms), station, chart, khz, dial (Hz) }
  tunedAt: 0,      // when the rig was tuned for it (ms)
  dial: null,      // where it was tuned (Hz)
  started: false,  // its chart began (a start tone heard after it was tuned)
  good: {},        // the frequency that copied last, by station id (kHz)
  skip: {},        // frequencies passed over until (ms), by "station|kHz"
  tickAt: 0
};

function mmdWefaxAutoData()
{
  if (WEFAX_AUTO.data) return WEFAX_AUTO.data;
  try
  {
    WEFAX_AUTO.data = JSON.parse(fs.readFileSync(path.join(resourcesPath, "data", "wefax-schedule.json"), "utf8"));
  }
  catch (e)
  {
    WEFAX_AUTO.data = { stations: [] };
  }
  if (!Array.isArray(WEFAX_AUTO.data.stations)) WEFAX_AUTO.data.stations = [];
  return WEFAX_AUTO.data;
}

// "HH:MM" (UTC) as minutes into the day
function mmdWefaxAutoMinutes(hhmm)
{
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// A chart sent on the day of ms (UTC): its days ("weekdays", ["Mon", ...]) and days of the month (monthDays: [20, 21]), none every day
function mmdWefaxAutoOnDay(chart, ms)
{
  if (Array.isArray(chart.monthDays) && !chart.monthDays.includes(new Date(ms).getUTCDate())) return false;
  const days = chart.days;
  if (!days) return true;
  const day = new Date(ms).getUTCDay();
  if (days == "weekdays") return day >= 1 && day <= 5;
  if (days == "weekends") return day == 0 || day == 6;
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return Array.isArray(days) && days.includes(names[day]);
}

// A frequency on the air at ms: inside its window (from, to UTC; none: all day)
function mmdWefaxAutoOnAir(f, ms)
{
  const from = mmdWefaxAutoMinutes(f.from), to = mmdWefaxAutoMinutes(f.to);
  if (from == null || to == null) return true;
  const d = new Date(ms);
  const now = d.getUTCHours() * 60 + d.getUTCMinutes();
  return from <= to ? now >= from && now < to : now >= from || now < to;
}

// The frequency to receive a station's chart at ms on (kHz), else null: on the air then (and one the chart is sent on, where the schedule
// names some: its khz), not passed over; the one that copied last, else the nearest the hour suits
function mmdWefaxAutoFreq(station, ms, chart = {})
{
  const now = Date.now();
  const only = chart.khz == null ? null : [].concat(chart.khz).map(Number);
  const list = (station.frequencies || []).filter((f) => f.khz > 0 && (!only || only.includes(f.khz)) && mmdWefaxAutoOnAir(f, ms) && !((WEFAX_AUTO.skip[station.id + "|" + f.khz] || 0) > now));
  if (!list.length) return null;
  const good = WEFAX_AUTO.good[station.id];
  if (good && list.some((f) => f.khz == good)) return good;
  const hour = new Date(ms).getHours();
  const want = hour >= 19 || hour < 7 ? WEFAX_AUTO_NIGHT_KHZ : WEFAX_AUTO_DAY_KHZ;
  list.sort((a, b) => Math.abs(a.khz - want) - Math.abs(b.khz - want));
  return list[0].khz;
}

// The next chart anywhere: the soonest one starting from a little ago (WEFAX_AUTO_LATE_MS), on a frequency that can be tuned
function mmdWefaxAutoFind(from = Date.now())
{
  let best = null;
  const day = 86400000;
  const midnight = Math.floor(from / day) * day;
  for (const station of mmdWefaxAutoData().stations)
  {
    for (const chart of station.charts || [])
    {
      // (One sent only now and then, its note says when: a tropical cyclone, the season, the ice; not waited for)
      const minutes = chart.note ? null : mmdWefaxAutoMinutes(chart.time);
      if (minutes == null) continue;
      // Today's or tomorrow's
      for (const base of [midnight, midnight + day])
      {
        const at = base + minutes * 60000;
        if (at < from - WEFAX_AUTO_LATE_MS || !mmdWefaxAutoOnDay(chart, at)) continue;
        if (best && at >= best.at) break;
        const khz = mmdWefaxAutoFreq(station, at, chart);
        if (khz) best = { at, station, chart, khz, dial: Math.round(khz * 1000 - 1900) };
        break;
      }
    }
  }
  return best;
}

// The checkbox
function mmdWefaxAutoToggle()
{
  WEFAX_AUTO.on = cwWefaxAuto.checked;
  WEFAX_AUTO.next = null;
  WEFAX_AUTO.dial = null;
  WEFAX_AUTO.tickAt = 0;
  if (WEFAX_AUTO.on && GT.settings.MMD.rigControl !== true)
  {
    // It can't tune without Rig Control: said so, and left off
    WEFAX_AUTO.on = false;
    cwWefaxAuto.checked = false;
    mmdStatus(I18N("cwViewer.wefax.auto.noRig"), true);
  }
  // On again: the last "off" said no more
  else if (WEFAX_AUTO.on && DEC.running) mmdStatus(I18N("cwViewer.status.listening"));
  mmdWefaxAutoTick();
}

// Off (tuned by hand, another mode), saying why
function mmdWefaxAutoStop(why)
{
  if (!WEFAX_AUTO.on) return;
  WEFAX_AUTO.on = false;
  WEFAX_AUTO.next = null;
  WEFAX_AUTO.dial = null;
  cwWefaxAuto.checked = false;
  if (why) mmdStatus(why);
  mmdWefaxAutoShow();
}

// A WEFAX chart began (mmdSstv.js): the one tuned for has started, its frequency good for this station
function mmdWefaxAutoStarted()
{
  const n = WEFAX_AUTO.next;
  if (!WEFAX_AUTO.on || !n || Date.now() < WEFAX_AUTO.tunedAt) return;
  WEFAX_AUTO.started = true;
  WEFAX_AUTO.good[n.station.id] = n.khz;
}

// From mmdRender: every WEFAX_AUTO_TICK_MS, the chart tuned for followed, and the next one tuned for when it's time
function mmdWefaxAutoTick()
{
  if (!WEFAX_AUTO.on)
  {
    mmdWefaxAutoShow();
    return;
  }
  const now = Date.now();
  if (now - WEFAX_AUTO.tickAt < WEFAX_AUTO_TICK_MS) return;
  WEFAX_AUTO.tickAt = now;
  if (DEC.mode != "wefax")
  {
    mmdWefaxAutoStop("");
    return;
  }
  // Tuned by hand since (the rig read elsewhere, once it had time to get there): off
  const dial = mmdDial();
  if (WEFAX_AUTO.dial != null && dial != null && now - WEFAX_AUTO.tunedAt > WEFAX_AUTO_SETTLE_MS && Math.abs(dial - WEFAX_AUTO.dial) > WEFAX_AUTO_MOVED_HZ)
  {
    mmdWefaxAutoStop(I18N("cwViewer.wefax.auto.byHand"));
    return;
  }
  // A chart coming in: received to its end, whatever its schedule
  if (SSTV.live && SSTV.live.kind == "wefax")
  {
    mmdWefaxAutoShow();
    return;
  }
  const n = WEFAX_AUTO.next;
  if (n)
  {
    // Its chart came and went: the next
    if (WEFAX_AUTO.started) WEFAX_AUTO.next = null;
    // Never started: its frequency passed over a while, the next
    else if (now > n.at + WEFAX_AUTO_MISS_MS)
    {
      WEFAX_AUTO.skip[n.station.id + "|" + n.khz] = now + WEFAX_AUTO_SKIP_MS;
      if (WEFAX_AUTO.good[n.station.id] == n.khz) delete WEFAX_AUTO.good[n.station.id];
      WEFAX_AUTO.next = null;
    }
  }
  if (!WEFAX_AUTO.next)
  {
    WEFAX_AUTO.next = mmdWefaxAutoFind(now);
    WEFAX_AUTO.started = false;
  }
  const next = WEFAX_AUTO.next;
  // Its time near: the rig tuned there (once)
  if (next && WEFAX_AUTO.dial != next.dial && now >= next.at - WEFAX_AUTO_LEAD_MS)
  {
    const vfo = window.opener.mmDecoderVfo();
    if (mmdTuneDial(next.dial, "USB", !!vfo && vfo.ssbData === true))
    {
      WEFAX_AUTO.dial = next.dial;
      WEFAX_AUTO.tunedAt = now;
    }
  }
  mmdWefaxAutoShow();
}

// What it's doing, beside its checkbox: the chart tuned for (or the next), its station, frequency and time
function mmdWefaxAutoShow()
{
  let text = "";
  const n = WEFAX_AUTO.on ? WEFAX_AUTO.next : null;
  if (WEFAX_AUTO.on && !n) text = I18N("cwViewer.wefax.auto.none");
  else if (n)
  {
    const minutes = Math.round((n.at - Date.now()) / 60000);
    const when = new Date(n.at).toISOString().slice(11, 16) + " UTC" + (minutes > 0 ? " (" + I18N("cwViewer.wefax.auto.in").replace("{minutes}", minutes) + ")" : "");
    text = n.station.id + " " + n.khz + " kHz · " + (n.chart.title || "") + " · " + when;
  }
  if (cwWefaxAutoText.textContent != text)
  {
    cwWefaxAutoText.textContent = text;
    cwWefaxAutoText.title = n ? [n.station.id, n.station.name, n.khz + " kHz", n.chart.title, n.chart.area].filter(Boolean).join(" · ") : "";
  }
}
