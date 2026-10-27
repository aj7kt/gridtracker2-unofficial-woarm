// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// SDR++ Server (SDR++ run with --server) as a Rig Control VFO (its protocol "sdrpp", rig.js): the VFO is the frequency the server's device
// is tuned to; an SDR has no mode, so it says USB, which is what its I/Q gives the Multi-Mode Decoder (rigIq.js). One client at a time.
//   The protocol (little-endian): each packet a header (its type, its whole size), then for a command its number and its data.
//   Commands to the server: GET_UI, UI_ACTION, START, STOP, SET_FREQUENCY (a double), SET_SAMPLE_TYPE, SET_COMPRESSION; from it,
//   SET_SAMPLERATE (a double: the device's rate) and DISCONNECT (another client has it). A command answered comes back as COMMAND_ACK.
//   The server's source menu (its sources, the device, the sample rate, gain ...) comes as a draw list: typed elements (a step: a widget
//   or a layout call; a bool, an int, a float, a string), each widget followed by its values. A widget changed is sent back as UI_ACTION
//   (whether to answer with the menu again, the widget's id, its new value). Here Source, Device and Sample Rate are shown in the VFO's
//   box (and its Refresh); its gain is left to SDR++ itself.
//   The I/Q is the device's whole band, sent from START to STOP: packets of BASEBAND, brought down to the decoder's rate in a worker
//   (rigIqWorker.js). The server answers SET_FREQUENCY but never says where it is tuned: what was set is the VFO's frequency, and kept
//   (the VFO's sdrppFreq) so it is tuned there again when connected again

const SDRPP_PACKET_COMMAND = 0;
const SDRPP_PACKET_ACK = 1;
const SDRPP_PACKET_BASEBAND = 2;
const SDRPP_PACKET_ERROR = 6;
const SDRPP_CMD_GET_UI = 0;
const SDRPP_CMD_UI_ACTION = 1;
const SDRPP_CMD_START = 2;
const SDRPP_CMD_STOP = 3;
const SDRPP_CMD_SET_FREQUENCY = 4;
const SDRPP_CMD_SET_SAMPLE_TYPE = 6;
const SDRPP_CMD_SET_COMPRESSION = 7;
const SDRPP_CMD_SET_SAMPLERATE = 0x80;
const SDRPP_CMD_DISCONNECT = 0x81;
const SDRPP_PCM_I16 = 1;
// A packet bigger than this is taken as the stream gone wrong
const SDRPP_PACKET_MAX = 1 << 24;
// The draw list's element types, and the steps read here
const SDRPP_ELEM_STEP = 0;
const SDRPP_ELEM_BOOL = 1;
const SDRPP_ELEM_INT = 2;
const SDRPP_ELEM_FLOAT = 3;
const SDRPP_ELEM_STRING = 4;
const SDRPP_STEP_BEGIN_DISABLED = 0x02;
const SDRPP_STEP_END_DISABLED = 0x03;
const SDRPP_STEP_COMBO = 0x80;
const SDRPP_STEP_BUTTON = 0x81;
// The share of the I/Q's rate that is usable (the rest is the filters' skirts)
const SDRPP_IQ_USABLE = 0.8;

// SDR++'s Rigctl Server (a module of SDR++'s own window, not of --server) as a Rig Control VFO (its protocol "sdrppRigctl"): the VFO is
// the SDR++ window's selected VFO, read and tuned; its I/Q stays in SDR++. It speaks only the plain rigctl protocol, and takes one client
// at a time: f answers the frequency alone ("7074000"), m the mode and the passband ("USB", "2700"), F and M an RPRT line (RPRT 0, or
// RPRT 1 for an error); a command it doesn't know answers RPRT 1. Its answers aren't labelled, so they are read in the order asked
// (R.plainQueue: what each command sent will answer, a poll's end marked, rigSdrppRigctlWrote). A line that isn't what comes next is
// passed over; the queue is let go if it ever grows long (answers lost), so it can't fall out of step for good. Its modes: FM, WFM, AM,
// DSB, USB, CW, LSB, RAW
const SDRPP_RIGCTL_QUEUE_MAX = 16;

