// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// BirdWatch panel: the satellite selected by a left click on the map (ringed there like a SOTA / DX Feeds selection),
// with its names, position, look angles, range and next AOS / LOS. The tracker (birdWatchWorker.js) supplies the numbers

const BIRD_WATCH_PASS_HOURS = 24;
const BIRD_WATCH_PASS_RETRY_MS = 10 * 60 * 1000;
// A list this old is asked again, so the next 24 hours (the Pass Timeline's) stay in it: one satellite's at a time, this far apart, so
// many tracked satellites don't hold up the tracker's ticks all at once
const BIRD_WATCH_PASS_RENEW_MS = 60 * 60 * 1000;
const BIRD_WATCH_PASS_RENEW_GAP_MS = 5000;
// A pass worked out again is the same pass when its AOS and its LOS are this close to the one known (birdWatchPanelPasses)
const BIRD_WATCH_PASS_SAME_MS = 2000;
// A request not answered in this long never will be (the tracker couldn't work it out: an element set that stops propagating part way
// through a pass, as a decaying satellite's does, gets an error without its id): let go, so it can be asked again
const BIRD_WATCH_PASS_STALL_MS = 5 * 60 * 1000;

// The twenty satellite icons (img/sat), picked by the catalog number (its remainder divided by 20)
const BIRD_WATCH_ICONS = ["sat-01-classic", "sat-02-dish", "sat-03-cubesat", "sat-04-sputnik", "sat-05-station", "sat-06-telescope", "sat-07-flatsat", "sat-08-oscar", "sat-09-yagi", "sat-10-beacon",
  "sat-11-sixu", "sat-12-iridium", "sat-13-wing", "sat-14-cross", "sat-15-drum", "sat-16-weather", "sat-17-comsat", "sat-18-tether", "sat-19-sail", "sat-20-helix"];

// ---- The boxes under the BirdWatch title (#birdWatchBoxes, each with its data-box name), in the order the user dragged them to by their
// top borders (panelBoxes.js; settings.BirdWatch.boxOrder); the title always stays on top

let birdWatchBoxesReady = false;

// Once, at the first layout: the saved order and dragging, and the info box's minimized state
function birdWatchBoxesInit()
{
  if (birdWatchBoxesReady) return;
  birdWatchBoxesReady = true;
  panelBoxesInit(birdWatchBoxes, GT.settings.BirdWatch.boxOrder, (names) => (GT.settings.BirdWatch.boxOrder = names));
  birdWatchInfoCollapseRender();
}

// BirdWatch settings, Panel View: Reset Panels puts the boxes back in their first order
function birdWatchResetPanels()
{
  GT.settings.BirdWatch.boxOrder = panelBoxesReset(birdWatchBoxes);
}

// The info box's - / +: minimized, only the satellite's name shows (like the control panel's Map View Filters)
function birdWatchInfoCollapseToggle()
{
  GT.settings.BirdWatch.infoCollapsed = GT.settings.BirdWatch.infoCollapsed !== true;
  birdWatchInfoCollapseRender();
}

function birdWatchInfoCollapseRender()
{
  const collapsed = GT.settings.BirdWatch.infoCollapsed === true;
  birdWatchInfoLong.style.display = collapsed ? "none" : "";
  birdWatchInfoPos.style.display = collapsed ? "none" : "";
  birdWatchInfoCollapseImg.src = collapsed ? "img/maximize.png" : "img/minimize.png";
  birdWatchInfoCollapseImg.title = I18N(collapsed ? "roster.menu.ShowControls" : "roster.menu.HideControls");
}

// The SatNOGS satellite database entries (satellites.json in Ginternal\sat), read when first needed and again when the
// file changes
function birdWatchSatInfo(norad)
{
  const D = GT.birdWatchDb || (GT.birdWatchDb = { stamp: "", map: new Map() });
  try
  {
    const file = path.join(satDir(), "satellites.json");
    const stat = fs.statSync(file);
    const stamp = stat.mtimeMs + ":" + stat.size;
    if (stamp != D.stamp)
    {
      const map = new Map();
      for (const sat of JSON.parse(fs.readFileSync(file, "utf8"))) map.set(Number(sat.norad_cat_id), sat);
      D.map = map;
      D.stamp = stamp;
    }
  }
  catch (e)
  {
    return null;
  }
  return D.map.get(Number(norad)) || null;
}

