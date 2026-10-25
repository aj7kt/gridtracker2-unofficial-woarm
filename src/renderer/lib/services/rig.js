// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// Rig Control (Settings -> Features -> Service): the rig's frequency and mode, read every second and set on request (rigTune), through
// Hamlib's rigctld (TCP), flrig (XML-RPC over HTTP), or on a serial port (Web Serial, serialPorts.js) an Icom over CI-V, a Kenwood or a
// newer Yaesu over their CAT (rigCatProtocol). WSJT-X usually
// holds the rig's serial port: a port that can't be opened says so under Choose Port, with the way to share the rig (rigctld or flrig).
// The rig set up is VFO-A's, the downlink (RX); VFO-B, the uplink (TX), is the same rig's second VFO (split on) or a second rig of its
// own (settings.rig.second, its VFO A), each rig with its own link

function rigNewState(key)
{
  return {
    key: key,           // "a": VFO-A's rig (settings.rig), "b": VFO-B's second rig (settings.rig.second)
    link: null,         // the open serial port, or the socket (flrig: nothing kept, each call is a request)
    writer: null,
    reader: null,
    protocol: null,
    status: "off",      // off, noPort, notFound, connecting, connected, error
    error: "",
    freq: null,         // Hz, the last read
    mode: null,         // "USB", "FM", ... as the rig says it
    freqB: null,        // Hz, the second VFO's (the TX one), when the rig has one
    modeB: null,        // the second VFO's mode, where the rig can say it (rigctld x, flrig get_modeB, CI-V 26 01); asked with VFO-B on it
    modeBAsk: true,     // CI-V: false once the rig answered NG to 26 01 (it hasn't it), so it isn't asked again
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
    lastSent: null,     // serial: the frame out last (a Kenwood or Yaesu "?;" refuses it)
    catId: null,        // Kenwood, Yaesu: what the rig answered to ID; ("019", "0570")
    waiting: null       // serial: the timer for the reply to the frame out, after which the next goes anyway
  };
}

GT.rig = rigNewState("a");
GT.rigB = rigNewState("b");

const RIG_REPLY_MS = 250;
const RIG_GAP_MS = 30;
const RIG_QUEUE_MAX = 12;

const RIG_POLL_MS = 1000;
const RIG_RETRY_MS = 10000;
const RIG_BAUDS = [4800, 9600, 19200, 38400, 57600, 115200];
// The Icoms by the CI-V address each comes with (an address can be changed in the rig: the name from the port's device id wins, below)
const RIG_CIV_MODELS = { 0x94: "IC-7300", 0xa2: "IC-9700", 0xa4: "IC-705", 0x88: "IC-7100", 0x98: "IC-7610", 0x7a: "IC-7600", 0x74: "IC-7700", 0x6a: "IC-7800", 0x8e: "IC-7851", 0x7c: "IC-9100", 0x70: "IC-7000", 0x76: "IC-7200", 0x80: "IC-7410", 0x5e: "IC-718", 0x58: "IC-706MKIIG", 0x60: "IC-910H", 0x66: "IC-746PRO", 0x6e: "IC-756PROIII", 0x64: "IC-756PROII", 0x5c: "IC-756PRO", 0x50: "IC-756", 0x96: "IC-R8600", 0xac: "IC-905" };
const RIG_CIV_MODES = { 0x00: "LSB", 0x01: "USB", 0x02: "AM", 0x03: "CW", 0x04: "RTTY", 0x05: "FM", 0x06: "WFM", 0x07: "CW-R", 0x08: "RTTY-R", 0x17: "DV" };

// A rig's settings: VFO-A's are settings.rig, the second rig's settings.rig.second
function rigSettingsOf(R)
{
  return R.key == "a" ? GT.settings.rig : GT.settings.rig.second;
}

// VFO-B, the uplink: "none" (not tuned), "same" (VFO-A's rig's second VFO, split on) or "second" (a rig of its own). Until one is chosen
// (settings.rig.vfoB "auto"): the same rig, once it has answered as having a second VFO, else none. What is shown is what is used, and
// nothing is saved until the user picks
function rigVfoBChoice()
{
  const value = GT.settings.rig.vfoB;
  if (value == "none" || value == "same" || value == "second") return value;
  return GT.rig.dual === true ? "same" : "none";
}

// VFO-B is on a rig of its own
function rigSecondUsed()
{
  return GT.settings.rig.enable && rigVfoBChoice() == "second";
}

// VFO-B's Connect: unchecked, no uplink is tuned (and a second rig is let go). Never with VFO-B None, where it can't be checked
function rigUplinkOn()
{
  return GT.settings.rig.connectB !== false && rigVfoBChoice() != "none";
}

// Whether a rig's second VFO's mode is asked: VFO-A's rig, with VFO-B on it (Same as VFO-A) and its Connect checked
function rigModeBWanted(R)
{
  return R.key == "a" && rigVfoBChoice() == "same" && rigUplinkOn();
}

// Whether a rig is to be connected: VFO-A's while Rig Control is on, the second one while VFO-B is on it; each with its Connect checked
function rigWanted(R)
{
  return R.key == "a" ? GT.settings.rig.enable && GT.settings.rig.connect !== false : rigSecondUsed() && rigUplinkOn();
}

// The rig the uplink (TX) is tuned on: the second one, or VFO-A's (its second VFO); null with VFO-B None, or its Connect unchecked
function rigUplink()
{
  if (!rigUplinkOn()) return null;
  const choice = rigVfoBChoice();
  return choice == "second" ? GT.rigB : choice == "same" ? GT.rig : null;
}

// Each VFO's converter offset, in Hz (vfo "a" the downlink, "b" the uplink): the rig's dial is the satellite's frequency plus it. As
// large as a converter's LO can be (an LNB's 9750 MHz is -9750000000), both ways
const RIG_OFFSET_MAX = 1e12;

function rigOffset(vfo)
{
  const value = Number(GT.settings.rig[vfo == "b" ? "offsetB" : "offsetA"]);
  return Number.isFinite(value) && Math.abs(value) <= RIG_OFFSET_MAX ? Math.round(value) : 0;
}

