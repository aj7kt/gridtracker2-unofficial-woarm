// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Multi-Mode Decoder's weather fax mode (HF radiofax, WEFAX): charts read from the input's audio, in a worker so the waterfall keeps
// drawing. Written from the published characteristics of meteorological analogue facsimile (WMO Manual on the Global Telecommunication
// System, WMO-No. 386, Vol. I Part III: frequency modulation, black 1500 Hz and white 2300 Hz with the receiver in USB 1.9 kHz below the
// assigned frequency; index of cooperation 576 or 288; 60, 90, 120 or 240 lines a minute; the start signal, black and white keyed at
// 300 Hz for IOC 576 or 675 Hz for IOC 288 for about 5 s; the phasing signal, a black line with a white pulse of 5% of it, about 30 s;
// the stop signal, black and white keyed at 450 Hz for about 5 s, then black), as the broadcasters publish them (NOAA's Worldwide Marine
// Radiofacsimile Broadcast Schedules, the Australian Bureau of Meteorology's technical characteristics of its HF fax transmissions).
// No other decoder's code is used.
//
// The audio is mixed down from 1900 Hz to a complex signal about 6000 samples a second, and its frequency read from one sample to the
// next. The start tone gives the index of cooperation and how far off the receiver is tuned (its mean is the center frequency); the
// phasing lines, folded over each line rate, give the line rate and where each line starts, then each one's white pulse is measured and
// the line rate fitted through them (a sound card's clock a few tens of ppm off slants the chart); the chart's lines follow at that rate
// until the stop tone. Tuned in partway through a chart, "start now" looks for phasing lines in what comes next, and runs on at the
// line rate chosen if there are none.
//
// In:  { type: "init", rate } (the audio's sample rate; 12000 until told), { type: "audio", samples (Float32Array, one chunk after
//      another) }, { type: "reset" } (the audio started again), { type: "stop" } (the chart being received ended here),
//      { type: "config", lpm (60, 90, 120, 240 or "auto"), ioc (576, 288 or "auto"), startNow (true: begin a chart now, without a start
//      tone), trim (ppm: the line rate made this much slower, positive, or faster), align (0 to 1: the chart moved left by this share of
//      a line, for a chart tuned in partway), track (false: the chart's lines not followed, see wefaxTrackRow; true unless told) }
//      (each optional)
// Out: { type: "start", id, ioc, lpm, width, offsetHz, ppm (the line rate measured, see status), tone (a start tone was heard), phasing
//      (its phasing lines were found) }
//      { type: "rows", id, from, count, pixels }  rows from .. from + count - 1 (Uint8Array, width * count, 0 black to 255 white)
//      { type: "redraw", id, count, pixels }      its first count rows again (the trim or alignment changed)
//      { type: "done", id, count, complete, pixels }  the chart as finally read, count rows (complete: its stop tone was heard)
//      { type: "status", state ("idle", "start", "phasing" or "receiving"), snr (dB), id, line, ioc, lpm, offsetHz, ppm }  twice a second
//      (ppm: the sender's line rate measured against the one it should have)

// The rate the audio is read at (samples a second, near this: the input's rate divided by a whole number)
const WEFAX_WORK_RATE = 6000;
// The low pass before it: a Blackman windowed sinc this many taps for each sample the rate is divided by, half power 1100 Hz either side
// of the center (the tones, a receiver up to WEFAX_SHIFT_MAX off, and most of a chart's finest detail; wider lets in more noise, and a
// weak signal's frequency is read worse for it)
const WEFAX_TAPS = 16;
const WEFAX_CUTOFF = 1100;
// Black, white and the center (Hz); how far off the receiver may be tuned (Hz)
const WEFAX_BLACK = 1500;
const WEFAX_WHITE = 2300;
const WEFAX_CENTER = 1900;
const WEFAX_SHIFT_MAX = 300;
// Each frequency read is kept within this of the center (Hz): black or white that far off still reads, and the clicks noise makes in a
// weak signal's frequency (a turn of the phase in a sample or two) count for little
const WEFAX_CLIP = 800;
// The line rates (lines a minute) and the one taken when none is told or found
const WEFAX_LPMS = [60, 90, 120, 240];
const WEFAX_LPM_DEFAULT = 120;
// The start tones by index of cooperation, and the stop tone (Hz: black and white keyed at this rate)
const WEFAX_START_TONES = { 576: 300, 288: 675 };
const WEFAX_STOP_TONE = 450;
const WEFAX_KEYED = [300, 675, 450];
// The tones are looked for in blocks of this many seconds: one is heard in a block when its keying rate holds this share of the
// frequency's variance, its swing between these shares of what black to white gives it (a square wave's 4 / pi of 400 Hz), and the
// block's mean within WEFAX_TONE_SHIFT of the center. On the air a tone reads far less clean than that: black and white keyed every
// 1.7 ms overlap in the low pass, the stronger of the two (as the signal fades) pulling the frequency read its way, so its swing reads
// a third to a half of the full one and its mean wanders hundreds of Hz (a loud NMC start tone: share 0.2 to 0.35, swing 150 to 300 Hz,
// mean 1540 to 2150 Hz). A chart's own lines and phasing never put more than 0.03 at any keying rate
const WEFAX_BLOCK = 0.25;
const WEFAX_TONE_SHARE = 0.15;
const WEFAX_TONE_AMP_MIN = 0.24;
const WEFAX_TONE_AMP_MAX = 1.45;
const WEFAX_TONE_SHIFT = 450;
// The start tone's means give the receiver's tuning only when they agree within this (Hz, their interquartile range); otherwise the
// phasing lines give it (wefaxPhasingTuning)
const WEFAX_TONE_AGREE = 100;
// A start tone: in 6 of the newest 8 blocks; the stop tone: 4 of the newest 6. A block with more than this share of its frequencies read
// beyond WEFAX_CLIP is noise (noise alone through the low pass puts about 0.22 there, a chart at 0 dB signal to noise 0.15 at most);
// this many seconds of them in a row end a chart (a chart takes 10 minutes or more: one begun is waited on through a long fade, and
// the noisy rows at its end are left out when it does end)
const WEFAX_NOISE_SHARE = 0.17;
const WEFAX_LOST = 120;
// The phasing lines: their white pulse's share of a line, the bins a line is folded into, how clear the pulse must stand out of them
// (0 to 1, black to white), the seconds looked at before deciding, and how long they are looked for after a start tone (s) or a start now
const WEFAX_PULSE = 0.05;
const WEFAX_BINS = 200;
const WEFAX_PHASE_SCORE = 0.35;
const WEFAX_SEARCH = 4;
const WEFAX_SEARCH_TONE = 15;
const WEFAX_SEARCH_NOW = 6;
// A chart begun from its phasing lines alone, while idle (its start tone too garbled on the air to be heard: a loud NMC one read 0.03 to
// 0.1 at 300 Hz, its phasing after it clean): the newest this many seconds looked at every second, and taken for phasing when at least
// this share of the lines in them (and this many) are a phasing line's, black with a clear white pulse where the fold put it
const WEFAX_IDLE_SPAN = 6;
const WEFAX_IDLE_SHARE = 0.7;
const WEFAX_IDLE_LINES = 6;
// The line rate is measured within this share of what it should be, from phasing pulses at least this many lines apart
const WEFAX_RATE_TOL = 0.001;
const WEFAX_FIT_SPAN = 10;
// A chart's line rate from its phasing is trusted with at least this many pulses, this many lines apart, lying this close (samples, their
// RMS) to the line through them; a trusted one is kept (WF.knownRate: the sound card's clock doesn't change from one chart to the next) and
// a chart whose phasing was too noisy to trust takes it (static: 12 pulses scattered 4 samples gave 188 ppm against 10 to 13 on the
// charts around it, and the chart leaned)
const WEFAX_RATE_PULSES = 20;
const WEFAX_RATE_SPAN = 20;
const WEFAX_RATE_RMS = 2;
// The most lines a chart has (25 minutes at 120 lines a minute); the frequencies kept (a ring, 23 minutes at 6000 a second)
const WEFAX_MAX_LINES = 3000;
const WEFAX_RING = 1 << 23;
// Following the chart's lines (wefaxTrackRow): each row's edges are its levels less the mean of this many pixels either side (the
// edges of a solid black area, black to white over all of it, count the most, then thin lines); the first rows of a chart make the
// reference, and each row lined up with it then goes into it at 1 / WEFAX_TRACK_MEMORY
const WEFAX_TRACK_EDGE = 8;
const WEFAX_TRACK_FIRST = 2;
const WEFAX_TRACK_MEMORY = 24;
// A row is measured when it matches the reference at least this well near where it's expected (within this many steps of the coarse
// correlation, about 1.8 pixels each) and not clearly better anywhere else. How well: the correlation there against the spread of it
// at every shift (the best of a row that matches nowhere is about 3.5)
const WEFAX_TRACK_MATCH = 5;
const WEFAX_TRACK_NEAR = 2;
// A step (samples dropped or added): rows matching at least this well, by this much more than near where they're expected, and this
// many in a row (at most two rows between them) agreeing within this many pixels on where
const WEFAX_TRACK_STEP = 3.5;
const WEFAX_TRACK_BETTER = 2;
const WEFAX_TRACK_ROWS = 3;
const WEFAX_TRACK_AGREE = 3;
// (and matching this well summed over them: a step that's harder to see waits for more rows, up to WEFAX_TRACK_ROWS_MOST)
const WEFAX_TRACK_STEPS = 16;
const WEFAX_TRACK_ROWS_MOST = 6;
// Where the next row starts: a line fitted through the newest this many rows' measurements (at least 4, over 4 rows, for its slope:
// a clock's error, followed within WEFAX_TRACK_PPM; a sound card dropping or doubling blocks of samples now and then is taken as the
// steps it is); moved only when that is more than WEFAX_TRACK_HOLD samples from where it is, so a clean chart is read just as it would
// be untracked
const WEFAX_TRACK_FIT = 60;
const WEFAX_TRACK_PPM = 300;
const WEFAX_TRACK_HOLD = 0.4;
// A chart's own left edge on its lines (stations place a chart partway across the line, its right side then showing at the left): found
// the way the eye finds it, every WEFAX_ALIGN_EVERY of the chart's rows and as it ends. Each column's ink (the share of its rows whose
// pixel is darker than WEFAX_ALIGN_DARK along with the one above or below it, smoothed over WEFAX_ALIGN_SMOOTH pixels either side); the
// widest band of quiet columns (circularly) is the paper between the chart's right and left edges, taken when it's at least
// WEFAX_ALIGN_MIN of a line wide, WEFAX_ALIGN_LEAD times the next widest, blank in each third of the chart's height, and the chart's ink
// stands out from its paper (its median column at least WEFAX_ALIGN_CONTRAST above its quietest fifth, as a share). Otherwise (static all
// across a chart, a chart of numbers filling it, a chart lying on a diagonal) it's left as it is. The lines then start WEFAX_ALIGN_MARGIN
// of a line (at most half the band) before the band's end; moved only by WEFAX_ALIGN_MOVE of a line or more. Tried on NMC's charts of
// 2026-11-11: lined up the four with a clear band, left the five without one alone
const WEFAX_ALIGN_EVERY = 150;
const WEFAX_ALIGN_ROWS = 60;
const WEFAX_ALIGN_DARK = 128;
const WEFAX_ALIGN_SMOOTH = 9;
const WEFAX_ALIGN_MIN = 0.03;
const WEFAX_ALIGN_LEAD = 1.8;
const WEFAX_ALIGN_CONTRAST = 0.25;
const WEFAX_ALIGN_MARGIN = 0.02;
const WEFAX_ALIGN_MOVE = 0.01;
// A step (not a line-start marker's) at most this share of a line: a sound card's dropped or doubled block of samples moves the chart a
// few tens of pixels; a chart with the same thing repeated across it (NMC's sea state charts: rows of wave arrows every few tens of
// pixels) matches as well at many shifts, and took false steps of hundreds of pixels, and slopes of hundreds of ppm, with 2500 ppm and
// no limit (the phasing lines measure the line rate well; untracked the same chart stayed straight)
const WEFAX_TRACK_STEP_MAX = 0.04;
// No row measured in this many: a new reference begun from the rows coming in (the chart has changed too much to match the old one)
const WEFAX_TRACK_STALE = 40;
// The line-start marker some stations send (KVM70 Honolulu: a solid black run about 3.3% of each line, the chart beginning after it):
// a run of levels below WEFAX_TRACK_BLACK 2.5% to 4.5% of a line wide, taken as the chart's line start once WEFAX_TRACK_MARK_AGREE of
// the newest WEFAX_TRACK_MARK_ROWS rows have one in the same place (and at least WEFAX_TRACK_MARK_SEEN have one anywhere). Then each
// row's marker counts as a measurement this much stronger than a match of the chart's lines does
const WEFAX_TRACK_BLACK = 96;
const WEFAX_TRACK_MARK_ROWS = 30;
const WEFAX_TRACK_MARK_SEEN = 20;
const WEFAX_TRACK_MARK_AGREE = 18;
const WEFAX_TRACK_MARK_WEIGHT = 20;

