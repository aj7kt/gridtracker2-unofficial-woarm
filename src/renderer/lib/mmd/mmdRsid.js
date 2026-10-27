// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Multi-Mode Decoder's RSID (Settings, Decoders): in every mode, the input's own samples (the worklet's raw stream) go to
// rsidWorker.js too, which finds the RSIDs senders put before a transmission to say its mode. Each found is drawn on the waterfall
// where it was heard: a box round its tones, the mode's name over it (mmdOverlay), moved down with the rows as the band changes are

// An RSID's length on the air (15 tones of 1024 samples at 11025 Hz, ms), and its tones' span (16 tones 11025 / 1024 Hz apart; Hz below
// and above the mode's own frequency, its tone 7)
const RSID_MS = (15 * 1024 * 1000) / 11025;
const RSID_BELOW_HZ = (7 * 11025) / 1024;
const RSID_ABOVE_HZ = (8 * 11025) / 1024;
// EOT: the end of a transmission, not a mode
const RSID_EOT = 263;
// The input's audio kept, so a click on an RSID can decode its transmission from the start (ms); and how far before the RSID was found
// that starts (its last tones: the mode starts a moment after them)
const RSID_KEEP_MS = 30000;
const RSID_BACK_MS = 1000;

const RSID = {
  worker: null,
  rate: 0,      // the sample rate the worker was set up for
  config: ""    // the audio range it was last told
};

// RSID on (Settings, Decoders), on unless turned off
function mmdRsidOn()
{
  return GT.settings.MMD.rsid !== false;
}

function mmdRsidLoad(rate)
{
  if (!RSID.worker)
  {
    RSID.worker = new Worker("lib/mmd/rsidWorker.js");
    RSID.worker.onmessage = (event) => mmdRsidMessage(event.data);
  }
  if (RSID.rate != rate)
  {
    RSID.rate = rate;
    RSID.config = "";
    RSID.worker.postMessage({ type: "init", rate });
  }
  const config = mmdMinHz() + "|" + mmdMaxHz();
  if (RSID.config != config)
  {
    RSID.config = config;
    RSID.worker.postMessage({ type: "config", minHz: mmdMinHz(), maxHz: mmdMaxHz() });
  }
  return RSID.worker;
}

// A tenth of a second of the input's samples (a copy: the mode's own worker is handed the samples themselves); kept a while too, so a
// click on an RSID can decode its transmission from its start (mmdRsidPick)
function mmdRsidAudio(data)
{
  if (!mmdRsidOn() || data.seq != DEC.seq) return;
  const samples = data.samples.slice();
  mmdRsidLoad(data.rate).postMessage({ type: "audio", samples }, [samples.buffer]);
  const now = Date.now();
  const kept = RSID.kept || (RSID.kept = []);
  kept.push({ at: now, rate: data.rate, samples: data.samples.slice() });
  while (kept.length && now - kept[0].at > RSID_KEEP_MS) kept.shift();
}

// A retune or Clear: what was being heard is let go
function mmdRsidReset()
{
  if (RSID.worker) RSID.worker.postMessage({ type: "reset" });
  RSID.kept = [];
}

function mmdRsidMessage(m)
{
  if (m.type != "rsid" || m.code == RSID_EOT || !mmdRsidOn()) return;
  // In Olivia mode, an Olivia or Contestia RSID sets the submode and where its signal is looked for (mmdOlivia.js)
  mmdOliviaRsid(m.name, m.freq);
  // In PSK31 and RTTY mode, the finder leaves the place alone a moment, so the RSID's tones don't hide the signal after it (keyWorker.js)
  if (mmdKeyMode() && KEY.worker) KEY.worker.postMessage({ type: "rsid", freq: m.freq });
  // Its last tone is in the rows still queued for the waterfall, not on it yet: placed above the top by them
  const marks = DEC.rsidMarks || (DEC.rsidMarks = []);
  marks.push({ age: -(DEC.fallQueue || []).length, freq: m.freq, name: m.name, at: Date.now(), box: null });
  mmdOverlay();
}

// The Mode menu's mode for an RSID's mode name (one decoded here), else null
function mmdRsidModeOf(name)
{
  if (name == "BPSK31") return "psk31";
  if (name == "RTTY 45") return "rtty";
  if (name == "Packet 1200") return "packet";
  const m = /^(Olivia|Contestia) (\d+)\/(\d+)$/.exec(name);
  if (m && OLIVIA_SUBMODES.some(([mode, tones, bandwidth]) => mode == m[1].toLowerCase() && tones == m[2] && bandwidth == m[3])) return "olivia";
  return null;
}

// The RSID drawn where the waterfall was clicked (its box or its name over it; CSS pixels), else null
function mmdRsidAt(x, y)
{
  const ratio = window.devicePixelRatio || 1;
  for (const mark of DEC.rsidMarks || [])
  {
    const b = mark.box;
    if (b && x * ratio >= b.left && x * ratio <= b.right && y * ratio >= b.top && y * ratio <= b.bottom) return mark;
  }
  return null;
}