// The LO badge after a frequency with an offset: its tooltip the offset and the rig's own dial; "" without one
function rigLoBadge(offset, dial)
{
  if (!offset) return "";
  const title = I18N("rig.offset.badge.hover").replace("{offset}", (offset > 0 ? "+" : "") + offset.toLocaleString()).replace("{dial}", formatDialFreq(dial));
  return "<span class=\"rigLoBadge\" title=\"" + htmlEntities(title) + "\">LO</span>";
}

// The serial port each rig keeps (serialPorts.js), and its settings' elements: rigProtocol ... for VFO-A's, rigBProtocol ... for the second
function rigPurpose(R)
{
  return R.key == "a" ? "rig" : "rigB";
}

function rigEl(R, name)
{
  return document.getElementById((R.key == "a" ? "rig" : "rigB") + name);
}

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

// The address a rig's frames go to: the one set, else the one the rig answered from, else the broadcast address (00), which every Icom
// answers, from its own
function rigCivAddress(R)
{
  const value = parseInt(String(rigSettingsOf(R).civAddress).trim(), 16);
  if (Number.isFinite(value) && value > 0 && value < 0xff) return value;
  return R.civFound || 0x00;
}

// Each protocol: serial (CI-V) or network (rigctld, flrig); what to send to ask and to set, and how the answers read. R is the rig
//   poll(R):          what asks the frequency and the mode
//   setFreq(hz, R), setMode(mode, R): what sets them (mode as the rig names it: "USB", "FM", ...)
//   parse(line | bytes, R): updates R.freq / R.mode from an answer; a string back is an error
const RIG_PROTOCOLS = {
  rigctld: {
    name: "Hamlib rigctld",
    serial: false,
    // The extended protocol (+): the answers come labeled, "Frequency: 14074000", "Mode: USB", and end with "RPRT 0". The second VFO
    // is the split TX one: its frequency is read (i) and set (I) as the split frequency, with split on (S 1 VFOB)
    caps: () => "+1\n",
    // With VFO-B on this rig, its mode too (x: the split mode, "TX Mode: LSB")
    poll: (R) => "+f\n+m\n" + (R.dual ? "+i\n" : "") + (R.dual && rigModeBWanted(R) ? "+x\n" : ""),
    setFreq: (hz) => "+F " + Math.round(hz) + "\n",
    setMode: (mode) => "+M " + mode + " 0\n",
    setTx: (hz) => "+I " + Math.round(hz) + "\n",
    // The split (TX) VFO's own mode (X): an inverting transponder's uplink is LSB under a USB downlink
    setTxMode: (mode) => "+X " + mode + " 0\n",
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
      else if ((m = /^TX Mode:\s*(\S+)/.exec(line))) R.modeB = m[1];
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
    calls: { freq: "rig.get_vfoA", mode: "rig.get_modeA", freqB: "rig.get_vfoB", modeB: "rig.get_modeB", model: "rig.get_xcvr" },
    setFreq: (hz) => ["rig.set_vfoA", "<double>" + Math.round(hz) + "</double>"],
    setMode: (mode) => ["rig.set_modeA", "<string>" + mode + "</string>"],
    setTx: (hz) => ["rig.set_vfoB", "<double>" + Math.round(hz) + "</double>"],
    setTxMode: (mode) => ["rig.set_modeB", "<string>" + mode + "</string>"],
    splitOn: () => ["rig.set_split", "<int>1</int>"]
  },
  civ: {
    name: "Icom CI-V",
    serial: true,
    binary: true,
    // 19 00 asks the rig its CI-V address (answered with it), once connected
    caps: (R) => rigCivFrame(rigCivAddress(R), 0x19, [0x00]),
    // 03 asks the frequency, 04 the mode; 05 and 06 set them. The other VFO (the TX one, with split on: 0F 01) is read and set
    // without switching to it, with 25 01 (the IC-7300, 7610, 9700 and 705 have it; a rig that answers NG hasn't, and isn't asked again)
    // With VFO-B on this rig, the other VFO's mode too (26 01), unless the rig answered NG to it
    poll: (R) => [rigCivFrame(rigCivAddress(R), 0x03), rigCivFrame(rigCivAddress(R), 0x04)].concat(R.dual === false ? [] : [rigCivFrame(rigCivAddress(R), 0x25, [0x01])])
      .concat(R.dual === true && R.modeBAsk && rigModeBWanted(R) ? [rigCivFrame(rigCivAddress(R), 0x26, [0x01])] : []),
    setFreq: (hz, R) => rigCivFrame(rigCivAddress(R), 0x05, rigCivHzToBcd(hz)),
    setTx: (hz, R) => rigCivFrame(rigCivAddress(R), 0x25, [0x01, ...rigCivHzToBcd(hz)]),
    splitOn: (R) => rigCivFrame(rigCivAddress(R), 0x0f, [0x01]),
    // 26 01: the unselected (TX) VFO's mode, data mode off, filter 1 (the IC-7300, 7610, 9700, 705 have it; an older Icom answers NG)
    setTxMode: (mode, R) =>
    {
      const code = Number(Object.keys(RIG_CIV_MODES).find((key) => RIG_CIV_MODES[key] == String(mode).toUpperCase()));
      return Number.isFinite(code) ? rigCivFrame(rigCivAddress(R), 0x26, [0x01, code, 0x00, 0x01]) : null;
    },
    // 1B 00 sets the repeater tone (00, then the tenths of a hertz as four BCD digits: 67.0 is 00 06 70), 16 42 turns it on (01) or off (00)
    setTone: (hz, R) =>
    {
      if (!(hz > 0)) return [rigCivFrame(rigCivAddress(R), 0x16, [0x42, 0x00])];
      const digits = String(Math.round(hz * 10)).padStart(4, "0");
      const bcd = (i) => (Number(digits[i]) << 4) | Number(digits[i + 1]);
      return [rigCivFrame(rigCivAddress(R), 0x1b, [0x00, bcd(0), bcd(2)]), rigCivFrame(rigCivAddress(R), 0x16, [0x42, 0x01])];
    },
    canTone: () => true,
    setMode: (mode, R) =>
    {
      const code = Number(Object.keys(RIG_CIV_MODES).find((key) => RIG_CIV_MODES[key] == String(mode).toUpperCase()));
      return Number.isFinite(code) ? rigCivFrame(rigCivAddress(R), 0x06, [code]) : null;
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
      else if (command == 0x26 && data.length >= 2 && data[0] == 0x01) R.modeB = RIG_CIV_MODES[data[1]] || ("mode " + data[1]);
      else if (command == 0xfa)
      {
        // NG to 26 01: the rig hasn't it, and isn't asked again
        if (R.lastSent && R.lastSent[4] == 0x26) R.modeBAsk = false;
        // The first NG, before the other VFO ever answered: the rig hasn't the 25 command
        if (R.dual === null) R.dual = false;
        return "NG";
      }
      return null;
    }
  },
  kenwood: rigCatProtocol({
    name: "Kenwood CAT (TS-2000+)",
    // FA / FB: VFO A / B in Hz, 11 digits; MD: the mode, one digit; FR0 FT1: receive on A, transmit on B (split)
    digits: 11,
    modeAsk: "MD;",
    modeReply: /^MD(\d)$/,
    modes: { 1: "LSB", 2: "USB", 3: "CW", 4: "FM", 5: "AM", 6: "RTTY", 7: "CW-R", 9: "RTTY-R" },
    modeSet: (code) => "MD" + code + ";",
    splitOn: () => "FR0;FT1;",
    // ID; answers ID019; for a TS-2000 (an Elecraft, or an SDR program's "TS-2000" port, says what it emulates). As Hamlib has them
    // (rigs/kenwood/kenwood.c, kenwood_id_string_list): 017 is a TS-570D and what the Elecraft K2, K3 and KX3 say, 020 a TS-480 and
    // what some SDR programs say
    models: { "017": "TS-570D", "018": "TS-570S", "019": "TS-2000", "020": "TS-480", "021": "TS-590S", "022": "TS-990S", "023": "TS-590SG", "024": "TS-890S" }
  }),
  yaesu: rigCatProtocol({
    name: "Yaesu CAT (FT-991+)",
    // The newer Yaesus (FT-991, FT-891, FT-710, FTDX10, FTDX101 ...): FA / FB in Hz, 9 digits; MD0: the main receiver's mode, a hex
    // digit (Hamlib's newcat_mode_conv)
    digits: 9,
    modeAsk: "MD0;",
    modeReply: /^MD0([0-9A-F])$/,
    modes: { 1: "LSB", 2: "USB", 3: "CW", 4: "FM", 5: "AM", 6: "RTTY", 7: "CW-R", 8: "PKT-L", 9: "RTTY-R", A: "PKT-FM", B: "FM-N", C: "PKT-U", D: "AM-N", E: "C4FM", F: "PKT-FM-N" },
    modeSet: (code) => "MD0" + code + ";",
    // Split as Hamlib sets it (rigs/yaesu/newcat.c): ST1 on the rigs that have ST; FT3 (TX on VFO B: these count A and B as 2 and 3) on
    // those that don't; the FT-891 has neither, so its second VFO can't take the uplink. A rig not known yet: ST1
    splitOn: (id) => (["0310", "0570", "0670", "0251", "0252", "0583", "0362", "0462"].includes(id) ? "FT3;" : "ST1;"),
    noSplit: ["0135"],
    // ID; answers four digits (Hamlib's nc_rigid_t, its leading zero kept)
    models: { "0241": "FT-450", "0244": "FT-450D", "0310": "FT-950", "0135": "FT-891", "0570": "FT-991", "0670": "FT-991A", "0251": "FT-2000", "0252": "FT-2000D", "0583": "FTDX1200", "0761": "FTDX10", "0362": "FTDX5000", "0462": "FTDX3000", "0681": "FTDX101D", "0682": "FTDX101MP", "0800": "FT-710", "0840": "FTX-1" }
  }),
  // The FT-817, FT-818, FT-857 and FT-897's own CAT, as Hamlib has it (rigs/yaesu/ft817.c): every command five bytes, four of data and
  // the command's. 03 asks the frequency and the mode, answered with five bytes (the frequency as eight BCD digits in tens of hertz, the
  // highest first, then the mode); a setting gets one byte back or none. VFO B is only reached by swapping the VFOs, so the rig is taken
  // as having one VFO: two of them, VFO-A's rig and a second one, are the way to work a satellite. No ID: the protocol names the rig
  yaesu817: {
    name: "Yaesu CAT (FT-817/818/857/897)",
    serial: true,
    binary: true,
    model: "FT-817/818/857/897",
    poll: () => [new Uint8Array([0, 0, 0, 0, 0x03])],
    replies: (data) => data instanceof Uint8Array && data[4] == 0x03,
    // A setting's acknowledgement (or a stray byte) doesn't stay to shift the next answer
    beforeSend: (data, R) => { R.bytes = []; },
    gapMs: 60,
    setFreq: (hz) =>
    {
      const digits = String(Math.max(0, Math.floor(Math.round(hz) / 10))).padStart(8, "0").slice(-8);
      const bcd = (i) => (Number(digits[i]) << 4) | Number(digits[i + 1]);
      return new Uint8Array([bcd(0), bcd(2), bcd(4), bcd(6), 0x01]);
    },
    setTx: () => null,
    splitOn: () => null,
    setMode: (mode) =>
    {
      const code = { LSB: 0x00, USB: 0x01, CW: 0x02, "CW-R": 0x03, AM: 0x04, FM: 0x08 }[String(mode).toUpperCase()];
      return code === undefined ? null : new Uint8Array([code, 0, 0, 0, 0x07]);
    },
    // 0B sets the CTCSS tone (its tenths of a hertz as four BCD digits, written twice), 4A turns the encoder on, 8A turns it off
    setTone: (hz) =>
    {
      if (!(hz > 0)) return [new Uint8Array([0x8a, 0, 0, 0, 0x0a])];
      const digits = String(Math.round(hz * 10)).padStart(4, "0");
      const a = (Number(digits[0]) << 4) | Number(digits[1]);
      const b = (Number(digits[2]) << 4) | Number(digits[3]);
      return [new Uint8Array([a, b, a, b, 0x0b]), new Uint8Array([0x4a, 0, 0, 0, 0x0a])];
    },
    canTone: () => true,
    // The answer to 03 once its five bytes are in (anything else, a setting's acknowledgement, is let go)
    receive: (data, R) =>
    {
      for (const b of data) R.bytes.push(b);
      const asked = R.lastSent instanceof Uint8Array && R.lastSent[4] == 0x03;
      if (!asked)
      {
        R.bytes = [];
        rigReplied(R);
        return;
      }
      if (R.bytes.length < 5) return;
      const reply = R.bytes.slice(0, 5);
      R.bytes = [];
      const nibbles = reply.slice(0, 4).flatMap((x) => [x >> 4, x & 0x0f]);
      if (nibbles.every((n) => n <= 9))
      {
        R.freq = Number(nibbles.join("")) * 10;
        const modes = { 0x00: "LSB", 0x01: "USB", 0x02: "CW", 0x03: "CW-R", 0x04: "AM", 0x06: "WFM", 0x08: "FM", 0x0a: "DIG", 0x0c: "PKT" };
        R.mode = (modes[reply[4] & 0x7f] || "mode " + (reply[4] & 0x7f)) + (reply[4] & 0x80 ? "-N" : "");
        R.dual = false;
      }
      rigReplied(R);
    }
  }
};

