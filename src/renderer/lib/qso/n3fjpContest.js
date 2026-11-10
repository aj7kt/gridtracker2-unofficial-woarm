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
// a Feed Roster or map spot clicked goes to it, before AC Log and Log4OM (rtsn.js, pota.js). A QSO logged in it (ENTEREVENT,
// which carries the whole QSO) is GridTracker's at once: worked on the map and in the rosters, in the backup log when that's
// on, and with Also Log To My Other Logs to the logs and services GridTracker logs to, as a WSJT-X QSO is (sendToLogger)

GT.n3fjpContestInstanceId = "N3FJP-Contest";
GT.n3fjpContestSocket = null;
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

// Every second (ui.js): opens or closes the connection with the Connect setting
function connectToN3fjpContest()
{
  if (GT.n3fjpContestSocket && !GT.settings.n3fjpContest.connect) closeN3fjpContest();
  if (GT.n3fjpContestSocket || !GT.settings.n3fjpContest.connect) return;
  if (!(GT.settings.n3fjpContest.port > 0 && String(GT.settings.n3fjpContest.ip).length > 4)) return;

  const net = window.require("net");
  const socket = new net.Socket();
  GT.n3fjpContestSocket = socket;
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
  const instance = GT.instances[GT.n3fjpContestInstanceId];
  if (instance && instance.open)
  {
    instance.open = false;
    handleClosed(GT.n3fjpContestStatus);
  }
  updateN3fjpContestConnectStatus();
}

// A contest log's mode as GridTracker's: phone and the sidebands are SSB
function n3fjpContestMode(mode)
{
  mode = String(mode || "").trim().toUpperCase();
  return ["PH", "SSB", "USB", "LSB", "PHONE"].includes(mode) ? "SSB" : mode;
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
// as an ADIF record. With Also Log To My Other Logs it goes on as a WSJT-X QSO does (sendToLogger: the logs and services
// GridTracker logs to, the backup log, and GridTracker's own); otherwise it is only GridTracker's (worked on the map and in
// the rosters) and in the backup log when that's on
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
  set("QSO_DATE", object.QSO_DATE);
  set("TIME_ON", object.TIME_ON);
  set("RST_SENT", object.RST_SENT);
  set("RST_RCVD", object.RST_RCVD);
  set("STATION_CALLSIGN", String(object.MYCALL || "").toUpperCase());
  if (Number(object.DXCC) > 0) set("DXCC", String(Number(object.DXCC)));
  set("CONT", object.CONT);
  if (!record.CALL || !record.BAND || !record.MODE || !record.QSO_DATE || !record.TIME_ON) return;

  if (GT.settings.n3fjpContest.logOthers)
  {
    let adif = "<EOH>";
    for (const key in record) adif += "<" + key + ":" + record[key].length + ">" + record[key] + " ";
    sendToLogger(adif + "<EOR>");
    return;
  }

  // Only GridTracker's: the station's call and grid, and the country, as sendToLogger fills them in
  if (!record.STATION_CALLSIGN && GT.settings.app.myCall != "NOCALL" && GT.settings.app.myCall.length > 0) record.STATION_CALLSIGN = GT.settings.app.myCall;
  if (GT.settings.app.myGrid.length > 1) record.MY_GRIDSQUARE = GT.settings.app.myGrid;
  if (!record.DXCC)
  {
    const dxcc = callsignToDxcc(record.CALL);
    if (dxcc > 0) record.DXCC = String(dxcc);
  }
  if (Number(record.DXCC) > 0 && GT.dxccToADIFName[Number(record.DXCC)]) record.COUNTRY = GT.dxccToADIFName[Number(record.DXCC)];
  let report = "";
  for (const key in record)
  {
    // As finishSendingReport: no value that isn't plain ASCII
    if (record[key].length != Buffer.byteLength(record[key])) continue;
    report += "<" + key + ":" + record[key].length + ">" + record[key] + " ";
  }
  report += "<EOR>";
  addEvent("log", "<font style='color:#FFA500'>▲ </font><font style='color:var(--gt-title)'> " + I18N("gt.log.newQSO") + " </font><font style='color:var(--gt-callsign)'>" + record.CALL + "</font><font style='color:#FFA500'> ▲</font>");
  try
  {
    onAdiLoadComplete(report, null, true);
  }
  catch (e)
  {
    addEvent("log", "<font style='color:var(--gt-error)'>" + I18N("gt.log.exceptionInternal") + "</font>");
  }
  writeBackupLogQso(report, record);
}
