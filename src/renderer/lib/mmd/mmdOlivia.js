// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Multi-Mode Decoder's Olivia mode (the Mode menu): one Olivia or Contestia signal, its submode (tones / bandwidth) picked in the menu
// on the second line, its centre set by a click on the waterfall or by an RSID heard for it (the RSID's mode and frequency). The input's
// own samples (the worklet's raw stream) go to oliviaWorker.js, which finds the signal near that centre and decodes it. Here it is a
// signal of CW's list (DEC.signals: its line, hovered and pinned as CW's), its text added as it comes; the WPM column its baud. The
// waterfall shows where it is looked for: dashed lines at the edges of its band (mmdOliviaDraw)

// Its signal's id, apart from CW's (the worklet's, small numbers) and PSK31's and RTTY's (KEY_ID_BASE and up)
const OLIVIA_ID = 300000;
// The submodes in the menu: [mode, tones, bandwidth (Hz)]
const OLIVIA_SUBMODES = [
  ["olivia", 4, 250], ["olivia", 8, 250], ["olivia", 8, 500], ["olivia", 16, 500], ["olivia", 16, 1000], ["olivia", 32, 1000],
  ["contestia", 4, 250], ["contestia", 8, 250], ["contestia", 8, 500], ["contestia", 16, 500], ["contestia", 16, 1000], ["contestia", 32, 1000]
];
const OLIVIA_NAMES = { olivia: "Olivia", contestia: "Contestia" };
// The highest audio frequency oliviaWorker.js keeps (its own OLIVIA_TOP_HZ): the same number
const OLIVIA_TOP_HZ = 4200;
// While the signal decoded has printed text within this many of its blocks, an RSID heard doesn't move the decoder
const OLIVIA_BUSY_BLOCKS = 2.5;

const OLIVIA = {
  worker: null,
  rate: 0,      // the sample rate the worker was set up for
  config: ""    // the submode and centre it was last told
};

function mmdOliviaMode(mode = DEC.mode)
{
  return mode == "olivia";
}

// The submode picked (MMD.oliviaSubmode, its index in OLIVIA_SUBMODES' order as "olivia 8/500"): { mode, tones, bandwidth }
function mmdOliviaSub()
{
  const key = String(GT.settings.MMD.oliviaSubmode || "olivia 8/500");
  const found = OLIVIA_SUBMODES.find(([mode, tones, bandwidth]) => mode + " " + tones + "/" + bandwidth == key) || OLIVIA_SUBMODES[2];
  return { mode: found[0], tones: found[1], bandwidth: found[2] };
}

// Where it is looked for (audio Hz, MMD.oliviaCenter): kept inside the audio decoded, and below what oliviaWorker.js keeps of it (its
// OLIVIA_TOP_HZ, less the band and the search above the centre: a wide Bandwidth shows more than it can decode)
function mmdOliviaCenter()
{
  const center = Number(GT.settings.MMD.oliviaCenter) || 1500;
  const sub = mmdOliviaSub();
  const half = sub.bandwidth / 2;
  const top = Math.min(mmdMaxHz() - half, OLIVIA_TOP_HZ - 0.75 * sub.bandwidth - sub.bandwidth / sub.tones / 2);
  return Math.round(Math.max(mmdMinHz() + half, Math.min(top, center)));
}

// The submode menu on the second line: filled once, its value the one picked
function mmdOliviaMenu()
{
  if (!cwOliviaSub.options.length)
  {
    for (const [mode, tones, bandwidth] of OLIVIA_SUBMODES) cwOliviaSub.appendChild(new Option(OLIVIA_NAMES[mode] + " " + tones + "/" + bandwidth, mode + " " + tones + "/" + bandwidth));
  }
  const sub = mmdOliviaSub();
  cwOliviaSub.value = sub.mode + " " + sub.tones + "/" + sub.bandwidth;
}

// A submode picked in the menu: decoded from here on
function mmdOliviaPicked()
{
  GT.settings.MMD.oliviaSubmode = cwOliviaSub.value;
  mmdOliviaRestart();
}

// oliviaWorker.js, set up for the input's rate, told the submode and the centre whenever they change
function mmdOliviaLoad(rate)
{
  if (!OLIVIA.worker)
  {
    OLIVIA.worker = new Worker("lib/mmd/oliviaWorker.js");
    OLIVIA.worker.onmessage = (event) => mmdOliviaMessage(event.data);
  }
  if (OLIVIA.rate != rate)
  {
    OLIVIA.rate = rate;
    OLIVIA.config = "";
    OLIVIA.worker.postMessage({ type: "init", rate });
  }
  const sub = mmdOliviaSub();
  const center = mmdOliviaCenter();
  const config = sub.mode + "|" + sub.tones + "|" + sub.bandwidth + "|" + center;
  if (OLIVIA.config != config)
  {
    OLIVIA.config = config;
    OLIVIA.worker.postMessage({ type: "config", mode: sub.mode, tones: sub.tones, bandwidth: sub.bandwidth, center: center });
  }
  return OLIVIA.worker;
}

