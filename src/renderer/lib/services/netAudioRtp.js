// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// RTP audio as a network audio protocol (netAudio.js): what PipeWire's module-rtp-sink / module-rtp-source / module-rtp-sap,
// PulseAudio's module-rtp-send / module-rtp-recv and AES67-style senders speak, both ways.
//   RTP (RFC 3550) over UDP: a 12-byte header (version 2, padding, extension and CSRC count bits, marker and payload type, a 16-bit
//   sequence number, a 32-bit timestamp counting sample frames, the stream's SSRC), CSRCs (4 bytes each), an optional header extension
//   (4 bytes: its profile and its length in 32-bit words, then those words), the payload, padding (its last byte its count).
//   Payloads (RFC 3551, RFC 3190): L16 signed 16-bit big-endian, L24 signed 24-bit big-endian, L8 unsigned 8-bit, PCMU / PCMA G.711,
//   channels interleaved. Static payload types: 0 PCMU 8000/1, 8 PCMA 8000/1, 10 L16 44100/2, 11 L16 44100/1; 96-127 are dynamic,
//   their format told by the SDP (PipeWire and PulseAudio use 127 for anything not 10/11). RTCP muxed on the port: second byte 200-204.
//   Defaults of both Linux servers: multicast 224.0.0.56, TTL 1, multicast loopback off, PipeWire's port 46000 (or an even one up to
//   47022 picked at random), MTU 1280, packets of 2-20 ms; PipeWire sends S16BE 48000/2 by default, PulseAudio its sink's rate as L16.
//   SAP (RFC 2974) on UDP 9875 tells receivers about a stream: a 4-byte header (version 1, address type, T = deletion, E encrypted,
//   C compressed, the authentication length, a 16-bit message id hash), the origin's address (4 bytes for IPv4), "application/sdp" and
//   a NUL (optional), then the SDP (RFC 4566). PipeWire and PulseAudio announce on 224.0.0.56 every 5 s and send a deletion when the
//   stream stops (PipeWire forgets a session after 90 s without one); 224.2.127.254 is the standard SAP group, 239.255.255.255 the one
//   AES67 / Dante devices use. PipeWire's SDP: v=, o=, s=, c=IN IP4 <group>/<ttl>, t=, m=audio <port> RTP/AVP <pt>, i=<n> channels,
//   a=recvonly, a=rtpmap:<pt> L16/48000/2, a=source-filter, a=ptime, a=framecount, a=ts-refclk + a=mediaclk:direct= (PTP) or
//   a=mediaclk:sender, a=tool:PipeWire <version>, a=type:broadcast. PulseAudio's: v=, o=, s=, c=IN IP4 <group>, t=, a=recvonly, m=audio,
//   a=rtpmap:<pt> L16/<rate>/<channels> (it needs the channel count), a=type:broadcast; it reads L16 only.
// Input: one socket per local UDP port, shared by every stream on it, joined to each stream's multicast group on every IPv4 interface.
//   The stream's rate and channels are used unless a SAP announcement for its group and port says otherwise. Each stream locks to the
//   first SSRC it hears (another sender on the same group and port is ignored and said so); a short reorder buffer puts packets back
//   in sequence, drops duplicates and fills what was lost with silence (from the RTP timestamps, so the timeline stays true).
// Output: L16 packets of whole milliseconds within 1400 bytes (at most 20 ms), announced by SAP so PipeWire and PulseAudio pick them up.

const RTP_VERSION = 2;
const RTP_HEADER_BYTES = 12;
const RTP_DEFAULT_PORT = 46000;
const RTP_DEFAULT_GROUP = "224.0.0.56";
const RTP_DYNAMIC_PT = 96;
const RTP_PAYLOAD_MAX = 1400;
const RTP_PTIME_MAX_MS = 20;
// Packets held waiting for one missing before it is taken as lost, and the longest one is held
const RTP_REORDER_PACKETS = 3;
const RTP_REORDER_MS = 60;
// Silence filled in for lost packets up to this long; a longer gap is a restart, not filled
const RTP_GAP_MAX_SEC = 1;
// A sequence jump bigger than these (ahead, behind) is a restart, taken when a second packet in sequence confirms it
const RTP_SEQ_AHEAD_MAX = 3000;
const RTP_SEQ_BEHIND_MAX = 64;
const RTP_SILENT_MS = 2000;
// The SSRC a stream locked to, silent this long: another one takes its place (the sender restarted)
const RTP_SSRC_TAKEOVER_MS = 1000;
const RTP_RETRY_MS = 3000;
const RTP_TICK_MS = 50;
// Interfaces looked at again this often, for multicast memberships on new ones (Wi-Fi back, a cable plugged in)
const RTP_REJOIN_MS = 30000;
// The producer silent this long: the timestamps jump ahead with the clock, and the next packet has the marker bit
const RTP_OUT_IDLE_MS = 200;
const RTP_STATIC_PT = {
  0: { enc: "PCMU", rate: 8000, channels: 1 },
  8: { enc: "PCMA", rate: 8000, channels: 1 },
  10: { enc: "L16", rate: 44100, channels: 2 },
  11: { enc: "L16", rate: 44100, channels: 1 }
};
// Bytes per sample of each payload format read
const RTP_ENCODINGS = { L8: 1, L16: 2, L24: 3, PCMU: 1, PCMA: 1 };
const SAP_PORT = 9875;
const SAP_LISTEN_GROUPS = ["224.0.0.56", "224.2.127.254", "239.255.255.255"];
const SAP_SEND_GROUPS = ["224.0.0.56", "224.2.127.254"];
const SAP_MIME = "application/sdp";
// Announcements: every 5 s for the first minute (as PipeWire and PulseAudio do), then every 20 s (well within PipeWire's 90 s)
const SAP_FAST_MS = 5000;
const SAP_FAST_FOR_MS = 60000;
const SAP_SLOW_MS = 20000;
// A session heard of is forgotten after 10 of its intervals (within these), 5 minutes while its interval isn't known yet
const SAP_EXPIRE_FIRST_MS = 300000;
const SAP_EXPIRE_MIN_MS = 60000;
const SAP_EXPIRE_MAX_MS = 3600000;
const SAP_EXPIRE_CHECK_MS = 10000;
const NTP_EPOCH_OFFSET = 2208988800;

