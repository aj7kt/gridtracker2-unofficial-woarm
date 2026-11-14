// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// Map Cast (Settings -> Features -> Casting -> Enable Casting, and the button panel's Cast button: at the end): the map as the main window
// shows it, sent to a Google Cast device (the Google TV Streamer) as a live video.
//   The frames: while the video is wanted (a cast, or someone on the network watching it), the main window captures itself, cut to #main
//   (the map and what's over it) by Element Capture, at up to 30 frames a second, scaled on the GPU to the video's size; the window is
//   snapped to 16:9 while casting (the main process: 'mapCastSnap'). The capture goes to mapCastWorker.js, which encodes it (H.264: on a
//   hardware encoder, else in software at CAST_SOFTWARE_FPS, said in the Event Viewer) and keeps the last 12 seconds as HLS (a live
//   playlist of 2 second MPEG-TS segments, and the same as one endless stream, map.ts). While Enable Casting is on it serves them on the
//   Port, to the device cast to and to anyone on the network (VLC, a browser), and asks for the video when someone does. Nothing here
//   per frame. With Announce On Network on too, mapCastAnnounceWorker.js lists the video as a UPnP / DLNA media server, so players on the
//   network (Kodi, VLC, Roku, smart TVs) find it themselves.
//   The device: Google's Default Media Receiver (no receiver app of our own to register or host), contacted once the playlist is full
//   (CAST_SEGMENTS_FULL), and told over the Cast protocol to play it as a LIVE stream.
//   The Cast protocol (CASTV2): TLS to port 8009 (the device's certificate is its own: not checked), each message a 4-byte big-endian
//   length and a CastMessage protobuf (protocol version, source, destination, namespace, payload type, JSON payload). CONNECT to the
//   receiver, PING/PONG every few seconds, LAUNCH the app, CONNECT to its transport, then LOAD on the media namespace.
//   DLNA / UPnP players (Kodi, many smart TVs): MediaRenderers with an AVTransport, found by SSDP (those that take only audio left out),
//   told over SOAP to play the video (SetAVTransportURI, Play) and asked how it goes every CAST_DLNA_POLL_MS; one that stops or plays
//   something else is no longer cast to.
//   Several devices can be cast to at once (CAST.sessions, one connection each), all playing the one video (MPEG-TS HLS); the window stays
//   snapped while any is cast to.
// mapCastFind() lists the devices on the network (Cast by mDNS, DLNA by SSDP); mapCastSupported(), mapCastStart(host) (adds one),
// mapCastStop() (all), mapCastStatus() (the console's too); mapCastServe(), mapCastUnserve()

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
// On a hardware encoder, Lock Window Size's sizes (map.castLockHeight: 0 Off, 720, 1080): the size the window is made while casting, so
// the map is captured at it (720p: everything on the TV half as big again as at 1080p, easier to read from across a room)
const CAST_LOCK_SIZES = { 720: { width: 1280, height: 720 }, 1080: { width: 1920, height: 1080 } };
// H.264 High, level 4.0 (1920x1080 at up to 30 fps), on a hardware encoder
const CAST_CODEC = "avc1.640028";
const CAST_FPS = 30;
// A fixed quantizer, not a bitrate: a bitrate's encoder spends what's left of it re-sending the unchanged map, this one sends only
// what changed (next to nothing for a still map; a key frame ~250 KB, one each 2 second segment)
const CAST_QP = 20;
// Without a hardware encoder: the software one (OpenH264: no fixed quantizer, only a bitrate; nothing past H.264 level 5.2, so no 8K),
// H.264 Constrained Baseline, at the Software Resolution and Software Frame Rate (Settings -> Features -> Casting: map.castSoftwareHeight,
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
// The main window resized while casting: the casts started again at its new size once it has stopped changing this long (mapCastResized)
const CAST_RESIZE_SETTLE_MS = 1000;
// At the start, a cast going when the app closed resumed after this (the main window laid out first)
const CAST_RESUME_WAIT_MS = 10000;
// A message bigger than this is taken as the stream gone wrong (the protocol's own limit is 64 KiB)
const CAST_MESSAGE_MAX = 65536;
const CAST_LOG_LINES = 40;
// How long the Cast devices are listened for: by the button (done as soon as the one wanted answers), and by its menu
const CAST_FIND_MS = 2500;
const CAST_MENU_FIND_MS = 1500;
// DLNA: the service a player is told to play by, how often it's asked how it goes, the failed asks in a row that end its cast, and how
// long a request (and a player's description, after the search) may take
const CAST_DLNA_AVTRANSPORT = "urn:schemas-upnp-org:service:AVTransport:1";
const CAST_DLNA_POLL_MS = 5000;
const CAST_DLNA_FAILS = 3;
const CAST_DLNA_TIMEOUT_MS = 4000;
// Announce On Network's name until another is typed in Name (the same for everyone: not translated)
const CAST_ANNOUNCE_NAME = "GridTracker2 by N0TTL";

const CAST = {
  // Whether this computer can cast (mapCastSupported), null until known, and whether it has a hardware encoder for it
  supported: null,
  hardware: false,
  // A search for devices under way (its number), 0 when none; whether the last search found any (the Cast button enabled)
  finding: 0,
  devicesFound: false,
  discoverTimer: null,
  // How many devices the last search found (one: a click on the button casts to it or stops; more: it lists them), and those devices
  // (the Casting box lists them)
  foundCount: 0,
  found: [],
  // A DLNA player's description as read (its location: { device } or { device: null } when it isn't one to cast to), not read again
  dlnaDescriptions: new Map(),
  // The devices cast to, by mapCastKey (the address, "dlna:" before a DLNA player's): each { key, kind ("cast" or "dlna"), host, name,
  // id, remember (kept for the next start: not a console cast), socket, input, requestId, transportId, sessionId, loaded (told to play
  // the video), playerState, pingTimer, loadTimer, prepareTimer, waiting (the video still being prepared: not contacted yet),
  // localAddress; a DLNA player's control (its AVTransport's address), playing (told to play, and doing so), played (seen PLAYING),
  // pollTimer, fails }
  sessions: new Map(),
  // The address a device last reached this computer at (kept after the cast), and the one it would be expected at before a cast (the link
  // in Settings, mapCastLinkAddress)
  localAddress: "",
  linkAddress: "",
  // The worker (while Enable Casting is on) and the port it serves on (once listening); the addresses watching the video now, as it says
  worker: null,
  port: 0,
  viewers: [],
  // The worker listing the video as a media server on the network (Announce On Network, while the video is served), the name it was
  // started with, and the wait after Name is typed in
  announcer: null,
  announcedName: "",
  announceNameTimer: null,
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
  // The segments the playlist lists
  segments: 0,
  // Counted by the first device's mapCastStart and as the last stops, so a start stopped meanwhile goes no further
  starts: 0,
  grabTimer: null,
  portTimer: null,
  // The resume at the start (mapCastInit) waiting, else null
  resumeTimer: null,
  stats: null,
  grabbing: false,
  track: null,
  mainStyle: null,
  snapped: false,
  // The main window's size locked while casting (Lock Window Size: it can't be resized until the last cast stops); the casts
  // being stopped to be cast to again at a new size (mapCastRecast)
  locked: false,
  recasting: false,
  log: []
};

// The devices cast to; any (or being prepared); any still waiting for the video; any connected
function mapCastSessions()
{
  return [...CAST.sessions.values()];
}

function mapCastActive()
{
  return CAST.sessions.size > 0;
}

function mapCastPreparing()
{
  return mapCastSessions().some((S) => S.waiting);
}

// The Cast button radiates (mapCastRender) from a click until the device plays: while the video's buffer fills before it is contacted
// (S.waiting), then until it says PLAYING (S.played), at most CAST_BUSY_MAX_MS after it was contacted (a player that never says so)
const CAST_BUSY_MAX_MS = 45000;

