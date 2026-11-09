// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// Network audio over the "simple protocol" (netAudio.js' protocol "pulse"): raw PCM over a plain TCP connection, served by
// PulseAudio's module-simple-protocol-tcp and PipeWire's module-protocol-simple (pipewire-pulse also takes the PulseAudio module's
// name and arguments). The server listens; GridTracker2 connects to it, for either direction.
//   There is no header and no handshake: from the moment the connection is up the bytes are interleaved samples, signed 16-bit
//   little-endian (s16le), in the server's configured rate and channel count. Nothing tells the client what those are, so the stream's
//   rate and channels must be set to match the server's (a mismatch plays at the wrong speed or as noise: the data rate is measured
//   and a mismatch said in the status line). Both modules default to 16-bit; only s16le is supported here.
//   PipeWire (module-protocol-simple): server.address default "tcp:4711"; audio.rate 44100, audio.channels 2, audio.format S16 by
//   default; "capture = true" sends the client audio (with capture.props media.class = Audio/Sink: a sink of its own that programs
//   play into), "playback = true" takes audio from the client (playback.props media.class = Audio/Source: a source programs record
//   from). Neither is on by default. A client that doesn't read fast enough loses what couldn't be sent (no disconnect).
//   PulseAudio (module-simple-protocol-tcp): port 4711, listening on every interface unless listen= is given; rate, format and
//   channels default to the daemon's own sample spec (default-sample-rate, often 44100); record=false and playback=true by default;
//   source= / sink= pick the device; at most 10 connections. A recording client is buffered up to 5 s; a playing client is read only
//   as its sink needs more (0.5 s queue), so TCP itself paces the sender.
//   With both directions on, one connection carries both: the server sends capture audio and takes playback audio on the same
//   socket. So handles to the same server (same host, port, rate and channels) share one connection here, and that connection
//   always reads: what comes in is given to the "in" handles, or thrown away when there are none (an "out" handle never lets it
//   pile up), and only "out" handles write to it.
// A connection is retried every 3 s while any handle wants it: refused, closed, or (an input) silent for long after audio flowed

const PULSE_RETRY_MS = 3000;
const PULSE_CONNECT_TIMEOUT_MS = 5000;
const PULSE_WATCH_MS = 500;
// No audio this long (an input): said in the status line
const PULSE_STALL_MS = 2000;
// No audio this long after it had flowed: the server's stream taken as gone, the connection made again
const PULSE_DEAD_MS = 15000;
// Buffered output beyond this many seconds of audio: the next chunks are dropped
const PULSE_BACKLOG_SECONDS = 1;
// Nothing of the output taken by the server for this long while some is waiting: the connection made again
const PULSE_STUCK_MS = 10000;
// How long "dropping" stays in the status line after the last chunk dropped
const PULSE_DROP_SHOW_MS = 3000;
// The data rate measured over this window, starting this long after the first audio (the start may come in a burst)
const PULSE_MEASURE_SKIP_MS = 2000;
const PULSE_MEASURE_MS = 10000;
// A measured rate this far off the set one (a share of it) is a mismatch
const PULSE_RATE_TOLERANCE = 0.04;

// Open connections, by host, port, rate and channels
const PULSE_CONNECTIONS = new Map();

NET_AUDIO_PROTOCOLS.pulse = {
  name: "PipeWire / PulseAudio (TCP)",
  // Its port is a TCP one (the box says so)
  tcp: true,
  dirs: ["in", "out"],
  fields: { in: ["host", "port", "rate", "channels", "channel"], out: ["host", "port", "rate", "channels"] },
  // The port both modules listen on by default. The rate the user guide's server lines set (both servers default to their own,
  // 44.1 kHz for PipeWire's module): it must match the server's either way
  defaults: { host: "", port: 4711, rate: 48000, channels: 2, channel: "left" },
  open: (stream, dir, sink) => netAudioPulseOpen(stream, dir, sink)
};

