// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The NAVTEX plugin (plugin.json beside this file): maritime safety broadcasts in SITOR B, decoded by navtexWorker.js from the input's
// own samples (the worklet's raw stream). Each station heard is one of the decoder's signals (host.channels: its mark on the waterfall,
// pinned by a click on it). Each ZCZC ... NNNN message a block in navtexList, the newest on top, its header the station (B1), subject
// (B2) and number (B3B4), when and where it was heard and how cleanly (its error symbols' share: under 4% is received satisfactorily, as
// the IMO's NAVTEX Manual has it), then its text as sent. A station repeats a message in its slots for days: one received cleanly
// already is only marked heard again (as NAVTEX receivers do), but number 00 is always shown (ITU-R M.540). A station mid-message shows
// in a Receiving block on top. Right-click: copy, save, delete. Settings' Save Messages saves each complete message as a text file
// (navtexSave) in NAVTEX Messages, beside GridTracker's own folders

// Messages kept in the list
const NAVTEX_KEEP = 200;
// A message is received satisfactorily under this share of error symbols
const NAVTEX_GOOD = 0.04;
// The Receiving block shows this much of a station's newest text (characters)
const NAVTEX_LIVE_CHARS = 400;
// Its baud, shown for its signals
const NAVTEX_BAUD_SHOWN = 100;

const NAVTEX = {
  host: null,     // the decoder's host (mmdPluginHost.js), from init
  worker: null,   // navtexWorker.js, made as audio first comes
  rate: 0,        // the rate it was set up for
  config: "",     // what it was last told (Min Freq and Max Freq)
  messages: [],   // the newest first: { key, station, subject, number, text, complete, errors, chars, at, dial, hz, heard, lastAt, saved }
  listKey: null   // what the list was last drawn from
};

function mmdNavtexMode()
{
  return NAVTEX.host != null && NAVTEX.host.mode() == "navtex";
}

// ---- The worker: set up for the input's rate, told the audio decoded (Min Freq and Max Freq) whenever it changes

function mmdNavtexWorker(rate)
{
  const H = NAVTEX.host;
  if (!NAVTEX.worker)
  {
    NAVTEX.worker = new Worker(H.workerUrl("navtexWorker.js"));
    NAVTEX.worker.onmessage = (event) => H.guard(() => mmdNavtexFromWorker(event.data));
  }
  if (NAVTEX.rate != rate)
  {
    NAVTEX.rate = rate;
    NAVTEX.config = "";
    NAVTEX.worker.postMessage({ type: "init", rate });
  }
  const range = H.range();
  const message = { type: "config", minHz: range.minHz, maxHz: range.maxHz };
  const config = JSON.stringify(message);
  if (NAVTEX.config != config)
  {
    NAVTEX.config = config;
    NAVTEX.worker.postMessage(message);
  }
  return NAVTEX.worker;
}

// A tenth of a second of the input's samples from the worklet
function mmdNavtexAudio(data)
{
  mmdNavtexWorker(data.rate).postMessage({ type: "audio", samples: data.samples }, [data.samples.buffer]);
}

// Listening starts again (the mode chosen, a retune, Clear): every station let go
function mmdNavtexReset()
{
  if (NAVTEX.worker) NAVTEX.worker.postMessage({ type: "reset" });
}

function mmdNavtexFromWorker(m)
{
  if (!mmdNavtexMode()) return;
  const H = NAVTEX.host;
  // The stations heard: the decoder's signals (a message open, its ZCZC read and its NNNN not yet, kept while the lock drops a moment)
  if (m.type == "channels") H.channels(m.list, NAVTEX_BAUD_SHOWN);
  else if (m.type == "text") H.signalText(m.id, m.text);
  // A whole message (ZCZC ... NNNN) to the list; the station's running text starts afresh for the next
  else if (m.type == "message")
  {
    const signal = H.signal(m.id);
    mmdNavtexMessage(m, signal ? signal.freq : null);
    H.signalTextClear(m.id);
  }
}

// ---- The messages

// A message's share of error symbols (1 with no characters)
function mmdNavtexRate(m)
{
  return m.chars > 0 ? m.errors / m.chars : 1;
}