// G.711 µ-law and A-law to ±1
const RTP_ULAW = new Float32Array(256);
const RTP_ALAW = new Float32Array(256);
for (let i = 0; i < 256; i++)
{
  const u = ~i & 0xff;
  const t = (((u & 0x0f) << 3) + 0x84) << ((u & 0x70) >> 4);
  RTP_ULAW[i] = (u & 0x80 ? 0x84 - t : t - 0x84) / 32768;
  const a = i ^ 0x55;
  const seg = (a & 0x70) >> 4;
  let v = (a & 0x0f) << 4;
  if (seg == 0) v += 8;
  else
  {
    v += 0x108;
    if (seg > 1) v <<= seg - 1;
  }
  RTP_ALAW[i] = (a & 0x80 ? v : -v) / 32768;
}

// Input sockets by local port, and the one SAP listener shared by every input and every discover
const RTP_IN_SOCKETS = new Map();
const RTP_SAP = { socket: null, users: new Set(), sessions: new Map(), joined: new Set(), retry: null, rejoin: null, expire: null };

NET_AUDIO_PROTOCOLS.rtp = {
  name: "RTP (PipeWire / PulseAudio / AES67)",
  dirs: ["in", "out"],
  fields: { in: ["host", "port", "rate", "channels", "channel"], out: ["host", "port", "rate", "channels", "announce"] },
  defaults: { host: RTP_DEFAULT_GROUP, port: RTP_DEFAULT_PORT, rate: 48000, channels: 2, channel: "left" },
  discover: (onList) => rtpDiscover(onList),
  open: (stream, dir, sink) => (dir == "out" ? rtpOutOpen(stream, sink) : rtpInOpen(stream, sink))
};

// ---- Shared helpers

function rtpIsIpv4(text)
{
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(text || "");
}

// Node takes a UDP port above 65535 modulo 65536 without a word: a port out of range is said instead
function rtpPortValid(port)
{
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function rtpIsMulticast(ip)
{
  if (!rtpIsIpv4(ip)) return false;
  const first = parseInt(ip, 10);
  return first >= 224 && first <= 239;
}

// Every IPv4 address of this computer, loopback too (multicast sent from this computer can come back on it)
function rtpLocalAddresses()
{
  const list = [];
  let interfaces = {};
  try
  {
    interfaces = window.require("os").networkInterfaces();
  }
  catch (e)
  {
    return list;
  }
  for (const name in interfaces)
  {
    for (const item of interfaces[name] || [])
    {
      if (item.family == "IPv4" || item.family === 4) list.push(item.address);
    }
  }
  return list;
}

// The first address of this computer that isn't loopback, for an announcement's origin when the socket doesn't say
function rtpOwnAddress()
{
  const list = rtpLocalAddresses().filter((ip) => !ip.startsWith("127."));
  return list.length ? list[0] : "127.0.0.1";
}

// A multicast group joined on every IPv4 interface not joined yet (joined: a Set of "group|address" kept by the socket's owner). A
// computer with one interface that refuses it, or none at all, joins it the system's default way. The error, if nothing could be joined
function rtpJoin(socket, group, joined)
{
  let error = null;
  let any = false;
  for (const address of rtpLocalAddresses())
  {
    const key = group + "|" + address;
    if (joined.has(key))
    {
      any = true;
      continue;
    }
    try
    {
      socket.addMembership(group, address);
      joined.add(key);
      any = true;
    }
    catch (e)
    {
      error = error || e;
    }
  }
  if (!any && !joined.has(group + "|"))
  {
    try
    {
      socket.addMembership(group);
      joined.add(group + "|");
      any = true;
    }
    catch (e)
    {
      error = error || e;
    }
  }
  // Interfaces gone: forgotten, so they are joined again when they come back
  const now = new Set(rtpLocalAddresses());
  for (const key of joined)
  {
    const address = key.slice(key.indexOf("|") + 1);
    if (address && !now.has(address)) joined.delete(key);
  }
  return any ? null : error;
}

function rtpLeave(socket, group, joined)
{
  for (const key of Array.from(joined))
  {
    if (!key.startsWith(group + "|")) continue;
    const address = key.slice(group.length + 1);
    try
    {
      if (address) socket.dropMembership(group, address);
      else socket.dropMembership(group);
    }
    catch (e)
    {
      // Already gone with its interface
    }
    joined.delete(key);
  }
}

// "48 kHz, 2 ch, 16-bit" for status lines
function rtpFormatText(fmt)
{
  const khz = Math.round(fmt.rate / 10) / 100;
  const kind = fmt.enc == "PCMU" ? "µ-law" : fmt.enc == "PCMA" ? "A-law" : RTP_ENCODINGS[fmt.enc] * 8 + "-bit";
  return khz + " kHz, " + fmt.channels + " ch, " + kind;
}

// ---- SDP (RFC 4566) and SAP (RFC 2974)

// An SDP's session: its origin (o=, whose fields but the version name the session), name, tool, and each audio stream of it with its
// address, port and the formats this file can read by payload type (fmt: the first of them in the m= line's order). Null if it isn't
// one (it must start v=0). IPv6 addresses are skipped
function rtpSdpParse(text)
{
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length >= 2 && line[1] == "=");
  if (!lines.length || lines[0] != "v=0") return null;
  const session = { origin: null, name: "", tool: "", media: [] };
  let conn = null;
  let media = null;
  for (const line of lines)
  {
    const type = line[0];
    const value = line.slice(2);
    if (type == "o")
    {
      const parts = value.split(/\s+/);
      if (parts.length >= 6) session.origin = { user: parts[0], id: parts[1], version: parts[2], address: parts[5], key: [parts[0], parts[1], parts[3], parts[4], parts[5]].join(" ") };
    }
    else if (type == "s") session.name = value.trim();
    else if (type == "c")
    {
      const m = value.match(/^IN\s+IP4\s+([0-9.]+)(?:\/(\d+))?/);
      const c = m ? { host: m[1], ttl: m[2] ? parseInt(m[2], 10) : null } : { host: null, ttl: null };
      if (media) media.conn = c;
      else conn = c;
    }
    else if (type == "m")
    {
      const m = value.match(/^(\S+)\s+(\d+)(?:\/\d+)?\s+(\S+)\s*(.*)$/);
      media = m ? { kind: m[1], port: parseInt(m[2], 10), proto: m[3], pts: m[4].split(/\s+/).filter((pt) => /^\d+$/.test(pt)).map(Number), rtpmap: {}, ptime: null, conn: null } : { kind: "", rtpmap: {} };
      session.media.push(media);
    }
    else if (type == "a")
    {
      const colon = value.indexOf(":");
      const name = colon < 0 ? value : value.slice(0, colon);
      const arg = colon < 0 ? "" : value.slice(colon + 1).trim();
      // PipeWire puts its tool after the m= line
      if (name == "tool") session.tool = session.tool || arg;
      else if (name == "rtpmap" && media)
      {
        const m = arg.match(/^(\d+)\s+([^/\s]+)\/(\d+)(?:\/(\d+))?/);
        if (m) media.rtpmap[parseInt(m[1], 10)] = { enc: m[2].toUpperCase(), rate: parseInt(m[3], 10), channels: m[4] ? parseInt(m[4], 10) : 1 };
      }
      else if (name == "ptime" && media) media.ptime = parseFloat(arg) || null;
    }
  }
  session.media = session.media.filter((item) => item.kind == "audio" && /^RTP\/AVP/.test(item.proto || "") && item.port > 0).map((item) =>
  {
    const c = item.conn || conn || { host: null, ttl: null };
    const formats = {};
    let fmt = null;
    let other = null;
    for (const pt of item.pts)
    {
      const info = item.rtpmap[pt] || RTP_STATIC_PT[pt];
      if (!info) continue;
      if (RTP_ENCODINGS[info.enc] && info.rate > 0 && info.channels > 0)
      {
        formats[pt] = { enc: info.enc, rate: info.rate, channels: info.channels };
        fmt = fmt || formats[pt];
      }
      else other = other || info.enc;
    }
    return { port: item.port, host: c.host, multicast: rtpIsMulticast(c.host), ttl: c.ttl, formats: formats, fmt: fmt, unsupported: fmt ? null : other, ptime: item.ptime, name: session.name };
  }).filter((item) => item.host);
  return session;
}

