// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Multi-Mode Decoder's SSTV mode (mmdSstv.js): pictures read from the 12 kHz audio the worklet sends (mmdWorklet.js, as it does for
// FT8), in a worker so the waterfall keeps drawing. Written from the published mode specifications (JL Barber, N7CXI, "Proposal for SSTV
// Mode Specifications", and the VIS code table), with ideas from slowrx by Oona Räisänen, OH2EIQ (ISC license; none of its code is used):
// each moment's frequency read from a short spectrum whose window grows as the signal weakens, and the line rate taken from the sync
// pulses (a sound card's clock a little off slants the picture; here it is measured as the lines come in, and the picture redrawn).
//
// In:  { type: "audio", samples (Float32Array at 12 kHz, one chunk after another) }, { type: "reset" } (the audio started again),
//      { type: "config", noVis } (Start Without VIS: sstvSyncStart)
// Out: { type: "start", id, mode, name, width, height }  a picture begins (its VIS code was heard)
//      { type: "rows", id, from, count, rgba }            rows from .. from + count - 1 (Uint8ClampedArray, width * count * 4)
//      { type: "redraw", id, count, rgba }                its first count rows again (the line rate measured better)
//      { type: "done", id, count, complete, rgba }        the picture as finally read, count rows (complete: all of them)
//      { type: "status", state ("idle" or "receiving"), snr (dB), id, line, lines, measured, syncs }  twice a second (measured: the lines
//      whose sync pulse was looked for, syncs: those where it was found clearly)

const SSTV_RATE = 12000;
// A frequency is read every SSTV_STEP samples: 6000 a second
const SSTV_STEP = 2;
const SSTV_EST_RATE = SSTV_RATE / SSTV_STEP;
// The spectrum: 256 points' bins (46.9 Hz) from 140 to 3420 Hz, where a picture's tones can be with its sender up to SSTV_SHIFT_MAX off;
// each reading works out only the bins it needs (sstvSpectrum)
const SSTV_N = 256;
const SSTV_BIN_HZ = SSTV_RATE / SSTV_N;
const SSTV_K0 = 3;
const SSTV_K1 = 73;
// While no picture comes in: a reading every SSTV_IDLE_STEP (1 ms, enough for a VIS code's 30 ms tones) over the whole passband (from
// SSTV_IDLE_LO to SSTV_IDLE_HI Hz), with a window of its own; a VIS code heard, the picture is read again from its start at the full rate
const SSTV_IDLE_STEP = 6;
const SSTV_IDLE_LO = 150;
const SSTV_IDLE_HI = 3300;
const SSTV_IDLE_WINDOW = 140;
// The window by the signal to noise ratio (samples; slowrx's lengths at this rate): strong signals read sharply, weak ones steadily
const SSTV_WINDOWS = [[20, 14], [10, 18], [9, 26], [3, 36], [-5, 70], [-10, 140], [-Infinity, 256]];
// The ratio it is chosen by: the median of the newest SSTV_SNR_KEEP measurements (each over 256 samples, 21 ms), less SSTV_SNR_BIAS dB.
// One measurement swings with the picture itself (a sync pulse, fine detail) and with a satellite's FM or a fading HF signal, which
// changed the window several times a line; steadier and a little longer, the pictures read closer to what was sent (by 1 to 6 dB on FM
// satellite recordings and on HF-like noise, 0.4 dB softer on a strong clean signal)
const SSTV_SNR_KEEP = 15;
const SSTV_SNR_BIAS = 6;
// A picture's color is cleaned (sstvPaint) on the lines read with a window longer than this (the signal not strong): noise there shows
// as specks of color, while the color carries little fine detail (Robot and PD send it at half resolution)
const SSTV_CLEAN_WINDOW = 14;
// The sync pulses are found in readings with a window of their own (3 ms: 1200 Hz told from the porch's 1500 Hz, and short beside a pulse),
// as where the frequency climbs out of the sync tone (below SSTV_SYNC_EDGE above it)
const SSTV_SYNC_WINDOW = 36;
const SSTV_SYNC_EDGE = 150;
// Black and white (Hz; 255 steps between them), the sync pulse, and the VIS code's tones
const SSTV_BLACK = 1500;
const SSTV_WHITE = 2300;
const SSTV_SYNC = 1200;
const SSTV_LEADER = 1900;
// How far off a sender may be tuned (Hz: its VIS code is looked for over the whole passband), and how far a tone may be from what it
// should be (Hz)
const SSTV_SHIFT_MAX = 1000;
const SSTV_TONE_TOL = 70;
// The VIS code's: each tone within this of what it should be (Hz; its bits' 1100 and 1300 Hz still told apart), and its leader steady
// (within that of its median) in this share of its readings. On the air (a satellite's FM, a fading HF signal) a 30 ms tone reads
// rougher than a test signal, and the parity and a known mode's code still have to match. While a picture comes in, a VIS code that would
// end it must read as cleanly as SSTV_TONE_TOL and a leader steady in half its readings (a picture begun isn't given up easily)
const SSTV_VIS_TOL = 100;
const SSTV_VIS_STEADY = 0.35;
const SSTV_VIS_STEADY_LIVE = 0.5;
// The line rate is measured within this share of what the mode says (sound cards are rarely 0.2% off)
const SSTV_RATE_TOL = 0.006;
// A picture is read on to its last line whatever the signal does (a faded signal that comes back still gives the rest of it), and
// every line drawn is kept: nothing shown is cut away, noise or not

// ---- The modes (N7CXI's table): each one's VIS code, name, size, the time of a line (s; a PD line holds two rows), where its sync pulse
// ends (s from the line's start), and its channels: where each starts in the line and how long it is (s), and what it carries

function sstvMartin(vis, name, scan)
{
  const sync = 4.862e-3, porch = 0.572e-3, sep = 0.572e-3;
  const g = sync + porch, b = g + scan + sep, r = b + scan + sep;
  return { vis, name, family: "gbr", width: 320, height: 256, line: r + scan + sep, sync, syncEnd: sync, channels: [[g, scan], [b, scan], [r, scan]] };
}

// The sync pulse comes between blue and red (and once before the first line)
function sstvScottie(vis, name, scan)
{
  const sync = 9e-3, porch = 1.5e-3, sep = 1.5e-3;
  const g = sep, b = g + scan + sep, r = b + scan + sync + porch;
  return { vis, name, family: "gbr", width: 320, height: 256, line: r + scan, sync, syncEnd: b + scan + sync, lead: sync, channels: [[g, scan], [b, scan], [r, scan]] };
}

