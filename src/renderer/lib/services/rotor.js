// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// Rotor Control (Settings -> Features -> Service): an antenna rotator, on a serial port (Web Serial, built into Chromium: no native
// module) or through Hamlib's rotctld over the network. Pointed at a heading (Ctrl-click on the map, the roster's Aim Rotator) and, with
// Follow Satellite, at BirdWatch's selected satellite while it is up, and at where it will rise a few minutes before. Its position is
// read every couple of seconds. Protocols: Yaesu GS-232A/B, Easycomm II, SPID Rot2Prog, rotctld, and CatRotator / PstRotator (UDP, the
// <PST> messages; what was the service of its own before, its settings carried over: rotorMigrate)

GT.rotor = {
  link: null,         // the open serial port, or the socket
  writer: null,
  protocol: null,
  status: "off",      // off, noPort, connecting, connected, error
  error: "",
  az: null,           // the position last read
  el: null,
  hasEl: null,        // whether the controller reports an elevation: known once it has answered (null until then)
  sent: null,         // the last target sent: { az, el, at }
  pending: "",        // text received that isn't a whole line yet
  bytes: [],          // the same for a binary protocol
  pollTimer: null,
  retryTimer: null,
  generation: 0       // a connect under way is the newest one; an older one that finishes is ignored
};

const ROTOR_POLL_MS = 2000;
const ROTOR_RETRY_MS = 10000;
// Following a satellite: not more often than this, and only once the target has moved a degree
const ROTOR_FOLLOW_MS = 2000;
// Before a pass: pointed at where the satellite will rise, this long before its AOS
const ROTOR_PREAIM_MS = 5 * 60000;
const ROTOR_BAUDS = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];

function rotorPad3(n)
{
  return String(Math.round(n)).padStart(3, "0");
}

// A Rot2Prog frame: 0x57, the azimuth as four ASCII digits of (360 + az) * PH, PH, the same for the elevation, PV, the command, 0x20
function rotorSpidFrame(az, el, command)
{
  const digits = (value) => [...String(Math.round(value)).padStart(4, "0")].map((d) => d.charCodeAt(0));
  return new Uint8Array([0x57, ...digits(360 + az), 0x01, ...digits(360 + el), 0x01, command, 0x20]);
}

