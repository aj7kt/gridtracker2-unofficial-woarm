// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Log QSO window (gt_logqso.html; Settings -> Logging, Log QSO: adifLog.logQso, off unless turned on): a card to log one QSO, handed
// to the main window (logQsoLog in logQso.js), which logs it as every QSO GridTracker logs is (adif.js sendToLogger: GridTracker's own
// log, the backup log at once, every logger and service in Settings -> Logging, or the queue with Queue QSOs To Send Later on).
// GridTracker stays a log viewer: nothing here edits or deletes a QSO already logged, keeps a dupe sheet or tracks QSLs.
// The main window opens it and says what to fill it in with (logQsoWinFill): its button in the button panel and F2 (the rig), the Feed
// Roster's Log QSO... and its POTA / SOTA columns (a spot), the Multi-Mode Decoder (what it heard).
// The card: the call large on top, centered, chips under it (the band and mode in their colors, UTC, "already worked today", the
// queue), the VFO menu and the lock beside it; then the views' tabs (QSO, My Station) over their tiles, one for each field, a label over
// its box. While it shows, the rig is followed (lqRigTick). Unlocked (the lock, or the right-click menu), the tiles are dragged to new
// places, and fields are added (the right-click menu's Add Fields: the view's ADIF fields by kind) or taken off again (an added one's
// x); the layouts are kept (adifLog.logQsoLayout, logQsoLayouts), and so is what My Station's fields hold, as it's typed, and a few of
// the QSO's (adifLog.logQsoSticky). A spot's park or summit shows its POTA_REF / SOTA_REF tile for that QSO even when the layout
// has none. Enter logs; Cancel and the window's X close it (nothing is logged); Escape only locks an unlocked card, it never closes the
// window. All times UTC (logQsoCore.js)

// The fields every QSO has, in their tiles' default order (a tile's id; span: columns it takes)
const LQ_CORE = {
  timeOn: { label: "logQso.timeOn.label", span: 2 },
  timeOff: { label: "logQso.timeOff.label", span: 2 },
  freq: { label: "sotaLog.freq", span: 1 },
  band: { label: "gt.qsoPage.Band", span: 1 },
  mode: { label: "stats.sotaExport.mode", span: 1 },
  rst: { label: "sotaLog.rst", span: 1 },
  grid: { label: "gt.callsignBox.Grid", span: 1 },
  name: { label: "gt.callsignBox.Name", span: 2 },
  power: { label: "logQso.power.label", span: 1 },
  comment: { label: "stats.sotaExport.comment", span: 2 }
};
// The core fields that can be taken off the card (and added again from Add Fields): Freq (the Band is enough). Its box stays, hidden, so
// the card still follows the rig (Band with it) and the QSO still has the frequency when the rig gave one
const LQ_CORE_OPTIONAL = ["freq"];
// ADIF 3.1.6's fields that can be added (Add Fields), each on one view: My Station's are the station's own (STATION_CALLSIGN,
// OPERATOR, OWNER_CALLSIGN, every MY_ field), QSO's every other a QSO can have, by kind; each tile's id "x:" + its field. Not offered:
// the core tiles' fields, the _INTL ones (ADX only, not ADI), those only read from old files (GUEST_OP, VE_PROV), and those a logging
// program or online logbook keeps itself (the LoTW, eQSL, Club Log, QRZ.com, HRDLog, HamQTH, HAMLOG and DCL upload and QSL ones). What
// each may hold is ADIF's rule for it (logQsoCore.js: LOG_QSO_FIELD_RULES)
const LQ_EXTRA_GROUPS = {
  qso: [
    ["activation", ["POTA_REF", "SOTA_REF", "WWFF_REF", "SIG", "SIG_INFO"]],
    ["location", ["DXCC", "COUNTRY", "QTH", "ADDRESS", "STATE", "CNTY", "CNTY_ALT", "USACA_COUNTIES", "CQZ", "ITUZ", "IOTA", "IOTA_ISLAND_ID",
      "CONT", "REGION", "DARC_DOK", "VUCC_GRIDS", "LAT", "LON", "ALTITUDE", "DISTANCE"]],
    ["contest", ["CONTEST_ID", "STX", "SRX", "STX_STRING", "SRX_STRING", "CLASS", "ARRL_SECT", "CHECK", "PRECEDENCE", "PFX"]],
    ["qsl", ["QSL_VIA", "QSLMSG", "QSLMSG_RCVD", "QSL_SENT", "QSL_SENT_VIA", "QSLSDATE", "QSL_RCVD", "QSL_RCVD_VIA", "QSLRDATE",
      "AWARD_SUBMITTED", "AWARD_GRANTED", "CREDIT_SUBMITTED", "CREDIT_GRANTED"]],
    ["contacted", ["CONTACTED_OP", "EQ_CALL", "EMAIL", "WEB", "AGE", "RIG", "RX_PWR", "MORSE_KEY_TYPE", "MORSE_KEY_INFO", "FISTS", "FISTS_CC",
      "SKCC", "TEN_TEN", "UKSMG"]],
    ["propagation", ["PROP_MODE", "ANT_AZ", "ANT_EL", "ANT_PATH", "FREQ_RX", "BAND_RX", "SAT_NAME", "SAT_MODE", "MS_SHOWER", "NR_BURSTS",
      "NR_PINGS", "MAX_BURSTS", "FORCE_INIT", "A_INDEX", "K_INDEX", "SFI"]],
    ["other", ["NOTES", "QSO_COMPLETE", "QSO_RANDOM", "SWL", "PUBLIC_KEY"]]
  ],
  station: [
    ["operator", ["STATION_CALLSIGN", "OPERATOR", "OWNER_CALLSIGN", "MY_NAME", "MY_RIG", "MY_ANTENNA", "MY_MORSE_KEY_TYPE", "MY_MORSE_KEY_INFO",
      "MY_FISTS"]],
    ["location", ["MY_GRIDSQUARE", "MY_VUCC_GRIDS", "MY_LAT", "MY_LON", "MY_ALTITUDE", "MY_STREET", "MY_CITY", "MY_POSTAL_CODE", "MY_STATE",
      "MY_CNTY", "MY_CNTY_ALT", "MY_USACA_COUNTIES", "MY_DXCC", "MY_COUNTRY", "MY_CQ_ZONE", "MY_ITU_ZONE", "MY_IOTA", "MY_IOTA_ISLAND_ID",
      "MY_ARRL_SECT", "MY_DARC_DOK"]],
    ["activation", ["MY_POTA_REF", "MY_SOTA_REF", "MY_WWFF_REF", "MY_SIG", "MY_SIG_INFO"]]
  ]
};
// Kept in capitals; two columns wide
const LQ_UPPER = new Set(["POTA_REF", "SOTA_REF", "WWFF_REF", "SIG", "SIG_INFO", "STATE", "IOTA", "CONT", "REGION", "DARC_DOK", "VUCC_GRIDS",
  "LAT", "LON", "CLASS", "ARRL_SECT", "CHECK", "PRECEDENCE", "PFX", "QSL_VIA", "QSL_SENT", "QSL_SENT_VIA", "QSL_RCVD", "QSL_RCVD_VIA",
  "AWARD_SUBMITTED", "AWARD_GRANTED", "CREDIT_SUBMITTED", "CREDIT_GRANTED", "CONTACTED_OP", "EQ_CALL", "MORSE_KEY_TYPE", "SKCC",
  "PROP_MODE", "ANT_PATH", "SAT_NAME", "SAT_MODE", "FORCE_INIT", "QSO_COMPLETE", "QSO_RANDOM", "SWL", "STATION_CALLSIGN", "OPERATOR",
  "OWNER_CALLSIGN", "MY_MORSE_KEY_TYPE", "MY_GRIDSQUARE", "MY_VUCC_GRIDS", "MY_LAT", "MY_LON", "MY_STATE", "MY_IOTA", "MY_ARRL_SECT",
  "MY_DARC_DOK", "MY_POTA_REF", "MY_SOTA_REF", "MY_WWFF_REF", "MY_SIG", "MY_SIG_INFO"]);
const LQ_WIDE = new Set(["COUNTRY", "QTH", "ADDRESS", "CNTY_ALT", "USACA_COUNTIES", "CONTEST_ID", "QSLMSG", "QSLMSG_RCVD", "AWARD_SUBMITTED",
  "AWARD_GRANTED", "CREDIT_SUBMITTED", "CREDIT_GRANTED", "EMAIL", "WEB", "RIG", "MORSE_KEY_INFO", "NOTES", "PUBLIC_KEY", "MY_RIG", "MY_ANTENNA",
  "MY_MORSE_KEY_INFO", "MY_STREET", "MY_CNTY_ALT", "MY_USACA_COUNTIES", "MY_COUNTRY"]);
// The QSO's fields with a Retain switch beside their label (adifLog.logQsoRetain, by tile: Power on until it's switched off, the rest
// off): retained, what was logged last starts the next card and clearing the call leaves it (lqRetained). My Station's are always kept,
// as typed (lqKeepStation)
const LQ_RETAIN = ["power", "comment", "x:PROP_MODE", "x:SAT_NAME", "x:SAT_MODE", "x:FREQ_RX"];
const LQ_RETAIN_DEFAULT = ["power"];
const LQ_STICKY_QSO = LQ_RETAIN.map(lqAdif).filter(Boolean);
// Each added field: its view, its kind (its Add Fields menu), upper, span (columns), sticky
const LQ_EXTRA = {};
for (const view in LQ_EXTRA_GROUPS)
{
  for (const [kind, fields] of LQ_EXTRA_GROUPS[view])
  {
    for (const adif of fields)
    {
      LQ_EXTRA[adif] = { view, kind, upper: LQ_UPPER.has(adif), span: LQ_WIDE.has(adif) ? 2 : 1, sticky: view == "station" || LQ_STICKY_QSO.includes(adif) };
    }
  }
}

// A field's label (its tile, the menus): a name for it (logQso.field.<NAME>.label; a MY_ field's the same as the field without MY_, a
// few the core tiles' own)
const LQ_LABEL_KEYS = {
  MY_GRIDSQUARE: "gt.callsignBox.Grid", MY_NAME: "gt.callsignBox.Name", MY_CQ_ZONE: "logQso.field.CQZ.label", MY_ITU_ZONE: "logQso.field.ITUZ.label",
  MY_CITY: "logQso.field.QTH.label", EQ_CALL: "logQso.field.OWNER_CALLSIGN.label", MY_RIG: "logQso.field.MY_RIG.label"
};
function lqLabel(adif)
{
  return I18N(LQ_LABEL_KEYS[adif] || "logQso.field." + adif.replace(/^MY_/, "") + ".label");
}

// The card's two views (the tabs over the tiles: adifLog.logQsoView), each its own tiles: the QSO (every core field is here) and My
// Station (the station's own details, filled in from what GridTracker knows: logQsoStationDefaults in logQso.js). Both views' fields go
// on the QSO logged, whichever one shows. A view's tiles until it's arranged (QSO: the core fields, the call's DXCC entity)
const LQ_VIEWS = ["qso", "station"];
const LQ_VIEW_DEFAULTS = {
  qso: ["band", "mode", "grid", "timeOn", "rst", "name", "timeOff", "power", "comment", "x:POTA_REF", "x:SOTA_REF"],
  station: ["x:STATION_CALLSIGN", "x:MY_GRIDSQUARE", "x:MY_CITY", "x:MY_STATE", "x:MY_CNTY", "x:MY_COUNTRY", "x:MY_DXCC", "x:MY_CQ_ZONE",
    "x:MY_ITU_ZONE", "x:MY_RIG", "x:MY_ANTENNA"]
};
// The card's window until it's resized, and after Reset Layout (CSS px inside the window: main's fitWin; its frame as new in
// src/main/index.js)
const LQ_WIN_DEFAULT = { width: 674, height: 392 };

// prefill: what the form was filled in with (a mode changed takes the new mode's report while the old one's is there); dataFields: the
// added fields this QSO's data brought (a spot's park and summit), shown though the layout has none; drag: the tile being dragged
// settle: the timer until the call counts as typed; looked: the call last looked up
// touched: the ids of the boxes typed in since the card was filled (checked as they're typed: lqCheck)
// station: My Station's details as GridTracker knows them (at the last fill); rig: the timer following the rig, rigHz / rigMode: what it
// read last (the card follows a change in it, not the reading itself: a spot's frequency stays until the rig is tuned)
const LOGQSO = {
  prefill: null, dataFields: [], drag: null, clock: null, settle: null, looked: "", touched: new Set(), station: {}, rig: null, rigHz: 0,
  rigMode: "", trackRig: false, inbound: false, callEmpty: true, widths: false, arrange: false, resizable: null, seen: false, saveSoon: null
};
// (widths: the right-click menu's Unlock Widths is on, until Lock Widths or Escape: each tile shows its 1x / 2x buttons, lqSetWidth;
// the widths picked are kept, adifLog.logQsoWidths. arrange: Unlock Fields is on, lqArranging. Both only while the master lock is open:
// lqLocked. resizable: what the window was last told, lqBuild)
// (inbound: the card came with a call, from a spot or the decoder: its fields stay when the call is typed over; callEmpty: the call box
// is empty, the next key starting a call)
// How often the rig is read while the card shows (ms)
const LQ_RIG_MS = 500;

