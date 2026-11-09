// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// Rig Control (Settings -> Features -> Service): each VFO's frequency and mode, read every second and set on request (rigTune), through
// Hamlib's rigctld (TCP), flrig (XML-RPC over HTTP), SPY Server by Airspy and SDR++ Server (TCP, rigSpy.js and rigSdrpp.js: an SDR, its
// I/Q for the Multi-Mode Decoder too, rigIq.js), SDR++'s Rigctl Server (plain rigctl, rigSdrpp.js),
// or on a serial port (serialPorts.js: Node's serialport, else Web Serial) an Icom over CI-V, a Kenwood or a newer Yaesu over their CAT (rigCatProtocol). WSJT-X usually
// holds the rig's serial port: a port that can't be opened says so under Choose Port, with the way to share the rig (rigctld or flrig).
// The VFOs (settings.Rigs.vfos, VFO-A, VFO-B ... by their place in the list): each one a rig of its own with its own link, or the second
// VFO (VFO B, or Sub) of one of those. The features each pick theirs: BirdWatch its downlink's and uplink's (rigRoleVfo), the Multi-Mode
// Decoder one for each mode

function rigNewState(key)
{
  return {
    key: key,           // the id of the VFO this is the rig of (settings.Rigs.vfos)
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
    civMode: null,      // CI-V: the mode as 04 says it, without its data mode (mode is it with "-D" while data mode is on: rigCivModeShow)
    dataMode: null,     // CI-V: whether data mode is on (1A 06; null until it has answered)
    dataAsk: true,      // CI-V: false once the rig answered NG to 1A 06 (it hasn't it), so it isn't asked again
    dual: null,         // whether the rig has a second VFO that can be read and set: known once it has answered (null until then)
    mainSub: false,     // rigctld: the backend names its VFOs Main and Sub (its VFO list), not VFOA and VFOB
    vfoMode: null,      // rigctld: runs in VFO mode (--vfo: every command names its VFO); null until it has said (rigNetChkVfo)
    answerB: false,     // rigctld in VFO mode: the answer coming is VFO-B's on this rig (its second VFO)
    vfoWarned: false,   // rigctld: told on this connection that VFO-B needs VFO mode (rigNetVfoWarn)
    vfoOptPending: false, // rigctld: Force VFO Mode's \set_vfo_opt asked, its answer not in yet (rigNetChkVfo)
    split: false,       // split (TX on the second VFO) has been asked of the rig
    civFound: null,     // CI-V: the address the rig answered from (asked with 19 00 at the address used, or the known ones in turn: rigCivProbe)
    civProbe: 0,        // CI-V: the next known address rigCivProbe asks
    model: null,        // the rig's name, as rigctld or flrig say it, or the Icom its CI-V address is the default of
    toneFreq: null,     // rigctld: whether it can set the rig's CTCSS tone, and turn it on (its capabilities: Can set CTCSS Tone, Set functions TONE)
    toneFunc: null,
    toneOn: false,      // a CTCSS tone was turned on here (and is turned off again when a transmitter without one is set)
    ranges: null,       // rigctld: the RX and TX ranges its capabilities list, in Hz ({ rx: [[low, high], ...], tx: [...] }; rigRanges.js)
    rangeSection: null, // rigctld: the capabilities' ranges being read ("rx", "tx"), while their lines come
    pollTimer: null,
    retryTimer: null,
    openTries: 0,       // serial: the opens tried again since it was last asked to connect (rigSerialRetry)
    connectedAt: 0,     // when its link opened (a rig that hasn't answered since a while after: rigNoAnswer)
    freqAt: 0,          // when the rig last said its frequency (rigFreqSaid; quiet since a while: rigNoAnswer); 0 where it says it only as it changes
    generation: 0,      // a connect under way is the newest one; an older one that finishes is ignored
    pending: "",        // text received that isn't a whole line yet
    bytes: [],          // CI-V bytes that aren't a whole frame yet
    busy: false,        // flrig: a request is out
    queue: [],          // serial: the frames to send, one at a time (an Icom answers only the last of a burst)
    lastSent: null,     // serial: the frame out last (a Kenwood or Yaesu "?;" refuses it)
    catId: null,        // Kenwood, Yaesu: what the rig answered to ID; ("019", "0570")
    civFilter: null,    // CI-V: the filter in use, FIL1 to FIL3 (1 to 3), as the mode's answer tells it; a mode set keeps it (setMode)
    civFilterB: null,   // CI-V: the same for the other VFO (26 01's answer; setTxMode)
    cwPitch: null,      // CI-V: the CW pitch in Hz (14 09), when an answer tells it (nothing asks it now)
    tuningStep: null,   // the rig's tuning step in Hz, when an answer tells it (CI-V 10, rigctld n; nothing asks it now)
    scope: null,        // CI-V: its band scope as read (rigScopeState), with Use Scope If Present
    waiting: null,      // serial: the timer for the reply to the frame out, after which the next goes anyway
    closing: null,      // serial: its port's close under way (rigDisconnect), waited for by the next connect
    pttKeyed: null,     // PTT: how rigPtt keyed it, { method ("cat", "dtr", "rts"), vfo (the VFO's id, or null: rigDisconnect), generation (the connection) }, until unkeyed
    pttData: null,      // serial: the PTT command queued last, never the one the queue's cap lets go (rigWrite)
    tuneSeq: 0,         // how many times settings were sent (rigSend); never reset
    readSeq: 0,         // the tuneSeq the last whole poll was asked after: what was read reflects the settings up to it
    readCount: 0,       // how many whole polls have been read (a later read is a higher count); never reset
    netAnswers: [],     // rigctld: the answers still to come, in order, each { count: its RPRT lines, seq: a poll's tuneSeq, or null }
    plainQueue: [],     // SDR++ (rigctl): the answers still to come, in order, each { kind: "freq", "mode", "width", "rprt", or "done" and a poll's seq }
    httpChain: Promise.resolve() // flrig: the calls one after another (the polls and the settings), so a poll reads what was set before it
  };
}

// Each rig's state, by the id of its VFO: one for each VFO that is a rig of its own (rigLinksSync)
GT.rigs = {};

const RIG_REPLY_MS = 250;
const RIG_GAP_MS = 30;
const RIG_QUEUE_MAX = 12;

const RIG_POLL_MS = 1000;
const RIG_RETRY_MS = 10000;
const RIG_BAUDS = [4800, 9600, 19200, 38400, 57600, 115200];
// The Icoms by the CI-V address each comes with (an address can be changed in the rig: the name from the port's device id wins, below)
const RIG_CIV_MODELS = { 0x94: "IC-7300", 0xa2: "IC-9700", 0xa4: "IC-705", 0x88: "IC-7100", 0x98: "IC-7610", 0x7a: "IC-7600", 0x74: "IC-7700", 0x6a: "IC-7800", 0x8e: "IC-7851", 0x7c: "IC-9100", 0x70: "IC-7000", 0x76: "IC-7200", 0x80: "IC-7410", 0x5e: "IC-718", 0x58: "IC-706MKIIG", 0x60: "IC-910H", 0x66: "IC-746PRO", 0x6e: "IC-756PROIII", 0x64: "IC-756PROII", 0x5c: "IC-756PRO", 0x50: "IC-756", 0x96: "IC-R8600", 0xac: "IC-905" };
// The CI-V tuning step codes (command 10), in Hz
const RIG_CIV_STEPS = { 0: 10, 1: 100, 2: 500, 3: 1000, 4: 5000, 5: 6250, 6: 8330, 7: 9000, 8: 10000, 9: 12500, 10: 20000, 11: 25000, 12: 50000, 13: 100000 };
const RIG_CIV_MODES = { 0x00: "LSB", 0x01: "USB", 0x02: "AM", 0x03: "CW", 0x04: "RTTY", 0x05: "FM", 0x06: "WFM", 0x07: "CW-R", 0x08: "RTTY-R", 0x17: "DV" };

// ---- The VFOs: each { id, name, connect, offset, source, of, and its rig's link: protocol, host, netPort, flrigPort, spyPort, sdrppPort
// (and sdrppFreq: where an SDR++ Server was last tuned), port, baud, dataBits, parity, stopBits, dtr, rts (its lines: RIG_LINE_LEVELS),
// civAddress, forceVfo }. source "own": a rig of its own, its link as set; "of": the second VFO of the VFO of (one that
// is a rig of its own, and has no other second VFO), its link that one's. A VFO with its Connect unchecked is let go (its settings free
// to change)

const RIG_LINK_DEFAULTS = { protocol: "rigctld", host: "127.0.0.1", netPort: 4532, flrigPort: 12345, spyPort: 5555, sdrppPort: 5259, flexPort: 4992, icomLanPort: 50001, lanUser: "", lanPassword: "", lanRate: 16000, port: null, baud: 19200, dataBits: 8, parity: "none", stopBits: 1, dtr: "low", rts: "low", civAddress: "", forceVfo: false, ptt: "cat", useScope: false };
// PTT Method (each rig's box): how the Multi-Mode Decoder keys the rig to transmit. none: it isn't keyed; cat: the protocol's PTT
// command; vox: the rig's own VOX, from the audio; dtr, rts: the serial port's line (a serial rig only)
const RIG_PTT_METHODS = ["none", "cat", "vox", "dtr", "rts"];
// DTR and RTS (a serial rig's box): its port's two lines while connected, low or high, set as the port opens (rigPttLineLevels); the one
// PTT Method uses is low whatever it is set to, and raised only to key the rig
const RIG_LINE_LEVELS = ["low", "high"];
// VFO-A to VFO-H
const RIG_VFOS_MAX = 8;

function rigVfos()
{
  return GT.settings.Rigs.vfos;
}

function rigVfoById(id)
{
  return id ? rigVfos().find((v) => v.id == id) || null : null;
}

// A VFO's name: its letter by its place in the list, with the user's own name after it, "VFO-C (SDR)"; "None" for none
function rigVfoLabel(v)
{
  if (!v) return I18N("settings.rig.vfo.none.label");
  const letter = "VFO-" + String.fromCharCode(65 + Math.max(0, rigVfos().indexOf(v)));
  return v.name ? letter + " (" + v.name + ")" : letter;
}

// The VFO is the second VFO of another one's rig
function rigVfoIsSecond(v)
{
  return !!v && v.source == "of";
}

// The VFO whose rig a VFO is on: itself, or the one it is the second VFO of
function rigVfoOwner(v)
{
  return rigVfoIsSecond(v) ? rigVfoById(v.of) : v;
}

// A VFO's rig (its state): its own, or its owner's; null when there is none
function rigVfoLink(v)
{
  const owner = v ? rigVfoOwner(v) : null;
  return owner && !rigVfoIsSecond(owner) ? GT.rigs[owner.id] || null : null;
}

// Whether a VFO is in use: Rig Control on and its Connect checked (a second VFO's owner's too)
function rigVfoOn(v)
{
  if (!v || !GT.settings.Rigs.enable || v.connect === false) return false;
  if (!rigVfoIsSecond(v)) return true;
  const owner = rigVfoOwner(v);
  return !!owner && !rigVfoIsSecond(owner) && owner.connect !== false;
}

// What a VFO reads now: { R: its rig, up, dial, mode }. Up while it is on, its rig connected and read, and not No Answer (rigNoAnswer:
// what it said last no longer taken for its frequency); a second VFO: the rig has one that answers. dial the rig's own frequency, its
// converter offset not taken off
function rigVfoRead(v)
{
  const R = rigVfoLink(v);
  if (!R || !rigVfoOn(v) || R.status != "connected" || rigNoAnswer(R)) return { R: R, up: false, dial: null, mode: null };
  const second = rigVfoIsSecond(v);
  const dial = second ? (R.dual === true ? R.freqB : null) : R.freq;
  return { R: R, up: dial > 0, dial: dial > 0 ? dial : null, mode: (second ? R.modeB : R.mode) || null };
}

// A rig's settings (its link's): its VFO's
function rigSettingsOf(R)
{
  return rigVfoById(R.key) || RIG_LINK_DEFAULTS;
}

// The settings as they should be: at least one VFO, each with an id of its own and its link's settings; a second VFO only of a VFO that
// is a rig of its own, and only one such for each (any other is made a rig of its own, its Connect unchecked)
function rigVfosNormalize()
{
  const S = GT.settings.Rigs;
  if (!Array.isArray(S.vfos) || S.vfos.length == 0) S.vfos = [{ id: "v1", source: "own", connect: false }];
  S.vfos = S.vfos.filter((v) => v && typeof v == "object").slice(0, RIG_VFOS_MAX);
  const ids = new Set();
  for (const v of S.vfos)
  {
    if (typeof v.id != "string" || !v.id || ids.has(v.id)) v.id = rigVfoNewId(ids);
    ids.add(v.id);
    // (DTR and RTS: a VFO saved before they were there has neither, and gets its protocol's, below)
    for (const [key, value] of Object.entries(RIG_LINK_DEFAULTS)) if (v[key] === undefined && key != "dtr" && key != "rts") v[key] = value;
    v.name = typeof v.name == "string" ? v.name.slice(0, 20) : "";
    // Not connected until the user checks Connect
    v.connect = v.connect === true;
    if (!Number.isFinite(Number(v.offset)) || Math.abs(Number(v.offset)) > RIG_OFFSET_MAX) v.offset = 0;
    // SSB's Data (rigSsbDataChanged): off unless checked
    v.ssbData = v.ssbData === true;
    if (!RIG_PTT_METHODS.includes(v.ptt)) v.ptt = "cat";
    // DTR and RTS: High or Low; neither set, as its protocol usually wants them (rigProtocolLine)
    for (const line of ["dtr", "rts"]) if (!RIG_LINE_LEVELS.includes(v[line])) v[line] = rigProtocolLine(v.protocol, line);
    // Its satellite ranges (rigVfoSatRanges), those it can use; none set (left out): every frequency, receive only
    if (v.satRanges !== undefined)
    {
      v.satRanges = Array.isArray(v.satRanges) ? v.satRanges.filter((r) => r && RIG_SAT_DIRS.includes(r.dir) && Number(r.lo) >= 0 && Number(r.hi) >= Number(r.lo))
        .map((r) => ({ lo: Number(r.lo), hi: Number(r.hi), dir: r.dir })) : undefined;
    }
  }
  const owned = new Set();
  for (const v of S.vfos)
  {
    if (v.source != "of") v.source = "own";
    if (v.source == "own")
    {
      v.of = null;
      continue;
    }
    const owner = rigVfoById(v.of);
    if (owner && owner !== v && owner.source != "of" && !owned.has(owner.id)) owned.add(owner.id);
    else
    {
      v.source = "own";
      v.of = null;
      v.connect = false;
    }
  }
}

function rigVfoNewId(taken = new Set(rigVfos().map((v) => v.id)))
{
  let n = 1;
  while (taken.has("v" + n)) n++;
  return "v" + n;
}

// A rig's state for each VFO that is a rig of its own: one whose VFO is gone, or is now a second VFO, let go
function rigLinksSync()
{
  for (const v of rigVfos())
  {
    if (!rigVfoIsSecond(v) && !GT.rigs[v.id]) GT.rigs[v.id] = rigNewState(v.id);
  }
  for (const id of Object.keys(GT.rigs))
  {
    const v = rigVfoById(id);
    if (v && !rigVfoIsSecond(v)) continue;
    rigDisconnect(GT.rigs[id]);
    delete GT.rigs[id];
    serialPortTell("rig_" + id, null);
  }
  // (One let go still keyed, its link lost, no longer counts: rigPttTell)
  rigPttTell();
}

// Whether a rig's second VFO is asked (its frequency where that isn't asked anyway, its mode): a VFO on it that is in use
function rigModeBWanted(R)
{
  return rigVfos().some((v) => rigVfoIsSecond(v) && v.of == R.key && rigVfoOn(v));
}

