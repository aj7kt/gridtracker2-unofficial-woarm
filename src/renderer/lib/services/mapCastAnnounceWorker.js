// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// Map Cast's media server (Settings -> Features -> Casting -> Announce On Network; mapCast.js starts it while the video is served), off the
// main window's thread: the map's video listed on the network as a UPnP / DLNA MediaServer, so players there (Kodi, VLC, Roku Media
// Player, smart TVs' media apps) find it themselves and play it. Node's dgram and http (the main window has nodeIntegrationInWorker).
//   SSDP: on 239.255.255.250:1900, NOTIFY ssdp:alive on every network interface at the start (a few times: UDP may be lost) and each
//   ANNOUNCE_ALIVE_MS, ssdp:byebye at the stop; a search (M-SEARCH) for anything this is answered, from the interface the asker is on.
//   HTTP: on a port of the system's choosing (the SSDP messages carry it): the device's description, its two services' descriptions, and
//   their SOAP controls. ContentDirectory: one folder (its name) with one video (title: the live map), whose addresses are the cast
//   worker's, on its Port (mapCastWorker.js): map.ts (one endless MPEG-TS stream, which most DLNA players take) first, then map.m3u8
//   (HLS). ConnectionManager: what it serves. Event subscriptions are accepted, and nothing is sent to them: nothing here ever changes.
//   Its identity (the UDN) is made from the computer's name, so a player's saved place for it stays good from start to start.
// In:  { type: "start", castPort, name, title, version }, { type: "stop" }
// Out: { type: "log", text }, { type: "error", text }

const dgram = require("dgram");
const http = require("http");
const os = require("os");
const crypto = require("crypto");
// Node's timers, as every window uses: never Chromium's, which can be slowed while a window is hidden
const nodeTimers = require("timers");

const ANNOUNCE_SSDP_ADDRESS = "239.255.255.250";
const ANNOUNCE_SSDP_PORT = 1900;
// How long an announcement holds (CACHE-CONTROL), how often it's made again, and when at the start
const ANNOUNCE_MAX_AGE = 1800;
const ANNOUNCE_ALIVE_MS = 600000;
const ANNOUNCE_START_MS = [0, 1500, 4000];
// A search answered after a random wait of up to this (its MX allows more; spread out for the asker)
const ANNOUNCE_REPLY_MS = 500;
const ANNOUNCE_DEVICE = "urn:schemas-upnp-org:device:MediaServer:1";
const ANNOUNCE_CONTENT = "urn:schemas-upnp-org:service:ContentDirectory:1";
const ANNOUNCE_CONNECTION = "urn:schemas-upnp-org:service:ConnectionManager:1";
// The video's two forms, as DLNA protocolInfo: a stream (no seeking), and HLS
const ANNOUNCE_STREAM_INFO = "http-get:*:video/mp2t:DLNA.ORG_OP=00;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000";
const ANNOUNCE_HLS_INFO = "http-get:*:application/vnd.apple.mpegurl:*";

const A = {
  castPort: 0,
  name: "GridTracker2",
  title: "",
  version: "",
  uuid: "",
  server: null,
  port: 0,
  ssdp: null,
  aliveTimer: null,
  startTimers: [],
  // The interfaces' addresses the SSDP socket has joined the group on
  joined: new Set()
};

function announceLog(text)
{
  self.postMessage({ type: "log", text: text });
}

// The UDN: a UUID made from the computer's name (the same from start to start)
function announceUuid()
{
  const hex = crypto.createHash("md5").update("GridTracker2 map cast " + os.hostname()).digest("hex");
  return [hex.slice(0, 8), hex.slice(8, 12), "3" + hex.slice(13, 16), ((parseInt(hex[16], 16) & 3) | 8).toString(16) + hex.slice(17, 20), hex.slice(20, 32)].join("-");
}

function announceXml(text)
{
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// The computer's IPv4 addresses on the network: [{ address, netmask }]
function announceInterfaces()
{
  return Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family == "IPv4" && !a.internal);
}

function announceIpNumber(address)
{
  return address.split(".").reduce((n, part) => n * 256 + Number(part), 0);
}