function lqAdif(id)
{
  return id.startsWith("x:") ? id.slice(2) : null;
}

function lqView()
{
  return LQ_VIEWS.includes(GT.settings.adifLog.logQsoView) ? GT.settings.adifLog.logQsoView : "qso";
}

// A view's layout as kept (QSO's in adifLog.logQsoLayout, [] never arranged; My Station's in adifLog.logQsoLayouts), null when it was
// never arranged
function lqSaved(view)
{
  if (view == "qso") return Array.isArray(GT.settings.adifLog.logQsoLayout) && GT.settings.adifLog.logQsoLayout.length ? GT.settings.adifLog.logQsoLayout : null;
  const all = GT.settings.adifLog.logQsoLayouts;
  return all && typeof all == "object" && Array.isArray(all[view]) ? all[view] : null;
}

function lqSetSaved(view, order)
{
  if (view == "qso") GT.settings.adifLog.logQsoLayout = order || [];
  else
  {
    if (!GT.settings.adifLog.logQsoLayouts || typeof GT.settings.adifLog.logQsoLayouts != "object") GT.settings.adifLog.logQsoLayouts = {};
    if (order) GT.settings.adifLog.logQsoLayouts[view] = order;
    else delete GT.settings.adifLog.logQsoLayouts[view];
  }
  lqSaveSettings();
}

// The card's arrangement changed (a layout, a tile's width, the 1x width): GridTracker's settings written now (the main window's
// saveGridTrackerSettings: only when they differ from the file), not only when it closes
function lqSaveSettings()
{
  try
  {
    window.opener.saveGridTrackerSettings();
  }
  catch (e)
  {
    console.error(e);
  }
}

// A tile's view: the core fields' QSO, an added field's its own (LQ_EXTRA)
function lqViewOf(id)
{
  const extra = LQ_EXTRA[lqAdif(id)];
  return extra ? extra.view : "qso";
}

// A view's tiles in order: its known ones, each on its own view only; QSO's has every core field (one that's missing goes after the one
// before it)
function lqLayout(view = "qso")
{
  const list = lqSaved(view) || LQ_VIEW_DEFAULTS[view];
  const out = list.filter((id, i) => list.indexOf(id) == i && (id in LQ_CORE ? view == "qso" : !!LQ_EXTRA[lqAdif(id)] && lqViewOf(id) == view));
  // (a core field a kept layout doesn't have, one new since: after the core field before it, Band after Freq; not one that can be taken
  // off, LQ_CORE_OPTIONAL)
  if (view == "qso")
  {
    const core = Object.keys(LQ_CORE);
    core.forEach((id, i) =>
    {
      if (out.includes(id) || LQ_CORE_OPTIONAL.includes(id)) return;
      const before = core.slice(0, i).reverse().find((c) => out.includes(c));
      out.splice(before ? out.indexOf(before) + 1 : 0, 0, id);
    });
  }
  return out;
}

// Every view's tiles
function lqAllLaid()
{
  return LQ_VIEWS.flatMap((view) => lqLayout(view));
}

// The master lock (the lock at the top right, adifLog.logQsoLocked): shut, the card can't be arranged (Unlock Fields, Unlock Widths and
// Reset Layout greyed out) and its window can't be resized
function lqLocked()
{
  return GT.settings.adifLog.logQsoLocked !== false;
}

// Unlock Fields is on (the master lock open): the tiles are dragged, their boxes not typed in meanwhile
function lqArranging()
{
  return LOGQSO.arrange && !lqLocked();
}

// A view's tiles on the card: its layout's, and on QSO this QSO's data fields no view has
function lqShown(view = "qso")
{
  const layout = lqLayout(view);
  if (view != "qso") return layout;
  const laid = lqAllLaid();
  return layout.concat(LOGQSO.dataFields.filter((id) => !laid.includes(id)));
}

// ---- The tiles