// Kenwood's CAT and the newer Yaesus' (which grew from it): text commands that end with ";" over a serial port. A question (two letters
// and the ";", "FA;") is answered ("FA00014074000;"); a setting ("FA00145800000;") isn't, unless it is refused ("?;"). The rig that
// answers FB has a second VFO; one that refuses it hasn't
function rigCatProtocol(cat)
{
  const hz = (value) => String(Math.max(0, Math.round(value))).padStart(cat.digits, "0").slice(-cat.digits);
  const freqReply = new RegExp("^F([AB])(\\d{" + cat.digits + "})$");
  return {
    name: cat.name,
    serial: true,
    split: /;/,
    caps: () => "ID;",
    poll: (R) => ["FA;", cat.modeAsk].concat(R.dual === false ? [] : ["FB;"]),
    replies: (data) => typeof data == "string" && /^[A-Z]{2}\d?;$/.test(data),
    setFreq: (value) => "FA" + hz(value) + ";",
    setTx: (value) => "FB" + hz(value) + ";",
    splitOn: (R) => cat.splitOn(R.catId),
    setMode: (mode) =>
    {
      const code = Object.keys(cat.modes).find((key) => cat.modes[key] == String(mode).toUpperCase());
      return code === undefined ? null : cat.modeSet(code);
    },
    parse: (line, R) =>
    {
      const text = line.trim();
      let m;
      if ((m = freqReply.exec(text)))
      {
        if (m[1] == "A") R.freq = Number(m[2]);
        else
        {
          R.freqB = Number(m[2]);
          // A rig that can't be split over CAT (the FT-891) reads its second VFO, but it can't take the uplink
          R.dual = !(cat.noSplit || []).includes(R.catId);
        }
      }
      else if ((m = cat.modeReply.exec(text))) R.mode = cat.modes[m[1]] || ("mode " + m[1]);
      else if ((m = /^ID(\d+)$/.exec(text)))
      {
        R.catId = m[1];
        R.model = cat.models[m[1]] || "ID " + m[1];
        if ((cat.noSplit || []).includes(R.catId)) R.dual = false;
      }
      else if (text == "?")
      {
        // Refused: the second VFO's question, before it was ever answered, means the rig hasn't one
        if (R.lastSent == "FB;" && R.dual === null) R.dual = false;
        return "?";
      }
      return null;
    }
  };
}

