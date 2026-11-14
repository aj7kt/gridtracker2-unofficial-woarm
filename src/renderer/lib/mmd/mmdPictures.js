// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Multi-Mode Decoder's picture view (sstvView): the pictures a mode receives (SSTV's, mmdSstv.js; a plugin's through host.pictures:
// WEFAX's charts), each kind's own list, shown in its own mode. Each one drawn as it comes in, the newest few kept in a strip beside it
// (a click shows one large, a click on the large one goes back to the newest), saved as it ends (its kind's Save setting) or any one
// with a right-click, which also copies, turns, filters and deletes it. A kind whose pictures' length isn't known as they start (grows:
// WEFAX's) has its canvas made longer as their lines come.
// A kind (mmdPicturesKind): { kind, modes (the Mode menu's), folder() (where its pictures are saved), saveKey (its Save setting in
// GT.settings.MMD), idleKey (the header's text with nothing coming in), grows, background ("black" or "white": a picture's canvas before
// its rows come), planes (3, or 1 for grey: Filter's Undo kept smaller), tabs (SSTV's Receive and Send tabs shown), datestamp (its caption
// shows the UTC date before the time, WEFAX's), describe(pic, live)
// (its own words for how much of a picture came, else SSTV's line counts), fromFile(name) (a saved file's name part, as mmdPicFileName
// wrote it, claimed as its kind's: its shown name, else null), catchAll (claims any name the others don't: SSTV's), chartTools (its
// right-click also prints and shows its file in its folder, and each one is lined up and cropped as it ends, when its Auto-Align and
// Auto-Crop settings are on (<kind>AutoAlign, <kind>AutoCrop in GT.settings.MMD; WEFAX's on Settings, Decoders): WEFAX's),
// station({ at, dial, station }) (the station a saved picture is from, its file name's station id or null: { id, label } or null; one
// coming in names its own, mmdPicStart's m.station) }

// Pictures kept in the strip (each kind's)
const PICS_KEEP = 12;
// A growing picture's canvas is made this many lines longer each time its lines run past its end
const PICS_GROW_ROWS = 600;
// The caption over the picture shown: its font this many times the header's (a chart kind's, chartTools, this much of that), its colors
// (the station, on a line above the rest; the mode, the UTC date and time, the frequency, the band, Saved)
const PICS_CAPTION_SCALE = 2;
const PICS_CHART_CAPTION_SCALE = 0.75;
const PICS_CAPTION_COLORS = { station: "#fc6", name: "#8cf", time: "#fff", freq: "#8f8", band: "#ff0", saved: "#bbb" };
// A chart kind's (chartTools) columns of margin Auto-Align leaves before a chart's left edge and Auto-Crop around it, and the dark level
// (0 black, 255 white) the two count as ink
const PICS_EDGE_PAD = 8;
const PICS_INK_LEVEL = 128;
// Filter's choices, in its submenu's order (each PICS_FILTER's, its label cwViewer.picture.filter<Name>.label), and the Undo steps kept
// for each picture (the oldest let go past it)
const PICS_FILTERS = ["sharpen", "denoise", "smooth", "autoContrast", "equalize", "lighten", "darken", "invert"];
const PICS_UNDO_KEEP = 20;
// A turned picture's thumbnail made again with the rows that have come since, at most this often
const PICS_THUMB_TURNED_MS = 3000;

const PICS = {
  kinds: {},       // by kind (mmdPicturesKind)
  order: [],       // the kinds, in the order they were registered
  lists: {},       // each kind's pictures, the newest first: { id, kind, name, width, height, canvas, rows, complete, at (ms, its start),
                   // dial (Hz on the air or null), shift, saved, files, rotate, undo, station (its station's name to show, or null),
                   // stationId (in its file name) }
  views: {},       // each kind's one shown large (a click on the strip); null: the newest
  live: null,      // the one coming in (any kind's)
  drawQueued: false,
  savedLoaded: {}  // each kind's saved pictures put in its strip this window (mmdPicLoadSaved)
};

// A kind of picture: its list kept from now on
function mmdPicturesKind(def)
{
  if (!def || !def.kind || PICS.kinds[def.kind]) return;
  def.modes = Array.isArray(def.modes) ? def.modes : [def.kind];
  PICS.kinds[def.kind] = def;
  PICS.order.push(def.kind);
  PICS.lists[def.kind] = [];
  PICS.views[def.kind] = null;
  PICS.savedLoaded[def.kind] = false;
}

// The view's own events, once (mmdInit)
function mmdPicInit()
{
  // A click: back to the newest
  sstvPicture.addEventListener("click", () => mmdPicView(null));
  sstvPicture.addEventListener("contextmenu", (event) => mmdPicMenu(event, mmdPicShown()));
  window.addEventListener("resize", mmdPicDraw);
  window.addEventListener("keydown", mmdPicKey);
}

// Up and Down arrows: the picture above or below the one shown in the strip, as a click on it (the top one: back to the newest). Not
// while typing in a box or a menu has the keys, with a modifier held, or with Settings open
function mmdPicKey(event)
{
  if (event.key != "ArrowUp" && event.key != "ArrowDown") return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !mmdPicMode()) return;
  if (typeof mmdSettings != "undefined" && mmdSettings.style.display == "flex") return;
  const el = document.activeElement;
  if (el && (el.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName))) return;
  const list = mmdPicList();
  const at = list.indexOf(mmdPicShown());
  if (at < 0) return;
  event.preventDefault();
  const next = Math.max(0, Math.min(list.length - 1, at + (event.key == "ArrowDown" ? 1 : -1)));
  if (next == at) return;
  mmdPicView(next == 0 ? null : list[next].id);
  mmdPicStripReveal();
}

// The strip scrolled (its own scroller, not the page) just enough to show the outlined thumbnail
function mmdPicStripReveal()
{
  const item = sstvStrip.querySelector(".sstvThumbShown");
  if (!item) return;
  let box = sstvStrip;
  while (box && box != document.body && box.scrollHeight <= box.clientHeight + 1 && box.scrollWidth <= box.clientWidth + 1) box = box.parentElement;
  if (!box || box == document.body) return;
  // (with its margin, so the top one goes right back to the top)
  const m = parseFloat(window.getComputedStyle(item).margin) || 0;
  const r = item.getBoundingClientRect(), b = box.getBoundingClientRect();
  if (r.top - m < b.top) box.scrollTop -= b.top - r.top + m;
  else if (r.bottom + m > b.bottom) box.scrollTop += r.bottom + m - b.bottom;
  if (r.left - m < b.left) box.scrollLeft -= b.left - r.left + m;
  else if (r.right + m > b.right) box.scrollLeft += r.right + m - b.right;
}

// The kind shown in a mode (DEC.mode by default), else null
function mmdPicKindOf(mode = DEC.mode)
{
  for (const kind of PICS.order) if (PICS.kinds[kind].modes.includes(mode)) return PICS.kinds[kind];
  return null;
}

// A mode with pictures (DEC.mode by default)
function mmdPicMode(mode = DEC.mode)
{
  return !!mmdPicKindOf(mode);
}

