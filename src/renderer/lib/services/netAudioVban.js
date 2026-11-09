// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// VBAN by VB-Audio (Voicemeeter, VBAN Receptor/Talkie, PipeWire's module-vban, ...) as a network audio stream for the Multi-Mode
// Decoder (netAudio.js): its Input Device menus hear a VBAN stream, its Output Device menus send one.
//   The protocol (VBAN Protocol Specifications, revision 13, Sep 2025, little-endian): one UDP packet each frame of audio, to port 6980
//   by default, unicast or broadcast, nothing ever asked or answered. Each packet a 28-byte header and its samples:
//     0  "VBAN"
//     4  the sample rate's index (low 5 bits, VBAN_RATES) and the sub-protocol (high 3 bits: 0x00 audio, 0x20 serial, 0x40 text,
//        0x60 service)
//     5  samples in the packet, less 1 (1 to 256)
//     6  channels, less 1 (1 to 256)
//     7  the data format (low 3 bits, VBAN_FORMATS), a reserved bit (0x08, must be 0) and the codec (high 4 bits: 0x00 PCM)
//     8  the stream's name, 16 ASCII characters (unused ones zero)
//     24 the frame counter, 32 bits, one more each packet of the stream
//   The samples interleaved by channel (as in a WAVE file), the data after the header exactly what the header says, at most 1436 bytes.
//   A stream is known by its name and the address it comes from (two senders may use the same name).
// Only PCM audio is taken. The other sub-protocols are ignored, the service one's PING (VBAN_SERVICE_IDENTIFICATION, asking devices
// on the LAN to say who they are) too: answering it would only list this computer (its host and user name) in other VBAN apps,
// which neither receiving nor sending needs, and it is a request a device is free not to answer.
// VBAN says nothing about a lost packet: its frame counter is what shows one. UDP may also duplicate or reorder packets; one older
// than the last taken is dropped (too late to be placed), a gap is filled with silence so the timeline stays true

const VBAN_HEADER_BYTES = 28;
// "VBAN" read as a little-endian 32-bit word
const VBAN_MAGIC = 0x4e414256;
const VBAN_PROTOCOL_MASK = 0xe0;
const VBAN_PROTOCOL_AUDIO = 0x00;
const VBAN_RATE_MASK = 0x1f;
const VBAN_DATATYPE_MASK = 0x07;
const VBAN_RESERVED_MASK = 0x08;
const VBAN_CODEC_MASK = 0xf0;
const VBAN_CODEC_PCM = 0x00;
const VBAN_DATATYPE_INT16 = 1;
// The sample rates by index (21 to 31 undefined)
const VBAN_RATES = [
  6000, 12000, 24000, 48000, 96000, 192000, 384000,
  8000, 16000, 32000, 64000, 128000, 256000, 512000,
  11025, 22050, 44100, 88200, 176400, 352800, 705600
];
// The data formats by index: bytes a sample, its name, and how one is read to ±1. 8-bit is unsigned (128 is zero). 12-bit and 10-bit
// (6, 7) are listed by the specification without saying how they are packed: not taken
const VBAN_FORMATS = [
  { bytes: 1, label: "8-bit", read: (b, o) => (b[o] - 128) / 128 },
  { bytes: 2, label: "16-bit", read: (b, o) => b.readInt16LE(o) / 32768 },
  { bytes: 3, label: "24-bit", read: (b, o) => (((b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) << 8) >> 8) / 8388608 },
  { bytes: 4, label: "32-bit", read: (b, o) => b.readInt32LE(o) / 2147483648 },
  { bytes: 4, label: "32-bit float", read: (b, o) => b.readFloatLE(o) },
  { bytes: 8, label: "64-bit float", read: (b, o) => b.readDoubleLE(o) }
];
const VBAN_MAX_SAMPLES = 256;
const VBAN_MAX_DATA = 1436;
const VBAN_NAME_BYTES = 16;
const VBAN_PORT_DEFAULT = 6980;
const VBAN_NAME_DEFAULT = "Stream1";
const VBAN_RETRY_MS = 3000;
// No packet for this long: the stream is taken as gone (said once), and the next one as a new start (no gap filled)
const VBAN_SILENT_MS = 2000;
const VBAN_WATCH_MS = 500;
// A frame counter at most this many packets behind the last one taken is a late or doubled packet (dropped); further back, the sender
// started again (its counter from 0)
const VBAN_LATE_PACKETS = 64;
// This many packets in a row dropped as late: the sender started again all the same
const VBAN_LATE_RUN = 16;
// The most silence a gap is filled with, in seconds of the stream (more: a restart, nothing filled)
const VBAN_FILL_MAX_S = 1;
// Samples sent in part of a packet when nothing more comes for this long (the end of a transmission)
const VBAN_FLUSH_MS = 100;
// A stream not heard for this long leaves the Found menu and the list of others seen
const VBAN_FORGET_MS = 5000;