function mapCastBusy()
{
  const now = Date.now();
  return mapCastSessions().some((S) => S.waiting || (!S.played && now < (S.busyUntil || 0)));
}

function mapCastConnected()
{
  return mapCastSessions().some(mapCastOn);
}

// A device cast to that is playing the video, or about to (a Cast device connected, a DLNA player told to play it)
function mapCastOn(S)
{
  return !!S.socket || !!S.playing;
}

// A session's key: the device's address (a TV can be a Cast device and a DLNA player at once: "dlna:" before the player's)
function mapCastKey(kind, host)
{
  return (kind == "dlna" ? "dlna:" : "") + host;
}

// Two devices the same: of one kind, and by their id when both have one, else by their address
function mapCastSame(a, b)
{
  if ((a.kind || "cast") != (b.kind || "cast")) return false;
  return a.id && b.id ? a.id == b.id : !!a.host && a.host == b.host;
}

// The one cast to that is this device, else null
function mapCastSessionOf(device)
{
  return mapCastSessions().find((S) => mapCastSame(S, device)) || null;
}

// The devices' names, for the Event Viewer and the button's tooltip
function mapCastNames(list)
{
  return list.map((S) => S.name).join(", ");
}

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

function mapCastSend(S, destination, namespace, data)
{
  if (S.socket && !S.socket.destroyed) S.socket.write(mapCastEncode("sender-0", destination, namespace, data));
}

// The video's size: #main (the map and what's over it: the whole window while casting, mapCastCapture) as casting makes it (the main
// process's 'mapCastSize': the window snapped to 16:9 where it can be, in the screen's pixels): on a hardware encoder no bigger than
// CAST_MAX_*, in software the Software Resolution's (scaled up to it too: the size picked is the one sent); null while the window isn't
// laid out
async function mapCastVideoSize(software)
{
  const main = await electron.ipcRenderer.invoke("mapCastSize").catch(() => null);
  if (!main || main.width <= 0 || main.height <= 0) return null;
  const box = mapCastTarget(software);
  if (box)
  {
    const fit = mapCastFit(main.width, main.height, box.width, box.height, true);
    // A window 16:9 but for its rounding (snapped to it): the resolution picked exactly (1280x720, not 1280x718)
    return fit.width == box.width && Math.abs(fit.height - box.height) <= 4 ? { width: box.width, height: box.height } : fit;
  }
  return mapCastFit(main.width, main.height, CAST_MAX_WIDTH, CAST_MAX_HEIGHT, false);
}

