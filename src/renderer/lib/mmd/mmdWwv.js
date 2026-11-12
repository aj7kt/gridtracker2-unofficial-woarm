// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Multi-Mode Decoder's WWV mode (WWV and WWVH, NIST's time stations): the 12 kHz audio (the worklet's FT8 stream) goes to
// wwvWorker.js with the PC clock's time of each chunk's last sample (mmdWwvAudio: by the context's own clock, less WWV_LATENCY_MS). The
// worker finds the second pulses, reads the time code and times each station's pulses against the PC clock each minute. Here, in
// wwvView: the time as the stations send it, the date, DUT1, the leap second warning and U.S. daylight saving time from the code, each
// station heard and how clearly; then the PC clock's offset, from the last few minutes' pulses less the radio path from your location
// (GT.myLat, GT.myLon) to each station: a sky wave off the F2 layer at about 300 km (virtual height), in as many hops as the ground
// distance needs at 3500 km a hop at most (within a millisecond or so). The audio's delay is measured on one setup only, so the offset
// is given as good to WWV_SYSTEM_MS. Set PC Clock, shown once the offset has held steady over several minutes and is well over that,
// moves the clock by it through the system's own administrator prompt (the main process's clockAdjust): only when clicked and confirmed,
// never by itself, and only with a sound card's audio (a network stream's or an SDR server's delay isn't the one measured). Each minute
// timed is listed under it, the newest on top

// The stations: their transmitters (NIST)
const WWV_SITES = { WWV: { lat: 40.6781, lon: -105.0472 }, WWVH: { lat: 21.9878, lon: -159.7636 } };
// The sky wave: the F2 layer's virtual height (km), a hop's longest ground distance (km), the Earth's radius (km), light's speed (km/s)
const WWV_LAYER_KM = 300;
const WWV_HOP_KM = 3500;
const WWV_EARTH_KM = 6371;
const WWV_LIGHT_KMS = 299792.458;
// The offset: from the minutes of the last this many; settled with this many of them at least, with the time code read
const WWV_WINDOW_MINUTES = 5;
const WWV_STABLE_MINUTES = 3;
// The audio's delay from the antenna to the context's clock (ms), taken off each chunk's time (mmdWwvAudio). Measured 2026-11-11 on an
// IC-7300 (USB-D, FIL1) through its USB codec (WASAPI shared, Chromium's audio input) in this window's context: the offset shown then,
// with FT8's mapping (the output timestamp, less FT8_LATENCY_MS), was 0.146 s short of the PC clock's offset from time.nist.gov
// (w32tm, the same minutes), so that mapping's true delay was 154 ms; of it, 78 ms was the context's own output side (currentTime less
// the output timestamp's contextTime, 89 ms, less the timestamp's age, 11 ms), which this mapping leaves out (it differs from one output
// device to another: Bluetooth, a USB headset ...), leaving 76 ms (latencyHint "playback" then) for the rig's DSP, the codec, the
// driver and Chromium's input. That part differs from one rig and sound card to another and isn't measured here: the offset is given
// as good to WWV_SYSTEM_MS (combined with its own scatter). FT8_LATENCY_MS (FT8's DT convention against WSJT-X, not absolute time) is left as it is.
// Measured again once the context went from latencyHint "playback" to "interactive" (mmDecoder.js; same rig, same day, 12 minutes
// timed): the offset shown with 76 was 52 ms short of time.nist.gov's, so on the interactive path it is 24
const WWV_LATENCY_MS = 24;
const WWV_SYSTEM_MS = 50;
// Set PC Clock: offered when the offset is at least this (ms: five times WWV_SYSTEM_MS, so the clock set ends up far nearer than it was),
// its own uncertainty under this (ms), and its minutes within this of each other (ms)
const WWV_SET_MIN_MS = 250;
const WWV_SET_SIGMA_MS = 20;
const WWV_SET_SPREAD_MS = 50;
// The worker's last statuses kept (their diag: what the count did, for a recording made alongside to be checked against offline)
const WWV_LOG = 3600;
// A stretch the stream skipped of more than this many samples (12 kHz), and under this many seconds, is given to the worker as silence
const WWV_GAP_MIN = 6;
const WWV_GAP_MAX_S = 5;
// The audio's delay changing (the worker's delayStepMs) is said for this long after (ms)
const WWV_STEP_SHOWN_MS = 300000;
// A minute this far (ms) from the one before it: the PC clock was set meanwhile (the offset starts again from it)
const WWV_JUMP_MS = 100;
// Minutes listed
const WWV_HISTORY = 120;