function rigProtocolChosen(R = GT.rig)
{
  return RIG_PROTOCOLS[rigSettingsOf(R).protocol] || RIG_PROTOCOLS.rigctld;
}

// ---- Settings (Features -> Service): VFO-A's rig, then VFO-B (Same Rig or Second Rig) and the second rig's rows under it

function rigSettingsRender()
{
  const S = GT.settings.rig;
  rigEnable.checked = S.enable;
  rigConnectValue.checked = S.connect !== false;
  rigVfoB.value = rigVfoBChoice();
  // VFO-A's box and VFO-B's (their titles VFO-A (Downlink), VFO-B (Uplink))
  rigVfoABoxTr.style.display = S.enable ? "" : "none";
  rigVfoBBoxTr.style.display = S.enable ? "" : "none";
  rigSecondTr.style.display = rigSecondUsed() ? "" : "none";
  rigOffsetATr.style.display = S.enable ? "" : "none";
  rigOffsetBTr.style.display = S.enable && rigVfoBChoice() != "none" ? "" : "none";
  rigOffsetA.value = String(rigOffset("a"));
  rigOffsetB.value = String(rigOffset("b"));
  // Connected (each box's Connect checked), its settings can't be changed: nothing half set goes live to a rig
  rigBConnectValue.checked = rigUplinkOn();
  const locked = S.connect !== false;
  const lockedB = rigUplinkOn();
  rigLockField(rigOffsetA, locked);
  for (const el of [rigVfoB, rigOffsetB]) rigLockField(el, lockedB);
  // VFO-B None: nothing to connect
  rigLockField(rigBConnectValue, rigVfoBChoice() == "none");
  rigSettingsRenderOne(GT.rig, S.enable, locked);
  rigSettingsRenderOne(GT.rigB, rigSecondUsed(), lockedB);
}

// A setting's field greyed and left alone (locked), or not
function rigLockField(el, locked)
{
  el.disabled = locked;
  el.classList.toggle("rigLocked", locked);
}