// The UDP sockets listening, one each local port, shared by every input (and the Found menu) on it: { port, socket, bound, error,
// listeners, retry }
const VBAN_PORTS = {};

NET_AUDIO_PROTOCOLS.vban = {
  name: "VBAN",
  dirs: ["in", "out"],
  fields: { in: ["port", "streamName", "host", "channel"], out: ["host", "port", "streamName", "rate", "channels"] },
  defaults: { port: VBAN_PORT_DEFAULT, streamName: VBAN_NAME_DEFAULT, host: "", rate: 48000, channels: 1, channel: "left" },
  discover: (onList) => netVbanDiscover(onList),
  open: (stream, dir, sink) => (dir == "out" ? netVbanOpenOut(stream, sink) : netVbanOpenIn(stream, sink))
};

// ---- Shared sockets

// A listener ({ onBound(P), onError(P, message), onPacket(head, msg, rinfo) }) on a local UDP port, its socket opened if it is the
// first; told at once if the socket is already up or failing
function netVbanPortJoin(port, listener)
{
  let P = VBAN_PORTS[port];
  if (!P)
  {
    P = VBAN_PORTS[port] = { port: port, socket: null, bound: false, error: null, listeners: new Set(), retry: null };
    P.listeners.add(listener);
    netVbanPortBind(P);
    return P;
  }
  P.listeners.add(listener);
  if (P.bound) listener.onBound(P);
  else if (P.error) listener.onError(P, P.error);
  return P;
}

// The last listener gone: the socket closed
function netVbanPortLeave(P, listener)
{
  P.listeners.delete(listener);
  if (P.listeners.size > 0 || VBAN_PORTS[P.port] !== P) return;
  delete VBAN_PORTS[P.port];
  if (P.retry) nodeTimers.clearTimeout(P.retry);
  P.retry = null;
  const socket = P.socket;
  P.socket = null;
  P.bound = false;
  if (socket) netVbanClose(socket);
}

// The port's socket, bound with reuseAddr so other VBAN apps on this computer may listen too
function netVbanPortBind(P)
{
  P.retry = null;
  if (VBAN_PORTS[P.port] !== P) return;
  const socket = window.require("dgram").createSocket({ type: "udp4", reuseAddr: true });
  P.socket = socket;
  socket.on("message", (msg, rinfo) => netVbanPortMessage(P, socket, msg, rinfo));
  socket.on("error", (e) => netVbanPortFail(P, socket, e.message));
  socket.on("listening", () =>
  {
    if (P.socket !== socket) return;
    P.bound = true;
    P.error = null;
    for (const L of P.listeners) L.onBound(P);
  });
  try
  {
    socket.bind(P.port);
  }
  catch (e)
  {
    netVbanPortFail(P, socket, e.message);
  }
}

// The socket failed (the port taken, or bad): every listener told, and tried again in a while
function netVbanPortFail(P, socket, message)
{
  if (P.socket !== socket) return;
  P.socket = null;
  P.bound = false;
  P.error = message;
  netVbanClose(socket);
  for (const L of P.listeners) L.onError(P, message);
  if (VBAN_PORTS[P.port] === P && !P.retry) P.retry = nodeTimers.setTimeout(() => netVbanPortBind(P), VBAN_RETRY_MS);
}

// A VBAN audio packet to every listener on the port; anything else dropped here
function netVbanPortMessage(P, socket, msg, rinfo)
{
  if (P.socket !== socket) return;
  const head = netVbanHeader(msg);
  if (!head || head.protocol != VBAN_PROTOCOL_AUDIO) return;
  for (const L of P.listeners) L.onPacket(head, msg, rinfo);
}