// A message from the worker (hz: its station's audio frequency)
function mmdNavtexMessage(m, hz)
{
  if (!String(m.text || "").trim()) return;
  const now = Date.now();
  const key = m.station + m.subject + m.number;
  const message = { key, station: m.station, subject: m.subject, number: m.number, text: String(m.text), complete: !!m.complete, errors: m.errors, chars: m.chars, at: now, dial: NAVTEX.host.dialHz(), hz, heard: 1, lastAt: now, saved: null };
  // A repeat (not 00): the one kept already is marked heard again, or (this one cleaner) takes its place
  const was = m.number != "00" && !/_/.test(key) ? NAVTEX.messages.find((x) => x.key == key) : null;
  if (was)
  {
    was.heard++;
    was.lastAt = now;
    const better = (message.complete && !was.complete) || (message.complete == was.complete && mmdNavtexRate(message) < mmdNavtexRate(was));
    if (better) Object.assign(was, { text: message.text, complete: message.complete, errors: message.errors, chars: message.chars, dial: message.dial, hz: message.hz });
    if (better) mmdNavtexAutoSave(was);
  }
  else
  {
    NAVTEX.messages.unshift(message);
    if (NAVTEX.messages.length > NAVTEX_KEEP) NAVTEX.messages.length = NAVTEX_KEEP;
    mmdNavtexAutoSave(message);
  }
  mmdNavtexRender();
}

// Saved as it comes (Settings' Save Messages), complete ones only, not a test signal's; a cleaner copy saved over it
function mmdNavtexAutoSave(message)
{
  if (NAVTEX.host.get("navtexSave") !== true || !message.complete || NAVTEX.host.testHeard(message.at, Date.now())) return;
  mmdNavtexSave(message, message.saved || null);
}

// Clear: every message forgotten (files saved stay)
function mmdNavtexClear()
{
  NAVTEX.messages = [];
  NAVTEX.listKey = null;
  if (mmdNavtexMode()) mmdNavtexRender();
}

// The subject's name (B2), as the IMO's NAVTEX Manual names them
function mmdNavtexSubject(subject)
{
  const key = "cwViewer.navtex.subject." + subject;
  const name = NAVTEX.host.t(key);
  return name && name != key ? name : subject;
}

// The list: a Receiving block for each station mid-message (locked, or its message still open while the lock drops for a moment), then
// the messages; drawn again only when something in it changed
function mmdNavtexRender()
{
  if (!mmdNavtexMode()) return;
  const H = NAVTEX.host;
  const live = H.signals().filter((s) => (s.alive || s.receiving) && s.text.trim());
  const blocks = [];
  for (const s of live)
  {
    const air = H.airHz(s.freq);
    const head = "<span class='navtexLive'>" + H.escape(H.t("cwViewer.navtex.receiving")) + "</span> " + (air == null ? Math.round(s.freq) + " Hz" : H.freqText(air)) + (s.snrSeen === true && s.snr > -30 ? " · " + Math.round(s.snr) + " dB" : "");
    blocks.push("<div class='navtexBlock navtexBlockLive'><div class='navtexHead'>" + head + "</div><pre class='navtexText'>" + H.escape(s.text.slice(-NAVTEX_LIVE_CHARS)) + "</pre></div>");
  }
  for (const m of NAVTEX.messages)
  {
    const rate = mmdNavtexRate(m);
    const rateClass = !m.complete ? "navtexBad" : rate < NAVTEX_GOOD ? "navtexGood" : "navtexFair";
    const where = m.dial ? H.freqText(m.dial) : Math.round(m.hz || 0) + " Hz";
    const parts = [
      "<span class='navtexId'>" + H.escape(m.station + m.subject + m.number) + "</span>",
      "<span class='navtexSubject'>" + H.escape(mmdNavtexSubject(m.subject)) + "</span>",
      new Date(m.at).toISOString().slice(11, 16) + " UTC",
      where,
      "<span class='" + rateClass + "'>" + H.escape(m.complete ? H.t("cwViewer.navtex.errors").replace("{percent}", (rate * 100).toFixed(1)) : H.t("cwViewer.navtex.incomplete")) + "</span>"
    ];
    if (m.heard > 1) parts.push(H.escape(H.t("cwViewer.navtex.heard").replace("{count}", m.heard)));
    if (m.saved) parts.push(H.escape(H.t("cwViewer.sstv.saved")));
    blocks.push("<div class='navtexBlock' data-key='" + H.escape(m.key + "|" + m.at) + "'><div class='navtexHead'>" + parts.join(" · ") + "</div><pre class='navtexText'>" + H.escape(m.text) + "</pre></div>");
  }
  const html = blocks.join("");
  if (html != NAVTEX.listKey)
  {
    NAVTEX.listKey = html;
    navtexRows.innerHTML = html;
  }
  navtexEmpty.style.display = blocks.length ? "none" : "";
}

// The message a block in the list shows
function mmdNavtexAt(target)
{
  const block = target.closest(".navtexBlock[data-key]");
  if (!block) return null;
  return NAVTEX.messages.find((m) => m.key + "|" + m.at == block.dataset.key) || null;
}