RIG_PROTOCOLS.sdrppRigctl = {
  name: "SDR++ (rigctl)",
  serial: false,
  model: "SDR++",
  caps: (R) =>
  {
    R.plainQueue = [];
    R.dual = false;
    return null;
  },
  poll: () => "f\nm\n",
  setFreq: (hz) => "F " + Math.round(hz) + "\n",
  // Its own modes only (no data variant)
  setMode: (mode) => (["FM", "WFM", "AM", "DSB", "USB", "CW", "LSB", "RAW"].includes(String(mode).toUpperCase()) ? "M " + String(mode).toUpperCase() + " 0\n" : null),
  wrote: (data, R, pollSeq) => rigSdrppRigctlWrote(data, R, pollSeq),
  parse: (line, R) => rigSdrppRigctlLine(line, R)
};

// What a write will be answered with, in order (f: the frequency; m: the mode, then the passband; anything else: an RPRT line), then for
// a poll its end
function rigSdrppRigctlWrote(data, R, pollSeq)
{
  if (R.plainQueue.length > SDRPP_RIGCTL_QUEUE_MAX) R.plainQueue = [];
  for (const command of String(data).split("\n"))
  {
    const c = command.trim();
    if (!c) continue;
    if (c == "f") R.plainQueue.push({ kind: "freq" });
    else if (c == "m") R.plainQueue.push({ kind: "mode" }, { kind: "width" });
    else R.plainQueue.push({ kind: "rprt" });
  }
  if (pollSeq !== null) R.plainQueue.push({ kind: "done", seq: pollSeq });
}

// An answer line, matched with what comes next
function rigSdrppRigctlLine(line, R)
{
  const text = line.trim();
  const head = R.plainQueue[0];
  if (!head) return null;
  const fits = { freq: /^\d+$/, mode: /^[A-Za-z]+$/, width: /^-?\d+$/, rprt: /^RPRT\s/ }[head.kind];
  if (!fits || !fits.test(text)) return null;
  R.plainQueue.shift();
  if (head.kind == "freq") R.freq = Number(text);
  else if (head.kind == "mode") R.mode = text.toUpperCase();
  // A poll answered whole
  while (R.plainQueue.length && R.plainQueue[0].kind == "done")
  {
    R.readSeq = Math.max(R.readSeq, R.plainQueue.shift().seq);
    rigReadWhole(R);
  }
  return head.kind == "rprt" && !/^RPRT\s+0/.test(text) ? text : null;
}

RIG_PROTOCOLS.sdrpp = {
  name: "SDR++ (Server)",
  serial: false,
  raw: true,
  portKey: "sdrppPort",
  portDefault: 5259,
  // Its menu asked for, 16-bit samples, no compression; and tuned to where it was last
  caps: (R) =>
  {
    R.sdrppIn = Buffer.alloc(0);
    R.sdrppRate = null;
    R.sdrppMenu = null;
    R.sdrppTuned = null;
    R.sdrppRunning = false;
    R.dual = false;
    R.mode = "USB";
    const out = [rigSdrppCommand(SDRPP_CMD_GET_UI), rigSdrppCommand(SDRPP_CMD_SET_SAMPLE_TYPE, Buffer.from([SDRPP_PCM_I16])), rigSdrppCommand(SDRPP_CMD_SET_COMPRESSION, Buffer.from([0]))];
    const v = rigVfoById(R.key);
    if (v && v.sdrppFreq > 0) out.push(RIG_PROTOCOLS.sdrpp.setFreq(v.sdrppFreq, R));
    return Buffer.concat(out);
  },
  // Nothing to ask: every poll is a whole read of what is known
  poll: (R) =>
  {
    R.readSeq = R.tuneSeq;
    rigReadWhole(R);
    return null;
  },
  setFreq: (hz, R) =>
  {
    R.sdrppTuned = Math.round(hz);
    const v = rigVfoById(R.key);
    if (v) v.sdrppFreq = R.sdrppTuned;
    const body = Buffer.alloc(8);
    body.writeDoubleLE(R.sdrppTuned, 0);
    return rigSdrppCommand(SDRPP_CMD_SET_FREQUENCY, body);
  },
  setMode: () => null,
  receive: (data, R) => rigSdrppReceive(data, R),
  // Answered once its menu has come (it never says a frequency of its own)
  answered: (R) => !!R.sdrppMenu,
  iq: { name: "SDR++ (Server)", start: (R, minRate, onIq) => rigSdrppIqStart(R, minRate, onIq), stop: (R) => rigSdrppIqStop(R) },
  // Its Source, Device and Sample Rate rows in the VFO's box
  render: (R) => rigSdrppMenusRender(R)
};

