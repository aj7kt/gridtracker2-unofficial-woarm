// Serial ports for Rig Control and Rotor Control (renderer/lib/services/serialPorts.js), opened here with Node's serialport, not with
// Chromium's Web Serial in the page. Opened with no flow control and HUPCL off, a port's DTR and RTS stay low as it opens on Windows
// (Chromium raises both for a moment at every open, which keys a rig wired for PTT on one), and are then set at once as the service asks;
// its close doesn't throw away what was written (Chromium's purges); drain() waits until it has gone out. Ports are listed with their USB
// vendor, product and serial number, so no chooser or grant is needed: a service's port is found again by what it kept (serialMatch).
// serialport is a native module: loaded on first use, and one that won't load (not there, or not for this system) leaves the page on
// Web Serial (serialAvailable false), as does the --web-serial switch. Each port open belongs to the window that opened it, by an id
// handed out here; it is closed when that window goes or reloads, and as GridTracker2 quits.
//   serialAvailable():            whether serialport is there and lists the ports (asked once)
//   serialList():                 the ports: [{ path, friendlyName, manufacturer, serialNumber, pnpId, vendorId, productId, ... }]
//   serialFind(wanted):           the port a service kept (its identity, as saved), or null
//   serialOpen(path, options):    { id } or { error }; options { baudRate, dataBits, parity, stopBits, dtr, rts }
//   serialWrite(id, bytes), serialSet(id, { dtr, rts }), serialDrain(id), serialClose(id): {} or { error }
// To the window: serialData(id, bytes), serialError(id, message), serialGone(id) (unplugged, or closed by the system)
const timers = require("timers");

// The wait for writes still going out (a drain, a close) is never longer than this
const SERIAL_DRAIN_MS = 1000;
// serialport's list not answered in this long (udevadm stuck, a driver that hangs the enumeration) counts as failed: short enough that
// the Web Serial chooser it falls back to still has the click's user activation (Chromium keeps it about 5 s)
const SERIAL_LIST_MS = 3000;

// serialport's SerialPort: undefined until tried, null when it isn't there (serialLoadError says why)
let serialPortClass;
let serialLoadError = "";
// Whether it lists the ports (serialAvailable): a promise, once asked
let serialAvailableAsk = null;
// The ports open: id -> { port, owner (its window's webContents), path, lines: { dtr, rts }, lastWrite (a promise: the last write
// done) }
const serialPortsOpen = new Map();
let serialNextId = 1;
// The windows whose going closes their ports (watched once each)
const serialOwners = new WeakSet();

function serialLoad()
{
  if (serialPortClass !== undefined) return serialPortClass;
  serialPortClass = null;
  try
  {
    const { app } = require("electron");
    if (app && app.commandLine.hasSwitch("web-serial")) serialLoadError = "not used (--web-serial)";
    else serialPortClass = require("serialport").SerialPort || null;
  }
  catch (e)
  {
    serialLoadError = e && e.message ? e.message : String(e);
    serialPortClass = null;
  }
  if (!serialPortClass) console.log("Serial ports through Web Serial: serialport " + serialLoadError);
  return serialPortClass;
}

function serialMessage(e)
{
  return e && e.message ? e.message : String(e);
}

// serialport's list, or its error (none in SERIAL_LIST_MS: an error too)
function serialListTimed(SerialPort)
{
  return new Promise((resolve, reject) =>
  {
    const timer = timers.setTimeout(() => reject(new Error("no answer in " + SERIAL_LIST_MS / 1000 + " s")), SERIAL_LIST_MS);
    Promise.resolve().then(() => SerialPort.list()).then((list) =>
    {
      timers.clearTimeout(timer);
      resolve(list);
    }, (e) =>
    {
      timers.clearTimeout(timer);
      reject(e);
    });
  });
}

// serialport's list: [] when it can't be had
async function serialListPorts()
{
  const SerialPort = serialLoad();
  if (!SerialPort) return [];
  try
  {
    const list = await serialListTimed(SerialPort);
    return Array.isArray(list) ? list.map((entry) => Object.assign({}, entry)) : [];
  }
  catch (e)
  {
    console.log("Serial port list: " + serialMessage(e));
    return [];
  }
}

// serialport loaded, and its list answered (Linux: udevadm there)
function serialAvailable()
{
  if (!serialAvailableAsk)
  {
    serialAvailableAsk = (async () =>
    {
      const SerialPort = serialLoad();
      if (!SerialPort) return false;
      try
      {
        await serialListTimed(SerialPort);
        return true;
      }
      catch (e)
      {
        console.log("Serial ports through Web Serial: serialport's list " + serialMessage(e));
        return false;
      }
    })();
  }
  return serialAvailableAsk;
}

