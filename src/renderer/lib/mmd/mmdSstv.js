// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Multi-Mode Decoder's SSTV mode (the Mode menu): the 12 kHz audio the worklet sends (as for FT8) goes to sstvWorker.js, which reads
// the pictures. Here each one is drawn as it comes in, the newest few are kept in a strip beside it (a click shows one large, a click on
// the large one goes back to the newest), and they are saved: each as it ends with Settings' Save Pictures, or any one with a right-click.
// WEFAX mode (weather fax charts, wefaxWorker.js, from the same 12 kHz audio) shares the view: its charts are kept apart from SSTV's
// pictures, each mode showing its own; a chart's length isn't known as it starts, so its canvas grows as its lines come. Its line rate,
// index of cooperation, Start Now and Stop are on the second line (mmdWefaxMenu)

// Pictures kept in the strip (each mode's)
const SSTV_KEEP = 12;
// A chart's canvas is made this many lines longer each time its lines run past its end
const WEFAX_GROW_ROWS = 600;
// WEFAX's menus: lines a minute, index of cooperation ("auto": found from the start tone and phasing)
const WEFAX_LPM_CHOICES = ["auto", 60, 90, 120, 240];
const WEFAX_IOC_CHOICES = ["auto", 576, 288];
// Trim's step and limit (ppm: the line rate made this much slower, positive, or faster)
const WEFAX_TRIM_STEP = 20;
const WEFAX_TRIM_MAX = 2000;
// The caption over the picture shown: its font this many times the header's, its colors (the mode, the UTC time, the frequency, the
// band, Saved)
const SSTV_CAPTION_SCALE = 2;
const SSTV_CAPTION_COLORS = { name: "#8cf", time: "#fff", freq: "#8f8", band: "#ff0", saved: "#bbb" };
// Filter's choices, in its submenu's order (each SSTV_FILTER's, its label cwViewer.picture.filter<Name>.label), and the Undo steps kept
// for each picture (the oldest let go past it)
const SSTV_FILTERS = ["sharpen", "denoise", "smooth", "autoContrast", "equalize", "lighten", "darken", "invert"];
const SSTV_UNDO_KEEP = 20;

const SSTV = {
  workers: {},  // by mode: "sstv" sstvWorker.js, "wefax" wefaxWorker.js
  lists: { sstv: [], wefax: [] },
  views: { sstv: null, wefax: null },
  // The mode's pictures, the newest first: { id, kind, name, width, height, canvas, rows, complete, at (ms, its start), dial (Hz on the
  // air or null), shift, saved }
  get pictures() { return this.lists[mmdSstvKind()]; },
  set pictures(list) { this.lists[mmdSstvKind()] = list; },
  // The one shown large (a click on the strip); null: the newest
  get viewing() { return this.views[mmdSstvKind()]; },
  set viewing(id) { this.views[mmdSstvKind()] = id; },
  live: null,   // the one coming in
  drawn: null,  // where the picture shown was drawn on sstvPicture (device pixels: x, y, w, h), and which
  // WEFAX by hand: Trim (ppm; kept across restarts in MMD.wefaxTrim, read in mmdSstvInit), and where the chart coming in is lined up
  // (align, this session's: its lines moved left by this share of one; a new chart starts at 0, its phasing lines up the rest)
  wefaxTrim: 0,
  wefaxAlign: 0,
  status: { state: "idle", snr: -20, line: 0, lines: 0 },
  drawQueued: false,
  savedLoaded: { sstv: false, wefax: false }, // each mode's saved pictures put in its strip this window (mmdSstvLoadSaved)
  tab: "receive" // the view's tab: "receive" (the pictures) or "send" (Send Picture, mmdSstvTx.js)
};

function mmdSstvInit()
{
  // WEFAX's Trim as it was last set
  const trim = Number(GT.settings.MMD.wefaxTrim);
  SSTV.wefaxTrim = Number.isFinite(trim) ? Math.max(-WEFAX_TRIM_MAX, Math.min(WEFAX_TRIM_MAX, Math.round(trim / WEFAX_TRIM_STEP) * WEFAX_TRIM_STEP)) : 0;
  // A click: on a WEFAX chart coming in, its left edge set there; else back to the newest
  sstvPicture.addEventListener("click", (event) =>
  {
    if (!mmdWefaxAlignAt(event)) mmdSstvView(null);
  });
  sstvPicture.addEventListener("contextmenu", (event) => mmdSstvMenu(event, mmdSstvShown()));
  window.addEventListener("resize", mmdSstvDraw);
}

// SSTV or WEFAX mode: the picture view's
function mmdSstvMode(mode = DEC.mode)
{
  return mode == "sstv" || mode == "wefax";
}