const SSTV_MODES = [
  sstvMartin(0x2c, "Martin 1", 146.432e-3),
  sstvMartin(0x28, "Martin 2", 73.216e-3),
  sstvScottie(0x3c, "Scottie 1", 138.24e-3),
  sstvScottie(0x38, "Scottie 2", 88.064e-3),
  sstvScottie(0x4c, "Scottie DX", 345.6e-3),
  // Robot 36: luminance, then one color difference a line (R-Y on even lines, B-Y on odd), each for two rows
  { vis: 0x08, name: "Robot 36", family: "r36", width: 320, height: 240, line: 150e-3, sync: 9e-3, syncEnd: 9e-3, channels: [[12e-3, 88e-3], [106e-3, 44e-3]] },
  // Robot 72: luminance, R-Y, B-Y every line
  { vis: 0x0c, name: "Robot 72", family: "yuv", width: 320, height: 240, line: 300e-3, sync: 9e-3, syncEnd: 9e-3, channels: [[12e-3, 138e-3], [156e-3, 69e-3], [231e-3, 69e-3]] },
  sstvPd(0x63, "PD 90", 0.532e-3, 320, 256),
  sstvPd(0x5f, "PD 120", 0.19e-3, 640, 496),
  sstvPd(0x60, "PD 180", 0.286e-3, 640, 496)
];

// PD: a line holds two rows, luminance of the first, R-Y and B-Y for both, luminance of the second
function sstvPd(vis, name, pixel, width, height)
{
  const sync = 20e-3, porch = 2.08e-3, scan = pixel * width, y1 = sync + porch;
  return { vis, name, family: "pd", width, height, line: y1 + 4 * scan, sync, syncEnd: sync, channels: [[y1, scan], [y1 + scan, scan], [y1 + 2 * scan, scan], [y1 + 3 * scan, scan]] };
}

// The lines a mode sends (a PD line is two rows)
function sstvLines(mode)
{
  return mode.family == "pd" ? mode.height / 2 : mode.height;
}

// ---- The state

// Running as the worker (not loaded for an offline test)
const SSTV_IN_WORKER = typeof WorkerGlobalScope != "undefined" && self instanceof WorkerGlobalScope;

const S = {
  out: SSTV_IN_WORKER ? (message, transfer) => postMessage(message, transfer || []) : null,
  samples: new Float32Array(1 << 17), // the newest samples (a ring)
  count: 0,       // samples ever had
  freq: new Float32Array(1 << 21),    // each reading's frequency (Hz; a ring, about 350 s): within a picture's range while one comes in
  wide: new Float32Array(1 << 21),    // the same over all a VIS code uses (so a new picture is heard during one)
  sync: new Float32Array(1 << 21),    // and over the same, read with the sync pulses' own window (SSTV_SYNC_WINDOW)
  est: 0,         // readings ever made
  window: 36,     // the window now (samples)
  snr: -20,
  snrs: [],       // the newest measurements, for the window (SSTV_SNR_KEEP)
  full: -1,       // within a picture, the newest reading whose frequencies were worked out (sstvReadAll; -1: none yet)
  hann: {},
  cos: null,
  sin: null,
  visFrom: 0,     // the reading the VIS search goes on from
  pic: null,      // the picture being received
  nextId: 1,
  statusAt: 0,
  // Start Without VIS (MMD.sstvNoVis, the "config" message): a picture whose VIS code was missed started from its sync pulses
  // (sstvSyncStart); the reading it last looked at, the train it found then (to be found again before it starts), and the reading the
  // last picture ended at (its own pulses are not looked at again)
  noVis: false,
  syncCheckAt: 0,
  syncSeen: null,
  quietFrom: 0
};

function sstvTables()
{
  S.cos = [];
  S.sin = [];
  for (let k = SSTV_K0; k <= SSTV_K1; k++)
  {
    const c = new Float32Array(SSTV_N), s = new Float32Array(SSTV_N);
    for (let n = 0; n < SSTV_N; n++)
    {
      c[n] = Math.cos((2 * Math.PI * k * n) / SSTV_N);
      s[n] = Math.sin((2 * Math.PI * k * n) / SSTV_N);
    }
    S.cos.push(c);
    S.sin.push(s);
  }
  for (const [, length] of SSTV_WINDOWS)
  {
    const w = new Float32Array(length);
    for (let n = 0; n < length; n++) w[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (n + 0.5)) / length);
    S.hann[length] = w;
  }
}

function sstvReset()
{
  S.count = 0;
  S.est = 0;
  S.visFrom = 0;
  S.snr = -20;
  S.snrs = [];
  S.full = -1;
  S.window = 36;
  if (S.pic) sstvFinish(false);
  S.pic = null;
  S.syncCheckAt = 0;
  S.syncSeen = null;
  S.quietFrom = 0;
}

// ---- Reading the frequency

const SSTV_POWER = new Float32Array(SSTV_K1 - SSTV_K0 + 1);

// The strongest frequency between lo and hi (Hz) in the spectrum just worked out: its strongest bin (one bin either side of the range
// allowed), then between its neighbors (a Gaussian through the three)
function sstvPeak(lo, hi)
{
  const kLo = Math.max(SSTV_K0 + 1, Math.floor(lo / SSTV_BIN_HZ)), kHi = Math.min(SSTV_K1 - 1, Math.ceil(hi / SSTV_BIN_HZ));
  let best = kLo;
  for (let k = kLo; k <= kHi; k++) if (SSTV_POWER[k - SSTV_K0] > SSTV_POWER[best - SSTV_K0]) best = k;
  const la = Math.log(SSTV_POWER[best - 1 - SSTV_K0] + 1e-20), lb = Math.log(SSTV_POWER[best - SSTV_K0] + 1e-20), ld = Math.log(SSTV_POWER[best + 1 - SSTV_K0] + 1e-20);
  const den = 2 * (2 * lb - la - ld);
  const delta = den > 0 ? Math.max(-0.5, Math.min(0.5, (ld - la) / den)) : 0;
  return Math.max(lo, Math.min(hi, (best + delta) * SSTV_BIN_HZ));
}

// The reading centered on sample c, with no picture coming in: the strongest frequency over the whole passband (the three readings the same)
// Within a picture (its sender shift Hz off): the strongest between its black and white (a bin either side), over all a VIS code uses
// (a new picture from the same sender), and over the same with the sync pulses' window
function sstvRead(c, pic)
{
  if (!pic)
  {
    sstvSpectrum(c, SSTV_IDLE_WINDOW, SSTV_IDLE_LO, SSTV_IDLE_HI);
    const f = sstvPeak(SSTV_IDLE_LO, SSTV_IDLE_HI);
    if (!S.noVis) return [f, f, f];
    // Start Without VIS: the sync pulses' own reading too, for sstvSyncStart
    sstvSpectrum(c, SSTV_SYNC_WINDOW, SSTV_IDLE_LO, SSTV_IDLE_HI);
    return [f, f, sstvPeak(SSTV_IDLE_LO, SSTV_IDLE_HI)];
  }
  const lo = 1000 + pic.shift, hi = 2500 + pic.shift;
  sstvSpectrum(c, S.window, lo, hi);
  const f = sstvPeak(SSTV_BLACK + pic.shift - SSTV_BIN_HZ, SSTV_WHITE + pic.shift + SSTV_BIN_HZ);
  const wide = sstvPeak(lo, hi);
  if (S.window == SSTV_SYNC_WINDOW) return [f, wide, wide];
  sstvSpectrum(c, SSTV_SYNC_WINDOW, lo, hi);
  return [f, wide, sstvPeak(lo, hi)];
}

