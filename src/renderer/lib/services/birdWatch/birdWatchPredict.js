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
  birdWatchSkyBox.style.display = T.selected && GT.settings.Birdwatch.skybox ? "block" : "none";
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
    if (GT.settings.Birdwatch.colors.pathOn && !p.pending && now - p.at > BIRD_WATCH_PATH_REFRESH_MS)
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
  birdWatchDopplerUpdate();
  if (T.selected && GT.settings.Birdwatch.skybox) birdWatchSkyUpdate();
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
  const color = GT.settings.Birdwatch.colors.pathLine;
  const width = GT.settings.Birdwatch.colors.pathWidth;
  const size = GT.settings.Birdwatch.colors.pathTimeSize;
  const outline = GT.settings.Birdwatch.colors.pathOutlineOn;
  const dash = GT.settings.Birdwatch.colors.pathDashOn;
  const halo = new ol.style.Stroke({ color: birdWatchRgba(GT.settings.Birdwatch.colors.pathOutline, 0.55), width: width + 2.5 });
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
  if (!GT.settings.Birdwatch.colors.pathOn || !p || p.points.length < 4 || !sat || sat.error || !birdWatchPredicted(norad) || !GT.layerSources.birdWatch) return;

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
  for (let t = now + BIRD_WATCH_PATH_TICK_MS; GT.settings.Birdwatch.colors.pathTimeOn && t <= last; t += BIRD_WATCH_PATH_TICK_MS)
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
// The satellite that is up is selected; with none up, the one that rises next. Of two up at once, the one that sets first
// is followed until it does, and then the other (when one that was being followed sets, the next to pick is simply the
// next that is up, so this is no special case). Picked once per change, so a click on another satellite stays until the pick moves on.
// Only a pass that climbs at least the Auto-Track lowest max elevation (BirdWatch settings, General) counts

function birdWatchAutoToggle()
{
  GT.settings.Birdwatch.auto = !GT.settings.Birdwatch.auto;
  birdWatchAutoImg.style.filter = GT.settings.Birdwatch.auto ? "" : "grayscale(1)";
  if (GT.birdWatchTrack) GT.birdWatchTrack.autoPick = null;
  birdWatchAutoUpdate();
}

function birdWatchAutoUpdate()
{
  const T = GT.birdWatchTrack;
  if (!GT.settings.Birdwatch.auto || !T.worker) return;
  const up = [];
  let next = null;
  const minEl = GT.settings.Birdwatch.autoMinElevation || 0;
  const now = Date.now();
  for (const norad of GT.settings.Birdwatch.tracked)
  {
    const sat = T.last.get(norad);
    if (!sat || sat.error) continue;
    const current = birdWatchWantPasses(norad);
    const pass = T.passes.get(norad).list.find((x) => x.los > now && x.maxEl >= minEl) || null;
    if (!pass) continue;
    if (sat.up && pass === current) up.push({ norad: norad, los: pass.los });
    else if (!next || pass.aos < next.aos) next = { norad: norad, aos: pass.aos };
  }
  let pick = null;
  if (up.length) pick = up.some((s) => s.norad == T.autoPick) ? T.autoPick : up.sort((a, b) => a.los - b.los)[0].norad;
  else if (next) pick = next.norad;
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
  const P = birdWatchPredictState();
  const norad = T.selected;
  const sat = T.last.get(norad);
  const pass = birdWatchWantPasses(norad);
  let arc = P.arcs.get(norad);
  if (pass)
  {
    const key = pass.aos + "|" + pass.los;
    if ((!arc || (arc.key != key && arc.pendingKey != key)))
    {
      P.arcs.set(norad, arc = { key: arc ? arc.key : null, pendingKey: key, points: arc ? arc.points : [] });
      T.worker.postMessage({ type: "arc", norad: norad, from: pass.aos, to: pass.los, stepSec: 10, id: key });
    }
  }
  birdWatchSkyDraw(sat, pass, arc && pass && arc.key == pass.aos + "|" + pass.los ? arc.points : []);
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
  if (sat && !sat.error && sat.el >= 0) busy.push(at(sat.az, sat.el));
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

  const color = GT.settings.Birdwatch.colors.pathLine;
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
    c.fillStyle = "#ffffff";
    c.font = "10px sans-serif";
    c.fillText(top[2].toFixed(0) + "°", tx, ty - 9);
  }

  // Where it is now, when it is up
  if (sat && !sat.error && sat.el >= 0)
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
  const tracked = GT.settings.Birdwatch.tracked;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(420, Math.min(1000, window.innerWidth - 470));
  const height = BIRD_WATCH_AXIS + tracked.length * BIRD_WATCH_ROW + 4;
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
  if (block && block.norad != GT.birdWatchTrack.selected) birdWatchSelect(block.norad);
}