// Whose pictures are shown: WEFAX's in its mode, else SSTV's
function mmdSstvKind()
{
  return DEC.mode == "wefax" ? "wefax" : "sstv";
}

// The mode's worker, once (WEFAX's told its menus' choices)
function mmdSstvLoad(kind = mmdSstvKind())
{
  if (SSTV.workers[kind]) return SSTV.workers[kind];
  const worker = new Worker(kind == "wefax" ? "lib/mmd/wefaxWorker.js" : "lib/mmd/sstvWorker.js");
  worker.onmessage = (event) => mmdSstvMessage(kind, event.data);
  SSTV.workers[kind] = worker;
  if (kind == "wefax") mmdWefaxConfig({});
  return worker;
}

// A chunk of 12 kHz audio from the worklet
function mmdSstvAudio(data)
{
  mmdSstvLoad().postMessage({ type: "audio", samples: data.samples }, [data.samples.buffer]);
}

// The audio starts again (SSTV or WEFAX mode chosen, the input started, Clear): what the workers were reading is let go
function mmdSstvReset()
{
  for (const kind in SSTV.workers) SSTV.workers[kind].postMessage({ type: "reset" });
  SSTV.live = null;
  SSTV.status = { state: "idle", snr: -20, line: 0, lines: 0 };
  mmdSstvHead();
}

// Clear: the strip emptied as well (saved pictures stay where they are)
function mmdSstvClear()
{
  mmdSstvReset();
  SSTV.pictures = [];
  SSTV.viewing = null;
  mmdSstvStrip();
  mmdSstvDraw();
}

function mmdSstvMessage(kind, m)
{
  // The other mode's worker, still finishing: nothing of it shown here
  if (kind != mmdSstvKind()) return;
  const wefax = kind == "wefax";
  if (m.type == "status")
  {
    SSTV.status = m;
    mmdSstvHead();
    return;
  }
  if (m.type == "start")
  {
    // WEFAX: its length isn't known yet (the canvas grows, mmdWefaxRoom), named by its line rate and index of cooperation
    const height = wefax ? WEFAX_GROW_ROWS : m.height;
    const canvas = document.createElement("canvas");
    canvas.width = m.width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = wefax ? "white" : "black";
    ctx.fillRect(0, 0, m.width, height);
    const dial = mmdDial();
    const name = wefax ? "WEFAX " + m.lpm + "/" + m.ioc : m.name;
    const shift = wefax ? Math.round(m.offsetHz || 0) : m.shift || 0;
    const pic = { id: m.id, kind, name, width: m.width, height: wefax ? 0 : m.height, canvas, rows: 0, complete: false, at: Date.now(), dial, shift, saved: null };
    // Auto-Tune: the chart tuned for has begun (mmdWefaxAuto.js)
    if (wefax) mmdWefaxAutoStarted();
    // A new chart lined up by its own phasing: the last one's alignment let go
    if (wefax && SSTV.wefaxAlign)
    {
      SSTV.wefaxAlign = 0;
      mmdWefaxConfig({});
    }
    SSTV.pictures.unshift(pic);
    if (SSTV.pictures.length > SSTV_KEEP) SSTV.pictures.length = SSTV_KEEP;
    if (SSTV.viewing && !SSTV.pictures.some((p) => p.id == SSTV.viewing)) SSTV.viewing = null;
    SSTV.live = pic;
    mmdSstvStrip();
    mmdSstvDraw();
    mmdSstvHead();
    // The waterfall's guides moved to where this sender is
    mmdOverlay();
    return;
  }
  const pic = SSTV.pictures.find((p) => p.id == m.id);
  if (!pic) return;
  // WEFAX's rows are grey levels (made RGBA here), SSTV's RGBA
  const rgba = wefax && m.pixels ? mmdWefaxRgba(m.pixels) : m.rgba;
  if (m.type == "rows")
  {
    if (wefax) mmdWefaxRoom(pic, m.from + m.count);
    pic.canvas.getContext("2d").putImageData(new ImageData(rgba, pic.width, m.count), 0, m.from);
    pic.rows = Math.max(pic.rows, m.from + m.count);
  }
  // Drawn again (a better line rate): over the rows it had; every row ever shown stays shown
  else if ((m.type == "redraw" || m.type == "done") && m.count > 0)
  {
    if (wefax) mmdWefaxRoom(pic, m.count);
    pic.canvas.getContext("2d").putImageData(new ImageData(rgba, pic.width, m.count), 0, 0);
    pic.rows = Math.max(pic.rows, m.count);
  }
  if (wefax) pic.height = pic.rows;
  // A turned one's thumbnail kept up with it as it comes in
  if (m.type == "rows" || m.type == "redraw") mmdSstvThumbTurned(pic);
  if (m.type == "done")
  {
    pic.complete = m.complete;
    if (SSTV.live == pic) SSTV.live = null;
    // Nothing of it ever drawn: off the strip
    if (pic.rows == 0) SSTV.pictures = SSTV.pictures.filter((p) => p != pic);
    // Saved however much of it came, with its mode's Save (SSTV's Save Pictures, WEFAX's Save Charts); not a test signal's (mmdTest.js)
    else if (GT.settings.MMD[pic.kind == "wefax" ? "wefaxSave" : "sstvSave"] && !mmdTestHeard(pic.at, Date.now())) mmdSstvSave(pic, null);
    mmdSstvStrip();
    mmdSstvHead();
  }
  mmdSstvDraw();
}

