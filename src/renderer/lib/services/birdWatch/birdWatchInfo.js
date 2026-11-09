// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// BirdWatch's satellite info panel (under the BirdWatch title): the rows of numbers of the selected satellite. A row can be dragged
// to another place, a right click on a value picks its color, and a right click on a label opens a menu: make it the featured item
// (large, at the top), show or hide each row, reset the list. All of it is kept in settings.BirdWatch.info

// Every row of the list, in the order it comes in. A row added here later is added to the end of everyone's list (birdWatchInfoState)
//   keys:   the values of the row, each a color's name in the settings (Lat/Lon is one row with two values)
//   name:   the row's name in full: its label, its line in the menu, and in brackets under the value when it is the featured item
//   labels: the label of each value in the row, when it isn't the row's name
//   value:  each value's text (or html) and the color it has until the user picks one
//   tip:    the row's tooltip
//   off:    the row is hidden until the user shows it (a new row with it set is hidden for everyone, once)
//   when:   the row is only there while this is true (the rotor's, while Rotor Control is on)
//   click:  what a left click on the value does (the rotor's opens its settings)
const BIRD_WATCH_INFO_ITEMS = [
  { id: "azim", keys: ["azim"], name: () => I18N("birdWatch.tip.azim"), value: (n) => [{ text: n.az, color: "yellow" }], tip: () => I18N("birdWatch.hint.azim") },
  { id: "elev", keys: ["elev"], name: () => I18N("birdWatch.tip.elev"), value: (n) => [{ text: n.el, color: n.up ? "lightgreen" : "#ff8080" }], tip: () => I18N("birdWatch.hint.elev") },
  {
    id: "latlon", keys: ["lat", "lon"],
    name: () => I18N("birdWatch.info.latName") + "/" + I18N("birdWatch.info.lonName"),
    labels: () => [I18N("birdWatch.info.latName"), I18N("birdWatch.info.lonName")],
    value: (n) => [{ text: n.lat, color: "lightgreen" }, { text: n.lon, color: "lightgreen" }],
    tip: () => I18N("birdWatch.hint.latlon")
  },
  { id: "grid", keys: ["grid"], name: () => I18N("gt.callsignBox.Grid"), value: (n) => [{ text: n.grid, color: "yellow" }], tip: () => I18N("birdWatch.hint.grid") },
  { id: "range", keys: ["range"], name: () => I18N("birdWatch.info.range"), value: (n) => [{ text: n.range, color: "cyan" }], tip: () => I18N("birdWatch.tip.range") },
  { id: "rangerate", keys: ["rangerate"], name: () => I18N("birdWatch.info.rangeRate"), value: (n) => [{ text: n.rangeRate, color: "white" }], tip: () => I18N("birdWatch.hint.rangeRate") },
  { id: "ground", keys: ["ground"], name: () => I18N("birdWatch.tip.ground"), value: (n) => [{ text: n.ground, color: "cyan" }], tip: () => I18N("birdWatch.tip.ground") },
  { id: "altitude", keys: ["altitude"], name: () => I18N("birdWatch.info.altitude"), value: (n) => [{ text: n.altitude, color: "cyan" }], tip: () => I18N("birdWatch.hint.altitude") },
  { id: "velocity", keys: ["velocity"], name: () => I18N("birdWatch.info.velocity"), value: (n) => [{ text: n.velocity, color: "cyan" }], tip: () => I18N("birdWatch.hint.velocity") },
  { id: "heading", keys: ["heading"], name: () => I18N("birdWatch.info.heading"), value: (n) => [{ html: n.heading, color: "yellow" }], tip: () => I18N("birdWatch.hint.heading") },
  { id: "footprint", keys: ["footprint"], name: () => I18N("birdWatch.info.footprint"), value: (n) => [{ text: n.footprint, color: "cyan" }], tip: () => I18N("birdWatch.tip.footprint") },
  {
    id: "doppler", keys: ["doppler"], name: () => I18N("birdWatch.info.doppler"), value: (n) => [{ text: n.doppler, color: "white" }],
    tip: (n) => I18N("birdWatch.tip.doppler") + (n.refText ? "\n" + n.refText : "")
  },
  {
    id: "sigloss", keys: ["sigloss"], name: () => I18N("birdWatch.info.siglossFull"), value: (n) => [{ text: n.sigloss, color: "white" }],
    tip: (n) => I18N("birdWatch.tip.sigloss") + (n.refText ? "\n" + n.refText : "")
  },
  { id: "sigdelay", keys: ["sigdelay"], name: () => I18N("birdWatch.info.sigdelayFull"), value: (n) => [{ text: n.sigdelay, color: "white" }], tip: () => I18N("birdWatch.tip.sigdelay") },
  { id: "aos", keys: ["aos"], name: () => I18N("birdWatch.info.aos"), value: (n) => [{ html: n.aos, color: "white" }], tip: () => I18N("birdWatch.tip.aos") },
  { id: "los", keys: ["los"], name: () => I18N("birdWatch.info.los"), value: (n) => [{ html: n.los, color: "white" }], tip: () => I18N("birdWatch.tip.los") },
  { id: "maxtime", keys: ["maxtime"], name: () => I18N("birdWatch.info.maxTime"), value: (n) => [{ html: n.maxTime, color: "white" }], tip: () => I18N("birdWatch.tip.tca") },
  { id: "dos", keys: ["dos"], name: () => I18N("birdWatch.info.dos"), value: (n) => [{ text: n.dos, color: "white" }], tip: () => I18N("birdWatch.tip.dos") },
  { id: "progress", keys: ["progress"], off: true, name: () => I18N("birdWatch.info.progress"), value: (n) => [{ text: n.progress, color: "lightgreen" }], tip: () => I18N("birdWatch.hint.progress") },
  { id: "maxel", keys: ["maxel"], name: () => I18N("birdWatch.tip.maxElev"), value: (n) => [{ html: n.max, color: "lightgreen" }], tip: () => I18N("birdWatch.hint.maxElev") },
  { id: "period", keys: ["period"], off: true, name: () => I18N("birdWatch.info.period"), value: (n) => [{ text: n.period, color: "cyan" }], tip: () => I18N("birdWatch.hint.period") },
  { id: "inclination", keys: ["inclination"], off: true, name: () => I18N("birdWatch.info.inclination"), value: (n) => [{ text: n.inclination, color: "cyan" }], tip: () => I18N("birdWatch.hint.inclination") },
  { id: "apogee", keys: ["apogee"], off: true, name: () => I18N("birdWatch.info.apogee"), value: (n) => [{ text: n.apogee, color: "cyan" }], tip: () => I18N("birdWatch.hint.apogee") },
  { id: "perigee", keys: ["perigee"], off: true, name: () => I18N("birdWatch.info.perigee"), value: (n) => [{ text: n.perigee, color: "cyan" }], tip: () => I18N("birdWatch.hint.perigee") },
  { id: "revolution", keys: ["revolution"], off: true, name: () => I18N("birdWatch.info.revolution"), value: (n) => [{ text: n.revolution, color: "cyan" }], tip: () => I18N("birdWatch.hint.revolution") },
  { id: "sunel", keys: ["sunel"], off: true, name: () => I18N("birdWatch.info.sunEl"), value: (n) => [{ text: n.sunEl, color: "yellow" }], tip: () => I18N("birdWatch.hint.sunEl") },
  // The rotator's position (rotor.js), while Rotor Control is on: orange until it is connected, with the status in short (the room is
  // small); a click opens its settings
  {
    id: "rotor", keys: ["rotor"], when: () => GT.settings.rotor.enable, name: () => I18N("settings.rotor.label"),
    value: () =>
    {
      const R = GT.rotor;
      const live = (R.status == "connected" || R.status == "udp") && R.az !== null;
      const short = R.status == "error" ? I18N("rotor.status.errorShort") : I18N("rotor.status." + R.status).replace("{0}", R.status == "notFound" && GT.settings.rotor.port ? GT.settings.rotor.port.portName : R.error);
      return [{ text: live ? rotorPositionText() : short, color: R.status == "connected" || R.status == "udp" ? "lightgreen" : "orange" }];
    },
    tip: () => (GT.rotor.status == "error" ? GT.rotor.error + "\n" : "") + I18N("settings.rotor.hover"),
    click: () => rotorOpenSettings()
  },
  // The time to the next AOS, or to the LOS while the satellite is up: green while it is up and orange while it is not
  {
    id: "ttgo", keys: ["ttgo"],
    name: (n) => (n ? n.ttgoLabel : I18N("birdWatch.info.timeToAos")),
    value: (n) => [{ text: n.ttgo, color: n.up ? "lightgreen" : "orange" }],
    tip: (n) => n.ttgoFull
  },
  // The selected satellite's next mutual pass with an active station (Skeds, birdWatchSkeds.js), while there is one: magenta until it
  // opens, green with the time left while it is under way; a click opens the Skeds tab
  {
    id: "sked", keys: ["sked"], when: () => birdWatchSkedsActive(), name: () => I18N("birdWatch.skeds.info.label"),
    value: () =>
    {
      const info = birdWatchSkedInfo();
      return [{ html: info.html, color: info.color }];
    },
    tip: () => birdWatchSkedInfo().tip,
    click: () => showBirdWatchSettings("birdWatchSkedsDiv")
  }
];

