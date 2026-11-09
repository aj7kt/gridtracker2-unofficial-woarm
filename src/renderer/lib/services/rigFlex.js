// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// A FlexRadio (FLEX-6000 / 8000 series, SmartSDR) as a Rig Control VFO (its protocol "flex", rig.js): rig control over the SmartSDR TCP
// API, and the radio's audio both ways over DAX for the Multi-Mode Decoder (netAudio.js lists it in the decoder's device menus).
//   The API (TCP port 4992, text lines ending with a newline): the radio first says its protocol version ("V1.4.0.0") and this client's
//   handle ("H7A3B1234", hex). Each command goes as "C<seq>|<command>" and is answered, once, as "R<seq>|<code in hex>|<message>" (code 0:
//   done; the message a stream's id, a list ...). Status comes as "S<handle>|<object> <key=value> ..." for what was subscribed to (sub
//   slice all, sub client all, sub tx all), each time something changes, and on subscribing; messages as "M<code>|<text>". A space in a
//   value comes as 0x7F.
//   The slices (a slice is one receiver: its frequency in MHz, RF_frequency, its mode, whether it is the TX slice, its DAX channel) belong
//   to a GUI client (SmartSDR, Maestro ...). From firmware 3.0 several GUI clients can share the radio, and a client that isn't one (this
//   one, like DAX or CAT) is bound to one (client bind client_id=<its id>, from its "client <handle> connected ... client_id=..." status)
//   so its DAX channels are that client's. The first GUI client listed is the one bound; its slices are the VFOs. A radio with no GUI
//   client connected has no slices: SmartSDR must be running (or a Maestro on).
//   VFO-A is a slice of that client: the TX slice when first seen, else its first; it stays that slice while it is there. VFO-B (the second
//   VFO, dual) is the next slice of the same client: BirdWatch's uplink tunes it (setTx), and split puts the TX on it (slice set tx=1).
//   Modes: LSB USB AM SAM CW DIGL DIGU FM NFM DFM RTTY (and the waveforms' own, FDV ...). The data variants of USB, LSB and FM are DIGU,
//   DIGL and DFM, shown as USB-D, LSB-D and FM-D (as the CI-V rigs' data mode shows).
//   A ping each poll: its answer marks a whole read (rigReadWhole). Status is pushed, so the poll asks nothing else.
//   Discovery: each radio broadcasts a VITA-49 packet (class code 0xFFFF) about once a second to UDP port 4992, its payload key=value text
//   ("model=FLEX-6600 serial=... nickname=... ip=192.168.1.50 port=4992 ..."). An empty Host field uses the first radio heard.
// DAX audio (UDP, VITA-49, big-endian): the client says which UDP port it listens on (client udpport <port>), asks for a DAX RX stream of
// the channel VFO-A's slice is on (stream create type=dax_rx dax_channel=<n>; answered with the stream's id), and the radio sends it there:
// packets of IF data with a stream id and a class id, 28 bytes of header (header word, stream id, class id (OUI 0x001C2D, then
// 0x534C and the packet class code), integer and fractional timestamps), then the samples, at 24 kHz. Class 0x03E3: 32-bit floats,
// stereo (left, right in turn; DAX's audio is the same on both); class 0x0123 (the reduced-bandwidth DAX a client can ask for): 16-bit
// integers, mono. The header's 4-bit packet count shows packets lost. DAX TX (stream create type=dax_tx) goes the same way to the radio's
// UDP port 4991: 0x03E3 packets, 128 stereo frames each, as the audio comes. A slice without a DAX channel is given a free one (slice set
// dax=<n>), once a connection. The radio removes a client's streams when it disconnects; a handle stopped removes its own (stream remove).
// Firmware 2.x (before multiple GUI clients) has no client bind, and older stream commands: those are tried when the 3.x ones are refused

const FLEX_PORT = 4992;
const FLEX_VITA_PORT = 4991;
const FLEX_DISCOVERY_PORT = 4992;
// Where the radio may take a client's UDP registration datagram (SmartLink's way), tried once when no DAX comes after the TCP one
const FLEX_UDP_REGISTER_PORT = 4993;
const FLEX_OUI = 0x001c2d;
const FLEX_INFO_CLASS = 0x534c;
const FLEX_CLASS_DISCOVERY = 0xffff;
const FLEX_CLASS_DAX_FLOAT = 0x03e3;
const FLEX_CLASS_DAX_INT16 = 0x0123;
const FLEX_DAX_RATE = 24000;
// Stereo frames in each DAX TX packet (5.33 ms at 24 kHz)
const FLEX_TX_FRAMES = 128;
// How long a discovery listens for a radio (ms)
const FLEX_DISCOVERY_MS = 3000;
// The API silent this long (the pings unanswered: the radio switched off, the network gone) is a lost connection (ms)
const FLEX_SILENT_MS = 6000;
// The commands awaiting an answer kept at most (one never answered isn't kept for good)
const FLEX_PENDING_MAX = 200;
// The audio's check (ms): streams made and remade as the connection and the slices change; a refused stream tried again after
// FLEX_RETRY_MS; no packets for FLEX_NO_AUDIO_MS said so
const FLEX_AUDIO_TICK_MS = 500;
const FLEX_RETRY_MS = 3000;
const FLEX_NO_AUDIO_MS = 2000;
// A gap longer than this isn't filled (a stream started again); a silence longer than FLEX_LONG_GAP_MS is measured by its time
const FLEX_GAP_MAX_MS = 1000;
const FLEX_LONG_GAP_MS = 250;
// The DAX channels a radio has (the FLEX-6000s have 8)
const FLEX_DAX_CHANNELS = 8;
// The modes a slice can be set to, and their data variants
const FLEX_MODES = ["LSB", "USB", "AM", "SAM", "CW", "DIGL", "DIGU", "FM", "NFM", "DFM", "RTTY", "FDV"];
const FLEX_DATA_MODES = { USB: "DIGU", LSB: "DIGL", FM: "DFM" };
const FLEX_MODE_SHOW = { DIGU: "USB-D", DIGL: "LSB-D", DFM: "FM-D" };