// How far the newest picture's sender is from where its tones belong (Hz): the waterfall's guides are drawn there (mmdOverlay)
function mmdSstvShift()
{
  return SSTV.pictures.length ? SSTV.pictures[0].shift : 0;
}

// The picture shown large: the one clicked in the strip, else the newest
function mmdSstvShown()
{
  return SSTV.pictures.find((p) => p.id == SSTV.viewing) || SSTV.pictures[0] || null;
}

function mmdSstvView(id)
{
  SSTV.viewing = id;
  mmdSstvStrip();
  mmdSstvDraw();
  mmdSstvHead();
}

// The large picture drawn to fit its place (its shape kept), at the next frame
function mmdSstvDraw()
{
  if (SSTV.drawQueued) return;
  SSTV.drawQueued = true;
  window.requestAnimationFrame(() =>
  {
    SSTV.drawQueued = false;
    if (!mmdSstvMode()) return;
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
    const pic = mmdSstvShown();
    if (!pic) return;
    // Its caption on top, the picture in the room under it
    const top = mmdSstvCaption(ctx, pic, w, ratio);
    const room = Math.max(1, h - top);
    // (A WEFAX chart: the lines it has so far; until it has a few, as if it were as long as it is wide)
    const height = pic.kind == "wefax" ? Math.max(pic.rows, 1) : pic.height;
    ctx.imageSmoothingEnabled = true;
    const rotate = pic.rotate || 0;
    if (!rotate)
    {
      const shape = pic.kind == "wefax" ? Math.max(height, pic.width / 2) : height;
      const scale = Math.min(w / pic.width, room / shape);
      const dw = pic.width * scale, dh = height * scale;
      ctx.drawImage(pic.canvas, 0, 0, pic.width, height, (w - dw) / 2, top + (room - shape * scale) / 2, dw, dh);
      SSTV.drawn = { x: (w - dw) / 2, y: top + (room - shape * scale) / 2, w: dw, h: dh, pic, rotate: 0 };
    }
    else
    {
      // Turned (mmdSstvRotate): fitted as it is shown, drawn about its middle
      const turned = rotate % 180 != 0;
      const sw = turned ? height : pic.width, sh = turned ? pic.width : height;
      const scale = Math.min(w / sw, room / sh);
      const bw = sw * scale, bh = sh * scale, bx = (w - bw) / 2, by = top + (room - bh) / 2;
      ctx.save();
      ctx.translate(bx + bw / 2, by + bh / 2);
      ctx.rotate((rotate * Math.PI) / 180);
      ctx.drawImage(pic.canvas, 0, 0, pic.width, height, (-pic.width * scale) / 2, (-height * scale) / 2, pic.width * scale, height * scale);
      ctx.restore();
      SSTV.drawn = { x: bx, y: by, w: bw, h: bh, pic, rotate };
    }
    // (Its tooltip says what a click does: WEFAX's lines up the chart coming in)
    const tip = I18N(pic.kind == "wefax" ? "cwViewer.wefax.picture.hover" : "cwViewer.sstv.picture.hover");
    if (sstvPicture.title != tip) sstvPicture.title = tip;
  });
}