function netVbanClose(socket)
{
  try
  {
    socket.close();
  }
  catch (e)
  {
    // Already closed
  }
}

// ---- Packets

// A packet's header, or null when it isn't VBAN
function netVbanHeader(msg)
{
  if (msg.length < VBAN_HEADER_BYTES || msg.readUInt32LE(0) != VBAN_MAGIC) return null;
  const name = msg.subarray(8, 8 + VBAN_NAME_BYTES);
  const end = name.indexOf(0);
  return {
    protocol: msg[4] & VBAN_PROTOCOL_MASK,
    rate: VBAN_RATES[msg[4] & VBAN_RATE_MASK] || 0,
    samples: msg[5] + 1,
    channels: msg[6] + 1,
    format: msg[7] & VBAN_DATATYPE_MASK,
    reserved: msg[7] & VBAN_RESERVED_MASK,
    codec: msg[7] & VBAN_CODEC_MASK,
    name: name.toString("latin1", 0, end < 0 ? VBAN_NAME_BYTES : end).trim(),
    frame: msg.readUInt32LE(24)
  };
}

// What a stream carries, for status lines: "48 kHz, 2 ch, 16-bit"
function netVbanDescribe(rate, channels, label)
{
  return netVbanKhz(rate) + " kHz, " + channels + " ch, " + label;
}

function netVbanKhz(rate)
{
  return String(Math.round(rate) / 1000);
}

// A stream name as VBAN carries it: printable ASCII, at most 16 characters
function netVbanName(text)
{
  return String(text || "").replace(/[^\x20-\x7e]/g, "").trim().slice(0, VBAN_NAME_BYTES);
}

// An address to send to or filter on: an IPv4 address as it is, a hostname looked up (IPv4); done(error, address)
function netVbanResolve(host, done)
{
  if (window.require("net").isIPv4(host))
  {
    done(null, host);
    return;
  }
  window.require("dns").lookup(host, { family: 4 }, (e, address) => done(e, address));
}

// ---- Input

// A VBAN stream heard on a local port: the one named (any case), or with no name set the first one seen; only from the host set, if
// one is. Its chunks to sink.pcm as they come, mono (the channel picked), at the rate each packet says
function netVbanOpenIn(stream, sink)
{
  const H = {
    sink: sink,
    port: Number(stream.port) || VBAN_PORT_DEFAULT,
    wantName: netVbanName(stream.streamName),
    want: netVbanName(stream.streamName).toLowerCase(),
    host: String(stream.host || "").trim(),
    hostIp: null,
    pick: stream.channel || "left",
    // The stream taken: its name, its sender's address, its format, the last frame counter taken, and when
    name: null,
    from: null,
    key: null,
    last: null,
    lastAt: 0,
    lateRun: 0,
    silent: true,
    heard: false,
    bad: null,
    // Other streams on the port while the one named isn't there: "name (address)" -> when last seen
    others: new Map(),
    othersText: "",
    statusText: null,
    statusError: false,
    P: null,
    watch: null,
    retry: null,
    stopped: false
  };
  H.listener = {
    onBound: () => netVbanInIdle(H),
    onError: (P, message) =>
    {
      netVbanInForget(H);
      netVbanStatus(H, I18N("netAudio.vban.bindFailed").replace("{port}", H.port).replace("{error}", message), true);
    },
    onPacket: (head, msg, rinfo) => netVbanInPacket(H, head, msg, rinfo)
  };
  if (!(H.port >= 1 && H.port <= 65535))
  {
    netVbanStatus(H, I18N("netAudio.vban.bindFailed").replace("{port}", stream.port).replace("{error}", I18N("netAudio.vban.badPort")), true);
    return { stop: () => {} };
  }
  H.watch = nodeTimers.setInterval(() => netVbanInWatch(H), VBAN_WATCH_MS);
  if (H.host) netVbanInResolve(H);
  else H.P = netVbanPortJoin(H.port, H.listener);
  return { stop: () => netVbanInStop(H) };
}

function netVbanInStop(H)
{
  if (H.stopped) return;
  H.stopped = true;
  if (H.watch) nodeTimers.clearInterval(H.watch);
  if (H.retry) nodeTimers.clearTimeout(H.retry);
  H.watch = H.retry = null;
  if (H.P) netVbanPortLeave(H.P, H.listener);
  H.P = null;
}

