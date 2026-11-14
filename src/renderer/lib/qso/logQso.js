// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// Log QSO (Settings -> Logging: adifLog.logQso, off unless turned on; off, nothing of it shows). Every request to log a QSO by hand comes
// here, to the main window, and from here goes to the Log QSO window (gt_logqso.html, logQsoWindow.js: the form), which hands the QSO
// it makes back here to be logged (logQsoLog). The requests: the button panel's Log QSO and F2 (logQsoButton), the Feed Roster's Log
// QSO... (logQsoFromFeedSpot), and the Multi-Mode Decoder, by way of window.opener (mmdLogQso.js: logQsoShow). GridTracker stays a log
// viewer: the form makes one new QSO and it goes to sendToLogger (adif.js), as every QSO GridTracker logs does. Here too: the last Feed
// Roster spot clicked (a phone QSO's form takes its call and park while the rig is still on it), the rig read (Rig Control's VFO the
// window's VFO menu picks), and whether a call is already in the log on a band and mode today (the form's hint: read only)

// The last Feed Roster (or map) spot clicked with Log QSO on: { call, freq (Hz), mode, band, pota, grid, at (ms: the click) }, else null
GT.logQsoLastSpot = null;
// How long a request waits for the Log QSO window to load (ms), and how often it looks
const LOG_QSO_OPEN_WAIT_MS = 15000;
const LOG_QSO_OPEN_STEP_MS = 250;
// The Log QSO window's name (src/main/index.js allowedWindows)
const LOG_QSO_WINDOW = "gt_logqso";

function logQsoOn()
{
  return GT.settings.adifLog.logQso === true;
}

// The window made (hidden) if it isn't yet: at startup with Log QSO on, and when it's turned on
function logQsoOpenWindow()
{
  if (GT.logQsoWindowHandle == null) GT.logQsoWindowHandle = window.open("gt_logqso.html", LOG_QSO_WINDOW);
}

// A request to log a QSO (from the button, the Feed Roster, the decoder through window.opener): the window shown, in front, and its form
// filled in (req: logQsoWinFill's: { fields }, { phone }, or null for a blank one), once the window has loaded. force: the Feed Roster's
// POTA / SOTA columns, which log by hand with Log QSO's buttons off too (as their own dialog did)
function logQsoShow(req, force = false)
{
  if (!logQsoOn() && force !== true) return;
  logQsoOpenWindow();
  const copy = req ? JSON.parse(JSON.stringify(req)) : null;
  const until = Date.now() + LOG_QSO_OPEN_WAIT_MS;
  const give = () =>
  {
    if (GT.logQsoWindowInitialized && GT.logQsoWindowHandle)
    {
      try
      {
        GT.logQsoWindowHandle.window.logQsoWinFill(copy);
      }
      catch (e)
      {
        console.error(e);
      }
      electron.ipcRenderer.send("showWin", LOG_QSO_WINDOW);
      electron.ipcRenderer.send("focusWin", LOG_QSO_WINDOW);
      return;
    }
    if (Date.now() < until) nodeTimers.setTimeout(give, LOG_QSO_OPEN_STEP_MS);
  };
  give();
}

// What Rig Control's VFO for Log QSO reads (the one picked in the window's VFO menu, adifLog.logQsoVfo, else the first one connected):
// { up, freq: its dial on the air (its converter's offset taken off), mode }
function logQsoRigRead()
{
  const none = { up: false, freq: 0, mode: "" };
  if (!GT.settings.Rigs || !GT.settings.Rigs.enable) return none;
  const picked = rigVfoById(GT.settings.adifLog.logQsoVfo);
  const v = picked || rigVfos().find((x) => rigVfoRead(x).up) || null;
  if (!v) return none;
  const read = rigVfoRead(v);
  return read.up ? { up: true, freq: read.dial - rigOffset(v), mode: read.mode || "" } : none;
}

// A point (lon, lat) inside a zone's or county's shape (its GeoJSON feature: Polygon or MultiPolygon, the outer rings)
function logQsoInShape(geo, lon, lat)
{
  const g = geo && (geo.geometry || geo);
  if (!g || !g.coordinates) return false;
  const polys = g.type == "Polygon" ? [g.coordinates] : g.type == "MultiPolygon" ? g.coordinates : [];
  return polys.some((p) => p && p[0] && pointInPolygon([lon, lat], p[0]));
}

