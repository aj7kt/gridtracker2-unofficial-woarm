// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// N3FJP Contest Log (Settings -> Logging -> N3FJP Contest Log, Connect): any of N3FJP's contest logs (CQ WW, WPX, Field
// Day, NAQP, the State QSO Parties ...) through the TCP API they share with AC Log, on a port of its own (AC Log keeps 1100).
// Kept apart from AC Log (acLog.js): a contest log is a program of its own, and differs where it matters:
//   - Its band and mode can't be written into its fields (it ignores that): without a rig CHANGEBM, with one CHANGEFREQ
//   - The contest's mode is enforced: logging in another one pops a modal "Incorrect Mode" dialog, and the API answers
//     nothing until it's closed. So a spot never changes its mode (CHANGEFREQ with SUPPRESSMODEDEFAULT; CHANGEBM with the
//     mode it already has)
//   - Its hidden fields (grid, the Other fields) stay filled after a QSO is logged, so the next one typed by hand would take
//     them: a spot writes only the call
//   - Its log holds the contest's QSOs only: AC Log (or the other logs) stays GridTracker's logbook
// Like AC Log and Log4OM it is a rig source (its band, mode and frequency: an instance of its own), and while it is connected
// a Feed Roster or map spot clicked goes to it, before AC Log and Log4OM (rtsn.js feedSpotTarget). A QSO logged in it
// (ENTEREVENT, which carries the whole QSO) goes the way a WSJT-X QSO does (sendToLogger): GridTracker's at once, worked on
// the map and in the rosters, in the backup log when that's on, and with Also Log To My Other Logs to the logs and services
// GridTracker logs to as well

GT.n3fjpContestInstanceId = "N3FJP-Contest";
GT.n3fjpContestSocket = null;
// The address and port it is connected to ("ip:port"): another set in Settings reconnects (connectToN3fjpContest)
GT.n3fjpContestTarget = "";
GT.n3fjpContestPollTimer = null;
GT.n3fjpContestStatus = {
  Id: GT.n3fjpContestInstanceId,
  event: "Status",
  Frequency: 0,
  Band: "OOB",
  MO: "???",
  TxEnabled: 0,
  Transmitting: 0,
  Decoding: 0,
  DEcall: "",
  DEgrid: "",
  DXcall: "",
  DXgrid: "",
  Report: "-",
  instance: GT.n3fjpContestInstanceId
};
// What it said about itself: its program and version (PROGRAM), its rig ("None" without one: RIGENABLED), and its band and
// mode as READBMF last gave them (the mode as it names it: CHANGEBM takes it back unchanged)
GT.n3fjpContest = { program: "", rig: "", band: "", mode: "" };
// Its commands go out this far apart (the API asks for at least 5 ms between action commands)
const N3FJP_CONTEST_COMMAND_GAP_MS = 25;
// Asked again this often while connected (it also says band / mode / frequency changes on its own)
const N3FJP_CONTEST_POLL_MS = 5000;
GT.n3fjpContestQueue = [];
GT.n3fjpContestQueueTimer = null;

// Connected, and its instance open: any spot can be worked through it
function n3fjpContestCanWork(callObj)
{
  return GT.settings.n3fjpContest.connect && GT.n3fjpContestSocket != null && GT.n3fjpContestSocket.connecting == false &&
    GT.n3fjpContestInstanceId in GT.instances && GT.instances[GT.n3fjpContestInstanceId].open == true;
}

// A command on its way, after the ones before it (N3FJP_CONTEST_COMMAND_GAP_MS apart)
function n3fjpContestSend(command)
{
  GT.n3fjpContestQueue.push(command);
  if (!GT.n3fjpContestQueueTimer) n3fjpContestSendNext();
}

function n3fjpContestSendNext()
{
  GT.n3fjpContestQueueTimer = null;
  const command = GT.n3fjpContestQueue.shift();
  if (command === undefined) return;
  if (GT.n3fjpContestSocket && !GT.n3fjpContestSocket.destroyed) GT.n3fjpContestSocket.write(command + "\r\n");
  GT.n3fjpContestQueueTimer = nodeTimers.setTimeout(n3fjpContestSendNext, N3FJP_CONTEST_COMMAND_GAP_MS);
}

// Its rig, when it has one (RIGENABLED: "None" without)
function n3fjpContestHasRig()
{
  return GT.n3fjpContest.rig.length > 0 && GT.n3fjpContest.rig.toUpperCase() != "NONE";
}

