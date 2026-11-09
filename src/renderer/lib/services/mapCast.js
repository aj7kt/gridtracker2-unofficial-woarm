// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// Map Cast (Settings -> General -> Display -> Enable Casting, and the button panel's Cast button: at the end): the map as the main window
// shows it, sent to a Google Cast device (the Google TV Streamer) as a live video.
//   The frames: while the device is watching, the main window captures itself, cut to #main (the map and what's over it) by Element
//   Capture, at up to 30 frames a second, scaled on the GPU to the video's size; the window is snapped to 16:9 while casting (the main
//   process: 'mapCastSnap'). The capture goes to mapCastWorker.js, which encodes it (H.264, on a hardware encoder only) and serves the
//   video (an endless fragmented MP4) from a small HTTP server on the address the device is reached from. Nothing here per frame.
//   The device: Google's Default Media Receiver (no receiver app of our own to register or host), told over the Cast protocol to play
//   that URL as a LIVE stream.
//   The Cast protocol (CASTV2): TLS to port 8009 (the device's certificate is its own: not checked), each message a 4-byte big-endian
//   length and a CastMessage protobuf (protocol version, source, destination, namespace, payload type, JSON payload). CONNECT to the
//   receiver, PING/PONG every few seconds, LAUNCH the app, CONNECT to its transport, then LOAD on the media namespace.
// mapCastFind() lists the Cast devices on the network (mDNS); mapCastSupported(), mapCastStart(host), mapCastStop(), mapCastStatus() (the
// console's too)

const CAST_PORT = 8009;
const CAST_APP_DEFAULT_MEDIA = "CC1AD845";
const CAST_NS_CONNECTION = "urn:x-cast:com.google.cast.tp.connection";
const CAST_NS_HEARTBEAT = "urn:x-cast:com.google.cast.tp.heartbeat";
const CAST_NS_RECEIVER = "urn:x-cast:com.google.cast.receiver";
const CAST_NS_MEDIA = "urn:x-cast:com.google.cast.media";
const CAST_PING_MS = 5000;
// The window's relayout after it is snapped to 16:9, waited for before the video's size is taken
const CAST_SNAP_WAIT_MS = 500;
// The video's largest size (a smaller map is sent at its own size: the device scales it)
const CAST_MAX_WIDTH = 1920;
const CAST_MAX_HEIGHT = 1080;
// H.264 High, level 4.0 (1920x1080 at up to 30 fps), only on a hardware encoder: without one, no casting (mapCastSupported)
const CAST_CODEC = "avc1.640028";
const CAST_FPS = 30;
// A fixed quantizer, not a bitrate: a bitrate's encoder spends what's left of it re-sending the unchanged map, this one sends only
// what changed (next to nothing for a still map; a key frame ~200 KB)
const CAST_QP = 20;
// A message bigger than this is taken as the stream gone wrong (the protocol's own limit is 64 KiB)
const CAST_MESSAGE_MAX = 65536;
const CAST_LOG_LINES = 40;
// How long the Cast devices are listened for: by the button (done as soon as the one wanted answers), and by its menu
const CAST_FIND_MS = 2500;
const CAST_MENU_FIND_MS = 1500;