function rigSdrppCommand(cmd, body = null)
{
  const length = 12 + (body ? body.length : 0);
  const packet = Buffer.alloc(length);
  packet.writeUInt32LE(SDRPP_PACKET_COMMAND, 0);
  packet.writeUInt32LE(length, 4);
  packet.writeUInt32LE(cmd, 8);
  if (body) body.copy(packet, 12);
  return packet;
}

function rigSdrppReceive(data, R)
{
  R.sdrppIn = R.sdrppIn && R.sdrppIn.length ? Buffer.concat([R.sdrppIn, data]) : Buffer.from(data);
  while (R.sdrppIn.length >= 8)
  {
    const type = R.sdrppIn.readUInt32LE(0);
    const size = R.sdrppIn.readUInt32LE(4);
    if (size < 8 || size > SDRPP_PACKET_MAX)
    {
      rigFail(R, "bad packet");
      return;
    }
    if (R.sdrppIn.length < size) break;
    const packet = R.sdrppIn.subarray(0, size);
    R.sdrppIn = R.sdrppIn.subarray(size);
    rigSdrppPacket(R, type, packet);
  }
}

function rigSdrppPacket(R, type, packet)
{
  const cmd = packet.length >= 12 ? packet.readUInt32LE(8) : -1;
  if (type == SDRPP_PACKET_COMMAND)
  {
    if (cmd == SDRPP_CMD_SET_SAMPLERATE && packet.length >= 20)
    {
      R.sdrppRate = packet.readDoubleLE(12);
      // A decoder listening: its stages for the new rate (the decoder starts again at the rate it then comes at), and the server started
      // again when it was connected again (it says its rate on every connection)
      if (R.sdrppIq)
      {
        rigSdrppIqPlan(R);
        if (!R.sdrppRunning)
        {
          rigWrite(R, rigSdrppCommand(SDRPP_CMD_START));
          rigWrite(R, rigSdrppCommand(SDRPP_CMD_GET_UI));
          R.sdrppRunning = true;
        }
      }
    }
    // Another client has the server
    else if (cmd == SDRPP_CMD_DISCONNECT) rigFail(R, "busy");
  }
  else if (type == SDRPP_PACKET_ACK)
  {
    if (cmd == SDRPP_CMD_GET_UI || cmd == SDRPP_CMD_UI_ACTION)
    {
      R.sdrppMenu = rigSdrppMenuRead(packet.subarray(12));
      R.model = (R.sdrppMenu.source || "SDR") + " (SDR++ Server)";
      rigSdrppMenusRender(R);
    }
    else if (cmd == SDRPP_CMD_SET_FREQUENCY && R.sdrppTuned !== null)
    {
      R.freq = R.sdrppTuned;
      R.readSeq = R.tuneSeq;
      rigReadWhole(R);
    }
  }
  else if (type == SDRPP_PACKET_BASEBAND && R.sdrppIq && R.sdrppWorker)
  {
    const payload = packet.subarray(8);
    const buf = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.length);
    R.sdrppWorker.postMessage({ type: "data", buf: buf }, [buf]);
  }
  else if (type == SDRPP_PACKET_ERROR) R.error = "SDR++ Server error " + (packet.length > 8 ? packet[8] : "");
}