// A SAP packet's parts: deletion or not, its message id hash, the origin's address, the SDP text. Null if it isn't one this reads
// (another version, encrypted, compressed, IPv6 origin, another payload type)
function rtpSapParse(msg)
{
  if (msg.length < 4) return null;
  const flags = msg[0];
  if (flags >> 5 != 1 || flags & 0x03 || flags & 0x10) return null;
  let off = 8 + msg[1] * 4;
  if (off > msg.length) return null;
  const origin = msg[4] + "." + msg[5] + "." + msg[6] + "." + msg[7];
  let body = msg.subarray(off);
  if (body.subarray(0, 3).toString("latin1") != "v=0")
  {
    const nul = body.indexOf(0);
    if (nul < 0 || nul > 64 || body.subarray(0, nul).toString("latin1").toLowerCase() != SAP_MIME) return null;
    body = body.subarray(nul + 1);
  }
  const end = body.indexOf(0);
  return { deletion: !!(flags & 0x04), hash: msg.readUInt16BE(2), origin: origin, sdp: body.subarray(0, end < 0 ? body.length : end).toString("utf8") };
}

function rtpSapBuild(deletion, hash, origin, sdp)
{
  const head = Buffer.alloc(8);
  head[0] = 0x20 | (deletion ? 0x04 : 0);
  head.writeUInt16BE(hash, 2);
  const parts = origin.split(".").map((part) => parseInt(part, 10) & 0xff);
  for (let i = 0; i < 4; i++) head[4 + i] = parts[i] || 0;
  return Buffer.concat([head, Buffer.from(SAP_MIME + "\0", "latin1"), Buffer.from(sdp, "utf8")]);
}

// ---- The SAP listener: sessions on the LAN, for discover and for inputs (their format)

function rtpSapUse(user)
{
  RTP_SAP.users.add(user);
  if (!RTP_SAP.socket && !RTP_SAP.retry) rtpSapOpen();
}

function rtpSapRelease(user)
{
  RTP_SAP.users.delete(user);
  if (RTP_SAP.users.size) return;
  rtpSapClose();
  if (RTP_SAP.retry) nodeTimers.clearTimeout(RTP_SAP.retry);
  RTP_SAP.retry = null;
  RTP_SAP.sessions.clear();
}

function rtpSapClose()
{
  if (RTP_SAP.rejoin) nodeTimers.clearInterval(RTP_SAP.rejoin);
  if (RTP_SAP.expire) nodeTimers.clearInterval(RTP_SAP.expire);
  RTP_SAP.rejoin = RTP_SAP.expire = null;
  if (RTP_SAP.socket)
  {
    try
    {
      RTP_SAP.socket.close();
    }
    catch (e)
    {
      // Closed already
    }
  }
  RTP_SAP.socket = null;
  RTP_SAP.joined.clear();
}

// UDP 9875, shared with anything else on this computer listening to SAP, joined to the SAP groups. Tried again every 3 s if it can't be
// opened (announcements are a help, not a need: the inputs work with their own settings meanwhile)
function rtpSapOpen()
{
  const socket = window.require("dgram").createSocket({ type: "udp4", reuseAddr: true });
  RTP_SAP.socket = socket;
  socket.on("error", () =>
  {
    if (RTP_SAP.socket != socket) return;
    rtpSapClose();
    if (RTP_SAP.users.size) RTP_SAP.retry = nodeTimers.setTimeout(() =>
    {
      RTP_SAP.retry = null;
      if (RTP_SAP.users.size && !RTP_SAP.socket) rtpSapOpen();
    }, RTP_RETRY_MS);
  });
  socket.on("listening", () =>
  {
    const join = () => SAP_LISTEN_GROUPS.forEach((group) => rtpJoin(socket, group, RTP_SAP.joined));
    join();
    RTP_SAP.rejoin = nodeTimers.setInterval(join, RTP_REJOIN_MS);
    RTP_SAP.expire = nodeTimers.setInterval(rtpSapExpire, SAP_EXPIRE_CHECK_MS);
  });
  socket.on("message", (msg, rinfo) => rtpSapMessage(msg, rinfo));
  try
  {
    socket.bind({ port: SAP_PORT, exclusive: false });
  }
  catch (e)
  {
    socket.emit("error", e);
  }
}

