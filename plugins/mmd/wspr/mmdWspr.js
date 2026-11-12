// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The WSPR plugin (plugin.json beside this file): each 2 minute period of the 12 kHz audio (the worklet's stream, input "audio12")
// decoded once it has been heard, from the even minute, by wsprWorker.js (1350 to 1650 Hz of audio, as WSPR is sent). Its stations
// listed, the newest first, and sent on to GridTracker2 (host.sendWspr: the map), as WSJT-X's WSPR decodes are. Listened to with the
// window closed too, as every mode is. Not one of Detect Modes'

const WSPR_PERIOD_MS = 120000;
// The audio decoded: this much from the even minute (a transmission runs from 1 s to 111.6 s), once this far past it
const WSPR_HEARD_MS = 114000;
const WSPR_DECODE_AT_MS = 115000;
const WSPR_KEEP_S = 130;
const WSPR_ROWS_MAX = 1000;

const WSPR = {
  host: null,   // the decoder's host (mmdPluginHost.js), from init
  F: null,      // { worker, ring, total (samples ever), cutTotal (the rig moved there), endWall (ms: when the newest was heard), next (the period to decode) }
  lines: [],    // every station decoded, the newest first: { utc, snr, dt, freq (Hz on the air, else audio), air, drift, message }
  listKey: null
};

function mmdWsprMode()
{
  return WSPR.host != null && WSPR.host.mode() == "wspr";
}

function mmdWsprLoad()
{
  if (WSPR.F) return WSPR.F;
  const H = WSPR.host;
  const worker = new Worker(H.workerUrl("wsprWorker.js"));
  const F = { worker: worker, ring: new Float32Array(WSPR_KEEP_S * H.rate12), total: 0, cutTotal: 0, endWall: 0, next: 0 };
  worker.onmessage = (event) => H.guard(() => mmdWsprDecoded(F, event.data));
  WSPR.F = F;
  return F;
}

// A chunk of the 12 kHz audio: into the ring with when its last sample was heard; each period heard to its end decoded
function mmdWsprAudio(data)
{
  const H = WSPR.host;
  const F = mmdWsprLoad();
  const endWall = H.heardAt(data);
  const n = data.samples.length;
  const size = F.ring.length;
  for (let i = 0; i < n; i++) F.ring[(F.total + i) % size] = data.samples[i];
  // Heard from scratch: the first period decoded is the first that starts after the audio does
  if (F.total == 0)
  {
    F.next = Math.ceil((endWall - (n / H.rate12) * 1000) / WSPR_PERIOD_MS) * WSPR_PERIOD_MS;
    F.cutTotal = 0;
    H.status(H.t("cwViewer.wspr.waiting").replace("{utc}", new Date(F.next).toISOString().slice(11, 16)));
  }
  F.total += n;
  F.endWall = endWall;
  while (F.endWall >= F.next + WSPR_DECODE_AT_MS)
  {
    mmdWsprDecode(F, F.next);
    F.next += WSPR_PERIOD_MS;
  }
}

// The period starting at start, to the worker: not one heard partly before the rig last moved (retune), nor one not heard whole
function mmdWsprDecode(F, start)
{
  const H = WSPR.host;
  const first = F.total - Math.round(((F.endWall - start) / 1000) * H.rate12);
  const count = Math.round((WSPR_HEARD_MS / 1000) * H.rate12);
  if (first < 0 || first < F.total - F.ring.length || first < F.cutTotal) return;
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) samples[i] = F.ring[(first + i) % F.ring.length];
  F.worker.postMessage({ type: "decode", start: start, samples: samples }, [samples.buffer]);
  if (mmdWsprMode()) H.status(H.t("cwViewer.wspr.decoding").replace("{utc}", new Date(start).toISOString().slice(11, 16)));
}

