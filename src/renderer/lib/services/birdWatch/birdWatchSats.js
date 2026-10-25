// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// BirdWatch settings, Satellites: the satellites that are tracked (settings.Birdwatch.tracked, by catalog number), and a search of
// the element sets (Telemetry) to add more. A satellite needs an element set to be tracked, so only those can be found

// Both lists scroll the whole list but only put the rows in view into the page (spacers stand in for the rest), like the Logbook
// and the rosters. Every row is one height (.birdSatRow in style.css), and a few above and below the view are drawn too
const BIRD_WATCH_SAT_ROW = 22;
const BIRD_WATCH_SAT_BUFFER = 8;
const BIRD_WATCH_SAT_LIST_HEIGHT = 210;

// The scan for satellites near AOS (the Scan Near AOS button): the satellites of the filter that are in AOS now and will stay for the
// next five minutes, or will be within the next hour. active: the results list shows them (with their AOS In column) instead of the
// search; order: their catalog numbers, in AOS now first (the one that has been up longest) and then the soonest; found: their
// results by catalog number; pending: the request asked for
GT.birdWatchScan = { active: false, order: [], found: new Map(), pending: null };

function birdWatchSatsRender()
{
  birdWatchLogTagValue.checked = GT.settings.Birdwatch.logTag;
  birdWatchSkyboxValue.checked = GT.settings.Birdwatch.skybox;
  birdWatchAutoMinEl.value = GT.settings.Birdwatch.autoMinElevation;
  birdWatchAutoMinElText.textContent = GT.settings.Birdwatch.autoMinElevation + "°";
  birdWatchHideNoUplinkValue.checked = GT.settings.Birdwatch.hideNoUplink;
  birdWatchSatUplink.checked = GT.settings.Birdwatch.uplinkOnly;
  birdWatchSatRigRender();
  birdWatchSatVirtual(birdWatchSatTrackedList, GT.settings.Birdwatch.tracked, "remove", false);
  birdWatchSatShowResults(false);
}

// What is typed or the Only With Uplinks box changed: the search again (a scan's results are left)
function birdWatchSatFilterChange()
{
  GT.settings.Birdwatch.uplinkOnly = birdWatchSatUplink.checked;
  GT.birdWatchScan.active = false;
  GT.birdWatchScan.pending = null;
  birdWatchSatShowResults(true);
}

// Scan By Rig: the satellites the connected rig can hear or work (its ranges: rigRanges.js). Only while those are known: otherwise it is
// greyed out, says why, and lets every satellite through (what is chosen stays chosen)
let birdWatchSatRigKey = "";

function birdWatchSatRigFilter()
{
  const need = GT.settings.Birdwatch.rigFilter;
  if (need != "hear" && need != "work") return null;
  const ranges = rigRanges();
  return ranges ? { need: need, ranges: ranges } : null;
}

function birdWatchSatRigRender()
{
  const ranges = rigRanges();
  const value = GT.settings.Birdwatch.rigFilter;
  birdWatchSatRig.value = value == "hear" || value == "work" ? value : "off";
  birdWatchSatRig.disabled = !ranges;
  birdWatchSatRigLabel.style.opacity = ranges ? "" : "0.5";
  birdWatchSatRigLabel.title = I18N(ranges ? "birdWatch.satellites.rig.hover" : "birdWatch.satellites.rig.unknown.hover");
  birdWatchSatRigName.textContent = ranges && ranges.model ? ranges.model : "";
  birdWatchSatRigKey = birdWatchSatRigKeyOf(ranges);
}

// What the filter lets through changes with it: the rig(s), their ranges (an offset moves them), whether an uplink can be tuned
function birdWatchSatRigKeyOf(ranges)
{
  return ranges ? (ranges.model || "") + ":" + JSON.stringify(ranges.rx) + ":" + JSON.stringify(ranges.tx) + ":" + ranges.canTx : "";
}

function birdWatchSatRigChange()
{
  GT.settings.Birdwatch.rigFilter = birdWatchSatRig.value;
  birdWatchSatFilterChange();
}

// From Rig Control, as its state changes: a rig whose ranges became known (or stopped being) changes what the filter lets through
function birdWatchSatRigAvailable()
{
  if (typeof birdWatchSatRig == "undefined") return;
  const ranges = rigRanges();
  const key = birdWatchSatRigKeyOf(ranges);
  if (key == birdWatchSatRigKey) return;
  birdWatchSatRigRender();
  if (GT.settings.Birdwatch.rigFilter != "off" && !GT.birdWatchScan.active && birdWatchSettingsDiv.style.display != "none") birdWatchSatSearchChange(false);
}