// An announcement kept (or refreshed), or a deletion acted on. A session is its message id hash and origin; one whose SDP origin line
// matches a newer announcement's (its SDP changed, so its hash did) is replaced by it. The same announcement heard on two SAP groups
// within a second isn't taken as its interval
function rtpSapMessage(msg, rinfo)
{
  const sap = rtpSapParse(msg);
  if (!sap) return;
  const sdp = rtpSdpParse(sap.sdp);
  const key = sap.hash + "|" + (sap.origin != "0.0.0.0" ? sap.origin : rinfo.address);
  const now = Date.now();
  let changed = false;
  if (sap.deletion)
  {
    for (const [other, item] of RTP_SAP.sessions)
    {
      if (other == key || (sdp && sdp.origin && item.sdp.origin && item.sdp.origin.key == sdp.origin.key))
      {
        RTP_SAP.sessions.delete(other);
        changed = true;
      }
    }
  }
  else if (sdp && sdp.origin)
  {
    const old = RTP_SAP.sessions.get(key);
    for (const [other, item] of RTP_SAP.sessions)
    {
      if (other != key && item.sdp.origin && item.sdp.origin.key == sdp.origin.key)
      {
        RTP_SAP.sessions.delete(other);
        changed = true;
      }
    }
    let interval = old ? old.interval : null;
    if (old && now - old.last >= 1000) interval = now - old.last;
    const life = interval ? Math.max(SAP_EXPIRE_MIN_MS, Math.min(SAP_EXPIRE_MAX_MS, interval * 10)) : SAP_EXPIRE_FIRST_MS;
    RTP_SAP.sessions.set(key, { text: sap.sdp, sdp: sdp, from: rinfo.address, last: old && now - old.last < 1000 ? old.last : now, interval: interval, expires: now + life });
    if (!old || old.text != sap.sdp) changed = true;
  }
  if (changed) rtpSapChanged();
}

function rtpSapExpire()
{
  const now = Date.now();
  let changed = false;
  for (const [key, item] of RTP_SAP.sessions)
  {
    if (item.expires < now)
    {
      RTP_SAP.sessions.delete(key);
      changed = true;
    }
  }
  if (changed) rtpSapChanged();
}

function rtpSapChanged()
{
  for (const user of Array.from(RTP_SAP.users))
  {
    try
    {
      user.onChange();
    }
    catch (e)
    {
      // A listener's window gone: it is stopped by its owner
    }
  }
}

// The announced stream for an input's group (blank: a unicast one) and port, the most recently heard if more than one
function rtpSapFind(group, port)
{
  let best = null;
  for (const item of RTP_SAP.sessions.values())
  {
    for (const media of item.sdp.media)
    {
      if (media.port != port) continue;
      if (group ? media.host != group : media.multicast) continue;
      if (!best || item.last > best.last) best = { last: item.last, media: media };
    }
  }
  return best ? best.media : null;
}

// The Found menu's list: each announced audio stream this file can read, its name, where and its format
function rtpSapList()
{
  const list = [];
  for (const item of RTP_SAP.sessions.values())
  {
    const tool = /^pipewire/i.test(item.sdp.tool) ? "PipeWire RTP" : "RTP";
    for (const media of item.sdp.media)
    {
      if (!media.fmt) continue;
      const where = media.multicast ? media.host + ":" + media.port : "UDP " + media.port;
      const khz = Math.round(media.fmt.rate / 10) / 100;
      list.push({
        label: tool + ": " + (item.sdp.name || item.from) + " (" + where + ", " + khz + " kHz " + media.fmt.channels + " ch)",
        dir: "in",
        fields: { host: media.multicast ? media.host : "", port: media.port, rate: media.fmt.rate, channels: media.fmt.channels > 1 ? 2 : 1 }
      });
    }
  }
  list.sort((a, b) => a.label.localeCompare(b.label));
  return list;
}

// Streams announced on the LAN: onList(list) now and whenever it changes
function rtpDiscover(onList)
{
  let last = null;
  const user = {
    onChange: () =>
    {
      const list = rtpSapList();
      const text = JSON.stringify(list);
      if (text == last) return;
      last = text;
      onList(list);
    }
  };
  try
  {
    rtpSapUse(user);
    user.onChange();
  }
  catch (e)
  {
    // The list stays empty
  }
  return { stop: () => rtpSapRelease(user) };
}

// ---- Input

// A stream's input: its port's shared socket, its group joined, its format from SAP when announced
function rtpInOpen(stream, sink)
{
  const host = String(stream.host || "").trim();
  const H = {
    sink: sink,
    port: stream.port || RTP_DEFAULT_PORT,
    group: rtpIsMulticast(host) ? host : null,
    filter: host && !rtpIsMulticast(host) ? host : null,
    rate: stream.rate || 48000,
    channels: stream.channels || 1,
    channel: stream.channel || "left",
    open: true,
    media: null,
    entry: null,
    lookup: null
  };
  rtpInReset(H);
  H.sapUser = { onChange: () => rtpInSapChanged(H) };
  if (!rtpPortValid(H.port))
  {
    H.open = false;
    rtpInSay(H, I18N("netAudio.rtp.badPort").replace("{port}", H.port), true);
    return { stop: () => {} };
  }
  try
  {
    rtpSapUse(H.sapUser);
    H.media = rtpSapFind(H.group || "", H.port);
    if (H.filter && !rtpIsIpv4(H.filter)) rtpInLookup(H, H.filter);
    rtpInSocketAdd(H);
  }
  catch (e)
  {
    rtpInSay(H, e.message, true);
  }
  return { stop: () => rtpInStop(H) };
}

// What a stream knows of its sender, forgotten when the sender changes
function rtpInReset(H)
{
  H.ssrc = null;
  H.source = null;
  H.next = null;
  H.nextTs = null;
  H.held = new Map();
  H.probe = null;
  H.key = null;
  H.fmt = null;
  H.guess = null;
  H.prev = null;
  H.lastAt = 0;
  H.silent = false;
  H.other = null;
  H.dirty = true;
}

// A source filter given as a name: looked up, again every 3 s until it is found
function rtpInLookup(H, name)
{
  window.require("dns").lookup(name, { family: 4 }, (e, address) =>
  {
    if (!H.open) return;
    if (e)
    {
      rtpInSay(H, I18N("netAudio.rtp.notFound").replace("{host}", name), true);
      H.lookup = nodeTimers.setTimeout(() =>
      {
        H.lookup = null;
        if (H.open) rtpInLookup(H, name);
      }, RTP_RETRY_MS);
      return;
    }
    H.filter = address;
  });
}

function rtpInSay(H, text, error)
{
  if (H.said == text + error) return;
  H.said = text + error;
  try
  {
    H.sink.status(text, !!error);
  }
  catch (e)
  {
    // The window gone: it stops the handle
  }
}

function rtpInListening(H)
{
  if (H.group) rtpInSay(H, I18N("netAudio.rtp.listeningGroup").replace("{group}", H.group).replace("{port}", H.port), false);
  else rtpInSay(H, I18N("netAudio.rtp.listening").replace("{port}", H.port), false);
}

function rtpInSapChanged(H)
{
  const media = rtpSapFind(H.group || "", H.port);
  if (JSON.stringify(media) == JSON.stringify(H.media)) return;
  H.media = media;
  H.dirty = true;
}