// Two port names the same: COM3 and com3; macOS's /dev/tty.x and /dev/cu.x (the same device, called in or out)
function serialSamePath(a, b)
{
  a = String(a || "");
  b = String(b || "");
  if (!a || !b) return false;
  if (a == b) return true;
  if (/^COM\d+$/i.test(a)) return a.toUpperCase() == b.toUpperCase();
  // (Web Serial's name may be without the /dev/)
  const plain = (name) => name.replace(/^\/dev\//, "").replace(/^(?:tty|cu)\./, "tty.");
  return plain(a) == plain(b);
}

// The list entry that is the port a service kept (wanted: its identity as saved; as Chromium knew it, { portName, displayName,
// serialNumber, deviceInstanceId }, or as picked from this list, with pnpId too), or null:
//   1. the device itself: Windows' device instance id (Chromium's deviceInstanceId and serialport's pnpId are the same id), or the pnpId
//      kept (Linux: its /dev/serial/by-id name);
//   2. its USB serial number, where one entry alone has it (several: the one with the name kept);
//   3. a port known by neither (COM1, a virtual port, saved without them): its name.
// A port known by a device id or a serial number is never taken for another one that has its name now (Linux gives /dev/ttyUSB0 to
// whichever adapter comes first)
function serialMatch(wanted, list)
{
  if (!wanted || !Array.isArray(list)) return null;
  const same = (a, b) => !!a && !!b && String(a).toUpperCase() == String(b).toUpperCase();
  const ids = [wanted.deviceInstanceId, wanted.pnpId].filter(Boolean);
  if (ids.length)
  {
    const found = list.filter((entry) => entry && ids.some((id) => same(id, entry.pnpId)));
    if (found.length == 1) return found[0];
    if (found.length > 1) return found.find((entry) => serialSamePath(entry.path, wanted.portName)) || null;
  }
  if (wanted.serialNumber)
  {
    const found = list.filter((entry) => entry && same(entry.serialNumber, wanted.serialNumber));
    if (found.length == 1) return found[0];
    if (found.length > 1) return found.find((entry) => serialSamePath(entry.path, wanted.portName)) || null;
  }
  if (ids.length || wanted.serialNumber) return null;
  return list.find((entry) => entry && serialSamePath(entry.path, wanted.portName)) || null;
}

function serialSend(owner, channel, ...args)
{
  try
  {
    if (!owner.isDestroyed()) owner.send(channel, ...args);
  }
  catch (e)
  {
    // The window going
  }
}

// A window's ports closed as it goes, or as it loads again (a reload: the page that opened them is gone)
function serialWatchOwner(owner)
{
  if (serialOwners.has(owner)) return;
  serialOwners.add(owner);
  const closeTheirs = () =>
  {
    for (const [id, entry] of serialPortsOpen) if (entry.owner === owner) serialCloseId(id);
  };
  owner.once("destroyed", closeTheirs);
  owner.on("did-navigate", closeTheirs);
  // (Its page crashed: nobody left to unkey a rig keyed by DTR or RTS, so both lines are dropped first)
  owner.on("render-process-gone", () =>
  {
    for (const [id, entry] of serialPortsOpen)
    {
      if (entry.owner !== owner) continue;
      entry.lines = { dtr: false, rts: false };
      serialSetLines(entry);
      serialCloseId(id);
    }
  });
}

// What a drain or a close waits for: the writes still going out and the line sets asked, but never longer than SERIAL_DRAIN_MS
function serialWritesDone(entry)
{
  return new Promise((resolve) =>
  {
    const timer = timers.setTimeout(resolve, SERIAL_DRAIN_MS);
    Promise.all([entry.lastWrite, entry.lastSet]).then(() =>
    {
      timers.clearTimeout(timer);
      resolve();
    });
  });
}

// The lines set as they are kept (serialport sets every line at each set: one left out would be raised). One set at a time, in the order
// asked: serialport runs each on libuv's threadpool, where two run at once (a key and its unkey landing the wrong way round)
function serialSetLines(entry)
{
  const done = entry.lastSet.then(() => new Promise((resolve) =>
  {
    entry.port.set({ dtr: entry.lines.dtr, rts: entry.lines.rts, brk: false }, (e) => resolve(e ? { error: serialMessage(e) } : {}));
  }));
  entry.lastSet = done;
  return done;
}

async function serialOpenPort(owner, path, options = {})
{
  const SerialPort = serialLoad();
  if (!SerialPort) return { error: "serialport " + serialLoadError };
  let port;
  try
  {
    port = new SerialPort({
      path: String(path),
      baudRate: Number(options.baudRate) || 9600,
      dataBits: Number(options.dataBits) == 7 ? 7 : 8,
      stopBits: Number(options.stopBits) == 2 ? 2 : 1,
      parity: ["none", "even", "odd"].includes(options.parity) ? options.parity : "none",
      rtscts: false,
      xon: false,
      xoff: false,
      hupcl: false,
      autoOpen: false
    });
  }
  catch (e)
  {
    return { error: serialMessage(e) };
  }
  // (Errors come with their callbacks; one without would otherwise throw here)
  port.on("error", () => {});
  const opened = await new Promise((resolve) => port.open((e) => resolve(e ? serialMessage(e) : null)));
  if (opened !== null) return { error: opened };
  const entry = { port: port, owner: owner, path: String(path), lines: { dtr: options.dtr === true, rts: options.rts === true }, lastWrite: Promise.resolve(), lastSet: Promise.resolve() };
  const set = await serialSetLines(entry);
  // (Its window gone meanwhile: nobody to keep it for)
  if (set.error || owner.isDestroyed())
  {
    port.close(() => {});
    return set.error ? set : { error: "closed" };
  }
  const id = serialNextId++;
  serialPortsOpen.set(id, entry);
  serialWatchOwner(owner);
  port.removeAllListeners("error");
  port.on("error", (e) => serialSend(owner, "serialError", id, serialMessage(e)));
  // (Each chunk a slice of serialport's 64 kB read pool: sent as a copy of its own bytes alone)
  port.on("data", (data) => serialSend(owner, "serialData", id, new Uint8Array(data)));
  // Closed, not by serialClose: gone (unplugged, or a read or write the system refused)
  port.on("close", () =>
  {
    if (serialPortsOpen.get(id) !== entry) return;
    serialPortsOpen.delete(id);
    serialSend(owner, "serialGone", id);
  });
  // A read answered with no bytes (Windows) ends serialport's stream: it reads no more, so the port is let go as gone
  port.on("end", () =>
  {
    if (serialPortsOpen.get(id) !== entry) return;
    serialPortsOpen.delete(id);
    serialSend(owner, "serialGone", id);
    if (port.isOpen) port.close(() => {});
  });
  return { id: id };
}

// The port of an id, if it is the window's
function serialEntry(owner, id)
{
  const entry = serialPortsOpen.get(id);
  return entry && entry.owner === owner && entry.port.isOpen ? entry : null;
}

function serialWrite(owner, id, bytes)
{
  const entry = serialEntry(owner, id);
  if (!entry) return Promise.resolve({ error: "Port is not open" });
  const done = new Promise((resolve) =>
  {
    try
    {
      entry.port.write(Buffer.from(bytes), (e) => resolve(e ? { error: serialMessage(e) } : {}));
    }
    catch (e)
    {
      resolve({ error: serialMessage(e) });
    }
  });
  entry.lastWrite = done;
  return done;
}

// lines: { dtr, rts }, either left out as it is
function serialSet(owner, id, lines = {})
{
  const entry = serialEntry(owner, id);
  if (!entry) return Promise.resolve({ error: "Port is not open" });
  for (const line of ["dtr", "rts"]) if (typeof lines[line] == "boolean") entry.lines[line] = lines[line];
  return serialSetLines(entry);
}

// Once what was written has gone out (the writes done, then the system's own buffer: serialport's drain)
async function serialDrain(owner, id)
{
  const entry = serialEntry(owner, id);
  if (!entry) return {};
  await serialWritesDone(entry);
  if (!entry.port.isOpen) return {};
  return new Promise((resolve) =>
  {
    const timer = timers.setTimeout(() => resolve({ error: "drain timed out" }), SERIAL_DRAIN_MS);
    entry.port.drain((e) =>
    {
      timers.clearTimeout(timer);
      resolve(e ? { error: serialMessage(e) } : {});
    });
  });
}

// Closed once the writes still going out are done (a write still under way as a port closes is thrown away)
async function serialCloseId(id)
{
  const entry = serialPortsOpen.get(id);
  if (!entry) return {};
  serialPortsOpen.delete(id);
  entry.port.removeAllListeners("data");
  await serialWritesDone(entry);
  if (!entry.port.isOpen) return {};
  return new Promise((resolve) => entry.port.close((e) => resolve(e ? { error: serialMessage(e) } : {})));
}

function serialClose(owner, id)
{
  const entry = serialPortsOpen.get(id);
  return entry && entry.owner === owner ? serialCloseId(id) : Promise.resolve({});
}

// Every port closed (GridTracker2 quitting)
function serialCloseAll()
{
  for (const id of [...serialPortsOpen.keys()]) serialCloseId(id);
}

// The IPC the page uses (serialPorts.js)
function serialInit(ipcMain)
{
  ipcMain.handle("serialAvailable", () => serialAvailable());
  ipcMain.handle("serialList", () => serialListPorts());
  ipcMain.handle("serialFind", async (event, wanted) => serialMatch(wanted, await serialListPorts()));
  ipcMain.handle("serialOpen", (event, path, options) => serialOpenPort(event.sender, path, options));
  ipcMain.handle("serialWrite", (event, id, bytes) => serialWrite(event.sender, id, bytes));
  ipcMain.handle("serialSet", (event, id, lines) => serialSet(event.sender, id, lines));
  ipcMain.handle("serialDrain", (event, id) => serialDrain(event.sender, id));
  ipcMain.handle("serialClose", (event, id) => serialClose(event.sender, id));
}

module.exports = { serialInit, serialCloseAll, serialMatch };
