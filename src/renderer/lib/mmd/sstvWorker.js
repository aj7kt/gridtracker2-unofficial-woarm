// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Multi-Mode Decoder's SSTV mode (mmdSstv.js): pictures read from the 12 kHz audio the worklet sends (mmdWorklet.js, as it does for
// FT8), in a worker so the waterfall keeps drawing. Written from the published mode specifications (JL Barber, N7CXI, "Proposal for SSTV
// Mode Specifications", and the VIS code table), with ideas from slowrx by Oona Räisänen, OH2EIQ (ISC license; none of its code is used):
// each moment's frequency read from a short spectrum whose window grows as the signal weakens, and the line rate taken from the sync
// pulses (a sound card's clock a little off slants the picture; here it is measured as the lines come in, and the picture redrawn).
//
// In:  { type: "audio", samples (Float32Array at 12 kHz, one chunk after another) }, { type: "reset" } (the audio started again)
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
// rougher than a test signal, and the parity and a known mode's code still have to match
const SSTV_VIS_TOL = 100;
const SSTV_VIS_STEADY = 0.35;
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
  hann: {},
  cos: null,
  sin: null,
  visFrom: 0,     // the reading the VIS search goes on from
  pic: null,      // the picture being received
  nextId: 1,
  statusAt: 0
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
  S.window = 36;
  if (S.pic) sstvFinish(false);
  S.pic = null;
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
    return [f, f, f];
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
function sstvSnr()
{
  const mask = S.samples.length - 1;
  const first = S.count - SSTV_N;
  const shift = S.pic ? S.pic.shift : 0;
  const power = (lo, hi) =>
  {
    lo = Math.max(100, lo + shift);
    hi = Math.min(5500, hi + shift);
    let sum = 0;
    for (let k = Math.round(lo / SSTV_BIN_HZ); k <= Math.round(hi / SSTV_BIN_HZ); k++)
    {
      let re = 0, im = 0;
      for (let n = 0; n < SSTV_N; n += 2)
      {
        const x = S.samples[(first + n) & mask] * (0.5 - 0.5 * Math.cos((2 * Math.PI * n) / SSTV_N));
        const p = (2 * Math.PI * k * n) / SSTV_N;
        re += x * Math.cos(p);
        im += x * Math.sin(p);
      }
      sum += re * re + im * im;
    }
    return [sum, Math.round(hi / SSTV_BIN_HZ) - Math.round(lo / SSTV_BIN_HZ) + 1];
  };
  const [n1, c1] = power(400, 800), [n2, c2] = power(2700, 3400), [sv, cv] = power(SSTV_BLACK, SSTV_WHITE);
  const noise = (n1 + n2) / (c1 + c2) + 1e-20;
  const snr = 10 * Math.log10(Math.max(1e-6, sv - noise * cv) / (noise * cv));
  S.snr = Math.max(-20, snr);
  for (const [above, length] of SSTV_WINDOWS)
  {
    if (S.snr >= above)
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
  // A picture just begun: read again from its start, at the full rate and within its range
  if (sstvVisSearch()) sstvReadAll();
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
// every SSTV_IDLE_STEP, the ones between it the same
function sstvReadAll()
{
  const fmask = S.freq.length - 1;
  while (S.est * SSTV_STEP + 129 <= S.count)
  {
    const i = S.est & fmask;
    if (!S.pic && S.est % SSTV_IDLE_STEP != 0)
    {
      const before = (S.est - 1) & fmask;
      S.freq[i] = S.freq[before];
      S.wide[i] = S.wide[before];
      S.sync[i] = S.sync[before];
    }
    else [S.freq[i], S.wide[i], S.sync[i]] = sstvRead(S.est * SSTV_STEP, S.pic);
    S.est++;
  }
}

// ---- The VIS code: 1900 Hz for 300 ms (with a 10 ms break at 1200 Hz in it), the start bit (1200 Hz, 30 ms), 7 bits low bit first and an
// even parity bit (each 30 ms: 1100 Hz a one, 1300 Hz a zero), the stop bit (1200 Hz, 30 ms). The leader's frequency gives how far off
// the sender is tuned (shift), which every tone after it is read with

const SSTV_MS = SSTV_EST_RATE / 1000;

// The readings (over all a VIS code uses) from a to b (reading indexes; their middle, the edges left out; one a millisecond): their
// median, and the share of them within SSTV_VIS_TOL of it. Noise read as some other frequency anywhere in the passband moves neither
const SSTV_MEDIAN = new Float32Array(400);

function sstvMedian(a, b)
{
  const fmask = S.wide.length - 1;
  const from = Math.round(a + (b - a) * 0.15), to = Math.round(b - (b - a) * 0.15);
  let n = 0;
  for (let i = from; i < to && n < SSTV_MEDIAN.length; i += SSTV_IDLE_STEP) SSTV_MEDIAN[n++] = S.wide[i & fmask];
  if (n == 0) return [0, 0];
  const values = SSTV_MEDIAN.subarray(0, n).sort();
  const median = values[n >> 1];
  let near = 0;
  for (let i = 0; i < n; i++) if (Math.abs(values[i] - median) < SSTV_VIS_TOL) near++;
  return [median, near / n];
}

// A VIS code starting (its start bit) at reading t: { code, shift, error } or null. Its leader must be most of its readings
function sstvVisAt(t)
{
  const ms = SSTV_MS;
  const [leader, steady] = sstvMedian(t - 250 * ms, t - 30 * ms);
  const shift = leader - SSTV_LEADER;
  if (Math.abs(shift) > SSTV_SHIFT_MAX || steady < SSTV_VIS_STEADY) return null;
  let error = 0;
  const tone = (from, to, hz) =>
  {
    const [m] = sstvMedian(t + from * ms, t + to * ms);
    const e = Math.abs(m - shift - hz);
    error += e;
    return e < SSTV_VIS_TOL;
  };
  if (!tone(0, 30, SSTV_SYNC) || !tone(270, 300, SSTV_SYNC)) return null;
  let code = 0, ones = 0;
  for (let bit = 0; bit < 8; bit++)
  {
    const [m] = sstvMedian(t + (30 + 30 * bit) * ms, t + (60 + 30 * bit) * ms);
    const one = Math.abs(m - shift - 1100), zero = Math.abs(m - shift - 1300);
    if (Math.min(one, zero) >= SSTV_VIS_TOL) return null;
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

// The readings not searched yet that have 300 ms after them: each start (1 ms apart) tried; of a run of starts that all read the same
// code, the one read best. True when a picture has begun
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
    const v = sstvVisAt(t);
    if (v && (!best || v.code == best.code))
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

// ---- A picture's lines

function sstvStart(mode, at, shift)
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
    lines: sstvLines(mode),
    // The line rate and where line 0's sync pulse ends (readings): as the mode says, until the pulses are measured
    a: start + mode.syncEnd * SSTV_EST_RATE, b: period, nominal: period,
    points: [],       // sync pulses measured: [line, where it ends, how clearly]
    measured: 0,      // the lines whose pulse has been looked for
    rendered: 0,      // the lines drawn
    drawnAt: [],      // the start each drawn line was read from (to tell when a better rate moves them)
    redrawnAt: 0,
    rgba: new Uint8ClampedArray(mode.width * mode.height * 4),
    chroma: null      // Robot 36: the even line's R-Y, for the odd line after it
  };
  // Read again from just before it starts (the samples are still kept): at the full rate, within its range
  const back = Math.floor(at - 10 * SSTV_MS);
  if (back * SSTV_STEP - 129 > S.count - S.samples.length) S.est = Math.min(S.est, back);
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
// (BirdWatch retunes in steps), moves it line by line, and the picture's levels and the next pulses are read with it
const SSTV_FOLLOW_MAX = 200;
const SSTV_FOLLOW_GAIN = 0.5;

function sstvSyncTone(pic, at)
{
  const smask = S.sync.length - 1;
  const length = Math.round(pic.mode.sync * SSTV_EST_RATE);
  const from = Math.round(at - length * 0.85), to = Math.round(at - length * 0.15);
  let n = 0;
  for (let i = from; i < to && n < SSTV_MEDIAN.length; i++) SSTV_MEDIAN[n++] = S.sync[i & smask];
  if (n < 5) return null;
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

// Y, R-Y and B-Y (0 to 255, the differences about 128) to a row of the picture
function sstvYuvRow(pic, row, Y, V, U)
{
  const w = pic.mode.width, rgba = pic.rgba;
  for (let x = 0; x < w; x++)
  {
    const i = (row * w + x) * 4, v = V[x] - 128, u = U[x] - 128;
    rgba[i] = Y[x] + 1.402 * v;
    rgba[i + 1] = Y[x] - 0.344 * u - 0.714 * v;
    rgba[i + 2] = Y[x] + 1.772 * u;
    rgba[i + 3] = 255;
  }
}

const SSTV_ROW = [new Float32Array(800), new Float32Array(800), new Float32Array(800), new Float32Array(800)];

// Line y read into the picture (its rows: two for PD, and for Robot 36 an odd line's pair); the first row it drew and how many
function sstvRender(pic, y)
{
  const mode = pic.mode, w = mode.width, rgba = pic.rgba;
  const [c0, c1, c2, c3] = SSTV_ROW;
  pic.drawnAt[y] = sstvLineStart(pic, y);
  if (mode.family == "gbr")
  {
    sstvChannel(pic, y, 0, c0);
    sstvChannel(pic, y, 1, c1);
    sstvChannel(pic, y, 2, c2);
    for (let x = 0; x < w; x++)
    {
      const i = (y * w + x) * 4;
      rgba[i] = c2[x];
      rgba[i + 1] = c0[x];
      rgba[i + 2] = c1[x];
      rgba[i + 3] = 255;
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
  // Robot 36: an even line keeps its R-Y for the odd line after it, which draws both rows with its B-Y
  const even = y % 2 == 0;
  if (even)
  {
    pic.chroma = Float32Array.from(sstvChannel(pic, y, 1, c1).subarray(0, w));
    pic.evenY = Float32Array.from(sstvChannel(pic, y, 0, c0).subarray(0, w));
    // The last line of a picture that stops here: drawn with no B-Y
    if (y == pic.lines - 1) return sstvR36Pair(pic, y, pic.evenY, null, pic.chroma, new Float32Array(w).fill(128));
    return [y, 0];
  }
  const v = pic.chroma || new Float32Array(w).fill(128);
  const evenY = pic.evenY || sstvChannel(pic, y - 1, 0, new Float32Array(w));
  return sstvR36Pair(pic, y - 1, evenY, sstvChannel(pic, y, 0, c0), v, sstvChannel(pic, y, 1, c1));
}

function sstvR36Pair(pic, row, evenY, oddY, v, u)
{
  sstvYuvRow(pic, row, evenY, v, u);
  if (!oddY) return [row, 1];
  sstvYuvRow(pic, row + 1, oddY, v, u);
  return [row, 2];
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
      // The sender's tones followed from this pulse's (a measurement far off is noise, not a drift)
      const tone = sstvSyncTone(pic, at);
      if (tone !== null && Math.abs(tone - pic.shift) < SSTV_FOLLOW_MAX) pic.shift += (tone - pic.shift) * SSTV_FOLLOW_GAIN;
    }
    pic.lineShift[pic.measured] = pic.shift;
    pic.measured++;
  }
  let from = -1, to = -1;
  while (pic.rendered < pic.measured && sstvLineStart(pic, pic.rendered) + pic.period + margin <= S.est)
  {
    const [row, count] = sstvRender(pic, pic.rendered);
    if (count > 0)
    {
      if (from < 0) from = row;
      to = row + count;
    }
    pic.rendered++;
  }
  if (from >= 0) S.out({ type: "rows", id: pic.id, from, count: to - from, rgba: pic.rgba.slice(from * pic.mode.width * 4, to * pic.mode.width * 4) });
  // A better line rate that moves the lines drawn by half a pixel or more: all of them drawn again (not more often than every 8 lines)
  if (pic.rendered - pic.redrawnAt >= 8)
  {
    const pixel = (pic.mode.channels[0][1] * SSTV_EST_RATE) / pic.mode.width;
    let moved = 0;
    for (let y = 0; y < pic.rendered; y++) moved = Math.max(moved, Math.abs(sstvLineStart(pic, y) - pic.drawnAt[y]));
    if (moved > pixel / 2)
    {
      sstvRedraw(pic, pic.rendered);
      const count = sstvRowsOf(pic, pic.rendered);
      S.out({ type: "redraw", id: pic.id, count, rgba: pic.rgba.slice(0, count * pic.mode.width * 4) });
    }
    pic.redrawnAt = pic.rendered;
  }
  if (pic.rendered >= pic.lines) sstvFinish(true);
}

function sstvRedraw(pic, lines)
{
  pic.chroma = null;
  pic.evenY = null;
  for (let y = 0; y < lines; y++) sstvRender(pic, y);
}

// The picture as finally read: the line rate from all its sync pulses, every line drawn again with it (all of them kept)
function sstvFinish(complete)
{
  const pic = S.pic;
  S.pic = null;
  if (!pic) return;
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
  };
}

// Offline tests (Node): the same functions, with what it says sent where the test wants
if (typeof module != "undefined") module.exports = { S, SSTV_MODES, sstvFeed, sstvReset, SSTV_RATE };
