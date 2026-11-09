// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// An Icom on the network as a Rig Control VFO (its protocol "icomlan", rig.js): the IC-705, IC-7610, IC-9700, IC-905 (and the others
// with a LAN port, or RS-BA1's Remote Utility server) through Icom's remote protocol, the one RS-BA1 and wfview use. The rig is read and
// set with the CI-V of the civ protocol (its poll, its settings and its parse, rig.js), carried over the network, and its receive and
// transmit audio go over the same login, for the Multi-Mode Decoder (audio, below). The rig's Network menu sets its user and password
// (Username / Password in the VFO's box), and for audio to transmit its MOD input for data (DATA MOD) to LAN.
//   The protocol, as wfview (udphandler, udpbase, udpcivdata, udpaudio, packettypes.h) and kappanhang document it: three UDP streams,
//   control (the rig's port, 50001 by default), CI-V and audio (the rig's ports for them in its status reply, 50002 and 50003 by
//   default; ours told it in the stream request). Every packet starts with 16 bytes, little-endian: its length (4), its type (2), its
//   sequence number (2), the sender's id (4) and the receiver's (4). An id is the sender's IPv4 address' last two bytes and its port.
//   Types: 00 data (16 bytes long: idle), 01 resend request, 03 are you there, 04 I am here, 05 disconnect, 06 are you ready (and the
//   rig's I am ready), 07 ping. Each stream starts with 03 until 04 comes (it carries the rig's id), then 06 until 06 comes.
//   Data packets (00) are numbered, each side its own count: the other side asks for one missed (01, the number in the header's
//   sequence; or longer, pairs of numbers from 0x10), and is sent it again (one no longer kept: an idle with its number). A stream with
//   nothing else to send sends an idle every 100 ms (not the audio stream). Pings (07, 21 bytes: 0x10 00 a request or 01 a reply, then
//   4 bytes the reply echoes) go both ways every 500 ms, numbered apart from the data
//   Control: the login (0x80 bytes: the user and password scrambled, ICOM_LAN_SCRAMBLE, and this program's name) is answered with a
//   token (0x60; 0x30 FEFFFFFF: a wrong user or password), acknowledged (0x40, 02) and renewed every minute (0x40, 05); the rig sends
//   its capabilities (0x42 bytes and 0x66 for each radio: its name, its CI-V address, the rates it has), and who is using it (0x90:
//   busy, and that program's name and address). The stream request (0x90) asks for the audio's codec (LPCM 16-bit mono here; the rig
//   has µ-law and 8-bit too) and rate both ways, and tells our CI-V and audio ports; the status reply (0x50) gives the rig's, or an
//   error (FFFFFFFF: refused). The packets after the 16 bytes: 0x10 the rest's size (4, big-endian), 0x14 01 asked or 02 answered,
//   0x15 what it is, 0x16 its own count (2, big-endian), 0x1a our random login number (2), 0x1c the token (4)
//   CI-V: the stream is opened (0x16 bytes: C0 01, its count, 04) and closed (00); each CI-V frame in a packet of its own, 0x15 bytes
//   (C1, the frame's length, its count big-endian) then the frame. Audio: 0x18 bytes (0x12 its count and 0x16 its length, big-endian)
//   then the samples, 16-bit little-endian; the rig's come in packets of any size, ours go 20 ms at a time, at most 1364 bytes a packet

const ICOM_LAN_CLIENT = "GridTracker2";
// The rates the stream request may ask for, both ways (the Rig box's Audio Rate)
const ICOM_LAN_RATES = [8000, 16000, 24000, 48000];
const ICOM_LAN_RATE_DEFAULT = 16000;
// The codecs (the stream request's 0x72 and 0x73): 01 µ-law, 02 8-bit, 04 16-bit, each mono (08, 10, 20 their stereo)
const ICOM_LAN_CODEC_PCM16 = 0x04;
// The rig's buffer for our transmit audio, in ms (the stream request's 0x84)
const ICOM_LAN_TX_BUFFER_MS = 150;

const ICOM_LAN_DATA = 0x00;
const ICOM_LAN_RESEND = 0x01;
const ICOM_LAN_ARE_YOU_THERE = 0x03;
const ICOM_LAN_I_AM_HERE = 0x04;
const ICOM_LAN_DISCONNECT = 0x05;
const ICOM_LAN_READY = 0x06;
const ICOM_LAN_PING = 0x07;
// What a token packet is (0x15): removed (logging out), acknowledged (after the login), renewed
const ICOM_LAN_TOKEN_REMOVE = 0x01;
const ICOM_LAN_TOKEN_ACK = 0x02;
const ICOM_LAN_TOKEN_RENEW = 0x05;
// The answers' errors (0x30, read little-endian)
const ICOM_LAN_BAD_LOGIN = 0xfeffffff;
const ICOM_LAN_REFUSED = 0xffffffff;
// The capabilities: their header, then each radio's
const ICOM_LAN_CAPS_HEADER = 0x42;
const ICOM_LAN_CAPS_RADIO = 0x66;
const ICOM_LAN_CIV_HEADER = 0x15;
const ICOM_LAN_AUDIO_HEADER = 0x18;
// Samples a packet takes at most (bytes), as the rig's own client sends them
const ICOM_LAN_AUDIO_MAX = 1364;

