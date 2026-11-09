// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// BirdWatch's Skeds (BirdWatch settings, Skeds): the stations a pass can be shared with, each by its callsign and grid (its height and
// lowest elevation when known), and the mutual passes: the windows when a tracked satellite is up for you and for an active station at
// once, worked out by the tracker (birdWatchWorker.js, "mutual") for the next three days. They show in the Skeds tab, in the Pass
// Timeline (a row for each active station), on the map (each active station's marker), in the BirdWatch panel (the selected
// satellite's next mutual window), and are announced as Pass Alerts are. Auto-Track's mode (Skeds First, Skeds Only) prefers them.
// Each can be saved to a calendar (.ics) or copied as a line of text to send to the other station, and a station's own line pasted in.
//   A satellite counts when it has something to hear: a two-way one (a repeater, a transponder) for a QSO, a downlink-only one for
//   both listening (marked "RX only")

const BIRD_WATCH_SKED_HOURS = 72;
// Worked out again this often, and at once when the stations, the satellites tracked or the element sets change
const BIRD_WATCH_SKED_REFRESH_MS = 10 * 60000;
// Skeds First and Skeds Only move to a mutual window this long before it opens, so the rotator and the rig are there in time
const BIRD_WATCH_SKED_LEAD_MS = 3 * 60000;
const BIRD_WATCH_SKEDS_MAX = 50;
// A satellite you select yourself holds Skeds First / Skeds Only off until its LOS; with no pass of it known, this long
const BIRD_WATCH_SKED_HOLD_MS = 15 * 60000;
// The Mutual Passes list drawn again this often while it shows
const BIRD_WATCH_SKED_LIST_MS = 15000;
const BIRD_WATCH_SKED_GRID = /^[A-R]{2}[0-9]{2}([A-X]{2})?$/i;
const BIRD_WATCH_SKED_CALL = /^[A-Z0-9]{1,3}[0-9][A-Z0-9]{0,4}(\/[A-Z0-9]{1,4})?$/i;

// The windows worked out (sorted by start, each with its satellite's norad, name and rank added), and the request under way
GT.birdWatchSkeds = { windows: [], pending: null, results: null, key: "", at: 0, generation: 0, markers: new Map(), source: null, alerted: new Map() };

function birdWatchSkedList()
{
  const B = GT.settings.BirdWatch;
  if (!Array.isArray(B.skeds)) B.skeds = [];
  // Grids all capitals (a station kept with a lowercase one is put right)
  for (const s of B.skeds) if (typeof s.grid == "string" && s.grid != s.grid.toUpperCase()) s.grid = s.grid.toUpperCase();
  return B.skeds;
}

// A station's place, from its grid's center; null for a grid that isn't one
function birdWatchSkedPlace(s)
{
  const grid = String(s.grid || "").trim();
  if (!BIRD_WATCH_SKED_GRID.test(grid)) return null;
  const c = squareToCenter(grid.toUpperCase());
  return Number.isFinite(c.a) && Number.isFinite(c.o) ? { lat: c.a, lon: c.o } : null;
}

// Your own lowest elevation for a mutual window (Skeds tab), and a station's (its own, else yours)
function birdWatchSkedMyMinEl()
{
  return Number(GT.settings.BirdWatch.skedMyMinEl) || 0;
}

function birdWatchSkedMinEl(s)
{
  return s.minEl === null || s.minEl === undefined || s.minEl === "" ? birdWatchSkedMyMinEl() : Number(s.minEl) || 0;
}

// The active stations whose grid is good, as the tracker takes them
function birdWatchSkedStations()
{
  const list = [];
  for (const s of birdWatchSkedList())
  {
    if (!s.active) continue;
    const place = birdWatchSkedPlace(s);
    if (place) list.push({ key: s.id, lat: place.lat, lon: place.lon, alt: Number(s.height) || 0, minEl: birdWatchSkedMinEl(s) });
  }
  return list;
}

function birdWatchSkedById(id)
{
  return birdWatchSkedList().find((s) => s.id == id) || null;
}

function birdWatchSkedNewId()
{
  for (let i = 1; ; i++) if (!birdWatchSkedById("s" + i)) return "s" + i;
}

// A satellite's highest point above the ground (km), from its element set's second line as the panel's Apogee is (Kepler's third law);
// null without one
function birdWatchSkedApogeeKm(norad)
{
  const tle = birdWatchTleGet(norad);
  if (!tle || !tle.line2) return null;
  const eccentricity = Number("0." + tle.line2.slice(26, 33).trim());
  const revolutions = Number(tle.line2.slice(52, 63));
  if (!(revolutions > 0)) return null;
  const axis = Math.cbrt(398600.4418 / ((revolutions * 2 * Math.PI / 86400) ** 2));
  return axis * (1 + eccentricity) - EARTH_RADIUS_KM;
}

// How far over the ground a satellite at a height (km) can be seen from, above an elevation (degrees): the angle at the Earth's center
// (radians)
function birdWatchSkedCoverage(km, el)
{
  const e = el * Math.PI / 180;
  return Math.acos(EARTH_RADIUS_KM / (EARTH_RADIUS_KM + km) * Math.cos(e)) - e;
}

// Whether a mutual pass with a station can ever happen: the two places closer together than what each sees of the tracked satellite
// that reaches farthest (at its apogee, above each side's lowest elevation, a 0° one being its horizon). The orbit may never pass over
// both, so possible only means not ruled out; never is certain. { possible, km apart }, or null with nothing to go by
function birdWatchSkedReach(s)
{
  const place = birdWatchSkedPlace(s);
  if (!place || !Number.isFinite(GT.myLat) || !Number.isFinite(GT.myLon)) return null;
  const myMin = birdWatchSkedMyMinEl();
  const theirMin = birdWatchSkedMinEl(s);
  const myEl = myMin > 0 ? myMin : birdWatchHorizonEl(Number(GT.settings.app.myElevation) || 0);
  const theirEl = theirMin > 0 ? theirMin : birdWatchHorizonEl(Number(s.height) || 0);
  let reach = -1;
  for (const norad of GT.settings.BirdWatch.tracked)
  {
    if (birdWatchAutoRank(norad) >= BIRD_WATCH_AUTO_DEAF) continue;
    const km = birdWatchSkedApogeeKm(norad);
    if (km > 0) reach = Math.max(reach, birdWatchSkedCoverage(km, myEl) + birdWatchSkedCoverage(km, theirEl));
  }
  if (reach < 0) return null;
  const apart = MyCircle.distance(GT.myLat, GT.myLon, place.lat, place.lon);
  return { possible: apart <= reach, km: apart * EARTH_RADIUS_KM };
}

