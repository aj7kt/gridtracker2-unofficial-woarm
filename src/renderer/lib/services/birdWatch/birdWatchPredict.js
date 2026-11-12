// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// BirdWatch predictions: the selected satellite's predicted ground track on the map and its next pass in a sky plot, and the
// timeline of every tracked satellite's passes over the next 24 hours.
// The tracker (birdWatchWorker.js) works the numbers out

const BIRD_WATCH_PATH_REFRESH_MS = 60000;
const BIRD_WATCH_PATH_TICK_MS = 10 * 60 * 1000;
const BIRD_WATCH_TIMELINE_HOURS = 24;

function birdWatchPredictState()
{
  const T = GT.birdWatchTrack;
  return T.predict || (T.predict = { paths: new Map(), arcs: new Map(), features: new Map(), blocks: [] });
}

// Only the selected satellite is predicted
function birdWatchPredicted(norad)
{
  return GT.birdWatchTrack.selected == Number(norad);
}

// The sky plot and the map follow the selection (called when a satellite is selected or the selection is cleared)
function birdWatchPredictApply()
{
  const T = GT.birdWatchTrack;
  const P = birdWatchPredictState();
  birdWatchSkyBox.style.display = T.selected && GT.settings.BirdWatch.skybox ? "block" : "none";
  birdWatchSideProfileBox.style.display = T.selected && GT.settings.BirdWatch.sideProfile ? "block" : "none";
  birdWatchSideHorizonBox.style.display = T.selected && GT.settings.BirdWatch.sideHorizon ? "block" : "none";
  birdWatchSideEarthBox.style.display = T.selected && GT.settings.BirdWatch.sideEarth ? "block" : "none";
  for (const norad of [...P.features.keys()])
  {
    if (!birdWatchPredicted(norad)) birdWatchPathRemove(norad);
  }
  // Selected now: its path is asked for at the next tick
  const p = T.selected ? P.paths.get(T.selected) : null;
  if (p && !P.features.has(T.selected)) p.at = 0;
}

// Everything is forgotten when the map is rebuilt, the tracker stops or the element sets change
function birdWatchPredictReset()
{
  const T = GT.birdWatchTrack;
  // The Skeds' mutual passes are worked out again too (birdWatchSkeds.js)
  birdWatchSkedsReset();
  if (!T.predict) return;
  for (const norad of [...T.predict.features.keys()]) birdWatchPathRemove(norad);
  T.predict.paths.clear();
  T.predict.arcs.clear();
}

// Each tracker tick
function birdWatchPredictUpdate()
{
  const T = GT.birdWatchTrack;
  const P = birdWatchPredictState();
  const now = Date.now();
  const norad = T.selected;
  const sat = norad ? T.last.get(norad) : null;
  if (sat && !sat.error)
  {
    let p = P.paths.get(norad);
    if (!p) P.paths.set(norad, p = { points: [], at: 0, pending: false });
    if (GT.settings.BirdWatch.colors.pathOn && !p.pending && now - p.at > BIRD_WATCH_PATH_REFRESH_MS)
    {
      p.pending = true;
      p.at = now;
      T.worker.postMessage({ type: "path", norad: norad });
    }
  }
  birdWatchClearControls();
  birdWatchAutoUpdate();
  birdWatchSatScanTick();
  birdWatchAlertsUpdate();
  // The Skeds' mutual passes, their markers and alerts (birdWatchSkeds.js)
  birdWatchSkedsTick();
  birdWatchDopplerUpdate();
  if (T.selected && GT.settings.BirdWatch.skybox) birdWatchSkyUpdate();
  if (T.selected) birdWatchSideViewUpdate();
  if (birdWatchTimelineDiv.style.display != "none") birdWatchTimelineDraw();
}

function birdWatchPredictMessage(m)
{
  const P = birdWatchPredictState();
  if (m.type == "path")
  {
    const p = P.paths.get(m.norad);
    if (!p) return;
    p.points = m.points || [];
    p.pending = false;
    birdWatchPathDraw(m.norad);
  }
  else if (m.type == "arc")
  {
    const arc = P.arcs.get(m.norad);
    if (arc && arc.pendingKey == m.id)
    {
      arc.key = m.id;
      arc.pendingKey = null;
      arc.points = m.points || [];
    }
  }
}

// ---- The ground track

function birdWatchPathStyles(label)
{
  const color = GT.settings.BirdWatch.colors.pathLine;
  const width = GT.settings.BirdWatch.colors.pathWidth;
  const size = GT.settings.BirdWatch.colors.pathTimeSize;
  const outline = GT.settings.BirdWatch.colors.pathOutlineOn;
  const dash = GT.settings.BirdWatch.colors.pathDashOn;
  const halo = new ol.style.Stroke({ color: birdWatchRgba(GT.settings.BirdWatch.colors.pathOutline, 0.55), width: width + 2.5 });
  return {
    past: (outline ? [new ol.style.Style({ zIndex: -4, stroke: halo })] : []).concat(new ol.style.Style({ zIndex: -3, stroke: new ol.style.Stroke({ color: color, width: width, lineDash: dash ? [2, 5] : undefined }) })),
    future: (outline ? [new ol.style.Style({ zIndex: -4, stroke: halo })] : []).concat(new ol.style.Style({ zIndex: -3, stroke: new ol.style.Stroke({ color: color, width: width, lineDash: dash ? [8, 5] : undefined }) })),
    tick: new ol.style.Style({
      zIndex: -3,
      image: new ol.style.Circle({ radius: size * 0.32, fill: new ol.style.Fill({ color: color }), stroke: new ol.style.Stroke({ color: "#ffffff", width: 1 }) }),
      text: label ? new ol.style.Text({ text: label, offsetY: -(size + 3), font: "bold " + size + "px sans-serif", fill: new ol.style.Fill({ color: color }), stroke: new ol.style.Stroke({ color: "#ffffff", width: 3 }) }) : undefined
    })
  };
}