// ---- The state

// Running as the worker (not loaded for an offline test)
const WEFAX_IN_WORKER = typeof WorkerGlobalScope != "undefined" && self instanceof WorkerGlobalScope;

const WF = {
  out: WEFAX_IN_WORKER ? (message, transfer) => postMessage(message, transfer || []) : null,
  rate: 0,        // the input's rate
  down: 1,        // divided by this
  work: 0,        // to this (samples a second)
  h: null,        // the low pass
  xr: null,       // the newest samples mixed down (a ring)
  xi: null,
  inCount: 0,     // samples ever had
  oc: 1,          // the 1900 Hz oscillator, and its step
  os: 0,
  stepC: 1,
  stepS: 0,
  zr: 0,          // the last sample mixed down and filtered
  zi: 0,
  power: 0,       // its mean power, slowly
  lastHz: WEFAX_CENTER,
  freq: new Int16Array(WEFAX_RING), // each sample's frequency less the center, in quarters of a Hz (a ring)
  n: 0,           // frequencies ever read
  block: null,    // the tone block being summed
  blocks: [],     // the newest blocks: { kind (the keying rate heard, 0 none), mean (Hz), start, noisy }
  state: "idle",  // idle, start (a start tone), search (phasing looked for), track (phasing lines measured), image
  tone: 0,        // the start tone heard (Hz), its means, where it began and how many blocks since it stopped
  toneMeans: [],
  toneFrom: 0,
  toneEnd: 0,
  toneMiss: 0,
  toneHeard: false,
  ioc: 576,
  lpm: WEFAX_LPM_DEFAULT,
  offset: 0,      // how far off the receiver is tuned (Hz)
  searchFrom: 0,  // phasing looked for from here (a frequency's index)
  searchAt: 0,
  manual: false,  // begun by start now
  byPhasing: false, // begun by phasing lines seen while idle (no start tone heard): back to idle if no chart follows them
  idleAt: 0,      // when phasing was last looked for while idle (a frequency's index)
  model: null,    // the line rate: { a (where line 0 starts), b (a line, in samples), nominal, points, measured, hits, misses, firstMiss }
  knownRate: 0,   // the line rate a chart's clean phasing measured, against nominal (1.000013: 13 ppm slow); 0 none yet (wefaxRateCheck)
  pic: null,      // the chart being received
  noisyRun: 0,
  noisyFrom: 0,
  config: { lpm: "auto", ioc: "auto", trim: 0, align: 0, track: true },
  z: { re: new Float32Array(256), im: new Float32Array(256) }, // the newest samples mixed down, for the signal to noise ratio
  snr: -20,
  nextId: 1,
  statusAt: 0
};

function wefaxInit(rate)
{
  WF.rate = rate > 0 ? rate : 12000;
  WF.down = Math.max(1, Math.round(WF.rate / WEFAX_WORK_RATE));
  WF.work = WF.rate / WF.down;
  const taps = WEFAX_TAPS * WF.down;
  WF.h = new Float32Array(taps);
  const fc = WEFAX_CUTOFF / WF.rate;
  let sum = 0;
  for (let k = 0; k < taps; k++)
  {
    const m = k - (taps - 1) / 2;
    const sinc = m == 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * m) / (Math.PI * m);
    const window = 0.42 - 0.5 * Math.cos((2 * Math.PI * k) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * k) / (taps - 1));
    WF.h[k] = sinc * window;
    sum += WF.h[k];
  }
  for (let k = 0; k < taps; k++) WF.h[k] /= sum;
  let size = 1;
  while (size < taps) size <<= 1;
  WF.xr = new Float32Array(size);
  WF.xi = new Float32Array(size);
  WF.stepC = Math.cos((2 * Math.PI * WEFAX_CENTER) / WF.rate);
  WF.stepS = Math.sin((2 * Math.PI * WEFAX_CENTER) / WF.rate);
  // The tone blocks: each keying rate's cosine and sine over a block, and their sums (to take the block's mean out of what it reads)
  const length = Math.round(WEFAX_BLOCK * WF.work);
  WF.blockTables = WEFAX_KEYED.map((hz) =>
  {
    const c = new Float32Array(length), s = new Float32Array(length);
    let gc = 0, gs = 0;
    for (let i = 0; i < length; i++)
    {
      c[i] = Math.cos((2 * Math.PI * hz * i) / WF.work);
      s[i] = Math.sin((2 * Math.PI * hz * i) / WF.work);
      gc += c[i];
      gs += s[i];
    }
    return { c, s, gc, gs };
  });
  WF.blockLength = length;
  // (another input rate: the line rate measured at the old one no guide)
  WF.knownRate = 0;
  wefaxReset();
}

function wefaxReset()
{
  if (WF.pic) wefaxFinish(false);
  WF.pic = null;
  WF.inCount = 0;
  WF.oc = 1;
  WF.os = 0;
  WF.zr = 0;
  WF.zi = 0;
  WF.power = 0;
  WF.lastHz = WEFAX_CENTER;
  WF.n = 0;
  WF.blocks = [];
  WF.block = wefaxNewBlock(0);
  WF.state = "idle";
  WF.model = null;
  WF.manual = false;
  WF.byPhasing = false;
  WF.idleAt = 0;
  WF.toneHeard = false;
  WF.offset = 0;
  WF.noisyRun = 0;
  WF.snr = -20;
  if (WF.xr)
  {
    WF.xr.fill(0);
    WF.xi.fill(0);
  }
}

function wefaxNewBlock(start)
{
  return { start, count: 0, wild: 0, sum: 0, squares: 0, re: [0, 0, 0], im: [0, 0, 0] };
}

// ---- Reading the frequency