// One stream's handle, on the connection to its server (a new one, or one another handle already has)
function netAudioPulseOpen(stream, dir, sink)
{
  const host = String(stream.host || "").trim();
  const port = Number(stream.port) || NET_AUDIO_PROTOCOLS.pulse.defaults.port;
  const rate = Number(stream.rate) || NET_AUDIO_PROTOCOLS.pulse.defaults.rate;
  const channels = Number(stream.channels) == 1 ? 1 : 2;
  const handle = { dir: dir, sink: sink, conn: null, channel: stream.channel || "left", shownText: null, shownError: null };
  handle.stop = () => netAudioPulseStop(handle);
  handle.write = (samples) => netAudioPulseWrite(handle, samples);
  if (dir == "out") handle.rate = rate;
  if (!host)
  {
    netAudioPulseTell(handle, I18N("netAudio.pulse.noHost"), true);
    return handle;
  }
  const key = host + "|" + port + "|" + rate + "|" + channels;
  let conn = PULSE_CONNECTIONS.get(key);
  if (!conn)
  {
    conn = {
      key: key,
      host: host,
      port: port,
      rate: rate,
      channels: channels,
      frameBytes: channels * 2,
      handles: new Set(),
      socket: null,
      connected: false,
      connectedAt: 0,
      error: null,
      retryTimer: null,
      connectTimer: null,
      watchTimer: null,
      rest: null,
      firstData: 0,
      lastData: 0,
      measureStart: 0,
      measureBytes: 0,
      rateNote: null,
      queuedBytes: 0,
      sentBytes: 0,
      sentAt: 0,
      sentAny: false,
      dropAt: 0
    };
    PULSE_CONNECTIONS.set(key, conn);
    netAudioPulseConnect(conn);
    conn.watchTimer = nodeTimers.setInterval(() => netAudioPulseWatch(conn), PULSE_WATCH_MS);
  }
  handle.conn = conn;
  conn.handles.add(handle);
  netAudioPulseShow(conn);
  return handle;
}

// A handle let go: the connection closed with the last one
function netAudioPulseStop(handle)
{
  const conn = handle.conn;
  handle.conn = null;
  if (!conn || !conn.handles.delete(handle) || conn.handles.size) return;
  PULSE_CONNECTIONS.delete(conn.key);
  nodeTimers.clearInterval(conn.watchTimer);
  nodeTimers.clearTimeout(conn.retryTimer);
  nodeTimers.clearTimeout(conn.connectTimer);
  conn.watchTimer = conn.retryTimer = conn.connectTimer = null;
  const socket = conn.socket;
  conn.socket = null;
  conn.connected = false;
  if (socket) socket.destroy();
}

// The TCP connection to the server, made (again). Everything it tracks starts over: a new connection is a new stream
function netAudioPulseConnect(conn)
{
  conn.retryTimer = null;
  if (!PULSE_CONNECTIONS.has(conn.key) || conn.socket) return;
  conn.rest = null;
  conn.firstData = conn.lastData = conn.measureStart = conn.measureBytes = 0;
  conn.rateNote = null;
  conn.queuedBytes = conn.sentBytes = 0;
  conn.sentAt = Date.now();
  conn.sentAny = false;
  conn.dropAt = 0;
  const net = window.require("net");
  const socket = new net.Socket();
  conn.socket = socket;
  socket.on("connect", () =>
  {
    if (conn.socket !== socket) return;
    nodeTimers.clearTimeout(conn.connectTimer);
    conn.connectTimer = null;
    conn.connected = true;
    conn.error = null;
    conn.connectedAt = conn.sentAt = Date.now();
    // Small writes go out as they are made; a server gone without a word is found by the keepalive
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 5000);
    netAudioPulseShow(conn);
  });
  socket.on("data", (data) => { if (conn.socket === socket) netAudioPulseReceive(conn, data); });
  socket.on("error", (e) =>
  {
    if (conn.socket !== socket) return;
    conn.error = e.message;
  });
  socket.on("close", () =>
  {
    if (conn.socket !== socket) return;
    nodeTimers.clearTimeout(conn.connectTimer);
    conn.connectTimer = null;
    conn.socket = null;
    conn.connected = false;
    if (!conn.error) conn.error = I18N("netAudio.pulse.closed").replace("{host}", conn.host);
    netAudioPulseShow(conn);
    if (PULSE_CONNECTIONS.has(conn.key)) conn.retryTimer = nodeTimers.setTimeout(() => netAudioPulseConnect(conn), PULSE_RETRY_MS);
  });
  // A server that doesn't answer at all (a host that's off, a firewall dropping it): given up on, and tried again
  conn.connectTimer = nodeTimers.setTimeout(() =>
  {
    conn.connectTimer = null;
    if (conn.socket === socket && !conn.connected) socket.destroy(new Error(I18N("netAudio.pulse.noAnswer").replace("{host}", conn.host + ":" + conn.port)));
  }, PULSE_CONNECT_TIMEOUT_MS);
  socket.connect(conn.port, conn.host);
  netAudioPulseShow(conn);
}