// The kind shown now's name, else null
function mmdPicKind()
{
  const def = mmdPicKindOf();
  return def ? def.kind : null;
}

// A kind's pictures (the one shown now's by default)
function mmdPicList(kind = mmdPicKind())
{
  return (kind && PICS.lists[kind]) || [];
}

// The view shown in a mode with pictures, hidden in the others; SSTV's Receive and Send tabs only for a kind that has them (mmdModeSet,
// after every registration's shown)
function mmdPicShowView()
{
  const def = mmdPicKindOf();
  sstvView.style.display = def ? "" : "none";
  sstvTxTab.style.display = sstvRxTab.style.display = def && def.tabs ? "" : "none";
}

// ---- A picture coming in (a kind's decoder: SSTV's worker, a plugin's)

// One starting (m: { id, name, width, height: its lines, 0 for a kind that grows; shift: Hz its sender is from where its tones belong;
// station: { id, label } it is from, or none }): a canvas of its own, first in its kind's strip, the one coming in
function mmdPicStart(kind, m)
{
  const def = PICS.kinds[kind];
  if (!def) return null;
  const height = def.grows ? PICS_GROW_ROWS : m.height;
  const canvas = document.createElement("canvas");
  canvas.width = m.width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = def.background || "black";
  ctx.fillRect(0, 0, m.width, height);
  const pic = { id: m.id, kind, name: m.name, width: m.width, height: def.grows ? 0 : m.height, canvas, rows: 0, complete: false, at: Date.now(), dial: mmdDial(), shift: Math.round(m.shift || 0), saved: null };
  mmdPicStation(pic, m.station);
  const list = PICS.lists[kind];
  list.unshift(pic);
  if (list.length > PICS_KEEP) list.length = PICS_KEEP;
  if (PICS.views[kind] && !list.some((p) => p.id == PICS.views[kind])) PICS.views[kind] = null;
  PICS.live = pic;
  mmdPicStrip();
  mmdPicDraw();
  mmdPicHead();
  // The waterfall's guides moved to where this sender is
  mmdOverlay();
  return pic;
}

// The station a picture is from ({ id, label }, or none): its name shown over its caption, its id in its file name
function mmdPicStation(pic, station)
{
  const label = station && station.label ? String(station.label) : "";
  pic.station = label || null;
  pic.stationId = label && station.id ? String(station.id).replace(/[^A-Za-z0-9-]+/g, "") || null : null;
}

function mmdPicFind(kind, id)
{
  return (PICS.lists[kind] || []).find((p) => p.id == id) || null;
}

// Rows of one (RGBA, count rows from from)
function mmdPicRows(kind, id, from, count, rgba)
{
  const pic = mmdPicFind(kind, id);
  if (!pic) return;
  const grows = PICS.kinds[kind].grows;
  if (grows) mmdPicRoom(pic, from + count);
  pic.canvas.getContext("2d").putImageData(new ImageData(rgba, pic.width, count), 0, from);
  pic.rows = Math.max(pic.rows, from + count);
  if (grows) pic.height = pic.rows;
  // A turned one's thumbnail kept up with it as it comes in
  mmdPicThumbTurned(pic);
  mmdPicDraw();
}

// Drawn again from its top (count rows of RGBA: a better line rate), over the rows it had; every row ever shown stays shown
function mmdPicRedraw(kind, id, count, rgba, thumb = true)
{
  const pic = mmdPicFind(kind, id);
  if (!pic || !(count > 0)) return;
  const grows = PICS.kinds[kind].grows;
  if (grows) mmdPicRoom(pic, count);
  pic.canvas.getContext("2d").putImageData(new ImageData(rgba, pic.width, count), 0, 0);
  pic.rows = Math.max(pic.rows, count);
  if (grows) pic.height = pic.rows;
  if (thumb) mmdPicThumbTurned(pic);
  mmdPicDraw();
}

// One ended (complete: all of it came): nothing of it ever drawn, off the strip; else a chart kind's lined up and cropped (its Auto-Align
// and Auto-Crop, where ticked), then saved however much of it came, with its kind's Save, not a test signal's (mmdTest.js)
function mmdPicDone(kind, id, complete)
{
  const pic = mmdPicFind(kind, id);
  if (!pic) return;
  const def = PICS.kinds[kind];
  pic.complete = complete;
  if (PICS.live == pic) PICS.live = null;
  if (pic.rows == 0) PICS.lists[kind] = PICS.lists[kind].filter((p) => p != pic);
  else
  {
    if (def.chartTools)
    {
      if (GT.settings.MMD[kind + "AutoAlign"] === true) mmdPicAutoAlign(pic);
      if (GT.settings.MMD[kind + "AutoCrop"] === true) mmdPicAutoCrop(pic);
    }
    if (GT.settings.MMD[def.saveKey] && !mmdTestHeard(pic.at, Date.now())) mmdPicSave(pic, null);
  }
  mmdPicStrip();
  mmdPicHead();
  mmdPicDraw();
}

// Listening afresh (a kind's decoder let go of what it read): its picture coming in isn't any more
function mmdPicReset(kind)
{
  if (PICS.live && PICS.live.kind == kind) PICS.live = null;
  mmdPicHead();
}

// Clear: a kind's strip emptied (saved pictures stay where they are)
function mmdPicClear(kind)
{
  mmdPicReset(kind);
  PICS.lists[kind] = [];
  PICS.views[kind] = null;
  mmdPicStrip();
  mmdPicDraw();
}

// Its mode picked: the first time in this window, its saved pictures in its strip; the view drawn afresh
function mmdPicEntered(kind)
{
  mmdPicLoadSaved(kind);
  mmdPicStrip();
  mmdPicDraw();
  mmdPicHead();
}

// How far the newest picture's sender is from where its tones belong (Hz): the waterfall's guides are drawn there (mmdOverlay)
function mmdPicShift(kind = mmdPicKind())
{
  const list = mmdPicList(kind);
  return list.length ? list[0].shift : 0;
}

// A grey picture's levels (0 black, 255 white) as RGBA
function mmdPicGrey(grey)
{
  const rgba = new Uint8ClampedArray(grey.length * 4);
  for (let i = 0, j = 0; i < grey.length; i++, j += 4)
  {
    rgba[j] = rgba[j + 1] = rgba[j + 2] = grey[i];
    rgba[j + 3] = 255;
  }
  return rgba;
}

// A growing picture's canvas long enough for rows lines: a longer one (its kind's background below), what it had copied in, and the strip
// shown again (it holds the canvas itself)
function mmdPicRoom(pic, rows)
{
  if (rows <= pic.canvas.height) return;
  const canvas = document.createElement("canvas");
  canvas.width = pic.width;
  canvas.height = Math.ceil(rows / PICS_GROW_ROWS) * PICS_GROW_ROWS;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = PICS.kinds[pic.kind].background || "black";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(pic.canvas, 0, 0);
  pic.canvas = canvas;
  mmdPicStrip();
}

// ---- The view

// The picture shown large: the one clicked in the strip, else the newest
function mmdPicShown()
{
  const kind = mmdPicKind();
  const list = mmdPicList(kind);
  return list.find((p) => p.id == PICS.views[kind]) || list[0] || null;
}

