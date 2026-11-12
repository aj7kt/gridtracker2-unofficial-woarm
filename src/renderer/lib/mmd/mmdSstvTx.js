// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// Send Picture (the Multi-Mode Decoder in SSTV mode): the SSTV view's Send tab (its header's Receive / Send) that builds the picture (a background: the GridTracker logo, the map as the main window shows it, this window's
// waterfall, a color, or an image file; your call, grid and a line of text over it) at the mode's size, shows it, and sends it: encoded
// (sstvEncoder.js) and played to the SSTV Output Device (the window's Settings: the common one, or SSTV's own) through the Power's gain
// (moved as it plays: the rig's ALC watched), the rig keyed by its PTT Method (rigPtt). The choices are kept in settings.MMD.sstvTx

// The leader tone before the VIS code for VOX (s), and the PTT lead and tail with Rig Control (ms)
const SSTV_TX_VOX_LEAD_S = 0.6;
const SSTV_TX_PTT_LEAD_MS = 250;
const SSTV_TX_PTT_TAIL_MS = 200;
// Over how long a picture can take (s) the sending is cut off anyway
const SSTV_TX_WATCHDOG_S = 3;
// Tune: a steady tone (Hz, in the SSTV passband) for this long at most (s)
const SSTV_TX_TUNE_HZ = 1900;
const SSTV_TX_TUNE_S = 30;
// (How the rig is keyed is its own PTT Method, Rig Control's settings: rigPttMethod.) powerDb: Power, sending's and Tune's alike, the last
// one set (-28 dB at first), dB below full scale (as WSJT-X's Pwr slider: 0 to -45 dB in 0.1 dB steps, a gain of 10^(dB/20)), applied as
// the audio plays, so the slider acts at once; powerByBand: kept for the band it was set on, { "20m": dB } (mmdSstvTxPower)
// logoZoom, logoX, logoY and imageZoom, imageX, imageY: the GridTracker logo's and the image file's own size over covering the picture
// (0.25 to 4: under 1 it is smaller than the picture, the color round it) and where it sits (each -100 to 100: half its size either way),
// each kept for its own background (mmdSstvTxPlace). stampDate, stampTime: the UTC date and time it is sent (either or both), its color,
// size (stampSize) and place (stampPos) as a line of the text's, in a box (stampBox "color", its stampBoxColor) or not ("none"), in
// stampFont. call, grid, textOn: your call, your
// grid and your line of text on the picture, each its own color (callColor ...), size (callSize: SSTV_TX_SIZES) and place (callPos: one of
// SSTV_TX_PLACES), all in textFont (SSTV_TX_FONTS). textShow, stampShow: the Text and the Time Stamp on the picture at all (their titles'
// checkboxes; off, the rest of each is kept as it was)
const SSTV_TX_DEFAULTS = { mode: "Martin 1", back: "logo", color: "#1a2a5a", image: "", logoZoom: 1, logoX: 0, logoY: 0, imageZoom: 1, imageX: 0, imageY: 0, textFont: "arial", call: true, callColor: "#ffff00", callSize: "xlarge", callPos: "4-2", grid: true, gridColor: "#ffff00", gridSize: "medium", gridPos: "4-2", textOn: true, text: "CQ SSTV", textColor: "#ffff00", textSize: "medium", textPos: "4-2", stampFont: "arial", stampDate: false, stampTime: false, stampPos: "0-4", stampSize: "small", stampColor: "#ffffff", stampBox: "none", stampBoxColor: "#000000", textShow: true, stampShow: true, powerDb: -28, powerByBand: null };
const SSTV_TX_ZOOM = [0.25, 4];
// The fonts there are to pick (the Text's and the Time Stamp's): each one's name as shown, and the families tried in turn (Windows' own
// first, then the macOS and Linux ones nearest it). monospace: the computer's own monospaced font (its name in the locale)
const SSTV_TX_FONTS = {
  arial: ["Arial", "Arial, Helvetica, 'Liberation Sans', sans-serif"],
  arialBlack: ["Arial Black", "'Arial Black', 'Helvetica Neue', Arial, sans-serif"],
  impact: ["Impact", "Impact, Haettenschweiler, 'Arial Narrow', sans-serif"],
  verdana: ["Verdana", "Verdana, Geneva, 'DejaVu Sans', sans-serif"],
  georgia: ["Georgia", "Georgia, 'Times New Roman', 'Liberation Serif', serif"],
  courier: ["Courier New", "'Courier New', Courier, 'Liberation Mono', monospace"],
  comic: ["Comic Sans MS", "'Comic Sans MS', 'Comic Neue', 'Chalkboard SE', cursive"],
  monospace: [null, "monospace"]
};
// The text's sizes, as shares of the picture's height (tiny and smaller: the time stamp's menu only)
const SSTV_TX_SIZES = { tiny: 0.04, smaller: 0.055, small: 0.07, medium: 0.1, large: 0.14, xlarge: 0.2 };
// The places the text can go: the picture split SSTV_TX_GRID by SSTV_TX_GRID, each "row-column" ("0-0" top left, "4-4" bottom right)
const SSTV_TX_GRID = 5;
const SSTV_TX_PLACES = Array.from({ length: SSTV_TX_GRID * SSTV_TX_GRID }, (_, i) => Math.floor(i / SSTV_TX_GRID) + "-" + (i % SSTV_TX_GRID));

function mmdSstvTxFont(key, px)
{
  return "bold " + Math.round(px) + "px " + (SSTV_TX_FONTS[key] || SSTV_TX_FONTS.arial)[1];
}

// The time stamp (the UTC date and/or time of the build: Send builds the picture as it sends it) and its box, at its size (one of
// SSTV_TX_SIZES, as a line of the text) and place (one of SSTV_TX_PLACES: its row and column as shares of the room the box leaves, the
// corners a margin in from the edges): { text, px, bx, by, bw, bh, cx, baseline (where its text goes) }; null when neither is on
function mmdSstvTxStamp(ctx, T, w, h)
{
  if (!T.stampShow || (!T.stampDate && !T.stampTime)) return null;
  const now = new Date().toISOString();
  const text = [T.stampDate ? now.slice(0, 10) : "", T.stampTime ? now.slice(11, 19) : "", "UTC"].filter(Boolean).join(" ");
  const px = Math.max(8, h * (SSTV_TX_SIZES[T.stampSize] || SSTV_TX_SIZES.small)), padX = px * 0.45, padY = px * 0.3, margin = h * 0.025;
  const [rowAt, colAt] = (SSTV_TX_PLACES.includes(T.stampPos) ? T.stampPos : SSTV_TX_DEFAULTS.stampPos).split("-").map((n) => Number(n) / (SSTV_TX_GRID - 1));
  ctx.font = mmdSstvTxFont(T.stampFont, px);
  ctx.textBaseline = "alphabetic";
  const m = ctx.measureText(text);
  const ascent = m.actualBoundingBoxAscent, descent = m.actualBoundingBoxDescent;
  const bw = m.width + 2 * padX, bh = ascent + descent + 2 * padY;
  const bx = margin + colAt * Math.max(0, w - 2 * margin - bw), by = margin + rowAt * Math.max(0, h - 2 * margin - bh);
  // The text's middle on the box's: its baseline set so its ink sits as far from the top as from the bottom
  return { text, px, bx, by, bw, bh, cx: bx + bw / 2, baseline: by + padY + ascent };
}