// Whether a rig is to be connected: its VFO in use
function rigWanted(R)
{
  const v = rigVfoById(R.key);
  return !!v && !rigVfoIsSecond(v) && rigVfoOn(v);
}

// ---- BirdWatch's VFOs. Each VFO says what it is for with satellites (its box's Satellites row): ranges of frequencies on the air, each
// to receive (rx), transmit (tx) or both; none set, every frequency, receive only (nothing transmits until the user says so). For a
// transmitter, its downlink goes to the first VFO in the list (their order is their priority) that receives there, a connected one before
// one that isn't; its uplink to the first that transmits there, never the downlink's own (a rig that doesn't go there is said in the
// Event Viewer: rigVerifyLater). A transmitter's own picks come first
// (BirdWatch.vfoPins, { uuid: { rx, tx } }: a right-click on its downlink or uplink in the transmitters window)

// The bands offered in the Satellites row (MHz on the air)
const RIG_SAT_BANDS = [["10m", 28, 29.7], ["6m", 50, 54], ["2m", 144, 148], ["1.25m", 222, 225], ["70cm", 420, 450], ["33cm", 902, 928], ["23cm", 1240, 1300], ["13cm", 2300, 2450], ["9cm", 3300, 3500], ["6cm", 5650, 5925], ["3cm", 10000, 10500], ["1.2cm", 24000, 24250]];
const RIG_SAT_DIRS = ["rx", "tx", "both"];

// A VFO's satellite ranges: [{ lo, hi (MHz; both 0: every frequency), dir }]
function rigVfoSatRanges(v)
{
  return Array.isArray(v.satRanges) ? v.satRanges : [{ lo: 0, hi: 0, dir: "rx" }];
}

// Whether a VFO is for a side ("rx" or "tx") at a frequency (Hz on the air; none given: at any frequency of its ranges)
function rigVfoSatCovers(v, side, hz)
{
  return rigVfoSatRanges(v).some((r) => (r.dir == "both" || r.dir == side) && (!(hz > 0) || (r.lo == 0 && r.hi == 0) || (hz >= r.lo * 1e6 && hz <= r.hi * 1e6)));
}

// A VFO in use with its rig connected
function rigVfoReady(v)
{
  const R = v && rigVfoOn(v) ? rigVfoLink(v) : null;
  return !!R && R.status == "connected";
}

// BirdWatch's VFOs for a transmitter (left out: the one followed, else none in particular): { rx, tx }, each a VFO or null (none: a side
// the transmitter hasn't, or no VFO for it)
function rigRoles(t)
{
  if (t === undefined) t = GT.rigDoppler && typeof birdWatchStickyPrevious == "function" ? birdWatchStickyPrevious() : null;
  const pins = t && GT.settings.BirdWatch.vfoPins ? GT.settings.BirdWatch.vfoPins[t.uuid] || {} : {};
  const pick = (side, hz, not) =>
  {
    const pinned = rigVfoById(pins[side]);
    if (pinned && pinned !== not) return pinned;
    const list = rigVfos().filter((v) => v !== not && rigVfoSatCovers(v, side, hz));
    return list.find(rigVfoReady) || list[0] || null;
  };
  const rx = t && !(t.downlink_low > 0) ? null : pick("rx", t ? t.downlink_low : 0, null);
  const tx = t && !(t.uplink_low > 0) ? null : pick("tx", t ? t.uplink_low : 0, rx);
  return { rx: rx, tx: tx };
}

// Side "rx" the downlink's VFO, "tx" the uplink's, for a transmitter (left out: the one followed); null for none
function rigRoleVfo(side, t)
{
  return rigRoles(t)[side];
}

// A side's VFO is in use and its rig connected
function rigRoleConnected(side, t)
{
  return rigVfoReady(rigRoleVfo(side, t));
}

// Either side's VFO is in use and its rig connected: there is something to follow a satellite with
function rigRolesConnected(t)
{
  return rigRoleConnected("rx", t) || rigRoleConnected("tx", t);
}

// A transmitter's own pick for a side ("rx" or "tx") as it is used: a VFO's id, or "" for none (the first that fits, as for any; also a
// pick passed over: an uplink's on the downlink's own VFO)
function rigRolePin(t, side)
{
  const pins = GT.settings.BirdWatch.vfoPins || {};
  const id = t && pins[t.uuid] ? pins[t.uuid][side] : "";
  if (!id || !rigVfoById(id)) return "";
  const v = rigRoles(t)[side];
  return v && v.id == id ? id : "";
}

function rigRolePinSet(t, side, id)
{
  const S = GT.settings.BirdWatch;
  if (!S.vfoPins || typeof S.vfoPins != "object") S.vfoPins = {};
  const pin = Object.assign({}, S.vfoPins[t.uuid]);
  if (rigVfoById(id)) pin[side] = id;
  else delete pin[side];
  if (pin.rx || pin.tx) S.vfoPins[t.uuid] = pin;
  else delete S.vfoPins[t.uuid];
  rigRolesChanged();
}

// BirdWatch's VFOs may be others now: what is followed is sent again (to the VFOs it goes to now), its modes and its uplink's tone with it,
// and what shows them is drawn again
function rigRolesChanged()
{
  const D = GT.rigDoppler;
  if (D)
  {
    D.sentRx = D.sentTx = null;
    if (D.mode) D.pendingMode = true;
    const t = D.tx && typeof birdWatchStickyPrevious == "function" ? birdWatchStickyPrevious() : null;
    if (t) D.pendingTone = birdWatchTransmitterTone(t) || 0;
  }
  rigLineRender();
  if (typeof birdWatchSatRigAvailable == "function") birdWatchSatRigAvailable();
  if (typeof birdWatchTransmitterWindowUpdate == "function") birdWatchTransmitterWindowUpdate();
}

// Each VFO's converter offset, in Hz (a VFO, or its id): the rig's dial is the frequency on the air plus it. As large as a converter's LO
// can be (an LNB's 9750 MHz is -9750000000), both ways
const RIG_OFFSET_MAX = 1e12;

function rigOffset(v)
{
  if (typeof v == "string") v = rigVfoById(v);
  const value = Number(v && v.offset);
  return Number.isFinite(value) && Math.abs(value) <= RIG_OFFSET_MAX ? Math.round(value) : 0;
}

// The LO badge after a frequency with an offset: its tooltip the offset and the rig's own dial; "" without one
function rigLoBadge(offset, dial)
{
  if (!offset) return "";
  const title = I18N("rig.offset.badge.hover").replace("{offset}", (offset > 0 ? "+" : "") + offset.toLocaleString()).replace("{dial}", formatDialFreq(dial));
  return "<span class=\"rigLoBadge\" title=\"" + htmlEntities(title) + "\">LO</span>";
}

// The serial port each rig keeps (serialPorts.js), and its settings' elements (in its VFO's box: data-f="Protocol" ...)
function rigPurpose(R)
{
  return "rig_" + R.key;
}

function rigVfoBox(id)
{
  return typeof rigVfosDiv == "undefined" ? null : rigVfosDiv.querySelector(".rigVfoBox[data-vfo='" + id + "']");
}

function rigVfoEl(id, name)
{
  const box = rigVfoBox(id);
  return box ? box.querySelector("[data-f='" + name + "']") : null;
}

