// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// WSPR mode (the Mode menu): each 2 minute period of the 12 kHz audio (the worklet's FT8 stream) decoded once it has been heard, from the
// even minute, by wsprWorker.js (1350 to 1650 Hz of audio, as WSPR is sent). Its stations listed, the newest first, and sent to
// GridTracker's instance MMD (services/mmDecoder.js: the map), as WSJT-X's WSPR decodes are. Listened to with the window closed too
// (mmdListen). Not one of Detect Modes'

const WSPR_PERIOD_MS = 120000;
// The audio decoded: this much from the even minute (a transmission runs from 1 s to 111.6 s), once this far past it
const WSPR_HEARD_MS = 114000;
const WSPR_DECODE_AT_MS = 115000;
const WSPR_KEEP_S = 130;
const WSPR_ROWS_MAX = 1000;

const WSPR = {
  F: null,      // { worker, ring, total (samples ever), cutTotal (the rig moved there), endWall (ms: when the newest was heard), next (the period to decode) }
  lines: [],    // every station decoded, the newest first: { utc, snr, dt, freq (Hz on the air, else audio), air, drift, message }
  listKey: null
};

function mmdWsprMode(mode = DEC.mode)
{
  return mode == "wspr";
}

function mmdWsprLoad()
{
  if (WSPR.F) return WSPR.F;
  const worker = new Worker("lib/mmd/wsprWorker.js");
  const F = { worker: worker, ring: new Float32Array(WSPR_KEEP_S * FT8_RATE), total: 0, cutTotal: 0, endWall: 0, next: 0 };
  worker.onmessage = (event) => mmdWsprDecoded(F, event.data);
  WSPR.F = F;
  return F;
}

// A chunk of the 12 kHz audio: into the ring with when its last sample was heard (as mmdFt8Audio); each period heard to its end decoded
function mmdWsprAudio(data)
{
  const F = mmdWsprLoad();
  const stamp = DEC.ctx.getOutputTimestamp();
  const endWall = performance.timeOrigin + stamp.performanceTime + (data.end - stamp.contextTime) * 1000 - FT8_LATENCY_MS;
  const n = data.samples.length;
  const size = F.ring.length;
  for (let i = 0; i < n; i++) F.ring[(F.total + i) % size] = data.samples[i];
  // Heard from scratch: the first period decoded is the first that starts after the audio does
  if (F.total == 0)
  {
    F.next = Math.ceil((endWall - (n / FT8_RATE) * 1000) / WSPR_PERIOD_MS) * WSPR_PERIOD_MS;
    F.cutTotal = 0;
    mmdStatus(I18N("cwViewer.wspr.waiting").replace("{utc}", new Date(F.next).toISOString().slice(11, 16)));
  }
  F.total += n;
  F.endWall = endWall;
  while (F.endWall >= F.next + WSPR_DECODE_AT_MS)
  {
    mmdWsprDecode(F, F.next);
    F.next += WSPR_PERIOD_MS;
  }
}

// The period starting at start, to the worker: not one heard partly before the rig last moved (mmdRetune), nor one not heard whole
function mmdWsprDecode(F, start)
{
  const first = F.total - Math.round(((F.endWall - start) / 1000) * FT8_RATE);
  const count = Math.round((WSPR_HEARD_MS / 1000) * FT8_RATE);
  if (first < 0 || first < F.total - F.ring.length || first < F.cutTotal) return;
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) samples[i] = F.ring[(first + i) % F.ring.length];
  F.worker.postMessage({ type: "decode", start: start, samples: samples }, [samples.buffer]);
  if (mmdWsprMode()) mmdStatus(I18N("cwViewer.wspr.decoding").replace("{utc}", new Date(start).toISOString().slice(11, 16)));
}

// A period's stations: listed (each on the air where the rig is read), and to GridTracker's instance
function mmdWsprDecoded(F, data)
{
  if (WSPR.F != F) return;
  if (data.type == "error")
  {
    mmdStatus(I18N("cwViewer.status.failed") + " WSPR: " + data.message, true);
    return;
  }
  if (data.type != "decoded") return;
  const utc = new Date(data.start).toISOString().slice(11, 16);
  const opener = window.opener;
  const list = data.list.map((d) =>
  {
    const air = opener.mmDecoderAirHz(d.freq);
    return Object.assign({}, d, { utc, air });
  });
  WSPR.lines = list.sort((a, b) => b.snr - a.snr).concat(WSPR.lines).slice(0, WSPR_ROWS_MAX);
  // (A period heard while a test signal played stays in the window: mmdTest.js)
  if (!mmdTestHeard(data.start, data.start + WSPR_HEARD_MS)) opener.mmDecoderInstanceWspr(data.start, list);
  mmdWsprRender();
  if (mmdWsprMode()) mmdStatus(I18N("cwViewer.wspr.status").replace("{count}", list.length).replace("{utc}", utc));
}

// The list: UTC, dB, DT, frequency (MHz on the air to the Hz, else audio Hz), drift, call, grid, dBm, and the distance to its grid in
// the distance unit of Settings (none without a grid), worked out as it is drawn so a change of unit shows
function mmdWsprRender()
{
  const opener = window.opener;
  const unitText = "(" + opener.mmDecoderGridDistance("").unit + ")";
  if (wsprDistUnit.textContent != unitText) wsprDistUnit.textContent = unitText;
  const html = WSPR.lines.map((d) =>
  {
    const freq = d.air == null ? Math.round(d.freq) + " Hz" : (d.air / 1e6).toFixed(6);
    const far = opener.mmDecoderGridDistance(d.grid).distance;
    const dist = far == null ? "" : String(far);
    return "<tr><td>" + d.utc + "</td><td class='ft8Num'>" + d.snr + "</td><td class='ft8Num'>" + d.dt.toFixed(1) + "</td><td class='ft8Num'>" + freq +
      "</td><td class='ft8Num'>" + d.drift + "</td><td class='packetCall'>" + mmdEscape(d.call) + "</td><td>" + mmdEscape(d.grid || "") + "</td><td class='ft8Num'>" + d.power +
      "</td><td class='ft8Num'>" + dist + "</td></tr>";
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