function mmdPicView(id)
{
  const kind = mmdPicKind();
  if (!kind) return;
  PICS.views[kind] = id;
  mmdPicStrip();
  mmdPicDraw();
  mmdPicHead();
}

// The large picture drawn to fit its place (its shape kept), at the next frame
function mmdPicDraw()
{
  if (PICS.drawQueued) return;
  PICS.drawQueued = true;
  window.requestAnimationFrame(() =>
  {
    PICS.drawQueued = false;
    if (!mmdPicMode()) return;
    const ratio = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(sstvPicture.clientWidth * ratio));
    const h = Math.max(1, Math.round(sstvPicture.clientHeight * ratio));
    if (sstvPicture.width != w || sstvPicture.height != h)
    {
      sstvPicture.width = w;
      sstvPicture.height = h;
    }
    const ctx = sstvPicture.getContext("2d");
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, w, h);
    const pic = mmdPicShown();
    if (!pic) return;
    // Its caption on top, the picture in the room under it
    const top = mmdPicCaption(ctx, pic, w, ratio);
    const room = Math.max(1, h - top);
    // (A growing one: the lines it has so far; until it has a few, as if it were as long as half its width)
    const grows = PICS.kinds[pic.kind].grows;
    const height = grows ? Math.max(pic.rows, 1) : pic.height;
    ctx.imageSmoothingEnabled = true;
    const rotate = pic.rotate || 0;
    if (!rotate)
    {
      const shape = grows ? Math.max(height, pic.width / 2) : height;
      const scale = Math.min(w / pic.width, room / shape);
      const dw = pic.width * scale, dh = height * scale, dx = (w - dw) / 2, dy = top + (room - shape * scale) / 2;
      ctx.drawImage(pic.canvas, 0, 0, pic.width, height, dx, dy, dw, dh);
    }
    else
    {
      // Turned (mmdPicRotate): fitted as it is shown, drawn about its middle
      const turned = rotate % 180 != 0;
      const sw = turned ? height : pic.width, sh = turned ? pic.width : height;
      const scale = Math.min(w / sw, room / sh);
      const bw = sw * scale, bh = sh * scale, bx = (w - bw) / 2, by = top + (room - bh) / 2;
      ctx.save();
      ctx.translate(bx + bw / 2, by + bh / 2);
      ctx.rotate((rotate * Math.PI) / 180);
      ctx.drawImage(pic.canvas, 0, 0, pic.width, height, (-pic.width * scale) / 2, (-height * scale) / 2, pic.width * scale, height * scale);
      ctx.restore();
    }
  });
}

// A picture's UTC start: its time, and its date before it for a kind that shows one (datestamp): "2026-11-13 12:34:56 UTC"
function mmdPicWhen(pic)
{
  const t = new Date(pic.at).toISOString();
  return (PICS.kinds[pic.kind] && PICS.kinds[pic.kind].datestamp ? t.slice(0, 10) + " " : "") + t.slice(11, 19) + " UTC";
}

// The caption over the picture shown, centered: the station it is from on a line of its own (orange), then its mode (light blue), UTC date
// and time (white), frequency on the air (light green) with its band (yellow; none for a kind whose frequencies are all outside the
// amateur bands, BANDS_NOTE_MODES: WEFAX's), and Saved once it is; each line smaller where it is too narrow for it. Its height (device
// pixels)
function mmdPicCaption(ctx, pic, w, ratio)
{
  const C = PICS_CAPTION_COLORS;
  const parts = [[pic.name, C.name], [mmdPicWhen(pic), C.time]];
  if (pic.dial)
  {
    parts.push([(pic.dial / 1e6).toFixed(3) + " MHz", C.freq]);
    const band = mmdPicBandShown(pic) ? mmdBandOf(pic.dial) : null;
    if (band) parts.push(["(" + band + ")", C.band]);
  }
  if (pic.saved) parts.push([I18N("cwViewer.sstv.saved"), C.saved]);
  const family = window.getComputedStyle(sstvHeadText).fontFamily;
  const chart = PICS.kinds[pic.kind] && PICS.kinds[pic.kind].chartTools;
  const size = parseFloat(window.getComputedStyle(sstvHeadText).fontSize) * PICS_CAPTION_SCALE * (chart ? PICS_CHART_CAPTION_SCALE : 1) * ratio;
  let top = 0;
  if (pic.station) top += mmdPicCaptionLine(ctx, [[pic.station, C.station]], w, top, size, family);
  return top + mmdPicCaptionLine(ctx, parts, w, top, size, family);
}

// A picture's band shown: not for a kind whose modes' frequencies are all outside the amateur bands (always "OOB")
function mmdPicBandShown(pic)
{
  const def = PICS.kinds[pic.kind];
  return !def || !def.modes.some((mode) => BANDS_NOTE_MODES.includes(mode));
}

// One line of the caption (parts: [text, color]) at top, centered, its font size made smaller where the line is too narrow for it. Its
// height
function mmdPicCaptionLine(ctx, parts, w, top, size, family)
{
  const measure = () =>
  {
    ctx.font = Math.round(size) + "px " + family;
    const gap = ctx.measureText("  ").width;
    return { gap, total: parts.reduce((sum, [t]) => sum + ctx.measureText(t).width, 0) + gap * (parts.length - 1) };
  };
  let m = measure();
  if (m.total > w * 0.96)
  {
    size *= (w * 0.96) / m.total;
    m = measure();
  }
  const height = Math.round(size * 1.5);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  let x = (w - m.total) / 2;
  for (const [t, color] of parts)
  {
    ctx.fillStyle = color;
    ctx.fillText(t, x, top + height / 2);
    x += ctx.measureText(t).width + m.gap;
  }
  return height;
}

// The strip: each picture's own canvas, shown small; the one shown large outlined
function mmdPicStrip()
{
  sstvStrip.replaceChildren();
  const shown = mmdPicShown();
  const list = mmdPicList();
  for (const pic of list)
  {
    const item = document.createElement("div");
    item.className = "sstvThumb" + (pic == shown ? " sstvThumbShown" : "");
    item.title = mmdPicDescribe(pic);
    // (Turned: a turned copy, made again as the strip is and, while it comes in, every PICS_THUMB_TURNED_MS (mmdPicThumbTurned); else the
    // picture's own canvas, which shows its rows as they come)
    pic.thumb = pic.rotate ? mmdPicTurned(pic) : null;
    pic.thumbAt = Date.now();
    item.appendChild(pic.thumb || pic.canvas);
    item.addEventListener("click", () => mmdPicView(pic == list[0] ? null : pic.id));
    item.addEventListener("contextmenu", (event) => mmdPicMenu(event, pic));
    sstvStrip.appendChild(item);
  }
}