// The power in the bins from lo to hi Hz, and one either side (SSTV_POWER, by bin less SSTV_K0), of the samples about c, with a Hann
// window length long
function sstvSpectrum(c, length, lo, hi)
{
  const w = S.hann[length];
  const mask = S.samples.length - 1;
  const first = c - (length >> 1);
  const k0 = Math.max(SSTV_K0, Math.floor(lo / SSTV_BIN_HZ) - 1), k1 = Math.min(SSTV_K1, Math.ceil(hi / SSTV_BIN_HZ) + 1);
  for (let k = k0 - SSTV_K0; k <= k1 - SSTV_K0; k++)
  {
    const ct = S.cos[k], st = S.sin[k];
    let re = 0, im = 0;
    for (let n = 0; n < length; n++)
    {
      const x = S.samples[(first + n) & mask] * w[n];
      re += x * ct[n];
      im += x * st[n];
    }
    SSTV_POWER[k] = re * re + im * im;
  }
}

// The signal to noise ratio (dB) from the newest 256 samples: the power from black to white against the noise either side of the signal
// (400 to 800 Hz and 2700 to 3400 Hz, each moved with the picture's sender when one comes in), in the same width
// Its every other sample windowed (SSTV_SNR_X), and each bin's cosine and sine at those samples (SSTV_SNR_COS, SSTV_SNR_SIN: by bin, up to
// 5500 Hz), worked out once (a Math.cos and Math.sin a sample each time took half the worker's time)
const SSTV_SNR_X = new Float64Array(SSTV_N / 2);
const SSTV_SNR_COS = [];
const SSTV_SNR_SIN = [];

function sstvSnrTables()
{
  for (let k = 0; k <= Math.round(5500 / SSTV_BIN_HZ); k++)
  {
    const c = new Float64Array(SSTV_N / 2), s = new Float64Array(SSTV_N / 2);
    for (let m = 0; m < SSTV_N / 2; m++)
    {
      const p = (2 * Math.PI * k * 2 * m) / SSTV_N;
      c[m] = Math.cos(p);
      s[m] = Math.sin(p);
    }
    SSTV_SNR_COS.push(c);
    SSTV_SNR_SIN.push(s);
  }
}

function sstvSnr()
{
  const mask = S.samples.length - 1;
  const first = S.count - SSTV_N;
  const shift = S.pic ? S.pic.shift : 0;
  if (!SSTV_SNR_COS.length) sstvSnrTables();
  for (let m = 0; m < SSTV_N / 2; m++) SSTV_SNR_X[m] = S.samples[(first + 2 * m) & mask] * (0.5 - 0.5 * Math.cos((2 * Math.PI * 2 * m) / SSTV_N));
  const power = (lo, hi) =>
  {
    lo = Math.max(100, lo + shift);
    hi = Math.min(5500, hi + shift);
    let sum = 0;
    for (let k = Math.round(lo / SSTV_BIN_HZ); k <= Math.round(hi / SSTV_BIN_HZ); k++)
    {
      const ct = SSTV_SNR_COS[k], st = SSTV_SNR_SIN[k];
      let re = 0, im = 0;
      for (let m = 0; m < SSTV_N / 2; m++)
      {
        re += SSTV_SNR_X[m] * ct[m];
        im += SSTV_SNR_X[m] * st[m];
      }
      sum += re * re + im * im;
    }
    return [sum, Math.round(hi / SSTV_BIN_HZ) - Math.round(lo / SSTV_BIN_HZ) + 1];
  };
  const [n1, c1] = power(400, 800), [n2, c2] = power(2700, 3400), [sv, cv] = power(SSTV_BLACK, SSTV_WHITE);
  const noise = (n1 + n2) / (c1 + c2) + 1e-20;
  const snr = 10 * Math.log10(Math.max(1e-6, sv - noise * cv) / (noise * cv));
  S.snr = Math.max(-20, snr);
  S.snrs.push(S.snr);
  if (S.snrs.length > SSTV_SNR_KEEP) S.snrs.shift();
  const sorted = S.snrs.slice().sort((a, b) => a - b);
  const steady = sorted[sorted.length >> 1] - SSTV_SNR_BIAS;
  for (const [above, length] of SSTV_WINDOWS)
  {
    if (steady >= above)
    {
      S.window = length;
      break;
    }
  }
}

// Samples in: the readings they allow (each needs the samples either side of its center), the VIS search, and the picture's lines
function sstvFeed(samples)
{
  const mask = S.samples.length - 1;
  // Each sample in, the signal to noise ratio (and the window with it) every 256
  for (let i = 0; i < samples.length; i++)
  {
    S.samples[S.count & mask] = samples[i];
    S.count++;
    if ((S.count & 255) == 0) sstvSnr();
  }
  sstvReadAll();
  // A picture just begun (its VIS code heard, or with Start Without VIS its sync pulses): read again from its start, at the full rate and
  // within its range
  if (sstvVisSearch() || sstvSyncStart()) sstvReadAll();
  if (S.pic) sstvLinesIn();
  const now = Date.now();
  if (now - S.statusAt > 500)
  {
    S.statusAt = now;
    const pic = S.pic;
    S.out({ type: "status", state: pic ? "receiving" : "idle", snr: Math.round(S.snr), id: pic ? pic.id : 0, line: pic ? pic.rendered : 0, lines: pic ? sstvLines(pic.mode) : 0, measured: pic ? pic.measured : 0, syncs: pic ? pic.points.length : 0 });
  }
}

// The readings the samples allow (each needs the samples up to half the longest window past its center); with no picture coming in, one
// every SSTV_IDLE_STEP, the ones between it the same. Within a picture read with a long window (SSTV_STRIDE_FROM samples or more: it
// changes slowly), its frequencies are worked out every window / 32 readings and the ones between drawn straight from one to the next
// (the sync pulses' own reading still at every one): a 256-sample window costs a sixth of what it would
const SSTV_STRIDE_FROM = 70;

function sstvReadAll()
{
  const fmask = S.freq.length - 1;
  while (S.est * SSTV_STEP + 129 <= S.count)
  {
    const i = S.est & fmask;
    const stride = S.pic && S.window >= SSTV_STRIDE_FROM ? S.window >> 5 : 1;
    if (!S.pic && S.est % SSTV_IDLE_STEP != 0)
    {
      const before = (S.est - 1) & fmask;
      S.freq[i] = S.freq[before];
      S.wide[i] = S.wide[before];
      S.sync[i] = S.sync[before];
    }
    else if (stride > 1 && S.est % stride != 0 && S.full >= 0 && S.est > S.full && S.est - S.full < 16)
    {
      // Between two worked out: filled in at the next one
      const lo = 1000 + S.pic.shift, hi = 2500 + S.pic.shift;
      sstvSpectrum(S.est * SSTV_STEP, SSTV_SYNC_WINDOW, lo, hi);
      S.sync[i] = sstvPeak(lo, hi);
    }
    else
    {
      [S.freq[i], S.wide[i], S.sync[i]] = sstvRead(S.est * SSTV_STEP, S.pic);
      if (S.pic && S.full >= 0 && S.est - S.full > 1 && S.est - S.full < 16)
      {
        const a = S.full & fmask, gap = S.est - S.full;
        for (let k = 1; k < gap; k++)
        {
          const j = (S.full + k) & fmask, f = k / gap;
          S.freq[j] = S.freq[a] + (S.freq[i] - S.freq[a]) * f;
          S.wide[j] = S.wide[a] + (S.wide[i] - S.wide[a]) * f;
        }
      }
      S.full = S.pic ? S.est : -1;
    }
    S.est++;
  }
}