// Bytes from the server: whole frames to every "in" handle, the part of a frame a chunk ends with kept for the next one. With no
// "in" handle the frames are only counted (the stream stays aligned for one that comes later) and thrown away
function netAudioPulseReceive(conn, data)
{
  const now = Date.now();
  const resumed = !conn.lastData || now - conn.lastData >= PULSE_STALL_MS;
  if (!conn.firstData) conn.firstData = now;
  conn.lastData = now;
  netAudioPulseMeasure(conn, now, data.length, resumed);
  let bytes = data;
  if (conn.rest)
  {
    bytes = Buffer.concat([conn.rest, data]);
    conn.rest = null;
  }
  const frames = Math.floor(bytes.length / conn.frameBytes);
  const used = frames * conn.frameBytes;
  // A copy, so the chunk itself can go
  if (used < bytes.length) conn.rest = Buffer.from(bytes.subarray(used));
  if (resumed) netAudioPulseShow(conn);
  if (!frames) return;
  for (const handle of conn.handles)
  {
    if (handle.dir != "in") continue;
    const samples = netAudioPulseMono(bytes, frames, conn.channels, handle.channel);
    try
    {
      handle.sink.pcm(samples, conn.rate);
    }
    catch (e)
    {
      // The listener gone (its window closed): it stops its handle itself
    }
  }
}

// Interleaved s16le frames to mono samples (±1): the left or right channel of a stereo stream, or both mixed
function netAudioPulseMono(bytes, frames, channels, channel)
{
  const samples = new Float32Array(frames);
  if (channels == 1)
  {
    for (let i = 0; i < frames; i++) samples[i] = bytes.readInt16LE(i * 2) / 32768;
  }
  else if (channel == "mix")
  {
    for (let i = 0; i < frames; i++) samples[i] = (bytes.readInt16LE(i * 4) + bytes.readInt16LE(i * 4 + 2)) / 65536;
  }
  else
  {
    const offset = channel == "right" ? 2 : 0;
    for (let i = 0; i < frames; i++) samples[i] = bytes.readInt16LE(i * 4 + offset) / 32768;
  }
  return samples;
}

// The data rate, over a window after the first audio (and again after a stall: what was held back may come at once). Measured
// once a connection; a rate well off the set one is said in the status line, since nothing else would tell
function netAudioPulseMeasure(conn, now, length, resumed)
{
  if (conn.rateNote !== null || conn.measureStart < 0) return;
  if (resumed)
  {
    conn.firstData = now;
    conn.measureStart = 0;
    conn.measureBytes = 0;
    return;
  }
  if (!conn.measureStart)
  {
    if (now - conn.firstData >= PULSE_MEASURE_SKIP_MS)
    {
      conn.measureStart = now;
      conn.measureBytes = 0;
    }
    return;
  }
  conn.measureBytes += length;
  if (now - conn.measureStart < PULSE_MEASURE_MS) return;
  const measured = conn.measureBytes / conn.frameBytes / ((now - conn.measureStart) / 1000);
  // Done for this connection either way
  conn.measureStart = -1;
  if (Math.abs(measured / conn.rate - 1) <= PULSE_RATE_TOLERANCE) return;
  conn.rateNote = I18N("netAudio.pulse.rateMismatch").replace("{measured}", netAudioPulseKhz(measured)).replace("{rate}", netAudioPulseKhz(conn.rate));
  netAudioPulseShow(conn);
}