// The caption over the picture shown, centered: its mode (light blue), UTC time (white), frequency on the air (light green) with its band
// (yellow), and Saved once it is; smaller where the line is too narrow for it. Its height (device pixels)
function mmdSstvCaption(ctx, pic, w, ratio)
{
  const C = SSTV_CAPTION_COLORS;
  const parts = [[pic.name, C.name], [new Date(pic.at).toISOString().slice(11, 19) + " UTC", C.time]];
  if (pic.dial)
  {
    parts.push([(pic.dial / 1e6).toFixed(3) + " MHz", C.freq]);
    const band = mmdBandOf(pic.dial);
    if (band) parts.push(["(" + band + ")", C.band]);
  }
  if (pic.saved) parts.push([I18N("cwViewer.sstv.saved"), C.saved]);
  const family = window.getComputedStyle(sstvHeadText).fontFamily;
  let size = parseFloat(window.getComputedStyle(sstvHeadText).fontSize) * SSTV_CAPTION_SCALE * ratio;
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
function mmdSstvStrip()
{
  sstvStrip.replaceChildren();
  const shown = mmdSstvShown();
  for (const pic of SSTV.pictures)
  {
    const item = document.createElement("div");
    item.className = "sstvThumb" + (pic == shown ? " sstvThumbShown" : "");
    item.title = mmdSstvDescribe(pic);
    // (Turned: a turned copy, made again as the strip is and, while it comes in, every SSTV_THUMB_TURNED_MS (mmdSstvThumbTurned); else the
    // picture's own canvas, which shows its rows as they come)
    pic.thumb = pic.rotate ? mmdSstvTurned(pic) : null;
    pic.thumbAt = Date.now();
    item.appendChild(pic.thumb || pic.canvas);
    item.addEventListener("click", () => mmdSstvView(pic == SSTV.pictures[0] ? null : pic.id));
    item.addEventListener("contextmenu", (event) => mmdSstvMenu(event, pic));
    sstvStrip.appendChild(item);
  }
}

// A picture told in a line: its mode, UTC time, frequency on the air (the strip's tooltips; not with caption false, the header's: the
// caption over the picture has them), and how much of it came
function mmdSstvDescribe(pic, caption = true)
{
  const parts = caption ? [pic.name, new Date(pic.at).toISOString().slice(11, 19) + " UTC"] : [];
  if (caption && pic.dial) parts.push((pic.dial / 1e6).toFixed(3) + " MHz");
  // Its sender's tones this far from where they belong (it was found and read there)
  if (Math.abs(pic.shift) >= 25) parts.push((pic.shift > 0 ? "+" : "") + pic.shift + " Hz");
  if (pic.kind == "wefax")
  {
    // A chart: the lines so far (its length isn't known until its stop tone)
    parts.push(I18N("cwViewer.wefax.lines").replace("{line}", pic.rows));
    if (pic == SSTV.live) parts.push(I18N("cwViewer.wefax.receiving"));
  }
  else if (pic == SSTV.live) parts.push(I18N("cwViewer.sstv.line").replace("{line}", pic.rows).replace("{lines}", pic.height));
  else if (!pic.complete) parts.push(I18N("cwViewer.sstv.cut").replace("{line}", pic.rows).replace("{lines}", pic.height));
  if (caption && pic.saved) parts.push(I18N("cwViewer.sstv.saved"));
  return parts.join(" · ");
}

// The header over the picture (also what is dragged to share the room with the waterfall): the picture shown, or what is listened for
function mmdSstvHead()
{
  const pic = mmdSstvShown();
  const idle = I18N(mmdSstvKind() == "wefax" ? "cwViewer.wefax.idle" : "cwViewer.sstv.idle");
  let text = pic ? mmdSstvDescribe(pic, false) : idle;
  if (!SSTV.live && pic) text += (text ? "  ·  " : "") + idle;
  if (SSTV.viewing && pic) text += "  ·  " + I18N("cwViewer.sstv.newest");
  sstvHeadText.textContent = text;
}

// The right-click on a picture: Save Picture..., Copy To Clipboard, Rotate, Filter (not while it comes in), Delete (From Session; File,
// its saved files deleted; Both: those two only while a file it was saved to is still there)
function mmdSstvMenu(event, pic)
{
  event.preventDefault();
  event.stopPropagation();
  if (!pic) return;
  const remote = window.require("@electron/remote");
  // Rotate: turned from as it is now, or back as it was received
  const turn = (by) => ({ click: () => mmdSstvRotate(pic, by == null ? null : ((pic.rotate || 0) + by) % 360) });
  const saved = mmdSstvSavedFiles(pic).length > 0;
  const undo = (pic.undo || []).length;
  const filters = SSTV_FILTERS.map((name) => ({ label: I18N("cwViewer.picture.filter" + name[0].toUpperCase() + name.slice(1) + ".label"), click: () => mmdSstvFilter(pic, name) }));
  const menu = remote.Menu.buildFromTemplate([
    { label: I18N("cwViewer.sstv.save.label"), click: () => mmdSstvSaveAs(pic) },
    { label: I18N("cwViewer.picture.copy.label"), click: () => mmdSstvCopy(pic) },
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
      enabled: pic != SSTV.live,
      submenu: filters.concat([
        { type: "separator" },
        { label: I18N("cwViewer.picture.filterUndo.label").replace("{count}", undo), enabled: undo > 0, click: () => mmdSstvUndo(pic, 1) },
        { label: I18N("cwViewer.picture.filterUndoAll.label"), enabled: undo > 0, click: () => mmdSstvUndo(pic, undo) }
      ])
    },
    { type: "separator" },
    {
      label: I18N("cwViewer.picture.delete.label"),
      submenu: [
        { label: I18N("cwViewer.picture.deleteSession.label"), click: () => mmdSstvDelete(pic) },
        { label: I18N("cwViewer.picture.deleteFile.label"), enabled: saved, click: () => mmdSstvUnlink(pic) },
        {
          label: I18N("cwViewer.picture.deleteBoth.label"),
          enabled: saved,
          click: () =>
          {
            mmdSstvUnlink(pic);
            mmdSstvDelete(pic);
          }
        }
      ]
    }
  ]);
  menu.popup({ window: remote.getCurrentWindow() });
}