// The background's own Zoom and Position (the logo's or the image file's: "logo" or "image" keys), { zoom, x, y }; null for another
// background (a map, the waterfall and a color aren't moved)
function mmdSstvTxPlace(T = mmdSstvTxSettings())
{
  if (T.back != "logo" && T.back != "image") return null;
  return { zoom: Number(T[T.back + "Zoom"]) || 1, x: Number(T[T.back + "X"]) || 0, y: Number(T[T.back + "Y"]) || 0 };
}
const SSTV_TX_POWER_MIN_DB = -45;

const TX = {
  ctx: null,
  source: null,
  gain: null,   // the Power, set as the audio plays
  kind: null,   // what is sent: "picture" or "tune"
  mode: null,
  startAt: 0,   // the context's time the audio started
  lead: 0,      // s into the audio the first line starts
  lines: 0,
  timer: null,
  watchdog: null,
  pttVfo: null, // the VFO whose rig was keyed (Rig Control), until it is unkeyed
  unkey: null,  // the last sending's rig unkeyed once its tail is over (mmdSstvTxUnkey), while it waits; and its timer
  unkeyTimer: null,
  stops: 0,     // the stops so far (mmdSstvTxStop): a start waiting for its Output Device sees it was stopped meanwhile
  starting: 0,  // the starts waiting for their network Output Device (mmdNetOutput) meanwhile
  netToken: null, // a network Output Device's, while it is sent to (mmdNetAudio.js)
  logo: null,   // the GridTracker logo, loaded once
  image: null,  // the image file chosen, loaded (its path in image.src)
  built: null,  // the picture as last built (a canvas at the mode's size)
  building: 0,
  sending: false, // Send under way (its build, then the start)
  sends: 0,     // Send's clicks so far: one stopped and clicked again goes on as the newer one only (mmdSstvTxSend)
  zoomGrid: null, // the small place grid the zoom box is open for (mmdSstvTxZoomOpen)
  zoomTimer: null
};

function mmdSstvTxSettings()
{
  const S = GT.settings.MMD;
  if (!S.sstvTx || typeof S.sstvTx != "object") S.sstvTx = {};
  for (const key in SSTV_TX_DEFAULTS) if (!(key in S.sstvTx)) S.sstvTx[key] = SSTV_TX_DEFAULTS[key];
  // (a place that isn't one: the default)
  for (const key of ["callPos", "gridPos", "textPos", "stampPos"])
  {
    if (!SSTV_TX_PLACES.includes(S.sstvTx[key])) S.sstvTx[key] = SSTV_TX_DEFAULTS[key];
  }
  S.sstvTx.powerDb = mmdSstvTxPowerDb(S.sstvTx.powerDb, SSTV_TX_DEFAULTS.powerDb);
  if (!S.sstvTx.powerByBand || typeof S.sstvTx.powerByBand != "object") S.sstvTx.powerByBand = {};
  return S.sstvTx;
}

// A Power in dB, as the slider has it: 0 to -45, to 0.1 dB (not a number: fallback)
function mmdSstvTxPowerDb(db, fallback)
{
  const n = Number(db);
  return Number.isFinite(n) ? Math.max(SSTV_TX_POWER_MIN_DB, Math.min(0, Math.round(n * 10) / 10)) : fallback;
}

// ---- Power, as WSJT-X's Pwr slider: one for sending and Tune alike, kept for the band the SSTV VFO's rig is on (a band not set yet:
// the last one set)

// The band the rig is on ("" not known, or off the bands)
function mmdSstvTxBand()
{
  const dial = mmdDial();
  const band = dial ? mmdBandOf(dial) : "";
  return band && band != "OOB" ? band : "";
}

// This band's (powerByBand: { "20m": dB }), else the last one set
function mmdSstvTxPower()
{
  const T = mmdSstvTxSettings();
  const own = Number(T.powerByBand[mmdSstvTxBand()]);
  return Number.isFinite(own) && typeof T.powerByBand[mmdSstvTxBand()] == "number" ? mmdSstvTxPowerDb(own, T.powerDb) : T.powerDb;
}

// The slider moved: for this band and as the last one set; onto what is playing (a picture or Tune) at once
function mmdSstvTxPowerSet(db)
{
  const T = mmdSstvTxSettings();
  db = mmdSstvTxPowerDb(db, mmdSstvTxPower());
  T.powerDb = db;
  const band = mmdSstvTxBand();
  if (band) T.powerByBand[band] = db;
  if (TX.gain) TX.gain.gain.value = mmdSstvTxAmp();
  mmdSstvTxPowerRender();
}

// The slider and its dB as they are now: also as the band changes (mmdRender)
function mmdSstvTxPowerRender()
{
  const db = mmdSstvTxPower();
  if (Number(sstvTxPower.value) != db) sstvTxPower.value = db;
  const text = (db == 0 ? "0" : db.toFixed(1)) + " dB";
  if (sstvTxPowerTd.textContent != text) sstvTxPowerTd.textContent = text;
}

// The Power as a gain (1 at 0 dB)
function mmdSstvTxAmp()
{
  return Math.pow(10, mmdSstvTxPower() / 20);
}

function mmdSstvTxInit()
{
  for (const m of SSTV_TX_MODES) sstvTxMode.add(new Option(m.name + " (" + Math.round(sstvTxSeconds(m)) + " s)", m.name));
  // The Power as it is set, from the start (not the page's own -28)
  mmdSstvTxPowerRender();
  // Every choice: the settings taken from the form and the picture built again (the Power as it plays too)
  // The fonts' menus, each name in its own font
  for (const select of [sstvTxTextFont, sstvTxStampFont])
  {
    for (const [key, [name, family]] of Object.entries(SSTV_TX_FONTS))
    {
      const option = new Option(name || I18N("sstvTx.font.monospace"), key);
      option.style.fontFamily = family;
      select.add(option);
    }
  }
  // Each line's place, and the time stamp's: a small grid of cells standing for the picture's places (SSTV_TX_PLACES), the one picked lit;
  // hovered, the zoom box opens beside it (mmdSstvTxZoomOpen), where one is picked
  for (const name of ["Call", "Grid", "Text", "Stamp"])
  {
    const grid = window["sstvTx" + name + "Pos"];
    for (const place of SSTV_TX_PLACES)
    {
      const cell = document.createElement("span");
      cell.dataset.place = place;
      grid.appendChild(cell);
    }
    grid.addEventListener("mouseenter", () => mmdSstvTxZoomOpen(grid));
    grid.addEventListener("mouseleave", mmdSstvTxZoomLater);
  }
  mmdSstvTxZoomInit();
  const styles = ["Call", "Grid", "Text"].flatMap((name) => [window["sstvTx" + name + "Color"], window["sstvTx" + name + "Size"], window["sstvTx" + name + "Pos"]]);
  for (const el of [sstvTxMode, sstvTxBack, sstvTxColor, sstvTxZoom, sstvTxImgX, sstvTxImgY, sstvTxTextShow, sstvTxStampShow, sstvTxTextFont, sstvTxCall, sstvTxGrid, sstvTxTextOn, sstvTxText, ...styles, sstvTxStampFont, sstvTxStampDate, sstvTxStampTime, sstvTxStampPos, sstvTxStampSize, sstvTxStampColor, sstvTxStampBox, sstvTxStampBoxColor, sstvTxPower])
  {
    el.addEventListener(el.type == "text" || el.type == "range" || el.type == "color" ? "input" : "change", mmdSstvTxChanged);
  }
  // A double-click on Zoom, X or Y: back to 1x, centered
  for (const [el, value] of [[sstvTxZoom, 1], [sstvTxImgX, 0], [sstvTxImgY, 0]])
  {
    el.addEventListener("dblclick", () =>
    {
      el.value = value;
      mmdSstvTxChanged();
    });
  }
  TX.logo = new Image();
  TX.logo.src = "img/gridtracker.png";
  TX.logo.onload = () => mmdSstvTxPreview();
  window.addEventListener("resize", () => mmdSstvTxDraw());
}