RIG_PROTOCOLS.flex = {
  name: "FlexRadio SmartSDR",
  serial: false,
  portKey: "flexPort",
  portDefault: FLEX_PORT,
  // Its own open: the radio found on the LAN when no host is set
  open: (R, generation) => rigFlexOpen(R, generation),
  // A connection's state made new; nothing is sent until the radio has said this client's handle (rigFlexLine)
  caps: (R) =>
  {
    rigFlexReset(R);
    return null;
  },
  poll: (R) => rigFlexPoll(R),
  setFreq: (hz, R) => rigFlexTune(R, rigFlexSliceA(R), hz),
  setMode: (mode, R, data) => rigFlexSetMode(R, rigFlexSliceA(R), mode, data),
  setTx: (hz, R) => rigFlexTune(R, rigFlexSliceB(R), hz),
  setTxMode: (mode, R) => rigFlexSetMode(R, rigFlexSliceB(R), mode, undefined),
  // Split: the TX on VFO-B's slice (VFO-A stays the slice it is)
  splitOn: (R) =>
  {
    const B = rigFlexSliceB(R);
    return B ? rigFlexCmd(R, "slice set " + B.index + " tx=1") : null;
  },
  // The CTCSS tone of VFO-A's slice, or VFO-B's (side "b")
  setTone: (hz, R, side) =>
  {
    const slice = side == "b" ? rigFlexSliceB(R) : rigFlexSliceA(R);
    if (!slice) return null;
    return rigFlexCmd(R, "slice set " + slice.index + (hz > 0 ? " fm_tone_mode=CTCSS_TX fm_tone_value=" + Number(hz).toFixed(1) : " fm_tone_mode=OFF"));
  },
  canTone: () => true,
  setPtt: (on, R) => rigFlexPtt(R, on),
  parse: (line, R) => rigFlexLine(line, R),
  // DAX: the receive audio of VFO-A's slice, and audio to transmit
  audio: { name: "FlexRadio DAX", dirs: ["in", "out"], start: (R, dir, sink) => rigFlexAudioStart(R, dir, sink) }
};

// ---- The connection

// The TCP connection to the radio: to the host set, or (none set) to the first radio discovered. Settled once connected or failed (a
// failure is told through rigFail, for this connect only)
function rigFlexOpen(R, generation)
{
  const S = rigSettingsOf(R);
  const host = String(S.host || "").trim();
  const port = Number(S[RIG_PROTOCOLS.flex.portKey]) || FLEX_PORT;
  const fail = (message) => { if (generation == R.generation) rigFail(R, message); };
  const found = host ? Promise.resolve({ ip: host }) : rigFlexDiscover(FLEX_DISCOVERY_MS);
  return found.then((radio) =>
  {
    if (generation != R.generation) return;
    if (!radio)
    {
      fail(I18N("rig.flex.notFound"));
      return;
    }
    R.flexFound = host ? null : radio;
    return new Promise((resolve) =>
    {
      const net = window.require("net");
      const socket = new net.Socket();
      let connected = false;
      socket.setEncoding("utf8");
      socket.setNoDelay(true);
      socket.on("connect", () =>
      {
        if (generation != R.generation)
        {
          socket.destroy();
          resolve();
          return;
        }
        connected = true;
        R.link = {
          write: (data) => socket.write(data),
          destroy: () => socket.destroy(),
          flexIp: String(socket.remoteAddress || radio.ip).replace(/^::ffff:/, "")
        };
        rigConnected(R);
        resolve();
      });
      socket.on("data", (data) => { if (generation == R.generation) rigReceive(R, data); });
      socket.on("error", (e) =>
      {
        fail(e.message);
        resolve();
      });
      socket.on("close", () =>
      {
        if (connected) fail("closed");
        resolve();
      });
      socket.connect(host ? port : Number(radio.port) || port, radio.ip);
    });
  });
}

