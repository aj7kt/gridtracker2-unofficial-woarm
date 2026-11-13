// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// Map Cast's video (mapCast.js), off the main window's thread: the main window's capture of its map (Element Capture, at the video's
// size) encoded as H.264 (WebCodecs; the config comes from mapCast.js: a hardware encoder's, else the software one's at a lower frame
// rate) while it's wanted (a cast, or someone on the network watching), and kept as HLS: CAST_SEGMENT_SECONDS MPEG-TS segments, each
// from a key frame, the last CAST_SEGMENTS_LISTED of them listed. A small HTTP server (Node's http: the main window has
// nodeIntegrationInWorker), on the Port while Enable Casting is on, serves them: map.m3u8 (the master playlist: the video's codec,
// size, frame rate and bandwidth, which a media playlist can't tell), video.m3u8 (the live playlist) and seg<n>.ts; a device starts
// near the oldest listed, so it has most of what is kept at once. map.ts is the same segments as one endless stream (for players that
// take a plain HTTP stream, not HLS: many DLNA ones; mapCastAnnounceWorker.js lists it): the last CAST_STREAM_BURST segments at once,
// then each as it's done. A request while there's no video yet asks for it ("wanted") and is answered once CAST_SEGMENTS_READY segments
// are done; nobody asking for anything for CAST_IDLE_MS is said ("idle"). Times in 90 kHz; each frame lasts until the next.
// The video's frames are a fixed rate's: one in each 1/fps of a second (its time that slot's start), the capture's latest picture. The
// capture sends one only when the picture changes (and none while the window is minimized), so mostly it is the same picture again,
// which costs next to nothing. A picture not at the video's size (the window not 16:9 before casting snaps it) is fitted into it.
// In:  { type: "listen", port }, { type: "start", config, quantizer, gen } (the VideoEncoder's config: its size and frame rate the
//      video's; each frame's QP, null for the encoder's own bitrate; the video's number), { type: "encodeStop" }, { type: "track", track } or
//      { type: "frames", readable } (the capture, replacing any before), { type: "untrack" }, { type: "castEnded", address } (the device
//      cast to counted as watching for CAST_IDLE_MS more), { type: "stop" }
// Out: { type: "listening", port }, { type: "wanted" }, { type: "idle" }, { type: "segments", count, gen } (those listed),
//      { type: "error", text, code, serving }, { type: "captureEnded" } (the capture's frames stopped coming),
//      { type: "stats", frames, outputs, keys, keyBytes, deltaBytes, grabs, repeats, sent, encodeMs, segments, sequence } (each segment),
//      { type: "viewers", addresses } (who's watching now, as it changes), { type: "log", text }

const http = require("http");
const { Buffer } = require("buffer");
// Node's timers, as every window uses: never Chromium's, which can be slowed while a window is hidden
const nodeTimers = require("timers");

// A segment's length (a key frame starts each)
const CAST_SEGMENT_SECONDS = 2;
// The segments listed (the video a device starts with), and those kept: one that leaves the list is kept for its own length and the
// list's (RFC 8216: a device may still be fetching it)
const CAST_SEGMENTS_LISTED = 6;
const CAST_SEGMENTS_KEPT = CAST_SEGMENTS_LISTED * 2 + 1;
// A request while there's no video yet is answered once half the segments listed are done (a device cast to waits for all of them:
// mapCast.js), else after CAST_HOLD_MS with 503
const CAST_SEGMENTS_READY = CAST_SEGMENTS_LISTED / 2;
const CAST_HOLD_MS = 30000;
// Nobody watching (no request, the device cast to counted from when its cast stopped) this long: said, so the video stops being made;
// looked at this often
const CAST_IDLE_MS = 30000;
const CAST_IDLE_CHECK_MS = 1000;
// Watching now: an address that asked for anything this recently (a player asks for the playlist every few seconds); the Cast button's
// badge counts them (with the devices cast to)
const CAST_WATCHING_MS = 10000;
// The master playlist's BANDWIDTH (bits a second) at the least: the most any kept segment needed, when more
const CAST_BANDWIDTH_MIN = 1000000;
// Frames waiting to be encoded past this are skipped
const CAST_ENCODE_QUEUE = 2;
const CAST_TIMESCALE = 90000;
// map.ts: the segments sent at once to a player that opens it (so it can start), and the most waiting to go to one that doesn't keep up
// (it's cut off past this)
const CAST_STREAM_BURST = 2;
const CAST_STREAM_BACKLOG = 16 * 1024 * 1024;
// map.ts's DLNA headers: a stream (no seeking, no byte ranges)
const CAST_STREAM_HEADERS = { "Content-Type": "video/mp2t", "transferMode.dlna.org": "Streaming", "contentFeatures.dlna.org": "DLNA.ORG_OP=00;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000" };