// ---- Its menu: the draw list read into the widgets wanted. { source, combos: { source, device, rate }: each { id, items, current,
// disabled }, refresh: { id, disabled } }

function rigSdrppMenuRead(buf)
{
  const elems = [];
  let i = 0;
  while (i < buf.length)
  {
    const type = buf[i++];
    if (type == SDRPP_ELEM_STEP && i + 2 <= buf.length)
    {
      elems.push({ step: buf[i] });
      i += 2;
    }
    else if (type == SDRPP_ELEM_BOOL && i + 1 <= buf.length) elems.push(!!buf[i++]);
    else if (type == SDRPP_ELEM_INT && i + 4 <= buf.length)
    {
      elems.push(buf.readInt32LE(i));
      i += 4;
    }
    else if (type == SDRPP_ELEM_FLOAT && i + 4 <= buf.length)
    {
      elems.push(buf.readFloatLE(i));
      i += 4;
    }
    else if (type == SDRPP_ELEM_STRING && i + 2 <= buf.length)
    {
      const n = buf.readUInt16LE(i);
      elems.push(buf.toString("utf8", i + 2, i + 2 + n));
      i += 2 + n;
    }
    else break;
  }
  const menu = { source: "", combos: {}, refresh: null };
  let disabled = 0;
  for (let k = 0; k < elems.length; k++)
  {
    const e = elems[k];
    if (typeof e != "object" || e === null) continue;
    if (e.step == SDRPP_STEP_BEGIN_DISABLED) disabled++;
    else if (e.step == SDRPP_STEP_END_DISABLED) disabled = Math.max(0, disabled - 1);
    else if (e.step == SDRPP_STEP_COMBO && typeof elems[k + 1] == "string")
    {
      // Its id, the item picked, the items (each ended by a NUL)
      const id = elems[k + 1];
      const items = String(elems[k + 3] || "").split("\0");
      if (items.length && items[items.length - 1] == "") items.pop();
      const combo = { id: id, current: Number(elems[k + 2]) || 0, items: items, disabled: disabled > 0 };
      if (id == "##sdrpp_server_src_sel") menu.combos.source = combo;
      else if (/_dev_sel_/.test(id)) menu.combos.device = combo;
      else if (/_sr_sel_/.test(id)) menu.combos.rate = combo;
    }
    else if (e.step == SDRPP_STEP_BUTTON && typeof elems[k + 1] == "string" && /_refr_/.test(elems[k + 1])) menu.refresh = { id: elems[k + 1], disabled: disabled > 0 };
  }
  const src = menu.combos.source;
  if (src) menu.source = src.items[src.current] || "";
  return menu;
}

// A widget of its menu changed (a combo's item picked, a button pressed): sent, and its menu answered again
function rigSdrppAction(R, id, value)
{
  if (R.status != "connected") return;
  const name = Buffer.from(id, "utf8");
  const parts = [Buffer.from([1]), Buffer.from([SDRPP_ELEM_STRING]), Buffer.alloc(2), name];
  parts[2].writeUInt16LE(name.length, 0);
  if (typeof value == "boolean") parts.push(Buffer.from([SDRPP_ELEM_BOOL, value ? 1 : 0]));
  else
  {
    const int = Buffer.alloc(5);
    int[0] = SDRPP_ELEM_INT;
    int.writeInt32LE(value, 1);
    parts.push(int);
  }
  rigWrite(R, rigSdrppCommand(SDRPP_CMD_UI_ACTION, Buffer.concat(parts)));
}

