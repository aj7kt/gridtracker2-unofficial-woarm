// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// Serial ports for the services that use one (Rotor Control, Rig Control): through Node's serialport in the main process (main/serial.js),
// or, where that isn't available (it won't load on this system), through Web Serial (Chromium's own). Either way a service gets a port
// with what rig.js and rotor.js use of Web Serial's: open(options), a writer (write(bytes): a promise), setSignals({ dataTerminalReady,
// requestToSend }), close(), and its "disconnect" event; Node's (serialNodePort) has drain() too, and its bytes come to ondata (Web
// Serial's through its readable).
// Node: the ports are listed with their USB serial numbers and Windows device ids; Choose Port's menu is that list, and the port a
// service keeps is found again by what it kept (main/serial.js serialMatch).
// Web Serial: the browser only lists ports on a click (requestPort); the main process sends the list here to pick from (a menu) and,
// told which port a service keeps (by the identity Chromium grants by: the Windows device instance id, else the USB serial number,
// else the name), grants it again at each start, so getPorts() finds it without asking. With a port kept by each service, getPorts()
// is asked for one service's alone (serialPortGrantOnly), as the browser doesn't say which granted port is which. What a service keeps
// is the same either way, so a port chosen with one is found with the other

// The service whose Choose Port is open: { purpose, done(port), taken: [ports the other services have open] }
GT.serialPicking = null;
// The port each service keeps (serialPortTell), by its purpose: what Node's are found by (serialPortFor)
GT.serialWanted = {};
// Whether Node's serialport is there (null: not asked yet; serialNodeReady), and the ports open through it, by their id there
GT.serialNode = null;
GT.serialNodeAsk = null;
GT.serialNodePorts = new Map();

function serialPortsInit()
{
  electron.ipcRenderer.on("serialPortList", (event, list) => serialPortPick(list));
  // Node's ports: what comes in, an error, and a port gone (unplugged)
  electron.ipcRenderer.on("serialData", (event, id, bytes) =>
  {
    const port = GT.serialNodePorts.get(id);
    if (port && port.ondata) port.ondata(bytes);
  });
  electron.ipcRenderer.on("serialError", (event, id, message) =>
  {
    const port = GT.serialNodePorts.get(id);
    if (port) serialNodeEvent(port, "error", { message: message });
  });
  electron.ipcRenderer.on("serialGone", (event, id) =>
  {
    const port = GT.serialNodePorts.get(id);
    if (!port) return;
    GT.serialNodePorts.delete(id);
    port.id = null;
    port.closed = true;
    serialNodeEvent(port, "disconnect", {});
  });
}

// Whether the ports go through Node's serialport (asked of the main process once, as a service first needs one): a promise
function serialNodeReady()
{
  if (!GT.serialNodeAsk)
  {
    GT.serialNodeAsk = electron.ipcRenderer.invoke("serialAvailable").then((yes) => yes === true, () => false).then((yes) =>
    {
      GT.serialNode = yes;
      return yes;
    });
  }
  return GT.serialNodeAsk;
}

function serialNodeEvent(port, type, event)
{
  for (const fn of port.listeners[type] || [])
  {
    try
    {
      fn(event);
    }
    catch (e)
    {
      console.error(e);
    }
  }
}

// A port in the main process's list (main/serial.js), to be opened there: as rig.js and rotor.js use a Web Serial port (above). Once it
// is closed (or gone), what is still under way on it is let be: a write's failure then is no news
function serialNodePort(entry)
{
  const port = { node: true, path: entry.path, id: null, closed: false, ondata: null, listeners: {} };
  const call = (channel, ...args) =>
  {
    if (port.closed) return Promise.resolve();
    if (port.id === null) return Promise.reject(new Error("The port is not open."));
    return electron.ipcRenderer.invoke(channel, port.id, ...args).then((answer) =>
    {
      if (answer && answer.error && !port.closed) throw new Error(answer.error);
    });
  };
  // options: Web Serial's (baudRate, dataBits, stopBits, parity), and dtr, rts: the lines as the port opens (true: high)
  port.open = async (options) =>
  {
    const answer = await electron.ipcRenderer.invoke("serialOpen", entry.path, options);
    if (!answer || answer.error) throw new Error(answer ? answer.error : "Failed to open serial port.");
    port.id = answer.id;
    GT.serialNodePorts.set(port.id, port);
  };
  port.writer = { write: (bytes) => call("serialWrite", bytes), releaseLock: () => {} };
  // (A line left out stays as it is)
  port.setSignals = (signals) => call("serialSet", { dtr: signals.dataTerminalReady, rts: signals.requestToSend });
  // Done once what was written has gone out
  port.drain = () => call("serialDrain");
  port.close = () =>
  {
    const id = port.id;
    port.closed = true;
    port.id = null;
    if (id === null) return Promise.resolve();
    GT.serialNodePorts.delete(id);
    return electron.ipcRenderer.invoke("serialClose", id).then(() => {});
  };
  port.addEventListener = (type, fn) =>
  {
    (port.listeners[type] = port.listeners[type] || []).push(fn);
  };
  return port;
}