// Each protocol: serial or network, text lines or binary frames; what to send to point and to ask the position, and how the answer reads
//   set(az, el): el is null for a controller without one (or not known yet: the azimuth alone is safe for every one)
//   parse(line | bytes): { az, el } (el null when the answer has none) or null when it isn't a position
const ROTOR_PROTOCOLS = {
  gs232: {
    name: "Yaesu GS-232A/B",
    serial: true,
    // "W aaa eee" turns both (GS-232B, and an A with an az/el controller); "M aaa" the azimuth alone
    set: (az, el) => (el === null ? "M" + rotorPad3(az) + "\r" : "W" + rotorPad3(az) + " " + rotorPad3(el) + "\r"),
    poll: () => "C2\r",
    // "+0aaa+0eee" (A) or "AZ=aaa EL=eee" (B); an azimuth-only controller answers with the azimuth alone
    parse: (line) =>
    {
      const m = /(?:AZ=|\+0)(\d{3})(?:\s*(?:EL=|\+0)(\d{3}))?/.exec(line);
      return m ? { az: Number(m[1]), el: m[2] !== undefined ? Number(m[2]) : null } : null;
    }
  },
  easycomm: {
    name: "Easycomm II",
    serial: true,
    set: (az, el) => "AZ" + az.toFixed(1) + (el === null ? "" : " EL" + el.toFixed(1)) + "\n",
    poll: () => "AZ EL\n",
    parse: (line) =>
    {
      const az = /AZ(-?\d+(?:\.\d+)?)/.exec(line);
      const el = /EL(-?\d+(?:\.\d+)?)/.exec(line);
      return az ? { az: Number(az[1]), el: el ? Number(el[1]) : null } : null;
    }
  },
  spid: {
    name: "SPID Rot2Prog",
    serial: true,
    binary: true,
    set: (az, el) => rotorSpidFrame(az, el === null ? 0 : el, 0x2f),
    poll: () => rotorSpidFrame(0, 0, 0x1f),
    // 12 bytes: 0x57, H1 H2 H3 H4 (each 0 to 9), PH, V1 V2 V3 V4, PV, 0x20: the azimuth is H / PH - 360
    parse: (bytes) =>
    {
      if (bytes.length < 12 || bytes[0] != 0x57) return null;
      const value = (at, pulses) => (bytes[at] * 1000 + bytes[at + 1] * 100 + bytes[at + 2] * 10 + bytes[at + 3]) / (pulses || 1) - 360;
      return { az: value(1, bytes[5]), el: value(6, bytes[10]) };
    }
  },
  rotctld: {
    name: "Hamlib rotctld",
    serial: false,
    set: (az, el) => "P " + az.toFixed(1) + " " + (el === null ? "0" : el.toFixed(1)) + "\n",
    poll: () => "p\n",
    // dump_caps, once connected: "Max Elevation: 90.00" says whether the rotator tilts at all
    caps: () => "1\n",
    // "p" is answered with the azimuth on one line and the elevation on the next
    parse: (line, R) =>
    {
      const caps = /^Max Elevation:\s*(-?\d+(?:\.\d+)?)/.exec(line);
      if (caps)
      {
        R.hasEl = Number(caps[1]) > 0;
        return null;
      }
      if (/^RPRT\s+-/.test(line))
      {
        R.error = line;
        return null;
      }
      if (!/^-?\d+(?:\.\d+)?$/.test(line.trim())) return null;
      // The first of the two lines is kept until the second
      if (R.half === null || R.half === undefined)
      {
        R.half = Number(line);
        return null;
      }
      const az = R.half;
      R.half = null;
      return { az: az, el: Number(line) };
    }
  },
  pstrotator: {
    name: "CatRotator / PstRotator",
    serial: false,
    udp: true,
    // <PST><AZIMUTH>aaa</AZIMUTH></PST>, with the elevation when the program reports one (groups.io/g/PstRotator/message/5825)
    set: (az, el) => "<PST><AZIMUTH>" + Math.round(az) + "</AZIMUTH>" + (el === null ? "" : "<ELEVATION>" + Math.round(el) + "</ELEVATION>") + "</PST>",
    // Asked one at a time; the answers ("AZ:123.4", "EL:45.0") come to the port one up (12001)
    poll: () => "<PST>AZ?</PST><PST>EL?</PST>",
    parse: (text, R) =>
    {
      const az = /AZ:?\s*(-?\d+(?:\.\d+)?)/.exec(text);
      const el = /EL:?\s*(-?\d+(?:\.\d+)?)/.exec(text);
      if (el && !az) return { az: R.az === null ? 0 : R.az, el: Number(el[1]) };
      return az ? { az: Number(az[1]), el: el ? Number(el[1]) : (R.hasEl ? R.el : null) } : null;
    }
  }
};

// The protocol chosen (the select element is rotorProtocol, so this isn't)
function rotorProtocolChosen()
{
  return ROTOR_PROTOCOLS[GT.settings.rotor.protocol] || ROTOR_PROTOCOLS.gs232;
}

// ---- Settings (Features -> Service)