// How long a mode's picture takes (s): the VIS code and its lines
function sstvTxSeconds(mode)
{
  return SSTV_TX_VIS_S + (mode.lead || 0) + mode.line * (mode.kind == "pd" ? mode.height / 2 : mode.height);
}

// The SSTV view's tab: "receive" (the pictures received) or "send" (this)
function mmdSstvTab(name)
{
  const send = name == "send";
  SSTV.tab = send ? "send" : "receive";
  sstvBody.style.display = send ? "none" : "";
  sstvSendBody.style.display = send ? "" : "none";
  sstvRxTab.classList.toggle("sstvTabOn", !send);
  sstvTxTab.classList.toggle("sstvTabOn", send);
  if (!send)
  {
    mmdPicDraw();
    return;
  }
  mmdSstvTxForm();
  mmdSstvTxPreview();
}

// Refresh (beside Background): the background taken again (the map as it is now, the image file read again), the picture built again
function mmdSstvTxRefresh()
{
  TX.image = null;
  mmdSstvTxPreview();
}

function mmdSstvTxShown()
{
  return SSTV.tab == "send";
}

// (The Send tab shown or the Receive one: another mode leaving SSTV puts the view back on Receive)
function mmdSstvTxShow(show)
{
  mmdSstvTab(show ? "send" : "receive");
}

// The form from the settings
function mmdSstvTxForm()
{
  const T = mmdSstvTxSettings();
  // Filled from the settings: from now on the form may be read back into them (mmdSstvTxChanged)
  TX.formFilled = true;
  sstvTxMode.value = sstvTxModeByName(T.mode).name;
  sstvTxBack.value = T.back;
  sstvTxColor.value = T.color;
  // The sliders show the background's own (the logo's, or the image file's)
  const place = mmdSstvTxPlace(T) || { zoom: 1, x: 0, y: 0 };
  sstvTxZoom.value = place.zoom;
  sstvTxZoomTd.textContent = place.zoom.toFixed(2) + "×";
  sstvTxImgX.value = place.x;
  sstvTxImgY.value = place.y;
  sstvTxTextShow.checked = T.textShow;
  sstvTxStampShow.checked = T.stampShow;
  sstvTxTextGroup.classList.toggle("sstvTxGroupOff", !T.textShow);
  sstvTxStampGroup.classList.toggle("sstvTxGroupOff", !T.stampShow);
  sstvTxStampDate.checked = T.stampDate;
  sstvTxStampTime.checked = T.stampTime;
  sstvTxStampPos.value = T.stampPos;
  mmdSstvTxPlaceShow(sstvTxStampPos);
  sstvTxStampSize.value = T.stampSize;
  sstvTxStampColor.value = T.stampColor;
  sstvTxStampBox.value = T.stampBox;
  sstvTxStampBoxColor.value = T.stampBoxColor;
  sstvTxStampBoxColor.style.display = T.stampBox == "color" ? "" : "none";
  sstvTxCall.checked = T.call;
  sstvTxGrid.checked = T.grid;
  sstvTxText.value = T.text;
  sstvTxTextOn.checked = T.textOn;
  // (Its text kept while it is off, greyed)
  sstvTxText.disabled = !T.textOn;
  // Each line's own color, size and place; the fonts (each menu shown in the font picked)
  for (const key of ["call", "grid", "text"])
  {
    const name = key[0].toUpperCase() + key.slice(1);
    window["sstvTx" + name + "Color"].value = T[key + "Color"];
    window["sstvTx" + name + "Size"].value = T[key + "Size"];
    window["sstvTx" + name + "Pos"].value = T[key + "Pos"];
    mmdSstvTxPlaceShow(window["sstvTx" + name + "Pos"]);
  }
  sstvTxTextFont.value = T.textFont;
  sstvTxStampFont.value = T.stampFont;
  sstvTxTextFont.style.fontFamily = (SSTV_TX_FONTS[T.textFont] || SSTV_TX_FONTS.arial)[1];
  sstvTxStampFont.style.fontFamily = (SSTV_TX_FONTS[T.stampFont] || SSTV_TX_FONTS.arial)[1];
  mmdSstvTxPowerRender();
  // The color: the whole picture, or round a logo or image zoomed smaller than it; Zoom and Position: the logo's and an image file's
  const movable = T.back == "logo" || T.back == "image";
  sstvTxColorRow.style.display = T.back == "color" || movable ? "" : "none";
  sstvTxImageRow.style.display = T.back == "image" ? "" : "none";
  sstvTxZoomRow.style.display = movable ? "" : "none";
  sstvTxPlaceRow.style.display = movable ? "" : "none";
  sstvTxImageName.textContent = T.image ? path.basename(T.image) : "";
  mmdSstvTxOutputRender();
  mmdSstvTxPttRender();
  mmdSstvTxButtons();
}

// A place grid's cell for its value lit (the zoom box's too while it is that grid's)
function mmdSstvTxPlaceShow(grid)
{
  for (const cell of grid.children) cell.classList.toggle("sstvTxPlaceOn", cell.dataset.place == grid.value);
  if (TX.zoomGrid == grid) for (const cell of sstvTxPlaceZoom.children) cell.classList.toggle("sstvTxPlaceOn", cell.dataset.place == grid.value);
}

// The zoom box: the places SSTV_TX_GRID by SSTV_TX_GRID over the picture as it will be sent, opened beside a line's small grid while it
// or the box is hovered; a click on a cell picks that place for the line (the grid's value and its change event), the box left open
const SSTV_TX_ZOOM_W = 150;
const SSTV_TX_ZOOM_CLOSE_MS = 250;

