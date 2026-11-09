// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// Map Cast's video (mapCast.js), off the main window's thread: each frame of the main window's capture of its map (Element Capture, at
// the video's size) encoded as H.264 by a hardware encoder (WebCodecs; the config comes from mapCast.js, which casts only where there is one), muxed
// into an endless fragmented MP4 and sent by a small HTTP server (Node's http: the main window has nodeIntegrationInWorker) to whoever
// asks. Each request gets the stream's header (ftyp, moov), then the video from the next key frame on, its time starting there; a
// request asks for a key frame, and one comes every CAST_KEY_SECONDS anyway.
//   The MP4: one video track, no samples in the moov (mvex/trex: all in fragments), then a fragment per frame: moof (mfhd, traf: tfhd,
//   tfdt with the frame's time, trun with its one sample) and mdat. Times in 90 kHz; each frame's duration the nominal one.
// Each frame is encoded as it comes; the capture sends one only when the picture changes (and none while the window is minimized), so
// at each tick of the frame rate when none came since the tick before the last is sent again: the video keeps its frame rate (a player
// buffers through a gap; the same picture again costs next to nothing).
// In:  { type: "start", address, config, quantizer } (the VideoEncoder's config: its size and frame rate the video's; each frame's QP), { type: "track", track } or
//      { type: "frames", readable } (the capture, replacing any before), { type: "untrack" }, { type: "stop" }
// Out: { type: "listening", port, codec }, { type: "error", text }, { type: "clients", count },
//      { type: "stats", frames, outputs, keys, keyBytes, deltaBytes, grabs, repeats, sent, encodeMs }, { type: "log", text }

const http = require("http");
const { Buffer } = require("buffer");

const CAST_KEY_SECONDS = 10;
// A viewer this far behind is dropped (it can ask again)
const CAST_CLIENT_BACKLOG = 8 * 1024 * 1024;
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
  codec: "",
  fps: 30,
  quantizer: 20,
  width: 0,
  height: 0,
  description: null,
  clients: new Set(),
  forceKey: true,
  sinceKey: 0,
  last: null,
  tick: null,
  reader: null,
  track: null,
  // A captured frame came since the last tick
  fresh: false,
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

// A frame's moof and the head of its mdat (the frame's bytes follow it)
function mp4Fragment(sequence, time, key, size)
{
  // Offsets from the moof's start (default-base-is-moof)
  const tfhd = mp4FullBox("tfhd", 0, 0x020000, mp4U32(1));
  const tfdt = mp4FullBox("tfdt", 1, 0, mp4U32(Math.floor(time / 2 ** 32), time % 2 ** 32));
  // One sample: the data offset (filled in below), its duration, size and flags
  const trun = mp4FullBox("trun", 0, 0x000701, mp4U32(1, 0, Math.round(MP4_TIMESCALE / W.fps), size, key ? MP4_FLAGS_KEY : MP4_FLAGS_DELTA));
  const moof = mp4Box("moof", mp4FullBox("mfhd", 0, 0, mp4U32(sequence)), mp4Box("traf", tfhd, tfdt, trun));
  moof.writeUInt32BE(moof.length + 8, moof.length - trun.length + 16);
  const mdat = Buffer.alloc(8);
  mdat.writeUInt32BE(8 + size, 0);
  mdat.write("mdat", 4, "ascii");
  return Buffer.concat([moof, mdat]);
}

function workerStart(msg)
{
  const config = msg.config;
  W.width = config.width;
  W.height = config.height;
  W.fps = config.framerate;
  W.quantizer = msg.quantizer;
  W.codec = config.codec + " " + W.width + "x" + W.height + " " + W.fps + " fps";
  W.encoder = new VideoEncoder({
    output: workerOutput,
    error: (e) =>
    {
      workerLog("encoder " + e.message);
      self.postMessage({ type: "error", text: "encoder " + e.message });
    }
  });
  W.encoder.configure(config);
  const server = http.createServer(workerRequest);
  server.on("error", (e) => self.postMessage({ type: "error", text: "server " + e.message }));
  server.listen(0, msg.address, () => self.postMessage({ type: "listening", port: server.address().port, codec: W.codec }));
  W.server = server;
  W.tick = setInterval(workerTick, 1000 / W.fps);
}

