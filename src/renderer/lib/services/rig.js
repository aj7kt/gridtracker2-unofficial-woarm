// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// Rig Control (Settings -> Features -> Service): the rig's frequency and mode, read every second and set on request (rigTune), through
// Hamlib's rigctld (TCP), flrig (XML-RPC over HTTP) or an Icom over CI-V on a serial port (Web Serial, serialPorts.js). WSJT-X usually
// holds the rig's serial port: a port that can't be opened says so under Choose Port, with the way to share the rig (rigctld or flrig)

GT.rig = {
  link: null,         // the open serial port, or the socket (flrig: nothing kept, each call is a request)
  writer: null,
  reader: null,
  protocol: null,
  status: "off",      // off, noPort, notFound, connecting, connected, error
  error: "",
  freq: null,         // Hz, the last read
  mode: null,         // "USB", "FM", ... as the rig says it
  freqB: null,        // Hz, the second VFO's (the TX one), when the rig has one
  dual: null,         // whether the rig has a second VFO that can be read and set: known once it has answered (null until then)
  split: false,       // split (TX on the second VFO) has been asked of the rig
  civFound: null,     // CI-V: the address the rig answered from (asked with 19 00 at the broadcast address, 00, which every Icom answers)
  model: null,        // the rig's name, as rigctld or flrig say it, or the Icom its CI-V address is the default of
  toneFreq: null,     // rigctld: whether it can set the rig's CTCSS tone, and turn it on (its capabilities: Can set CTCSS Tone, Set functions TONE)
  toneFunc: null,
  toneOn: false,      // a CTCSS tone was turned on here (and is turned off again when a transmitter without one is set)
  ranges: null,       // rigctld: the RX and TX ranges its capabilities list, in Hz ({ rx: [[low, high], ...], tx: [...] }; rigRanges.js)
  rangeSection: null, // rigctld: the capabilities' ranges being read ("rx", "tx"), while their lines come
  pollTimer: null,
  retryTimer: null,
  generation: 0,      // a connect under way is the newest one; an older one that finishes is ignored
  pending: "",        // text received that isn't a whole line yet
  bytes: [],          // CI-V bytes that aren't a whole frame yet
  busy: false,        // flrig: a request is out
  queue: [],          // serial: the frames to send, one at a time (an Icom answers only the last of a burst)
  waiting: null       // serial: the timer for the reply to the frame out, after which the next goes anyway
};

const RIG_REPLY_MS = 250;
const RIG_QUEUE_MAX = 12;

const RIG_POLL_MS = 1000;
const RIG_RETRY_MS = 10000;
const RIG_BAUDS = [4800, 9600, 19200, 38400, 57600, 115200];
// The Icoms by the CI-V address each comes with (an address can be changed in the rig: the name from the port's device id wins, below)
const RIG_CIV_MODELS = { 0x94: "IC-7300", 0xa2: "IC-9700", 0xa4: "IC-705", 0x88: "IC-7100", 0x98: "IC-7610", 0x7a: "IC-7600", 0x74: "IC-7700", 0x6a: "IC-7800", 0x8e: "IC-7851", 0x7c: "IC-9100", 0x70: "IC-7000", 0x76: "IC-7200", 0x80: "IC-7410", 0x5e: "IC-718", 0x58: "IC-706MKIIG", 0x60: "IC-910H", 0x66: "IC-746PRO", 0x6e: "IC-756PROIII", 0x64: "IC-756PROII", 0x5c: "IC-756PRO", 0x50: "IC-756", 0x96: "IC-R8600", 0xac: "IC-905" };
const RIG_CIV_MODES = { 0x00: "LSB", 0x01: "USB", 0x02: "AM", 0x03: "CW", 0x04: "RTTY", 0x05: "FM", 0x06: "WFM", 0x07: "CW-R", 0x08: "RTTY-R", 0x17: "DV" };

// ---- CI-V: FE FE <to> <from> <command> <data...> FD; the frequency as five BCD bytes, the lowest digits first