function birdWatchPathRemove(norad)
{
  const P = birdWatchPredictState();
  const features = P.features.get(norad);
  if (features && GT.layerSources.birdWatch) for (const feature of features) GT.layerSources.birdWatch.removeFeature(feature);
  P.features.delete(norad);
}

// The clock time of a mark on the track, in the user's time mode
function birdWatchClock(ms)
{
  const t = new Date(ms);
  return GT.settings.app.useLocalTime == 1 ? t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : t.toISOString().slice(11, 16) + "Z";
}

// The path, past dotted and to come dashed, with a mark and the time every ten minutes ahead. The longitudes are made continuous
// and the whole shifted by whole worlds to run through where the satellite is now, so every world the map draws shows it
function birdWatchPathDraw(norad)
{
  const T = GT.birdWatchTrack;
  const P = birdWatchPredictState();
  const p = P.paths.get(norad);
  const sat = T.last.get(norad);
  birdWatchPathRemove(norad);
  if (!GT.settings.BirdWatch.colors.pathOn || !p || p.points.length < 4 || !sat || sat.error || !birdWatchPredicted(norad) || !GT.layerSources.birdWatch) return;

  const now = Date.now();
  const pts = [];
  let prev = p.points[0][2];
  let x = prev;
  for (const [t, lat, lon] of p.points)
  {
    x += ((lon - prev + 540) % 360) - 180;
    prev = lon;
    pts.push([t, x, lat]);
  }
  let at = 0;
  for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i][0] - now) < Math.abs(pts[at][0] - now)) at = i;
  const shift = 360 * Math.round((sat.lon - pts[at][1]) / 360);
  for (const q of pts) q[1] += shift;

  const styles = birdWatchPathStyles();
  const features = [];
  const line = (list, style) =>
  {
    if (list.length < 2) return;
    const coords = list.map((q) => [q[1], q[2]]);
    const json = GT.useTransform ? { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } } : birdWatchLineJson(birdWatchSplitLine(coords));
    const feature = shapeFeature("birdWatchPath", json, "birdWatchPath", "#00000000", "#00000000", 1);
    feature.setStyle(style);
    features.push(feature);
  };
  line(pts.slice(0, at + 1), styles.past);
  line(pts.slice(at), styles.future);

  const last = pts[pts.length - 1][0];
  // The ticks (a mark and its time every ten minutes) are the Time option's
  for (let t = now + BIRD_WATCH_PATH_TICK_MS; GT.settings.BirdWatch.colors.pathTimeOn && t <= last; t += BIRD_WATCH_PATH_TICK_MS)
  {
    let near = at;
    for (let i = at; i < pts.length; i++) if (Math.abs(pts[i][0] - t) < Math.abs(pts[near][0] - t)) near = i;
    const lon = ((pts[near][1] + 540) % 360) - 180;
    const mark = new ol.Feature({ geometry: new ol.geom.Point(ol.proj.fromLonLat([lon, pts[near][2]], GT.settings.map.projection)), prop: "birdWatchPath" });
    mark.setStyle(birdWatchPathStyles(birdWatchClock(t)).tick);
    features.push(mark);
  }
  for (const feature of features) GT.layerSources.birdWatch.addFeature(feature);
  P.features.set(norad, features);
}

// ---- Auto Satellite Tracking
// The satellite that is up is selected; with none up, the one that rises next. Of those up, the most usable (birdWatchAutoRank: one
// that can be worked first, then one that can be heard); of equally usable ones, the one that sets first. The pick is kept until it
// sets, even when a more usable one rises, unless it has nothing to hear (when one that was being followed sets, the next to pick is
// simply the next that is up, so this is no special case). With nothing up that can be heard, the next that can be rises first. Picked
// once per change, so a click on another satellite stays until the pick moves on. Only a pass that climbs at least the Auto-Track
// lowest max elevation (BirdWatch settings, General) counts

function birdWatchAutoToggle()
{
  GT.settings.BirdWatch.auto = !GT.settings.BirdWatch.auto;
  birdWatchAutoImg.style.filter = GT.settings.BirdWatch.auto ? "" : "grayscale(1)";
  if (GT.birdWatchTrack) GT.birdWatchTrack.autoPick = null;
  birdWatchAutoUpdate();
}