// The rows as they are on screen: id -> { item, row, labels, values }
let birdWatchInfoRows = new Map();
let birdWatchInfoBuilt = false;
let birdWatchInfoLastN = null;
let birdWatchInfoDragging = null;

function birdWatchInfoItem(id)
{
  return BIRD_WATCH_INFO_ITEMS.find((i) => i.id == id);
}

// The user's list, made sound: only rows that exist, none twice, the featured one not among them, and a row that isn't in
// the saved order (added since) at the end. A row seen for the first time that is "off" starts out hidden
function birdWatchInfoState()
{
  const B = GT.settings.BirdWatch;
  const S = B.info && typeof B.info == "object" ? B.info : (B.info = {});
  const ids = BIRD_WATCH_INFO_ITEMS.map((i) => i.id);
  if (!ids.includes(S.featured)) S.featured = "ttgo";
  const seen = new Set([S.featured]);
  const order = [];
  for (const id of Array.isArray(S.order) ? S.order : [])
  {
    if (ids.includes(id) && !seen.has(id))
    {
      seen.add(id);
      order.push(id);
    }
  }
  for (const id of ids)
  {
    if (!seen.has(id))
    {
      seen.add(id);
      order.push(id);
    }
  }
  S.order = order;
  S.hidden = (Array.isArray(S.hidden) ? S.hidden : []).filter((id) => ids.includes(id));
  S.known = (Array.isArray(S.known) ? S.known : []).filter((id) => ids.includes(id));
  for (const item of BIRD_WATCH_INFO_ITEMS)
  {
    if (S.known.includes(item.id)) continue;
    S.known.push(item.id);
    if (item.off && !S.hidden.includes(item.id)) S.hidden.push(item.id);
  }
  S.hidden = S.hidden.filter((id) => id != S.featured);
  if (!S.colors || typeof S.colors != "object") S.colors = {};
  return S;
}