// What a service keeps of a port, from the browser's list entry
function serialPortIdentity(port)
{
  return { portName: port.portName, displayName: port.displayName || "", vendorId: port.vendorId || "", productId: port.productId || "", serialNumber: port.serialNumber || "", deviceInstanceId: port.deviceInstanceId || "" };
}

// The same from the main process's list entry (Node's serialport), as Chromium has its parts: the Windows device id is serialport's
// pnpId there (kept as pnpId too: Linux's /dev/serial/by-id name); the USB vendor and product ids in decimal (serialport's are hex);
// the name without Windows' " (COM3)"; a serial number Windows made up for a USB device without one (5&2F4C4D6&0&3, where it is plugged
// in) isn't one
function serialNodeIdentity(entry)
{
  const serial = String(entry.serialNumber || "");
  const display = String(entry.friendlyName || entry.manufacturer || "").replace(/\s*\(COM\d+\)$/i, "");
  const decimal = (hex) => (/^[0-9a-f]{1,4}$/i.test(String(hex || "")) ? String(parseInt(hex, 16)) : "");
  return { portName: entry.path, displayName: display, vendorId: decimal(entry.vendorId), productId: decimal(entry.productId), serialNumber: serial.includes("&") ? "" : serial, deviceInstanceId: process.platform == "win32" ? entry.pnpId || "" : "", pnpId: entry.pnpId || "" };
}

// The device's own name where Windows has it in the device id (USB\VID_10C4&PID_EA60\IC-7300_02057052 gives IC-7300), which the USB
// bridge chip's name (CP2102...) doesn't say; "" elsewhere
function serialPortModel(port)
{
  const m = /\\([A-Za-z][\w-]*?)_\d+$/.exec((port && port.deviceInstanceId) || "");
  return m ? m[1] : "";
}

