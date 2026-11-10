// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// NAVTEX mode's messages (navtexWorker.js through mmdKey.js): each ZCZC ... NNNN message a block in navtexList, the newest on top, its
// header the station (B1), subject (B2) and number (B3B4), when and where it was heard and how cleanly (its error symbols' share: under
// 4% is received satisfactorily, as the IMO's NAVTEX Manual has it), then its text as sent. A station repeats a message in its slots
// for days: one received cleanly already is only marked heard again (as NAVTEX receivers do), but number 00 is always shown (ITU-R
// M.540). A station mid-message shows in a Receiving block on top. Right-click: copy, save, delete. Settings' Save Messages saves each
// complete message as a text file (navtexSave) in NAVTEX Messages, beside GridTracker's own folders

// Messages kept in the list
const NAVTEX_KEEP = 200;
// A message is received satisfactorily under this share of error symbols
const NAVTEX_GOOD = 0.04;
// The Receiving block shows this much of a station's newest text (characters)
const NAVTEX_LIVE_CHARS = 400;

const NAVTEX = {
  messages: [],  // the newest first: { key, station, subject, number, text, complete, errors, chars, at, dial, hz, heard, lastAt, saved }
  listKey: null  // what the list was last drawn from
};

function mmdNavtexMode(mode = DEC.mode)
{
  return mode == "navtex";
}

// A message's share of error symbols (1 with no characters)
function mmdNavtexRate(m)
{
  return m.chars > 0 ? m.errors / m.chars : 1;
}

// A message from the worker (hz: its channel's audio frequency)
function mmdNavtexMessage(m, hz)
{
  if (!String(m.text || "").trim()) return;
  const now = Date.now();
  const key = m.station + m.subject + m.number;
  const message = { key, station: m.station, subject: m.subject, number: m.number, text: String(m.text), complete: !!m.complete, errors: m.errors, chars: m.chars, at: now, dial: mmdDial(), hz, heard: 1, lastAt: now, saved: null };
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

// Saved as it comes (Settings' Save Messages), complete ones only, not a test signal's (mmdTest.js); a cleaner copy saved over it
function mmdNavtexAutoSave(message)
{
  if (GT.settings.MMD.navtexSave !== true || !message.complete || mmdTestHeard(message.at, Date.now())) return;
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
  const name = I18N(key);
  return name && name != key ? name : subject;
}

// The list: a Receiving block for each station mid-message (locked, or its message still open while the lock drops for a moment), then
// the messages; drawn again only when something in it changed
function mmdNavtexRender()
{
  if (!mmdNavtexMode()) return;
  const opener = window.opener;
  const live = Object.values(DEC.signals).filter((s) => s.id >= KEY_ID_BASE && (s.alive || s.receiving) && s.text.trim());
  const blocks = [];
  for (const s of live)
  {
    const air = opener.mmDecoderAirHz(s.freq);
    const head = "<span class='navtexLive'>" + mmdEscape(I18N("cwViewer.navtex.receiving")) + "</span> " + (air == null ? Math.round(s.freq) + " Hz" : mmdFreq(air)) + (s.snrSeen === true && s.snr > -30 ? " · " + Math.round(s.snr) + " dB" : "");
    blocks.push("<div class='navtexBlock navtexBlockLive'><div class='navtexHead'>" + head + "</div><pre class='navtexText'>" + mmdEscape(s.text.slice(-NAVTEX_LIVE_CHARS)) + "</pre></div>");
  }
  for (const m of NAVTEX.messages)
  {
    const rate = mmdNavtexRate(m);
    const rateClass = !m.complete ? "navtexBad" : rate < NAVTEX_GOOD ? "navtexGood" : "navtexFair";
    const where = m.dial ? mmdFreq(m.dial) : Math.round(m.hz || 0) + " Hz";
    const parts = [
      "<span class='navtexId'>" + mmdEscape(m.station + m.subject + m.number) + "</span>",
      "<span class='navtexSubject'>" + mmdEscape(mmdNavtexSubject(m.subject)) + "</span>",
      new Date(m.at).toISOString().slice(11, 16) + " UTC",
      where,
      "<span class='" + rateClass + "'>" + mmdEscape(m.complete ? I18N("cwViewer.navtex.errors").replace("{percent}", (rate * 100).toFixed(1)) : I18N("cwViewer.navtex.incomplete")) + "</span>"
    ];
    if (m.heard > 1) parts.push(mmdEscape(I18N("cwViewer.navtex.heard").replace("{count}", m.heard)));
    if (m.saved) parts.push(mmdEscape(I18N("cwViewer.sstv.saved")));
    blocks.push("<div class='navtexBlock' data-key='" + mmdEscape(m.key + "|" + m.at) + "'><div class='navtexHead'>" + parts.join(" · ") + "</div><pre class='navtexText'>" + mmdEscape(m.text) + "</pre></div>");
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
  const remote = window.require("@electron/remote");
  const menu = remote.Menu.buildFromTemplate([
    { label: I18N("cwViewer.picture.copy.label"), click: () => window.require("electron").clipboard.writeText(mmdNavtexFile(message)) },
    { label: I18N("cwViewer.navtex.save.label"), click: () => mmdNavtexSaveAs(message) },
    { type: "separator" },
    { label: I18N("cwViewer.picture.delete.label"), click: () => mmdNavtexDelete(message) }
  ]);
  menu.popup({ window: remote.getCurrentWindow() });
}

function mmdNavtexDelete(message)
{
  NAVTEX.messages = NAVTEX.messages.filter((m) => m != message);
  mmdNavtexRender();
}

// The folder complete messages are saved in: NAVTEX Messages beside GridTracker's own folders (as SSTV Pictures)
function mmdNavtexFolder()
{
  return path.join(path.dirname(GT.appData), "NAVTEX Messages");
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
  const lines = [
    "NAVTEX " + message.station + message.subject + message.number + "  " + mmdNavtexSubject(message.subject),
    new Date(message.at).toISOString().slice(0, 16).replace("T", " ") + " UTC" + (message.dial ? "  " + mmdFreq(message.dial) : ""),
    message.complete ? I18N("cwViewer.navtex.errors").replace("{percent}", (mmdNavtexRate(message) * 100).toFixed(1)) : I18N("cwViewer.navtex.incomplete"),
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
    defaultPath: path.join(mmdNavtexFolder(), mmdNavtexFileName(message)),
    filters: [{ name: "Text", extensions: ["txt"] }]
  });
  if (file) mmdNavtexSave(message, file);
}

// Saved as text: to file, or (null) into NAVTEX Messages
function mmdNavtexSave(message, file)
{
  try
  {
    if (!file) file = path.join(mmdNavtexFolder(), mmdNavtexFileName(message));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, mmdNavtexFile(message));
    message.saved = file;
  }
  catch (e)
  {
    mmdStatus(I18N("cwViewer.sstv.saveFailed") + " " + e.message, true);
  }
  mmdNavtexRender();
}

function mmdNavtexInit()
{
  navtexRows.addEventListener("contextmenu", mmdNavtexMenu);
}