function lqEscape(text)
{
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// A tile's box (or boxes): the core fields' have the ids the rest of this file reads; an added field's is logQsoX_<FIELD>
function lqControl(id)
{
  const now = `<span class="lqNow" onclick="logQsoWinNow('{W}');" title="${lqEscape(I18N("logQso.now.hover"))}">${lqEscape(I18N("logQso.now.label"))}</span>`;
  switch (id)
  {
    case "timeOn":
    case "timeOff":
    {
      const w = id == "timeOn" ? "On" : "Off";
      return `<div class="lqPair"><input type="text" id="logQsoDate${w}" class="inputTextValue lqInput lqDate" maxlength="10" placeholder="YYYY-MM-DD" />` +
        `<input type="text" id="logQsoTime${w}" class="inputTextValue lqInput lqTime" maxlength="8" placeholder="HH:MM:SS" />${now.replace("{W}", w)}</div>`;
    }
    case "freq":
      return `<input type="text" id="logQsoFreq" class="inputTextValue lqInput" maxlength="14" oninput="logQsoWinBand();" />`;
    // The band: ADIF's, offered (lqBands); it follows the frequency until one is picked
    case "band":
      return `<input type="text" id="logQsoBandBox" class="inputTextValue lqInput" maxlength="6" data-list="lqBands" autocomplete="off" oninput="logQsoWinChips(); logQsoWinHint();" />`;
    case "mode":
      return `<select id="logQsoMode" class="inputTextValue lqInput" onchange="logQsoWinModeChanged(true);"></select>`;
    case "rst":
      return `<div class="lqPair"><input type="text" id="logQsoRstSent" class="inputTextValue lqInput" maxlength="8" /><span class="lqSlash">/</span><input type="text" id="logQsoRstRcvd" class="inputTextValue lqInput" maxlength="8" /></div>`;
    case "grid":
      return `<input type="text" id="logQsoGrid" class="inputTextValue lqInput lqUpper" maxlength="10" oninput="logQsoWinChips();" />`;
    case "name":
      return `<input type="text" id="logQsoName" class="inputTextValue lqInput" maxlength="40" />`;
    case "power":
      return `<input type="text" id="logQsoPower" class="inputTextValue lqInput" maxlength="6" />`;
    case "comment":
      return `<input type="text" id="logQsoComment" class="inputTextValue lqInput" maxlength="120" />`;
  }
  const adif = lqAdif(id);
  const rule = LQ_EXTRA[adif] || {};
  // As long as ADIF's rule lets it be: a grid's 10 characters, a date's (typed with dashes), a location's (or its decimal degrees), an
  // Enumeration's longest value, a zone's 2 digits
  const spec = LOG_QSO_FIELD_RULES[adif] || {};
  let max = 80;
  if (spec.grid || spec.date) max = 10;
  else if (spec.location) max = 14;
  else if (spec.vucc) max = 19;
  else if (spec.band) max = 6;
  else if (spec.choice) max = Math.max(...spec.choice.map((c) => c.length));
  else if (spec.int && spec.max != null) max = Math.max(String(spec.max).length, String(spec.min || 0).length);
  // What it offers (lqMakeLists, the card's own drop-down: lqDropOpen): an Enumeration's values, the DXCC entities, the states; a county's
  // box the counties of the state beside it (lqCountyList)
  const listId = adif == "STATE" || adif == "MY_STATE" ? "lqStates_" + adif : adif == "CNTY" || adif == "MY_CNTY" ? "lqCounties_" + adif :
    LQ_SEARCH_FIELDS.includes(adif) ? "lqSearch_" + adif : "lqList_" + adif;
  const list = listId in LQ_LISTS ? ` data-list="${listId}" autocomplete="off"` : "";
  return `<input type="text" id="logQsoX_${adif}" class="inputTextValue lqInput${rule.upper ? " lqUpper" : ""}" maxlength="${max}"${list} />`;
}

// ---- Suggestion lists: drawn in the card (not the browser's own lists, which run off the window's edge), as tall as the room above or
// below the box allows, scrolling

// Each list: [value, label] pairs (made at load: lqMakeLists; a county box's as its state changes: lqCountyList)
const LQ_LISTS = {};
// The open list: its box, its element, the values shown, the one picked with the arrow keys
const LQ_DROP = { input: null, el: null, items: [], hot: -1, picking: false };
const LQ_DROP_MAX = 260;

// The suggestion lists: ADIF's Enumerations (logQsoCore.js: with ADIF's descriptions where it has them, LOG_QSO_CHOICE_NAMES) and the
// values a field is offered (CONTEST_ID), the DXCC entities by number and by name (DXCC, MY_DXCC, COUNTRY, MY_COUNTRY), the bands (BAND,
// BAND_RX), the states and provinces GridTracker knows (STATE, MY_STATE: its state list, each with its name), and an empty one for each
// county box
function lqMakeLists()
{
  for (const adif in LOG_QSO_FIELD_RULES)
  {
    const rule = LOG_QSO_FIELD_RULES[adif];
    const names = LOG_QSO_CHOICE_NAMES[adif] || {};
    if (rule.choice || rule.suggest) LQ_LISTS["lqList_" + adif] = (rule.choice || rule.suggest).map((v) => [v, names[v] || ""]);
  }
  const names = GT.dxccToADIFName || {};
  const dxcc = Object.keys(names).filter((k) => Number(k) > 0 && names[k]).sort((a, b) => Number(a) - Number(b));
  LQ_LISTS.lqList_MY_DXCC = LQ_LISTS.lqList_DXCC = dxcc.map((k) => [k, names[k]]);
  LQ_LISTS.lqList_MY_COUNTRY = LQ_LISTS.lqList_COUNTRY = [...new Set(dxcc.map((k) => names[k]))].sort().map((n) => [n, ""]);
  LQ_LISTS.lqList_BAND_RX = LQ_LISTS.lqBands = LOG_QSO_BANDS.map(([band, lo, hi]) => [band, `${lo} - ${hi} MHz`]);
  LQ_LISTS.lqStates_STATE = [];
  LQ_LISTS.lqStates_MY_STATE = [];
  LQ_LISTS.lqCounties_CNTY = [];
  LQ_LISTS.lqCounties_MY_CNTY = [];
  // (the parks and summits: searched as they're typed, lqSearchItems)
  for (const adif of LQ_SEARCH_FIELDS) LQ_LISTS["lqSearch_" + adif] = [];
  LQ_DROP.el = document.createElement("div");
  LQ_DROP.el.className = "lqDrop";
  LQ_DROP.el.style.display = "none";
  // (a press on it keeps the box's focus; the click picks)
  LQ_DROP.el.addEventListener("mousedown", (event) => event.preventDefault());
  LQ_DROP.el.addEventListener("click", (event) =>
  {
    const item = event.target.closest ? event.target.closest(".lqDropItem") : null;
    if (item) lqDropPick(Number(item.dataset.i));
  });
  document.body.appendChild(LQ_DROP.el);
  lqBox.addEventListener("scroll", lqDropClose);
  window.addEventListener("resize", lqDropClose);
}

// A state box's list: the states GridTracker knows of the DXCC entity there is (STATE: the DXCC box's, else the call's; MY_STATE:
// MY_DXCC's, else the station's own), each with its name; every one when no entity is known, none for an entity it has no states of
function lqStateList(adif)
{
  const mine = adif == "MY_STATE";
  const box = document.getElementById("logQsoX_" + (mine ? "MY_DXCC" : "DXCC"));
  let dxcc = box && /^\d+$/.test(box.value.trim()) ? Number(box.value.trim()) : 0;
  if (!dxcc)
  {
    try
    {
      const call = String(logQsoCall.value || "").toUpperCase().trim();
      dxcc = mine ? Number(GT.myDXCC) : logQsoCallRegexp().test(call) ? Number(window.opener.callsignToDxcc(call)) : 0;
    }
    catch (e)
    {
      dxcc = 0;
    }
  }
  const states = GT.StateData || {};
  const keys = Object.keys(states).filter((k) => /^[A-Z0-9]+-[A-Z0-9]+$/.test(k) && (dxcc <= 0 || Number(states[k].dxcc) == dxcc));
  LQ_LISTS["lqStates_" + adif] = keys.map((k) => [k.split("-")[1], states[k].name || ""]).sort((a, b) => a[0].localeCompare(b[0]));
}

// A county box (CNTY, MY_CNTY) shows a U.S. county by its name alone ("Linn"); the QSO still has it as ADIF does, "OR,Linn": the state
// from the state box beside it (STATE, MY_STATE), else the one the county came with (its data-state). Anything else (a county not in
// GridTracker's list, another country's subdivision) shows and logs as it is
function lqCountyStateBox(input)
{
  return document.getElementById("logQsoX_" + (input.id == "logQsoX_MY_CNTY" ? "MY_STATE" : "STATE"));
}

// What a county box stands for, as ADIF writes it ("OR,Linn"; typed with its state, as it is)
function lqCountyFull(input)
{
  const value = String(input.value || "").trim();
  if (!value || value.includes(",")) return value;
  const stateBox = lqCountyStateBox(input);
  const state = String((stateBox && stateBox.value.trim()) || input.dataset.state || "").toUpperCase();
  return state ? state + "," + value : value;
}

// A county put in a box: a U.S. one as its name (its state kept beside it), anything else as it is
function lqSetCounty(input, full)
{
  const text = String(full || "").trim();
  const key = text.toUpperCase().replace(/\s*,\s*/, ",").replaceAll(" ", "");
  if (key.includes(",") && GT.cntyToCounty && key in GT.cntyToCounty)
  {
    input.dataset.state = key.split(",")[0];
    input.value = GT.cntyToCounty[key];
    return;
  }
  input.dataset.state = "";
  input.value = text;
}

// A county box's list: the counties of the state in the state box beside it (STATE for CNTY, MY_STATE for MY_CNTY), else of the state
// typed before its comma, written as ADIF has them ("OR,Linn": GridTracker's county list, counties.json) and shown by their names
function lqCountyList(adif)
{
  const box = document.getElementById("logQsoX_" + adif);
  if (!box) return;
  const stateBox = lqCountyStateBox(box);
  const typedState = box.value.includes(",") ? box.value.split(",")[0] : box.dataset.state;
  const state = String((stateBox && stateBox.value.trim()) || typedState || "").toUpperCase().trim();
  const id = "lqCounties_" + adif;
  if (LQ_LISTS[id].state == state) return;
  // (each [ADIF's value, no label, the name shown])
  LQ_LISTS[id] = state ? Object.keys(GT.cntyToCounty).filter((k) => k.startsWith(state + ",")).map((k) => [state + "," + GT.cntyToCounty[k], "", GT.cntyToCounty[k]])
    .sort((a, b) => a[2].localeCompare(b[2])) : [];
  LQ_LISTS[id].state = state;
}

// The park and summit fields, searched as they're typed in GridTracker's own lists: POTA's parks with POTA Hunting on (Settings ->
// Features: GT.pota.parks), the SOTA summit list while SOTA Chasing runs (GT.sota.summits). Each list is too long to show whole: from two
// characters, up to LQ_SEARCH_MAX matches, the references starting with what's typed first (in order), then the names holding it.
// MY_POTA_REF is a list of parks: the one after its last comma is searched
const LQ_SEARCH_FIELDS = ["POTA_REF", "MY_POTA_REF", "SOTA_REF", "MY_SOTA_REF"];
const LQ_SEARCH_MAX = 60;

// A list's references and names (in capitals, without accents) as two arrays, made once for each list loaded (POTA's and SOTA's lists
// are refreshed now and then: a new one is indexed again), so each key searches arrays rather than every entry's object
const LQ_SEARCH_INDEX = {};
function lqSearchIndex(kind, book)
{
  const kept = LQ_SEARCH_INDEX[kind];
  if (kept && kept.book === book) return kept;
  const refs = Object.keys(book).filter((ref) => ref != "?-????");
  const names = refs.map((ref) => String(book[ref].name || "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, ""));
  LQ_SEARCH_INDEX[kind] = { book, refs, names };
  return LQ_SEARCH_INDEX[kind];
}

// What's searched for in a park or summit box (MY_POTA_REF: the park after its last comma)
function lqSearchTyped(input)
{
  const value = String(input.value || "");
  return (input.id == "logQsoX_MY_POTA_REF" ? value.split(",").pop() : value).trim().toUpperCase();
}

function lqSearchItems(adif, typed)
{
  if (typed.length < 2) return [];
  const pota = adif.endsWith("POTA_REF");
  let book = null;
  try
  {
    if (pota) book = GT.settings.app.potaFeatureEnabled && GT.pota && GT.pota.parks;
    else book = window.opener.sotaActive() && GT.sota && GT.sota.count > 0 && GT.sota.summits;
  }
  catch (e)
  {
    console.error(e);
  }
  if (!book) return [];
  const index = lqSearchIndex(pota ? "pota" : "sota", book);
  const refs = [];
  const names = [];
  // (what's typed matched as the names are kept, without accents: "meridionales" finds "Méridionales")
  const plain = typed.normalize("NFD").replace(/[̀-ͯ]/g, "");
  for (let i = 0; i < index.refs.length; i++)
  {
    const ref = index.refs[i];
    if (ref.startsWith(typed))
    {
      refs.push(ref);
      if (refs.length >= LQ_SEARCH_MAX) break;
    }
    else if (names.length < LQ_SEARCH_MAX && index.names[i].includes(plain)) names.push(ref);
  }
  refs.sort();
  const label = (ref) =>
  {
    const e = book[ref];
    const where = pota ? e.locationDesc : e.region;
    return String(e.name || "") + (where ? " - " + where : "");
  };
  return refs.concat(names).slice(0, LQ_SEARCH_MAX).map((ref) => [ref, label(ref)]);
}

// A box's list opened under it (above it when there's more room there), its height what fits in the window. all: every value (the box
// just given the keys or clicked); else those matching what's typed (the value or its label containing it). A park or summit box: what
// matches what's typed in its list (lqSearchItems)
function lqDropOpen(input, all = false)
{
  const values = LQ_LISTS[input.dataset.list] || [];
  const search = input.dataset.list.startsWith("lqSearch_");
  const typed = search ? lqSearchTyped(input) : String(input.value || "").trim().toUpperCase();
  // (an item: [its value, its label, what's shown for its value when that isn't the value itself: a county's name])
  const shown = (item) => item[2] || item[0];
  const same = (item) => item[0].toUpperCase() == typed || shown(item).toUpperCase() == typed;
  const exact = values.some(same);
  if (search) LQ_DROP.items = lqSearchItems(input.id.slice(8), typed);
  else LQ_DROP.items = all || !typed || exact ? values : values.filter((item) => shown(item).toUpperCase().includes(typed) || item[0].toUpperCase().includes(typed) || item[1].toUpperCase().includes(typed));
  LQ_DROP.input = input;
  if (!LQ_DROP.items.length)
  {
    LQ_DROP.el.style.display = "none";
    return;
  }
  LQ_DROP.hot = LQ_DROP.items.findIndex(same);
  LQ_DROP.el.innerHTML = LQ_DROP.items.map((item, i) => `<div class="lqDropItem${i == LQ_DROP.hot ? " lqHot" : ""}" data-i="${i}">` +
    `<span class="lqDropValue">${lqEscape(shown(item))}</span>${item[1] ? `<span class="lqDropLabel">${lqEscape(item[1])}</span>` : ""}</div>`).join("");
  const box = input.getBoundingClientRect();
  const below = window.innerHeight - box.bottom - 6;
  const above = box.top - 6;
  const down = below >= Math.min(LQ_DROP_MAX, 150) || below >= above;
  const room = Math.max(60, Math.min(LQ_DROP_MAX, down ? below : above));
  const style = LQ_DROP.el.style;
  style.display = "";
  // Measured first, then placed (as the map's tooltips are, mouseMoveDataItem): its left edge at the box's while all of it fits; else
  // its right edge at the box's; else as far right as the window lets it; never past either edge (a park's or summit's long name is cut
  // short with an ellipsis rather than the list running off the window)
  const edge = 4;
  style.left = "0px";
  style.minWidth = Math.min(box.width, window.innerWidth - 2 * edge) + "px";
  style.maxWidth = window.innerWidth - 2 * edge + "px";
  style.maxHeight = room + "px";
  const width = LQ_DROP.el.offsetWidth;
  let left = box.left;
  if (left + width > window.innerWidth - edge) left = box.right - width;
  if (left < edge) left = window.innerWidth - edge - width;
  style.left = Math.max(edge, left) + "px";
  const height = Math.min(room, LQ_DROP.el.scrollHeight + 2);
  style.top = (down ? box.bottom + 2 : box.top - 2 - height) + "px";
  LQ_DROP.el.scrollTop = 0;
  lqDropReveal();
}

// The list scrolled (itself only: nothing else moves) so its picked value shows
function lqDropReveal()
{
  const item = LQ_DROP.hot >= 0 ? LQ_DROP.el.children[LQ_DROP.hot] : null;
  if (!item) return;
  const list = LQ_DROP.el;
  if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop;
  else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
}

function lqDropClose()
{
  if (!LQ_DROP.el) return;
  LQ_DROP.el.style.display = "none";
  LQ_DROP.input = null;
  LQ_DROP.hot = -1;
}

function lqDropShown()
{
  return !!(LQ_DROP.el && LQ_DROP.input && LQ_DROP.el.style.display != "none");
}

// A value picked: into its box (as typed: checked, the county list following a state), the list closed
function lqDropPick(i)
{
  const input = LQ_DROP.input;
  if (!input || !LQ_DROP.items[i]) return;
  // (MY_POTA_REF, a list of parks: the one picked takes the place of the one being typed, after the last comma)
  if (input.id == "logQsoX_MY_POTA_REF" && input.value.includes(","))
  {
    const parts = input.value.split(",").map((p) => p.trim());
    parts[parts.length - 1] = LQ_DROP.items[i][0];
    input.value = parts.join(",");
  }
  // (a county: its name shown, its state kept: lqSetCounty)
  else if (input.id == "logQsoX_CNTY" || input.id == "logQsoX_MY_CNTY") lqSetCounty(input, LQ_DROP.items[i][0]);
  else input.value = LQ_DROP.items[i][0];
  lqDropClose();
  LQ_DROP.picking = true;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  LQ_DROP.picking = false;
}

// The arrow keys move through the open list, Enter picks, Escape closes it (true: the key was the list's)
function lqDropKey(event)
{
  if (!lqDropShown()) return false;
  const count = LQ_DROP.items.length;
  if (event.key == "ArrowDown" || event.key == "ArrowUp")
  {
    const down = event.key == "ArrowDown";
    LQ_DROP.hot = LQ_DROP.hot < 0 ? (down ? 0 : count - 1) : (LQ_DROP.hot + (down ? 1 : -1) + count) % count;
    for (const el of LQ_DROP.el.querySelectorAll(".lqHot")) el.classList.remove("lqHot");
    LQ_DROP.el.children[LQ_DROP.hot].classList.add("lqHot");
    lqDropReveal();
    return true;
  }
  if (event.key == "Enter" && LQ_DROP.hot >= 0)
  {
    lqDropPick(LQ_DROP.hot);
    return true;
  }
  if (event.key == "Escape" || event.key == "Enter")
  {
    lqDropClose();
    // (a park or summit box's search closed: what's in it checked now)
    lqCheck();
    return event.key == "Escape";
  }
  if (event.key == "Tab") lqDropClose();
  return false;
}

// The ADIF fields each core tile writes (an added tile's is its own; a grid's 9th and 10th characters go in its _EXT field)
const LQ_ADIF_NAMES = {
  call: "CALL", timeOn: "QSO_DATE, TIME_ON", timeOff: "QSO_DATE_OFF, TIME_OFF", freq: "FREQ", band: "BAND", mode: "MODE, SUBMODE", rst: "RST_SENT, RST_RCVD",
  grid: "GRIDSQUARE, GRIDSQUARE_EXT", name: "NAME", power: "TX_PWR", comment: "COMMENT", MY_GRIDSQUARE: "MY_GRIDSQUARE, MY_GRIDSQUARE_EXT"
};

// A tile's tooltip (escaped for an attribute): the ADIF fields it writes, then what ADIF says of them (logQso.adif.<field>.hover)
function lqTip(id)
{
  const key = lqAdif(id) || id;
  return lqEscape(`${LQ_ADIF_NAMES[key] || key}\n${I18N("logQso.adif." + key + ".hover")}`).replace(/\n/g, "&#10;");
}

// The card's tiles built again (the layout changed, a field added or taken off, another view): every view's (each in its own grid, the
// one shown's alone showing: every view's boxes are on the QSO logged), what's typed in them kept
function lqBuild()
{
  lqDropClose();
  const values = {};
  for (const input of lqTiles.querySelectorAll("input, select")) values[input.id] = input.value;
  const modeOptions = typeof logQsoMode != "undefined" ? [...logQsoMode.options].map((o) => [o.text, o.value]) : null;
  const locked = lqLocked();
  const arranging = lqArranging();
  const sizing = LOGQSO.widths && !locked;
  const shown = lqView();
  const laid = lqAllLaid();
  const widthTip = lqEscape(I18N("logQso.width.hover"));
  const retainTip = lqEscape(I18N("logQso.retain.hover"));
  const tile = (id) =>
  {
    const core = LQ_CORE[id];
    const adif = lqAdif(id);
    const span = lqSpan(id);
    const label = lqEscape(core ? (id == "timeOn" || id == "timeOff" ? lqTimeLabel(I18N(core.label)) : I18N(core.label)) : lqLabel(adif));
    // (an added field's x, and Freq's: only while the master lock is open)
    const removable = !core || LQ_CORE_OPTIONAL.includes(id);
    const remove = !removable || locked ? "" : `<span class="lqRemove" onclick="logQsoWinRemove('${id}');">✕</span>`;
    // (Unlock Widths: its 1x and 2x buttons, the one it is lit)
    const widths = sizing ? `<span class="lqWidths" title="${widthTip}">` +
      [1, 2].map((n) => `<span class="lqWidthBtn${n == span ? " lqOn" : ""}" onclick="lqSetWidth('${id}', ${n});">${n}×</span>`).join("") + "</span>" : "";
    // (a Retain switch beside the label of a tile that has one)
    const retain = LQ_RETAIN.includes(id) ? `<span class="lqRetain${lqRetained(id) ? " lqOn" : ""}" title="${retainTip}" onclick="lqToggleRetain('${id}', event);"></span>` : "";
    const data = LOGQSO.dataFields.includes(id) && !laid.includes(id) ? " lqFromData" : "";
    return `<div class="lqTile${removable ? " lqExtra" : ""}${data}" data-id="${id}" draggable="${arranging ? "true" : "false"}" style="grid-column: span ${span};" title="${lqTip(id)}">` +
      `<div class="lqLabel"><span class="lqGrip">⠿</span><span class="lqLabelText">${label}</span>${retain}${widths}${remove}</div>${lqControl(id)}</div>`;
  };
  // (a core field taken off the card keeps its box, hidden: LQ_CORE_OPTIONAL)
  const qsoTiles = lqShown("qso");
  const hidden = LQ_CORE_OPTIONAL.filter((id) => !qsoTiles.includes(id)).map((id) => lqControl(id)).join("");
  lqTiles.innerHTML = LQ_VIEWS.map((view) => `<div class="lqViewGrid" data-view="${view}"${view == shown ? "" : " style=\"display: none\""}>` +
    lqShown(view).map(tile).join("") + "</div>").join("") + `<div class="lqHiddenBoxes" style="display: none">${hidden}</div>`;
  logQsoViewQso.classList.toggle("lqOn", shown == "qso");
  logQsoViewStation.classList.toggle("lqOn", shown == "station");
  if (modeOptions)
  {
    for (const [text, value] of modeOptions) logQsoMode.add(new Option(text, value));
  }
  for (const id in values)
  {
    const el = document.getElementById(id);
    if (el) el.value = values[id];
  }
  // The band beside the frequency, the chips (drawn from what the boxes hold)
  if (modeOptions) logQsoWinBand();
  document.body.classList.toggle("lqUnlocked", arranging);
  document.body.classList.toggle("lqWidthsOn", sizing);
  lqApplyColWidth();
  logQsoLock.classList.toggle("lqOpen", !locked);
  logQsoLock.innerHTML = lqLockSvg(locked);
  logQsoLock.title = I18N("logQso.lock.hover");
  // The window resized only while the master lock is open
  if (LOGQSO.resizable !== !locked)
  {
    LOGQSO.resizable = !locked;
    electron.ipcRenderer.send("setResizable", "gt_logqso", !locked);
  }
  // The boxes built again keep their red outlines
  if (modeOptions && LOGQSO.touched.size) lqCheck();
}

// ---- Local time: with GridTracker's clock on local time (the time display's click: GT.settings.app.useLocalTime), Time On and Time Off
// show and take local time, labeled with its zone ("Time On (PST)"); the QSO is logged in UTC as ADIF has it (logQsoWinValues hands
// logQsoCore.js UTC, as it always took). A switch while the card shows: its times turned over to the other (lqClockTick)

function lqLocalTime()
{
  return GT.settings.app.useLocalTime == 1;
}

// The local zone's short name, as GridTracker's other local times show it (PST, or GMT+1 where there's no short name)
function lqZoneName()
{
  try
  {
    const part = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).formatToParts(new Date()).find((p) => p.type == "timeZoneName");
    return part ? part.value : "";
  }
  catch (e)
  {
    return "";
  }
}

// A moment as the time boxes show it (local or UTC): { date: 2026-11-11, time: 21:12:33 }
function lqTimeParts(ms, local = lqLocalTime())
{
  if (!local) return logQsoUtcParts(ms);
  const d = new Date(ms);
  return {
    date: d.getFullYear() + "-" + logQsoPad(d.getMonth() + 1) + "-" + logQsoPad(d.getDate()),
    time: logQsoPad(d.getHours()) + ":" + logQsoPad(d.getMinutes()) + ":" + logQsoPad(d.getSeconds())
  };
}

// A time typed in the boxes (local or UTC) as a moment (ms), else null (what logQsoParseUtc takes, read as local time when it is)
function lqParseShown(date, time, local = lqLocalTime())
{
  const ms = logQsoParseUtc(date, time);
  if (ms == null || !local) return ms;
  const d = new Date(ms);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()).getTime();
}

// A time tile's label with the zone its boxes are in ("Time On (UTC)", "Time On (PST)")
function lqTimeLabel(text)
{
  return lqLocalTime() ? text.replace("UTC", lqZoneName() || "UTC") : text;
}

// The time boxes turned over from one way of showing them to the other (the clock switched while the card shows), what can't be read
// left as it is
function lqTimesTurned(fromLocal)
{
  for (const w of ["On", "Off"])
  {
    const date = window["logQsoDate" + w];
    const time = window["logQsoTime" + w];
    const ms = lqParseShown(date.value, time.value, fromLocal);
    if (ms == null) continue;
    const at = lqTimeParts(ms, !fromLocal);
    date.value = at.date;
    time.value = at.time;
  }
}

// A tile's width in columns: the one picked for it (Unlock Widths: adifLog.logQsoWidths), else its own (LQ_CORE, LQ_EXTRA)
function lqSpan(id)
{
  const picked = GT.settings.adifLog.logQsoWidths && GT.settings.adifLog.logQsoWidths[id];
  if (picked == 1 || picked == 2) return picked;
  const core = LQ_CORE[id];
  return core ? core.span : (LQ_EXTRA[lqAdif(id)] && LQ_EXTRA[lqAdif(id)].span) || 1;
}

// The view showing's rows filled out: walking its tiles in order (as many columns as the window fits, 1x or 2x each, lqSpan), a tile too
// wide for what's left of a row goes to the next one and the tile before it widens to the row's end, so no row but the last has a hole
// and the order never changes. After every build, resize, view switch and 1x width change
function lqFitRows()
{
  const grid = lqTiles.querySelector(`.lqViewGrid[data-view="${lqView()}"]`);
  if (!grid) return;
  const cols = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length);
  let used = 0;
  let last = null;
  for (const tile of grid.querySelectorAll(".lqTile"))
  {
    const span = Math.min(cols, lqSpan(tile.dataset.id));
    if (used + span > cols)
    {
      if (last && used < cols) last.el.style.gridColumn = `span ${last.span + cols - used}`;
      used = 0;
    }
    tile.style.gridColumn = `span ${span}`;
    last = { el: tile, span };
    used += span;
    // (a full row: the next tile starts a new one, nothing to widen in this one)
    if (used >= cols)
    {
      used = 0;
      last = null;
    }
  }
}