const W = {
  server: null,
  // Requests waiting for the video: [{ path, request, response, time }]; who asked for anything last when (address: Date.now()); the
  // video asked for and not started yet
  held: [],
  clients: {},
  // Who really asked for anything last when (address: Date.now(); not a device whose cast stopped, as clients counts), and the addresses
  // watching as last said ("viewers")
  seen: {},
  viewers: "",
  idleTimer: null,
  wanted: false,
  // The video's number (mapCast.js's, sent with its segments)
  gen: 0,
  encoder: null,
  // The codec's string (as in CODECS), and with the video's size and rate (the log's)
  codecString: "",
  codec: "",
  fps: 30,
  quantizer: 20,
  width: 0,
  height: 0,
  description: null,
  // The segment being filled: [{ time, key, data }], a key frame first
  pending: [],
  // Those done: [{ sequence, duration (seconds), ts }], oldest first
  segments: [],
  // Those playing map.ts: [{ response, address }], each sent every segment as it's done
  streams: [],
  sequence: 0,
  // The slot whose frame is the next key frame
  nextKeySlot: 0,
  last: null,
  // Where a picture not at the video's size is fitted into it
  canvas: null,
  tick: null,
  reader: null,
  track: null,
  // A captured frame came since the last frame encoded
  fresh: false,
  // When the video's first slot began (performance.now), and the last slot encoded
  start: 0,
  slot: -1,
  grabs: 0,
  repeats: 0,
  frames: 0,
  outputs: 0,
  keys: 0,
  keyBytes: 0,
  deltaBytes: 0,
  sent: 0,
  encodeStart: 0,
  encodeMs: 0
};

function workerLog(text)
{
  self.postMessage({ type: "log", text: text });
}

// ---- The frames as MPEG-TS segments
// Each segment: PAT, PMT, then one PES per frame (an access unit delimiter, the SPS and PPS before a key frame, its NAL units with start
// codes), its PTS the frame's time (90 kHz) plus TS_PTS_OFFSET, a PCR in its first packet. Continuity counters run on
// across segments, so one after another is one stream

const TS_PID_PMT = 0x1000;
const TS_PID_VIDEO = 0x100;
// The PCR is the frame's time, its PTS this much later (the time a player has to get it decoded)
const TS_PTS_OFFSET = 63000;
const TS_AUD = Buffer.from([0, 0, 0, 1, 0x09, 0xf0]);
const TS_CC = { pat: 0, pmt: 0, video: 0 };
const TS_CRC = (() =>
{
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++)
  {
    let c = i << 24;
    for (let bit = 0; bit < 8; bit++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
    table[i] = c >>> 0;
  }
  return table;
})();

// CRC-32/MPEG-2 of a PSI section
function tsCrc(bytes)
{
  let crc = 0xffffffff;
  for (const byte of bytes) crc = ((crc << 8) ^ TS_CRC[((crc >>> 24) ^ byte) & 0xff]) >>> 0;
  return crc;
}

// A PSI section (no CRC yet) in one packet: pointer field, the section and its CRC, 0xFF after
function tsPsi(pid, cc, section)
{
  const packet = Buffer.alloc(188, 0xff);
  packet.writeUInt8(0x47, 0);
  packet.writeUInt16BE(0x4000 | pid, 1);
  packet.writeUInt8(0x10 | cc, 3);
  packet.writeUInt8(0, 4);
  section.copy(packet, 5);
  packet.writeUInt32BE(tsCrc(section), 5 + section.length);
  return packet;
}