// The source filter's address (a hostname looked up once each open; tried again while it can't be found), then the port joined
function netVbanInResolve(H)
{
  H.retry = null;
  netVbanResolve(H.host, (e, address) =>
  {
    if (H.stopped) return;
    if (e || !address)
    {
      netVbanStatus(H, I18N("netAudio.vban.hostFailed").replace("{host}", H.host).replace("{error}", e ? e.message : ""), true);
      H.retry = nodeTimers.setTimeout(() => netVbanInResolve(H), VBAN_RETRY_MS);
      return;
    }
    H.hostIp = address;
    H.P = netVbanPortJoin(H.port, H.listener);
  });
}

// The status line, only when it changes
function netVbanStatus(H, text, error = false)
{
  if (H.stopped || (text == H.statusText && error == H.statusError)) return;
  H.statusText = text;
  H.statusError = error;
  try
  {
    H.sink.status(text, error);
  }
  catch (e)
  {
    // The window listening has gone; the core stops this handle
  }
}

// Listening, nothing taken: what is heard on the port says what the status line is
function netVbanInIdle(H)
{
  if (H.from) return;
  const listening = I18N("netAudio.vban.listening").replace("{port}", H.port);
  if (H.want && H.othersText)
  {
    netVbanStatus(H, I18N("netAudio.vban.waiting").replace("{name}", H.wantName).replace("{port}", H.port).replace("{names}", H.othersText));
  }
  else if (H.heard)
  {
    netVbanStatus(H, I18N("netAudio.vban.noAudio").replace("{seconds}", VBAN_SILENT_MS / 1000) + " (" + listening + ")");
  }
  else netVbanStatus(H, listening);
}

// The stream taken let go: the next packet that matches is a new start, from whoever sends it
function netVbanInForget(H)
{
  H.from = null;
  H.key = null;
  H.last = null;
  H.lateRun = 0;
  H.bad = null;
  H.silent = true;
  if (!H.want) H.name = null;
}

// Each half second: a stream not heard for 2 s said once and let go, and streams no longer seen out of the list of others
function netVbanInWatch(H)
{
  const now = Date.now();
  if (H.from && now - H.lastAt > VBAN_SILENT_MS)
  {
    netVbanInForget(H);
    netVbanInIdle(H);
  }
  if (H.others.size > 0)
  {
    for (const [label, at] of H.others)
    {
      if (now - at > VBAN_FORGET_MS) H.others.delete(label);
    }
    netVbanInOthers(H);
  }
}

// The others seen, as the status line shows them; the status line again if that changed
function netVbanInOthers(H)
{
  const text = Array.from(H.others.keys()).sort().join(", ");
  if (text == H.othersText) return;
  H.othersText = text;
  if (H.P && H.P.bound) netVbanInIdle(H);
}