// The SatNOGS satellites on a temporary catalog number: the real number each follows (norad_follow_id) -> its temporary one, for the
// element sets filed under the real one (birdWatchTleRebuild). Not when the database has a satellite of its own under the real number
function birdWatchSatFollows()
{
  birdWatchSatInfo(0);
  const D = GT.birdWatchDb;
  if (!D) return new Map();
  if (D.followsStamp !== D.stamp)
  {
    const follows = new Map();
    for (const [norad, sat] of D.map)
    {
      const real = Number(sat.norad_follow_id);
      if (real > 0 && real != norad && !D.map.has(real)) follows.set(real, norad);
    }
    D.follows = follows;
    D.followsStamp = D.stamp;
  }
  return D.follows;
}

// The name under the short one: the database's own when it differs, else the first other name it lists
function birdWatchLongName(info, name)
{
  if (!info) return "";
  const same = (a) => String(a).replace(/[\s-]/g, "").toLowerCase() == String(name).replace(/[\s-]/g, "").toLowerCase();
  if (info.name && !same(info.name)) return info.name;
  return String(info.names || "").split(",").map((n) => n.trim()).find((n) => n && !same(n)) || "";
}

// Everything the database says, for the tooltip
function birdWatchSatDescription(norad, tle, info)
{
  const lines = [tle.name + "  (" + norad + ")"];
  if (!info) return lines.join("\n");
  if (info.name && info.name != tle.name) lines.push(info.name);
  if (info.names) lines.push(info.names);
  const day = (iso) => (iso ? String(iso).slice(0, 10) : "");
  if (info.status) lines.push(info.status + (info.decayed ? " (" + day(info.decayed) + ")" : ""));
  if (info.launched) lines.push("Launched " + day(info.launched));
  if (info.operator && info.operator != "None") lines.push(info.operator);
  if (info.countries) lines.push(info.countries.split(",").join(", "));
  return lines.join("\n");
}

// A selected satellite's element set this many days old (or more) is said to be old in the Event Viewer
const BIRD_WATCH_TLE_STALE_DAYS = 14;

// Left click on a satellite on the map: select it, or clear the selection when it already is. auto: Auto-Track's pick (Sticky Mode then)
function birdWatchSelect(norad, auto = false)
{
  const T = GT.birdWatchTrack;
  norad = norad == T.selected ? null : Number(norad);
  // The transmitter followed until now, for Sticky Mode's choice on the new satellite
  const previous = birdWatchStickyPrevious();
  T.selected = norad;
  // Auto-Track's pick or the user's: followed as Auto-Track's Rig Control says when Auto-Track's, also once the rig connects later
  T.selectedByAuto = !!(norad && auto);
  // One you picked yourself holds Auto-Track's Skeds modes off until its LOS (birdWatchSkeds.js)
  birdWatchSkedSelected(norad, auto);
  // The rig stops following the last satellite's transmitter (birdWatchDoppler.js)
  birdWatchDopplerStopFollow();
  for (const [id, marker] of T.markers) birdWatchStyleMarker(marker, id == norad);
  birdWatchFootprintSync();
  birdWatchInfoDiv.style.display = norad ? "block" : "none";
  birdWatchDopplerButtonUpdate();
  birdWatchPredictApply();
  if (norad) birdWatchPanelFill(norad);
  else birdWatchSetSat(null);
  // In the Event Viewer: which satellite, and whether Auto-Track picked it
  const tle = norad ? birdWatchTleGet(norad) : null;
  const name = tle ? tle.name : String(norad);
  addEvent("birdwatch", "<font style='color:var(--gt-label)'>" + htmlEntities(norad ? I18N(auto ? "birdWatch.event.autoSelected" : "birdWatch.event.selected").replace("{sat}", () => name) : I18N("birdWatch.event.deselected")) + "</font>");
  // An old element set: where it is and when it passes drift further off each day
  const days = tle && tle.epoch > 0 ? Math.floor((Date.now() - tle.epoch) / 86400000) : 0;
  if (days >= BIRD_WATCH_TLE_STALE_DAYS) addEvent("birdwatch", "<font style='color:var(--gt-warning)'>" + htmlEntities(I18N("birdWatch.event.staleTle").replace("{sat}", () => name).replace("{days}", days)) + "</font>");
  // The rig follows the transmitter last followed on the new satellite, or (Sticky Mode, Auto-Track's pick only) the previous satellite's mode
  if (norad) birdWatchStickyFollow(norad, previous, auto);
}

