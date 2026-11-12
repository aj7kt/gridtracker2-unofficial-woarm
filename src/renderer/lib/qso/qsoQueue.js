// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// Queue QSOs To Send Later (Settings -> Logging, Send Later: adifLog.queueQsos, off unless turned on), for operators who send their
// QSOs on in a batch (after a POTA trip, once a year), online or offline. With it on, every QSO finishSendingReport (adif.js) logs (WSJT-X's
// Logged ADIF and QSO Logged, JTDX's and MSHV's the same way, the Multi-Mode Decoder's Log QSO, a logger's ADIF broadcast) is logged here
// at once, as a local-only QSO is (GridTracker's own log, so the map and the rosters show it worked; the backup log when that's on), and
// what would have gone out (the logging programs and the online logbooks) waits in the queue: an ADIF file in Ginternal, each QSO
// appended as it comes and flushed, so it survives a restart or a crash. A POTA spot of your QSO is only for the moment it's made: a
// queued QSO has none, then or later. Send All sends each queued QSO the way it would have gone (qsoToUdpLoggers, then
// qsoToLoggersAndServices: never into GridTracker's own log a second time), on its own too once Send All After's count is queued
// (adifLog.queueAutoSend, queueSendAfter); Export ADIF saves the queue to a file. There's no way to empty it without sending (a Discard
// button was taken out: too easy to lose a trip's QSOs). A queued QSO isn't edited here: that's the logger's job. Off, nothing changes:
// every QSO goes out as it always has

const QSO_QUEUE_FILE = "qso-queue.adif";
// While Send All runs: how many of the queue file's QSOs, from its start, have been sent (so a QSO isn't sent twice after a crash
// halfway through: those are dropped as the queue is read at startup). Gone once the file is written again without them
const QSO_QUEUE_SENT_FILE = "qso-queue.sent";
// Send All: a QSO every so often (ms), so a year of them doesn't land on the services all at once
const QSO_QUEUE_STEP_MS = 500;
// Send All After: the count it takes (QSOs), and what it starts at
const QSO_QUEUE_AFTER_MIN = 1;
const QSO_QUEUE_AFTER_MAX = 9999;
const QSO_QUEUE_AFTER_DEFAULT = 25;

// list: the queued QSOs, oldest first (each its ADIF record as finishSendingReport made it, to its <EOR>); sending: Send All under way;
// sent: how many it has sent so far
GT.qsoQueue = { list: [], sending: false, sent: 0 };

function qsoQueueOn()
{
  return GT.settings.adifLog.queueQsos === true;
}

function qsoQueueCount()
{
  return GT.qsoQueue.list.length;
}

function qsoQueuePath(name = QSO_QUEUE_FILE)
{
  return path.join(GT.appData, name);
}

// A queue file's records (its text): each from after the header to its <EOR>, as written (the line break before it left off, the space
// after its last field kept)
function qsoQueueParse(text)
{
  const body = String(text || "").split(/<EOH>/i);
  const records = body[body.length - 1].split(/<EOR>/i).map((r) => r.replace(/^\s+/, "")).filter((r) => r.length > 0);
  return records.map((r) => r + "<EOR>");
}

// At startup: the queue read (without what a Send All cut short had sent already), its setting's box ticked as saved
function qsoQueueInit()
{
  try
  {
    const file = qsoQueuePath();
    if (fs.existsSync(file))
    {
      GT.qsoQueue.list = qsoQueueParse(fs.readFileSync(file, "utf8"));
      const sentFile = qsoQueuePath(QSO_QUEUE_SENT_FILE);
      if (fs.existsSync(sentFile))
      {
        const sent = parseInt(fs.readFileSync(sentFile, "utf8"));
        if (sent > 0) GT.qsoQueue.list.splice(0, sent);
        qsoQueueWrite();
      }
    }
  }
  catch (e)
  {
    console.error(e);
    addEvent("log", "<font style='color:var(--gt-error)'>" + htmlEntities(I18N("settings.logging.queue.event.error")) + "</font>");
  }
  qsoQueueRender();
}