// A connection's own state (R.flexConn): a new object each connection, so what belongs to an older one (a stream, an answer) is told
// apart by it
function rigFlexReset(R)
{
  const ip = R.link ? R.link.flexIp || String(R.link.remoteAddress || "").replace(/^::ffff:/, "") : "";
  R.flexConn = {
    radioIp: ip || null,
    handle: null,         // this client's handle (the H line)
    version: null,        // the API's version (the V line)
    seq: 0,
    pending: new Map(),   // seq: what to do with its answer (code, message)
    lastLineAt: Date.now(),
    clients: {},          // by handle (a number): { handle, id, program, station }
    gui: null,            // the GUI client bound to (one of clients)
    bindAsked: false,
    slicesAsked: false,
    slicesKnown: false,   // the slices' status has come (sub slice all answered)
    slices: {},           // by index: { index, letter, freq (Hz), mode, tx, active, client, dax }
    sliceA: null,         // VFO-A's slice index, and VFO-B's
    sliceB: null,
    txDax: null,          // transmit's dax (DAX the TX audio's source), as the radio says it
    daxForced: false,     // dax turned on here for a transmission (turned off again after it)
    daxAssigned: false,   // a DAX channel given to VFO-A's slice on this connection
    udpPort: null,        // the UDP port told to the radio (client udpport)
    udpRegistered: false
  };
  R.dual = null;
  if (R.flexFound) R.model = rigFlexRadioName(R.flexFound);
}

// "FLEX-6600 Shack (192.168.1.50)": the radio discovered, as its VFO shows it
function rigFlexRadioName(radio)
{
  const nick = radio.nickname || radio.name || "";
  return (radio.model || "FlexRadio") + (nick ? " " + nick.replace(/_/g, " ") : "") + " (" + radio.ip + ")";
}

// A command, its sequence number its own: the text to send, its answer handed to done(code, message) when it comes
function rigFlexCmd(R, text, done = null)
{
  const C = R.flexConn;
  if (!C) return null;
  C.seq++;
  if (C.pending.size >= FLEX_PENDING_MAX) C.pending.delete(C.pending.keys().next().value);
  C.pending.set(C.seq, done);
  return "C" + C.seq + "|" + text + "\n";
}

function rigFlexSend(R, text, done = null)
{
  const data = rigFlexCmd(R, text, done);
  if (data) rigWrite(R, data);
}

// A ping: its answer (after everything sent before it) marks a whole read. A radio that has said nothing for a while is gone
function rigFlexPoll(R)
{
  const C = R.flexConn;
  if (!C) return null;
  if (Date.now() - C.lastLineAt > FLEX_SILENT_MS)
  {
    rigFail(R, "timeout");
    return null;
  }
  if (C.handle === null) return null;
  const seq = R.tuneSeq;
  return rigFlexCmd(R, "ping", () =>
  {
    R.readSeq = Math.max(R.readSeq, seq);
    rigReadWhole(R);
  });
}

// A line from the radio
function rigFlexLine(line, R)
{
  const C = R.flexConn;
  if (!C) return null;
  C.lastLineAt = Date.now();
  const text = line.replace(/\r$/, "");
  const kind = text[0];
  if (kind == "V") C.version = text.slice(1);
  else if (kind == "H")
  {
    C.handle = parseInt(text.slice(1), 16);
    rigFlexStart(R);
  }
  else if (kind == "R")
  {
    const parts = text.slice(1).split("|");
    const seq = Number(parts[0]);
    const code = parseInt(parts[1], 16) || 0;
    const message = parts.slice(2).join("|");
    if (!C.pending.has(seq)) return null;
    const done = C.pending.get(seq);
    C.pending.delete(seq);
    if (done) done(code, message);
  }
  else if (kind == "S")
  {
    const bar = text.indexOf("|");
    if (bar > 0) rigFlexStatus(R, text.slice(bar + 1));
  }
  return null;
}

// The handle known: the client list, the TX's status and the radio's name asked for; the slices once bound (or once it is known there is
// no GUI client to bind to)
function rigFlexStart(R)
{
  const C = R.flexConn;
  rigFlexSend(R, "sub client all", () =>
  {
    rigFlexBind(R);
    if (!C.bindAsked) rigFlexSubSlices(R);
  });
  rigFlexSend(R, "sub tx all");
  rigFlexSend(R, "info", (code, message) =>
  {
    const m = /model="?([^",]+)/.exec(message);
    if (code == 0 && m && !R.flexFound) R.model = m[1];
  });
}

// Bound to the first GUI client (if not yet): its slices then asked again, so they are known as its
function rigFlexBind(R)
{
  const C = R.flexConn;
  if (C.gui) return;
  const list = Object.values(C.clients).filter((c) => c.id && c.handle != C.handle && !/^(DAX|CAT)\b/i.test(c.program));
  const gui = list.find((c) => /SmartSDR|Maestro/i.test(c.program)) || list[0];
  if (!gui) return;
  C.gui = gui;
  C.bindAsked = true;
  rigFlexSend(R, "client bind client_id=" + gui.id, () => rigFlexSubSlices(R));
}

function rigFlexSubSlices(R)
{
  const C = R.flexConn;
  C.slicesAsked = true;
  rigFlexSend(R, "sub slice all", () =>
  {
    C.slicesKnown = true;
    rigFlexPick(R);
    rigFlexAudioSync(R);
  });
}

