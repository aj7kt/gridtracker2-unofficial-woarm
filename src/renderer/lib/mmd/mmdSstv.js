// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Multi-Mode Decoder's SSTV mode (the Mode menu): the 12 kHz audio the worklet sends (as for FT8) goes to sstvWorker.js, which reads
// the pictures. Here each one is drawn as it comes in, the newest few are kept in a strip beside it (a click shows one large, a click on
// the large one goes back to the newest), and they are saved: each as it ends with Settings' Save Pictures, or any one with a right-click

// Pictures kept in the strip
const SSTV_KEEP = 12;

const SSTV = {
  worker: null,
  pictures: [], // the newest first: { id, name, width, height, canvas, rows, complete, at (ms, its start), dial (Hz on the air or null), saved }
  live: null,   // the one coming in
  viewing: null, // the one shown large (a click on the strip); null: the newest
  status: { state: "idle", snr: -20, line: 0, lines: 0 },
  drawQueued: false,
  tab: "receive" // the view's tab: "receive" (the pictures) or "send" (Send Picture, mmdSstvTx.js)
};

function mmdSstvInit()
{
  sstvPicture.addEventListener("click", () => mmdSstvView(null));
  sstvPicture.addEventListener("contextmenu", (event) => mmdSstvMenu(event, mmdSstvShown()));
  window.addEventListener("resize", mmdSstvDraw);
}

// sstvWorker.js, once
function mmdSstvLoad()
{
  if (SSTV.worker) return SSTV.worker;
  SSTV.worker = new Worker("lib/mmd/sstvWorker.js");
  SSTV.worker.onmessage = (event) => mmdSstvMessage(event.data);
  return SSTV.worker;
}

// A chunk of 12 kHz audio from the worklet
function mmdSstvAudio(data)
{
  mmdSstvLoad().postMessage({ type: "audio", samples: data.samples }, [data.samples.buffer]);
}

// The audio starts again (SSTV mode chosen, the input started, Clear): what the worker was reading is let go
function mmdSstvReset()
{
  if (SSTV.worker) SSTV.worker.postMessage({ type: "reset" });
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

function mmdSstvMessage(m)
{
  if (m.type == "status")
  {
    SSTV.status = m;
    mmdSstvHead();
    return;
  }
  if (m.type == "start")
  {
    const canvas = document.createElement("canvas");
    canvas.width = m.width;
    canvas.height = m.height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, m.width, m.height);
    const dial = mmdDial();
    const pic = { id: m.id, name: m.name, width: m.width, height: m.height, canvas, rows: 0, complete: false, at: Date.now(), dial, shift: m.shift || 0, saved: null };
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
  const ctx = pic.canvas.getContext("2d");
  if (m.type == "rows")
  {
    ctx.putImageData(new ImageData(m.rgba, pic.width, m.count), 0, m.from);
    pic.rows = Math.max(pic.rows, m.from + m.count);
  }
  // Drawn again (a better line rate): over the rows it had; every row ever shown stays shown
  else if ((m.type == "redraw" || m.type == "done") && m.count > 0)
  {
    ctx.putImageData(new ImageData(m.rgba, pic.width, m.count), 0, 0);
    pic.rows = Math.max(pic.rows, m.count);
  }
  if (m.type == "done")
  {
    pic.complete = m.complete;
    if (SSTV.live == pic) SSTV.live = null;
    // Nothing of it ever drawn: off the strip
    if (pic.rows == 0) SSTV.pictures = SSTV.pictures.filter((p) => p != pic);
    // Saved however much of it came (not a test signal's: mmdTest.js)
    else if (GT.settings.MMD.sstvSave && !mmdTestHeard(pic.at, Date.now())) mmdSstvSave(pic, null);
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
    if (DEC.mode != "sstv") return;
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
    const scale = Math.min(w / pic.width, h / pic.height);
    const dw = pic.width * scale, dh = pic.height * scale;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(pic.canvas, (w - dw) / 2, (h - dh) / 2, dw, dh);
  });
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
    item.appendChild(pic.canvas);
    item.addEventListener("click", () => mmdSstvView(pic == SSTV.pictures[0] ? null : pic.id));
    item.addEventListener("contextmenu", (event) => mmdSstvMenu(event, pic));
    sstvStrip.appendChild(item);
  }
}