function rtpInStop(H)
{
  if (!H.open) return;
  H.open = false;
  if (H.lookup) nodeTimers.clearTimeout(H.lookup);
  rtpSapRelease(H.sapUser);
  const entry = H.entry;
  if (!entry) return;
  entry.handles.delete(H);
  if (H.group && entry.socket && entry.ready && !Array.from(entry.handles).some((other) => other.group == H.group)) rtpLeave(entry.socket, H.group, entry.joined);
  if (entry.handles.size) return;
  rtpInClose(entry);
  if (entry.retry) nodeTimers.clearTimeout(entry.retry);
  entry.retry = null;
  RTP_IN_SOCKETS.delete(entry.port);
}

function rtpInSocketAdd(H)
{
  let entry = RTP_IN_SOCKETS.get(H.port);
  if (!entry)
  {
    entry = { port: H.port, socket: null, ready: false, error: null, handles: new Set(), joined: new Set(), retry: null, tick: null, rejoin: null };
    RTP_IN_SOCKETS.set(H.port, entry);
  }
  entry.handles.add(H);
  H.entry = entry;
  if (!entry.socket && !entry.retry) rtpInBind(entry);
  else if (entry.ready) rtpInJoined(entry, H);
  else if (entry.error) rtpInSay(H, entry.error, true);
}

// A stream's group joined (if it has one) and its status line said
function rtpInJoined(entry, H)
{
  if (H.group)
  {
    const e = rtpJoin(entry.socket, H.group, entry.joined);
    if (e)
    {
      rtpInSay(H, I18N("netAudio.rtp.joinFail").replace("{group}", H.group).replace("{error}", e.message), true);
      return;
    }
  }
  if (H.ssrc === null) rtpInListening(H);
}

// The port's socket, shared with other programs on it (reuseAddr), tried again every 3 s while it can't be had
function rtpInBind(entry)
{
  const socket = window.require("dgram").createSocket({ type: "udp4", reuseAddr: true });
  entry.socket = socket;
  socket.on("error", (e) => rtpInFail(entry, socket, e));
  socket.on("listening", () =>
  {
    if (entry.socket != socket) return;
    entry.ready = true;
    entry.error = null;
    for (const H of entry.handles) rtpInJoined(entry, H);
    entry.tick = nodeTimers.setInterval(() => rtpInTick(entry), RTP_TICK_MS);
    entry.rejoin = nodeTimers.setInterval(() =>
    {
      for (const H of entry.handles) if (H.group) rtpJoin(socket, H.group, entry.joined);
    }, RTP_REJOIN_MS);
  });
  socket.on("message", (msg, rinfo) => rtpInMessage(entry, msg, rinfo));
  try
  {
    socket.bind({ port: entry.port, exclusive: false });
  }
  catch (e)
  {
    rtpInFail(entry, socket, e);
  }
}

function rtpInClose(entry)
{
  if (entry.tick) nodeTimers.clearInterval(entry.tick);
  if (entry.rejoin) nodeTimers.clearInterval(entry.rejoin);
  entry.tick = entry.rejoin = null;
  if (entry.socket)
  {
    try
    {
      entry.socket.close();
    }
    catch (e)
    {
      // Closed already
    }
  }
  entry.socket = null;
  entry.ready = false;
  entry.joined.clear();
}

function rtpInFail(entry, socket, e)
{
  if (entry.socket != socket) return;
  rtpInClose(entry);
  entry.error = I18N("netAudio.rtp.bindFail").replace("{port}", entry.port).replace("{error}", e.message);
  for (const H of entry.handles) rtpInSay(H, entry.error, true);
  if (!entry.handles.size) return;
  entry.retry = nodeTimers.setTimeout(() =>
  {
    entry.retry = null;
    if (entry.handles.size && !entry.socket) rtpInBind(entry);
  }, RTP_RETRY_MS);
}

// An RTP packet's header fields and payload (CSRCs, header extension and padding taken off); null if it isn't one (RTCP included)
function rtpParse(msg)
{
  if (msg.length < RTP_HEADER_BYTES) return null;
  const b0 = msg[0];
  const b1 = msg[1];
  if (b0 >> 6 != RTP_VERSION || (b1 >= 200 && b1 <= 204)) return null;
  let off = RTP_HEADER_BYTES + (b0 & 0x0f) * 4;
  if (b0 & 0x10)
  {
    if (msg.length < off + 4) return null;
    off += 4 + msg.readUInt16BE(off + 2) * 4;
  }
  let end = msg.length;
  if (b0 & 0x20) end -= msg[end - 1];
  if (off > end) return null;
  return { marker: b1 >> 7, pt: b1 & 0x7f, seq: msg.readUInt16BE(2), ts: msg.readUInt32BE(4), ssrc: msg.readUInt32BE(8), payload: msg.subarray(off, end) };
}

function rtpInMessage(entry, msg, rinfo)
{
  const p = rtpParse(msg);
  if (!p) return;
  const now = Date.now();
  for (const H of entry.handles)
  {
    try
    {
      rtpInPacket(H, p, rinfo, now);
    }
    catch (e)
    {
      // The listener's window gone: it stops the handle
    }
  }
}

// A packet for a stream: its sender's (the first SSRC heard, or one taking over from a sender silent a second), in its format
function rtpInPacket(H, p, rinfo, now)
{
  if (!H.open || (H.filter && rinfo.address != H.filter)) return;
  if (H.ssrc !== null && p.ssrc !== H.ssrc)
  {
    if (now - H.lastAt <= RTP_SSRC_TAKEOVER_MS)
    {
      if (!H.other)
      {
        H.other = rinfo.address;
        H.dirty = true;
        rtpInStatus(H);
      }
      return;
    }
    // A new sender, or the same one restarted: a new timeline, nothing filled
    rtpInReset(H);
  }
  if (H.ssrc === null)
  {
    H.ssrc = p.ssrc;
    H.source = rinfo.address;
    H.dirty = true;
  }
  const fmt = rtpInFormat(H, p);
  if (H.silent)
  {
    H.silent = false;
    H.dirty = true;
  }
  H.lastAt = now;
  if (!fmt.enc)
  {
    rtpInSay(H, I18N("netAudio.rtp.unsupported").replace("{format}", fmt.name), true);
    H.key = null;
    H.dirty = true;
    return;
  }
  rtpInQueue(H, { p: p, fmt: fmt, at: now });
  if (H.dirty) rtpInStatus(H);
}