// A period's stations: listed (each on the air where the rig is read), and on to GridTracker2
function mmdWsprDecoded(F, data)
{
  const H = WSPR.host;
  if (WSPR.F != F) return;
  if (data.type == "error")
  {
    H.status(H.t("cwViewer.status.failed") + " WSPR: " + data.message, true);
    return;
  }
  if (data.type != "decoded") return;
  const utc = new Date(data.start).toISOString().slice(11, 16);
  const list = data.list.map((d) => Object.assign({}, d, { utc, air: H.airHz(d.freq) }));
  // A station heard again on the same band: its new row replaces its old one (the newest on top). The band from its frequency on the air;
  // with no rig read, every row is the one band the audio is
  // No station twice: in this period's too (decoded twice on the band: its strongest kept)
  const key = (d) => String(d.call || "").toUpperCase() + "|" + H.bandOf(d.air);
  const heard = new Set();
  const fresh = list.sort((a, b) => b.snr - a.snr).filter((d) =>
  {
    if (heard.has(key(d))) return false;
    heard.add(key(d));
    return true;
  });
  WSPR.lines = fresh.concat(WSPR.lines.filter((d) => !heard.has(key(d)))).slice(0, WSPR_ROWS_MAX);
  // (A period heard while a test signal played stays in the window)
  if (!H.testHeard(data.start, data.start + WSPR_HEARD_MS)) H.sendWspr(data.start, fresh);
  mmdWsprRender();
  if (mmdWsprMode()) H.status(H.t("cwViewer.wspr.status").replace("{count}", fresh.length).replace("{utc}", utc));
}

// The list: UTC, dB, DT, frequency (MHz on the air to the Hz, else audio Hz), drift, call, grid, dBm, and the distance to its grid in
// the distance unit of Settings (none without a grid), worked out as it is drawn so a change of unit shows
function mmdWsprRender()
{
  const H = WSPR.host;
  const unitText = "(" + H.gridDistance("").unit + ")";
  if (wsprDistUnit.textContent != unitText) wsprDistUnit.textContent = unitText;
  const html = WSPR.lines.map((d) =>
  {
    const freq = d.air == null ? Math.round(d.freq) + " Hz" : (d.air / 1e6).toFixed(6);
    const far = H.gridDistance(d.grid).distance;
    const dist = far == null ? "" : String(far);
    return "<tr><td>" + d.utc + "</td><td class='wsprNum'>" + d.snr + "</td><td class='wsprNum'>" + d.dt.toFixed(1) + "</td><td class='wsprNum'>" + freq +
      "</td><td class='wsprNum'>" + d.drift + "</td><td class='wsprCall'>" + H.escape(d.call) + "</td><td>" + H.escape(d.grid || "") + "</td><td class='wsprNum'>" + d.power +
      "</td><td class='wsprNum'>" + dist + "</td></tr>";
  }).join("");
  if (html != WSPR.listKey)
  {
    WSPR.listKey = html;
    wsprRows.innerHTML = html;
  }
  wsprEmpty.style.display = WSPR.lines.length ? "none" : "";
}

// Listening stops: what was heard is let go (the stations decoded stay listed)
function mmdWsprStop()
{
  if (WSPR.F) WSPR.F.total = 0;
}

// The rig moved: the period under way isn't decoded (it was heard partly on the old frequency)
function mmdWsprRetune()
{
  if (WSPR.F && WSPR.F.total > 0) WSPR.F.cutTotal = WSPR.F.total;
}

function mmdWsprClear()
{
  WSPR.lines = [];
  mmdWsprRender();
}

// Its box on Settings, Decoders: Set Mode (Set Frequency and the rest are the decoder's own, as every mode's)
function mmdWsprSettings()
{
  wsprSetModeValue.checked = WSPR.host.get("wsprSetMode") === true;
}

mmdRegisterMode({
  id: "wspr",
  name: "WSPR",
  modes: ["wspr"],
  input: "audio12",
  init: (host) =>
  {
    WSPR.host = host;
  },
  periodMs: () => WSPR_PERIOD_MS,
  audio: (data) => mmdWsprAudio(data),
  // Its list; listened for afresh on every change of mode (its list kept)
  shown: (on) =>
  {
    wsprList.style.display = on ? "" : "none";
    mmdWsprStop();
  },
  clear: () => mmdWsprClear(),
  retune: () => mmdWsprRetune(),
  stop: () => mmdWsprStop(),
  settingsRender: () => mmdWsprSettings()
});