// A tile's 1x or 2x button: that width kept for it in the settings (its own width again: not kept), the tiles built again. Kept by its
// field, so a field taken off the card and added again comes back at that width
function lqSetWidth(id, n)
{
  if (!GT.settings.adifLog.logQsoWidths || typeof GT.settings.adifLog.logQsoWidths != "object") GT.settings.adifLog.logQsoWidths = {};
  delete GT.settings.adifLog.logQsoWidths[id];
  if (lqSpan(id) != n) GT.settings.adifLog.logQsoWidths[id] = n;
  lqBuild();
  lqSaveSettings();
}

// The 1x column's width (px; the grid fits as many as the window does, stretched to fill it): Unlock Widths' slider
// (adifLog.logQsoColWidth), LQ_COL_DEFAULT until it's moved and after Reset Layout
const LQ_COL_MIN = 115;
const LQ_COL_MAX = 320;
const LQ_COL_DEFAULT = 115;
// (a width kept outside the slider's range, such as one from before its minimum was raised: the nearest end of it)
function lqColWidth()
{
  const w = Number(GT.settings.adifLog.logQsoColWidth);
  return w > 0 ? Math.max(LQ_COL_MIN, Math.min(LQ_COL_MAX, w)) : LQ_COL_DEFAULT;
}

function lqApplyColWidth()
{
  const w = lqColWidth();
  document.documentElement.style.setProperty("--lq-col", w + "px");
  logQsoColWidth.value = w;
  logQsoColWidthValue.textContent = w + " px";
  lqFitRows();
}

// The slider moved: the width kept and shown; let go (done): the settings written
function lqSetColWidth(value, done = false)
{
  GT.settings.adifLog.logQsoColWidth = Math.max(LQ_COL_MIN, Math.min(LQ_COL_MAX, Math.round(Number(value) || LQ_COL_DEFAULT)));
  lqDropClose();
  lqApplyColWidth();
  if (done) lqSaveSettings();
}

// Unlock Widths / Lock Widths (the right-click menu, Escape locks)
function logQsoWinWidthsToggle()
{
  if (lqLocked() && !LOGQSO.widths) return;
  LOGQSO.widths = !LOGQSO.widths;
  lqBuild();
}

// The lock: shut, its shackle down; open, swung up to the right
function lqLockSvg(locked)
{
  const shackle = locked ? "M8 11V8a4 4 0 0 1 8 0v3" : "M8 11V8a4 4 0 0 1 7.6-1.8";
  return `<svg viewBox="0 0 24 24" width="18" height="18"><path d="${shackle}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>` +
    `<rect x="5" y="11" width="14" height="10" rx="2.5" fill="currentColor"/><circle cx="12" cy="16" r="1.6" fill="var(--lq-bg)"/></svg>`;
}

// ---- Filled in, read

// From the main window: the form filled in and its call box given the keys. req: { fields } (filled in already: the decoder's, from
// logQsoCore.js), { phone: { rigMode, dialHz, spot, fromSpot } } (logQsoPrefillPhone's, the time now), or nothing (blank, now)
function logQsoWinFill(req)
{
  const now = Date.now();
  let f = null;
  if (req && req.fields) f = Object.assign(logQsoBlank(now), req.fields);
  else if (req && req.phone) f = logQsoPrefillPhone(Object.assign({ now, opened: now }, req.phone));
  if (!f) f = logQsoBlank(now);
  // No mode from the rig, the spot or the decoder: the last one picked or logged this session (GT.logQsoSessionMode), with its reports
  const session = GT.logQsoSessionMode;
  if (!f.mode && session && session.mode)
  {
    const before = logQsoDefaultRst("SSB");
    f.mode = session.mode;
    f.submode = session.submode || "";
    if (!f.rstSent || f.rstSent == before) f.rstSent = logQsoDefaultRst(f.mode);
    if (!f.rstRcvd || f.rstRcvd == before) f.rstRcvd = logQsoDefaultRst(f.mode);
  }
  LOGQSO.prefill = f;
  // (on screen yet: logQsoWinWaiting; the window shown sets it, the visibilitychange listener in logQsoWinInit)
  LOGQSO.seen = !document.hidden;
  // My Station's details as GridTracker knows them now
  LOGQSO.station = lqStationDefaults();
  // The rig followed from here on (not a decoder's QSO: its frequency is the signal's): a change in what it reads goes on the card
  LOGQSO.trackRig = !(req && req.fields);
  let rigNow = null;
  try
  {
    rigNow = window.opener.logQsoRigRead();
  }
  catch (e)
  {
    console.error(e);
  }
  LOGQSO.rigHz = rigNow && rigNow.up ? rigNow.freq : 0;
  LOGQSO.rigMode = rigNow && rigNow.up ? rigNow.mode : "";
  // A card with no frequency (a blank one) takes the rig's now
  if (LOGQSO.trackRig && !f.freq && rigNow && rigNow.up) f.freq = logQsoMhz(rigNow.freq);
  // The QSO's own park and summit (a spot's) show their fields
  LOGQSO.dataFields = [];
  if (f.potaRef) LOGQSO.dataFields.push("x:POTA_REF");
  if (f.sotaRef) LOGQSO.dataFields.push("x:SOTA_REF");
  lqBuild();
  // (what a spot or the decoder brought made ASCII as typed text is: lqAsciiOnly; its times, UTC, shown in local time when the clock is)
  LOGQSO.local = lqLocalTime();
  for (const w of ["On", "Off"])
  {
    const ms = logQsoParseUtc(f["date" + w], f["time" + w]);
    if (ms == null) continue;
    const at = lqTimeParts(ms);
    f["date" + w] = at.date;
    f["time" + w] = at.time;
  }
  const inputs = logQsoWinInputs();
  for (const key in inputs) inputs[key].value = lqAsciiOnly(f[key]);
  logQsoCall.value = lqAsciiOnly(f.call);
  // Power and Comment retained (their Retain switches): what was logged last, when the card brought none
  if (!f.power && lqRetained("power") && GT.settings.adifLog.logQsoPower) logQsoPower.value = GT.settings.adifLog.logQsoPower;
  if (!f.comment && lqRetained("comment") && lqSticky().COMMENT) logQsoComment.value = lqSticky().COMMENT;
  // Added fields: the station's own as last logged, else as GridTracker knows them (unknown: blank), the QSO's park and summit; the rest
  // empty
  for (const input of lqTiles.querySelectorAll("input[id^='logQsoX_']")) lqPutExtra(input, lqStickyValue(input.id.slice(8)));
  if (f.potaRef && document.getElementById("logQsoX_POTA_REF")) logQsoX_POTA_REF.value = f.potaRef;
  if (f.sotaRef && document.getElementById("logQsoX_SOTA_REF")) logQsoX_SOTA_REF.value = f.sotaRef;
  logQsoWinModes(f.mode, f.submode);
  logQsoWinVfoMenu();
  // A call filled in is looked up at once (a new card looks it up afresh)
  LOGQSO.looked = "";
  logQsoWinLookup();
  LOGQSO.touched.clear();
  LOGQSO.inbound = !!f.call;
  LOGQSO.callEmpty = !f.call;
  lqDxccFromCall();
  for (const el of document.querySelectorAll(".logQsoBad")) el.classList.remove("logQsoBad");
  logQsoError.textContent = "";
  logQsoWinQueued();
  logQsoWinBand();
  // (the call box given the keys, its caret after the call: not selected, so a key doesn't replace it)
  logQsoCall.focus();
  logQsoCall.setSelectionRange(logQsoCall.value.length, logQsoCall.value.length);
}