// The video's SPS and PPS (from the avcC), each with a start code
function tsParameterSets()
{
  const avcc = W.description;
  const parts = [];
  let at = 5;
  for (const count of ["sps", "pps"])
  {
    const n = count == "sps" ? avcc[at++] & 0x1f : avcc[at++];
    for (let i = 0; i < n; i++)
    {
      const length = avcc.readUInt16BE(at);
      parts.push(Buffer.from([0, 0, 0, 1]), avcc.subarray(at + 2, at + 2 + length));
      at += 2 + length;
    }
  }
  return Buffer.concat(parts);
}

// A frame's access unit in Annex B: AUD, SPS and PPS before a key frame (unless it has its own), its NAL units with start codes
function tsAccessUnit(frame, parameterSets)
{
  const lengthSize = (W.description[4] & 3) + 1;
  const parts = [TS_AUD];
  const nals = [];
  let hasSps = false;
  for (let at = 0; at + lengthSize <= frame.data.length;)
  {
    const length = frame.data.readUIntBE(at, lengthSize);
    const nal = frame.data.subarray(at + lengthSize, at + lengthSize + length);
    at += lengthSize + length;
    if (!nal.length) continue;
    const type = nal[0] & 0x1f;
    // (the encoder's own delimiters left out: there's one already)
    if (type == 9) continue;
    if (type == 7) hasSps = true;
    nals.push(Buffer.from([0, 0, 0, 1]), nal);
  }
  if (frame.key && !hasSps) parts.push(parameterSets);
  return Buffer.concat(parts.concat(nals));
}

// 33 bits of a 90 kHz time as a PES header's PTS (prefix 0010: PTS only)
function tsPts(time)
{
  const t = time % 2 ** 33;
  return Buffer.from([0x21 | ((Math.floor(t / 2 ** 30) & 7) << 1), Math.floor(t / 2 ** 22) & 0xff, ((Math.floor(t / 2 ** 15) & 0x7f) << 1) | 1, Math.floor(t / 2 ** 7) & 0xff, ((t & 0x7f) << 1) | 1]);
}

// A frame's PES in TS packets: the first with the PCR (and random access on a key frame), the last filled out with adaptation stuffing
function tsPes(frame, parameterSets, packets)
{
  const unit = tsAccessUnit(frame, parameterSets);
  // Video: no PES length (0, unbounded); PTS only, no B-frames
  const pes = Buffer.concat([Buffer.from([0, 0, 1, 0xe0, 0, 0, 0x80, 0x80, 5]), tsPts(frame.time + TS_PTS_OFFSET), unit]);
  const base = frame.time % 2 ** 33;
  const pcr = Buffer.from([Math.floor(base / 2 ** 25) & 0xff, Math.floor(base / 2 ** 17) & 0xff, Math.floor(base / 2 ** 9) & 0xff, Math.floor(base / 2) & 0xff, ((base & 1) << 7) | 0x7e, 0]);
  let offset = 0;
  for (let first = true; first || offset < pes.length; first = false)
  {
    const packet = Buffer.alloc(188, 0xff);
    // The adaptation field's bytes after its length byte: flags (PCR, random access), the PCR
    const fields = first ? Buffer.concat([Buffer.from([0x10 | (frame.key ? 0x40 : 0)]), pcr]) : null;
    let adaptation = fields ? 1 + fields.length : 0;
    const left = pes.length - offset;
    if (left < 184 - adaptation) adaptation = 184 - left;
    packet.writeUInt8(0x47, 0);
    packet.writeUInt16BE((first ? 0x4000 : 0) | TS_PID_VIDEO, 1);
    packet.writeUInt8((adaptation ? 0x30 : 0x10) | TS_CC.video, 3);
    TS_CC.video = (TS_CC.video + 1) & 0x0f;
    if (adaptation)
    {
      packet.writeUInt8(adaptation - 1, 4);
      if (adaptation > 1)
      {
        if (fields) fields.copy(packet, 5);
        else packet.writeUInt8(0, 5);
      }
    }
    offset += pes.copy(packet, 4 + adaptation, offset, offset + 184 - adaptation);
    packets.push(packet);
  }
}

