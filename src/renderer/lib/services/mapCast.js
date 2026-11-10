// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// Map Cast (Settings -> General -> Display -> Enable Casting, and the button panel's Cast button: at the end): the map as the main window
// shows it, sent to a Google Cast device (the Google TV Streamer) as a live video.
//   The frames: while the video is wanted (a cast, or someone on the network watching it), the main window captures itself, cut to #main
//   (the map and what's over it) by Element Capture, at up to 30 frames a second, scaled on the GPU to the video's size; the window is
//   snapped to 16:9 while casting (the main process: 'mapCastSnap'). The capture goes to mapCastWorker.js, which encodes it (H.264: on a
//   hardware encoder, else in software at CAST_SOFTWARE_FPS, said in the Event Viewer) and keeps the last 12 seconds as HLS (a live
//   playlist of 2 second fragmented MP4 segments). While Enable Casting is on it serves them on the Port, to the device cast to and to
//   anyone on the network (VLC, a browser), and asks for the video when someone does. Nothing here per frame.
//   The device: Google's Default Media Receiver (no receiver app of our own to register or host), contacted once the playlist is full
//   (CAST_SEGMENTS_FULL), and told over the Cast protocol to play it as a LIVE stream.
//   The Cast protocol (CASTV2): TLS to port 8009 (the device's certificate is its own: not checked), each message a 4-byte big-endian
//   length and a CastMessage protobuf (protocol version, source, destination, namespace, payload type, JSON payload). CONNECT to the
//   receiver, PING/PONG every few seconds, LAUNCH the app, CONNECT to its transport, then LOAD on the media namespace.
// mapCastFind() lists the Cast devices on the network (mDNS); mapCastSupported(), mapCastStart(host), mapCastStop(), mapCastStatus() (the
// console's too); mapCastServe(), mapCastUnserve()

const CAST_PORT = 8009;
const CAST_APP_DEFAULT_MEDIA = "CC1AD845";
const CAST_NS_CONNECTION = "urn:x-cast:com.google.cast.tp.connection";
const CAST_NS_HEARTBEAT = "urn:x-cast:com.google.cast.tp.heartbeat";
const CAST_NS_RECEIVER = "urn:x-cast:com.google.cast.receiver";
const CAST_NS_MEDIA = "urn:x-cast:com.google.cast.media";
const CAST_PING_MS = 5000;
// The capture failed or ended: started again this much later
const CAST_CAPTURE_RETRY_MS = 5000;
// The segments a device cast to is contacted after (the worker's CAST_SEGMENTS_LISTED: the playlist full), and how long they may take
// before the cast is given up (said in the Event Viewer)
const CAST_SEGMENTS_FULL = 6;
const CAST_PREPARE_WAIT_MS = 45000;
// A device whose app is ready but has had no video to play this long: the cast stopped, said in the Event Viewer
const CAST_LOAD_WAIT_MS = 20000;
// The video's largest size (a smaller map is sent at its own size: the device scales it)
const CAST_MAX_WIDTH = 1920;
const CAST_MAX_HEIGHT = 1080;
// H.264 High, level 4.0 (1920x1080 at up to 30 fps), on a hardware encoder
const CAST_CODEC = "avc1.640028";
const CAST_FPS = 30;
// A fixed quantizer, not a bitrate: a bitrate's encoder spends what's left of it re-sending the unchanged map, this one sends only
// what changed (next to nothing for a still map; a key frame ~250 KB, one each 2 second segment)
const CAST_QP = 20;
// Without a hardware encoder: the software one (OpenH264: no fixed quantizer, only a bitrate; nothing past H.264 level 5.2, so no 8K),
// H.264 Constrained Baseline, at the Software Resolution and Software Frame Rate (Settings -> General -> Display: map.castSoftwareHeight,
// map.castSoftwareFps). Each resolution's width (16:9) and the level that fits it at up to 30 fps; ms a frame on a desktop CPU: 480p 7,
// 720p 9, 1080p 16, 1440p 21, 2160p 50
const CAST_SOFTWARE_SIZES = {
  480: { width: 854, level: "1f" },
  720: { width: 1280, level: "1f" },
  1080: { width: 1920, level: "28" },
  1440: { width: 2560, level: "32" },
  2160: { width: 3840, level: "33" }
};
const CAST_SOFTWARE_HEIGHT = 720;
const CAST_SOFTWARE_FPS = 10;
// Its bitrate: this much a pixel each frame (720p at 10 fps: ~1.8 Mbit/s), within these
const CAST_SOFTWARE_BITS_PER_PIXEL = 0.2;
const CAST_SOFTWARE_BITRATE_MIN = 500000;
const CAST_SOFTWARE_BITRATE_MAX = 20000000;
// No Cast device found: looked for again this often (the Cast button is enabled once one is)
const CAST_DISCOVER_RETRY_MS = 30000;
// The Port changed: served on once the typing has stopped this long
const CAST_PORT_WAIT_MS = 1000;
// A message bigger than this is taken as the stream gone wrong (the protocol's own limit is 64 KiB)
const CAST_MESSAGE_MAX = 65536;
const CAST_LOG_LINES = 40;
// How long the Cast devices are listened for: by the button (done as soon as the one wanted answers), and by its menu
const CAST_FIND_MS = 2500;
const CAST_MENU_FIND_MS = 1500;