// A status line: "<object words> <key=value> ...". The clients, the slices and the TX are kept
function rigFlexStatus(R, body)
{
  const C = R.flexConn;
  const words = [];
  const keys = {};
  for (const token of body.split(" "))
  {
    if (!token) continue;
    const eq = token.indexOf("=");
    if (eq < 0) words.push(token);
    else keys[token.slice(0, eq)] = token.slice(eq + 1).replace(/\x7f/g, " ");
  }
  if (words[0] == "client" && words.length >= 2)
  {
    const handle = parseInt(words[1], 16);
    if (!Number.isFinite(handle)) return;
    if (words[2] == "disconnected")
    {
      delete C.clients[handle];
      // The GUI client bound to gone: another one bound, as there is one
      if (C.gui && C.gui.handle == handle)
      {
        C.gui = null;
        rigFlexBind(R);
      }
      rigFlexPick(R);
      return;
    }
    const c = C.clients[handle] || (C.clients[handle] = { handle: handle, id: "", program: "", station: "" });
    if (keys.client_id !== undefined) c.id = keys.client_id;
    if (keys.program !== undefined) c.program = keys.program;
    if (keys.station !== undefined) c.station = keys.station;
    // A GUI client that comes once the list was read: bound to, if none is
    if (C.slicesAsked && !C.gui)
    {
      rigFlexBind(R);
      if (C.gui) rigFlexPick(R);
    }
  }
  else if (words[0] == "slice" && words.length >= 2)
  {
    const index = Number(words[1]);
    if (!Number.isInteger(index)) return;
    if (words[2] == "removed" || keys.in_use == "0")
    {
      delete C.slices[index];
      rigFlexPick(R);
      return;
    }
    const s = C.slices[index] || (C.slices[index] = { index: index, letter: String.fromCharCode(65 + index), freq: null, mode: null, tx: false, active: false, client: null, dax: 0 });
    if (keys.RF_frequency !== undefined) s.freq = Math.round(Number(keys.RF_frequency) * 1e6) || null;
    if (keys.mode !== undefined) s.mode = keys.mode.toUpperCase();
    if (keys.tx !== undefined) s.tx = keys.tx == "1";
    if (keys.active !== undefined) s.active = keys.active == "1";
    if (keys.client_handle !== undefined) s.client = parseInt(keys.client_handle, 16);
    if (keys.index_letter !== undefined) s.letter = keys.index_letter;
    if (keys.dax !== undefined) s.dax = Number(keys.dax) || 0;
    rigFlexPick(R);
  }
  else if (words[0] == "transmit" && keys.dax !== undefined) C.txDax = keys.dax == "1";
}

// The slices of the GUI client bound to (all of them, when none is bound, or none of them are its: firmware 2.x), by index
function rigFlexSlicesOurs(C)
{
  const all = Object.values(C.slices).sort((a, b) => a.index - b.index);
  if (!C.gui) return all;
  const its = all.filter((s) => s.client == C.gui.handle);
  return its.length || all.some((s) => s.client !== null) ? its : all;
}

// VFO-A's and VFO-B's slices chosen (each kept while it is there), and the rig's frequencies and modes read from them
function rigFlexPick(R)
{
  const C = R.flexConn;
  const ours = rigFlexSlicesOurs(C);
  const has = (index) => index !== null && ours.some((s) => s.index == index);
  if (!has(C.sliceA))
  {
    const first = ours.find((s) => s.tx) || ours[0];
    C.sliceA = first ? first.index : null;
  }
  if (!has(C.sliceB) || C.sliceB == C.sliceA)
  {
    const next = ours.find((s) => s.index > C.sliceA) || ours.find((s) => s.index != C.sliceA);
    C.sliceB = next ? next.index : null;
  }
  const A = rigFlexSliceA(R);
  const B = rigFlexSliceB(R);
  R.freq = A ? A.freq : null;
  R.mode = A ? rigFlexModeShow(A.mode) : null;
  R.freqB = B ? B.freq : null;
  R.modeB = B ? rigFlexModeShow(B.mode) : null;
  R.dual = C.slicesKnown ? !!B : null;
}

function rigFlexSliceA(R)
{
  const C = R.flexConn;
  return C && C.sliceA !== null ? C.slices[C.sliceA] || null : null;
}

function rigFlexSliceB(R)
{
  const C = R.flexConn;
  return C && C.sliceB !== null ? C.slices[C.sliceB] || null : null;
}

// A slice's mode as shown: its data modes as USB-D, LSB-D, FM-D
function rigFlexModeShow(mode)
{
  return mode ? FLEX_MODE_SHOW[mode] || mode : null;
}

// ---- Settings

// A slice tuned (MHz, to the hertz). Its frequency taken as set once the radio has said so (its status, or the command's answer: what
// a later ping reads reflects it either way)
function rigFlexTune(R, slice, hz)
{
  if (!slice || !(hz > 0)) return null;
  const value = Math.round(hz);
  return rigFlexCmd(R, "slice tune " + slice.index + " " + (value / 1e6).toFixed(6), (code) =>
  {
    if (code != 0 || (rigFlexSliceA(R) !== slice && rigFlexSliceB(R) !== slice)) return;
    slice.freq = value;
    rigFlexPick(R);
  });
}