// My Station's details as GridTracker knows them (logQsoStationDefaults in logQso.js), and the latitude and longitude of the grid's
// center (as its zones are)
function lqStationDefaults()
{
  let station = {};
  try
  {
    station = window.opener.logQsoStationDefaults() || {};
    if (station.MY_GRIDSQUARE)
    {
      const ll = window.opener.squareToCenter(station.MY_GRIDSQUARE);
      if (ll && isFinite(ll.a) && isFinite(ll.o))
      {
        station.MY_LAT = logQsoLocation(ll.a, true);
        station.MY_LON = logQsoLocation(ll.o, false);
      }
    }
  }
  catch (e)
  {
    console.error(e);
  }
  return station;
}

// The fields kept for the next card (adifLog.logQsoSticky, saved with the settings): My Station's as typed (an emptied one kept empty),
// the QSO's sticky ones (LQ_STICKY_QSO) as last logged
function lqSticky()
{
  if (!GT.settings.adifLog.logQsoSticky || typeof GT.settings.adifLog.logQsoSticky != "object") GT.settings.adifLog.logQsoSticky = {};
  return GT.settings.adifLog.logQsoSticky;
}

// What an added field starts a card with: what was kept of it (lqSticky: My Station's; a QSO field's only while it's retained), else My
// Station's detail as GridTracker knows it (LOGQSO.station); "" for the rest, and for what isn't known
// An added field's box given a value (ASCII only: lqAsciiOnly; a county shown by its name: lqSetCounty)
function lqPutExtra(input, value)
{
  const text = lqAsciiOnly(value);
  if (input.id == "logQsoX_CNTY" || input.id == "logQsoX_MY_CNTY") lqSetCounty(input, text);
  else input.value = text;
}

function lqStickyValue(adif)
{
  const sticky = lqSticky();
  const extra = LQ_EXTRA[adif];
  // (Serial Sent: the next serial, one after the last one logged, lqNextSerial)
  if (adif == "STX" && "STX" in sticky) return String(sticky.STX);
  if (extra && extra.sticky && adif in sticky && (extra.view == "station" || lqRetained("x:" + adif))) return String(sticky[adif]);
  return LOGQSO.station[adif] ? String(LOGQSO.station[adif]) : "";
}

// A tile's Retain switch on (LQ_RETAIN; adifLog.logQsoRetain, else its default)
function lqRetained(id)
{
  const saved = GT.settings.adifLog.logQsoRetain;
  if (saved && typeof saved == "object" && typeof saved[id] == "boolean") return saved[id];
  return LQ_RETAIN_DEFAULT.includes(id);
}

// The box a retained tile holds (Power, Comment, an added field's)
function lqRetainBox(id)
{
  return id == "power" ? logQsoPower : id == "comment" ? logQsoComment : document.getElementById("logQsoX_" + lqAdif(id));
}

// The Retain tile a box belongs to (LQ_RETAIN), or null
function lqRetainIdOf(el)
{
  const id = el.id == "logQsoPower" ? "power" : el.id == "logQsoComment" ? "comment" : el.id.startsWith("logQsoX_") ? "x:" + el.id.slice(8) : "";
  return LQ_RETAIN.includes(id) ? id : null;
}

// The settings written a moment after the last key (what's kept as it's typed: retained tiles, My Station), not on every key
const LQ_KEEP_SAVE_MS = 1500;
function lqSaveSoon()
{
  nodeTimers.clearTimeout(LOGQSO.saveSoon);
  LOGQSO.saveSoon = nodeTimers.setTimeout(lqSaveSettings, LQ_KEEP_SAVE_MS);
}

// What's kept of a retained tile for the next card, as it's typed and as it's logged: Power's in adifLog.logQsoPower (as it always was),
// the rest in lqSticky (Comment as COMMENT); not retained: nothing kept (Power's last value stays, unused while it isn't retained)
function lqKeepRetained(id, value)
{
  value = String(value || "").trim();
  if (id == "power")
  {
    if (lqRetained(id)) GT.settings.adifLog.logQsoPower = value;
    return;
  }
  const key = id == "comment" ? "COMMENT" : lqAdif(id);
  const sticky = lqSticky();
  if (value && lqRetained(id)) sticky[key] = value;
  else delete sticky[key];
}

// A Retain switch clicked: switched, kept in the settings (written now); switched on, what the box holds now is kept for the next card
function lqToggleRetain(id, event)
{
  if (event) event.stopPropagation();
  if (!GT.settings.adifLog.logQsoRetain || typeof GT.settings.adifLog.logQsoRetain != "object") GT.settings.adifLog.logQsoRetain = {};
  GT.settings.adifLog.logQsoRetain[id] = !lqRetained(id);
  const box = lqRetainBox(id);
  lqKeepRetained(id, box ? box.value : "");
  for (const el of document.querySelectorAll(`.lqTile[data-id="${id}"] .lqRetain`)) el.classList.toggle("lqOn", lqRetained(id));
  lqSaveSettings();
}

// A My Station box typed in: what it holds kept at once (lqSticky), so every card from then on starts with it, and it's saved with the
// settings when GridTracker closes; the same as what GridTracker knows: not kept, so it follows Settings (a new grid, another rig)
function lqKeepStation(input)
{
  const adif = input.id.slice(8);
  if (!LQ_EXTRA[adif] || LQ_EXTRA[adif].view != "station") return;
  // (a county kept as ADIF has it, "OR,Linn": lqCountyFull)
  let value = adif == "MY_CNTY" ? lqCountyFull(input) : String(input.value || "").trim();
  if (LQ_EXTRA[adif].upper) value = value.toUpperCase();
  const sticky = lqSticky();
  if (value == String(LOGQSO.station[adif] || "")) delete sticky[adif];
  else sticky[adif] = value;
}

// The core fields' boxes, by the field each holds (logQsoCore.js's names)
function logQsoWinInputs()
{
  return {
    call: logQsoCall, dateOn: logQsoDateOn, timeOn: logQsoTimeOn, dateOff: logQsoDateOff, timeOff: logQsoTimeOff, freq: logQsoFreq, band: logQsoBandBox,
    rstSent: logQsoRstSent, rstRcvd: logQsoRstRcvd, grid: logQsoGrid, name: logQsoName, power: logQsoPower, comment: logQsoComment
  };
}

// The Mode menu: its choices (logQsoCore.js), and the one filled in when it isn't among them; Pick One when there's none
function logQsoWinModes(mode, submode)
{
  logQsoMode.replaceChildren();
  logQsoMode.add(new Option(I18N("logQso.mode.pick"), ""));
  const choices = LOG_QSO_MODE_CHOICES.slice();
  if (mode && !choices.some(([m, s]) => m == mode && s == submode)) choices.unshift([mode, submode]);
  for (const [m, s] of choices) logQsoMode.add(new Option(logQsoModeLabel(m, s), m + "|" + s));
  logQsoMode.value = mode ? mode + "|" + submode : "";
}

// The VFO menu (with Rig Control on and a VFO set up): the first connected one, or one picked (adifLog.logQsoVfo, its id)
function logQsoWinVfoMenu()
{
  const O = window.opener;
  const vfos = GT.settings.Rigs && GT.settings.Rigs.enable ? O.rigVfos() : [];
  logQsoVfo.style.display = vfos.length ? "" : "none";
  if (!vfos.length) return;
  logQsoVfo.replaceChildren();
  logQsoVfo.add(new Option(I18N("logQso.vfo.auto"), ""));
  for (const v of vfos) logQsoVfo.add(new Option(O.rigVfoLabel(v), v.id));
  const picked = String(GT.settings.adifLog.logQsoVfo || "");
  logQsoVfo.value = vfos.some((v) => v.id == picked) ? picked : "";
}

// Another VFO picked: kept, and the form's frequency (and a voice mode) taken from it when it reads one, followed from then on; MY_RIG
// as that VFO's rig while it still says the last one's
function logQsoWinVfoChanged()
{
  GT.settings.adifLog.logQsoVfo = logQsoVfo.value;
  const rigBefore = LOGQSO.station.MY_RIG || "";
  LOGQSO.station = lqStationDefaults();
  const myRig = document.getElementById("logQsoX_MY_RIG");
  if (myRig && myRig.value == rigBefore) myRig.value = LOGQSO.station.MY_RIG || "";
  const read = window.opener.logQsoRigRead();
  if (!read.up) return;
  LOGQSO.rigHz = read.freq;
  LOGQSO.rigMode = read.mode;
  LOGQSO.trackRig = true;
  LOGQSO.touched.delete("logQsoFreq");
  logQsoFreq.value = logQsoMhz(read.freq);
  const m = logQsoPhoneMode(read.mode);
  if (m.kind == "voice")
  {
    logQsoWinModes(m.mode, m.submode);
    logQsoWinModeChanged();
  }
  logQsoWinBand();
  lqCheck();
}

// While the card shows, the rig followed: a change in its frequency goes on the card (until Freq is typed in), a change to a voice mode
// in Mode (until another mode is picked). Not a decoder's QSO: its frequency is the signal's
function lqRigTick()
{
  if (document.hidden || !LOGQSO.prefill || !LOGQSO.trackRig) return;
  let read;
  try
  {
    read = window.opener.logQsoRigRead();
  }
  catch (e)
  {
    return;
  }
  if (!read || !read.up) return;
  let changed = false;
  if (read.freq != LOGQSO.rigHz)
  {
    LOGQSO.rigHz = read.freq;
    if (!LOGQSO.touched.has("logQsoFreq"))
    {
      logQsoFreq.value = logQsoMhz(read.freq);
      changed = true;
    }
  }
  if (read.mode != LOGQSO.rigMode)
  {
    LOGQSO.rigMode = read.mode;
    const m = logQsoPhoneMode(read.mode);
    if (m.kind == "voice" && !LOGQSO.touched.has("logQsoMode"))
    {
      logQsoWinModes(m.mode, m.submode);
      logQsoWinModeChanged();
      changed = true;
    }
  }
  if (changed)
  {
    logQsoWinBand();
    lqCheck();
  }
}

// Queue QSOs To Send Later on: a chip saying so, with how many wait
function logQsoWinQueued()
{
  const queued = window.opener.qsoQueueOn();
  logQsoQueued.style.display = queued ? "" : "none";
  if (queued) logQsoQueued.textContent = I18N("logQso.queued.label").replace("{count}", window.opener.qsoQueueCount());
}

// A card on the window not logged or cancelled yet (LOGQSO.prefill: set by each fill, cleared by Cancel and once logged): the main window
// shows it again as it is rather than filling it afresh (logQsoButton)
function logQsoWinWaiting()
{
  // (one that has been on screen: not the blank one the window fills itself with as it loads, still hidden)
  return !!LOGQSO.prefill && LOGQSO.seen === true;
}

// Cancel: the window hidden, nothing logged
function logQsoWinClose()
{
  LOGQSO.prefill = null;
  lqDropClose();
  electron.ipcRenderer.send("hideWin", "gt_logqso");
}

// The core fields' values as typed (logQsoCore.js's fields), the mode and submode from the Mode menu
function logQsoWinValues()
{
  const f = {};
  const inputs = logQsoWinInputs();
  for (const key in inputs) f[key] = inputs[key].value;
  // (times shown in local time handed on in UTC, as logQsoCore.js and ADIF take them; what can't be read is handed on as typed, to be
  // flagged there)
  if (lqLocalTime())
  {
    for (const w of ["On", "Off"])
    {
      const ms = lqParseShown(f["date" + w], f["time" + w]);
      if (ms == null) continue;
      const at = logQsoUtcParts(ms);
      f["date" + w] = at.date;
      f["time" + w] = at.time;
    }
  }
  const [mode, submode] = String(logQsoMode.value || "|").split("|");
  f.mode = mode || "";
  f.submode = submode || "";
  f.potaRef = LOGQSO.prefill ? LOGQSO.prefill.potaRef : "";
  return f;
}