// A packet's format: what the SDP announced for its payload type, else a static payload type's, else (a dynamic one) the stream's own
// rate and channels as L16, or L24 when the payload's size or the timestamps say 3 bytes a sample
function rtpInFormat(H, p)
{
  if (H.media && H.media.formats[p.pt]) return H.media.formats[p.pt];
  if (H.media && H.media.unsupported && !H.media.fmt) return { enc: null, name: H.media.unsupported };
  if (RTP_STATIC_PT[p.pt]) return RTP_STATIC_PT[p.pt];
  if (p.pt < 96) return { enc: null, name: "PT " + p.pt };
  const ch = H.channels;
  const len = p.payload.length;
  if (!H.guess && H.prev && p.seq == ((H.prev.seq + 1) & 0xffff))
  {
    const frames = (p.ts - H.prev.ts) >>> 0;
    if (frames > 0 && frames < 65536)
    {
      if (H.prev.len == frames * ch * 3) H.guess = "L24";
      else if (H.prev.len == frames * ch * 2) H.guess = "L16";
    }
  }
  H.prev = { seq: p.seq, ts: p.ts, len: len };
  const enc = H.guess || (len % (2 * ch) && len % (3 * ch) == 0 ? "L24" : "L16");
  return { enc: enc, rate: H.rate, channels: ch };
}

// Into the reorder buffer: late ones and duplicates dropped; a big jump either way taken as a restart when the packet after it follows on
function rtpInQueue(H, item)
{
  const seq = item.p.seq;
  if (H.next === null) H.next = seq;
  const ahead = (seq - H.next) & 0xffff;
  const behind = (H.next - seq) & 0xffff;
  const far = ahead < 0x8000 ? ahead > RTP_SEQ_AHEAD_MAX : behind > RTP_SEQ_BEHIND_MAX;
  if (far)
  {
    if (!H.probe || seq != ((H.probe.p.seq + 1) & 0xffff))
    {
      H.probe = item;
      return;
    }
    rtpInDrain(H, true);
    H.next = H.probe.p.seq;
    H.nextTs = null;
    H.held.set(H.probe.p.seq, H.probe);
  }
  else if (ahead >= 0x8000 || H.held.has(seq)) return;
  H.probe = null;
  H.held.set(seq, item);
  rtpInDrain(H, false);
}

// Packets out of the reorder buffer in sequence; one missing is waited for while fewer than RTP_REORDER_PACKETS are held after it
// (all: whatever is held goes, gaps and all)
function rtpInDrain(H, all)
{
  while (H.held.size)
  {
    let item = H.held.get(H.next);
    if (!item)
    {
      if (!all && H.held.size <= RTP_REORDER_PACKETS) return;
      let best = null;
      let bestAhead = 0x10000;
      for (const seq of H.held.keys())
      {
        const ahead = (seq - H.next) & 0xffff;
        if (ahead < bestAhead)
        {
          bestAhead = ahead;
          best = seq;
        }
      }
      H.next = best;
      item = H.held.get(best);
    }
    H.held.delete(H.next);
    H.next = (H.next + 1) & 0xffff;
    rtpInDeliver(H, item);
  }
}

// A packet's samples to the listener, silence first for what its timestamp says was lost (up to a second); the format changed:
// a new timeline
function rtpInDeliver(H, item)
{
  const { p, fmt } = item;
  const key = fmt.enc + "/" + fmt.rate + "/" + fmt.channels;
  if (key != H.key)
  {
    H.key = key;
    H.fmt = fmt;
    H.nextTs = null;
    H.dirty = true;
  }
  const frames = Math.floor(p.payload.length / (RTP_ENCODINGS[fmt.enc] * fmt.channels));
  if (H.nextTs !== null)
  {
    const gap = (p.ts - H.nextTs) | 0;
    if (gap > 0 && gap <= fmt.rate * RTP_GAP_MAX_SEC) H.sink.pcm(new Float32Array(gap), fmt.rate);
  }
  H.nextTs = (p.ts + frames) >>> 0;
  if (frames > 0) H.sink.pcm(rtpDecode(p.payload, fmt, frames, H.channel), fmt.rate);
}

// Interleaved samples to mono ±1: the channel picked (left, right), or all of them averaged (mix)
function rtpDecode(buf, fmt, frames, channel)
{
  const ch = fmt.channels;
  const bytes = RTP_ENCODINGS[fmt.enc];
  const stride = bytes * ch;
  const out = new Float32Array(frames);
  let read;
  if (fmt.enc == "L16") read = (o) => (((buf[o] << 24) >> 16) | buf[o + 1]) / 32768;
  else if (fmt.enc == "L24") read = (o) => ((buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8)) / 2147483648;
  else if (fmt.enc == "L8") read = (o) => (buf[o] - 128) / 128;
  else if (fmt.enc == "PCMU") read = (o) => RTP_ULAW[buf[o]];
  else read = (o) => RTP_ALAW[buf[o]];
  if (ch > 1 && channel == "mix")
  {
    for (let i = 0; i < frames; i++)
    {
      let sum = 0;
      for (let c = 0; c < ch; c++) sum += read(i * stride + c * bytes);
      out[i] = sum / ch;
    }
    return out;
  }
  const pick = ch > 1 && channel == "right" ? bytes : 0;
  for (let i = 0; i < frames; i++) out[i] = read(i * stride + pick);
  return out;
}

// Each stream's held packets let go once one has waited too long, and "No audio" said once its sender has gone quiet
function rtpInTick(entry)
{
  const now = Date.now();
  for (const H of entry.handles)
  {
    try
    {
      if (H.held.size)
      {
        let oldest = now;
        for (const item of H.held.values()) oldest = Math.min(oldest, item.at);
        if (now - oldest > RTP_REORDER_MS) rtpInDrain(H, true);
      }
      if (H.ssrc !== null && !H.silent && now - H.lastAt > RTP_SILENT_MS)
      {
        H.silent = true;
        H.other = null;
        rtpInSay(H, I18N("netAudio.rtp.noAudio").replace("{seconds}", Math.round(RTP_SILENT_MS / 1000)), false);
      }
    }
    catch (e)
    {
      // The listener's window gone: it stops the handle
    }
  }
}

// "Receiving 48 kHz, 2 ch, 16-bit from 192.168.1.20 (Desktop)", and another sender ignored if there is one
function rtpInStatus(H)
{
  // Nothing let out of the reorder buffer yet: said once something is
  if (!H.fmt) return;
  H.dirty = false;
  const name = H.media && H.media.name ? " (" + H.media.name + ")" : "";
  let text = I18N("netAudio.rtp.receiving").replace("{format}", rtpFormatText(H.fmt)).replace("{source}", H.source + name);
  if (H.other) text += "; " + I18N("netAudio.rtp.ignoring").replace("{source}", H.other);
  rtpInSay(H, text, false);
}