function rigCivFrame(address, command, data = [])
{
  return new Uint8Array([0xfe, 0xfe, address, 0xe0, command, ...data, 0xfd]);
}

function rigCivBcdToHz(bytes)
{
  let hz = 0;
  for (let i = bytes.length - 1; i >= 0; i--) hz = hz * 100 + (bytes[i] >> 4) * 10 + (bytes[i] & 0x0f);
  return hz;
}

function rigCivHzToBcd(hz)
{
  const digits = String(Math.round(hz)).padStart(10, "0");
  const bytes = [];
  for (let i = 10; i >= 2; i -= 2) bytes.push((Number(digits[i - 2]) << 4) | Number(digits[i - 1]));
  return bytes;
}

// The address frames go to: the one set, else the one the rig answered from, else the broadcast address (00), which every Icom
// answers, from its own
function rigCivAddress()
{
  const value = parseInt(String(GT.settings.rig.civAddress).trim(), 16);
  if (Number.isFinite(value) && value > 0 && value < 0xff) return value;
  return GT.rig.civFound || 0x00;
}

// Each protocol: serial (CI-V) or network (rigctld, flrig); what to send to ask and to set, and how the answers read
//   poll():          what asks the frequency and the mode
//   setFreq(hz), setMode(mode): what sets them (mode as the rig names it: "USB", "FM", ...)
//   parse(line | bytes, R): updates R.freq / R.mode from an answer; a string back is an error
const RIG_PROTOCOLS = {
  rigctld: {
    name: "Hamlib rigctld",
    serial: false,
    // The extended protocol (+): the answers come labeled, "Frequency: 14074000", "Mode: USB", and end with "RPRT 0". The second VFO
    // is the split TX one: its frequency is read (i) and set (I) as the split frequency, with split on (S 1 VFOB)
    caps: () => "+1\n",
    poll: (R) => "+f\n+m\n" + (R.dual ? "+i\n" : ""),
    setFreq: (hz) => "+F " + Math.round(hz) + "\n",
    setMode: (mode) => "+M " + mode + " 0\n",
    setTx: (hz) => "+I " + Math.round(hz) + "\n",
    splitOn: () => "+S 1 VFOB\n",
    // The CTCSS tone in tenths of a hertz (C), and the tone turned on or off (U TONE)
    setTone: (hz) => (hz > 0 ? "+C " + Math.round(hz * 10) + "\n+U TONE 1\n" : "+U TONE 0\n"),
    canTone: (R) => R.toneFreq === true && R.toneFunc === true,
    parse: (line, R) =>
    {
      let m;
      // The capabilities' "RX ranges ..." and "TX ranges ..." headings, each followed by its ranges indented: "1800000 Hz - 2000000 Hz"
      // (older Hamlib) or "1.8 MHz - 2 MHz"; a line that isn't indented ends them
      if ((m = /^(RX|TX) ranges/i.exec(line)))
      {
        R.rangeSection = m[1].toLowerCase();
        R.ranges = R.ranges || { rx: [], tx: [] };
        return null;
      }
      if (R.rangeSection && (m = /^\s+([\d.]+)\s*([GMk]?)Hz\s*-\s*([\d.]+)\s*([GMk]?)Hz/.exec(line)))
      {
        const unit = { G: 1e9, M: 1e6, k: 1e3, "": 1 };
        R.ranges[R.rangeSection].push([Number(m[1]) * unit[m[2]], Number(m[3]) * unit[m[4]]]);
        return null;
      }
      if (!/^\s/.test(line)) R.rangeSection = null;
      if ((m = /^Frequency:\s*(\d+)/.exec(line))) R.freq = Number(m[1]);
      else if ((m = /^TX Frequency:\s*(\d+)/.exec(line))) R.freqB = Number(m[1]);
      else if ((m = /^VFO list:\s*(.*)/.exec(line))) R.dual = /VFOB|Sub/i.test(m[1]);
      else if ((m = /^Model name:\s*(.+)/.exec(line))) R.model = m[1].trim();
      else if ((m = /^Can set CTCSS Tone:\s*(\S)/.exec(line))) R.toneFreq = m[1] == "Y";
      else if ((m = /^Set functions:\s*(.*)/.exec(line))) R.toneFunc = /\bTONE\b/.test(m[1]);
      else if ((m = /^Mode:\s*(\S+)/.exec(line))) R.mode = m[1];
      else if ((m = /^RPRT\s+(-\d+)/.exec(line))) return "RPRT " + m[1];
      return null;
    }
  },
  flrig: {
    name: "flrig",
    serial: false,
    http: true,
    // XML-RPC: VFO A is the RX one and B the TX one (split on); the gets give strings, the sets take the hertz or the mode's name
    calls: { freq: "rig.get_vfoA", mode: "rig.get_modeA", freqB: "rig.get_vfoB", model: "rig.get_xcvr" },
    setFreq: (hz) => ["rig.set_vfoA", "<double>" + Math.round(hz) + "</double>"],
    setMode: (mode) => ["rig.set_modeA", "<string>" + mode + "</string>"],
    setTx: (hz) => ["rig.set_vfoB", "<double>" + Math.round(hz) + "</double>"],
    splitOn: () => ["rig.set_split", "<int>1</int>"]
  },
  civ: {
    name: "Icom CI-V",
    serial: true,
    binary: true,
    // 19 00 asks the rig its CI-V address (answered with it), once connected
    caps: () => rigCivFrame(rigCivAddress(), 0x19, [0x00]),
    // 03 asks the frequency, 04 the mode; 05 and 06 set them. The other VFO (the TX one, with split on: 0F 01) is read and set
    // without switching to it, with 25 01 (the IC-7300, 7610, 9700 and 705 have it; a rig that answers NG hasn't, and isn't asked again)
    poll: (R) => [rigCivFrame(rigCivAddress(), 0x03), rigCivFrame(rigCivAddress(), 0x04)].concat(R.dual === false ? [] : [rigCivFrame(rigCivAddress(), 0x25, [0x01])]),
    setFreq: (hz) => rigCivFrame(rigCivAddress(), 0x05, rigCivHzToBcd(hz)),
    setTx: (hz) => rigCivFrame(rigCivAddress(), 0x25, [0x01, ...rigCivHzToBcd(hz)]),
    splitOn: () => rigCivFrame(rigCivAddress(), 0x0f, [0x01]),
    // 1B 00 sets the repeater tone (00, then the tenths of a hertz as four BCD digits: 67.0 is 00 06 70), 16 42 turns it on (01) or off (00)
    setTone: (hz) =>
    {
      if (!(hz > 0)) return [rigCivFrame(rigCivAddress(), 0x16, [0x42, 0x00])];
      const digits = String(Math.round(hz * 10)).padStart(4, "0");
      const bcd = (i) => (Number(digits[i]) << 4) | Number(digits[i + 1]);
      return [rigCivFrame(rigCivAddress(), 0x1b, [0x00, bcd(0), bcd(2)]), rigCivFrame(rigCivAddress(), 0x16, [0x42, 0x01])];
    },
    canTone: () => true,
    setMode: (mode) =>
    {
      const code = Number(Object.keys(RIG_CIV_MODES).find((key) => RIG_CIV_MODES[key] == String(mode).toUpperCase()));
      return Number.isFinite(code) ? rigCivFrame(rigCivAddress(), 0x06, [code]) : null;
    },
    // A frame from the rig to us (E0), or to everyone (00: the rig telling of a change); our own frames come back (the echo) and are skipped
    parse: (frame, R) =>
    {
      if (frame[2] != 0xe0 && frame[2] != 0x00) return null;
      // Our own frames come back (the echo): from us (E0)
      if (frame[3] == 0xe0) return null;
      // Whatever the rig answers tells its address
      if (frame[3] > 0 && frame[3] < 0xff) R.civFound = frame[3];
      const command = frame[4];
      const data = frame.slice(5, frame.length - 1);
      if ((command == 0x03 || command == 0x00) && data.length >= 5) R.freq = rigCivBcdToHz(data.slice(0, 5));
      else if ((command == 0x04 || command == 0x01) && data.length >= 1) R.mode = RIG_CIV_MODES[data[0]] || ("mode " + data[0]);
      else if (command == 0x19 && data.length >= 2 && data[0] == 0x00) R.civFound = data[1];
      else if (command == 0x25 && data.length >= 6 && data[0] == 0x01)
      {
        R.freqB = rigCivBcdToHz(data.slice(1, 6));
        R.dual = true;
      }
      else if (command == 0xfa)
      {
        // The first NG, before the other VFO ever answered: the rig hasn't the 25 command
        if (R.dual === null) R.dual = false;
        return "NG";
      }
      return null;
    }
  }
};

