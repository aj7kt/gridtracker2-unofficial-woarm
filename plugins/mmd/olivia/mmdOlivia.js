// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Olivia plugin (plugin.json beside this file): one Olivia or Contestia signal, its submode (tones / bandwidth) picked in the menu
// in the row under the second line, its centre set by a click on the waterfall or by an RSID heard for it (the RSID's mode and
// frequency). The input's own samples (the worklet's raw stream, input "raw") go to oliviaWorker.js, which finds the signal near that
// centre and decodes it. Here it is a signal of CW's list (cwList: its line, hovered and pinned as CW's; host.channels, signalText), its
// text added as it comes; the WPM column its baud. The waterfall shows where it is looked for: dashed lines at the edges of its band
// (mmdOliviaDraw)

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
  host: null,   // the decoder's host (mmdPluginHost.js), from init
  worker: null,
  rate: 0,      // the sample rate the worker was set up for
  config: "",   // the submode and centre it was last told
  saved: null   // the submode and centre before a test signal played, put back after (testStart, testEnd)
};

// (a hook can come before init)
function mmdOliviaMode()
{
  return !!OLIVIA.host && OLIVIA.host.mode() == "olivia";
}

// The submode picked (MMD.oliviaSubmode, as "olivia 8/500"): { mode, tones, bandwidth }
function mmdOliviaSub()
{
  const key = String(OLIVIA.host.get("oliviaSubmode") || "olivia 8/500");
  const found = OLIVIA_SUBMODES.find(([mode, tones, bandwidth]) => mode + " " + tones + "/" + bandwidth == key) || OLIVIA_SUBMODES[2];
  return { mode: found[0], tones: found[1], bandwidth: found[2] };
}

function mmdOliviaSubKey(sub = mmdOliviaSub())
{
  return sub.mode + " " + sub.tones + "/" + sub.bandwidth;
}

// Where it is looked for (audio Hz, MMD.oliviaCenter): kept inside the audio decoded, and below what oliviaWorker.js keeps of it (its
// OLIVIA_TOP_HZ, less the band and the search above the centre: a wide Bandwidth shows more than it can decode)
function mmdOliviaCenter()
{
  const H = OLIVIA.host;
  const center = Number(H.get("oliviaCenter")) || 1500;
  const sub = mmdOliviaSub();
  const half = sub.bandwidth / 2;
  const range = H.range();
  const top = Math.min(range.maxHz - half, OLIVIA_TOP_HZ - 0.75 * sub.bandwidth - sub.bandwidth / sub.tones / 2);
  return Math.round(Math.max(range.minHz + half, Math.min(top, center)));
}

// The submode menu: filled once, its value the one picked
function mmdOliviaMenu()
{
  if (!cwOliviaSub.options.length)
  {
    for (const [mode, tones, bandwidth] of OLIVIA_SUBMODES) cwOliviaSub.appendChild(new Option(OLIVIA_NAMES[mode] + " " + tones + "/" + bandwidth, mode + " " + tones + "/" + bandwidth));
  }
  cwOliviaSub.value = mmdOliviaSubKey();
}

// A submode picked in the menu: decoded from here on
function mmdOliviaPicked()
{
  OLIVIA.host.guard(() =>
  {
    OLIVIA.host.set("oliviaSubmode", cwOliviaSub.value);
    mmdOliviaRestart();
  });
}