function rigEl(R, name)
{
  return rigVfoEl(R.key, name);
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

// A CI-V rig's mode as shown and used: its mode as 04 says it, with "-D" while data mode is on (USB-D, as WSJT-X's Data mode sets it)
function rigCivModeShow(R)
{
  if (R.civMode === null) return;
  R.mode = R.civMode + (R.dataMode && ["USB", "LSB", "FM", "AM"].includes(R.civMode) ? "-D" : "");
}

// The address a rig's frames go to: the one set, else the one the rig answered from, else the default address of the Icom its USB port
// names (IC-7300_... is 94: an IC-7300 doesn't answer the broadcast address), else the broadcast address (00)
function rigCivAddress(R)
{
  const value = parseInt(String(rigSettingsOf(R).civAddress).trim(), 16);
  if (Number.isFinite(value) && value > 0 && value < 0xff) return value;
  if (R.civFound) return R.civFound;
  const model = serialPortModel(rigSettingsOf(R).port);
  const known = model ? Object.keys(RIG_CIV_MODELS).find((key) => RIG_CIV_MODELS[key] == model) : undefined;
  return known !== undefined ? Number(known) : 0x00;
}

// No address set and none known yet (an IC-7300 doesn't answer the broadcast address, and a CI-V interface or a USB adapter doesn't
// name the rig): each poll asks three of the known Icoms' addresses who is there (19 00, as Hamlib's probe does), one after another
// through the list, until a rig answers (its address is then R.civFound)
const RIG_CIV_PROBE_EACH_POLL = 3;

function rigCivProbe(R)
{
  const value = parseInt(String(rigSettingsOf(R).civAddress).trim(), 16);
  if (R.civFound || (Number.isFinite(value) && value > 0 && value < 0xff) || !rigNoAnswer(R)) return [];
  const addresses = Object.keys(RIG_CIV_MODELS).map(Number);
  const frames = [];
  for (let i = 0; i < RIG_CIV_PROBE_EACH_POLL; i++) frames.push(rigCivFrame(addresses[R.civProbe++ % addresses.length], 0x19, [0x00]));
  return frames;
}

// Each protocol: serial (CI-V) or network (rigctld, flrig); what to send to ask and to set, and how the answers read. R is the rig
//   poll(R):          what asks the frequency and the mode
//   setFreq(hz, R), setMode(mode, R, data): what sets them (mode as the rig names it: "USB", "FM", ...; data: true for the mode's
//                     data variant, false for it plain, where the protocol can tell them apart; undefined leaves it as it is)
//   parse(line | bytes, R): updates R.freq / R.mode from an answer; a string back is an error
const RIG_PROTOCOLS = {
  rigctld: {
    name: "Hamlib rigctld",
    serial: false,
    // The extended protocol (+): the answers come labeled, "Frequency: 14074000", "Mode: USB", and end with "RPRT 0". Whether rigctld
    // runs in VFO mode (--vfo) is asked first, on its own (rigNetChkVfo), and nothing is polled until it is known.
    // In VFO mode every command names its VFO: VFO-A Main (or VFOA), VFO-B on this rig Sub (or VFOB), each set and read as itself; no
    // split, and the VFO selected (the one a Main/Sub rig transmits on) is never changed.
    // Otherwise the second VFO is the split TX one: its frequency read (i) and set (I) as the split frequency, with split on (S 1 VFOB).
    // A Main/Sub backend can't take that (Hamlib 4.7's FTX-1: split on, a set of the selected VFO selects Sub), so on one VFO-B isn't
    // tuned until rigctld runs in VFO mode (rigTuneCanTx), and the user is told (rigNetVfoWarn)
    caps: () => "+1\n",
    // The second VFO (i, and x: the split mode, "TX Mode: LSB") only with VFO-B on this rig, and not on a Main/Sub backend: there reading
    // the split frequency can make the next f answer it for a moment, which BirdWatch would take as VFO-A moving
    poll: (R) =>
    {
      if (R.vfoMode === null) return null;
      if (R.vfoMode) return "+f " + rigNetVfo(R, "a") + "\n+m " + rigNetVfo(R, "a") + "\n" + (R.dual && rigModeBWanted(R) ? "+f " + rigNetVfo(R, "b") + "\n+m " + rigNetVfo(R, "b") + "\n" : "");
      return "+f\n+m\n" + (R.dual && rigModeBWanted(R) && !R.mainSub ? "+i\n+x\n" : "");
    },
    setFreq: (hz, R) => "+F " + (R.vfoMode ? rigNetVfo(R, "a") + " " : "") + Math.round(hz) + "\n",
    setMode: (mode, R, data) => "+M " + (R.vfoMode ? rigNetVfo(R, "a") + " " : "") + (data && ["USB", "LSB", "FM"].includes(mode) ? "PKT" + mode : mode) + " 0\n",
    setTx: (hz, R) => (R.vfoMode ? "+F " + rigNetVfo(R, "b") + " " : "+I ") + Math.round(hz) + "\n",
    // The split (TX) VFO's own mode (X): an inverting transponder's uplink is LSB under a USB downlink
    setTxMode: (mode, R) => (R.vfoMode ? "+M " + rigNetVfo(R, "b") + " " : "+X ") + mode + " 0\n",
    splitOn: (R) => (R.vfoMode ? null : "+S 1 VFOB\n"),
    // The CTCSS tone in tenths of a hertz (C), and the tone turned on or off (U TONE), on the uplink's VFO: in VFO mode the rig's first
    // (side "a") or, the uplink on its second VFO, that one ("b")
    setTone: (hz, R, side) =>
    {
      const vfo = R.vfoMode ? rigNetVfo(R, side == "b" ? "b" : "a") + " " : "";
      return hz > 0 ? "+C " + vfo + Math.round(hz * 10) + "\n+U " + vfo + "TONE 1\n" : "+U " + vfo + "TONE 0\n";
    },
    canTone: (R) => R.toneFreq === true && R.toneFunc === true,
    // PTT (T), keyed (1) or not (0), on the rig's first VFO in VFO mode
    setPtt: (on, R) => "+T" + rigNetVfoArg(R) + " " + (on ? 1 : 0) + "\n",
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
      // In VFO mode an answer starts by naming its VFO ("get_freq: Sub"): VFO-B's frequency and mode are this rig's second VFO's
      if ((m = /^get_(?:freq|mode):\s*(\S*)/.exec(line))) R.answerB = R.vfoMode === true && m[1] == rigNetVfo(R, "b");
      else if ((m = /^Frequency:\s*(\d+)/.exec(line)))
      {
        if (R.answerB) R.freqB = Number(m[1]);
        else rigFreqSaid(R, Number(m[1]));
      }
      else if ((m = /^TX Frequency:\s*(\d+)/.exec(line))) R.freqB = Number(m[1]);
      else if ((m = /^TX Mode:\s*(\S+)/.exec(line))) R.modeB = m[1];
      else if ((m = /^VFO list:\s*(.*)/.exec(line)))
      {
        R.dual = /VFOB|Sub/i.test(m[1]);
        R.mainSub = /\bMain\b/.test(m[1]) && /\bSub\b/.test(m[1]) && !/\bVFOB\b/.test(m[1]);
        rigNetVfoWarn(R);
      }
      else if ((m = /^Model name:\s*(.+)/.exec(line))) R.model = m[1].trim();
      else if ((m = /^Can set CTCSS Tone:\s*(\S)/.exec(line))) R.toneFreq = m[1] == "Y";
      else if ((m = /^Set functions:\s*(.*)/.exec(line))) R.toneFunc = /\bTONE\b/.test(m[1]);
      else if ((m = /^Tuning Step:\s*(\d+)/.exec(line))) R.tuningStep = Number(m[1]) || null;
      else if ((m = /^Mode:\s*(\S+)/.exec(line))) R[R.answerB ? "modeB" : "mode"] = m[1];
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
    // Data: the name most rigs' flrig modes give it (an Icom's USB-D)
    setMode: (mode, R, data) => ["rig.set_modeA", "<string>" + (data && ["USB", "LSB"].includes(mode) ? mode + "-D" : mode) + "</string>"],
    setTx: (hz) => ["rig.set_vfoB", "<double>" + Math.round(hz) + "</double>"],
    setTxMode: (mode) => ["rig.set_modeB", "<string>" + mode + "</string>"],
    splitOn: () => ["rig.set_split", "<int>1</int>"],
    setPtt: (on) => ["rig.set_ptt", "<int>" + (on ? 1 : 0) + "</int>"]
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
    // Data mode too (1A 06: the IC-7300, 705, 9700, 7610 ...; an older Icom answers NG, and isn't asked again), so USB-D shows as such
    poll: (R) => rigCivProbe(R).concat([rigCivFrame(rigCivAddress(R), 0x03), rigCivFrame(rigCivAddress(R), 0x04)]).concat(R.dual === false ? [] : [rigCivFrame(rigCivAddress(R), 0x25, [0x01])])
      .concat(R.dual === true && R.modeBAsk && rigModeBWanted(R) ? [rigCivFrame(rigCivAddress(R), 0x26, [0x01])] : [])
      .concat(R.dataAsk && R.civFound ? [rigCivFrame(rigCivAddress(R), 0x1a, [0x06])] : []),
    setFreq: (hz, R) => rigCivFrame(rigCivAddress(R), 0x05, rigCivHzToBcd(hz)),
    setTx: (hz, R) => rigCivFrame(rigCivAddress(R), 0x25, [0x01, ...rigCivHzToBcd(hz)]),
    splitOn: (R) => rigCivFrame(rigCivAddress(R), 0x0f, [0x01]),
    // 26 01: the unselected (TX) VFO's mode, data mode off, its filter kept (as last read; FIL1 before one is) (the IC-7300, 7610, 9700,
    // 705 have it; an older Icom answers NG)
    setTxMode: (mode, R) =>
    {
      const code = Number(Object.keys(RIG_CIV_MODES).find((key) => RIG_CIV_MODES[key] == String(mode).toUpperCase()));
      return Number.isFinite(code) ? rigCivFrame(rigCivAddress(R), 0x26, [0x01, code, 0x00, R.civFilterB || 0x01]) : null;
    },
    // 1B 00 sets the repeater tone (its tenths of a hertz as six BCD digits, the highest first: 67.0 is 00 06 70, as Hamlib sends it), 16 42
    // turns it on (01) or off (00)
    setTone: (hz, R) =>
    {
      if (!(hz > 0)) return [rigCivFrame(rigCivAddress(R), 0x16, [0x42, 0x00])];
      const digits = String(Math.round(hz * 10)).padStart(6, "0");
      const bcd = (i) => (Number(digits[i]) << 4) | Number(digits[i + 1]);
      return [rigCivFrame(rigCivAddress(R), 0x1b, [0x00, bcd(0), bcd(2), bcd(4)]), rigCivFrame(rigCivAddress(R), 0x16, [0x42, 0x01])];
    },
    canTone: () => true,
    // 1C 00: PTT keyed (01) or not (00)
    setPtt: (on, R) => rigCivFrame(rigCivAddress(R), 0x1c, [0x00, on ? 0x01 : 0x00]),
    // The mode with the filter in use kept (06 mode filter: without one the rig takes the mode's default, FIL2 on the IC-7300; before the
    // filter is read, the mode alone). Data asked for or against: 1A 06 after the mode, data mode on with that filter (01 and it) or off
    // (00 00), as the IC-7300, 705, 9700 and 7610 have it. Two frames, each queued on its own (rigTune): sent in one write, an IC-7300
    // streaming its band scope dropped the second, so data mode never came on
    setMode: (mode, R, data) =>
    {
      const code = Number(Object.keys(RIG_CIV_MODES).find((key) => RIG_CIV_MODES[key] == String(mode).toUpperCase()));
      if (!Number.isFinite(code)) return null;
      const frame = rigCivFrame(rigCivAddress(R), 0x06, R.civFilter ? [code, R.civFilter] : [code]);
      if (data === undefined) return frame;
      return [frame, rigCivFrame(rigCivAddress(R), 0x1a, [0x06, data ? 0x01 : 0x00, data ? R.civFilter || 0x01 : 0x00])];
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
      if ((command == 0x03 || command == 0x00) && data.length >= 5) rigFreqSaid(R, rigCivBcdToHz(data.slice(0, 5)));
      else if ((command == 0x04 || command == 0x01) && data.length >= 1)
      {
        R.civMode = RIG_CIV_MODES[data[0]] || ("mode " + data[0]);
        // The filter in use after it (FIL1 to FIL3)
        if (data.length >= 2 && data[1] >= 1 && data[1] <= 3) R.civFilter = data[1];
        rigCivModeShow(R);
      }
      // Data mode (1A 06): 00 off, 01 to 03 D1 to D3
      else if (command == 0x1a && data.length >= 2 && data[0] == 0x06)
      {
        R.dataMode = data[1] > 0;
        rigCivModeShow(R);
      }
      else if (command == 0x19 && data.length >= 2 && data[0] == 0x00) R.civFound = data[1];
      else if (command == 0x25 && data.length >= 6 && data[0] == 0x01)
      {
        R.freqB = rigCivBcdToHz(data.slice(1, 6));
        R.dual = true;
      }
      else if (command == 0x26 && data.length >= 2 && data[0] == 0x01)
      {
        R.modeB = RIG_CIV_MODES[data[1]] || ("mode " + data[1]);
        // Its filter (after the mode and the data mode)
        if (data.length >= 4 && data[3] >= 1 && data[3] <= 3) R.civFilterB = data[3];
      }
      // The CW pitch (14 09, 0 to 255 for 300 to 900 Hz, in 5 Hz steps)
      else if (command == 0x14 && data.length >= 3 && data[0] == 0x09) R.cwPitch = Math.round((300 + (rigCivBcdToHz([data[2], data[1]]) * 600) / 255) / 5) * 5;
      // The tuning step (10, one BCD byte): its code as the IC-7300, 705, 9700 and 7610 have them; 00 is TS off, 10 Hz a step
      else if (command == 0x10 && data.length == 1) R.tuningStep = RIG_CIV_STEPS[(data[0] >> 4) * 10 + (data[0] & 0x0f)] || null;
      // The band scope (27): its sweeps and settings (rigScopeRead)
      else if (command == 0x27 && data.length >= 1) rigScopeRead(R, data);
      // NG to the scope's data asked for (27 11 01): the rig won't send it over this port (rigScopeStatus says why)
      else if (command == 0xfa && R.lastSent && R.lastSent[4] == 0x27 && R.lastSent[5] == 0x11) rigScopeRefused(R);
      else if (command == 0xfa)
      {
        // NG to 26 01, or to 1A 06: the rig hasn't it, and isn't asked again (nor taken as having no second VFO)
        if (R.lastSent && R.lastSent[4] == 0x26) R.modeBAsk = false;
        if (R.lastSent && R.lastSent[4] == 0x1a && R.lastSent[5] == 0x06)
        {
          R.dataAsk = false;
          return "NG";
        }
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
    // TX; keys the rig (its PTT), RX; unkeys it
    ptt: { on: "TX;", off: "RX;" },
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
    // Their CAT RTS menu is on as they come (CAT ignored while RTS is low; Hamlib opens them with RTS up): RTS High as the protocol is
    // picked
    lines: { rts: "high" },
    modeAsk: "MD0;",
    modeReply: /^MD0([0-9A-F])$/,
    modes: { 1: "LSB", 2: "USB", 3: "CW", 4: "FM", 5: "AM", 6: "RTTY", 7: "CW-R", 8: "PKT-L", 9: "RTTY-R", A: "PKT-FM", B: "FM-N", C: "PKT-U", D: "AM-N", E: "C4FM", F: "PKT-FM-N" },
    modeSet: (code) => "MD0" + code + ";",
    // The second VFO's mode: MD1, the Sub receiver's, on the rigs with two (FTX-1, FTDX101); one that refuses it (the FT-991's MD has the
    // main receiver alone) isn't asked again
    modeBAsk: "MD1;",
    modeBReply: /^MD1([0-9A-F])$/,
    modeBSet: (code) => "MD1" + code + ";",
    // TX1; keys the rig over CAT, TX0; unkeys it
    ptt: { on: "TX1;", off: "TX0;" },
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
    // 08 keys the rig (its PTT), 88 unkeys it
    setPtt: (on) => new Uint8Array([0, 0, 0, 0, on ? 0x08 : 0x88]),
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
        rigFreqSaid(R, Number(nibbles.join("")) * 10);
        const modes = { 0x00: "LSB", 0x01: "USB", 0x02: "CW", 0x03: "CW-R", 0x04: "AM", 0x06: "WFM", 0x08: "FM", 0x0a: "DIG", 0x0c: "PKT" };
        R.mode = (modes[reply[4] & 0x7f] || "mode " + (reply[4] & 0x7f)) + (reply[4] & 0x80 ? "-N" : "");
        R.dual = false;
      }
      rigReplied(R);
    }
  }
};

// ---- Did it stick: each frequency sent to a VFO (rigTune) is read back RIG_VERIFY_MS later; read more than RIG_VERIFY_HZ away from it,
// still where it was before (the rig didn't move: a dial moved elsewhere is the user's tuning), and nothing sent to that VFO since, it is a
// warning in the Event Viewer (at most one a VFO every RIG_VERIFY_EVENT_MS). Nothing otherwise. BirdWatch's Doppler following isn't
// checked here (it reads back every setting itself: birdWatchSideTarget)
const RIG_VERIFY_MS = 3000;
const RIG_VERIFY_HZ = 100;
const RIG_VERIFY_EVENT_MS = 10000;
// The last frequency sent to each VFO (by its id), and when each last warned
GT.rigVerify = {};
GT.rigVerifyWarned = {};

function rigVerifyLater(v, dial)
{
  // Where the dial was when it was sent (null: not known, any other reading counts)
  const was = rigVfoRead(v);
  const sent = { dial: dial, before: was.up ? was.dial : null };
  GT.rigVerify[v.id] = sent;
  nodeTimers.setTimeout(() =>
  {
    if (GT.rigVerify[v.id] !== sent) return;
    const read = rigVfoRead(v);
    if (!read.up || Math.abs(read.dial - dial) <= RIG_VERIFY_HZ) return;
    if (sent.before !== null && Math.abs(read.dial - sent.before) > RIG_VERIFY_HZ) return;
    const now = Date.now();
    if (now - (GT.rigVerifyWarned[v.id] || 0) < RIG_VERIFY_EVENT_MS) return;
    GT.rigVerifyWarned[v.id] = now;
    const text = I18N("rig.event.notTuned").replace("{vfo}", rigVfoLabel(v)).replace("{freq}", formatDialFreq(dial - rigOffset(v))).replace("{read}", formatDialFreq(read.dial - rigOffset(v)));
    addEvent("app", "<font style='color:orange'>" + htmlEntities(text) + "</font>");
  }, RIG_VERIFY_MS);
}

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
    lines: cat.lines,
    split: /;/,
    caps: () => "ID;",
    // The second VFO's mode too where the CAT has it (modeBAsk), with a VFO on it in use, until refused
    poll: (R) => ["FA;", cat.modeAsk].concat(R.dual === false ? [] : ["FB;"]).concat(cat.modeBAsk && R.dual === true && R.modeBAsk && rigModeBWanted(R) ? [cat.modeBAsk] : []),
    replies: (data) => typeof data == "string" && /^[A-Z]{2}\d?;$/.test(data),
    setFreq: (value) => "FA" + hz(value) + ";",
    setTx: (value) => "FB" + hz(value) + ";",
    // The second VFO's mode (BirdWatch's uplink: an inverting transponder's LSB under a USB downlink), where the CAT has it and the rig
    // hasn't refused it
    setTxMode: cat.modeBSet
      ? (mode, R) =>
        {
          if (R.modeBAsk === false) return null;
          const code = Object.keys(cat.modes).find((key) => cat.modes[key] == String(mode).toUpperCase());
          return code === undefined ? null : cat.modeBSet(code);
        }
      : undefined,
    splitOn: (R) => cat.splitOn(R.catId),
    // PTT, where the CAT has it (ptt: its on and off commands)
    setPtt: cat.ptt ? (on) => (on ? cat.ptt.on : cat.ptt.off) : undefined,
    // Data: the rig's packet mode where it has one (a Yaesu's PKT-U, PKT-L), else the mode plain
    setMode: (mode, R, data) =>
    {
      const name = String(mode).toUpperCase();
      const packet = { USB: "PKT-U", LSB: "PKT-L" }[name];
      if (data && packet && Object.values(cat.modes).includes(packet)) mode = packet;
      const code = Object.keys(cat.modes).find((key) => cat.modes[key] == String(mode).toUpperCase());
      return code === undefined ? null : cat.modeSet(code);
    },
    parse: (line, R) =>
    {
      const text = line.trim();
      let m;
      if ((m = freqReply.exec(text)))
      {
        if (m[1] == "A") rigFreqSaid(R, Number(m[2]));
        else
        {
          R.freqB = Number(m[2]);
          // A rig that can't be split over CAT (the FT-891) reads its second VFO, but it can't take the uplink
          R.dual = !(cat.noSplit || []).includes(R.catId);
        }
      }
      else if ((m = cat.modeReply.exec(text))) R.mode = cat.modes[m[1]] || ("mode " + m[1]);
      else if (cat.modeBReply && (m = cat.modeBReply.exec(text))) R.modeB = cat.modes[m[1]] || ("mode " + m[1]);
      else if ((m = /^ID(\d+)$/.exec(text)))
      {
        R.catId = m[1];
        R.model = cat.models[m[1]] || "ID " + m[1];
        if ((cat.noSplit || []).includes(R.catId)) R.dual = false;
      }
      else if (text == "?")
      {
        // Refused: the second VFO's question, before it was ever answered, means the rig hasn't one; its mode's (asked or set), that the
        // CAT has no second VFO's mode (not asked or set again on this connection)
        if (R.lastSent == "FB;" && R.dual === null) R.dual = false;
        if (cat.modeBAsk && typeof R.lastSent == "string" && R.lastSent.startsWith(cat.modeBAsk.slice(0, 3))) R.modeBAsk = false;
        return "?";
      }
      return null;
    }
  };
}

function rigProtocolChosen(R)
{
  return RIG_PROTOCOLS[rigSettingsOf(R).protocol] || RIG_PROTOCOLS.rigctld;
}

// ---- Settings (Features -> Service): a box for each VFO (made from #rigVfoTemplate), its title its letter, then Add VFO

function rigSettingsRender()
{
  // A box shows its rig's state: the states made first (the settings are shown as they load, before rigInit)
  rigVfosNormalize();
  rigLinksSync();
  const S = GT.settings.Rigs;
  rigEnable.checked = S.enable;
  rigVfosTr.style.display = S.enable ? "" : "none";
  // The boxes made again only when the list changed
  const ids = rigVfos().map((v) => v.id).join(",");
  if (rigVfosDiv.dataset.ids != ids)
  {
    rigVfosDiv.dataset.ids = ids;
    rigVfosDiv.innerHTML = "";
    for (const v of rigVfos()) rigVfosDiv.appendChild(rigVfoBoxMake(v));
  }
  rigAddVfo.style.display = rigVfos().length < RIG_VFOS_MAX ? "" : "none";
  for (const v of rigVfos()) rigVfoBoxRender(v);
  // Its box in the Radios tab (panel.js)
  settingsRadiosTabRender();
  // The VFOs (added, removed, their letters and names) in the Multi-Mode Decoder's menus (its window, when loaded)
  try
  {
    GT.mmDecoderHandle.window.mmdVfosRender();
  }
  catch (e)
  {
    // Not loaded: its menus are made as it opens
  }
}

// A VFO's box: the template's, its fields' ids its own (rig_<id>_Protocol ...) and their labels pointed at them
function rigVfoBoxMake(v)
{
  const box = rigVfoTemplate.content.firstElementChild.cloneNode(true);
  box.dataset.vfo = v.id;
  for (const el of box.querySelectorAll("[data-f]")) el.id = "rig_" + v.id + "_" + el.dataset.f;
  for (const label of box.querySelectorAll("label[data-for]")) label.htmlFor = "rig_" + v.id + "_" + label.dataset.for;
  renderI18n(box);
  return box;
}

// The VFO a field is in (its box's)
function rigVfoOfEl(el)
{
  const box = el.closest(".rigVfoBox");
  return box ? rigVfoById(box.dataset.vfo) : null;
}