function rigProtocolChosen()
{
  return RIG_PROTOCOLS[GT.settings.rig.protocol] || RIG_PROTOCOLS.rigctld;
}

// ---- Settings (Features -> Service)

function rigSettingsRender()
{
  const S = GT.settings.rig;
  rigEnable.checked = S.enable;
  if (!rigProtocol.options.length)
  {
    for (const [key, protocol] of Object.entries(RIG_PROTOCOLS))
    {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = protocol.name;
      rigProtocol.appendChild(option);
    }
    for (const baud of RIG_BAUDS)
    {
      const option = document.createElement("option");
      option.value = String(baud);
      option.textContent = String(baud);
      rigBaud.appendChild(option);
    }
  }
  rigProtocol.value = S.protocol in RIG_PROTOCOLS ? S.protocol : "rigctld";
  rigBaud.value = RIG_BAUDS.includes(Number(S.baud)) ? String(S.baud) : "19200";
  rigDataBits.value = Number(S.dataBits) == 7 ? "7" : "8";
  rigParity.value = ["none", "even", "odd"].includes(S.parity) ? S.parity : "none";
  rigStopBits.value = Number(S.stopBits) == 2 ? "2" : "1";
  rigCivAddress.value = S.civAddress;
  rigCivAddress.placeholder = I18N("rig.civ.auto");
  rigHost.value = S.host;
  const protocol = rigProtocolChosen();
  rigNetPort.value = protocol.http ? S.flrigPort : S.netPort;
  rigPortName.textContent = S.port ? serialPortShortName(S.port) + (serialPortModel(S.port) ? "  \u2014  " + serialPortModel(S.port) : "") : I18N("settings.rotor.none.label");
  rigPortName.title = S.port ? S.port.displayName || "" : "";
  const serial = protocol.serial;
  const rows = { rigProtocolTr: S.enable, rigPortTr: S.enable && serial, rigBaudTr: S.enable && serial, rigCivTr: S.enable && S.protocol == "civ", rigHostTr: S.enable && !serial, rigStatusTr: S.enable };
  for (const [id, on] of Object.entries(rows)) document.getElementById(id).style.display = on ? "" : "none";
  serialLinuxRender(rigLinuxTr, rigLinuxText, S.port, S.enable && serial);
  rigStatusRender();
}