// The files a picture was saved to (by Save Picture... or Save Pictures) that are still there
function mmdSstvSavedFiles(pic)
{
  return (pic.files || []).filter((file) => fs.existsSync(file));
}

// A picture's saved files deleted, the picture left in the session, not saved now
function mmdSstvUnlink(pic)
{
  for (const file of mmdSstvSavedFiles(pic))
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
  pic.files = mmdSstvSavedFiles(pic);
  pic.saved = pic.files.length ? pic.files[pic.files.length - 1] : null;
  mmdSstvStrip();
  mmdSstvDraw();
  mmdSstvHead();
}

// A turned picture's thumbnail made again with the rows that have come since, at most every SSTV_THUMB_TURNED_MS
const SSTV_THUMB_TURNED_MS = 3000;

function mmdSstvThumbTurned(pic)
{
  if (!pic.rotate || !pic.thumb || !pic.thumb.parentNode || Date.now() - pic.thumbAt < SSTV_THUMB_TURNED_MS) return;
  const fresh = mmdSstvTurned(pic);
  pic.thumb.parentNode.replaceChild(fresh, pic.thumb);
  pic.thumb = fresh;
  pic.thumbAt = Date.now();
}

// A picture turned (degrees clockwise: 0, 90, 180, 270; null as received): shown, in the strip, and saved or copied that way. A file
// saved already stays as it was
function mmdSstvRotate(pic, degrees)
{
  pic.rotate = degrees || 0;
  mmdSstvStrip();
  mmdSstvDraw();
}

// The picture as far as it came (a WEFAX chart: the rows received; its canvas grows WEFAX_GROW_ROWS at a time, white below them), turned
// as it is shown: a canvas of its own
function mmdSstvTurned(pic)
{
  const rows = pic.kind == "wefax" && pic.rows > 0 ? Math.min(pic.rows, pic.canvas.height) : pic.canvas.height;
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

// A picture filtered in place (name: one of SSTV_FILTERS), as far as it came: shown, in the strip, and saved or copied that way, what it
// was kept for Undo. A file saved already stays as it was
function mmdSstvFilter(pic, name)
{
  const width = pic.canvas.width, rows = pic.rows > 0 ? Math.min(pic.rows, pic.canvas.height) : pic.canvas.height;
  const image = pic.canvas.getContext("2d").getImageData(0, 0, width, rows);
  // (A chart's grey: one plane, so its Undo steps take a quarter of the room; else red, green and blue)
  const planes = mmdSstvPlanes(image.data, pic.kind == "wefax" ? 1 : 3);
  pic.undo = (pic.undo || []).concat([{ rows, planes: planes.map((p) => p.slice()) }]).slice(-SSTV_UNDO_KEEP);
  SSTV_FILTER[name](planes, width, rows);
  mmdSstvPut(pic, planes, rows);
}

// Undo: steps filters taken back (all of them: as it was received, turned as it is)
function mmdSstvUndo(pic, steps)
{
  if (!pic.undo || !pic.undo.length) return;
  const back = pic.undo.splice(Math.max(0, pic.undo.length - steps))[0];
  mmdSstvPut(pic, back.planes, back.rows);
}

// A picture's rows from its planes, shown again
function mmdSstvPut(pic, planes, rows)
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
  mmdSstvStrip();
  mmdSstvDraw();
}