// ---- The VIS code: 1900 Hz for 300 ms (with a 10 ms break at 1200 Hz in it), the start bit (1200 Hz, 30 ms), 7 bits low bit first and an
// even parity bit (each 30 ms: 1100 Hz a one, 1300 Hz a zero), the stop bit (1200 Hz, 30 ms). The leader's frequency gives how far off
// the sender is tuned (shift), which every tone after it is read with

const SSTV_MS = SSTV_EST_RATE / 1000;

// The readings (over all a VIS code uses) from a to b (reading indexes; their middle, the edges left out; one a millisecond): their
// median, and the share of them within tol of it. Noise read as some other frequency anywhere in the passband moves neither
const SSTV_MEDIAN = new Float32Array(400);

function sstvMedian(a, b, tol = SSTV_VIS_TOL)
{
  const fmask = S.wide.length - 1;
  const from = Math.round(a + (b - a) * 0.15), to = Math.round(b - (b - a) * 0.15);
  let n = 0;
  for (let i = from; i < to && n < SSTV_MEDIAN.length; i += SSTV_IDLE_STEP) SSTV_MEDIAN[n++] = S.wide[i & fmask];
  if (n == 0) return [0, 0];
  const values = SSTV_MEDIAN.subarray(0, n).sort();
  const median = values[n >> 1];
  let near = 0;
  for (let i = 0; i < n; i++) if (Math.abs(values[i] - median) < tol) near++;
  return [median, near / n];
}

// A VIS code starting (its start bit) at reading t: { code, shift, error } or null. Its leader must be most of its readings. While a
// picture comes in, held to the stricter tolerances (one that would end it must be clean)
function sstvVisAt(t)
{
  const ms = SSTV_MS;
  const tol = S.pic ? SSTV_TONE_TOL : SSTV_VIS_TOL;
  const [leader, steady] = sstvMedian(t - 250 * ms, t - 30 * ms, tol);
  const shift = leader - SSTV_LEADER;
  if (Math.abs(shift) > SSTV_SHIFT_MAX || steady < (S.pic ? SSTV_VIS_STEADY_LIVE : SSTV_VIS_STEADY)) return null;
  let error = 0;
  const tone = (from, to, hz) =>
  {
    const [m] = sstvMedian(t + from * ms, t + to * ms, tol);
    const e = Math.abs(m - shift - hz);
    error += e;
    return e < tol;
  };
  if (!tone(0, 30, SSTV_SYNC) || !tone(270, 300, SSTV_SYNC)) return null;
  let code = 0, ones = 0;
  for (let bit = 0; bit < 8; bit++)
  {
    const [m] = sstvMedian(t + (30 + 30 * bit) * ms, t + (60 + 30 * bit) * ms, tol);
    const one = Math.abs(m - shift - 1100), zero = Math.abs(m - shift - 1300);
    if (Math.min(one, zero) >= tol) return null;
    error += Math.min(one, zero);
    if (one < zero)
    {
      ones++;
      // The eighth bit is the parity
      if (bit < 7) code |= 1 << bit;
    }
  }
  if (ones % 2) return null;
  return { code, shift, error };
}

// The readings not searched yet that have 300 ms after them: each start (1 ms apart) tried; of a run of starts in a row that each read
// a header of a mode known here, the one read best (a start a few ms off the real one straddles two bits each window and can misread as
// another code, often one no mode has: it neither counts nor ends the run, which used to skip the real header 300 ms on). True when a
// picture has begun
function sstvVisSearch()
{
  const ms = SSTV_MS;
  const last = S.est - Math.ceil(300 * ms);
  let from = Math.max(S.visFrom, Math.ceil(260 * ms));
  // Too far behind (a gap): from the newest 2 s
  if (last - from > 2 * SSTV_EST_RATE) from = last - 2 * SSTV_EST_RATE;
  let best = null;
  let t = from;
  for (; t <= last; t += 6)
  {
    let v = sstvVisAt(t);
    if (v && !SSTV_MODES.some((m) => m.vis == v.code)) v = null;
    if (v)
    {
      if (!best || v.error < best.error) best = { ...v, t };
      continue;
    }
    if (best) break;
  }
  // A run still going on at the newest start: decided next time, when it can be seen to end
  if (best && t > last) t = best.t - 6;
  S.visFrom = Math.max(from, t);
  if (!best || t <= best.t) return false;
  const mode = SSTV_MODES.find((m) => m.vis == best.code);
  S.visFrom = best.t + Math.ceil(300 * ms);
  if (!mode) return false;
  sstvStart(mode, best.t + 300 * ms, best.shift);
  return true;
}

// ---- Start Without VIS (S.noVis): with no picture coming in, every SSTV_SYNC_CHECK s the newest lines' worth of sync readings (6 to 16
// lines, at most SSTV_SYNC_SPAN s) are laid side by side at each mode's line period, its shortest first. A train of the mode's sync
// pulses shows as one place in the line where the readings agree (SSTV_SYNC_AGREE of them within 60 Hz) on the lowest steady tone (1200 Hz
// with the sender up to SSTV_SHIFT_MAX off), for about as long as its pulse, with the porch after it 200 Hz or more higher, that tone
// nowhere else in the line and the rest of it mostly between black and white (a data signal's carrier passed the others). Found the
// same way twice in a row (the same mode, its pulses where they were), the picture starts at the first of those lines, drawn from the
// top: where it began isn't known (Robot 36's separators tell its color differences apart: sstvSeparator). It ends after
// SSTV_SYNC_LOST lines with no pulse, those left out (sstvLinesIn), and is never complete
const SSTV_SYNC_CHECK = 0.5;
const SSTV_SYNC_SPAN = 6;
const SSTV_SYNC_AGREE = 0.75;
const SSTV_SYNC_LOST = 12;
const SSTV_SYNC_SORT = new Float32Array(16);