const WWV = {
  worker: null,
  status: null,   // the worker's last status
  frame: null,    // the last minute's frame taken: { fields, mode }
  // The minutes timed, the newest first: { minuteStart, mode, test (heard while a test signal played), offset (ms, the paths taken off),
  // local (a sound card's audio), stations: [{ name, n, median, mad, sigma, snr, path: { km, hops, ms } or null, offset }] }
  minutes: [],
  since: 0,       // the offset is from the minutes starting from here on (ms: after a jump or a Set PC Clock)
  setting: false, // Set PC Clock under way
  note: null,     // what Set PC Clock did: { text, error }
  log: [],        // the last WWV_LOG statuses' diag, with the PC clock's time each came: [{ at, utc, lost, diag, gaps }]
  lastEnd: null,  // the context time of the last chunk's last sample
  gaps: { count: 0, ms: 0 }, // stretches the stream skipped, given to the worker as silence
  delayStep: null, // the audio's delay last seen changing: { ms, at }
  listKey: null
};

function mmdWwvMode(mode = DEC.mode)
{
  return mode == "wwv";
}

function mmdWwvLoad()
{
  if (!WWV.worker)
  {
    WWV.worker = new Worker("lib/mmd/wwvWorker.js");
    WWV.worker.onmessage = (event) => mmdWwvMessage(event.data);
    WWV.worker.postMessage({ type: "init", rate: FT8_RATE });
  }
  return WWV.worker;
}

// A chunk of the 12 kHz audio, with the PC clock's time of its last sample: the context's clock now against Date.now (the sample's
// context time, data.end, that much before the context's currentTime), less WWV_LATENCY_MS. The same as FT8's mapping less the
// context's own output side, so a slow output device doesn't move it; each chunk's jitter (currentTime moves in the audio thread's
// bursts) is averaged out by the worker's line through the chunks' times
// A stretch the stream skipped (the worklet hears nothing in a quantum the input had no audio for, while the context's clock goes on:
// its chunk ends later, by the context's clock, than its samples reach) is given to the worker as silence first, so its count of
// samples stays on the context's clock (and the pulses where they were)
function mmdWwvAudio(data)
{
  const now = Date.now();
  const wall = DEC.ctx.currentTime > 0 ? now - (DEC.ctx.currentTime - data.end) * 1000 - WWV_LATENCY_MS : null;
  const worker = mmdWwvLoad();
  const gap = WWV.lastEnd == null ? 0 : Math.round((data.end - WWV.lastEnd) * FT8_RATE) - data.samples.length;
  WWV.lastEnd = data.end;
  if (gap > WWV_GAP_MIN && gap < FT8_RATE * WWV_GAP_MAX_S)
  {
    WWV.gaps.count++;
    WWV.gaps.ms += (gap * 1000) / FT8_RATE;
    worker.postMessage({ type: "audio", samples: new Float32Array(gap), wall: null });
  }
  worker.postMessage({ type: "audio", samples: data.samples, wall: wall }, [data.samples.buffer]);
}

// Listening starts again (the mode chosen, a retune, the input started again): the pulses found afresh; the minutes timed stay
function mmdWwvReset()
{
  if (WWV.worker) WWV.worker.postMessage({ type: "reset" });
  WWV.status = null;
  WWV.frame = null;
  WWV.lastEnd = null;
  mmdWwvRender();
}

// Clear: the minutes timed forgotten too
function mmdWwvClear()
{
  mmdWwvReset();
  WWV.minutes = [];
  WWV.since = 0;
  WWV.note = null;
  WWV.delayStep = null;
  mmdWwvRender();
}