// A segment's frames as MPEG-TS
function tsSegment(frames)
{
  const pat = Buffer.from([0x00, 0xb0, 0x0d, 0x00, 0x01, 0xc1, 0x00, 0x00, 0x00, 0x01, 0xe0 | (TS_PID_PMT >> 8), TS_PID_PMT & 0xff]);
  const pmt = Buffer.from([0x02, 0xb0, 0x12, 0x00, 0x01, 0xc1, 0x00, 0x00, 0xe0 | (TS_PID_VIDEO >> 8), TS_PID_VIDEO & 0xff, 0xf0, 0x00, 0x1b, 0xe0 | (TS_PID_VIDEO >> 8), TS_PID_VIDEO & 0xff, 0xf0, 0x00]);
  const packets = [tsPsi(0, TS_CC.pat, pat), tsPsi(TS_PID_PMT, TS_CC.pmt, pmt)];
  TS_CC.pat = (TS_CC.pat + 1) & 0x0f;
  TS_CC.pmt = (TS_CC.pmt + 1) & 0x0f;
  const parameterSets = tsParameterSets();
  for (const frame of frames) tsPes(frame, parameterSets, packets);
  return Buffer.concat(packets);
}

// The master playlist: the one video, so the device's player is set up for its codec and size (without CODECS the Cast player
// assumes H.264 Main 3.0)
function workerMasterPlaylist()
{
  const peak = Math.max(CAST_BANDWIDTH_MIN, ...W.segments.map((segment) => Math.ceil((segment.ts.length * 8) / segment.duration)));
  // The codec as the stream's avcC has it (profile, constraints, level: an encoder may not give what its config asked for)
  const codec = W.description ? "avc1." + [1, 2, 3].map((i) => W.description[i].toString(16).padStart(2, "0")).join("") : W.codecString;
  const info = "BANDWIDTH=" + peak + ",CODECS=\"" + codec + "\",RESOLUTION=" + W.width + "x" + W.height + ",FRAME-RATE=" + W.fps.toFixed(3);
  return ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-INDEPENDENT-SEGMENTS", "#EXT-X-STREAM-INF:" + info, "video.m3u8"].join("\n") + "\n";
}

// The live playlist: the last CAST_SEGMENTS_LISTED segments (none until the first is done). The player asked to start all but one
// segment back from the end (EXT-X-START), not at the newest: else it plays right at the edge, and waits for each new segment
function workerPlaylist()
{
  const listed = W.segments.slice(-CAST_SEGMENTS_LISTED);
  const target = Math.max(CAST_SEGMENT_SECONDS, ...listed.map((segment) => Math.round(segment.duration)));
  const back = (CAST_SEGMENTS_LISTED - 1) * CAST_SEGMENT_SECONDS;
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-TARGETDURATION:" + target, "#EXT-X-MEDIA-SEQUENCE:" + (listed.length ? listed[0].sequence : W.sequence + 1), "#EXT-X-INDEPENDENT-SEGMENTS", "#EXT-X-START:TIME-OFFSET=-" + back];
  for (const segment of listed) lines.push("#EXTINF:" + segment.duration.toFixed(3) + ",", "seg" + segment.sequence + ".ts");
  return lines.join("\n") + "\n";
}

// The video made from now on (a new one: the one before, if any, ended), its sequence numbers going on from the last
function workerStart(msg)
{
  workerEncodeStop();
  W.wanted = false;
  W.gen = msg.gen;
  const config = msg.config;
  W.width = config.width;
  W.height = config.height;
  W.fps = config.framerate;
  W.quantizer = msg.quantizer;
  W.codecString = config.codec;
  W.codec = config.codec + " " + W.width + "x" + W.height + " " + W.fps + " fps";
  W.encoder = new VideoEncoder({
    output: workerOutput,
    error: (e) =>
    {
      workerLog("encoder " + e.message);
      self.postMessage({ type: "error", text: "encoder " + e.message, serving: false });
    }
  });
  W.encoder.configure(config);
  workerTick();
}