function sstvSyncStart()
{
  if (!S.noVis || S.pic || S.est - S.syncCheckAt < SSTV_SYNC_CHECK * SSTV_EST_RATE) return false;
  S.syncCheckAt = S.est;
  const smask = S.sync.length - 1, step = SSTV_IDLE_STEP;
  let found = null;
  for (const mode of SSTV_MODES.slice().sort((p, q) => p.line - q.line))
  {
    const period = mode.line * SSTV_EST_RATE;
    const lines = Math.max(6, Math.min(16, Math.floor(SSTV_SYNC_SPAN / mode.line)));
    const first = S.est - 1 - period * lines;
    // (All of them heard since the last picture ended, and their samples still kept to read the picture again from)
    if (first < S.quietFrom || first * SSTV_STEP - 4096 < S.count - S.samples.length) continue;
    const phases = Math.floor(period / step);
    const med = new Float32Array(phases), agree = new Float32Array(phases);
    const v = SSTV_SYNC_SORT.subarray(0, lines);
    for (let p = 0; p < phases; p++)
    {
      for (let k = 0; k < lines; k++) v[k] = S.sync[Math.round(first + k * period + p * step) & smask];
      v.sort();
      const m = v[lines >> 1];
      let near = 0;
      for (let k = 0; k < lines; k++) if (Math.abs(v[k] - m) < 60) near++;
      med[p] = m;
      agree[p] = near / lines;
    }
    let low = Infinity, at = -1;
    for (let p = 0; p < phases; p++)
    {
      if (agree[p] >= SSTV_SYNC_AGREE && med[p] < low)
      {
        low = med[p];
        at = p;
      }
    }
    if (at < 0 || Math.abs(low - SSTV_SYNC) > SSTV_SHIFT_MAX) continue;
    // The run of steady phases at it (round the line), as long as the mode's pulse
    const wrap = (p) => ((p % phases) + phases) % phases;
    const steady = (p) => agree[wrap(p)] >= SSTV_SYNC_AGREE && Math.abs(med[wrap(p)] - low) < 60;
    let a = at, b = at;
    while (b - a < phases && steady(b + 1)) b++;
    while (b - a < phases && steady(a - 1)) a--;
    const width = ((b - a + 1) * step) / SSTV_MS, pulse = mode.sync * 1000;
    if (width < Math.max(2, pulse * 0.4) || width > pulse + 6) continue;
    // The porch after it higher
    const after = [];
    for (let ms = 2; ms <= 5; ms++) after.push(med[wrap(b + Math.round((ms * SSTV_MS) / step))]);
    after.sort((p, q) => p - q);
    if (after[2] - low < 200) continue;
    // The rest of the line a picture: its tone nowhere else (a carrier's would be), and the line mostly between black and white (250 to
    // 1200 Hz above it)
    const clearOf = Math.round(((pulse + 3) * SSTV_MS) / step);
    let rest = 0, atLow = 0, inPicture = 0;
    for (let p = b + clearOf; p < a + phases - clearOf; p++)
    {
      const m = med[wrap(p)];
      rest++;
      if (Math.abs(m - low) < 60) atLow++;
      if (m >= low + 250 && m <= low + 1200) inPicture++;
    }
    if (rest == 0 || atLow > rest * 0.05 || inPicture < rest * 0.7) continue;
    // From the first of those lines whose own pulse (and the next two's) is there: never from noise before the signal came, whose pulse
    // the line rate would be measured from
    const there = (k) => Math.abs(S.sync[Math.round(first + k * period + at * step) & smask] - low) < 60;
    let k0 = 0;
    while (k0 < lines - 3 && !(there(k0) && there(k0 + 1) && there(k0 + 2))) k0++;
    found = { mode, period, end: first + k0 * period + b * step, shift: low - SSTV_SYNC };
    break;
  }
  const seen = S.syncSeen;
  S.syncSeen = found ? { vis: found.mode.vis, end: found.end, period: found.period } : null;
  if (!found || !seen || seen.vis != found.mode.vis) return false;
  // Its pulses where they were half a second ago (within 5 ms of a whole number of lines on)
  const off = (((found.end - seen.end) % found.period) + found.period) % found.period;
  if (Math.min(off, found.period - off) > 5 * SSTV_MS) return false;
  // The first line's start, from its pulse's end (Scottie's lead pulse before it, as sstvStart adds)
  const mode = found.mode;
  sstvStart(mode, found.end - (mode.syncEnd + (mode.lead || 0)) * SSTV_EST_RATE, found.shift, true);
  return true;
}

// ---- A picture's lines

function sstvStart(mode, at, shift, noVis = false)
{
  if (S.pic) sstvFinish(false);
  const id = S.nextId++;
  const period = mode.line * SSTV_EST_RATE;
  const start = at + (mode.lead || 0) * SSTV_EST_RATE;
  S.pic = {
    // shift: how far the sender is from where its tones belong (Hz), from the VIS code, then followed line by line from each sync pulse's
    // tone (sstvSyncTone: a sender that drifts, a satellite's Doppler); lineShift: the one each line was read with
    id, mode, shift, period,
    lineShift: [],
    tones: [],        // the newest sync pulses' tones (sstvSyncTone), for the one followed
    lines: sstvLines(mode),
    // The line rate and where line 0's sync pulse ends (readings): as the mode says, until the pulses are measured
    a: start + mode.syncEnd * SSTV_EST_RATE, b: period, nominal: period,
    points: [],       // sync pulses measured: [line, where it ends, how clearly]
    measured: 0,      // the lines whose pulse has been looked for
    rendered: 0,      // the lines drawn
    drawnAt: [],      // the start each drawn line was read from (to tell when a better rate moves them)
    redrawnAt: 0,
    rgba: new Uint8ClampedArray(mode.width * mode.height * 4),
    // Each row's luminance and color differences as read (0 to 255, the differences about 128), painted into rgba with the color cleaned
    // (sstvPaint); the window each line was read with
    Y: new Float32Array(mode.width * mode.height),
    U: new Float32Array(mode.width * mode.height),
    V: new Float32Array(mode.width * mode.height),
    lineWindow: [],
    // Robot 36: the separators' votes, and 1 when the even lines carry B-Y (sstvSeparator)
    sepAgree: 0,
    sepDisagree: 0,
    parity: 0,
    reparity: false,
    // Started without its VIS code (sstvSyncStart), and the lines in a row since its last sync pulse
    noVis,
    lost: 0,
    lastClear: -1,    // its last line with a clear pulse
    chroma: null      // Robot 36: the even line's color difference, for the odd line after it
  };
  // Read again from just before it starts (the samples are still kept): at the full rate, within its range
  const back = Math.floor(at - 10 * SSTV_MS);
  if (back * SSTV_STEP - 129 > S.count - S.samples.length) S.est = Math.min(S.est, back);
  S.full = -1;
  S.syncSeen = null;
  S.out({ type: "start", id, mode: mode.vis, name: mode.name, width: mode.width, height: mode.height, shift: Math.round(shift) });
}

// Where line y starts (readings), by the line rate measured so far
function sstvLineStart(pic, y)
{
  return pic.a + pic.b * y - pic.mode.syncEnd * SSTV_EST_RATE * sstvScale(pic);
}

// The sender's clock against ours: everything within a line is that much longer or shorter than the mode says, as the line is
function sstvScale(pic)
{
  return pic.b / pic.nominal;
}