// The address of the interface an asker is on (its subnet), else the first
function announceAddressFor(remote)
{
  const all = announceInterfaces();
  const r = announceIpNumber(remote);
  const near = all.find((a) =>
  {
    // (the subnet's size: its addresses share the same quotient)
    const size = 2 ** 32 - announceIpNumber(a.netmask);
    return Math.floor(announceIpNumber(a.address) / size) == Math.floor(r / size);
  });
  return (near || all[0])?.address || "";
}

function announceServerHeader()
{
  return os.type() + "/" + os.release() + " UPnP/1.0 DLNADOC/1.50 GridTracker2/" + A.version;
}

// The device and its services, as each NT / ST is with its USN
function announceTargets()
{
  const udn = "uuid:" + A.uuid;
  return [
    { nt: "upnp:rootdevice", usn: udn + "::upnp:rootdevice" },
    { nt: udn, usn: udn },
    { nt: ANNOUNCE_DEVICE, usn: udn + "::" + ANNOUNCE_DEVICE },
    { nt: ANNOUNCE_CONTENT, usn: udn + "::" + ANNOUNCE_CONTENT },
    { nt: ANNOUNCE_CONNECTION, usn: udn + "::" + ANNOUNCE_CONNECTION }
  ];
}

function announceLocation(address)
{
  return "http://" + address + ":" + A.port + "/upnp/device.xml";
}

// ---- SSDP

function announceSsdpStart()
{
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  A.ssdp = socket;
  socket.on("error", (e) =>
  {
    if (A.ssdp != socket) return;
    self.postMessage({ type: "error", text: "ssdp " + e.message });
  });
  socket.on("message", announceSearched);
  socket.bind(ANNOUNCE_SSDP_PORT, () =>
  {
    if (A.ssdp != socket) return;
    announceJoin();
    for (const ms of ANNOUNCE_START_MS) A.startTimers.push(nodeTimers.setTimeout(() => announceNotify("ssdp:alive"), ms));
    A.aliveTimer = nodeTimers.setInterval(() => announceNotify("ssdp:alive"), ANNOUNCE_ALIVE_MS);
    announceLog("announced as " + A.name + " (uuid:" + A.uuid + ") at port " + A.port);
  });
}

// The SSDP group joined on every interface (again with each announcement: one may have come up since)
function announceJoin()
{
  for (const a of announceInterfaces())
  {
    if (A.joined.has(a.address)) continue;
    try
    {
      A.ssdp.addMembership(ANNOUNCE_SSDP_ADDRESS, a.address);
      A.joined.add(a.address);
    }
    catch (e)
    {
      announceLog("join on " + a.address + ": " + e.message);
    }
  }
}

// NOTIFY (nts: ssdp:alive or ssdp:byebye) for each of the targets, out of every interface (a socket on each, closed when sent); done
// once all are sent
function announceNotify(nts)
{
  if (nts == "ssdp:alive" && A.ssdp) announceJoin();
  const sends = [];
  for (const a of announceInterfaces())
  {
    sends.push(new Promise((resolve) =>
    {
      const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
      socket.on("error", () =>
      {
        try
        {
          socket.close();
        }
        catch (e)
        {
          // Already closed
        }
        resolve();
      });
      socket.bind(0, a.address, () =>
      {
        try
        {
          socket.setMulticastInterface(a.address);
        }
        catch (e)
        {
          // The system's choice of interface then
        }
        const messages = announceTargets().map((target) =>
        {
          const lines = ["NOTIFY * HTTP/1.1", "HOST: " + ANNOUNCE_SSDP_ADDRESS + ":" + ANNOUNCE_SSDP_PORT, "NT: " + target.nt, "NTS: " + nts, "USN: " + target.usn];
          if (nts == "ssdp:alive") lines.push("CACHE-CONTROL: max-age=" + ANNOUNCE_MAX_AGE, "LOCATION: " + announceLocation(a.address), "SERVER: " + announceServerHeader());
          return Buffer.from(lines.join("\r\n") + "\r\n\r\n", "utf8");
        });
        let left = messages.length;
        for (const message of messages)
        {
          socket.send(message, ANNOUNCE_SSDP_PORT, ANNOUNCE_SSDP_ADDRESS, () =>
          {
            if (--left > 0) return;
            socket.close();
            resolve();
          });
        }
      });
    }));
  }
  return Promise.all(sends);
}