// RGBA as planes: the first count of red, green and blue, each a byte a pixel
function mmdSstvPlanes(rgba, count)
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
const SSTV_FILTER = {
  // Unsharp mask: each pixel pushed as far again from its blurred neighborhood
  sharpen: (planes, w, h) => planes.forEach((p) =>
  {
    const blur = mmdSstvBlur(p, w, h);
    for (let i = 0; i < p.length; i++) p[i] = 2 * p[i] - blur[i];
  }),
  // Median of each 3 x 3: specks and noise taken out, edges and lines kept
  denoise: (planes, w, h) => planes.forEach((p) => p.set(mmdSstvMedian(p, w, h))),
  // Gaussian blur (5 x 5 binomial)
  smooth: (planes, w, h) => planes.forEach((p) => p.set(mmdSstvBlur(p, w, h))),
  // Its levels stretched to black and white (the darkest and lightest 0.5% let go)
  autoContrast: (planes) => mmdSstvLevels(planes, (hist, total) =>
  {
    let lo = 0, hi = 255;
    for (let n = 0; lo < 255 && (n += hist[lo]) <= total * 0.005;) lo++;
    for (let n = 0; hi > 0 && (n += hist[hi]) <= total * 0.005;) hi--;
    return hi > lo ? (v) => ((v - lo) * 255) / (hi - lo) : null;
  }),
  // Histogram equalization: its levels spread evenly from black to white
  equalize: (planes) => mmdSstvLevels(planes, (hist, total) =>
  {
    const cdf = new Float64Array(256);
    for (let v = 0, n = 0; v < 256; v++) cdf[v] = n += hist[v];
    const first = cdf[hist.findIndex((n) => n > 0)];
    return total > first ? (v) => ((cdf[v] - first) * 255) / (total - first) : null;
  }),
  // Gamma 1.25 and 0.8: the midtones lighter or darker, black and white kept
  lighten: (planes) => mmdSstvLevels(planes, () => (v) => 255 * Math.pow(v / 255, 0.8)),
  darken: (planes) => mmdSstvLevels(planes, () => (v) => 255 * Math.pow(v / 255, 1.25)),
  invert: (planes) => mmdSstvLevels(planes, () => (v) => 255 - v)
};

// Every plane's levels remapped the same way (colors kept): curve(histogram of all planes, its count) gives each level's new one, or
// null to leave them
function mmdSstvLevels(planes, curve)
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
function mmdSstvBlur(p, w, h)
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
const SSTV_MEDIAN_SWAPS = [1, 2, 4, 5, 7, 8, 0, 1, 3, 4, 6, 7, 1, 2, 4, 5, 7, 8, 0, 3, 5, 8, 4, 7, 3, 6, 1, 4, 2, 5, 4, 7, 4, 2, 6, 4, 4, 2];

// A plane's 3 x 3 medians (its edges repeated past them)
function mmdSstvMedian(p, w, h)
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
      for (let k = 0; k < SSTV_MEDIAN_SWAPS.length; k += 2)
      {
        const a = SSTV_MEDIAN_SWAPS[k], b = SSTV_MEDIAN_SWAPS[k + 1];
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

// The picture (as much of it as came) onto the clipboard as an image
function mmdSstvCopy(pic)
{
  const electron = window.require("electron");
  electron.clipboard.writeImage(electron.nativeImage.createFromDataURL(mmdSstvPng(pic)));
}

// The picture as a PNG data URL, as it is shown: a WEFAX chart only as far as its rows came, and turned if it is (mmdSstvTurned)
function mmdSstvPng(pic)
{
  if (!pic.rotate && (pic.kind != "wefax" || !(pic.rows > 0) || pic.rows >= pic.canvas.height)) return pic.canvas.toDataURL("image/png");
  return mmdSstvTurned(pic).toDataURL("image/png");
}

// Off the strip (one still coming in: the rest of it isn't shown); the newest shown large if it was the one shown. A file saved stays
function mmdSstvDelete(pic)
{
  SSTV.pictures = SSTV.pictures.filter((p) => p != pic);
  if (SSTV.live == pic) SSTV.live = null;
  if (SSTV.viewing == pic.id) SSTV.viewing = null;
  mmdSstvStrip();
  mmdSstvDraw();
  mmdSstvHead();
}

// The folder a picture is saved in by its mode: a WEFAX chart in WEFAX's Save Charts folder, an SSTV picture in Save Pictures'
function mmdSstvFolderOf(pic)
{
  return pic.kind == "wefax" ? window.opener.mmDecoderWefaxFolder() : window.opener.mmDecoderSstvFolder();
}

// Save: the dialog opens where a picture of its kind was last saved this way (MMD.saveAsDir, kept), else in its mode's folder (made
// first, so the dialog never starts in a folder that isn't there); the folder chosen is kept for the next
function mmdSstvSaveAs(pic)
{
  const remote = window.require("@electron/remote");
  const S = GT.settings.MMD;
  if (!S.saveAsDir || typeof S.saveAsDir != "object") S.saveAsDir = {};
  let dir = S.saveAsDir[pic.kind];
  if (!dir || !fs.existsSync(dir))
  {
    dir = mmdSstvFolderOf(pic);
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
    defaultPath: path.join(dir, mmdSstvFileName(pic)),
    filters: [{ name: "PNG", extensions: ["png"] }]
  });
  if (!file) return;
  S.saveAsDir[pic.kind] = path.dirname(file);
  mmdSstvSave(pic, file);
}