// A VFO's box: its title, name and Connect, where it is (its own rig, or another one's second VFO), its offset; its rig's rows for one of
// its own, or how that rig's second VFO is for a second VFO. Connected (Connect checked), its settings can't be changed: nothing half set
// goes live to a rig
function rigVfoBoxRender(v)
{
  const el = (name) => rigVfoEl(v.id, name);
  const second = rigVfoIsSecond(v);
  const locked = v.connect !== false;
  el("Title").textContent = rigVfoLabel(v).replace(/ \(.*$/, "");
  if (document.activeElement !== el("Name")) el("Name").value = v.name;
  el("Name").placeholder = I18N("settings.rig.vfoName.label");
  el("Connect").checked = locked;
  // Removed only with its Connect unchecked, and never the last one
  el("Remove").style.display = rigVfos().length > 1 && !locked ? "" : "none";
  // Where it is: its own rig, or the second VFO of a VFO that is a rig of its own with no other second VFO (none for a VFO that has one)
  const source = el("Source");
  const hasSecond = rigVfos().some((x) => rigVfoIsSecond(x) && x.of == v.id);
  const choices = [["own", I18N("settings.rig.source.own.label")]];
  if (!hasSecond)
  {
    for (const owner of rigVfos())
    {
      if (owner === v || rigVfoIsSecond(owner)) continue;
      if (rigVfos().some((x) => x !== v && rigVfoIsSecond(x) && x.of == owner.id)) continue;
      choices.push([owner.id, I18N("settings.rig.source.second.label").replace("{vfo}", rigVfoLabel(owner))]);
    }
  }
  const key = choices.map(([value, text]) => value + "=" + text).join("|");
  if (source.dataset.key != key)
  {
    source.dataset.key = key;
    source.innerHTML = "";
    for (const [value, text] of choices) source.appendChild(new Option(text, value));
  }
  source.value = second ? v.of : "own";
  rigLockField(source, locked);
  el("Offset").value = String(rigOffset(v));
  rigLockField(el("Offset"), locked);
  // SSB's Data: a rig of its own's (a second VFO's mode is set without it)
  el("SsbData").checked = v.ssbData === true;
  el("SsbTr").style.display = second ? "none" : "";
  // Move up and down (the list's order is BirdWatch's priority): not the first up, nor the last down
  const at = rigVfos().indexOf(v);
  el("MoveUp").style.visibility = at > 0 ? "" : "hidden";
  el("MoveDown").style.visibility = at < rigVfos().length - 1 ? "" : "hidden";
  rigSatRender(v);
  if (second)
  {
    for (const name of ["ProtocolTr", "ProtocolNoteTr", "PortTr", "LinuxTr", "BaudTr", "CivTr", "ScopeTr", "HostTr", "LanTr", "SdrppSourceTr", "SdrppDeviceTr", "SdrppRateTr", "ForceVfoTr", "PttTr", "LinesTr"]) el(name).style.display = "none";
    el("StatusTr").style.display = "";
    el("PortError").style.display = "none";
    rigVfoSecondStatusRender(v);
  }
  else rigSettingsRenderOne(GT.rigs[v.id], true, locked);
}

// A VFO's Satellites row (rigVfoSatRanges): each range as "2m RX", "28.0 - 29.7 MHz TX" or "All Frequencies RX" with its ✕; none: not
// used with satellites. Under them a band (or All Frequencies, or Custom with its MHz), RX, TX or RX/TX, and Add
const RIG_SAT_DIR_NAMES = { rx: "RX", tx: "TX", both: "RX/TX" };
const RIG_SAT_DIR_COLORS = { rx: "cyan", tx: "orange", both: "yellow" };

function rigSatRender(v)
{
  const el = (name) => rigVfoEl(v.id, name);
  const ranges = rigVfoSatRanges(v);
  const html = ranges.length == 0 ? "<span style='color:#aaa'>" + htmlEntities(I18N("settings.rig.sat.none")) + "</span>" : ranges.map((r, i) =>
    "<span class='rigSatRange'>" + htmlEntities(rigSatRangeName(r)) + " <span style='color:" + RIG_SAT_DIR_COLORS[r.dir] + "'>" + RIG_SAT_DIR_NAMES[r.dir] + "</span>" +
    "<span class='rigVfoRemove' data-i='" + i + "' title='" + htmlEntities(I18N("settings.rig.sat.remove.hover")).replace(/'/g, "&#39;") + "' onclick='rigSatRemove(this);'>✕</span></span>").join("");
  const list = el("SatList");
  if (list.rigHtml !== html)
  {
    list.rigHtml = html;
    list.innerHTML = html;
  }
  const band = el("SatBand");
  if (!band.options.length)
  {
    band.add(new Option(I18N("settings.rig.sat.all"), "all"));
    for (const [name] of RIG_SAT_BANDS) band.add(new Option(name, name));
    band.add(new Option(I18N("settings.rig.sat.custom"), "custom"));
    for (const dir of RIG_SAT_DIRS) el("SatDir").add(new Option(RIG_SAT_DIR_NAMES[dir], dir));
  }
  el("SatCustom").style.display = band.value == "custom" ? "" : "none";
}

// A range's name: All Frequencies, a band's, or its MHz
function rigSatRangeName(r)
{
  if (r.lo == 0 && r.hi == 0) return I18N("settings.rig.sat.all");
  const band = RIG_SAT_BANDS.find(([, lo, hi]) => lo == r.lo && hi == r.hi);
  const mhz = (n) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
  return band ? band[0] : mhz(r.lo) + " - " + mhz(r.hi) + " MHz";
}

function rigSatBandChanged(el)
{
  const v = rigVfoOfEl(el);
  if (v) rigSatRender(v);
}

// Add: the band picked (or every frequency, or the MHz typed), to receive, transmit or both; one already there isn't added again.
// (The VFO's default, every frequency receive only, shows as a range of its own until a receive range is added)
function rigSatAdd(el)
{
  const v = rigVfoOfEl(el);
  if (!v) return;
  const band = rigVfoEl(v.id, "SatBand").value;
  const dir = rigVfoEl(v.id, "SatDir").value;
  if (!RIG_SAT_DIRS.includes(dir)) return;
  let lo = 0;
  let hi = 0;
  if (band == "custom")
  {
    const loEl = rigVfoEl(v.id, "SatLo");
    const hiEl = rigVfoEl(v.id, "SatHi");
    lo = Number(loEl.value);
    hi = Number(hiEl.value);
    loEl.style.outline = lo > 0 ? "" : "1px solid red";
    hiEl.style.outline = hi >= lo && hi > 0 ? "" : "1px solid red";
    if (!(lo > 0) || !(hi >= lo)) return;
  }
  else if (band != "all")
  {
    const found = RIG_SAT_BANDS.find(([name]) => name == band);
    if (!found) return;
    lo = found[1];
    hi = found[2];
  }
  // The first receive (or both) range replaces the default every frequency receive only (10m RX: 10m alone); a first transmit one is
  // added to it
  const ranges = v.satRanges === undefined && dir != "tx" ? [] : rigVfoSatRanges(v).slice();
  if (!ranges.some((r) => r.lo == lo && r.hi == hi && r.dir == dir)) ranges.push({ lo: lo, hi: hi, dir: dir });
  v.satRanges = ranges;
  rigSatRender(v);
  rigRolesChanged();
}

// A range's ✕: taken off (the last one: the VFO isn't used with satellites)
function rigSatRemove(el)
{
  const v = rigVfoOfEl(el);
  if (!v) return;
  v.satRanges = rigVfoSatRanges(v).filter((r, i) => i != Number(el.dataset.i));
  rigSatRender(v);
  rigRolesChanged();
}

// Move up (step -1) or down (1): the list's order is BirdWatch's priority (and the VFOs' letters)
function rigVfoMove(el, step)
{
  const v = rigVfoOfEl(el);
  const list = rigVfos();
  const from = list.indexOf(v);
  const to = from + step;
  if (!v || to < 0 || to >= list.length) return;
  list.splice(from, 1);
  list.splice(to, 0, v);
  rigSettingsRender();
  rigRolesChanged();
}

// A second VFO's Status: how its rig is, and whether that rig has a second VFO that answers
function rigVfoSecondStatusRender(v)
{
  const statusEl = rigVfoEl(v.id, "Status");
  if (!statusEl) return;
  const R = rigVfoLink(v);
  const read = rigVfoRead(v);
  let text;
  let color;
  if (!R || !rigVfoOn(v))
  {
    text = I18N("rotor.status.off");
    color = "#ccc";
  }
  else if (R.status != "connected" || rigNoAnswer(R))
  {
    text = rigStatusShort(R);
    color = { connecting: "yellow", error: "#ff8080" }[R.status] || "orange";
  }
  else if (R.dual === false)
  {
    text = I18N("settings.rig.noSecondVfo");
    color = "orange";
  }
  else if (!read.up)
  {
    text = I18N("rotor.status.connecting");
    color = "yellow";
  }
  else
  {
    text = I18N("rotor.status.connected") + "  " + formatDialFreq(read.dial - rigOffset(v)) + (rigOffset(v) ? " LO" : "") + " MHz" + (read.mode ? " " + read.mode : "");
    color = "lightgreen";
  }
  statusEl.textContent = text;
  statusEl.style.color = color;
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
  for (const name of ["Protocol", "Choose", "Baud", "DataBits", "Parity", "StopBits", "CivValue", "Host", "NetPort", "ForceVfo", "LanUser", "LanPassword"]) rigLockField(rigEl(R, name), locked);
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
  rigEl(R, "ForceVfo").checked = S.forceVfo === true;
  rigEl(R, "UseScope").checked = S.useScope === true;
  rigScopeWarnRender(R);
  const protocol = rigProtocolChosen(R);
  // (A VFO set up before its protocol was there has no port of its own for it yet: the protocol's default)
  rigEl(R, "NetPort").value = protocol.http ? S.flrigPort : protocol.portKey ? S[protocol.portKey] || protocol.portDefault : S.netPort;
  // Its port's kind beside it: TCP, or UDP for a protocol that is reached over UDP (Icom LAN)
  rigEl(R, "NetPortLabel").textContent = I18N(protocol.udp ? "settings.rig.udpPort.label" : "settings.rotor.tcpPort.label");
  // The radio's own login (Icom LAN: the user and password set in the radio's Network menu)
  rigEl(R, "LanUser").value = S.lanUser || "";
  rigEl(R, "LanPassword").value = S.lanPassword || "";
  const portName = rigEl(R, "PortName");
  portName.textContent = S.port ? serialPortShortName(S.port) + (serialPortModel(S.port) ? "  —  " + serialPortModel(S.port) : "") : I18N("settings.rotor.none.label");
  portName.title = S.port ? S.port.displayName || "" : "";
  const serial = protocol.serial;
  // Kenwood CAT and Yaesu CAT name one rig each; the others that speak them are said under the protocol
  const note = { kenwood: "settings.rig.kenwood.note", yaesu: "settings.rig.yaesu.note", yaesu817: "settings.rig.yaesu817.note" }[S.protocol];
  // A model's name (TS-990, FTX-1) isn't broken at its hyphen
  rigEl(R, "ProtocolNote").innerHTML = note ? htmlEntities(I18N(note)).replace(/([A-Za-z#]+-[A-Za-z0-9]+)/g, "<span style='white-space:nowrap'>$1</span>") : "";
  // PTT Method: None and VOX always, CAT where the protocol has a PTT command, DTR and RTS on a serial port (a choice the protocol hasn't
  // shows as None)
  const pttSelect = rigEl(R, "Ptt");
  const pttChoices = [["none", I18N("settings.rig.vfo.none.label")]].concat(typeof protocol.setPtt == "function" ? [["cat", "CAT"]] : [], [["vox", "VOX"]], serial ? [["dtr", "DTR"], ["rts", "RTS"]] : []);
  const pttKey = pttChoices.map(([value, text]) => value + "=" + text).join("|");
  if (pttSelect.dataset.key != pttKey)
  {
    pttSelect.dataset.key = pttKey;
    pttSelect.innerHTML = "";
    for (const [value, text] of pttChoices) pttSelect.appendChild(new Option(text, value));
  }
  pttSelect.value = pttChoices.some(([value]) => value == S.ptt) ? S.ptt : "none";
  // DTR and RTS (a serial port's): High or Low as set, locked with the connection's settings; the line PTT Method uses shows PTT (low
  // until the rig is keyed, whatever it is set to: rigPttLineDrop), and isn't changed here
  for (const [name, line] of [["Dtr", "dtr"], ["Rts", "rts"]])
  {
    const select = rigEl(R, name);
    const ptt = S.ptt == line;
    const choices = ptt ? [["ptt", "PTT"]] : [["high", I18N("settings.rig.line.high.label")], ["low", I18N("settings.rig.line.low.label")]];
    const key = choices.map(([value, text]) => value + "=" + text).join("|");
    if (select.dataset.key != key)
    {
      select.dataset.key = key;
      select.innerHTML = "";
      for (const [value, text] of choices) select.appendChild(new Option(text, value));
    }
    select.value = ptt ? "ptt" : S[line] == "high" ? "high" : "low";
    rigLockField(select, locked || ptt);
  }
  const sdrpp = on && S.protocol == "sdrpp";
  const rows = { ProtocolTr: on, ProtocolNoteTr: on && !!note, PortTr: on && serial, BaudTr: on && serial, CivTr: on && (S.protocol == "civ" || S.protocol == "icomlan"), ScopeTr: on && S.protocol == "civ", HostTr: on && !serial, LanTr: on && protocol.lanLogin === true, ForceVfoTr: on && S.protocol == "rigctld", SdrppSourceTr: sdrpp, SdrppDeviceTr: sdrpp, SdrppRateTr: sdrpp, PttTr: on, LinesTr: on && serial, StatusTr: on };
  for (const [name, shown] of Object.entries(rows)) rigEl(R, name).style.display = shown ? "" : "none";
  serialLinuxRender(rigEl(R, "LinuxTr"), rigEl(R, "LinuxText"), S.port, on && serial);
  rigStatusRender(R);
}

// Every rig connected (or let go) as its VFO is set
function rigConnectAll()
{
  rigLinksSync();
  for (const R of Object.values(GT.rigs)) rigConnect(R);
}

function rigEnableChanged()
{
  GT.settings.Rigs.enable = rigEnable.checked;
  rigSettingsRender();
  rigConnectAll();
}

// A box's Connect unchecked: its rig let go (a second VFO: no longer read or tuned), its settings free to change; checked: locked, and
// connected with them. What BirdWatch follows is sent again once it is on
function rigConnectChanged(el)
{
  const v = rigVfoOfEl(el);
  if (v) rigVfoConnectSet(v, el.checked);
}

// A VFO's Connect (its box in Settings, or its dot in the BirdWatch panel's rig box)
function rigVfoConnectSet(v, on)
{
  v.connect = on;
  if (GT.rigDoppler) GT.rigDoppler.sentRx = GT.rigDoppler.sentTx = null;
  rigSettingsRender();
  // A second VFO's rig is polled for it (rigModeBWanted) without connecting again; a rig of its own, and the second VFO on it, as it is
  if (!rigVfoIsSecond(v)) rigConnect(GT.rigs[v.id]);
}

// Where a VFO is changed: a rig of its own, or the second VFO of another; its Connect left unchecked (it goes live once it is checked)
function rigVfoSourceChanged(el)
{
  const v = rigVfoOfEl(el);
  if (!v) return;
  const owner = rigVfoById(el.value);
  v.source = owner ? "of" : "own";
  v.of = owner ? owner.id : null;
  v.connect = false;
  rigVfosNormalize();
  rigLinksSync();
  if (!rigVfoIsSecond(v))
  {
    serialPortTell(rigPurpose(GT.rigs[v.id]), v.port);
    rigConnect(GT.rigs[v.id]);
  }
  rigSettingsRender();
}

// A VFO's own name, shown after its letter
function rigVfoNameChanged(el)
{
  const v = rigVfoOfEl(el);
  if (!v) return;
  v.name = el.value.trim().slice(0, 20);
  rigSettingsRender();
  rigLineRender();
}

// Add VFO: a rig of its own, not connected yet (its settings set first, then Connect checked)
function rigVfoAdd()
{
  if (rigVfos().length >= RIG_VFOS_MAX) return;
  const v = Object.assign({ id: rigVfoNewId(), name: "", connect: false, offset: 0, ssbData: false, source: "own", of: null }, RIG_LINK_DEFAULTS);
  rigVfos().push(v);
  rigLinksSync();
  rigSettingsRender();
}

// A VFO removed (its Connect unchecked first): its rig let go; a second VFO of it becomes a rig of its own, not connected. A feature
// that used it uses none until another is picked
function rigVfoRemove(el)
{
  const v = rigVfoOfEl(el);
  if (!v || v.connect !== false || rigVfos().length <= 1) return;
  GT.settings.Rigs.vfos = rigVfos().filter((x) => x !== v);
  // What picked it (a transmitter's own pick in BirdWatch, the Multi-Mode Decoder's modes) uses none from now on, not a VFO added later and
  // given its id (rigVfoNewId takes the lowest free one)
  const pins = GT.settings.BirdWatch.vfoPins || {};
  for (const uuid in pins)
  {
    for (const side of ["rx", "tx"]) if (pins[uuid][side] == v.id) delete pins[uuid][side];
    if (!pins[uuid].rx && !pins[uuid].tx) delete pins[uuid];
  }
  const modes = GT.settings.MMD.vfos || {};
  for (const mode in modes) if (modes[mode] == v.id) modes[mode] = "";
  rigVfosNormalize();
  rigLinksSync();
  rigSettingsRender();
  rigRolesChanged();
}

// SSB's Data: the digital modes set on this VFO in USB or LSB (the Multi-Mode Decoder's) set as its data mode
function rigSsbDataChanged(el)
{
  const v = rigVfoOfEl(el);
  if (v) v.ssbData = el.checked;
}

// Offset Hz takes digits and a minus sign
function rigOffsetKey(event)
{
  return event.charCode == 0 || /[0-9-]/.test(String.fromCharCode(event.charCode));
}

// An offset changed: kept when it is a whole number of hertz within the limit (otherwise the one before stays), and the frequencies
// followed sent again with it
function rigOffsetChanged(el)
{
  const v = rigVfoOfEl(el);
  if (!v) return;
  const text = el.value.replace(/[\s,._]/g, "");
  const value = /^-?\d+$/.test(text) ? Number(text) : NaN;
  if (Number.isFinite(value) && Math.abs(value) <= RIG_OFFSET_MAX) v.offset = value;
  if (GT.rigDoppler) GT.rigDoppler.sentRx = GT.rigDoppler.sentTx = null;
  rigSettingsRender();
}

// A serial line's level ("dtr" or "rts") as a protocol usually wants it (its lines: a newer Yaesu's RTS high), else low
function rigProtocolLine(protocol, line)
{
  const lines = RIG_PROTOCOLS[protocol] && RIG_PROTOCOLS[protocol].lines;
  return lines && RIG_LINE_LEVELS.includes(lines[line]) ? lines[line] : "low";
}

// A rig's protocol, port settings, address or host changed: connected again with them
function rigSettingsChanged(el)
{
  const v = rigVfoOfEl(el);
  const R = v ? GT.rigs[v.id] : null;
  if (!R) return;
  const S = rigSettingsOf(R);
  const protocolSelect = rigEl(R, "Protocol");
  // Another protocol: the port field still shows the old one's port, so it isn't read; the render below fills it with the new one's
  const sameProtocol = S.protocol == protocolSelect.value;
  S.protocol = protocolSelect.value;
  S.baud = Number(rigEl(R, "Baud").value);
  S.dataBits = Number(rigEl(R, "DataBits").value);
  S.parity = rigEl(R, "Parity").value;
  S.stopBits = Number(rigEl(R, "StopBits").value);
  // DTR and RTS: High or Low (the line PTT Method uses shows PTT, its own setting kept as it is)
  for (const [name, line] of [["Dtr", "dtr"], ["Rts", "rts"]]) if (RIG_LINE_LEVELS.includes(rigEl(R, name).value)) S[line] = rigEl(R, name).value;
  S.civAddress = rigEl(R, "CivValue").value.trim().toUpperCase();
  S.host = rigEl(R, "Host").value.trim();
  S.forceVfo = rigEl(R, "ForceVfo").checked;
  S.lanUser = rigEl(R, "LanUser").value.trim();
  S.lanPassword = rigEl(R, "LanPassword").value;
  // Another protocol: DTR and RTS as it usually wants them (rigProtocolLine)
  if (!sameProtocol) for (const line of ["dtr", "rts"]) S[line] = rigProtocolLine(S.protocol, line);
  if (sameProtocol)
  {
    const protocol = rigProtocolChosen(R);
    if (protocol.http) S.flrigPort = Number(rigEl(R, "NetPort").value) || 12345;
    else if (protocol.portKey) S[protocol.portKey] = Number(rigEl(R, "NetPort").value) || protocol.portDefault;
    else S.netPort = Number(rigEl(R, "NetPort").value) || 4532;
  }
  rigSettingsRender();
  rigConnect(R);
}

// PTT Method picked (changed with the rig connected too: it is read as the rig is keyed). A serial port's lines set again as its box
// says (rigPttLineDrop): the one the method names low, so the rig isn't left keyed by a line asserted before, the other as it is set
function rigPttChanged(el)
{
  const v = rigVfoOfEl(el);
  const R = v ? GT.rigs[v.id] : null;
  if (!R) return;
  const S = rigSettingsOf(R);
  S.ptt = RIG_PTT_METHODS.includes(rigEl(R, "Ptt").value) ? rigEl(R, "Ptt").value : "cat";
  rigPttLineDrop(R);
  rigSettingsRender();
}

function rigChoosePort(el)
{
  const v = rigVfoOfEl(el);
  const R = v ? GT.rigs[v.id] : null;
  if (!R) return;
  serialPortChoose(rigPurpose(R), (port) =>
  {
    rigSettingsOf(R).port = port;
    rigSettingsRender();
    rigConnect(R);
  });
}

// A rig's name: as rigctld or flrig said it; a serial rig's from its port's device id (IC-7300_...), else the Icom its address
// is the default of; "" when none is known
function rigModelName(R)
{
  if (R.model) return R.model;
  if (rigProtocolChosen(R).serial) return serialPortModel(rigSettingsOf(R).port) || (R.civFound && RIG_CIV_MODELS[R.civFound]) || "";
  return "";
}

// "14.074.000 (435.250.000) MHz USB (LSB)": the rig's VFO, its second VFO in brackets when a VFO in use is on it, the modes. The
// frequencies on the air: a VFO with an offset is the rig's dial less it, "LO" after it
function rigFrequencyText(R)
{
  if (R.freq === null) return "";
  const one = (dial, v) => formatDialFreq(dial - rigOffset(v)) + (rigOffset(v) ? " LO" : "");
  const second = rigVfos().find((v) => rigVfoIsSecond(v) && v.of == R.key && rigVfoOn(v));
  const showB = !!second && R.dual && R.freqB !== null;
  return one(R.freq, rigVfoById(R.key)) + (showB ? " (" + one(R.freqB, second) + ")" : "") + " MHz" + (R.mode ? " " + R.mode : "") + (showB && R.modeB ? " (" + R.modeB + ")" : "");
}

// Its link is open but the rig hasn't said its frequency in the time it should have: shown as No Answer (a wrong baud rate, the rig's
// CI-V USB port or CAT off). So is one that said it, then nothing for RIG_SILENT_MS (switched off behind its CI-V interface, rigctld
// answering RPRT -5), where each poll asks it (R.freqAt; not SmartSDR, which says it only as it changes): what it said last is then no
// longer taken for its frequency (rigVfoRead)
const RIG_NO_ANSWER_MS = 3000;
const RIG_SILENT_MS = 5000;

function rigNoAnswer(R)
{
  // A protocol that answers without saying a frequency (SDR++ Server, until it is tuned) says so itself
  if (R.protocol && R.protocol.answered && R.protocol.answered(R)) return false;
  if (R.status != "connected") return false;
  if (R.freq === null) return Date.now() - R.connectedAt > RIG_NO_ANSWER_MS;
  return R.freqAt > 0 && Date.now() - R.freqAt > RIG_SILENT_MS;
}

// VFO-A's frequency as the rig said it (asked by a poll, or told as its dial turned), and when (rigNoAnswer)
function rigFreqSaid(R, hz)
{
  R.freq = hz;
  R.freqAt = Date.now();
}

// A rig's status, in short: "Error", "No Port Chosen", "No Answer" ...
function rigStatusShort(R)
{
  if (rigNoAnswer(R)) return I18N("rig.status.noAnswer");
  return R.status == "error" ? I18N("rotor.status.errorShort") : I18N("rotor.status." + R.status).replace("{0}", R.error);
}

// The rig's box in the BirdWatch panel (a box like the sky plot's, its border yellow): BirdWatch's downlink VFO's frequency and mode on
// one row with Re-center, its uplink VFO's on the next with Lock VFOs (the uplink's mode "-" where the rig doesn't say its second VFO's),
// then Follow / Unfollow; a VFO's status instead of its frequency while it can't be read. The satellite's frequencies: a VFO with an
// offset shows the rig's dial less it, with the LO badge (its tooltip the offset and the dial). There while Rig Control is on. Each cell
// is written only when it changed (compared with what was written: innerHTML reads back in the browser's own form), so a click on an
// icon is never lost to a redraw
function rigLineRender()
{
  if (typeof birdWatchRigLine == "undefined") return;
  // Not there, nor read, while BirdWatch's own Rig Control is off (BirdWatch settings, General)
  const on = GT.settings.Rigs.enable && GT.settings.BirdWatch.autoRig !== false;
  birdWatchRigLine.style.display = on ? "" : "none";
  if (!on) return;
  const rx = rigRoleVfo("rx");
  // The uplink's row, not while following a transmitter with no uplink (a beacon, a downlink only): its VFO isn't tuned for it, so it
  // would show the last transmitter's
  const followed = GT.rigDoppler && typeof birdWatchStickyPrevious == "function" ? birdWatchStickyPrevious() : null;
  const tx = followed && !(followed.uplink_low > 0) ? null : rigRoleVfo("tx");
  const orange = (text) => "<span style='color:orange'>" + htmlEntities(text) + "</span>";
  const freq = (dial, v, color) => "<span style='color:" + color + "'>" + formatDialFreq(dial - rigOffset(v)) + rigLoBadge(rigOffset(v), dial) + "</span>";
  // Not read: its rig's status, "Off" for one not in use, "-" without a VFO (or a second VFO its rig hasn't)
  const status = (v, read) => (!v ? "-" : !rigVfoOn(v) ? I18N("rotor.status.off") : read.R && (read.R.status != "connected" || rigNoAnswer(read.R)) ? rigStatusShort(read.R) : "-");
  const cell = (el, html) =>
  {
    if (el.rigHtml === html) return;
    el.rigHtml = html;
    el.innerHTML = html;
  };
  const shown = (el, show) =>
  {
    const value = show ? "" : "none";
    if (el.style.display != value) el.style.display = value;
  };
  const a = rigVfoRead(rx);
  cell(birdWatchRigRxFreq, a.up ? freq(a.dial, rx, "yellow") : orange(status(rx, a)));
  cell(birdWatchRigRxMode, htmlEntities((a.up && a.mode) || "-"));
  const b = rigVfoRead(tx);
  for (const el of [birdWatchRigTxDot, birdWatchRigTxFreq, birdWatchRigTxMode, birdWatchRigLock]) shown(el, !!tx);
  // Re-center beside both rows when there's an uplink
  const recenterRows = tx ? "1 / span 2" : "1";
  if (birdWatchRecenterButton.rigRows != recenterRows)
  {
    birdWatchRecenterButton.rigRows = recenterRows;
    birdWatchRecenterButton.style.gridRow = recenterRows;
  }
  if (tx)
  {
    cell(birdWatchRigTxFreq, b.up ? freq(b.dial, tx, "#ffd27f") : orange(status(tx, b)));
    cell(birdWatchRigTxMode, htmlEntities((b.up && b.mode) || "-"));
  }
  // Each VFO's Connect, a dot before its frequency (birdWatchRigConnectToggle): light blue while it is connected and read, orange while it
  // is connecting, red when its rig can't be reached (an error, its port not there or not chosen, No Answer), grey while off; an off VFO's
  // frequency and mode dimmed
  const failed = (R) => !!R && (["error", "notFound", "noPort"].includes(R.status) || rigNoAnswer(R));
  const dot = (el, freqEl, modeEl, v, read) =>
  {
    const state = !v ? "none" : read.up ? "on" : !rigVfoOn(v) ? "off" : failed(read.R) ? "error" : "trying";
    if (el.dataset.state != state) el.dataset.state = state;
    const hover = v ? I18N("birdWatch.rig.connect.hover").replace("{vfo}", rigVfoLabel(v)) : "";
    if (el.title != hover) el.title = hover;
    const opacity = v && !rigVfoOn(v) ? "0.4" : "";
    if (freqEl.style.opacity != opacity) freqEl.style.opacity = modeEl.style.opacity = opacity;
  };
  dot(birdWatchRigRxDot, birdWatchRigRxFreq, birdWatchRigRxMode, rx, a);
  if (tx) dot(birdWatchRigTxDot, birdWatchRigTxFreq, birdWatchRigTxMode, tx, b);
  // Lock VFOs, there with an uplink (and a downlink to lock it to): locked lit, unlocked grey
  const locked = GT.settings.BirdWatch.lockVfos === true;
  birdWatchRigLock.style.visibility = rx && tx ? "" : "hidden";
  birdWatchRigLock.classList.toggle("active", locked);
  shown(birdWatchRigLocked, locked);
  shown(birdWatchRigUnlocked, !locked);
  const lockHover = I18N("birdWatch.rig.lockVfos.label") + "\n" + I18N("birdWatch.rig.lockVfos.hover");
  if (birdWatchRigLock.title != lockHover) birdWatchRigLock.title = lockHover;
  birdWatchRigButtonsRender();
}

// A VFO's dot in the rig box clicked: its Connect turned off, or on (a second VFO's own VFO with it, if that is off)
function birdWatchRigConnectToggle(side)
{
  const v = rigRoleVfo(side);
  if (!v) return;
  const on = !rigVfoOn(v);
  if (on && rigVfoIsSecond(v))
  {
    const owner = rigVfoOwner(v);
    if (owner && !rigVfoIsSecond(owner) && owner.connect !== true) rigVfoConnectSet(owner, true);
  }
  rigVfoConnectSet(v, on);
  rigLineRender();
}

// The user's tuning away from the Doppler frequency on a side BirdWatch follows (birdWatchSideTarget): "+120 Hz", "-1.25 kHz"; "" for none
function rigUserOffsetText(side)
{
  const D = GT.rigDoppler;
  const hz = D && D[side] && D.offset ? Math.round(D.offset[side] || 0) : 0;
  if (!hz) return "";
  return (hz > 0 ? "+" : "-") + (Math.abs(hz) < 1000 ? Math.abs(hz) + " Hz" : (Math.abs(hz) / 1000).toFixed(2) + " kHz");
}

// The rig box's Follow / Unfollow, while BirdWatch's Rig Control can follow the satellite selected; and Re-center while it follows, lit
// while the user's tuning is off the Doppler frequency (its tooltip says by how much)
function birdWatchRigButtonsRender()
{
  const T = GT.birdWatchTrack;
  const following = !!GT.rigDoppler;
  const show = GT.settings.BirdWatch.autoRig !== false && !!(T && T.selected) && rigRolesConnected();
  birdWatchRigButtons.style.display = show ? "" : "none";
  birdWatchRecenterButton.style.visibility = show && following ? "" : "hidden";
  if (!show) return;
  const label = I18N(following ? "birdWatch.rig.unfollow.label" : "birdWatch.rig.follow.label");
  const hover = I18N(following ? "birdWatch.rig.unfollow.hover" : "birdWatch.rig.follow.hover");
  if (birdWatchFollowButton.textContent != label) birdWatchFollowButton.textContent = label;
  if (birdWatchFollowButton.title != hover) birdWatchFollowButton.title = hover;
  const offsets = ["rx", "tx"].map(rigUserOffsetText).filter((text) => text);
  birdWatchRecenterButton.classList.toggle("active", offsets.length > 0);
  const recenterHover = I18N("birdWatch.rig.recenter.label") + (offsets.length ? " (" + offsets.join(", ") + ")" : "") + "\n" + I18N("birdWatch.rig.recenter.hover") +
    (offsets.length ? "\n" + I18N("rig.userOffset.hover") : "");
  if (birdWatchRecenterButton.title != recenterHover) birdWatchRecenterButton.title = recenterHover;
}

function rigStatusRender(R)
{
  // A second VFO on this rig says how it reads too; BirdWatch's line follows
  for (const v of rigVfos()) if (rigVfoIsSecond(v) && v.of == R.key) rigVfoSecondStatusRender(v);
  rigLineRender();
  if (typeof birdWatchSatRigAvailable == "function") birdWatchSatRigAvailable();
  // A protocol's own rows (SDR++ Server's menus) follow its state too
  if (R.protocol && R.protocol.render) R.protocol.render(R);
  const statusEl = rigEl(R, "Status");
  if (!statusEl) return;
  // No Answer: what it said last isn't shown
  const quiet = rigNoAnswer(R);
  let text = quiet ? I18N("rig.status.noAnswer") : I18N("rotor.status." + R.status).replace("{0}", R.error);
  // A rig with a second VFO that can be read and set is said so
  if (R.status == "connected" && R.dual && !quiet) text += " (" + I18N("rig.twoVfos") + ")";
  if (R.status == "connected" && rigModelName(R)) text += "  " + rigModelName(R);
  if (R.status == "connected" && R.freq !== null && !quiet) text += "  " + rigFrequencyText(R);
  // A serial port that couldn't be opened is said in full under Choose Port, with the way to share the rig; Status says it in short
  const portError = rigProtocolChosen(R).serial && (R.status == "error" || R.status == "notFound");
  const portErrorEl = rigEl(R, "PortError");
  portErrorEl.style.display = portError ? "" : "none";
  portErrorEl.textContent = portError ? (R.status == "error" ? I18N("serial.inUse").replace("{0}", serialPortShortName(rigSettingsOf(R).port)) + "\n" + R.error : text) : "";
  if (portError) text = I18N("rotor.status.errorShort");
  statusEl.textContent = text;
  statusEl.style.color = quiet ? "orange" : { connected: "lightgreen", connecting: "yellow", error: "#ff8080", noPort: "orange", notFound: "orange" }[R.status] || "#ccc";
  // The CI-V address the rig answered from, beside the field
  rigEl(R, "CivFound").textContent = R.civFound && R.status == "connected" ? I18N("rig.civ.found").replace("{0}", R.civFound.toString(16).toUpperCase().padStart(2, "0")) + (RIG_CIV_MODELS[R.civFound] ? "  ·  " + RIG_CIV_MODELS[R.civFound] : "") : "";
}

function rigSetStatus(R, status, error = "")
{
  if (status == "connected" && R.status != "connected") R.connectedAt = Date.now();
  R.status = status;
  R.error = error;
  rigStatusRender(R);
}

function rigInit()
{
  // Asked before GridTracker2 closes or restarts with a rig keyed (rigPttTell)
  electron.ipcRenderer.on("rigPttUnkeyBeforeClose", rigPttUnkeyBeforeClose);
  rigVfosNormalize();
  rigLinksSync();
  for (const R of Object.values(GT.rigs)) serialPortTell(rigPurpose(R), rigSettingsOf(R).port);
  rigSettingsRender();
  rigConnectAll();
}

// ---- The link (each rig its own)

// The link let go; what it returns is settled once it is (a serial port takes a moment: R.closing). A rig keyed here is unkeyed first,
// straight on the link (past the queue, let go here), and so is an unkey still waiting in the queue; a serial port is then closed only
// once that has gone out (Node's: drained; Web Serial's: once it has had the time to, RIG_UNKEY_CLOSE_MS). lost (rigFail): the link may
// not carry it, so the rig stays as keyed here, and is unkeyed again at the next connection's first read (rigReadWhole)
function rigDisconnect(R, lost = false)
{
  let unkeyed = false;
  if (R.pttKeyed && R.link)
  {
    unkeyed = rigPttUnkeyNow(R);
    if (!lost) R.pttKeyed = null;
  }
  // An unkey still waiting in a serial rig's queue (rigPttRelease, behind frames not answered yet): with nothing keyed here, the PTT
  // command queued last is one (a key is kept in R.pttKeyed until unkeyed). Lost: kept as a key is, for no VFO in particular
  else if (R.writer && R.pttData !== null && R.queue.includes(R.pttData))
  {
    R.writer.write(typeof R.pttData == "string" ? new TextEncoder().encode(R.pttData) : R.pttData).catch(() => {});
    unkeyed = true;
    if (lost) R.pttKeyed = { method: "cat", vfo: null, generation: R.generation };
  }
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
  R.netAnswers = [];
  R.httpChain = Promise.resolve();
  nodeTimers.clearTimeout(R.waiting);
  R.waiting = null;
  // (Told once its queue is let go: an unkey in it no longer waits there, rigPttUnkeyQueued)
  rigPttTell();
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
  // Node's serialport (serialPorts.js): its close keeps what was written, and an unkey just written is drained (sent) first
  if (link.node)
  {
    return (R.closing = (async () =>
    {
      if (unkeyed) await link.drain().catch(() => {});
      await link.close().catch(() => {});
    })());
  }
  if (typeof link.getInfo == "function")
  {
    return (R.closing = (async () =>
    {
      if (unkeyed) await new Promise((resolve) => nodeTimers.setTimeout(resolve, RIG_UNKEY_CLOSE_MS));
      try { if (reader) await reader.cancel(); } catch (e) { /* done already */ }
      try { await link.close(); } catch (e) { /* closed already, or gone */ }
    })());
  }
  return Promise.resolve();
}

// A Web Serial port's close throws away what it hasn't sent yet (Chromium's close purges both ways; a write is done once its bytes are
// handed on, not once they are sent): one an unkey was just written to is closed this much later, time for it to go out at the slowest
// baud rate (a CI-V frame takes under 20 ms at 4800). (Node's serialport is drained instead: rigDisconnect)
const RIG_UNKEY_CLOSE_MS = 250;

// A serial rig that can't be opened (its port not there: the radio switched off or unplugged, a USB port not there yet at startup; or
// held: by a GridTracker just closed, by another program) is tried again this many times this far apart, then every RIG_RETRY_MS, for
// as long as its Connect is checked, so it connects by itself once its port is back. Its Connect is never unchecked here
const RIG_SERIAL_TRIES = 5;
const RIG_SERIAL_RETRY_MS = 2000;

// retry: a serial rig tried again (rigSerialRetry), its status still saying why it couldn't be opened until this try is answered;
// otherwise a connect of its own, which starts its tries again
async function rigConnect(R, retry = false)
{
  if (!retry) R.openTries = 0;
  // (A serial port's close still under way from before too: it can't be opened again until that is done)
  const closing = Promise.all([R.closing, rigDisconnect(R)]);
  R.freq = R.mode = R.freqB = R.modeB = null;
  R.freqAt = 0;
  R.modeBAsk = true;
  R.dual = null;
  R.mainSub = false;
  R.vfoMode = null;
  R.plainQueue = [];
  R.answerB = false;
  R.vfoWarned = false;
  R.split = false;
  R.civFound = null;
  R.civProbe = 0;
  R.civMode = R.dataMode = null;
  R.dataAsk = true;
  R.model = null;
  R.catId = null;
  R.toneFreq = R.toneFunc = null;
  R.toneOn = false;
  R.ranges = R.rangeSection = null;
  R.scope = rigScopeState();
  if (!rigWanted(R))
  {
    rigSetStatus(R, "off");
    return;
  }
  R.protocol = rigProtocolChosen(R);
  const generation = R.generation;
  if (!retry || !["error", "notFound"].includes(R.status)) rigSetStatus(R, "connecting");
  await closing;
  if (generation != R.generation) return;
  // A protocol with a transport of its own (Icom LAN's UDP streams) opens itself
  const open = R.protocol.open ? R.protocol.open(R, generation) : R.protocol.serial ? rigOpenSerial(R, generation) : R.protocol.http ? rigOpenHttp(R, generation) : rigOpenNet(R, generation);
  open.catch((e) =>
  {
    if (generation == R.generation) rigFail(R, e && e.message ? e.message : String(e));
  });
}

// Lost, or rigctld / flrig not there (yet): tried again in a while, as long as the rig is wanted. A serial rig that never got there:
// tried again in a moment, then in a while (rigSerialRetry), its Connect left checked and why it failed showing meanwhile.
// A rig keyed here is unkeyed as the link goes, and again once connected (rigDisconnect)
function rigFail(R, message)
{
  const retry = R.status == "connected" || !(R.protocol && R.protocol.serial);
  rigDisconnect(R, true);
  rigSetStatus(R, "error", message);
  if (retry) R.retryTimer = nodeTimers.setTimeout(() => rigConnect(R), RIG_RETRY_MS);
  else rigSerialRetry(R);
}

// A serial rig's open tried again: in a moment for its first RIG_SERIAL_TRIES tries, then every RIG_RETRY_MS (rigConnect lets it go
// once it is no longer wanted)
function rigSerialRetry(R)
{
  R.openTries = (R.openTries || 0) + 1;
  R.retryTimer = nodeTimers.setTimeout(() => rigConnect(R, true), R.openTries <= RIG_SERIAL_TRIES ? RIG_SERIAL_RETRY_MS : RIG_RETRY_MS);
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
    rigSerialRetry(R);
    return;
  }
  const options = { baudRate: Number(S.baud) || 19200, dataBits: Number(S.dataBits) == 7 ? 7 : 8, stopBits: Number(S.stopBits) == 2 ? 2 : 1, parity: ["none", "even", "odd"].includes(S.parity) ? S.parity : "none" };
  // Node's serialport: both lines as its box says, the one PTT Method names low, set as it opens (it opens with them low)
  const lines = rigPttLineLevels(R);
  if (port.node) Object.assign(options, { dtr: lines.dataTerminalReady, rts: lines.requestToSend });
  await port.open(options);
  if (generation != R.generation)
  {
    port.close().catch(() => {});
    return;
  }
  R.link = port;
  R.writer = port.node ? port.writer : port.writable.getWriter();
  // Web Serial: both lines set as its box says (the port opens with them asserted), the one PTT Method names low, so the rig isn't keyed
  // by connecting
  if (!port.node) rigPttLineDrop(R);
  port.addEventListener("disconnect", () =>
  {
    if (generation == R.generation) rigFail(R, "disconnected");
  });
  if (port.node)
  {
    // What comes in (Node's), and an error the port reports, as a Web Serial read's
    port.ondata = (bytes) =>
    {
      if (generation == R.generation) rigReceive(R, bytes);
    };
    port.addEventListener("error", (e) =>
    {
      if (generation == R.generation) rigFail(R, e.message);
    });
  }
  else rigReadSerial(R, port, generation);
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
    // Text lines, but bytes for a protocol that reads its own (SPY Server's)
    if (!R.protocol.raw) socket.setEncoding("utf8");
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
    const port = R.protocol.portKey ? Number(S[R.protocol.portKey]) || R.protocol.portDefault : Number(S.netPort) || 4532;
    socket.connect(port, S.host || "127.0.0.1");
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
      // Closed before its end (flrig gone mid-answer: no end, and no error either): a failure, or the calls after it would wait for good
      response.on("close", () => reject(new Error("closed")));
    });
    request.on("error", reject);
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.end(body);
  });
}

// A poll, after the settings sent before it (in the one chain with them): what it reads reflects them
async function rigHttpPoll(R, generation)
{
  if (R.busy) return;
  R.busy = true;
  const seq = R.tuneSeq;
  const run = R.httpChain.then(() => rigHttpPollNow(R, generation, seq));
  R.httpChain = run.catch(() => {});
  try
  {
    await run;
  }
  finally
  {
    R.busy = false;
  }
}

async function rigHttpPollNow(R, generation, seq)
{
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
    rigFreqSaid(R, Number(freq) || null);
    R.mode = mode || null;
    if (R.dual !== false)
    {
      R.dual = freqB !== null;
      R.freqB = freqB;
      R.modeB = modeB;
    }
    R.readSeq = Math.max(R.readSeq, seq);
    if (R.status != "connected") rigSetStatus(R, "connected");
    else rigStatusRender(R);
    rigReadWhole(R);
  }
  catch (e)
  {
    if (generation == R.generation) rigFail(R, e.message);
  }
}