// Serving the video on port (Settings -> Features -> Casting -> Port), to any computer or device on the network
function workerListen(msg)
{
  const server = http.createServer(workerRequest);
  server.on("error", (e) =>
  {
    if (W.server == server) self.postMessage({ type: "error", text: "server " + e.message, code: e.code, serving: true });
  });
  server.listen(msg.port, () =>
  {
    if (W.server == server) self.postMessage({ type: "listening", port: server.address().port });
  });
  W.server = server;
  W.idleTimer = nodeTimers.setInterval(workerIdleCheck, CAST_IDLE_CHECK_MS);
}

const CAST_HEADERS = { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" };

function workerRequest(request, response)
{
  const path = request.url.split("?")[0];
  const address = String(request.socket.remoteAddress || "").replace(/^::ffff:/, "");
  W.clients[address] = W.seen[address] = Date.now();
  workerViewers();
  workerLog(request.method + " " + path + " from " + address);
  if (request.method == "OPTIONS")
  {
    response.writeHead(204, { ...CAST_HEADERS, "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS", "Access-Control-Allow-Headers": "*" });
    response.end();
    return;
  }
  if (!workerReady())
  {
    const held = { path: path, request: request, response: response, time: Date.now() };
    W.held.push(held);
    response.on("close", () => (W.held = W.held.filter((other) => other != held)));
    if (!W.encoder && !W.wanted)
    {
      W.wanted = true;
      self.postMessage({ type: "wanted" });
    }
    return;
  }
  workerAnswer(request, response, path);
}

// Enough video to start from
function workerReady()
{
  return !!W.encoder && !!W.description && W.segments.length >= CAST_SEGMENTS_READY;
}

function workerAnswer(request, response, path)
{
  const headers = CAST_HEADERS;
  if (path == "/map.ts")
  {
    workerStream(request, response);
    return;
  }
  let body = null;
  let type = "video/mp2t";
  if (path == "/map.m3u8") body = Buffer.from(workerMasterPlaylist(), "utf8");
  else if (path == "/video.m3u8") body = Buffer.from(workerPlaylist(), "utf8");
  else
  {
    const match = path.match(/^\/seg(\d+)\.ts$/);
    const segment = match && W.segments.find((kept) => kept.sequence == Number(match[1]));
    if (segment) body = segment.ts;
  }
  if (path.endsWith(".m3u8")) type = "application/vnd.apple.mpegurl";
  if (!body)
  {
    response.writeHead(404, headers);
    response.end();
    return;
  }
  response.writeHead(200, { ...headers, "Content-Type": type, "Content-Length": body.length });
  if (request.method == "HEAD") response.end();
  else
  {
    response.end(body);
    W.sent += body.length;
  }
}

// map.ts: the last CAST_STREAM_BURST segments now, then each as it's done (workerSegment), until the player closes it or the video stops
function workerStream(request, response)
{
  response.writeHead(200, { ...CAST_HEADERS, ...CAST_STREAM_HEADERS });
  if (request.method == "HEAD")
  {
    response.end();
    return;
  }
  const stream = { response: response, address: String(request.socket.remoteAddress || "").replace(/^::ffff:/, "") };
  W.streams.push(stream);
  response.on("close", () => (W.streams = W.streams.filter((other) => other != stream)));
  for (const segment of W.segments.slice(-CAST_STREAM_BURST)) workerStreamWrite(stream, segment);
}

// A segment to one playing map.ts (it counts as watching while it's sent to); one too far behind is cut off
function workerStreamWrite(stream, segment)
{
  if (stream.response.writableLength > CAST_STREAM_BACKLOG)
  {
    workerLog("map.ts to " + stream.address + " cut off: not keeping up");
    stream.response.destroy();
    return;
  }
  stream.response.write(segment.ts);
  W.sent += segment.ts.length;
  W.clients[stream.address] = W.seen[stream.address] = Date.now();
}

// Every map.ts ended (the video stopped: the next starts from 0, a new stream)
function workerStreamsEnd()
{
  const streams = W.streams;
  W.streams = [];
  for (const stream of streams) stream.response.end();
}

function workerOutput(chunk, metadata)
{
  W.encodeMs = Math.round(performance.now() - W.encodeStart);
  const description = metadata?.decoderConfig?.description;
  if (description) W.description = Buffer.from(ArrayBuffer.isView(description) ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength) : new Uint8Array(description)).subarray(0);
  if (!W.description) return;
  const data = Buffer.alloc(chunk.byteLength);
  chunk.copyTo(data);
  const key = chunk.type == "key";
  W.outputs++;
  if (key)
  {
    W.keys++;
    W.keyBytes += data.length;
  }
  else W.deltaBytes += data.length;
  const time = Math.round((chunk.timestamp * CAST_TIMESCALE) / 1000000);
  // A key frame ends the segment before it and starts the next
  if (key && W.pending.length) workerSegment(time);
  if (key || W.pending.length) W.pending.push({ time: time, key: key, data: data });
}