// "A mutual pass will never happen: 8,200 km apart, too far for the satellites you track"
function birdWatchSkedNeverText(reach)
{
  return I18N("birdWatch.skeds.never").replace("{distance}", birdWatchDistance(reach.km));
}

// Any active station: Auto-Track's Skeds modes have something to go by, the panel's row is there
function birdWatchSkedsActive()
{
  return birdWatchSkedList().some((s) => s.active && birdWatchSkedPlace(s));
}

// ---- Working them out

// Each tracker tick (birdWatchPredictUpdate): asked again when what they depend on changed, or they are getting old; the map's markers
// and the alerts kept up
function birdWatchSkedsTick()
{
  const T = GT.birdWatchTrack;
  if (!T || !T.worker) return;
  const K = GT.birdWatchSkeds;
  const stations = birdWatchSkedStations();
  const key = JSON.stringify([stations, GT.settings.BirdWatch.tracked, birdWatchSkedMyMinEl(), GT.settings.BirdWatch.skedMinSeconds, GT.myLat, GT.myLon, GT.settings.app.myElevation]);
  if (!K.pending && (key != K.key || Date.now() - K.at > BIRD_WATCH_SKED_REFRESH_MS)) birdWatchSkedsAsk(key, stations);
  birdWatchSkedMarkers();
  birdWatchSkedAlerts();
  // The Mutual Passes list kept current while it shows (a window under way, one gone)
  if (Date.now() - (K.listAt || 0) > BIRD_WATCH_SKED_LIST_MS)
  {
    K.listAt = Date.now();
    birdWatchSkedsListRender();
  }
}

// Forgotten (the element sets changed, the tracker started again): asked again at the next tick
function birdWatchSkedsReset()
{
  const K = GT.birdWatchSkeds;
  K.key = "";
  K.pending = null;
  K.generation++;
}

// The Skeds' own tracker: a second birdWatchWorker.js, given the same station and element sets as BirdWatch's but tracking nothing, so
// working out three days of mutual passes (about a second a satellite) never holds up the tracker's ticks, the Doppler and the rotor
function birdWatchSkedWorker()
{
  const K = GT.birdWatchSkeds;
  if (!K.worker)
  {
    K.worker = new Worker("./lib/services/birdWatch/birdWatchWorker.js");
    K.worker.onmessage = (event) =>
    {
      if (event.data && event.data.type == "mutual") birdWatchSkedsMessage(event.data);
    };
  }
  const meters = Number(GT.settings.app.myElevation) || 0;
  K.worker.postMessage({ type: "observer", lat: GT.myLat, lon: GT.myLon, alt: meters, minEl: birdWatchHorizonEl(meters) });
  K.worker.postMessage({ type: "tles", list: birdWatchTleList() });
  return K.worker;
}

// Stopped with BirdWatch's tracker
function birdWatchSkedsStop()
{
  const K = GT.birdWatchSkeds;
  if (K.worker) K.worker.terminate();
  K.worker = null;
  birdWatchSkedsReset();
}

// Its tracker asked about every tracked satellite that has something to hear (the station and element sets sent first, as they are now);
// with no active station, there is nothing to ask
function birdWatchSkedsAsk(key, stations)
{
  const K = GT.birdWatchSkeds;
  K.key = key;
  K.at = Date.now();
  K.generation++;
  const norads = stations.length ? GT.settings.BirdWatch.tracked.filter((norad) => birdWatchAutoRank(norad) < BIRD_WATCH_AUTO_DEAF) : [];
  if (!norads.length)
  {
    K.pending = null;
    birdWatchSkedsDone([]);
    return;
  }
  K.pending = new Set(norads);
  K.results = [];
  const myMin = birdWatchSkedMyMinEl();
  const worker = birdWatchSkedWorker();
  for (const norad of norads)
  {
    worker.postMessage({
      type: "mutual", id: "skeds|" + K.generation, norad: norad, hours: BIRD_WATCH_SKED_HOURS, minEl: myMin > 0 ? myMin : undefined,
      minSeconds: Number(GT.settings.BirdWatch.skedMinSeconds) || 0, stations: stations
    });
  }
}

// From the tracker: one satellite's windows; with all of them in, the list is made
function birdWatchSkedsMessage(m)
{
  const K = GT.birdWatchSkeds;
  if (m.id != "skeds|" + K.generation || !K.pending || !K.pending.has(m.norad)) return;
  K.pending.delete(m.norad);
  const name = birdWatchAlertName(m.norad);
  const rank = birdWatchAutoRank(m.norad);
  for (const w of m.windows || []) K.results.push(Object.assign({ norad: m.norad, name: name, rank: rank }, w));
  if (K.pending.size) return;
  K.pending = null;
  birdWatchSkedsDone(K.results);
}

function birdWatchSkedsDone(windows)
{
  const K = GT.birdWatchSkeds;
  K.windows = windows.sort((a, b) => a.start - b.start);
  birdWatchSkedsListRender();
  if (typeof birdWatchInfoBuilt != "undefined" && birdWatchInfoBuilt) birdWatchInfoRebuild();
  if (birdWatchTimelineDiv.style.display != "none") birdWatchTimelineDraw();
}