// The results list: the search, or the scan's results
function birdWatchSatShowResults(toTop)
{
  const scan = GT.birdWatchScan;
  if (!scan.active)
  {
    birdWatchSatSearchChange(toTop);
    return;
  }
  // The satellites already tracked are not offered again
  birdWatchSatVirtual(birdWatchSatResults, scan.order.filter((norad) => !GT.settings.Birdwatch.tracked.includes(norad)), "add", toTop, true);
}

// A list's rows in view: the list's items, and what each row's button does. A new list (a new search) starts at the top
function birdWatchSatVirtual(list, items, action, toTop, scan = false)
{
  const v = list.birdSatView || (list.birdSatView = { items: [], action: "add", scan: false, first: -1, last: -1, queued: false });
  v.items = items;
  v.action = action;
  v.scan = scan;
  birdWatchSatMeasure(list, items, scan);
  if (toTop) list.scrollTop = 0;
  if (!list.birdSatHooked)
  {
    list.birdSatHooked = true;
    list.addEventListener("scroll", () =>
    {
      if (v.queued) return;
      v.queued = true;
      requestAnimationFrame(() =>
      {
        v.queued = false;
        birdWatchSatDraw(list, false);
      });
    }, { passive: true });
  }
  birdWatchSatDraw(list, true);
}

function birdWatchSatStatus(info)
{
  return info && info.status && info.status != "in orbit" ? info.status : "";
}

// Each list is as wide as its widest row: the widths of the name, description and status columns are measured over every item
// (not just the rows drawn), and set on the list for its rows and its own width to follow (style.css)
function birdWatchSatMeasure(list, items, scan)
{
  const font = getComputedStyle(list).font;
  const context = (birdWatchSatMeasure.canvas || (birdWatchSatMeasure.canvas = document.createElement("canvas"))).getContext("2d");
  context.font = font;
  const width = (text) => (text ? context.measureText(text).width : 0);
  let name = width(I18N("birdWatch.satellites.name.label"));
  let long = width(I18N("birdWatch.satellites.description.label"));
  let status = 0;
  for (const norad of items)
  {
    const tle = birdWatchTleGet(norad);
    const info = birdWatchSatInfo(norad);
    name = Math.max(name, width(tle ? tle.name : String(norad)));
    long = Math.max(long, width(tle ? birdWatchLongName(info, tle.name) : ""));
    status = Math.max(status, width(birdWatchSatStatus(info)));
  }
  // A little over what the text needs, for the scaling of text on some screens
  list.style.setProperty("--satName", Math.ceil(name) + 8 + "px");
  list.style.setProperty("--satLong", Math.ceil(long) + 8 + "px");
  list.style.setProperty("--satStatus", (status ? Math.ceil(status) + 8 : 0) + "px");
  // The scan's AOS In column (MM:SS) and the gap before it
  list.style.setProperty("--satAos", scan ? Math.max(58, Math.ceil(width(I18N("birdWatch.satellites.aosIn.label"))) + 8) + "px" : "0px");
  list.style.setProperty("--satAosGap", scan ? "10px" : "0px");
  // The edit button, and the gap before it
  list.style.setProperty("--satEdit", "44px");
  birdWatchTabsFit();
}

// The boxes of a tab sit in a row as wide as the window allows. When they don't fit in one row they wrap, and the tab is then only as
// wide as its widest row (a wrapped container would otherwise keep the width of the one row they would make if they fit)
function birdWatchTabsFit()
{
  // A resize of the window can come while the page is still loading, before the settings window's elements are there
  if (typeof birdWatchSettingsDiv == "undefined") return;
  for (const columns of birdWatchSettingsDiv.querySelectorAll(".mapGroups"))
  {
    columns.style.width = "";
    if (columns.offsetParent === null) continue;
    const gap = parseFloat(getComputedStyle(columns).columnGap) || 0;
    const rows = new Map();
    for (const group of columns.children)
    {
      if (group.offsetParent === null) continue;
      rows.set(group.offsetTop, (rows.has(group.offsetTop) ? rows.get(group.offsetTop) + gap : 0) + group.offsetWidth);
    }
    if (rows.size > 1) columns.style.width = Math.ceil(Math.max(...rows.values())) + 1 + "px";
  }
}

