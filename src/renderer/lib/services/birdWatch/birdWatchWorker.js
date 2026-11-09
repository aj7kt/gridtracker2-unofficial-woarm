// BirdWatch's tracker, a Web Worker (new Worker("./lib/services/birdWatch/birdWatchWorker.js")): it keeps the
// element sets it is given, follows the satellites it is told to track once a second, and says when
// one rises (AOS) or sets (LOS) for the observer. It never touches the DOM, the network or the disk.
//
// To the worker                                       From the worker
//   { type: "observer", lat, lon, alt, minEl }         { type: "positions", time, sats: [...] } each tick
//     degrees, degrees, meters, degrees (horizon)      { type: "aos" | "los", norad, time, az, el }
//   { type: "tles", list: [{ norad, name, line1, line2 }] }   { type: "tles", count, bad: [norad] }
//   { type: "track", norad: [..] } / { type: "untrack", norad: [..] } / { type: "untrack" } (all)
//   { type: "passes", id, norad, hours, minEl }        { type: "passes", id, norad, passes: [...] }
//   { type: "path", norad }                            { type: "path", norad, points: [[ms, lat, lon]..], period } its ground track:
//                                                        a little of the past and up to an orbit ahead
//   { type: "arc", norad, from, to, stepSec, id }      { type: "arc", norad, id, points: [[ms, az, el]..] } the sky between two times
//   { type: "mutual", id, norad, hours, minEl, minSeconds, stations: [{ key, lat, lon, alt, minEl }] }
//                                                      { type: "mutual", id, norad, windows: [...] } the skeds: when the observer
//                                                        (above minEl) and a station (above its own minEl) both see it
//   { type: "clock", offset }  ms added to the real clock (time travel), 0 is real time
//   { type: "interval", ms }   tick period, 1000 by default
//   { type: "state" }                                  { type: "state", ... } what it holds (for checks)
//
// A sat in "positions": { norad, lat, lon, alt (km), az, el, range (km), doppler (factor), up }
//   `up` is true while el >= minEl. A pass: { aos, los, maxEl, maxElTime, maxAz, aosAz, losAz, inProgress }
//   with times in ms since 1970; aos is the request time when the sat was already up (inProgress).
// A mutual window: { key, start, end, seconds, inProgress, best: { time, myEl, theirEl, myAz, theirAz }, my, their, myPass, theirPass }
//   best is when the lower of the two elevations is highest; my / their: { startAz, endAz, maxEl, maxElTime } over the window;
//   myPass / theirPass: { aos, los, maxEl, clipped } the whole pass it is in (clipped: cut by the search's ends). Elevations to
//   0.1 degree, azimuths to 1 degree, whole ms; start is the request time when both were already up (inProgress). Station
//   alt in meters, minEl 0 by default; windows shorter than minSeconds are left out (one under way by its whole length, from the
//   later of the two passes' AOS); hours as for "passes" (up to 72).

importScripts("../../third-party/satellite.js");

const W = {
  observer: null,
  observerEcf: null,
  minEl: 0,
  sats: new Map(),
  tracked: new Map(),
  offset: 0,
  interval: 1000,
  timer: null
};

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const PASS_STEP = 20000;
const PASS_MAX_HOURS = 72;
const MUTUAL_STEP = 20000;
const MUTUAL_SKIP = 600000;
const MUTUAL_NEAR = 20;
const MUTUAL_FINE = 0.05;

const handlers = {
  observer: setObserver,
  tles: setTles,
  track: trackSats,
  untrack: untrackSats,
  passes: findPasses,
  path: findPath,
  scan: scanSats,
  arc: findArc,
  mutual: findMutual,
  clock: (m) =>
  {
    W.offset = Number(m.offset) || 0;
  },
  interval: (m) =>
  {
    W.interval = Math.max(100, Number(m.ms) || 1000);
    schedule();
  },
  state: sendState
};

onmessage = (event) =>
{
  const m = event.data;
  if (m && m.type in handlers)
  {
    try
    {
      handlers[m.type](m);
    }
    catch (e)
    {
      postMessage({ type: "error", for: m.type, message: String(e && e.message || e) });
    }
  }
  else console.log("birdWatchWorker: unknown event type : " + (m && m.type));
};