// The ground circle a satellite can be seen from (its footprint, or radio horizon): where it is at least at the horizon,
// from its height. The angle at the Earth's center is acos(R / (R + h)). Colors:
// BirdWatch settings, Colors
function birdWatchRgba(hex, alpha)
{
  const n = parseInt(String(hex).replace("#", ""), 16) || 0;
  return "rgba(" + (n >> 16 & 255) + ", " + (n >> 8 & 255) + ", " + (n & 255) + ", " + alpha + ")";
}

// The flat map repeats a feature in the worlds either side only when zoomed out far enough to see them, so a line or polygon with
// longitudes past 180 would be cut off when zoomed in beside the date line. These split one at the date line, each part
// moved into world 0
function birdWatchWorldOf(x)
{
  return Math.floor((x + 180) / 360);
}

// A line of continuous longitudes: the parts, each a list of [lon, lat]
function birdWatchSplitLine(coords)
{
  const parts = [];
  let part = null;
  let world = null;
  const push = (x, y, w) =>
  {
    if (w !== world)
    {
      part = [];
      parts.push(part);
      world = w;
    }
    part.push([x - 360 * w, y]);
  };
  push(coords[0][0], coords[0][1], birdWatchWorldOf(coords[0][0]));
  for (let i = 1; i < coords.length; i++)
  {
    let [x1, y1] = coords[i - 1];
    const [x2, y2] = coords[i];
    const w2 = birdWatchWorldOf(x2);
    let w = world;
    while (w != w2)
    {
      const dir = w2 > w ? 1 : -1;
      const edge = dir > 0 ? 180 + 360 * w : -180 + 360 * w;
      const y = y1 + (edge - x1) / (x2 - x1) * (y2 - y1);
      push(edge, y, w);
      w += dir;
      push(edge, y, w);
      x1 = edge;
      y1 = y;
    }
    push(x2, y2, w2);
  }
  return parts.filter((p) => p.length > 1);
}

function birdWatchClipEdge(list, inside, edge)
{
  const out = [];
  for (let i = 0; i < list.length; i++)
  {
    const a = list[i];
    const b = list[(i + 1) % list.length];
    const ia = inside(a);
    if (ia) out.push(a);
    if (ia != inside(b)) out.push([edge, a[1] + (edge - a[0]) / (b[0] - a[0]) * (b[1] - a[1])]);
  }
  return out;
}

// A ring of continuous longitudes: the polygons, each [ring]
function birdWatchSplitPolygon(ring)
{
  const points = ring.slice();
  if (points.length > 1 && points[0][0] == points[points.length - 1][0] && points[0][1] == points[points.length - 1][1]) points.pop();
  const xs = points.map((p) => p[0]);
  const first = birdWatchWorldOf(Math.min(...xs));
  const last = birdWatchWorldOf(Math.max(...xs) - 1e-9);
  const polygons = [];
  for (let k = first; k <= last; k++)
  {
    let out = birdWatchClipEdge(points, (p) => p[0] >= 360 * k - 180, 360 * k - 180);
    out = birdWatchClipEdge(out, (p) => p[0] <= 360 * k + 180, 360 * k + 180);
    if (out.length < 3) continue;
    const shifted = out.map((p) => [p[0] - 360 * k, p[1]]);
    shifted.push(shifted[0]);
    polygons.push([shifted]);
  }
  return polygons;
}

// A circle's fill and line (birdWatchFootprintGeoJson) ready for the flat map: split at the date line (the AEQD map needs no change)
function birdWatchWorldJson(json)
{
  if (GT.useTransform) return json;
  const polygons = birdWatchSplitPolygon(json.fill.geometry.coordinates[0]);
  return {
    fill: { type: "Feature", properties: {}, geometry: polygons.length == 1 ? { type: "Polygon", coordinates: polygons[0] } : { type: "MultiPolygon", coordinates: polygons } },
    line: birdWatchLineJson(birdWatchSplitLine(json.line.geometry.coordinates))
  };
}

