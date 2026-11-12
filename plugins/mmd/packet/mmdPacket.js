// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Packet plugin (plugin.json beside this file): the input's own samples (the worklet's raw stream at its full rate, input "raw") go
// to packetWorker.js, which finds AX.25 frames at 1200 baud (AFSK, VHF APRS), 9600 (G3RUH FSK) and 300 (HF packet), and reads APRS in
// them. Here each frame is a line on top of the list: UTC, baud, from, to and path (and the satellite BirdWatch follows, heard through
// it), and what it says (APRS read: a position with its grid, a message, a status ...; other packets as they are). A message to you is
// highlighted. HF packet (300 baud) is looked for all across the audio decoded, wherever its tones land; each place one was heard lately
// is a tick at the waterfall's top, and its line says where (its Baud's hover). A click on the waterfall (or on a 300 baud line) locks onto
// that place: only it is decoded, shown by a tick with guard lines either side and its two tones; a click inside the guards lets go.
// Detect Modes' own Packet decoder is here too (detectRaw)

// Lines kept in the list
const PACKET_ROWS_MAX = 1000;
// The lock's guard lines either side of its middle (Hz: the tones 100 Hz either side, and the worker's spread round it), and how long a
// place 300 baud was heard stays ticked (ms)
const PACKET_LOCK_HALF = 200;
const PACKET_HEARD_MS = 120000;
// Detect Modes: its label colour, how near two finds are the same signal (Hz), its rank where two overlap, its signal's width (Hz)
const PACKET_DETECT = { packet: { color: "#ffa64d", sameHz: 150, rank: 8, width: 400 } };

const PACKET = {
  host: null,    // the decoder's host (mmdPluginHost.js), from init
  worker: null,
  rate: 0,       // the sample rate the worker was set up for
  lines: [],     // the newest first: { utc, baud, src, to, sat, text, mine, hz }
  count: 0,      // frames decoded since the list was cleared
  lock: null,    // HF 300 baud locked on this place (Hz of audio), or null: looked for everywhere
  heard: [],     // where 300 baud was heard lately: { hz, at }
  hfSent: "",    // what the worker was last told of the audio decoded and the lock
  detect: null,  // Detect Modes' own: { worker, rate }
};

// (a hook can come before init)
function mmdPacketMode()
{
  return !!PACKET.host && PACKET.host.mode() == "packet";
}

// packetWorker.js, set up for the input's rate (again when it changes), and told where HF packet is looked for
function mmdPacketLoad(rate)
{
  const H = PACKET.host;
  if (!PACKET.worker)
  {
    PACKET.worker = new Worker(H.workerUrl("packetWorker.js"));
    PACKET.worker.onmessage = (event) => H.guard(() => mmdPacketMessage(event.data));
  }
  if (PACKET.rate != rate)
  {
    PACKET.rate = rate;
    PACKET.worker.postMessage({ type: "init", rate });
    PACKET.hfSent = "";
  }
  mmdPacketHf();
  return PACKET.worker;
}

// The worker told the audio decoded (between [ and ]) and the lock, when they changed
function mmdPacketHf()
{
  if (!PACKET.worker) return;
  const range = PACKET.host.range();
  const hf = { type: "hf", min: range.minHz, max: range.maxHz, lock: PACKET.lock };
  const key = JSON.stringify(hf);
  if (key == PACKET.hfSent) return;
  PACKET.hfSent = key;
  PACKET.worker.postMessage(hf);
}

// A click on the waterfall, or on a 300 baud line (hz: its place): locked on there; inside the lock's guards, let go
function mmdPacketLock(hz)
{
  if (hz == null) return;
  if (PACKET.lock != null && Math.abs(hz - PACKET.lock) <= PACKET_LOCK_HALF) PACKET.lock = null;
  else
  {
    // On a place heard lately, near enough: that one
    const near = PACKET.heard.filter((h) => Math.abs(h.hz - hz) <= PACKET_LOCK_HALF / 2).sort((a, b) => Math.abs(a.hz - hz) - Math.abs(b.hz - hz))[0];
    PACKET.lock = Math.round(near ? near.hz : hz);
  }
  mmdPacketHf();
  PACKET.host.overlay();
}