// The sync pulse that ends nearest where line y's should: where the most readings before it are at the sync tone and the fewest after.
// Its place and how clear that is (0 to 1)
function sstvSyncEnd(pic, y)
{
  const smask = S.sync.length - 1;
  const expect = pic.a + pic.b * y;
  const spread = pic.points.length >= 8 ? 2 * SSTV_MS : pic.points.length == 0 ? 15 * SSTV_MS : Math.max(3 * SSTV_MS, pic.mode.sync * SSTV_EST_RATE);
  // Most of the pulse (all of it would take in the porch before Scottie's), and the porch after it
  const before = Math.round(Math.min(pic.mode.sync * 0.8, 16e-3) * SSTV_EST_RATE), after = Math.round(1.5 * SSTV_MS);
  const edge = SSTV_SYNC + SSTV_SYNC_EDGE + pic.shift;
  let best = -1, bestAt = expect;
  for (let e = Math.round(expect - spread); e <= Math.round(expect + spread); e++)
  {
    let high = 0, low = 0;
    for (let i = e - before; i < e; i++) if (S.sync[i & smask] < edge) high++;
    for (let i = e; i < e + after; i++) if (S.sync[i & smask] < edge) low++;
    const fall = high / before - low / after;
    if (fall > best)
    {
      best = fall;
      bestAt = e;
    }
  }
  return [bestAt, best];
}

// The sender's tones followed (Hz): the sync tone's median over the pulse that ends at reading at (its middle: the edges left out), less
// where it belongs. Null when too few readings agree on it (noise). A sender that drifts, or a satellite's Doppler not yet corrected
// (BirdWatch retunes in steps), moves it line by line, and the picture's levels and the next pulses are read with it (sstvLinesIn).
// In noise the readings fall to the bottom of their range (a receiver's hiss is loudest low, an FM one's most of all) and agree there:
// the readings within a bin of it are left out, the tone followed is the median of the newest SSTV_FOLLOW_LINES lines' (from the third),
// and it moves at most SSTV_FOLLOW_STEP Hz a line (a drifting sender or a Doppler moves a few). Without these, an ISS pass's noise once
// read every tone 170 Hz high for a dozen lines: a magenta band across the picture
const SSTV_FOLLOW_MAX = 200;
const SSTV_FOLLOW_GAIN = 0.5;
const SSTV_FOLLOW_LINES = 5;
const SSTV_FOLLOW_STEP = 25;

function sstvSyncTone(pic, at)
{
  const smask = S.sync.length - 1;
  const length = Math.round(pic.mode.sync * SSTV_EST_RATE);
  const from = Math.round(at - length * 0.85), to = Math.round(at - length * 0.15);
  const floor = 1000 + pic.shift + SSTV_BIN_HZ;
  let n = 0;
  for (let i = from; i < to && n < SSTV_MEDIAN.length; i++)
  {
    const v = S.sync[i & smask];
    if (v > floor) SSTV_MEDIAN[n++] = v;
  }
  if (n < 5 || n < (to - from) * 0.6) return null;
  const values = SSTV_MEDIAN.subarray(0, n).sort();
  const median = values[n >> 1];
  let near = 0;
  for (let i = 0; i < n; i++) if (Math.abs(values[i] - median) < SSTV_TONE_TOL) near++;
  return near / n >= 0.6 ? median - SSTV_SYNC : null;
}

// The line rate and offset from the sync pulses measured: a straight line through them, weighted by how clear each was, the ones far
// off it left out; the rate kept within SSTV_RATE_TOL of the mode's
function sstvFit(pic)
{
  let points = pic.points;
  if (points.length == 0) return;
  for (let round = 0; round < 3; round++)
  {
    let a, b;
    if (points.length < 3)
    {
      b = pic.nominal;
      a = points.reduce((sum, p) => sum + p[1] - b * p[0], 0) / points.length;
    }
    else
    {
      let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (const [x, y, w] of points)
      {
        sw += w;
        sx += w * x;
        sy += w * y;
        sxx += w * x * x;
        sxy += w * x * y;
      }
      const den = sw * sxx - sx * sx;
      b = den > 0 ? (sw * sxy - sx * sy) / den : pic.nominal;
      b = Math.max(pic.nominal * (1 - SSTV_RATE_TOL), Math.min(pic.nominal * (1 + SSTV_RATE_TOL), b));
      a = (sy - b * sx) / sw;
    }
    pic.a = a;
    pic.b = b;
    const residual = points.map((p) => Math.abs(p[1] - a - b * p[0]));
    const rms = Math.sqrt(residual.reduce((s, r) => s + r * r, 0) / residual.length);
    const keep = points.filter((p, i) => residual[i] <= Math.max(2 * SSTV_MS, 2.5 * rms));
    if (keep.length == points.length || keep.length < 3) break;
    points = keep;
  }
}

// What a channel reads at reading t: 0 (black) to 255 (white)
function sstvLevel(t, shift)
{
  const fmask = S.freq.length - 1;
  const i = Math.floor(t), frac = t - i;
  const f = S.freq[i & fmask] * (1 - frac) + S.freq[(i + 1) & fmask] * frac;
  return Math.max(0, Math.min(255, ((f - SSTV_BLACK - shift) * 255) / (SSTV_WHITE - SSTV_BLACK)));
}

// A channel of line y: width values, each the mean of three readings across its pixel
function sstvChannel(pic, y, channel, out)
{
  const [start, length] = pic.mode.channels[channel];
  const scale = sstvScale(pic);
  const base = sstvLineStart(pic, y) + start * SSTV_EST_RATE * scale;
  const pixel = (length * SSTV_EST_RATE * scale) / pic.mode.width;
  // Read with the sender's tones as they were at this line (sstvSyncTone)
  const shift = pic.lineShift[y] !== undefined ? pic.lineShift[y] : pic.shift;
  for (let x = 0; x < pic.mode.width; x++)
  {
    const t = base + (x + 0.5) * pixel;
    out[x] = pixel >= 2 ? (sstvLevel(t - pixel / 4, shift) + sstvLevel(t, shift) + sstvLevel(t + pixel / 4, shift)) / 3 : sstvLevel(t, shift);
  }
  return out;
}

// Y, R-Y and B-Y (0 to 255, the differences about 128) of a row of the picture, kept for sstvPaint
function sstvYuvRow(pic, row, Y, V, U)
{
  const w = pic.mode.width, at = row * w;
  for (let x = 0; x < w; x++)
  {
    pic.Y[at + x] = Y[x];
    pic.U[at + x] = U[x];
    pic.V[at + x] = V[x];
  }
}

// The line a row is read from
function sstvRowLine(pic, row)
{
  return pic.mode.family == "pd" ? row >> 1 : row;
}

// Rows from .. to - 1 painted into rgba from the planes kept, the rows up to avail - 1 there to be read. On a line read with a longer
// window than SSTV_CLEAN_WINDOW, each color difference is the median of the 5 x 3 about it, then averaged with its neighbors either side
// (Robot, PD: their color comes at half resolution), or the median of the 3 x 3 (Martin, Scottie: theirs at full)
const SSTV_NEAR = new Float32Array(15);
const SSTV_CLEAN = [new Float32Array(800), new Float32Array(800)];