// Samples in: each mixed down from 1900 Hz, every down-th filtered and its frequency read (the phase turned since the last one; a sample
// far weaker than the signal's mean, where noise turns the phase anywhere, keeps the last frequency), kept, and summed into the tone block
function wefaxFeed(samples)
{
  if (!WF.h) wefaxInit(12000);
  const h = WF.h, taps = h.length, xr = WF.xr, xi = WF.xi, mask = xr.length - 1;
  const hzPerRadian = WF.work / (2 * Math.PI), slow = 1 / (0.2 * WF.work);
  const fmask = WF.freq.length - 1;
  for (let i = 0; i < samples.length; i++)
  {
    const x = samples[i];
    const at = WF.inCount & mask;
    xr[at] = x * WF.oc;
    xi[at] = -x * WF.os;
    const c = WF.oc * WF.stepC - WF.os * WF.stepS;
    WF.os = WF.os * WF.stepC + WF.oc * WF.stepS;
    WF.oc = c;
    WF.inCount++;
    // The oscillator kept at one (its rounding would drift)
    if ((WF.inCount & 4095) == 0)
    {
      const g = 1 / Math.sqrt(WF.oc * WF.oc + WF.os * WF.os);
      WF.oc *= g;
      WF.os *= g;
    }
    if (WF.inCount % WF.down != 0) continue;
    let re = 0, im = 0;
    for (let k = 0, j = WF.inCount - 1; k < taps; k++, j--)
    {
      re += h[k] * xr[j & mask];
      im += h[k] * xi[j & mask];
    }
    const dr = re * WF.zr + im * WF.zi, di = im * WF.zr - re * WF.zi;
    WF.zr = re;
    WF.zi = im;
    const p = re * re + im * im;
    WF.power += (p - WF.power) * slow;
    let hz = WF.lastHz, wild = false;
    if (p > 0.02 * WF.power)
    {
      hz = WEFAX_CENTER + Math.atan2(di, dr) * hzPerRadian;
      wild = Math.abs(hz - WEFAX_CENTER) > WEFAX_CLIP;
      hz = Math.max(WEFAX_CENTER - WEFAX_CLIP, Math.min(WEFAX_CENTER + WEFAX_CLIP, hz));
    }
    WF.lastHz = hz;
    WF.freq[WF.n & fmask] = Math.max(-32767, Math.min(32767, Math.round((hz - WEFAX_CENTER) * 4)));
    WF.z.re[WF.n & 255] = re;
    WF.z.im[WF.n & 255] = im;
    WF.n++;
    if ((WF.n & 1023) == 0) wefaxSnr();
    wefaxBlockAdd(hz, wild);
  }
  wefaxLinesIn();
  const now = Date.now();
  if (now - WF.statusAt > 500)
  {
    WF.statusAt = now;
    const pic = WF.pic, m = WF.model;
    const state = WF.state == "idle" ? "idle" : WF.state == "start" ? "start" : WF.state == "image" ? "receiving" : "phasing";
    WF.out({ type: "status", state, snr: Math.round(WF.snr), id: pic ? pic.id : 0, line: pic ? pic.rendered : 0, ioc: WF.ioc, lpm: WF.lpm, offsetHz: Math.round(WF.offset), ppm: m ? Math.round((m.b / m.nominal - 1) * 1e6) : 0 });
  }
}

// The frequency (Hz, the receiver's tuning taken out) at index t (between two, the line between them)
function wefaxHz(t)
{
  const fmask = WF.freq.length - 1;
  const i = Math.floor(t), frac = t - i;
  return WEFAX_CENTER + (WF.freq[i & fmask] * (1 - frac) + WF.freq[(i + 1) & fmask] * frac) / 4 - WF.offset;
}

// The level at t: 0 black, 1 white (a little past either kept, so noise read far off counts for no more than that)
function wefaxLevel(t)
{
  return Math.max(-0.5, Math.min(1.5, (wefaxHz(t) - WEFAX_BLACK) / (WEFAX_WHITE - WEFAX_BLACK)));
}

// The signal to noise ratio (dB) from the newest 256 samples mixed down: the power within 450 Hz of the center against the noise between
// 600 and 1100 Hz (within a receiver's passband), in the same width
const WEFAX_SNR_COS = new Float32Array(256);
const WEFAX_SNR_SIN = new Float32Array(256);
const WEFAX_SNR_RE = new Float32Array(128);
const WEFAX_SNR_IM = new Float32Array(128);
for (let n = 0; n < 256; n++)
{
  WEFAX_SNR_COS[n] = Math.cos((2 * Math.PI * n) / 256);
  WEFAX_SNR_SIN[n] = -Math.sin((2 * Math.PI * n) / 256);
}

function wefaxSnr()
{
  const N = 256, start = WF.n;
  const binHz = WF.work / N;
  // Every other sample, with a Hann window
  for (let j = 0; j < 128; j++)
  {
    const w = 0.5 - 0.5 * WEFAX_SNR_COS[2 * j];
    WEFAX_SNR_RE[j] = WF.z.re[(start + 2 * j) & 255] * w;
    WEFAX_SNR_IM[j] = WF.z.im[(start + 2 * j) & 255] * w;
  }
  const power = (lo, hi) =>
  {
    let sum = 0, bins = 0;
    for (let k = Math.round(lo / binHz); k <= Math.round(hi / binHz); k++, bins++)
    {
      let sr = 0, si = 0;
      for (let j = 0; j < 128; j++)
      {
        const p = (k * 2 * j) & 255, c = WEFAX_SNR_COS[p], s = WEFAX_SNR_SIN[p], a = WEFAX_SNR_RE[j], b = WEFAX_SNR_IM[j];
        sr += a * c - b * s;
        si += a * s + b * c;
      }
      sum += sr * sr + si * si;
    }
    return [sum, bins];
  };
  const shift = WF.offset;
  const [sv, cv] = power(-450 + shift, 450 + shift), [nv, cn] = power(600 - WEFAX_CENTER, 1100 - WEFAX_CENTER);
  const noise = nv / cn + 1e-20;
  const snr = 10 * Math.log10(Math.max(1e-6, sv - noise * cv) / (noise * cv));
  WF.snr += (Math.max(-20, snr) - WF.snr) * 0.3;
}

// ---- The tones: each block's frequencies summed, then each keying rate's share of how they vary, and the block's mean

function wefaxBlockAdd(hz, wild)
{
  const b = WF.block, i = b.count, tables = WF.blockTables;
  if (wild) b.wild++;
  b.sum += hz;
  b.squares += hz * hz;
  for (let k = 0; k < tables.length; k++)
  {
    b.re[k] += hz * tables[k].c[i];
    b.im[k] += hz * tables[k].s[i];
  }
  b.count++;
  if (b.count < WF.blockLength) return;
  const N = b.count, mean = b.sum / N, variance = Math.max(1, b.squares / N - mean * mean);
  const swing = (4 / Math.PI) * ((WEFAX_WHITE - WEFAX_BLACK) / 2);
  let kind = 0, best = WEFAX_TONE_SHARE;
  for (let k = 0; k < tables.length; k++)
  {
    const t = tables[k];
    const re = b.re[k] - mean * t.gc, im = b.im[k] - mean * t.gs;
    const amp = (2 * Math.sqrt(re * re + im * im)) / N;
    const share = (amp * amp) / 2 / variance;
    if (share > best && amp >= swing * WEFAX_TONE_AMP_MIN && amp <= swing * WEFAX_TONE_AMP_MAX)
    {
      best = share;
      kind = WEFAX_KEYED[k];
    }
  }
  if (Math.abs(mean - WEFAX_CENTER) > WEFAX_TONE_SHIFT) kind = 0;
  WF.blocks.push({ kind, mean, start: b.start, wild: b.wild / N, noisy: b.wild > N * WEFAX_NOISE_SHARE });
  if (WF.blocks.length > 16) WF.blocks.shift();
  WF.block = wefaxNewBlock(WF.n);
  wefaxTones();
}

// The newest blocks of a kind, of the newest count
function wefaxBlocksOf(kind, count)
{
  return WF.blocks.slice(-count).filter((b) => b.kind == kind);
}

// A block in: a start tone begun or ended, the stop tone, or the signal gone
function wefaxTones()
{
  const last = WF.blocks[WF.blocks.length - 1];
  const second = WF.work;
  if (WF.state == "start")
  {
    if (last.kind == WF.tone)
    {
      WF.toneMiss = 0;
      WF.toneMeans.push(last.mean);
      // Too long for a start tone: something else
      if (WF.n - WF.toneFrom > 15 * second) WF.state = "idle";
      return;
    }
    if (WF.toneMiss++ == 0) WF.toneEnd = last.start;
    if (WF.toneMiss < 2) return;
    // The start tone over: its mean is the center, when its blocks agree on it (else none taken, the phasing lines give it)
    const means = WF.toneMeans.slice().sort((a, b) => a - b);
    const spread = means[Math.floor(means.length * 0.75)] - means[Math.floor(means.length * 0.25)];
    WF.offset = spread <= WEFAX_TONE_AGREE ? Math.max(-WEFAX_SHIFT_MAX, Math.min(WEFAX_SHIFT_MAX, means[means.length >> 1] - WEFAX_CENTER)) : 0;
    wefaxSearch(WF.toneEnd + WEFAX_BLOCK * second, false);
    return;
  }
  for (const hz of [WEFAX_START_TONES[576], WEFAX_START_TONES[288]])
  {
    const run = wefaxBlocksOf(hz, 8);
    if (WF.blocks.length >= 8 && run.length >= 6)
    {
      if (WF.pic) wefaxFinish(false, run[0].start);
      WF.state = "start";
      WF.tone = hz;
      WF.toneHeard = true;
      WF.manual = false;
      WF.byPhasing = false;
      WF.toneMeans = run.map((b) => b.mean);
      WF.toneFrom = run[0].start;
      WF.toneMiss = 0;
      WF.ioc = WF.config.ioc == "auto" ? (hz == WEFAX_START_TONES[288] ? 288 : 576) : WF.config.ioc;
      WF.model = null;
      return;
    }
  }
  if (WF.state == "idle") return;
  const stop = wefaxBlocksOf(WEFAX_STOP_TONE, 6);
  if (stop.length >= 4)
  {
    if (WF.pic) wefaxFinish(true, stop[0].start);
    wefaxIdle();
    return;
  }
  // The signal gone: the chart ends where the noise began
  if (last.noisy)
  {
    if (WF.noisyRun++ == 0) WF.noisyFrom = last.start;
  }
  else WF.noisyRun = 0;
  if (WF.noisyRun * WEFAX_BLOCK >= WEFAX_LOST)
  {
    if (WF.pic) wefaxFinish(false, WF.noisyFrom);
    wefaxIdle();
  }
}