window.addEventListener("resize", birdWatchTabsFit);

// The header at the top of each list, kept there while it scrolls (position: sticky, .birdSatHead in style.css)
function birdWatchSatHeader(scan, list = null)
{
  const row = document.createElement("div");
  // The rows' own classes, so the header has the rows' padding and gaps and its columns line up with theirs
  row.className = "birdTleRow birdSatRow birdSatHead";
  const columns = [["birdTleName", "birdWatch.satellites.name.label"], ["birdSatId", "birdWatch.satellites.id.label"], ["birdSatLong", "birdWatch.satellites.description.label"]];
  if (scan) columns.push(["birdSatAos", "birdWatch.satellites.aosIn.label"]);
  columns.push(["birdSatStatus", null]);
  // Both lists have the edit button of each satellite before the add or remove button: the header holds the column's width
  columns.push(["birdSatEdit", null]);
  columns.push(["birdSatButton", null]);
  for (const [cls, key] of columns)
  {
    const cell = document.createElement("span");
    cell.className = cls;
    if (key) cell.textContent = I18N(key);
    if (cls == "birdSatEdit")
    {
      cell.className = "button birdTleButton birdSatButton";
      cell.textContent = "✎";
      cell.style.visibility = "hidden";
    }
    // The button column's header is a button the size of the rows' buttons: it adds every result at once (the results) or stops
    // tracking every satellite (the tracked list), and is only there to hold the column's width with nothing to act on
    if (cls == "birdSatButton")
    {
      cell.className = "button birdTleButton birdSatButton";
      const adding = list && list.action == "add";
      if (list && list.items.length > 0)
      {
        cell.textContent = adding ? "⊕" : "⊖";
        cell.title = I18N(adding ? "birdWatch.satellites.addAll.hover" : "birdWatch.satellites.removeAll.hover");
        cell.onclick = () => (adding ? birdWatchSatAddAll(list.items) : birdWatchSatRemoveAll());
      }
      else
      {
        cell.textContent = "+";
        cell.style.visibility = "hidden";
      }
    }
    row.appendChild(cell);
  }
  return row;
}

// Redrawn when the rows drawn no longer cover the view (or when forced: the items changed)
function birdWatchSatDraw(list, force)
{
  const v = list.birdSatView;
  const count = v.items.length;
  const height = list.clientHeight || BIRD_WATCH_SAT_LIST_HEIGHT;
  const shownFirst = Math.max(0, Math.min(count, Math.floor(list.scrollTop / BIRD_WATCH_SAT_ROW)));
  const shownLast = Math.min(count, Math.ceil((list.scrollTop + height) / BIRD_WATCH_SAT_ROW));
  if (!force && shownFirst >= v.first && shownLast <= v.last) return;

  const first = Math.max(0, shownFirst - BIRD_WATCH_SAT_BUFFER);
  const last = Math.min(count, shownLast + BIRD_WATCH_SAT_BUFFER);
  v.first = first;
  v.last = last;
  const spacer = (rows) =>
  {
    const div = document.createElement("div");
    div.style.height = rows * BIRD_WATCH_SAT_ROW + "px";
    return div;
  };
  const nodes = [birdWatchSatHeader(v.scan, v)];
  if (count == 0 && list === birdWatchSatTrackedList)
  {
    const none = document.createElement("div");
    none.className = "birdTleStatus";
    none.textContent = I18N("birdWatch.satellites.none");
    nodes.push(none);
  }
  if (first > 0) nodes.push(spacer(first));
  for (let i = first; i < last; i++) nodes.push(birdWatchSatRow(v.items[i], v.action, v.scan ? GT.birdWatchScan.found.get(v.items[i]) : null));
  if (last < count) nodes.push(spacer(count - last));
  list.replaceChildren(...nodes);
}