function mmdWwvMessage(m)
{
  if (m.type == "status")
  {
    // (The carrier found, lost or moved: the waterfall's marks drawn again)
    const was = WWV.status ? WWV.status.path + Math.round(WWV.status.carrier || 0) : "";
    WWV.status = m;
    WWV.log.push({ at: Date.now(), utc: m.utc, lost: m.lost, diag: m.diag, gaps: Object.assign({}, WWV.gaps) });
    if (WWV.log.length > WWV_LOG) WWV.log.shift();
    if (mmdWwvMode() && was != m.path + Math.round(m.carrier || 0)) mmdOverlay();
    if (mmdWwvMode() && DEC.running) mmdWwvHead();
  }
  else if (m.type == "frame")
  {
    if (m.fields) WWV.frame = { fields: m.fields, mode: m.mode };
  }
  else if (m.type == "minute") mmdWwvMinute(m);
  if (mmdWwvMode()) mmdWwvRender();
}

// The radio path from your location to a station: { km (on the ground), hops, ms }; null while your location isn't set
function mmdWwvPath(name)
{
  const lat = Number(GT.myLat), lon = Number(GT.myLon);
  const site = WWV_SITES[name];
  if (!site || !isFinite(lat) || !isFinite(lon) || (lat == 0 && lon == 0)) return null;
  const rad = Math.PI / 180;
  const a = Math.sin(((site.lat - lat) * rad) / 2) ** 2 + Math.cos(lat * rad) * Math.cos(site.lat * rad) * Math.sin(((site.lon - lon) * rad) / 2) ** 2;
  const angle = 2 * Math.asin(Math.min(1, Math.sqrt(a)));
  const km = angle * WWV_EARTH_KM;
  const hops = Math.max(1, Math.ceil(km / WWV_HOP_KM));
  // Each hop: up to the layer and down again, its two slant legs over half the hop's angle each
  const R = WWV_EARTH_KM, H = WWV_EARTH_KM + WWV_LAYER_KM, half = angle / (2 * hops);
  const leg = Math.sqrt(R * R + H * H - 2 * R * H * Math.cos(half));
  return { km: km, hops: hops, ms: ((2 * hops * leg) / WWV_LIGHT_KMS) * 1000 };
}

// A minute timed: each station's offset less its path, the minute's the stations' weighed by how sure each is (its sigma); a jump from
// the minute before starts the offset again from this one
function mmdWwvMinute(m)
{
  let sum = 0, weight = 0;
  const stations = m.stations.map((s) =>
  {
    const path = mmdWwvPath(s.name);
    const offset = s.median - (path ? path.ms : 0);
    const w = 1 / Math.max(0.05, s.sigma) ** 2;
    sum += offset * w;
    weight += w;
    return Object.assign({}, s, { path: path, offset: offset });
  });
  const minute = { minuteStart: m.minuteStart, mode: m.mode, test: mmdTestHeard(Date.now() - 62000, Date.now()), offset: sum / weight, stations: stations, local: !!DEC.stream };
  const before = WWV.minutes.find((x) => !x.test);
  if (before && !minute.test && Math.abs(minute.offset - before.offset) > WWV_JUMP_MS) WWV.since = minute.minuteStart;
  // The audio's own delay changed (the worker saw the pulses move by the samples: the stations don't move): the offset starts again from
  // this minute, and that's said for a while
  const step = m.stations.map((s) => s.delayStepMs).filter((v) => v != null);
  if (step.length && !minute.test)
  {
    WWV.since = minute.minuteStart;
    WWV.delayStep = { ms: step.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a)), at: Date.now() };
  }
  WWV.minutes.unshift(minute);
  if (WWV.minutes.length > WWV_HISTORY) WWV.minutes.length = WWV_HISTORY;
}