function wefaxIdle()
{
  WF.state = "idle";
  WF.model = null;
  WF.manual = false;
  WF.byPhasing = false;
  WF.blocks = [];
  WF.noisyRun = 0;
}

// ---- The phasing lines

// Phasing looked for from index from (manual: begun by start now; byPhasing: phasing lines seen while idle)
function wefaxSearch(from, manual, byPhasing = false)
{
  WF.state = "search";
  WF.searchFrom = from;
  WF.searchAt = 0;
  WF.manual = manual;
  WF.byPhasing = byPhasing;
  WF.model = null;
  WF.noisyRun = 0;
}

const WEFAX_PROFILE = new Float64Array(WEFAX_BINS);
const WEFAX_PROFILE_COUNT = new Float64Array(WEFAX_BINS);
const WEFAX_RUN = new Float64Array(WEFAX_BINS);

// The phasing lines between indexes from and to: the levels folded over each line rate, the white pulse looked for in each fold (a run
// of bins its width, clearly whiter than the rest of the fold and than any other run). A rate a whole number of times the right one folds
// two pulses or more into a line and is rejected; one a whole number of times shorter folds its pulse with black, less clear. The best:
// { lpm, score, edge (the index of a pulse's leading edge) } or null
function wefaxPhaseSearch(from, to)
{
  const lpms = WF.config.lpm == "auto" ? WEFAX_LPMS : [WF.config.lpm];
  const K = WEFAX_BINS, width = Math.round(K * WEFAX_PULSE);
  let best = null;
  for (const lpm of lpms)
  {
    const period = (60 / lpm) * WF.work;
    if (to - from < 3 * period) continue;
    WEFAX_PROFILE.fill(0);
    WEFAX_PROFILE_COUNT.fill(0);
    for (let t = from; t < to; t++)
    {
      const bin = Math.min(K - 1, Math.floor((((t - from) % period) / period) * K));
      WEFAX_PROFILE[bin] += wefaxLevel(t);
      WEFAX_PROFILE_COUNT[bin]++;
    }
    for (let k = 0; k < K; k++) WEFAX_PROFILE[k] /= Math.max(1, WEFAX_PROFILE_COUNT[k]);
    let peak = 0;
    for (let k = 0; k < K; k++)
    {
      let sum = 0;
      for (let j = 0; j < width; j++) sum += WEFAX_PROFILE[(k + j) % K];
      WEFAX_RUN[k] = sum / width;
      if (WEFAX_RUN[k] > WEFAX_RUN[peak]) peak = k;
    }
    const sorted = Float64Array.from(WEFAX_PROFILE).sort();
    const base = sorted[K >> 1];
    let other = -1;
    for (let k = 0; k < K; k++)
    {
      const apart = Math.min((k - peak + K) % K, (peak - k + K) % K);
      if (apart > 1.5 * width) other = Math.max(other, WEFAX_RUN[k]);
    }
    const score = WEFAX_RUN[peak] - Math.max(base, other);
    if (!best || score > best.score) best = { lpm, score, edge: from + (peak / K) * period };
  }
  return best && best.score >= WEFAX_PHASE_SCORE ? best : null;
}

// Phasing found (or not, and the chart run on at the line rate chosen): the line rate, and for a start now the receiver's tuning from the
// phasing lines' black and white
function wefaxLinesIn()
{
  const second = WF.work;
  if (WF.state == "idle") wefaxIdlePhasing();
  if (WF.state == "search")
  {
    const span = WF.n - WF.searchFrom;
    if (span < WEFAX_SEARCH * second || WF.n - WF.searchAt < 0.5 * second) return;
    WF.searchAt = WF.n;
    const found = wefaxPhaseSearch(Math.max(WF.searchFrom, WF.n - 8 * second), WF.n);
    if (found)
    {
      WF.lpm = found.lpm;
      const period = (60 / found.lpm) * second;
      // The receiver's tuning from the phasing lines' black and white (after a start tone too: its own mean is seldom clean on the air)
      wefaxPhasingTuning(found.edge, period);
      WF.model = { a: found.edge, b: period, nominal: period, points: [], measured: 0, hits: 0, misses: 0, firstMiss: 0, phasing: true };
      WF.state = "track";
    }
    // None found in time: run on at the line rate chosen (begun by phasing seen while idle: it wasn't, back to listening)
    else if (span >= (WF.manual ? WEFAX_SEARCH_NOW : WEFAX_SEARCH_TONE) * second)
    {
      if (WF.byPhasing) wefaxIdle();
      else wefaxFreeRun(WF.searchFrom);
    }
  }
  if (WF.state == "track") wefaxTrack();
  if (WF.state == "image") wefaxRender();
}

// Idle: once a second, the newest WEFAX_IDLE_SPAN seconds looked at for phasing lines (a chart whose start tone wasn't heard). Found
// (the fold's pulse, and most of the lines in them a phasing line's on their own), the chart is begun from them as after a start tone
function wefaxIdlePhasing()
{
  const second = WF.work, span = WEFAX_IDLE_SPAN * second;
  if (WF.n < span + second || WF.n - WF.idleAt < second) return;
  WF.idleAt = WF.n;
  const from = WF.n - span;
  const found = wefaxPhaseSearch(from, WF.n);
  if (!found) return;
  const period = (60 / found.lpm) * second;
  const m = { a: found.edge, b: period, points: [] };
  let lines = 0, hits = 0;
  for (let y = 0; found.edge + period * (y + 1) + 0.05 * period <= WF.n; y++, lines++) if (wefaxEdge(m, y)[2]) hits++;
  if (lines < WEFAX_IDLE_LINES || hits < WEFAX_IDLE_SHARE * lines) return;
  WF.ioc = WF.config.ioc == "auto" ? 576 : WF.config.ioc;
  WF.toneHeard = false;
  wefaxSearch(from, false, true);
}

// The receiver's tuning from phasing lines (a pulse's leading edge at edge, a line period long): the pulses' middles white, the lines'
// middles black, their medians either side of the center
function wefaxPhasingTuning(edge, period)
{
  const white = [], black = [];
  for (let line = 0; edge + (line + 1) * period <= WF.n; line++)
  {
    const s = edge + line * period;
    for (let t = s + 0.3 * WEFAX_PULSE * period; t < s + 0.7 * WEFAX_PULSE * period; t += 2) white.push(wefaxHz(t) + WF.offset);
    for (let t = s + 0.3 * period; t < s + 0.7 * period; t += 8) black.push(wefaxHz(t) + WF.offset);
  }
  if (white.length < 10 || black.length < 10) return;
  white.sort((a, b) => a - b);
  black.sort((a, b) => a - b);
  const w = white[white.length >> 1], k = black[black.length >> 1];
  const offset = w - k > 500 && w - k < 1100 ? (w + k) / 2 - WEFAX_CENTER : k - WEFAX_BLACK;
  if (Math.abs(offset) <= WEFAX_SHIFT_MAX) WF.offset = offset;
}

// Each phasing line's pulse measured as its line comes in, and the line rate fitted through them; the chart's own lines begin at the
// first of three lines in a row with no pulse (after three with one), the picture with them (the phasing lines aren't drawn). Too few
// found: the chart runs on at the rate the fold gave. Black lines with no clear pulse count as phasing only within WEFAX_PHASING_MOST
// lines of where it was found
const WEFAX_PHASING_MOST = 120;
// A line whose level (all but its pulse) is below this is still a phasing line's black, whether its pulse was clear or not
const WEFAX_PHASING_BLACK = 0.3;

function wefaxTrack()
{
  const m = WF.model;
  while (m.a + m.b * (m.measured + 1) + 0.05 * m.b <= WF.n)
  {
    const y = m.measured;
    const [at, clear, hit, rest] = wefaxEdge(m, y);
    if (hit)
    {
      m.points.push([y, at, clear]);
      wefaxFit(m);
      m.hits++;
      m.misses = 0;
    }
    // A line still black, its pulse not clear: a phasing line through static (a crash of it blurs a pulse or two), not the chart
    // begun; it counts neither way (a run of three of them ended the phasing 19 s early on an NMC chart, its line rate then fitted from
    // too few pulses: 185 ppm off). Past WEFAX_PHASING_MOST lines they count as the chart's
    else if (rest < WEFAX_PHASING_BLACK && m.hits >= 3 && y < WEFAX_PHASING_MOST)
    {
      m.measured++;
      continue;
    }
    else if (m.misses++ == 0) m.firstMiss = y;
    m.measured++;
    if (m.misses >= 3 && m.hits >= 3)
    {
      wefaxRateCheck(m);
      wefaxPicture(m.firstMiss, true);
      return;
    }
    if (m.misses >= 8 && m.hits < 3)
    {
      // Begun by phasing seen while idle, and its lines don't hold up: no chart, back to listening
      if (WF.byPhasing)
      {
        wefaxIdle();
        return;
      }
      m.phasing = false;
      wefaxRateCheck(m);
      wefaxPicture(m.firstMiss, false);
      return;
    }
  }
}