// A picture told in a line: its station, mode, UTC date and time, frequency on the air (the strip's tooltips; not with caption false, the header's: the
// caption over the picture has them), and how much of it came (its kind's own words, else its lines of all of them)
function mmdPicDescribe(pic, caption = true)
{
  const parts = caption ? (pic.station ? [pic.station] : []).concat([pic.name, mmdPicWhen(pic)]) : [];
  if (caption && pic.dial) parts.push((pic.dial / 1e6).toFixed(3) + " MHz");
  // Its sender's tones this far from where they belong (it was found and read there)
  if (Math.abs(pic.shift) >= 25) parts.push((pic.shift > 0 ? "+" : "") + pic.shift + " Hz");
  const def = PICS.kinds[pic.kind];
  const own = def && typeof def.describe == "function" ? def.describe(pic, pic == PICS.live) : null;
  if (own) parts.push(...own);
  else if (pic == PICS.live) parts.push(I18N("cwViewer.sstv.line").replace("{line}", pic.rows).replace("{lines}", pic.height));
  else if (!pic.complete) parts.push(I18N("cwViewer.sstv.cut").replace("{line}", pic.rows).replace("{lines}", pic.height));
  if (caption && pic.saved) parts.push(I18N("cwViewer.sstv.saved"));
  return parts.join(" · ");
}

// The header over the picture (also what is dragged to share the room with the waterfall): the picture shown, or what is listened for
function mmdPicHead()
{
  const def = mmdPicKindOf();
  if (!def) return;
  const pic = mmdPicShown();
  const idle = I18N(def.idleKey);
  let text = pic ? mmdPicDescribe(pic, false) : idle;
  if (!PICS.live && pic) text += (text ? "  ·  " : "") + idle;
  if (PICS.views[def.kind] && pic) text += "  ·  " + I18N("cwViewer.sstv.newest");
  sstvHeadText.textContent = text;
}

// The right-click on a picture: Save Picture..., Copy To Clipboard, Rotate, Filter (not while it comes in), Delete (From Session; File,
// its saved files deleted; Both: those two only while a file it was saved to is still there). A chart kind's (chartTools) also: Print...,
// Show In Folder (while a file it was saved to is there), and Auto-Align and Auto-Crop done to this one now (not while it comes in; each
// an Undo step of Filter's: its settings' Auto-Align and Auto-Crop do every chart as it ends)
function mmdPicMenu(event, pic)
{
  event.preventDefault();
  event.stopPropagation();
  if (!pic) return;
  const remote = window.require("@electron/remote");
  // Rotate: turned from as it is now, or back as it was received
  const turn = (by) => ({ click: () => mmdPicRotate(pic, by == null ? null : ((pic.rotate || 0) + by) % 360) });
  const saved = mmdPicSavedFiles(pic).length > 0;
  const undo = (pic.undo || []).length;
  const filters = PICS_FILTERS.map((name) => ({ label: I18N("cwViewer.picture.filter" + name[0].toUpperCase() + name.slice(1) + ".label"), click: () => mmdPicFilter(pic, name) }));
  const chart = !!PICS.kinds[pic.kind].chartTools;
  const still = pic != PICS.live;
  // (An SSTV picture's Log QSO... first, with Log QSO on: mmdLogQso.js)
  const menu = remote.Menu.buildFromTemplate(mmdLogQsoPictureMenu(pic).concat([
    { label: I18N("cwViewer.sstv.save.label"), click: () => mmdPicSaveAs(pic) },
    { label: I18N("cwViewer.picture.copy.label"), click: () => mmdPicCopy(pic) },
    ...(chart
      ? [
          { label: I18N("cwViewer.picture.print.label"), click: () => mmdPicPrint(pic) },
          { label: I18N("cwViewer.picture.showFolder.label"), enabled: saved, click: () => mmdPicShowFile(pic) },
          { type: "separator" }
        ]
      : []),
    {
      label: I18N("cwViewer.picture.rotate.label"),
      submenu: [
        Object.assign({ label: I18N("cwViewer.picture.rotateRight.label") }, turn(90)),
        Object.assign({ label: I18N("cwViewer.picture.rotateLeft.label") }, turn(270)),
        Object.assign({ label: I18N("cwViewer.picture.rotateHalf.label") }, turn(180)),
        Object.assign({ label: I18N("cwViewer.picture.rotateNone.label"), enabled: !!pic.rotate }, turn(null))
      ]
    },
    {
      label: I18N("cwViewer.picture.filter.label"),
      enabled: still,
      submenu: filters.concat([
        { type: "separator" },
        { label: I18N("cwViewer.picture.filterUndo.label").replace("{count}", undo), enabled: undo > 0, click: () => mmdPicUndo(pic, 1) },
        { label: I18N("cwViewer.picture.filterUndoAll.label"), enabled: undo > 0, click: () => mmdPicUndo(pic, undo) }
      ])
    },
    ...(chart
      ? [
          { label: I18N("cwViewer.picture.autoAlign.label"), enabled: still, click: () => mmdPicAutoAlign(pic, true) },
          { label: I18N("cwViewer.picture.autoCrop.label"), enabled: still, click: () => mmdPicAutoCrop(pic, true) }
        ]
      : []),
    { type: "separator" },
    {
      label: I18N("cwViewer.picture.delete.label"),
      submenu: [
        { label: I18N("cwViewer.picture.deleteSession.label"), click: () => mmdPicDelete(pic) },
        { label: I18N("cwViewer.picture.deleteFile.label"), enabled: saved, click: () => mmdPicUnlink(pic) },
        {
          label: I18N("cwViewer.picture.deleteBoth.label"),
          enabled: saved,
          click: () =>
          {
            mmdPicUnlink(pic);
            mmdPicDelete(pic);
          }
        }
      ]
    }
  ]));
  menu.popup({ window: remote.getCurrentWindow() });
}

// The files a picture was saved to (by Save Picture... or its kind's Save) that are still there
function mmdPicSavedFiles(pic)
{
  return (pic.files || []).filter((file) => fs.existsSync(file));
}

// A picture's saved files deleted, the picture left in the session, not saved now
function mmdPicUnlink(pic)
{
  for (const file of mmdPicSavedFiles(pic))
  {
    try
    {
      fs.unlinkSync(file);
    }
    catch (e)
    {
      mmdStatus(I18N("cwViewer.sstv.deleteFailed") + " " + e.message, true);
    }
  }
  pic.files = mmdPicSavedFiles(pic);
  pic.saved = pic.files.length ? pic.files[pic.files.length - 1] : null;
  mmdPicStrip();
  mmdPicDraw();
  mmdPicHead();
}

function mmdPicThumbTurned(pic)
{
  if (!pic.rotate || !pic.thumb || !pic.thumb.parentNode || Date.now() - pic.thumbAt < PICS_THUMB_TURNED_MS) return;
  const fresh = mmdPicTurned(pic);
  pic.thumb.parentNode.replaceChild(fresh, pic.thumb);
  pic.thumb = fresh;
  pic.thumbAt = Date.now();
}

// A picture turned (degrees clockwise: 0, 90, 180, 270; null as received): shown, in the strip, and saved or copied that way. A file
// saved already stays as it was
function mmdPicRotate(pic, degrees)
{
  pic.rotate = degrees || 0;
  mmdPicStrip();
  mmdPicDraw();
}