// The offset now: the minutes since WWV.since in the last WWV_WINDOW_MINUTES (not a test signal's), their mean, how far apart they
// are and its uncertainty (the larger of the minutes' scatter over their number, and a minute's own over their number: each station's
// sigma, the worker's, the stations' together); settled once there are WWV_STABLE_MINUTES of them with the time code read (or counted on)
function mmdWwvOffset()
{
  const newest = WWV.minutes.find((x) => !x.test);
  if (!newest) return null;
  const list = WWV.minutes.filter((x) => !x.test && x.minuteStart >= WWV.since && x.minuteStart > newest.minuteStart - WWV_WINDOW_MINUTES * 60000);
  if (!list.length) return null;
  const k = list.length;
  const mean = list.reduce((s, x) => s + x.offset, 0) / k;
  const sd = k > 1 ? Math.sqrt(list.reduce((s, x) => s + (x.offset - mean) ** 2, 0) / (k - 1)) : 0;
  const within = list.map((x) => 1 / Math.sqrt(x.stations.reduce((s, st) => s + 1 / Math.max(0.05, st.sigma) ** 2, 0))).sort((a, b) => a - b)[Math.floor(k / 2)];
  const sigma = Math.max(k > 1 ? sd / Math.sqrt(k) : 0, within / Math.sqrt(k));
  const spread = Math.max(...list.map((x) => x.offset)) - Math.min(...list.map((x) => x.offset));
  // (Read: by the newest minute. A minute before it timed to the nearest second is that one's second too: one a second or more apart
  // would have started the offset again, WWV_JUMP_MS)
  const read = newest.mode == "code" || newest.mode == "flywheel";
  const nearest = newest.mode == "nearest";
  return { ms: mean, sigma: sigma, spread: spread, minutes: k, read: read, nearest: nearest, local: list.every((x) => x.local), path: list.every((x) => x.stations.every((s) => s.path)) };
}

// Set PC Clock is offered: the offset settled over WWV_STABLE_MINUTES or more with the time code read, steady, worth moving the clock
// for, from a sound card's audio, and nothing being set already
function mmdWwvSettable(o)
{
  return !!o && !WWV.setting && o.read && o.local && o.minutes >= WWV_STABLE_MINUTES && o.sigma < WWV_SET_SIGMA_MS && o.spread < WWV_SET_SPREAD_MS && Math.abs(o.ms) >= WWV_SET_MIN_MS;
}

// Set PC Clock: asked first, then the main process moves the clock by the offset (back when it's ahead) through the system's own prompt;
// the offset starts again from the next minute
async function mmdWwvSetClock()
{
  const o = mmdWwvOffset();
  if (!mmdWwvSettable(o)) return;
  const seconds = Math.round(-o.ms) / 1000;
  const remote = window.require("@electron/remote");
  const ask = I18N(seconds < 0 ? "cwViewer.wwv.setClock.back" : "cwViewer.wwv.setClock.forward").replace("{seconds}", Math.abs(seconds).toFixed(3));
  const answer = remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
    type: "question",
    buttons: [I18N("cwViewer.wwv.setClock.label"), I18N("cwViewer.wwv.setClock.cancel")],
    defaultId: 1,
    cancelId: 1,
    message: ask,
    detail: I18N("cwViewer.wwv.setClock.accuracy").replace("{system}", (WWV_SYSTEM_MS / 1000).toFixed(2))
  });
  if (answer != 0) return;
  WWV.setting = true;
  WWV.note = null;
  mmdWwvRender();
  let result;
  try
  {
    result = await electron.ipcRenderer.invoke("clockAdjust", seconds);
  }
  catch (e)
  {
    result = { ok: false, error: e.message };
  }
  WWV.setting = false;
  if (result && result.ok)
  {
    WWV.since = Date.now() + 60000;
    WWV.note = { text: I18N("cwViewer.wwv.setClock.done").replace("{seconds}", (seconds > 0 ? "+" : "") + seconds.toFixed(3)), error: false };
  }
  else WWV.note = { text: I18N("cwViewer.wwv.setClock.failed") + " " + ((result && result.error) || ""), error: true };
  mmdWwvRender();
}

// The status line: how the audio is read (the carrier found, or AM audio), else what's listened for
function mmdWwvHead()
{
  const s = WWV.status;
  if (!s || !s.counting) mmdStatus(I18N("cwViewer.wwv.searching"));
  else mmdStatus(s.path == "carrier" && s.carrier ? I18N("cwViewer.wwv.carrier").replace("{hz}", s.carrier.toFixed(1)) : I18N("cwViewer.wwv.am"));
}