function sstvPaint(pic, from, to, avail)
{
  const w = pic.mode.width, rgba = pic.rgba;
  const wide = pic.mode.family == "gbr" ? 1 : 2;
  for (let row = from; row < to; row++)
  {
    const at = row * w;
    const clean = (pic.lineWindow[sstvRowLine(pic, row)] || 0) > SSTV_CLEAN_WINDOW;
    for (const [p, plane] of [[0, pic.U], [1, pic.V]])
    {
      const out = SSTV_CLEAN[p];
      for (let x = 0; x < w; x++)
      {
        if (!clean)
        {
          out[x] = plane[at + x];
          continue;
        }
        let n = 0;
        for (let dy = -1; dy <= 1; dy++)
        {
          const r = Math.max(0, Math.min(avail - 1, row + dy)) * w;
          for (let dx = -wide; dx <= wide; dx++)
          {
            // Insertion into the ones taken so far, kept in order
            const v = plane[r + Math.max(0, Math.min(w - 1, x + dx))];
            let k = n++;
            while (k > 0 && SSTV_NEAR[k - 1] > v)
            {
              SSTV_NEAR[k] = SSTV_NEAR[k - 1];
              k--;
            }
            SSTV_NEAR[k] = v;
          }
        }
        out[x] = SSTV_NEAR[n >> 1];
      }
      if (clean && wide == 2)
      {
        let before = out[0];
        for (let x = 0; x < w; x++)
        {
          const here = out[x];
          out[x] = (before + here + out[Math.min(w - 1, x + 1)]) / 3;
          before = here;
        }
      }
    }
    const U = SSTV_CLEAN[0], V = SSTV_CLEAN[1];
    for (let x = 0; x < w; x++)
    {
      const i = (at + x) * 4, y = pic.Y[at + x], v = V[x] - 128, u = U[x] - 128;
      rgba[i] = y + 1.402 * v;
      rgba[i + 1] = y - 0.344 * u - 0.714 * v;
      rgba[i + 2] = y + 1.772 * u;
      rgba[i + 3] = 255;
    }
  }
}

const SSTV_ROW = [new Float32Array(800), new Float32Array(800), new Float32Array(800), new Float32Array(800)];

// Line y read into the picture (its rows: two for PD, and for Robot 36 an odd line's pair); the first row it drew and how many
function sstvRender(pic, y)
{
  const mode = pic.mode, w = mode.width;
  const [c0, c1, c2, c3] = SSTV_ROW;
  pic.drawnAt[y] = sstvLineStart(pic, y);
  if (mode.family == "gbr")
  {
    sstvChannel(pic, y, 0, c0);
    sstvChannel(pic, y, 1, c1);
    sstvChannel(pic, y, 2, c2);
    // Green, blue and red kept as luminance and color differences (sstvPaint puts them back)
    const at = y * w;
    for (let x = 0; x < w; x++)
    {
      const r = c2[x], g = c0[x], b = c1[x], lum = 0.299 * r + 0.587 * g + 0.114 * b;
      pic.Y[at + x] = lum;
      pic.U[at + x] = 128 + (b - lum) / 1.772;
      pic.V[at + x] = 128 + (r - lum) / 1.402;
    }
    return [y, 1];
  }
  if (mode.family == "yuv")
  {
    sstvYuvRow(pic, y, sstvChannel(pic, y, 0, c0), sstvChannel(pic, y, 1, c1), sstvChannel(pic, y, 2, c2));
    return [y, 1];
  }
  if (mode.family == "pd")
  {
    sstvChannel(pic, y, 1, c1);
    sstvChannel(pic, y, 2, c2);
    sstvYuvRow(pic, 2 * y, sstvChannel(pic, y, 0, c0), c1, c2);
    sstvYuvRow(pic, 2 * y + 1, sstvChannel(pic, y, 3, c3), c1, c2);
    return [2 * y, 2];
  }
  // Robot 36: an even line keeps its color difference for the odd line after it, which draws both rows with its own: R-Y on the even
  // line and B-Y on the odd, or the other way round when the separators say so (pic.parity: sstvSeparator)
  const even = y % 2 == 0;
  const none = () => new Float32Array(w).fill(128);
  if (even)
  {
    pic.chroma = Float32Array.from(sstvChannel(pic, y, 1, c1).subarray(0, w));
    pic.evenY = Float32Array.from(sstvChannel(pic, y, 0, c0).subarray(0, w));
    // The last line of a picture that stops here: drawn with no other color difference
    if (y == pic.lines - 1) return pic.parity ? sstvR36Pair(pic, y, pic.evenY, null, none(), pic.chroma) : sstvR36Pair(pic, y, pic.evenY, null, pic.chroma, none());
    return [y, 0];
  }
  const kept = pic.chroma || none();
  const evenY = pic.evenY || sstvChannel(pic, y - 1, 0, new Float32Array(w));
  const oddY = sstvChannel(pic, y, 0, c0), own = sstvChannel(pic, y, 1, c1);
  return pic.parity ? sstvR36Pair(pic, y - 1, evenY, oddY, own, kept) : sstvR36Pair(pic, y - 1, evenY, oddY, kept, own);
}

function sstvR36Pair(pic, row, evenY, oddY, v, u)
{
  sstvYuvRow(pic, row, evenY, v, u);
  if (!oddY) return [row, 1];
  sstvYuvRow(pic, row + 1, oddY, v, u);
  return [row, 2];
}

// Robot 36's separator after line y's luminance (100 to 104.5 ms into it): 1500 Hz before R-Y, 2300 Hz before B-Y. Its middle's sync
// readings (a short window) vote whether the even lines carry R-Y as the mode says (pic.sepAgree) or B-Y (pic.sepDisagree; a picture
// started without its VIS code doesn't know which line it began on: sstvSyncStart); pic.parity changes when one side leads by
// SSTV_PARITY_LEAD votes, and the picture is drawn again with it
const SSTV_PARITY_LEAD = 6;

function sstvSeparator(pic, y)
{
  const smask = S.sync.length - 1, scale = sstvScale(pic), base = sstvLineStart(pic, y);
  const from = Math.round(base + 0.1013 * SSTV_EST_RATE * scale), to = Math.round(base + 0.1032 * SSTV_EST_RATE * scale);
  let n = 0;
  for (let i = from; i < to && n < SSTV_MEDIAN.length; i++) SSTV_MEDIAN[n++] = S.sync[i & smask];
  if (n < 5) return;
  const values = SSTV_MEDIAN.subarray(0, n).sort();
  const median = values[n >> 1];
  let near = 0;
  for (let i = 0; i < n; i++) if (Math.abs(values[i] - median) < 200) near++;
  const tone = median - pic.shift;
  if (near / n < 0.6 || Math.abs(tone - 1900) < 200) return;
  if ((tone < 1900) == (y % 2 == 0)) pic.sepAgree++;
  else pic.sepDisagree++;
  const parity = pic.parity ? (pic.sepAgree >= pic.sepDisagree + SSTV_PARITY_LEAD ? 0 : 1) : pic.sepDisagree >= pic.sepAgree + SSTV_PARITY_LEAD ? 1 : 0;
  if (parity != pic.parity)
  {
    pic.parity = parity;
    pic.reparity = true;
  }
}