// The frequency typed (or followed from the rig): the Band box follows it (its band, none off ADIF's bands) until a band is picked
// there; the chips, the hint
function logQsoWinBand()
{
  if (!LOGQSO.touched.has("logQsoBandBox"))
  {
    const mhz = Number(String(logQsoFreq.value || "").trim().replace(",", "."));
    logQsoBandBox.value = mhz > 0 ? logQsoBand(mhz * 1e6) : "";
  }
  logQsoWinChips();
  logQsoWinHint();
}

// The QSO's band: the Band box's
function lqBandNow()
{
  return String(logQsoBandBox.value || "").trim().toLowerCase();
}

// The chips beside the tabs: the frequency, the band, the mode (the band and mode each in its color, Settings -> Colors) and the grid,
// only while their own tiles aren't in sight (Freq taken off the card, the My Station tab showing); the grid's bearing and distance always
function logQsoWinChips()
{
  const inSight = (id) => lqView() == "qso" && lqShown("qso").includes(id);
  const band = lqBandNow();
  logQsoBandChip.textContent = band;
  logQsoBandChip.style.display = band && !inSight("band") ? "" : "none";
  // (the frequency in MHz, to the hertz it's known to, at least three places: 7.171, 14.07455)
  const mhz = Number(String(logQsoFreq.value || "").trim().replace(",", "."));
  const freqText = mhz > 0 ? mhz.toFixed(6).replace(/(\.\d{3}\d*?)0+$/, "$1") + " MHz" : "";
  logQsoFreqChip.textContent = freqText;
  logQsoFreqChip.style.display = freqText && !inSight("freq") ? "" : "none";
  const bandColor = band && GT.bandColors ? GT.bandColors[band] : null;
  logQsoBandChip.style.setProperty("--own-color", bandColor ? "#" + bandColor : "");
  const [mode, submode] = String(logQsoMode.value || "|").split("|");
  logQsoModeChip.textContent = mode ? logQsoModeLabel(mode, submode || "") : "";
  logQsoModeChip.style.display = mode && !inSight("mode") ? "" : "none";
  const filed = mode ? logQsoWorkedMode(mode, submode) : "";
  const modeColor = filed && GT.modeColors ? GT.modeColors[filed] || GT.modeColors[mode] : null;
  logQsoModeChip.style.setProperty("--own-color", modeColor ? "#" + modeColor : "");
  const grid = String(logQsoGrid.value || "").trim().toUpperCase();
  logQsoGridChip.textContent = grid;
  logQsoGridChip.style.display = LOG_QSO_GRID_REGEXP.test(grid) && !inSight("grid") ? "" : "none";
  lqPathChips(grid);
}

// The bearing and distance chips: from the station (My Station's grid when it holds a real one, else GridTracker's own position, as the
// map and the rosters use) to the grid's center, the short path; the distance in Settings' Distance Units, as the rest of GridTracker
// shows it
function lqPathChips(grid)
{
  let bearing = "";
  let distance = "";
  try
  {
    if (LOG_QSO_GRID_REGEXP.test(grid))
    {
      const O = window.opener;
      const to = O.squareToCenter(grid);
      const box = document.getElementById("logQsoX_MY_GRIDSQUARE");
      const mine = String((box && box.value) || "").trim().toUpperCase();
      const from = LOG_QSO_GRID_REGEXP.test(mine) ? O.squareToCenter(mine) : { a: GT.myLat, o: GT.myLon };
      // (MyCircle: third-party.js, loaded in this window as in the roster's)
      const unit = O.distanceUnit.value;
      bearing = `${I18N("logQso.chip.bearing.label")} ${parseInt(MyCircle.bearing(from.a, from.o, to.a, to.o))}°`;
      distance = `${I18N("logQso.field.DISTANCE.label")} ${parseInt(MyCircle.distance(from.a, from.o, to.a, to.o) * MyCircle.validateRadius(unit))}${unit.toLowerCase()}`;
    }
  }
  catch (e)
  {
    console.error(e);
  }
  logQsoBearingChip.textContent = bearing;
  logQsoDistanceChip.textContent = distance;
}

// The clock chip, each second while the window shows
function lqClockTick()
{
  // (GridTracker's clock switched between local time and UTC: the card's times and their labels follow)
  const local = lqLocalTime();
  if (LOGQSO.prefill && typeof LOGQSO.local == "boolean" && LOGQSO.local != local && typeof logQsoDateOn != "undefined")
  {
    lqTimesTurned(LOGQSO.local);
    LOGQSO.local = local;
    lqBuild();
  }
  LOGQSO.local = local;
  if (document.hidden) return;
  logQsoUtcChip.textContent = "UTC " + new Date().toISOString().slice(11, 19);
}

// Another mode (picked: from the Mode menu, remembered for this session's next cards, GT.logQsoSessionMode): its reports, while the
// ones there are the last mode's own; the chips, the hint
function logQsoWinModeChanged(picked = false)
{
  const f = logQsoWinValues();
  if (picked && f.mode) GT.logQsoSessionMode = { mode: f.mode, submode: f.submode };
  const before = LOGQSO.prefill ? logQsoDefaultRst(LOGQSO.prefill.mode || "SSB") : "";
  const after = logQsoDefaultRst(f.mode || "SSB");
  if (logQsoRstSent.value == before) logQsoRstSent.value = after;
  if (logQsoRstRcvd.value == before) logQsoRstRcvd.value = after;
  if (LOGQSO.prefill) LOGQSO.prefill.mode = f.mode;
  logQsoMode.classList.remove("logQsoBad");
  logQsoWinChips();
  logQsoWinHint();
}

// Now beside Time On or Time Off: that one set to the time now
function logQsoWinNow(which)
{
  if (lqArranging()) return;
  const at = lqTimeParts(Date.now());
  window["logQsoDate" + which].value = at.date;
  window["logQsoTime" + which].value = at.time;
  lqCheck();
}

// How long after the last key in the call box it counts as settled (ms)
const LQ_SETTLE_MS = 900;

// A key in the call box: the hint, and the lookup once the typing stops
function logQsoWinCallInput()
{
  logQsoWinHint();
  nodeTimers.clearTimeout(LOGQSO.settle);
  LOGQSO.settle = nodeTimers.setTimeout(logQsoWinLookup, LQ_SETTLE_MS);
}

// The call settled (left, a pause in typing, the card filled in with one): looked up by the main window (logQsoLookup: GridTracker's
// lookup service, its cache first); the answer comes back to logQsoWinFromLookup
function logQsoWinLookup()
{
  nodeTimers.clearTimeout(LOGQSO.settle);
  const call = String(logQsoCall.value || "").toUpperCase().trim();
  if (!logQsoCallRegexp().test(call) || call == LOGQSO.looked) return;
  // Another call settled than the one the card had (a Feed Roster spot's or the decoder's call changed, or the last one typed): the card
  // starts over as new for it, as when the call is cleared (lqClearForNextCall), then it's looked up
  if (LOGQSO.looked)
  {
    lqClearForNextCall();
    // (it's the user's card now, not the spot's)
    LOGQSO.inbound = false;
    lqDxccFromCall();
    lqCheck();
  }
  LOGQSO.looked = call;
  window.opener.logQsoLookup(call);
}

// What a lookup says, into the card's fields still empty (only those on the card): its name, grid, and with their fields added, its
// QTH (city), state, county, zones, IOTA, e-mail, QSL route, latitude, longitude and web page. Nothing typed is replaced, but for a grid box holding what isn't a
// grid (and not being typed in): a real grid there (the spot's, the decoder's, one typed) always stands over the lookup's
function logQsoWinFromLookup(lookup)
{
  const call = String(logQsoCall.value || "").toUpperCase().trim();
  if (!lookup || String(lookup.call || "").toUpperCase() != call) return;
  const put = (input, value, upper = false) =>
  {
    if (!input || String(input.value || "").trim() || value == null || value === "") return;
    let text = logQsoAscii(String(value));
    if (!text) return;
    input.value = upper ? text.toUpperCase() : text;
  };
  if (LOG_QSO_GRID_REGEXP.test(String(lookup.grid || "").toUpperCase()))
  {
    const typed = String(logQsoGrid.value || "").trim().toUpperCase();
    if (typed && !LOG_QSO_GRID_REGEXP.test(typed) && document.activeElement != logQsoGrid) logQsoGrid.value = "";
    put(logQsoGrid, lookup.grid, true);
  }
  put(logQsoName, lookup.name);
  const extra = (adif) => document.getElementById("logQsoX_" + adif);
  put(extra("QTH"), lookup.addr2);
  put(extra("STATE"), lookup.state, true);
  // (the county with its state, as ADIF has it: the lookup's own "OR,Linn", else its state and county; shown by its name, lqSetCounty)
  const cntyBox = extra("CNTY");
  if (cntyBox && !cntyBox.value.trim())
  {
    const county = String(lookup.cnty || "").includes(",") ? lookup.cnty : lookup.state && lookup.county ? lookup.state + "," + lookup.county : lookup.county;
    if (county) lqPutExtra(cntyBox, county);
  }
  if (/^\d+$/.test(String(lookup.cqzone || ""))) put(extra("CQZ"), String(Number(lookup.cqzone)));
  if (/^\d+$/.test(String(lookup.ituzone || ""))) put(extra("ITUZ"), String(Number(lookup.ituzone)));
  put(extra("IOTA"), lookup.iota, true);
  put(extra("EMAIL"), lookup.email);
  put(extra("QSL_VIA"), lookup.qsl_via, true);
  // (its latitude and longitude written as ADIF has them)
  if (lookup.lat !== "" && lookup.lon !== "" && isFinite(Number(lookup.lat)) && isFinite(Number(lookup.lon)) && !(Number(lookup.lat) == 0 && Number(lookup.lon) == 0))
  {
    put(extra("LAT"), logQsoParseLocation(String(lookup.lat), true));
    put(extra("LON"), logQsoParseLocation(String(lookup.lon), false));
  }
  put(extra("WEB"), lookup.url);
  logQsoWinChips();
  lqCheck();
}

// The hint chip: the call already in GridTracker's log on this band and mode today (it doesn't stop the QSO being logged)
function logQsoWinHint()
{
  const f = logQsoWinValues();
  const call = String(f.call || "").toUpperCase().trim();
  const band = lqBandNow();
  let text = "";
  if (logQsoCallRegexp().test(call) && band && f.mode && window.opener.logQsoWorkedToday(call, band, logQsoWorkedMode(f.mode, f.submode)))
  {
    text = I18N("logQso.worked.label").replace("{call}", call).replace("{band}", band).replace("{mode}", logQsoModeLabel(f.mode, f.submode));
  }
  if (logQsoHint.textContent != text) logQsoHint.textContent = text;
}

// ---- Arranging: the lock, dragging, adding and taking off fields

// The master lock clicked: shut, Unlock Fields and Unlock Widths end too (the window's size fixed); open, they can be picked
function logQsoWinLockToggle()
{
  GT.settings.adifLog.logQsoLocked = !lqLocked();
  if (lqLocked())
  {
    LOGQSO.arrange = false;
    LOGQSO.widths = false;
  }
  lqBuild();
  lqSaveSettings();
}

// Unlock Fields / Lock Fields (the right-click menu; only with the master lock open)
function logQsoWinFieldsToggle()
{
  if (lqLocked()) return;
  LOGQSO.arrange = !LOGQSO.arrange;
  lqBuild();
}

// The view switch beside the call: another view shown (kept for next time); what's typed in every view stays on the card
function logQsoWinView(view)
{
  if (!LQ_VIEWS.includes(view)) return;
  GT.settings.adifLog.logQsoView = view;
  for (const grid of lqTiles.querySelectorAll(".lqViewGrid")) grid.style.display = grid.dataset.view == view ? "" : "none";
  logQsoViewQso.classList.toggle("lqOn", view == "qso");
  logQsoViewStation.classList.toggle("lqOn", view == "station");
  lqFitRows();
  // (the band, mode and grid chips show while their tiles are out of sight)
  logQsoWinChips();
}

// The view shown's tiles in their order on the card kept as its layout (the data fields not among them)
function lqSaveOrder()
{
  const view = lqView();
  const grid = lqTiles.querySelector(`.lqViewGrid[data-view="${view}"]`);
  if (!grid) return;
  const laid = lqAllLaid();
  lqSetSaved(view, [...grid.querySelectorAll(".lqTile")].map((t) => t.dataset.id).filter((id) => !(LOGQSO.dataFields.includes(id) && !laid.includes(id))));
}

