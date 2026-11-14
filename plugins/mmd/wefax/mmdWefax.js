// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The WEFAX plugin (plugin.json beside this file): weather fax charts from the 12 kHz audio (the worklet's stream, input "audio12"),
// read by wefaxWorker.js. Each chart is shown in the decoder's picture view as a kind of its own (host.pictures: kept apart from SSTV's
// pictures, saved with Save Charts into its own folder); a chart's length isn't known as it starts, so its canvas grows as its lines
// come. Its line rate and index of cooperation are found by the worker (from the start tone and phasing), and it keeps the chart straight
// and lined up by itself. Start Now, Stop and Auto-Tune (mmdWefaxAuto.js) are on a row of their own (its ui.html's bar)

const WEFAX = {
  host: null,   // the decoder's host (mmdPluginHost.js), from init
  worker: null  // wefaxWorker.js, once
};

function mmdWefaxMode()
{
  return WEFAX.host != null && WEFAX.host.mode() == "wefax";
}

function mmdWefaxInit(host)
{
  WEFAX.host = host;
  // Its charts in the picture view: grey on white, growing as they come; saved in Save Charts' folder (MMD.wefaxFolder, else WEFAX Charts
  // beside GridTracker's own folders) with Save Charts; a saved file's name part "WEFAX120576" is a chart's (WEFAX 120/576)
  host.pictures.kind({
    folder: () => host.get("wefaxFolder") || host.folder("WEFAX Charts"),
    saveKey: "wefaxSave",
    idleKey: "cwViewer.wefax.idle",
    grows: true,
    datestamp: true,
    background: "white",
    planes: 1,
    tabs: false,
    // How much of a chart came: its lines so far (its length isn't known until its stop tone), and Receiving while it comes
    describe: (pic, live) => [host.t("cwViewer.wefax.lines").replace("{line}", pic.rows)].concat(live ? [host.t("cwViewer.wefax.receiving")] : []),
    // Its right-click's Print and Show In Folder; each chart lined up and cropped as it ends with Auto-Align and Auto-Crop on (Settings,
    // Decoders: wefaxAutoAlign, wefaxAutoCrop)
    chartTools: true,
    // A saved chart's station: its file name's, else found from its time and frequency
    station: (info) => mmdWefaxStation(info.dial, info.at, info.station),
    fromFile: (name) =>
    {
      const m = name.match(/^WEFAX(\d+?)(576|288)$/);
      return m ? "WEFAX " + m[1] + "/" + m[2] : null;
    }
  });
}