function birdWatchInfoBuild()
{
  const S = birdWatchInfoState();
  const body = birdWatchInfoBody;
  if (!birdWatchInfoBuilt) birdWatchInfoListen();
  birdWatchInfoBuilt = true;
  birdWatchInfoRows = new Map();
  body.textContent = "";

  // The featured item: large and centered, its name in brackets under it
  const featured = birdWatchInfoItem(S.featured);
  const top = body.insertRow();
  top.className = "birdInfoFeatured";
  const cell = top.insertCell();
  const values = featured.keys.map((key, i) =>
  {
    if (i) cell.append(" / ");
    const span = document.createElement("span");
    span.className = "birdInfoFeaturedValue";
    span.dataset.key = key;
    if (featured.click)
    {
      span.style.cursor = "pointer";
      span.onclick = featured.click;
    }
    cell.append(span);
    return span;
  });
  const bracket = document.createElement("div");
  bracket.className = "birdInfoFeaturedName";
  bracket.dataset.item = featured.id;
  bracket.textContent = "(" + featured.name(null) + ")";
  cell.append(bracket);
  birdWatchInfoRows.set(featured.id, { item: featured, row: top, labels: [bracket], values: values, featured: true });

  for (const id of S.order)
  {
    if (S.hidden.includes(id)) continue;
    const item = birdWatchInfoItem(id);
    if (item.when && !item.when()) continue;
    const tr = body.insertRow();
    tr.className = "birdInfoRow";
    tr.draggable = true;
    tr.dataset.id = id;
    const names = item.labels ? item.labels(null) : [item.name(null)];
    const several = item.keys.length > 1;
    const labels = [];
    const cells = [];
    // One cell: the label (it takes the room that is left, and is cut short rather than push the value) and the value (only
    // its text takes the right click for its color). A row with two values wraps its second pair under the first when they don't fit
    const box = tr.insertCell().appendChild(document.createElement("div"));
    box.className = several ? "birdInfoBox birdInfoPair" : "birdInfoBox";
    item.keys.forEach((key, i) =>
    {
      const group = several ? box.appendChild(document.createElement("div")) : box;
      if (several) group.className = "birdInfoGroup";
      const label = group.appendChild(document.createElement("span"));
      label.className = "birdInfoLabel";
      label.dataset.item = id;
      label.textContent = names[i];
      const value = group.appendChild(document.createElement("span"));
      value.className = "birdInfoValue";
      value.dataset.key = key;
      if (item.click)
      {
        value.style.cursor = "pointer";
        value.onclick = item.click;
      }
      labels.push(label);
      cells.push(value);
    });
    birdWatchInfoRows.set(id, { item: item, row: tr, labels: labels, values: cells, featured: false });
  }
}