const ICOM_LAN_TICK_MS = 20;
const ICOM_LAN_HELLO_MS = 500;
const ICOM_LAN_PING_MS = 500;
const ICOM_LAN_IDLE_MS = 100;
const ICOM_LAN_TOKEN_MS = 60000;
// From the first hello to the CI-V stream up, at most; nothing in for this long once up: the rig is gone
const ICOM_LAN_SETUP_MS = 8000;
const ICOM_LAN_LOST_MS = 5000;
// The rig's who-is-using-it (0x90) waited for this long after its capabilities, before the stream is asked for anyway
const ICOM_LAN_FREE_WAIT_MS = 300;
// No CI-V in for this long: the stream opened again (as wfview does: the rig may not have taken the first)
const ICOM_LAN_CIV_QUIET_MS = 2000;
const ICOM_LAN_NO_AUDIO_MS = 2000;
// A packet missed: asked for again this often, this many times, and what came after it held this long for it (then it is given up)
const ICOM_LAN_ASK_MS = 40;
const ICOM_LAN_ASK_TRIES = 3;
const ICOM_LAN_HOLD_MS = 120;
// A sequence number further ahead than this: the other side started again (nothing asked for); this many older ones in a row too
const ICOM_LAN_GAP_MAX = 50;
const ICOM_LAN_OLD_MAX = 20;
// The packets kept to be sent again on request (each stream's last ones)
const ICOM_LAN_HISTORY = 500;
// Closing: the sockets kept this long for the rig's requests for the last packets, then let go
const ICOM_LAN_CLOSE_MS = 300;

// The scrambling of the user and password: each character's code plus its place (from 0), wrapped into 32 to 126, looked up here (the
// entry for 32 first); anything outside is 00. Sixteen characters at most
const ICOM_LAN_SCRAMBLE = [
  0x47, 0x5d, 0x4c, 0x42, 0x66, 0x20, 0x23, 0x46, 0x4e, 0x57, 0x45, 0x3d, 0x67, 0x76, 0x60, 0x41,
  0x62, 0x39, 0x59, 0x2d, 0x68, 0x7e, 0x7c, 0x65, 0x7d, 0x49, 0x29, 0x72, 0x73, 0x78, 0x21, 0x6e,
  0x5a, 0x5e, 0x4a, 0x3e, 0x71, 0x2c, 0x2a, 0x54, 0x3c, 0x3a, 0x63, 0x4f, 0x43, 0x75, 0x27, 0x79,
  0x5b, 0x35, 0x70, 0x48, 0x6b, 0x56, 0x6f, 0x34, 0x32, 0x6c, 0x30, 0x61, 0x6d, 0x7b, 0x2f, 0x4b,
  0x64, 0x38, 0x2b, 0x2e, 0x50, 0x40, 0x3f, 0x55, 0x33, 0x37, 0x25, 0x77, 0x24, 0x26, 0x74, 0x6a,
  0x28, 0x53, 0x4d, 0x69, 0x22, 0x5c, 0x44, 0x31, 0x36, 0x58, 0x3b, 0x7a, 0x51, 0x5f, 0x52
];

// The civ protocol's CI-V (its poll, its settings, PTT 1C 00, its parse) over the network; the rig's frames framed by rigReceive (binary)
RIG_PROTOCOLS.icomlan = Object.assign({}, RIG_PROTOCOLS.civ, {
  name: "Icom LAN (IC-705, 7610, 9700, 905 ...)",
  serial: false,
  udp: true,
  lanLogin: true,
  portKey: "icomLanPort",
  portDefault: 50001,
  open: (R, generation) => icomLanOpen(R, generation),
  // Its receive audio (in) and the audio to transmit (out), for the Multi-Mode Decoder
  audio: { name: "Icom LAN", dirs: ["in", "out"], start: (R, dir, sink) => icomLanAudioStart(R, dir, sink) }
});

// A user or password scrambled as the login takes it: 16 bytes
function icomLanScramble(text)
{
  const out = Buffer.alloc(16);
  const bytes = Buffer.from(String(text || ""), "utf8");
  for (let i = 0; i < bytes.length && i < 16; i++)
  {
    let p = bytes[i] + i;
    if (p > 126) p = 32 + (p % 127);
    out[i] = p >= 32 && p <= 126 ? ICOM_LAN_SCRAMBLE[p - 32] : 0x00;
  }
  return out;
}

// The rate the audio goes at both ways: the VFO's Audio Rate, or 16 kHz
function icomLanRate(R)
{
  const rate = Number(rigSettingsOf(R).lanRate);
  return ICOM_LAN_RATES.includes(rate) ? rate : ICOM_LAN_RATE_DEFAULT;
}

// A text field of a packet: its bytes up to the first 00
function icomLanText(b, at, size)
{
  const field = b.subarray(at, Math.min(b.length, at + size));
  const end = field.indexOf(0);
  return field.subarray(0, end < 0 ? field.length : end).toString("latin1").trim();
}

// ---- The connection: the control stream first, then (once logged in and the streams granted) the CI-V and audio streams