// The picture as far as it came (a growing one: the rows received; its canvas grows PICS_GROW_ROWS at a time, its background below them),
// turned as it is shown: a canvas of its own
function mmdPicTurned(pic)
{
  const rows = PICS.kinds[pic.kind].grows && pic.rows > 0 ? Math.min(pic.rows, pic.canvas.height) : pic.canvas.height;
  const width = pic.canvas.width, rotate = pic.rotate || 0, turned = rotate % 180 != 0;
  const canvas = document.createElement("canvas");
  canvas.width = turned ? rows : width;
  canvas.height = turned ? width : rows;
  const ctx = canvas.getContext("2d");
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.drawImage(pic.canvas, 0, 0, width, rows, -width / 2, -rows / 2, width, rows);
  return canvas;
}

// ---- Filter

// A picture filtered in place (name: one of PICS_FILTERS), as far as it came: shown, in the strip, and saved or copied that way, what it
// was kept for Undo. A file saved already stays as it was
function mmdPicFilter(pic, name)
{
  mmdPicChange(pic, (planes, width, rows) => PICS_FILTER[name](planes, width, rows));
}

// A picture changed in place as far as it came (Filter, Auto-Align, Auto-Crop): change(planes, width, rows) works on its planes, and
// gives false for nothing done (no Undo step kept), or { planes, width, rows } for a new size (Auto-Crop). What it was kept for Undo;
// true once done
function mmdPicChange(pic, change)
{
  const width = pic.canvas.width, rows = pic.rows > 0 ? Math.min(pic.rows, pic.canvas.height) : pic.canvas.height;
  const image = pic.canvas.getContext("2d").getImageData(0, 0, width, rows);
  // (A grey kind's: one plane, so its Undo steps take a quarter of the room; else red, green and blue)
  const planes = mmdPicPlanes(image.data, PICS.kinds[pic.kind].planes || 3);
  const before = { width, rows, height: pic.height, planes: planes.map((p) => p.slice()) };
  const out = change(planes, width, rows);
  if (out === false) return false;
  pic.undo = (pic.undo || []).concat([before]).slice(-PICS_UNDO_KEEP);
  if (out && out.planes)
  {
    mmdPicResize(pic, out.width, out.rows, out.rows);
    mmdPicPut(pic, out.planes, out.rows);
  }
  else mmdPicPut(pic, planes, rows);
  return true;
}

// Undo: steps filters taken back (all of them: as it was received, turned as it is), its size as it was then
function mmdPicUndo(pic, steps)
{
  if (!pic.undo || !pic.undo.length) return;
  const back = pic.undo.splice(Math.max(0, pic.undo.length - steps))[0];
  if (back.width != pic.canvas.width || back.rows != Math.min(pic.rows || pic.canvas.height, pic.canvas.height)) mmdPicResize(pic, back.width, back.rows, back.height);
  mmdPicPut(pic, back.planes, back.rows);
}

// A picture's canvas made width by rows (its kind's background; drawn again by mmdPicPut), height its lines (one cut: more than came)
function mmdPicResize(pic, width, rows, height)
{
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = Math.max(rows, height || rows);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = PICS.kinds[pic.kind].background || "black";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  pic.canvas = canvas;
  pic.width = width;
  pic.rows = rows;
  pic.height = PICS.kinds[pic.kind].grows ? rows : canvas.height;
}

// A picture's rows from its planes, shown again
function mmdPicPut(pic, planes, rows)
{
  const width = pic.canvas.width;
  const rgba = new Uint8ClampedArray(width * rows * 4);
  for (let c = 0; c < 3; c++)
  {
    const p = planes[Math.min(c, planes.length - 1)];
    for (let i = 0, j = c; i < p.length; i++, j += 4) rgba[j] = p[i];
  }
  for (let j = 3; j < rgba.length; j += 4) rgba[j] = 255;
  pic.canvas.getContext("2d").putImageData(new ImageData(rgba, width, rows), 0, 0);
  mmdPicStrip();
  mmdPicDraw();
}

// RGBA as planes: the first count of red, green and blue, each a byte a pixel
function mmdPicPlanes(rgba, count)
{
  const planes = [];
  for (let c = 0; c < count; c++)
  {
    const p = new Uint8ClampedArray(rgba.length / 4);
    for (let i = 0, j = c; i < p.length; i++, j += 4) p[i] = rgba[j];
    planes.push(p);
  }
  return planes;
}

// Each filter, on a picture's planes (width by rows) in place
const PICS_FILTER = {
  // Unsharp mask: each pixel pushed as far again from its blurred neighborhood
  sharpen: (planes, w, h) => planes.forEach((p) =>
  {
    const blur = mmdPicBlur(p, w, h);
    for (let i = 0; i < p.length; i++) p[i] = 2 * p[i] - blur[i];
  }),
  // Median of each 3 x 3: specks and noise taken out, edges and lines kept
  denoise: (planes, w, h) => planes.forEach((p) => p.set(mmdPicMedian(p, w, h))),
  // Gaussian blur (5 x 5 binomial)
  smooth: (planes, w, h) => planes.forEach((p) => p.set(mmdPicBlur(p, w, h))),
  // Its levels stretched to black and white (the darkest and lightest 0.5% let go)
  autoContrast: (planes) => mmdPicLevels(planes, (hist, total) =>
  {
    let lo = 0, hi = 255;
    for (let n = 0; lo < 255 && (n += hist[lo]) <= total * 0.005;) lo++;
    for (let n = 0; hi > 0 && (n += hist[hi]) <= total * 0.005;) hi--;
    return hi > lo ? (v) => ((v - lo) * 255) / (hi - lo) : null;
  }),
  // Histogram equalization: its levels spread evenly from black to white
  equalize: (planes) => mmdPicLevels(planes, (hist, total) =>
  {
    const cdf = new Float64Array(256);
    for (let v = 0, n = 0; v < 256; v++) cdf[v] = n += hist[v];
    const first = cdf[hist.findIndex((n) => n > 0)];
    return total > first ? (v) => ((cdf[v] - first) * 255) / (total - first) : null;
  }),
  // Gamma 1.25 and 0.8: the midtones lighter or darker, black and white kept
  lighten: (planes) => mmdPicLevels(planes, () => (v) => 255 * Math.pow(v / 255, 0.8)),
  darken: (planes) => mmdPicLevels(planes, () => (v) => 255 * Math.pow(v / 255, 1.25)),
  invert: (planes) => mmdPicLevels(planes, () => (v) => 255 - v)
};

// Every plane's levels remapped the same way (colors kept): curve(histogram of all planes, its count) gives each level's new one, or
// null to leave them
function mmdPicLevels(planes, curve)
{
  const hist = new Float64Array(256);
  for (const p of planes) for (let i = 0; i < p.length; i++) hist[p[i]]++;
  const map = curve(hist, planes.length * planes[0].length);
  if (!map) return;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = Math.round(map(v));
  for (const p of planes) for (let i = 0; i < p.length; i++) p[i] = lut[p[i]];
}

