// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The WEFAX plugin's Auto-Tune (its checkbox on the WEFAX row; this session's only, off at each start): the stations' published chart
// schedules (wefax-schedule.json, beside this file) say which chart starts next and where; the rig is tuned there (through Rig Control, as the Frequency
// menu tunes it) a little before, the chart's start tone starts the picture as always, and once it is over the next chart anywhere is
// tuned for. Nothing is ever sent but the frequency and USB; tuning the rig by hand (its dial, the Frequency menu) turns it off.
// A chart is chosen by where its transmitter is from your locator: ground wave first, then the first F2 hop, avoiding the skip zone
// (between the ground wave and the first hop), and only as a last resort a sporadic-E or two-hop path. Frequencies whose chart never
// started (no start tone heard) are passed over for a while.

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
// A reliable (ground wave or one-hop) chart starting within this wait is preferred; after it a marginal path may be taken
const WEFAX_AUTO_LOOKAHEAD_MS = 60 * 60000;
// Path margins: a one-hop path must be this far below the MUF, a two-hop path further still
const WEFAX_AUTO_MUF_MARGIN = 0.9;
const WEFAX_AUTO_TWO_HOP_MARGIN = 0.75;
// The longest one-hop and two-hop ground distances (km)
const WEFAX_AUTO_HOP_MAX_KM = 4000;
const WEFAX_AUTO_TWO_HOP_MAX_KM = 8000;
// The MUF at a distance divided by foF2 (ITU-style single-hop curve), 0 to 4000 km
const WEFAX_AUTO_MUF_POINTS = [[0, 1.0], [500, 1.29], [1000, 1.85], [1500, 2.39], [2000, 2.81], [2500, 3.10], [3000, 3.28], [4000, 3.50]];
// foF2 at mid-latitudes, approximately: solar maximum day/night and solar minimum day/night (MHz)
const WEFAX_AUTO_FOF2_DAY_MIN = 7;
const WEFAX_AUTO_FOF2_DAY_MAX = 10;
const WEFAX_AUTO_FOF2_NIGHT_MIN = 2.5;
const WEFAX_AUTO_FOF2_NIGHT_MAX = 5;
// Solar Cycle 25, roughly: index 1.0 near the maximum (2024-2026), falling to 0.2 by 2032
const WEFAX_AUTO_SOLAR = [[2023, 0.9], [2024, 1.0], [2025, 1.0], [2026, 0.95], [2027, 0.85], [2028, 0.70], [2029, 0.50], [2030, 0.35], [2031, 0.25], [2032, 0.20]];
// Ground-wave working radius at 4 kW (km) by frequency (MHz); scaled by sqrt(power / 4)
const WEFAX_AUTO_GROUND_POINTS = [[2, 200], [2.6, 195], [3.5, 150], [4, 135], [4.5, 115], [5.5, 95], [7, 75], [8, 60], [9.5, 45], [11, 31], [12.6, 24], [14, 20], [16, 15], [18, 11], [20.5, 7], [22.5, 5], [30, 3]];
// Sporadic E (MHz, km): a possible short path when F2 skips over the receiver
const WEFAX_AUTO_ES_MIN_MHZ = 10;
const WEFAX_AUTO_ES_MAX_MHZ = 22;
const WEFAX_AUTO_ES_MIN_KM = 600;
const WEFAX_AUTO_ES_MAX_KM = 2200;
// Daytime D-layer absorption (MHz): below the hard floor unusable, below the soft floor marginal
const WEFAX_AUTO_LUF_DAY_HARD_MHZ = 3.5;
const WEFAX_AUTO_LUF_DAY_SOFT_MHZ = 5;
const WEFAX_AUTO_EARTH_KM = 6371.009;