// A satellite's row: its name, catalog number, longer name and status, and a button to add or remove it
function birdWatchSatRow(norad, action, scan = null)
{
  const tle = birdWatchTleGet(norad);
  const info = birdWatchSatInfo(norad);
  const row = document.createElement("div");
  row.className = "birdTleRow birdSatRow";

  const name = document.createElement("span");
  name.className = "birdTleName";
  name.textContent = tle ? tle.name : String(norad);
  name.title = birdWatchSatDescription(norad, tle || { name: String(norad) }, info);
  row.appendChild(name);

  const number = document.createElement("span");
  number.className = "birdTleStatus birdSatId";
  number.textContent = norad;
  row.appendChild(number);

  const long = document.createElement("span");
  long.className = "birdSatLong";
  long.textContent = tle ? birdWatchLongName(info, tle.name) : "";
  row.appendChild(long);

  // A scan's time to AOS, in the blue of the Decode bar: counted down by birdWatchSatScanTick
  if (scan)
  {
    const aos = document.createElement("span");
    aos.className = "birdSatAos";
    aos.dataset.aos = scan.aos;
    aos.textContent = birdWatchMmss(scan.aos - Date.now());
    aos.title = [I18N("birdWatch.tip.aos") + "  " + userTimeString(scan.aos) + "  " + Math.round(scan.aosAz) + "°", I18N("birdWatch.tip.los") + "  " + userTimeString(scan.los), I18N("birdWatch.tip.maxElev") + "  " + scan.maxEl.toFixed(1) + "°"].join("\n");
    row.appendChild(aos);
  }

  // The database's status (satellites.json) says "in orbit" for nearly all of them, so only a different one is shown
  const status = document.createElement("span");
  status.className = "birdSatStatus";
  status.textContent = birdWatchSatStatus(info);
  row.appendChild(status);

  const tracked = GT.settings.Birdwatch.tracked.includes(norad);
  const button = document.createElement("div");
  button.className = "button birdTleButton birdSatButton";
  // Edit its orbit values, tracked or not: the Telemetry tab opens with the form (what is saved there overrides the TLE it had)
  const edit = document.createElement("div");
  edit.className = "button birdTleButton birdSatButton";
  edit.textContent = "✎";
  edit.title = I18N("birdWatch.satellites.editTle.hover");
  edit.onclick = () => birdWatchTleEditSatellite(norad);
  row.appendChild(edit);
  if (action == "remove")
  {
    button.textContent = "✕";
    button.title = I18N("birdWatch.satellites.remove.hover");
    button.onclick = () => birdWatchSatRemove(norad);
  }
  else if (tracked)
  {
    button.textContent = "✓";
    button.title = I18N("birdWatch.satellites.tracked.hover");
    button.style.opacity = "0.5";
  }
  else
  {
    button.textContent = "+";
    button.title = I18N("birdWatch.satellites.add.hover");
    button.onclick = () => birdWatchSatAdd(norad);
  }
  row.appendChild(button);
  return row;
}

// The element sets that match what is typed: part of a name (the short one, the database's or its other names) or a catalog number
function birdWatchSatSearchChange(toTop = true)
{
  const query = birdWatchSatSearch.value.trim().toLowerCase();
  const rig = birdWatchSatRigFilter();
  const found = [];
  for (const set of birdWatchTleList())
  {
    if (GT.settings.Birdwatch.tracked.includes(set.norad)) continue;
    if (rig && !birdWatchRigCan(set.norad, rig.need, rig.ranges)) continue;
    const info = birdWatchSatInfo(set.norad);
    const hay = [set.name, String(set.norad), info ? info.name : "", info ? info.names : ""].join("|").toLowerCase();
    if (GT.settings.Birdwatch.uplinkOnly && !birdWatchHasUplink(set.norad)) continue;
    if (query == "" || hay.includes(query)) found.push({ norad: set.norad, exact: String(set.norad) == query || set.name.toLowerCase() == query, name: set.name });
  }
  found.sort((a, b) => (b.exact - a.exact) || a.name.localeCompare(b.name));
  birdWatchSatVirtual(birdWatchSatResults, found.map((item) => item.norad), "add", toTop);
  birdWatchSatCount.textContent = I18N("birdWatch.satellites.found").replace("{n}", found.length);
}

// Scan Near AOS: every satellite the filter lets through (what is typed, Only With Uplinks and Scan By Rig) is asked of the tracker, which looks for the ones
// in AOS now that will be for the next five minutes and the ones that will be within the next hour
function birdWatchSatScan()
{
  const T = GT.birdWatchTrack;
  if (!T || !T.worker) return;
  const scan = GT.birdWatchScan;
  const rig = birdWatchSatRigFilter();
  const norads = [];
  for (const set of birdWatchTleList())
  {
    if (GT.settings.Birdwatch.tracked.includes(set.norad)) continue;
    if (GT.settings.Birdwatch.uplinkOnly && !birdWatchHasUplink(set.norad)) continue;
    if (rig && !birdWatchRigCan(set.norad, rig.need, rig.ranges)) continue;
    const info = birdWatchSatInfo(set.norad);
    const query = birdWatchSatSearch.value.trim().toLowerCase();
    if (query == "" || [set.name, String(set.norad), info ? info.name : "", info ? info.names : ""].join("|").toLowerCase().includes(query)) norads.push(set.norad);
  }
  scan.pending = Date.now();
  birdWatchSatCount.textContent = I18N("birdWatch.satellites.scanning");
  T.worker.postMessage({ type: "scan", id: scan.pending, norads: norads, hours: 1, upMinutes: 5 });
}