// The windows still to come or under way (one under way is still a window until it ends)
function birdWatchSkedWindows(now = Date.now())
{
  return GT.birdWatchSkeds.windows.filter((w) => w.end > now && birdWatchSkedById(w.key));
}

// ---- Auto-Track (birdWatchAutoUpdate): what the Skeds modes pick. { pick: norad } to follow, { idle: true } for Skeds Only between
// windows (the selection is left as it is), or null to let Next Pass decide
function birdWatchSkedAutoPick(now)
{
  const mode = GT.settings.BirdWatch.autoMode || "skedsFirst";
  if (mode == "next" || !birdWatchSkedsActive()) return null;
  // A satellite you selected yourself stays selected until its LOS, as with Auto-Track's own picks
  const T = GT.birdWatchTrack;
  const hold = T.skedHold;
  if (hold && hold.norad == T.selected && now < hold.until) return { idle: true };
  if (hold)
  {
    // Over (its LOS, or another satellite selected since): Auto-Track picks afresh, the sked's satellite again if its window is still open
    T.skedHold = null;
    T.autoPick = null;
  }
  const windows = birdWatchSkedWindows(now);
  // Under way now, or opening within the lead: the active station's first, then two-way before listen-only, then the one that lasts
  // longest from now
  const soon = windows.filter((w) => w.start - BIRD_WATCH_SKED_LEAD_MS <= now);
  if (soon.length)
  {
    const focus = birdWatchSkedFocus();
    soon.sort((a, b) => (a.key == focus ? 0 : 1) - (b.key == focus ? 0 : 1) || (a.rank == 0 ? 0 : 1) - (b.rank == 0 ? 0 : 1) || b.end - a.end);
    return { pick: soon[0].norad };
  }
  return mode == "skedsOnly" ? { idle: true } : null;
}

// ---- The active station: the one you picked (its marker on the map, its row in the Mutual Passes list, its bar on the timeline). The
// panel's Mutual Pass row shows its pass, Skeds First prefers its windows, and it is marked out in each of those places

// The active station's id (BirdWatch.skedFocus: kept across restarts), "" none
function birdWatchSkedFocus()
{
  return GT.settings.BirdWatch.skedFocus || "";
}

// A mutual window picked: its station made the active one, its satellite selected (by you: held until its LOS)
function birdWatchSkedPick(w)
{
  GT.settings.BirdWatch.skedFocus = w.key;
  if (GT.birdWatchTrack.selected != w.norad) birdWatchSelect(w.norad);
  else birdWatchSkedSelected(w.norad, false);
  birdWatchSkedFocusShow();
}

// A station picked (its marker on the map): made the active one, the satellite of its next mutual pass selected. The active station
// clicked again: no station is the active one any more (the satellite selected stays, as you picked it)
function birdWatchSkedPickStation(id)
{
  if (id == birdWatchSkedFocus())
  {
    GT.settings.BirdWatch.skedFocus = "";
    birdWatchSkedFocusShow();
    return;
  }
  const w = birdWatchSkedWindows().find((x) => x.key == id);
  if (w) birdWatchSkedPick(w);
  else
  {
    GT.settings.BirdWatch.skedFocus = id;
    birdWatchSkedFocusShow();
  }
}

// The active station shown where it is marked out
function birdWatchSkedFocusShow()
{
  birdWatchSkedMarkers();
  birdWatchSkedsListRender();
  if (birdWatchTimelineDiv.style.display != "none") birdWatchTimelineDraw();
  if (typeof birdWatchInfoBuilt != "undefined" && birdWatchInfoBuilt) birdWatchInfoRebuild();
}

// The active station's windows first, then the others' (each list keeps its own order)
function birdWatchSkedFocusFirst(windows)
{
  const focus = birdWatchSkedFocus();
  return windows.filter((w) => w.key == focus).concat(windows.filter((w) => w.key != focus));
}

// A satellite selected (birdWatchSelect): one you picked yourself holds the Skeds modes off until its LOS (the pass under way, else its
// next one); Auto-Track's own pick, or none, lets them go on
function birdWatchSkedSelected(norad, auto)
{
  const T = GT.birdWatchTrack;
  if (!norad || auto)
  {
    T.skedHold = null;
    return;
  }
  const pass = birdWatchWantPasses(norad);
  T.skedHold = { norad: norad, until: pass && pass.los > Date.now() ? pass.los : Date.now() + BIRD_WATCH_SKED_HOLD_MS };
}

// ---- The Skeds tab

function birdWatchSkedsRender()
{
  if (typeof birdWatchSkedRows == "undefined") return;
  const B = GT.settings.BirdWatch;
  birdWatchSkedMyMinElValue.value = birdWatchSkedMyMinEl();
  birdWatchSkedMyMinElText.textContent = birdWatchSkedMyMinEl() + "°";
  birdWatchSkedMinMinutes.value = Math.round((Number(B.skedMinSeconds) || 0) / 60);
  birdWatchSkedMinMinutesText.textContent = birdWatchSkedMinutesText(Number(B.skedMinSeconds) || 0);
  birdWatchSkedRows.innerHTML = "";
  const unit = birdWatchSkedHeightUnit();
  for (const s of birdWatchSkedList())
  {
    const row = birdWatchSkedRowTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.sked = s.id;
    renderI18n(row);
    const el = (f) => row.querySelector("[data-f='" + f + "']");
    el("Active").checked = s.active === true;
    el("Call").value = s.call || "";
    el("Grid").value = s.grid || "";
    el("Grid").classList.toggle("birdSkedBad", !!s.grid && !birdWatchSkedPlace(s));
    el("Height").value = s.height ? Math.round(unit.from(s.height)) : "";
    el("Height").placeholder = unit.name;
    el("MinEl").value = s.minEl === null || s.minEl === undefined || s.minEl === "" ? "" : s.minEl;
    el("MinEl").placeholder = birdWatchSkedMyMinEl() + "°";
    el("Notes").value = s.notes || "";
    birdWatchSkedRows.appendChild(row);
    // Too far apart for any tracked satellite: said under its row
    const reach = birdWatchSkedReach(s);
    if (reach && !reach.possible)
    {
      const note = document.createElement("tr");
      note.className = "birdSkedNever";
      note.innerHTML = "<td></td><td colspan='6'></td>";
      note.lastChild.textContent = birdWatchSkedNeverText(reach);
      birdWatchSkedRows.appendChild(note);
    }
  }
  birdWatchSkedEmpty.style.display = birdWatchSkedList().length ? "none" : "";
  birdWatchSkedAddButton.style.display = birdWatchSkedList().length < BIRD_WATCH_SKEDS_MAX ? "" : "none";
  birdWatchSkedsListRender();
}