// The right-click on a message: Copy To Clipboard, Save Message..., Delete
function mmdNavtexMenu(event)
{
  const message = mmdNavtexAt(event.target);
  if (!message) return;
  event.preventDefault();
  const H = NAVTEX.host;
  const remote = window.require("@electron/remote");
  const menu = remote.Menu.buildFromTemplate([
    { label: H.t("cwViewer.picture.copy.label"), click: () => window.require("electron").clipboard.writeText(mmdNavtexFile(message)) },
    { label: H.t("cwViewer.navtex.save.label"), click: () => mmdNavtexSaveAs(message) },
    { type: "separator" },
    { label: H.t("cwViewer.picture.delete.label"), click: () => mmdNavtexDelete(message) }
  ]);
  menu.popup({ window: remote.getCurrentWindow() });
}

function mmdNavtexDelete(message)
{
  NAVTEX.messages = NAVTEX.messages.filter((m) => m != message);
  mmdNavtexRender();
}

// Its file name: the UTC time, the station, subject and number (20261101-054012Z_WA42.txt)
function mmdNavtexFileName(message)
{
  const t = new Date(message.at).toISOString();
  return t.slice(0, 10).replace(/-/g, "") + "-" + t.slice(11, 19).replace(/:/g, "") + "Z_" + (message.station + message.subject + message.number).replace(/[^\w]/g, "_") + ".txt";
}

// What is saved or copied: a header (the subject, when, where, how cleanly), then the message as sent, ZCZC to NNNN
function mmdNavtexFile(message)
{
  const H = NAVTEX.host;
  const lines = [
    "NAVTEX " + message.station + message.subject + message.number + "  " + mmdNavtexSubject(message.subject),
    new Date(message.at).toISOString().slice(0, 16).replace("T", " ") + " UTC" + (message.dial ? "  " + H.freqText(message.dial) : ""),
    message.complete ? H.t("cwViewer.navtex.errors").replace("{percent}", (mmdNavtexRate(message) * 100).toFixed(1)) : H.t("cwViewer.navtex.incomplete"),
    "",
    "ZCZC " + message.station + message.subject + message.number,
    message.text.replace(/\r?\n/g, "\r\n"),
    message.complete ? "NNNN" : ""
  ];
  return lines.join("\r\n").replace(/\s+$/, "") + "\r\n";
}

function mmdNavtexSaveAs(message)
{
  const remote = window.require("@electron/remote");
  const file = remote.dialog.showSaveDialogSync(remote.getCurrentWindow(), {
    defaultPath: path.join(NAVTEX.host.folder("NAVTEX Messages"), mmdNavtexFileName(message)),
    filters: [{ name: "Text", extensions: ["txt"] }]
  });
  if (file) mmdNavtexSave(message, file);
}

// Saved as text: to file, or (null) into NAVTEX Messages (beside GridTracker's own folders, as SSTV Pictures)
function mmdNavtexSave(message, file)
{
  try
  {
    if (!file) file = path.join(NAVTEX.host.folder("NAVTEX Messages"), mmdNavtexFileName(message));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, mmdNavtexFile(message));
    message.saved = file;
  }
  catch (e)
  {
    NAVTEX.host.status(NAVTEX.host.t("cwViewer.sstv.saveFailed") + " " + e.message, true);
  }
  mmdNavtexRender();
}

// ---- Its box on Settings, Decoders: Set Frequency (the decoder's own, as every mode's), Set Mode, Save Messages

function mmdNavtexSettings()
{
  const H = NAVTEX.host;
  navtexSetModeValue.checked = H.get("navtexSetMode") === true;
  navtexSaveValue.checked = H.get("navtexSave") === true;
}

function mmdNavtexSetSave()
{
  NAVTEX.host.set("navtexSave", navtexSaveValue.checked);
  mmdNavtexSettings();
}

mmdRegisterMode({
  id: "navtex",
  name: "NAVTEX",
  modes: ["navtex"],
  input: "raw",
  // (its stations are the decoder's signals: the waterfall's guard lines, a click pins the one there)
  signals: true,
  init: (host) =>
  {
    NAVTEX.host = host;
    navtexRows.addEventListener("contextmenu", mmdNavtexMenu);
  },
  audio: (data) => mmdNavtexAudio(data),
  tune: (hz) => NAVTEX.host.focusNear(hz),
  shown: (on) =>
  {
    navtexList.style.display = on ? "" : "none";
    if (!on) return;
    NAVTEX.listKey = null;
    mmdNavtexRender();
  },
  entered: () => mmdNavtexReset(),
  // (its Receiving blocks as their text comes)
  tick: () => mmdNavtexRender(),
  clear: () =>
  {
    mmdNavtexReset();
    mmdNavtexClear();
  },
  retune: () =>
  {
    if (mmdNavtexMode()) mmdNavtexReset();
  },
  settingsRender: () => mmdNavtexSettings()
});