// The mode a slice is set to: the data variant asked for (data true) or against (false); data left out keeps the slice's own (DIGU
// stays DIGU for USB). USB-D and the like are their data mode. A mode the radio hasn't: nothing
function rigFlexModeFor(mode, data, current)
{
  let name = String(mode).toUpperCase().replace(/^PKT/, "");
  if (/-D$/.test(name))
  {
    name = name.slice(0, -2);
    data = true;
  }
  name = { "CW-R": "CW", "RTTY-R": "RTTY", WFM: "FM" }[name] || name;
  const variant = FLEX_DATA_MODES[name];
  if (variant)
  {
    if (data === undefined) data = current == variant;
    return data ? variant : name;
  }
  return FLEX_MODES.includes(name) ? name : null;
}

function rigFlexSetMode(R, slice, mode, data)
{
  if (!slice) return null;
  const flexMode = rigFlexModeFor(mode, data, slice.mode);
  if (!flexMode) return null;
  return rigFlexCmd(R, "slice set " + slice.index + " mode=" + flexMode, (code) =>
  {
    if (code != 0) return;
    slice.mode = flexMode;
    rigFlexPick(R);
  });
}

// PTT (xmit). With DAX TX audio open and the TX slice in a mode that doesn't take DAX by itself (not DIGU, DIGL), DAX is made the TX
// audio's source for the transmission (transmit set dax=1), and put back after it
function rigFlexPtt(R, on)
{
  const C = R.flexConn;
  if (!C) return null;
  let out = "";
  if (on && R.flexAudio && R.flexAudio.out && C.txDax === false && !C.daxForced)
  {
    const T = Object.values(C.slices).find((s) => s.tx) || rigFlexSliceA(R);
    if (T && !/^DIG/.test(T.mode || ""))
    {
      out += rigFlexCmd(R, "transmit set dax=1");
      C.daxForced = true;
    }
  }
  out += rigFlexCmd(R, "xmit " + (on ? 1 : 0));
  if (!on && C.daxForced)
  {
    out += rigFlexCmd(R, "transmit set dax=0");
    C.daxForced = false;
  }
  return out;
}

// ---- Discovery: the first radio heard on UDP 4992 within ms, { ip, port, model, serial, nickname ... }; null for none

function rigFlexDiscover(ms)
{
  return new Promise((resolve) =>
  {
    const dgram = window.require("dgram");
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    let done = false;
    const finish = (radio) =>
    {
      if (done) return;
      done = true;
      nodeTimers.clearTimeout(timer);
      try { socket.close(); } catch (e) { /* closed already */ }
      resolve(radio);
    };
    const timer = nodeTimers.setTimeout(() => finish(null), ms);
    socket.on("error", () => finish(null));
    socket.on("message", (msg, rinfo) =>
    {
      const radio = rigFlexDiscoveryRead(msg, rinfo.address);
      if (radio) finish(radio);
    });
    socket.bind(FLEX_DISCOVERY_PORT);
  });
}

// A discovery packet's key=value text, padding taken off; null for a packet that isn't one
function rigFlexDiscoveryRead(msg, from)
{
  const p = rigFlexVita(msg);
  if (!p || p.classCode != FLEX_CLASS_DISCOVERY) return null;
  const radio = {};
  for (const token of p.payload.toString("latin1").replace(/[\0\s]+$/, "").split(/\s+/))
  {
    const eq = token.indexOf("=");
    if (eq > 0) radio[token.slice(0, eq)] = token.slice(eq + 1);
  }
  radio.ip = /^\d+\.\d+\.\d+\.\d+$/.test(radio.ip || "") ? radio.ip : String(from).replace(/^::ffff:/, "");
  return radio;
}

// ---- VITA-49

// A packet's header read: { type, count, streamId (null without one), oui, classCode, payload } (its trailer taken off); null if short
function rigFlexVita(buf)
{
  if (!buf || buf.length < 8) return null;
  const word = buf.readUInt32BE(0);
  const type = word >>> 28;
  const hasClass = (word & 0x08000000) != 0;
  const hasTrailer = (word & 0x04000000) != 0;
  const tsi = (word >>> 22) & 3;
  const tsf = (word >>> 20) & 3;
  const size = Math.min(buf.length, (word & 0xffff) * 4);
  let at = 4;
  let streamId = null;
  if (type == 1 || type == 3)
  {
    streamId = buf.readUInt32BE(at);
    at += 4;
  }
  let oui = 0;
  let classCode = -1;
  if (hasClass)
  {
    if (at + 8 > size) return null;
    oui = buf.readUInt32BE(at) & 0xffffff;
    classCode = buf.readUInt16BE(at + 6);
    at += 8;
  }
  if (tsi) at += 4;
  // The fractional timestamp: a sample count (tsf 1) where the radio keeps one
  let frac = null;
  if (tsf)
  {
    if (at + 8 > size) return null;
    frac = buf.readUInt32BE(at) * 4294967296 + buf.readUInt32BE(at + 4);
    at += 8;
  }
  const end = size - (hasTrailer ? 4 : 0);
  if (at > end) return null;
  return { type: type, count: (word >>> 16) & 15, streamId: streamId, oui: oui, classCode: classCode, tsf: tsf, frac: frac, payload: buf.subarray(at, end) };
}