// A picture told in a line: its mode, UTC time, frequency on the air, and how much of it came
function mmdSstvDescribe(pic)
{
  const parts = [pic.name, new Date(pic.at).toISOString().slice(11, 19) + " UTC"];
  if (pic.dial) parts.push((pic.dial / 1e6).toFixed(3) + " MHz");
  // Its sender's tones this far from where they belong (it was found and read there)
  if (Math.abs(pic.shift) >= 25) parts.push((pic.shift > 0 ? "+" : "") + pic.shift + " Hz");
  if (pic == SSTV.live) parts.push(I18N("cwViewer.sstv.line").replace("{line}", pic.rows).replace("{lines}", pic.height));
  else if (!pic.complete) parts.push(I18N("cwViewer.sstv.cut").replace("{line}", pic.rows).replace("{lines}", pic.height));
  if (pic.saved) parts.push(I18N("cwViewer.sstv.saved"));
  return parts.join(" · ");
}

// The header over the picture (also what is dragged to share the room with the waterfall): the picture shown, or what is listened for
function mmdSstvHead()
{
  const pic = mmdSstvShown();
  let text = pic ? mmdSstvDescribe(pic) : I18N("cwViewer.sstv.idle");
  if (!SSTV.live && pic) text += "  ·  " + I18N("cwViewer.sstv.idle");
  if (SSTV.viewing && pic) text += "  ·  " + I18N("cwViewer.sstv.newest");
  sstvHeadText.textContent = text;
}

// The right-click on a picture: Save Picture..., Copy To Clipboard, Delete
function mmdSstvMenu(event, pic)
{
  event.preventDefault();
  event.stopPropagation();
  if (!pic) return;
  const remote = window.require("@electron/remote");
  const menu = remote.Menu.buildFromTemplate([
    { label: I18N("cwViewer.sstv.save.label"), click: () => mmdSstvSaveAs(pic) },
    { label: I18N("cwViewer.picture.copy.label"), click: () => mmdSstvCopy(pic) },
    { type: "separator" },
    { label: I18N("cwViewer.picture.delete.label"), click: () => mmdSstvDelete(pic) }
  ]);
  menu.popup({ window: remote.getCurrentWindow() });
}

// The picture (as much of it as came) onto the clipboard as an image
function mmdSstvCopy(pic)
{
  const electron = window.require("electron");
  electron.clipboard.writeImage(electron.nativeImage.createFromDataURL(pic.canvas.toDataURL("image/png")));
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

function mmdSstvSaveAs(pic)
{
  const remote = window.require("@electron/remote");
  const file = remote.dialog.showSaveDialogSync(remote.getCurrentWindow(), {
    defaultPath: path.join(window.opener.mmDecoderSstvFolder(), mmdSstvFileName(pic)),
    filters: [{ name: "PNG", extensions: ["png"] }]
  });
  if (file) mmdSstvSave(pic, file);
}

// Its name: the UTC time it started, its mode, and the frequency on the air (20261027-225115Z_Martin1_14230kHz.png)
function mmdSstvFileName(pic)
{
  const t = new Date(pic.at).toISOString();
  const when = t.slice(0, 10).replace(/-/g, "") + "-" + t.slice(11, 19).replace(/:/g, "") + "Z";
  return when + "_" + pic.name.replace(/\s+/g, "") + (pic.dial ? "_" + Math.round(pic.dial / 1000) + "kHz" : "") + ".png";
}

// Saved as a PNG: to file, or (null) into the folder Settings give
function mmdSstvSave(pic, file)
{
  try
  {
    if (!file) file = path.join(window.opener.mmDecoderSstvFolder(), mmdSstvFileName(pic));
    // Its folder made first, whichever it is (one taken away since, or never made)
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const data = pic.canvas.toDataURL("image/png").split(",")[1];
    fs.writeFileSync(file, window.require("buffer").Buffer.from(data, "base64"));
    pic.saved = file;
  }
  catch (e)
  {
    mmdStatus(I18N("cwViewer.sstv.saveFailed") + " " + e.message, true);
  }
}