// One rig's rows: shown (on) or not, their fields locked or not
function rigSettingsRenderOne(R, on, locked = false)
{
  for (const name of ["Protocol", "Choose", "Baud", "DataBits", "Parity", "StopBits", "CivValue", "Host", "NetPort"]) rigLockField(rigEl(R, name), locked);
  const S = rigSettingsOf(R);
  const protocolSelect = rigEl(R, "Protocol");
  const baudSelect = rigEl(R, "Baud");
  if (!protocolSelect.options.length)
  {
    for (const [key, protocol] of Object.entries(RIG_PROTOCOLS))
    {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = protocol.name;
      protocolSelect.appendChild(option);
    }
    for (const baud of RIG_BAUDS)
    {
      const option = document.createElement("option");
      option.value = String(baud);
      option.textContent = String(baud);
      baudSelect.appendChild(option);
    }
  }
  protocolSelect.value = S.protocol in RIG_PROTOCOLS ? S.protocol : "rigctld";
  baudSelect.value = RIG_BAUDS.includes(Number(S.baud)) ? String(S.baud) : "19200";
  rigEl(R, "DataBits").value = Number(S.dataBits) == 7 ? "7" : "8";
  rigEl(R, "Parity").value = ["none", "even", "odd"].includes(S.parity) ? S.parity : "none";
  rigEl(R, "StopBits").value = Number(S.stopBits) == 2 ? "2" : "1";
  rigEl(R, "CivValue").value = S.civAddress;
  rigEl(R, "CivValue").placeholder = I18N("rig.civ.auto");
  rigEl(R, "Host").value = S.host;
  const protocol = rigProtocolChosen(R);
  rigEl(R, "NetPort").value = protocol.http ? S.flrigPort : S.netPort;
  const portName = rigEl(R, "PortName");
  portName.textContent = S.port ? serialPortShortName(S.port) + (serialPortModel(S.port) ? "  —  " + serialPortModel(S.port) : "") : I18N("settings.rotor.none.label");
  portName.title = S.port ? S.port.displayName || "" : "";
  const serial = protocol.serial;
  // Kenwood CAT and Yaesu CAT name one rig each; the others that speak them are said under the protocol
  const note = { kenwood: "settings.rig.kenwood.note", yaesu: "settings.rig.yaesu.note", yaesu817: "settings.rig.yaesu817.note" }[S.protocol];
  // A model's name (TS-990, FTX-1) isn't broken at its hyphen
  rigEl(R, "ProtocolNote").innerHTML = note ? htmlEntities(I18N(note)).replace(/([A-Za-z#]+-[A-Za-z0-9]+)/g, "<span style='white-space:nowrap'>$1</span>") : "";
  const rows = { ProtocolTr: on, ProtocolNoteTr: on && !!note, PortTr: on && serial, BaudTr: on && serial, CivTr: on && S.protocol == "civ", HostTr: on && !serial, StatusTr: on };
  for (const [name, shown] of Object.entries(rows)) rigEl(R, name).style.display = shown ? "" : "none";
  serialLinuxRender(rigEl(R, "LinuxTr"), rigEl(R, "LinuxText"), S.port, on && serial);
  rigStatusRender(R);
}

function rigEnableChanged()
{
  GT.settings.rig.enable = rigEnable.checked;
  rigSettingsRender();
  rigConnect(GT.rig);
  rigConnect(GT.rigB);
}

// A box's Connect unchecked: its rig let go (VFO-B's: no uplink tuned), its settings free to change; checked: locked, and connected
// with them (key: "a" VFO-A's box, "b" VFO-B's)
function rigConnectChanged(key = "a")
{
  if (key == "b")
  {
    GT.settings.rig.connectB = rigBConnectValue.checked;
    // The uplink followed is sent again once it is on
    if (GT.rigDoppler) GT.rigDoppler.sentTx = null;
  }
  else GT.settings.rig.connect = rigConnectValue.checked;
  rigSettingsRender();
  rigConnect(key == "b" ? GT.rigB : GT.rig);
}

// VFO-B on the same rig, a second one, or none: the second rig connected, or let go
function rigVfoBChanged()
{
  GT.settings.rig.vfoB = ["none", "same", "second"].includes(rigVfoB.value) ? rigVfoB.value : "none";
  // VFO-B's Connect stays unchecked after a choice (None can't connect; another one goes live only once Connect is checked)
  GT.settings.rig.connectB = false;
  rigSettingsRender();
  rigConnect(GT.rigB);
}

// Offset Hz takes digits and a minus sign
function rigOffsetKey(event)
{
  return event.charCode == 0 || /[0-9-]/.test(String.fromCharCode(event.charCode));
}

// An offset changed: kept when it is a whole number of hertz within the limit (otherwise the one before stays), and the frequencies
// followed sent again with it
function rigOffsetChanged()
{
  for (const [input, key] of [[rigOffsetA, "offsetA"], [rigOffsetB, "offsetB"]])
  {
    const text = input.value.replace(/[\s,._]/g, "");
    const value = /^-?\d+$/.test(text) ? Number(text) : NaN;
    if (Number.isFinite(value) && Math.abs(value) <= RIG_OFFSET_MAX) GT.settings.rig[key] = value;
  }
  if (GT.rigDoppler) GT.rigDoppler.sentRx = GT.rigDoppler.sentTx = null;
  rigSettingsRender();
}

// A rig's protocol, port settings, address or host changed: connected again with them (key: "a" VFO-A's rig, "b" the second)
function rigSettingsChanged(key = "a")
{
  const R = key == "b" ? GT.rigB : GT.rig;
  const S = rigSettingsOf(R);
  const protocolSelect = rigEl(R, "Protocol");
  // Another protocol: the port field still shows the old one's port, so it isn't read; the render below fills it with the new one's
  const sameProtocol = S.protocol == protocolSelect.value;
  S.protocol = protocolSelect.value;
  S.baud = Number(rigEl(R, "Baud").value);
  S.dataBits = Number(rigEl(R, "DataBits").value);
  S.parity = rigEl(R, "Parity").value;
  S.stopBits = Number(rigEl(R, "StopBits").value);
  S.civAddress = rigEl(R, "CivValue").value.trim().toUpperCase();
  S.host = rigEl(R, "Host").value.trim();
  if (sameProtocol)
  {
    if (rigProtocolChosen(R).http) S.flrigPort = Number(rigEl(R, "NetPort").value) || 12345;
    else S.netPort = Number(rigEl(R, "NetPort").value) || 4532;
  }
  rigSettingsRender();
  rigConnect(R);
}

function rigChoosePort(key = "a")
{
  const R = key == "b" ? GT.rigB : GT.rig;
  serialPortChoose(rigPurpose(R), (port) =>
  {
    rigSettingsOf(R).port = port;
    rigSettingsRender();
    rigConnect(R);
  });
}

// A rig's name: as rigctld or flrig said it; a serial rig's from its port's device id (IC-7300_...), else the Icom its address
// is the default of; "" when none is known
function rigModelName(R = GT.rig)
{
  if (R.model) return R.model;
  if (rigProtocolChosen(R).serial) return serialPortModel(rigSettingsOf(R).port) || (R.civFound && RIG_CIV_MODELS[R.civFound]) || "";
  return "";
}

// "14.074.000 (435.250.000) MHz USB (LSB)": VFO A, the second VFO in brackets when the rig has one (and VFO-B is on it), the modes. The
// satellite's frequencies: a VFO with an offset is the rig's dial less it, "LO" after it
function rigFrequencyText(R)
{
  if (R.freq === null) return "";
  const one = (dial, vfo) => formatDialFreq(dial - rigOffset(vfo)) + (rigOffset(vfo) ? " LO" : "");
  const showB = R.key == "a" && rigVfoBChoice() == "same" && rigUplinkOn() && R.dual && R.freqB !== null;
  return one(R.freq, R.key == "a" ? "a" : "b") + (showB ? " (" + one(R.freqB, "b") + ")" : "") + " MHz" + (R.mode ? " " + R.mode : "") + (showB && R.modeB ? " (" + R.modeB + ")" : "");
}

// A rig's status, in short: "Error", "No Port Chosen", ...
function rigStatusShort(R)
{
  return R.status == "error" ? I18N("rotor.status.errorShort") : I18N("rotor.status." + R.status).replace("{0}", R.error);
}

// The rig's box in the BirdWatch panel (a box like the sky plot's, its border yellow): the downlink on one line, the uplink in brackets
// (the second VFO's, or the second rig's), "Rig: 145.800.000 (435.250.000)", the modes on the next, "Mode: USB (LSB)" (the uplink's in
// brackets: the second rig's, or the second VFO's where the rig says it); a rig's status instead of its frequency while it isn't connected. The satellite's frequencies: a VFO with an offset shows
// the rig's dial less it, with the LO badge (its tooltip the offset and the dial). There while Rig Control is on
function rigLineRender()
{
  if (typeof birdWatchRigLine == "undefined") return;
  const A = GT.rig;
  const B = GT.rigB;
  const on = GT.settings.rig.enable;
  const second = rigSecondUsed();
  const label = (key) => "<span style='color:white'>" + I18N(key) + ":</span> ";
  const orange = (text) => "<span style='color:orange'>" + htmlEntities(text) + "</span>";
  const freq = (dial, vfo, color) => "<span style='color:" + color + "'>" + formatDialFreq(dial - rigOffset(vfo)) + rigLoBadge(rigOffset(vfo), dial) + "</span>";
  const aUp = A.status == "connected" && A.freq !== null;
  const bUp = B.status == "connected" && B.freq !== null;
  // The uplink goes onto a line of its own when both don't fit (GHz frequencies with LO badges); each part kept whole
  const part = (inner) => "<span style='white-space:nowrap'>" + inner + "</span>";
  let html = "<div style='white-space:normal'>" + part(label("rig.line.rig") + (aUp ? freq(A.freq, "a", "yellow") : orange(rigStatusShort(A))));
  // VFO-B on this rig's second VFO: its frequency, and its mode where the rig says it ("-" where it can't: Kenwood, Yaesu CAT)
  const sameB = !second && rigVfoBChoice() == "same" && rigUplinkOn() && aUp && A.dual && A.freqB !== null;
  if (second) html += " " + part("(" + (bUp ? freq(B.freq, "b", "#ffd27f") : orange(rigStatusShort(B))) + ")");
  else if (sameB) html += " " + part("(" + freq(A.freqB, "b", "#ffd27f") + ")");
  html += "</div>";
  if (aUp || bUp)
  {
    const modeB = second ? (bUp && B.mode) || "-" : sameB ? A.modeB || "-" : null;
    html += "<div>" + label("rig.line.mode") + "<span style='color:lightgreen'>" + htmlEntities((aUp && A.mode) || "-") + "</span>" +
      (modeB !== null ? " (<span style='color:lightgreen'>" + htmlEntities(modeB) + "</span>)" : "") + "</div>";
  }
  birdWatchRigLine.style.display = on ? "" : "none";
  if (on && birdWatchRigLine.innerHTML != html) birdWatchRigLine.innerHTML = html;
}

function rigStatusRender(R = GT.rig)
{
  const statusEl = rigEl(R, "Status");
  if (!statusEl) return;
  let text = I18N("rotor.status." + R.status).replace("{0}", R.error);
  // A rig with a second VFO that can be read and set is said so
  if (R.status == "connected" && R.dual) text += " (" + I18N("rig.twoVfos") + ")";
  if (R.status == "connected" && rigModelName(R)) text += "  " + rigModelName(R);
  if (R.status == "connected" && R.freq !== null) text += "  " + rigFrequencyText(R);
  // A serial port that couldn't be opened is said in full under Choose Port, with the way to share the rig; Status says it in short
  const portError = rigProtocolChosen(R).serial && (R.status == "error" || R.status == "notFound");
  const portErrorEl = rigEl(R, "PortError");
  portErrorEl.style.display = portError ? "" : "none";
  portErrorEl.textContent = portError ? (R.status == "error" ? I18N("serial.inUse").replace("{0}", serialPortShortName(rigSettingsOf(R).port)) + "\n" + R.error : text) : "";
  if (portError) text = I18N("rotor.status.errorShort");
  statusEl.textContent = text;
  statusEl.style.color = { connected: "lightgreen", connecting: "yellow", error: "#ff8080", noPort: "orange", notFound: "orange" }[R.status] || "#ccc";
  if (typeof birdWatchSatRigAvailable == "function") birdWatchSatRigAvailable();
  // VFO-B not chosen yet follows whether VFO-A's rig has a second VFO, which is known once it has answered
  if (R.key == "a" && typeof rigVfoB != "undefined" && rigVfoB.value != rigVfoBChoice()) rigSettingsRender();
  // The CI-V address the rig answered from, beside the field
  rigEl(R, "CivFound").textContent = R.civFound && R.status == "connected" ? I18N("rig.civ.found").replace("{0}", R.civFound.toString(16).toUpperCase().padStart(2, "0")) + (RIG_CIV_MODELS[R.civFound] ? "  ·  " + RIG_CIV_MODELS[R.civFound] : "") : "";
  rigLineRender();
}

function rigSetStatus(R, status, error = "")
{
  R.status = status;
  R.error = error;
  rigStatusRender(R);
}

function rigInit()
{
  serialPortTell("rig", GT.settings.rig.port);
  serialPortTell("rigB", GT.settings.rig.second.port);
  rigSettingsRender();
  rigConnect(GT.rig);
  rigConnect(GT.rigB);
}

// ---- The link (each rig its own)

// The link let go; what it returns is settled once it is (a serial port takes a moment)
function rigDisconnect(R)
{
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
  R.lastSent = null;
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

async function rigConnect(R)
{
  const closing = rigDisconnect(R);
  R.freq = R.mode = R.freqB = R.modeB = null;
  R.modeBAsk = true;
  R.dual = null;
  R.split = false;
  R.civFound = null;
  R.model = null;
  R.catId = null;
  R.toneFreq = R.toneFunc = null;
  R.toneOn = false;
  R.ranges = R.rangeSection = null;
  if (!rigWanted(R))
  {
    rigSetStatus(R, "off");
    return;
  }
  R.protocol = rigProtocolChosen(R);
  const generation = R.generation;
  rigSetStatus(R, "connecting");
  await closing;
  if (generation != R.generation) return;
  const open = R.protocol.serial ? rigOpenSerial(R, generation) : R.protocol.http ? rigOpenHttp(R, generation) : rigOpenNet(R, generation);
  open.catch((e) =>
  {
    if (generation == R.generation) rigFail(R, e && e.message ? e.message : String(e));
  });
}

// Lost, or never got there: tried again in a while, as long as the rig is wanted
function rigFail(R, message)
{
  rigDisconnect(R);
  rigSetStatus(R, "error", message);
  R.retryTimer = nodeTimers.setTimeout(() => rigConnect(R), RIG_RETRY_MS);
}

async function rigOpenSerial(R, generation)
{
  const S = rigSettingsOf(R);
  if (!S.port)
  {
    rigSetStatus(R, "noPort");
    return;
  }
  const port = await serialPortFor(rigPurpose(R));
  if (generation != R.generation) return;
  if (!port)
  {
    rigSetStatus(R, "notFound", serialPortShortName(S.port));
    R.retryTimer = nodeTimers.setTimeout(() => rigConnect(R), RIG_RETRY_MS);
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
    if (generation == R.generation) rigFail(R, "disconnected");
  });
  rigReadSerial(R, port, generation);
  rigConnected(R);
}

async function rigReadSerial(R, port, generation)
{
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
        rigReceive(R, value);
      }
    }
    catch (e)
    {
      if (generation == R.generation) rigFail(R, e.message);
      return;
    }
    finally
    {
      reader.releaseLock();
    }
  }
}