const CAST = {
  // Whether this computer can cast (mapCastSupported), null until known, and whether it has a hardware encoder for it
  supported: null,
  hardware: false,
  // A search for devices under way (its number), 0 when none; whether the last search found any (the Cast button enabled)
  finding: 0,
  devicesFound: false,
  discoverTimer: null,
  host: "",
  name: "",
  socket: null,
  input: Buffer.alloc(0),
  // The address the device reached this computer at (kept after the cast), and the one it would be expected at before a cast (the link
  // in Settings, mapCastLinkAddress)
  localAddress: "",
  linkAddress: "",
  // The worker (while Enable Casting is on) and the port it serves on (once listening)
  worker: null,
  port: 0,
  // The video being made: its codec, size and frame rate, and whether in software
  encoding: false,
  codec: "",
  width: 0,
  height: 0,
  fps: CAST_FPS,
  software: false,
  // A warning that the video is made in software given (once, for those watching without a cast)
  softwareWarned: false,
  // The video's number (each start's), so the worker's word of one stopped since isn't taken for the next
  gen: 0,
  // The segments the playlist lists; the video being made for a cast before the device is contacted; whether the device has been told
  // to play it
  segments: 0,
  preparing: false,
  prepareTimer: null,
  loaded: false,
  // Counted by each mapCastStart and mapCastStop, so a start stopped meanwhile goes no further
  starts: 0,
  grabTimer: null,
  loadTimer: null,
  portTimer: null,
  stats: null,
  requestId: 0,
  transportId: "",
  sessionId: "",
  grabbing: false,
  track: null,
  mainStyle: null,
  snapped: false,
  playerState: "",
  pingTimer: null,
  log: []
};

function mapCastLog(text)
{
  CAST.log.push(new Date().toTimeString().substring(0, 8) + " " + text);
  if (CAST.log.length > CAST_LOG_LINES) CAST.log.shift();
}