// A plane blurred by 1 4 6 4 1 across, then down (its edges repeated past them)
function mmdPicBlur(p, w, h)
{
  const across = new Float32Array(p.length), out = new Uint8ClampedArray(p.length);
  const col = (dx) => Int32Array.from({ length: w }, (_, x) => Math.max(0, Math.min(w - 1, x + dx)));
  const l2 = col(-2), l1 = col(-1), r1 = col(1), r2 = col(2);
  for (let y = 0; y < h; y++)
  {
    const row = y * w;
    for (let x = 0; x < w; x++) across[row + x] = (p[row + l2[x]] + 4 * p[row + l1[x]] + 6 * p[row + x] + 4 * p[row + r1[x]] + p[row + r2[x]]) / 16;
  }
  for (let y = 0; y < h; y++)
  {
    const at = (dy) => Math.max(0, Math.min(h - 1, y + dy)) * w;
    const a = at(-2), b = at(-1), c = y * w, d = at(1), e = at(2);
    for (let x = 0; x < w; x++) out[c + x] = (across[a + x] + 4 * across[b + x] + 6 * across[c + x] + 4 * across[d + x] + across[e + x]) / 16;
  }
  return out;
}

// The 3 x 3 median's exchanges (Paeth's 19, as Devillard gives them): each pair put in order leaves the median at 4
const PICS_MEDIAN_SWAPS = [1, 2, 4, 5, 7, 8, 0, 1, 3, 4, 6, 7, 1, 2, 4, 5, 7, 8, 0, 3, 5, 8, 4, 7, 3, 6, 1, 4, 2, 5, 4, 7, 4, 2, 6, 4, 4, 2];

// A plane's 3 x 3 medians (its edges repeated past them)
function mmdPicMedian(p, w, h)
{
  const out = new Uint8ClampedArray(p.length), v = new Uint8Array(9);
  // (Each of the 9's place: its row's start, by the row's 0, 1 or 2, plus its column, by x and the column's 0, 1 or 2)
  const rows = new Int32Array(3), cols = new Int32Array(w * 3);
  for (let x = 0; x < w; x++)
  {
    cols[x * 3] = Math.max(0, x - 1);
    cols[x * 3 + 1] = x;
    cols[x * 3 + 2] = Math.min(w - 1, x + 1);
  }
  for (let y = 0; y < h; y++)
  {
    rows[0] = Math.max(0, y - 1) * w;
    rows[1] = y * w;
    rows[2] = Math.min(h - 1, y + 1) * w;
    for (let x = 0; x < w; x++)
    {
      for (let k = 0; k < 9; k++) v[k] = p[rows[(k / 3) | 0] + cols[x * 3 + (k % 3)]];
      for (let k = 0; k < PICS_MEDIAN_SWAPS.length; k += 2)
      {
        const a = PICS_MEDIAN_SWAPS[k], b = PICS_MEDIAN_SWAPS[k + 1];
        if (v[a] > v[b])
        {
          const t = v[a];
          v[a] = v[b];
          v[b] = t;
        }
      }
      out[y * w + x] = v[4];
    }
  }
  return out;
}

// ---- A chart kind's tools (chartTools): lining up and cropping as it ends (each an Undo step of Filter's), print, its folder

// A plane's rows each moved by columns to the left, wrapping
function mmdPicRollPlane(p, w, rows, by)
{
  const row = new Uint8ClampedArray(w);
  for (let y = 0; y < rows; y++)
  {
    const at = y * w;
    row.set(p.subarray(at, at + w));
    p.set(row.subarray(by), at);
    p.set(row.subarray(0, by), at + w - by);
  }
}

// Auto-Align: the chart's left edge found (the widest run of empty columns, around the wrap, ends there) and moved to the left, a little
// of its margin before it. Nothing found to go by, or already there: left as it is (said so for one picked from its right-click, asked)
function mmdPicAutoAlign(pic, asked = false)
{
  const done = mmdPicChange(pic, (planes, w, rows) =>
  {
    const ink = mmdPicInk(planes[0], w, rows);
    const run = ink ? mmdPicEmptyRun(ink.columns, w) : null;
    if (!run) return false;
    // (the run's end, with up to PICS_EDGE_PAD of it left before the chart)
    const by = (run.start + run.length - Math.min(PICS_EDGE_PAD, Math.floor(run.length / 2)) + w) % w;
    if (!by) return false;
    planes.forEach((p) => mmdPicRollPlane(p, w, rows, by));
  });
  if (!done && asked) mmdStatus(I18N("cwViewer.picture.autoAlignNone"));
}

// Auto-Crop: the empty columns and rows around the chart taken off (PICS_EDGE_PAD of them kept). Nothing to take off: left as it is
// (said so for one picked from its right-click, asked)
function mmdPicAutoCrop(pic, asked = false)
{
  const done = mmdPicChange(pic, (planes, w, rows) =>
  {
    const ink = mmdPicInk(planes[0], w, rows);
    if (!ink) return false;
    const across = mmdPicContentSpan(ink.columns, w);
    if (!across) return false;
    // (its rows counted only across the chart's columns; a row of small text has little ink against the chart's busiest rows, so only
    // rows with almost none are taken off)
    const down = mmdPicContentSpan(mmdPicRowInk(ink.dark, ink.skip, w, rows, across), rows, (across.to - across.from) * 0.01);
    if (!down) return false;
    const x0 = Math.max(0, across.from - PICS_EDGE_PAD), x1 = Math.min(w, across.to + PICS_EDGE_PAD);
    const y0 = Math.max(0, down.from - PICS_EDGE_PAD), y1 = Math.min(rows, down.to + PICS_EDGE_PAD);
    if (x0 == 0 && x1 == w && y0 == 0 && y1 == rows) return false;
    const cw = x1 - x0, ch = y1 - y0;
    const cropped = planes.map((p) =>
    {
      const out = new Uint8ClampedArray(cw * ch);
      for (let y = 0; y < ch; y++) out.set(p.subarray((y0 + y) * w + x0, (y0 + y) * w + x1), y * cw);
      return out;
    });
    return { planes: cropped, width: cw, rows: ch };
  });
  if (!done && asked) mmdStatus(I18N("cwViewer.picture.autoCropNone"));
}

// Where a grey picture has ink: its 3 x 3 medians (specks of noise taken out) dark or not, and each column's count of dark pixels, rows
// almost all dark left out (a phasing line, a black bar across the whole width; skip: those rows, 1). Null for a picture with nothing to
// go by
function mmdPicInk(p, w, rows)
{
  if (w < 16 || rows < 16) return null;
  const median = mmdPicMedian(p, w, rows);
  const dark = new Uint8Array(w * rows);
  const skip = new Uint8Array(rows);
  const columns = new Float64Array(w);
  for (let y = 0; y < rows; y++)
  {
    const at = y * w;
    let count = 0;
    for (let x = 0; x < w; x++) if ((dark[at + x] = median[at + x] < PICS_INK_LEVEL ? 1 : 0)) count++;
    if (count > w * 0.9)
    {
      skip[y] = 1;
      continue;
    }
    for (let x = 0; x < w; x++) columns[x] += dark[at + x];
  }
  return { dark, skip, columns };
}