function birdWatchLineJson(parts)
{
  return { type: "Feature", properties: {}, geometry: parts.length == 1 ? { type: "LineString", coordinates: parts[0] } : { type: "MultiLineString", coordinates: parts } };
}

// The footprint is two features, so the closing edges a pole needs are filled but never stroked: the fill (under the icons),
// and the circle's line (just under them)
function birdWatchFootprintStyles()
{
  const colors = GT.settings.BirdWatch.colors;
  return {
    fill: new ol.style.Style({ zIndex: -2, fill: new ol.style.Fill({ color: birdWatchRgba(colors.footprintFill, 1 - colors.footprintTransparency) }) }),
    line: new ol.style.Style({ zIndex: -1, stroke: new ol.style.Stroke({ color: colors.footprintRing, width: 1 }) })
  };
}

// The circle in longitude and latitude, as two GeoJSON features for the map's feature builder (shapeFeature): its line and its fill.
// A circle that crosses the date line has its longitudes run on past 180, centered on the satellite's longitude so that
// every world the map draws side by side shows it (the map repeats a feature one world at a time either side of where it is).
// A circle that holds a pole is cut at the date line instead: its line runs from -180 to 180 and its fill is closed over
// the pole, like the Shadow's polygon, in both projections (the builder needs a polygon closed in longitude and latitude
// to know whether it holds the AEQD antipode)
function birdWatchFootprintGeoJson(lat, lon, radiusKm)
{
  lat = Math.max(-89.999, Math.min(89.999, lat));
  const points = [];
  for (let bearing = 0; bearing < 360; bearing += 2)
  {
    const d = getDestination(lat, lon, bearing, radiusKm);
    points.push([d.lng, d.lat]);
  }
  const feature = (type, coordinates) => ({ type: "Feature", properties: {}, geometry: { type: type, coordinates: coordinates } });

  // Where the angle at the Earth's center reaches a pole: the circle holds it
  const pole = Math.abs(lat) + radiusKm / EARTH_RADIUS_KM * 180 / Math.PI >= 90;
  if (pole)
  {
    points.sort((p, q) => p[0] - q[0]);
    // The circle at the date line, from its neighbours either side of it
    const first = points[0];
    const last = points[points.length - 1];
    const t = (180 - last[0]) / (first[0] + 360 - last[0]);
    const edgeLat = last[1] + t * (first[1] - last[1]);
    const line = [[-180, edgeLat]].concat(points, [[180, edgeLat]]);
    const edge = (GT.useTransform ? 89.99 : 85) * (lat >= 0 ? 1 : -1);
    return { fill: feature("Polygon", [line.concat([[180, edge], [-180, edge], line[0]])]), line: feature("LineString", line) };
  }

  // Not around a pole: one closed loop, the longitudes made continuous
  const ring = [];
  let prevLng = 0;
  for (const p of points)
  {
    ring.push([ring.length ? ring[ring.length - 1][0] + ((p[0] - prevLng + 540) % 360 - 180) : p[0], p[1]]);
    prevLng = p[0];
  }
  const shift = 360 * Math.round((lon - ring.reduce((sum, p) => sum + p[0], 0) / ring.length) / 360);
  for (const p of ring) p[0] += shift;
  ring.push(ring[0]);
  return { fill: feature("Polygon", [ring]), line: feature("LineString", ring) };
}

// Only the selected satellite's and the hovered one's footprint is shown
function birdWatchFootprintSync()
{
  const T = GT.birdWatchTrack;
  for (const [norad, sat] of T.last)
  {
    if (!sat.error && GT.settings.BirdWatch.colors.footprintOn && (norad == T.selected || norad == T.hover)) birdWatchFootprint(sat);
  }
  for (const [norad, ring] of T.rings)
  {
    if (!GT.settings.BirdWatch.colors.footprintOn || (norad != T.selected && norad != T.hover))
    {
      GT.layerSources.birdWatch.removeFeature(ring.fill);
      GT.layerSources.birdWatch.removeFeature(ring.line);
      T.rings.delete(norad);
    }
  }
}