// Height in the user's units: feet with miles (or nautical miles), meters otherwise, as the station's own Elevation is
function birdWatchSkedHeightUnit()
{
  const feet = ["MI", "NM"].includes(GT.settings.app.distanceUnit);
  return feet ? { name: "ft", from: (m) => m * 3.28084, to: (v) => v / 3.28084 } : { name: "m", from: (m) => m, to: (v) => v };
}

function birdWatchSkedMinutesText(seconds)
{
  return seconds > 0 ? Math.round(seconds / 60) + " min" : I18N("birdWatch.skeds.minDuration.off");
}

// A row's field changed: kept (a grid and a callsign upper-cased: 6-character grids are all capitals, as the Maidenhead conference of
// 2018 has it), the windows asked again at the next tick
function birdWatchSkedFieldChanged(el)
{
  const row = el.closest("[data-sked]");
  const s = row ? birdWatchSkedById(row.dataset.sked) : null;
  if (!s) return;
  const get = (f) => row.querySelector("[data-f='" + f + "']");
  s.active = get("Active").checked;
  s.call = get("Call").value.trim().toUpperCase().slice(0, 16);
  s.grid = get("Grid").value.trim().slice(0, 6).toUpperCase();
  const height = Number(get("Height").value);
  s.height = height > 0 ? Math.round(birdWatchSkedHeightUnit().to(height)) : 0;
  const minEl = get("MinEl").value.trim().replace("°", "");
  s.minEl = minEl === "" || !Number.isFinite(Number(minEl)) ? null : Math.max(0, Math.min(60, Number(minEl)));
  s.notes = get("Notes").value.trim().slice(0, 60);
  birdWatchSkedsRender();
  birdWatchSkedsChanged();
}

function birdWatchSkedAdd()
{
  if (birdWatchSkedList().length >= BIRD_WATCH_SKEDS_MAX) return;
  birdWatchSkedList().push({ id: birdWatchSkedNewId(), call: "", grid: "", height: 0, minEl: null, notes: "", active: true });
  birdWatchSkedsRender();
  const rows = birdWatchSkedRows.querySelectorAll("[data-f='Call']");
  if (rows.length) rows[rows.length - 1].focus();
}

function birdWatchSkedRemove(el)
{
  const row = el.closest("[data-sked]");
  if (!row) return;
  GT.settings.BirdWatch.skeds = birdWatchSkedList().filter((s) => s.id != row.dataset.sked);
  birdWatchSkedsRender();
  birdWatchSkedsChanged();
}

// The stations changed: their windows asked again now, the panel's row and Auto-Track with them
function birdWatchSkedsChanged()
{
  const K = GT.birdWatchSkeds;
  K.key = "";
  if (K.pending) birdWatchSkedsReset();
  if (typeof birdWatchInfoBuilt != "undefined" && birdWatchInfoBuilt) birdWatchInfoRebuild();
  birdWatchSkedsTick();
}

function birdWatchSkedMyMinElChange()
{
  GT.settings.BirdWatch.skedMyMinEl = Number(birdWatchSkedMyMinElValue.value);
  birdWatchSkedMyMinElText.textContent = birdWatchSkedMyMinEl() + "°";
  for (const input of birdWatchSkedRows.querySelectorAll("[data-f='MinEl']")) input.placeholder = birdWatchSkedMyMinEl() + "°";
  birdWatchSkedsChanged();
}

function birdWatchSkedMinMinutesChange()
{
  GT.settings.BirdWatch.skedMinSeconds = Number(birdWatchSkedMinMinutes.value) * 60;
  birdWatchSkedMinMinutesText.textContent = birdWatchSkedMinutesText(GT.settings.BirdWatch.skedMinSeconds);
  birdWatchSkedsChanged();
}