// How usable a satellite is to follow, by its best transmitter: 0 an amateur two-way one (a repeater, a transponder), 1 an amateur
// downlink, 2 another downlink, 3 nothing to hear
const BIRD_WATCH_AUTO_DEAF = 3;
// Each satellite's, until the transmitters are read again (birdWatchTransmitterStamp)
const birdWatchAutoRanks = { stamp: null, ranks: new Map() };

function birdWatchAutoRank(norad)
{
  if (birdWatchAutoRanks.stamp != birdWatchTransmitterStamp)
  {
    birdWatchAutoRanks.stamp = birdWatchTransmitterStamp;
    birdWatchAutoRanks.ranks.clear();
  }
  if (birdWatchAutoRanks.ranks.has(norad)) return birdWatchAutoRanks.ranks.get(norad);
  let rank = BIRD_WATCH_AUTO_DEAF;
  for (const t of birdWatchTransmitters(norad))
  {
    if (t.downlink_low > 0) rank = Math.min(rank, birdWatchAmateurTransmitter(t) ? (t.uplink_low > 0 ? 0 : 1) : 2);
  }
  birdWatchAutoRanks.ranks.set(norad, rank);
  return rank;
}

function birdWatchAutoUpdate()
{
  const T = GT.birdWatchTrack;
  if (!GT.settings.BirdWatch.auto || !T.worker) return;
  // The transmitters read again if their file changed (the ranks with them)
  birdWatchTransmitters(0);
  const up = [];
  let next = null;
  let nextHeard = null;
  const minEl = GT.settings.BirdWatch.autoMinElevation || 0;
  const now = Date.now();
  // Skeds First and Skeds Only (birdWatchSkeds.js): a mutual pass with an active station, from a little before it opens; Skeds Only
  // leaves the selection as it is between them
  const sked = birdWatchSkedAutoPick(now);
  if (sked && sked.idle) return;
  if (sked && sked.pick)
  {
    if (sked.pick != T.autoPick)
    {
      T.autoPick = sked.pick;
      if (T.selected != sked.pick) birdWatchSelect(sked.pick, true);
    }
    return;
  }
  // A satellite always up (geostationary: its one pass longer than Skeds' BIRD_WATCH_SKED_ALWAYS_MS) never sets, so kept "until it
  // sets" it would hold the pick for good: it's picked only when no other satellite is up or coming up
  let always = null;
  for (const norad of GT.settings.BirdWatch.tracked)
  {
    const sat = T.last.get(norad);
    if (!sat || sat.error) continue;
    const current = birdWatchWantPasses(norad);
    const pass = T.passes.get(norad).list.find((x) => x.los > now && x.maxEl >= minEl) || null;
    if (!pass) continue;
    const rank = birdWatchAutoRank(norad);
    if (pass.los - pass.aos > BIRD_WATCH_SKED_ALWAYS_MS)
    {
      if (sat.up && (!always || rank < always.rank)) always = { norad: norad, rank: rank };
      continue;
    }
    if (sat.up && pass === current) up.push({ norad: norad, los: pass.los, rank: rank });
    else
    {
      if (!next || pass.aos < next.aos) next = { norad: norad, aos: pass.aos };
      if (rank < BIRD_WATCH_AUTO_DEAF && (!nextHeard || pass.aos < nextHeard.aos)) nextHeard = { norad: norad, aos: pass.aos };
    }
  }
  let pick = null;
  const best = up.length ? Math.min(...up.map((s) => s.rank)) : BIRD_WATCH_AUTO_DEAF;
  const usable = up.filter((s) => s.rank == best);
  if (up.some((s) => s.norad == T.autoPick && s.rank < BIRD_WATCH_AUTO_DEAF)) pick = T.autoPick;
  else if (up.length && (best < BIRD_WATCH_AUTO_DEAF || !nextHeard)) pick = usable.some((s) => s.norad == T.autoPick) ? T.autoPick : usable.sort((a, b) => a.los - b.los)[0].norad;
  else if (nextHeard) pick = nextHeard.norad;
  else if (next) pick = next.norad;
  else if (always) pick = always.norad;
  if (pick && pick != T.autoPick)
  {
    T.autoPick = pick;
    if (T.selected != pick) birdWatchSelect(pick, true);
  }
}

// ---- The sky plot

const BIRD_WATCH_SKY_SIZE = 176;

function birdWatchSkyUpdate()
{
  const T = GT.birdWatchTrack;
  const norad = T.selected;
  const pass = birdWatchWantPasses(norad);
  birdWatchSkyDraw(T.last.get(norad), pass, birdWatchPassArc(norad, pass));
}

// The sky a pass crosses ([[ms, az, el]..], every 10 s from its AOS to its LOS), asked of the tracker once for each pass: [] until it
// has come (the sky plot and the side view share it)
function birdWatchPassArc(norad, pass)
{
  const T = GT.birdWatchTrack;
  const P = birdWatchPredictState();
  let arc = P.arcs.get(norad);
  if (!pass) return [];
  const key = pass.aos + "|" + pass.los;
  if (!arc || (arc.key != key && arc.pendingKey != key))
  {
    P.arcs.set(norad, arc = { key: arc ? arc.key : null, pendingKey: key, points: arc ? arc.points : [] });
    T.worker.postMessage({ type: "arc", norad: norad, from: pass.aos, to: pass.los, stepSec: 10, id: key });
  }
  return arc.key == key ? arc.points : [];
}