const CAST = {
  // Whether this computer can cast (mapCastSupported), null until known
  supported: null,
  // A search for devices under way (its number), 0 when none
  finding: 0,
  host: "",
  name: "",
  socket: null,
  input: Buffer.alloc(0),
  localAddress: "",
  worker: null,
  port: 0,
  codec: "",
  width: 0,
  height: 0,
  clients: 0,
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

// What is cast (#main, the map and what's over it: the whole window while casting, mapCastCapture), in the screen's pixels
function mapCastMainSize()
{
  const scale = window.devicePixelRatio || 1;
  return { width: Math.round(window.innerWidth * scale), height: Math.round(window.innerHeight * scale) };
}

// width x height scaled to fit in the box (only down, unless grow), even sizes (the encoder's)
function mapCastFit(width, height, boxWidth, boxHeight, grow)
{
  const scale = grow ? Math.min(boxWidth / width, boxHeight / height) : Math.min(1, boxWidth / width, boxHeight / height);
  return { width: Math.max(2, Math.min(boxWidth, Math.floor((width * scale) / 2) * 2)), height: Math.max(2, Math.min(boxHeight, Math.floor((height * scale) / 2) * 2)) };
}

// The video worker's VideoEncoder config (mapCastWorker.js): length-prefixed NAL units ("avc"), as an MP4 carries them
function mapCastEncoderConfig(width, height)
{
  return { codec: CAST_CODEC, width: width, height: height, bitrateMode: "quantizer", framerate: CAST_FPS, latencyMode: "realtime", hardwareAcceleration: "prefer-hardware", avc: { format: "avc" } };
}

// Whether this computer can cast: Element Capture, and a hardware encoder for the video
async function mapCastSupported(width = CAST_MAX_WIDTH, height = CAST_MAX_HEIGHT)
{
  if (typeof VideoEncoder == "undefined" || typeof RestrictionTarget == "undefined" || !navigator.mediaDevices?.getDisplayMedia) return false;
  const support = await VideoEncoder.isConfigSupported(mapCastEncoderConfig(width, height)).catch(() => null);
  return !!support?.supported;
}

// Casting to host (name: what the user calls it, in the Event Viewer and the button's tooltip)
async function mapCastStart(host, name = "")
{
  mapCastStop();
  CAST.host = String(host || "").trim();
  CAST.name = name || CAST.host;
  if (!CAST.host) return "no host";
  if (!(await mapCastSupported())) return "can't cast here: no hardware video encoder (or no Element Capture)";
  CAST.snapped = await electron.ipcRenderer.invoke("mapCastSnap", true);
  if (CAST.snapped) await new Promise((resolve) => setTimeout(resolve, CAST_SNAP_WAIT_MS));
  const main = mapCastMainSize();
  if (main.width <= 0 || main.height <= 0)
  {
    mapCastStop();
    return "no map";
  }
  // The video's size, fixed while casting (the capture is cropped and scaled to it)
  const size = mapCastFit(main.width, main.height, CAST_MAX_WIDTH, CAST_MAX_HEIGHT, false);
  CAST.width = size.width;
  CAST.height = size.height;
  CAST.log = [];
  CAST.clients = 0;
  CAST.stats = null;
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
    mapCastWorkerStart();
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
  return "connecting to " + CAST.host;
}

function mapCastStop()
{
  mapCastGrab(false);
  if (CAST.snapped) electron.ipcRenderer.invoke("mapCastSnap", false);
  CAST.snapped = false;
  clearInterval(CAST.pingTimer);
  CAST.pingTimer = null;
  const socket = CAST.socket;
  CAST.socket = null;
  if (socket && !socket.destroyed)
  {
    if (CAST.sessionId) socket.write(mapCastEncode("sender-0", "receiver-0", CAST_NS_RECEIVER, { type: "STOP", sessionId: CAST.sessionId, requestId: ++CAST.requestId }));
    socket.end();
  }
  // It closes itself once its server and encoder are closed (ended here if it hasn't by then)
  const worker = CAST.worker;
  CAST.worker = null;
  if (worker)
  {
    worker.postMessage({ type: "stop" });
    setTimeout(() => worker.terminate(), 2000);
  }
  CAST.port = 0;
  CAST.clients = 0;
  CAST.transportId = "";
  CAST.sessionId = "";
  mapCastRender();
  return "stopped";
}

function mapCastStatus()
{
  return {
    host: CAST.host,
    connected: !!CAST.socket,
    url: CAST.port ? "http://" + CAST.localAddress + ":" + CAST.port + "/map.mp4" : "",
    codec: CAST.codec,
    transportId: CAST.transportId,
    playerState: CAST.playerState,
    viewers: CAST.clients,
    grabbing: CAST.grabbing,
    worker: CAST.stats,
    log: CAST.log
  };
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
      CAST.codec = msg.codec;
      mapCastLog("serving " + msg.codec + " on port " + msg.port);
      if (CAST.transportId) mapCastLoad();
    }
    else if (msg.type == "clients")
    {
      CAST.clients = msg.count;
      // Frames only while someone watches
      mapCastGrab(msg.count > 0);
    }
    else if (msg.type == "stats") CAST.stats = msg;
    else if (msg.type == "log") mapCastLog("worker: " + msg.text);
    else if (msg.type == "error")
    {
      mapCastLog("worker error " + msg.text);
      mapCastEvent("cast.event.failed", true);
      mapCastStop();
    }
  };
  worker.onerror = (e) => mapCastLog("worker error " + e.message);
  worker.postMessage({ type: "start", address: CAST.localAddress, config: mapCastEncoderConfig(CAST.width, CAST.height), quantizer: CAST_QP });
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
    mapCastSend(CAST.transportId, CAST_NS_CONNECTION, { type: "CONNECT" });
    mapCastLog("receiver ready");
    if (CAST.port) mapCastLoad();
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