// The list changed: drawn again, with the numbers the satellite had last
function birdWatchInfoRebuild()
{
  birdWatchInfoBuild();
  if (birdWatchInfoLastN) birdWatchInfoUpdate(birdWatchInfoLastN);
}

// Each tracker tick: the numbers of the selected satellite in their rows
function birdWatchInfoUpdate(n)
{
  birdWatchInfoLastN = n;
  if (!birdWatchInfoBuilt) birdWatchInfoBuild();
  const colors = birdWatchInfoState().colors;
  for (const entry of birdWatchInfoRows.values())
  {
    const item = entry.item;
    const values = item.value(n);
    values.forEach((v, i) =>
    {
      const el = entry.values[i];
      if (v.html !== undefined) el.innerHTML = v.html;
      else el.textContent = v.text;
      el.style.color = colors[item.keys[i]] || v.color;
    });
    if (entry.featured) entry.labels[0].textContent = "(" + item.name(n) + ")";
    else if (item.labels) item.labels(n).forEach((text, i) => (entry.labels[i].textContent = text));
    else entry.labels[0].textContent = item.name(n);
    // (Set only when it changed: a tooltip showing isn't redrawn every tick)
    const tip = item.tip ? item.tip(n) : "";
    if (entry.row.title != tip) entry.row.title = tip;
  }
}

// Make an item the featured one: the one that was featured goes back into the list where this one was
function birdWatchInfoFeature(id)
{
  const S = birdWatchInfoState();
  if (id == S.featured) return;
  S.order[S.order.indexOf(id)] = S.featured;
  S.featured = id;
  birdWatchInfoRebuild();
}

function birdWatchInfoToggle(id)
{
  const S = birdWatchInfoState();
  S.hidden = S.hidden.includes(id) ? S.hidden.filter((h) => h != id) : S.hidden.concat(id);
  birdWatchInfoRebuild();
}

// Every row shown (the order and the featured item stay)
function birdWatchInfoEnableAll()
{
  birdWatchInfoState().hidden = [];
  birdWatchInfoRebuild();
}

// The default list: the featured item, the order and which rows are shown
function birdWatchInfoReset()
{
  // The colors picked stay
  const S = birdWatchInfoState();
  S.featured = "ttgo";
  S.order = [];
  S.hidden = [];
  // Forgetting the rows seen puts the "off" ones back to hidden
  S.known = [];
  birdWatchInfoRebuild();
}

// Dragged row dropped before or after another
function birdWatchInfoMove(id, target, before)
{
  if (id == target) return;
  const S = birdWatchInfoState();
  S.order = S.order.filter((x) => x != id);
  S.order.splice(S.order.indexOf(target) + (before ? 0 : 1), 0, id);
  birdWatchInfoRebuild();
}

// Right click on a label: the featured item, which rows are shown, and the way back to the default list
function birdWatchInfoMenu(id)
{
  const S = birdWatchInfoState();
  const menu = new Menu();
  menu.append(new MenuItem({
    type: "checkbox",
    label: I18N("birdWatch.info.featured"),
    checked: S.featured == id,
    enabled: S.featured != id,
    click: () => birdWatchInfoFeature(id)
  }));
  menu.append(new MenuItem({ type: "separator" }));
  for (const rowId of [S.featured].concat(S.order))
  {
    const item = birdWatchInfoItem(rowId);
    if (item.when && !item.when()) continue;
    menu.append(new MenuItem({
      type: "checkbox",
      label: item.name(birdWatchInfoLastN),
      checked: !S.hidden.includes(rowId),
      enabled: rowId != S.featured,
      click: () => birdWatchInfoToggle(rowId)
    }));
  }
  menu.append(new MenuItem({ type: "separator" }));
  menu.append(new MenuItem({ label: I18N("birdWatch.info.enableAll"), click: () => birdWatchInfoEnableAll() }));
  menu.append(new MenuItem({ label: I18N("birdWatch.info.defaultList"), click: () => birdWatchInfoReset() }));
  menu.popup();
}