// The size the window is made for while casting (in the screen's pixels), so the map is captured at it: in software the Software
// Resolution's; on a hardware encoder Lock Window Size's (720p or 1080p); else none (the window snapped to 16:9 at about its size)
function mapCastTarget(software)
{
  if (software) return mapCastSoftwareSize();
  return mapCastLockSize();
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

// Casting to host as well (name: what the user calls it, in the Event Viewer and the button's tooltip; remember: kept for the next start,
// mapCastRemember; control: a DLNA player's AVTransport address, else a Cast device). The first device: the window snapped and the
// video made (or the one being made for those watching, when it's that size); each device contacted once the playlist is full (at once
// when it is already)
async function mapCastStart(host, name = "", id = "", remember = false, control = "")
{
  host = String(host || "").trim();
  if (!host) return "no host";
  const kind = control ? "dlna" : "cast";
  const key = mapCastKey(kind, host);
  if (CAST.sessions.has(key)) return "already casting to " + host;
  if (!(await mapCastSupported())) return "can't cast here: no video encoder (or no Element Capture)";
  CAST.supported = true;
  if (CAST.sessions.has(key)) return "already casting to " + host;
  const S = { key, kind, host, name: name || host, id: id || "", remember, socket: null, input: Buffer.alloc(0), requestId: 0, transportId: "", sessionId: "", loaded: false, playerState: "", pingTimer: null, loadTimer: null, prepareTimer: null, waiting: true, localAddress: "", control, playing: false, played: false, pollTimer: null, fails: 0 };
  const first = !mapCastActive();
  CAST.sessions.set(key, S);
  mapCastRemember();
  // No video in time: this device given up (said in the Event Viewer)
  S.prepareTimer = nodeTimers.setTimeout(() =>
  {
    S.prepareTimer = null;
    if (!S.waiting || CAST.sessions.get(key) !== S) return;
    mapCastLog("no video after " + CAST_PREPARE_WAIT_MS / 1000 + " s for " + host);
    mapCastEvent("cast.event.failed", true, "", false, S.name);
    mapCastStopOne(S);
  }, CAST_PREPARE_WAIT_MS);
  mapCastRender();
  if (first)
  {
    const start = ++CAST.starts;
    // In software the window sized to the Software Resolution, so the map is captured at it (not scaled up from a smaller window); on a
    // hardware encoder to Lock Window Size's 720p or 1080p the same way
    const software = mapCastUseSoftware();
    const target = mapCastTarget(software);
    const snapped = await electron.ipcRenderer.invoke("mapCastSnap", true, target && { width: target.width, height: target.height });
    // (all stopped meanwhile: the window put back)
    if (start != CAST.starts)
    {
      if (snapped && !CAST.snapped && !mapCastActive()) electron.ipcRenderer.invoke("mapCastSnap", false);
      return "stopped";
    }
    CAST.snapped = snapped;
    // A window made for the video's size (the Software Resolution; on a hardware encoder Lock Window Size's 720p or 1080p) can't be
    // resized while casting (as the Log QSO card's while its lock is shut): the video would no longer match it
    if (snapped && target) mapCastLockWindow(true);
    const size = await mapCastVideoSize(software);
    if (start != CAST.starts) return "stopped";
    // (served here when Enable Casting isn't on: from the console)
    mapCastServe();
    if (!size || !CAST.worker)
    {
      mapCastEvent("cast.event.failed", true, "", false, mapCastNames(mapCastSessions()));
      mapCastStop();
      return "no map";
    }
    if (CAST.encoding && (size.width != CAST.width || size.height != CAST.height || software != CAST.software || (software && mapCastSoftwareFps() != CAST.fps))) mapCastEncodeStop();
    if (!CAST.encoding) mapCastEncodeStart(size, software);
    if (CAST.software) mapCastEvent("cast.event.software", false, mapCastSoftwareText(), true);
    mapCastLog("preparing " + CAST.width + "x" + CAST.height + " for " + host);
  }
  else mapCastLog("adding " + host);
  mapCastConnectWhenReady();
  return "preparing the video for " + host;
}

// Each device waiting contacted once the playlist is full and served
function mapCastConnectWhenReady()
{
  if (!CAST.encoding || CAST.segments < CAST_SEGMENTS_FULL || !CAST.port) return;
  for (const S of mapCastSessions())
  {
    if (!S.waiting) continue;
    S.waiting = false;
    nodeTimers.clearTimeout(S.prepareTimer);
    S.prepareTimer = null;
    mapCastConnect(S);
  }
  mapCastRender();
}

function mapCastConnect(S)
{
  S.loaded = false;
  S.playerState = "";
  // The button radiates until it plays, or CAST_BUSY_MAX_MS (drawn again then: mapCastBusy)
  S.played = false;
  S.busyUntil = Date.now() + CAST_BUSY_MAX_MS;
  nodeTimers.clearTimeout(S.busyTimer);
  S.busyTimer = nodeTimers.setTimeout(mapCastRender, CAST_BUSY_MAX_MS + 50);
  if (S.kind == "dlna")
  {
    mapCastDlnaConnect(S);
    return;
  }
  const socket = window.require("tls").connect({ host: S.host, port: CAST_PORT, rejectUnauthorized: false });
  S.socket = socket;
  S.input = Buffer.alloc(0);
  let connected = false;
  socket.on("secureConnect", () =>
  {
    connected = true;
    S.localAddress = CAST.localAddress = String(socket.localAddress || "").replace(/^::ffff:/, "");
    mapCastLog(S.host + ": connected from " + S.localAddress);
    mapCastEvent("cast.event.started", false, "", false, S.name);
    mapCastRender();
    mapCastSend(S, "receiver-0", CAST_NS_CONNECTION, { type: "CONNECT" });
    mapCastSend(S, "receiver-0", CAST_NS_RECEIVER, { type: "LAUNCH", appId: CAST_APP_DEFAULT_MEDIA, requestId: ++S.requestId });
    S.pingTimer = nodeTimers.setInterval(() => mapCastSend(S, "receiver-0", CAST_NS_HEARTBEAT, { type: "PING" }), CAST_PING_MS);
  });
  socket.on("data", (data) => mapCastReceive(S, data));
  socket.on("error", (e) => mapCastLog(S.host + ": error " + e.message));
  socket.on("close", () =>
  {
    if (S.socket != socket) return;
    mapCastLog(S.host + ": connection closed");
    mapCastEvent(connected ? "cast.event.ended" : "cast.event.unreachable", !connected, "", false, S.name);
    mapCastStopOne(S);
  });
}

// ---- DLNA / UPnP players

// Text for XML (an element's or an attribute's), and an element's text out of XML (any namespace prefix), its entities decoded
function mapCastXml(text)
{
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function mapCastXmlTag(xml, name)
{
  const match = new RegExp("<(?:[\\w-]+:)?" + name + "(?:\\s[^>]*)?>([^<]*)<", "i").exec(xml || "");
  return match ? match[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").trim() : "";
}

// A SOAP action on a player's service (control: its address); resolves { text, localAddress } (the address this computer reached it
// from), rejects on an error, an answer that isn't 200 or no answer in CAST_DLNA_TIMEOUT_MS
function mapCastSoap(control, action, args, service = CAST_DLNA_AVTRANSPORT)
{
  return new Promise((resolve, reject) =>
  {
    let url;
    try
    {
      url = new URL(control);
    }
    catch (e)
    {
      reject(new Error(action + ": bad address"));
      return;
    }
    const body = Buffer.from('<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:' + action + ' xmlns:u="' + service + '">' +
      Object.entries(args).map(([name, value]) => "<" + name + ">" + mapCastXml(value) + "</" + name + ">").join("") + "</u:" + action + "></s:Body></s:Envelope>", "utf8");
    const headers = { "Content-Type": 'text/xml; charset="utf-8"', SOAPACTION: '"' + service + "#" + action + '"', "Content-Length": body.length };
    const request = window.require("http").request({ host: url.hostname, port: url.port || 80, path: url.pathname + url.search, method: "POST", headers, timeout: CAST_DLNA_TIMEOUT_MS }, (response) =>
    {
      // (read now: once the answer has ended its connection may be let go)
      const localAddress = String(response.socket?.localAddress || "").replace(/^::ffff:/, "");
      const parts = [];
      response.on("data", (data) => parts.push(data));
      response.on("end", () =>
      {
        const text = Buffer.concat(parts).toString("utf8");
        if (response.statusCode == 200) resolve({ text, localAddress });
        else reject(new Error(action + ": " + response.statusCode + (mapCastXmlTag(text, "errorDescription") ? " " + mapCastXmlTag(text, "errorDescription") : "")));
      });
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new Error(action + ": no answer")));
    request.on("error", reject);
    request.end(body);
  });
}

// A player's description (XML, at most 256 KB), or a rejection
function mapCastHttpGet(address)
{
  return new Promise((resolve, reject) =>
  {
    const request = window.require("http").get(address, { timeout: CAST_DLNA_TIMEOUT_MS }, (response) =>
    {
      if (response.statusCode != 200)
      {
        response.resume();
        reject(new Error("HTTP " + response.statusCode));
        return;
      }
      const parts = [];
      let size = 0;
      response.on("data", (data) =>
      {
        size += data.length;
        if (size > 262144) request.destroy(new Error("too big"));
        else parts.push(data);
      });
      response.on("end", () => resolve(Buffer.concat(parts).toString("utf8")));
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new Error("no answer")));
    request.on("error", reject);
  });
}

// A service's control address in a description (its type containing type), made whole from the description's address, else ""
function mapCastDlnaService(xml, location, type)
{
  const base = mapCastXmlTag(xml, "URLBase") || location;
  for (const match of xml.matchAll(/<(?:[\w-]+:)?service>([\s\S]*?)<\/(?:[\w-]+:)?service>/gi))
  {
    if (!mapCastXmlTag(match[1], "serviceType").includes(type)) continue;
    const control = mapCastXmlTag(match[1], "controlURL");
    try
    {
      return control ? new URL(control, base).href : "";
    }
    catch (e)
    {
      return "";
    }
  }
  return "";
}

// The player whose description is at location (a search's answer from host): { kind: "dlna", id (its UDN), name, model, host, control },
// or null when it has no AVTransport or takes only audio (its ConnectionManager's sink protocols; one that won't say is taken as one
// that plays video). Kept once read (a description that couldn't be read is tried again by the next search)
async function mapCastDlnaDescribe(location, host)
{
  if (CAST.dlnaDescriptions.has(location)) return CAST.dlnaDescriptions.get(location).device;
  let device = null;
  try
  {
    const xml = await mapCastHttpGet(location);
    const control = mapCastDlnaService(xml, location, "AVTransport");
    if (control)
    {
      const manager = mapCastDlnaService(xml, location, "ConnectionManager");
      const sinks = manager ? await mapCastSoap(manager, "GetProtocolInfo", {}, "urn:schemas-upnp-org:service:ConnectionManager:1").then((answer) => mapCastXmlTag(answer.text, "Sink")).catch(() => "") : "";
      if (!sinks || /video\/|mpegurl|mp2t/i.test(sinks)) device = { kind: "dlna", id: mapCastXmlTag(xml, "UDN") || location, name: mapCastXmlTag(xml, "friendlyName") || host, model: "DLNA", host, control };
    }
    CAST.dlnaDescriptions.set(location, { device });
  }
  catch (e)
  {
    mapCastLog("DLNA " + location + ": " + e.message);
  }
  return device;
}

// The DLNA players that answer an SSDP search for media renderers within waitMs, asked on each network interface (an answer can only
// come back the way the search went out)
function mapCastDlnaFind(waitMs)
{
  return new Promise((resolve) =>
  {
    const dgram = window.require("dgram");
    const interfaces = Object.values(window.require("os").networkInterfaces()).flat().filter((a) => a.family == "IPv4" && !a.internal).map((a) => a.address);
    const answers = new Map();
    const sockets = [];
    const search = Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 1\r\nST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n\r\n', "ascii");
    for (const address of interfaces)
    {
      const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
      socket.on("error", () => {});
      socket.on("message", (msg, rinfo) =>
      {
        const location = /^location:\s*(\S+)/im.exec(msg.toString("latin1"));
        if (location && !answers.has(location[1])) answers.set(location[1], rinfo.address);
      });
      socket.bind(0, address, () =>
      {
        socket.send(search, 1900, "239.255.255.250");
        socket.send(search, 1900, "239.255.255.250");
      });
      sockets.push(socket);
    }
    nodeTimers.setTimeout(async () =>
    {
      for (const socket of sockets)
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
      const devices = await Promise.all([...answers].map(([location, host]) => mapCastDlnaDescribe(location, host)));
      resolve(devices.filter(Boolean));
    }, waitMs);
  });
}

// A DLNA player told to play the video (MPEG-TS HLS, at the address it reached this computer at), then asked how it goes
async function mapCastDlnaConnect(S)
{
  const current = () => CAST.sessions.get(S.key) === S;
  try
  {
    // (first an ask that changes nothing: the address this computer reaches it from)
    const probe = await mapCastSoap(S.control, "GetTransportInfo", { InstanceID: 0 });
    if (!current()) return;
    S.localAddress = CAST.localAddress = probe.localAddress || CAST.localAddress || CAST.linkAddress;
    if (!S.localAddress) throw new Error("no address of this computer to give it");
    S.url ="http://" + S.localAddress + ":" + CAST.port + "/map.m3u8";
    const mime = "application/vnd.apple.mpegurl";
    const didl = '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"><item id="gridtracker2" parentID="0" restricted="1"><dc:title>GridTracker2</dc:title><upnp:class>object.item.videoItem</upnp:class><res protocolInfo="http-get:*:' + mime + ':*">' + mapCastXml(S.url) + "</res></item></DIDL-Lite>";
    await mapCastSoap(S.control, "SetAVTransportURI", { InstanceID: 0, CurrentURI: S.url, CurrentURIMetaData: didl });
    if (!current()) return;
    await mapCastSoap(S.control, "Play", { InstanceID: 0, Speed: 1 });
    if (!current())
    {
      // (stopped while it was being told to play: told to stop)
      mapCastSoap(S.control, "Stop", { InstanceID: 0 }).catch(() => {});
      return;
    }
    S.playing = S.loaded = true;
    S.loadedAt = Date.now();
    mapCastLog(S.host + ": playing " + S.url + " (DLNA, from " + S.localAddress + ")");
    mapCastEvent("cast.event.started", false, "", false, S.name);
    S.pollTimer = nodeTimers.setInterval(() => mapCastDlnaPoll(S), CAST_DLNA_POLL_MS);
    mapCastRender();
  }
  catch (e)
  {
    if (!current()) return;
    mapCastLog(S.host + ": " + e.message);
    mapCastEvent("cast.event.unreachable", true, "", false, S.name);
    mapCastStopOne(S);
  }
}

// How a DLNA player cast to goes: stopped (once it has played, or long after it was told to), playing something else (not from this
// port), or not answering CAST_DLNA_FAILS times in a row: no longer cast to (not told to stop: it may be playing what the user picked)
async function mapCastDlnaPoll(S)
{
  if (S.polling || CAST.sessions.get(S.key) !== S) return;
  S.polling = true;
  try
  {
    const info = await mapCastSoap(S.control, "GetTransportInfo", { InstanceID: 0 });
    const media = await mapCastSoap(S.control, "GetMediaInfo", { InstanceID: 0 }).catch(() => null);
    if (CAST.sessions.get(S.key) !== S) return;
    S.fails = 0;
    const state = mapCastXmlTag(info.text, "CurrentTransportState");
    if (state != S.playerState) mapCastLog(S.host + ": player " + state);
    S.playerState = state;
    if (state == "PLAYING" && !S.played)
    {
      S.played = true;
      // (the button stops radiating)
      mapCastRender();
    }
    const uri = media ? mapCastXmlTag(media.text, "CurrentURI") : "";
    const other = !!uri && !uri.includes(":" + CAST.port + "/");
    const stopped = (state == "STOPPED" || state == "NO_MEDIA_PRESENT") && (S.played || Date.now() - S.loadedAt > CAST_LOAD_WAIT_MS);
    if (other || stopped)
    {
      mapCastLog(S.host + (other ? ": playing something else" : ": stopped"));
      mapCastEvent("cast.event.ended", false, "", false, S.name);
      mapCastStopOne(S, true);
    }
  }
  catch (e)
  {
    if (CAST.sessions.get(S.key) === S && ++S.fails >= CAST_DLNA_FAILS)
    {
      mapCastLog(S.host + ": " + e.message);
      mapCastEvent("cast.event.ended", false, "", false, S.name);
      mapCastStopOne(S, true);
    }
  }
  finally
  {
    S.polling = false;
  }
}

// One device no longer cast to (the others go on); the last: the window put back, and the video no longer served unless Enable Casting is
// on (a cast from the console). The video goes on being made while others watch it (the worker says when nobody does). byDevice: a DLNA
// player that stopped or plays something else by itself, not told to stop (it may be playing what the user picked there)
function mapCastStopOne(S, byDevice = false)
{
  if (CAST.sessions.get(S.key) !== S) return;
  CAST.sessions.delete(S.key);
  S.waiting = false;
  nodeTimers.clearTimeout(S.busyTimer);
  nodeTimers.clearTimeout(S.prepareTimer);
  nodeTimers.clearInterval(S.pingTimer);
  nodeTimers.clearTimeout(S.loadTimer);
  nodeTimers.clearInterval(S.pollTimer);
  S.prepareTimer = S.pingTimer = S.loadTimer = S.pollTimer = null;
  // (as GridTracker2 closes, the main process tells it: mapCastClose)
  if (S.kind == "dlna" && S.playing && !byDevice && !GT.closing) mapCastSoap(S.control, "Stop", { InstanceID: 0 }).catch((e) => mapCastLog(S.host + ": stop " + e.message));
  S.playing = false;
  const socket = S.socket;
  S.socket = null;
  if (socket && !socket.destroyed)
  {
    if (S.sessionId) socket.write(mapCastEncode("sender-0", "receiver-0", CAST_NS_RECEIVER, { type: "STOP", sessionId: S.sessionId, requestId: ++S.requestId }));
    socket.end();
  }
  if (CAST.worker) CAST.worker.postMessage({ type: "castEnded", address: S.host });
  mapCastRemember();
  // (the last one: the window put back; not while casting again at a new size, mapCastRecast: it keeps the size it was given)
  if (!mapCastActive() && !CAST.recasting)
  {
    CAST.starts++;
    // (resizable again before its old size is put back)
    mapCastLockWindow(false);
    if (CAST.snapped) electron.ipcRenderer.invoke("mapCastSnap", false);
    CAST.snapped = false;
    if (!GT.settings.map.castEnable) mapCastUnserve();
  }
  mapCastRender();
}

// The main window resized while casting (it isn't locked: a hardware encoder's with Lock Window Size Off), once it has settled
// for CAST_RESIZE_SETTLE_MS: snapped to the TV's shape again (the nearest 16:9 at about its size, as a cast's start does), then when that
// changes the video's size, every device cast to is stopped and cast to again at the new one (the video is made again at it; the size
// the window goes back to when the casts stop is kept). (The snap's own resize comes while the casts are prepared: not taken again)
async function mapCastResized()
{
  if (!mapCastActive() || CAST.locked || CAST.recasting || !CAST.encoding || mapCastPreparing()) return;
  await electron.ipcRenderer.invoke("mapCastSnap", true, null, true).catch(() => false);
  if (!mapCastActive() || CAST.locked || CAST.recasting) return;
  const size = await mapCastVideoSize(CAST.software);
  if (!size || (size.width == CAST.width && size.height == CAST.height) || !mapCastActive() || CAST.recasting) return;
  mapCastLog("window resized: casting again at " + size.width + "x" + size.height);
  mapCastEvent("cast.event.resized", false, size.width + "x" + size.height, false, mapCastNames(mapCastSessions()));
  mapCastRecast();
}

// Every device cast to stopped and cast to again (the first one makes the video again, at the window's size now), the window left as it is
function mapCastRecast()
{
  const devices = mapCastSessions().map((S) => ({ host: S.host, name: S.name, id: S.id, remember: S.remember, control: S.control }));
  CAST.recasting = true;
  try
  {
    for (const S of mapCastSessions()) mapCastStopOne(S);
  }
  finally
  {
    CAST.recasting = false;
  }
  // (the video no longer the old size: made again at the new one by the first device's start)
  mapCastEncodeStop();
  for (const d of devices) mapCastStart(d.host, d.name, d.id, d.remember, d.control);
}

// The DLNA players watching the video, each by its AVTransport's address: those cast to (casting: false leaves them out), and any found
// whose address is watching it now (playing it from its own list of media servers, Announce On Network, or from an address typed in:
// Kodi's own player says what it plays, and stops on its Stop, however it was started)
function mapCastDlnaWatching(casting = true)
{
  const controls = new Set();
  if (casting) for (const S of mapCastSessions()) if (S.kind == "dlna" && S.playing && S.control) controls.add(S.control);
  const viewers = new Set(CAST.viewers);
  const cast = new Set(mapCastSessions().map((S) => S.control));
  for (const device of CAST.found.concat([GT.settings.map.castDevice]))
  {
    if (device && device.kind == "dlna" && device.control && viewers.has(device.host) && (casting || !cast.has(device.control))) controls.add(device.control);
  }
  return [...controls];
}

// GridTracker2 closing or restarting (saveAndCloseApp): the DLNA players watching told to stop (else they're left waiting on a video that
// has gone), by the main process, which holds the exit until they've answered (the window would be gone before they were sent from
// here); then every cast stopped, and the video no longer served
function mapCastClose()
{
  const controls = mapCastDlnaWatching();
  if (controls.length) electron.ipcRenderer.sendSync("mapCastStopDevices", controls);
  // (the devices cast to stay on the list for the next start: mapCastRemember leaves it alone while closing)
  mapCastStop();
  mapCastUnserve();
}

// Every device no longer cast to
function mapCastStop()
{
  for (const S of mapCastSessions()) mapCastStopOne(S);
  mapCastRender();
  return "stopped";
}

// The devices cast to, kept (map.castDevices: [{ id, name, host, kind, control }], not the console's casts) so the next start casts to
// them again (mapCastResume); not as the app closes (its casts stopping then are resumed)
function mapCastRemember()
{
  if (GT.closing) return;
  GT.settings.map.castDevices = mapCastSessions().filter((S) => S.remember).map((S) => ({ id: S.id, name: S.name, host: S.host, kind: S.kind, control: S.control }));
}

// The devices kept to cast to again (map.castDevices)
function mapCastRemembered()
{
  const list = GT.settings.map.castDevices;
  return Array.isArray(list) ? list.filter((d) => d && d.host) : [];
}

function mapCastStatus()
{
  return {
    sessions: mapCastSessions().map((S) => ({ kind: S.kind, host: S.host, name: S.name, connected: mapCastOn(S), waiting: S.waiting, transportId: S.transportId, playerState: S.playerState })),
    url: CAST.port ? "http://" + (CAST.localAddress || CAST.linkAddress) + ":" + CAST.port + "/map.m3u8" : "",
    codec: CAST.codec,
    encoding: CAST.encoding,
    software: CAST.software,
    size: CAST.width + "x" + CAST.height,
    segments: CAST.segments,
    grabbing: CAST.grabbing,
    devicesFound: CAST.devicesFound,
    announcing: !!CAST.announcer,
    worker: CAST.stats,
    log: CAST.log
  };
}

// The video served on the Port (Settings -> Features -> Casting), made when asked for: while Enable Casting is on, and while casting
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
  mapCastAnnounceStop();
  mapCastEncodeStop();
  // It closes itself once its server and encoder are closed (ended here if it hasn't by then)
  const worker = CAST.worker;
  CAST.worker = null;
  if (worker)
  {
    worker.postMessage({ type: "stop" });
    nodeTimers.setTimeout(() => worker.terminate(), 2000);
  }
  CAST.port = 0;
  CAST.viewers = [];
  mapCastRender();
}

// Settings -> Features -> Casting -> Announce On Network: while the video is served (Enable Casting on, listening on the Port), it's
// listed on the network as a UPnP / DLNA media server (mapCastAnnounceWorker.js), under its Name, the video in it
function mapCastAnnounceStart()
{
  if (CAST.announcer || GT.settings.map.castAnnounce !== true || !CAST.worker || !CAST.port) return;
  const worker = new Worker("./lib/services/mapCastAnnounceWorker.js");
  CAST.announcer = worker;
  worker.onmessage = (event) =>
  {
    if (CAST.announcer != worker) return;
    const msg = event.data;
    if (msg.type == "log") mapCastLog("announce: " + msg.text);
    else if (msg.type == "error") mapCastLog("announce error " + msg.text);
  };
  worker.onerror = (e) => mapCastLog("announce worker error " + e.message);
  CAST.announcedName = mapCastAnnounceName();
  worker.postMessage({ type: "start", castPort: CAST.port, name: CAST.announcedName, title: I18N("settings.map.cast.announce.item"), version: gtVersionStr });
}

// The name it's listed under: the one typed in Name, else CAST_ANNOUNCE_NAME
function mapCastAnnounceDefaultName()
{
  return CAST_ANNOUNCE_NAME;
}

function mapCastAnnounceName()
{
  const typed = String(GT.settings.map.castAnnounceName || "").trim();
  return typed || mapCastAnnounceDefaultName();
}

// Name typed in: kept (the default's own text, or nothing, keeps the default), and announced under it once the typing has stopped
function mapCastAnnounceNameChanged()
{
  const typed = castAnnounceName.value.trim();
  GT.settings.map.castAnnounceName = typed == mapCastAnnounceDefaultName() ? "" : typed;
  nodeTimers.clearTimeout(CAST.announceNameTimer);
  CAST.announceNameTimer = nodeTimers.setTimeout(() =>
  {
    CAST.announceNameTimer = null;
    if (!CAST.announcer || CAST.announcedName == mapCastAnnounceName()) return;
    mapCastLog("announce name changed to " + mapCastAnnounceName());
    mapCastAnnounceStop();
    mapCastAnnounceStart();
  }, CAST_PORT_WAIT_MS);
}

// The Name box showing the name it's listed under (an emptied box shows the default again)
function mapCastAnnounceNameShow()
{
  castAnnounceName.value = mapCastAnnounceName();
}

// No longer listed (it says goodbye on the network first, then closes itself: ended here if it hasn't by then)
function mapCastAnnounceStop()
{
  const worker = CAST.announcer;
  CAST.announcer = null;
  if (!worker) return;
  worker.postMessage({ type: "stop" });
  nodeTimers.setTimeout(() => worker.terminate(), 2000);
}

function mapCastAnnounceChanged()
{
  GT.settings.map.castAnnounce = castAnnounce.checked;
  if (GT.settings.map.castAnnounce) mapCastAnnounceStart();
  else mapCastAnnounceStop();
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
  nodeTimers.clearTimeout(CAST.grabTimer);
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
  nodeTimers.clearTimeout(CAST.grabTimer);
  CAST.grabTimer = nodeTimers.setTimeout(() =>
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
      mapCastAnnounceStart();
      mapCastConnectWhenReady();
      mapCastLoadWhenReady();
    }
    else if (msg.type == "wanted") mapCastEncodeWanted();
    else if (msg.type == "idle")
    {
      // (a cast's video is wanted while it's prepared and played)
      if (CAST.encoding && !mapCastActive()) mapCastEncodeStop();
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
    else if (msg.type == "viewers")
    {
      CAST.viewers = Array.isArray(msg.addresses) ? msg.addresses : [];
      mapCastRender();
    }
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
      const casting = mapCastActive();
      const names = mapCastNames(mapCastSessions());
      if (casting) mapCastEvent(msg.code == "EADDRINUSE" ? "cast.event.port" : "cast.event.failed", true, GT.settings.map.castPort, false, names);
      else if (msg.serving) mapCastEvent("cast.event.port", true, GT.settings.map.castPort);
      if (casting) mapCastStop();
      if (msg.serving) mapCastUnserve();
      else mapCastEncodeStop();
    }
  };
  worker.onerror = (e) => mapCastLog("worker error " + e.message);
}

// A device's bytes in (S: its session): each whole message read. None once its cast has stopped: after the STOP the device still says
// its app closed and its connection did, which would be taken for the device ending the cast itself (said again in the Event Viewer)
function mapCastReceive(S, data)
{
  if (CAST.sessions.get(S.key) !== S) return;
  S.input = S.input.length ? Buffer.concat([S.input, data]) : Buffer.from(data);
  while (S.input.length >= 4)
  {
    const size = S.input.readUInt32BE(0);
    if (size > CAST_MESSAGE_MAX)
    {
      mapCastLog(S.host + ": bad message");
      mapCastStopOne(S);
      return;
    }
    if (S.input.length < 4 + size) break;
    const message = mapCastDecode(S.input.subarray(4, 4 + size));
    S.input = S.input.subarray(4 + size);
    mapCastMessage(S, message);
    if (CAST.sessions.get(S.key) !== S) return;
  }
}

function mapCastMessage(S, message)
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
    if (data.type == "PING") mapCastSend(S, message.source, CAST_NS_HEARTBEAT, { type: "PONG" });
  }
  else if (message.namespace == CAST_NS_RECEIVER && data.type == "RECEIVER_STATUS")
  {
    const app = (data.status?.applications || []).find((a) => a.appId == CAST_APP_DEFAULT_MEDIA);
    if (!app)
    {
      // Closed on the device (or another app cast to it)
      if (S.transportId)
      {
        mapCastLog(S.host + ": receiver closed");
        mapCastEvent("cast.event.ended", false, "", false, S.name);
        mapCastStopOne(S);
      }
      return;
    }
    if (app.transportId == S.transportId) return;
    S.transportId = app.transportId;
    S.sessionId = app.sessionId;
    S.loaded = false;
    mapCastSend(S, S.transportId, CAST_NS_CONNECTION, { type: "CONNECT" });
    mapCastLog(S.host + ": receiver ready");
    nodeTimers.clearTimeout(S.loadTimer);
    S.loadTimer = nodeTimers.setTimeout(() =>
    {
      S.loadTimer = null;
      if (S.loaded) return;
      mapCastLog(S.host + ": no video to play");
      mapCastEvent("cast.event.failed", true, "", false, S.name);
      mapCastStopOne(S);
    }, CAST_LOAD_WAIT_MS);
    mapCastLoadWhenReady();
  }
  else if (message.namespace == CAST_NS_MEDIA)
  {
    if (data.type == "MEDIA_STATUS")
    {
      const state = (data.status || []).map((s) => s.playerState + (s.idleReason ? " " + s.idleReason : "")).join(", ");
      if (state && state != S.playerState) mapCastLog(S.host + ": player " + state);
      if (state) S.playerState = state;
      // Its first PLAYING (it goes PLAYING / BUFFERING after): the button stops radiating
      if (/^PLAYING/.test(state) && !S.played)
      {
        S.played = true;
        mapCastRender();
      }
    }
    else mapCastLog(S.host + ": media " + data.type + (data.reason ? " " + data.reason : ""));
  }
  else if (message.namespace == CAST_NS_CONNECTION && data.type == "CLOSE" && message.source == S.transportId)
  {
    mapCastLog(S.host + ": receiver closed the connection");
    mapCastEvent("cast.event.ended", false, "", false, S.name);
    mapCastStopOne(S);
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

// Each device told to play the video, once: when its app is ready, the video is served, and a segment is done (an empty playlist isn't
// something to start from)
function mapCastLoadWhenReady()
{
  if (!CAST.port || !CAST.segments) return;
  for (const S of mapCastSessions())
  {
    if (S.loaded || !S.transportId) continue;
    S.loaded = true;
    nodeTimers.clearTimeout(S.loadTimer);
    S.loadTimer = null;
    mapCastLoad(S);
  }
}

// HLS with MPEG-TS segments (the Default Media Receiver is told the segments' format), at the address the device reached this computer at
function mapCastLoad(S)
{
  const url = "http://" + S.localAddress + ":" + CAST.port + "/map.m3u8";
  const media = { contentId: url, contentType: "application/x-mpegurl", streamType: "LIVE", hlsSegmentFormat: "ts", hlsVideoSegmentFormat: "mpeg2_ts" };
  mapCastSend(S, S.transportId, CAST_NS_MEDIA, { type: "LOAD", requestId: ++S.requestId, sessionId: S.sessionId, autoplay: true, media: media });
  mapCastLog(S.host + ": load " + url);
}

// The devices on the network: the Cast devices, then the DLNA players (both looked for at once, for waitMs)
async function mapCastFind(waitMs = CAST_FIND_MS, until = null)
{
  const [cast, dlna] = await Promise.all([mapCastFindCast(waitMs, until), mapCastDlnaFind(waitMs)]);
  return cast.concat(dlna);
}

// The Cast devices that answer an mDNS query for _googlecast._tcp within waitMs: [{ kind: "cast", id, name, model, host }] in the order
// they answered (each from its own address); done as soon as one answers that until(device) is true for, when given
function mapCastFindCast(waitMs = CAST_FIND_MS, until = null)
{
  return new Promise((resolve) =>
  {
    const socket = window.require("dgram").createSocket({ type: "udp4", reuseAddr: true });
    const found = {};
    let timer = null;
    const finish = () =>
    {
      if (!timer) return;
      nodeTimers.clearTimeout(timer);
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
      const device = { kind: "cast", id: txt.id || "", name: txt.fn || "", model: txt.md || "", host: rinfo.address };
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
    timer = nodeTimers.setTimeout(finish, waitMs);
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

// ---- Settings -> Features -> Casting -> Enable Casting, and the button panel's Cast button (shown while it's on). With one device found a
// click casts to it (or to the one picked last, GT.settings.map.castDevice, tried at the address it had when none answers) or stops;
// with more, it lists them as a right click does: each with a checkbox, ticked to cast to it as well, unticked to stop it

async function mapCastInit()
{
  // The window's size beside Enable Casting follows the window (once it has stopped changing); while casting, the casts are started again
  // at its new size once it has settled (mapCastResized)
  let sizeTimer = null, settleTimer = null;
  window.addEventListener("resize", () =>
  {
    nodeTimers.clearTimeout(sizeTimer);
    sizeTimer = nodeTimers.setTimeout(mapCastWindowSizeShow, 250);
    nodeTimers.clearTimeout(settleTimer);
    settleTimer = nodeTimers.setTimeout(mapCastResized, CAST_RESIZE_SETTLE_MS);
  });
  mapCastRender();
  CAST.supported = await mapCastSupported();
  castPort.value = GT.settings.map.castPort;
  mapCastSoftwareShow();
  mapCastLinkAddress();
  if (GT.settings.map.castEnable)
  {
    mapCastServe();
    if (mapCastRemembered().length && CAST.supported) CAST.resumeTimer = nodeTimers.setTimeout(mapCastResume, CAST_RESUME_WAIT_MS);
    else mapCastDiscover();
  }
  mapCastRender();
}

// Casting again to the devices cast to when the app closed (map.castDevices), each once it answers a search (found again by its id: its
// address may have changed). Called off meanwhile (Enable Casting turned off: mapCastResumeCancel; a cast started by hand), it isn't, and
// a device not answering (turned off: the window isn't resized for a cast that can't start) is let go; the devices are looked for as usual
async function mapCastResume()
{
  CAST.resumeTimer = null;
  const wanted = () => GT.settings.map.castEnable && mapCastRemembered().length > 0 && !mapCastActive();
  if (!wanted() || CAST.finding)
  {
    mapCastDiscover();
    return;
  }
  const devices = await mapCastSearch(CAST_FIND_MS, null);
  if (!devices || !wanted()) return;
  const remembered = mapCastRemembered();
  for (const saved of remembered)
  {
    const device = devices.find((d) => mapCastSame(saved, d));
    if (device)
    {
      mapCastLog("resuming the cast to " + device.host);
      mapCastTo(device);
    }
    else mapCastLog("not resuming: " + saved.host + " didn't answer");
  }
  // (the ones that didn't answer no longer kept)
  mapCastRemember();
}

// A resume waiting (mapCastInit) called off
function mapCastResumeCancel()
{
  if (CAST.resumeTimer) nodeTimers.clearTimeout(CAST.resumeTimer);
  CAST.resumeTimer = null;
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

// The cast video's address, for VLC or a browser (served while Enable Casting is on): file "map.m3u8" (HLS, what a cast plays) or
// "map.ts" (the same as one endless MPEG-TS stream)
function mapCastLink(file)
{
  const address = CAST.localAddress || CAST.linkAddress;
  return address ? "http://" + address + ":" + GT.settings.map.castPort + "/" + file : "";
}

function mapCastCopyLink(file)
{
  const link = mapCastLink(file);
  if (link) navigator.clipboard.writeText(link);
}

// A right click on a link: Open In Default Browser (a new window or tab there: the main process hands it on)
function mapCastLinkMenu(event, file)
{
  event.preventDefault();
  const link = mapCastLink(file);
  if (!link) return;
  const menu = new Menu();
  menu.append(new MenuItem({ label: I18N("cast.menu.openBrowser.label"), click: () => openSite(link) }));
  menu.popup();
}

// Settings -> Features -> Casting -> Port (only while Enable Casting is on and nothing is cast: mapCastRender): served on from then on,
// once the typing has stopped (those watching then open the link again)
function mapCastPortChanged()
{
  if (ValidatePort(castPort, null, null)) GT.settings.map.castPort = Number(castPort.value);
  nodeTimers.clearTimeout(CAST.portTimer);
  CAST.portTimer = nodeTimers.setTimeout(() =>
  {
    CAST.portTimer = null;
    // (not served on since its port was in use: tried on this one)
    if (!GT.settings.map.castEnable || mapCastActive() || (CAST.worker && CAST.port == GT.settings.map.castPort)) return;
    mapCastLog("port changed to " + GT.settings.map.castPort);
    mapCastUnserve();
    mapCastServe();
  }, CAST_PORT_WAIT_MS);
  mapCastRender();
}

// Settings -> Features -> Casting -> Lock Window Size (a hardware encoder's: Off, 720p or 1080p): from the next cast on; and while casting,
// at once: Off, the window can be resized again (a resize then casts again at its size, mapCastResized); a size, the window is made that
// size and locked, and when the video isn't that size, every device is cast to again at it
function mapCastLockChanged()
{
  GT.settings.map.castLockHeight = Number(castLockSize.value) || 0;
  if (CAST.software) return;
  const target = mapCastLockSize();
  if (!target)
  {
    mapCastLockWindow(false);
    return;
  }
  if (!mapCastActive() || !CAST.snapped) return;
  electron.ipcRenderer.invoke("mapCastSnap", true, target).then((snapped) =>
  {
    // (still that size, and still casting, once the window has been sized)
    const now = mapCastLockSize();
    if (!snapped || !now || now.height != target.height || !mapCastActive() || !CAST.snapped) return;
    mapCastLockWindow(true);
    if (CAST.encoding && !CAST.recasting && (CAST.width != target.width || CAST.height != target.height))
    {
      mapCastEvent("cast.event.resized", false, target.width + "x" + target.height, false, mapCastNames(mapCastSessions()));
      mapCastRecast();
    }
  });
}

// Lock Window Size's size: { width, height } (720p or 1080p), null when Off
function mapCastLockSize()
{
  return CAST_LOCK_SIZES[GT.settings.map.castLockHeight] || null;
}

// Settings -> Features -> Casting -> Software Frame Rate and Software Resolution (without a hardware encoder): from the next video made on

// The main window resizable or not (the main process's setResizable, as the Log QSO card's), told only when it changes
function mapCastLockWindow(locked)
{
  if (CAST.locked == locked) return;
  CAST.locked = locked;
  electron.ipcRenderer.send("setResizable", "GridTracker2", !locked);
  mapCastLog(locked ? "window size locked" : "window size unlocked");
}

// Beside Enable Casting: the main window's size now, in the screen's pixels (what the video is made from), as it changes
async function mapCastWindowSizeShow()
{
  const size = GT.settings.map.castEnable && CAST.supported ? await electron.ipcRenderer.invoke("mapCastWindowSize").catch(() => null) : null;
  const text = size ? size.width + "x" + size.height : "";
  if (castWindowSize.textContent != text) castWindowSize.textContent = text;
}

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
  mapCastWindowSizeShow();
  castEnableRow.title = I18N(CAST.supported === false ? "settings.map.cast.unsupported.hover" : "settings.map.cast.enable.hover");
  // Everything else in the box only while Enable Casting is on (and it can cast)
  const linked = GT.settings.map.castEnable && CAST.supported;
  // The port changed while nothing is cast (a cast uses it)
  castPortRow.style.display = linked ? "" : "none";
  castPort.disabled = !linked || mapCastActive();
  // The software encoder's frame rate and resolution: only without a hardware encoder
  const software = linked && !CAST.hardware;
  for (const row of [castSoftwareFpsRow, castSoftwareSizeRow]) row.style.display = software ? "" : "none";
  // Lock Window Size: only with a hardware encoder (the software one has its Software Resolution)
  castLockRow.style.display = linked && CAST.hardware ? "" : "none";
  castLockSize.value = String(mapCastLockSize() ? GT.settings.map.castLockHeight : 0);
  // Announce On Network, and its Name only while it's on (not rewritten while being typed in)
  castAnnounceRow.style.display = linked ? "" : "none";
  castAnnounce.checked = GT.settings.map.castAnnounce === true;
  castAnnounceNameRow.style.display = linked && GT.settings.map.castAnnounce === true ? "" : "none";
  if (document.activeElement != castAnnounceName) castAnnounceName.value = mapCastAnnounceName();
  // The devices, and the two addresses (the plain stream, then HLS)
  castDevicesRow.style.display = linked ? "" : "none";
  if (linked) mapCastRenderDevices();
  castLinkHlsText.textContent = linked ? mapCastLink("map.m3u8") : "";
  castLinkStreamText.textContent = linked ? mapCastLink("map.ts") : "";
  for (const row of [castWatchRow, castLinkHlsRow, castLinkStreamRow]) row.style.display = linked && castLinkHlsText.textContent ? "" : "none";
  // The button enabled once a Cast device has been found (a right click looks again)
  const active = mapCastActive();
  const usable = CAST.devicesFound || active;
  castButton.style.display = GT.settings.map.castEnable && CAST.supported ? "" : "none";
  castButton.style.opacity = usable ? "" : "0.4";
  castButton.style.cursor = CAST.finding || mapCastPreparing() ? "progress" : usable ? "" : "default";
  // Radiating from a click until the device plays (mapCastBusy)
  castButton.classList.toggle("castBusy", mapCastBusy());
  castImg.style.filter = active ? "" : "grayscale(1)";
  // The devices played on, else the ones still waiting for the video
  const on = mapCastSessions().filter(mapCastOn);
  const waiting = mapCastSessions().filter((S) => S.waiting);
  // (with more than one device found, a click lists them instead of stopping)
  const many = CAST.foundCount > 1;
  if (on.length) castButton.title = I18N(many ? "gt.button.cast.onMany.hover" : "gt.button.cast.on.hover").replace("{0}", mapCastNames(on));
  else if (waiting.length) castButton.title = I18N(many ? "gt.button.cast.preparingMany.hover" : "gt.button.cast.preparing.hover").replace("{0}", mapCastNames(waiting));
  else castButton.title = I18N(CAST.devicesFound ? "gt.button.cast.hover" : "gt.button.cast.none.hover");
  // The badge: how many watch the map now, the devices cast to (connected) and anyone on the network watching the video, each address
  // once (a TV cast to also asks for the video)
  const watching = new Set(CAST.viewers);
  for (const S of on) watching.add(S.host);
  const count = GT.settings.map.castEnable && CAST.supported ? watching.size : 0;
  const text = count > 0 ? String(count) : "";
  if (castBadge.textContent != text) castBadge.textContent = text;
  castBadge.style.display = text ? "" : "none";
}

// Settings -> Features -> Casting -> Devices: the devices the last search found and any cast to that didn't answer it, each ticked while
// cast to (a click casts to it as well, or stops); the names come from the network, so they're set as text. Rebuilt only when it changes
function mapCastRenderDevices()
{
  const list = CAST.found.slice();
  for (const S of mapCastSessions())
  {
    if (!list.some((device) => mapCastSame(S, device))) list.push({ kind: S.kind, id: S.id, name: S.name, host: S.host, control: S.control, model: S.kind == "dlna" ? "DLNA" : "" });
  }
  const shown = JSON.stringify([CAST.finding > 0, list.map((device) => [device.kind, device.id, device.host, device.name, device.model, !!mapCastSessionOf(device)])]);
  if (castDeviceList.dataset.shown == shown) return;
  castDeviceList.dataset.shown = shown;
  const rows = list.map((device) =>
  {
    const row = document.createElement("label");
    row.className = "castDevice";
    row.title = device.host;
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = !!mapCastSessionOf(device);
    box.onchange = () => mapCastToggle(device);
    const name = document.createElement("span");
    name.textContent = device.name || device.host;
    row.append(box, name);
    if (device.model)
    {
      const kind = document.createElement("span");
      kind.className = "castDeviceKind";
      kind.textContent = device.model;
      row.append(kind);
    }
    return row;
  });
  if (!rows.length)
  {
    const none = document.createElement("div");
    none.className = "castDeviceNone";
    none.textContent = I18N(CAST.finding ? "settings.map.cast.searching.label" : "settings.map.cast.noDevices.label");
    rows.push(none);
  }
  castDeviceList.replaceChildren(...rows);
  castSearchButton.textContent = I18N(CAST.finding ? "settings.map.cast.searching.label" : "settings.map.cast.search.label");
}

// Search (and the Features tab shown): the devices looked for again, listed once found
async function mapCastSearchClick()
{
  if (CAST.finding || !GT.settings.map.castEnable || !CAST.supported) return;
  await mapCastSearch(CAST_FIND_MS, null);
}

function mapCastEnableChanged()
{
  GT.settings.map.castEnable = castEnable.checked;
  mapCastPortReset();
  nodeTimers.clearTimeout(CAST.portTimer);
  CAST.portTimer = null;
  if (GT.settings.map.castEnable)
  {
    mapCastServe();
    mapCastDiscover();
  }
  else
  {
    mapCastResumeCancel();
    CAST.finding = 0;
    nodeTimers.clearTimeout(CAST.discoverTimer);
    CAST.discoverTimer = null;
    CAST.devicesFound = false;
    // (DLNA players watching without a cast told to stop as well: the video goes away)
    for (const control of mapCastDlnaWatching(false)) mapCastSoap(control, "Stop", { InstanceID: 0 }).catch((e) => mapCastLog(control + ": stop " + e.message));
    CAST.found = [];
    mapCastStop();
    // (nothing to cast to again at the next start)
    GT.settings.map.castDevices = [];
    mapCastUnserve();
  }
  mapCastRender();
}

// An event about the cast (key: its text, {0} the device's name or names, {1} more), an error's or a warning's color when it's one
function mapCastEvent(key, error, more = "", warning = false, name = "")
{
  const color = error ? "--gt-error" : warning ? "--gt-warning" : "--gt-label";
  addEvent("cast", "<font style='color:var(" + color + ")'>" + htmlEntities(I18N(key).replace("{0}", name).replace("{1}", more)) + "</font>", error);
}

function mapCastDeviceLabel(device)
{
  const name = device.name || device.host;
  return device.model ? name + " (" + device.model + ")" : name;
}

// Casting to device as well (kept for the next start), and it remembered as the one picked last (a click's when none answers, and the
// link's address in Settings)
function mapCastTo(device)
{
  const control = device.kind == "dlna" ? device.control || "" : "";
  GT.settings.map.castDevice = { id: device.id || "", name: device.name || "", host: device.host, kind: control ? "dlna" : "cast", control };
  mapCastStart(device.host, device.name || device.host, device.id || "", true, control);
  mapCastLinkAddress();
}

// A device in the Casting box's list ticked (cast to it as well) or unticked (no longer)
function mapCastToggle(device)
{
  const S = mapCastSessionOf(device);
  if (S) mapCastStopOne(S);
  else mapCastTo(device);
  mapCastRender();
}

// Whether any device answered a search (the Cast button enabled), those devices listed in the Casting box; none: looked for again in a
// while
function mapCastFound(devices)
{
  CAST.devicesFound = devices.length > 0;
  CAST.foundCount = devices.length;
  CAST.found = devices;
  nodeTimers.clearTimeout(CAST.discoverTimer);
  CAST.discoverTimer = !CAST.devicesFound && GT.settings.map.castEnable ? nodeTimers.setTimeout(mapCastDiscover, CAST_DISCOVER_RETRY_MS) : null;
  mapCastRender();
}

// The Cast devices looked for (while Enable Casting is on), until one is found
async function mapCastDiscover()
{
  nodeTimers.clearTimeout(CAST.discoverTimer);
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

// A click: with more than one device found, they're listed (as a right click does), to cast to any of them; with one, it's cast to, or
// casting stops (at once, while only one was found last)
async function mapCastButtonClick()
{
  if (CAST.finding) return;
  if (mapCastActive() && CAST.foundCount <= 1)
  {
    mapCastStop();
    return;
  }
  if (!CAST.devicesFound && !mapCastActive()) return;
  const devices = await mapCastSearch(CAST_MENU_FIND_MS, null);
  if (!devices) return;
  if (devices.length > 1)
  {
    mapCastDeviceMenu(devices);
    return;
  }
  if (mapCastActive())
  {
    mapCastStop();
    return;
  }
  // None found: tried where the one picked last was (it may not answer the search from there)
  const saved = GT.settings.map.castDevice;
  const device = devices[0] || (saved.host ? saved : null);
  if (device) mapCastTo(device);
  else mapCastEvent("cast.event.noDevice", true);
}

async function mapCastButtonMenu(event)
{
  event.preventDefault();
  if (CAST.finding) return;
  const devices = await mapCastSearch(CAST_MENU_FIND_MS, null);
  if (devices) mapCastDeviceMenu(devices);
}

// The devices found, each with a checkbox (ticked while cast to): ticking one casts to it as well, unticking stops it; and Stop Casting
// (every device) while casting
function mapCastDeviceMenu(devices)
{
  const menu = new Menu();
  for (const device of devices)
  {
    menu.append(new MenuItem({
      label: mapCastDeviceLabel(device),
      type: "checkbox",
      checked: !!mapCastSessionOf(device),
      click: () => mapCastToggle(device)
    }));
  }
  // Cast to but not answering this search: listed too, ticked, so each can be stopped
  for (const S of mapCastSessions())
  {
    if (devices.some((d) => mapCastSame(S, d))) continue;
    menu.append(new MenuItem({ label: S.name, type: "checkbox", checked: true, click: () => mapCastStopOne(S) }));
  }
  if (!devices.length && !mapCastActive()) menu.append(new MenuItem({ label: I18N("cast.menu.none.label"), enabled: false }));
  if (mapCastActive())
  {
    menu.append(new MenuItem({ type: "separator" }));
    menu.append(new MenuItem({ label: I18N("cast.menu.stop.label"), click: () => mapCastStop() }));
  }
  menu.popup();
}