function now()
{
  return Date.now() + W.offset;
}

function setObserver(m)
{
  W.observer = {
    latitude: Number(m.lat) * D2R,
    longitude: Number(m.lon) * D2R,
    height: (Number(m.alt) || 0) / 1000
  };
  W.observerEcf = satellite.geodeticToEcf(W.observer);
  if (m.minEl != null) W.minEl = Number(m.minEl) || 0;
  tick();
}

// Replaces the element sets; what is tracked stays tracked (if still in the list)
function setTles(m)
{
  const sats = new Map();
  const bad = [];
  for (const t of m.list || [])
  {
    const norad = Number(t.norad);
    const old = W.sats.get(norad);
    if (old && old.line1 == t.line1 && old.line2 == t.line2)
    {
      sats.set(norad, old);
      continue;
    }
    let rec = null;
    // twoline2satrec accepts nearly anything, so the shape is checked first
    if (!/^1 .{67}$/.test(t.line1 || "") || !/^2 .{67}$/.test(t.line2 || "") || t.line1.slice(2, 7) != t.line2.slice(2, 7))
    {
      bad.push(norad);
      continue;
    }
    try
    {
      rec = satellite.twoline2satrec(t.line1, t.line2);
    }
    catch (e) { rec = null; }
    if (!rec || rec.error)
    {
      bad.push(norad);
      continue;
    }
    sats.set(norad, { norad: norad, name: t.name || "", line1: t.line1, line2: t.line2, rec: rec });
  }
  W.sats = sats;
  for (const norad of [...W.tracked.keys()])
  {
    if (!sats.has(norad)) W.tracked.delete(norad);
  }
  postMessage({ type: "tles", count: sats.size, bad: bad });
  schedule();
}

function trackSats(m)
{
  for (const norad of [].concat(m.norad))
  {
    if (W.sats.has(Number(norad)) && !W.tracked.has(Number(norad))) W.tracked.set(Number(norad), { up: null });
  }
  schedule();
  tick();
}

function untrackSats(m)
{
  if (m.norad == null) W.tracked.clear();
  else for (const norad of [].concat(m.norad)) W.tracked.delete(Number(norad));
  schedule();
}

// One timer, only while something is tracked and the observer is known
function schedule()
{
  const want = W.tracked.size > 0 && W.observer;
  if (W.timer && !want)
  {
    clearInterval(W.timer);
    W.timer = null;
  }
  else if (want)
  {
    if (W.timer) clearInterval(W.timer);
    W.timer = setInterval(tick, W.interval);
  }
}

// Where a satellite is at a time (ms), seen from the observer (or another place, { latitude, longitude, height } as the
// observer is kept); null if it can't be propagated
function look(sat, ms, obs = W.observer)
{
  const date = new Date(ms);
  const pv = satellite.propagate(sat.rec, date);
  if (!pv || !pv.position || !pv.velocity) return null;
  const gmst = satellite.gstime(date);
  const geo = satellite.eciToGeodetic(pv.position, gmst);
  const ecf = satellite.eciToEcf(pv.position, gmst);
  const la = satellite.ecfToLookAngles(obs, ecf);
  return { geo: geo, ecf: ecf, eci: pv.position, vel: pv.velocity, gmst: gmst, az: la.azimuth * R2D, el: la.elevation * R2D, range: la.rangeSat };
}

function tick()
{
  if (!W.observer || W.tracked.size == 0) return;
  const t = now();
  const out = [];
  for (const [norad, state] of W.tracked)
  {
    const sat = W.sats.get(norad);
    const p = look(sat, t);
    if (!p)
    {
      out.push({ norad: norad, error: true });
      continue;
    }
    const up = p.el >= W.minEl;
    // The first sight only sets the state: a sat already up at the start is not a fresh AOS
    if (state.up != null && up != state.up) postMessage({ type: up ? "aos" : "los", norad: norad, time: t, az: p.az, el: p.el });
    state.up = up;
    const velEcf = satellite.eciToEcf(p.vel, p.gmst);
    const sun = sunVector(t);
    const along = p.eci.x * sun[0] + p.eci.y * sun[1] + p.eci.z * sun[2];
    const across = Math.sqrt(Math.max(0, p.eci.x * p.eci.x + p.eci.y * p.eci.y + p.eci.z * p.eci.z - along * along));
    out.push({
      norad: norad,
      lat: satellite.degreesLat(p.geo.latitude),
      lon: satellite.degreesLong(p.geo.longitude),
      alt: p.geo.height,
      az: p.az,
      el: p.el,
      range: p.range,
      doppler: satellite.dopplerFactor(W.observerEcf, p.ecf, velEcf),
      speed: Math.sqrt(p.vel.x * p.vel.x + p.vel.y * p.vel.y + p.vel.z * p.vel.z),
      up: up,
      sunlit: !(along < 0 && across < 6378)
    });
  }
  postMessage({ type: "positions", time: t, sats: out });
}