// The phasing over: its line rate kept when its pulses are enough, far enough apart and close to the line through them (and taken as the
// one known from now on); otherwise the one known (none yet: nominal), only where line 0 starts fitted to its pulses (their median)
function wefaxRateCheck(m)
{
  const p = m.points, n = p.length, span = n ? p[n - 1][0] - p[0][0] : 0;
  const rms = n >= 3 ? Math.sqrt(p.reduce((s, q) => s + (q[1] - m.a - m.b * q[0]) ** 2, 0) / n) : Infinity;
  if (n >= WEFAX_RATE_PULSES && span >= WEFAX_RATE_SPAN && rms <= WEFAX_RATE_RMS)
  {
    WF.knownRate = m.b / m.nominal;
    return;
  }
  const b = m.nominal * (WF.knownRate || 1);
  if (n)
  {
    const starts = p.map((q) => q[1] - b * q[0]).sort((x, y) => x - y);
    m.a = starts[n >> 1];
  }
  m.b = b;
}

// Line y's pulse: where the level steps up most from black to white within a little of where it should (the step's height its clearness,
// 0 to 1), and whether it is a phasing line's (clear, and the rest of the line black)
function wefaxEdge(m, y)
{
  const period = m.b, expect = m.a + m.b * y;
  const spread = Math.round(m.points.length >= 3 ? 0.004 * period : 0.02 * period);
  const L = Math.max(2, Math.round(WEFAX_PULSE * period * 0.8));
  const from = Math.round(expect) - spread - L, length = 2 * spread + 2 * L + 1;
  const sums = new Float64Array(length + 1);
  for (let i = 0; i < length; i++) sums[i + 1] = sums[i] + wefaxLevel(from + i);
  const score = (i) => (sums[i + L] - sums[i]) / L - (sums[i] - sums[i - L]) / L;
  let best = L;
  for (let i = L; i <= L + 2 * spread; i++) if (score(i) > score(best)) best = i;
  let delta = 0;
  if (best > L && best < L + 2 * spread)
  {
    const a = score(best - 1), b = score(best), c = score(best + 1), den = a - 2 * b + c;
    if (den < 0) delta = Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den));
  }
  const at = from + best + delta, clear = score(best);
  let rest = 0, count = 0;
  for (let t = at + 0.1 * period; t < at + 0.9 * period; t += 4, count++) rest += wefaxLevel(t);
  // (the best at the very edge of where it was looked for is only the slope of a pulse further off: not a measurement, or the line
  // fitted would follow its own error from one line to the next)
  const inside = best > L && best < L + 2 * spread;
  return [at, clear, inside && clear > 0.4 && rest / count < 0.3, rest / count];
}

// The line rate and where line 0 starts, from the pulses measured: a straight line through them, weighted by how clear each was, the
// ones far off it left out; the rate kept within WEFAX_RATE_TOL of what it should be
function wefaxFit(m)
{
  let points = m.points;
  for (let round = 0; round < 3; round++)
  {
    let a, b;
    // The rate only from pulses at least WEFAX_FIT_SPAN lines apart (a few lines' worth gave hundreds of ppm, and the pulses looked for
    // where that put them); until then the nominal rate, only where line 0 starts fitted
    if (points.length < 3 || points[points.length - 1][0] - points[0][0] < WEFAX_FIT_SPAN)
    {
      b = m.nominal;
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
      b = den > 0 ? (sw * sxy - sx * sy) / den : m.nominal;
      b = Math.max(m.nominal * (1 - WEFAX_RATE_TOL), Math.min(m.nominal * (1 + WEFAX_RATE_TOL), b));
      a = (sy - b * sx) / sw;
    }
    m.a = a;
    m.b = b;
    const residual = points.map((p) => Math.abs(p[1] - a - b * p[0]));
    const rms = Math.sqrt(residual.reduce((s, r) => s + r * r, 0) / residual.length);
    const keep = points.filter((p, i) => residual[i] <= Math.max(0.002 * m.nominal, 2.5 * rms));
    if (keep.length == points.length || keep.length < 3) break;
    points = keep;
  }
}

// No phasing lines: the chart from index from at the line rate chosen (120 lines a minute unless told), and for a start now the receiver's
// tuning from the levels in its first seconds (most of a chart is one level, usually white)
function wefaxFreeRun(from)
{
  WF.lpm = WF.config.lpm == "auto" ? WEFAX_LPM_DEFAULT : WF.config.lpm;
  const period = (60 / WF.lpm) * WF.work;
  if (!WF.toneHeard)
  {
    // The commonest frequency (10 Hz bins, over 50 Hz): white if above the center, black if below (the two can't be confused while the
    // receiver is less than 400 Hz off)
    const bins = new Float64Array((2 * WEFAX_CLIP) / 10 + 1);
    let count = 0;
    for (let t = from; t < Math.min(WF.n, from + 4 * WF.work); t += 3, count++) bins[Math.round((wefaxHz(t) + WF.offset - WEFAX_CENTER + WEFAX_CLIP) / 10)]++;
    let best = 2, most = 0;
    for (let k = 2; k < bins.length - 2; k++)
    {
      const sum = bins[k - 2] + bins[k - 1] + bins[k] + bins[k + 1] + bins[k + 2];
      if (sum > most)
      {
        most = sum;
        best = k;
      }
    }
    const mode = WEFAX_CENTER - WEFAX_CLIP + best * 10;
    const offset = mode >= WEFAX_CENTER ? mode - WEFAX_WHITE : mode - WEFAX_BLACK;
    if (count > 100 && most > 0.15 * count && Math.abs(offset) <= WEFAX_SHIFT_MAX) WF.offset = offset;
  }
  // (at the line rate known from an earlier chart's phasing, when there is one)
  WF.model = { a: from, b: period * (WF.knownRate || 1), nominal: period, points: [], measured: 0, hits: 0, misses: 0, firstMiss: 0, phasing: false };
  wefaxPicture(0, false);
}

// ---- The chart's lines

// A chart's own lines begin at line y0 of the line model, the picture with them (its phasing lines aren't drawn)
function wefaxPicture(y0, phasing)
{
  const width = Math.floor(WF.ioc * Math.PI);
  const id = WF.nextId++;
  // shift: each row's start moved by this (samples) as it was read, adjust: the rows still to come, mark: where each row's line-start
  // marker says it should start (NaN: none found) (wefaxTrackRow); every row is the chart's own, so all are followed
  WF.pic = { id, width, y0, rendered: 0, rows: new Uint8Array(width * 600), shift: new Float64Array(600), adjust: 0, mark: new Float64Array(600).fill(NaN), track: wefaxTrackNew(width), complete: false, alignNext: WEFAX_ALIGN_EVERY };
  // (lined up afresh: wefaxAutoAlign)
  WF.config.align = 0;
  WF.state = "image";
  WF.noisyRun = 0;
  const m = WF.model;
  WF.out({ type: "start", id, ioc: WF.ioc, lpm: WF.lpm, width, offsetHz: Math.round(WF.offset), ppm: Math.round((m.b / m.nominal - 1) * 1e6), tone: WF.toneHeard, phasing });
}

// Where row r starts (an index), with the trim (pivoting on the chart's first row, so its top stays put), the alignment, and where
// following the chart's lines moved it (each row read as it was, the rows to come as they will be)
function wefaxLineStart(pic, r)
{
  const m = WF.model, line = m.b * (1 + WF.config.trim * 1e-6);
  return m.a + m.b * pic.y0 + line * (r + WF.config.align) + (r < pic.rendered ? pic.shift[r] : pic.adjust);
}

// Row r read into the chart: each pixel the mean of the frequency across it (three readings), as a level
function wefaxRow(pic, r)
{
  const width = pic.width, start = wefaxLineStart(pic, r);
  const pixel = (WF.model.b * (1 + WF.config.trim * 1e-6)) / width;
  const scale = 255 / (WEFAX_WHITE - WEFAX_BLACK);
  const rows = pic.rows, base = r * width;
  for (let x = 0; x < width; x++)
  {
    const t = start + (x + 0.5) * pixel;
    const hz = pixel >= 1.2 ? (wefaxHz(t - pixel / 3) + wefaxHz(t) + wefaxHz(t + pixel / 3)) / 3 : wefaxHz(t);
    rows[base + x] = Math.max(0, Math.min(255, Math.round((hz - WEFAX_BLACK) * scale)));
  }
}

// The rows whose frequencies are all in, drawn and sent
function wefaxRender()
{
  const pic = WF.pic, width = pic.width;
  const line = WF.model.b * (1 + WF.config.trim * 1e-6);
  // The first row sent (lower, when a step taken has the rows since it read again)
  let from = pic.rendered;
  while (wefaxLineStart(pic, pic.rendered) + line + 4 <= WF.n)
  {
    if (pic.rendered >= WEFAX_MAX_LINES)
    {
      wefaxSend(pic, from);
      wefaxFinish(false);
      wefaxIdle();
      return;
    }
    if ((pic.rendered + 1) * width > pic.rows.length)
    {
      const rows = new Uint8Array(pic.rows.length * 2);
      rows.set(pic.rows);
      pic.rows = rows;
      const shift = new Float64Array(pic.shift.length * 2);
      shift.set(pic.shift);
      pic.shift = shift;
      const mark = new Float64Array(pic.mark.length * 2).fill(NaN);
      mark.set(pic.mark);
      pic.mark = mark;
    }
    const r = pic.rendered;
    pic.shift[r] = pic.adjust;
    wefaxRow(pic, r);
    pic.rendered++;
    if (WF.config.track) from = Math.min(from, wefaxTrackRow(pic, r));
  }
  wefaxSend(pic, from);
  // Every WEFAX_ALIGN_EVERY of its own rows: its left edge looked for (the chart so far drawn again when it's moved); not on a chart
  // whose line-start markers line it up
  if (pic.rendered >= pic.alignNext && !(WF.config.track && pic.track.markWidth))
  {
    pic.alignNext += WEFAX_ALIGN_EVERY;
    wefaxAutoAlign(pic, true);
  }
}