function rotorSettingsRender()
{
  const S = GT.settings.rotor;
  rotorEnable.checked = S.enable;
  if (!rotorProtocol.options.length)
  {
    for (const [key, protocol] of Object.entries(ROTOR_PROTOCOLS))
    {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = protocol.name;
      rotorProtocol.appendChild(option);
    }
    for (const baud of ROTOR_BAUDS)
    {
      const option = document.createElement("option");
      option.value = String(baud);
      option.textContent = String(baud);
      rotorBaud.appendChild(option);
    }
  }
  rotorProtocol.value = S.protocol in ROTOR_PROTOCOLS ? S.protocol : "gs232";
  rotorBaud.value = ROTOR_BAUDS.includes(Number(S.baud)) ? String(S.baud) : "9600";
  rotorDataBits.value = Number(S.dataBits) == 7 ? "7" : "8";
  rotorParity.value = ["none", "even", "odd"].includes(S.parity) ? S.parity : "none";
  rotorStopBits.value = Number(S.stopBits) == 2 ? "2" : "1";
  rotorHost.value = S.host;
  const udp = !!rotorProtocolChosen().udp;
  rotorNetPort.value = udp ? S.udpPort : S.netPort;
  rotorNetPortLabel.textContent = I18N(udp ? "settings.logging.pstrotator.details.Port" : "settings.rotor.tcpPort.label");
  rotorFollow.checked = S.follow;
  // The short name (COM3, ttyUSB0, tty.usbserial-0001), the device's full name in its tooltip
  rotorPortName.textContent = S.port ? serialPortShortName(S.port) : I18N("settings.rotor.none.label");
  rotorPortName.title = S.port ? S.port.displayName || "" : "";
  const serial = rotorProtocolChosen().serial;
  const rows = { rotorProtocolTr: S.enable, rotorPortTr: S.enable && serial, rotorBaudTr: S.enable && serial, rotorHostTr: S.enable && !serial, rotorFollowTr: S.enable, rotorStatusTr: S.enable };
  for (const [id, on] of Object.entries(rows)) document.getElementById(id).style.display = on ? "" : "none";
  // Linux: a user who isn't in the group that owns the serial devices can't open them; said under the port, with the fix
  serialLinuxRender(rotorLinuxTr, rotorLinuxText, S.port, S.enable && serial);
  // The BirdWatch panel's Rotor row is there while the service is on (birdWatchInfo.js)
  if (typeof birdWatchInfoBuilt != "undefined" && birdWatchInfoBuilt) birdWatchInfoRebuild();
  rotorStatusRender();
}

// The Settings checkbox
function rotorEnableChanged()
{
  GT.settings.rotor.enable = rotorEnable.checked;
  rotorSettingsRender();
  rotorAimingChanged();
  rotorConnect();
}

// The protocol, baud, host or port changed: connected again with them
function rotorSettingsChanged()
{
  const S = GT.settings.rotor;
  // Another protocol: the port field still shows the old one's port, so it isn't read; the render below fills it with the new one's
  const sameProtocol = S.protocol == rotorProtocol.value;
  S.protocol = rotorProtocol.value;
  S.baud = Number(rotorBaud.value);
  S.dataBits = Number(rotorDataBits.value);
  S.parity = rotorParity.value;
  S.stopBits = Number(rotorStopBits.value);
  S.host = rotorHost.value.trim();
  if (sameProtocol)
  {
    if (rotorProtocolChosen().udp) S.udpPort = Number(rotorNetPort.value) || 12000;
    else S.netPort = Number(rotorNetPort.value) || 4533;
  }
  rotorSettingsRender();
  rotorConnect();
}

function rotorFollowChanged()
{
  GT.settings.rotor.follow = rotorFollow.checked;
  GT.rotor.sent = null;
}

// The roster's Aim Rotator menu items show while the service is on
function rotorAimingChanged()
{
  if (GT.callRosterWindowInitialized) GT.callRosterWindowHandle.window.setPstrotatorEnable(GT.settings.rotor.enable);
}

// The Settings window on Features, where Rotor Control is (a click on the status in the BirdWatch panel)
function rotorOpenSettings()
{
  const button = document.querySelector(".settingstab button[onclick*='featuresSettingsDiv']");
  if (!button) return;
  closeBirdWatchSettings();
  closeEventViewer();
  openSettingsTab(button, "featuresSettingsDiv");
  helpDiv.style.display = "none";
  GT.helpShow = false;
  rootSettingsDiv.style.display = "inline-flex";
}

function rotorStatusRender()
{
  const R = GT.rotor;
  if (typeof rotorStatus == "undefined") return;
  let text = I18N("rotor.status." + R.status).replace("{0}", R.error);
  if ((R.status == "connected" || R.status == "udp") && R.az !== null) text += "  " + rotorPositionText();
  // A serial port's error is said in full under its Choose Port button (the port's name stays beside the button); Status says it in short
  const portError = rotorProtocolChosen().serial && (R.status == "error" || R.status == "notFound");
  rotorPortError.style.display = portError ? "" : "none";
  rotorPortError.textContent = portError ? text : "";
  if (portError) text = I18N("rotor.status.errorShort");
  rotorStatus.textContent = text;
  rotorStatus.style.color = { connected: "lightgreen", udp: "lightgreen", connecting: "yellow", error: "#ff8080", noPort: "orange", notFound: "orange" }[R.status] || "#ccc";
  if (typeof birdWatchInfoLastN != "undefined" && birdWatchInfoLastN && GT.birdWatchTrack && GT.birdWatchTrack.selected) birdWatchInfoUpdate(birdWatchInfoLastN);
}

