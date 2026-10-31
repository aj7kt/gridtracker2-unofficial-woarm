// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Multi-Mode Decoder's Packet mode (the Mode menu): the input's own samples (the worklet's raw stream, at its full rate) go to
// packetWorker.js, which finds AX.25 frames at 1200 baud (AFSK, VHF APRS), 9600 (G3RUH FSK) and 300 (HF packet), and reads APRS in them.
// Here each frame is a line on top of the list: UTC, baud, from, to and path (and the satellite BirdWatch follows, heard through it), and
// what it says (APRS read: a position with its grid, a message, a status ...; other packets as they are). A message to you is highlighted.
// HF packet (300 baud) is looked for all across the audio decoded, wherever its tones land; each place one was heard lately is a tick at
// the waterfall's top, and its line says where (its Baud's hover). A click on the waterfall (or on a 300 baud line) locks onto that place:
// only it is decoded, shown by a tick with guard lines either side and its two tones; a click inside the guards lets go

// Lines kept in the list
const PACKET_ROWS_MAX = 1000;
// The lock's guard lines either side of its middle (Hz: the tones 100 Hz either side, and the worker's spread round it), and how long a
// place 300 baud was heard stays ticked (ms)
const PACKET_LOCK_HALF = 200;
const PACKET_HEARD_MS = 120000;

const PACKET = {
  worker: null,
  rate: 0,       // the sample rate the worker was set up for
  lines: [],     // the newest first: { utc, baud, src, to, sat, text, mine, hz }
  count: 0,      // frames decoded since the list was cleared
  lock: null,    // HF 300 baud locked on this place (Hz of audio), or null: looked for everywhere
  heard: [],     // where 300 baud was heard lately: { hz, at }
  hfSent: ""     // what the worker was last told of the audio decoded and the lock
};

// packetWorker.js, set up for the input's rate (again when it changes), and told where HF packet is looked for
function mmdPacketLoad(rate)
{
  if (!PACKET.worker)
  {
    PACKET.worker = new Worker("lib/mmd/packetWorker.js");
    PACKET.worker.onmessage = (event) => mmdPacketMessage(event.data);
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
  const hf = { type: "hf", min: mmdMinHz(), max: mmdMaxHz(), lock: PACKET.lock };
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
  mmdOverlay();
}

// On the waterfall (mmdOverlay), in Packet mode: where 300 baud was heard lately (a cyan tick at the top, fading as it ages), and the lock:
// its middle a solid line with a tick at the top, its guards dashed, its tones (100 Hz either side) faint, the band between them shaded,
// and what it is in a label
function mmdPacketDraw(ctx, x, ratio, w, h)
{
  if (DEC.mode != "packet") return;
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
  mmdOverlayLabel(ctx, I18N("cwViewer.packet.locked").replace("{hz}", lock), mid, 12 * ratio, "center", 11, ratio, w, "rgb(255, 200, 80)");
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
  mmdOverlay();
}

function mmdPacketMessage(m)
{
  if (m.type != "frame" || DEC.mode != "packet") return;
  const myCall = String(GT.settings.app.myCall || "").toUpperCase();
  const base = (call) => String(call).toUpperCase().replace(/-\d+$/, "");
  const aprs = m.aprs;
  const line = {
    utc: new Date().toISOString().slice(11, 19),
    baud: m.baud,
    src: m.src,
    to: m.dst + (m.path.length ? " via " + m.path.join(",") : ""),
    sat: window.opener.mmDecoderSatellite(),
    text: aprs ? mmdPacketAprsText(aprs) : mmdPacketPrintable(m.info),
    // A message to you (APRS), or a frame addressed to you
    mine: myCall != "NOCALL" && ((aprs && aprs.kind == "message" && base(aprs.to) == base(myCall)) || base(m.dst) == base(myCall)),
    // HF 300 baud: where it was heard (Hz of audio), ticked on the waterfall
    hz: m.hz > 0 ? Math.round(m.hz) : null
  };
  if (line.hz != null)
  {
    PACKET.heard = PACKET.heard.filter((p) => Math.abs(p.hz - line.hz) > 60);
    PACKET.heard.push({ hz: line.hz, at: Date.now() });
    mmdOverlay();
  }
  PACKET.lines.unshift(line);
  if (PACKET.lines.length > PACKET_ROWS_MAX) PACKET.lines.length = PACKET_ROWS_MAX;
  PACKET.count++;
  // Scrolled down the list, the view is moved down by a line, so the lines being read stay put
  if (packetList.scrollTop > 0) packetList.scrollTop += packetRows.rows[0] ? packetRows.rows[0].getBoundingClientRect().height : 18;
  packetRows.insertAdjacentHTML("afterbegin", mmdPacketLine(line));
  while (packetRows.rows.length > PACKET_ROWS_MAX) packetRows.deleteRow(-1);
  packetEmpty.style.display = "none";
  mmdStatus(I18N("cwViewer.packet.status").replace("{count}", PACKET.count).replace("{utc}", line.utc));
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
  const label = (kind) => I18N("cwViewer.packet.kind." + kind);
  const parts = [];
  if (a.lat != null)
  {
    const grid = window.opener.latLonToGridSquare(a.lat, a.lon, 6);
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
  // A 300 baud line: where it was heard on its Baud's hover, and a click on it locks there (mmdPacketInit)
  const heard = line.hz != null ? " title=\"" + mmdEscape(I18N("cwViewer.packet.heardAt").replace("{hz}", line.hz)).replace(/"/g, "&quot;") + "\"" : "";
  return "<tr" + (line.mine ? " class='packetMine'" : "") + (line.hz != null ? " data-hz='" + line.hz + "'" : "") + "><td class='ft8Num'>" + line.utc + "</td><td class='ft8Num'" + heard + ">" + line.baud + "</td><td class='packetCall'>" + mmdEscape(line.src) +
    "</td><td class='packetPath' title=\"" + mmdEscape(line.to).replace(/"/g, "&quot;") + "\">" + mmdEscape(line.to) + (line.sat ? " <span class='packetSat'>" + mmdEscape(I18N("cwViewer.packet.via").replace("{sat}", line.sat)) + "</span>" : "") +
    "</td><td title=\"" + mmdEscape(line.text).replace(/"/g, "&quot;") + "\">" + mmdEscape(line.text) + "</td></tr>";
}

// A click on a 300 baud line: locked on where it was heard (not when the mouse selected text in it, to copy)
function mmdPacketInit()
{
  packetRows.addEventListener("click", (event) =>
  {
    const row = event.target.closest("tr[data-hz]");
    if (row && String(window.getSelection()).length == 0) mmdPacketLock(Number(row.dataset.hz));
  });
}

// The whole list drawn again (after a Clear)
function mmdPacketRender()
{
  packetRows.innerHTML = PACKET.lines.map(mmdPacketLine).join("");
  packetEmpty.style.display = PACKET.lines.length ? "none" : "";
}