// What the station's grid tells (kept by grid: the shapes are only searched when it changes): the CQ and ITU zones and, in the U.S., the
// state and county its center is in
GT.logQsoGridPlace = { grid: "", place: {} };
function logQsoGridPlace(grid)
{
  if (GT.logQsoGridPlace.grid == grid) return GT.logQsoGridPlace.place;
  const place = {};
  try
  {
    const ll = squareToCenter(grid);
    const zone = (dict) => Object.keys(dict || {}).find((k) => logQsoInShape(dict[k].geo, ll.o, ll.a));
    const cq = zone(GT.cqZones);
    if (cq) place.MY_CQ_ZONE = String(Number(cq));
    const itu = zone(GT.ituZones);
    if (itu) place.MY_ITU_ZONE = String(Number(itu));
    // The U.S. states the grid's square touches (GridTracker's grid to state list), their counties searched for its center
    const states = (GT.gridToState[grid.slice(0, 4)] || []).filter((s) => s.startsWith("US-")).map((s) => s.slice(3));
    const county = Object.keys(GT.countyData).find((k) => states.includes(k.split(",")[0]) && logQsoInShape(GT.countyData[k].geo, ll.o, ll.a));
    if (county && county in GT.cntyToCounty)
    {
      place.MY_STATE = county.split(",")[0];
      place.MY_CNTY = place.MY_STATE + "," + GT.cntyToCounty[county];
    }
    else if (states.length == 1) place.MY_STATE = states[0];
  }
  catch (e)
  {
    console.error(e);
  }
  GT.logQsoGridPlace = { grid, place };
  return place;
}

// The Log QSO card's My Station details as GridTracker knows them (only what it knows: anything else is left out, the card's box blank;
// what's typed on the card stands over these): the callsign (STATION_CALLSIGN, OPERATOR), the grid (MY_GRIDSQUARE) and what its center
// is in (logQsoGridPlace), the DXCC entity and its name, the city when the station's own call was looked up, and the rig of the VFO the
// card reads (its name as Rig Control knows it)
function logQsoStationDefaults()
{
  const out = {};
  const call = String(GT.settings.app.myCall || "").toUpperCase().trim();
  if (call && call != "NOCALL" && CALLSIGN_REGEXP.test(call))
  {
    out.STATION_CALLSIGN = call;
    out.OPERATOR = call;
  }
  const grid = String(GT.settings.app.myRawGrid || GT.settings.app.myGrid || "").toUpperCase().trim();
  if (/^[A-R]{2}[0-9]{2}([A-X]{2}([0-9]{2}([A-X]{2})?)?)?$/.test(grid))
  {
    out.MY_GRIDSQUARE = grid;
    Object.assign(out, logQsoGridPlace(grid));
  }
  if (GT.myDXCC > 0)
  {
    out.MY_DXCC = String(GT.myDXCC);
    if (GT.dxccToADIFName[GT.myDXCC]) out.MY_COUNTRY = GT.dxccToADIFName[GT.myDXCC];
  }
  const lookup = call ? GT.lookupCache[call] : null;
  if (lookup && lookup.addr2) out.MY_CITY = String(lookup.addr2);
  try
  {
    if (GT.settings.Rigs && GT.settings.Rigs.enable)
    {
      const v = rigVfoById(GT.settings.adifLog.logQsoVfo) || rigVfos().find((x) => rigVfoRead(x).up) || null;
      const read = v ? rigVfoRead(v) : null;
      const model = read && read.R ? rigModelName(read.R) : "";
      if (model) out.MY_RIG = model;
    }
  }
  catch (e)
  {
    console.error(e);
  }
  return out;
}

// A phone QSO's request: the rig's frequency and mode now, and a spot (fromSpot: opened on that spot)
function logQsoPhoneRequest(spot, fromSpot)
{
  const read = logQsoRigRead();
  return { phone: { rigMode: read.up ? read.mode : "", dialHz: read.up ? read.freq : 0, spot: spot || null, fromSpot: fromSpot === true } };
}

// The Log QSO window hidden with a card on it that wasn't logged or cancelled (its window says, logQsoWinWaiting)
function logQsoCardWaiting()
{
  try
  {
    return !!(GT.logQsoWindowInitialized && GT.logQsoWindowHandle && GT.logQsoWindowHandle.window.logQsoWinWaiting());
  }
  catch (e)
  {
    console.error(e);
    return false;
  }
}