// The elevation (degrees) at a time, as look has it but without the rest of look's work (the searches call this a lot); -90 if
// it can't be propagated
function elevationAt(sat, ms, obs = W.observer)
{
  const date = new Date(ms);
  const pv = satellite.propagate(sat.rec, date);
  if (!pv || !pv.position || !pv.velocity) return -90;
  return satellite.ecfToLookAngles(obs, satellite.eciToEcf(pv.position, satellite.gstime(date))).elevation * R2D;
}

// The time (ms) the elevation crosses `level` between a (below/above) and b (the other side), to a second
function crossing(sat, a, b, level, obs = W.observer)
{
  const aboveA = elevationAt(sat, a, obs) >= level;
  while (b - a > 1000)
  {
    const mid = (a + b) / 2;
    if ((elevationAt(sat, mid, obs) >= level) == aboveA) a = mid;
    else b = mid;
  }
  return b;
}

// The highest point of a pass between two times that are both below its peak
function peak(sat, a, b, obs = W.observer)
{
  while (b - a > 1000)
  {
    const m1 = a + (b - a) / 3;
    const m2 = b - (b - a) / 3;
    if (elevationAt(sat, m1, obs) < elevationAt(sat, m2, obs)) a = m1;
    else b = m2;
  }
  const t = (a + b) / 2;
  return { time: t, el: elevationAt(sat, t, obs) };
}

// The highest value of fn(time) between two times, for a value with one peak there (to a second): { time, value }. A golden
// section search, one fn call a step
function highest(fn, a, b)
{
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a);
  let d = a + g * (b - a);
  let fc = fn(c);
  let fd = fn(d);
  while (b - a > 1000)
  {
    if (fc < fd)
    {
      a = c;
      c = d;
      fc = fd;
      d = a + g * (b - a);
      fd = fn(d);
    }
    else
    {
      b = d;
      d = c;
      fd = fc;
      c = b - g * (b - a);
      fc = fn(c);
    }
  }
  return fc > fd ? { time: c, value: fc } : { time: d, value: fd };
}

function findPasses(m)
{
  const sat = W.sats.get(Number(m.norad));
  if (!sat || !W.observer)
  {
    postMessage({ type: "passes", id: m.id, norad: m.norad, passes: [], error: !sat ? "unknown satellite" : "no observer" });
    return;
  }
  const level = m.minEl != null ? Number(m.minEl) : W.minEl;
  const start = now();
  const end = start + Math.min(Math.max(Number(m.hours) || 24, 0.1), PASS_MAX_HOURS) * 3600000;
  postMessage({ type: "passes", id: m.id, norad: m.norad, passes: computePasses(sat, start, end, level) });
}

// The passes of a satellite between two times (ms), as they are for the observer above a level (degrees): one already under
// way is first, with the time it rose
function computePasses(sat, start, end, level)
{
  const passes = [];
  let pass = null;
  let prevT = start;
  let prevUp = elevationAt(sat, start) >= level;
  if (prevUp)
  {
    // Up already: back to when it rose (not further than 40 minutes)
    let back = start;
    while (back > start - 2400000 && elevationAt(sat, back - 10000) >= level) back -= 10000;
    const aos = back > start - 2400000 ? crossing(sat, back - 10000, back, level) : back;
    pass = { aos: aos, aosAz: look(sat, aos).az, inProgress: true };
  }
  for (let t = start + PASS_STEP; ; t += PASS_STEP)
  {
    if (t > end) t = end;
    const up = elevationAt(sat, t) >= level;
    if (up && !prevUp)
    {
      const aos = crossing(sat, prevT, t, level);
      pass = { aos: aos, aosAz: look(sat, aos).az, inProgress: false };
    }
    else if (!up && prevUp && pass)
    {
      const los = crossing(sat, prevT, t, level);
      finish(sat, pass, los, passes);
      pass = null;
    }
    prevUp = up;
    prevT = t;
    if (t >= end) break;
  }
  // Still up when the window ends: reported with the window's end as its LOS
  if (pass) finish(sat, pass, end, passes, true);
  return passes;
}