// A field added to the view shown, its box filled in as the card would be (the station's own: as last logged, else as GridTracker knows)
function logQsoWinAdd(id)
{
  // (a field added with the master lock shut opens it: the card is being arranged)
  if (lqLocked()) logQsoWinLockToggle();
  const view = lqView();
  const layout = lqLayout(view);
  // (Freq back before Band, where it was; any other field last)
  if (!layout.includes(id)) layout.splice(id == "freq" && layout.includes("band") ? layout.indexOf("band") : layout.length, 0, id);
  lqSetSaved(view, layout);
  lqBuild();
  const input = document.getElementById("logQsoX_" + lqAdif(id));
  if (input && !input.value) lqPutExtra(input, lqStickyValue(lqAdif(id)));
  if (id == "x:DXCC" || id == "x:COUNTRY") lqDxccFromCall();
  if (input && !lqArranging()) input.focus();
}

// An added field taken off its view (what it held goes with it; Freq's box stays, hidden, LQ_CORE_OPTIONAL); never while the master
// lock is shut
function logQsoWinRemove(id)
{
  if (lqLocked()) return;
  const view = lqViewOf(id);
  lqSetSaved(view, lqLayout(view).filter((x) => x != id));
  LOGQSO.dataFields = LOGQSO.dataFields.filter((x) => x != id);
  const sticky = GT.settings.adifLog.logQsoSticky;
  if (sticky && lqAdif(id)) delete sticky[lqAdif(id)];
  lqBuild();
}

// The view shown's tiles back as they started (LQ_VIEW_DEFAULTS), with the window's size and the 1x width
function logQsoWinResetLayout()
{
  if (lqLocked()) return;
  const view = lqView();
  // (the widths picked for its tiles go too, and the 1x width and the window's size go back to theirs: LQ_COL_DEFAULT, LQ_WIN_DEFAULT)
  const widths = GT.settings.adifLog.logQsoWidths;
  if (widths && typeof widths == "object") for (const id of lqShown(view)) delete widths[id];
  GT.settings.adifLog.logQsoColWidth = LQ_COL_DEFAULT;
  electron.ipcRenderer.send("fitWin", "gt_logqso", LQ_WIN_DEFAULT.width, LQ_WIN_DEFAULT.height, false);
  lqSetSaved(view, null);
  if (view == "qso") LOGQSO.dataFields = [];
  lqBuild();
  for (const input of lqTiles.querySelectorAll(`.lqViewGrid[data-view="${view}"] input[id^='logQsoX_']`)) if (!input.value) lqPutExtra(input, lqStickyValue(input.id.slice(8)));
}

function lqDragStart(event)
{
  const tile = event.target.closest ? event.target.closest(".lqTile") : null;
  if (!tile || !lqArranging())
  {
    event.preventDefault();
    return;
  }
  LOGQSO.drag = tile;
  tile.classList.add("lqDragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", tile.dataset.id);
}

// Over another tile: the one dragged goes before it, or after it past its middle
function lqDragOver(event)
{
  if (!LOGQSO.drag) return;
  event.preventDefault();
  const over = event.target.closest ? event.target.closest(".lqTile") : null;
  if (!over || over == LOGQSO.drag) return;
  if (over.parentNode != LOGQSO.drag.parentNode) return;
  const box = over.getBoundingClientRect();
  const after = event.clientX > box.left + box.width / 2;
  over.parentNode.insertBefore(LOGQSO.drag, after ? over.nextSibling : over);
}

function lqDragEnd()
{
  if (!LOGQSO.drag) return;
  LOGQSO.drag.classList.remove("lqDragging");
  LOGQSO.drag = null;
  lqSaveOrder();
  lqFitRows();
}

// The right-click menu: Cut, Copy and Paste in a box; Add Fields (by kind, those not on the card); Remove Field on an added one; Unlock
// Fields, Unlock Widths and Reset Layout (greyed out while the master lock is shut)
function logQsoWinMenu(event)
{
  event.preventDefault();
  const menu = new Menu();
  const box = event.target.closest ? event.target.closest("input, select") : null;
  if (box && !lqArranging())
  {
    menu.append(new MenuItem({ label: I18N("copy"), role: "copy" }));
    menu.append(new MenuItem({ label: I18N("paste"), role: "paste" }));
    menu.append(new MenuItem({ type: "separator" }));
  }
  // (the view showing's fields only: the QSO's on QSO, the station's own on My Station; each by its label, its ADIF name beside it)
  const shown = lqAllLaid().concat(LOGQSO.dataFields);
  const groups = LQ_EXTRA_GROUPS[lqView()].map(([kind, fields]) =>
  {
    const left = fields.filter((adif) => !shown.includes("x:" + adif));
    const items = left.map((adif) => ({ label: lqLabel(adif), sublabel: adif, toolTip: adif, click: () => logQsoWinAdd("x:" + adif) }));
    return { label: I18N("logQso.group." + kind), enabled: left.length > 0, submenu: left.length ? items : [{ label: "-", enabled: false }] };
  });
  // (a core field taken off, Freq: first, on QSO)
  if (lqView() == "qso")
  {
    for (const id of LQ_CORE_OPTIONAL.filter((c) => !shown.includes(c)).reverse()) groups.unshift({ label: I18N(LQ_CORE[id].label), click: () => logQsoWinAdd(id) });
  }
  menu.append(new MenuItem({ label: I18N("logQso.menu.addFields"), submenu: groups }));
  const tile = event.target.closest ? event.target.closest(".lqTile.lqExtra") : null;
  if (tile)
  {
    const id = tile.dataset.id;
    const name = LQ_CORE[id] ? I18N(LQ_CORE[id].label) : lqLabel(lqAdif(id));
    menu.append(new MenuItem({ label: I18N("logQso.menu.removeField").replace("{field}", name), enabled: !lqLocked(), click: () => logQsoWinRemove(id) }));
  }
  menu.append(new MenuItem({ type: "separator" }));
  const open = !lqLocked();
  menu.append(new MenuItem({ label: I18N(lqArranging() ? "logQso.menu.lock" : "logQso.menu.unlock"), enabled: open, click: () => logQsoWinFieldsToggle() }));
  menu.append(new MenuItem({ label: I18N(open && LOGQSO.widths ? "logQso.menu.lockWidths" : "logQso.menu.unlockWidths"), enabled: open, click: () => logQsoWinWidthsToggle() }));
  menu.append(new MenuItem({ label: I18N("logQso.menu.resetLayout"), enabled: open, click: () => logQsoWinResetLayout() }));
  menu.popup();
}

// ---- Logging

// Enter logs the QSO; Escape ends Unlock Fields and Unlock Widths, or with neither on shuts the master lock; it never closes the window
function logQsoWinKey(event)
{
  // An open suggestion list takes its keys first (Enter picks from it, Escape closes it)
  if (lqDropKey(event))
  {
    event.preventDefault();
    return;
  }
  if (event.key == "Escape")
  {
    event.preventDefault();
    if (LOGQSO.widths || LOGQSO.arrange)
    {
      LOGQSO.widths = false;
      LOGQSO.arrange = false;
      lqBuild();
    }
    else if (!lqLocked()) logQsoWinLockToggle();
  }
  else if (event.key == "Enter" && !lqArranging())
  {
    event.preventDefault();
    logQsoWinLog();
  }
}

// A field's message: [i18n key, its {0}, {1} ...] (an added field named by its label)
function lqErrorText(error)
{
  let text = I18N(error[0]);
  for (let i = 1; i < error.length; i++) text = text.replace("{" + (i - 1) + "}", i == 1 && LQ_EXTRA[error[i]] ? lqLabel(error[i]) : error[i]);
  return text;
}

// An added field's box checked: null (empty), { error: its message } or { adif, plain, fields } (what it writes)
function lqExtraCheck(input)
{
  const adif = input.id.slice(8);
  const rule = LQ_EXTRA[adif] || {};
  let value = String(input.value || "").trim();
  if (!value) return null;
  if (rule.upper) value = value.toUpperCase();
  const plain = logQsoAscii(value);
  if (plain == null) return { error: I18N("logQso.error.ascii") };
  if ((adif == "SOTA_REF" || adif == "MY_SOTA_REF") && !window.opener.sotaRefParts(plain)) return { error: I18N("sotaLog.badRef").replace("{0}", plain) };
  if (adif == "POTA_REF" && !LOG_QSO_PARK_REGEXP.test(plain)) return { error: I18N("sotaLog.badPark").replace("{0}", plain) };
  // (a county with its state, as it's logged: lqCountyFull)
  if (adif == "CNTY" || adif == "MY_CNTY") return lqCountyCheck(adif, logQsoAscii(lqCountyFull(input)) || plain, input);
  // DXCC, MY_DXCC: one of ADIF's DXCC entity codes (GridTracker's list of them)
  if ((adif == "DXCC" || adif == "MY_DXCC") && /^\d+$/.test(plain) && !(GT.dxccToADIFName && GT.dxccToADIFName[Number(plain)])) return { error: lqErrorText(["logQso.error.format", adif, "291"]) };
  // ADIF's rules for the field (logQsoCore.js)
  const checked = logQsoFieldCheck(adif, plain);
  if (checked.error) return { error: lqErrorText(checked.error) };
  return { adif, plain, fields: checked.fields };
}

// The DXCC entities whose CNTY is ADIF's "ST,County Name" (USA, Alaska, Hawaii)
const LQ_COUNTY_DXCC = [291, 6, 110];

// CNTY / MY_CNTY: a U.S. county as ADIF has it, "OR,Linn" (GridTracker's county list: any case and spacing typed, written as the list
// has it); for a U.S. call (the worked one's, or the station's: STATION_CALLSIGN, else Settings' callsign) it must be one. Elsewhere the
// subdivisions differ by country: plain text
function lqCountyCheck(adif, plain, input = null)
{
  const key = plain.toUpperCase().replace(/\s*,\s*/, ",").replaceAll(" ", "");
  if (key in GT.countyData && key in GT.cntyToCounty) return { adif, plain, fields: { [adif]: key.split(",")[0] + "," + GT.cntyToCounty[key] } };
  const station = document.getElementById("logQsoX_STATION_CALLSIGN");
  const call = String((adif == "MY_CNTY" ? (station && station.value) || GT.settings.app.myCall : logQsoCall.value) || "").toUpperCase().trim();
  // (the example as it's typed: the county's name with a state beside it, else with its state)
  const stateBox = input ? lqCountyStateBox(input) : null;
  const example = stateBox && stateBox.value.trim() ? "Linn" : "OR,Linn";
  if (call && LQ_COUNTY_DXCC.includes(Number(window.opener.callsignToDxcc(call)))) return { error: lqErrorText(["logQso.error.format", adif, example]) };
  return { adif, plain, fields: { [adif]: plain } };
}

// The added fields' values, checked: { errors: [[input, message]], fields: { FIELD: value } (in the card's order), potaRef, sotaRef }
function lqExtras()
{
  const out = { errors: [], fields: {}, potaRef: "", sotaRef: "" };
  for (const input of lqTiles.querySelectorAll("input[id^='logQsoX_']"))
  {
    const checked = lqExtraCheck(input);
    if (!checked) continue;
    if (checked.error) out.errors.push([input, checked.error]);
    else if (checked.adif == "POTA_REF") out.potaRef = checked.plain;
    else
    {
      if (checked.adif == "SOTA_REF") out.sotaRef = checked.plain;
      Object.assign(out.fields, checked.fields);
    }
  }
  return out;
}

// ---- Checked as it's typed

// A core field's message is its time's for its date box too
const LQ_ERROR_OF = { dateOn: "timeOn", dateOff: "timeOff" };

// The boxes checked as they're typed in: each one typed in since the card was filled (all: every box, as Log does), outlined red while
// what's in it breaks its rule; the message at the bottom is the box being typed in's, else the first one's. Returns how many are wrong
function lqCheck(all = false)
{
  const errors = new Map();
  const touched = (el) => all || LOGQSO.touched.has(el.id);
  const checked = logQsoValidate(logQsoWinValues());
  const inputs = logQsoWinInputs();
  for (const key in inputs)
  {
    const message = checked.errors[LQ_ERROR_OF[key] || key];
    if (message && touched(inputs[key])) errors.set(inputs[key], I18N(message));
  }
  if (checked.errors.mode && touched(logQsoMode)) errors.set(logQsoMode, I18N(checked.errors.mode));
  // (a park or summit box being searched by name, its list showing: not checked till it's left or a match is picked)
  const searching = lqDropShown() && LQ_DROP.input && LQ_DROP.input.dataset.list.startsWith("lqSearch_") ? LQ_DROP.input : null;
  for (const input of lqTiles.querySelectorAll("input[id^='logQsoX_']"))
  {
    const extra = touched(input) && (all || input != searching) ? lqExtraCheck(input) : null;
    if (extra && extra.error) errors.set(input, extra.error);
  }
  for (const el of document.querySelectorAll(".logQsoBad")) if (!errors.has(el)) el.classList.remove("logQsoBad");
  for (const el of errors.keys()) el.classList.add("logQsoBad");
  logQsoError.textContent = errors.get(document.activeElement) || (errors.size ? errors.values().next().value : "");
  return errors.size;
}