// Text for a double-quoted attribute (a tooltip: translations have apostrophes)
function mmdWwvAttr(text)
{
  return mmdEscape(String(text)).replace(/"/g, "&quot;");
}

// A number of seconds with its sign, to the millisecond
function mmdWwvSeconds(ms)
{
  return (ms >= 0 ? "+" : "-") + (Math.abs(ms) / 1000).toFixed(3);
}

// wwvView: the time and the code's flags, the stations, the offset (and Set PC Clock), then the minutes timed; drawn again only when
// something in it changed
function mmdWwvRender()
{
  if (!mmdWwvMode()) return;
  const s = WWV.status;
  const f = WWV.frame ? WWV.frame.fields : null;
  const parts = [];
  // The time as sent: the second just heard, by the minute the time code gave (none yet: what's being waited for)
  let head;
  if (s && s.utc != null) head = "<span class='wwvClock'>" + new Date(s.utc).toISOString().slice(11, 19) + "</span> UTC";
  else head = "<span class='wwvWait'>" + mmdEscape(I18N(!s || !s.counting ? "cwViewer.wwv.searching" : s.lost ? "cwViewer.wwv.lost" : !s.aligned ? "cwViewer.wwv.counting" : "cwViewer.wwv.reading")) + "</span>";
  if (f) head += " · " + new Date(f.minuteStart).toISOString().slice(0, 10) + " · " + mmdEscape(I18N("cwViewer.wwv.day").replace("{day}", f.doy));
  if (WWV.frame && WWV.frame.mode == "unconfirmed") head += " <span class='wwvFair'>(" + mmdEscape(I18N("cwViewer.wwv.mode.unconfirmed")) + ")</span>";
  parts.push("<div class='wwvHead'>" + head + "</div>");
  // The stations: heard (their pulses' dB) or not
  if (s)
  {
    const heard = s.stations.map((st) => "<span class='wwvStation'>" + st.name + "</span> " + st.tone + " Hz " + (st.locked && st.snr != null ? "<span class='wwvGood'>" + Math.round(st.snr) + " dB</span>" : "<span class='wwvBad'>" + mmdEscape(I18N("cwViewer.wwv.notHeard")) + "</span>"));
    parts.push("<div class='wwvLine'>" + heard.join(" · ") + "</div>");
  }
  // The code's flags
  if (f)
  {
    const dst = f.dst1 && f.dst2 ? "on" : !f.dst1 && !f.dst2 ? "off" : f.dst2 ? "begins" : "ends";
    const flags = [
      I18N("cwViewer.wwv.dut1").replace("{value}", (f.dut1 > 0 ? "+" : f.dut1 < 0 ? "-" : "") + Math.abs(f.dut1).toFixed(1)),
      I18N(f.lsw ? "cwViewer.wwv.leap.warning" : "cwViewer.wwv.leap.none"),
      I18N("cwViewer.wwv.dst." + dst)
    ];
    parts.push("<div class='wwvLine'>" + flags.map((x) => mmdEscape(x)).join(" · ") + "</div>");
  }
  // The offset, and Set PC Clock
  const o = mmdWwvOffset();
  if (o)
  {
    let text = mmdEscape(I18N(o.ms >= 0 ? "cwViewer.wwv.ahead" : "cwViewer.wwv.behind").replace("{offset}", (Math.abs(o.ms) / 1000).toFixed(3)));
    // (Its uncertainty: its own scatter with the audio delay's that isn't measured, WWV_SYSTEM_MS)
    const sigma = Math.sqrt(o.sigma * o.sigma + WWV_SYSTEM_MS * WWV_SYSTEM_MS);
    text = "<span class='wwvOffset'>" + text + "</span> " + mmdEscape(I18N("cwViewer.wwv.spread").replace("{sigma}", (Math.round(sigma) / 1000).toFixed(3)).replace("{minutes}", o.minutes));
    if (o.nearest) text += " · " + mmdEscape(I18N("cwViewer.wwv.nearest"));
    else if (!o.read) text += " · " + mmdEscape(I18N("cwViewer.wwv.mode.unconfirmed"));
    if (!o.path) text += " · " + mmdEscape(I18N("cwViewer.wwv.noLocation"));
    if (!o.local) text += " · " + mmdEscape(I18N("cwViewer.wwv.network"));
    if (mmdWwvSettable(o)) text += " <span class='cwButton' onclick='mmdWwvSetClock();' title=\"" + mmdWwvAttr(I18N("cwViewer.wwv.setClock.hover")) + "\">" + mmdEscape(I18N("cwViewer.wwv.setClock.label")) + "</span>";
    parts.push("<div class='wwvLine' title=\"" + mmdWwvAttr(I18N("cwViewer.wwv.accuracy.hover").replace("{latency}", WWV_LATENCY_MS).replace("{system}", WWV_SYSTEM_MS)) + "\">" + text + "</div>");
  }
  if (WWV.delayStep && Date.now() - WWV.delayStep.at < WWV_STEP_SHOWN_MS) parts.push("<div class='wwvLine wwvFair'>" + mmdEscape(I18N("cwViewer.wwv.delayStep").replace("{ms}", (WWV.delayStep.ms > 0 ? "+" : "") + Math.round(WWV.delayStep.ms))) + "</div>");
  if (WWV.note) parts.push("<div class='wwvLine " + (WWV.note.error ? "wwvBad" : "wwvGood") + "'>" + mmdEscape(WWV.note.text) + "</div>");
  const html = parts.join("");
  // The minutes timed: UTC, how the minute was known, each station's pulses, offset (s, path taken off), path (ms) and dB
  const rows = [];
  for (const x of WWV.minutes)
  {
    for (const st of x.stations)
    {
      const path = st.path ? st.path.ms.toFixed(1) + " (" + st.path.hops + ")" : "";
      rows.push("<tr" + (x.test ? " class='wwvTest'" : "") + "><td>" + new Date(x.minuteStart).toISOString().slice(11, 16) + "</td><td class='packetCall'>" + st.name + "</td><td>" + mmdEscape(I18N("cwViewer.wwv.mode." + x.mode)) +
        "</td><td class='ft8Num'>" + st.n + "</td><td class='ft8Num'>" + mmdWwvSeconds(st.offset) + "</td><td class='ft8Num'>" + path + "</td><td class='ft8Num'>" + Math.round(st.snr) + "</td></tr>");
    }
  }
  const key = html + "#" + rows.length + rows.slice(0, 2).join("");
  if (key == WWV.listKey) return;
  WWV.listKey = key;
  wwvTop.innerHTML = html;
  wwvRows.innerHTML = rows.join("");
  wwvEmpty.style.display = rows.length ? "none" : "";
}

// On the waterfall: the carrier read (a dashed line), named, and where each station's pulses are in the audio
function mmdWwvDraw(ctx, x, ratio, w, h)
{
  const s = WWV.status;
  if (!mmdWwvMode() || !s || s.path != "carrier" || !s.carrier) return;
  ctx.strokeStyle = "rgba(120, 220, 255, 0.8)";
  ctx.lineWidth = Math.max(1, Math.round(ratio));
  ctx.setLineDash([4 * ratio, 4 * ratio]);
  ctx.beginPath();
  for (const hz of [s.carrier, s.carrier + 1000, s.carrier + 1200])
  {
    const at = Math.round(x(hz)) + 0.5;
    ctx.moveTo(at, 0);
    ctx.lineTo(at, h);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  mmdOverlayLabel(ctx, "WWV", x(s.carrier), h - 19 * ratio, "center", 11, ratio, w, "rgb(120, 220, 255)");
}

// WWV / WWVH in the decoder's mode registry (mmdPluginHost.js): its time code from the 12 kHz stream
mmdRegisterMode({
  id: "wwv",
  name: "WWV",
  modes: ["wwv"],
  input: "audio12",
  audio: (data) => mmdWwvAudio(data),
  // Its view; the pulses found afresh (the minutes timed kept)
  shown: (on) =>
  {
    wwvView.style.display = on ? "" : "none";
    if (!on) return;
    mmdWwvReset();
    WWV.listKey = null;
    mmdWwvRender();
  },
  draw: (ctx, x, ratio, w, h) => mmdWwvDraw(ctx, x, ratio, w, h),
  tick: () => mmdWwvRender(),
  clear: () => mmdWwvClear(),
  retune: () =>
  {
    if (mmdWwvMode()) mmdWwvReset();
  },
  // (its count of samples starts again with the next start; the minutes timed stay)
  stop: () => mmdWwvReset()
});