// rigConnect's open for this protocol: the link (rigWrite's CI-V into the CI-V stream, one frame at a time through R.writer, as a serial
// Icom's) and the control stream's hello. Whatever goes wrong later says so through rigFail, which tries again (RIG_RETRY_MS)
function icomLanOpen(R, generation)
{
  const S = rigSettingsOf(R);
  const C = {
    R: R,
    generation: generation,
    host: String(S.host || "").trim() || "127.0.0.1",
    port: Number(S[R.protocol.portKey]) || R.protocol.portDefault,
    user: String(S.lanUser || ""),
    password: String(S.lanPassword || ""),
    rate: icomLanRate(R),
    closed: false,
    startedAt: Date.now(),
    localIp: 0,
    innerSeq: 0,
    // Our random login number (the rig's answer carries it back) and the token it gives
    tokRequest: Math.floor(Math.random() * 0x10000),
    token: 0,
    loggedIn: false,
    tokenOk: false,
    tokenAt: 0,
    // The rig's capabilities ({ guid, name, civ, txRates }), when they came, and whether it said no one else is using it
    radio: null,
    capAt: 0,
    free: false,
    requested: false,
    streamsUp: false,
    civUp: false,
    audioUp: false,
    txAllowed: true,
    civSeq: 0,
    civDataAt: 0,
    civOpenAt: 0,
    audioSeq: 0,
    // Samples in the rig's last audio packet: what a packet missed is taken to have held (zeros in its place)
    audioPacketSamples: 0,
    ctl: null,
    civ: null,
    audio: null,
    timer: null,
    link: null
  };
  C.link = { write: (data) => icomLanCivSend(C, data), destroy: () => icomLanClose(C) };
  R.link = C.link;
  R.writer = { write: (data) => { icomLanCivSend(C, data); return Promise.resolve(); }, releaseLock: () => {} };
  R.icomLan = C;
  icomLanAudioNotify(R);
  C.ctl = icomLanStream(C, "ctl");
  C.timer = nodeTimers.setInterval(() => icomLanTick(C), ICOM_LAN_TICK_MS);
  icomLanStreamConnect(C.ctl, C.port);
  return Promise.resolve();
}

// Something went wrong: rigFail (the rig shown in error, tried again in a while; its link's destroy closes this), while this is still
// the rig's connection, else just closed
function icomLanFail(C, message)
{
  if (C.closed) return;
  if (C.R.link === C.link && C.generation == C.R.generation) rigFail(C.R, message);
  icomLanClose(C);
}

// Let go (rigDisconnect, through the link's destroy): the CI-V stream closed, the token given back, each stream disconnected, the
// sockets closed a moment later (the rig may still ask for those last packets: an idle after them shows it one that went missing)
function icomLanClose(C)
{
  if (C.closed) return;
  C.closed = true;
  nodeTimers.clearInterval(C.timer);
  if (C.R.icomLan === C) C.R.icomLan = null;
  if (C.civUp) icomLanCivOpen(C, true);
  if (C.loggedIn && C.ctl.state == "up") icomLanToken(C, ICOM_LAN_TOKEN_REMOVE);
  icomLanAudioNotify(C.R);
  const streams = [C.civ, C.audio, C.ctl].filter((T) => T);
  nodeTimers.setTimeout(() =>
  {
    for (const T of streams) if (T.state == "up" && T.idles) icomLanSendTracked(T, icomLanPacket(T, 0x10, ICOM_LAN_DATA));
  }, ICOM_LAN_IDLE_MS);
  nodeTimers.setTimeout(() =>
  {
    for (const T of streams)
    {
      if (T.state == "up")
      {
        const bye = icomLanPacket(T, 0x10, ICOM_LAN_DISCONNECT);
        icomLanSend(T, bye);
        icomLanSend(T, bye);
      }
      T.state = "closed";
      try
      {
        T.socket.close();
      }
      catch (e)
      {
        // Closed already
      }
    }
  }, ICOM_LAN_CLOSE_MS);
}

// Every ICOM_LAN_TICK_MS: each stream's hellos, pings, idles and missed packets; the setup's and the link's time limits, the token's
// renewal, the stream request once it can go, the CI-V stream's watchdog and the audio's
function icomLanTick(C)
{
  const now = Date.now();
  for (const T of [C.ctl, C.civ, C.audio]) if (T && !C.closed) icomLanStreamTick(T, now);
  if (C.closed) return;
  if (!C.civUp)
  {
    if (now - C.startedAt > ICOM_LAN_SETUP_MS) icomLanFail(C, I18N(C.loggedIn ? "rig.icomLan.noStreams" : "rig.icomLan.noAnswer"));
    else if (!C.requested && C.radio && (C.free || (C.tokenOk && now - C.capAt > ICOM_LAN_FREE_WAIT_MS))) icomLanRequest(C);
    return;
  }
  if (now - C.ctl.lastRx > ICOM_LAN_LOST_MS || now - C.civ.lastRx > ICOM_LAN_LOST_MS)
  {
    icomLanFail(C, I18N("rig.icomLan.lost").replace("{s}", String(ICOM_LAN_LOST_MS / 1000)));
    return;
  }
  if (now - C.tokenAt >= ICOM_LAN_TOKEN_MS)
  {
    C.tokenAt = now;
    icomLanToken(C, ICOM_LAN_TOKEN_RENEW);
  }
  if (now - Math.max(C.civDataAt, C.civOpenAt) > ICOM_LAN_CIV_QUIET_MS) icomLanCivOpen(C, false);
  icomLanAudioWatch(C, now);
}

// ---- A stream: its socket, its hello, its numbered packets both ways