function mapCastVarint(n)
{
  const bytes = [];
  while (n > 0x7f)
  {
    bytes.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  bytes.push(n);
  return Buffer.from(bytes);
}

// A CastMessage with a JSON payload, framed
function mapCastEncode(source, destination, namespace, data)
{
  const field = (tag, text) =>
  {
    const bytes = Buffer.from(text, "utf8");
    return Buffer.concat([Buffer.from([tag]), mapCastVarint(bytes.length), bytes]);
  };
  // 1: protocol version (CASTV2_1_0), 2: source, 3: destination, 4: namespace, 5: payload type (STRING), 6: the payload
  const body = Buffer.concat([Buffer.from([0x08, 0x00]), field(0x12, source), field(0x1a, destination), field(0x22, namespace), Buffer.from([0x28, 0x00]), field(0x32, JSON.stringify(data))]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length, 0);
  return Buffer.concat([head, body]);
}

function mapCastDecode(body)
{
  const fields = {};
  let i = 0;
  const varint = () =>
  {
    let n = 0;
    let shift = 0;
    let b;
    do
    {
      b = body[i++];
      n += (b & 0x7f) * 2 ** shift;
      shift += 7;
    } while (b & 0x80);
    return n;
  };
  while (i < body.length)
  {
    const key = varint();
    const wire = key & 7;
    if (wire == 0) fields[key >>> 3] = varint();
    else if (wire == 2)
    {
      const length = varint();
      fields[key >>> 3] = body.subarray(i, i + length);
      i += length;
    }
    else break;
  }
  const text = (n) => (fields[n] instanceof Buffer ? fields[n].toString("utf8") : "");
  return { source: text(2), destination: text(3), namespace: text(4), payload: text(6) };
}

function mapCastSend(destination, namespace, data)
{
  if (CAST.socket && !CAST.socket.destroyed) CAST.socket.write(mapCastEncode("sender-0", destination, namespace, data));
}

// The video's size: #main (the map and what's over it: the whole window while casting, mapCastCapture) as casting makes it (the main
// process's 'mapCastSize': the window snapped to 16:9 where it can be, in the screen's pixels): on a hardware encoder no bigger than
// CAST_MAX_*, in software the Software Resolution's (scaled up to it too: the size picked is the one sent); null while the window isn't
// laid out
async function mapCastVideoSize(software)
{
  const main = await electron.ipcRenderer.invoke("mapCastSize").catch(() => null);
  if (!main || main.width <= 0 || main.height <= 0) return null;
  if (software)
  {
    const box = mapCastSoftwareSize();
    const fit = mapCastFit(main.width, main.height, box.width, box.height, true);
    // A window 16:9 but for its rounding (snapped to it): the resolution picked exactly (1280x720, not 1280x718)
    return fit.width == box.width && Math.abs(fit.height - box.height) <= 4 ? { width: box.width, height: box.height } : fit;
  }
  return mapCastFit(main.width, main.height, CAST_MAX_WIDTH, CAST_MAX_HEIGHT, false);
}

// The Software Resolution's size and H.264 level (720p if the one kept isn't one of them)
function mapCastSoftwareSize()
{
  const height = Object.hasOwn(CAST_SOFTWARE_SIZES, GT.settings.map.castSoftwareHeight) ? Number(GT.settings.map.castSoftwareHeight) : CAST_SOFTWARE_HEIGHT;
  return { width: CAST_SOFTWARE_SIZES[height].width, height: height, level: CAST_SOFTWARE_SIZES[height].level };
}

// The Software Frame Rate, 1 to 30
function mapCastSoftwareFps()
{
  return Math.max(1, Math.min(30, Math.round(Number(GT.settings.map.castSoftwareFps) || CAST_SOFTWARE_FPS)));
}

// Whether the video is made in software: no hardware encoder
function mapCastUseSoftware()
{
  return !CAST.hardware;
}

// width x height scaled to fit in the box (only down, unless grow), even sizes (the encoder's)
function mapCastFit(width, height, boxWidth, boxHeight, grow)
{
  const scale = grow ? Math.min(boxWidth / width, boxHeight / height) : Math.min(1, boxWidth / width, boxHeight / height);
  return { width: Math.max(2, Math.min(boxWidth, Math.floor((width * scale) / 2) * 2)), height: Math.max(2, Math.min(boxHeight, Math.floor((height * scale) / 2) * 2)) };
}

// The video worker's VideoEncoder config (mapCastWorker.js): length-prefixed NAL units ("avc"), as an MP4 carries them
function mapCastEncoderConfig(width, height, software)
{
  if (software)
  {
    const fps = mapCastSoftwareFps();
    const bitrate = Math.round(Math.max(CAST_SOFTWARE_BITRATE_MIN, Math.min(CAST_SOFTWARE_BITRATE_MAX, width * height * fps * CAST_SOFTWARE_BITS_PER_PIXEL)));
    return { codec: "avc1.42e0" + mapCastSoftwareSize().level, width: width, height: height, bitrate: bitrate, framerate: fps, latencyMode: "realtime", hardwareAcceleration: "prefer-software", avc: { format: "avc" } };
  }
  return { codec: CAST_CODEC, width: width, height: height, bitrateMode: "quantizer", framerate: CAST_FPS, latencyMode: "realtime", hardwareAcceleration: "prefer-hardware", avc: { format: "avc" } };
}

// Whether this computer can cast: Element Capture, and an encoder for the video (CAST.hardware: a hardware one)
async function mapCastSupported()
{
  if (typeof VideoEncoder == "undefined" || typeof RestrictionTarget == "undefined" || !navigator.mediaDevices?.getDisplayMedia) return false;
  const supports = async (config) => !!(await VideoEncoder.isConfigSupported(config).catch(() => null))?.supported;
  CAST.hardware = await supports(mapCastEncoderConfig(CAST_MAX_WIDTH, CAST_MAX_HEIGHT, false));
  return CAST.hardware || (await supports(mapCastEncoderConfig(CAST_SOFTWARE_SIZES[CAST_SOFTWARE_HEIGHT].width, CAST_SOFTWARE_HEIGHT, true)));
}

// Casting to host (name: what the user calls it, in the Event Viewer and the button's tooltip): the window snapped, the video made
// (or the one being made for those watching, when it's that size), and the device contacted once the playlist is full
async function mapCastStart(host, name = "")
{
  mapCastStop();
  CAST.host = String(host || "").trim();
  CAST.name = name || CAST.host;
  if (!CAST.host) return "no host";
  if (!(await mapCastSupported())) return "can't cast here: no video encoder (or no Element Capture)";
  CAST.supported = true;
  const start = ++CAST.starts;
  const snapped = await electron.ipcRenderer.invoke("mapCastSnap", true);
  // (stopped meanwhile: the window put back)
  if (start != CAST.starts)
  {
    if (snapped && !CAST.snapped && !CAST.socket) electron.ipcRenderer.invoke("mapCastSnap", false);
    return "stopped";
  }
  CAST.snapped = snapped;
  const software = mapCastUseSoftware();
  const size = await mapCastVideoSize(software);
  if (start != CAST.starts) return "stopped";
  // (served here when Enable Casting isn't on: from the console)
  mapCastServe();
  if (!size || !CAST.worker)
  {
    mapCastEvent("cast.event.failed", true);
    mapCastStop();
    return "no map";
  }
  if (CAST.encoding && (size.width != CAST.width || size.height != CAST.height || software != CAST.software || (software && mapCastSoftwareFps() != CAST.fps))) mapCastEncodeStop();
  if (!CAST.encoding) mapCastEncodeStart(size, software);
  if (CAST.software) mapCastEvent("cast.event.software", false, mapCastSoftwareText(), true);
  CAST.preparing = true;
  CAST.prepareTimer = setTimeout(() =>
  {
    CAST.prepareTimer = null;
    if (!CAST.preparing) return;
    mapCastLog("no video after " + CAST_PREPARE_WAIT_MS / 1000 + " s");
    mapCastEvent("cast.event.failed", true);
    mapCastStop();
  }, CAST_PREPARE_WAIT_MS);
  mapCastLog("preparing " + CAST.width + "x" + CAST.height + " for " + CAST.host);
  mapCastRender();
  mapCastConnectWhenReady();
  return "preparing the video for " + CAST.host;
}

// The device contacted once the playlist is full and served
function mapCastConnectWhenReady()
{
  if (!CAST.preparing || CAST.segments < CAST_SEGMENTS_FULL || !CAST.port) return;
  CAST.preparing = false;
  clearTimeout(CAST.prepareTimer);
  CAST.prepareTimer = null;
  mapCastConnect();
}

function mapCastConnect()
{
  CAST.loaded = false;
  CAST.playerState = "";
  const socket = window.require("tls").connect({ host: CAST.host, port: CAST_PORT, rejectUnauthorized: false });
  CAST.socket = socket;
  CAST.input = Buffer.alloc(0);
  let connected = false;
  socket.on("secureConnect", () =>
  {
    connected = true;
    CAST.localAddress = String(socket.localAddress || "").replace(/^::ffff:/, "");
    mapCastLog("connected from " + CAST.localAddress);
    mapCastEvent("cast.event.started", false);
    mapCastRender();
    mapCastSend("receiver-0", CAST_NS_CONNECTION, { type: "CONNECT" });
    mapCastSend("receiver-0", CAST_NS_RECEIVER, { type: "LAUNCH", appId: CAST_APP_DEFAULT_MEDIA, requestId: ++CAST.requestId });
    CAST.pingTimer = setInterval(() => mapCastSend("receiver-0", CAST_NS_HEARTBEAT, { type: "PING" }), CAST_PING_MS);
  });
  socket.on("data", (data) => mapCastReceive(data));
  socket.on("error", (e) => mapCastLog("error " + e.message));
  socket.on("close", () =>
  {
    if (CAST.socket != socket) return;
    mapCastLog("connection closed");
    mapCastEvent(connected ? "cast.event.ended" : "cast.event.unreachable", !connected);
    mapCastStop();
  });
  mapCastRender();
}

// The cast stopped; the video goes on being made while others watch it (the worker says when nobody does), and is served while Enable
// Casting is on (else not: a cast from the console)
function mapCastStop()
{
  CAST.starts++;
  if (CAST.snapped) electron.ipcRenderer.invoke("mapCastSnap", false);
  CAST.snapped = false;
  CAST.preparing = false;
  clearTimeout(CAST.prepareTimer);
  CAST.prepareTimer = null;
  clearInterval(CAST.pingTimer);
  CAST.pingTimer = null;
  clearTimeout(CAST.loadTimer);
  CAST.loadTimer = null;
  const socket = CAST.socket;
  CAST.socket = null;
  if (socket && !socket.destroyed)
  {
    if (CAST.sessionId) socket.write(mapCastEncode("sender-0", "receiver-0", CAST_NS_RECEIVER, { type: "STOP", sessionId: CAST.sessionId, requestId: ++CAST.requestId }));
    socket.end();
  }
  if (CAST.worker && CAST.host) CAST.worker.postMessage({ type: "castEnded", address: CAST.host });
  CAST.loaded = false;
  CAST.transportId = "";
  CAST.sessionId = "";
  if (!GT.settings.map.castEnable) mapCastUnserve();
  mapCastRender();
  return "stopped";
}

function mapCastStatus()
{
  return {
    host: CAST.host,
    connected: !!CAST.socket,
    preparing: CAST.preparing,
    url: CAST.port ? "http://" + (CAST.localAddress || CAST.linkAddress) + ":" + CAST.port + "/map.m3u8" : "",
    codec: CAST.codec,
    transportId: CAST.transportId,
    playerState: CAST.playerState,
    encoding: CAST.encoding,
    software: CAST.software,
    size: CAST.width + "x" + CAST.height,
    segments: CAST.segments,
    grabbing: CAST.grabbing,
    devicesFound: CAST.devicesFound,
    worker: CAST.stats,
    log: CAST.log
  };
}

// The video served on the Port (Settings -> General -> Display), made when asked for: while Enable Casting is on, and while casting
function mapCastServe()
{
  if (CAST.worker || !CAST.supported) return;
  CAST.port = 0;
  CAST.segments = 0;
  CAST.stats = null;
  mapCastWorkerStart();
  CAST.worker.postMessage({ type: "listen", port: GT.settings.map.castPort });
}

function mapCastUnserve()
{
  mapCastEncodeStop();
  // It closes itself once its server and encoder are closed (ended here if it hasn't by then)
  const worker = CAST.worker;
  CAST.worker = null;
  if (worker)
  {
    worker.postMessage({ type: "stop" });
    setTimeout(() => worker.terminate(), 2000);
  }
  CAST.port = 0;
  mapCastRender();
}

// The video made from now on, at size (mapCastVideoSize), on the hardware encoder or in software; the capture scaled to it (and fitted
// into it by the worker while the window isn't that shape)
function mapCastEncodeStart(size, software)
{
  if (!CAST.worker) return;
  CAST.software = software;
  CAST.width = size.width;
  CAST.height = size.height;
  CAST.fps = software ? mapCastSoftwareFps() : CAST_FPS;
  const config = mapCastEncoderConfig(size.width, size.height, software);
  CAST.codec = config.codec + " " + size.width + "x" + size.height + " " + CAST.fps + " fps" + (software ? " software" : "");
  CAST.segments = 0;
  CAST.stats = null;
  CAST.encoding = true;
  CAST.worker.postMessage({ type: "start", config: config, quantizer: software ? null : CAST_QP, gen: ++CAST.gen });
  mapCastGrab(true);
  mapCastLog("encoding " + CAST.codec);
}

function mapCastEncodeStop()
{
  clearTimeout(CAST.grabTimer);
  CAST.grabTimer = null;
  mapCastGrab(false);
  if (CAST.worker && CAST.encoding) CAST.worker.postMessage({ type: "encodeStop" });
  if (CAST.encoding) mapCastLog("encoding stopped");
  CAST.encoding = false;
  CAST.segments = 0;
}

// Someone on the network asked for the video (not a cast: its video is started by mapCastStart), made at the size casting would give
async function mapCastEncodeWanted()
{
  if (CAST.encoding || !CAST.worker) return;
  const software = mapCastUseSoftware();
  const size = await mapCastVideoSize(software);
  if (!size || CAST.encoding || !CAST.worker) return;
  mapCastEncodeStart(size, software);
  if (software && !CAST.softwareWarned)
  {
    CAST.softwareWarned = true;
    mapCastEvent("cast.event.software", false, mapCastSoftwareText(), true);
  }
}

// The software video's resolution and frame rate, as its Event Viewer warning says them: "720p, 10 fps"
function mapCastSoftwareText()
{
  return mapCastSoftwareSize().height + "p, " + mapCastSoftwareFps() + " fps";
}

// The capture tried again later (it failed, or ended), while the video is made
function mapCastGrabLater()
{
  clearTimeout(CAST.grabTimer);
  CAST.grabTimer = setTimeout(() =>
  {
    CAST.grabTimer = null;
    mapCastGrab(true);
  }, CAST_CAPTURE_RETRY_MS);
}

function mapCastWorkerStart()
{
  const worker = new Worker("./lib/services/mapCastWorker.js");
  CAST.worker = worker;
  worker.onmessage = (event) =>
  {
    if (CAST.worker != worker) return;
    const msg = event.data;
    if (msg.type == "listening")
    {
      CAST.port = msg.port;
      mapCastLog("serving on port " + msg.port);
      mapCastConnectWhenReady();
      mapCastLoadWhenReady();
    }
    else if (msg.type == "wanted") mapCastEncodeWanted();
    else if (msg.type == "idle")
    {
      // (a cast's video is wanted while it's prepared and played)
      if (CAST.encoding && !CAST.preparing && !CAST.socket) mapCastEncodeStop();
    }
    else if (msg.type == "segments")
    {
      // (not a video stopped since)
      if (msg.gen != CAST.gen || !CAST.encoding) return;
      CAST.segments = msg.count;
      mapCastConnectWhenReady();
      mapCastLoadWhenReady();
    }
    else if (msg.type == "stats") CAST.stats = msg;
    else if (msg.type == "log") mapCastLog("worker: " + msg.text);
    else if (msg.type == "captureEnded")
    {
      mapCastLog("capture ended");
      mapCastCaptureStop();
      if (CAST.encoding) mapCastGrabLater();
    }
    else if (msg.type == "error")
    {
      // Its server (its port in use: nothing served until Enable Casting is turned on again), or its encoder (the video stopped: asked
      // for again by the next request or cast)
      mapCastLog("worker error " + msg.text);
      const casting = CAST.socket || CAST.preparing;
      if (casting) mapCastEvent(msg.code == "EADDRINUSE" ? "cast.event.port" : "cast.event.failed", true, GT.settings.map.castPort);
      else if (msg.serving) mapCastEvent("cast.event.port", true, GT.settings.map.castPort);
      if (casting) mapCastStop();
      if (msg.serving) mapCastUnserve();
      else mapCastEncodeStop();
    }
  };
  worker.onerror = (e) => mapCastLog("worker error " + e.message);
}

function mapCastReceive(data)
{
  CAST.input = CAST.input.length ? Buffer.concat([CAST.input, data]) : Buffer.from(data);
  while (CAST.input.length >= 4)
  {
    const size = CAST.input.readUInt32BE(0);
    if (size > CAST_MESSAGE_MAX)
    {
      mapCastLog("bad message");
      mapCastStop();
      return;
    }
    if (CAST.input.length < 4 + size) break;
    const message = mapCastDecode(CAST.input.subarray(4, 4 + size));
    CAST.input = CAST.input.subarray(4 + size);
    mapCastMessage(message);
  }
}

function mapCastMessage(message)
{
  let data = null;
  try
  {
    data = JSON.parse(message.payload);
  }
  catch (e)
  {
    return;
  }
  if (message.namespace == CAST_NS_HEARTBEAT)
  {
    if (data.type == "PING") mapCastSend(message.source, CAST_NS_HEARTBEAT, { type: "PONG" });
  }
  else if (message.namespace == CAST_NS_RECEIVER && data.type == "RECEIVER_STATUS")
  {
    const app = (data.status?.applications || []).find((a) => a.appId == CAST_APP_DEFAULT_MEDIA);
    if (!app)
    {
      // Closed on the device (or another app cast to it)
      if (CAST.transportId)
      {
        mapCastLog("receiver closed");
        mapCastEvent("cast.event.ended", false);
        mapCastStop();
      }
      return;
    }
    if (app.transportId == CAST.transportId) return;
    CAST.transportId = app.transportId;
    CAST.sessionId = app.sessionId;
    CAST.loaded = false;
    mapCastSend(CAST.transportId, CAST_NS_CONNECTION, { type: "CONNECT" });
    mapCastLog("receiver ready");
    clearTimeout(CAST.loadTimer);
    CAST.loadTimer = setTimeout(() =>
    {
      CAST.loadTimer = null;
      if (CAST.loaded) return;
      mapCastLog("no video to play");
      mapCastEvent("cast.event.failed", true);
      mapCastStop();
    }, CAST_LOAD_WAIT_MS);
    mapCastLoadWhenReady();
  }
  else if (message.namespace == CAST_NS_MEDIA)
  {
    if (data.type == "MEDIA_STATUS")
    {
      const state = (data.status || []).map((s) => s.playerState + (s.idleReason ? " " + s.idleReason : "")).join(", ");
      if (state && state != CAST.playerState) mapCastLog("player " + state);
      if (state) CAST.playerState = state;
    }
    else mapCastLog("media " + data.type + (data.reason ? " " + data.reason : ""));
  }
  else if (message.namespace == CAST_NS_CONNECTION && data.type == "CLOSE" && message.source == CAST.transportId)
  {
    mapCastLog("receiver closed the connection");
    mapCastEvent("cast.event.ended", false);
    mapCastStop();
  }
}

// The capture of #main started (handed to the worker) or stopped: while the video is encoded
async function mapCastGrab(on)
{
  if (on && CAST.worker && CAST.encoding && !CAST.grabbing)
  {
    CAST.grabbing = true;
    try
    {
      await mapCastCapture();
    }
    catch (e)
    {
      mapCastLog("capture " + e.message);
      mapCastCaptureStop();
      if (CAST.worker && CAST.encoding) mapCastGrabLater();
    }
  }
  else if (!on && CAST.grabbing) mapCastCaptureStop();
}

// The main window captures itself (the main process answers its getDisplayMedia with its own frame), cut by Element Capture to #main
// and scaled on the GPU to the video's size. #main needs for that a stacking context of its own (isolation) and the window's height
// (all in it is positioned: it has none of its own; nothing in it is sized by it), both put back after. The track goes to the worker,
// which reads its frames (or, where a track can't be handed over, the frames' stream does)
async function mapCastCapture()
{
  const element = document.getElementById("main");
  CAST.mainStyle = { isolation: element.style.isolation, height: element.style.height };
  element.style.isolation = "isolate";
  element.style.height = "100vh";
  electron.ipcRenderer.send("mapCastCaptureAllowed");
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: CAST.fps }, audio: false, preferCurrentTab: true });
  const track = stream.getVideoTracks()[0];
  CAST.track = track;
  await track.restrictTo(await RestrictionTarget.fromElement(element));
  await track.applyConstraints({ width: CAST.width, height: CAST.height, frameRate: CAST.fps, resizeMode: "crop-and-scale" });
  if (!CAST.worker || !CAST.encoding || CAST.track != track)
  {
    track.stop();
    return;
  }
  try
  {
    CAST.worker.postMessage({ type: "track", track: track }, [track]);
    CAST.track = null;
    mapCastLog("capture: track to the worker");
  }
  catch (e)
  {
    const readable = new MediaStreamTrackProcessor({ track: track }).readable;
    CAST.worker.postMessage({ type: "frames", readable: readable }, [readable]);
    mapCastLog("capture: frames to the worker");
  }
}