function rigConnected(R)
{
  // A rig that can't say what it is: the protocol names it (the FT-817's)
  if (R.protocol.model) R.model = R.protocol.model;
  rigSetStatus(R, "connected");
  if (R.protocol === RIG_PROTOCOLS.rigctld) rigNetChkVfoAsk(R);
  if (R.protocol.caps) rigWrite(R, R.protocol.caps(R));
  rigPoll(R);
  R.pollTimer = nodeTimers.setInterval(() => rigPoll(R), RIG_POLL_MS);
}

// The poll's asks, then (serial) a mark in the queue: once the queue reaches it, they have been answered, and what was read reflects the
// settings sent before the poll (readSeq)
function rigPoll(R)
{
  // Nothing in to show it, while the rig doesn't answer (or has gone quiet): its status shown as the poll goes (No Answer, rigNoAnswer)
  if (R.freq === null || rigNoAnswer(R)) rigStatusRender(R);
  const asks = R.protocol.poll(R);
  const seq = R.tuneSeq;
  for (const ask of Array.isArray(asks) ? asks : [asks]) rigWrite(R, ask, seq);
  if (R.writer) rigWrite(R, { readMark: seq });
  rigScopeSync(R);
}

// A poll now, besides the regular ones (after a setting: what the rig made of it)
function rigPollSoon(R)
{
  if (R.status != "connected" || !R.protocol) return;
  if (R.protocol.http) rigHttpPoll(R, R.generation);
  else rigPoll(R);
}