function icomLanStream(C, name)
{
  const T = {
    C: C,
    name: name,
    socket: window.require("dgram").createSocket({ type: "udp4" }),
    state: "new",       // new, hello (03 until 04), readying (06 until 06), up, closed
    port: 0,
    localPort: 0,
    myId: 0,
    remoteId: 0,
    helloAt: 0,
    pingAt: 0,
    pingSeq: 0,
    sendSeq: 1,
    trackedAt: 0,
    // The numbered packets sent, by number, to send again on request
    history: new Map(),
    // The rig's numbered packets: the next one due, those in after a gap (held until it fills), the gaps ({ since, askedAt, tries })
    rx: { next: null, held: new Map(), missing: new Map(), old: 0 },
    lastRx: Date.now(),
    // Packets given up on since the last one delivered (the audio's zeros)
    lost: 0,
    idles: name != "audio"
  };
  T.socket.on("message", (msg) => icomLanReceive(T, msg));
  T.socket.on("error", (e) => icomLanFail(C, e.message));
  return T;
}

// The stream's socket to the rig's port, its id from the address and port it goes out from, and its hello begun
function icomLanStreamConnect(T, port)
{
  const C = T.C;
  T.port = port;
  T.socket.connect(port, C.host, (e) =>
  {
    if (C.closed) return;
    if (e)
    {
      icomLanFail(C, e.message);
      return;
    }
    const local = T.socket.address();
    let ip = local.address.split(".").map(Number);
    if (ip.length != 4 || ip.every((x) => x == 0)) ip = [C.localIp >>> 24, (C.localIp >>> 16) & 0xff, (C.localIp >>> 8) & 0xff, C.localIp & 0xff];
    if (T.name == "ctl") C.localIp = ((ip[0] << 24) | (ip[1] << 16) | (ip[2] << 8) | ip[3]) >>> 0;
    T.localPort = local.port;
    T.myId = ((ip[2] << 24) | (ip[3] << 16) | (local.port & 0xffff)) >>> 0;
    T.state = "hello";
    icomLanHello(T);
  });
}

function icomLanSend(T, b)
{
  if (T.state == "new" || T.state == "closed") return;
  try
  {
    T.socket.send(b);
  }
  catch (e)
  {
    // The socket closing
  }
}

// A packet's 16 bytes: its length, its type, its sequence number, our id and the rig's; the rest zeros
function icomLanPacket(T, size, type, seq = 0)
{
  const b = Buffer.alloc(size);
  b.writeUInt32LE(size, 0);
  b.writeUInt16LE(type, 4);
  b.writeUInt16LE(seq & 0xffff, 6);
  b.writeUInt32LE(T.myId, 8);
  b.writeUInt32LE(T.remoteId, 12);
  return b;
}

// A data packet out with the stream's next number, kept to be sent again on request
function icomLanSendTracked(T, b)
{
  const seq = T.sendSeq;
  T.sendSeq = (T.sendSeq + 1) & 0xffff;
  b.writeUInt16LE(seq, 6);
  T.history.delete(seq);
  T.history.set(seq, b);
  if (T.history.size > ICOM_LAN_HISTORY) T.history.delete(T.history.keys().next().value);
  T.trackedAt = Date.now();
  icomLanSend(T, b);
}

// Are you there (03, until the rig says I am here), then are you ready (06, until it says it is)
function icomLanHello(T)
{
  T.helloAt = Date.now();
  if (T.state == "hello") icomLanSend(T, icomLanPacket(T, 0x10, ICOM_LAN_ARE_YOU_THERE, 0));
  else if (T.state == "readying") icomLanSend(T, icomLanPacket(T, 0x10, ICOM_LAN_READY, 1));
}

function icomLanStreamTick(T, now)
{
  if (T.state == "hello" || T.state == "readying")
  {
    if (now - T.helloAt >= ICOM_LAN_HELLO_MS) icomLanHello(T);
    return;
  }
  if (T.state != "up") return;
  if (now - T.pingAt >= ICOM_LAN_PING_MS)
  {
    T.pingAt = now;
    const ping = icomLanPacket(T, 0x15, ICOM_LAN_PING, T.pingSeq);
    T.pingSeq = (T.pingSeq + 1) & 0xffff;
    const day = new Date();
    ping.writeUInt32LE((((day.getHours() * 60 + day.getMinutes()) * 60 + day.getSeconds()) * 1000 + day.getMilliseconds()) >>> 0, 0x11);
    icomLanSend(T, ping);
  }
  if (T.idles && now - T.trackedAt >= ICOM_LAN_IDLE_MS) icomLanSendTracked(T, icomLanPacket(T, 0x10, ICOM_LAN_DATA));
  icomLanRxTick(T, now);
}

// A packet in on a stream: a resend request answered (even while closing), a ping answered, the hello's answers, the rig's disconnect;
// a data packet into the numbered ones (icomLanTracked)
function icomLanReceive(T, msg)
{
  const C = T.C;
  if (msg.length < 0x10 || T.state == "closed") return;
  T.lastRx = Date.now();
  const type = msg.readUInt16LE(4);
  const seq = msg.readUInt16LE(6);
  if (type == ICOM_LAN_RESEND)
  {
    icomLanResend(T, msg);
    return;
  }
  if (C.closed) return;
  if (msg.length == 0x15 && type == ICOM_LAN_PING)
  {
    // The rig's own ping answered (its number and its 4 bytes back); an answer to ours counts as the rig there (lastRx)
    if (msg[0x10] != 0x00 || T.state != "up") return;
    const reply = icomLanPacket(T, 0x15, ICOM_LAN_PING, seq);
    reply[0x10] = 0x01;
    msg.copy(reply, 0x11, 0x11, 0x15);
    icomLanSend(T, reply);
    return;
  }
  if (msg.length == 0x10 && type != ICOM_LAN_DATA)
  {
    if (type == ICOM_LAN_I_AM_HERE && T.state == "hello")
    {
      T.remoteId = msg.readUInt32LE(8);
      T.state = "readying";
      icomLanHello(T);
    }
    else if (type == ICOM_LAN_READY && T.state == "readying")
    {
      T.state = "up";
      icomLanStreamUp(T);
    }
    else if (type == ICOM_LAN_DISCONNECT && T.state == "up") icomLanFail(C, I18N("rig.icomLan.closed"));
    return;
  }
  if (type == ICOM_LAN_DATA && T.state == "up") icomLanTracked(T, seq, msg);
}