function mapCastCaptureStop()
{
  CAST.grabbing = false;
  if (CAST.track) CAST.track.stop();
  CAST.track = null;
  if (CAST.worker) CAST.worker.postMessage({ type: "untrack" });
  const element = document.getElementById("main");
  if (CAST.mainStyle)
  {
    element.style.isolation = CAST.mainStyle.isolation;
    element.style.height = CAST.mainStyle.height;
  }
  CAST.mainStyle = null;
}

// The device told to play the video, once: when its app is ready, the video is served, and a segment is done (an empty playlist isn't
// something to start from)
function mapCastLoadWhenReady()
{
  if (CAST.loaded || !CAST.transportId || !CAST.port || !CAST.segments) return;
  CAST.loaded = true;
  clearTimeout(CAST.loadTimer);
  CAST.loadTimer = null;
  mapCastLoad();
}

// HLS with fragmented MP4 segments (the Default Media Receiver needs to be told the segments' format)
function mapCastLoad()
{
  const url = "http://" + CAST.localAddress + ":" + CAST.port + "/map.m3u8";
  const media = { contentId: url, contentType: "application/x-mpegurl", streamType: "LIVE", hlsSegmentFormat: "fmp4", hlsVideoSegmentFormat: "fmp4" };
  mapCastSend(CAST.transportId, CAST_NS_MEDIA, { type: "LOAD", requestId: ++CAST.requestId, sessionId: CAST.sessionId, autoplay: true, media: media });
  mapCastLog("load " + url);
}