function rigEnableChanged()
{
  GT.settings.rig.enable = rigEnable.checked;
  rigSettingsRender();
  rigConnect();
}

// The protocol, port settings, address or host changed: connected again with them
function rigSettingsChanged()
{
  const S = GT.settings.rig;
  // Another protocol: the port field still shows the old one's port, so it isn't read; the render below fills it with the new one's
  const sameProtocol = S.protocol == rigProtocol.value;
  S.protocol = rigProtocol.value;
  S.baud = Number(rigBaud.value);
  S.dataBits = Number(rigDataBits.value);
  S.parity = rigParity.value;
  S.stopBits = Number(rigStopBits.value);
  S.civAddress = rigCivAddress.value.trim().toUpperCase();
  S.host = rigHost.value.trim();
  if (sameProtocol)
  {
    if (rigProtocolChosen().http) S.flrigPort = Number(rigNetPort.value) || 12345;
    else S.netPort = Number(rigNetPort.value) || 4532;
  }
  rigSettingsRender();
  rigConnect();
}

function rigChoosePort()
{
  serialPortChoose("rig", (port) =>
  {
    GT.settings.rig.port = port;
    rigSettingsRender();
    rigConnect();
  });
}

function rigMhz(hz)
{
  return (hz / 1e6).toFixed(6);
}