// The Mutual Passes list: each window with its satellite, its time (UTC), how long it lasts, the station and both elevations at its best
// moment, and its own ICS and Copy; a click on its satellite selects it
function birdWatchSkedsListRender()
{
  if (typeof birdWatchSkedMutualList == "undefined" || birdWatchSkedsDiv.style.display == "none") return;
  const K = GT.birdWatchSkeds;
  const windows = birdWatchSkedWindows();
  birdWatchSkedMutualList.innerHTML = "";
  let status = "";
  if (!birdWatchSkedsActive()) status = I18N("birdWatch.skeds.noStations");
  else if (!GT.birdWatchTrack || !GT.birdWatchTrack.worker) status = I18N("birdWatch.skeds.notTracking");
  else if (K.pending) status = I18N("birdWatch.skeds.working");
  else if (!windows.length) status = I18N("birdWatch.skeds.none");
  birdWatchSkedMutualStatus.textContent = status;
  birdWatchSkedMutualStatus.style.display = status ? "" : "none";
  birdWatchSkedAllButtons.style.display = windows.length ? "" : "none";
  const now = Date.now();
  for (const w of windows)
  {
    const s = birdWatchSkedById(w.key);
    const row = document.createElement("tr");
    const up = w.start <= now;
    // Under way: shaded; the active station's: its callsign marked out (.birdSkedFocus)
    row.className = (up ? "birdSkedUp" : "") + (w.key == birdWatchSkedFocus() ? " birdSkedFocus" : "");
    const cells = [
      [w.name + (w.rank > 0 ? " " + I18N("birdWatch.skeds.rxOnly") : ""), "birdSkedSat"],
      [birdWatchSkedWhen(w), ""],
      [toDHMS(w.seconds), "birdSkedDur"],
      [s.call || s.grid, "birdSkedCall"],
      [Math.round(w.best.myEl) + "° / " + Math.round(w.best.theirEl) + "°", "birdSkedEl"]
    ];
    for (const [text, className] of cells)
    {
      const td = document.createElement("td");
      td.textContent = text;
      if (className) td.className = className;
      row.appendChild(td);
    }
    // A click picks it: its satellite selected, its station the active one
    row.onclick = () => birdWatchSkedPick(w);
    row.title = birdWatchSkedTip(w) + "\n\n" + I18N("birdWatch.skeds.pick.hover");
    const actions = document.createElement("td");
    actions.className = "birdSkedActions";
    const ics = document.createElement("span");
    ics.className = "button birdTleButton";
    ics.textContent = "ICS";
    ics.title = I18N("birdWatch.skeds.ics.hover");
    ics.onclick = (event) =>
    {
      event.stopPropagation();
      birdWatchSkedSaveIcs([w]);
    };
    const copy = document.createElement("span");
    copy.className = "button birdTleButton";
    copy.textContent = I18N("birdWatch.skeds.copy.label");
    copy.title = I18N("birdWatch.skeds.copy.hover");
    copy.onclick = (event) =>
    {
      event.stopPropagation();
      birdWatchSkedCopy([w]);
    };
    actions.append(ics, " ", copy);
    row.appendChild(actions);
    birdWatchSkedMutualList.appendChild(row);
  }
}

// A window's day and times in UTC: "Thu 18:42–18:49 UTC"
function birdWatchSkedWhen(w)
{
  const start = new Date(w.start);
  const day = start.toLocaleDateString(GT.localeString || undefined, { weekday: "short", timeZone: "UTC" });
  return day + " " + start.toISOString().slice(11, 16) + "–" + new Date(w.end).toISOString().slice(11, 16) + " UTC";
}

// A window's tooltip (the list's row, the timeline's bar, the panel's row, the station's marker): the satellite, the station, the time,
// how long, and each side's view. No time to go in it (the panel's row counts down): it stays the same while it shows
function birdWatchSkedTip(w)
{
  const s = birdWatchSkedById(w.key) || {};
  const lines = [
    w.name + (w.rank > 0 ? " " + I18N("birdWatch.skeds.rxOnly") : "") + "  —  " + (s.call || "") + " " + (s.grid || ""),
    birdWatchSkedWhen(w) + "  (" + toDHMS(w.seconds) + ")"
  ];
  lines.push(I18N("birdWatch.skeds.best").replace("{time}", new Date(w.best.time).toISOString().slice(11, 19) + " UTC").replace("{my}", Math.round(w.best.myEl)).replace("{their}", Math.round(w.best.theirEl)));
  lines.push(I18N("birdWatch.skeds.you").replace("{az1}", Math.round(w.my.startAz)).replace("{az2}", Math.round(w.my.endAz)).replace("{max}", Math.round(w.my.maxEl)));
  lines.push(I18N("birdWatch.skeds.them").replace("{call}", s.call || "").replace("{az1}", Math.round(w.their.startAz)).replace("{az2}", Math.round(w.their.endAz)).replace("{max}", Math.round(w.their.maxEl)));
  return lines.join("\n");
}

// ---- Sharing: a line of text for each window, a calendar file, your own line for the other station's list

// The satellite's frequencies for the line: its first two-way amateur transmitter (else its first downlink), uplink and downlink in
// MHz and its mode
function birdWatchSkedFrequencies(norad)
{
  const list = birdWatchTransmitters(norad);
  const t = list.find((x) => x.uplink_low > 0 && x.downlink_low > 0 && birdWatchAmateurTransmitter(x)) || list.find((x) => x.downlink_low > 0);
  if (!t) return "";
  const mhz = (hz) => (hz / 1e6).toFixed(3);
  return (t.uplink_low > 0 ? mhz(t.uplink_low) + " up / " : "") + mhz(t.downlink_low) + " down" + (t.mode ? " " + t.mode : "");
}

// Your callsign as it is kept (a plain zero: the Ø of formatCallsign is for the screen, and the other side's Paste Sked Line reads digits)
function birdWatchSkedMyCall()
{
  return String(GT.settings.app.myCall || "").toUpperCase();
}

function birdWatchSkedMyGrid()
{
  return String(GT.settings.app.myRawGrid || GT.settings.app.myGrid || "").toUpperCase();
}

// "SO-50  2026-11-12 18:42–18:49 UTC (7m 10s)  K7ABC CN87 31° / W1XYZ FN31 22°  145.850 up / 436.795 down FM"
function birdWatchSkedLine(w)
{
  const s = birdWatchSkedById(w.key) || {};
  const start = new Date(w.start).toISOString();
  const freqs = birdWatchSkedFrequencies(w.norad);
  return w.name + (w.rank > 0 ? " " + I18N("birdWatch.skeds.rxOnly") : "") + "  " + start.slice(0, 10) + " " + start.slice(11, 16) + "–" + new Date(w.end).toISOString().slice(11, 16) + " UTC (" + toDHMS(w.seconds) + ")  " +
    birdWatchSkedMyCall() + " " + birdWatchSkedMyGrid().slice(0, 4) + " " + Math.round(w.best.myEl) + "° / " + (s.call || "") + " " + String(s.grid || "").slice(0, 4) + " " + Math.round(w.best.theirEl) + "°" + (freqs ? "  " + freqs : "");
}