// A DAX packet's samples, mono at 24 kHz: the float stereo ones' two channels mixed, the 16-bit mono ones as they are
function rigFlexDaxSamples(p)
{
  const data = p.payload;
  if (p.classCode == FLEX_CLASS_DAX_FLOAT)
  {
    const n = data.length >> 3;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++)
    {
      const value = (data.readFloatBE(i * 8) + data.readFloatBE(i * 8 + 4)) / 2;
      out[i] = Number.isFinite(value) ? value : 0;
    }
    return out;
  }
  const n = data.length >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = data.readInt16BE(i * 2) / 32768;
  return out;
}

// A DAX TX packet: 128 frames of mono samples as float stereo (both channels the same), its packet count and stream id
function rigFlexTxPacket(samples, streamId, count)
{
  const buf = Buffer.alloc(28 + samples.length * 8);
  buf.writeUInt32BE(((1 << 28) | 0x08000000 | (3 << 22) | (1 << 20) | ((count & 15) << 16) | (buf.length / 4)) >>> 0, 0);
  buf.writeUInt32BE(streamId >>> 0, 4);
  buf.writeUInt32BE(FLEX_OUI, 8);
  buf.writeUInt32BE(((FLEX_INFO_CLASS << 16) | FLEX_CLASS_DAX_FLOAT) >>> 0, 12);
  for (let i = 0; i < samples.length; i++)
  {
    const value = Math.max(-1, Math.min(1, samples[i]));
    buf.writeFloatBE(value, 28 + i * 8);
    buf.writeFloatBE(value, 32 + i * 8);
  }
  return buf;
}

// ---- DAX audio (netAudio.js). Each rig's (R.flexAudio): its "in" and "out" handles, the UDP socket they share (its port kept, so it is
// the same one again when reopened), and the check that makes the radio's streams follow the connection and VFO-A's slice

function rigFlexAudioStart(R, dir, sink)
{
  const A = R.flexAudio || (R.flexAudio = { in: null, out: null, socket: null, port: null, lastPort: 0, bindAt: 0, timer: null });
  if (A[dir]) A[dir].api.stop();
  const h = { dir: dir, sink: sink, said: null, stopped: false, conn: null, ch: 0, streamId: null, creating: false, failedAt: 0, altTried: false, startedAt: 0, lastAt: 0, lastCount: null, lastFrac: null, receiving: false, quiet: false, format: null, buf: null, fill: 0, count: 0, sent: false };
  h.api = { stop: () => rigFlexAudioStop(R, h) };
  if (dir == "out")
  {
    h.buf = new Float32Array(FLEX_TX_FRAMES);
    h.api.rate = FLEX_DAX_RATE;
    h.api.write = (samples) => rigFlexAudioWrite(R, h, samples);
  }
  A[dir] = h;
  if (!A.timer) A.timer = nodeTimers.setInterval(() => rigFlexAudioSync(R), FLEX_AUDIO_TICK_MS);
  rigFlexAudioSync(R);
  return h.api;
}

// A handle's status, told only when it changed
function rigFlexSay(h, text, error = false)
{
  const key = text + (error ? "!" : "");
  if (h.said === key) return;
  h.said = key;
  try
  {
    h.sink.status(text, error);
  }
  catch (e)
  {
    // The listener's window gone: it stops the handle itself
  }
}

function rigFlexAudioStop(R, h)
{
  if (h.stopped) return;
  h.stopped = true;
  const A = R.flexAudio;
  if (A && A[h.dir] === h) A[h.dir] = null;
  rigFlexStreamRemove(R, h);
  if (A && !A.in && !A.out)
  {
    nodeTimers.clearInterval(A.timer);
    A.timer = null;
    if (A.socket)
    {
      try { A.socket.close(); } catch (e) { /* closed already */ }
    }
    A.socket = null;
    A.port = null;
  }
}

// A handle's stream removed from the radio (while its connection is the one up)
function rigFlexStreamRemove(R, h)
{
  if (h.streamId !== null && h.streamId >= 0 && h.conn && h.conn === R.flexConn && R.status == "connected") rigFlexSend(R, "stream remove 0x" + h.streamId.toString(16).padStart(8, "0"));
  h.streamId = null;
}

// The UDP socket bound (the port it had before, else any free one); one that fails is tried again in a while
function rigFlexUdpEnsure(R)
{
  const A = R.flexAudio;
  if (A.socket || Date.now() < A.bindAt) return;
  const dgram = window.require("dgram");
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: false });
  A.socket = socket;
  const tried = A.lastPort;
  socket.on("error", (e) =>
  {
    if (A.socket !== socket) return;
    try { socket.close(); } catch (x) { /* closed already */ }
    A.socket = null;
    A.port = null;
    A.bindAt = Date.now() + FLEX_RETRY_MS;
    // Its old port taken: any port next time
    if (tried) A.lastPort = 0;
    for (const h of [A.in, A.out]) if (h) rigFlexSay(h, e.message, true);
  });
  socket.on("listening", () =>
  {
    if (A.socket !== socket) return;
    A.port = socket.address().port;
    A.lastPort = A.port;
    rigFlexAudioSync(R);
  });
  socket.on("message", (msg, rinfo) => { if (A.socket === socket) rigFlexUdpIn(R, msg, rinfo); });
  socket.bind(tried || 0);
}