// The segment being filled done (end: the next one's start), the oldest let go
function workerSegment(end)
{
  const frames = W.pending;
  W.pending = [];
  const sequence = ++W.sequence;
  const segment = { sequence: sequence, duration: (end - frames[0].time) / CAST_TIMESCALE, ts: tsSegment(frames) };
  W.segments.push(segment);
  while (W.segments.length > CAST_SEGMENTS_KEPT) W.segments.shift();
  // (those already playing map.ts first: one held until now is sent this one with its first)
  for (const stream of W.streams.slice()) workerStreamWrite(stream, segment);
  if (workerReady())
  {
    const held = W.held;
    W.held = [];
    for (const waiting of held) workerAnswer(waiting.request, waiting.response, waiting.path);
  }
  self.postMessage({ type: "segments", count: Math.min(W.segments.length, CAST_SEGMENTS_LISTED), gen: W.gen });
  self.postMessage({ type: "stats", frames: W.frames, outputs: W.outputs, keys: W.keys, keyBytes: W.keyBytes, deltaBytes: W.deltaBytes, grabs: W.grabs, repeats: W.repeats, sent: W.sent, encodeMs: W.encodeMs, segments: W.segments.length, sequence: W.sequence });
}

// The video's frame for slot (a key frame each CAST_SEGMENT_SECONDS)
function workerEncode(frame, slot)
{
  if (!W.encoder || W.encoder.state != "configured" || W.encoder.encodeQueueSize > CAST_ENCODE_QUEUE) return;
  const key = slot >= W.nextKeySlot;
  if (key) W.nextKeySlot = slot + CAST_SEGMENT_SECONDS * W.fps;
  W.encodeStart = performance.now();
  W.encoder.encode(frame, W.quantizer ? { keyFrame: key, avc: { quantizer: W.quantizer } } : { keyFrame: key });
  W.frames++;
}

// The next slot's frame, once it has begun: the latest picture, timed at the slot's start; then a look again when the slot after begins
// (until a picture comes, a frame's time later)
function workerTick()
{
  const now = performance.now();
  if (W.last)
  {
    if (!W.start) W.start = now;
    const slot = Math.floor(((now - W.start) * W.fps) / 1000);
    if (slot > W.slot)
    {
      W.slot = slot;
      const frame = new VideoFrame(W.last, { timestamp: Math.round((slot * 1000000) / W.fps), duration: Math.round(1000000 / W.fps) });
      workerEncode(frame, slot);
      frame.close();
      if (!W.fresh) W.repeats++;
      W.fresh = false;
    }
  }
  const next = W.start ? W.start + ((W.slot + 1) * 1000) / W.fps : now + 1000 / W.fps;
  W.tick = nodeTimers.setTimeout(workerTick, Math.max(1, next - performance.now() + 1));
}

// The capture's frames as they come (a track handed over, or its frames' stream), until it ends (said, so it's started again) or
// another replaces it
async function workerRead(readable, track)
{
  workerUntrack();
  const reader = readable.getReader();
  W.reader = reader;
  W.track = track;
  try
  {
    for (;;)
    {
      const { value, done } = await reader.read();
      if (done) break;
      if (W.reader != reader)
      {
        value.close();
        break;
      }
      workerFrame(value);
    }
  }
  catch (e)
  {
    if (W.reader == reader) workerLog("capture " + e.message);
  }
  if (W.reader == reader)
  {
    workerUntrack();
    self.postMessage({ type: "captureEnded" });
  }
}

function workerUntrack()
{
  if (W.reader) W.reader.cancel().catch(() => {});
  W.reader = null;
  if (W.track) W.track.stop();
  W.track = null;
}

