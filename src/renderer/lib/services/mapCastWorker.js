// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// Map Cast's video (mapCast.js), off the main window's thread: the main window's capture of its map (Element Capture, at the video's
// size) encoded as H.264 by a hardware encoder (WebCodecs; the config comes from mapCast.js, which casts only where there is one), all
// the time while Enable Casting is on, and kept as HLS: CAST_SEGMENT_SECONDS segments (fragmented MP4), each from a key frame, the last
// CAST_SEGMENTS_LISTED of them listed. While casting a small HTTP server (Node's http: the main window has nodeIntegrationInWorker) serves
// them to the device: map.m3u8 (the master playlist: the video's codec, size, frame rate and bandwidth, which a media playlist can't
// tell), video.m3u8 (the live playlist), init.mp4 (ftyp, moov) and seg<n>.m4s; the device starts near the oldest listed, so it has
// most of what is kept at once.
//   The MP4: one video track, no samples in the moov (mvex/trex: all in fragments), then a segment is one fragment: moof (mfhd, traf:
//   tfhd, tfdt with its first frame's time, trun with all its frames) and mdat. Times in 90 kHz; each frame lasts until the next.
// The video's frames are a fixed rate's: one in each 1/fps of a second (its time that slot's start), the capture's latest picture. The
// capture sends one only when the picture changes (and none while the window is minimized), so mostly it is the same picture again,
// which costs next to nothing. A picture not at the video's size (the window not 16:9 before casting snaps it) is fitted into it.
// In:  { type: "start", config, quantizer } (the VideoEncoder's config: its size and frame rate the video's; each frame's QP),
//      { type: "serve", address }, { type: "unserve" }, { type: "track", track } or { type: "frames", readable } (the capture, replacing
//      any before), { type: "untrack" }, { type: "stop" }
// Out: { type: "listening", port, codec }, { type: "segments", count } (those listed), { type: "error", text, serving },
//      { type: "stats", frames, outputs, keys, keyBytes, deltaBytes, grabs, repeats, sent, encodeMs, segments, sequence },
//      { type: "log", text }

const http = require("http");
const { Buffer } = require("buffer");

// A segment's length (a key frame starts each)
const CAST_SEGMENT_SECONDS = 2;
// The segments listed (the video a device starts with), and those kept: one that leaves the list is kept for its own length and the
// list's (RFC 8216: a device may still be fetching it)
const CAST_SEGMENTS_LISTED = 6;
const CAST_SEGMENTS_KEPT = CAST_SEGMENTS_LISTED * 2 + 1;
// The master playlist's BANDWIDTH (bits a second) at the least: the most any kept segment needed, when more
const CAST_BANDWIDTH_MIN = 1000000;
// Frames waiting to be encoded past this are skipped
const CAST_ENCODE_QUEUE = 2;
const MP4_TIMESCALE = 90000;
const MP4_MATRIX = mp4U32(0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000);
// A key frame's sample flags (depends on nothing) and the others' (depends on others, not a sync sample)
const MP4_FLAGS_KEY = 0x02000000;
const MP4_FLAGS_DELTA = 0x01010000;

const W = {
  server: null,
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
  // Those done: [{ sequence, duration (seconds), data }], oldest first
  segments: [],
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

function mp4U32(...values)
{
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, i) => bytes.writeUInt32BE(value >>> 0, i * 4));
  return bytes;
}

function mp4U16(...values)
{
  const bytes = Buffer.alloc(values.length * 2);
  values.forEach((value, i) => bytes.writeUInt16BE(value & 0xffff, i * 2));
  return bytes;
}

function mp4Box(type, ...parts)
{
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length, 0);
  head.write(type, 4, "ascii");
  return Buffer.concat([head, body]);
}

function mp4FullBox(type, version, flags, ...parts)
{
  return mp4Box(type, mp4U32(((version << 24) | flags) >>> 0), ...parts);
}