// DXCC and COUNTRY (when on the card) follow the call, its entity as GridTracker works it out (as sendToLogger would), until they're
// typed in; a DXCC typed in, COUNTRY follows it
function lqDxccFromCall()
{
  const call = String(logQsoCall.value || "").toUpperCase().trim();
  const typed = document.getElementById("logQsoX_DXCC");
  let dxcc = 0;
  try
  {
    if (typed && LOGQSO.touched.has(typed.id)) dxcc = /^\d+$/.test(typed.value.trim()) ? Number(typed.value.trim()) : 0;
    else dxcc = logQsoCallRegexp().test(call) ? Number(window.opener.callsignToDxcc(call)) : 0;
  }
  catch (e)
  {
    console.error(e);
  }
  const name = dxcc > 0 && GT.dxccToADIFName ? GT.dxccToADIFName[dxcc] || "" : "";
  for (const [adif, value] of [["DXCC", dxcc > 0 ? String(dxcc) : ""], ["COUNTRY", name]])
  {
    const box = document.getElementById("logQsoX_" + adif);
    if (box && !LOGQSO.touched.has(box.id)) box.value = value;
  }
}

// The card cleared for the next QSO (the call emptied, or a call typed into an empty box on a card that came with no call): every field
// of the QSO view cleared (grid, name, power, comment, its added fields; the station's own among them as they start a card), a spot's
// park and summit gone, the reports the mode's, the times now; only the mode, the VFO and its frequency, and My Station kept
function lqClearForNextCall()
{
  logQsoGrid.value = "";
  logQsoName.value = "";
  // (a retained tile keeps what it holds: its Retain switch)
  if (!lqRetained("power")) logQsoPower.value = "";
  if (!lqRetained("comment")) logQsoComment.value = "";
  const [mode] = String(logQsoMode.value || "|").split("|");
  logQsoRstSent.value = logQsoRstRcvd.value = logQsoDefaultRst(mode || "SSB");
  const at = lqTimeParts(Date.now());
  logQsoDateOn.value = logQsoDateOff.value = at.date;
  logQsoTimeOn.value = logQsoTimeOff.value = at.time;
  if (LOGQSO.prefill)
  {
    LOGQSO.prefill.potaRef = "";
    LOGQSO.prefill.sotaRef = "";
    LOGQSO.prefill.mode = mode || "";
  }
  if (LOGQSO.dataFields.length)
  {
    LOGQSO.dataFields = [];
    lqBuild();
  }
  // (a retained tile keeps what it holds, and Serial Sent its next serial)
  for (const input of lqTiles.querySelectorAll('.lqViewGrid[data-view="qso"] input[id^="logQsoX_"]'))
  {
    if (input.id == "logQsoX_STX") continue;
    if (!lqRetained("x:" + input.id.slice(8))) input.value = "";
  }
  for (const id of [...LOGQSO.touched]) if (id != "logQsoFreq" && id != "logQsoMode") LOGQSO.touched.delete(id);
  LOGQSO.looked = "";
  logQsoWinChips();
  logQsoWinHint();
}

// Text as the card lets it in: printable ASCII only (ADIF's ADI fields are ASCII, and whether a length counts bytes or characters is
// never in doubt then). Accented letters lose their accents, a few letters are spelled out (ß ss, æ ae, ø o, ł l ...), anything else is
// dropped
const LQ_ASCII_LETTERS = {
  ß: "ss", Æ: "AE", æ: "ae", Ø: "O", ø: "o", Œ: "OE", œ: "oe", Đ: "D", đ: "d", Ł: "L", ł: "l", Þ: "TH", þ: "th", Ð: "D", ð: "d", ı: "i",
  "–": "-", "—": "-", "‘": "'", "’": "'", "“": "\"", "”": "\"", "…": "...", " ": " "
};
function lqAsciiOnly(text)
{
  return String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, (c) => LQ_ASCII_LETTERS[c] || "");
}

// A text box's value made ASCII as it's typed or pasted (lqAsciiOnly), the caret kept where it was
function lqKeepAscii(el)
{
  if (el.tagName != "INPUT" || el.type != "text") return;
  const value = el.value;
  const clean = lqAsciiOnly(value);
  if (clean == value) return;
  const caret = el.selectionStart == null ? clean.length : lqAsciiOnly(value.slice(0, el.selectionStart)).length;
  el.value = clean;
  el.setSelectionRange(caret, caret);
}

// A key in any of the card's boxes (or another mode picked): that box counts as typed in, and the boxes are checked
function lqOnInput(event)
{
  const el = event.target;
  if (!el || !el.id || !(el.id == "logQsoCall" || lqTiles.contains(el))) return;
  // (only ASCII goes in: lqAsciiOnly)
  lqKeepAscii(el);
  if (el.id == "logQsoCall")
  {
    // Emptied: cleared for the next QSO (which then counts as having come with nothing)
    if (!el.value.trim())
    {
      lqClearForNextCall();
      LOGQSO.inbound = false;
      LOGQSO.callEmpty = true;
      lqCheck();
      return;
    }
    // The first key of a call on a card that came with none: everything else cleared first
    if (LOGQSO.callEmpty && !LOGQSO.inbound) lqClearForNextCall();
    LOGQSO.callEmpty = false;
  }
  LOGQSO.touched.add(el.id);
  // A My Station box, a retained tile's: what it holds kept for the next cards, written to the settings a moment after the last key (the
  // grid: the bearing and distance from it)
  if (el.id.startsWith("logQsoX_") && LQ_EXTRA[el.id.slice(8)] && LQ_EXTRA[el.id.slice(8)].view == "station")
  {
    lqKeepStation(el);
    lqSaveSoon();
  }
  const retainId = lqRetainIdOf(el);
  if (retainId && lqRetained(retainId))
  {
    lqKeepRetained(retainId, el.value);
    lqSaveSoon();
  }
  if (el.id == "logQsoX_MY_GRIDSQUARE") logQsoWinChips();
  if (el.id == "logQsoCall" || el.id == "logQsoX_DXCC") lqDxccFromCall();
  // A state typed or a county picked: the county box's list follows the state; a known county picked with its state box empty fills
  // that in
  const adif = el.id.startsWith("logQsoX_") ? el.id.slice(8) : "";
  if (adif == "STATE" || adif == "MY_STATE") lqStateList(adif);
  if (adif == "STATE" || adif == "CNTY") lqCountyList("CNTY");
  if (adif == "MY_STATE" || adif == "MY_CNTY") lqCountyList("MY_CNTY");
  if (adif == "CNTY" || adif == "MY_CNTY")
  {
    const key = lqCountyFull(el).toUpperCase().replace(/\s*,\s*/, ",").replaceAll(" ", "");
    const stateBox = lqCountyStateBox(el);
    if (key in GT.cntyToCounty && stateBox && !stateBox.value.trim())
    {
      stateBox.value = key.split(",")[0];
      LOGQSO.touched.add(stateBox.id);
      lqKeepStation(stateBox);
    }
    // (a known county typed with its state, "OR,Linn": shown by its name from then on, its state kept)
    if (key in GT.cntyToCounty && el.value.includes(",")) lqSetCounty(el, el.value);
    if (adif == "MY_CNTY") lqKeepStation(el);
  }
  // Its list (one it has) showing what matches what's typed
  if (el.dataset.list && !LQ_DROP.picking) lqDropOpen(el);
  lqCheck();
}

// Log: checked (what's wrong outlined, the first of it said), then the QSO handed to the main window (logQsoLog), with its park (the
// POTA_REF field, else the spot's, else this call's on this band in the Feed Roster); the window closes once it's logged
function logQsoWinLog()
{
  const O = window.opener;
  // Every box checked now, typed in or not; the first one wrong on another view: that view shown
  if (lqCheck(true))
  {
    const bad = document.querySelector(".lqViewGrid .logQsoBad");
    const grid = bad && !document.querySelector(`.lqViewGrid[data-view="${lqView()}"] .logQsoBad`) ? bad.closest(".lqViewGrid") : null;
    if (grid) logQsoWinView(grid.dataset.view);
    return;
  }
  const f = logQsoWinValues();
  const checked = logQsoValidate(f);
  const extras = lqExtras();
  const record = Object.assign(checked.record, extras.fields);
  // A QSO GridTracker's log would leave out (Settings -> Logbook: its working callsigns, date or grids) refused with the reason, as the
  // roster's hand-logged QSOs always were (sota.js)
  const myCall = String(GT.settings.app.myCall || "").toUpperCase();
  const blocked = O.sotaChaseFilterBlock(myCall, Math.floor(logQsoParseUtc(f.dateOn, f.timeOn) / 1000));
  if (blocked)
  {
    logQsoError.textContent = blocked;
    return;
  }
  const potaRef = extras.potaRef || f.potaRef || O.logQsoSpotPark(record.CALL, record.BAND);
  // A park's QSO needs its frequency (POTA's spot of it says where): a band alone isn't enough
  if (potaRef && !record.FREQ)
  {
    logQsoFreq.classList.add("logQsoBad");
    logQsoError.textContent = I18N("logQso.error.freq");
    return;
  }
  // Logged by the main window (logQso.js), as every request comes through it; false: the same QSO as the one logged last
  if (!O.logQsoLog(logQsoAdif(record), potaRef, extras.sotaRef))
  {
    logQsoError.textContent = I18N("sotaLog.duplicate");
    return;
  }
  // This session's next cards start in this mode (when nothing gives them one)
  GT.logQsoSessionMode = { mode: record.MODE, submode: record.SUBMODE || "" };
  // A contest's Serial Sent logged: the next card's is one more (kept with the settings, so it goes on counting after a restart)
  if (/^\d+$/.test(String(extras.fields.STX || ""))) lqSticky().STX = String(Number(extras.fields.STX) + 1);
  // The retained tiles (their Retain switches) on the card: what they logged starts the next card (My Station's are kept as they're typed)
  for (const id of LQ_RETAIN)
  {
    if (!lqRetained(id)) continue;
    if (id == "power") lqKeepRetained(id, record.TX_PWR);
    else if (id == "comment") lqKeepRetained(id, record.COMMENT);
    else if (document.getElementById("logQsoX_" + lqAdif(id))) lqKeepRetained(id, extras.fields[lqAdif(id)]);
  }
  lqSaveSettings();
  logQsoWinClose();
}

function logQsoWinInit()
{
  loadChildWindowI18n();
  // The card always opens with its master lock shut (one left open last time included)
  GT.settings.adifLog.logQsoLocked = true;
  lqMakeLists();
  logQsoCall.title = `CALL\n${I18N("logQso.adif.call.hover")}`;
  // A box with a list: given the keys, its whole list shows (a county box's for its state); clicked again, shown or hidden; left, closed
  document.addEventListener("focusin", (event) =>
  {
    const el = event.target;
    if (!el || !el.dataset || !el.dataset.list) return;
    if (el.id == "logQsoX_CNTY" || el.id == "logQsoX_MY_CNTY") lqCountyList(el.id.slice(8));
    if (el.id == "logQsoX_STATE" || el.id == "logQsoX_MY_STATE") lqStateList(el.id.slice(8));
    lqDropOpen(el, true);
  });
  document.addEventListener("focusout", (event) =>
  {
    if (event.target != LQ_DROP.input) return;
    const search = LQ_DROP.input.dataset.list.startsWith("lqSearch_");
    lqDropClose();
    // (a park or summit box left: checked now, as its search list held it back)
    if (search) lqCheck();
  });
  document.addEventListener("mousedown", (event) =>
  {
    const el = event.target;
    if (!el || !el.dataset || !el.dataset.list || document.activeElement != el) return;
    if (lqDropShown()) lqDropClose();
    else lqDropOpen(el, true);
  });
  document.addEventListener("keydown", logQsoWinKey);
  document.addEventListener("input", lqOnInput);
  document.addEventListener("contextmenu", logQsoWinMenu);
  lqTiles.addEventListener("dragstart", lqDragStart);
  lqTiles.addEventListener("dragover", lqDragOver);
  lqTiles.addEventListener("dragend", lqDragEnd);
  // (the window shown: its card has been on screen, so hiding and showing it again keeps it, logQsoWinWaiting. Hidden: its master lock
  // shut, so it never shows again unlocked)
  document.addEventListener("visibilitychange", () =>
  {
    if (!document.hidden && LOGQSO.prefill) LOGQSO.seen = true;
    if (document.hidden && !lqLocked()) logQsoWinLockToggle();
  });
  // (the window given the keys with no box holding them and the call empty: the call box takes them, its pipe strobing)
  window.addEventListener("focus", () =>
  {
    if ((!document.activeElement || document.activeElement == document.body) && !logQsoCall.value) logQsoCall.focus();
  });
  // (the window resized: its rows filled out again for the columns that fit now)
  new ResizeObserver(() => lqFitRows()).observe(lqTiles);
  LOGQSO.clock = nodeTimers.setInterval(lqClockTick, 1000);
  LOGQSO.rig = nodeTimers.setInterval(lqRigTick, LQ_RIG_MS);
  lqClockTick();
  // (loaded even when the first fill fails, so the main window's requests aren't left waiting: each fills it again)
  try
  {
    logQsoWinFill(null);
  }
  catch (e)
  {
    console.error(e);
  }
  GT.logQsoWindowInitialized = true;
}