// Its name: the UTC time it started, its mode, and the frequency on the air (20261027-225115Z_Martin1_14230kHz.png)
function mmdSstvFileName(pic)
{
  const t = new Date(pic.at).toISOString();
  const when = t.slice(0, 10).replace(/-/g, "") + "-" + t.slice(11, 19).replace(/:/g, "") + "Z";
  return when + "_" + pic.name.replace(/[^\w-]+/g, "") + (pic.dial ? "_" + Math.round(pic.dial / 1000) + "kHz" : "") + ".png";
}

// Saved as a PNG: to file, or (null) into the folder Settings give
function mmdSstvSave(pic, file)
{
  try
  {
    if (!file) file = path.join(mmdSstvFolderOf(pic), mmdSstvFileName(pic));
    // Its folder made first, whichever it is (one taken away since, or never made)
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const data = mmdSstvPng(pic).split(",")[1];
    fs.writeFileSync(file, window.require("buffer").Buffer.from(data, "base64"));
    pic.saved = file;
    // Every file it was saved to (Delete's File takes them all)
    pic.files = (pic.files || []).filter((f) => f != file).concat(file);
    mmdSstvDraw();
  }
  catch (e)
  {
    mmdStatus(I18N("cwViewer.sstv.saveFailed") + " " + e.message, true);
  }
}

// The mode's newest SSTV_KEEP saved pictures (PNGs), into its strip behind any that came since, the first time its mode is shown in this
// window: each as it was saved, named, timed and on the frequency its file name gives (Delete's File takes the file). Both modes' folders
// are looked in, a file going to the mode its name gives (charts saved in SSTV Pictures before WEFAX had a folder of its own), one named
// otherwise to its folder's
async function mmdSstvLoadSaved(kind)
{
  if (SSTV.savedLoaded[kind]) return;
  SSTV.savedLoaded[kind] = true;
  let found = [];
  const folders = { sstv: mmdSstvFolderOf({ kind: "sstv" }), wefax: mmdSstvFolderOf({ kind: "wefax" }) };
  for (const folderKind of folders.sstv == folders.wefax ? ["sstv"] : ["sstv", "wefax"])
  {
    try
    {
      const folder = folders[folderKind];
      found = found.concat(fs.readdirSync(folder).filter((f) => /\.png$/i.test(f)).map((f) => mmdSstvSavedInfo(path.join(folder, f), folderKind)));
    }
    catch (e)
    {
      // (No folder yet: nothing saved there)
    }
  }
  found = found.filter((info) => info && info.kind == kind).sort((a, b) => b.at - a.at).slice(0, SSTV_KEEP);
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
  const list = SSTV.lists[kind];
  const fresh = pics.filter((pic) => !list.some((p) => (p.files || []).includes(pic.saved)));
  SSTV.lists[kind] = list.concat(fresh).sort((a, b) => b.at - a.at).slice(0, SSTV_KEEP);
  if (mmdSstvMode() && kind == mmdSstvKind())
  {
    mmdSstvStrip();
    mmdSstvDraw();
    mmdSstvHead();
  }
}

// A saved picture's file told by its name (mmdSstvFileName: 20261027-225115Z_Martin1_14230kHz.png, WEFAX's WEFAX120576): { file, kind,
// at, name, dial }. Another name: itself, its folder's kind, at the time it was written. Null for one it can't read
function mmdSstvSavedInfo(file, folderKind)
{
  try
  {
    const base = path.basename(file, path.extname(file));
    const m = base.match(/^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d)Z_([\w-]+?)(?:_(\d+)kHz)?$/);
    if (!m) return { file, kind: folderKind, at: fs.statSync(file).mtimeMs, name: base, dial: null };
    const at = Date.UTC(m[1], m[2] - 1, m[3], m[4], m[5], m[6]);
    // Its mode's spaces put back (Martin 1, Scottie DX, PD 120), a chart's line rate and index of cooperation apart (WEFAX 120/576)
    const wefax = m[7].match(/^WEFAX(\d+?)(576|288)$/);
    const name = wefax ? "WEFAX " + wefax[1] + "/" + wefax[2] : m[7].replace(/^([A-Za-z]+?)(\d+|DX)$/, "$1 $2");
    return { file, kind: wefax ? "wefax" : "sstv", at, name, dial: m[8] ? Number(m[8]) * 1000 : null };
  }
  catch (e)
  {
    return null;
  }
}