// One audio packet heard on the port: is it this stream's, what format, where on the timeline (gap, late, restart), and its samples
function netVbanInPacket(H, head, msg, rinfo)
{
  if (H.stopped) return;
  if (H.hostIp && rinfo.address != H.hostIp) return;
  const now = Date.now();
  if (H.want)
  {
    if (head.name.toLowerCase() != H.want)
    {
      if (!H.from)
      {
        const label = (head.name || "\"\"") + " (" + rinfo.address + ")";
        const known = H.others.has(label);
        H.others.set(label, now);
        if (!known) netVbanInOthers(H);
      }
      return;
    }
  }
  else if (H.name !== null && head.name != H.name) return;
  // One sender at a time: another one with the same name waits until this one has gone quiet
  if (H.from && rinfo.address != H.from) return;
  if (!H.from)
  {
    H.from = rinfo.address;
    H.name = head.name;
    H.others.clear();
    H.othersText = "";
  }
  H.heard = true;

  const format = VBAN_FORMATS[head.format];
  if (head.codec != VBAN_CODEC_PCM || !format || !head.rate || head.reserved)
  {
    const what = head.codec != VBAN_CODEC_PCM ? "codec " + (head.codec >> 4) : !head.rate ? "rate " + (msg[4] & VBAN_RATE_MASK) : "format " + head.format;
    H.lastAt = now;
    H.key = null;
    if (H.bad != what)
    {
      H.bad = what;
      netVbanStatus(H, I18N("netAudio.vban.unsupported").replace("{host}", H.from).replace("{name}", H.name).replace("{what}", what), true);
    }
    return;
  }
  H.bad = null;
  // Corrupt (less data than the header says): dropped, as Voicemeeter does
  if (msg.length - VBAN_HEADER_BYTES < format.bytes * head.channels * head.samples) return;

  const key = head.rate + "/" + head.channels + "/" + head.format;
  if (key != H.key)
  {
    // A new format: a new start, nothing filled
    H.key = key;
    H.last = null;
    H.silent = true;
  }
  if (H.last !== null)
  {
    const step = (head.frame - H.last) | 0;
    if (step <= 0 && step > -VBAN_LATE_PACKETS && H.lateRun < VBAN_LATE_RUN)
    {
      H.lateRun++;
      return;
    }
    if (step > 1)
    {
      // Packets lost: as many samples of silence as they held (taken as this one's size), when that is a believable gap
      const missing = (step - 1) * head.samples;
      if (missing <= head.rate * VBAN_FILL_MAX_S) netVbanInPcm(H, new Float32Array(missing), head.rate);
    }
  }
  H.last = head.frame;
  H.lateRun = 0;
  H.lastAt = now;
  netVbanInPcm(H, netVbanDecode(msg, head, format, H.pick), head.rate);
  if (H.silent)
  {
    H.silent = false;
    const text = I18N(H.want ? "netAudio.vban.receiving" : "netAudio.vban.receivingFirst");
    netVbanStatus(H, text.replace("{format}", netVbanDescribe(head.rate, head.channels, format.label)).replace("{host}", H.from).replace("{name}", H.name || "\"\""));
  }
}

function netVbanInPcm(H, samples, rate)
{
  try
  {
    H.sink.pcm(samples, rate);
  }
  catch (e)
  {
    // The window listening has gone; the core stops this handle
  }
}

// A packet's samples as mono ±1: the left channel, the right one (the left if there is only one) or all of them mixed
function netVbanDecode(msg, head, format, pick)
{
  const n = head.samples;
  const size = format.bytes;
  const stride = size * head.channels;
  const first = pick == "right" && head.channels > 1 ? 1 : 0;
  const count = pick == "mix" ? head.channels : 1;
  const read = format.read;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++)
  {
    let offset = VBAN_HEADER_BYTES + i * stride + first * size;
    let sum = 0;
    for (let c = 0; c < count; c++, offset += size) sum += read(msg, offset);
    out[i] = count > 1 ? sum / count : sum;
  }
  return out;
}

// ---- Found menu

// VBAN streams heard on the default port, for the Found menu: onList(list) each time the streams seen (or their formats) change
function netVbanDiscover(onList)
{
  const D = { onList: onList, seen: new Map(), text: null, P: null, timer: null, stopped: false };
  const listener = {
    onBound: () => {},
    onError: () => {},
    onPacket: (head, msg, rinfo) =>
    {
      const format = VBAN_FORMATS[head.format];
      const id = head.name + "\n" + rinfo.address;
      const item = D.seen.get(id);
      const info = netVbanKhz(head.rate) + " kHz, " + head.channels + " ch";
      D.seen.set(id, { name: head.name, address: rinfo.address, info: info, usable: head.codec == VBAN_CODEC_PCM && !!format && !!head.rate, at: Date.now() });
      if (!item || item.info != info) netVbanDiscoverList(D);
    }
  };
  D.P = netVbanPortJoin(VBAN_PORT_DEFAULT, listener);
  D.timer = nodeTimers.setInterval(() =>
  {
    const now = Date.now();
    for (const [id, item] of D.seen)
    {
      if (now - item.at > VBAN_FORGET_MS) D.seen.delete(id);
    }
    netVbanDiscoverList(D);
  }, 1000);
  return {
    stop: () =>
    {
      if (D.stopped) return;
      D.stopped = true;
      nodeTimers.clearInterval(D.timer);
      netVbanPortLeave(D.P, listener);
    }
  };
}

