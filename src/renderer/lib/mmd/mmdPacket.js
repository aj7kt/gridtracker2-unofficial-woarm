// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Multi-Mode Decoder's Packet mode (the Mode menu): the input's own samples (the worklet's raw stream, at its full rate) go to
// packetWorker.js, which finds AX.25 frames at 1200 baud (AFSK, VHF APRS), 9600 (G3RUH FSK) and 300 (HF packet), and reads APRS in them.
// Here each frame is a line on top of the list: UTC, baud, from, to and path (and the satellite BirdWatch follows, heard through it), and
// what it says (APRS read: a position with its grid, a message, a status ...; other packets as they are). A message to you is highlighted

// Lines kept in the list
const PACKET_ROWS_MAX = 1000;

const PACKET = {
  worker: null,
  rate: 0,       // the sample rate the worker was set up for
  lines: [],     // the newest first: { utc, baud, src, to, sat, text, mine }
  count: 0       // frames decoded since the list was cleared
};

// packetWorker.js, set up for the input's rate (again when it changes)
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
  }
  return PACKET.worker;
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

// Clear: the list emptied
function mmdPacketClear()
{
  mmdPacketReset();
  PACKET.lines = [];
  PACKET.count = 0;
  mmdPacketRender();
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
    mine: myCall != "NOCALL" && ((aprs && aprs.kind == "message" && base(aprs.to) == base(myCall)) || base(m.dst) == base(myCall))
  };
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
  return "<tr" + (line.mine ? " class='packetMine'" : "") + "><td class='ft8Num'>" + line.utc + "</td><td class='ft8Num'>" + line.baud + "</td><td class='packetCall'>" + mmdEscape(line.src) +
    "</td><td class='packetPath' title=\"" + mmdEscape(line.to).replace(/"/g, "&quot;") + "\">" + mmdEscape(line.to) + (line.sat ? " <span class='packetSat'>" + mmdEscape(I18N("cwViewer.packet.via").replace("{sat}", line.sat)) + "</span>" : "") +
    "</td><td title=\"" + mmdEscape(line.text).replace(/"/g, "&quot;") + "\">" + mmdEscape(line.text) + "</td></tr>";
}

// The whole list drawn again (after a Clear)
function mmdPacketRender()
{
  packetRows.innerHTML = PACKET.lines.map(mmdPacketLine).join("");
  packetEmpty.style.display = PACKET.lines.length ? "none" : "";
}