// A captured frame: the picture the next slot shows (fitted into the video's size, black round it, when it isn't that size)
function workerFrame(captured)
{
  W.grabs++;
  let picture = captured;
  if (captured.displayWidth != W.width || captured.displayHeight != W.height)
  {
    if (!W.canvas) W.canvas = new OffscreenCanvas(W.width, W.height);
    const context = W.canvas.getContext("2d", { alpha: false });
    const scale = Math.min(W.width / captured.displayWidth, W.height / captured.displayHeight);
    const width = Math.round(captured.displayWidth * scale);
    const height = Math.round(captured.displayHeight * scale);
    context.fillStyle = "#000";
    context.fillRect(0, 0, W.width, W.height);
    context.drawImage(captured, Math.floor((W.width - width) / 2), Math.floor((W.height - height) / 2), width, height);
    picture = new VideoFrame(W.canvas, { timestamp: captured.timestamp });
    captured.close();
  }
  if (W.last) W.last.close();
  W.last = picture;
  W.fresh = true;
}

// The video no longer made (the server goes on: a request asks for it again)
function workerEncodeStop()
{
  nodeTimers.clearTimeout(W.tick);
  W.tick = null;
  workerStreamsEnd();
  workerUntrack();
  if (W.encoder && W.encoder.state != "closed") W.encoder.close();
  W.encoder = null;
  if (W.last) W.last.close();
  W.last = null;
  W.canvas = null;
  W.description = null;
  W.pending = [];
  W.segments = [];
  W.nextKeySlot = 0;
  W.start = 0;
  W.slot = -1;
  W.fresh = false;
}

// Requests waited on too long answered (503), and nobody watching said (each look while so: the video may be wanted for a cast)
function workerIdleCheck()
{
  const now = Date.now();
  for (const waiting of W.held.filter((held) => now - held.time > CAST_HOLD_MS))
  {
    waiting.response.writeHead(503, CAST_HEADERS);
    waiting.response.end();
  }
  W.held = W.held.filter((held) => now - held.time <= CAST_HOLD_MS);
  for (const address of Object.keys(W.clients)) if (now - W.clients[address] > CAST_IDLE_MS) delete W.clients[address];
  workerViewers();
  // (asked for and not started: asked again by the next request)
  if (!W.encoder && !W.held.length) W.wanted = false;
  if (W.encoder && !W.held.length && !Object.keys(W.clients).length) self.postMessage({ type: "idle" });
}

// The addresses watching now (asked for anything within CAST_WATCHING_MS), said when they change: { type: "viewers", addresses }
function workerViewers()
{
  const now = Date.now();
  for (const address of Object.keys(W.seen)) if (now - W.seen[address] > CAST_WATCHING_MS) delete W.seen[address];
  const list = Object.keys(W.seen).sort();
  const key = list.join(",");
  if (key == W.viewers) return;
  W.viewers = key;
  self.postMessage({ type: "viewers", addresses: list });
}

function workerStop()
{
  nodeTimers.clearInterval(W.idleTimer);
  workerEncodeStop();
  if (W.server)
  {
    W.server.close();
    W.server.closeAllConnections();
  }
  W.server = null;
  self.close();
}

self.onmessage = (event) =>
{
  const msg = event.data;
  try
  {
    if (msg.type == "listen") workerListen(msg);
    else if (msg.type == "start") workerStart(msg);
    else if (msg.type == "encodeStop") workerEncodeStop();
    else if (msg.type == "track") workerRead(new MediaStreamTrackProcessor({ track: msg.track }).readable, msg.track);
    else if (msg.type == "frames") workerRead(msg.readable, null);
    else if (msg.type == "untrack") workerUntrack();
    // The device cast to counted as watching until CAST_IDLE_MS from now (a cast again soon has the video ready)
    else if (msg.type == "castEnded") W.clients[msg.address] = Date.now();
    else if (msg.type == "stop") workerStop();
  }
  catch (e)
  {
    workerLog(msg.type + " " + e.message);
    if (msg.type == "start" || msg.type == "listen") self.postMessage({ type: "error", text: e.message, serving: msg.type == "listen" });
  }
};