// A spot clicked for the contest log: its entry cleared, with Enable Rig Control the rig tuned to the spot's frequency
// through it (its mode kept), or without a rig its band set (its mode kept); then the call, tabbed out so it fills in the
// country, zone and RST. Nothing else is written (its hidden fields would stay for the next QSO)
function n3fjpContestWorkSpot(callObj)
{
  n3fjpContestSend(aclAction("CLEAR").trim());
  if (GT.settings.n3fjpContest.rigControl)
  {
    if (n3fjpContestHasRig() && callObj.freq > 0)
    {
      n3fjpContestSend(valueToXmlField("CMD", "<CHANGEFREQ>" + valueToXmlField("VALUE", (callObj.freq / 1000000).toFixed(6)) +
        valueToXmlField("SUPPRESSMODEDEFAULT", "TRUE")));
    }
    else if (!n3fjpContestHasRig() && GT.n3fjpContest.mode)
    {
      // Its band field has no unit ("20", "70" for 70cm)
      const band = String(callObj.band || "").replace(/c?m$/, "");
      if (band && band != GT.n3fjpContest.band)
      {
        n3fjpContestSend(valueToXmlField("CMD", "<CHANGEBM>" + valueToXmlField("BAND", band) + valueToXmlField("MODE", GT.n3fjpContest.mode)));
      }
    }
  }
  n3fjpContestSend(aclUpdateControlValue("TXTENTRYCALL", callObj.DEcall).trim());
  n3fjpContestSend(aclAction("CALLTAB").trim());
}

// Settings -> Logging -> N3FJP Contest Log: a green / red dot right of Connect, as AC Log's; its tooltip names the program
// connected to
function updateN3fjpContestConnectStatus()
{
  if (typeof n3fjpContestConnectStatus == "undefined") return;
  let html = "";
  let title = "";
  if (GT.settings.n3fjpContest.connect)
  {
    const connected = GT.n3fjpContestSocket != null && GT.n3fjpContestSocket.connecting == false;
    html = `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background-color:${connected ? "#00DD00" : "#FF3333"};margin-left:3px;vertical-align:middle;"></span>`;
    if (connected && GT.n3fjpContest.program) title = I18N("settings.logging.N3FJPContest.connected.hover").replace("{0}", GT.n3fjpContest.program);
  }
  if (n3fjpContestConnectStatus.innerHTML != html) n3fjpContestConnectStatus.innerHTML = html;
  if (n3fjpContestConnectStatus.title != title) n3fjpContestConnectStatus.title = title;
}

// Every second (ui.js): opens or closes the connection with the Connect setting; another address or port typed while connected:
// closed, and opened there on the next tick
function connectToN3fjpContest()
{
  const target = String(GT.settings.n3fjpContest.ip).trim() + ":" + Number(GT.settings.n3fjpContest.port);
  if (GT.n3fjpContestSocket && (!GT.settings.n3fjpContest.connect || GT.n3fjpContestTarget != target)) closeN3fjpContest();
  if (GT.n3fjpContestSocket || !GT.settings.n3fjpContest.connect) return;
  if (!(GT.settings.n3fjpContest.port > 0 && String(GT.settings.n3fjpContest.ip).length > 4)) return;

  const net = window.require("net");
  const socket = new net.Socket();
  GT.n3fjpContestSocket = socket;
  GT.n3fjpContestTarget = target;
  let buffer = "";
  socket.on("error", () => closeN3fjpContest());
  socket.on("end", () => closeN3fjpContest());
  socket.connect(Number(GT.settings.n3fjpContest.port), GT.settings.n3fjpContest.ip, () =>
  {
    if (GT.n3fjpContestSocket !== socket) return;
    if (!(GT.n3fjpContestInstanceId in GT.instances))
    {
      addNewInstance(GT.n3fjpContestInstanceId);
      const instance = GT.instances[GT.n3fjpContestInstanceId];
      instance.crEnable = false;
      instance.canRoster = false;
      instance.valid = false;
      instance.oldStatus = null;
      instance.status = GT.n3fjpContestStatus;
    }
    for (const command of ["PROGRAM", "OPINFO", "RIGENABLED", "READBMF"]) n3fjpContestSend(`<CMD><${command}></CMD>`);
    nodeTimers.clearInterval(GT.n3fjpContestPollTimer);
    GT.n3fjpContestPollTimer = nodeTimers.setInterval(() =>
    {
      if (!GT.n3fjpContestSocket) return;
      n3fjpContestSend("<CMD><RIGENABLED></CMD>");
      n3fjpContestSend("<CMD><READBMF></CMD>");
      // Its entry's call (cleared there by hand, or typed without tabbing out: no event says so)
      n3fjpContestSend("<CMD><READ><CONTROL>TXTENTRYCALL</CONTROL></CMD>");
    }, N3FJP_CONTEST_POLL_MS);
    updateN3fjpContestConnectStatus();
  });
  // Its messages, each <CMD> ... </CMD> (some span several lines)
  socket.on("data", (data) =>
  {
    buffer += Buffer.from(data).toString();
    let end;
    while ((end = buffer.indexOf("</CMD>")) > -1)
    {
      const start = buffer.indexOf("<CMD>");
      const message = start > -1 && start < end ? buffer.substring(start, end + 6) : "";
      buffer = buffer.substring(end + 6);
      if (message) handleN3fjpContestMessage(message);
    }
    // (nothing sensible is this long)
    if (buffer.length > 65536) buffer = "";
  });
  updateN3fjpContestConnectStatus();
}