// The rig's name: as rigctld or flrig said it; a serial rig's from its port's device id (IC-7300_...), else the Icom its address
// is the default of; "" when none is known
function rigModelName()
{
  const R = GT.rig;
  if (R.model) return R.model;
  if (rigProtocolChosen().serial) return serialPortModel(GT.settings.rig.port) || (R.civFound && RIG_CIV_MODELS[R.civFound]) || "";
  return "";
}

// "14.074000 (435.250000) MHz USB": VFO A, the second VFO in brackets when the rig has one, the mode
function rigFrequencyText()
{
  const R = GT.rig;
  if (R.freq === null) return "";
  return rigMhz(R.freq) + (R.dual && R.freqB !== null ? " (" + rigMhz(R.freqB) + ")" : "") + " MHz" + (R.mode ? " " + R.mode : "");
}

// The rig's box in the control panel and the BirdWatch panel (a box like the sky plot's, its border yellow): the frequencies on one line,
// "Rig: 14.074000 (435.250000)", the mode on the next, "Mode: USB"; its status instead while it isn't connected. There while Rig Control is on
function rigLineRender()
{
  if (typeof rigLineMain == "undefined") return;
  const R = GT.rig;
  const on = GT.settings.rig.enable;
  let html;
  if (R.status == "connected" && R.freq !== null)
  {
    html = "<div><span style='color:white'>" + I18N("rig.line.rig") + ":</span> <span style='color:yellow'>" + rigMhz(R.freq) + "</span>" +
      (R.dual && R.freqB !== null ? " <span style='color:#ffd27f'>(" + rigMhz(R.freqB) + ")</span>" : "") + "</div>" +
      "<div><span style='color:white'>" + I18N("rig.line.mode") + ":</span> <span style='color:lightgreen'>" + htmlEntities(R.mode || "-") + "</span></div>";
  }
  else html = "<div><span style='color:white'>" + I18N("rig.line.rig") + ":</span> <span style='color:orange'>" + htmlEntities(R.status == "error" ? I18N("rotor.status.errorShort") : I18N("rotor.status." + R.status).replace("{0}", R.error)) + "</span></div>";
  for (const line of [rigLineMain, birdWatchRigLine])
  {
    line.style.display = on ? "" : "none";
    if (on && line.innerHTML != html) line.innerHTML = html;
  }
}

function rigStatusRender()
{
  const R = GT.rig;
  if (typeof rigStatus == "undefined") return;
  let text = I18N("rotor.status." + R.status).replace("{0}", R.error);
  // A rig with a second VFO that can be read and set is said so
  if (R.status == "connected" && R.dual) text += " (" + I18N("rig.twoVfos") + ")";
  if (R.status == "connected" && rigModelName()) text += "  " + rigModelName();
  if (R.status == "connected" && R.freq !== null) text += "  " + rigFrequencyText();
  // A serial port that couldn't be opened is said in full under Choose Port, with the way to share the rig; Status says it in short
  const portError = rigProtocolChosen().serial && (R.status == "error" || R.status == "notFound");
  rigPortError.style.display = portError ? "" : "none";
  rigPortError.textContent = portError ? (R.status == "error" ? I18N("serial.inUse").replace("{0}", serialPortShortName(GT.settings.rig.port)) + "\n" + R.error : text) : "";
  if (portError) text = I18N("rotor.status.errorShort");
  rigStatus.textContent = text;
  rigStatus.style.color = { connected: "lightgreen", connecting: "yellow", error: "#ff8080", noPort: "orange", notFound: "orange" }[R.status] || "#ccc";
  // The CI-V address the rig answered from, beside the field
  if (typeof birdWatchSatRigAvailable == "function") birdWatchSatRigAvailable();
  rigCivFound.textContent = R.civFound && R.status == "connected" ? I18N("rig.civ.found").replace("{0}", R.civFound.toString(16).toUpperCase().padStart(2, "0")) + (RIG_CIV_MODELS[R.civFound] ? "  \u00b7  " + RIG_CIV_MODELS[R.civFound] : "") : "";
  rigLineRender();
}