// "123° / 45°", or the azimuth alone for a controller without an elevation
function rotorPositionText()
{
  const R = GT.rotor;
  if (R.az === null) return "-";
  return Math.round(R.az) + "°" + (R.hasEl && R.el !== null ? " / " + Math.round(R.el) + "°" : "");
}

function rotorSetStatus(status, error = "")
{
  GT.rotor.status = status;
  GT.rotor.error = error;
  rotorStatusRender();
}

// ---- The serial port: through serialPorts.js (the picker, the grant at each start, the Linux group check)

// The CatRotator / PstRotator service that was its own (settings.pstrotator: enable, ip, port) is Rotor Control with that protocol now:
// carried over once, the old enable cleared so it isn't again. Its address and port are taken even when it was off, as long as
// Rotor Control still has its defaults
function rotorMigrate()
{
  const old = GT.settings.pstrotator;
  const S = GT.settings.rotor;
  if (!old) return;
  if (old.enable && !S.enable)
  {
    S.enable = true;
    S.protocol = "pstrotator";
    if (old.ip) S.host = old.ip;
    if (Number(old.port) > 0) S.udpPort = Number(old.port);
    old.enable = false;
  }
  else if (S.host == "127.0.0.1" && S.udpPort == 12000 && old.ip && old.ip != "127.0.0.1")
  {
    S.host = old.ip;
    if (Number(old.port) > 0) S.udpPort = Number(old.port);
  }
}

function rotorInit()
{
  rotorMigrate();
  serialPortTell("rotor", GT.settings.rotor.port);
  rotorSettingsRender();
  rotorAimingChanged();
  rotorConnect();
}

function rotorChoosePort()
{
  serialPortChoose("rotor", (port) =>
  {
    GT.settings.rotor.port = port;
    rotorSettingsRender();
    rotorConnect();
  });
}

// ---- The link

// The link let go; what it returns is settled once it is (a serial port takes a moment)
function rotorDisconnect()
{
  const R = GT.rotor;
  R.generation++;
  nodeTimers.clearInterval(R.pollTimer);
  nodeTimers.clearTimeout(R.retryTimer);
  R.pollTimer = R.retryTimer = null;
  const link = R.link;
  const writer = R.writer;
  const reader = R.reader;
  R.link = R.writer = R.reader = null;
  R.pending = "";
  R.bytes = [];
  R.sent = null;
  R.half = null;
  if (writer)
  {
    try { writer.releaseLock(); } catch (e) { /* closed already */ }
  }
  if (!link) return Promise.resolve();
  if (typeof link.destroy == "function")
  {
    link.destroy();
    return Promise.resolve();
  }
  if (typeof link.getInfo == "function")
  {
    // A serial port only closes once its reader has let go: the read loop is stopped first, then the port is closed. The promise
    // is for whoever opens next (rotorConnect): the same port can't be opened until this is done
    return (async () =>
    {
      try { if (reader) await reader.cancel(); } catch (e) { /* done already */ }
      try { await link.close(); } catch (e) { /* closed already, or gone */ }
    })();
  }
  if (typeof link.close == "function")
  {
    try { link.close(); } catch (e) { /* gone already */ }
  }
  return Promise.resolve();
}

async function rotorConnect()
{
  const closing = rotorDisconnect();
  const R = GT.rotor;
  const S = GT.settings.rotor;
  R.az = R.el = null;
  R.hasEl = null;
  if (!S.enable)
  {
    rotorSetStatus("off");
    return;
  }
  R.protocol = rotorProtocolChosen();
  const generation = R.generation;
  rotorSetStatus("connecting");
  // The port that was open is closed before one is opened; a newer connect meanwhile takes over
  await closing;
  if (generation != R.generation) return;
  const open = R.protocol.serial ? rotorOpenSerial(generation) : R.protocol.udp ? rotorOpenUdp(generation) : rotorOpenNet(generation);
  open.catch((e) =>
  {
    if (generation == R.generation) rotorFail(e && e.message ? e.message : String(e));
  });
}