// The button panel's Log QSO (and F2): a click opens the form filled in from the rig (and the last spot clicked, while the rig is still on
// it), or hides the window when it's showing; shown again after hiding, the card is as it was left (until it's logged or cancelled); a
// right-click (toggle false) always opens it afresh
function logQsoButton(toggle = true)
{
  if (!logQsoOn()) return;
  if (toggle && GT.logQsoWindowInitialized && electron.ipcRenderer.sendSync("isWinVisible", LOG_QSO_WINDOW))
  {
    electron.ipcRenderer.send("hideWin", LOG_QSO_WINDOW);
    return;
  }
  // Hidden with a card still on it (not logged, not cancelled): shown again just as it was, nothing cleared or filled in again
  if (toggle && logQsoCardWaiting())
  {
    electron.ipcRenderer.send("showWin", LOG_QSO_WINDOW);
    electron.ipcRenderer.send("focusWin", LOG_QSO_WINDOW);
    return;
  }
  logQsoShow(logQsoPhoneRequest(logQsoLastSpot(), false));
}

// From the Log QSO window: its QSO (adif: the message sendToLogger takes, logQsoAdif's) logged, with a park (potaRef) when it has one.
// True once it's logged; false when sendToLogger left it alone (the same QSO as the one logged last). One with a park or a summit
// (sotaRef: its SOTA_REF, in the record already) says so in the Event Viewer, as the Feed Roster's hand-logged QSOs always have
function logQsoLog(adif, potaRef, sotaRef)
{
  const before = GT.lastReport;
  sendToLogger(String(adif), potaRef ? { potaRef: String(potaRef) } : {});
  if (GT.lastReport === before) return false;
  // (the park only with POTA on: sendToLogger adds it only then)
  const park = GT.settings.app.potaFeatureEnabled ? potaRef : "";
  const refs = [park, sotaRef].filter((value) => value).join(" / ");
  if (refs)
  {
    const call = (/<CALL:\d+>([^ <]+)/i.exec(String(adif)) || [])[1] || "";
    addEvent("sota", `<font style='color:var(--gt-status-ok);'>${I18N("sotaLog.title")}</font><br><font style='color:var(--gt-callsign);'>${htmlEntities(call)}</font> ` +
      `<font style='color:#40FFD8;'>${htmlEntities(refs)}</font>`);
  }
  return true;
}

// From the Log QSO window, when the call on its card settles (typed and left, a pause in typing, or filled in): the call looked up
// with GridTracker's lookup service (Settings -> Lookups), the cache first, as the Lookup window does; its answer comes back through
// logQsoLookupArrived. Not offline unless it's cached (lookupCallsign)
function logQsoLookup(call)
{
  call = String(call || "").trim().toUpperCase();
  if (!CALLSIGN_REGEXP.test(call)) return;
  GT.logQsoLookupCall = call;
  lookupCallsign(call, null, true);
}

// Every lookup's answer (lookup.js cacheLookupObject): handed to the Log QSO window when it's for the call it asked for and its card
// still shows that call
function logQsoLookupArrived(lookup)
{
  try
  {
    if (!lookup || !GT.logQsoLookupCall || String(lookup.call || "").toUpperCase() != GT.logQsoLookupCall) return;
    if (!GT.logQsoWindowInitialized || !GT.logQsoWindowHandle) return;
    GT.logQsoWindowHandle.window.logQsoWinFromLookup(JSON.parse(JSON.stringify(lookup)));
  }
  catch (e)
  {
    console.error(e);
  }
}

// Queue QSOs To Send Later turned on or off, or its count changed: the Log QSO window's chip saying so redrawn (a card on it already
// would otherwise keep what it showed when it was filled)
function logQsoQueuedChanged()
{
  try
  {
    if (!GT.logQsoWindowInitialized || !GT.logQsoWindowHandle) return;
    GT.logQsoWindowHandle.window.logQsoWinQueued();
  }
  catch (e)
  {
    console.error(e);
  }
}

// Settings -> Logging, Log QSO: its box ticked or not
function logQsoEnableChanged(what)
{
  GT.settings.adifLog.logQso = what.checked === true;
  logQsoRender();
}