// The Cast devices that answer an mDNS query for _googlecast._tcp within waitMs: [{ id, name, model, host }] in the order they
// answered (each from its own address); done as soon as one answers that until(device) is true for, when given
function mapCastFind(waitMs = CAST_FIND_MS, until = null)
{
  return new Promise((resolve) =>
  {
    const socket = window.require("dgram").createSocket({ type: "udp4", reuseAddr: true });
    const found = {};
    let timer = null;
    const finish = () =>
    {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
      try
      {
        socket.close();
      }
      catch (e)
      {
        // Already closed
      }
      resolve(Object.values(found));
    };
    socket.on("message", (msg, rinfo) =>
    {
      const txt = mapCastDnsTxt(msg);
      if (!txt) return;
      const device = { id: txt.id || "", name: txt.fn || "", model: txt.md || "", host: rinfo.address };
      found[rinfo.address] = device;
      if (until && until(device)) finish();
    });
    socket.on("error", () => {});
    socket.bind(0, () =>
    {
      const labels = ["_googlecast", "_tcp", "local"].map((label) => Buffer.concat([Buffer.from([label.length]), Buffer.from(label, "ascii")]));
      // One question: PTR (12), class IN (1)
      const query = Buffer.concat([Buffer.from([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]), ...labels, Buffer.from([0, 0, 12, 0, 1])]);
      socket.send(query, 5353, "224.0.0.251");
    });
    timer = setTimeout(finish, waitMs);
  });
}