function rigOpenNet(R, generation)
{
  const S = rigSettingsOf(R);
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
      rigConnected(R);
      resolve();
    });
    socket.on("data", (data) => { if (generation == R.generation) rigReceive(R, data); });
    socket.on("error", (e) => { if (generation == R.generation) rigFail(R, e.message); reject(e); });
    socket.on("close", () => { if (generation == R.generation && R.link === socket) rigFail(R, "closed"); });
    socket.connect(Number(S.netPort) || 4532, S.host || "127.0.0.1");
  });
}

// flrig: no link to keep; connected once it has answered, polled by requests
function rigOpenHttp(R, generation)
{
  R.link = { http: true };
  R.pollTimer = nodeTimers.setInterval(() => rigHttpPoll(R, generation), RIG_POLL_MS);
  rigHttpPoll(R, generation);
  return Promise.resolve();
}

// One XML-RPC call to a rig's flrig: the string (or number) in its answer
function rigHttpCall(R, method, paramsXml = "")
{
  const S = rigSettingsOf(R);
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

async function rigHttpPoll(R, generation)
{
  if (R.busy) return;
  R.busy = true;
  try
  {
    if (R.model === null)
    {
      try { R.model = await rigHttpCall(R, R.protocol.calls.model); } catch (e) { R.model = ""; }
    }
    const freq = await rigHttpCall(R, R.protocol.calls.freq);
    const mode = await rigHttpCall(R, R.protocol.calls.mode);
    let freqB = null;
    let modeB = null;
    if (R.dual !== false)
    {
      try { freqB = Number(await rigHttpCall(R, R.protocol.calls.freqB)) || null; } catch (e) { freqB = null; }
      if (freqB !== null && rigModeBWanted(R))
      {
        try { modeB = (await rigHttpCall(R, R.protocol.calls.modeB)) || null; } catch (e) { modeB = null; }
      }
    }
    if (generation != R.generation) return;
    R.freq = Number(freq) || null;
    R.mode = mode || null;
    if (R.dual !== false)
    {
      R.dual = freqB !== null;
      R.freqB = freqB;
      R.modeB = modeB;
    }
    if (R.status != "connected") rigSetStatus(R, "connected");
    else rigStatusRender(R);
  }
  catch (e)
  {
    if (generation == R.generation) rigFail(R, e.message);
  }
  finally
  {
    R.busy = false;
  }
}

function rigConnected(R)
{
  // A rig that can't say what it is: the protocol names it (the FT-817's)
  if (R.protocol.model) R.model = R.protocol.model;
  rigSetStatus(R, "connected");
  if (R.protocol.caps) rigWrite(R, R.protocol.caps(R));
  rigPoll(R);
  R.pollTimer = nodeTimers.setInterval(() => rigPoll(R), RIG_POLL_MS);
}

function rigPoll(R)
{
  const asks = R.protocol.poll(R);
  for (const ask of Array.isArray(asks) ? asks : [asks]) rigWrite(R, ask);
}

function rigWrite(R, data)
{
  if (!R.link || data === null) return;
  // A serial rig takes one command at a time: queued, sent as the one before is answered (a backlog, when it doesn't answer, is capped)
  if (R.writer)
  {
    if (R.queue.length >= RIG_QUEUE_MAX) R.queue.shift();
    R.queue.push(data);
    rigDrain(R);
    return;
  }
  try
  {
    R.link.write(data);
  }
  catch (e)
  {
    rigFail(R, e.message);
  }
}

// The next queued frame out, once nothing is awaited; the next after it on the rig's reply (rigReplied) or, failing that, in a moment.
// A command the rig doesn't answer (a Kenwood or Yaesu setting: the protocol's replies) only gets a short gap before the next
function rigDrain(R)
{
  if (R.waiting || !R.writer || R.queue.length == 0) return;
  const data = R.queue.shift();
  R.lastSent = data;
  if (R.protocol.beforeSend) R.protocol.beforeSend(data, R);
  const answered = !R.protocol.replies || R.protocol.replies(data);
  R.waiting = nodeTimers.setTimeout(() =>
  {
    R.waiting = null;
    rigDrain(R);
  }, answered ? RIG_REPLY_MS : R.protocol.gapMs || RIG_GAP_MS);
  R.writer.write(typeof data == "string" ? new TextEncoder().encode(data) : data).catch((e) => rigFail(R, e.message));
}

function rigReplied(R)
{
  if (!R.waiting) return;
  nodeTimers.clearTimeout(R.waiting);
  R.waiting = null;
  rigDrain(R);
}

// Bytes or text in: lines (rigctld) or CI-V frames to the protocol; what was read is shown
function rigReceive(R, data)
{
  // A protocol that reads its own answers (the FT-817's: five bytes, unframed)
  if (R.protocol.receive)
  {
    R.protocol.receive(data, R);
    rigStatusRender(R);
    return;
  }
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
      if (frame[3] != 0xe0) rigReplied(R);
    }
    rigStatusRender(R);
    return;
  }
  // Lines (rigctld), or answers that end with ";" (Kenwood, Yaesu: each one lets the next command go)
  R.pending += typeof data == "string" ? data : new TextDecoder().decode(data);
  const lines = R.pending.split(R.protocol.split || /\r\n|\r|\n/);
  R.pending = lines.pop();
  for (const line of lines)
  {
    if (line.trim() == "") continue;
    const problem = R.protocol.parse(line, R);
    if (problem) R.error = problem;
    if (R.protocol.split) rigReplied(R);
  }
  rigStatusRender(R);
}