// rigctld's name for VFO-A ("a") or VFO-B on the same rig ("b"), as its backend names its VFOs
function rigNetVfo(R, vfo)
{
  if (R.mainSub) return vfo == "a" ? "Main" : "Sub";
  return vfo == "a" ? "VFOA" : "VFOB";
}

// What a rigctld command for VFO-A takes after it in VFO mode (" Main", " VFOA"), else nothing (the Multi-Mode Decoder's own commands)
function rigNetVfoArg(R)
{
  return R.vfoMode ? " " + rigNetVfo(R, "a") : "";
}

// rigctld: whether it runs in VFO mode, asked before anything else. Its answer has no RPRT line ("ChkVFO: 0", or "1" alone), so it isn't
// counted as one (netAnswers); an old Hamlib that doesn't know it answers RPRT and an error. Not answered in a while: taken as no.
// Force VFO Mode (the rig's settings): VFO mode asked for first (\set_vfo_opt 1, for this connection alone), its answer passed over
// the same way (vfoOptPending)
const RIG_CHK_VFO_MS = 3000;

function rigNetChkVfoAsk(R)
{
  const generation = R.generation;
  R.vfoOptPending = rigSettingsOf(R).forceVfo === true;
  try
  {
    R.link.write((R.vfoOptPending ? "+\\set_vfo_opt 1\n" : "") + "+\\chk_vfo\n");
  }
  catch (e)
  {
    rigFail(R, e.message);
    return;
  }
  nodeTimers.setTimeout(() =>
  {
    if (generation == R.generation && R.vfoMode === null) rigNetVfoKnown(R, false);
  }, RIG_CHK_VFO_MS);
}

