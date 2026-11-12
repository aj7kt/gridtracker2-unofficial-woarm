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
// its rows come), planes (3, or 1 for grey: Filter's Undo kept smaller), tabs (SSTV's Receive and Send tabs shown), describe(pic, live)
// (its own words for how much of a picture came, else SSTV's line counts), fromFile(name) (a saved file's name part, as mmdPicFileName
// wrote it, claimed as its kind's: its shown name, else null), catchAll (claims any name the others don't: SSTV's) }

// Pictures kept in the strip (each kind's)
const PICS_KEEP = 12;
// A growing picture's canvas is made this many lines longer each time its lines run past its end
const PICS_GROW_ROWS = 600;
// The caption over the picture shown: its font this many times the header's, its colors (the mode, the UTC time, the frequency, the
// band, Saved)
const PICS_CAPTION_SCALE = 2;
const PICS_CAPTION_COLORS = { name: "#8cf", time: "#fff", freq: "#8f8", band: "#ff0", saved: "#bbb" };
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
                   // dial (Hz on the air or null), shift, saved, files, rotate, undo }
  views: {},       // each kind's one shown large (a click on the strip); null: the newest
  live: null,      // the one coming in (any kind's)
  drawn: null,     // where the picture shown was drawn on sstvPicture (device pixels: x, y, w, h), and which
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

// One starting (m: { id, name, width, height: its lines, 0 for a kind that grows; shift: Hz its sender is from where its tones belong }):
// a canvas of its own, first in its kind's strip, the one coming in
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

// One ended (complete: all of it came): nothing of it ever drawn, off the strip; else saved however much of it came, with its kind's
// Save, not a test signal's (mmdTest.js)
function mmdPicDone(kind, id, complete)
{
  const pic = mmdPicFind(kind, id);
  if (!pic) return;
  const def = PICS.kinds[kind];
  pic.complete = complete;
  if (PICS.live == pic) PICS.live = null;
  if (pic.rows == 0) PICS.lists[kind] = PICS.lists[kind].filter((p) => p != pic);
  else if (GT.settings.MMD[def.saveKey] && !mmdTestHeard(pic.at, Date.now())) mmdPicSave(pic, null);
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
      const dw = pic.width * scale, dh = height * scale;
      ctx.drawImage(pic.canvas, 0, 0, pic.width, height, (w - dw) / 2, top + (room - shape * scale) / 2, dw, dh);
      PICS.drawn = { x: (w - dw) / 2, y: top + (room - shape * scale) / 2, w: dw, h: dh, pic, rotate: 0 };
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
      PICS.drawn = { x: bx, y: by, w: bw, h: bh, pic, rotate };
    }
  });
}