// The streams made to follow what is: the connection (a new one has none), VFO-A's slice and its DAX channel; and each handle's status
function rigFlexAudioSync(R)
{
  const A = R.flexAudio;
  if (!A || (!A.in && !A.out)) return;
  rigFlexUdpEnsure(R);
  const C = R.status == "connected" && R.flexConn && R.flexConn.slicesKnown ? R.flexConn : null;
  for (const h of [A.in, A.out])
  {
    if (!h) continue;
    if (h.conn !== C)
    {
      // A new connection (or none): the old one's streams went with it
      h.conn = C;
      h.streamId = null;
      h.creating = false;
      h.failedAt = 0;
      h.lastCount = null;
      h.lastFrac = null;
      h.lastAt = 0;
      h.receiving = false;
      h.sent = false;
    }
    if (!C)
    {
      rigFlexSay(h, I18N("rig.flex.audio.notConnected"), true);
      continue;
    }
    if (!A.port) continue;
    if (C.udpPort !== A.port)
    {
      C.udpPort = A.port;
      rigFlexSend(R, "client udpport " + A.port);
    }
    const S = rigFlexSliceA(R);
    if (!S)
    {
      rigFlexSay(h, I18N("rig.flex.audio.noSlice"), true);
      continue;
    }
    if (!(S.dax > 0))
    {
      rigFlexDaxAssign(R, S);
      rigFlexSay(h, I18N("rig.flex.audio.noDax").replace("{slice}", S.letter), true);
      continue;
    }
    // The slice moved to another DAX channel: its stream made again
    if (h.streamId !== null && h.ch != S.dax) rigFlexStreamRemove(R, h);
    if (h.streamId === null && !h.creating && Date.now() - h.failedAt > FLEX_RETRY_MS) rigFlexStreamCreate(R, h, C, S);
    rigFlexAudioStatus(R, h, S);
  }
}

// VFO-A's slice given a DAX channel, once a connection: the lowest no other slice of the client uses
function rigFlexDaxAssign(R, S)
{
  const C = R.flexConn;
  if (C.daxAssigned) return;
  C.daxAssigned = true;
  const used = rigFlexSlicesOurs(C).map((s) => s.dax);
  let ch = 1;
  while (ch < FLEX_DAX_CHANNELS && used.includes(ch)) ch++;
  rigFlexSend(R, "slice set " + S.index + " dax=" + ch, (code) =>
  {
    if (code != 0 || C.slices[S.index] !== S) return;
    S.dax = ch;
    rigFlexAudioSync(R);
  });
}

// A handle's stream asked for: DAX RX of the slice's channel, or DAX TX (that channel made this client's to transmit first). Refused, the
// firmware 2.x form is tried, then (refused too) it is asked again in a while
function rigFlexStreamCreate(R, h, C, S)
{
  h.creating = true;
  h.ch = S.dax;
  const forms = h.dir == "in" ? ["stream create type=dax_rx dax_channel=" + S.dax, "stream create dax=" + S.dax] : ["stream create type=dax_tx", "stream create daxtx"];
  if (h.dir == "out") rigFlexSend(R, "dax audio set " + S.dax + " slice=" + S.index + " tx=1");
  rigFlexSend(R, forms[h.altTried ? 1 : 0], (code, message) =>
  {
    if (h.conn !== C) return;
    h.creating = false;
    const id = parseInt(String(message).trim().replace(/^0x/i, ""), 16);
    if (code == 0)
    {
      // Stopped while it was made: removed again
      h.streamId = Number.isFinite(id) ? id : -1;
      if (h.stopped)
      {
        rigFlexStreamRemove(R, h);
        return;
      }
      h.startedAt = Date.now();
      h.lastAt = 0;
      h.lastCount = h.lastFrac = null;
      h.receiving = h.quiet = false;
      rigFlexAudioSync(R);
      return;
    }
    if (!h.altTried)
    {
      h.altTried = true;
      rigFlexAudioSync(R);
      return;
    }
    h.altTried = false;
    h.failedAt = Date.now();
    rigFlexSay(h, I18N("rig.flex.audio.refused").replace("{code}", (code >>> 0).toString(16).toUpperCase()), true);
  });
}

// A handle's status: waiting for its stream, receiving or not (no packets in a while), ready to send or sending. With no DAX in a while
// after the stream was made, the UDP registration datagram is tried once (as a SmartLink client registers)
function rigFlexAudioStatus(R, h, S)
{
  if (h.streamId === null) return;
  const now = Date.now();
  if (h.dir == "out")
  {
    rigFlexSay(h, I18N(h.sent ? "rig.flex.audio.sending" : "rig.flex.audio.ready").replace("{slice}", S.letter));
    return;
  }
  if (!h.lastAt)
  {
    if (now - h.startedAt > FLEX_NO_AUDIO_MS) rigFlexUdpRegister(R);
    rigFlexSay(h, I18N("rig.flex.audio.waiting").replace("{slice}", S.letter).replace("{ch}", h.ch));
  }
  else if (now - h.lastAt > FLEX_NO_AUDIO_MS)
  {
    h.quiet = true;
    rigFlexSay(h, I18N("rig.flex.audio.noAudio"), true);
  }
}