// The chart's own left edge (see WEFAX_ALIGN_EVERY): the shift (pixels, the line to start that far along) when one is clearly found,
// else 0
function wefaxAlignFind(pic)
{
  const W = pic.width, r0 = 0, r1 = pic.rendered;
  if (r1 - r0 < WEFAX_ALIGN_ROWS) return 0;
  const rows = pic.rows;
  // A pixel is ink when it's dark and so is the one above or below it (static on a fax line comes as dots and short dashes along the
  // line, one row high; lettering and lines reach the next row). Each column's ink, over all the chart's rows and each third of them
  const dark = (x, r) => r >= r0 && r < r1 && rows[r * W + x] < WEFAX_ALIGN_DARK;
  const ink = new Float64Array(W), thirds = [new Float64Array(W), new Float64Array(W), new Float64Array(W)];
  for (let r = r0; r < r1; r++)
  {
    const third = thirds[Math.min(2, Math.floor(((r - r0) * 3) / (r1 - r0)))];
    for (let x = 0; x < W; x++)
    {
      if (dark(x, r) && (dark(x, r - 1) || dark(x, r + 1)))
      {
        ink[x]++;
        third[x]++;
      }
    }
  }
  const k = WEFAX_ALIGN_SMOOTH, sm = new Float64Array(W);
  let sum = 0;
  for (let d = -k; d <= k; d++) sum += ink[(d + W) % W];
  for (let x = 0; x < W; x++)
  {
    sm[x] = sum / ((2 * k + 1) * (r1 - r0));
    sum += ink[(x + k + 1) % W] - ink[(x - k + W) % W];
  }
  const sorted = Float64Array.from(sm).sort();
  const p20 = sorted[Math.floor(W * 0.2)], median = sorted[W >> 1];
  if (!(median > 0) || (median - p20) / median < WEFAX_ALIGN_CONTRAST) return 0;
  const limit = Math.max(p20 * 1.6, p20 + 0.004);
  let start = 0;
  while (start < W && sm[start] <= limit) start++;
  if (start == W) return 0;
  // The quiet runs, circularly, from the first busy column
  let best = null, second = 0, run = null;
  for (let i = 1; i <= W; i++)
  {
    const x = (start + i) % W;
    if (sm[x] <= limit)
    {
      if (!run) run = { from: x, length: 0 };
      run.length++;
    }
    if ((sm[x] > limit || i == W) && run)
    {
      if (!best || run.length > best.length)
      {
        if (best) second = Math.max(second, best.length);
        best = run;
      }
      else second = Math.max(second, run.length);
      run = null;
    }
  }
  if (!best || best.length < WEFAX_ALIGN_MIN * W || best.length < WEFAX_ALIGN_LEAD * second) return 0;
  // Blank paper is blank at every height: in each third of the rows, the band's columns hold at most half the ink of the chart's own
  // median column (those outside the band; on a narrow chart most of the line is paper). A chart lying on a diagonal has a blank
  // triangle, not a band
  for (const col of thirds)
  {
    const own = [];
    for (let i = best.length; i < W; i++) own.push(col[(best.from + i) % W]);
    own.sort((a, b) => a - b);
    let inBand = 0;
    for (let i = 0; i < best.length; i++) inBand += col[(best.from + i) % W];
    if (inBand / best.length > 0.5 * own[own.length >> 1]) return 0;
  }
  const margin = Math.min(Math.round(WEFAX_ALIGN_MARGIN * W), best.length >> 1);
  return (best.from + best.length - margin + W) % W;
}

// The chart lined up on its own left edge when one is found far enough from where its lines start now: its rows read again (those whose
// frequencies are still kept), following its lines begun again from there, and (send) the chart drawn again. True when it was moved
function wefaxAutoAlign(pic, send)
{
  if (!WF.model) return false;
  const shift = wefaxAlignFind(pic);
  let share = shift / pic.width;
  // As it ends (not send), all of it in: no band found in the whole chart, after one was found in its first rows (a chart lying on a
  // diagonal can show one there), puts it back where its lines began
  if (!shift && !send && WF.config.align) share = 1 - WF.config.align;
  else if (!shift || share < WEFAX_ALIGN_MOVE || share > 1 - WEFAX_ALIGN_MOVE) return false;
  WF.config.align = (WF.config.align + share) % 1;
  if (WF.config.track) wefaxTrackReset(pic);
  for (let r = 0; r < pic.rendered; r++) if (wefaxLineStart(pic, r) > WF.n - WF.freq.length + 4) wefaxRow(pic, r);
  if (send) WF.out({ type: "redraw", id: pic.id, count: pic.rendered, pixels: pic.rows.slice(0, pic.rendered * pic.width) });
  return true;
}

function wefaxSend(pic, from)
{
  if (pic.rendered <= from) return;
  WF.out({ type: "rows", id: pic.id, from, count: pic.rendered - from, pixels: pic.rows.slice(from * pic.width, pic.rendered * pic.width) });
}

// The rows drawn again (the trim or alignment changed): those whose frequencies are still kept
function wefaxRedraw()
{
  const pic = WF.pic;
  if (!pic || pic.rendered == 0) return;
  for (let r = 0; r < pic.rendered; r++) if (wefaxLineStart(pic, r) > WF.n - WF.freq.length + 4) wefaxRow(pic, r);
  WF.out({ type: "redraw", id: pic.id, count: pic.rendered, pixels: pic.rows.slice(0, pic.rendered * pic.width) });
}

// The chart as finally read (ending at index end, when known: the rows from there on, the stop tone or noise, left out)
function wefaxFinish(complete, end)
{
  const pic = WF.pic;
  WF.pic = null;
  if (!pic) return;
  // Its rows' line-start markers stacked, when it has them; else lined up on its own left edge once more, now all of it is in
  if (WF.config.track && pic.track.markWidth) wefaxTrackRestack(pic);
  else wefaxAutoAlign(pic, false);
  let count = pic.rendered;
  if (end !== undefined) while (count > 0 && wefaxLineStart(pic, count - 1) + WF.model.b * 0.5 > end) count--;
  WF.out({ type: "done", id: pic.id, count, complete, pixels: pic.rows.slice(0, count * pic.width) });
}

// ---- Following the chart's lines
//
// After the phasing lines nothing in a radiofax line marks where it starts, so the chart is read at the line rate measured. Samples the
// sound card drops or doubles move everything after them sideways, and a clock some way off slants the chart. A weather chart is full of
// lines running straight down it (meridians, its frame, the edge of its paper, the legend's blocks), so each row as it's read is
// compared with the rows before it at every shift across a line: its edges (its levels less their local mean) correlated, circularly,
// with a reference made of the recent rows lined up with one another (a coarse correlation by FFT, then to a fraction of a pixel near
// its peak). A row matching best near where it's expected is measured there and lined up into the reference; a straight line through
// the newest measurements (where a row should start, and how fast that moves) sets where the next rows are read from. A row matching
// clearly better somewhere else is a step: taken only when WEFAX_TRACK_ROWS rows in a row agree on it, and the rows since it began are
// read again from there and sent again. Rows with little to go on (blank, noisy, or only curves and diagonals, which match nowhere in
// particular) change nothing.

// The FFTs, by size: the bit reversal and the twiddles
const WEFAX_FFT = {};