// ftyp and moov: the track (its avcC the encoder's description), no samples of its own
function mp4Init()
{
  const ftyp = mp4Box("ftyp", Buffer.from("isom", "ascii"), mp4U32(0x200), Buffer.from("isomiso6avc1mp41", "ascii"));
  const mvhd = mp4FullBox("mvhd", 0, 0, mp4U32(0, 0, MP4_TIMESCALE, 0, 0x00010000), mp4U16(0x0100), Buffer.alloc(10), MP4_MATRIX, Buffer.alloc(24), mp4U32(2));
  const tkhd = mp4FullBox("tkhd", 0, 3, mp4U32(0, 0, 1, 0, 0), Buffer.alloc(8), mp4U16(0, 0, 0, 0), MP4_MATRIX, mp4U32(W.width * 65536, W.height * 65536));
  // Language "und"
  const mdhd = mp4FullBox("mdhd", 0, 0, mp4U32(0, 0, MP4_TIMESCALE, 0), mp4U16(0x55c4, 0));
  const hdlr = mp4FullBox("hdlr", 0, 0, mp4U32(0), Buffer.from("vide", "ascii"), Buffer.alloc(12), Buffer.from("VideoHandler\0", "ascii"));
  const vmhd = mp4FullBox("vmhd", 0, 1, Buffer.alloc(8));
  const dinf = mp4Box("dinf", mp4FullBox("dref", 0, 0, mp4U32(1), mp4FullBox("url ", 0, 1)));
  // The sample entry: its size, 72 dpi, a frame per sample, 24-bit color
  const avc1 = mp4Box("avc1", Buffer.alloc(6), mp4U16(1), Buffer.alloc(16), mp4U16(W.width, W.height), mp4U32(0x00480000, 0x00480000, 0), mp4U16(1), Buffer.alloc(32), mp4U16(0x0018, 0xffff), mp4Box("avcC", W.description));
  const stbl = mp4Box("stbl", mp4FullBox("stsd", 0, 0, mp4U32(1), avc1), mp4FullBox("stts", 0, 0, mp4U32(0)), mp4FullBox("stsc", 0, 0, mp4U32(0)), mp4FullBox("stsz", 0, 0, mp4U32(0, 0)), mp4FullBox("stco", 0, 0, mp4U32(0)));
  const trak = mp4Box("trak", tkhd, mp4Box("mdia", mdhd, hdlr, mp4Box("minf", vmhd, dinf, stbl)));
  const mvex = mp4Box("mvex", mp4FullBox("trex", 0, 0, mp4U32(1, 1, 0, 0, 0)));
  return Buffer.concat([ftyp, mp4Box("moov", mvhd, trak, mvex)]);
}

// A segment: one moof for its frames (each lasting until the next, the last until end), then their mdat
function mp4Segment(sequence, frames, end)
{
  // Offsets from the moof's start (default-base-is-moof)
  const tfhd = mp4FullBox("tfhd", 0, 0x020000, mp4U32(1));
  const first = frames[0].time;
  const tfdt = mp4FullBox("tfdt", 1, 0, mp4U32(Math.floor(first / 2 ** 32), first % 2 ** 32));
  // Each sample: its duration, size and flags; after the count, the data offset (filled in below)
  const samples = frames.map((frame, i) => mp4U32((i + 1 < frames.length ? frames[i + 1].time : end) - frame.time, frame.data.length, frame.key ? MP4_FLAGS_KEY : MP4_FLAGS_DELTA));
  const trun = mp4FullBox("trun", 0, 0x000701, mp4U32(frames.length, 0), ...samples);
  const moof = mp4Box("moof", mp4FullBox("mfhd", 0, 0, mp4U32(sequence)), mp4Box("traf", tfhd, tfdt, trun));
  moof.writeUInt32BE(moof.length + 8, moof.length - trun.length + 16);
  const data = frames.map((frame) => frame.data);
  const size = data.reduce((total, bytes) => total + bytes.length, 0);
  const mdat = Buffer.alloc(8);
  mdat.writeUInt32BE(8 + size, 0);
  mdat.write("mdat", 4, "ascii");
  return Buffer.concat([moof, mdat, ...data]);
}

// The master playlist: the one video, so the device's player is set up for its codec and size (without CODECS the Cast player
// assumes H.264 Main 3.0)
function workerMasterPlaylist()
{
  const peak = Math.max(CAST_BANDWIDTH_MIN, ...W.segments.map((segment) => Math.ceil((segment.data.length * 8) / segment.duration)));
  const info = "BANDWIDTH=" + peak + ",CODECS=\"" + W.codecString + "\",RESOLUTION=" + W.width + "x" + W.height + ",FRAME-RATE=" + W.fps.toFixed(3);
  return ["#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-INDEPENDENT-SEGMENTS", "#EXT-X-STREAM-INF:" + info, "video.m3u8"].join("\n") + "\n";
}

// The live playlist: the last CAST_SEGMENTS_LISTED segments (none until the first is done). The player asked to start all but one
// segment back from the end (EXT-X-START), not at the newest: else it plays right at the edge, and waits for each new segment
function workerPlaylist()
{
  const listed = W.segments.slice(-CAST_SEGMENTS_LISTED);
  const target = Math.max(CAST_SEGMENT_SECONDS, ...listed.map((segment) => Math.round(segment.duration)));
  const back = (CAST_SEGMENTS_LISTED - 1) * CAST_SEGMENT_SECONDS;
  const lines = ["#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-TARGETDURATION:" + target, "#EXT-X-MEDIA-SEQUENCE:" + (listed.length ? listed[0].sequence : W.sequence + 1), "#EXT-X-INDEPENDENT-SEGMENTS", "#EXT-X-START:TIME-OFFSET=-" + back, "#EXT-X-MAP:URI=\"init.mp4\""];
  for (const segment of listed) lines.push("#EXTINF:" + segment.duration.toFixed(3) + ",", "seg" + segment.sequence + ".m4s");
  return lines.join("\n") + "\n";
}

function workerStart(msg)
{
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
  // A few looks a frame, so a slot is seldom missed (a late timer)
  W.tick = setInterval(workerTick, 1000 / W.fps / 3);
}