// A DNS name's end (a pointer ends it)
function mapCastDnsSkipName(msg, i)
{
  while (i < msg.length)
  {
    const length = msg[i];
    if (length == 0) return i + 1;
    if ((length & 0xc0) == 0xc0) return i + 2;
    i += length + 1;
  }
  return i;
}

// The key=value pairs of a reply's TXT record, null when it has none
function mapCastDnsTxt(msg)
{
  try
  {
    let i = 12;
    const questions = msg.readUInt16BE(4);
    const records = msg.readUInt16BE(6) + msg.readUInt16BE(8) + msg.readUInt16BE(10);
    for (let q = 0; q < questions; q++) i = mapCastDnsSkipName(msg, i) + 4;
    for (let r = 0; r < records; r++)
    {
      i = mapCastDnsSkipName(msg, i);
      const type = msg.readUInt16BE(i);
      const length = msg.readUInt16BE(i + 8);
      i += 10;
      if (type == 16)
      {
        const txt = {};
        for (let j = i; j < i + length; j += msg[j] + 1)
        {
          const pair = msg.subarray(j + 1, j + 1 + msg[j]).toString("utf8");
          const eq = pair.indexOf("=");
          if (eq > 0) txt[pair.substring(0, eq)] = pair.substring(eq + 1);
        }
        return txt;
      }
      i += length;
    }
  }
  catch (e)
  {
    // A short or broken reply
  }
  return null;
}