// North at the top, east on the right (looking down at the ground), the horizon the outer circle and the zenith the center
function birdWatchSkyDraw(sat, pass, points)
{
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const size = BIRD_WATCH_SKY_SIZE;
  if (birdWatchSky.width != Math.ceil(size * dpr))
  {
    birdWatchSky.width = Math.ceil(size * dpr);
    birdWatchSky.height = Math.ceil(size * dpr);
  }
  const c = birdWatchSky.getContext("2d");
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, size, size);
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 14;
  const at = (az, el) =>
  {
    const rho = radius * (1 - Math.max(0, el) / 90);
    const a = az * Math.PI / 180;
    return [cx + rho * Math.sin(a), cy - rho * Math.cos(a)];
  };

  c.fillStyle = "#06101f";
  c.beginPath();
  c.arc(cx, cy, radius, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = "#5a6a85";
  c.lineWidth = 1;
  for (const el of [0, 30, 60])
  {
    c.beginPath();
    c.arc(cx, cy, radius * (1 - el / 90), 0, Math.PI * 2);
    c.stroke();
  }
  c.beginPath();
  c.moveTo(cx - radius, cy);
  c.lineTo(cx + radius, cy);
  c.moveTo(cx, cy - radius);
  c.lineTo(cx, cy + radius);
  c.stroke();
  c.fillStyle = "#aab6cc";
  c.font = "bold 11px sans-serif";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText("N", cx, 6);
  c.fillText("S", cx, size - 6);
  c.fillText("E", size - 6, cy);
  c.fillText("W", 6, cy);

  // The 30° and 60° rings' labels, small and dim, each on its ring at the azimuth (of the eight points of the compass the track
  // and the satellite are farthest from) so they stay clear of the track
  c.font = "9px sans-serif";
  c.textAlign = "center";
  c.textBaseline = "middle";
  const busy = points.map((q) => at(q[1], q[2]));
  if (sat && !sat.error && sat.up) busy.push(at(sat.az, sat.el));
  for (const el of [30, 60])
  {
    let best = 225;
    let farthest = -1;
    for (let az = 45; az < 360; az += 90)
    {
      const [x, y] = at(az, el);
      const near = busy.reduce((m, [bx, by]) => Math.min(m, Math.hypot(bx - x, by - y)), 1e9);
      if (near > farthest)
      {
        farthest = near;
        best = az;
      }
    }
    const [x, y] = at(best, el);
    c.fillStyle = "#06101f";
    c.fillRect(x - 9, y - 5, 18, 10);
    c.fillStyle = "#8fa0bf";
    c.fillText(el + "°", x, y + 0.5);
  }

  const color = GT.settings.BirdWatch.colors.pathLine;
  if (pass && points.length > 1)
  {
    c.strokeStyle = "#ffffff";
    c.lineWidth = 4;
    c.beginPath();
    points.forEach((q, i) => { const [x, y] = at(q[1], q[2]); if (i) c.lineTo(x, y); else c.moveTo(x, y); });
    c.stroke();
    c.strokeStyle = color;
    c.lineWidth = 2;
    c.beginPath();
    points.forEach((q, i) => { const [x, y] = at(q[1], q[2]); if (i) c.lineTo(x, y); else c.moveTo(x, y); });
    c.stroke();

    const dot = (az, el, fill) =>
    {
      const [x, y] = at(az, el);
      c.fillStyle = fill;
      c.strokeStyle = "#ffffff";
      c.lineWidth = 1;
      c.beginPath();
      c.arc(x, y, 3.5, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    };
    dot(points[0][1], points[0][2], "#2ecc40");
    dot(points[points.length - 1][1], points[points.length - 1][2], "#ff4136");
    let top = points[0];
    for (const q of points) if (q[2] > top[2]) top = q;
    const [tx, ty] = at(top[1], top[2]);
    c.fillStyle = gtThemeColor("elevation");
    c.font = "10px sans-serif";
    c.fillText(top[2].toFixed(0) + "°", tx, ty - 9);
  }

  // Where it is now, when it is up (above the horizon from the station's height: just under 0° it sits on the outer ring)
  if (sat && !sat.error && sat.up)
  {
    const [x, y] = at(sat.az, sat.el);
    c.fillStyle = "#00e5ff";
    c.strokeStyle = "#000000";
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(x, y, 5, 0, Math.PI * 2);
    c.fill();
    c.stroke();
  }
}

// ---- The side views (under the sky plot, each on its own in BirdWatch settings): the pass's profile (elevation over its time), the
// pass across the horizon (azimuth along it), and the satellite above the curve of the Earth. The colors are the sky plot's

const BIRD_WATCH_SIDE_W = 176;
const BIRD_WATCH_SIDE_H = 110;
const BIRD_WATCH_EARTH_KM = 6371;

function birdWatchSideViewUpdate()
{
  const S = GT.settings.BirdWatch;
  if (!S.sideProfile && !S.sideHorizon && !S.sideEarth) return;
  const T = GT.birdWatchTrack;
  const norad = T.selected;
  const sat = T.last.get(norad);
  const pass = birdWatchWantPasses(norad);
  if (S.sideProfile) birdWatchSideProfile(birdWatchSideViewContext(birdWatchSideProfileCanvas), sat, birdWatchPassArc(norad, pass));
  if (S.sideHorizon) birdWatchSideHorizon(birdWatchSideViewContext(birdWatchSideHorizonCanvas), sat, birdWatchPassArc(norad, pass));
  if (S.sideEarth) birdWatchSideEarth(birdWatchSideViewContext(birdWatchSideEarthCanvas), sat);
}

// The canvas at the screen's pixel ratio, cleared to the background
function birdWatchSideViewContext(canvas)
{
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  if (canvas.width != Math.ceil(BIRD_WATCH_SIDE_W * dpr))
  {
    canvas.width = Math.ceil(BIRD_WATCH_SIDE_W * dpr);
    canvas.height = Math.ceil(BIRD_WATCH_SIDE_H * dpr);
  }
  const c = canvas.getContext("2d");
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = "#06101f";
  c.fillRect(0, 0, BIRD_WATCH_SIDE_W, BIRD_WATCH_SIDE_H);
  c.lineWidth = 1;
  c.font = "9px sans-serif";
  c.textBaseline = "middle";
  return c;
}

// The elevation scale of the profile and the horizon: the lines every 30° up to the pass's top (at least 30°), labeled on the left
function birdWatchSideElevation(c, points, left, right, top, bottom)
{
  const peak = points.reduce((m, q) => Math.max(m, q[2]), 0);
  const ceil = peak > 60 ? 90 : peak > 30 ? 60 : 30;
  const y = (el) => bottom - (Math.max(0, el) / ceil) * (bottom - top);
  c.strokeStyle = "#5a6a85";
  c.fillStyle = "#8fa0bf";
  c.textAlign = "right";
  for (let el = 0; el <= ceil; el += 30)
  {
    c.beginPath();
    c.moveTo(left, y(el) + 0.5);
    c.lineTo(right, y(el) + 0.5);
    c.stroke();
    c.fillText(el + "°", left - 3, y(el) + 0.5);
  }
  return y;
}

// A pass's track (white under the path color), its AOS and LOS (green, red) and its top labeled, as the sky plot draws them
function birdWatchSideTrack(c, xy, peakAt)
{
  for (const [color, width] of [["#ffffff", 4], [GT.settings.BirdWatch.colors.pathLine, 2]])
  {
    c.strokeStyle = color;
    c.lineWidth = width;
    c.beginPath();
    xy.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.stroke();
  }
  birdWatchSideDot(c, xy[0][0], xy[0][1], "#2ecc40", 3.5, "#ffffff", 1);
  birdWatchSideDot(c, xy[xy.length - 1][0], xy[xy.length - 1][1], "#ff4136", 3.5, "#ffffff", 1);
  c.fillStyle = gtThemeColor("elevation");
  c.font = "10px sans-serif";
  c.textAlign = "center";
  c.fillText(peakAt.text, Math.min(BIRD_WATCH_SIDE_W - 12, Math.max(12, peakAt.x)), Math.max(6, peakAt.y - 9));
  c.font = "9px sans-serif";
}

function birdWatchSideDot(c, x, y, fill, radius, stroke, width)
{
  c.fillStyle = fill;
  c.strokeStyle = stroke;
  c.lineWidth = width;
  c.beginPath();
  c.arc(x, y, radius, 0, Math.PI * 2);
  c.fill();
  c.stroke();
  c.lineWidth = 1;
}

// Where it is now, when it is up: the sky plot's dot
function birdWatchSideNow(c, sat, x, y)
{
  if (sat && !sat.error && sat.up) birdWatchSideDot(c, x, y, "#00e5ff", 5, "#000000", 1.5);
}

// Elevation over the pass's time, its AOS and LOS times under its ends
function birdWatchSideProfile(c, sat, points)
{
  const left = 26;
  const right = BIRD_WATCH_SIDE_W - 8;
  const bottom = BIRD_WATCH_SIDE_H - 16;
  const y = birdWatchSideElevation(c, points, left, right, 10, bottom);
  if (points.length < 2) return;
  const t0 = points[0][0];
  const t1 = points[points.length - 1][0];
  const x = (ms) => left + ((ms - t0) / Math.max(1, t1 - t0)) * (right - left);
  let top = points[0];
  for (const q of points) if (q[2] > top[2]) top = q;
  birdWatchSideTrack(c, points.map((q) => [x(q[0]), y(q[2])]), { x: x(top[0]), y: y(top[2]), text: top[2].toFixed(0) + "°" });
  c.fillStyle = "#aab6cc";
  c.textAlign = "left";
  c.fillText(birdWatchClock(t0), left - 4, BIRD_WATCH_SIDE_H - 6);
  c.textAlign = "right";
  c.fillText(birdWatchClock(t1), right + 4, BIRD_WATCH_SIDE_H - 6);
  const now = Date.now();
  if (now >= t0 && now <= t1 && sat) birdWatchSideNow(c, sat, x(now), y(sat.el));
}

// The pass across the horizon, as seen facing it: azimuth along (centered on the pass's top, so the pass is never cut in two), the
// points of the compass under it
function birdWatchSideHorizon(c, sat, points)
{
  const left = 26;
  const right = BIRD_WATCH_SIDE_W - 8;
  const bottom = BIRD_WATCH_SIDE_H - 16;
  const y = birdWatchSideElevation(c, points, left, right, 10, bottom);
  let top = points[0] || null;
  for (const q of points) if (q[2] > top[2]) top = q;
  const center = top ? top[1] : sat && !sat.error ? sat.az : 180;
  const x = (az) => (left + right) / 2 + ((((az - center + 540) % 360) - 180) / 180) * ((right - left) / 2);
  c.strokeStyle = "#5a6a85";
  c.fillStyle = "#aab6cc";
  c.textAlign = "center";
  c.font = "bold 10px sans-serif";
  for (const [az, name] of [[0, "N"], [90, "E"], [180, "S"], [270, "W"]])
  {
    const at = x(az);
    c.beginPath();
    c.moveTo(Math.round(at) + 0.5, bottom);
    c.lineTo(Math.round(at) + 0.5, bottom + 4);
    c.stroke();
    c.fillText(name, Math.min(right, Math.max(left, at)), BIRD_WATCH_SIDE_H - 6);
  }
  c.font = "9px sans-serif";
  if (points.length > 1) birdWatchSideTrack(c, points.map((q) => [x(q[1]), y(q[2])]), { x: x(top[1]), y: y(top[2]), text: top[2].toFixed(0) + "°" });
  if (sat && !sat.error) birdWatchSideNow(c, sat, x(sat.az), y(sat.el));
}

// The satellite above the curve of the Earth, at its height and range, from the side: the station on top, the satellite east of it to
// the right (as the sky plot has it), the station's horizon dashed and the line of sight green when the satellite is up
function birdWatchSideEarth(c, sat)
{
  if (!sat || sat.error || !(sat.range > 0)) return;
  const R = BIRD_WATCH_EARTH_KM;
  const r = R + sat.alt;
  // The angle at the Earth's center between the station and the satellite, from the height and the range
  const theta = Math.acos(Math.max(-1, Math.min(1, (R * R + r * r - sat.range * sat.range) / (2 * R * r))));
  const dir = sat.az < 180 ? 1 : -1;
  // Km about the Earth's center, y up: the station at (0, R)
  const station = [0, R];
  const bird = [dir * r * Math.sin(theta), r * Math.cos(theta)];
  const minX = Math.min(station[0], bird[0]);
  const maxX = Math.max(station[0], bird[0]);
  const minY = Math.min(station[1], bird[1]);
  const maxY = Math.max(station[1], bird[1]);
  // Both in the box, a band under them for the Earth; never closer than 300 km across the height
  const scale = Math.min((BIRD_WATCH_SIDE_W - 40) / Math.max(maxX - minX, 1), (BIRD_WATCH_SIDE_H - 44) / Math.max(maxY - minY, 300));
  const px = (p) => [BIRD_WATCH_SIDE_W / 2 + (p[0] - (minX + maxX) / 2) * scale, 16 + (maxY - p[1]) * scale];
  const [ex, ey] = px([0, 0]);
  c.fillStyle = "#14395e";
  c.strokeStyle = "#3f7fbf";
  c.beginPath();
  c.arc(ex, ey, R * scale, 0, Math.PI * 2);
  c.fill();
  c.stroke();
  const [sx, sy] = px(station);
  const [bx, by] = px(bird);
  // The station's horizon: the tangent through it
  c.strokeStyle = "#8fa0bf";
  c.setLineDash([3, 3]);
  c.beginPath();
  c.moveTo(0, Math.round(sy) + 0.5);
  c.lineTo(BIRD_WATCH_SIDE_W, Math.round(sy) + 0.5);
  c.stroke();
  // The line of sight
  c.strokeStyle = sat.up ? "#2ecc40" : "#ff4136";
  c.lineWidth = 1.5;
  if (sat.up) c.setLineDash([]);
  c.beginPath();
  c.moveTo(sx, sy);
  c.lineTo(bx, by);
  c.stroke();
  c.setLineDash([]);
  c.lineWidth = 1;
  c.fillStyle = "#ffffff";
  c.beginPath();
  c.moveTo(sx, sy - 6);
  c.lineTo(sx - 4, sy + 1);
  c.lineTo(sx + 4, sy + 1);
  c.closePath();
  c.fill();
  birdWatchSideDot(c, bx, by, "#00e5ff", 5, "#000000", 1.5);
  // The height over the satellite, the range under the line of sight's middle
  const clampX = (x) => Math.min(BIRD_WATCH_SIDE_W - 30, Math.max(30, x));
  c.font = "10px sans-serif";
  c.textAlign = "center";
  c.fillStyle = gtThemeColor("distance");
  c.fillText("↑ " + birdWatchDistance(sat.alt), clampX(bx), Math.max(7, by - 11));
  c.fillStyle = sat.up ? "#2ecc40" : "#ff8a80";
  c.fillText("↔ " + birdWatchDistance(sat.range), clampX((sx + bx) / 2), Math.min(BIRD_WATCH_SIDE_H - 7, (sy + by) / 2 + 12));
}

// ---- The timeline

function birdWatchTimelineToggle()
{
  if (birdWatchTimelineDiv.style.display != "none")
  {
    birdWatchTimelineClose();
    return;
  }
  birdWatchTimelineDiv.style.display = "block";
  birdWatchTimelineDraw();
}

function birdWatchTimelineClose()
{
  birdWatchTimelineDiv.style.display = "none";
}

const BIRD_WATCH_ROW = 34;
const BIRD_WATCH_AXIS = 22;
const BIRD_WATCH_LABELS = 84;

function birdWatchTimelineDraw()
{
  const T = GT.birdWatchTrack;
  const P = birdWatchPredictState();
  if (!T.worker) return;
  const tracked = GT.settings.BirdWatch.tracked;
  // Then a row for each active station (Skeds, birdWatchSkeds.js): its mutual passes
  const skeds = birdWatchSkedList().filter((s) => s.active && birdWatchSkedPlace(s));
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(420, Math.min(1000, window.innerWidth - 470));
  const height = BIRD_WATCH_AXIS + (tracked.length + skeds.length) * BIRD_WATCH_ROW + 4;
  if (birdWatchTimelineCanvas.width != Math.ceil(width * dpr) || birdWatchTimelineCanvas.height != Math.ceil(height * dpr))
  {
    birdWatchTimelineCanvas.width = Math.ceil(width * dpr);
    birdWatchTimelineCanvas.height = Math.ceil(height * dpr);
    birdWatchTimelineCanvas.style.width = width + "px";
    birdWatchTimelineCanvas.style.height = height + "px";
  }
  const c = birdWatchTimelineCanvas.getContext("2d");
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, width, height);

  const now = Date.now();
  const span = BIRD_WATCH_TIMELINE_HOURS * 3600000;
  const left = BIRD_WATCH_LABELS;
  const right = width - 8;
  const x = (t) => left + (t - now) / span * (right - left);

  // The hours, on the hour in the user's time mode
  const local = GT.settings.app.useLocalTime == 1;
  const first = new Date(now);
  if (local) first.setMinutes(0, 0, 0);
  else first.setUTCMinutes(0, 0, 0);
  c.font = "11px sans-serif";
  c.textBaseline = "middle";
  c.textAlign = "center";
  for (let t = first.getTime() + 3600000; t < now + span; t += 3600000)
  {
    const hour = local ? new Date(t).getHours() : new Date(t).getUTCHours();
    c.strokeStyle = hour == 0 ? "#8a97b0" : "#2c3a52";
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(Math.round(x(t)) + 0.5, BIRD_WATCH_AXIS - 4);
    c.lineTo(Math.round(x(t)) + 0.5, height);
    c.stroke();
    if (hour % 2 == 0)
    {
      c.fillStyle = hour == 0 ? "#ffffff" : "#aab6cc";
      c.fillText(String(hour).padStart(2, "0"), x(t), 9);
    }
  }

  P.blocks = [];
  tracked.forEach((norad, row) =>
  {
    const top = BIRD_WATCH_AXIS + row * BIRD_WATCH_ROW;
    c.fillStyle = norad == T.selected ? "#0b1c3a" : "#08111f";
    c.fillRect(left, top + 1, right - left, BIRD_WATCH_ROW - 2);
    const tle = birdWatchTleGet(norad);
    c.fillStyle = norad == T.selected ? "#ffff00" : "#ffffff";
    c.font = "bold 12px sans-serif";
    c.textAlign = "left";
    c.fillText(tle ? tle.name : String(norad), 4, top + BIRD_WATCH_ROW / 2, BIRD_WATCH_LABELS - 8);

    birdWatchWantPasses(norad);
    const list = T.passes.get(norad) ? T.passes.get(norad).list : [];
    for (const pass of list)
    {
      if (pass.los < now || pass.aos > now + span) continue;
      const x0 = Math.max(left, x(pass.aos));
      const x1 = Math.min(right, x(pass.los));
      // Taller and brighter the higher the pass climbs
      const h = 6 + (BIRD_WATCH_ROW - 12) * Math.min(1, Math.max(0, pass.maxEl) / 90);
      const y0 = top + (BIRD_WATCH_ROW - h) / 2;
      c.fillStyle = "rgba(255, 255, 0, " + (0.3 + 0.6 * Math.min(1, pass.maxEl / 90)) + ")";
      c.strokeStyle = "#ffffff";
      c.lineWidth = 1;
      c.beginPath();
      c.roundRect(x0, y0, Math.max(3, x1 - x0), h, 3);
      c.fill();
      c.stroke();
      if (x1 - x0 > 30 && h > 13)
      {
        c.fillStyle = "#000000";
        c.font = "10px sans-serif";
        c.textAlign = "center";
        c.fillText(Math.round(pass.maxEl) + "°" + (x1 - x0 > 76 ? "  " + Math.round((pass.los - pass.aos) / 60000) + "m" : ""), (x0 + x1) / 2, top + BIRD_WATCH_ROW / 2);
      }
      if (pass.visible && x1 - x0 > 6)
      {
        c.font = "10px sans-serif";
        c.fillStyle = "#ffffff";
        c.textAlign = "center";
        c.fillText("\u{1F441}", (x0 + x1) / 2, y0 - 2);
      }
      P.blocks.push({ x0: x0, x1: Math.max(x0 + 3, x1), y0: y0, y1: y0 + h, norad: norad, pass: pass });
    }
  });

  // The stations' rows: each mutual window a bar, green for a two-way satellite and cyan for a listen-only one, its satellite and how
  // long it lasts on it when there is room
  const windows = birdWatchSkedWindows(now);
  skeds.forEach((s, i) =>
  {
    const top = BIRD_WATCH_AXIS + (tracked.length + i) * BIRD_WATCH_ROW;
    c.fillStyle = "#0b1f12";
    c.fillRect(left, top + 1, right - left, BIRD_WATCH_ROW - 2);
    // The active station's name yellow, as the selected satellite's is
    c.fillStyle = s.id == birdWatchSkedFocus() ? "#ffff00" : "#90ee90";
    c.font = "bold 12px sans-serif";
    c.textAlign = "left";
    c.fillText(s.call || s.grid, 4, top + BIRD_WATCH_ROW / 2, BIRD_WATCH_LABELS - 8);
    for (const w of windows)
    {
      if (w.key != s.id || w.start > now + span) continue;
      const x0 = Math.max(left, x(w.start));
      const x1 = Math.min(right, x(w.end));
      const y0 = top + 5;
      const h = BIRD_WATCH_ROW - 10;
      c.fillStyle = w.rank == 0 ? "rgba(46, 204, 64, 0.85)" : "rgba(0, 229, 255, 0.75)";
      c.strokeStyle = w.norad == T.selected ? "#ffff00" : "#ffffff";
      c.lineWidth = w.norad == T.selected ? 2 : 1;
      c.beginPath();
      c.roundRect(x0, y0, Math.max(3, x1 - x0), h, 3);
      c.fill();
      c.stroke();
      c.lineWidth = 1;
      if (x1 - x0 > 40)
      {
        c.fillStyle = "#000000";
        c.font = "10px sans-serif";
        c.textAlign = "center";
        c.fillText(w.name + (x1 - x0 > 90 ? "  " + toDHMS(w.seconds) : ""), (x0 + x1) / 2, top + BIRD_WATCH_ROW / 2, x1 - x0 - 4);
      }
      P.blocks.push({ x0: x0, x1: Math.max(x0 + 3, x1), y0: y0, y1: y0 + h, norad: w.norad, sked: w });
    }
  });

  // Now, at the left edge
  c.strokeStyle = "#ff8080";
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(left, BIRD_WATCH_AXIS - 4);
  c.lineTo(left, height);
  c.stroke();
}