const WEFAX_AUTO = {
  on: false,
  data: null,      // the schedule file, read once
  next: null,      // the chart tuned for: { at (ms), station, chart, khz, path, dial (Hz) }
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
    WEFAX_AUTO.data = JSON.parse(fs.readFileSync(WEFAX.host.file("wefax-schedule.json"), "utf8"));
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

// A chart sent on the day of ms (UTC): the station's or chart's months, days ("weekdays", ["Mon", ...]) and days of the month
function mmdWefaxAutoOnDay(station, chart, ms)
{
  const date = new Date(ms);
  const month = date.getUTCMonth() + 1;
  if (Array.isArray(station.months) && !station.months.includes(month)) return false;
  if (Array.isArray(chart.months) && !chart.months.includes(month)) return false;
  if (Array.isArray(chart.monthDays) && !chart.monthDays.includes(date.getUTCDate())) return false;
  const days = chart.days;
  if (!days) return true;
  const day = date.getUTCDay();
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

// Your place as { lat, lon }, or null with no locator set
function mmdWefaxAutoMyPlace()
{
  const H = WEFAX.host;
  if (String(H.myGrid() || "").length < 4) return null;
  const lat = Number(H.myLat()), lon = Number(H.myLon());
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

// The solar cycle index (0.2 to 1.0) for a time
function mmdWefaxAutoSolarIndex(ms)
{
  const d = new Date(ms);
  const year = d.getUTCFullYear() + d.getUTCMonth() / 12;
  if (year <= WEFAX_AUTO_SOLAR[0][0]) return WEFAX_AUTO_SOLAR[0][1];
  for (let i = 1; i < WEFAX_AUTO_SOLAR.length; i++)
  {
    const a = WEFAX_AUTO_SOLAR[i - 1], b = WEFAX_AUTO_SOLAR[i];
    if (year <= b[0]) return a[1] + (b[1] - a[1]) * (year - a[0]) / (b[0] - a[0]);
  }
  return WEFAX_AUTO_SOLAR[WEFAX_AUTO_SOLAR.length - 1][1];
}

// Solar local time in hours at a longitude
function mmdWefaxAutoLocalHour(lon, ms)
{
  const d = new Date(ms);
  let hour = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600 + lon / 15;
  hour %= 24;
  return hour < 0 ? hour + 24 : hour;
}

// The great-circle distance between two places (km)
function mmdWefaxAutoDistanceKm(lat1, lon1, lat2, lon2)
{
  const r = Math.PI / 180;
  const p1 = lat1 * r, p2 = lat2 * r;
  const dp = (lat2 - lat1) * r, dl = (lon2 - lon1) * r;
  const a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * WEFAX_AUTO_EARTH_KM;
}

// The midpoint of the great-circle path between two places
function mmdWefaxAutoMidpoint(lat1, lon1, lat2, lon2)
{
  const r = Math.PI / 180;
  const p1 = lat1 * r, l1 = lon1 * r, p2 = lat2 * r, l2 = lon2 * r;
  const x = Math.cos(p1) * Math.cos(l1) + Math.cos(p2) * Math.cos(l2);
  const y = Math.cos(p1) * Math.sin(l1) + Math.cos(p2) * Math.sin(l2);
  const z = Math.sin(p1) + Math.sin(p2);
  return { lat: Math.atan2(z, Math.sqrt(x * x + y * y)) / r, lon: Math.atan2(y, x) / r };
}

// foF2 (MHz) at the path midpoint: day/night, solar cycle and latitude
function mmdWefaxAutoFof2(lat, lon, ms)
{
  const solar = mmdWefaxAutoSolarIndex(ms);
  const hour = mmdWefaxAutoLocalHour(lon, ms);
  const day = hour >= 6 && hour < 18;
  const base = day ? WEFAX_AUTO_FOF2_DAY_MIN + (WEFAX_AUTO_FOF2_DAY_MAX - WEFAX_AUTO_FOF2_DAY_MIN) * solar
                   : WEFAX_AUTO_FOF2_NIGHT_MIN + (WEFAX_AUTO_FOF2_NIGHT_MAX - WEFAX_AUTO_FOF2_NIGHT_MIN) * solar;
  const latitude = 1 + 0.12 * Math.cos(lat * Math.PI / 180);
  return Math.max(1.5, base * latitude);
}

// The MUF at a distance divided by foF2
function mmdWefaxAutoMufFactor(km)
{
  const points = WEFAX_AUTO_MUF_POINTS;
  if (km <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++)
  {
    if (km <= points[i][0])
    {
      const a = points[i - 1], b = points[i];
      return a[1] + (b[1] - a[1]) * (km - a[0]) / (b[0] - a[0]);
    }
  }
  return points[points.length - 1][1];
}

// The MUF at a distance (MHz)
function mmdWefaxAutoMuf(km, fof2)
{
  return fof2 * mmdWefaxAutoMufFactor(km);
}

// The nearest distance at which a frequency returns from the F2 layer, or Infinity if it never does
function mmdWefaxAutoSkipKm(mhz, fof2, margin)
{
  const target = mhz / (fof2 * margin);
  if (target <= 1) return 0;
  const points = WEFAX_AUTO_MUF_POINTS;
  if (target > points[points.length - 1][1]) return Infinity;
  for (let i = 1; i < points.length; i++)
  {
    if (points[i][1] >= target)
    {
      const a = points[i - 1], b = points[i];
      return a[0] + (b[0] - a[0]) * (target - a[1]) / (b[1] - a[1]);
    }
  }
  return Infinity;
}

// The farthest distance a frequency still returns from one F2 hop, or 0 if it never does
function mmdWefaxAutoMaxHopKm(mhz, fof2, margin)
{
  return mhz / (fof2 * margin) <= WEFAX_AUTO_MUF_POINTS[WEFAX_AUTO_MUF_POINTS.length - 1][1] ? WEFAX_AUTO_HOP_MAX_KM : 0;
}

// The ground-wave working radius (km) at a frequency and transmitter power
function mmdWefaxAutoGroundKm(mhz, powerKw)
{
  const points = WEFAX_AUTO_GROUND_POINTS;
  let base = points[points.length - 1][1];
  if (mhz <= points[0][0]) base = points[0][1];
  else
  {
    for (let i = 1; i < points.length; i++)
    {
      if (mhz <= points[i][0])
      {
        const a = points[i - 1], b = points[i];
        base = a[1] + (b[1] - a[1]) * (mhz - a[0]) / (b[0] - a[0]);
        break;
      }
    }
  }
  const power = Math.max(0.1, Number(powerKw) || 4);
  return base * Math.sqrt(power / 4);
}

// Whether a sporadic-E path could fill the F2 skip zone: a short, 10-22 MHz, day/early evening summer path
function mmdWefaxAutoEsPossible(mhz, km, lat, lon, ms)
{
  if (mhz < WEFAX_AUTO_ES_MIN_MHZ || mhz > WEFAX_AUTO_ES_MAX_MHZ || km < WEFAX_AUTO_ES_MIN_KM || km > WEFAX_AUTO_ES_MAX_KM) return false;
  const hour = mmdWefaxAutoLocalHour(lon, ms);
  if (hour < 8 || hour > 21) return false;
  if (Math.abs(lat) < 10) return true;
  const month = new Date(ms).getUTCMonth() + 1;
  return lat >= 0 ? month >= 5 && month <= 9 : month >= 11 || month <= 3;
}

// Daytime D-layer absorption: "ok", "marginal" or "dead"
function mmdWefaxAutoLuf(mhz, lat, lon, ms)
{
  const hour = mmdWefaxAutoLocalHour(lon, ms);
  if (hour < 6 || hour >= 18) return "ok";
  if (mhz < WEFAX_AUTO_LUF_DAY_HARD_MHZ) return "dead";
  if (mhz < WEFAX_AUTO_LUF_DAY_SOFT_MHZ) return "marginal";
  return "ok";
}

// How far a station is from your locator (km), or null with no locator or station position to go by
function mmdWefaxAutoStationKm(station)
{
  const me = mmdWefaxAutoMyPlace();
  if (!me) return null;
  const lat = Number(station.lat), lon = Number(station.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return mmdWefaxAutoDistanceKm(me.lat, me.lon, lat, lon);
}

// How a frequency reaches a station at a time: { kind, reliable, marginal, ... }, or null with nothing to go by.
// kind: "ground", "onehop", "twohop", "es" or "dead"
function mmdWefaxAutoPath(station, khz, at)
{
  const me = mmdWefaxAutoMyPlace();
  const lat = Number(station.lat), lon = Number(station.lon);
  if (!me || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const km = mmdWefaxAutoDistanceKm(me.lat, me.lon, lat, lon);
  const mhz = khz / 1000;
  const ground = mmdWefaxAutoGroundKm(mhz, station.powerKw);
  if (km <= ground) return { kind: "ground", km, mhz, ground, margin: ground - km, reliable: true, marginal: false };
  const mid = mmdWefaxAutoMidpoint(me.lat, me.lon, lat, lon);
  const fof2 = mmdWefaxAutoFof2(mid.lat, mid.lon, at);
  const luf = mmdWefaxAutoLuf(mhz, mid.lat, mid.lon, at);
  if (luf == "dead") return { kind: "dead", km, mhz, ground, fof2, reliable: false, marginal: false };
  const skip = mmdWefaxAutoSkipKm(mhz, fof2, WEFAX_AUTO_MUF_MARGIN);
  const maxHop = mmdWefaxAutoMaxHopKm(mhz, fof2, WEFAX_AUTO_MUF_MARGIN);
  if (skip != Infinity && maxHop > 0 && km >= skip && km <= maxHop)
  {
    const reliable = luf == "ok";
    return { kind: "onehop", km, mhz, ground, fof2, skip, maxHop, margin: mmdWefaxAutoMuf(km, fof2) - mhz, reliable, marginal: !reliable };
  }
  const twoHopTarget = mhz / (fof2 * WEFAX_AUTO_TWO_HOP_MARGIN);
  const twoHopSkip = mmdWefaxAutoSkipKm(mhz, fof2, WEFAX_AUTO_TWO_HOP_MARGIN);
  if (twoHopTarget <= mmdWefaxAutoMufFactor(3000) && twoHopSkip != Infinity && km >= Math.max(WEFAX_AUTO_HOP_MAX_KM, 2 * twoHopSkip) && km <= WEFAX_AUTO_TWO_HOP_MAX_KM)
    return { kind: "twohop", km, mhz, ground, fof2, skip: twoHopSkip, margin: mmdWefaxAutoMuf(3000, fof2) - mhz, reliable: false, marginal: true };
  if (mmdWefaxAutoEsPossible(mhz, km, mid.lat, mid.lon, at))
    return { kind: "es", km, mhz, ground, fof2, skip, maxHop, margin: 0, reliable: false, marginal: true };
  return { kind: "dead", km, mhz, ground, fof2, skip, maxHop, reliable: false, marginal: false };
}

// The path's preference: ground before one hop before a marginal path
function mmdWefaxAutoPathRank(path)
{
  if (!path) return 0;
  return path.kind == "ground" ? 0 : path.kind == "onehop" ? 1 : path.kind == "es" ? 2 : path.kind == "twohop" ? 3 : 9;
}

// The frequency to receive a station's chart at ms on, else null: on the air then (and one the chart is sent on, where the schedule
// names some: its khz), not passed over, and reaching your locator. The best path wins, then the one that copied last, then the
// nearest the hour suits. With no locator, the one that copied last, else the nearest the hour suits
function mmdWefaxAutoFreq(station, ms, chart = {})
{
  const only = chart.khz == null ? null : [].concat(chart.khz).map(Number);
  const list = (station.frequencies || []).filter((f) => f.khz > 0 && (!only || only.includes(f.khz)) && mmdWefaxAutoOnAir(f, ms) && !((WEFAX_AUTO.skip[station.id + "|" + f.khz] || 0) > ms));
  if (!list.length) return null;
  const good = WEFAX_AUTO.good[station.id];
  const hour = new Date(ms).getHours();
  const want = hour >= 19 || hour < 7 ? WEFAX_AUTO_NIGHT_KHZ : WEFAX_AUTO_DAY_KHZ;
  const legacy = () =>
  {
    if (good && list.some((f) => f.khz == good)) return { khz: good, path: null };
    const sorted = list.slice().sort((a, b) => Math.abs(a.khz - want) - Math.abs(b.khz - want));
    return { khz: sorted[0].khz, path: null };
  };
  if (mmdWefaxAutoStationKm(station) == null) return legacy();
  let best = null, bestScore = null;
  for (const f of list)
  {
    const path = mmdWefaxAutoPath(station, f.khz, ms);
    if (!path || path.kind == "dead") continue;
    const score = { reliable: path.reliable ? 0 : 1, rank: mmdWefaxAutoPathRank(path), good: f.khz == good ? 0 : 1, hour: Math.abs(f.khz - want), margin: path.margin };
    const better = !bestScore || score.reliable < bestScore.reliable ||
      (score.reliable == bestScore.reliable && (score.rank < bestScore.rank ||
      (score.rank == bestScore.rank && (score.good < bestScore.good ||
      (score.good == bestScore.good && (score.hour < bestScore.hour ||
      (score.hour == bestScore.hour && score.margin > bestScore.margin)))))));
    if (better) { best = { khz: f.khz, path }; bestScore = score; }
  }
  return best;
}

// The next chart anywhere: the soonest reliable one within WEFAX_AUTO_LOOKAHEAD_MS, else the best marginal one, else the next reliable
function mmdWefaxAutoFind(from = Date.now())
{
  const day = 86400000;
  const midnight = Math.floor(from / day) * day;
  const reliable = [], marginal = [];
  for (const station of mmdWefaxAutoData().stations)
  {
    for (const chart of station.charts || [])
    {
      // (One sent only now and then, its note says when: a tropical cyclone, the season, the ice; not waited for)
      const minutes = chart.note ? null : mmdWefaxAutoMinutes(chart.time);
      if (minutes == null) continue;
      for (const base of [midnight, midnight + day])
      {
        const at = base + minutes * 60000;
        if (at < from - WEFAX_AUTO_LATE_MS || !mmdWefaxAutoOnDay(station, chart, at)) continue;
        const pick = mmdWefaxAutoFreq(station, at, chart);
        if (!pick) continue;
        const candidate = { at, station, chart, khz: pick.khz, path: pick.path, dial: Math.round(pick.khz * 1000 - 1900) };
        if (!pick.path || pick.path.reliable) reliable.push(candidate);
        else if (pick.path.marginal) marginal.push(candidate);
        break;
      }
    }
  }
  const order = (a, b) => a.at - b.at || mmdWefaxAutoPathRank(a.path) - mmdWefaxAutoPathRank(b.path) ||
    (a.path ? a.path.km : Infinity) - (b.path ? b.path.km : Infinity) ||
    (b.path ? b.path.margin : 0) - (a.path ? a.path.margin : 0) || String(a.station.id).localeCompare(String(b.station.id));
  reliable.sort(order);
  marginal.sort(order);
  if (reliable.length && reliable[0].at <= from + WEFAX_AUTO_LOOKAHEAD_MS) return reliable[0];
  if (marginal.length && (!reliable.length || marginal[0].at < reliable[0].at)) return marginal[0];
  return reliable[0] || marginal[0] || null;
}

// The checkbox
function mmdWefaxAutoToggle()
{
  WEFAX_AUTO.on = cwWefaxAuto.checked;
  WEFAX_AUTO.next = null;
  WEFAX_AUTO.dial = null;
  WEFAX_AUTO.tickAt = 0;
  const H = WEFAX.host;
  if (WEFAX_AUTO.on && !H.rigControl())
  {
    // It can't tune without Rig Control: said so, and left off
    WEFAX_AUTO.on = false;
    cwWefaxAuto.checked = false;
    H.status(H.t("cwViewer.wefax.auto.noRig"), "warning");
  }
  // On again: the last "off" said no more
  else if (WEFAX_AUTO.on && H.running()) H.status(H.t("cwViewer.status.listening"));
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
  if (why) WEFAX.host.status(why);
  mmdWefaxAutoShow();
}

// A WEFAX chart began (mmdWefax.js): the one tuned for has started, its frequency good for this station
function mmdWefaxAutoStarted()
{
  const n = WEFAX_AUTO.next;
  if (!WEFAX_AUTO.on || !n || Date.now() < WEFAX_AUTO.tunedAt) return;
  WEFAX_AUTO.started = true;
  WEFAX_AUTO.good[n.station.id] = n.khz;
}

// Its registration's tick (four times a second): every WEFAX_AUTO_TICK_MS, the chart tuned for followed, and the next one tuned for when
// it's time
function mmdWefaxAutoTick()
{
  if (!WEFAX_AUTO.on)
  {
    mmdWefaxAutoShow();
    return;
  }
  const H = WEFAX.host;
  const now = Date.now();
  if (now - WEFAX_AUTO.tickAt < WEFAX_AUTO_TICK_MS) return;
  WEFAX_AUTO.tickAt = now;
  if (H.mode() != "wefax")
  {
    mmdWefaxAutoStop("");
    return;
  }
  // Tuned by hand since (the rig read elsewhere, once it had time to get there): off
  const dial = H.dialHz();
  if (WEFAX_AUTO.dial != null && dial != null && now - WEFAX_AUTO.tunedAt > WEFAX_AUTO_SETTLE_MS && Math.abs(dial - WEFAX_AUTO.dial) > WEFAX_AUTO_MOVED_HZ)
  {
    mmdWefaxAutoStop(H.t("cwViewer.wefax.auto.byHand"));
    return;
  }
  // A chart coming in: received to its end, whatever its schedule
  if (H.pictures.live())
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
  // Not tuned yet: the best chart is followed as the lookahead moves (a reliable chart may come within it)
  if (!WEFAX_AUTO.next || WEFAX_AUTO.dial != WEFAX_AUTO.next.dial)
  {
    const found = mmdWefaxAutoFind(now), cur = WEFAX_AUTO.next;
    if (!cur || !found || found.station.id != cur.station.id || found.khz != cur.khz || found.at != cur.at)
    {
      WEFAX_AUTO.next = found;
      WEFAX_AUTO.started = false;
    }
  }
  const next = WEFAX_AUTO.next;
  // Its time near: the rig tuned there (once)
  if (next && WEFAX_AUTO.dial != next.dial && now >= next.at - WEFAX_AUTO_LEAD_MS)
  {
    const vfo = H.vfo();
    if (H.tuneDial(next.dial, "USB", !!vfo && vfo.ssbData === true))
    {
      WEFAX_AUTO.dial = next.dial;
      WEFAX_AUTO.tunedAt = now;
    }
  }
  mmdWefaxAutoShow();
}

// The path beside the chart: its distance and how it is expected to arrive
function mmdWefaxAutoPathText(path)
{
  if (!path) return "";
  const H = WEFAX.host;
  const km = H.t("cwViewer.wefax.auto.km").replace("{km}", Math.round(path.km));
  const kind = path.kind == "ground" || path.kind == "onehop" || path.kind == "es" || path.kind == "twohop" ? H.t("cwViewer.wefax.auto.path." + path.kind) : "";
  return kind ? km + " · " + kind : km;
}

// What it's doing, beside its checkbox: the chart tuned for (or the next), its station, frequency, path and time
function mmdWefaxAutoShow()
{
  let text = "";
  const n = WEFAX_AUTO.on ? WEFAX_AUTO.next : null;
  const H = WEFAX.host;
  if (WEFAX_AUTO.on && !n) text = H.t("cwViewer.wefax.auto.none");
  else if (n)
  {
    const minutes = Math.round((n.at - Date.now()) / 60000);
    const when = new Date(n.at).toISOString().slice(11, 16) + " UTC" + (minutes > 0 ? " (" + H.t("cwViewer.wefax.auto.in").replace("{minutes}", minutes) + ")" : "");
    const path = mmdWefaxAutoPathText(n.path);
    text = n.station.id + " " + n.khz + " kHz" + (path ? " · " + path : "") + " · " + (n.chart.title || "") + " · " + when;
  }
  if (cwWefaxAutoText.textContent != text)
  {
    cwWefaxAutoText.textContent = text;
    cwWefaxAutoText.title = n ? [n.station.id, n.station.name, n.khz + " kHz", mmdWefaxAutoPathText(n.path), n.chart.title, n.chart.area].filter(Boolean).join(" · ") : "";
  }
}