// "rgb(r, g, b)" as the "#rrggbb" a color input takes
function birdWatchInfoHex(rgb)
{
  const [r, g, b] = (String(rgb).match(/\d+/g) || [255, 255, 255]).map(Number);
  return "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
}

// Right click on a value: the color picker, at the mouse, for that value; each change shows at once
function birdWatchInfoPick(key, el, event)
{
  let input = birdWatchInfoPick.input;
  if (!input)
  {
    input = birdWatchInfoPick.input = document.createElement("input");
    input.type = "color";
    Object.assign(input.style, { position: "fixed", width: "1px", height: "1px", opacity: "0", border: "0", padding: "0", pointerEvents: "none", zIndex: "700" });
    document.body.append(input);
    input.addEventListener("input", () =>
    {
      birdWatchInfoState().colors[input.dataset.key] = input.value;
      for (const entry of birdWatchInfoRows.values())
      {
        const at = entry.item.keys.indexOf(input.dataset.key);
        if (at >= 0) entry.values[at].style.color = input.value;
      }
    });
  }
  input.dataset.key = key;
  input.value = birdWatchInfoHex(getComputedStyle(el).color);
  input.style.left = event.clientX + "px";
  input.style.top = event.clientY + "px";
  if (input.showPicker) input.showPicker();
  else input.click();
}

// Once, on the table: right clicks and dragging a row (the rows themselves are drawn again whenever the list changes)
function birdWatchInfoListen()
{
  const table = birdWatchInfoPos;
  table.addEventListener("contextmenu", (e) =>
  {
    const value = e.target.closest("[data-key]");
    const label = e.target.closest("[data-item]");
    if (!value && !label) return;
    e.preventDefault();
    if (value) birdWatchInfoPick(value.dataset.key, value, e);
    else birdWatchInfoMenu(label.dataset.item);
  });

  const clearMarks = () =>
  {
    for (const tr of table.querySelectorAll(".birdInfoDragging, .birdInfoDropBefore, .birdInfoDropAfter")) tr.classList.remove("birdInfoDragging", "birdInfoDropBefore", "birdInfoDropAfter");
  };
  const above = (e, tr) =>
  {
    const box = tr.getBoundingClientRect();
    return e.clientY < box.top + box.height / 2;
  };
  table.addEventListener("dragstart", (e) =>
  {
    const tr = e.target.closest ? e.target.closest("tr[data-id]") : null;
    if (!tr) return;
    birdWatchInfoDragging = tr.dataset.id;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", birdWatchInfoDragging);
    tr.classList.add("birdInfoDragging");
  });
  table.addEventListener("dragover", (e) =>
  {
    const tr = birdWatchInfoDragging ? e.target.closest("tr[data-id]") : null;
    if (!tr) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const was = table.querySelectorAll(".birdInfoDropBefore, .birdInfoDropAfter");
    for (const mark of was) mark.classList.remove("birdInfoDropBefore", "birdInfoDropAfter");
    tr.classList.add(above(e, tr) ? "birdInfoDropBefore" : "birdInfoDropAfter");
  });
  table.addEventListener("drop", (e) =>
  {
    const tr = birdWatchInfoDragging ? e.target.closest("tr[data-id]") : null;
    if (!tr) return;
    e.preventDefault();
    const id = birdWatchInfoDragging;
    birdWatchInfoDragging = null;
    birdWatchInfoMove(id, tr.dataset.id, above(e, tr));
  });
  table.addEventListener("dragend", () =>
  {
    birdWatchInfoDragging = null;
    clearMarks();
  });
}

// The Sun's elevation above the horizon (degrees) at a place and time: the low precision formulas of the gray line's
// terminator (grayline.js), good to a fraction of a degree
function birdWatchSunElevation(lat, lon, ms)
{
  const R = Math.PI / 180;
  const n = ms / 86400000 + 2440587.5 - 2451545.0;
  const gst = (18.697374558 + 24.06570982441908 * n) % 24;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = (357.528 + 0.9856003 * n) % 360;
  const lambda = L + 1.915 * Math.sin(g * R) + 0.02 * Math.sin(2 * g * R);
  const epsilon = 23.43929111 - n / 36525 * (46.836769 / 3600);
  const rightAscension = Math.atan2(Math.cos(epsilon * R) * Math.sin(lambda * R), Math.cos(lambda * R));
  const declination = Math.asin(Math.sin(epsilon * R) * Math.sin(lambda * R));
  const hourAngle = (gst * 15 + lon) * R - rightAscension;
  return Math.asin(Math.sin(lat * R) * Math.sin(declination) + Math.cos(lat * R) * Math.cos(declination) * Math.cos(hourAngle)) / R;
}