function birdWatchFootprint(sat)
{
  const T = GT.birdWatchTrack;
  const radius = EARTH_RADIUS_KM * Math.acos(EARTH_RADIUS_KM / (EARTH_RADIUS_KM + sat.alt));
  const json = birdWatchWorldJson(birdWatchFootprintGeoJson(sat.lat, sat.lon, radius));

  let ring = T.rings.get(sat.norad);
  if (!ring)
  {
    const styles = birdWatchFootprintStyles();
    ring = { fill: new ol.Feature({ prop: "birdWatchRing" }), line: new ol.Feature({ prop: "birdWatchRing" }) };
    ring.fill.setStyle(styles.fill);
    ring.line.setStyle(styles.line);
    GT.layerSources.birdWatch.addFeature(ring.fill);
    GT.layerSources.birdWatch.addFeature(ring.line);
    T.rings.set(sat.norad, ring);
  }
  ring.fill.setGeometry(shapeFeature("birdWatchRing", json.fill, "birdWatchRing", "#00000000", "#00000000", 1).getGeometry());
  ring.line.setGeometry(shapeFeature("birdWatchRing", json.line, "birdWatchRing", "#00000000", "#00000000", 1).getGeometry());
}

// The Colors tab
function birdWatchColorsRender()
{
  const colors = GT.settings.BirdWatch.colors;
  birdWatchFootprintOn.checked = colors.footprintOn;
  birdWatchFootprintRing.value = colors.footprintRing;
  birdWatchFootprintFill.value = colors.footprintFill;
  birdWatchFootprintTransparency.value = colors.footprintTransparency;
  birdWatchFootprintTransparencyText.textContent = Math.round(colors.footprintTransparency * 100) + "%";
  birdWatchPathLine.value = colors.pathLine;
  birdWatchPathWidth.value = colors.pathWidth;
  birdWatchPathWidthText.textContent = colors.pathWidth;
  birdWatchPathOn.checked = colors.pathOn;
  birdWatchPathDashOn.checked = colors.pathDashOn;
  birdWatchPathOutlineOn.checked = colors.pathOutlineOn;
  birdWatchPathOutline.value = colors.pathOutline;
  birdWatchPathTimeOn.checked = colors.pathTimeOn;
  birdWatchPathTimeSize.value = colors.pathTimeSize;
  birdWatchPathTimeSizeText.textContent = colors.pathTimeSize + " pt";
  birdWatchColorsEnable();
}

// A row of the Map box switched off greys its options out (the cells and rows marked with its data-opt)
function birdWatchColorsEnable()
{
  const colors = GT.settings.BirdWatch.colors;
  for (const [key, on] of [["footprint", colors.footprintOn], ["path", colors.pathOn]])
  {
    for (const el of birdWatchDisplayDiv.querySelectorAll("[data-opt='" + key + "']"))
    {
      el.style.opacity = on ? "1" : "0.45";
      for (const input of el.querySelectorAll("input")) input.disabled = !on;
    }
  }
  // The outline's swatch is only there while the outline is on
  birdWatchPathOutlineSwatch.style.display = colors.pathOutlineOn ? "" : "none";
}

function birdWatchColorsChange()
{
  const colors = GT.settings.BirdWatch.colors;
  colors.footprintOn = birdWatchFootprintOn.checked;
  colors.pathOn = birdWatchPathOn.checked;
  colors.pathDashOn = birdWatchPathDashOn.checked;
  colors.pathOutlineOn = birdWatchPathOutlineOn.checked;
  colors.pathOutline = birdWatchPathOutline.value;
  colors.pathTimeOn = birdWatchPathTimeOn.checked;
  colors.pathTimeSize = Number(birdWatchPathTimeSize.value);
  birdWatchPathTimeSizeText.textContent = colors.pathTimeSize + " pt";
  birdWatchColorsEnable();
  colors.footprintRing = birdWatchFootprintRing.value;
  colors.footprintFill = birdWatchFootprintFill.value;
  colors.footprintTransparency = Number(birdWatchFootprintTransparency.value);
  colors.pathLine = birdWatchPathLine.value;
  colors.pathWidth = Number(birdWatchPathWidth.value);
  birdWatchPathWidthText.textContent = colors.pathWidth;
  birdWatchFootprintTransparencyText.textContent = Math.round(colors.footprintTransparency * 100) + "%";
  const T = GT.birdWatchTrack;
  if (!T) return;
  birdWatchFootprintSync();
  const styles = birdWatchFootprintStyles();
  for (const ring of T.rings.values())
  {
    ring.fill.setStyle(styles.fill);
    ring.line.setStyle(styles.line);
  }
  if (T.selected)
  {
    // Switched on: the path is asked for at the next tick
    const p = colors.pathOn ? T.predict.paths.get(T.selected) : null;
    if (p && !T.predict.features.has(T.selected)) p.at = 0;
    birdWatchPathDraw(T.selected);
  }
}