// The capture of #main started (handed to the worker) or stopped: only while someone watches
async function mapCastGrab(on)
{
  if (on && CAST.worker && !CAST.grabbing)
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
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: CAST_FPS }, audio: false, preferCurrentTab: true });
  const track = stream.getVideoTracks()[0];
  CAST.track = track;
  await track.restrictTo(await RestrictionTarget.fromElement(element));
  await track.applyConstraints({ width: CAST.width, height: CAST.height, frameRate: CAST_FPS, resizeMode: "crop-and-scale" });
  if (!CAST.worker || CAST.track != track)
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

function mapCastLoad()
{
  const url = "http://" + CAST.localAddress + ":" + CAST.port + "/map.mp4";
  mapCastSend(CAST.transportId, CAST_NS_MEDIA, { type: "LOAD", requestId: ++CAST.requestId, sessionId: CAST.sessionId, autoplay: true, media: { contentId: url, contentType: "video/mp4", streamType: "LIVE" } });
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
  mapCastRender();
}

function mapCastRender()
{
  // Only where it can cast (a hardware video encoder): the setting is kept as it is, but can't be changed, and the button stays hidden
  castEnable.checked = GT.settings.map.castEnable;
  castEnable.disabled = CAST.supported === false;
  castEnableRow.title = I18N(CAST.supported === false ? "settings.map.cast.unsupported.hover" : "settings.map.cast.hover");
  castButton.style.display = GT.settings.map.castEnable && CAST.supported ? "" : "none";
  castButton.style.cursor = CAST.finding ? "progress" : "";
  castImg.style.filter = CAST.socket ? "" : "grayscale(1)";
  castButton.title = CAST.socket ? I18N("gt.button.cast.on.hover").replace("{0}", CAST.name) : I18N("gt.button.cast.hover");
}

function mapCastEnableChanged()
{
  GT.settings.map.castEnable = castEnable.checked;
  if (!GT.settings.map.castEnable)
  {
    CAST.finding = 0;
    mapCastStop();
  }
  mapCastRender();
}

// An event about the cast (key: its text, {0} the device's name)
function mapCastEvent(key, error)
{
  addEvent("cast", "<font style='color:var(" + (error ? "--gt-error" : "--gt-label") + ")'>" + htmlEntities(I18N(key).replace("{0}", CAST.name)) + "</font>", error);
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
  mapCastRender();
  return devices;
}

async function mapCastButtonClick()
{
  if (CAST.socket || CAST.finding)
  {
    CAST.finding = 0;
    mapCastStop();
    return;
  }
  const saved = GT.settings.map.castDevice;
  const wanted = saved.id || saved.host ? mapCastIsSaved : () => true;
  const devices = await mapCastSearch(CAST_FIND_MS, wanted);
  if (!devices) return;
  // Not found: tried where it was (it may not answer the search from there)
  const device = devices.find(wanted) || (saved.host ? saved : null);
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
  if (!devices) return;
  const menu = new Menu();
  for (const device of devices)
  {
    menu.append(new MenuItem({
      label: mapCastDeviceLabel(device),
      type: "checkbox",
      checked: mapCastIsSaved(device),
      click: () =>
      {
        if (!(CAST.socket && CAST.host == device.host)) mapCastTo(device);
      }
    }));
  }
  if (!devices.length) menu.append(new MenuItem({ label: I18N("cast.menu.none.label"), enabled: false }));
  if (CAST.socket)
  {
    menu.append(new MenuItem({ type: "separator" }));
    menu.append(new MenuItem({ label: I18N("cast.menu.stop.label"), click: () => mapCastStop() }));
  }
  menu.popup();
}