function closeN3fjpContest()
{
  nodeTimers.clearInterval(GT.n3fjpContestPollTimer);
  GT.n3fjpContestPollTimer = null;
  nodeTimers.clearTimeout(GT.n3fjpContestQueueTimer);
  GT.n3fjpContestQueueTimer = null;
  GT.n3fjpContestQueue = [];
  if (GT.n3fjpContestSocket)
  {
    try { GT.n3fjpContestSocket.destroy(); } catch (e) { /* already closed */ }
    GT.n3fjpContestSocket = null;
  }
  GT.n3fjpContest = { program: "", rig: "", band: "", mode: "" };
  GT.n3fjpContestTarget = "";
  // (not the last entry's call when it's connected again)
  GT.n3fjpContestStatus.DXcall = GT.n3fjpContestStatus.DXgrid = "";
  const instance = GT.instances[GT.n3fjpContestInstanceId];
  if (instance && instance.open)
  {
    instance.open = false;
    handleClosed(GT.n3fjpContestStatus);
  }
  updateN3fjpContestConnectStatus();
}

// A contest log's mode as GridTracker's (and ADIF's): phone and the sidebands are SSB, N3FJP's RY is RTTY, and its DIG (Field Day's
// digital) DATA
function n3fjpContestMode(mode)
{
  mode = String(mode || "").trim().toUpperCase();
  if (["PH", "SSB", "USB", "LSB", "PHONE"].includes(mode)) return "SSB";
  if (mode == "RY" || mode == "RTTY") return "RTTY";
  if (mode == "DIG") return "DATA";
  return mode;
}

function handleN3fjpContestMessage(message)
{
  const object = parseAcLogXML(message.substring(0, message.length - 6));
  if (!object.type) return;
  const status = GT.n3fjpContestStatus;
  let changed = false;

  if (object.type == "PROGRAMRESPONSE")
  {
    GT.n3fjpContest.program = [object.PGM, object.VER].filter((part) => part).join(" ").trim();
    updateN3fjpContestConnectStatus();
  }
  else if (object.type == "OPINFORESPONSE")
  {
    const call = String(object.CALL || "").toUpperCase();
    if (call != status.DEcall)
    {
      status.DEcall = call;
      changed = true;
    }
  }
  else if (object.type == "RIGRESPONSE")
  {
    GT.n3fjpContest.rig = String(object.RIG || "").trim();
  }
  else if (object.type == "READBMFRESPONSE")
  {
    GT.n3fjpContest.band = String(object.BAND || "").trim();
    GT.n3fjpContest.mode = String(object.MODE || "").trim();
    const frequency = Math.round((Number(object.FREQ) || 0) * 1000000);
    const band = frequency > 0 ? formatBand(frequency / 1000000) : acLogBand(object.BAND) || "OOB";
    const mode = n3fjpContestMode(object.MODE) || status.MO;
    if (frequency != status.Frequency || band != status.Band || mode != status.MO)
    {
      status.Frequency = frequency;
      status.Band = band;
      status.MO = mode;
      changed = true;
    }
  }
  else if (object.type == "CALLTABEVENT")
  {
    status.DXcall = String(object.CALL || "").toUpperCase();
    status.DXgrid = object.LAT && object.LON ? latLonToGridSquare(Number(object.LAT), Number(object.LON)) : "";
    changed = true;
  }
  else if (object.type == "READRESPONSE" && String(object.CONTROL || "").toUpperCase() == "TXTENTRYCALL")
  {
    // The same call keeps its grid; another (typed without tabbing out) has none yet; none clears both
    const call = String(object.VALUE || "").trim().toUpperCase();
    n3fjpContestDxCall(call, call == status.DXcall ? status.DXgrid : "");
  }
  else if (object.type == "ENTEREVENT")
  {
    n3fjpContestQsoLogged(object);
  }

  // Any message means it's there: its instance opens, once its band is known (READBMF: not as "OOB" first, in the Event Viewer
  // and the band / mode event)
  const instance = GT.instances[GT.n3fjpContestInstanceId];
  if (!instance) return;
  if (!instance.open && !GT.n3fjpContest.band) return;
  if (!instance.open)
  {
    instance.open = true;
    instance.valid = true;
    changed = true;
    updateRosterInstances();
  }
  if (changed) handleInstanceStatus(status);
}