// The rig asks for packets again: one (a 16-byte request, its number in the header), or several (pairs of numbers from 0x10, each a
// first and a last; a pair that isn't one, each number on its own). Each sent again as it was, or an idle with its number if no longer
// kept (the rig then stops asking)
function icomLanResend(T, msg)
{
  const seqs = new Set();
  if (msg.length == 0x10) seqs.add(msg.readUInt16LE(6));
  else
  {
    let at = 0x10;
    for (; at + 4 <= msg.length; at += 4)
    {
      const first = msg.readUInt16LE(at);
      const last = msg.readUInt16LE(at + 2);
      const span = (last - first) & 0xffff;
      if (span <= ICOM_LAN_GAP_MAX) for (let k = 0; k <= span; k++) seqs.add((first + k) & 0xffff);
      else
      {
        seqs.add(first);
        seqs.add(last);
      }
    }
    if (at + 2 <= msg.length) seqs.add(msg.readUInt16LE(at));
  }
  for (const seq of seqs)
  {
    const kept = T.history.get(seq);
    icomLanSend(T, kept || icomLanPacket(T, 0x10, ICOM_LAN_DATA, seq));
  }
}

// A numbered packet from the rig: delivered in order (icomLanDeliver), one after a gap held until the gap fills (the missed ones asked
// for again at once) or until ICOM_LAN_HOLD_MS (icomLanRxTick). A duplicate, or one too late, is let go
function icomLanTracked(T, seq, b)
{
  const W = T.rx;
  const now = Date.now();
  if (W.next === null) W.next = seq;
  let ahead = (seq - W.next) & 0xffff;
  if (ahead >= 0x8000)
  {
    // Older than what is due: a late copy, unless they keep coming (the rig numbering again from lower down)
    if (++W.old <= ICOM_LAN_OLD_MAX) return;
    ahead = ICOM_LAN_GAP_MAX + 1;
  }
  W.old = 0;
  if (ahead > ICOM_LAN_GAP_MAX)
  {
    W.held.clear();
    W.missing.clear();
    W.next = seq;
    ahead = 0;
  }
  if (W.held.has(seq)) return;
  W.held.set(seq, b);
  W.missing.delete(seq);
  for (let k = 0; k < ahead; k++)
  {
    const s = (W.next + k) & 0xffff;
    if (!W.held.has(s) && !W.missing.has(s)) W.missing.set(s, { since: now, askedAt: 0, tries: 0 });
  }
  icomLanRxFlush(T);
  if (W.missing.size) icomLanAsk(T, now);
}

function icomLanRxFlush(T)
{
  const W = T.rx;
  while (W.held.has(W.next) && !T.C.closed)
  {
    const b = W.held.get(W.next);
    W.held.delete(W.next);
    W.next = (W.next + 1) & 0xffff;
    icomLanDeliver(T, b);
  }
}

// A gap held too long given up (counted: the audio's zeros), what came after it delivered; the gaps still open asked for again
function icomLanRxTick(T, now)
{
  const W = T.rx;
  while (W.held.size && W.missing.has(W.next) && now - W.missing.get(W.next).since > ICOM_LAN_HOLD_MS && !T.C.closed)
  {
    W.missing.delete(W.next);
    W.next = (W.next + 1) & 0xffff;
    T.lost++;
    icomLanRxFlush(T);
  }
  if (W.missing.size) icomLanAsk(T, now);
}

// The missed packets not asked for lately asked for again: one in a 16-byte request, several as pairs (each number as its own first and
// last, which both ways of reading a request take the same)
function icomLanAsk(T, now)
{
  const seqs = [];
  for (const [seq, m] of T.rx.missing)
  {
    if (m.tries >= ICOM_LAN_ASK_TRIES || now - m.askedAt < ICOM_LAN_ASK_MS) continue;
    m.tries++;
    m.askedAt = now;
    seqs.push(seq);
  }
  if (seqs.length == 0) return;
  if (seqs.length == 1)
  {
    icomLanSend(T, icomLanPacket(T, 0x10, ICOM_LAN_RESEND, seqs[0]));
    return;
  }
  const b = icomLanPacket(T, 0x10 + seqs.length * 4, ICOM_LAN_RESEND, 0);
  seqs.forEach((seq, i) =>
  {
    b.writeUInt16LE(seq, 0x10 + i * 4);
    b.writeUInt16LE(seq, 0x12 + i * 4);
  });
  icomLanSend(T, b);
}

// A stream's numbered packet, in order: an idle is nothing; the rest by stream
function icomLanDeliver(T, b)
{
  if (b.length <= 0x10) return;
  if (T.name == "ctl") icomLanControl(T.C, b);
  else if (T.name == "civ") icomLanCivIn(T.C, b);
  else icomLanAudioIn(T.C, b);
}