// ---- WEFAX

// A chart's grey levels (0 black, 255 white) as RGBA
function mmdWefaxRgba(grey)
{
  const rgba = new Uint8ClampedArray(grey.length * 4);
  for (let i = 0, j = 0; i < grey.length; i++, j += 4)
  {
    rgba[j] = rgba[j + 1] = rgba[j + 2] = grey[i];
    rgba[j + 3] = 255;
  }
  return rgba;
}

// A chart's canvas long enough for rows lines: a longer one (white below), what it had copied in, and the strip shown again (it holds
// the canvas itself)
function mmdWefaxRoom(pic, rows)
{
  if (rows <= pic.canvas.height) return;
  const canvas = document.createElement("canvas");
  canvas.width = pic.width;
  canvas.height = Math.ceil(rows / WEFAX_GROW_ROWS) * WEFAX_GROW_ROWS;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(pic.canvas, 0, 0);
  pic.canvas = canvas;
  mmdSstvStrip();
}

// The worker told the menus' choices (MMD.wefaxLpm, MMD.wefaxIoc), and whatever else is given (startNow)
function mmdWefaxConfig(extra)
{
  const S = GT.settings.MMD;
  const worker = SSTV.workers.wefax;
  if (!worker) return;
  worker.postMessage(Object.assign({ type: "config", lpm: S.wefaxLpm || "auto", ioc: S.wefaxIoc || "auto", trim: SSTV.wefaxTrim, align: SSTV.wefaxAlign }, extra));
}

// Trim: the chart's slant (step: -1 or 1; 0 back to none), drawn again at once, and kept for the next start (MMD.wefaxTrim)
function mmdWefaxTrimStep(step)
{
  SSTV.wefaxTrim = step == 0 ? 0 : Math.max(-WEFAX_TRIM_MAX, Math.min(WEFAX_TRIM_MAX, SSTV.wefaxTrim + step * WEFAX_TRIM_STEP));
  GT.settings.MMD.wefaxTrim = SSTV.wefaxTrim;
  cwWefaxTrimValue.textContent = (SSTV.wefaxTrim > 0 ? "+" : "") + SSTV.wefaxTrim;
  mmdWefaxConfig({});
}

// A click on the WEFAX chart coming in (the newest, shown): the chart's real left edge is there, so its lines are moved to start there
// (what came already drawn again). True when it was one
function mmdWefaxAlignAt(event)
{
  const d = SSTV.drawn;
  if (DEC.mode != "wefax" || !d || !d.pic || d.pic != SSTV.live || SSTV.viewing) return false;
  const ratio = window.devicePixelRatio || 1;
  // Where across the chart's lines the click was, the chart's turning undone (90° right: its lines run down the screen)
  const across = (event.offsetX * ratio - d.x) / d.w, down = (event.offsetY * ratio - d.y) / d.h;
  const share = { 0: across, 90: down, 180: 1 - across, 270: 1 - down }[d.rotate || 0];
  if (!(share >= 0 && share <= 1)) return false;
  SSTV.wefaxAlign = (SSTV.wefaxAlign + share) % 1;
  mmdWefaxConfig({});
  return true;
}

// The second line's WEFAX menus, shown in its mode
function mmdWefaxMenu()
{
  const S = GT.settings.MMD;
  const fill = (select, choices, value) =>
  {
    select.innerHTML = "";
    for (const c of choices) select.add(new Option(c == "auto" ? I18N("cwViewer.wefax.auto") : String(c), c, false, String(c) == String(value || "auto")));
  };
  fill(cwWefaxLpm, WEFAX_LPM_CHOICES, S.wefaxLpm);
  fill(cwWefaxIoc, WEFAX_IOC_CHOICES, S.wefaxIoc);
  cwWefaxTrimValue.textContent = (SSTV.wefaxTrim > 0 ? "+" : "") + SSTV.wefaxTrim;
}

function mmdWefaxPicked()
{
  const value = (v) => v == "auto" ? "auto" : Number(v);
  GT.settings.MMD.wefaxLpm = value(cwWefaxLpm.value);
  GT.settings.MMD.wefaxIoc = value(cwWefaxIoc.value);
  mmdWefaxConfig({});
}

// Start Now: a chart begun here, without waiting for its start tone (one tuned in partway)
function mmdWefaxStartNow()
{
  mmdSstvLoad("wefax");
  mmdWefaxConfig({ startNow: true });
}

// Stop: the chart coming in ends here
function mmdWefaxStop()
{
  if (SSTV.workers.wefax) SSTV.workers.wefax.postMessage({ type: "stop" });
}