// The pass under the mouse: its times and angles as the canvas's tooltip; a click selects its satellite
function birdWatchTimelineBlock(event)
{
  const rect = birdWatchTimelineCanvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  return birdWatchPredictState().blocks.find((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) || null;
}

function birdWatchTimelineMove(event)
{
  const block = birdWatchTimelineBlock(event);
  birdWatchTimelineCanvas.style.cursor = block ? "pointer" : "default";
  if (!block)
  {
    birdWatchTimelineCanvas.title = "";
    return;
  }
  // A station's mutual window (birdWatchSkeds.js)
  if (block.sked)
  {
    birdWatchTimelineCanvas.title = birdWatchSkedTip(block.sked);
    return;
  }
  const tle = birdWatchTleGet(block.norad);
  const pass = block.pass;
  // The times to go count from now: AOS only while it is still ahead
  const now = Date.now();
  const lines = [
    (tle ? tle.name : block.norad),
    I18N("birdWatch.tip.aos") + "  " + userTimeString(pass.aos) + "  " + Math.round(pass.aosAz) + "°"
  ];
  lines.push(I18N("birdWatch.tip.los") + "  " + userTimeString(pass.los) + "  " + Math.round(pass.losAz) + "°");
  if (pass.aos > now) lines.push(I18N("birdWatch.info.timeToAos") + "  " + toDHMS((pass.aos - now) / 1000));
  lines.push(I18N("birdWatch.info.timeToLos") + "  " + toDHMS((pass.los - now) / 1000));
  lines.push(I18N("birdWatch.tip.dos") + "  " + toDHMS((pass.los - pass.aos) / 1000));
  lines.push(I18N("birdWatch.tip.maxElev") + "  " + pass.maxEl.toFixed(1) + "°");
  if (pass.visible) lines.push("\u{1F441}  " + I18N("birdWatch.visible.hover"));
  birdWatchTimelineCanvas.title = lines.join("\n");
}

function birdWatchTimelineClick(event)
{
  const block = birdWatchTimelineBlock(event);
  // A station's mutual pass: picked (its satellite selected, the station the active one: birdWatchSkeds.js)
  if (block && block.sked) birdWatchSkedPick(block.sked);
  else if (block && block.norad != GT.birdWatchTrack.selected) birdWatchSelect(block.norad);
}