// An M-SEARCH: answered (unicast, from its interface's address) for each target it asks for, after a short random wait
function announceSearched(msg, rinfo)
{
  const text = msg.toString("utf8");
  if (!/^M-SEARCH \* HTTP\/1\.1/i.test(text) || !/^MAN:\s*"ssdp:discover"/im.test(text)) return;
  const st = (/^ST:\s*(.+)$/im.exec(text) || [])[1]?.trim() || "";
  const targets = announceTargets().filter((target) => st == "ssdp:all" || st == target.nt);
  if (!targets.length || !A.port) return;
  const address = announceAddressFor(rinfo.address);
  if (!address) return;
  nodeTimers.setTimeout(() =>
  {
    if (!A.ssdp) return;
    for (const target of targets)
    {
      const lines = ["HTTP/1.1 200 OK", "CACHE-CONTROL: max-age=" + ANNOUNCE_MAX_AGE, "DATE: " + new Date().toUTCString(), "EXT:", "LOCATION: " + announceLocation(address), "SERVER: " + announceServerHeader(), "ST: " + target.nt, "USN: " + target.usn];
      A.ssdp.send(Buffer.from(lines.join("\r\n") + "\r\n\r\n", "utf8"), rinfo.port, rinfo.address);
    }
  }, Math.floor(Math.random() * ANNOUNCE_REPLY_MS));
}

// ---- HTTP: descriptions and controls

function announceDeviceXml()
{
  const service = (type, id, path) => "<service><serviceType>" + type + "</serviceType><serviceId>urn:upnp-org:serviceId:" + id + "</serviceId><SCPDURL>/upnp/" + path + ".xml</SCPDURL><controlURL>/upnp/" + path + "/control</controlURL><eventSubURL>/upnp/" + path + "/event</eventSubURL></service>";
  return "<?xml version=\"1.0\" encoding=\"utf-8\"?>\r\n" +
    "<root xmlns=\"urn:schemas-upnp-org:device-1-0\" xmlns:dlna=\"urn:schemas-dlna-org:device-1-0\"><specVersion><major>1</major><minor>0</minor></specVersion><device>" +
    "<deviceType>" + ANNOUNCE_DEVICE + "</deviceType><dlna:X_DLNADOC>DMS-1.50</dlna:X_DLNADOC><friendlyName>" + announceXml(A.name) + "</friendlyName>" +
    "<manufacturer>GridTracker.org</manufacturer><manufacturerURL>https://gridtracker.org</manufacturerURL><modelDescription>GridTracker2 live map</modelDescription>" +
    "<modelName>GridTracker2</modelName><modelNumber>" + announceXml(A.version) + "</modelNumber><modelURL>https://gridtracker.org</modelURL><UDN>uuid:" + A.uuid + "</UDN>" +
    "<serviceList>" + service(ANNOUNCE_CONTENT, "ContentDirectory", "cds") + service(ANNOUNCE_CONNECTION, "ConnectionManager", "cms") + "</serviceList>" +
    "</device></root>\r\n";
}

// A service's description: its actions ([name, [[argument, direction, state variable]]]) and state variables ([name, type, evented])
function announceScpd(actions, variables)
{
  const action = ([name, args]) => "<action><name>" + name + "</name><argumentList>" + args.map(([arg, direction, variable]) => "<argument><name>" + arg + "</name><direction>" + direction + "</direction><relatedStateVariable>" + variable + "</relatedStateVariable></argument>").join("") + "</argumentList></action>";
  const variable = ([name, type, evented]) => "<stateVariable sendEvents=\"" + (evented ? "yes" : "no") + "\"><name>" + name + "</name><dataType>" + type + "</dataType></stateVariable>";
  return "<?xml version=\"1.0\" encoding=\"utf-8\"?>\r\n<scpd xmlns=\"urn:schemas-upnp-org:service-1-0\"><specVersion><major>1</major><minor>0</minor></specVersion><actionList>" + actions.map(action).join("") + "</actionList><serviceStateTable>" + variables.map(variable).join("") + "</serviceStateTable></scpd>\r\n";
}