// ---- Output

// A stream out: L16 at its rate and channels (mono duplicated), packets of whole milliseconds within RTP_PAYLOAD_MAX, static payload
// type 10 / 11 where its format is one, else 96; announced by SAP (blank host: PipeWire's and PulseAudio's group)
function rtpOutOpen(stream, sink)
{
  const rate = stream.rate || 48000;
  const channels = stream.channels == 2 ? 2 : 1;
  const maxFrames = Math.floor(RTP_PAYLOAD_MAX / (2 * channels));
  const ms = Math.max(1, Math.min(RTP_PTIME_MAX_MS, Math.floor((maxFrames * 1000) / rate)));
  const frames = Math.max(1, Math.min(maxFrames, Math.round((rate * ms) / 1000)));
  const host = String(stream.host || "").trim() || RTP_DEFAULT_GROUP;
  const O = {
    sink: sink,
    host: host,
    port: stream.port || RTP_DEFAULT_PORT,
    name: stream.name || "GridTracker2",
    rate: rate,
    channels: channels,
    pt: rate == 44100 ? (channels == 2 ? 10 : 11) : RTP_DYNAMIC_PT,
    frames: frames,
    pending: new Float32Array(frames),
    fill: 0,
    ssrc: Math.floor(Math.random() * 0x100000000) >>> 0,
    seq: Math.floor(Math.random() * 0x10000),
    ts: Math.floor(Math.random() * 0x100000000) >>> 0,
    marker: true,
    lastWrite: 0,
    lastChunk: 0,
    open: true,
    socket: null,
    ready: false,
    address: null,
    local: null,
    sendError: null,
    retry: null,
    sap: null,
    // Announced with SAP (the stream box's Announce): PipeWire and PulseAudio machines on the LAN pick it up by themselves. Unset (a
    // stream from before it was there): announced only to a multicast group
    announce: stream.announce === true || (stream.announce !== false && rtpIsMulticast(host))
  };
  if (!rtpPortValid(O.port))
  {
    O.open = false;
    rtpOutSay(O, I18N("netAudio.rtp.badPort").replace("{port}", O.port), true);
  }
  else
  {
    try
    {
      rtpOutConnect(O);
    }
    catch (e)
    {
      rtpOutSay(O, e.message, true);
    }
  }
  return { rate: rate, write: (samples) => rtpOutWrite(O, samples), stop: () => rtpOutStop(O) };
}

function rtpOutSay(O, text, error)
{
  if (O.said == text + error) return;
  O.said = text + error;
  try
  {
    O.sink.status(text, !!error);
  }
  catch (e)
  {
    // The window gone: it stops the handle
  }
}

// TTL 1 for the link-local groups (224.0.0.x, PipeWire's and PulseAudio's: routers never pass them on anyway, and 1 is what both use);
// 16 for other groups, so a LAN with multicast routing between its subnets (a 239.x group) gets them across
function rtpOutTtl(host)
{
  return host.startsWith("224.0.0.") ? 1 : 16;
}

// A UDP socket connected to the destination (a name looked up once, here), so the address this computer sends from is known for SAP
function rtpOutConnect(O)
{
  const socket = window.require("dgram").createSocket({ type: "udp4" });
  O.socket = socket;
  socket.on("error", (e) => rtpOutFail(O, socket, e));
  socket.connect(O.port, O.host, (e) =>
  {
    if (e) return rtpOutFail(O, socket, e);
    if (O.socket != socket || !O.open) return;
    try
    {
      O.address = socket.remoteAddress().address;
      O.local = socket.address().address;
      if (!O.local || O.local == "0.0.0.0") O.local = rtpOwnAddress();
      socket.setBroadcast(true);
      if (rtpIsMulticast(O.address))
      {
        socket.setMulticastTTL(rtpOutTtl(O.address));
        socket.setMulticastLoopback(true);
      }
    }
    catch (err)
    {
      return rtpOutFail(O, socket, err);
    }
    O.ready = true;
    O.sendError = null;
    rtpOutStatus(O);
    if (O.announce) rtpOutSapStart(O);
  });
}

// Ready while nothing is written, Sending while audio goes out (until RTP_OUT_SAY_IDLE_MS after the last piece)
const RTP_OUT_SAY_IDLE_MS = 2000;

function rtpOutStatus(O)
{
  const fmt = { enc: "L16", rate: O.rate, channels: O.channels };
  rtpOutSay(O, I18N(O.sending ? "netAudio.rtp.sending" : "netAudio.rtp.ready").replace("{format}", rtpFormatText(fmt)).replace("{destination}", O.host + ":" + O.port), false);
}

function rtpOutFail(O, socket, e)
{
  if (O.socket != socket) return;
  O.socket = null;
  O.ready = false;
  rtpOutSapStop(O, false);
  try
  {
    socket.close();
  }
  catch (err)
  {
    // Closed already
  }
  rtpOutSay(O, e.message, true);
  if (!O.open) return;
  O.retry = nodeTimers.setTimeout(() =>
  {
    O.retry = null;
    if (O.open && !O.socket) rtpOutConnect(O);
  }, RTP_RETRY_MS);
}

// Samples from the producer into packets, each sent as it fills. While the socket isn't up the packets are dropped, the sequence and
// timestamps moving on all the same (the timeline stays true for the receiver). After a pause the timestamps catch up with the clock
function rtpOutWrite(O, samples)
{
  if (!O.open || !samples || !samples.length) return;
  const now = Date.now();
  if (O.lastWrite && now - O.lastWrite > RTP_OUT_IDLE_MS)
  {
    // The pause: the time since the last chunk less that chunk's own length (its samples already counted)
    if (O.fill) rtpOutPad(O);
    const idle = Math.round(((now - O.lastWrite) * O.rate) / 1000) - O.lastChunk;
    if (idle > 0) O.ts = (O.ts + idle) >>> 0;
    O.marker = true;
  }
  O.lastWrite = now;
  O.lastChunk = samples.length;
  if (!O.sending)
  {
    O.sending = true;
    if (O.ready && !O.sendError) rtpOutStatus(O);
  }
  nodeTimers.clearTimeout(O.sayIdle);
  O.sayIdle = nodeTimers.setTimeout(() =>
  {
    O.sending = false;
    if (O.open && O.ready && !O.sendError) rtpOutStatus(O);
  }, RTP_OUT_SAY_IDLE_MS);
  let i = 0;
  while (i < samples.length)
  {
    const take = Math.min(O.frames - O.fill, samples.length - i);
    O.pending.set(samples.subarray(i, i + take), O.fill);
    O.fill += take;
    i += take;
    if (O.fill == O.frames) rtpOutSend(O);
  }
}