// The way a satellite is moving over the ground (degrees clockwise from north) between two tracker samples; the last one while it hasn't moved
function birdWatchHeading(from, to)
{
  if (!from || from.error || to.error) return from ? from.heading : undefined;
  if (from.lat == to.lat && from.lon == to.lon) return from.heading;
  const R = Math.PI / 180;
  const dLon = (to.lon - from.lon) * R;
  const y = Math.sin(dLon) * Math.cos(to.lat * R);
  const x = Math.cos(from.lat * R) * Math.sin(to.lat * R) - Math.sin(from.lat * R) * Math.cos(to.lat * R) * Math.cos(dLon);
  return (Math.atan2(y, x) / R + 360) % 360;
}

// The numbers of the rows that aren't in the tracker's sample: from its Doppler factor, the pass, the element set and the clock
function birdWatchInfoExtras(norad, sat, pass, now)
{
  const unit = GT.settings.app.distanceUnit;
  const extras = {};
  // Positive while it moves away from you: the frequency heard is the one sent times (1 - rate / the speed of light)
  const rate = (1 - sat.doppler) * 299792.458;
  extras.rangeRate = (rate >= 0 ? "+" : "") + kilometerToUnit(rate, unit).toFixed(2) + " " + unit.toLowerCase() + "/s";
  // An arrow turned to the heading (drawn, so it looks the same on every system), then the degrees
  extras.heading = sat.heading === undefined ? "-" :
    Math.round(sat.heading) + "&deg;&nbsp;" + headingArrowHtml(sat.heading);
  extras.maxTime = pass ? birdWatchTimeAzHtml(pass.maxElTime, pass.maxAz) : "-";
  extras.progress = sat.up && pass && pass.aos <= now && pass.los > pass.aos ? Math.min(100, Math.max(0, (now - pass.aos) / (pass.los - pass.aos) * 100)).toFixed(0) + "%" : "-";
  // From the horizon the map's Terminator setting says (Settings, Map): 0 is on the terminator line, below it is night
  extras.sunEl = (birdWatchSunElevation(GT.myLat, GT.myLon, now) - GT.terminatorDegrees[GT.settings.map.terminatorDegreeIndex]).toFixed(1) + "°";
  extras.period = extras.inclination = extras.apogee = extras.perigee = extras.revolution = "-";
  // The element set's second line: inclination (degrees), eccentricity (decimal point implied), revolutions a day and the revolution
  // number at its epoch. The orbit's size from the revolutions a day (Kepler's third law)
  const tle = birdWatchTleGet(norad);
  if (tle && tle.line2)
  {
    const inclination = Number(tle.line2.slice(8, 16));
    const eccentricity = Number("0." + tle.line2.slice(26, 33).trim());
    const revolutions = Number(tle.line2.slice(52, 63));
    const epochRevolution = Number(tle.line2.slice(63, 68));
    if (revolutions > 0)
    {
      const axis = Math.cbrt(398600.4418 / ((revolutions * 2 * Math.PI / 86400) ** 2));
      extras.period = (1440 / revolutions).toFixed(1) + " min";
      extras.inclination = inclination.toFixed(2) + "°";
      extras.apogee = birdWatchDistance(axis * (1 + eccentricity) - EARTH_RADIUS_KM);
      extras.perigee = birdWatchDistance(axis * (1 - eccentricity) - EARTH_RADIUS_KM);
      // The number at the epoch plus the orbits since (it can be one off close to a revolution's start)
      if (tle.epoch && Number.isFinite(epochRevolution)) extras.revolution = String(epochRevolution + Math.floor(revolutions * (now - tle.epoch) / 86400000));
    }
  }
  return extras;
}

// Left click on the satellite's name: the map centered on it
function birdWatchCenterOnSelected()
{
  const T = GT.birdWatchTrack;
  const marker = T && T.selected ? T.markers.get(T.selected) : null;
  const geometry = marker ? marker.getGeometry() : null;
  if (geometry) GT.map.getView().animate({ center: geometry.getCoordinates(), duration: 300 });
}