function mmdSstvTxZoomInit()
{
  const box = document.createElement("div");
  box.id = "sstvTxPlaceZoom";
  box.style.display = "none";
  for (const place of SSTV_TX_PLACES)
  {
    const cell = document.createElement("span");
    cell.dataset.place = place;
    cell.addEventListener("click", () =>
    {
      const grid = TX.zoomGrid;
      if (!grid) return;
      grid.value = place;
      mmdSstvTxPlaceShow(grid);
      grid.dispatchEvent(new Event("change"));
    });
    box.appendChild(cell);
  }
  box.addEventListener("mouseenter", () => nodeTimers.clearTimeout(TX.zoomTimer));
  box.addEventListener("mouseleave", mmdSstvTxZoomLater);
  document.body.appendChild(box);
}

function mmdSstvTxZoomOpen(grid)
{
  nodeTimers.clearTimeout(TX.zoomTimer);
  TX.zoomGrid = grid;
  const box = sstvTxPlaceZoom;
  // The picture's shape, and the picture itself under the cells (as last built)
  const mode = sstvTxModeByName(mmdSstvTxSettings().mode);
  const height = Math.round((SSTV_TX_ZOOM_W * mode.height) / mode.width);
  box.style.width = SSTV_TX_ZOOM_W + "px";
  box.style.height = height + "px";
  box.style.backgroundImage = TX.built ? "url(" + TX.built.toDataURL("image/png") + ")" : "none";
  // Beside the small grid on its right, its middle level with it, kept in the window
  const at = grid.getBoundingClientRect();
  box.style.display = "";
  const w = box.offsetWidth, h = box.offsetHeight;
  box.style.left = Math.max(0, Math.min(window.innerWidth - w, at.right + 2)) + "px";
  box.style.top = Math.max(0, Math.min(window.innerHeight - h, at.top + at.height / 2 - h / 2)) + "px";
  mmdSstvTxPlaceShow(grid);
}

// Closed a moment after the pointer leaves the small grid or the box (not when it goes from one to the other)
function mmdSstvTxZoomLater()
{
  nodeTimers.clearTimeout(TX.zoomTimer);
  TX.zoomTimer = nodeTimers.setTimeout(() =>
  {
    sstvTxPlaceZoom.style.display = "none";
    TX.zoomGrid = null;
  }, SSTV_TX_ZOOM_CLOSE_MS);
}

// The SSTV VFO's rig and its PTT Method, shown: "CAT · VFO-A (HF 7300)"; none in orange (no VFO: Rig Control off, or None picked)
function mmdSstvTxPttRender()
{
  const opener = window.opener;
  const vfo = GT.settings.MMD.rigControl === true ? opener.mmDecoderVfo("sstv") : null;
  const method = vfo ? opener.rigPttMethod(vfo.id) : "none";
  sstvTxPttText.textContent = (method == "none" ? opener.I18N("settings.rig.vfo.none.label") : method.toUpperCase()) + (vfo ? " · " + opener.rigVfoLabel(vfo) : "");
  sstvTxPttText.style.color = method == "none" ? "var(--gt-status-fail)" : "";
}

// The settings from the form, and the picture built again. Never before the form has been filled from them (mmdSstvTxForm): its blank
// fields read back would wipe the user's Text, Time Stamp and the rest
function mmdSstvTxChanged()
{
  if (!TX.formFilled) return;
  const T = mmdSstvTxSettings();
  T.mode = sstvTxMode.value;
  // Zoom and Position into the background they were showing, before Background changes (mmdSstvTxForm then shows the new one's own)
  if (T.back == "logo" || T.back == "image")
  {
    T[T.back + "Zoom"] = Math.max(SSTV_TX_ZOOM[0], Math.min(SSTV_TX_ZOOM[1], Number(sstvTxZoom.value) || 1));
    T[T.back + "X"] = Math.max(-100, Math.min(100, Number(sstvTxImgX.value) || 0));
    T[T.back + "Y"] = Math.max(-100, Math.min(100, Number(sstvTxImgY.value) || 0));
  }
  T.back = sstvTxBack.value;
  T.color = sstvTxColor.value;
  T.textShow = sstvTxTextShow.checked;
  T.stampShow = sstvTxStampShow.checked;
  T.stampDate = sstvTxStampDate.checked;
  T.stampTime = sstvTxStampTime.checked;
  T.stampPos = SSTV_TX_PLACES.includes(sstvTxStampPos.value) ? sstvTxStampPos.value : SSTV_TX_DEFAULTS.stampPos;
  T.stampSize = sstvTxStampSize.value in SSTV_TX_SIZES ? sstvTxStampSize.value : SSTV_TX_DEFAULTS.stampSize;
  T.stampColor = sstvTxStampColor.value;
  T.stampBox = sstvTxStampBox.value == "color" ? "color" : "none";
  T.stampBoxColor = sstvTxStampBoxColor.value;
  T.call = sstvTxCall.checked;
  T.grid = sstvTxGrid.checked;
  T.text = sstvTxText.value;
  T.textOn = sstvTxTextOn.checked;
  for (const key of ["call", "grid", "text"])
  {
    const name = key[0].toUpperCase() + key.slice(1);
    T[key + "Color"] = window["sstvTx" + name + "Color"].value;
    T[key + "Size"] = window["sstvTx" + name + "Size"].value in SSTV_TX_SIZES ? window["sstvTx" + name + "Size"].value : "medium";
    T[key + "Pos"] = SSTV_TX_PLACES.includes(window["sstvTx" + name + "Pos"].value) ? window["sstvTx" + name + "Pos"].value : SSTV_TX_DEFAULTS[key + "Pos"];
  }
  T.textFont = sstvTxTextFont.value in SSTV_TX_FONTS ? sstvTxTextFont.value : "arial";
  T.stampFont = sstvTxStampFont.value in SSTV_TX_FONTS ? sstvTxStampFont.value : "arial";
  // Power (Transmit's or Tune's, for this band), onto what is playing at once
  if (Number(sstvTxPower.value) != mmdSstvTxPower()) mmdSstvTxPowerSet(Number(sstvTxPower.value));
  mmdSstvTxForm();
  mmdSstvTxPreview();
}

// Choose Image...: a picture file, kept by its path
function mmdSstvTxChooseImage()
{
  const remote = window.require("@electron/remote");
  const files = remote.dialog.showOpenDialogSync(remote.getCurrentWindow(), {
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "bmp", "webp"] }],
    properties: ["openFile"]
  });
  if (!files || !files.length) return;
  mmdSstvTxSettings().image = files[0];
  TX.image = null;
  mmdSstvTxForm();
}

// The Output Device the picture goes to, shown by name (none: said so)
function mmdSstvTxOutputRender()
{
  const device = mmdOutputFind("sstv");
  sstvTxOutputText.textContent = device ? mmdInputLabel(device) : I18N("sstvTx.status.noOutput");
  // (Its whole name in the tooltip: a long one is cut short in the box)
  sstvTxOutputText.title = sstvTxOutputText.textContent;
  sstvTxOutputText.style.color = device ? "" : "var(--gt-status-fail)";
}