const ANNOUNCE_CDS_SCPD = announceScpd(
  [
    ["Browse", [["ObjectID", "in", "A_ARG_TYPE_ObjectID"], ["BrowseFlag", "in", "A_ARG_TYPE_BrowseFlag"], ["Filter", "in", "A_ARG_TYPE_Filter"], ["StartingIndex", "in", "A_ARG_TYPE_Index"], ["RequestedCount", "in", "A_ARG_TYPE_Count"], ["SortCriteria", "in", "A_ARG_TYPE_SortCriteria"], ["Result", "out", "A_ARG_TYPE_Result"], ["NumberReturned", "out", "A_ARG_TYPE_Count"], ["TotalMatches", "out", "A_ARG_TYPE_Count"], ["UpdateID", "out", "A_ARG_TYPE_UpdateID"]]],
    ["GetSearchCapabilities", [["SearchCaps", "out", "SearchCapabilities"]]],
    ["GetSortCapabilities", [["SortCaps", "out", "SortCapabilities"]]],
    ["GetSystemUpdateID", [["Id", "out", "SystemUpdateID"]]]
  ],
  [["A_ARG_TYPE_ObjectID", "string"], ["A_ARG_TYPE_BrowseFlag", "string"], ["A_ARG_TYPE_Filter", "string"], ["A_ARG_TYPE_Index", "ui4"], ["A_ARG_TYPE_Count", "ui4"], ["A_ARG_TYPE_SortCriteria", "string"], ["A_ARG_TYPE_Result", "string"], ["A_ARG_TYPE_UpdateID", "ui4"], ["SearchCapabilities", "string"], ["SortCapabilities", "string"], ["SystemUpdateID", "ui4", true]]
);

const ANNOUNCE_CMS_SCPD = announceScpd(
  [
    ["GetProtocolInfo", [["Source", "out", "SourceProtocolInfo"], ["Sink", "out", "SinkProtocolInfo"]]],
    ["GetCurrentConnectionIDs", [["ConnectionIDs", "out", "CurrentConnectionIDs"]]],
    ["GetCurrentConnectionInfo", [["ConnectionID", "in", "A_ARG_TYPE_ConnectionID"], ["RcsID", "out", "A_ARG_TYPE_RcsID"], ["AVTransportID", "out", "A_ARG_TYPE_AVTransportID"], ["ProtocolInfo", "out", "A_ARG_TYPE_ProtocolInfo"], ["PeerConnectionManager", "out", "A_ARG_TYPE_ConnectionManager"], ["PeerConnectionID", "out", "A_ARG_TYPE_ConnectionID"], ["Direction", "out", "A_ARG_TYPE_Direction"], ["Status", "out", "A_ARG_TYPE_ConnectionStatus"]]]
  ],
  [["SourceProtocolInfo", "string", true], ["SinkProtocolInfo", "string", true], ["CurrentConnectionIDs", "string", true], ["A_ARG_TYPE_ConnectionID", "i4"], ["A_ARG_TYPE_RcsID", "i4"], ["A_ARG_TYPE_AVTransportID", "i4"], ["A_ARG_TYPE_ProtocolInfo", "string"], ["A_ARG_TYPE_ConnectionManager", "string"], ["A_ARG_TYPE_Direction", "string"], ["A_ARG_TYPE_ConnectionStatus", "string"]]
);

// The folder (id "0") or the video (id "map") as DIDL-Lite, its addresses at host (the address the player reached this computer at); any
// other id: an empty list
function announceDidl(id, host)
{
  const open = "<DIDL-Lite xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\" xmlns:dlna=\"urn:schemas-dlna-org:metadata-1-0/\">";
  let body = "";
  if (id == "0") body = "<container id=\"0\" parentID=\"-1\" restricted=\"1\" searchable=\"0\" childCount=\"1\"><dc:title>" + announceXml(A.name) + "</dc:title><upnp:class>object.container.storageFolder</upnp:class></container>";
  else if (id == "map")
  {
    const base = "http://" + host + ":" + A.castPort + "/";
    body = "<item id=\"map\" parentID=\"0\" restricted=\"1\"><dc:title>" + announceXml(A.title) + "</dc:title><upnp:class>object.item.videoItem</upnp:class>" +
      "<res protocolInfo=\"" + ANNOUNCE_STREAM_INFO + "\">" + base + "map.ts</res><res protocolInfo=\"" + ANNOUNCE_HLS_INFO + "\">" + base + "map.m3u8</res></item>";
  }
  return open + body + "</DIDL-Lite>";
}