// A QSO into the queue (finishSendingReport, with the queue on: report is its ADIF record): appended to the file and flushed at once
function qsoQueueAdd(report)
{
  GT.qsoQueue.list.push(report);
  try
  {
    const file = qsoQueuePath();
    if (!fs.existsSync(file)) fs.writeFileSync(file, backupAdifHeader, { flush: true });
    fs.appendFileSync(file, report + "\r\n", { flush: true });
    addEvent("log", "<font style='color:var(--gt-label)'>" + htmlEntities(I18N("settings.logging.queue.event.queued").replace("{count}", qsoQueueCount())) + "</font>");
  }
  catch (e)
  {
    console.error(e);
    addEvent("log", "<font style='color:var(--gt-error)'>" + htmlEntities(I18N("settings.logging.queue.event.error")) + "</font>");
  }
  qsoQueueRender();
  // A moment later: not from inside the finishSendingReport that queued this QSO
  nodeTimers.setTimeout(qsoQueueAutoCheck, QSO_QUEUE_STEP_MS);
}

// Send All After: the count it waits for (QSO_QUEUE_AFTER_DEFAULT when not set or out of range)
function qsoQueueSendAfter()
{
  const n = parseInt(GT.settings.adifLog.queueSendAfter);
  return n >= QSO_QUEUE_AFTER_MIN && n <= QSO_QUEUE_AFTER_MAX ? n : QSO_QUEUE_AFTER_DEFAULT;
}

// Send All After on and that many QSOs queued: Send All starts by itself (online, and not already sending: Send All checks both).
// Checked as a QSO is queued, and when the setting is changed
function qsoQueueAutoCheck()
{
  if (GT.settings.adifLog.queueAutoSend !== true || !qsoQueueOn()) return;
  if (qsoQueueCount() >= qsoQueueSendAfter()) qsoQueueSendAll();
}

// The queue file written again as the queue is now (by way of a file beside it, so a crash leaves one or the other whole); the sent
// count goes with it
function qsoQueueWrite()
{
  const file = qsoQueuePath();
  const sentFile = qsoQueuePath(QSO_QUEUE_SENT_FILE);
  if (GT.qsoQueue.list.length == 0)
  {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  else
  {
    const temp = file + ".tmp";
    fs.writeFileSync(temp, backupAdifHeader + GT.qsoQueue.list.join("\r\n") + "\r\n", { flush: true });
    fs.renameSync(temp, file);
  }
  if (fs.existsSync(sentFile)) fs.unlinkSync(sentFile);
}

// A queued QSO's record, and the texts finishSendingReport would have sent of it: the same fields in the same order (report), without
// STATE and CNTY (QRZ's), and the station call and grid the LoTW queue file is named by
function qsoReportParts(record)
{
  let report = "";
  for (const key in record)
  {
    if (record[key] == null || record[key].length != Buffer.byteLength(record[key]) || record[key].length == 0)
    {
      delete record[key];
      continue;
    }
    report += "<" + key + ":" + record[key].length + ">" + record[key] + " ";
  }
  report += "<EOR>";
  let reportNoStateNoCnty = "";
  for (const key in record)
  {
    if (key != "STATE" && key != "CNTY") reportNoStateNoCnty += "<" + key + ":" + record[key].length + ">" + record[key] + " ";
  }
  reportNoStateNoCnty += "<EOR>";
  const callsignFile = "STATION_CALLSIGN" in record ? record.STATION_CALLSIGN.replaceAll("/", "_") : "";
  const gridFile = "MY_GRIDSQUARE" in record ? record.MY_GRIDSQUARE.substring(0, 4) : "";
  return { report, reportNoStateNoCnty, callsignFile, gridFile };
}

// One queued QSO sent the way it would have gone when it was logged (N1MM and Log4OM, then the other logging programs and the online
// logbooks: adif.js); not into GridTracker's own log or the backup log again, and no POTA spot
function qsoQueueSendOne(text)
{
  const record = parseADIFRecord(text);
  if (!("CALL" in record)) return;
  const parts = qsoReportParts(record);
  qsoToUdpLoggers(parts.report);
  qsoToLoggersAndServices(record, parts.report, parts.reportNoStateNoCnty, parts.callsignFile, parts.gridFile);
}

// Send All: each queued QSO in turn, the oldest first. Offline the online logbooks are sent nothing (adif.js), so it waits until
// GridTracker is online. A QSO that can't be handed on stops it there, it and those after it kept in the queue
function qsoQueueSendAll()
{
  const Q = GT.qsoQueue;
  if (Q.sending || Q.list.length == 0) return;
  if (GT.settings.map.offlineMode == true)
  {
    qsoQueueRender();
    return;
  }
  Q.sending = true;
  Q.sent = 0;
  qsoQueueRender();
  const step = () =>
  {
    if (Q.list.length == 0 || GT.settings.map.offlineMode == true)
    {
      qsoQueueSendDone(false);
      return;
    }
    try
    {
      qsoQueueSendOne(Q.list[0]);
    }
    catch (e)
    {
      console.error(e);
      qsoQueueSendDone(true);
      return;
    }
    Q.list.shift();
    Q.sent++;
    try
    {
      fs.writeFileSync(qsoQueuePath(QSO_QUEUE_SENT_FILE), String(Q.sent), { flush: true });
    }
    catch (e)
    {
      console.error(e);
    }
    qsoQueueRender();
    nodeTimers.setTimeout(step, QSO_QUEUE_STEP_MS);
  };
  step();
}

// Send All finished, or stopped (failed: a QSO couldn't be handed on): the queue file written without what was sent, and said so
function qsoQueueSendDone(failed)
{
  const Q = GT.qsoQueue;
  Q.sending = false;
  try
  {
    qsoQueueWrite();
  }
  catch (e)
  {
    console.error(e);
    addEvent("log", "<font style='color:var(--gt-error)'>" + htmlEntities(I18N("settings.logging.queue.event.error")) + "</font>");
  }
  if (Q.sent > 0) addEvent("log", "<font style='color:var(--gt-label)'>" + htmlEntities(I18N("settings.logging.queue.event.sent").replace("{count}", Q.sent)) + "</font>");
  if (failed) addEvent("log", "<font style='color:var(--gt-error)'>" + htmlEntities(I18N("settings.logging.queue.event.failed").replace("{count}", Q.list.length)) + "</font>");
  qsoQueueRender();
}

// Export ADIF: the queue saved to a file the user picks (it stays queued)
function qsoQueueExport()
{
  if (qsoQueueCount() == 0) return;
  const now = new Date();
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, "") + "_" + now.toISOString().slice(11, 16).replace(":", "");
  const result = electron.ipcRenderer.sendSync("saveTextFile", {
    title: I18N("settings.logging.queue.export.label"),
    defaultPath: "GridTracker2_queued_" + stamp + ".adif",
    content: backupAdifHeader + GT.qsoQueue.list.join("\r\n") + "\r\n",
    filters: [{ name: "ADIF", extensions: ["adif", "adi"] }, { name: "All Files", extensions: ["*"] }]
  });
  if (result && result.error) addEvent("log", "<font style='color:var(--gt-error)'>" + htmlEntities(I18N("settings.logging.queue.event.error")) + "</font>");
}

