// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The WEFAX plugin (plugin.json beside this file): weather fax charts from the 12 kHz audio (the worklet's stream, input "audio12"),
// read by wefaxWorker.js. Each chart is shown in the decoder's picture view as a kind of its own (host.pictures: kept apart from SSTV's
// pictures, saved with Save Charts into its own folder); a chart's length isn't known as it starts, so its canvas grows as its lines
// come. Its line rate, index of cooperation, Trim, Start Now, Stop and Auto-Tune (mmdWefaxAuto.js) are on a row of their own (its ui.html's
// bar)

// Its menus: lines a minute, index of cooperation ("auto": found from the start tone and phasing)
const WEFAX_LPM_CHOICES = ["auto", 60, 90, 120, 240];
const WEFAX_IOC_CHOICES = ["auto", 576, 288];
// Trim's step and limit (ppm: the line rate made this much slower, positive, or faster)
const WEFAX_TRIM_STEP = 20;
const WEFAX_TRIM_MAX = 2000;

const WEFAX = {
  host: null,   // the decoder's host (mmdPluginHost.js), from init
  worker: null, // wefaxWorker.js, once
  // Trim by hand (ppm; kept across restarts in MMD.wefaxTrim). Where a chart's own left edge is on its lines the worker finds by itself
  trim: 0
};

function mmdWefaxMode()
{
  return WEFAX.host != null && WEFAX.host.mode() == "wefax";
}

function mmdWefaxInit(host)
{
  WEFAX.host = host;
  const trim = Number(host.get("wefaxTrim"));
  WEFAX.trim = Number.isFinite(trim) ? Math.max(-WEFAX_TRIM_MAX, Math.min(WEFAX_TRIM_MAX, Math.round(trim / WEFAX_TRIM_STEP) * WEFAX_TRIM_STEP)) : 0;
  // Its charts in the picture view: grey on white, growing as they come; saved in Save Charts' folder (MMD.wefaxFolder, else WEFAX Charts
  // beside GridTracker's own folders) with Save Charts; a saved file's name part "WEFAX120576" is a chart's (WEFAX 120/576)
  host.pictures.kind({
    folder: () => host.get("wefaxFolder") || host.folder("WEFAX Charts"),
    saveKey: "wefaxSave",
    idleKey: "cwViewer.wefax.idle",
    grows: true,
    background: "white",
    planes: 1,
    tabs: false,
    // How much of a chart came: its lines so far (its length isn't known until its stop tone), and Receiving while it comes
    describe: (pic, live) => [host.t("cwViewer.wefax.lines").replace("{line}", pic.rows)].concat(live ? [host.t("cwViewer.wefax.receiving")] : []),
    fromFile: (name) =>
    {
      const m = name.match(/^WEFAX(\d+?)(576|288)$/);
      return m ? "WEFAX " + m[1] + "/" + m[2] : null;
    }
  });
}

// The worker, once (told its menus' choices)
function mmdWefaxLoad()
{
  if (WEFAX.worker) return WEFAX.worker;
  const H = WEFAX.host;
  WEFAX.worker = new Worker(H.workerUrl("wefaxWorker.js"));
  WEFAX.worker.onmessage = (event) => H.guard(() => mmdWefaxMessage(event.data));
  mmdWefaxConfig({});
  return WEFAX.worker;
}

// A chunk of 12 kHz audio from the worklet
function mmdWefaxAudio(data)
{
  mmdWefaxLoad().postMessage({ type: "audio", samples: data.samples }, [data.samples.buffer]);
}

// The audio starts again (WEFAX picked, the input started, Clear, a retune): what the worker was reading is let go
function mmdWefaxReset()
{
  if (WEFAX.worker) WEFAX.worker.postMessage({ type: "reset" });
  // (the decoder can start before its init: nothing of it to let go yet)
  if (WEFAX.host) WEFAX.host.pictures.reset();
}

function mmdWefaxMessage(m)
{
  const P = WEFAX.host.pictures;
  // Another mode showing: nothing of it shown here
  if (!P.shown()) return;
  if (m.type == "status")
  {
    P.head();
    return;
  }
  if (m.type == "start")
  {
    // Its length isn't known yet (it grows), named by its line rate and index of cooperation
    P.start({ id: m.id, name: "WEFAX " + m.lpm + "/" + m.ioc, width: m.width, height: 0, shift: m.offsetHz || 0 });
    // Auto-Tune: the chart tuned for has begun (mmdWefaxAuto.js)
    mmdWefaxAutoStarted();
    return;
  }
  // Its rows are grey levels (made RGBA for the view)
  const rgba = m.pixels ? P.grey(m.pixels) : m.rgba;
  if (m.type == "rows") P.rows(m.id, m.from, m.count, rgba);
  // Drawn again (a better line rate): over the rows it had; every row ever shown stays shown
  else if (m.type == "redraw" && m.count > 0) P.redraw(m.id, m.count, rgba);
  else if (m.type == "done")
  {
    if (m.count > 0) P.redraw(m.id, m.count, rgba, false);
    P.done(m.id, m.complete);
  }
}