// The rows lines 0 to y - 1 have drawn
function sstvRowsOf(pic, lines)
{
  if (pic.mode.family == "pd") return 2 * lines;
  if (pic.mode.family == "r36") return lines - (lines % 2);
  return lines;
}

// The lines whose readings are all in: each one's sync pulse measured (and the line rate with it), then drawn; the picture done after
// its last line, or once the signal is gone
function sstvLinesIn()
{
  const pic = S.pic;
  const margin = 4 * SSTV_MS;
  // A pulse is looked for up to its length past where it should end (sstvSyncEnd), and a little after
  const reach = Math.max(3 * SSTV_MS, pic.mode.sync * SSTV_EST_RATE) + 2 * SSTV_MS;
  while (pic.measured < pic.lines && pic.a + pic.b * pic.measured + reach + margin <= S.est)
  {
    const [at, clear] = sstvSyncEnd(pic, pic.measured);
    if (clear > 0.3)
    {
      pic.points.push([pic.measured, at, clear]);
      sstvFit(pic);
      // The sender's tones followed from the newest pulses' (a measurement far off is noise, not a drift)
      const tone = sstvSyncTone(pic, at);
      if (tone !== null && Math.abs(tone - pic.shift) < SSTV_FOLLOW_MAX)
      {
        pic.tones.push(tone);
        if (pic.tones.length > SSTV_FOLLOW_LINES) pic.tones.shift();
        if (pic.tones.length >= 3)
        {
          const sorted = pic.tones.slice().sort((p, q) => p - q);
          const step = (sorted[sorted.length >> 1] - pic.shift) * SSTV_FOLLOW_GAIN;
          pic.shift += Math.max(-SSTV_FOLLOW_STEP, Math.min(SSTV_FOLLOW_STEP, step));
        }
      }
    }
    pic.lineShift[pic.measured] = pic.shift;
    pic.lineWindow[pic.measured] = S.window;
    pic.measured++;
    // Started without its VIS code: over after SSTV_SYNC_LOST lines with no pulse, kept up to its last clear one (noise's stray pulses
    // after it left out too)
    if (pic.noVis)
    {
      pic.lost = clear > 0.3 ? 0 : pic.lost + 1;
      if (clear > 0.5) pic.lastClear = pic.measured;
      if (pic.lost >= SSTV_SYNC_LOST)
      {
        pic.lines = Math.max(0, Math.min(pic.measured - pic.lost, pic.lastClear + 1));
        break;
      }
    }
  }
  // (Started without its VIS code: drawn SSTV_SYNC_LOST lines behind, so the lines with no pulse at its end are never shown)
  const drawTo = Math.min(pic.lines, pic.noVis && pic.measured < pic.lines ? pic.measured - SSTV_SYNC_LOST : pic.measured);
  let from = -1, to = -1;
  while (pic.rendered < drawTo && sstvLineStart(pic, pic.rendered) + pic.period + margin <= S.est)
  {
    // (Robot 36: its separator's vote, now that the whole line has been read)
    if (pic.mode.family == "r36") sstvSeparator(pic, pic.rendered);
    const [row, count] = sstvRender(pic, pic.rendered);
    if (count > 0)
    {
      if (from < 0) from = row;
      to = row + count;
    }
    pic.rendered++;
  }
  if (from >= 0)
  {
    // The row before them painted again too: its color is cleaned with the rows below it, now in
    from = Math.max(0, from - 1);
    sstvPaint(pic, from, to, to);
    S.out({ type: "rows", id: pic.id, from, count: to - from, rgba: pic.rgba.slice(from * pic.mode.width * 4, to * pic.mode.width * 4) });
  }
  // A better line rate that moves the lines drawn by half a pixel or more: all of them drawn again (not more often than every 8 lines);
  // at once when Robot 36's color differences change places (sstvSeparator)
  if (pic.rendered - pic.redrawnAt >= 8 || pic.reparity)
  {
    const pixel = (pic.mode.channels[0][1] * SSTV_EST_RATE) / pic.mode.width;
    let moved = 0;
    for (let y = 0; y < pic.rendered; y++) moved = Math.max(moved, Math.abs(sstvLineStart(pic, y) - pic.drawnAt[y]));
    if (moved > pixel / 2 || pic.reparity)
    {
      sstvRedraw(pic, pic.rendered);
      const count = sstvRowsOf(pic, pic.rendered);
      S.out({ type: "redraw", id: pic.id, count, rgba: pic.rgba.slice(0, count * pic.mode.width * 4) });
    }
    pic.redrawnAt = pic.rendered;
    pic.reparity = false;
  }
  if (pic.rendered >= pic.lines || (pic.noVis && pic.measured >= pic.lines)) sstvFinish(!pic.noVis);
}

function sstvRedraw(pic, lines)
{
  pic.chroma = null;
  pic.evenY = null;
  for (let y = 0; y < lines; y++) sstvRender(pic, y);
  const rows = sstvRowsOf(pic, lines);
  sstvPaint(pic, 0, rows, rows);
}

// The picture as finally read: the line rate from all its sync pulses, every line drawn again with it (all of them kept)
function sstvFinish(complete)
{
  const pic = S.pic;
  S.pic = null;
  if (!pic) return;
  // Its pulses not looked at again by Start Without VIS
  S.quietFrom = S.est;
  // Started without its VIS code: every line up to its last pulse, also the ones not drawn yet (it is drawn behind: sstvLinesIn)
  if (pic.noVis) pic.rendered = Math.min(pic.lines, Math.max(pic.rendered, Math.min(pic.measured - pic.lost, pic.lastClear + 1)));
  if (pic.rendered > 0)
  {
    sstvFit(pic);
    sstvRedraw(pic, pic.rendered);
  }
  const count = sstvRowsOf(pic, pic.rendered);
  S.out({ type: "done", id: pic.id, count, complete, rgba: pic.rgba.slice(0, count * pic.mode.width * 4) });
}

sstvTables();

if (SSTV_IN_WORKER)
{
  onmessage = (event) =>
  {
    const data = event.data;
    if (data.type == "audio") sstvFeed(data.samples);
    else if (data.type == "reset") sstvReset();
    // Its settings (mmdSstv.js): Start Without VIS
    else if (data.type == "config")
    {
      S.noVis = data.noVis === true;
      S.syncSeen = null;
    }
  };
}

// Offline tests (Node): the same functions, with what it says sent where the test wants
if (typeof module != "undefined") module.exports = { S, SSTV_MODES, sstvFeed, sstvReset, SSTV_RATE };