// A stream answered its hello: the control stream logs in; the CI-V stream is opened and the rig connected (rigConnected: its poll
// begins); the audio stream's handles told
function icomLanStreamUp(T)
{
  const C = T.C;
  if (T.name == "ctl") icomLanLogin(C);
  else if (T.name == "civ")
  {
    C.civUp = true;
    icomLanCivOpen(C, false);
    if (C.R.link === C.link && C.generation == C.R.generation) rigConnected(C.R);
  }
  else
  {
    C.audioUp = true;
    icomLanAudioNotify(C.R);
  }
}

// ---- Control: the login, the token, the capabilities, the stream request and its answer

// The fields after the 16 bytes that the login, token and stream request share: the rest's size, asked (01), what it is, the next of
// our own count, our login number and the token
function icomLanInner(C, b, what)
{
  b.writeUInt32BE(b.length - 0x10, 0x10);
  b[0x14] = 0x01;
  b[0x15] = what;
  b.writeUInt16BE(C.innerSeq, 0x16);
  C.innerSeq = (C.innerSeq + 1) & 0xffff;
  b.writeUInt16LE(C.tokRequest, 0x1a);
  b.writeUInt32LE(C.token >>> 0, 0x1c);
}

// The login: the user (0x40) and password (0x50) scrambled, this program's name (0x60)
function icomLanLogin(C)
{
  const b = icomLanPacket(C.ctl, 0x80, ICOM_LAN_DATA);
  icomLanInner(C, b, 0x00);
  icomLanScramble(C.user).copy(b, 0x40);
  icomLanScramble(C.password).copy(b, 0x50);
  Buffer.from(ICOM_LAN_CLIENT, "latin1").copy(b, 0x60, 0, 15);
  icomLanSendTracked(C.ctl, b);
}

// A token packet: removed, acknowledged or renewed (0x24: 07 98, as wfview sends it)
function icomLanToken(C, what)
{
  const b = icomLanPacket(C.ctl, 0x40, ICOM_LAN_DATA);
  icomLanInner(C, b, what);
  b.writeUInt16BE(0x0798, 0x24);
  icomLanSendTracked(C.ctl, b);
}

// A control packet from the rig, by its length
function icomLanControl(C, b)
{
  const n = b.length;
  if (n == 0x60) icomLanLoginReply(C, b);
  else if (n == 0x40) icomLanTokenReply(C, b);
  else if (n == 0x50) icomLanStatus(C, b);
  else if (n == 0x90) icomLanConnInfo(C, b);
  else if (n > ICOM_LAN_CAPS_HEADER && (n - ICOM_LAN_CAPS_HEADER) % ICOM_LAN_CAPS_RADIO == 0) icomLanCaps(C, b);
}

// The login's answer: a wrong user or password, or the token (our login number with it); acknowledged, and renewed at once (as
// kappanhang does: the renewal's answer says the token is good)
function icomLanLoginReply(C, b)
{
  if (b.readUInt32LE(0x30) == ICOM_LAN_BAD_LOGIN)
  {
    icomLanFail(C, I18N("rig.icomLan.badLogin"));
    return;
  }
  if (C.loggedIn || b.readUInt16LE(0x1a) != C.tokRequest) return;
  C.token = b.readUInt32LE(0x1c);
  C.loggedIn = true;
  C.tokenAt = Date.now();
  icomLanToken(C, ICOM_LAN_TOKEN_ACK);
  icomLanToken(C, ICOM_LAN_TOKEN_RENEW);
}

// A renewal's answer (02 05): 0 the token good; FFFFFFFF refused (logged in again: rigFail tries again)
function icomLanTokenReply(C, b)
{
  if (b[0x14] != 0x02 || b[0x15] != ICOM_LAN_TOKEN_RENEW) return;
  const response = b.readUInt32LE(0x30);
  if (response == 0) C.tokenOk = true;
  else if (response == ICOM_LAN_REFUSED) icomLanFail(C, I18N("rig.icomLan.tokenRefused"));
}

// The capabilities: the first radio's (a server with several: the first). Its id (16 bytes, the stream request names it), its name
// (0x10), its CI-V address (0x52: the address frames go to, R.civFound) and its transmit rates (0x55: none, no transmit audio)
function icomLanCaps(C, b)
{
  if (C.radio) return;
  const at = ICOM_LAN_CAPS_HEADER;
  C.radio = { guid: Buffer.from(b.subarray(at, at + 0x10)), name: icomLanText(b, at + 0x10, 32), civ: b[at + 0x52], txRates: b.readUInt16LE(at + 0x55) };
  C.capAt = Date.now();
  C.txAllowed = C.radio.txRates > 1;
  if (C.radio.name) C.R.model = C.radio.name;
  if (C.radio.civ > 0 && C.radio.civ < 0xff) C.R.civFound = C.radio.civ;
}

// Who is using the rig (0x60 busy, 0x64 that program's name, 0x84 its IPv4 address, big-endian): no one, the stream can be asked for;
// someone else (not this program from here), it is said and tried again later
function icomLanConnInfo(C, b)
{
  if (C.streamsUp) return;
  if (b.readUInt32LE(0x60) == 0)
  {
    C.free = true;
    return;
  }
  const computer = icomLanText(b, 0x64, 16);
  const ip = b.readUInt32BE(0x84);
  if (ip == 0 || (computer == ICOM_LAN_CLIENT && (ip == C.localIp || C.localIp == 0))) return;
  const dotted = [ip >>> 24, (ip >>> 16) & 0xff, (ip >>> 8) & 0xff, ip & 0xff].join(".");
  icomLanFail(C, I18N("rig.icomLan.inUse").replace("{name}", computer || "?").replace("{ip}", dotted));
}