// Each row's dark pixels across the columns of span ({ from, to }), the almost all dark rows (skip) none, as for the columns: a black
// bar above or below the chart is cropped off too
function mmdPicRowInk(dark, skip, w, rows, span)
{
  const counts = new Float64Array(rows);
  for (let y = 0; y < rows; y++)
  {
    if (skip[y]) continue;
    const at = y * w;
    let n = 0;
    for (let x = span.from; x < span.to; x++) n += dark[at + x];
    counts[y] = n;
  }
  return counts;
}

// Which of counts (a column's or row's ink) are empty, smoothed over a few neighbors: little ink against the inkiest tenth of them (and
// no more than most, where given). Null when there's nothing to tell apart (all empty, or all alike)
function mmdPicEmpty(counts, n, wrap, most = Infinity)
{
  const smooth = new Float64Array(n);
  const half = 4;
  for (let i = 0; i < n; i++)
  {
    let sum = 0, k = 0;
    for (let d = -half; d <= half; d++)
    {
      let j = i + d;
      if (wrap) j = (j + n) % n;
      else if (j < 0 || j >= n) continue;
      sum += counts[j];
      k++;
    }
    smooth[i] = sum / k;
  }
  const sorted = Array.from(smooth).sort((a, b) => a - b);
  const lo = sorted[Math.floor(n * 0.02)], hi = sorted[Math.floor(n * 0.9)];
  if (!(hi > lo) || hi < 2) return null;
  const limit = Math.min(most, lo + (hi - lo) * 0.15);
  return Array.from(smooth, (v) => v <= limit);
}

// The widest run of empty columns, around the wrap: { start, length }, or null (none, or no column with ink)
function mmdPicEmptyRun(columns, w)
{
  const empty = mmdPicEmpty(columns, w, true);
  if (!empty) return null;
  // (from a column with ink round to it again, so every run ends inside the loop)
  const first = empty.indexOf(false);
  if (first < 0) return null;
  let best = null, start = -1;
  for (let i = 1; i <= w; i++)
  {
    if (empty[(first + i) % w])
    {
      if (start < 0) start = i;
    }
    else if (start >= 0)
    {
      if (!best || i - start > best.length) best = { start: (first + start) % w, length: i - start };
      start = -1;
    }
  }
  return best && best.length >= 3 ? best : null;
}

// The span from the first to the last of counts with ink ({ from, to }: to past the last), or null; most: the most ink an empty one has
function mmdPicContentSpan(counts, n, most = Infinity)
{
  const empty = mmdPicEmpty(counts, n, false, most);
  if (!empty) return null;
  const from = empty.indexOf(false), last = empty.lastIndexOf(false);
  return from < 0 ? null : { from, to: last + 1 };
}

// Its saved file shown in its folder (the newest it was saved to)
function mmdPicShowFile(pic)
{
  const files = mmdPicSavedFiles(pic);
  if (files.length) window.require("electron").shell.showItemInFolder(files[files.length - 1]);
}

// Print...: the picture on a page of its own (fitted, turned to landscape when it's wider than tall), its caption under it: its station,
// then its mode, UTC date and time and frequency. The page and the picture are written to a folder in the system's temporary folder and
// shown in a window of their own (its own process: this window's decoding goes on while the print dialog is up; a hidden one never
// shows the dialog), in front of this one, the dialog over it; both let go when done
async function mmdPicPrint(pic)
{
  const remote = window.require("@electron/remote");
  const os = window.require("os");
  let dir = null, win = null;
  const finish = () =>
  {
    try
    {
      if (win && !win.isDestroyed()) win.destroy();
    }
    catch (e)
    {
      // (gone already)
    }
    try
    {
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
    catch (e)
    {
      // (left for the system to clear)
    }
  };
  try
  {
    const turned = (pic.rotate || 0) % 180 != 0;
    const rows = PICS.kinds[pic.kind].grows && pic.rows > 0 ? Math.min(pic.rows, pic.canvas.height) : pic.canvas.height;
    const landscape = (turned ? rows : pic.canvas.width) > (turned ? pic.canvas.width : rows);
    const escape = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const line = [pic.name, mmdPicWhen(pic)].concat(pic.dial ? [(pic.dial / 1e6).toFixed(3) + " MHz"] : []).join(" · ");
    const html = "<!doctype html><html><head><meta charset=\"utf-8\"><style>" +
      (landscape ? "@page{size:landscape}" : "") +
      "html,body{margin:0;background:#fff;color:#000;font-family:sans-serif}" +
      "body{height:99vh;overflow:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center}" +
      "img{display:block;max-width:100%;max-height:calc(100vh - 14mm);object-fit:contain}" +
      ".caption{margin-top:2mm;font-size:10pt;text-align:center}.station{font-weight:bold}" +
      "</style></head><body><img src=\"picture.png\"><div class=\"caption\">" +
      (pic.station ? "<div class=\"station\">" + escape(pic.station) + "</div>" : "") +
      "<div>" + escape(line) + "</div></div></body></html>";
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "GridTracker2-print-"));
    fs.writeFileSync(path.join(dir, "picture.png"), window.require("buffer").Buffer.from(mmdPicPng(pic).split(",")[1], "base64"));
    fs.writeFileSync(path.join(dir, "page.html"), html);
    // (titled, macOS: tabbingIdentifier, so the main process never takes it for one of its windows: untitled it would be the app's
    // name, the main window's)
    win = new remote.BrowserWindow({
      show: false,
      title: I18N("cwViewer.picture.print.label").replace(/[.…]+$/, ""),
      tabbingIdentifier: "printPicture",
      width: 800,
      height: 600,
      parent: remote.getCurrentWindow(),
      autoHideMenuBar: true,
      backgroundColor: "#ffffff",
      // (its own page's print() is all that runs in it)
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true }
    });
    await win.loadFile(path.join(dir, "page.html"));
    // Its page's own print(), as the hot key list prints (the main process's webContents.print never shows the dialog), done once the
    // dialog is answered; closed by hand meanwhile: let go
    win.show();
    win.on("closed", finish);
    win.webContents.executeJavaScript("print()").then(finish, finish);
  }
  catch (e)
  {
    finish();
    mmdStatus(I18N("cwViewer.picture.printFailed") + " " + e.message, true);
  }
}

// ---- Copy, save, delete

// The picture (as much of it as came) onto the clipboard as an image
function mmdPicCopy(pic)
{
  const electron = window.require("electron");
  electron.clipboard.writeImage(electron.nativeImage.createFromDataURL(mmdPicPng(pic)));
}

// The picture as a PNG data URL, as it is shown: a growing one only as far as its rows came, and turned if it is (mmdPicTurned)
function mmdPicPng(pic)
{
  const grows = PICS.kinds[pic.kind].grows;
  if (!pic.rotate && (!grows || !(pic.rows > 0) || pic.rows >= pic.canvas.height)) return pic.canvas.toDataURL("image/png");
  return mmdPicTurned(pic).toDataURL("image/png");
}

// Off the strip (one still coming in: the rest of it isn't shown); the newest shown large if it was the one shown. A file saved stays
function mmdPicDelete(pic)
{
  PICS.lists[pic.kind] = PICS.lists[pic.kind].filter((p) => p != pic);
  if (PICS.live == pic) PICS.live = null;
  if (PICS.views[pic.kind] == pic.id) PICS.views[pic.kind] = null;
  mmdPicStrip();
  mmdPicDraw();
  mmdPicHead();
}