function birdWatchSkedCopy(windows)
{
  const lines = windows.map(birdWatchSkedLine);
  // The element sets' age goes with them: the times hold to seconds only while both sides use fresh ones
  const epoch = birdWatchSkedTleNote(windows);
  window.require("electron").clipboard.writeText(lines.join("\n") + (epoch ? "\n" + epoch : ""));
  addEvent("birdwatch", "<font style='color:white'>" + htmlEntities(I18N("birdWatch.skeds.copied").replace("{n}", lines.length)) + "</font>");
}

// "TLE epochs: SO-50 2026-11-11, ..." for the satellites in the windows
function birdWatchSkedTleNote(windows)
{
  const seen = new Map();
  for (const w of windows)
  {
    if (seen.has(w.norad)) continue;
    const tle = birdWatchTleGet(w.norad);
    const epoch = tle && tle.line1 ? birdWatchSkedTleEpoch(tle.line1) : null;
    if (epoch) seen.set(w.norad, w.name + " " + epoch);
  }
  return seen.size ? I18N("birdWatch.skeds.tleNote").replace("{list}", [...seen.values()].join(", ")) : "";
}

// A TLE's epoch (line 1, columns 19-32: two-digit year, day of the year with its fraction) as a UTC date
function birdWatchSkedTleEpoch(line1)
{
  const yy = Number(line1.slice(18, 20));
  const day = Number(line1.slice(20, 32));
  if (!Number.isFinite(yy) || !Number.isFinite(day)) return null;
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  return new Date(Date.UTC(year, 0, 1) + (day - 1) * 86400000).toISOString().slice(0, 10);
}