// From the tracker: the scan's results, the ones in AOS now first (the longest up first) and then the soonest to rise
function birdWatchSatScanResult(m)
{
  const scan = GT.birdWatchScan;
  if (m.id != scan.pending) return;
  scan.pending = null;
  scan.found = new Map(m.results.map((r) => [r.norad, r]));
  scan.order = m.results.slice().sort((a, b) => a.aos - b.aos).map((r) => r.norad);
  scan.active = true;
  birdWatchSatShowResults(true);
  birdWatchSatCount.textContent = I18N("birdWatch.satellites.scanFound").replace("{n}", m.results.length).replace("{checked}", m.checked);
}

// MM:SS (00:00 once it has begun)
function birdWatchMmss(ms)
{
  const seconds = Math.max(0, Math.round(ms / 1000));
  return String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
}

// Each tracker tick: the times to AOS in the rows drawn count down
function birdWatchSatScanTick()
{
  if (!GT.birdWatchScan.active || birdWatchSettingsDiv.style.display == "none") return;
  const now = Date.now();
  for (const cell of birdWatchSatResults.querySelectorAll(".birdSatAos[data-aos]")) cell.textContent = birdWatchMmss(Number(cell.dataset.aos) - now);
}

// Hot keys (hotkeys.js): the next or previous tracked satellite is selected, in the order they are tracked
function birdWatchSelectStep(step)
{
  const T = GT.birdWatchTrack;
  const list = GT.settings.Birdwatch.tracked;
  if (!T || !T.worker || !birdWatchPanelShown() || list.length == 0) return;
  const at = list.indexOf(T.selected);
  const next = list[at < 0 ? (step > 0 ? 0 : list.length - 1) : (at + step + list.length) % list.length];
  if (T.selected != next) birdWatchSelect(next);
}

function birdWatchSatAdd(norad)
{
  const tracked = GT.settings.Birdwatch.tracked;
  if (tracked.includes(norad)) return;
  tracked.push(norad);
  const T = GT.birdWatchTrack;
  if (T && T.worker) T.worker.postMessage({ type: "track", norad: [norad] });
  birdWatchSatsRender();
}

// Every satellite in the results at once
function birdWatchSatAddAll(items)
{
  const tracked = GT.settings.Birdwatch.tracked;
  const added = items.filter((norad) => !tracked.includes(norad));
  if (added.length == 0) return;
  tracked.push(...added);
  const T = GT.birdWatchTrack;
  if (T && T.worker) T.worker.postMessage({ type: "track", norad: added });
  birdWatchSatsRender();
}

// Every satellite stops being tracked
function birdWatchSatRemoveAll()
{
  for (const norad of [...GT.settings.Birdwatch.tracked]) birdWatchSatRemove(norad);
}

// Stopped being tracked: off the map, out of the tracker, and out of whatever it was selected for
function birdWatchSatRemove(norad)
{
  const tracked = GT.settings.Birdwatch.tracked;
  const at = tracked.indexOf(norad);
  if (at < 0) return;
  tracked.splice(at, 1);
  const T = GT.birdWatchTrack;
  if (T)
  {
    if (T.worker) T.worker.postMessage({ type: "untrack", norad: [norad] });
    if (T.selected == norad) birdWatchSelect(norad);
    if (T.hover == norad) T.hover = null;
    if (T.autoPick == norad) T.autoPick = null;
    const marker = T.markers.get(norad);
    if (marker && GT.layerSources.birdWatch) GT.layerSources.birdWatch.removeFeature(marker);
    T.markers.delete(norad);
    T.last.delete(norad);
    T.passes.delete(norad);
    if (T.predict)
    {
      birdWatchPathRemove(norad);
      T.predict.paths.delete(norad);
      T.predict.arcs.delete(norad);
    }
    birdWatchFootprintSync();
  }
  birdWatchSatsRender();
}