// Lost, or never got there: tried again in a while, as long as the service is on
function rotorFail(message)
{
  const R = GT.rotor;
  rotorDisconnect();
  rotorSetStatus("error", message);
  R.retryTimer = nodeTimers.setTimeout(rotorConnect, ROTOR_RETRY_MS);
}

async function rotorOpenSerial(generation)
{
  const R = GT.rotor;
  const S = GT.settings.rotor;
  if (!S.port)
  {
    rotorSetStatus("noPort");
    return;
  }
  const port = await serialPortFor("rotor");
  if (generation != R.generation) return;
  // Chosen, but not there: unplugged, or not granted (its identity changed); tried again in a while
  if (!port)
  {
    rotorSetStatus("notFound", serialPortShortName(S.port));
    R.retryTimer = nodeTimers.setTimeout(rotorConnect, ROTOR_RETRY_MS);
    return;
  }
  await port.open({ baudRate: Number(S.baud) || 9600, dataBits: Number(S.dataBits) == 7 ? 7 : 8, stopBits: Number(S.stopBits) == 2 ? 2 : 1, parity: ["none", "even", "odd"].includes(S.parity) ? S.parity : "none" });
  if (generation != R.generation)
  {
    port.close().catch(() => {});
    return;
  }
  R.link = port;
  R.writer = port.writable.getWriter();
  port.addEventListener("disconnect", () =>
  {
    if (generation == R.generation) rotorFail("disconnected");
  });
  rotorReadSerial(port, generation);
  rotorConnected();
}

async function rotorReadSerial(port, generation)
{
  const R = GT.rotor;
  while (port.readable && generation == R.generation)
  {
    const reader = port.readable.getReader();
    R.reader = reader;
    try
    {
      for (;;)
      {
        const { value, done } = await reader.read();
        if (done || generation != R.generation) break;
        rotorReceive(value);
      }
    }
    catch (e)
    {
      if (generation == R.generation) rotorFail(e.message);
      return;
    }
    finally
    {
      reader.releaseLock();
    }
  }
}

function rotorOpenNet(generation)
{
  const R = GT.rotor;
  const S = GT.settings.rotor;
  return new Promise((resolve, reject) =>
  {
    const net = window.require("net");
    const socket = new net.Socket();
    socket.setEncoding("utf8");
    socket.on("connect", () =>
    {
      if (generation != R.generation)
      {
        socket.destroy();
        return;
      }
      R.link = socket;
      rotorConnected();
      resolve();
    });
    socket.on("data", (data) => { if (generation == R.generation) rotorReceive(data); });
    socket.on("error", (e) => { if (generation == R.generation) rotorFail(e.message); reject(e); });
    socket.on("close", () => { if (generation == R.generation && R.link === socket) rotorFail("closed"); });
    socket.connect(Number(S.netPort) || 4533, S.host || "127.0.0.1");
  });
}

// UDP (CatRotator / PstRotator): the messages go out as they are, there is no link to be up or down; the answers to the position
// asked come to the port one up, when the program sends them (it is then that an elevation is known of)
function rotorOpenUdp(generation)
{
  const R = GT.rotor;
  const S = GT.settings.rotor;
  const dgram = window.require("dgram");
  const socket = dgram.createSocket("udp4");
  socket.on("error", () => { /* the reply port is taken: sent without listening */ });
  socket.on("message", (message) => { if (generation == R.generation) rotorReceive(message.toString("utf8"), true); });
  socket.bind((Number(S.udpPort) || 12000) + 1);
  R.link = socket;
  rotorConnected();
  return Promise.resolve();
}

function rotorConnected()
{
  const R = GT.rotor;
  if (R.protocol.udp) rotorSetStatus("udp", GT.settings.rotor.host + ":" + GT.settings.rotor.udpPort);
  else rotorSetStatus("connected");
  if (R.protocol.caps) rotorWrite(R.protocol.caps());
  rotorWrite(R.protocol.poll());
  R.pollTimer = nodeTimers.setInterval(() => rotorWrite(R.protocol.poll()), ROTOR_POLL_MS);
}