// A satellite's marker: its icon and name, with the selection ring while selected
function birdWatchStyleMarker(marker, selected)
{
  if (!marker.baseStyle)
  {
    const tle = birdWatchTleGet(marker.get("norad"));
    // Santa's rounded label (seasonal.js), black outline, clear of the selection ring: dark blue with yellow text, and for the selected
    // satellite light green with black text (high contrast, it stands out from the others on every base map)
    const name = tle ? tle.name : String(marker.get("norad"));
    marker.baseStyle = new ol.style.Style({ image: new ol.style.Icon({ src: "img/sat/" + BIRD_WATCH_ICONS[Number(marker.get("norad")) % BIRD_WATCH_ICONS.length] + ".png", scale: 0.07 }) });
    marker.labelStyle = santaLabelStyle(name, { fill: "#00008b", stroke: "#000000", text: "#ffff00" }, 30);
    marker.labelSelectedStyle = santaLabelStyle(name, { fill: "#90ee90", stroke: "#000000", text: "#000000" }, 30);
  }
  marker.setStyle(marker.baseStyle);
  if (selected) ringSelectedMarker(marker);
  // The label is part of the marker's own style, so it moves with the icon in the same draw
  marker.setStyle([].concat(marker.getStyle(), selected ? marker.labelSelectedStyle : marker.labelStyle));
}

// The fixed parts for a newly selected satellite
function birdWatchPanelFill(norad)
{
  const tle = birdWatchTleGet(norad);
  if (!tle)
  {
    birdWatchSetSat(null);
    return;
  }
  const info = birdWatchSatInfo(norad);
  birdWatchSetSat({ name: tle.name, longName: birdWatchLongName(info, tle.name), description: birdWatchSatDescription(norad, tle, info) });
}

// Right click on the satellite's name (BirdWatch panel): its page in the SatNOGS database, in the browser (by its SatNOGS id; a
// satellite the database doesn't have is searched for by its catalog number). Not in Offline Mode
function birdWatchOpenSatnogs(event)
{
  event.preventDefault();
  if (GT.settings.map.offlineMode) return;
  const norad = GT.birdWatchTrack && GT.birdWatchTrack.selected;
  if (!norad) return;
  const info = birdWatchSatInfo(norad);
  window.open(info && info.sat_id ? "https://db.satnogs.org/satellite/" + encodeURIComponent(info.sat_id) : "https://db.satnogs.org/search/?q=" + norad, "_blank");
}

function birdWatchSetSat(sat)
{
  birdWatchInfoName.textContent = sat ? sat.name : "";
  birdWatchInfoLong.textContent = sat ? sat.longName : "";
  birdWatchInfoNames.title = sat ? sat.description : "";
}

// The time of day in the user's time mode (Settings, UTC or local), the whole date and time in its tooltip
function birdWatchTimeHtml(ms)
{
  const t = new Date(ms);
  const text = GT.settings.app.useLocalTime == 1 ? t.toLocaleTimeString() : t.toISOString().slice(11, 19) + " UTC";
  return "<span title='" + userTimeString(ms) + "'>" + text + "</span>";
}

function birdWatchAzHtml(az)
{
  return "<span style='color:var(--gt-azimuth)'>" + Math.round(az) + "&deg;</span>";
}

// A time and the bearing at it (AOS, LOS and TCA), each in a box of its own: in the info panel (style.css) the boxes have a width, so the
// times of the three rows line up whatever the degrees are
function birdWatchTimeAzHtml(ms, az)
{
  return "<span class='birdInfoTime'>" + birdWatchTimeHtml(ms) + "</span>" + (az === undefined ? "" : " <span class='birdInfoAz'>" + birdWatchAzHtml(az) + "</span>");
}