// The CI-V and audio streams asked for: their sockets bound first (their ports go in the request)
function icomLanRequest(C)
{
  C.requested = true;
  C.civ = icomLanStream(C, "civ");
  C.audio = icomLanStream(C, "audio");
  let bound = 0;
  for (const T of [C.civ, C.audio])
  {
    T.socket.bind(0, () =>
    {
      T.localPort = T.socket.address().port;
      if (++bound == 2 && !C.closed) icomLanRequestSend(C);
    });
  }
}

// The stream request: the radio (its id from the capabilities, its name), the user scrambled, receive and transmit on, the codec and
// rate each way, our CI-V and audio ports, the transmit buffer, and 01 (convert, as both clients send it)
function icomLanRequestSend(C)
{
  const b = icomLanPacket(C.ctl, 0x90, ICOM_LAN_DATA);
  icomLanInner(C, b, 0x03);
  C.radio.guid.copy(b, 0x20);
  Buffer.from(C.radio.name, "latin1").copy(b, 0x40, 0, 31);
  icomLanScramble(C.user).copy(b, 0x60);
  b[0x70] = 0x01;
  b[0x71] = C.txAllowed ? 0x01 : 0x00;
  b[0x72] = ICOM_LAN_CODEC_PCM16;
  b[0x73] = C.txAllowed ? ICOM_LAN_CODEC_PCM16 : 0x00;
  b.writeUInt32BE(C.rate, 0x74);
  b.writeUInt32BE(C.txAllowed ? C.rate : 0, 0x78);
  b.writeUInt32BE(C.civ.localPort, 0x7c);
  b.writeUInt32BE(C.audio.localPort, 0x80);
  b.writeUInt32BE(ICOM_LAN_TX_BUFFER_MS, 0x84);
  b[0x88] = 0x01;
  icomLanSendTracked(C.ctl, b);
}

// The status: refused (0x30 FFFFFFFF), the rig disconnecting us (0x40 01), or its CI-V (0x42) and audio (0x46) ports, big-endian: those
// streams' hellos begun
function icomLanStatus(C, b)
{
  const error = b.readUInt32LE(0x30);
  if (error == ICOM_LAN_REFUSED)
  {
    if (!C.streamsUp) icomLanFail(C, I18N("rig.icomLan.refused"));
    return;
  }
  if (error == 0 && b[0x40] == 0x01)
  {
    icomLanFail(C, I18N("rig.icomLan.closed"));
    return;
  }
  if (C.streamsUp || !C.requested || !C.civ.localPort || !C.audio.localPort) return;
  C.streamsUp = true;
  icomLanStreamConnect(C.civ, b.readUInt16BE(0x42) || C.port + 1);
  icomLanStreamConnect(C.audio, b.readUInt16BE(0x46) || C.port + 2);
}

// ---- CI-V

// The CI-V stream opened (04) or closed (00)
function icomLanCivOpen(C, close)
{
  const b = icomLanPacket(C.civ, 0x16, ICOM_LAN_DATA);
  b.writeUInt16LE(0x01c0, 0x10);
  b.writeUInt16BE(C.civSeq, 0x13);
  C.civSeq = (C.civSeq + 1) & 0xffff;
  b[0x15] = close ? 0x00 : 0x04;
  C.civOpenAt = Date.now();
  icomLanSendTracked(C.civ, b);
}

// A CI-V frame out (rigDrain, through R.writer): in a packet of its own
function icomLanCivSend(C, data)
{
  if (C.closed || !C.civUp || data === null || data === undefined) return;
  const bytes = typeof data == "string" ? Buffer.from(data, "latin1") : Buffer.from(data);
  const b = icomLanPacket(C.civ, ICOM_LAN_CIV_HEADER + bytes.length, ICOM_LAN_DATA);
  b[0x10] = 0xc1;
  b.writeUInt16LE(bytes.length, 0x11);
  b.writeUInt16BE(C.civSeq, 0x13);
  C.civSeq = (C.civSeq + 1) & 0xffff;
  bytes.copy(b, ICOM_LAN_CIV_HEADER);
  icomLanSendTracked(C.civ, b);
}

// The rig's CI-V (C1, its length right): to rig.js' framing and the civ protocol's parse
function icomLanCivIn(C, b)
{
  if (b.length <= ICOM_LAN_CIV_HEADER || b[0x10] != 0xc1 || b.readUInt16LE(0x11) + ICOM_LAN_CIV_HEADER != b.length) return;
  C.civDataAt = Date.now();
  if (C.R.link === C.link && C.generation == C.R.generation) rigReceive(C.R, new Uint8Array(b.subarray(ICOM_LAN_CIV_HEADER)));
}

// ---- Audio, for the Multi-Mode Decoder: one "in" handle (the rig's receive audio) and one "out" handle (audio to transmit) per rig
// (R.icomLanIn, R.icomLanOut; a new one replaces the old), kept across reconnects: the stream of each connection feeds them