// Serving the video on address (the one the device is reached from), on a port of its own
function workerServe(msg)
{
  workerUnserve();
  const server = http.createServer(workerRequest);
  server.on("error", (e) => self.postMessage({ type: "error", text: "server " + e.message, serving: true }));
  server.listen(0, msg.address, () => self.postMessage({ type: "listening", port: server.address().port, codec: W.codec }));
  W.server = server;
}

function workerUnserve()
{
  if (!W.server) return;
  W.server.close();
  W.server.closeAllConnections();
  W.server = null;
}

function workerRequest(request, response)
{
  const path = request.url.split("?")[0];
  workerLog(request.method + " " + path + " from " + request.socket.remoteAddress);
  const headers = { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" };
  if (request.method == "OPTIONS")
  {
    response.writeHead(204, { ...headers, "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS", "Access-Control-Allow-Headers": "*" });
    response.end();
    return;
  }
  let body = null;
  let type = "video/mp4";
  if (path == "/map.m3u8" || path == "/video.m3u8")
  {
    body = Buffer.from(path == "/map.m3u8" ? workerMasterPlaylist() : workerPlaylist(), "utf8");
    type = "application/vnd.apple.mpegurl";
  }
  else if (path == "/init.mp4" && W.description) body = mp4Init();
  else
  {
    const match = path.match(/^\/seg(\d+)\.m4s$/);
    const segment = match && W.segments.find((kept) => kept.sequence == Number(match[1]));
    if (segment) body = segment.data;
  }
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
  const time = Math.round((chunk.timestamp * MP4_TIMESCALE) / 1000000);
  // A key frame ends the segment before it and starts the next
  if (key && W.pending.length) workerSegment(time);
  if (key || W.pending.length) W.pending.push({ time: time, key: key, data: data });
  self.postMessage({ type: "stats", frames: W.frames, outputs: W.outputs, keys: W.keys, keyBytes: W.keyBytes, deltaBytes: W.deltaBytes, grabs: W.grabs, repeats: W.repeats, sent: W.sent, encodeMs: W.encodeMs, segments: W.segments.length, sequence: W.sequence });
}

// The segment being filled done (end: the next one's start), the oldest let go
function workerSegment(end)
{
  const frames = W.pending;
  W.pending = [];
  const sequence = ++W.sequence;
  W.segments.push({ sequence: sequence, duration: (end - frames[0].time) / MP4_TIMESCALE, data: mp4Segment(sequence, frames, end) });
  while (W.segments.length > CAST_SEGMENTS_KEPT) W.segments.shift();
  self.postMessage({ type: "segments", count: Math.min(W.segments.length, CAST_SEGMENTS_LISTED) });
}

// The video's frame for slot (a key frame each CAST_SEGMENT_SECONDS)
function workerEncode(frame, slot)
{
  if (!W.encoder || W.encoder.state != "configured" || W.encoder.encodeQueueSize > CAST_ENCODE_QUEUE) return;
  const key = slot >= W.nextKeySlot;
  if (key) W.nextKeySlot = slot + CAST_SEGMENT_SECONDS * W.fps;
  W.encodeStart = performance.now();
  W.encoder.encode(frame, { keyFrame: key, avc: { quantizer: W.quantizer } });
  W.frames++;
}

// The next slot's frame, once it has begun: the latest picture, timed at the slot's start
function workerTick()
{
  if (!W.last) return;
  const now = performance.now();
  if (!W.start) W.start = now;
  const slot = Math.floor(((now - W.start) * W.fps) / 1000);
  if (slot <= W.slot) return;
  W.slot = slot;
  const frame = new VideoFrame(W.last, { timestamp: Math.round((slot * 1000000) / W.fps), duration: Math.round(1000000 / W.fps) });
  workerEncode(frame, slot);
  frame.close();
  if (!W.fresh) W.repeats++;
  W.fresh = false;
}

// The capture's frames as they come (a track handed over, or its frames' stream), until it ends or another replaces it
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

function workerStop()
{
  clearInterval(W.tick);
  workerUntrack();
  workerUnserve();
  if (W.encoder && W.encoder.state != "closed") W.encoder.close();
  if (W.last) W.last.close();
  self.close();
}

self.onmessage = (event) =>
{
  const msg = event.data;
  try
  {
    if (msg.type == "start") workerStart(msg);
    else if (msg.type == "serve") workerServe(msg);
    else if (msg.type == "unserve") workerUnserve();
    else if (msg.type == "track") workerRead(new MediaStreamTrackProcessor({ track: msg.track }).readable, msg.track);
    else if (msg.type == "frames") workerRead(msg.readable, null);
    else if (msg.type == "untrack") workerUntrack();
    else if (msg.type == "stop") workerStop();
  }
  catch (e)
  {
    workerLog(msg.type + " " + e.message);
    if (msg.type == "start" || msg.type == "serve") self.postMessage({ type: "error", text: e.message, serving: msg.type == "serve" });
  }
};