// The worker, once
function mmdWefaxLoad()
{
  if (WEFAX.worker) return WEFAX.worker;
  const H = WEFAX.host;
  WEFAX.worker = new Worker(H.workerUrl("wefaxWorker.js"));
  WEFAX.worker.onmessage = (event) => H.guard(() => mmdWefaxMessage(event.data));
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
    // Its length isn't known yet (it grows), named by its line rate and index of cooperation, and the station it is from (none for a
    // test signal's: the rig's dial says nothing about it)
    const now = Date.now();
    const station = WEFAX.host.testHeard(now) ? null : mmdWefaxStation(WEFAX.host.dialHz(), now, null);
    P.start({ id: m.id, name: "WEFAX " + m.lpm + "/" + m.ioc, width: m.width, height: 0, shift: m.offsetHz || 0, station });
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

// ---- The station a chart is from (shown over its caption, in its file name)

// A listed frequency this close (kHz) to the carrier is the station's, and a chart this close (ms) to the time is the one being sent
const WEFAX_STATION_KHZ = 1;
const WEFAX_STATION_NEAR_MS = 15 * 60000;

// The station a chart is from: { id, label } ("NMC · Point Reyes, CA"), or null. By its id (a saved chart's file name; "VFF-VFR" for two),
// else by its frequency (dial Hz: the carrier is 1.9 kHz above it) and time (ms): the chart Auto-Tune tuned for there, else the
// schedule's stations sending on it; two or more: those on the air then, then those with a chart near then, else all of them together
function mmdWefaxStation(dial, at, id)
{
  try
  {
    const stations = mmdWefaxAutoData().stations;
    const named = (list) => (list.length ? { id: list.map((s) => s.id).join("-"), label: list.map((s) => s.id).join("/") + " · " + list.map((s) => s.name).join(" / ") } : null);
    if (id)
    {
      const ids = String(id).split("-");
      const list = ids.map((i) => stations.find((s) => String(s.id) == i)).filter(Boolean);
      if (list.length == ids.length) return named(list);
    }
    if (!(dial > 0)) return null;
    const khz = (dial + 1900) / 1000;
    const n = WEFAX_AUTO.next;
    if (n && WEFAX_AUTO.dial != null && Math.abs(n.dial - dial) <= WEFAX_AUTO_MOVED_HZ && Math.abs(n.at - at) <= WEFAX_STATION_NEAR_MS) return named([n.station]);
    const on = (f) => Math.abs(Number(f.khz) - khz) <= WEFAX_STATION_KHZ;
    let list = stations.filter((s) => (s.frequencies || []).some(on));
    if (list.length > 1)
    {
      const onAir = list.filter((s) => s.frequencies.some((f) => on(f) && mmdWefaxAutoOnAir(f, at)));
      if (onAir.length) list = onAir;
    }
    if (list.length > 1)
    {
      const near = list.filter((s) => mmdWefaxStationNear(s, at));
      if (near.length) list = near;
    }
    return named(list);
  }
  catch (e)
  {
    return null;
  }
}

// A station with a chart scheduled within WEFAX_STATION_NEAR_MS of a time (the day before, of, or after it)
function mmdWefaxStationNear(station, at)
{
  const day = 86400000, midnight = Math.floor(at / day) * day;
  return (station.charts || []).some((chart) =>
  {
    const minutes = mmdWefaxAutoMinutes(chart.time);
    if (minutes == null) return false;
    return [midnight - day, midnight, midnight + day].some((base) =>
    {
      const t = base + minutes * 60000;
      return Math.abs(t - at) <= WEFAX_STATION_NEAR_MS && mmdWefaxAutoOnDay(station, chart, t);
    });
  });
}

// ---- Its row: Start Now, Stop (Auto-Tune: mmdWefaxAuto.js)

// The worker told what is given (startNow)
function mmdWefaxConfig(extra)
{
  if (!WEFAX.worker) return;
  WEFAX.worker.postMessage(Object.assign({ type: "config" }, extra));
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

// ---- Its box on Settings, Decoders: Set Mode, Auto-Align, Auto-Crop, Save Charts and its folder (Set Frequency and the rest are the
// decoder's own, as every mode's)

function mmdWefaxSettings()
{
  const H = WEFAX.host;
  wefaxSetModeValue.checked = H.get("wefaxSetMode") === true;
  wefaxAutoAlignValue.checked = H.get("wefaxAutoAlign") === true;
  wefaxAutoCropValue.checked = H.get("wefaxAutoCrop") === true;
  wefaxSaveValue.checked = H.get("wefaxSave") === true;
  wefaxFolderTr.style.display = H.get("wefaxSave") === true ? "" : "none";
  H.showFolder(wefaxFolderText, H.get("wefaxFolder") || H.folder("WEFAX Charts"), "settings.wefaxDecoder.folder.hover");
}

// Auto-Align and Auto-Crop: each chart lined up and cropped as it ends, before it's saved (mmdPicDone; wefaxAutoAlign, wefaxAutoCrop)
function mmdWefaxSetAuto()
{
  WEFAX.host.set("wefaxAutoAlign", wefaxAutoAlignValue.checked);
  WEFAX.host.set("wefaxAutoCrop", wefaxAutoCropValue.checked);
  mmdWefaxSettings();
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
  // Its row (Start Now, Stop, Auto-Tune); the picture view is the decoder's own (shown in its mode)
  shown: (on) =>
  {
    cwWefaxBar.style.display = on ? "" : "none";
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