// Where a chart's tones belong, to tune by (dashed): black (1500 Hz) and white (2300 Hz), moved to where the newest chart's sender was
// found when it was off (drawn under the RSIDs heard)
function mmdWefaxDrawMarks(ctx, x, ratio, w, h)
{
  if (!mmdWefaxMode()) return;
  const shift = WEFAX.host.pictures.shift();
  ctx.lineWidth = Math.max(1, Math.round(ratio));
  ctx.setLineDash([4 * ratio, 4 * ratio]);
  for (const hz of [1500, 2300])
  {
    const at = Math.round(x(hz + shift)) + 0.5;
    ctx.strokeStyle = "rgba(200, 200, 200, 0.6)";
    ctx.beginPath();
    ctx.moveTo(at, 0);
    ctx.lineTo(at, h);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

// ---- Its row: LPM, IOC, Trim, Start Now, Stop (Auto-Tune: mmdWefaxAuto.js)

// The worker told the menus' choices (MMD.wefaxLpm, MMD.wefaxIoc) and Trim, and whatever else is given (startNow)
function mmdWefaxConfig(extra)
{
  const H = WEFAX.host;
  if (!WEFAX.worker) return;
  WEFAX.worker.postMessage(Object.assign({ type: "config", lpm: H.get("wefaxLpm") || "auto", ioc: H.get("wefaxIoc") || "auto", trim: WEFAX.trim }, extra));
}

// Trim: the chart's slant (step: -1 or 1; 0 back to none), drawn again at once, and kept for the next start (MMD.wefaxTrim)
function mmdWefaxTrimStep(step)
{
  WEFAX.trim = step == 0 ? 0 : Math.max(-WEFAX_TRIM_MAX, Math.min(WEFAX_TRIM_MAX, WEFAX.trim + step * WEFAX_TRIM_STEP));
  WEFAX.host.set("wefaxTrim", WEFAX.trim);
  cwWefaxTrimValue.textContent = (WEFAX.trim > 0 ? "+" : "") + WEFAX.trim;
  mmdWefaxConfig({});
}

// Its row's menus, shown in its mode
function mmdWefaxMenu()
{
  const H = WEFAX.host;
  const fill = (select, choices, value) =>
  {
    select.innerHTML = "";
    for (const c of choices) select.add(new Option(c == "auto" ? H.t("cwViewer.wefax.auto") : String(c), c, false, String(c) == String(value || "auto")));
  };
  fill(cwWefaxLpm, WEFAX_LPM_CHOICES, H.get("wefaxLpm"));
  fill(cwWefaxIoc, WEFAX_IOC_CHOICES, H.get("wefaxIoc"));
  cwWefaxTrimValue.textContent = (WEFAX.trim > 0 ? "+" : "") + WEFAX.trim;
}

function mmdWefaxPicked()
{
  const value = (v) => (v == "auto" ? "auto" : Number(v));
  WEFAX.host.set("wefaxLpm", value(cwWefaxLpm.value));
  WEFAX.host.set("wefaxIoc", value(cwWefaxIoc.value));
  mmdWefaxConfig({});
}

// Start Now: a chart begun here, without waiting for its start tone (one tuned in partway)
function mmdWefaxStartNow()
{
  mmdWefaxLoad();
  mmdWefaxConfig({ startNow: true });
}

// Stop: the chart coming in ends here
function mmdWefaxStop()
{
  if (WEFAX.worker) WEFAX.worker.postMessage({ type: "stop" });
}

// ---- Its box on Settings, Decoders: Set Mode, Save Charts and its folder (Set Frequency and the rest are the decoder's own, as every mode's)

function mmdWefaxSettings()
{
  const H = WEFAX.host;
  wefaxSetModeValue.checked = H.get("wefaxSetMode") === true;
  wefaxSaveValue.checked = H.get("wefaxSave") === true;
  wefaxFolderTr.style.display = H.get("wefaxSave") === true ? "" : "none";
  H.showFolder(wefaxFolderText, H.get("wefaxFolder") || H.folder("WEFAX Charts"), "settings.wefaxDecoder.folder.hover");
}

// Save Charts: each chart saved as it ends, into its folder; its Folder shown while it is on
function mmdWefaxSetSave()
{
  WEFAX.host.set("wefaxSave", wefaxSaveValue.checked);
  mmdWefaxSettings();
}

mmdRegisterMode({
  id: "wefax",
  name: "WEFAX",
  modes: ["wefax"],
  input: "audio12",
  init: (host) => mmdWefaxInit(host),
  audio: (data) => mmdWefaxAudio(data),
  // Its row (line rate, IOC, Trim, Start Now, Stop, Auto-Tune); the picture view is the decoder's own (shown in its mode)
  shown: (on) =>
  {
    cwWefaxBar.style.display = on ? "" : "none";
    if (on) mmdWefaxMenu();
  },
  // Listening afresh (what it had heard before is gone); the first time in this window, its saved charts in its strip
  entered: () =>
  {
    mmdWefaxReset();
    WEFAX.host.pictures.entered();
  },
  drawBack: (ctx, x, ratio, w, h) => mmdWefaxDrawMarks(ctx, x, ratio, w, h),
  // Auto-Tune: the next chart tuned for when it's time
  tick: () => mmdWefaxAutoTick(),
  clear: () =>
  {
    if (!mmdWefaxMode()) return;
    mmdWefaxReset();
    WEFAX.host.pictures.clear();
  },
  // (a chart coming in ends here: it is kept as far as it got)
  retune: () =>
  {
    if (mmdWefaxMode()) mmdWefaxReset();
  },
  // It hears the audio from the start (a chart under way when it stopped can't go on)
  start: () => mmdWefaxReset(),
  // (the window lays itself out before its modes' init: nothing to draw then)
  layout: () =>
  {
    if (WEFAX.host) WEFAX.host.pictures.draw();
  },
  settingsRender: () => mmdWefaxSettings()
});