// Mono samples from an "out" handle to the server: s16le, the sample in every channel. Dropped while not connected, and while the
// server is more than a second behind (it isn't reading: a stalled server, or one with playback off)
function netAudioPulseWrite(handle, samples)
{
  const conn = handle.conn;
  if (!conn || handle.dir != "out" || !conn.connected || !conn.socket || !samples || !samples.length) return;
  const socket = conn.socket;
  if (socket.writableLength > conn.rate * conn.frameBytes * PULSE_BACKLOG_SECONDS)
  {
    const wasDropping = Date.now() - conn.dropAt < PULSE_DROP_SHOW_MS;
    conn.dropAt = Date.now();
    if (!wasDropping) netAudioPulseShow(conn);
    return;
  }
  const n = samples.length;
  const bytes = Buffer.alloc(n * conn.frameBytes);
  for (let i = 0; i < n; i++)
  {
    const value = Math.round(Math.max(-1, Math.min(1, samples[i] || 0)) * 32767);
    bytes.writeInt16LE(value, i * conn.frameBytes);
    if (conn.channels == 2) bytes.writeInt16LE(value, i * conn.frameBytes + 2);
  }
  conn.queuedBytes += bytes.length;
  socket.write(bytes);
  if (!conn.sentAny)
  {
    conn.sentAny = true;
    netAudioPulseShow(conn);
  }
}

// Twice a second: a stalled input said (once), a dead one made again, the output's dropping cleared from the status line, and an
// output the server has stopped taking made again
function netAudioPulseWatch(conn)
{
  if (!conn.connected || !conn.socket) return;
  const now = Date.now();
  let hasIn = false;
  for (const handle of conn.handles) if (handle.dir == "in") hasIn = true;
  if (hasIn && conn.lastData && now - conn.lastData >= PULSE_DEAD_MS)
  {
    conn.socket.destroy(new Error(I18N("netAudio.pulse.stopped").replace("{host}", conn.host)));
    return;
  }
  const waiting = conn.socket.writableLength;
  const sent = conn.queuedBytes - waiting;
  if (sent != conn.sentBytes || !waiting)
  {
    conn.sentBytes = sent;
    conn.sentAt = now;
  }
  else if (now - conn.sentAt >= PULSE_STUCK_MS)
  {
    conn.socket.destroy(new Error(I18N("netAudio.pulse.notTaking").replace("{host}", conn.host)));
    return;
  }
  netAudioPulseShow(conn);
}

// Every handle's status line, from its connection's state (a handle is told only when its line changes)
function netAudioPulseShow(conn)
{
  const now = Date.now();
  const where = conn.host + ":" + conn.port;
  const format = netAudioPulseKhz(conn.rate) + ", " + conn.channels + " ch, 16-bit";
  for (const handle of conn.handles)
  {
    let text;
    let error = false;
    if (!conn.connected)
    {
      text = conn.error || I18N("netAudio.pulse.connecting").replace("{host}", where);
      error = !!conn.error;
    }
    else if (handle.dir == "in")
    {
      if (conn.rateNote)
      {
        text = conn.rateNote;
        error = true;
      }
      else if (conn.lastData && now - conn.lastData < PULSE_STALL_MS)
      {
        text = I18N("netAudio.pulse.receiving").replace("{format}", format).replace("{host}", where);
      }
      else if (conn.lastData)
      {
        text = I18N("netAudio.pulse.noAudio").replace("{seconds}", Math.round(PULSE_STALL_MS / 1000));
        error = true;
      }
      else if (now - conn.connectedAt < PULSE_STALL_MS)
      {
        text = I18N("netAudio.pulse.waiting").replace("{host}", where);
      }
      else
      {
        // Connected, and nothing has ever come: the server isn't sending (PulseAudio's record is off by default)
        text = I18N("netAudio.pulse.noCapture").replace("{host}", where);
        error = true;
      }
    }
    else if (now - conn.dropAt < PULSE_DROP_SHOW_MS)
    {
      text = I18N("netAudio.pulse.dropping");
      error = true;
    }
    else if (conn.sentAny)
    {
      text = I18N("netAudio.pulse.sending").replace("{format}", format).replace("{host}", where);
    }
    else
    {
      text = I18N("netAudio.pulse.connected").replace("{host}", where);
    }
    netAudioPulseTell(handle, text, error);
  }
}

function netAudioPulseTell(handle, text, error)
{
  if (handle.shownText === text && handle.shownError === error) return;
  handle.shownText = text;
  handle.shownError = error;
  try
  {
    handle.sink.status(text, error);
  }
  catch (e)
  {
    // The listener gone (its window closed): it stops its handle itself
  }
}

// A rate as "48 kHz", "44.1 kHz"
function netAudioPulseKhz(rate)
{
  return Number((rate / 1000).toFixed(1)) + " kHz";
}