// The skeds: when the observer and each station can work a satellite at once. A window needs the observer up, so only the
// observer's own passes are searched for the station's elevation
function findMutual(m)
{
  const sat = W.sats.get(Number(m.norad));
  if (!sat || !W.observer)
  {
    postMessage({ type: "mutual", id: m.id, norad: m.norad, windows: [], error: !sat ? "unknown satellite" : "no observer" });
    return;
  }
  const level = m.minEl != null ? Number(m.minEl) : W.minEl;
  const shortest = Math.max(0, Number(m.minSeconds) || 0) * 1000;
  const start = now();
  const end = start + Math.min(Math.max(Number(m.hours) || 24, 0.1), PASS_MAX_HOURS) * 3600000;
  const passes = computePasses(sat, start, end, level);
  const windows = [];
  for (const s of [].concat(m.stations || []))
  {
    // A station without a place is left out
    if (!s || s.lat == null || s.lon == null || !isFinite(Number(s.lat)) || !isFinite(Number(s.lon))) continue;
    const station = {
      key: s.key,
      obs: { latitude: Number(s.lat) * D2R, longitude: Number(s.lon) * D2R, height: (Number(s.alt) || 0) / 1000 },
      level: Number(s.minEl) || 0
    };
    for (const pass of passes)
    {
      const from = Math.max(pass.aos, start);
      if (pass.los <= from) continue;
      for (const span of stationSpans(sat, station, from, pass.los))
      {
        // Its whole length: one under way began before now, when the later of the two passes rose (not just the time left of it)
        const w = mutualWindow(sat, station, pass, span, start, end);
        const began = w.inProgress ? Math.max(w.myPass.aos, w.theirPass.aos) : w.start;
        if (w.end - began >= shortest) windows.push(w);
      }
    }
  }
  windows.sort((a, b) => a.start - b.start);
  postMessage({ type: "mutual", id: m.id, norad: m.norad, windows: windows });
}

// The observer's and a station's view of a satellite at a time (ms), from one propagation: { time, myEl, myAz, theirEl, theirAz }
// in degrees (elevations -90 if it can't be propagated, as elevationAt has them). Also how fast the elevations can be changing:
// the line of sight turns no faster than the satellite's speed over the ground over its distance, and in `within` ms that
// distance can't shrink to under half, so for that long neither elevation changes faster than `rate` (degrees a second)
function skyPoint(sat, ms, obs)
{
  const date = new Date(ms);
  const pv = satellite.propagate(sat.rec, date);
  if (!pv || !pv.position || !pv.velocity) return { time: ms, myEl: -90, myAz: 0, theirEl: -90, theirAz: 0, rate: Infinity, within: 0 };
  const gmst = satellite.gstime(date);
  const ecf = satellite.eciToEcf(pv.position, gmst);
  const mine = satellite.ecfToLookAngles(W.observer, ecf);
  const theirs = satellite.ecfToLookAngles(obs, ecf);
  // The velocity turned into the Earth's frame, less the Earth's turning (7.292115e-5 radians a second)
  const v = satellite.eciToEcf(pv.velocity, gmst);
  const vx = v.x + 7.292115e-5 * ecf.y;
  const vy = v.y - 7.292115e-5 * ecf.x;
  const speed = Math.sqrt(vx * vx + vy * vy + v.z * v.z);
  const range = Math.min(mine.rangeSat, theirs.rangeSat);
  return {
    time: ms,
    myEl: mine.elevation * R2D,
    myAz: mine.azimuth * R2D,
    theirEl: theirs.elevation * R2D,
    theirAz: theirs.azimuth * R2D,
    rate: 2 * speed / range * R2D,
    within: range / speed / 2 * 1000
  };
}