// Simulate Rx, Send and Tune, always in their places: the one running red (Send while the picture is built too; Simulate Rx says
// Abort), a click on it stops it; the others greyed meanwhile, and a click on one does nothing
function mmdSstvTxButtons()
{
  const tuning = !!TX.source && TX.kind == "tune";
  const sending = !tuning && (!!TX.source || (TX.sending && !TX.simulating));
  const simulating = TX.simulating || mmdSstvTxSimulating();
  const set = (button, on, busy) =>
  {
    button.classList.toggle("sstvTxOn", on);
    button.classList.toggle("sstvTxBusy", busy);
  };
  set(sstvTxSendButton, sending, tuning || simulating);
  set(sstvTxTuneButton, tuning, sending || simulating);
  set(sstvTxSimulateButton, simulating, sending || tuning);
  sstvTxSimulateLabel.classList.toggle("sstvTxHidden", simulating);
  sstvTxAbortLabel.classList.toggle("sstvTxHidden", !simulating);
}

// Simulate Rx's picture playing into the decoder (mmdTestStart)
function mmdSstvTxSimulating()
{
  return !!TEST.source && TEST.file == "sstv-simulate";
}

// Send: the picture sent, or (red: sending, or being built for it) stopped
function mmdSstvTxSendClick()
{
  if (sstvTxSendButton.classList.contains("sstvTxBusy")) return;
  if (sstvTxSendButton.classList.contains("sstvTxOn")) mmdSstvTxStop(I18N("sstvTx.status.stopped"));
  else mmdSstvTxSend();
}

// Tune: the tone sent, or (red) stopped
function mmdSstvTxTuneClick()
{
  if (sstvTxTuneButton.classList.contains("sstvTxBusy")) return;
  if (sstvTxTuneButton.classList.contains("sstvTxOn")) mmdSstvTxStop(I18N("sstvTx.status.stopped"));
  else mmdSstvTxTune();
}

// Simulate Rx: the picture played into the decoder, or (Abort) stopped
function mmdSstvTxSimulateClick()
{
  if (sstvTxSimulateButton.classList.contains("sstvTxBusy")) return;
  if (sstvTxSimulateButton.classList.contains("sstvTxOn"))
  {
    TX.simulating = false;
    mmdTestStop();
    mmdSstvTxButtons();
  }
  else mmdSstvTxSimulate();
}

// ---- The picture: a background, then the text over it, at the mode's size (TX.built); shown in the panel to fit its place

// The background for the choice: an image or canvas (drawn to cover the picture), or null (the color alone)
async function mmdSstvTxBackground(T)
{
  if (T.back == "logo") return TX.logo && TX.logo.complete && TX.logo.naturalWidth > 0 ? TX.logo : null;
  if (T.back == "waterfall") return cwFall.width > 0 ? cwFall : null;
  if (T.back == "image")
  {
    if (!T.image) return null;
    if (TX.image && TX.image.src == NodeURL.pathToFileURL(T.image).href && TX.image.complete) return TX.image.naturalWidth > 0 ? TX.image : null;
    TX.image = await mmdSstvTxLoad(NodeURL.pathToFileURL(T.image).href);
    return TX.image;
  }
  if (T.back == "map")
  {
    // The map as the main window shows it: that window's picture, the map's part of it (the main process takes it: a canvas drawn from
    // map tiles can't be read)
    try
    {
      const el = window.opener.GT.map.getTargetElement();
      const r = el.getBoundingClientRect();
      const rect = { x: Math.max(0, Math.round(r.left)), y: Math.max(0, Math.round(r.top)), width: Math.round(r.width), height: Math.round(r.height) };
      const url = rect.width > 0 && rect.height > 0 ? await electron.ipcRenderer.invoke("captureWindowImage", "GridTracker2", rect) : "";
      return url ? await mmdSstvTxLoad(url) : null;
    }
    catch (e)
    {
      return null;
    }
  }
  return null;
}