function rigSetStatus(status, error = "")
{
  GT.rig.status = status;
  GT.rig.error = error;
  rigStatusRender();
}

function rigInit()
{
  serialPortTell("rig", GT.settings.rig.port);
  rigSettingsRender();
  rigConnect();
}

// ---- The link

// The link let go; what it returns is settled once it is (a serial port takes a moment)
function rigDisconnect()
{
  const R = GT.rig;
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
  R.busy = false;
  R.queue = [];
  nodeTimers.clearTimeout(R.waiting);
  R.waiting = null;
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
    return (async () =>
    {
      try { if (reader) await reader.cancel(); } catch (e) { /* done already */ }
      try { await link.close(); } catch (e) { /* closed already, or gone */ }
    })();
  }
  return Promise.resolve();
}

async function rigConnect()
{
  const closing = rigDisconnect();
  const R = GT.rig;
  const S = GT.settings.rig;
  R.freq = R.mode = R.freqB = null;
  R.dual = null;
  R.split = false;
  R.civFound = null;
  R.model = null;
  R.toneFreq = R.toneFunc = null;
  R.toneOn = false;
  R.ranges = R.rangeSection = null;
  if (!S.enable)
  {
    rigSetStatus("off");
    return;
  }
  R.protocol = rigProtocolChosen();
  const generation = R.generation;
  rigSetStatus("connecting");
  await closing;
  if (generation != R.generation) return;
  const open = R.protocol.serial ? rigOpenSerial(generation) : R.protocol.http ? rigOpenHttp(generation) : rigOpenNet(generation);
  open.catch((e) =>
  {
    if (generation == R.generation) rigFail(e && e.message ? e.message : String(e));
  });
}

// Lost, or never got there: tried again in a while, as long as the service is on
function rigFail(message)
{
  const R = GT.rig;
  rigDisconnect();
  rigSetStatus("error", message);
  R.retryTimer = nodeTimers.setTimeout(rigConnect, RIG_RETRY_MS);
}

async function rigOpenSerial(generation)
{
  const R = GT.rig;
  const S = GT.settings.rig;
  if (!S.port)
  {
    rigSetStatus("noPort");
    return;
  }
  const port = await serialPortFor("rig");
  if (generation != R.generation) return;
  if (!port)
  {
    rigSetStatus("notFound", serialPortShortName(S.port));
    R.retryTimer = nodeTimers.setTimeout(rigConnect, RIG_RETRY_MS);
    return;
  }
  await port.open({ baudRate: Number(S.baud) || 19200, dataBits: Number(S.dataBits) == 7 ? 7 : 8, stopBits: Number(S.stopBits) == 2 ? 2 : 1, parity: ["none", "even", "odd"].includes(S.parity) ? S.parity : "none" });
  if (generation != R.generation)
  {
    port.close().catch(() => {});
    return;
  }
  R.link = port;
  R.writer = port.writable.getWriter();
  port.addEventListener("disconnect", () =>
  {
    if (generation == R.generation) rigFail("disconnected");
  });
  rigReadSerial(port, generation);
  rigConnected();
}

async function rigReadSerial(port, generation)
{
  const R = GT.rig;
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
        rigReceive(value);
      }
    }
    catch (e)
    {
      if (generation == R.generation) rigFail(e.message);
      return;
    }
    finally
    {
      reader.releaseLock();
    }
  }
}

function rigOpenNet(generation)
{
  const R = GT.rig;
  const S = GT.settings.rig;
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
      rigConnected();
      resolve();
    });
    socket.on("data", (data) => { if (generation == R.generation) rigReceive(data); });
    socket.on("error", (e) => { if (generation == R.generation) rigFail(e.message); reject(e); });
    socket.on("close", () => { if (generation == R.generation && R.link === socket) rigFail("closed"); });
    socket.connect(Number(S.netPort) || 4532, S.host || "127.0.0.1");
  });
}