// The caption over the picture shown, centered: its mode (light blue), UTC time (white), frequency on the air (light green) with its band
// (yellow), and Saved once it is; smaller where the line is too narrow for it. Its height (device pixels)
function mmdPicCaption(ctx, pic, w, ratio)
{
  const C = PICS_CAPTION_COLORS;
  const parts = [[pic.name, C.name], [new Date(pic.at).toISOString().slice(11, 19) + " UTC", C.time]];
  if (pic.dial)
  {
    parts.push([(pic.dial / 1e6).toFixed(3) + " MHz", C.freq]);
    const band = mmdBandOf(pic.dial);
    if (band) parts.push(["(" + band + ")", C.band]);
  }
  if (pic.saved) parts.push([I18N("cwViewer.sstv.saved"), C.saved]);
  const family = window.getComputedStyle(sstvHeadText).fontFamily;
  let size = parseFloat(window.getComputedStyle(sstvHeadText).fontSize) * PICS_CAPTION_SCALE * ratio;
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
    ctx.fillText(t, x, height / 2);
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

// A picture told in a line: its mode, UTC time, frequency on the air (the strip's tooltips; not with caption false, the header's: the
// caption over the picture has them), and how much of it came (its kind's own words, else its lines of all of them)
function mmdPicDescribe(pic, caption = true)
{
  const parts = caption ? [pic.name, new Date(pic.at).toISOString().slice(11, 19) + " UTC"] : [];
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
// its saved files deleted; Both: those two only while a file it was saved to is still there)
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
  // (An SSTV picture's Log QSO... first, with Log QSO on: mmdLogQso.js)
  const menu = remote.Menu.buildFromTemplate(mmdLogQsoPictureMenu(pic).concat([
    { label: I18N("cwViewer.sstv.save.label"), click: () => mmdPicSaveAs(pic) },
    { label: I18N("cwViewer.picture.copy.label"), click: () => mmdPicCopy(pic) },
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
      enabled: pic != PICS.live,
      submenu: filters.concat([
        { type: "separator" },
        { label: I18N("cwViewer.picture.filterUndo.label").replace("{count}", undo), enabled: undo > 0, click: () => mmdPicUndo(pic, 1) },
        { label: I18N("cwViewer.picture.filterUndoAll.label"), enabled: undo > 0, click: () => mmdPicUndo(pic, undo) }
      ])
    },
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
  const width = pic.canvas.width, rows = pic.rows > 0 ? Math.min(pic.rows, pic.canvas.height) : pic.canvas.height;
  const image = pic.canvas.getContext("2d").getImageData(0, 0, width, rows);
  // (A grey kind's: one plane, so its Undo steps take a quarter of the room; else red, green and blue)
  const planes = mmdPicPlanes(image.data, PICS.kinds[pic.kind].planes || 3);
  pic.undo = (pic.undo || []).concat([{ rows, planes: planes.map((p) => p.slice()) }]).slice(-PICS_UNDO_KEEP);
  PICS_FILTER[name](planes, width, rows);
  mmdPicPut(pic, planes, rows);
}

// Undo: steps filters taken back (all of them: as it was received, turned as it is)
function mmdPicUndo(pic, steps)
{
  if (!pic.undo || !pic.undo.length) return;
  const back = pic.undo.splice(Math.max(0, pic.undo.length - steps))[0];
  mmdPicPut(pic, back.planes, back.rows);
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

// Its name: the UTC time it started, its mode, and the frequency on the air (20261027-225115Z_Martin1_14230kHz.png)
function mmdPicFileName(pic)
{
  const t = new Date(pic.at).toISOString();
  const when = t.slice(0, 10).replace(/-/g, "") + "-" + t.slice(11, 19).replace(/:/g, "") + "Z";
  return when + "_" + pic.name.replace(/[^\w-]+/g, "") + (pic.dial ? "_" + Math.round(pic.dial / 1000) + "kHz" : "") + ".png";
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
      pics.push({ id: "file:" + info.file, kind, name: info.name, width: canvas.width, height: canvas.height, canvas, rows: canvas.height, complete: true, at: info.at, dial: info.dial, shift: 0, saved: info.file, files: [info.file] });
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

// A saved picture's file told by its name (mmdPicFileName: 20261027-225115Z_Martin1_14230kHz.png): { file, kind, at, name, dial }, its
// kind the one whose fromFile claims its name part (a catch-all kind's last: SSTV's). Another name: itself, its folder's kind, at the time
// it was written. Null for one it can't read
function mmdPicSavedInfo(file, folderKind)
{
  try
  {
    const base = path.basename(file, path.extname(file));
    const m = base.match(/^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d)Z_([\w-]+?)(?:_(\d+)kHz)?$/);
    if (!m) return { file, kind: folderKind, at: fs.statSync(file).mtimeMs, name: base, dial: null };
    const at = Date.UTC(m[1], m[2] - 1, m[3], m[4], m[5], m[6]);
    const kinds = PICS.order.filter((k) => !PICS.kinds[k].catchAll).concat(PICS.order.filter((k) => PICS.kinds[k].catchAll));
    for (const kind of kinds)
    {
      const def = PICS.kinds[kind];
      const name = typeof def.fromFile == "function" ? def.fromFile(m[7]) : null;
      if (name) return { file, kind, at, name, dial: m[8] ? Number(m[8]) * 1000 : null };
    }
    return { file, kind: folderKind, at, name: m[7], dial: m[8] ? Number(m[8]) * 1000 : null };
  }
  catch (e)
  {
    return null;
  }
}