// ---- Settings -> General -> Display -> Enable Casting, and the button panel's Cast button (shown while it's on). A click casts to the
// device picked last (GT.settings.map.castDevice: found again by its id, or tried at the address it had), else to the first that
// answers, which is then remembered; a click while casting stops. A right click lists the devices found, to cast to one (and keep it)

async function mapCastInit()
{
  mapCastRender();
  CAST.supported = await mapCastSupported();
  castPort.value = GT.settings.map.castPort;
  mapCastSoftwareShow();
  mapCastLinkAddress();
  if (GT.settings.map.castEnable)
  {
    mapCastServe();
    mapCastDiscover();
  }
  mapCastRender();
}

// The address the device cast to last would reach this computer at (the one a connection to it goes out from), else this computer's
// first network address: the link's until a cast says
function mapCastLinkAddress()
{
  const found = (address) =>
  {
    CAST.linkAddress = address;
    mapCastRender();
  };
  const first = () =>
  {
    const all = Object.values(window.require("os").networkInterfaces()).flat();
    return all.find((a) => a.family == "IPv4" && !a.internal)?.address || "";
  };
  const host = GT.settings.map.castDevice.host;
  if (!host)
  {
    found(first());
    return;
  }
  const socket = window.require("dgram").createSocket("udp4");
  socket.on("error", () =>
  {
    try
    {
      socket.close();
    }
    catch (e)
    {
      // Already closed
    }
    found(first());
  });
  // (a UDP "connection" sends nothing: it only picks the route)
  socket.connect(CAST_PORT, host, () =>
  {
    const address = socket.address().address;
    socket.close();
    found(address);
  });
}

// The cast video's address, for VLC or a browser (served while casting)
function mapCastLink()
{
  const address = CAST.localAddress || CAST.linkAddress;
  return address ? "http://" + address + ":" + GT.settings.map.castPort + "/map.m3u8" : "";
}

function mapCastCopyLink()
{
  const link = mapCastLink();
  if (link) navigator.clipboard.writeText(link);
}

// Settings -> General -> Display -> Port (only while Enable Casting is on and nothing is cast: mapCastRender): served on from then on,
// once the typing has stopped (those watching then open the link again)
function mapCastPortChanged()
{
  if (ValidatePort(castPort, null, null)) GT.settings.map.castPort = Number(castPort.value);
  clearTimeout(CAST.portTimer);
  CAST.portTimer = setTimeout(() =>
  {
    CAST.portTimer = null;
    // (not served on since its port was in use: tried on this one)
    if (!GT.settings.map.castEnable || CAST.socket || CAST.preparing || (CAST.worker && CAST.port == GT.settings.map.castPort)) return;
    mapCastLog("port changed to " + GT.settings.map.castPort);
    mapCastUnserve();
    mapCastServe();
  }, CAST_PORT_WAIT_MS);
  mapCastRender();
}

// Settings -> General -> Display -> Software Frame Rate and Software Resolution (without a hardware encoder): from the next video made on
function mapCastSoftwareChanged()
{
  GT.settings.map.castSoftwareFps = Number(castSoftwareFps.value);
  GT.settings.map.castSoftwareHeight = Number(castSoftwareSize.value);
  mapCastSoftwareShow();
}

// The two as kept
function mapCastSoftwareShow()
{
  castSoftwareFps.value = mapCastSoftwareFps();
  castSoftwareFpsTd.textContent = mapCastSoftwareFps() + " fps";
  castSoftwareSize.value = String(mapCastSoftwareSize().height);
}

// The Port box showing the port kept (one being typed and not valid put back)
function mapCastPortReset()
{
  castPort.value = GT.settings.map.castPort;
  ValidatePort(castPort, null, null);
}

function mapCastRender()
{
  // Only where it can cast (a video encoder): the setting is kept as it is, but can't be changed, and the button stays hidden
  castEnable.checked = GT.settings.map.castEnable;
  castEnable.disabled = CAST.supported === false;
  castEnableRow.title = I18N(CAST.supported === false ? "settings.map.cast.unsupported.hover" : "settings.map.cast.hover");
  // The port changed while Enable Casting is on and nothing is cast (a cast uses it); grayed out with Enable Casting off
  castPort.disabled = !GT.settings.map.castEnable || CAST.supported === false || !!CAST.socket || CAST.preparing;
  castPortRow.style.opacity = GT.settings.map.castEnable && CAST.supported ? "" : "0.5";
  // The software encoder's frame rate and resolution: only without a hardware encoder; grayed out with Enable Casting off, as the Port
  const software = CAST.supported && !CAST.hardware;
  for (const row of [castSoftwareFpsRow, castSoftwareSizeRow])
  {
    row.style.display = software ? "" : "none";
    row.style.opacity = GT.settings.map.castEnable ? "" : "0.5";
  }
  castSoftwareFps.disabled = castSoftwareSize.disabled = !GT.settings.map.castEnable;
  const link = GT.settings.map.castEnable && CAST.supported ? mapCastLink() : "";
  castLinkText.textContent = link;
  castLink.style.display = link ? "" : "none";
  // The button enabled once a Cast device has been found (a right click looks again)
  const usable = CAST.devicesFound || !!CAST.socket || CAST.preparing;
  castButton.style.display = GT.settings.map.castEnable && CAST.supported ? "" : "none";
  castButton.style.opacity = usable ? "" : "0.4";
  castButton.style.cursor = CAST.finding || CAST.preparing ? "progress" : usable ? "" : "default";
  castImg.style.filter = CAST.socket || CAST.preparing ? "" : "grayscale(1)";
  if (CAST.socket) castButton.title = I18N("gt.button.cast.on.hover").replace("{0}", CAST.name);
  else if (CAST.preparing) castButton.title = I18N("gt.button.cast.preparing.hover").replace("{0}", CAST.name);
  else castButton.title = I18N(CAST.devicesFound ? "gt.button.cast.hover" : "gt.button.cast.none.hover");
}