// The spans between two times (inside one of the observer's passes) when the station has the satellite above its level:
// { start, end, startTheirs, endTheirs, points }, an end being the station's own crossing or else the time given. Sampled
// every MUTUAL_STEP (less often where the elevations change slowly); a high or a low of the station's elevation near its level
// is found exactly, so a short graze or a brief dip between two samples is not missed
function stationSpans(sat, station, a, b)
{
  const points = [];
  for (let t = a; ; )
  {
    const p = skyPoint(sat, t, station.obs);
    points.push(p);
    if (t >= b) break;
    // Longer steps (up to MUTUAL_SKIP) while they are safe: under the level, while the station's elevation can't close half its
    // gap to it; above, while neither elevation can change by more than MUTUAL_FINE
    const most = p.theirEl < station.level ? (station.level - p.theirEl) / 2 : MUTUAL_FINE;
    t = Math.min(b, t + Math.max(MUTUAL_STEP, Math.min(MUTUAL_SKIP, p.within, most / p.rate * 1000)));
  }
  const n = points.length;
  const extra = [];
  for (let i = 0; i < n; i++)
  {
    const el = points[i].theirEl;
    const prev = i > 0 ? points[i - 1].theirEl : el;
    const next = i < n - 1 ? points[i + 1].theirEl : el;
    // Flat (or a lone sample), or too far from the level for the gap between samples to hide a crossing
    if ((prev == el && next == el) || Math.abs(el - station.level) > MUTUAL_NEAR) continue;
    const lo = points[Math.max(0, i - 1)].time;
    const hi = points[Math.min(n - 1, i + 1)].time;
    if (el < station.level && prev <= el && next <= el)
    {
      const top = highest((t) => elevationAt(sat, t, station.obs), lo, hi);
      if (top.value >= station.level) extra.push(skyPoint(sat, top.time, station.obs));
    }
    else if (el >= station.level && prev >= el && next >= el)
    {
      const low = highest((t) => -elevationAt(sat, t, station.obs), lo, hi);
      if (-low.value < station.level) extra.push(skyPoint(sat, low.time, station.obs));
    }
  }
  const all = extra.length ? points.concat(extra).sort((x, y) => x.time - y.time) : points;
  const spans = [];
  let span = null;
  for (let i = 0; i < all.length; i++)
  {
    const up = all[i].theirEl >= station.level;
    if (up && !span)
    {
      const rise = i == 0 ? a : crossing(sat, all[i - 1].time, all[i].time, station.level, station.obs);
      span = { start: rise, startTheirs: i > 0, points: [] };
    }
    else if (!up && span)
    {
      span.end = crossing(sat, all[i - 1].time, all[i].time, station.level, station.obs);
      span.endTheirs = true;
      spans.push(span);
      span = null;
    }
    if (span) span.points.push(all[i]);
  }
  if (span)
  {
    span.end = b;
    span.endTheirs = false;
    spans.push(span);
  }
  return spans;
}

// The highest value of a window's samples (MUTUAL_STEP apart, or more where the elevations barely change), found exactly near
// the best of them: { time, value }
function windowTop(points, valueOf, fn, a, b)
{
  let top = points[0];
  for (const p of points) if (valueOf(p) > valueOf(top)) top = p;
  const near = highest(fn, Math.max(a, top.time - MUTUAL_STEP), Math.min(b, top.time + MUTUAL_STEP));
  return near.value > valueOf(top) ? near : { time: top.time, value: valueOf(top) };
}