// COM3 as it is; /dev/ttyUSB0 and /dev/tty.usbserial-0001 without the /dev/
function serialPortShortName(port)
{
  return String((port && port.portName) || "").replace(/^\/dev\//, "");
}

// The port a service keeps (at start, and whenever it changes): found by it with Node's serialport (serialPortFor), and granted by it
// in the main process for Web Serial
function serialPortTell(purpose, port)
{
  GT.serialWanted[purpose] = port || null;
  electron.ipcRenderer.send("serialPortWanted", purpose, port ? { portName: port.portName, displayName: port.displayName || "", serialNumber: port.serialNumber || "", deviceInstanceId: port.deviceInstanceId || "" } : null);
}

// Whether two kept ports (or a list entry) are the same device: by the identity Chromium grants by
function serialPortSame(a, b)
{
  if (!a || !b) return false;
  if (a.deviceInstanceId && b.deviceInstanceId) return a.deviceInstanceId == b.deviceInstanceId;
  if (a.serialNumber && b.serialNumber) return a.serialNumber == b.serialNumber;
  return a.portName == b.portName;
}

// The ports the services other than this one have open (connected on them): the rotor, each Rig Control VFO's rig
function serialPortsTaken(purpose)
{
  const open = [];
  if (purpose != "rotor" && GT.rotor.status == "connected" && rotorProtocolChosen().serial) open.push(GT.settings.rotor.port);
  for (const R of Object.values(GT.rigs))
  {
    if (purpose != rigPurpose(R) && R.status == "connected" && rigProtocolChosen(R).serial) open.push(rigSettingsOf(R).port);
  }
  return open.filter(Boolean);
}

// Choose Port (a click: the browser only asks on a user's gesture): done(identity) once one is picked; the ports the other services
// have open are in the menu greyed (disabled). Node's serialport: the menu is its list, at once
function serialPortChoose(purpose, done)
{
  const picking = { purpose: purpose, done: done, taken: serialPortsTaken(purpose) };
  GT.serialPicking = picking;
  const web = () => navigator.serial.requestPort().catch(() => { /* nothing chosen */ }).finally(() => { if (GT.serialPicking === picking) GT.serialPicking = null; });
  // (Web Serial known to be the one: asked straight from the click, as the browser wants)
  if (GT.serialNode === false)
  {
    web();
    return;
  }
  serialNodeReady().then((node) =>
  {
    if (!node) return web();
    return electron.ipcRenderer.invoke("serialList").then((list) => serialPortPick((Array.isArray(list) ? list : []).map(serialNodeIdentity), true), () => serialPortPick([], true));
  });
}

// The list to pick from, as a menu: the browser's (from the main process), or node: Node's (each entry as a service keeps it,
// serialNodeIdentity). The one picked is kept by the service that asked. Each shows its name and port, and the rig its Windows device id
// names (IC-7300), or Node's, the device's USB serial number where it has one (IC-7300_02018437: two of the same rig told apart)
function serialPortPick(list, node = false)
{
  const picking = GT.serialPicking;
  let chosen = false;
  const menu = new Menu();
  if (list.length == 0) menu.append(new MenuItem({ label: I18N("settings.rotor.noPorts.label"), enabled: false }));
  for (const port of list)
  {
    const model = node && port.serialNumber ? port.serialNumber : serialPortModel(port);
    menu.append(new MenuItem({
      label: (port.displayName && port.displayName != port.portName ? port.displayName + "  (" + port.portName + ")" : port.portName) + (model ? "  \u2014  " + model : ""),
      enabled: !(picking && picking.taken.some((taken) => serialPortSame(taken, port))),
      click: () =>
      {
        chosen = true;
        const identity = node ? port : serialPortIdentity(port);
        if (picking)
        {
          serialPortTell(picking.purpose, identity);
          picking.done(identity);
        }
        if (!node) electron.ipcRenderer.send("serialPortChosen", port.portId);
      }
    }));
  }
  menu.popup({
    callback: () =>
    {
      if (node)
      {
        if (GT.serialPicking === picking) GT.serialPicking = null;
      }
      else if (!chosen) electron.ipcRenderer.send("serialPortChosen", "");
    }
  });
}

// One service at a time: two asking together (the rotor and the rig, at start) would each be handed the other's port
let serialPortTurn = Promise.resolve();

// The port a service keeps, as Node's serialport lists it now, or as the browser has it: null when it isn't there (unplugged, or none
// chosen)
function serialPortFor(purpose)
{
  const mine = serialPortTurn.then(async () =>
  {
    if (await serialNodeReady())
    {
      const entry = await electron.ipcRenderer.invoke("serialFind", GT.serialWanted[purpose] || null);
      return entry ? serialNodePort(entry) : null;
    }
    await electron.ipcRenderer.invoke("serialPortGrantOnly", purpose);
    try
    {
      const ports = await navigator.serial.getPorts();
      return ports[0] || null;
    }
    finally
    {
      await electron.ipcRenderer.invoke("serialPortGrantOnly", null);
    }
  });
  serialPortTurn = mine.catch(() => {});
  return mine;
}

// ---- Linux: the serial devices belong to a group (dialout on Debian and Ubuntu, uucp on Arch and Fedora, as the distribution has it),
// and a user who isn't in it can't open them

// What to say, or null: from the groups the user is in, the port's device and the group that owns it (none known: the usual one this
// system has), and the groups the system has
function serialLinuxNotice(userGroups, portName, portGroup, systemGroups)
{
  const group = portGroup || ["dialout", "uucp"].find((name) => systemGroups.includes(name));
  if (!group || userGroups.includes(group)) return null;
  return { group: group, port: portName || "" };
}

// For a service's port (none chosen: the first serial device there is)
function serialLinuxCheck(port)
{
  if (process.platform != "linux") return null;
  try
  {
    const userGroups = window.require("child_process").execFileSync("id", ["-Gn"], { encoding: "utf8", timeout: 2000 }).trim().split(/\s+/);
    const byGid = new Map();
    const systemGroups = [];
    for (const line of fs.readFileSync("/etc/group", "utf8").split("\n"))
    {
      const [name, , gid] = line.split(":");
      if (!name) continue;
      systemGroups.push(name);
      byGid.set(Number(gid), name);
    }
    let portName = port ? port.portName : "";
    let portGroup = "";
    const devices = portName ? [portName] : fs.readdirSync("/dev").filter((name) => /^tty(USB|ACM|AMA|S)\d+$/.test(name)).sort().map((name) => "/dev/" + name);
    for (const device of devices)
    {
      try
      {
        portGroup = byGid.get(fs.statSync(device).gid) || "";
        if (!portName) portName = device;
        break;
      }
      catch (e)
      {
        // Not there (unplugged)
      }
    }
    return serialLinuxNotice(userGroups, portName, portGroup, systemGroups);
  }
  catch (e)
  {
    return null;
  }
}

// The Linux notice under a service's Port row: shown with the group and the device in it, or hidden
function serialLinuxRender(row, text, port, on)
{
  const notice = on ? serialLinuxCheck(port) : null;
  row.style.display = notice ? "" : "none";
  if (notice) text.textContent = I18N(notice.port ? "settings.rotor.linuxGroup" : "settings.rotor.linuxGroupNoPort").replace(/\{group\}/g, notice.group).replace("{port}", notice.port);
}