// An RSID clicked: the decoder switched to its mode (Olivia: its submode, where it is), nothing cleared, and its transmission decoded
// from where it started (the audio kept since just before the RSID ended), then on as it's heard. Already in that mode, PSK31, RTTY and
// Packet are decoding it already; Olivia goes to it. A mode not decoded here: nothing
function mmdRsidPick(mark)
{
  const mode = mmdRsidModeOf(mark.name);
  if (!mode) return;
  const olivia = mode == "olivia";
  if (olivia)
  {
    const m = /^(\w+) (\d+)\/(\d+)$/.exec(mark.name);
    GT.settings.MMD.oliviaSubmode = m[1].toLowerCase() + " " + m[2] + "/" + m[3];
    GT.settings.MMD.oliviaCenter = Math.round(mark.freq);
  }
  if (DEC.mode == mode && !olivia) return;
  // (Taken before the mode changes: a restart lets the audio kept go)
  const from = mark.at - RSID_BACK_MS;
  const chunks = (RSID.kept || []).filter((chunk) => chunk.at >= from);
  cwMode.value = mode;
  if (DEC.mode != mode) mmdModeSet(mode);
  else
  {
    mmdOliviaMenu();
    mmdOliviaRestart();
    mmdOliviaReset();
  }
  // PSK31 and RTTY: the RSID's own tones aren't taken for a signal (keyWorker.js)
  if (chunks.length && mmdKeyMode(mode)) mmdKeyLoad(chunks[0].rate).postMessage({ type: "rsid", freq: mark.freq });
  for (const chunk of chunks)
  {
    const data = { rate: chunk.rate, samples: chunk.samples.slice() };
    if (mode == "packet") mmdPacketAudio(data);
    else if (olivia) mmdOliviaAudio(data);
    else mmdKeyAudio(data);
  }
}

// The pointer over a clickable RSID: a hand
function mmdRsidHover(x, y)
{
  const mark = mmdRsidAt(x, y);
  cwOverlay.style.cursor = mark && mmdRsidModeOf(mark.name) ? "pointer" : "";
}

// Moved down with the rows drawn (drawn), let go once off the bottom
function mmdRsidRow(drawn)
{
  const marks = DEC.rsidMarks;
  if (!marks || !marks.length || !drawn) return;
  for (const mark of marks) mark.age += drawn;
  const rows = (1 + mmdRsidRows()) * 2;
  DEC.rsidMarks = marks.filter((mark) => mark.age < cwFall.height + rows);
  mmdOverlay();
}

// An RSID's length on the waterfall (rows): from its speed, else about one row heard per row (43 ms)
function mmdRsidRows()
{
  return RSID_MS * (DEC.fallRowsPerMs || 1 / 43);
}

// Each RSID heard: a dashed pink box round its tones from its first to its last, the mode's name in a box over its middle
function mmdRsidDraw(ctx, x, ratio, w, h)
{
  if (!DEC.rsidMarks || !DEC.rsidMarks.length) return;
  const rows = mmdRsidRows();
  const rgb = "255, 120, 220";
  for (const mark of DEC.rsidMarks)
  {
    const top = (mark.age + 1) * ratio;
    const bottom = (mark.age + 1 + rows) * ratio;
    if (bottom < 0 || top > h)
    {
      mark.box = null;
      continue;
    }
    const a = x(mark.freq - RSID_BELOW_HZ), b = x(mark.freq + RSID_ABOVE_HZ);
    const left = Math.min(a, b), right = Math.max(a, b);
    ctx.strokeStyle = "rgba(" + rgb + ", 0.9)";
    ctx.lineWidth = Math.max(1, Math.round(ratio));
    ctx.setLineDash([3 * ratio, 3 * ratio]);
    ctx.strokeRect(Math.round(left) + 0.5, Math.round(top) + 0.5, Math.max(1, Math.round(right - left)), Math.max(1, Math.round(bottom - top)));
    ctx.setLineDash([]);
    const text = I18N("cwViewer.rsid.label").replace("{mode}", mark.name);
    const labelY = Math.max(0, (top + bottom) / 2 - 9 * ratio);
    mmdOverlayLabel(ctx, text, (left + right) / 2, labelY, "center", 11, ratio, w, "rgb(" + rgb + ")");
    // Where a click picks it (mmdRsidAt): its box, and its name, which may be wider (canvas pixels)
    const half = Math.max((right - left) / 2, (ctx.measureText(text).width || 0) / 2 + 6 * ratio);
    const middle = (left + right) / 2;
    mark.box = { left: middle - half, right: middle + half, top: Math.min(top, labelY), bottom: Math.max(bottom, labelY + 18 * ratio) };
  }
}