// The station's whole pass around a span: out from the span's ends to where its elevation crosses its level, not before 40
// minutes ago (as computePasses looks back) nor after the search's end (clipped then)
function stationPass(sat, station, span, start, end)
{
  const step = (t, toward) => (toward < t ? Math.max(toward, t - PASS_STEP) : Math.min(toward, t + PASS_STEP));
  const limit = start - 2400000;
  let clipped = false;
  let aos = span.start;
  if (!span.startTheirs)
  {
    while (aos > limit && elevationAt(sat, step(aos, limit), station.obs) >= station.level) aos = step(aos, limit);
    if (aos > limit) aos = crossing(sat, step(aos, limit), aos, station.level, station.obs);
    else clipped = true;
  }
  let los = span.end;
  if (!span.endTheirs)
  {
    while (los < end && elevationAt(sat, step(los, end), station.obs) >= station.level) los = step(los, end);
    if (los < end) los = crossing(sat, los, step(los, end), station.level, station.obs);
    else clipped = true;
  }
  const top = highest((t) => elevationAt(sat, t, station.obs), aos, los);
  return { aos: aos, los: los, maxEl: top.value, maxElTime: top.time, clipped: clipped };
}

// A window as it is sent: see the header
function mutualWindow(sat, station, pass, span, start, end)
{
  const el = (v) => Math.round(v * 10) / 10;
  const az = (v) => Math.round(v) % 360;
  const first = skyPoint(sat, span.start, station.obs);
  const last = skyPoint(sat, span.end, station.obs);
  const points = [first].concat(span.points, [last]);
  const theirPass = stationPass(sat, station, span, start, end);
  // Each pass's own peak when it is in the window (and no sample is higher: a pass with more than one high), so the numbers
  // match the pass lists
  const topOf = (top, valueOf, fn) =>
  {
    if (top.time >= span.start && top.time <= span.end && !points.some((p) => valueOf(p) > top.value)) return top;
    return windowTop(points, valueOf, fn, span.start, span.end);
  };
  const mine = topOf({ time: pass.maxElTime, value: pass.maxEl }, (p) => p.myEl, (t) => elevationAt(sat, t));
  const theirs = topOf({ time: theirPass.maxElTime, value: theirPass.maxEl }, (p) => p.theirEl, (t) => elevationAt(sat, t, station.obs));
  const lower = (p) => Math.min(p.myEl, p.theirEl);
  const best = skyPoint(sat, windowTop(points, lower, (t) => lower(skyPoint(sat, t, station.obs)), span.start, span.end).time, station.obs);
  return {
    key: station.key,
    start: Math.round(span.start),
    end: Math.round(span.end),
    seconds: Math.round((span.end - span.start) / 1000),
    inProgress: span.start == start,
    best: { time: Math.round(best.time), myEl: el(best.myEl), theirEl: el(best.theirEl), myAz: az(best.myAz), theirAz: az(best.theirAz) },
    my: { startAz: az(first.myAz), endAz: az(last.myAz), maxEl: el(mine.value), maxElTime: Math.round(mine.time) },
    their: { startAz: az(first.theirAz), endAz: az(last.theirAz), maxEl: el(theirs.value), maxElTime: Math.round(theirs.time) },
    // A pass is never lower than the part of it in the window
    myPass: { aos: Math.round(pass.aos), los: Math.round(pass.los), maxEl: el(Math.max(pass.maxEl, mine.value)), clipped: !!pass.cut },
    theirPass: { aos: Math.round(theirPass.aos), los: Math.round(theirPass.los), maxEl: el(Math.max(theirPass.maxEl, theirs.value)), clipped: theirPass.clipped }
  };
}

// The scan (BirdWatch settings, Satellites): of the satellites asked about, those in AOS now that will be for the next minutes
// (upMinutes), and those that will be within the next hour (hours); { norad, aos, los, maxEl, aosAz } for each
function scanSats(m)
{
  const found = [];
  if (W.observer)
  {
    const start = now();
    const window = Number(m.hours || 1) * 3600000;
    const stay = Number(m.upMinutes || 5) * 60000;
    for (const norad of m.norads)
    {
      const sat = W.sats.get(Number(norad));
      if (!sat) continue;
      // The first pass that is in AOS now for long enough, or begins within the window. One whose passes can't be worked out (its
      // element set stops propagating part way through one, as a decaying satellite's does) is left out, not the whole scan with it
      let pass = null;
      try
      {
        pass = computePasses(sat, start, start + window, W.minEl).filter((p) => p.los > start).find((p) => (p.aos <= start ? p.los >= start + stay : p.aos <= start + window));
      }
      catch (e)
      {
        continue;
      }
      if (pass) found.push({ norad: Number(norad), aos: pass.aos, los: pass.los, maxEl: pass.maxEl, aosAz: pass.aosAz, up: pass.aos <= start });
    }
  }
  postMessage({ type: "scan", id: m.id, results: found, checked: m.norads.length });
}