// oliviaWorker.js, set up for the input's rate, told the submode and the centre whenever they change
function mmdOliviaLoad(rate)
{
  const H = OLIVIA.host;
  if (!OLIVIA.worker)
  {
    OLIVIA.worker = new Worker(H.workerUrl("oliviaWorker.js"));
    OLIVIA.worker.onmessage = (event) => H.guard(() => mmdOliviaMessage(event.data));
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
  const signal = OLIVIA.host.signal(0);
  if (signal) signal.freq = mmdOliviaCenter();
  OLIVIA.host.overlay();
}

// A click on the waterfall (Olivia mode): the centre looked for there
function mmdOliviaTune(hz)
{
  if (hz == null) return;
  OLIVIA.host.set("oliviaCenter", Math.round(hz));
  mmdOliviaRestart();
}

// An RSID's name ("Olivia 8/500", as rsidWorker.js gives it): its submode here as kept ("olivia 8/500"), else null
function mmdOliviaRsidSub(name)
{
  const m = /^(Olivia|Contestia) (\d+)\/(\d+)$/.exec(String(name));
  if (!m) return null;
  const key = m[1].toLowerCase() + " " + m[2] + "/" + m[3];
  return OLIVIA_SUBMODES.some(([mode, tones, bandwidth]) => mode + " " + tones + "/" + bandwidth == key) ? key : null;
}

// An RSID heard: one of the submodes here, in Olivia mode, sets the submode and the centre (its frequency is the mode's centre), unless
// the signal being decoded is still printing (text within OLIVIA_BUSY_BLOCKS of its blocks, and a second: a station's RSID elsewhere
// doesn't take it off the one listened to; its label is still drawn)
function mmdOliviaRsid(name, freq)
{
  if (!mmdOliviaMode()) return;
  const H = OLIVIA.host;
  const signal = H.signal(0);
  const sub = mmdOliviaSub();
  // A block: 64 symbols (Contestia 32), each tones / bandwidth seconds
  const blockMs = ((sub.mode == "contestia" ? 32 : 64) * sub.tones * 1000) / sub.bandwidth;
  if (signal && signal.text && Date.now() - signal.last < 1000 + OLIVIA_BUSY_BLOCKS * blockMs) return;
  const key = mmdOliviaRsidSub(name);
  if (!key) return;
  H.set("oliviaSubmode", key);
  H.set("oliviaCenter", Math.round(freq));
  mmdOliviaMenu();
  mmdOliviaRestart();
}

// Its signal (the decoder's: host.channels), made where it's looked for, its baud the submode's
function mmdOliviaSignal(freq, snr)
{
  const H = OLIVIA.host;
  const sub = mmdOliviaSub();
  H.channels([{ id: 0, freq: freq, snr: snr, wpm: Math.round((sub.bandwidth / sub.tones) * 10) / 10, active: true }]);
  const signal = H.signal(0);
  signal.snrSeen = snr != null;
  return signal;
}

function mmdOliviaMessage(m)
{
  if (!mmdOliviaMode()) return;
  const H = OLIVIA.host;
  if (m.type == "lock") mmdOliviaSignal(m.center, m.snr);
  else if (m.type == "text")
  {
    let signal = H.signal(0);
    if (!signal || !signal.freq) signal = mmdOliviaSignal(mmdOliviaCenter(), signal ? signal.snr : null);
    const sub = mmdOliviaSub();
    signal.wpm = Math.round((sub.bandwidth / sub.tones) * 10) / 10;
    // Lines run on: a new line as a space, one space between words
    H.signalText(0, m.text);
    signal.alive = true;
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
  OLIVIA.host.overlayLabel(ctx, OLIVIA_NAMES[sub.mode] + " " + sub.tones + "/" + sub.bandwidth, (left + right) / 2, h - 19 * ratio, "center", 11, ratio, w, "rgb(" + rgb + ")");
}

// A test signal: your submode and centre kept, put back when it ends (an RSID in it, or the recording's own, moves them meanwhile)
function mmdOliviaTestStart(t)
{
  const H = OLIVIA.host;
  OLIVIA.saved = { submode: H.get("oliviaSubmode"), center: H.get("oliviaCenter") };
  if (t.olivia)
  {
    H.set("oliviaSubmode", t.olivia.submode);
    H.set("oliviaCenter", t.olivia.center);
    mmdOliviaMenu();
    mmdOliviaRestart();
  }
}

function mmdOliviaTestEnd()
{
  const H = OLIVIA.host;
  const saved = OLIVIA.saved;
  OLIVIA.saved = null;
  if (!saved) return;
  const moved = H.get("oliviaSubmode") != saved.submode || H.get("oliviaCenter") != saved.center;
  H.set("oliviaSubmode", saved.submode);
  H.set("oliviaCenter", saved.center);
  if (moved && mmdOliviaMode())
  {
    mmdOliviaMenu();
    mmdOliviaRestart();
  }
}

// Olivia and Contestia in the decoder's mode registry: from the input's own samples, its signal in CW's list
mmdRegisterMode({
  id: "olivia",
  name: "Olivia",
  modes: ["olivia"],
  input: "raw",
  cwList: true,
  // (its dB measured wider than its filter: shown under 0 too)
  snrWide: ["olivia"],
  init: (host) =>
  {
    OLIVIA.host = host;
  },
  listName: () => "Olivia",
  audio: (data) => mmdOliviaAudio(data),
  // (a click: its signal looked for there)
  tune: (hz) => mmdOliviaTune(hz),
  shown: (on) =>
  {
    cwOliviaBox.style.display = on ? "" : "none";
    if (on && OLIVIA.host) mmdOliviaMenu();
  },
  entered: () => mmdOliviaReset(),
  draw: (ctx, x, ratio, w, h) => mmdOliviaDraw(ctx, x, ratio, w, h),
  clear: () => mmdOliviaReset(),
  retune: () =>
  {
    if (mmdOliviaMode()) mmdOliviaReset();
  },
  // RSIDs: Olivia's and Contestia's ("Olivia 8/500")
  rsidMode: (name) => (mmdOliviaRsidSub(name) ? ["olivia", mmdOliviaRsidSub(name)] : null),
  rsidHeard: (name, freq) => mmdOliviaRsid(name, freq),
  // (one clicked: its submode and place, decoded from its start; already in Olivia, it goes to it)
  rsidBefore: (mark, sub) =>
  {
    OLIVIA.host.set("oliviaSubmode", sub);
    OLIVIA.host.set("oliviaCenter", Math.round(mark.freq));
    return true;
  },
  rsidAfter: (mark, sub, chunks, switched) =>
  {
    if (!switched)
    {
      mmdOliviaMenu();
      mmdOliviaRestart();
      mmdOliviaReset();
    }
    for (const chunk of chunks) mmdOliviaAudio(chunk);
  },
  logQso: () => ({ sub: mmdOliviaSubKey(), signalId: OLIVIA.host.signalId(0) }),
  testStart: (t) => mmdOliviaTestStart(t),
  testEnd: () => mmdOliviaTestEnd()
});