// The folder a picture is saved in by its kind (SSTV's Save Pictures folder, WEFAX's Save Charts one ...)
function mmdPicFolderOf(pic)
{
  return PICS.kinds[pic.kind].folder();
}

// Save: the dialog opens where a picture of its kind was last saved this way (MMD.saveAsDir, kept), else in its kind's folder (made
// first, so the dialog never starts in a folder that isn't there); the folder chosen is kept for the next
function mmdPicSaveAs(pic)
{
  const remote = window.require("@electron/remote");
  const S = GT.settings.MMD;
  if (!S.saveAsDir || typeof S.saveAsDir != "object") S.saveAsDir = {};
  let dir = S.saveAsDir[pic.kind];
  if (!dir || !fs.existsSync(dir))
  {
    dir = mmdPicFolderOf(pic);
    try
    {
      fs.mkdirSync(dir, { recursive: true });
    }
    catch (e)
    {
      dir = remote.app.getPath("pictures");
    }
  }
  const file = remote.dialog.showSaveDialogSync(remote.getCurrentWindow(), {
    defaultPath: path.join(dir, mmdPicFileName(pic)),
    filters: [{ name: "PNG", extensions: ["png"] }]
  });
  if (!file) return;
  S.saveAsDir[pic.kind] = path.dirname(file);
  mmdPicSave(pic, file);
}

// Its name: the UTC time it started, its mode, the frequency on the air, and the station it is from (20261027-225115Z_Martin1_14230kHz.png,
// 20261113-201456Z_WEFAX120576_8680kHz_NMC.png)
function mmdPicFileName(pic)
{
  const t = new Date(pic.at).toISOString();
  const when = t.slice(0, 10).replace(/-/g, "") + "-" + t.slice(11, 19).replace(/:/g, "") + "Z";
  const freq = pic.dial ? "_" + Math.round(pic.dial / 1000) + "kHz" + (pic.stationId ? "_" + pic.stationId : "") : "";
  return when + "_" + pic.name.replace(/[^\w-]+/g, "") + freq + ".png";
}

// Saved as a PNG: to file, or (null) into its kind's folder
function mmdPicSave(pic, file)
{
  try
  {
    if (!file) file = path.join(mmdPicFolderOf(pic), mmdPicFileName(pic));
    // Its folder made first, whichever it is (one taken away since, or never made)
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const data = mmdPicPng(pic).split(",")[1];
    fs.writeFileSync(file, window.require("buffer").Buffer.from(data, "base64"));
    pic.saved = file;
    // Every file it was saved to (Delete's File takes them all)
    pic.files = (pic.files || []).filter((f) => f != file).concat(file);
    mmdPicDraw();
  }
  catch (e)
  {
    mmdStatus(I18N("cwViewer.sstv.saveFailed") + " " + e.message, true);
  }
}

// A kind's newest PICS_KEEP saved pictures (PNGs), into its strip behind any that came since, the first time its mode is shown in this
// window: each as it was saved, named, timed and on the frequency its file name gives (Delete's File takes the file). Every kind's folder
// is looked in, a file going to the kind its name gives (charts saved in SSTV Pictures before WEFAX had a folder of its own), one named
// otherwise to its folder's
async function mmdPicLoadSaved(kind)
{
  if (!PICS.kinds[kind] || PICS.savedLoaded[kind]) return;
  PICS.savedLoaded[kind] = true;
  let found = [];
  const looked = new Set();
  for (const folderKind of PICS.order)
  {
    let folder;
    try
    {
      folder = PICS.kinds[folderKind].folder();
    }
    catch (e)
    {
      continue;
    }
    if (!folder || looked.has(folder)) continue;
    looked.add(folder);
    try
    {
      found = found.concat(fs.readdirSync(folder).filter((f) => /\.png$/i.test(f)).map((f) => mmdPicSavedInfo(path.join(folder, f), folderKind)));
    }
    catch (e)
    {
      // (No folder yet: nothing saved there)
    }
  }
  found = found.filter((info) => info && info.kind == kind).sort((a, b) => b.at - a.at).slice(0, PICS_KEEP);
  const pics = [];
  for (const info of found)
  {
    try
    {
      const bitmap = await createImageBitmap(new Blob([await fs.promises.readFile(info.file)]));
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      bitmap.close();
      const pic = { id: "file:" + info.file, kind, name: info.name, width: canvas.width, height: canvas.height, canvas, rows: canvas.height, complete: true, at: info.at, dial: info.dial, shift: 0, saved: info.file, files: [info.file] };
      // (its station: from its name, else its kind's guess from its time and frequency; a kind's that fails, none)
      const def = PICS.kinds[kind];
      let station = null;
      try
      {
        station = typeof def.station == "function" ? def.station({ at: info.at, dial: info.dial, station: info.station }) : null;
      }
      catch (e)
      {
        station = null;
      }
      mmdPicStation(pic, station);
      pics.push(pic);
    }
    catch (e)
    {
      // (Not a picture it can read: left out)
    }
  }
  // (One saved again since, by Save Picture...: kept once, as it is now)
  const list = PICS.lists[kind];
  const fresh = pics.filter((pic) => !list.some((p) => (p.files || []).includes(pic.saved)));
  PICS.lists[kind] = list.concat(fresh).sort((a, b) => b.at - a.at).slice(0, PICS_KEEP);
  if (kind == mmdPicKind())
  {
    mmdPicStrip();
    mmdPicDraw();
    mmdPicHead();
  }
}

// A saved picture's file told by its name (mmdPicFileName: 20261027-225115Z_Martin1_14230kHz.png, a station id after the frequency:
// ..._8680kHz_NMC.png): { file, kind, at, name, dial, station }, its kind the one whose fromFile claims its name part (a catch-all kind's
// last: SSTV's). Another name: itself, its folder's kind, at the time it was written. Null for one it can't read
function mmdPicSavedInfo(file, folderKind)
{
  try
  {
    const base = path.basename(file, path.extname(file));
    const m = base.match(/^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d)Z_([\w-]+?)(?:_(\d+)kHz(?:_([A-Za-z0-9-]+))?)?$/);
    if (!m) return { file, kind: folderKind, at: fs.statSync(file).mtimeMs, name: base, dial: null, station: null };
    const at = Date.UTC(m[1], m[2] - 1, m[3], m[4], m[5], m[6]);
    const dial = m[8] ? Number(m[8]) * 1000 : null, station = m[9] || null;
    const kinds = PICS.order.filter((k) => !PICS.kinds[k].catchAll).concat(PICS.order.filter((k) => PICS.kinds[k].catchAll));
    for (const kind of kinds)
    {
      const def = PICS.kinds[kind];
      const name = typeof def.fromFile == "function" ? def.fromFile(m[7]) : null;
      if (name) return { file, kind, at, name, dial, station };
    }
    return { file, kind: folderKind, at, name: m[7], dial, station };
  }
  catch (e)
  {
    return null;
  }
}