// The Found list, passed on only when it changed
function netVbanDiscoverList(D)
{
  const list = [];
  for (const item of D.seen.values())
  {
    if (!item.usable) continue;
    list.push({
      label: "VBAN: " + I18N("netAudio.vban.found").replace("{name}", item.name || "\"\"").replace("{host}", item.address) + " (" + item.info + ")",
      dir: "in",
      fields: { port: VBAN_PORT_DEFAULT, streamName: item.name, host: item.address }
    });
  }
  list.sort((a, b) => a.label.localeCompare(b.label));
  const text = list.map((item) => item.label).join("\n");
  if (text == D.text || D.stopped) return;
  D.text = text;
  try
  {
    D.onList(list);
  }
  catch (e)
  {
    // The window listening has gone
  }
}

// ---- Output

// A VBAN stream sent to a host (unicast or broadcast): 16-bit PCM at the rate set, the mono samples in every channel, whole packets of
// up to 256 samples as they fill (the rest of a write waits for the next one, or is sent alone when nothing more comes)
function netVbanOpenOut(stream, sink)
{
  const rate = VBAN_RATES.indexOf(Number(stream.rate)) >= 0 ? Number(stream.rate) : 48000;
  const channels = Math.max(1, Math.min(8, Number(stream.channels) || 1));
  const perPacket = Math.min(VBAN_MAX_SAMPLES, Math.floor(VBAN_MAX_DATA / (2 * channels)));
  const O = {
    sink: sink,
    rate: rate,
    channels: channels,
    perPacket: perPacket,
    name: netVbanName(stream.streamName) || VBAN_NAME_DEFAULT,
    host: String(stream.host || "").trim(),
    port: Number(stream.port) || VBAN_PORT_DEFAULT,
    header: Buffer.alloc(VBAN_HEADER_BYTES),
    frame: 0,
    carry: new Float32Array(perPacket),
    carried: 0,
    socket: null,
    address: null,
    sending: false,
    flush: null,
    idle: null,
    retry: null,
    statusText: null,
    statusError: false,
    stopped: false
  };
  O.header.write("VBAN", 0, "ascii");
  O.header[4] = VBAN_RATES.indexOf(rate) | VBAN_PROTOCOL_AUDIO;
  O.header[6] = channels - 1;
  O.header[7] = VBAN_DATATYPE_INT16 | VBAN_CODEC_PCM;
  O.header.write(O.name, 8, VBAN_NAME_BYTES, "ascii");
  O.format = netVbanDescribe(rate, channels, "16-bit");
  O.where = O.host + ":" + O.port;
  if (!O.host || !(O.port >= 1 && O.port <= 65535))
  {
    const text = !O.host ? I18N("netAudio.vban.noHost") : I18N("netAudio.vban.sendFailed").replace("{host}", O.where).replace("{error}", I18N("netAudio.vban.badPort"));
    netVbanStatus(O, text, true);
    return { rate: rate, write: () => {}, stop: () => {} };
  }
  netVbanOutOpen(O);
  return { rate: rate, write: (samples) => netVbanOutWrite(O, samples), stop: () => netVbanOutStop(O) };
}

function netVbanOutStop(O)
{
  if (O.stopped) return;
  O.stopped = true;
  for (const timer of [O.flush, O.idle, O.retry])
  {
    if (timer) nodeTimers.clearTimeout(timer);
  }
  O.flush = O.idle = O.retry = null;
  if (O.socket) netVbanClose(O.socket);
  O.socket = null;
}

// Its own socket (any local port), allowed to broadcast, then the host looked up; again in a while if either fails
function netVbanOutOpen(O)
{
  O.retry = null;
  if (O.stopped) return;
  if (!O.socket)
  {
    const socket = window.require("dgram").createSocket({ type: "udp4" });
    O.socket = socket;
    socket.on("error", (e) => netVbanOutFail(O, socket, I18N("netAudio.vban.sendFailed").replace("{host}", O.where).replace("{error}", e.message)));
    try
    {
      socket.bind(0, () =>
      {
        if (O.socket !== socket) return;
        try
        {
          socket.setBroadcast(true);
        }
        catch (e)
        {
          // Broadcast not allowed here: unicast still works
        }
        netVbanOutResolve(O);
      });
    }
    catch (e)
    {
      netVbanOutFail(O, socket, I18N("netAudio.vban.sendFailed").replace("{host}", O.where).replace("{error}", e.message));
    }
    return;
  }
  netVbanOutResolve(O);
}