// A complex FFT in place (inverse: unscaled)
function wefaxFft(re, im, inverse)
{
  const N = re.length;
  let t = WEFAX_FFT[N];
  if (!t)
  {
    const bits = Math.round(Math.log2(N)), rev = new Uint32Array(N), cos = new Float64Array(N >> 1), sin = new Float64Array(N >> 1);
    for (let i = 0; i < N; i++)
    {
      let r = 0;
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      rev[i] = r;
    }
    for (let i = 0; i < N >> 1; i++)
    {
      cos[i] = Math.cos((2 * Math.PI * i) / N);
      sin[i] = -Math.sin((2 * Math.PI * i) / N);
    }
    t = WEFAX_FFT[N] = { rev, cos, sin };
  }
  for (let i = 0; i < N; i++)
  {
    const j = t.rev[i];
    if (j > i)
    {
      const r = re[i], m = im[i];
      re[i] = re[j];
      im[i] = im[j];
      re[j] = r;
      im[j] = m;
    }
  }
  const sign = inverse ? -1 : 1;
  for (let size = 2; size <= N; size <<= 1)
  {
    const half = size >> 1, step = N / size;
    for (let start = 0; start < N; start += size)
    {
      for (let k = 0; k < half; k++)
      {
        const c = t.cos[k * step], s = sign * t.sin[k * step];
        const a = start + k, b = a + half;
        const xr = re[b] * c - im[b] * s, xi = re[b] * s + im[b] * c;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

// What following a chart's lines keeps: its coarse correlation N steps across a line (a power of two, about 1.8 pixels each); the row
// being measured and the reference (edges, a pixel each); the measurements [row, where it should start (samples, against where the
// chart began), how well it matched]; the rows that may be a step; the line fitted (a, slope: where row r should start is a + slope r);
// the last row measured; the first row a step may have read again; and the line-start marker: its width once known (0 until then), the
// newest rows' markers before then, and each pixel's blackness summed across a row (twice round)
function wefaxTrackNew(width)
{
  let N = 1;
  while (N * 2 <= width) N <<= 1;
  const f = () => new Float64Array(N);
  return { N, cur: new Float32Array(width), ref: new Float32Array(width), xr: f(), xi: f(), rr: f(), ri: f(), cc: f(), count: 0, points: [], pending: [], a: 0, slope: 0, matched: 0, floor: 0, markWidth: 0, markSeen: [], dark: new Int32Array(2 * width + 1) };
}

// Where the line-start marker is put (pixels): the line's start, moved by the alignment set by hand
function wefaxTrackTarget(width)
{
  return ((1 - WF.config.align) * width) % width;
}

// Row r's line-start marker: a solid black run 2.5% to 4.5% of a line wide (once known, its width within 3 pixels), clearly blacker
// than a third of its width either side of it. { x (where it starts, pixels), width } or null
function wefaxTrackMark(pic, r)
{
  const T = pic.track, W = pic.width, rows = pic.rows, base = r * W, D = T.dark;
  for (let i = 0; i < 2 * W; i++) D[i + 1] = D[i] + (rows[base + (i < W ? i : i - W)] < WEFAX_TRACK_BLACK ? 1 : 0);
  const lo = T.markWidth ? T.markWidth - 3 : Math.round(0.025 * W), hi = T.markWidth ? T.markWidth + 3 : Math.round(0.045 * W);
  let best = null;
  for (let w = lo; w <= hi; w++)
  {
    const f = Math.max(4, Math.round(w / 3));
    for (let x = f; x < W + f; x++)
    {
      const inside = D[x + w] - D[x];
      if (inside < 0.85 * w) continue;
      const flank = (D[x] - D[x - f] + D[x + w + f] - D[x + w]) / (2 * f);
      if (flank > 0.3) continue;
      const score = inside / w - flank;
      if (!best || score > best.score) best = { x: x % W, width: w, score };
    }
  }
  if (!best) return null;
  // Its edges to a fraction of a pixel (where the level crosses mid gray), and its middle less half the width known (or found)
  const level = (x) => rows[base + ((x % W) + W) % W];
  const cross = (a, b) => (a == b ? 0.5 : Math.max(0, Math.min(1, (a - 128) / (a - b))));
  const x0 = best.x, x1 = best.x + best.width;
  const left = x0 - 0.5 + cross(level(x0 - 1), level(x0)), right = x1 + 0.5 - cross(level(x1), level(x1 - 1));
  best.x = (left + right) / 2 - (T.markWidth || best.width) / 2;
  return best;
}

// The chart's rows moved so their line-start markers stack: each row with a marker read from where the markers around it say, a row
// without one moved as the last row with one was; read again where their frequencies are still kept
function wefaxTrackRestack(pic)
{
  const n = pic.rendered, line = WF.model.b * (1 + WF.config.trim * 1e-6), px = line / pic.width;
  const wrap = (v) => v - line * Math.round(v / line);
  // Each marked row's move (samples), taken the same way round as the one before
  const marked = [], moves = [];
  for (let r = 0; r < n; r++)
  {
    if (isNaN(pic.mark[r])) continue;
    let d = wrap(pic.mark[r] - pic.shift[r]);
    if (moves.length) d = moves[moves.length - 1] + wrap(d - moves[moves.length - 1]);
    marked.push(r);
    moves.push(d);
  }
  // Each taken as the median of the five around it (a marker misread left out, and a row's own few tenths of a pixel not followed:
  // a move of less than a pixel is left undone)
  const smooth = moves.map((d, i) =>
  {
    const around = moves.slice(Math.max(0, i - 2), i + 3).sort((a, b) => a - b);
    return around[around.length >> 1];
  });
  if (!smooth.length) return;
  let move = smooth[0];
  for (let r = 0, j = 0; r < n; r++)
  {
    for (; j < marked.length && marked[j] <= r; j++) move = smooth[j];
    if (Math.abs(move) < px) continue;
    const start = wefaxLineStart(pic, r) + move;
    if (start + line + 4 > WF.n || start < WF.n - WF.freq.length + 4) continue;
    pic.shift[r] += move;
    wefaxRow(pic, r);
  }
}

// Begun again from the rows to come, read from where they would be
function wefaxTrackReset(pic)
{
  const T = pic.track;
  T.count = 0;
  T.points = [];
  T.pending = [];
  T.markSeen = [];
  T.a = pic.adjust - T.slope * pic.rendered;
  T.matched = pic.rendered;
  T.floor = pic.rendered;
}

// Row r's edges into T.cur, and their energy
function wefaxTrackEdges(pic, r)
{
  const W = pic.width, rows = pic.rows, base = r * W, out = pic.track.cur, E = WEFAX_TRACK_EDGE, span = 2 * E + 1;
  let sum = 0, energy = 0;
  for (let k = -E; k <= E; k++) sum += rows[base + ((k + W) % W)];
  for (let x = 0; x < W; x++)
  {
    const v = rows[base + x] - sum / span;
    out[x] = v;
    energy += v * v;
    sum += rows[base + ((x + E + 1) % W)] - rows[base + ((x - E + W) % W)];
  }
  return energy;
}

// The row against the reference with the row moved s pixels (a whole number)
function wefaxTrackAt(T, s)
{
  const cur = T.cur, ref = T.ref, W = cur.length;
  const k = ((s % W) + W) % W;
  let sum = 0;
  for (let x = 0, j = k; x < W; x++, j++)
  {
    if (j == W) j = 0;
    sum += ref[x] * cur[j];
  }
  return sum;
}

// The match's peak to a fraction of a pixel, near s (pixels)
function wefaxTrackPeak(T, s)
{
  const c = [];
  for (let d = -2; d <= 2; d++) c.push(wefaxTrackAt(T, s + d));
  let m = 1;
  for (let i = 2; i <= 3; i++) if (c[i] > c[m]) m = i;
  const a = c[m - 1], b = c[m], e = c[m + 1], den = a - 2 * b + e;
  return s + m - 2 + (den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - e)) / den)) : 0);
}

// The row lined up (moved s pixels) into the reference
function wefaxTrackAdd(T, s)
{
  const cur = T.cur, ref = T.ref, W = cur.length;
  const share = 1 / Math.min(WEFAX_TRACK_MEMORY, T.count + 1);
  const i0 = Math.floor(s), f = s - i0;
  for (let x = 0; x < W; x++)
  {
    const j = (((x + i0) % W) + W) % W, v = cur[j] * (1 - f) + cur[j + 1 == W ? 0 : j + 1] * f;
    ref[x] += share * (v - ref[x]);
  }
  T.count++;
}

// The line through the newest measurements, each weighted by how well it matched (its slope only from 4 of them over 4 rows or more,
// and kept within WEFAX_TRACK_PPM)
function wefaxTrackFit(T, line)
{
  const p = T.points, n = p.length;
  if (n < 3) return;
  const x0 = p[n - 1][0];
  let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [row, at, w] of p)
  {
    const x = row - x0;
    sw += w;
    sx += w * x;
    sy += w * at;
    sxx += w * x * x;
    sxy += w * x * at;
  }
  let slope = T.slope;
  const den = sw * sxx - sx * sx;
  if (n >= 4 && x0 - p[0][0] >= 4 && den > 0) slope = (sw * sxy - sx * sy) / den;
  const most = WEFAX_TRACK_PPM * 1e-6 * line;
  T.slope = Math.max(-most, Math.min(most, slope));
  T.a = (sy - T.slope * sx) / sw - T.slope * x0;
}