function rigFlexUdpRegister(R)
{
  const A = R.flexAudio;
  const C = R.flexConn;
  if (!A.socket || !C || C.udpRegistered || C.handle === null || !C.radioIp) return;
  C.udpRegistered = true;
  const text = Buffer.from("client udp_register handle=0x" + C.handle.toString(16).toUpperCase().padStart(8, "0") + "\n", "ascii");
  A.socket.send(text, FLEX_UDP_REGISTER_PORT, C.radioIp, () => {});
}

// A UDP packet in: DAX RX audio of the "in" handle's stream (from the radio), to its sink; a gap filled with silence first. The gap is
// told by the sample count timestamp where the radio keeps one (it goes up by each packet's frames), else by the 4-bit packet count;
// past 16 packets the count wraps, so a silence of over FLEX_LONG_GAP_MS since the last packet (too long to be the network's jitter)
// is measured by its time, the count picking the exact number. A gap over a second isn't filled. A packet a step behind (late, or
// twice) is dropped
function rigFlexUdpIn(R, msg, rinfo)
{
  const A = R.flexAudio;
  const h = A.in;
  if (!h || h.streamId === null || !h.conn) return;
  if (h.conn.radioIp && String(rinfo.address).replace(/^::ffff:/, "") != h.conn.radioIp) return;
  const p = rigFlexVita(msg);
  if (!p || p.oui != FLEX_OUI || (p.classCode != FLEX_CLASS_DAX_FLOAT && p.classCode != FLEX_CLASS_DAX_INT16)) return;
  if (h.streamId >= 0 && p.streamId !== h.streamId) return;
  const samples = rigFlexDaxSamples(p);
  if (!samples.length) return;
  const now = Date.now();
  const packetMs = (samples.length * 1000) / FLEX_DAX_RATE;
  const frac = p.tsf == 1 && p.frac > 0 ? p.frac : null;
  if (h.lastCount !== null)
  {
    let missing;
    const step = frac !== null && h.lastFrac !== null ? frac - h.lastFrac : NaN;
    if (step > 0 && step % samples.length == 0) missing = step / samples.length - 1;
    // Behind the last by a little: late, or twice; by more, the radio's count started again (nothing filled)
    else if (step <= 0 && step > -16 * samples.length) return;
    else if (step <= 0) missing = 0;
    else
    {
      missing = (p.count - h.lastCount - 1) & 15;
      const elapsed = now - h.lastAt;
      if (missing >= 8 && elapsed < FLEX_LONG_GAP_MS) return;
      if (elapsed >= FLEX_LONG_GAP_MS)
      {
        const guess = Math.round(elapsed / packetMs) - 1;
        missing += 16 * Math.max(0, Math.round((guess - missing) / 16));
      }
    }
    if (missing > 0 && missing * packetMs <= FLEX_GAP_MAX_MS) rigFlexPcm(h, new Float32Array(missing * samples.length));
  }
  h.lastCount = p.count;
  h.lastFrac = frac;
  h.lastAt = now;
  if (!h.receiving || h.quiet || h.format != p.classCode)
  {
    h.receiving = true;
    h.quiet = false;
    h.format = p.classCode;
    const S = rigFlexSliceA(R);
    rigFlexSay(h, I18N("rig.flex.audio.receiving").replace("{bits}", p.classCode == FLEX_CLASS_DAX_FLOAT ? "32-bit" : "16-bit").replace("{slice}", S ? S.letter : "?").replace("{ch}", h.ch));
  }
  rigFlexPcm(h, samples);
}

function rigFlexPcm(h, samples)
{
  try
  {
    h.sink.pcm(samples, FLEX_DAX_RATE);
  }
  catch (e)
  {
    // The listener's window gone: it stops the handle itself
  }
}

// Audio to transmit (mono, 24 kHz): packets of 128 frames sent to the radio as they fill, while its DAX TX stream is up (dropped
// otherwise). Silence isn't sent (its packets counted all the same)
function rigFlexAudioWrite(R, h, samples)
{
  const A = R.flexAudio;
  const up = !h.stopped && h.streamId !== null && h.streamId >= 0 && h.conn && h.conn === R.flexConn && A && A.socket && h.conn.radioIp;
  if (!up)
  {
    h.fill = 0;
    return;
  }
  for (let i = 0; i < samples.length; i++)
  {
    h.buf[h.fill++] = samples[i];
    if (h.fill < FLEX_TX_FRAMES) continue;
    h.fill = 0;
    const count = h.count++;
    if (!h.buf.some((x) => x != 0)) continue;
    A.socket.send(rigFlexTxPacket(h.buf, h.streamId, count), FLEX_VITA_PORT, h.conn.radioIp, () => {});
    if (!h.sent)
    {
      h.sent = true;
      const S = rigFlexSliceA(R);
      rigFlexSay(h, I18N("rig.flex.audio.sending").replace("{slice}", S ? S.letter : "?"));
    }
  }
}