// On the waterfall, in Packet mode: where 300 baud was heard lately (a cyan tick at the top, fading as it ages), and the lock: its
// middle a solid line with a tick at the top, its guards dashed, its tones (100 Hz either side) faint, the band between them shaded, and
// what it is in a label
function mmdPacketDraw(ctx, x, ratio, w, h)
{
  if (!mmdPacketMode()) return;
  const now = Date.now();
  PACKET.heard = PACKET.heard.filter((p) => now - p.at < PACKET_HEARD_MS);
  for (const p of PACKET.heard)
  {
    const at = Math.round(x(p.hz));
    ctx.fillStyle = "rgba(0, 255, 255, " + (1 - ((now - p.at) / PACKET_HEARD_MS) * 0.7).toFixed(2) + ")";
    ctx.beginPath();
    ctx.moveTo(at - 5 * ratio, 0);
    ctx.lineTo(at + 5 * ratio, 0);
    ctx.lineTo(at, 8 * ratio);
    ctx.closePath();
    ctx.fill();
  }
  if (PACKET.lock == null) return;
  const lock = PACKET.lock;
  const a = x(lock - PACKET_LOCK_HALF), b = x(lock + PACKET_LOCK_HALF);
  ctx.fillStyle = "rgba(255, 200, 80, 0.10)";
  ctx.fillRect(Math.min(a, b), 0, Math.abs(b - a), h);
  ctx.lineWidth = Math.max(1, Math.round(ratio));
  ctx.strokeStyle = "rgba(255, 200, 80, 0.85)";
  ctx.setLineDash([4 * ratio, 4 * ratio]);
  ctx.beginPath();
  for (const edge of [a, b])
  {
    ctx.moveTo(Math.round(edge) + 0.5, 0);
    ctx.lineTo(Math.round(edge) + 0.5, h);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(255, 200, 80, 0.35)";
  ctx.beginPath();
  for (const tone of [lock - 100, lock + 100])
  {
    ctx.moveTo(Math.round(x(tone)) + 0.5, 0);
    ctx.lineTo(Math.round(x(tone)) + 0.5, h);
  }
  ctx.stroke();
  const mid = Math.round(x(lock));
  ctx.fillStyle = "rgb(255, 200, 80)";
  ctx.fillRect(mid - Math.floor(ratio), 0, Math.max(1, Math.round(2 * ratio)), h);
  ctx.beginPath();
  ctx.moveTo(mid - 6 * ratio, 0);
  ctx.lineTo(mid + 6 * ratio, 0);
  ctx.lineTo(mid, 10 * ratio);
  ctx.closePath();
  ctx.fill();
  PACKET.host.overlayLabel(ctx, PACKET.host.t("cwViewer.packet.locked").replace("{hz}", lock), mid, 12 * ratio, "center", 11, ratio, w, "rgb(255, 200, 80)");
}

// A tenth of a second of the input's samples from the worklet
function mmdPacketAudio(data)
{
  mmdPacketLoad(data.rate).postMessage({ type: "audio", samples: data.samples }, [data.samples.buffer]);
}

// Listening starts again (Packet chosen, a retune): a frame half heard is let go
function mmdPacketReset()
{
  if (PACKET.worker) PACKET.worker.postMessage({ type: "reset" });
}

// Clear: the list emptied (and the places heard; a lock stays)
function mmdPacketClear()
{
  mmdPacketReset();
  PACKET.lines = [];
  PACKET.count = 0;
  PACKET.heard = [];
  mmdPacketRender();
  PACKET.host.overlay();
}

function mmdPacketMessage(m)
{
  if (m.type != "frame" || !mmdPacketMode()) return;
  const H = PACKET.host;
  const myCall = H.myCall();
  const base = (call) => String(call).toUpperCase().replace(/-\d+$/, "");
  const aprs = m.aprs;
  const line = {
    utc: new Date().toISOString().slice(11, 19),
    baud: m.baud,
    src: m.src,
    to: m.dst + (m.path.length ? " via " + m.path.join(",") : ""),
    sat: H.satellite(),
    text: aprs ? mmdPacketAprsText(aprs) : mmdPacketPrintable(m.info),
    // A message to you (APRS), or a frame addressed to you
    mine: myCall != "" && myCall != "NOCALL" && ((aprs && aprs.kind == "message" && base(aprs.to) == base(myCall)) || base(m.dst) == base(myCall)),
    // HF 300 baud: where it was heard (Hz of audio), ticked on the waterfall
    hz: m.hz > 0 ? Math.round(m.hz) : null
  };
  if (line.hz != null)
  {
    PACKET.heard = PACKET.heard.filter((p) => Math.abs(p.hz - line.hz) > 60);
    PACKET.heard.push({ hz: line.hz, at: Date.now() });
    H.overlay();
  }
  PACKET.lines.unshift(line);
  if (PACKET.lines.length > PACKET_ROWS_MAX) PACKET.lines.length = PACKET_ROWS_MAX;
  PACKET.count++;
  // Scrolled down the list, the view is moved down by a line, so the lines being read stay put
  if (packetList.scrollTop > 0) packetList.scrollTop += packetRows.rows[0] ? packetRows.rows[0].getBoundingClientRect().height : 18;
  packetRows.insertAdjacentHTML("afterbegin", mmdPacketLine(line));
  while (packetRows.rows.length > PACKET_ROWS_MAX) packetRows.deleteRow(-1);
  packetEmpty.style.display = "none";
  H.status(H.t("cwViewer.packet.status").replace("{count}", PACKET.count).replace("{utc}", line.utc));
}

// Text with the characters a screen can't show as dots
function mmdPacketPrintable(text)
{
  return String(text || "").replace(/[\x00-\x1f\x7f-\x9f]/g, "·");
}

// What an APRS frame says, in a line: a position as latitude and longitude with its grid (and course, speed, altitude, comment); a
// message with whom it is to; a status, an object's or an item's name ...
function mmdPacketAprsText(a)
{
  const H = PACKET.host;
  const label = (kind) => H.t("cwViewer.packet.kind." + kind);
  const parts = [];
  if (a.lat != null)
  {
    const grid = H.gridOf(a.lat, a.lon, 6);
    parts.push(label(a.kind == "mice" ? "position" : a.kind) + (a.name ? " " + a.name : "") + ": " + a.lat.toFixed(4) + ", " + a.lon.toFixed(4) + (grid ? " " + grid : ""));
    if (a.speed > 0) parts.push(a.course + "° " + Math.round(a.speed) + " kn");
    if (a.altitude != null) parts.push(a.altitude + " ft");
    if (a.message) parts.push(a.message);
  }
  else if (a.kind == "message") return label("message").replace("{to}", a.to) + ": " + mmdPacketPrintable(a.text) + (a.id ? " {" + a.id + "}" : "");
  // A status, weather, telemetry: its label and its text on one
  else if (a.kind != "other") return label(a.kind) + ": " + mmdPacketPrintable(a.text);
  if (a.text) parts.push(mmdPacketPrintable(a.text));
  return parts.join("  ");
}

function mmdPacketLine(line)
{
  const H = PACKET.host;
  // A 300 baud line: where it was heard on its Baud's hover, and a click on it locks there (mmdPacketInit)
  const heard = line.hz != null ? " title=\"" + H.escape(H.t("cwViewer.packet.heardAt").replace("{hz}", line.hz)).replace(/"/g, "&quot;") + "\"" : "";
  return "<tr" + (line.mine ? " class='packetMine'" : "") + (line.hz != null ? " data-hz='" + line.hz + "'" : "") + "><td class='ft8Num'>" + line.utc + "</td><td class='ft8Num'" + heard + ">" + line.baud + "</td><td class='packetCall'>" + H.escape(line.src) +
    "</td><td class='packetPath' title=\"" + H.escape(line.to).replace(/"/g, "&quot;") + "\">" + H.escape(line.to) + (line.sat ? " <span class='packetSat'>" + H.escape(H.t("cwViewer.packet.via").replace("{sat}", line.sat)) + "</span>" : "") +
    "</td><td title=\"" + H.escape(line.text).replace(/"/g, "&quot;") + "\">" + H.escape(line.text) + "</td></tr>";
}

// A click on a 300 baud line: locked on where it was heard (not when the mouse selected text in it, to copy)
function mmdPacketInit(host)
{
  PACKET.host = host;
  packetRows.addEventListener("click", (event) => host.guard(() =>
  {
    const row = event.target.closest("tr[data-hz]");
    if (row && String(window.getSelection()).length == 0) mmdPacketLock(Number(row.dataset.hz));
  }));
}

// The whole list drawn again (after a Clear)
function mmdPacketRender()
{
  packetRows.innerHTML = PACKET.lines.map(mmdPacketLine).join("");
  packetEmpty.style.display = PACKET.lines.length ? "none" : "";
}

// ---- Detect Modes: its own packetWorker.js, every place listened to, each frame a station found (HF 300 baud where it was heard,
// AFSK 1200 midway between its tones, 9600 (FM's flat audio) mid-passband)

function mmdPacketDetectRaw(data)
{
  const H = PACKET.host;
  let D = PACKET.detect;
  if (!D)
  {
    D = PACKET.detect = { worker: new Worker(H.workerUrl("packetWorker.js")), rate: 0 };
    D.worker.onmessage = (event) => H.guard(() => mmdPacketDetectMessage(event.data));
  }
  if (D.rate != data.rate)
  {
    const range = H.range();
    D.rate = data.rate;
    D.worker.postMessage({ type: "init", rate: data.rate });
    D.worker.postMessage({ type: "hf", min: range.minHz, max: range.maxHz, lock: null });
  }
  const samples = data.samples.slice();
  D.worker.postMessage({ type: "audio", samples }, [samples.buffer]);
}

function mmdPacketDetectMessage(m)
{
  const H = PACKET.host;
  if (!H.detectOn() || m.type != "frame") return;
  const range = H.range();
  const hz = m.hz > 0 ? m.hz : m.baud == 1200 ? 1700 : (range.minHz + range.maxHz) / 2;
  H.detectFound("packet", "Packet " + m.baud, hz, null, m.src + ">" + m.dst, { baud: m.baud, hz: m.hz > 0 ? m.hz : null });
}

// Packet in the decoder's mode registry: VHF and HF packet from the input's own samples
mmdRegisterMode({
  id: "packet",
  name: "Packet",
  modes: ["packet"],
  input: "raw",
  detect: PACKET_DETECT,
  init: (host) => mmdPacketInit(host),
  audio: (data) => mmdPacketAudio(data),
  // (a click: HF packet locked on there, or let go inside the lock)
  tune: (hz) => mmdPacketLock(hz),
  shown: (on) =>
  {
    packetList.style.display = on ? "" : "none";
  },
  entered: () => mmdPacketReset(),
  draw: (ctx, x, ratio, w, h) => mmdPacketDraw(ctx, x, ratio, w, h),
  clear: () =>
  {
    if (PACKET.host) mmdPacketClear();
  },
  retune: () =>
  {
    if (mmdPacketMode()) mmdPacketReset();
  },
  // (HF packet is looked for between Min Freq and Max Freq)
  range: () => mmdPacketHf(),
  // Its RSID ("Packet 1200"): clicked, decoded from its start (already in Packet: it is already)
  rsidMode: (name) => (name == "Packet 1200" ? ["packet", null] : null),
  rsidBefore: () => !mmdPacketMode(),
  rsidAfter: (mark, sub, chunks) =>
  {
    for (const chunk of chunks) mmdPacketAudio(chunk);
  },
  detectRaw: (data) => mmdPacketDetectRaw(data),
  detectReset: () =>
  {
    if (PACKET.detect) PACKET.detect.worker.postMessage({ type: "reset" });
  },
  // A station Detect Modes found picked: an HF one's place locked
  detectAfter: (f) =>
  {
    if (!f.sub || !f.sub.hz) return;
    PACKET.lock = null;
    mmdPacketLock(f.sub.hz);
  }
});