// Row r just read: measured against the reference, and where the next rows are read from set. Returns the first row to send again (the
// rows a step was found in are read again: pic.rendered is moved back to the first of them), else pic.rendered
function wefaxTrackRow(pic, r)
{
  const T = pic.track, W = pic.width, N = T.N;
  const line = WF.model.b * (1 + WF.config.trim * 1e-6), px = line / W;
  const most = WEFAX_TRACK_PPM * 1e-6 * line;
  const next = () =>
  {
    const at = T.a + T.slope * (r + 1);
    if (Math.abs(at - pic.adjust) > WEFAX_TRACK_HOLD) pic.adjust = at;
    return pic.rendered;
  };
  // A line's samples to between -line / 2 and line / 2; where the row is expected (the line fitted)
  const wrap = (v) => v - line * Math.round(v / line);
  const expect = T.a + T.slope * r;
  const energy = wefaxTrackEdges(pic, r);
  // A step that rows stopped agreeing on forgotten
  if (T.pending.length && r - T.pending[T.pending.length - 1].r > 3) T.pending = [];
  // The line-start marker: where it says the row should start (kept for the chart's last redraw), and how far that is from where the
  // row is expected (samples)
  const mark = wefaxTrackMark(pic, r);
  if (mark)
  {
    pic.mark[r] = pic.shift[r] + (mark.x - wefaxTrackTarget(W)) * px;
    const off = wrap(pic.mark[r] - expect);
    if (!T.markWidth)
    {
      // Not yet known: taken once most of the newest rows have one, in one place
      T.markSeen.push({ r, off, width: mark.width });
      while (T.markSeen[0].r <= r - WEFAX_TRACK_MARK_ROWS) T.markSeen.shift();
      if (T.markSeen.length >= WEFAX_TRACK_MARK_SEEN)
      {
        const offs = T.markSeen.map((m) => off + wrap(m.off - off)).sort((a, b) => a - b), mid = offs[offs.length >> 1];
        if (offs.filter((o) => Math.abs(o - mid) <= WEFAX_TRACK_AGREE * px).length >= WEFAX_TRACK_MARK_AGREE)
        {
          // The rows from here on read from the marker's place, the reference begun again there, and the chart so far redrawn with
          // its rows' markers stacked
          const widths = T.markSeen.map((m) => m.width).sort((a, b) => a - b);
          T.markWidth = widths[widths.length >> 1];
          for (const p of T.points) p[1] += mid;
          T.a += mid;
          T.count = 0;
          T.pending = [];
          T.matched = r;
          T.floor = r + 1;
          pic.adjust = T.a + T.slope * (r + 1);
          wefaxTrackRestack(pic);
          WF.out({ type: "redraw", id: pic.id, count: pic.rendered, pixels: pic.rows.slice(0, pic.rendered * W) });
          return pic.rendered;
        }
      }
    }
    else if (Math.abs(off) <= WEFAX_TRACK_AGREE * px)
    {
      // Where expected: measured (counting for far more than a match of the chart's lines would)
      const s = (expect + off - pic.shift[r]) / px;
      if (energy >= 16 * W) wefaxTrackAdd(T, s);
      return wefaxTrackMeasured(pic, r, expect + off, WEFAX_TRACK_MARK_WEIGHT, line, next);
    }
    else return wefaxTrackMaybeStep(pic, r, off, WEFAX_TRACK_MARK_WEIGHT, expect, line, next);
  }
  // A blank row (edges of 4 levels on average or less) says nothing; the first rows (and after a long time with nothing matching) make
  // the reference
  if (energy < 16 * W) return next();
  if (r - T.matched > WEFAX_TRACK_STALE) T.count = 0;
  if (T.count < WEFAX_TRACK_FIRST)
  {
    wefaxTrackAdd(T, 0);
    T.matched = r;
    return next();
  }
  // The coarse correlation: the row and the reference summed into N steps, cc[k] how well the row matches moved k steps
  const { xr, xi, rr, ri, cc, cur, ref } = T;
  xr.fill(0);
  xi.fill(0);
  rr.fill(0);
  ri.fill(0);
  for (let x = 0; x < W; x++)
  {
    const k = Math.floor((x * N) / W);
    xr[k] += cur[x];
    rr[k] += ref[x];
  }
  wefaxFft(xr, xi, false);
  wefaxFft(rr, ri, false);
  for (let k = 0; k < N; k++)
  {
    const a = rr[k] * xr[k] + ri[k] * xi[k], b = rr[k] * xi[k] - ri[k] * xr[k];
    xr[k] = a;
    xi[k] = b;
  }
  wefaxFft(xr, xi, true);
  // How clearly each stands out: against the spread of all of them (most are the row against the reference where they don't match;
  // a plain correlation, 0 to 1, would rate diagonals and hatching, which match a little everywhere, too well)
  let spread = 0, best = 0;
  for (let k = 0; k < N; k++) spread += xr[k] * xr[k];
  const norm = 1 / (Math.sqrt(spread / N) + 1e-12);
  for (let k = 0; k < N; k++)
  {
    cc[k] = xr[k] * norm;
    if (cc[k] > cc[best]) best = k;
  }
  // Steps to pixels (between -W / 2 and W / 2); the best match near where the row is expected (a peak, not just the edge of one
  // further off; the reach wider while the slope isn't known yet: a clock far off moves the rows that much each row)
  const pixels = (k) => ((k > N / 2 ? k - N : k) * W) / N;
  const near = Math.round((((expect - pic.shift[r]) / px) * N) / W);
  const reach = WEFAX_TRACK_NEAR + (T.points.length < 6 ? Math.ceil((most / px) * (N / W)) : 0);
  let local = near;
  for (let d = -reach; d <= reach; d++) if (cc[(near + d + N * 4) % N] > cc[(local + N * 4) % N]) local = near + d;
  const k = (local + N * 4) % N;
  const peak = cc[k] >= cc[(k + 1) % N] && cc[k] >= cc[(k + N - 1) % N];
  if (peak && cc[k] >= WEFAX_TRACK_MATCH && cc[k] >= cc[best] - WEFAX_TRACK_BETTER)
  {
    // Measured: lined up into the reference
    const s = wefaxTrackPeak(T, Math.round(pixels(k)));
    wefaxTrackAdd(T, s);
    return wefaxTrackMeasured(pic, r, pic.shift[r] + s * px, cc[k], line, next);
  }
  if (cc[best] < WEFAX_TRACK_STEP || (peak && cc[best] < cc[k] + WEFAX_TRACK_BETTER))
  {
    // Nothing clear: into the reference where it's expected (so the reference keeps up with the chart), unless it matches better
    // elsewhere or a step may have begun (those rows would blur it)
    if (!T.pending.length && cc[best] < cc[k] + WEFAX_TRACK_BETTER) wefaxTrackAdd(T, (expect - pic.shift[r]) / px);
    return next();
  }
  // Maybe a step: how far from where expected (samples)
  const s = wefaxTrackPeak(T, Math.round(pixels(best)));
  return wefaxTrackMaybeStep(pic, r, wrap(pic.shift[r] + s * px - expect), cc[best], expect, line, next);
}

// Row r measured: where it should start (samples) into the line fitted, weighted by how well it matched
function wefaxTrackMeasured(pic, r, at, weight, line, next)
{
  const T = pic.track;
  T.points.push([r, at, weight]);
  while (T.points[0][0] < r - WEFAX_TRACK_FIT) T.points.shift();
  T.pending = [];
  T.matched = r;
  wefaxTrackFit(T, line);
  return next();
}

// Row r matching clearly somewhere off where it's expected (off samples, matching weight well): maybe a step. The rows that may be one
// agree when they lie along a line (a clock far off moves them a little each row) within WEFAX_TRACK_AGREE pixels. Returns as
// wefaxTrackRow does
function wefaxTrackMaybeStep(pic, r, off, weight, expect, line, next)
{
  const T = pic.track, px = line / pic.width, most = WEFAX_TRACK_PPM * 1e-6 * line;
  const wrap = (v) => v - line * Math.round(v / line);
  const pending = T.pending;
  // Too far for a sound card's step (a line-start marker's may be any size): nothing
  if (weight < WEFAX_TRACK_MARK_WEIGHT && Math.abs(wrap(off)) > WEFAX_TRACK_STEP_MAX * line) return next();
  // (near half a line either way, all taken the same way as the first)
  if (pending.length) off = pending[0].off + wrap(off - pending[0].off);
  pending.push({ r, off, z: weight });
  if (pending.length > WEFAX_TRACK_ROWS_MOST) pending.shift();
  const first = pending[0], last = pending[pending.length - 1];
  const slope = pending.length > 1 ? (last.off - first.off) / (last.r - first.r) : 0;
  if (Math.abs(slope) > most + WEFAX_TRACK_AGREE * px || pending.some((p) => Math.abs(p.off - first.off - slope * (p.r - first.r)) > WEFAX_TRACK_AGREE * px))
  {
    T.pending = [last];
    return next();
  }
  if (pending.length < WEFAX_TRACK_ROWS || pending.reduce((sum, p) => sum + p.z, 0) < WEFAX_TRACK_STEPS) return next();
  // Taken: the line moved to the step (and turned, when the rows' own slope is clearly not the one followed: the measurements before
  // it are then no guide), and the rows since it began read again
  if (Math.abs(slope) > px)
  {
    T.slope = Math.max(-most, Math.min(most, T.slope + slope));
    T.points = [];
  }
  else for (const p of T.points) p[1] += last.off;
  T.a = expect + last.off - T.slope * r;
  T.pending = [];
  T.matched = r;
  const from = Math.max(first.r, T.floor);
  T.floor = r + 1;
  pic.rendered = from;
  pic.adjust = T.a + T.slope * from;
  return from;
}

// ---- Messages

function wefaxConfig(data)
{
  const c = WF.config;
  if (data.lpm !== undefined) c.lpm = WEFAX_LPMS.includes(Number(data.lpm)) ? Number(data.lpm) : "auto";
  if (data.ioc !== undefined) c.ioc = data.ioc == 576 || data.ioc == 288 ? Number(data.ioc) : "auto";
  const trim = data.trim !== undefined ? Math.max(-2000, Math.min(2000, Number(data.trim) || 0)) : c.trim;
  const align = data.align !== undefined ? Math.max(0, Math.min(1, Number(data.align) || 0)) : c.align;
  const moved = trim != c.trim || align != c.align;
  // (the rows' line-start markers found so far were measured at the old line rate)
  if (WF.pic && trim != c.trim) WF.pic.mark.fill(NaN);
  c.trim = trim;
  c.align = align;
  // Following the chart's lines turned on, or the rows moved by hand: begun again from the rows to come (where they're read from kept)
  const track = data.track !== undefined ? !!data.track : c.track;
  if (WF.pic && ((track && !c.track) || moved)) wefaxTrackReset(WF.pic);
  c.track = track;
  if (moved) wefaxRedraw();
  if (data.startNow)
  {
    if (!WF.h) wefaxInit(12000);
    if (WF.pic) wefaxFinish(false);
    WF.ioc = c.ioc == "auto" ? 576 : c.ioc;
    WF.toneHeard = false;
    WF.offset = 0;
    wefaxSearch(WF.n, true);
  }
}

function wefaxMessage(data)
{
  if (data.type == "audio") wefaxFeed(data.samples);
  else if (data.type == "init") wefaxInit(data.rate);
  else if (data.type == "reset") wefaxReset();
  else if (data.type == "config") wefaxConfig(data);
  else if (data.type == "stop")
  {
    if (WF.pic) wefaxFinish(false);
    wefaxIdle();
  }
}

if (WEFAX_IN_WORKER) onmessage = (event) => wefaxMessage(event.data);

// Offline tests (Node): the same functions, with what it says sent where the test wants
if (typeof module != "undefined") module.exports = { WF, wefaxMessage };