// ---- Tuning: for BirdWatch's Doppler only. The rosters (the Feed Roster's spots too) tune through WSJT-X and the loggers as before, never
// through Rig Control

// The rigs set to what is given of { rx, mode, tx, txMode, tone }, rx and tx the satellite's frequencies (each VFO's offset is added
// to what is sent: rigOffset): rx (Hz) and mode ("USB", "FM", ...) on VFO-A's rig; tx (Hz) on the
// uplink: the second rig's VFO A, or VFO-A's rig's second VFO with split on (only a rig that has one: rigTuneCanTx); txMode the uplink's
// mode: the second rig's, or the same rig's TX VFO's where its protocol can set that (setTxMode: rigctld, flrig, CI-V); tone (Hz) the
// uplink rig's CTCSS tone turned on (0: turned off, if it was turned on
// here; only a rig that can: rigTuneCanTone). True when something was sent
function rigTune(spec)
{
  if (typeof spec != "object" || spec === null) return false;
  const A = GT.rig;
  const B = GT.rigB;
  const second = rigSecondUsed();
  const aUp = A.status == "connected" && !!A.protocol;
  const bUp = second && B.status == "connected" && !!B.protocol;
  const stepsA = [];
  const stepsB = [];
  // The rig's dials: the satellite's frequencies plus each VFO's offset (none below 1 Hz is sent)
  const rxDial = spec.rx > 0 ? spec.rx + rigOffset("a") : 0;
  const txDial = spec.tx > 0 ? spec.tx + rigOffset("b") : 0;
  if (aUp && rxDial > 0) stepsA.push(A.protocol.setFreq(rxDial, A));
  if (aUp && spec.mode) stepsA.push(A.protocol.setMode(spec.mode, A));
  if (txDial > 0 && rigTuneCanTx())
  {
    if (second) stepsB.push(B.protocol.setFreq(txDial, B));
    else
    {
      if (!A.split)
      {
        stepsA.push(A.protocol.splitOn(A));
        A.split = true;
      }
      stepsA.push(A.protocol.setTx(txDial, A));
    }
  }
  // The uplink's mode: the second rig's own, or (the same rig) its TX VFO's where the protocol can set it (rigctld, flrig, CI-V)
  if (bUp && spec.txMode) stepsB.push(B.protocol.setMode(spec.txMode, B));
  else if (!second && aUp && spec.txMode && rigTuneCanTx() && A.protocol.setTxMode)
  {
    if (!A.split)
    {
      stepsA.push(A.protocol.splitOn(A));
      A.split = true;
    }
    stepsA.push(A.protocol.setTxMode(spec.txMode, A));
  }
  if (spec.tone !== undefined && spec.tone !== null && rigTuneCanTone())
  {
    const U = rigUplink();
    if (spec.tone > 0 || U.toneOn)
    {
      const tone = U.protocol.setTone(spec.tone, U);
      (U === A ? stepsA : stepsB).push(...(Array.isArray(tone) ? tone : [tone]));
      U.toneOn = spec.tone > 0;
    }
  }
  const sentA = rigSend(A, stepsA);
  const sentB = rigSend(B, stepsB);
  return sentA || sentB;
}