// The last packet, part full, sent with silence after it
function rtpOutPad(O)
{
  O.pending.fill(0, O.fill);
  O.fill = O.frames;
  rtpOutSend(O);
}

function rtpOutSend(O)
{
  const ch = O.channels;
  const buf = Buffer.alloc(RTP_HEADER_BYTES + O.frames * 2 * ch);
  buf[0] = RTP_VERSION << 6;
  buf[1] = (O.marker ? 0x80 : 0) | O.pt;
  buf.writeUInt16BE(O.seq, 2);
  buf.writeUInt32BE(O.ts, 4);
  buf.writeUInt32BE(O.ssrc, 8);
  let off = RTP_HEADER_BYTES;
  for (let i = 0; i < O.frames; i++)
  {
    const v = Math.max(-1, Math.min(1, O.pending[i] || 0));
    const s = Math.round(v < 0 ? v * 32768 : v * 32767);
    for (let c = 0; c < ch; c++)
    {
      buf.writeInt16BE(s, off);
      off += 2;
    }
  }
  O.seq = (O.seq + 1) & 0xffff;
  O.ts = (O.ts + O.frames) >>> 0;
  O.marker = false;
  O.fill = 0;
  if (!O.ready || !O.socket) return;
  const socket = O.socket;
  socket.send(buf, (e) =>
  {
    if (O.socket != socket || !O.open) return;
    if (e)
    {
      if (!O.sendError) rtpOutSay(O, e.message, true);
      O.sendError = e.message;
    }
    else if (O.sendError)
    {
      O.sendError = null;
      rtpOutStatus(O);
    }
  });
}

// The stream's SDP: PipeWire's line order (which AES67 / Dante receivers rely on), what PulseAudio reads (the rtpmap's channel count
// always given). A unicast stream's c= is its destination
function rtpOutSdp(O)
{
  const multicast = rtpIsMulticast(O.address);
  const ptime = Math.round((O.frames * 1000000) / O.rate) / 1000;
  const lines = [
    "v=0",
    "o=- " + O.sap.id + " " + O.sap.id + " IN IP4 " + O.local,
    "s=" + String(O.name).replace(/[\r\n]/g, " "),
    "c=IN IP4 " + O.address + (multicast ? "/" + rtpOutTtl(O.address) : ""),
    "t=0 0",
    "m=audio " + O.port + " RTP/AVP " + O.pt,
    "a=recvonly",
    "a=rtpmap:" + O.pt + " L16/" + O.rate + "/" + O.channels
  ];
  if (multicast) lines.push("a=source-filter: incl IN IP4 " + O.address + " " + O.local);
  lines.push("a=ptime:" + ptime, "a=mediaclk:sender", "a=tool:GridTracker2", "a=type:broadcast");
  return lines.join("\n") + "\n";
}

// SAP announcements from the moment the stream is connected, from the interface it goes out on, at its TTL
function rtpOutSapStart(O)
{
  rtpOutSapStop(O, false);
  const socket = window.require("dgram").createSocket({ type: "udp4", reuseAddr: true });
  O.sap = { socket: socket, id: Math.floor(Date.now() / 1000) + NTP_EPOCH_OFFSET, hash: 1 + Math.floor(Math.random() * 0xffff), started: Date.now(), timer: null, ready: false };
  const sap = O.sap;
  socket.on("error", () =>
  {
    // Announcements are a help: the stream goes on without them, and they start again with the next connection
    if (sap.timer) nodeTimers.clearTimeout(sap.timer);
    sap.timer = null;
  });
  socket.bind(0, () =>
  {
    if (O.sap != sap) return;
    try
    {
      socket.setMulticastTTL(rtpOutTtl(rtpIsMulticast(O.address) ? O.address : RTP_DEFAULT_GROUP));
      socket.setMulticastLoopback(true);
      if (!O.local.startsWith("127.")) socket.setMulticastInterface(O.local);
    }
    catch (e)
    {
      // The system's default interface then
    }
    sap.ready = true;
    rtpOutSapSend(O, false);
  });
}

function rtpOutSapSend(O, deletion, done)
{
  const sap = O.sap;
  if (!sap || !sap.ready)
  {
    if (done) done();
    return;
  }
  const packet = rtpSapBuild(deletion, sap.hash, O.local, rtpOutSdp(O));
  let left = SAP_SEND_GROUPS.length;
  for (const group of SAP_SEND_GROUPS)
  {
    try
    {
      sap.socket.send(packet, SAP_PORT, group, () =>
      {
        if (--left == 0 && done) done();
      });
    }
    catch (e)
    {
      if (--left == 0 && done) done();
    }
  }
  if (deletion) return;
  const wait = Date.now() - sap.started < SAP_FAST_FOR_MS ? SAP_FAST_MS : SAP_SLOW_MS;
  sap.timer = nodeTimers.setTimeout(() =>
  {
    sap.timer = null;
    if (O.sap == sap) rtpOutSapSend(O, false);
  }, wait);
}

// Announcements ended, with a deletion so receivers let the stream go at once (bye: the stream stopped, not just reconnecting)
function rtpOutSapStop(O, bye)
{
  const sap = O.sap;
  if (!sap) return;
  if (sap.timer) nodeTimers.clearTimeout(sap.timer);
  sap.timer = null;
  const close = () =>
  {
    try
    {
      sap.socket.close();
    }
    catch (e)
    {
      // Closed already
    }
  };
  if (bye) rtpOutSapSend(O, true, () =>
  {
    O.sap = null;
    close();
  });
  else
  {
    O.sap = null;
    close();
  }
}

function rtpOutStop(O)
{
  if (!O.open) return;
  if (O.fill && O.ready) rtpOutPad(O);
  O.open = false;
  if (O.retry) nodeTimers.clearTimeout(O.retry);
  O.retry = null;
  nodeTimers.clearTimeout(O.sayIdle);
  rtpOutSapStop(O, true);
  const socket = O.socket;
  O.socket = null;
  O.ready = false;
  if (socket)
  {
    try
    {
      socket.close();
    }
    catch (e)
    {
      // Closed already
    }
  }
}