// Where the satellite is over the ground, from a little ago to an orbit ahead (a long orbit's first three hours)
function geoAt(sat, ms)
{
  const date = new Date(ms);
  const pv = satellite.propagate(sat.rec, date);
  if (!pv || !pv.position) return null;
  const geo = satellite.eciToGeodetic(pv.position, satellite.gstime(date));
  return [ms, satellite.degreesLat(geo.latitude), satellite.degreesLong(geo.longitude)];
}

function findPath(m)
{
  const sat = W.sats.get(Number(m.norad));
  const points = [];
  let period = 0;
  if (sat)
  {
    period = 2 * Math.PI / sat.rec.no;
    const ahead = Math.min(period, 180) * 60000;
    const behind = Math.min(period * 0.2, 20) * 60000;
    const step = Math.max(10000, Math.round(ahead / 240 / 1000) * 1000);
    const start = now();
    for (let t = start - behind; t <= start + ahead; t += step)
    {
      const g = geoAt(sat, t);
      if (g) points.push(g);
    }
  }
  postMessage({ type: "path", norad: Number(m.norad), points: points, period: period });
}

// The sky between two times: azimuth and elevation (a pass's arc)
function findArc(m)
{
  const sat = W.sats.get(Number(m.norad));
  const points = [];
  if (sat && W.observer)
  {
    const step = Math.max(1000, (Number(m.stepSec) || 10) * 1000);
    for (let t = Number(m.from); t < Number(m.to) + step; t += step)
    {
      const l = look(sat, Math.min(t, Number(m.to)));
      if (l) points.push([Math.min(t, Number(m.to)), l.az, l.el]);
    }
  }
  postMessage({ type: "arc", norad: Number(m.norad), id: m.id, points: points });
}

// The Sun's direction (a unit vector, low precision: a fraction of a degree) for ms since 1970
function sunVector(ms)
{
  const n = ms / 86400000 + 2440587.5 - 2451545.0;
  const L = 280.46 + 0.9856474 * n;
  const g = (357.528 + 0.9856003 * n) * D2R;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D2R;
  const epsilon = (23.439 - 0.0000004 * n) * D2R;
  return [Math.cos(lambda), Math.cos(epsilon) * Math.sin(lambda), Math.sin(epsilon) * Math.sin(lambda)];
}

// Could it be seen with the eye then: it is high enough, the Earth's shadow is not on it, and the sky is dark
function visibleAt(sat, ms)
{
  const p = look(sat, ms);
  if (!p || p.el < 10) return false;
  const s = sunVector(ms);
  const r = p.eci;
  const along = r.x * s[0] + r.y * s[1] + r.z * s[2];
  const across = Math.sqrt(Math.max(0, r.x * r.x + r.y * r.y + r.z * r.z - along * along));
  if (along < 0 && across < 6378) return false;
  const theta = W.observer.longitude + p.gmst;
  const up = [Math.cos(W.observer.latitude) * Math.cos(theta), Math.cos(W.observer.latitude) * Math.sin(theta), Math.sin(W.observer.latitude)];
  return Math.asin(up[0] * s[0] + up[1] * s[1] + up[2] * s[2]) * R2D < -6;
}

function passVisible(sat, aos, los)
{
  for (let t = aos; t <= los; t += 10000) if (visibleAt(sat, t)) return true;
  return false;
}

function finish(sat, pass, los, passes, cut)
{
  pass.visible = passVisible(sat, pass.aos, los);
  const top = peak(sat, pass.aos, los);
  pass.los = los;
  pass.losAz = look(sat, los).az;
  pass.maxEl = top.el;
  pass.maxElTime = top.time;
  pass.maxAz = look(sat, top.time).az;
  if (cut) pass.cut = true;
  passes.push(pass);
}

function sendState()
{
  postMessage({
    type: "state",
    observer: W.observer,
    minEl: W.minEl,
    sats: W.sats.size,
    tracked: [...W.tracked.keys()],
    timer: !!W.timer,
    offset: W.offset,
    interval: W.interval
  });
}