// The host's address, looked up once each open (and again after a send fails)
function netVbanOutResolve(O)
{
  netVbanResolve(O.host, (e, address) =>
  {
    if (O.stopped) return;
    if (e || !address)
    {
      netVbanOutFail(O, null, I18N("netAudio.vban.hostFailed").replace("{host}", O.host).replace("{error}", e ? e.message : ""));
      return;
    }
    O.address = address;
    O.sending = false;
    netVbanStatus(O, I18N("netAudio.vban.ready").replace("{format}", O.format).replace("{host}", O.where).replace("{name}", O.name));
  });
}

// Sending failed: said, samples dropped meanwhile, and the socket (if it is the one that failed) and the address tried again
function netVbanOutFail(O, socket, text)
{
  if (O.stopped) return;
  if (socket && O.socket === socket)
  {
    O.socket = null;
    netVbanClose(socket);
  }
  O.address = null;
  O.sending = false;
  netVbanStatus(O, text, true);
  if (!O.retry) O.retry = nodeTimers.setTimeout(() => netVbanOutOpen(O), VBAN_RETRY_MS);
}

// Mono samples at O.rate from the producer: whole packets sent as they fill; nothing kept while there is nowhere to send them
function netVbanOutWrite(O, samples)
{
  if (O.stopped || !samples) return;
  if (O.flush) nodeTimers.clearTimeout(O.flush);
  O.flush = null;
  if (!O.address || !O.socket)
  {
    O.carried = 0;
    return;
  }
  let i = 0;
  while (i < samples.length)
  {
    const take = Math.min(O.perPacket - O.carried, samples.length - i);
    O.carry.set(samples.subarray(i, i + take), O.carried);
    O.carried += take;
    i += take;
    if (O.carried == O.perPacket) netVbanOutSend(O);
  }
  if (O.carried > 0) O.flush = nodeTimers.setTimeout(() => netVbanOutFlush(O), VBAN_FLUSH_MS);
  if (O.idle) nodeTimers.clearTimeout(O.idle);
  O.idle = nodeTimers.setTimeout(() => netVbanOutIdle(O), VBAN_SILENT_MS);
}

// Nothing more came: what is left sent as a short packet
function netVbanOutFlush(O)
{
  O.flush = null;
  if (!O.stopped && O.carried > 0 && O.address) netVbanOutSend(O);
}

// Nothing sent for a while: the status line back to ready
function netVbanOutIdle(O)
{
  O.idle = null;
  if (O.stopped || !O.address || !O.sending) return;
  O.sending = false;
  netVbanStatus(O, I18N("netAudio.vban.ready").replace("{format}", O.format).replace("{host}", O.where).replace("{name}", O.name));
}

// One packet of the samples carried: 16-bit, each sample in every channel, the frame counter one more
function netVbanOutSend(O)
{
  const n = O.carried;
  O.carried = 0;
  const channels = O.channels;
  const packet = Buffer.alloc(VBAN_HEADER_BYTES + n * 2 * channels);
  O.header.copy(packet, 0);
  packet[5] = n - 1;
  packet.writeUInt32LE(O.frame >>> 0, 24);
  O.frame = (O.frame + 1) >>> 0;
  let offset = VBAN_HEADER_BYTES;
  for (let i = 0; i < n; i++)
  {
    const value = Math.round(Math.max(-1, Math.min(1, O.carry[i] || 0)) * 32767);
    for (let c = 0; c < channels; c++, offset += 2) packet.writeInt16LE(value, offset);
  }
  const socket = O.socket;
  socket.send(packet, O.port, O.address, (e) =>
  {
    if (O.stopped || O.socket !== socket) return;
    if (e)
    {
      netVbanOutFail(O, null, I18N("netAudio.vban.sendFailed").replace("{host}", O.where).replace("{error}", e.message));
    }
    else if (!O.sending && O.address)
    {
      O.sending = true;
      netVbanStatus(O, I18N("netAudio.vban.sending").replace("{format}", O.format).replace("{host}", O.where).replace("{name}", O.name));
    }
  });
}