// A line in while VFO mode isn't known yet: the answer to \chk_vfo (asked first, so the first lines are its). True when it was
function rigNetChkVfo(R, line)
{
  if (R.vfoMode !== null) return false;
  // \set_vfo_opt's answer first, up to its RPRT (an error there: \chk_vfo says what it came to)
  if (R.vfoOptPending)
  {
    if (/^RPRT\s/.test(line)) R.vfoOptPending = false;
    return true;
  }
  const m = /^(?:ChkVFO:\s*)?([01])$/i.exec(line.trim());
  if (m) rigNetVfoKnown(R, m[1] == "1");
  else if (/^RPRT\s/.test(line)) rigNetVfoKnown(R, false);
  return true;
}

function rigNetVfoKnown(R, vfoMode)
{
  R.vfoMode = vfoMode;
  rigNetVfoWarn(R);
  rigPoll(R);
}

// A Main/Sub rig whose rigctld isn't in VFO mode: its VFO-B isn't tuned (rigTuneCanTx). An error in the Event Viewer (opened for it, as
// set) once a connection, as soon as both are known (the capabilities' VFO list, and VFO mode)
function rigNetVfoWarn(R)
{
  if (R.vfoWarned || R.vfoMode !== false || !R.mainSub) return;
  R.vfoWarned = true;
  addEvent("rig", "<font style='color:red'>" + htmlEntities(I18N("rig.event.needVfoMode").replace("{rig}", R.model || "rigctld")) + "</font>", true);
}

// rigctld: one RPRT line ends each command's answer; a poll's last one means it was read whole
function rigNetAnswered(R)
{
  const head = R.netAnswers[0];
  if (!head) return;
  if (--head.count > 0) return;
  R.netAnswers.shift();
  if (head.seq === null) return;
  R.readSeq = Math.max(R.readSeq, head.seq);
  rigReadWhole(R);
}

// A whole poll read: counted, and BirdWatch's Doppler following is told at once, so what it sets next is decided on a read only moments
// old (a turn of the rig's knob is less likely to be overwritten). A rig still keyed here from a connection before this one (lost while
// keyed: rigDisconnect) is unkeyed now that this one reads
function rigReadWhole(R)
{
  R.readCount++;
  if (R.pttKeyed && R.pttKeyed.generation != R.generation) rigPttRelease(R);
  if (typeof birdWatchDopplerFollow == "function") birdWatchDopplerFollow();
}

// pollSeq: a poll's ask, and the settings sent before it (rigctld counts its answers)
function rigWrite(R, data, pollSeq = null)
{
  if (!R.link || data === null) return;
  // A serial rig takes one command at a time: queued, sent as the one before is answered (a backlog, when it doesn't answer, is capped:
  // the oldest let go, never the PTT command queued last, so an unkey isn't lost while the rig doesn't answer)
  if (R.writer)
  {
    if (R.queue.length >= RIG_QUEUE_MAX)
    {
      const at = R.queue.findIndex((item) => item !== R.pttData);
      R.queue.splice(at < 0 ? 0 : at, 1);
    }
    R.queue.push(data);
    rigDrain(R);
    return;
  }
  if (R.protocol === RIG_PROTOCOLS.rigctld)
  {
    // Answers that never came (a server that doesn't end each with RPRT) aren't waited for without end
    if (R.netAnswers.length > 50) R.netAnswers = [];
    R.netAnswers.push({ count: (String(data).match(/\n/g) || []).length, seq: pollSeq });
  }
  // A protocol that keeps its own account of the answers to come (SDR++ (rigctl)): told what goes out
  if (R.protocol.wrote) R.protocol.wrote(data, R, pollSeq);
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
  // A poll's mark (rigPoll): everything before it has been answered
  if (data.readMark !== undefined)
  {
    R.readSeq = Math.max(R.readSeq, data.readMark);
    rigReadWhole(R);
    rigDrain(R);
    return;
  }
  R.lastSent = data;
  if (R.protocol.beforeSend) R.protocol.beforeSend(data, R);
  const answered = !R.protocol.replies || R.protocol.replies(data);
  R.waiting = nodeTimers.setTimeout(() =>
  {
    R.waiting = null;
    rigDrain(R);
  }, answered ? RIG_REPLY_MS : R.protocol.gapMs || RIG_GAP_MS);
  R.writer.write(typeof data == "string" ? new TextEncoder().encode(data) : data).catch((e) => rigFail(R, e.message));
  // The PTT command queued last, out now: the main process told, an unkey no longer waiting (rigPttUnkeyQueued)
  if (data === R.pttData) rigPttTell();
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
      // From the rig to us (E0: not our own frame echoed, nor its transceive broadcast to 00 as its dial turns): the command out is
      // answered, the next can go. Not by the band scope's sweeps (27 00): they come by themselves, many a second, and answer nothing
      if (frame[2] == 0xe0 && frame[3] != 0xe0 && !(frame[4] == 0x27 && frame[5] == 0x00)) rigReplied(R);
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
    if (R.protocol === RIG_PROTOCOLS.rigctld && rigNetChkVfo(R, line)) continue;
    const problem = R.protocol.parse(line, R);
    if (problem) R.error = problem;
    if (R.protocol === RIG_PROTOCOLS.rigctld && /^RPRT\s/.test(line)) rigNetAnswered(R);
    if (R.protocol.split) rigReplied(R);
  }
  rigStatusRender(R);
}

// ---- Tuning: for BirdWatch's Doppler, and the Multi-Mode Decoder (a signal clicked, the band scan: the rx alone). The rosters (the Feed Roster's
// spots too) tune through WSJT-X and the loggers as before, never through Rig Control

// The VFOs set to what is given of { rxVfo, rx, mode, data, tx, txMode, tone } (data: the mode's data variant, true, or plain, false: the
// Multi-Mode Decoder's FT8 frequencies), rx and tx frequencies on the air (each VFO's offset is added to what is sent: rigOffset). rx (Hz)
// and mode ("USB", "FM", ...) on the VFO rxVfo names (an id; not given: BirdWatch's downlink VFO), a second VFO through its rig's
// setTx and setTxMode, without split; tx (Hz) and txMode on BirdWatch's uplink VFO (only one that can: rigTuneCanTx): a rig of its own
// as its VFO, or a rig's second VFO with split on (its mode where the protocol can set it: rigctld, flrig, CI-V); tone (Hz) the uplink's
// CTCSS tone turned on (0: turned off, if it was turned on here; only a rig that can: rigTuneCanTone); verify false: the frequencies not
// read back (rigVerifyLater). True when something was sent
function rigTune(spec)
{
  if (typeof spec != "object" || spec === null) return false;
  // Each rig's steps, in order
  const steps = new Map();
  // (A step of several frames, CI-V's, each its own: queued one after another, each sent once the one before is answered. flrig's
  // steps are arrays too, [method, params]: one step each)
  const add = (R, step) =>
  {
    if (!steps.has(R)) steps.set(R, []);
    if (Array.isArray(step) && step.length && step.every((s) => s instanceof Uint8Array)) steps.get(R).push(...step);
    else steps.get(R).push(step);
  };
  // The frequencies sent, read back later ([VFO, dial]: rigVerifyLater)
  const verify = [];
  const rx = spec.rxVfo !== undefined ? rigVfoById(spec.rxVfo) : rigRoleVfo("rx");
  const rxR = rx && rigVfoOn(rx) ? rigVfoLink(rx) : null;
  if (rxR && rxR.status == "connected" && rxR.protocol)
  {
    // A dial is never sent below 1 Hz
    const dial = spec.rx > 0 ? spec.rx + rigOffset(rx) : 0;
    if (dial > 0 && (!rigVfoIsSecond(rx) || rxR.dual === true)) verify.push([rx, dial]);
    if (!rigVfoIsSecond(rx))
    {
      if (dial > 0) add(rxR, rxR.protocol.setFreq(dial, rxR));
      if (spec.mode) add(rxR, rxR.protocol.setMode(spec.mode, rxR, spec.data));
    }
    else if (rxR.dual === true)
    {
      if (dial > 0 && rxR.protocol.setTx) add(rxR, rxR.protocol.setTx(dial, rxR));
      if (spec.mode && rxR.protocol.setTxMode) add(rxR, rxR.protocol.setTxMode(spec.mode, rxR));
    }
  }
  const tx = rigRoleVfo("tx");
  if ((spec.tx > 0 || spec.txMode) && rigTuneCanTx())
  {
    const R = rigVfoLink(tx);
    const dial = spec.tx > 0 ? spec.tx + rigOffset(tx) : 0;
    if (dial > 0) verify.push([tx, dial]);
    if (!rigVfoIsSecond(tx))
    {
      if (dial > 0) add(R, R.protocol.setFreq(dial, R));
      if (spec.txMode) add(R, R.protocol.setMode(spec.txMode, R));
    }
    else if (dial > 0 || (spec.txMode && R.protocol.setTxMode))
    {
      if (!R.split)
      {
        add(R, R.protocol.splitOn(R));
        R.split = true;
      }
      if (dial > 0) add(R, R.protocol.setTx(dial, R));
      if (spec.txMode && R.protocol.setTxMode) add(R, R.protocol.setTxMode(spec.txMode, R));
    }
  }
  if (spec.tone !== undefined && spec.tone !== null && rigTuneCanTone())
  {
    const U = rigVfoLink(tx);
    if (spec.tone > 0 || U.toneOn)
    {
      const tone = U.protocol.setTone(spec.tone, U, rigVfoIsSecond(tx) ? "b" : "a");
      for (const step of Array.isArray(tone) ? tone : [tone]) add(U, step);
      U.toneOn = spec.tone > 0;
    }
  }
  let sent = false;
  for (const [R, list] of steps) if (rigSend(R, list)) sent = true;
  if (sent && spec.verify !== false) for (const [v, dial] of verify) rigVerifyLater(v, dial);
  return sent;
}

// A rig's steps out: flrig's calls one after another (one that fails once its connection was let go is passed over), the others
// written (serial: queued); true when there were any
function rigSend(R, steps)
{
  const sent = steps.filter((step) => step !== null && step !== undefined);
  if (sent.length == 0) return false;
  R.tuneSeq++;
  if (R.protocol.http)
  {
    const generation = R.generation;
    let chain = R.httpChain;
    for (const [method, params] of sent) chain = chain.then(() => rigHttpCall(R, method, params));
    chain.catch((e) => { if (generation == R.generation) rigFail(R, e.message); });
    R.httpChain = chain.catch(() => {});
    return true;
  }
  for (const step of sent) rigWrite(R, step);
  return true;
}

// Whether the uplink (TX) can be tuned: BirdWatch's uplink VFO (a transmitter's; left out, the one followed) is in use and its rig
// connected, and (a rig's second VFO) the rig has one that answers; never without an uplink VFO
function rigTuneCanTx(t)
{
  const tx = rigRoleVfo("tx", t);
  if (!tx || !rigVfoOn(tx)) return false;
  const R = rigVfoLink(tx);
  if (!R || R.status != "connected" || !R.protocol) return false;
  if (!rigVfoIsSecond(tx)) return true;
  // A Main/Sub rigctld rig only in VFO mode (rigNetVfoWarn)
  return R.dual === true && !(R.mainSub && R.vfoMode === false);
}

// Whether a CTCSS tone can be set on the uplink's rig: a CI-V rig, or one rigctld says can (flrig has no call for it)
function rigTuneCanTone(t)
{
  if (!rigTuneCanTx(t)) return false;
  const U = rigVfoLink(rigRoleVfo("tx", t));
  return typeof U.protocol.setTone == "function" && U.protocol.canTone(U);
}

// ---- The band scope (Use Scope If Present, a CI-V rig's box): an Icom's own spectrum scope (the IC-7300, 705, 9700, 7610 ...), shown in
// the Multi-Mode Decoder (mmdScope.js). Its data is asked for (27 11 01) only while the decoder's window wants it (rigScopeWant, renewed
// as it draws) and stopped (27 11 00) once it doesn't; the rig's own scope (27 10) is never turned on or off here. Each sweep comes as
// frames of 27 00, numbered (11 over USB): the first its settings (Center or Fixed mode, the center and the span either side or the
// edges, and whether it is out of range), the rest its trace, 475 points from 0 to 160. The rig sends it only over its USB port, with
// its CI-V USB Port unlinked from [REMOTE] (else it refuses: NG), and it needs RIG_SCOPE_BAUD to keep up (a sweep is about 600 bytes,
// a few a second)
const RIG_SCOPE_BAUD = 115200;
// The spans the rig has (Hz either side of the center: 27 15), narrowest first
const RIG_SCOPE_SPANS = [2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000];
// The decoder's window asking for it this long ago (ms) no longer wants it (it closed); a sweep this old is gone (ms)
const RIG_SCOPE_WANT_MS = 3000;
const RIG_SCOPE_STALE_MS = 3000;
// The VFO whose rig's scope the decoder's window wants: { id, at (when it last said so) }, or null
GT.rigScopeWant = null;

// A connection's scope, as read: on (27 11 as last sent: true, false, or null not yet), radioOn (27 10 as last read: the rig's own scope
// shown), refused (NG to 27 11 01), mode (27 14: 0 Center, 1 Fixed, 2 SCROLL-C, 3 SCROLL-F), span (Hz either side, Center modes), the
// sweep being put together (building) and the newest whole one (sweep: { low, high, center, outOfRange, points, at, seq })
function rigScopeState()
{
  return { on: null, radioOn: null, refused: false, mode: null, span: null, building: null, sweep: null, seq: 0, askedOnAt: 0 };
}

// From the decoder's window as it draws: the VFO (id) whose rig's scope it shows, or null for none
function rigScopeWant(vfoId)
{
  GT.rigScopeWant = vfoId ? { id: vfoId, at: Date.now() } : null;
  for (const R of Object.values(GT.rigs)) rigScopeSync(R);
}

// Whether a rig's scope data is wanted now: Use Scope If Present on, a CI-V rig connected fast enough that hasn't refused it, and the
// decoder's window showing it lately
function rigScopeWanted(R)
{
  const S = rigSettingsOf(R);
  const want = GT.rigScopeWant;
  if (S.useScope !== true || S.protocol != "civ" || R.status != "connected" || !R.scope || R.scope.refused) return false;
  if (Number(S.baud) < RIG_SCOPE_BAUD || !want || Date.now() - want.at > RIG_SCOPE_WANT_MS) return false;
  return rigVfoLink(rigVfoById(want.id)) === R;
}

// Its data asked for or stopped as wanted (each poll, and as the decoder's window says); asked for: the rig's own scope (on or off), its
// mode and its span read with it, and its own scope read again each poll while no sweep comes (it may be turned on at the rig). A rig with
// Use Scope If Present whose stream isn't known (a connection's first) has it stopped once, so one left on doesn't run unread
function rigScopeSync(R)
{
  if (!R.scope || R.status != "connected" || !R.protocol || !R.protocol.binary || R.protocol !== RIG_PROTOCOLS.civ) return;
  const C = R.scope;
  const address = rigCivAddress(R);
  if (rigScopeWanted(R))
  {
    if (C.on !== true)
    {
      C.on = true;
      C.askedOnAt = Date.now();
      for (const frame of [rigCivFrame(address, 0x27, [0x10]), rigCivFrame(address, 0x27, [0x11, 0x01]), rigCivFrame(address, 0x27, [0x14, 0x00]), rigCivFrame(address, 0x27, [0x15, 0x00])]) rigWrite(R, frame);
    }
    else if (!(C.sweep && Date.now() - C.sweep.at < RIG_SCOPE_STALE_MS) && Date.now() - C.askedOnAt > RIG_SCOPE_STALE_MS) rigWrite(R, rigCivFrame(address, 0x27, [0x10]));
    return;
  }
  if (C.on === true || (C.on === null && rigSettingsOf(R).useScope === true))
  {
    C.on = false;
    C.building = C.sweep = null;
    rigWrite(R, rigCivFrame(address, 0x27, [0x11, 0x00]));
  }
}

