// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// Serial ports for the services that use one (Rotor Control, Rig Control), through Web Serial (Chromium's own: no native module). The
// browser only lists ports on a click (requestPort); the main process sends the list here to pick from (a menu) and, told which port a
// service keeps (by the identity Chromium grants by: the Windows device instance id, else the USB serial number, else the name),
// grants it again at each start, so getPorts() finds it without asking. With a port kept by each service, getPorts() is asked for one
// service's alone (serialPortGrantOnly), as the browser doesn't say which granted port is which

// The service whose Choose Port is open: { purpose, done(port), taken: [ports the other services have open] }
GT.serialPicking = null;

function serialPortsInit()
{
  electron.ipcRenderer.on("serialPortList", (event, list) => serialPortPick(list));
}

// What a service keeps of a port, from the browser's list entry
function serialPortIdentity(port)
{
  return { portName: port.portName, displayName: port.displayName || "", vendorId: port.vendorId || "", productId: port.productId || "", serialNumber: port.serialNumber || "", deviceInstanceId: port.deviceInstanceId || "" };
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

// The main process grants a service's port by this (at start, and whenever it changes)
function serialPortTell(purpose, port)
{
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
// have open are in the menu greyed (disabled)
function serialPortChoose(purpose, done)
{
  GT.serialPicking = { purpose: purpose, done: done, taken: serialPortsTaken(purpose) };
  navigator.serial.requestPort().catch(() => { /* nothing chosen */ }).finally(() => { GT.serialPicking = null; });
}

// The browser's list, from the main process: a menu to pick from; the one picked is kept by the service that asked
function serialPortPick(list)
{
  const picking = GT.serialPicking;
  let chosen = false;
  const menu = new Menu();
  if (list.length == 0) menu.append(new MenuItem({ label: I18N("settings.rotor.noPorts.label"), enabled: false }));
  for (const port of list)
  {
    const model = serialPortModel(port);
    menu.append(new MenuItem({
      label: (port.displayName && port.displayName != port.portName ? port.displayName + "  (" + port.portName + ")" : port.portName) + (model ? "  \u2014  " + model : ""),
      enabled: !(picking && picking.taken.some((taken) => serialPortSame(taken, port))),
      click: () =>
      {
        chosen = true;
        const identity = serialPortIdentity(port);
        if (picking)
        {
          serialPortTell(picking.purpose, identity);
          picking.done(identity);
        }
        electron.ipcRenderer.send("serialPortChosen", port.portId);
      }
    }));
  }
  menu.popup({ callback: () => { if (!chosen) electron.ipcRenderer.send("serialPortChosen", ""); } });
}

// One service at a time: two asking together (the rotor and the rig, at start) would each be handed the other's port
let serialPortTurn = Promise.resolve();

// The port a service keeps, as the browser has it: null when it isn't there (unplugged, or none chosen)
function serialPortFor(purpose)
{
  const mine = serialPortTurn.then(async () =>
  {
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