// A tenth of a second of the input's samples from the worklet
function mmdOliviaAudio(data)
{
  mmdOliviaLoad(data.rate).postMessage({ type: "audio", samples: data.samples }, [data.samples.buffer]);
}

// Listening starts again (the mode chosen, a retune, Clear): what was half heard let go
function mmdOliviaReset()
{
  if (OLIVIA.worker) OLIVIA.worker.postMessage({ type: "reset" });
}

// Another submode or centre: told at once (the next audio would too), and its marks drawn there
function mmdOliviaRestart()
{
  if (OLIVIA.worker && OLIVIA.rate) mmdOliviaLoad(OLIVIA.rate);
  const signal = DEC.signals[OLIVIA_ID];
  if (signal) signal.freq = mmdOliviaCenter();
  DEC.dirty = true;
  mmdOverlay();
}

// A click on the waterfall (Olivia mode): the centre looked for there
function mmdOliviaTune(hz)
{
  if (hz == null) return;
  GT.settings.MMD.oliviaCenter = Math.round(hz);
  mmdOliviaRestart();
}

// An RSID heard (mmdRsid.js): one of the submodes here (its name as rsidWorker.js gives it, "Olivia 8/500"), in Olivia mode, sets the
// submode and the centre (its frequency is the mode's centre), unless the signal being decoded is still printing (text within
// OLIVIA_BUSY_BLOCKS of its blocks, and a second: a station's RSID elsewhere doesn't take it off the one listened to; its label is still
// drawn). True when it did
function mmdOliviaRsid(name, freq)
{
  if (!mmdOliviaMode()) return false;
  const signal = DEC.signals[OLIVIA_ID];
  const sub = mmdOliviaSub();
  // A block: 64 symbols (Contestia 32), each tones / bandwidth seconds
  const blockMs = ((sub.mode == "contestia" ? 32 : 64) * sub.tones * 1000) / sub.bandwidth;
  if (signal && signal.text && Date.now() - signal.last < 1000 + OLIVIA_BUSY_BLOCKS * blockMs) return false;
  const m = /^(Olivia|Contestia) (\d+)\/(\d+)$/.exec(String(name));
  if (!m) return false;
  const key = m[1].toLowerCase() + " " + m[2] + "/" + m[3];
  if (!OLIVIA_SUBMODES.some(([mode, tones, bandwidth]) => mode + " " + tones + "/" + bandwidth == key)) return false;
  GT.settings.MMD.oliviaSubmode = key;
  GT.settings.MMD.oliviaCenter = Math.round(freq);
  mmdOliviaMenu();
  mmdOliviaRestart();
  return true;
}

function mmdOliviaMessage(m)
{
  if (!mmdOliviaMode()) return;
  const signal = mmdSignal(OLIVIA_ID);
  const sub = mmdOliviaSub();
  signal.wpm = Math.round((sub.bandwidth / sub.tones) * 10) / 10;
  if (m.type == "lock")
  {
    signal.freq = m.center;
    signal.air = window.opener.mmDecoderAirHz(m.center);
    signal.snr = m.snr;
    signal.alive = true;
    DEC.dirty = true;
  }
  else if (m.type == "text")
  {
    if (!signal.freq)
    {
      signal.freq = mmdOliviaCenter();
      signal.air = window.opener.mmDecoderAirHz(signal.freq);
    }
    // Lines run on: a new line as a space, one space between words
    let text = signal.text + String(m.text).replace(/[\r\n]+/g, " ");
    text = text.replace(/ {2,}/g, " ");
    mmdText(signal, text);
    signal.last = Date.now();
    signal.alive = true;
    if (/(^| )CQ $/.test(signal.text)) signal.cqAt = signal.last;
    DEC.dirty = true;
  }
}

// Olivia mode: dashed lines at the edges of the band looked in (the centre, half the bandwidth either side), the submode in a box at the
// bottom between them
function mmdOliviaDraw(ctx, x, ratio, w, h)
{
  if (!mmdOliviaMode()) return;
  const sub = mmdOliviaSub();
  const center = mmdOliviaCenter();
  const a = x(center - sub.bandwidth / 2), b = x(center + sub.bandwidth / 2);
  const left = Math.min(a, b), right = Math.max(a, b);
  const rgb = "255, 200, 80";
  ctx.strokeStyle = "rgba(" + rgb + ", 0.8)";
  ctx.lineWidth = Math.max(1, Math.round(ratio));
  ctx.setLineDash([4 * ratio, 4 * ratio]);
  ctx.beginPath();
  ctx.moveTo(Math.round(left) + 0.5, 0);
  ctx.lineTo(Math.round(left) + 0.5, h);
  ctx.moveTo(Math.round(right) + 0.5, 0);
  ctx.lineTo(Math.round(right) + 0.5, h);
  ctx.stroke();
  ctx.setLineDash([]);
  mmdOverlayLabel(ctx, OLIVIA_NAMES[sub.mode] + " " + sub.tones + "/" + sub.bandwidth, (left + right) / 2, h - 19 * ratio, "center", 11, ratio, w, "rgb(" + rgb + ")");
}