// An answer or a sweep's frame (27, data from its subcommand on)
function rigScopeRead(R, data)
{
  const C = R.scope;
  if (!C) return;
  const sub = data[0];
  if (sub == 0x10 && data.length >= 2)
  {
    const radioOn = data[1] == 0x01;
    if (radioOn !== C.radioOn)
    {
      C.radioOn = radioOn;
      rigScopeWarnRender(R);
    }
  }
  else if (sub == 0x14 && data.length >= 3) C.mode = data[2];
  else if (sub == 0x15 && data.length >= 7) C.span = rigCivBcdToHz(data.slice(2, 7));
  // A sweep's frame: 00 (the main scope), its number and how many there are (BCD), then the first's settings or the others' trace
  else if (sub == 0x00 && data.length >= 4 && C.on === true) rigScopeFrame(R, C, data);
}

function rigScopeFrame(R, C, data)
{
  const bcd = (b) => (b >> 4) * 10 + (b & 0x0f);
  const number = bcd(data[2]);
  const count = bcd(data[3]);
  if (number == 1)
  {
    C.building = null;
    // Its mode, two frequencies (the center and the span either side, in the Center modes; the low and high edges, in the Fixed modes:
    // five BCD bytes each, the lowest digits first) and whether it is out of range
    if (data.length < 16) return;
    const mode = data[4];
    const a = rigCivBcdToHz(data.slice(5, 10));
    const b = rigCivBcdToHz(data.slice(10, 15));
    const center = mode == 0x00 || mode == 0x02;
    C.mode = mode;
    if (center) C.span = b;
    C.building = { low: center ? a - b : a, high: center ? a + b : b, center: center, outOfRange: data[15] == 0x01, points: [], next: 2 };
    // Out of range: no trace comes
    if (count <= 1 || C.building.outOfRange) rigScopeDone(R, C);
    return;
  }
  const B = C.building;
  // One missed: this sweep is let go, the next one taken whole
  if (!B || number != B.next)
  {
    C.building = null;
    return;
  }
  for (let i = 4; i < data.length; i++) B.points.push(data[i]);
  B.next++;
  if (number >= count) rigScopeDone(R, C);
}

// A whole sweep: kept, and given to the decoder's window
function rigScopeDone(R, C)
{
  const B = C.building;
  C.building = null;
  C.sweep = { low: B.low, high: B.high, center: B.center, outOfRange: B.outOfRange, points: Uint8Array.from(B.points), at: Date.now(), seq: ++C.seq };
  if (C.radioOn !== true)
  {
    C.radioOn = true;
    rigScopeWarnRender(R);
  }
  if (!GT.mmDecoderInitialized || !GT.mmDecoderHandle) return;
  try
  {
    const w = GT.mmDecoderHandle.window;
    if (typeof w.mmdScopeSweep == "function") w.mmdScopeSweep(C.sweep);
  }
  catch (e)
  {
    // The window is closing
  }
}

// NG to 27 11 01: not asked again on this connection (Use Scope If Present turned off and on asks again)
function rigScopeRefused(R)
{
  if (!R.scope) return;
  R.scope.refused = true;
  R.scope.on = false;
  rigScopeWarnRender(R);
}

// The scope of a VFO's rig (an id), for the decoder's window: null without Use Scope If Present (or not a CI-V rig); else { state: "ok"
// (sweeps coming), "waiting", "noRig" (not connected), "slow" (under RIG_SCOPE_BAUD), "refused", "radioOff" (the rig's own scope off),
// sweep (the newest), span (Hz either side), center (a Center mode: its span can be changed), spans }
function rigScopeStatus(vfoId)
{
  const R = rigVfoLink(rigVfoById(vfoId));
  if (!R) return null;
  const S = rigSettingsOf(R);
  if (S.protocol != "civ" || S.useScope !== true) return null;
  const C = R.scope;
  const fresh = !!(C && C.sweep && Date.now() - C.sweep.at < RIG_SCOPE_STALE_MS);
  let state = "waiting";
  if (R.status != "connected") state = "noRig";
  else if (Number(S.baud) < RIG_SCOPE_BAUD) state = "slow";
  else if (C && C.refused) state = "refused";
  else if (fresh) state = "ok";
  else if (C && C.radioOn === false) state = "radioOff";
  return { state: state, sweep: fresh ? C.sweep : null, span: C ? C.span : null, center: !C || C.mode === null || C.mode == 0x00 || C.mode == 0x02, spans: RIG_SCOPE_SPANS };
}

// The span either side made the next narrower (step -1) or wider (+1) of RIG_SCOPE_SPANS (27 15 00), on the rig of a VFO (an id), in a
// Center mode, going round past either end (the widest's next wider is the narrowest); read back after. The span asked for, or null
function rigScopeSpanStep(vfoId, step)
{
  const R = rigVfoLink(rigVfoById(vfoId));
  if (!R || !R.scope || R.status != "connected" || R.protocol !== RIG_PROTOCOLS.civ) return null;
  const C = R.scope;
  if (C.span === null || !(C.mode === null || C.mode == 0x00 || C.mode == 0x02)) return null;
  // The nearest of the spans to the one read, then the next one along
  let at = 0;
  RIG_SCOPE_SPANS.forEach((span, i) => { if (Math.abs(span - C.span) < Math.abs(RIG_SCOPE_SPANS[at] - C.span)) at = i; });
  const count = RIG_SCOPE_SPANS.length;
  const span = RIG_SCOPE_SPANS[(((at + step) % count) + count) % count];
  if (span == C.span) return null;
  const address = rigCivAddress(R);
  rigWrite(R, rigCivFrame(address, 0x27, [0x15, 0x00, ...rigCivHzToBcd(span)]));
  rigWrite(R, rigCivFrame(address, 0x27, [0x15, 0x00]));
  C.span = span;
  return span;
}

// Use Scope If Present (a CI-V rig's box) checked or not: asked for again (a refusal forgotten)
function rigScopeChanged(el)
{
  const v = rigVfoOfEl(el);
  const R = v ? GT.rigs[v.id] : null;
  if (!R) return;
  rigSettingsOf(R).useScope = rigEl(R, "UseScope").checked;
  if (R.scope) R.scope.refused = false;
  rigScopeSync(R);
  rigScopeWarnRender(R);
}

// Under Use Scope If Present (in yellow), why its scope can't come: too slow a baud rate, refused by the rig, the rig's own scope off
function rigScopeWarnRender(R)
{
  const el = rigEl(R, "ScopeWarn");
  if (!el) return;
  const S = rigSettingsOf(R);
  let key = "";
  if (S.useScope === true && S.protocol == "civ")
  {
    if (Number(S.baud) < RIG_SCOPE_BAUD) key = "rig.scope.slow";
    else if (R.scope && R.scope.refused) key = "rig.scope.refused";
    else if (R.scope && R.scope.radioOn === false) key = "rig.scope.radioOff";
  }
  const text = key ? I18N(key) : "";
  if (el.textContent != text) el.textContent = text;
  el.style.display = text ? "" : "none";
}

// ---- PTT (the Multi-Mode Decoder's Send Picture): the rig of a VFO (its id) keyed or unkeyed by its PTT Method (the rig's box; a second
// VFO's is its rig's): CAT (the protocol's PTT command; an SDR server hasn't one), DTR or RTS (the serial port's line), VOX (nothing sent:
// the audio keys the rig), None (it can't be keyed). Only this and the decoder's transmit key a rig; nothing else in GridTracker does

// A VFO's rig's PTT Method ("none", "cat", "vox", "dtr", "rts"), "none" without a rig
function rigPttMethod(vfoId)
{
  const owner = rigVfoOwner(rigVfoById(vfoId));
  return owner && RIG_PTT_METHODS.includes(owner.ptt) ? owner.ptt : "none";
}

// Whether the VFO's rig can be keyed its way: VOX with the VFO in use; the others with the rig connected and able (CAT: the protocol's
// command; DTR, RTS: a serial port)
function rigCanPtt(vfoId)
{
  const v = rigVfoById(vfoId);
  if (!v || !rigVfoOn(v)) return false;
  const method = rigPttMethod(vfoId);
  if (method == "vox") return true;
  const R = rigVfoLink(v);
  if (method == "none" || !R || R.status != "connected" || !R.protocol) return false;
  if (method == "cat") return typeof R.protocol.setPtt == "function";
  return !!(R.link && typeof R.link.setSignals == "function");
}

// Keyed (on true) or unkeyed; true when done (VOX: nothing to do, true). Keyed here, it is kept how (R.pttKeyed), and unkeyed that way on
// each rig keyed for the VFO, and on the VFO's rig if that is keyed: also with the VFO no longer in use (a second VFO's Connect unchecked,
// its rig still connected), removed or made another rig's, or its PTT Method changed since. A rig not connected now is unkeyed once it
// is again (rigReadWhole)
function rigPtt(vfoId, on)
{
  if (!on)
  {
    // (One lost while keyed for it, still to be unkeyed, among them: never in place of the rig the VFO is on now)
    const own = rigVfoLink(rigVfoById(vfoId));
    const keyed = Object.values(GT.rigs).filter((x) => x.pttKeyed && (x.pttKeyed.vfo == vfoId || x === own));
    if (keyed.length) return keyed.map((x) => rigPttRelease(x)).some(Boolean);
  }
  if (!rigCanPtt(vfoId)) return false;
  const method = rigPttMethod(vfoId);
  if (method == "vox") return true;
  const R = rigVfoLink(rigVfoById(vfoId));
  if (method == "cat")
  {
    const data = R.protocol.setPtt(!!on, R);
    R.pttData = data;
    if (!rigSend(R, [data])) return false;
  }
  else rigPttLine(R, method, !!on);
  R.pttKeyed = on ? { method: method, vfo: vfoId, generation: R.generation } : null;
  rigPttTell();
  return true;
}

// A rig keyed here unkeyed the way it was keyed, through its queue, while it is connected (else it stays as keyed: unkeyed once it is
// connected again): true when it was sent
function rigPttRelease(R)
{
  const keyed = R.pttKeyed;
  if (!keyed || R.status != "connected" || !R.link || !R.protocol) return false;
  R.pttKeyed = null;
  if (keyed.method != "cat")
  {
    rigPttTell();
    rigPttLine(R, keyed.method, false);
    return true;
  }
  const data = typeof R.protocol.setPtt == "function" ? R.protocol.setPtt(false, R) : null;
  R.pttData = data;
  const sent = rigSend(R, [data]);
  // (Told once the unkey is queued: while it waits there, the rig still counts as keyed, rigPttUnkeyQueued)
  rigPttTell();
  return sent;
}

// A rig keyed here unkeyed at once, straight on its link and past its queue: the link is about to be let go (rigDisconnect), or the main
// window is closing (rigPttUnkeyAll). Nothing waits for it to go out here; true when its CAT command was written (rigDisconnect then
// gives a serial port the time to send it before closing it)
function rigPttUnkeyNow(R)
{
  const keyed = R.pttKeyed;
  if (!keyed || !R.link || !R.protocol) return false;
  try
  {
    if (keyed.method != "cat")
    {
      rigPttLine(R, keyed.method, false);
      return false;
    }
    const data = typeof R.protocol.setPtt == "function" ? R.protocol.setPtt(false, R) : null;
    if (data === null || data === undefined) return false;
    if (R.protocol.http) rigHttpCall(R, data[0], data[1]).catch(() => {});
    else if (R.writer) R.writer.write(typeof data == "string" ? new TextEncoder().encode(data) : data).catch(() => {});
    else R.link.write(data);
    return true;
  }
  catch (e)
  {
    // The link gone already
    return false;
  }
}

// Every rig keyed here unkeyed at once, and an unkey still waiting in a queue written straight (rigPttUnkeyQueued), as GridTracker2 closes
// or restarts (asked first by the main process, rigPttUnkeyBeforeClose, and again at the main window's beforeunload): the Multi-Mode
// Decoder's window is destroyed with it, without its own unload, so it can't (main/index.js)
function rigPttUnkeyAll()
{
  for (const R of Object.values(GT.rigs))
  {
    if (!rigPttUnkeyQueued(R))
    {
      rigPttUnkeyNow(R);
      continue;
    }
    // An unkey still waiting in the queue: written now, past it (left queued too: a second one does no harm)
    try
    {
      R.writer.write(typeof R.pttData == "string" ? new TextEncoder().encode(R.pttData) : R.pttData).catch(() => {});
    }
    catch (e)
    {
      // The link gone already
    }
  }
}

window.addEventListener("beforeunload", rigPttUnkeyAll);

// Whether the main process was last told a rig is keyed here
GT.rigPttTold = false;

// An unkey still waiting in a serial rig's queue (rigPttRelease, behind frames not answered yet): nothing is keyed here any more, but the
// rig still is until it goes out (with nothing keyed here, the PTT command queued last is an unkey)
function rigPttUnkeyQueued(R)
{
  return !R.pttKeyed && !!R.writer && R.pttData !== null && R.queue.includes(R.pttData);
}

// The main process told whether a rig is keyed here, each time that changes (wherever R.pttKeyed does, as a rig is let go, and as an
// unkey queued goes out: until then the rig counts as keyed, rigPttUnkeyQueued): while one is, GridTracker2's close, a restart and an
// update's install wait for its unkey (main/index.js rigPttUnkeyThen)
function rigPttTell()
{
  const keyed = Object.values(GT.rigs).some((R) => !!R.pttKeyed || rigPttUnkeyQueued(R));
  if (keyed === GT.rigPttTold) return;
  GT.rigPttTold = keyed;
  electron.ipcRenderer.send("rigPttKeyed", keyed);
}

// The main process's ask before it closes or restarts GridTracker2 with a rig keyed: each one unkeyed at once (rigPttUnkeyAll), the
// answer sent once that has had the time to go out (RIG_UNKEY_CLOSE_MS, as a serial port's close waits); at once when no rig keyed
// has a link to unkey it on, and no unkey waits in a queue
function rigPttUnkeyBeforeClose()
{
  const unkeying = Object.values(GT.rigs).some((R) => (R.pttKeyed && R.link) || rigPttUnkeyQueued(R));
  rigPttUnkeyAll();
  if (unkeying) nodeTimers.setTimeout(() => electron.ipcRenderer.send("rigPttUnkeyed"), RIG_UNKEY_CLOSE_MS);
  else electron.ipcRenderer.send("rigPttUnkeyed");
}

// The serial port's DTR or RTS line set (its setSignals, Web Serial's or Node's: serialPorts.js; its promise let be: a port gone away
// says so elsewhere)
function rigPttLine(R, method, on)
{
  if (!R.link || typeof R.link.setSignals != "function") return;
  const signals = method == "dtr" ? { dataTerminalReady: on } : { requestToSend: on };
  R.link.setSignals(signals).catch(() => {});
}

// The serial port's DTR and RTS lines as the rig's box says (DTR, RTS: High or Low), as setSignals takes them: the line PTT Method names
// low whatever it is set to (it is raised only to key the rig: rigPttLine)
function rigPttLineLevels(R)
{
  const S = rigSettingsOf(R);
  const high = (line) => S.ptt != line && S[line] == "high";
  return { dataTerminalReady: high("dtr"), requestToSend: high("rts") };
}

// The serial port's DTR and RTS lines set as the rig's box says (rigPttLineLevels), in one setSignals call: as a Web Serial port opens
// (Chromium asserts both as it opens it; Node's are set as it opens, rigOpenSerial) and as PTT Method is picked
function rigPttLineDrop(R)
{
  if (!R.link || typeof R.link.setSignals != "function") return;
  R.link.setSignals(rigPttLineLevels(R)).catch(() => {});
}