// The next pass of a satellite, asked of the tracker when none is known (not more often than every few minutes), and again once its
// list is an hour old (the passes it had are kept: birdWatchPanelPasses). Up now: the pass under way, its AOS only known when it was
// seen coming
function birdWatchWantPasses(norad)
{
  const T = GT.birdWatchTrack;
  let p = T.passes.get(norad);
  if (!p) T.passes.set(norad, p = { list: [], at: 0, pending: false });
  const now = Date.now();
  if (p.pending && now - p.at > BIRD_WATCH_PASS_STALL_MS) p.pending = false;
  const pass = p.list.find((x) => x.los > now) || null;
  const renew = !!pass && now - p.at > BIRD_WATCH_PASS_RENEW_MS && now - (T.passRenewAt || 0) > BIRD_WATCH_PASS_RENEW_GAP_MS;
  if (!p.pending && (renew || (!pass && now - p.at > BIRD_WATCH_PASS_RETRY_MS)))
  {
    if (renew) T.passRenewAt = now;
    p.pending = true;
    p.at = now;
    T.worker.postMessage({ type: "passes", id: norad, norad: norad, hours: BIRD_WATCH_PASS_HOURS });
  }
  return pass;
}

// The distance along the ground from you to the point under the satellite, in kilometers
function birdWatchGroundKm(sat)
{
  const r = Math.PI / 180;
  const a = Math.sin((sat.lat - GT.myLat) * r / 2) ** 2 + Math.cos(GT.myLat * r) * Math.cos(sat.lat * r) * Math.sin((sat.lon - GT.myLon) * r / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

// A distance in kilometers in the user's unit (Settings, distance), whole numbers
function birdWatchDistance(km)
{
  return Math.round(kilometerToUnit(km, GT.settings.app.distanceUnit)) + " " + GT.settings.app.distanceUnit.toLowerCase();
}

// The transmitter the Doppler shift and the signal loss are worked out for: the first downlink of the satellite's active transmitters
// (the amateur ones first, as the Doppler table lists them): { hz, name } or null
function birdWatchReferenceFrequency(norad)
{
  if (typeof birdWatchTransmitters != "function") return null;
  const t = birdWatchTransmitters(norad).find((x) => x.downlink_low > 0);
  return t ? { hz: t.downlink_high > t.downlink_low ? (t.downlink_low + t.downlink_high) / 2 : t.downlink_low, name: t.description } : null;
}

// What the panel and the hover tooltip show for a satellite, from its latest tracker sample: null until there is one
function birdWatchNumbers(norad)
{
  const T = GT.birdWatchTrack;
  const sat = T.last.get(norad);
  if (!sat || sat.error) return null;
  const now = Date.now();
  const pass = birdWatchWantPasses(norad);
  const ref = birdWatchReferenceFrequency(norad);
  const numbers = {
    up: sat.up,
    lat: Number(sat.lat.toFixed(2)),
    lon: Number(sat.lon.toFixed(2)),
    grid: Math.abs(sat.lat) < 90 ? latLonToGridSquare(sat.lat, sat.lon, 6) : "",
    az: sat.az.toFixed(1) + "°",
    el: sat.el.toFixed(1) + "°",
    range: birdWatchDistance(sat.range),
    ground: birdWatchDistance(birdWatchGroundKm(sat)),
    altitude: birdWatchDistance(sat.alt),
    velocity: kilometerToUnit(sat.speed, GT.settings.app.distanceUnit).toFixed(2) + " " + GT.settings.app.distanceUnit.toLowerCase() + "/s",
    footprint: birdWatchDistance(2 * EARTH_RADIUS_KM * Math.acos(EARTH_RADIUS_KM / (EARTH_RADIUS_KM + sat.alt))),
    // Worked out for the satellite's first downlink; a satellite with none listed has no figure
    doppler: ref ? (ref.hz * (sat.doppler - 1) >= 0 ? "+" : "") + (ref.hz * (sat.doppler - 1) / 1000).toFixed(2) + " kHz" : "-",
    sigloss: ref ? (20 * Math.log10(sat.range) + 20 * Math.log10(ref.hz / 1e6) + 32.44).toFixed(1) + " dB" : "-",
    sigdelay: (sat.range / 299792.458 * 1000).toFixed(2) + " ms",
    refText: ref ? I18N("birdWatch.tip.at").replace("{f}", (ref.hz / 1e6).toFixed(6)) + " (" + ref.name + ")" : "",
    aos: pass ? birdWatchTimeAzHtml(pass.aos, pass.aosAz) : "-",
    los: pass ? birdWatchTimeAzHtml(pass.los, pass.losAz) : "-",
    dos: pass ? toDHMS((pass.los - pass.aos) / 1000) : "-",
    max: pass ? "<span title='" + userTimeString(pass.maxElTime) + "'>" + pass.maxEl.toFixed(1) + "&deg;</span>" + (pass.visible ? " <span title='" + htmlEntities(I18N("birdWatch.visible.hover")).replace(/'/g, "&#39;") + "'>\u{1F441}</span>" : "") : "-",
    ttgoLabel: I18N(sat.up ? "birdWatch.info.timeToLos" : "birdWatch.info.timeToAos"),
    ttgoShort: I18N(sat.up ? "birdWatch.info.tlos" : "birdWatch.info.taos"),
    ttgoFull: I18N(sat.up ? "birdWatch.tip.timeToLos" : "birdWatch.tip.timeToAos"),
    ttgo: pass ? toDHMS(Math.max(0, ((sat.up ? pass.los : pass.aos) - now) / 1000)) : "-"
  };
  // The rows of the info panel that are not in the tracker's sample (birdWatchInfo.js)
  return Object.assign(numbers, birdWatchInfoExtras(norad, sat, pass, now));
}

// Each tracker tick: the latest numbers are kept, and the selected satellite's and the hovered one's are shown
function birdWatchPanelUpdate(sats)
{
  const T = GT.birdWatchTrack;
  for (const sat of sats)
  {
    sat.heading = birdWatchHeading(T.last.get(sat.norad), sat);
    T.last.set(sat.norad, sat);
  }
  if (T.hover) birdWatchHoverFill();
  birdWatchFootprintSync();
  birdWatchPredictUpdate();
  if (!T.selected) return;

  // Rotor Control's Follow Satellite (rotor.js)
  rotorFollowSatellite(T.last.get(T.selected), birdWatchWantPasses(T.selected));

  const n = birdWatchNumbers(T.selected);
  birdWatchInfoPos.style.visibility = n ? "visible" : "hidden";
  if (!n) return;
  birdWatchInfoUpdate(n);
}

// From the tracker: a satellite's passes. One it had already (the list asked again: the same pass worked out again is a second or so
// off) is kept as it was, so what goes by it (its arc in the sky plot, Auto-Track's pick) carries on
function birdWatchPanelPasses(m)
{
  const p = GT.birdWatchTrack.passes.get(m.norad);
  if (!p) return;
  const known = p.list;
  p.list = (m.passes || []).map((pass) => known.find((x) => Math.abs(x.aos - pass.aos) < BIRD_WATCH_PASS_SAME_MS && Math.abs(x.los - pass.los) < BIRD_WATCH_PASS_SAME_MS) || pass);
  p.pending = false;
}

// The element sets changed: the passes are worked out again
function birdWatchPanelRefresh()
{
  const T = GT.birdWatchTrack;
  if (!T) return;
  T.passes.clear();
  birdWatchPredictReset();
  if (T.selected) birdWatchPanelFill(T.selected);
}

// Mouse over a satellite on the map (Settings -> Map -> Mouse Over): its transmitters, with the frequencies shifted to where it is now
function birdWatchHoverFill()
{
  const T = GT.birdWatchTrack;
  const norad = T.hover;
  if (!birdWatchTleGet(norad)) return false;
  myTooltip.innerHTML = birdWatchTransmitterHtml(norad);
  return true;
}

function birdWatchHoverOver(feature, fromHover)
{
  if (GT.MyGridIsUp) return false;
  if (GT.settings.map.mouseOver == true && fromHover == false) return false;
  if (GT.settings.map.mouseOver == false && fromHover == true) return false;

  GT.birdWatchTrack.hover = feature.get("norad");
  if (!birdWatchHoverFill())
  {
    GT.birdWatchTrack.hover = null;
    return false;
  }
  birdWatchFootprintSync();
  mouseMoveDataItem(feature);
  myTooltip.style.zIndex = 500;
  myTooltip.style.display = "block";
  return true;
}

function birdWatchHoverMove(feature)
{
  birdWatchHoverFill();
  mouseMoveDataItem(feature);
}

function birdWatchHoverOut(feature)
{
  GT.birdWatchTrack.hover = null;
  birdWatchFootprintSync();
  mouseOutOfDataItem(feature);
}