// flrig: no link to keep; connected once it has answered, polled by requests
function rigOpenHttp(generation)
{
  const R = GT.rig;
  R.link = { http: true };
  R.pollTimer = nodeTimers.setInterval(() => rigHttpPoll(generation), RIG_POLL_MS);
  rigHttpPoll(generation);
  return Promise.resolve();
}

// One XML-RPC call to flrig: the string (or number) in its answer
function rigHttpCall(method, paramsXml = "")
{
  const S = GT.settings.rig;
  return new Promise((resolve, reject) =>
  {
    const http = window.require("http");
    const body = "<?xml version=\"1.0\"?><methodCall><methodName>" + method + "</methodName><params>" + (paramsXml ? "<param><value>" + paramsXml + "</value></param>" : "") + "</params></methodCall>";
    const request = http.request({ host: S.host || "127.0.0.1", port: Number(S.flrigPort) || 12345, method: "POST", path: "/", headers: { "Content-Type": "text/xml", "Content-Length": Buffer.byteLength(body) }, timeout: 3000 }, (response) =>
    {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { text += chunk; });
      response.on("end", () =>
      {
        const fault = /<fault>/.test(text);
        const m = /<value>\s*(?:<(?:string|double|int|i4)>)?\s*([^<]*)/.exec(text);
        if (fault || !m) reject(new Error(fault ? "fault" : "no answer"));
        else resolve(m[1].trim());
      });
    });
    request.on("error", reject);
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.end(body);
  });
}

async function rigHttpPoll(generation)
{
  const R = GT.rig;
  if (R.busy) return;
  R.busy = true;
  try
  {
    if (R.model === null)
    {
      try { R.model = await rigHttpCall(R.protocol.calls.model); } catch (e) { R.model = ""; }
    }
    const freq = await rigHttpCall(R.protocol.calls.freq);
    const mode = await rigHttpCall(R.protocol.calls.mode);
    let freqB = null;
    if (R.dual !== false)
    {
      try { freqB = Number(await rigHttpCall(R.protocol.calls.freqB)) || null; } catch (e) { freqB = null; }
    }
    if (generation != R.generation) return;
    R.freq = Number(freq) || null;
    R.mode = mode || null;
    if (R.dual !== false)
    {
      R.dual = freqB !== null;
      R.freqB = freqB;
    }
    if (R.status != "connected") rigSetStatus("connected");
    else rigStatusRender();
  }
  catch (e)
  {
    if (generation == R.generation) rigFail(e.message);
  }
  finally
  {
    R.busy = false;
  }
}

function rigConnected()
{
  const R = GT.rig;
  rigSetStatus("connected");
  if (R.protocol.caps) rigWrite(R.protocol.caps());
  rigPoll();
  R.pollTimer = nodeTimers.setInterval(rigPoll, RIG_POLL_MS);
}

function rigPoll()
{
  const R = GT.rig;
  const asks = R.protocol.poll(R);
  for (const ask of Array.isArray(asks) ? asks : [asks]) rigWrite(ask);
}

function rigWrite(data)
{
  const R = GT.rig;
  if (!R.link || data === null) return;
  // A serial rig takes one command at a time: queued, sent as the one before is answered (a backlog, when it doesn't answer, is capped)
  if (R.writer)
  {
    if (R.queue.length >= RIG_QUEUE_MAX) R.queue.shift();
    R.queue.push(data);
    rigDrain();
    return;
  }
  try
  {
    R.link.write(data);
  }
  catch (e)
  {
    rigFail(e.message);
  }
}

// The next queued frame out, once nothing is awaited; the next after it on the rig's reply (rigReplied) or, failing that, in a moment
function rigDrain()
{
  const R = GT.rig;
  if (R.waiting || !R.writer || R.queue.length == 0) return;
  const data = R.queue.shift();
  R.waiting = nodeTimers.setTimeout(() =>
  {
    R.waiting = null;
    rigDrain();
  }, RIG_REPLY_MS);
  R.writer.write(typeof data == "string" ? new TextEncoder().encode(data) : data).catch((e) => rigFail(e.message));
}