function mapCastEnableChanged()
{
  GT.settings.map.castEnable = castEnable.checked;
  mapCastPortReset();
  clearTimeout(CAST.portTimer);
  CAST.portTimer = null;
  if (GT.settings.map.castEnable)
  {
    mapCastServe();
    mapCastDiscover();
  }
  else
  {
    CAST.finding = 0;
    clearTimeout(CAST.discoverTimer);
    CAST.discoverTimer = null;
    CAST.devicesFound = false;
    mapCastStop();
    mapCastUnserve();
  }
  mapCastRender();
}

// An event about the cast (key: its text, {0} the device's name, {1} more), an error's or a warning's color when it's one
function mapCastEvent(key, error, more = "", warning = false)
{
  const color = error ? "--gt-error" : warning ? "--gt-warning" : "--gt-label";
  addEvent("cast", "<font style='color:var(" + color + ")'>" + htmlEntities(I18N(key).replace("{0}", CAST.name).replace("{1}", more)) + "</font>", error);
}

function mapCastDeviceLabel(device)
{
  const name = device.name || device.host;
  return device.model ? name + " (" + device.model + ")" : name;
}

function mapCastIsSaved(device)
{
  const saved = GT.settings.map.castDevice;
  return saved.id ? device.id == saved.id : !!saved.host && device.host == saved.host;
}

// Casting to device, remembered as the one to cast to
function mapCastTo(device)
{
  GT.settings.map.castDevice = { id: device.id || "", name: device.name || "", host: device.host };
  mapCastStart(device.host, device.name || device.host);
  mapCastLinkAddress();
}

// Whether any Cast device answered a search (the Cast button enabled); none: looked for again in a while
function mapCastFound(devices)
{
  CAST.devicesFound = devices.length > 0;
  clearTimeout(CAST.discoverTimer);
  CAST.discoverTimer = !CAST.devicesFound && GT.settings.map.castEnable ? setTimeout(mapCastDiscover, CAST_DISCOVER_RETRY_MS) : null;
  mapCastRender();
}

// The Cast devices looked for (while Enable Casting is on), until one is found
async function mapCastDiscover()
{
  clearTimeout(CAST.discoverTimer);
  CAST.discoverTimer = null;
  if (!GT.settings.map.castEnable || !CAST.supported || CAST.finding) return;
  const devices = await mapCastFind(CAST_FIND_MS);
  if (GT.settings.map.castEnable && !CAST.finding) mapCastFound(devices);
}

// The devices found (done once until(device) is true for one, when given), or null when the search was called off meanwhile
async function mapCastSearch(waitMs, until)
{
  const search = Date.now();
  CAST.finding = search;
  mapCastRender();
  const devices = await mapCastFind(waitMs, until);
  if (CAST.finding != search) return null;
  CAST.finding = 0;
  mapCastFound(devices);
  return devices;
}

// A click casts to the one device found, or lists them when there are more (as a right click does); while casting (or preparing), it
// stops
async function mapCastButtonClick()
{
  if (CAST.socket || CAST.finding || CAST.preparing)
  {
    CAST.finding = 0;
    mapCastStop();
    return;
  }
  if (!CAST.devicesFound) return;
  const devices = await mapCastSearch(CAST_MENU_FIND_MS, null);
  if (!devices) return;
  if (devices.length > 1)
  {
    mapCastDeviceMenu(devices);
    return;
  }
  // None found: tried where the one picked last was (it may not answer the search from there)
  const saved = GT.settings.map.castDevice;
  const device = devices[0] || (saved.host ? saved : null);
  if (device) mapCastTo(device);
  else
  {
    CAST.name = "";
    mapCastEvent("cast.event.noDevice", true);
  }
}

async function mapCastButtonMenu(event)
{
  event.preventDefault();
  if (CAST.finding) return;
  const devices = await mapCastSearch(CAST_MENU_FIND_MS, null);
  if (devices) mapCastDeviceMenu(devices);
}

// The devices found to pick one from (the one picked last checked), and Stop Casting while casting
function mapCastDeviceMenu(devices)
{
  const menu = new Menu();
  for (const device of devices)
  {
    menu.append(new MenuItem({
      label: mapCastDeviceLabel(device),
      type: "checkbox",
      checked: mapCastIsSaved(device),
      click: () =>
      {
        if (!((CAST.socket || CAST.preparing) && CAST.host == device.host)) mapCastTo(device);
      }
    }));
  }
  if (!devices.length) menu.append(new MenuItem({ label: I18N("cast.menu.none.label"), enabled: false }));
  if (CAST.socket || CAST.preparing)
  {
    menu.append(new MenuItem({ type: "separator" }));
    menu.append(new MenuItem({ label: I18N("cast.menu.stop.label"), click: () => mapCastStop() }));
  }
  menu.popup();
}