// A rig's steps out: flrig's calls one after another, the others written (serial: queued); true when there were any
function rigSend(R, steps)
{
  const sent = steps.filter((step) => step !== null && step !== undefined);
  if (sent.length == 0) return false;
  if (R.protocol.http)
  {
    let chain = Promise.resolve();
    for (const [method, params] of sent) chain = chain.then(() => rigHttpCall(R, method, params));
    chain.catch((e) => rigFail(R, e.message));
    return true;
  }
  for (const step of sent) rigWrite(R, step);
  return true;
}

// Whether the uplink (TX) can be tuned: VFO-B on the second rig and it is connected, or on VFO-A's rig and it has a second VFO that
// answers; never with VFO-B None, or its Connect unchecked
function rigTuneCanTx()
{
  if (!rigUplinkOn()) return false;
  const choice = rigVfoBChoice();
  if (choice == "second") return GT.rigB.status == "connected";
  if (choice == "same") return GT.rig.status == "connected" && GT.rig.dual === true;
  return false;
}

// Whether a CTCSS tone can be set on the uplink rig: a CI-V rig, or one rigctld says can (flrig has no call for it); none with VFO-B None
function rigTuneCanTone()
{
  const U = rigUplink();
  return !!U && U.status == "connected" && !!U.protocol && typeof U.protocol.setTone == "function" && U.protocol.canTone(U);
}