function rigReplied()
{
  const R = GT.rig;
  if (!R.waiting) return;
  nodeTimers.clearTimeout(R.waiting);
  R.waiting = null;
  rigDrain();
}

// Bytes or text in: lines (rigctld) or CI-V frames to the protocol; what was read is shown
function rigReceive(data)
{
  const R = GT.rig;
  if (R.protocol.binary)
  {
    for (const b of data) R.bytes.push(b);
    for (;;)
    {
      const start = R.bytes.indexOf(0xfe);
      if (start < 0)
      {
        R.bytes = [];
        break;
      }
      const end = R.bytes.indexOf(0xfd, start);
      if (end < 0)
      {
        if (start > 0) R.bytes = R.bytes.slice(start);
        break;
      }
      const frame = R.bytes.slice(start, end + 1);
      R.bytes = R.bytes.slice(end + 1);
      if (frame.length < 6 || frame[1] != 0xfe) continue;
      R.protocol.parse(frame, R);
      // From the rig (not our own frame echoed): the command out is answered, the next can go
      if (frame[3] != 0xe0) rigReplied();
    }
    rigStatusRender();
    return;
  }
  R.pending += typeof data == "string" ? data : new TextDecoder().decode(data);
  const lines = R.pending.split(/\r\n|\r|\n/);
  R.pending = lines.pop();
  for (const line of lines)
  {
    if (line.trim() == "") continue;
    const problem = R.protocol.parse(line, R);
    if (problem) R.error = problem;
  }
  rigStatusRender();
}

// ---- Tuning: for BirdWatch's Doppler only. The rosters (the Feed Roster's spots too) tune through WSJT-X and the loggers as before, never
// through Rig Control

// The rig set to what is given of { rx, tx, mode, tone }: rx (Hz) on VFO A, tx (Hz) on the second VFO with split on (only a rig that has
// one: rigTuneCanTx), mode ("USB", "FM", ...) on VFO A, tone (Hz) the CTCSS tone turned on (0: turned off, if it was turned on here; only
// a rig that can: rigTuneCanTone). True when something was sent
function rigTune(spec)
{
  const R = GT.rig;
  if (typeof spec != "object" || spec === null || R.status != "connected" || !R.protocol) return false;
  const P = R.protocol;
  const steps = [];
  if (spec.rx > 0) steps.push(P.setFreq(spec.rx));
  if (spec.mode) steps.push(P.setMode(spec.mode));
  if (spec.tx > 0 && rigTuneCanTx())
  {
    if (!R.split)
    {
      steps.push(P.splitOn());
      R.split = true;
    }
    steps.push(P.setTx(spec.tx));
  }
  if (spec.tone !== undefined && spec.tone !== null && rigTuneCanTone() && (spec.tone > 0 || R.toneOn))
  {
    const tone = P.setTone(spec.tone);
    steps.push(...(Array.isArray(tone) ? tone : [tone]));
    R.toneOn = spec.tone > 0;
  }
  const sent = steps.filter((step) => step !== null && step !== undefined);
  if (sent.length == 0) return false;
  if (P.http)
  {
    let chain = Promise.resolve();
    for (const [method, params] of sent) chain = chain.then(() => rigHttpCall(method, params));
    chain.catch((e) => rigFail(e.message));
    return true;
  }
  for (const step of sent) rigWrite(step);
  return true;
}

// Whether the TX side can be tuned: the rig has a second VFO that answers
function rigTuneCanTx()
{
  return GT.rig.status == "connected" && GT.rig.dual === true;
}

// Whether a CTCSS tone can be set: a CI-V rig, or one rigctld says can (flrig has no call for it)
function rigTuneCanTone()
{
  const R = GT.rig;
  return R.status == "connected" && !!R.protocol && typeof R.protocol.setTone == "function" && R.protocol.canTone(R);
}