function mmdSstvTxLoad(url)
{
  return new Promise((resolve) =>
  {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

// The picture built (a canvas at the mode's size), the newest build the one kept
async function mmdSstvTxBuild()
{
  const T = mmdSstvTxSettings();
  const mode = sstvTxModeByName(T.mode);
  const generation = ++TX.building;
  const back = await mmdSstvTxBackground(T);
  if (generation != TX.building) return null;
  const canvas = document.createElement("canvas");
  canvas.width = mode.width;
  canvas.height = mode.height;
  const ctx = canvas.getContext("2d");
  const w = mode.width, h = mode.height;
  // The color: the whole picture, or what shows round a logo or image zoomed smaller than it (a map or the waterfall cover it)
  ctx.fillStyle = T.color;
  ctx.fillRect(0, 0, w, h);
  if (back)
  {
    const bw = back.naturalWidth || back.width, bh = back.naturalHeight || back.height;
    // Covering the picture, its shape kept, the middle shown; the logo and an image file also by their Zoom, and moved by X and Y (each
    // half their size at most, either way)
    const movable = T.back == "logo" || T.back == "image";
    const place = mmdSstvTxPlace(T) || { zoom: 1, x: 0, y: 0 };
    const scale = Math.max(w / bw, h / bh) * (movable ? place.zoom : 1);
    const dw = bw * scale, dh = bh * scale;
    const dx = movable ? (place.x / 100) * (dw / 2) : 0, dy = movable ? (place.y / 100) * (dh / 2) : 0;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(back, (w - dw) / 2 + dx, (h - dh) / 2 + dy, dw, dh);
  }
  // The text: your call, your grid and your line (each left out when unchecked or empty), each in its own color and size, at its own place
  // (one of SSTV_TX_PLACES); those at the same place stacked in that order, the stack put by the place's row and column within the room
  // it leaves (its first and last a little in from the edges)
  const app = window.opener.GT.settings.app;
  const lines = [];
  // (None with the Text turned off)
  if (T.textShow)
  {
    // Your call as GridTracker writes calls (formatCallsign: a slashed zero)
    if (T.call && app.myCall) lines.push({ key: "call", text: window.opener.formatCallsign(String(app.myCall).toUpperCase()) });
    if (T.grid && app.myGrid) lines.push({ key: "grid", text: String(app.myGrid).toUpperCase() });
    if (T.textOn && T.text.trim()) lines.push({ key: "text", text: T.text.trim() });
  }
  ctx.lineJoin = "round";
  const gap = h * 0.01;
  // The time stamp's box, worked out first so the text keeps clear of it
  const stamp = mmdSstvTxStamp(ctx, T, w, h);
  const edge = w * 0.03;
  // What is on the picture already, each { x, y, w, h }: the stamp's box, then each line as it is put (the places in order, top left first)
  const taken = stamp ? [{ x: stamp.bx, y: stamp.by, w: stamp.bw, h: stamp.bh }] : [];
  for (const place of SSTV_TX_PLACES)
  {
    const here = lines.filter((line) => T[line.key + "Pos"] == place).map((line) => Object.assign(line, { px: h * (SSTV_TX_SIZES[T[line.key + "Size"]] || SSTV_TX_SIZES.medium) }));
    if (!here.length) continue;
    // Its row and column as shares of the room the text leaves (0 at the top or left edge, 1 at the bottom or right, a half centered)
    const [rowAt, colAt] = place.split("-").map((n) => Number(n) / (SSTV_TX_GRID - 1));
    // Where each line's left end is (x) for the column
    for (const line of here)
    {
      line.shown = line.text;
      ctx.font = mmdSstvTxFont(T.textFont, line.px);
      while (line.shown.length > 1 && ctx.measureText(line.shown).width > w * 0.96) line.shown = line.shown.slice(0, -1);
      line.width = ctx.measureText(line.shown).width;
      line.x = edge + colAt * Math.max(0, w - 2 * edge - line.width);
    }
    const total = here.reduce((a, line) => a + line.px * 1.15 + gap, 0) - gap;
    let y = h * 0.05 + rowAt * Math.max(0, h * 0.9 - total);
    // A stack that would run into what is on the picture already (a line of it over the stamp's box or a line put before): moved up or
    // down to the nearest height where it runs into nothing and stays on the picture (just above or below something there); left where
    // it is if there is none
    const rects = (top) =>
    {
      let at = top;
      return here.map((line) =>
      {
        const r = { x: line.x, y: at, w: line.width, h: line.px * 1.15 };
        at += line.px * 1.15 + gap;
        return r;
      });
    };
    const hit = (top) => taken.find((t) => rects(top).some((r) => r.x < t.x + t.w + gap && r.x + r.w > t.x - gap && r.y < t.y + t.h + gap && r.y + r.h > t.y - gap));
    if (hit(y))
    {
      const wanted = y;
      const clear = taken.flatMap((t) => [t.y + t.h + gap, t.y - gap - total]).filter((top) => top >= 0 && top + total <= h && !hit(top));
      if (clear.length) y = clear.reduce((best, top) => (Math.abs(top - wanted) < Math.abs(best - wanted) ? top : best));
    }
    taken.push(...rects(y));
    for (const line of here)
    {
      ctx.font = mmdSstvTxFont(T.textFont, line.px);
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.lineWidth = Math.max(1, line.px / 7);
      ctx.strokeStyle = "black";
      ctx.fillStyle = T[line.key + "Color"];
      ctx.strokeText(line.shown, line.x, y);
      ctx.fillText(line.shown, line.x, y);
      y += line.px * 1.15 + gap;
    }
  }
  // The stamp in its corner: in its box (rounded, the text centred in it both ways, by the text's own ink) or outlined
  if (stamp)
  {
    if (T.stampBox == "color")
    {
      ctx.fillStyle = T.stampBoxColor;
      ctx.beginPath();
      ctx.roundRect(stamp.bx, stamp.by, stamp.bw, stamp.bh, Math.min(stamp.bh / 2, stamp.px * 0.35));
      ctx.fill();
    }
    ctx.font = mmdSstvTxFont(T.stampFont, stamp.px);
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    if (T.stampBox != "color")
    {
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(1, stamp.px / 7);
      ctx.strokeStyle = "black";
      ctx.strokeText(stamp.text, stamp.cx, stamp.baseline);
    }
    ctx.fillStyle = T.stampColor;
    ctx.fillText(stamp.text, stamp.cx, stamp.baseline);
  }
  TX.built = canvas;
  return canvas;
}

async function mmdSstvTxPreview()
{
  if (!mmdSstvTxShown()) return;
  await mmdSstvTxBuild();
  mmdSstvTxDraw();
  // The zoom box, open, over the picture as it is now (a place just picked in it)
  if (TX.zoomGrid && TX.built) sstvTxPlaceZoom.style.backgroundImage = "url(" + TX.built.toDataURL("image/png") + ")";
}

// The form's boxes in two columns when the picture, as large as it can be shown, still fits beside them: the space that would be bars
// either side of it goes to the settings instead (the form's widths: #sstvTxForm and .sstvTxTwoCol). Then the picture's place made
// exactly the picture's size (at most the mode's own resolution), the two centred together in the tab
const SSTV_TX_FORM_ONE = 340;
const SSTV_TX_FORM_TWO = 684;
// The tab's padding and the gap between the settings and the picture (#sstvSendBody), the picture's border, and its status line's height
const SSTV_TX_BODY_SPARE = 16;
const SSTV_TX_BORDER = 2;
const SSTV_TX_STATUS_H = 18;

function mmdSstvTxLayout()
{
  const mode = sstvTxModeByName(mmdSstvTxSettings().mode);
  const width = sstvSendBody.clientWidth - SSTV_TX_BODY_SPARE - SSTV_TX_BORDER;
  const height = sstvSendBody.clientHeight - 8 - SSTV_TX_BORDER - SSTV_TX_STATUS_H;
  // The picture's size beside a form of this width: as large as the room allows, never larger than the mode's own resolution
  const fit = (formWidth) => Math.max(0, Math.min(1, (width - formWidth) / mode.width, height / mode.height));
  // The boxes' heights as they are (their title and table, whatever their column): stacked in one column, or two a row
  const boxes = [...sstvTxForm.querySelectorAll(".mapGroup")].map((g) => g.firstElementChild.offsetHeight + g.querySelector("table").offsetHeight + 12);
  const gap = 4;
  const oneTall = boxes.reduce((a, h) => a + h, 0) + gap * (boxes.length - 1);
  let twoTall = 0;
  for (let i = 0; i < boxes.length; i += 2) twoTall += Math.max(boxes[i], boxes[i + 1] || 0) + (i ? gap : 0);
  const room = sstvSendBody.clientHeight - 8;
  // Two columns when the picture is as large beside them as beside one, or when one column wouldn't fit the height (two scroll less, if
  // at all: the picture a little smaller is better than settings out of sight)
  const two = fit(SSTV_TX_FORM_TWO) >= fit(SSTV_TX_FORM_ONE) - 0.001 || (oneTall > room && twoTall < oneTall);
  if (sstvTxForm.classList.contains("sstvTxTwoCol") != two) sstvTxForm.classList.toggle("sstvTxTwoCol", two);
  const scale = fit(two ? SSTV_TX_FORM_TWO : SSTV_TX_FORM_ONE);
  const cssW = Math.max(1, Math.floor(mode.width * scale)), cssH = Math.max(1, Math.floor(mode.height * scale));
  if (sstvTxPreview.style.width != cssW + "px") sstvTxPreview.style.width = cssW + "px";
  if (sstvTxPreview.style.height != cssH + "px") sstvTxPreview.style.height = cssH + "px";
  // The status line under it as wide as the picture (a long one cut short, not widening it)
  sstvTxRight.style.width = cssW + SSTV_TX_BORDER + "px";
}

// The picture built drawn in the Send tab, to fit (its shape kept), at most at the mode's own resolution (a screen pixel a picture pixel:
// no bigger than what is sent)
function mmdSstvTxDraw()
{
  if (!TX.built || !mmdSstvTxShown() || DEC.mode != "sstv") return;
  mmdSstvTxLayout();
  const ratio = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(sstvTxPreview.clientWidth * ratio)), h = Math.max(1, Math.round(sstvTxPreview.clientHeight * ratio));
  if (sstvTxPreview.width != w || sstvTxPreview.height != h)
  {
    sstvTxPreview.width = w;
    sstvTxPreview.height = h;
  }
  const ctx = sstvTxPreview.getContext("2d");
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, w, h);
  const scale = Math.min(w / TX.built.width, h / TX.built.height, ratio);
  const dw = Math.round(TX.built.width * scale), dh = Math.round(TX.built.height * scale);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(TX.built, Math.round((w - dw) / 2), Math.round((h - dh) / 2), dw, dh);
}

// ---- Sending

function mmdSstvTxActive()
{
  return !!TX.source;
}

// A picture being sent or built to be sent, or Tune: what keys the rig (Simulate Rx doesn't). Stopped when the mode changes, Detect Modes
// starts or the window closes (mmdModeSet, mmdDetectStart, mmdVisible)
function mmdSstvTxKeying()
{
  return !!TX.source || TX.starting > 0 || (TX.sending && !TX.simulating);
}

function mmdSstvTxStatus(text, error = false)
{
  sstvTxStatus.textContent = text;
  sstvTxStatus.style.color = error ? "var(--gt-error)" : "";
  if (text) mmdStatus(text, error);
}

// What can be sent now: the Output Device, and the SSTV VFO's rig keyed its PTT Method's way (rigCanPtt: CAT, DTR or RTS with the rig
// connected; VOX needs nothing of it), and not BirdWatch's meanwhile. { device, vfo, method }, or null with the status saying why
function mmdSstvTxReady()
{
  const device = mmdOutputFind("sstv");
  if (!device)
  {
    mmdSstvTxStatus(I18N("sstvTx.status.noOutput"), true);
    return null;
  }
  const opener = window.opener;
  const vfo = GT.settings.MMD.rigControl === true ? opener.mmDecoderVfo("sstv") : null;
  if (!vfo)
  {
    mmdSstvTxStatus(I18N("sstvTx.status.noRig"), true);
    return null;
  }
  const method = opener.rigPttMethod(vfo.id);
  if (method == "none")
  {
    mmdSstvTxStatus(I18N("sstvTx.status.pttNone"), true);
    return null;
  }
  if (!opener.rigCanPtt(vfo.id))
  {
    const R = opener.rigVfoLink(vfo);
    mmdSstvTxStatus(I18N(R && R.status == "connected" ? "sstvTx.status.noPtt" : "sstvTx.status.noRig"), true);
    return null;
  }
  if (opener.mmDecoderRigLocked())
  {
    mmdSstvTxStatus(I18N("sstvTx.status.rigLocked"), true);
    return null;
  }
  return { device, vfo, method };
}

// Send: the picture built, encoded and sent
async function mmdSstvTxSend()
{
  if (TX.source) return;
  const T = mmdSstvTxSettings();
  const mode = sstvTxModeByName(T.mode);
  if (!mmdSstvTxReady() || TX.sending) return;
  // (The Map refresh waits, so this build is the one kept)
  TX.sending = true;
  const send = ++TX.sends;
  mmdSstvTxButtons();
  mmdSstvTxStatus(I18N("sstvTx.status.building"));
  // Built again as it is sent (the time stamp's time the current one), and shown as sent
  const picture = await mmdSstvTxBuild();
  // (Stopped and Send clicked again meanwhile: TX.sending is the newer one's)
  if (TX.sends != send) return;
  if (picture) mmdSstvTxDraw();
  // (Stopped while it was built: TX.sending let go, nothing sent)
  if (!picture || TX.source || !TX.sending)
  {
    if (!TX.sending) return;
    TX.sending = false;
    mmdSstvTxStatus(picture ? "" : I18N("sstvTx.status.failed") + " " + I18N("sstvTx.status.building"), !picture);
    return;
  }
  const rgba = picture.getContext("2d").getImageData(0, 0, mode.width, mode.height).data;
  await mmdSstvTxStart("picture", (rate, amp, method) =>
  {
    const audio = sstvTxEncode(mode, rgba, rate, amp, method == "vox" ? SSTV_TX_VOX_LEAD_S : 0);
    TX.mode = mode;
    TX.lead = audio.lead;
    TX.lines = audio.lines;
    return audio;
  }, (seconds) => I18N("sstvTx.status.sent").replace("{mode}", mode.name).replace("{seconds}", Math.round(seconds)));
  if (TX.sends == send) TX.sending = false;
  mmdSstvTxButtons();
}

// Simulate Rx: the picture built and encoded as Send would, played into the decoder's own input as a test signal is (mmdTestStart: the
// Input Device silenced and a noise floor in its place, the pictures received kept, the one it makes not saved by itself), nothing keyed
// or sent; the Receive tab shown once it starts
const SSTV_TX_SIMULATE_AMP = 0.5;
const SSTV_TX_SIMULATE_LEAD_S = 0.5;

async function mmdSstvTxSimulate()
{
  if (TX.source || TX.sending) return;
  if (!DEC.ctx || !DEC.node)
  {
    mmdSstvTxStatus(I18N("sstvTx.status.notListening"), true);
    return;
  }
  const T = mmdSstvTxSettings();
  const mode = sstvTxModeByName(T.mode);
  TX.sending = true;
  TX.simulating = true;
  mmdSstvTxButtons();
  mmdSstvTxStatus(I18N("sstvTx.status.building"));
  const picture = await mmdSstvTxBuild();
  if (picture) mmdSstvTxDraw();
  TX.sending = false;
  // (Aborted while it was built: nothing played)
  const aborted = !TX.simulating;
  TX.simulating = false;
  mmdSstvTxButtons();
  if (aborted)
  {
    mmdSstvTxStatus("");
    return;
  }
  const ctx = DEC.ctx;
  if (!picture || !ctx || !DEC.node || TX.source)
  {
    mmdSstvTxStatus(picture ? "" : I18N("sstvTx.status.failed") + " " + I18N("sstvTx.status.building"), !picture);
    return;
  }
  const rgba = picture.getContext("2d").getImageData(0, 0, mode.width, mode.height).data;
  const audio = sstvTxEncode(mode, rgba, ctx.sampleRate, SSTV_TX_SIMULATE_AMP, SSTV_TX_SIMULATE_LEAD_S);
  const buffer = ctx.createBuffer(1, audio.samples.length, ctx.sampleRate);
  buffer.copyToChannel(audio.samples, 0);
  if (!mmdTestStart({ file: "sstv-simulate" }, buffer, false))
  {
    mmdSstvTxStatus(I18N("sstvTx.status.notListening"), true);
    return;
  }
  mmdSstvTxButtons();
  // (The window's status too: "Building the picture" is over)
  mmdSstvTxStatus("");
  mmdStatus("");
  mmdSstvTab("receive");
}

// Tune (its button): a steady full-scale tone at the Power (as WSJT-X's Tune: its tone held, less its Pwr slider), for SSTV_TX_TUNE_S at
// most or until clicked again, to set the rig's drive by
function mmdSstvTxTune()
{
  if (TX.source || TX.sending || !mmdSstvTxReady()) return;
  mmdSstvTxStart("tune", (rate, amp) =>
  {
    const samples = sstvTxRender({ hz: [SSTV_TX_TUNE_HZ], len: [SSTV_TX_TUNE_S] }, rate, amp).samples;
    return { samples, seconds: SSTV_TX_TUNE_S };
  }, () => I18N("sstvTx.status.stopped"));
}

// The audio path, a picture's or Tune's: the Output Device's context, the audio made full scale by make(rate, amp, method) ({ samples,
// seconds }) played on it through the Power's gain (changed as it plays), the rig keyed first by its PTT Method (VOX: by the audio
// itself), the decoder silenced meanwhile; ended(seconds) says what the status shows when it has all gone out. The last sending's rig,
// if it still waits for its tail, is unkeyed first (its tail would otherwise unkey this one's)
async function mmdSstvTxStart(kind, make, ended)
{
  const ready = mmdSstvTxReady();
  if (!ready || TX.source) return;
  mmdSstvTxUnkey();
  const stops = TX.stops;
  let ctx = null;
  try
  {
    // A network stream (mmdNetAudio.js): its own context, at the stream's rate, what it plays sent; else the sound card's
    let out = null;
    if (ready.device.netAudio)
    {
      let net;
      TX.starting++;
      try
      {
        net = await mmdNetOutput(ready.device);
      }
      finally
      {
        TX.starting--;
      }
      // (Another started meanwhile, or stopped: nothing sent)
      if (TX.source || TX.stops != stops)
      {
        net.ctx.close().catch(() => {});
        mmdNetOutputStop(net.token);
        return;
      }
      ctx = net.ctx;
      out = net.node;
      TX.netToken = net.token;
    }
    else
    {
      // "interactive", never "playback": a "playback" context misses a render callback now and then (measured 2026-11-11, the decoder's
      // own context: about 20 ms every 10 to 20 s), which would leave holes in the picture sent
      const options = { latencyHint: "interactive" };
      if (ready.device.deviceId && ready.device.deviceId != "default") options.sinkId = ready.device.deviceId;
      ctx = new AudioContext(options);
      out = ctx.destination;
    }
    const audio = make(ctx.sampleRate, 1, ready.method);
    const buffer = ctx.createBuffer(1, audio.samples.length, ctx.sampleRate);
    buffer.copyToChannel(audio.samples, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = mmdSstvTxAmp();
    source.connect(gain);
    gain.connect(out);
    TX.ctx = ctx;
    TX.source = source;
    TX.gain = gain;
    TX.kind = kind;
    // The decoder hears nothing meanwhile (not its own picture back from the rig): mmdSwApply
    mmdSwApply();
    mmdSstvTxButtons();
    if (ready.method != "vox")
    {
      window.opener.rigPtt(ready.vfo.id, true);
      TX.pttVfo = ready.vfo.id;
      await new Promise((r) => nodeTimers.setTimeout(r, SSTV_TX_PTT_LEAD_MS));
      if (TX.source != source) return;
    }
    source.onended = () =>
    {
      if (TX.source != source) return;
      mmdSstvTxStop(ended(audio.seconds));
    };
    source.start();
    TX.startAt = ctx.currentTime;
    TX.timer = nodeTimers.setInterval(mmdSstvTxTick, 250);
    TX.watchdog = nodeTimers.setTimeout(() => mmdSstvTxStop(I18N("sstvTx.status.stopped")), (audio.seconds + SSTV_TX_WATCHDOG_S) * 1000);
    mmdSstvTxTick();
  }
  catch (e)
  {
    if (ctx && TX.ctx != ctx)
    {
      ctx.close().catch(() => {});
      mmdNetOutputStop(TX.netToken);
      TX.netToken = null;
    }
    mmdSstvTxStop(I18N("sstvTx.status.failed") + " " + ((e && e.message) || String(e)), true);
  }
}

// The status as it goes: the line being sent, or Tune's seconds
function mmdSstvTxTick()
{
  if (!TX.source || !TX.ctx) return;
  const elapsed = TX.ctx.currentTime - TX.startAt;
  if (TX.kind == "tune")
  {
    mmdSstvTxStatus(I18N("sstvTx.status.tuning").replace("{seconds}", Math.min(SSTV_TX_TUNE_S, Math.floor(elapsed))).replace("{max}", SSTV_TX_TUNE_S));
    return;
  }
  const line = Math.max(0, Math.min(TX.lines, Math.floor((elapsed - TX.lead) / TX.mode.line) + 1));
  mmdSstvTxStatus(I18N("sstvTx.status.sending").replace("{mode}", TX.mode.name).replace("{line}", line).replace("{lines}", TX.lines));
}

// Over (sent, stopped, failed, the window closing): the audio stopped, the rig unkeyed a moment after (at once on an error), the decoder
// hearing again
function mmdSstvTxStop(text = "", error = false)
{
  TX.stops++;
  nodeTimers.clearInterval(TX.timer);
  nodeTimers.clearTimeout(TX.watchdog);
  TX.timer = null;
  TX.watchdog = null;
  // The last sending's rig, still waiting for its tail: unkeyed now
  mmdSstvTxUnkey();
  const source = TX.source, ctx = TX.ctx, netToken = TX.netToken;
  TX.netToken = null;
  TX.source = null;
  TX.ctx = null;
  TX.gain = null;
  TX.kind = null;
  TX.sending = false;
  if (source)
  {
    try
    {
      source.onended = null;
      source.stop();
    }
    catch (e)
    {
      // Never started, or its context closed
    }
  }
  const unkey = () =>
  {
    if (ctx) ctx.close().catch(() => {});
    // A network output let go with it (what was played has gone out by now)
    mmdNetOutputStop(netToken);
    if (TX.pttVfo)
    {
      try
      {
        window.opener.rigPtt(TX.pttVfo, false);
      }
      catch (e)
      {
        // The main window going away
      }
      TX.pttVfo = null;
    }
  };
  // (Kept while it waits: a new sending, or the window closing, has it done at once, mmdSstvTxUnkey)
  if (TX.pttVfo && !error)
  {
    TX.unkey = unkey;
    TX.unkeyTimer = nodeTimers.setTimeout(mmdSstvTxUnkey, SSTV_TX_PTT_TAIL_MS);
  }
  else unkey();
  mmdSwApply();
  // What the decoder had of the sending (little: it was silenced) let go
  if (DEC.mode == "sstv") mmdSstvReset();
  mmdSstvTxButtons();
  if (text) mmdSstvTxStatus(text, error);
}

// The last sending's rig unkeyed, if it waits for its tail (mmdSstvTxStop): when the tail is over, or at once as another sending starts
// or the sending is stopped again
function mmdSstvTxUnkey()
{
  nodeTimers.clearTimeout(TX.unkeyTimer);
  TX.unkeyTimer = null;
  const unkey = TX.unkey;
  TX.unkey = null;
  if (unkey) unkey();
}