function icomLanAudioStart(R, dir, sink)
{
  const H = { R: R, dir: dir, sink: sink, stopped: false, said: null, audioAt: Date.now(), pending: Buffer.alloc(0) };
  const key = dir == "out" ? "icomLanOut" : "icomLanIn";
  if (R[key]) R[key].stopped = true;
  R[key] = H;
  H.stop = () =>
  {
    H.stopped = true;
    if (R[key] === H) R[key] = null;
  };
  if (dir == "out")
  {
    H.write = (samples) => icomLanAudioWrite(H, samples);
    Object.defineProperty(H, "rate", { get: () => icomLanRate(R), enumerable: true });
  }
  icomLanAudioNotify(R);
  return H;
}

// A handle's status, said only when it changes
function icomLanAudioSay(H, text, error = false)
{
  if (H.stopped || H.said === text) return;
  H.said = text;
  try
  {
    H.sink.status(text, error);
  }
  catch (e)
  {
    // The listener's window gone
  }
}

function icomLanRateText(rate)
{
  return rate / 1000 + " kHz";
}

function icomLanRadioName(C)
{
  return (C.radio && C.radio.name) || C.host;
}

// The handles told how the rig's audio stream is: not there (waiting for the rig), up (in: its 2 s without audio counted from now; out:
// ready, or the rig takes no transmit audio)
function icomLanAudioNotify(R)
{
  const C = R.icomLan && !R.icomLan.closed ? R.icomLan : null;
  const up = !!C && C.audioUp;
  const H = R.icomLanIn;
  if (H && !H.stopped)
  {
    H.audioAt = Date.now();
    if (!up) icomLanAudioSay(H, I18N("rig.icomLan.audio.waiting"));
  }
  const O = R.icomLanOut;
  if (O && !O.stopped)
  {
    O.pending = Buffer.alloc(0);
    if (!up) icomLanAudioSay(O, I18N("rig.icomLan.audio.waiting"));
    else if (!C.txAllowed) icomLanAudioSay(O, I18N("rig.icomLan.audio.noTx"), true);
    else icomLanAudioSay(O, I18N("rig.icomLan.audio.ready").replace("{rate}", icomLanRateText(C.rate)).replace("{radio}", icomLanRadioName(C)));
  }
}

// No audio in for a while, said once (each tick while the audio stream is up)
function icomLanAudioWatch(C, now)
{
  const H = C.R.icomLanIn;
  if (C.audioUp && H && !H.stopped && now - H.audioAt > ICOM_LAN_NO_AUDIO_MS) icomLanAudioSay(H, I18N("rig.icomLan.audio.noAudio").replace("{s}", String(ICOM_LAN_NO_AUDIO_MS / 1000)));
}

// An audio packet from the rig: its samples (16-bit little-endian) to the in handle at the stream's rate, after zeros for the packets
// given up on since the last (each taken to have held as many samples as the last one did; more than a second's worth: none)
function icomLanAudioIn(C, b)
{
  const T = C.audio;
  const lost = T.lost;
  T.lost = 0;
  if (b.length < ICOM_LAN_AUDIO_HEADER + 2) return;
  const n = (b.length - ICOM_LAN_AUDIO_HEADER) >> 1;
  const fill = lost * C.audioPacketSamples;
  C.audioPacketSamples = n;
  const H = C.R.icomLanIn;
  if (!H || H.stopped || C.R.icomLan !== C) return;
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = b.readInt16LE(ICOM_LAN_AUDIO_HEADER + i * 2) / 32768;
  H.audioAt = Date.now();
  icomLanAudioSay(H, I18N("rig.icomLan.audio.receiving").replace("{rate}", icomLanRateText(C.rate)).replace("{radio}", icomLanRadioName(C)));
  try
  {
    if (fill > 0 && fill <= C.rate) H.sink.pcm(new Float32Array(fill), C.rate);
    H.sink.pcm(samples, C.rate);
  }
  catch (e)
  {
    // The listener's window gone
  }
}

// Audio to transmit (the out handle's write, mono at the stream's rate): 16-bit, sent 20 ms at a time as it fills (each 20 ms in
// packets of ICOM_LAN_AUDIO_MAX bytes at most). Nothing while the stream isn't up, or the rig takes none
function icomLanAudioWrite(H, samples)
{
  const C = H.R.icomLan;
  if (H.stopped || !C || C.closed || !C.audioUp || !C.txAllowed || !samples || !samples.length) return;
  const b = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i] || 0)) * 32767), i * 2);
  H.pending = H.pending.length ? Buffer.concat([H.pending, b]) : b;
  const frame = (C.rate / 50) * 2;
  while (H.pending.length >= frame)
  {
    const chunk = H.pending.subarray(0, frame);
    H.pending = H.pending.subarray(frame);
    for (let at = 0; at < chunk.length; at += ICOM_LAN_AUDIO_MAX) icomLanAudioSend(C, chunk.subarray(at, Math.min(chunk.length, at + ICOM_LAN_AUDIO_MAX)));
  }
}

// One audio packet out: 0x10 80 00 (97 81 for a 160-byte one, as wfview sends them), its count and its length (big-endian), the samples
function icomLanAudioSend(C, pcm)
{
  const b = icomLanPacket(C.audio, ICOM_LAN_AUDIO_HEADER + pcm.length, ICOM_LAN_DATA);
  b.writeUInt16LE(pcm.length == 0xa0 ? 0x9781 : 0x0080, 0x10);
  b.writeUInt16BE(C.audioSeq, 0x12);
  C.audioSeq = (C.audioSeq + 1) & 0xffff;
  b.writeUInt16BE(pcm.length, 0x16);
  pcm.copy(b, ICOM_LAN_AUDIO_HEADER);
  icomLanSendTracked(C.audio, b);
}