// A calendar event for each window: from its start to its end, both callsigns in its title, the details and each side's whole pass in
// its description, a reminder the Alerts' minutes before
function birdWatchSkedSaveIcs(windows)
{
  const A = GT.settings.BirdWatch.alerts;
  const stamp = birdWatchIcsTime(Date.now());
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//GridTracker2//BirdWatch Skeds//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const w of windows)
  {
    const s = birdWatchSkedById(w.key) || {};
    const title = I18N("birdWatch.skeds.icsTitle").replace("{sat}", w.name).replace("{my}", birdWatchSkedMyCall()).replace("{their}", s.call || s.grid || "").replace("{min}", Math.round(w.seconds / 60));
    const detail = [
      birdWatchSkedLine(w),
      I18N("birdWatch.skeds.duration") + " " + toDHMS(w.seconds),
      I18N("birdWatch.skeds.yourPass").replace("{aos}", birdWatchIcsClock(w.myPass.aos)).replace("{los}", birdWatchIcsClock(w.myPass.los)).replace("{max}", Math.round(w.myPass.maxEl)),
      I18N("birdWatch.skeds.theirPass").replace("{call}", s.call || "").replace("{aos}", birdWatchIcsClock(w.theirPass.aos)).replace("{los}", birdWatchIcsClock(w.theirPass.los)).replace("{max}", Math.round(w.theirPass.maxEl)),
      birdWatchSkedTleNote([w])
    ].filter((x) => x);
    lines.push(
      "BEGIN:VEVENT",
      "UID:sked-" + w.norad + "-" + w.key + "-" + Math.round(w.start / 1000) + "@gridtracker2",
      "DTSTAMP:" + stamp,
      "DTSTART:" + birdWatchIcsTime(w.start),
      "DTEND:" + birdWatchIcsTime(w.end),
      "SUMMARY:" + birdWatchIcsText(title),
      "DESCRIPTION:" + birdWatchIcsText(detail.join("\n")),
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "DESCRIPTION:" + birdWatchIcsText(title),
      "TRIGGER:-PT" + A.minutes + "M",
      "END:VALARM",
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  const first = windows[0];
  const s = first ? birdWatchSkedById(first.key) || {} : {};
  const result = electron.ipcRenderer.sendSync("saveTextFile", {
    title: I18N("birdWatch.export.title"),
    defaultPath: "BirdWatch_Sked" + (windows.length == 1 && s.call ? "_" + s.call.replace(/[^A-Z0-9]/gi, "") + "_" + first.name.replace(/[^A-Z0-9-]/gi, "") : "s") + "_" + new Date(first ? first.start : Date.now()).toISOString().slice(0, 10) + ".ics",
    content: lines.join("\r\n") + "\r\n",
    filters: [{ name: "iCalendar", extensions: ["ics"] }, { name: "All Files", extensions: ["*"] }]
  });
  if (result && result.error) addEvent("birdwatch", "<font style='color:red'>" + htmlEntities(result.error) + "</font>");
  else if (result) addEvent("birdwatch", "<font style='color:white'>" + htmlEntities(I18N("birdWatch.export.saved").replace("{n}", windows.length).replace("{file}", result)) + "</font>");
}

// A whole pass's time in the calendar's description: UTC
function birdWatchIcsClock(ms)
{
  return new Date(ms).toISOString().slice(11, 16) + " UTC";
}

function birdWatchSkedSaveAll()
{
  const windows = birdWatchSkedWindows();
  if (windows.length) birdWatchSkedSaveIcs(windows);
}

function birdWatchSkedCopyAll()
{
  const windows = birdWatchSkedWindows();
  if (windows.length) birdWatchSkedCopy(windows);
}

// Your own sked line, for the other station to paste into its list: "K7ABC CN87XX 120m min 10°"
function birdWatchSkedCopyMine()
{
  const parts = [birdWatchSkedMyCall(), birdWatchSkedMyGrid()];
  const height = Number(GT.settings.app.myElevation) || 0;
  if (height > 0) parts.push(Math.round(height) + "m");
  if (birdWatchSkedMyMinEl() > 0) parts.push("min " + birdWatchSkedMyMinEl() + "°");
  window.require("electron").clipboard.writeText(parts.filter((x) => x).join(" "));
  addEvent("birdwatch", "<font style='color:white'>" + htmlEntities(I18N("birdWatch.skeds.mineCopied").replace("{line}", parts.filter((x) => x).join(" "))) + "</font>");
}

// A station's line pasted from the clipboard (its callsign, grid, and maybe its height and lowest elevation, in any order): added, or
// the station with that callsign updated
function birdWatchSkedPaste()
{
  const text = String(window.require("electron").clipboard.readText() || "");
  let added = 0;
  for (const line of text.split(/\r?\n/))
  {
    // (A mutual pass's line, copied from the list, isn't a station's: its times and both stations' elevations would be misread)
    if (/\bUTC\b/.test(line)) continue;
    const s = birdWatchSkedParse(line);
    if (!s) continue;
    const same = birdWatchSkedList().find((x) => x.call && x.call == s.call);
    if (same) Object.assign(same, s, { id: same.id, active: same.active, notes: same.notes });
    else if (birdWatchSkedList().length < BIRD_WATCH_SKEDS_MAX) birdWatchSkedList().push(Object.assign({ id: birdWatchSkedNewId(), notes: "", active: true }, s));
    else continue;
    added++;
  }
  addEvent("birdwatch", "<font style='color:" + (added ? "white" : "yellow") + "'>" + htmlEntities(added ? I18N("birdWatch.skeds.pasted").replace("{n}", added) : I18N("birdWatch.skeds.pasteNone")) + "</font>");
  if (!added) return;
  birdWatchSkedsRender();
  birdWatchSkedsChanged();
}

// "W1XYZ FN31PR 30m min 15°" (the height in m or ft, the lowest elevation as "min 15°", "min15" or "15°"); null when there's no
// callsign and grid
function birdWatchSkedParse(line)
{
  // (A callsign written with a slashed zero, as GridTracker2 shows them, read as the digit)
  const words = String(line).replace(/,/g, " ").replace(/[Øø]/g, "0").trim().split(/\s+/);
  let call = null, grid = null, height = 0, minEl = null;
  for (let i = 0; i < words.length; i++)
  {
    const w = words[i];
    let m;
    if (!grid && BIRD_WATCH_SKED_GRID.test(w)) grid = w.toUpperCase();
    else if (!call && BIRD_WATCH_SKED_CALL.test(w) && /[0-9]/.test(w) && /[A-Z]/i.test(w)) call = w.toUpperCase();
    else if ((m = /^(\d+(?:\.\d+)?)(m|ft)$/i.exec(w))) height = m[2].toLowerCase() == "ft" ? Math.round(Number(m[1]) / 3.28084) : Math.round(Number(m[1]));
    else if (/^min$/i.test(w) && words[i + 1] && (m = /^(\d+(?:\.\d+)?)°?$/.exec(words[i + 1])))
    {
      minEl = Math.min(60, Number(m[1]));
      i++;
    }
    else if ((m = /^(?:min)?(\d+(?:\.\d+)?)°$/i.exec(w)) || (m = /^min(\d+(?:\.\d+)?)$/i.exec(w))) minEl = Math.min(60, Number(m[1]));
  }
  return call && grid ? { call: call, grid: grid, height: height, minEl: minEl } : null;
}

// ---- The panel's row (birdWatchInfo.js): the selected satellite's next mutual window, its callsign and the time to its AOS, or to its
// LOS while it is under way (toDHMS, as every time to go is shown), light green; the rest in its tooltip (and on the map, over the
// station's marker)

function birdWatchSkedInfo()
{
  const T = GT.birdWatchTrack;
  const now = Date.now();
  // The active station's, else the first station's with the selected satellite
  const w = T && T.selected ? birdWatchSkedFocusFirst(birdWatchSkedWindows(now)).find((x) => x.norad == T.selected) : null;
  if (!w) return { text: I18N("birdWatch.skeds.info.none"), html: htmlEntities(I18N("birdWatch.skeds.info.none")), color: "#9aa4b8", tip: I18N("birdWatch.skeds.info.hover") };
  const s = birdWatchSkedById(w.key) || {};
  const up = w.start <= now;
  const call = s.call || s.grid;
  const count = I18N(up ? "birdWatch.info.los" : "birdWatch.info.aos") + " " + toDHMS(((up ? w.end : w.start) - now) / 1000);
  // (As the featured item, large at the panel's top, the time goes on a line of its own under the callsign, .birdSkedBreak, orange to
  // its AOS as the Time To AOS item is: .birdSkedAos)
  const time = "<span class='" + (up ? "birdSkedLos" : "birdSkedAos") + "'>" + htmlEntities(count) + "</span>";
  return { text: call + "  " + count, html: htmlEntities(call) + "<span class='birdSkedBreak'> </span>" + time, color: "lightgreen", tip: birdWatchSkedTip(w) };
}

// ---- The map: each active station's marker on BirdWatch's layer, its callsign over it; bright while a mutual window with it is under way

function birdWatchSkedMarkers()
{
  const K = GT.birdWatchSkeds;
  const source = GT.layerSources.birdWatch;
  if (!source) return;
  if (K.source !== source)
  {
    K.source = source;
    K.markers.clear();
  }
  const now = Date.now();
  const open = new Set(birdWatchSkedWindows(now).filter((w) => w.start <= now).map((w) => w.key));
  const want = new Map();
  for (const s of birdWatchSkedList())
  {
    const place = s.active ? birdWatchSkedPlace(s) : null;
    if (place) want.set(s.id, { s: s, place: place, live: open.has(s.id) });
  }
  for (const [id, feature] of K.markers)
  {
    if (want.has(id)) continue;
    source.removeFeature(feature);
    K.markers.delete(id);
  }
  for (const [id, w] of want)
  {
    let feature = K.markers.get(id);
    const focused = id == birdWatchSkedFocus();
    const look = w.s.call + "|" + w.live + "|" + focused + "|" + w.place.lat + "|" + w.place.lon;
    if (feature && feature.look == look) continue;
    if (!feature)
    {
      feature = new ol.Feature({ prop: "birdWatchSked", sked: id });
      source.addFeature(feature);
      K.markers.set(id, feature);
    }
    feature.look = look;
    feature.setGeometry(new ol.geom.Point(ol.proj.fromLonLat([w.place.lon, w.place.lat], GT.settings.map.projection)));
    // Light green; bright green, larger and outlined in white while a mutual pass with it is under way; the active station outlined in
    // yellow, its callsign yellow
    const color = w.live ? "#00ff66" : "#90ee90";
    feature.setStyle(new ol.style.Style({
      zIndex: 5,
      image: new ol.style.RegularShape({ points: 4, radius: w.live || focused ? 9 : 6, angle: 0, fill: new ol.style.Fill({ color: color }), stroke: new ol.style.Stroke({ color: focused ? "#ffff00" : w.live ? "#ffffff" : "#000000", width: w.live || focused ? 2 : 1.5 }) }),
      text: new ol.style.Text({ text: w.s.call || w.s.grid, offsetY: -14, font: "bold 12px sans-serif", fill: new ol.style.Fill({ color: focused ? "#ffff00" : color }), stroke: new ol.style.Stroke({ color: "#000000", width: 3 }) })
    }));
  }
}

// The mouse over a station's marker (mouse.js, hoverFunctors): its callsign, grid and notes, and its next mutual passes in full (the
// satellite, the time, how long, both elevations at the best moment, each side's azimuths and highest elevation), as the map's tooltip
function birdWatchSkedHoverOver(feature, fromHover)
{
  if (GT.MyGridIsUp) return false;
  if (GT.settings.map.mouseOver == true && fromHover == false) return false;
  if (GT.settings.map.mouseOver == false && fromHover == true) return false;
  if (!birdWatchSkedHoverFill(feature)) return false;
  mouseMoveDataItem(feature);
  myTooltip.style.zIndex = 500;
  myTooltip.style.display = "block";
  return true;
}

function birdWatchSkedHoverMove(feature)
{
  birdWatchSkedHoverFill(feature);
  mouseMoveDataItem(feature);
}

const BIRD_WATCH_SKED_HOVER_MAX = 3;

function birdWatchSkedHoverFill(feature)
{
  const s = birdWatchSkedById(feature.get("sked"));
  if (!s) return false;
  const now = Date.now();
  const windows = birdWatchSkedWindows(now).filter((w) => w.key == s.id);
  const esc = (text) => htmlEntities(String(text));
  let html = "<div style='color:#90ee90;font-weight:bold;font-size:larger'>" + esc(s.call || s.grid) + "</div><div style='color:#ffff00'>" + esc(s.grid) + (s.notes ? "  <span style='color:#ccc'>" + esc(s.notes) + "</span>" : "") + "</div>";
  if (!windows.length)
  {
    const reach = birdWatchSkedReach(s);
    html += reach && !reach.possible ? "<div style='color:orange'>" + esc(birdWatchSkedNeverText(reach)) + "</div>" : "<div style='color:#9aa4b8'>" + esc(I18N("birdWatch.skeds.none")) + "</div>";
  }
  for (const w of windows.slice(0, BIRD_WATCH_SKED_HOVER_MAX))
  {
    const lines = birdWatchSkedTip(w).split("\n");
    html += "<hr style='border-color:#2c3a52'/><div style='color:" + (w.start <= now ? "lightgreen" : "cyan") + "'>" + esc(lines[0].split("  —  ")[0]) + "</div>" + lines.slice(1).map((line) => "<div>" + esc(line) + "</div>").join("");
  }
  if (windows.length > BIRD_WATCH_SKED_HOVER_MAX) html += "<div style='color:#9aa4b8'>+" + (windows.length - BIRD_WATCH_SKED_HOVER_MAX) + "</div>";
  myTooltip.innerHTML = "<div style='text-align:left;padding:2px 4px'>" + html + "</div>";
  return true;
}

// The markers taken off (the tracker stops)
function birdWatchSkedMarkersClear()
{
  const K = GT.birdWatchSkeds;
  if (K.source) for (const feature of K.markers.values()) K.source.removeFeature(feature);
  K.markers.clear();
}

// ---- Alerts (BirdWatch settings, Alerts, Announce Mutual Passes): a mutual window announced the Alerts' minutes before it opens

function birdWatchSkedAlerts()
{
  const A = GT.settings.BirdWatch.alerts;
  if (!A.mutual) return;
  const K = GT.birdWatchSkeds;
  const now = Date.now();
  for (const [key, when] of K.alerted) if (now - when > BIRD_WATCH_ALERT_KEEP_MS) K.alerted.delete(key);
  for (const w of birdWatchSkedWindows(now))
  {
    const toStart = w.start - now;
    if (w.inProgress || toStart <= 0 || toStart > A.minutes * 60000) continue;
    const key = w.norad + "|" + w.key + "|" + Math.round(w.start / 60000);
    if (K.alerted.has(key)) continue;
    K.alerted.set(key, now);
    birdWatchAlertSend(birdWatchSkedAlertMessage(w, Math.max(1, Math.round(toStart / 60000))));
  }
}

// "Mutual pass with W1XYZ on SO-50 in 5 minutes, 7 minutes long": the user's own wording ({C} callsign, {N} satellite, {T} minutes to it,
// {M} minutes long) or the built-in one
function birdWatchSkedAlertMessage(w, minutes)
{
  const s = birdWatchSkedById(w.key) || {};
  const own = String(GT.settings.BirdWatch.alerts.mutualText || "").trim();
  const text = own || birdWatchSkedAlertBuiltIn();
  return text.split("{C}").join(s.call || s.grid || "").split("{N}").join(w.name).split("{T}").join(String(minutes)).split("{M}").join(String(Math.max(1, Math.round(w.seconds / 60))));
}

function birdWatchSkedAlertBuiltIn()
{
  return I18N("birdWatch.alerts.mutual.message").replace("{call}", "{C}").replace("{name}", "{N}").replace("{n}", "{T}").replace("{m}", "{M}");
}