// Its box as set, the button panel's button shown with it on; on, the window made (hidden); off, the window hidden
function logQsoRender()
{
  if (typeof logQsoCheckBox != "undefined") logQsoCheckBox.checked = logQsoOn();
  if (typeof logQsoButtonDiv != "undefined") logQsoButtonDiv.style.display = logQsoOn() ? "" : "none";
  if (logQsoOn()) logQsoOpenWindow();
  else if (GT.logQsoWindowInitialized) electron.ipcRenderer.send("hideWin", LOG_QSO_WINDOW);
}

// A spot as the form takes it (a copy: the window keeps no reference to the main window's spots)
function logQsoSpotOf(callObj)
{
  const pota = String(callObj.pota || "");
  const grid = String((callObj.fullGrid && callObj.fullGrid.length >= 4 ? callObj.fullGrid : callObj.grid) || "").toUpperCase();
  return {
    call: String(callObj.DEcall || "").toUpperCase(),
    freq: Number(callObj.freq) || 0,
    mode: String(callObj.mode || ""),
    band: String(callObj.band || ""),
    pota: /^[A-Z0-9]{1,4}-\d{4,5}$/.test(pota) ? pota : "",
    sota: sotaRefParts(String(callObj.sota || "").toUpperCase()) ? String(callObj.sota).toUpperCase() : "",
    grid: /^[A-R]{2}[0-9]{2}([A-X]{2})?$/.test(grid) ? grid : "",
    at: Date.now()
  };
}

// A feed spot clicked (workFeedCallObj, rtsn.js: the Feed Roster's call, a DX Feeds or SOTA marker): remembered, with Log QSO on. What
// the click does is the same as ever
function logQsoRememberSpot(callObj)
{
  if (!logQsoOn() || !callObj) return;
  GT.logQsoLastSpot = logQsoSpotOf(callObj);
}

// From the decoder's window: the last spot clicked (a copy), else null
function logQsoLastSpot()
{
  return GT.logQsoLastSpot ? Object.assign({}, GT.logQsoLastSpot) : null;
}

// From the decoder's window: the park of the newest Feed Roster spot of a call on a band ("" none), for sendToLogger's options.potaRef
// (it takes no POTA_REF from the record: adif.js), as the N3FJP Contest Log's QSOs get theirs (n3fjpContestSpotOf)
function logQsoSpotPark(call, band)
{
  const spot = n3fjpContestSpotOf(String(call || "").toUpperCase(), String(band || ""));
  const pota = spot ? String(spot.pota || "") : "";
  return /^[A-Z0-9]{1,4}-\d{4,5}$/.test(pota) ? pota : "";
}

// From the decoder's window: a QSO with a call on a band in a mode (as GridTracker files it: logQsoWorkedMode) already in GridTracker's
// log today (UTC). Read only
function logQsoWorkedToday(call, band, mode)
{
  call = String(call || "").toUpperCase();
  band = String(band || "").toLowerCase();
  mode = String(mode || "").toUpperCase();
  const today = Math.floor(Date.now() / 86400000);
  for (const hash in GT.QSOhash)
  {
    const qso = GT.QSOhash[hash];
    if (!qso || String(qso.DEcall || "").toUpperCase() != call) continue;
    if (String(qso.band || "").toLowerCase() != band || String(qso.mode || "").toUpperCase() != mode) continue;
    if (Math.floor(Number(qso.time) / 86400) == today) return true;
  }
  return false;
}

// The Feed Roster's right-click on a call: Log QSO... is there with Log QSO on
function logQsoFeedAvailable()
{
  return logQsoOn();
}

// The Feed Roster's Log QSO... on a spot (its hash), or its POTA / SOTA column's click (force: with Log QSO's buttons off too):
// remembered as the last spot clicked, and the Log QSO window shown with the form filled in from it (its park's and summit's fields
// with them). Nothing is sent to the rig or to a logger
function logQsoFromFeedSpot(hash, force = false)
{
  if ((!logQsoOn() && force !== true) || !(hash in GT.feedRoster)) return;
  const spot = logQsoSpotOf(GT.feedRoster[hash].callObj);
  GT.logQsoLastSpot = spot;
  logQsoShow(logQsoPhoneRequest(spot, true), force);
}