// Its box ticked or not
function qsoQueueEnableChanged(what)
{
  GT.settings.adifLog.queueQsos = what.checked == true;
  qsoQueueRender();
  qsoQueueAutoCheck();
}

// Send All After: its box ticked or not, or its count typed (kept in range, written back as kept)
function qsoQueueAutoChanged()
{
  GT.settings.adifLog.queueAutoSend = qsoQueueAutoCheckBox.checked == true;
  const n = parseInt(qsoQueueAutoValue.value);
  GT.settings.adifLog.queueSendAfter = Number.isFinite(n) ? Math.max(QSO_QUEUE_AFTER_MIN, Math.min(QSO_QUEUE_AFTER_MAX, n)) : qsoQueueSendAfter();
  qsoQueueRender();
  qsoQueueAutoCheck();
}

// Settings -> Logging, Send Later: the box as set; Queued QSOs (n), its buttons and Send All After while the queue is on or has QSOs
// in it. Send All greyed out offline (its tooltip says why) and while it runs; Export ADIF with nothing queued
function qsoQueueRender()
{
  if (typeof qsoQueueCheckBox == "undefined") return;
  const Q = GT.qsoQueue;
  qsoQueueCheckBox.checked = qsoQueueOn();
  const count = Q.list.length;
  qsoQueueTr.style.display = qsoQueueOn() || count > 0 ? "" : "none";
  qsoQueueAutoTr.style.display = qsoQueueOn() ? "" : "none";
  qsoQueueAutoCheckBox.checked = GT.settings.adifLog.queueAutoSend === true;
  if (document.activeElement !== qsoQueueAutoValue) qsoQueueAutoValue.value = qsoQueueSendAfter();
  qsoQueueCountText.textContent = I18N("settings.logging.queue.count").replace("{count}", count);
  const offline = GT.settings.map.offlineMode == true;
  const sendOff = offline || Q.sending || count == 0;
  qsoQueueSendButton.classList.toggle("qsoQueueOff", sendOff);
  qsoQueueSendButton.title = I18N(offline ? "settings.logging.queue.send.offline" : "settings.logging.queue.send.hover");
  qsoQueueExportButton.classList.toggle("qsoQueueOff", count == 0);
}