function announceSoapReply(response, service, action, values)
{
  const body = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\r\n<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:" + action + "Response xmlns:u=\"" + service + "\">" +
    Object.entries(values).map(([name, value]) => "<" + name + ">" + announceXml(value) + "</" + name + ">").join("") + "</u:" + action + "Response></s:Body></s:Envelope>\r\n";
  announceSend(response, 200, "text/xml; charset=\"utf-8\"", body);
}

function announceSoapFault(response, code, description)
{
  const body = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\r\n<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><s:Fault><faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail><UPnPError xmlns=\"urn:schemas-upnp-org:control-1-0\"><errorCode>" + code + "</errorCode><errorDescription>" + description + "</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>\r\n";
  announceSend(response, 500, "text/xml; charset=\"utf-8\"", body);
}

function announceSend(response, status, type, body, head = false)
{
  const bytes = Buffer.from(body, "utf8");
  response.writeHead(status, { "Content-Type": type, "Content-Length": bytes.length, "Server": announceServerHeader(), "Cache-Control": "no-store" });
  response.end(head ? undefined : bytes);
}

// An argument of a SOAP request (its text, entities decoded)
function announceArg(xml, name)
{
  const match = new RegExp("<(?:\\w+:)?" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?" + name + ">").exec(xml);
  return match ? match[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&").trim() : "";
}

// ContentDirectory: Browse (the folder's or the video's own metadata, or the folder's one child), and the capabilities (none)
function announceContent(response, action, xml, host)
{
  if (action == "Browse")
  {
    const id = announceArg(xml, "ObjectID") || "0";
    const flag = announceArg(xml, "BrowseFlag");
    const start = Number(announceArg(xml, "StartingIndex")) || 0;
    if (id != "0" && id != "map")
    {
      announceSoapFault(response, 701, "No such object");
      return;
    }
    if (flag == "BrowseMetadata") announceSoapReply(response, ANNOUNCE_CONTENT, action, { Result: announceDidl(id, host), NumberReturned: 1, TotalMatches: 1, UpdateID: 1 });
    else if (flag == "BrowseDirectChildren")
    {
      // (the video has none; the folder only the video)
      const total = id == "0" ? 1 : 0;
      const returned = start < total ? 1 : 0;
      const result = announceDidl(returned ? "map" : "", host);
      announceSoapReply(response, ANNOUNCE_CONTENT, action, { Result: result, NumberReturned: returned, TotalMatches: total, UpdateID: 1 });
    }
    else announceSoapFault(response, 402, "Invalid Args");
  }
  else if (action == "GetSearchCapabilities") announceSoapReply(response, ANNOUNCE_CONTENT, action, { SearchCaps: "" });
  else if (action == "GetSortCapabilities") announceSoapReply(response, ANNOUNCE_CONTENT, action, { SortCaps: "" });
  else if (action == "GetSystemUpdateID") announceSoapReply(response, ANNOUNCE_CONTENT, action, { Id: 1 });
  else announceSoapFault(response, 401, "Invalid Action");
}

// ConnectionManager: what's served (the video's two forms), no connections of its own
function announceConnection(response, action)
{
  if (action == "GetProtocolInfo") announceSoapReply(response, ANNOUNCE_CONNECTION, action, { Source: ANNOUNCE_STREAM_INFO + "," + ANNOUNCE_HLS_INFO, Sink: "" });
  else if (action == "GetCurrentConnectionIDs") announceSoapReply(response, ANNOUNCE_CONNECTION, action, { ConnectionIDs: "0" });
  else if (action == "GetCurrentConnectionInfo") announceSoapReply(response, ANNOUNCE_CONNECTION, action, { RcsID: -1, AVTransportID: -1, ProtocolInfo: "", PeerConnectionManager: "", PeerConnectionID: -1, Direction: "Output", Status: "OK" });
  else announceSoapFault(response, 401, "Invalid Action");
}

function announceRequest(request, response)
{
  const path = request.url.split("?")[0];
  const host = String(request.socket.localAddress || "").replace(/^::ffff:/, "");
  const remote = String(request.socket.remoteAddress || "").replace(/^::ffff:/, "");
  const head = request.method == "HEAD";
  if (request.method == "GET" || head)
  {
    const xml = path == "/upnp/device.xml" ? announceDeviceXml() : path == "/upnp/cds.xml" ? ANNOUNCE_CDS_SCPD : path == "/upnp/cms.xml" ? ANNOUNCE_CMS_SCPD : null;
    if (xml)
    {
      if (path == "/upnp/device.xml") announceLog("description read by " + remote);
      announceSend(response, 200, "text/xml; charset=\"utf-8\"", xml, head);
    }
    else announceSend(response, 404, "text/plain", "", head);
    return;
  }
  // Events: a subscription accepted (nothing changes, so nothing is ever sent to it), or let go
  if ((request.method == "SUBSCRIBE" || request.method == "UNSUBSCRIBE") && /^\/upnp\/(cds|cms)\/event$/.test(path))
  {
    const headers = { "Server": announceServerHeader(), "Content-Length": 0 };
    if (request.method == "SUBSCRIBE")
    {
      headers.SID = request.headers.sid || "uuid:" + crypto.randomUUID();
      headers.TIMEOUT = "Second-" + ANNOUNCE_MAX_AGE;
    }
    response.writeHead(200, headers);
    response.end();
    request.resume();
    return;
  }
  if (request.method == "POST" && (path == "/upnp/cds/control" || path == "/upnp/cms/control"))
  {
    let xml = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) =>
    {
      xml += chunk;
      // (no real request is this big)
      if (xml.length > 65536) request.destroy();
    });
    request.on("end", () =>
    {
      const action = (String(request.headers.soapaction || "").replace(/"/g, "").split("#")[1] || "").trim();
      announceLog(action + " from " + remote);
      try
      {
        if (path == "/upnp/cds/control") announceContent(response, action, xml, host);
        else announceConnection(response, action);
      }
      catch (e)
      {
        announceLog(action + " " + e.message);
        announceSoapFault(response, 501, "Action Failed");
      }
    });
    return;
  }
  announceSend(response, 405, "text/plain", "");
  request.resume();
}

// ---- Start and stop

function announceStart(msg)
{
  A.castPort = msg.castPort;
  A.name = msg.name || "GridTracker2";
  A.title = msg.title || A.name;
  A.version = msg.version || "";
  A.uuid = announceUuid();
  const server = http.createServer(announceRequest);
  A.server = server;
  server.on("error", (e) =>
  {
    if (A.server == server) self.postMessage({ type: "error", text: "http " + e.message });
  });
  server.listen(0, () =>
  {
    if (A.server != server) return;
    A.port = server.address().port;
    announceSsdpStart();
  });
}

// Goodbye said (once sent, or after a moment), everything closed, and the worker with it
async function announceStop()
{
  nodeTimers.clearInterval(A.aliveTimer);
  for (const timer of A.startTimers) nodeTimers.clearTimeout(timer);
  A.startTimers = [];
  if (A.ssdp && A.port) await Promise.race([announceNotify("ssdp:byebye"), new Promise((resolve) => nodeTimers.setTimeout(resolve, 1000))]);
  const ssdp = A.ssdp;
  A.ssdp = null;
  if (ssdp)
  {
    try
    {
      ssdp.close();
    }
    catch (e)
    {
      // Already closed
    }
  }
  if (A.server)
  {
    A.server.close();
    A.server.closeAllConnections();
  }
  A.server = null;
  self.close();
}

self.onmessage = (event) =>
{
  const msg = event.data;
  try
  {
    if (msg.type == "start") announceStart(msg);
    else if (msg.type == "stop") announceStop();
  }
  catch (e)
  {
    self.postMessage({ type: "error", text: msg.type + " " + e.message });
  }
};