function rotorWrite(data)
{
  const R = GT.rotor;
  if (!R.link) return;
  try
  {
    if (R.writer) R.writer.write(typeof data == "string" ? new TextEncoder().encode(data) : data).catch((e) => rotorFail(e.message));
    else if (R.protocol.udp) R.link.send(Buffer.from(data), Number(GT.settings.rotor.udpPort) || 12000, GT.settings.rotor.host || "127.0.0.1");
    else R.link.write(data);
  }
  catch (e)
  {
    rotorFail(e.message);
  }
}

// Bytes or text in: lines (or, SPID, 12-byte frames; UDP, the datagram as it is) to the protocol; a position read is kept and shown
function rotorReceive(data, whole = false)
{
  const R = GT.rotor;
  if (whole)
  {
    rotorPosition(R.protocol.parse(String(data), R));
    return;
  }
  if (R.protocol.binary)
  {
    for (const b of data) R.bytes.push(b);
    while (R.bytes.length >= 12)
    {
      if (R.bytes[0] != 0x57)
      {
        R.bytes.shift();
        continue;
      }
      rotorPosition(R.protocol.parse(R.bytes.slice(0, 12), R));
      R.bytes = R.bytes.slice(12);
    }
    return;
  }
  R.pending += typeof data == "string" ? data : new TextDecoder().decode(data);
  const lines = R.pending.split(/\r\n|\r|\n/);
  R.pending = lines.pop();
  for (const line of lines)
  {
    if (line.trim() == "") continue;
    rotorPosition(R.protocol.parse(line, R));
  }
}

function rotorPosition(position)
{
  if (!position) return;
  const R = GT.rotor;
  R.az = position.az;
  R.el = position.el;
  if (R.hasEl === null || R.protocol !== ROTOR_PROTOCOLS.rotctld) R.hasEl = position.el !== null;
  rotorStatusRender();
}

// ---- Pointing

// The rotator turned to az (and el, where it has one); `follow` is the satellite tracking: not too often, and only for a change
function rotorPoint(az, el, follow = false)
{
  const R = GT.rotor;
  if ((R.status != "connected" && R.status != "udp") || !R.protocol) return false;
  az = Math.round((((Number(az) % 360) + 360) % 360) * 10) / 10;
  el = el === null || el === undefined ? null : Math.round(Math.min(90, Math.max(0, Number(el))) * 10) / 10;
  const now = Date.now();
  if (follow && R.sent)
  {
    if (now - R.sent.at < ROTOR_FOLLOW_MS) return false;
    if (Math.abs(az - R.sent.az) < 1 && Math.abs((el === null ? 0 : el) - (R.sent.el === null ? 0 : R.sent.el)) < 1) return false;
  }
  // Only an elevation the controller has (unknown yet: the azimuth alone, which every one takes)
  rotorWrite(R.protocol.set(az, R.hasEl ? el : null));
  R.sent = { az: az, el: el, at: now };
  return true;
}

// Aim Rotator (the map's Ctrl-click, the roster): a station on the ground, at the heading, level
function rotorAim(callObj)
{
  if (!(callObj.distance > 0)) return;
  if (!rotorPoint(callObj.heading, 0))
  {
    addEvent("rotor", "<font style='color:red'>" + I18N("rotor.notConnected") + "</font>");
    return;
  }
  const text = callObj.DEcall ? I18N("gt.rotator.aimAt").replace("{0}", callObj.DEcall) : I18N("gt.rotator.aimTo").replace("{0}", Math.round(callObj.heading));
  addEvent("rotor", "<font style='color:white'>" + text + "</font>");
}

// Each tracker tick (birdWatchPanelUpdate): the selected satellite while it is up; before its pass, where it will rise
function rotorFollowSatellite(sat, pass)
{
  const S = GT.settings.rotor;
  if (!S.enable || !S.follow || !sat || sat.error) return;
  const now = Date.now();
  if (sat.up) rotorPoint(sat.az, sat.el, true);
  else if (pass && !pass.inProgress && pass.aos > now && pass.aos - now <= ROTOR_PREAIM_MS) rotorPoint(pass.aosAz, 0, true);
}