// The VFO box's Source, Device and Sample Rate (each a menu of the server's, greyed while it is streaming), and Refresh
function rigSdrppMenusRender(R)
{
  const menu = R.sdrppMenu;
  const connected = R.status == "connected" && !!menu;
  for (const [key, field] of [["source", "SdrppSource"], ["device", "SdrppDevice"], ["rate", "SdrppRate"]])
  {
    const select = rigEl(R, field);
    if (!select) continue;
    const combo = connected ? menu.combos[key] : null;
    const items = combo && combo.items.length ? combo.items : [I18N(connected ? "settings.rig.sdrpp.none.label" : "settings.rig.sdrpp.notConnected.label")];
    const sig = items.join("\n");
    if (select.dataset.sig != sig)
    {
      select.dataset.sig = sig;
      select.innerHTML = "";
      items.forEach((text, i) => select.appendChild(new Option(text, String(i))));
    }
    select.value = combo && combo.items.length ? String(combo.current) : "0";
    select.disabled = !combo || !combo.items.length || combo.disabled;
  }
  const refresh = rigEl(R, "SdrppRefresh");
  if (refresh) refresh.classList.toggle("rigLocked", !(connected && menu.refresh && !menu.refresh.disabled));
}

// A menu picked in the VFO's box (which: "source", "device", "rate")
function rigSdrppPick(el, which)
{
  const v = rigVfoOfEl(el);
  const R = v ? GT.rigs[v.id] : null;
  const combo = R && R.sdrppMenu ? R.sdrppMenu.combos[which] : null;
  if (!combo || combo.disabled) return;
  rigSdrppAction(R, combo.id, Number(el.value));
}

function rigSdrppRefresh(el)
{
  const v = rigVfoOfEl(el);
  const R = v ? GT.rigs[v.id] : null;
  if (R && R.sdrppMenu && R.sdrppMenu.refresh && !R.sdrppMenu.refresh.disabled) rigSdrppAction(R, R.sdrppMenu.refresh.id, true);
}

// ---- The I/Q (rigIq.js): the server started, its band brought down in the worker to the rate asked for

function rigSdrppIqStart(R, minRate, onIq)
{
  R.sdrppIq = { minRate: minRate, onIq: onIq, rate: null };
  if (R.status != "connected" || !(R.sdrppRate > 0)) return null;
  rigSdrppIqPlan(R);
  rigWrite(R, rigSdrppCommand(SDRPP_CMD_START));
  R.sdrppRunning = true;
  // Its menu again: greyed while it runs
  rigWrite(R, rigSdrppCommand(SDRPP_CMD_GET_UI));
  return R.sdrppIq.rate;
}

function rigSdrppIqStop(R)
{
  if (!R || !R.sdrppIq) return;
  R.sdrppIq = null;
  if (R.sdrppWorker) R.sdrppWorker.postMessage({ type: "reset" });
  if (R.status == "connected" && R.sdrppRunning)
  {
    rigWrite(R, rigSdrppCommand(SDRPP_CMD_STOP));
    rigWrite(R, rigSdrppCommand(SDRPP_CMD_GET_UI));
  }
  R.sdrppRunning = false;
}

// The stages for the device's rate: as many halvings as still leave the rate asked for; the worker set up for them
function rigSdrppIqPlan(R)
{
  let stages = 0;
  while ((R.sdrppRate / Math.pow(2, stages + 1)) * SDRPP_IQ_USABLE >= R.sdrppIq.minRate) stages++;
  R.sdrppIq.rate = R.sdrppRate / Math.pow(2, stages);
  if (!R.sdrppWorker)
  {
    R.sdrppWorker = new Worker("lib/services/rigIqWorker.js");
    R.sdrppWorker.onmessage = (event) =>
    {
      const listener = R.sdrppIq;
      if (!listener) return;
      try
      {
        listener.onIq(event.data, listener.rate);
      }
      catch (e)
      {
        // The listener's window gone: the server stopped
        rigSdrppIqStop(R);
      }
    };
  }
  R.sdrppWorker.postMessage({ type: "config", stages: stages });
}