// The stream, whatever the path; it starts at the next key frame
function workerRequest(request, response)
{
  const range = request.headers.range ? " (" + request.headers.range + ")" : "";
  workerLog(request.method + " " + request.url + range + " from " + request.socket.remoteAddress);
  response.writeHead(200, { "Content-Type": "video/mp4", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
  if (request.method == "HEAD")
  {
    response.end();
    return;
  }
  const client = { response: response, started: false, base: 0, sequence: 0 };
  W.clients.add(client);
  W.forceKey = true;
  self.postMessage({ type: "clients", count: W.clients.size });
  response.on("close", () =>
  {
    W.clients.delete(client);
    workerLog("stream closed");
    self.postMessage({ type: "clients", count: W.clients.size });
  });
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
  for (const client of W.clients)
  {
    const response = client.response;
    if (response.destroyed || response.writableEnded) continue;
    if (!client.started)
    {
      if (!key) continue;
      client.started = true;
      client.base = time;
      response.write(mp4Init());
    }
    const head = mp4Fragment(++client.sequence, time - client.base, key, data.length);
    response.write(head);
    response.write(data);
    W.sent += head.length + data.length;
    if (response.writableLength > CAST_CLIENT_BACKLOG)
    {
      workerLog("viewer too far behind: dropped");
      response.destroy();
    }
  }
  self.postMessage({ type: "stats", frames: W.frames, outputs: W.outputs, keys: W.keys, keyBytes: W.keyBytes, deltaBytes: W.deltaBytes, grabs: W.grabs, repeats: W.repeats, sent: W.sent, encodeMs: W.encodeMs });
}

// The video's next frame, while anyone watches (key frames as they're due)
function workerEncode(frame)
{
  if (!W.clients.size || !W.encoder || W.encoder.state != "configured" || W.encoder.encodeQueueSize > CAST_ENCODE_QUEUE) return;
  const key = W.forceKey || W.sinceKey >= CAST_KEY_SECONDS * W.fps - 1;
  W.forceKey = false;
  W.sinceKey = key ? 0 : W.sinceKey + 1;
  W.encodeStart = performance.now();
  W.encoder.encode(frame, { keyFrame: key, avc: { quantizer: W.quantizer } });
  W.frames++;
}

// No grab since the last tick: the last one again
function workerTick()
{
  if (W.fresh)
  {
    W.fresh = false;
    return;
  }
  if (!W.last) return;
  const frame = new VideoFrame(W.last, { timestamp: Math.round(performance.now() * 1000) });
  workerEncode(frame);
  frame.close();
  W.repeats++;
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

// A captured frame, given the time it came (the repeats' clock)
function workerFrame(captured)
{
  W.grabs++;
  const frame = new VideoFrame(captured, { timestamp: Math.round(performance.now() * 1000) });
  captured.close();
  if (W.last) W.last.close();
  W.last = frame;
  W.fresh = true;
  workerEncode(frame);
}

function workerStop()
{
  clearInterval(W.tick);
  workerUntrack();
  for (const client of W.clients) client.response.end();
  W.clients.clear();
  if (W.server)
  {
    W.server.close();
    W.server.closeAllConnections();
  }
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
    else if (msg.type == "track") workerRead(new MediaStreamTrackProcessor({ track: msg.track }).readable, msg.track);
    else if (msg.type == "frames") workerRead(msg.readable, null);
    else if (msg.type == "untrack") workerUntrack();
    else if (msg.type == "stop") workerStop();
  }
  catch (e)
  {
    workerLog(msg.type + " " + e.message);
    if (msg.type == "start") self.postMessage({ type: "error", text: e.message });
  }
};