// A QSO logged in the contest log (its ENTEREVENT: call, band, mode, frequency, date, time, RSTs, DXCC, its operator's call),
// as an ADIF record, with the grid and park of the Feed Roster spot it came from. It goes the way a WSJT-X QSO does
// (sendToLogger: filled in as every QSO is, SOTA_REF and the summit's grid among them, then GridTracker's own log and the backup
// log), and with Also Log To My Other Logs on to the logs and services GridTracker logs to as well (otherwise local only)
function n3fjpContestQsoLogged(object)
{
  const record = {};
  const set = (key, value) =>
  {
    value = String(value == null ? "" : value).trim();
    if (value) record[key] = value;
  };
  set("CALL", String(object.CALL || "").toUpperCase());
  set("BAND", acLogBand(object.BAND));
  set("MODE", n3fjpContestMode(object.MODE));
  const freq = Number(object.FREQ);
  if (freq > 0) set("FREQ", freq.toFixed(6));
  // ADIF's YYYYMMDD and HHMMSS (N3FJP's other replies write 2026/11/10 and 12:34:56; an HHMM time gets its seconds)
  const date = String(object.QSO_DATE || "").replace(/\D/g, "");
  let time = String(object.TIME_ON || "").replace(/\D/g, "");
  if (time.length == 4) time += "00";
  if (date.length == 8) set("QSO_DATE", date);
  if (time.length == 6) set("TIME_ON", time);
  set("RST_SENT", object.RST_SENT);
  set("RST_RCVD", object.RST_RCVD);
  set("STATION_CALLSIGN", String(object.MYCALL || "").toUpperCase());
  if (Number(object.DXCC) > 0) set("DXCC", String(Number(object.DXCC)));
  set("CONT", object.CONT);
  if (!record.CALL || !record.BAND || !record.MODE || !record.QSO_DATE || !record.TIME_ON) return;

  // The spot it came from (this call on this band): its grid, and its park (sendToLogger takes no inbound POTA_REF)
  const spot = n3fjpContestSpotOf(record.CALL, record.BAND);
  const grid = spot ? String((spot.fullGrid && spot.fullGrid.length >= 4 ? spot.fullGrid : spot.grid) || "").toUpperCase() : "";
  if (/^[A-R]{2}[0-9]{2}([A-X]{2})?$/.test(grid)) record.GRIDSQUARE = grid;

  // The contest log empties its entry once a QSO is logged: its call no longer the DX call
  n3fjpContestDxCall("");

  let adif = "<EOH>";
  for (const key in record) adif += "<" + key + ":" + record[key].length + ">" + record[key] + " ";
  sendToLogger(adif + "<EOR>", { localOnly: GT.settings.n3fjpContest.logOthers !== true, potaRef: spot ? spot.pota : "" });
}

// The newest Feed Roster spot of a call on a band, else null
function n3fjpContestSpotOf(call, band)
{
  let best = null;
  for (const hash in GT.feedCallsigns)
  {
    const callObj = GT.feedCallsigns[hash];
    if (callObj.DEcall == call && callObj.band == band && (!best || callObj.age > best.age)) best = callObj;
  }
  return best;
}

// The contest log's DX call (and its grid) as GridTracker shows it, changed: an empty entry clears it
function n3fjpContestDxCall(call, grid = "")
{
  const status = GT.n3fjpContestStatus;
  call = String(call || "").toUpperCase();
  if (!call) grid = "";
  if (call == status.DXcall && grid == status.DXgrid) return;
  status.DXcall = call;
  status.DXgrid = grid;
  const instance = GT.instances[GT.n3fjpContestInstanceId];
  if (instance && instance.open) handleInstanceStatus(status);
}
