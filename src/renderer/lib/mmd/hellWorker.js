// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Multi-Mode Decoder's Hellschreiber mode: Feld-Hell (and its faster forms X5 and X9), received the way Rudolf Hell's machines
// printed it (his Feldfernschreiber of the late 1920s and 1930s): a strip of columns read straight from the tone's loudness, with no
// framing, no error check and no characters decided. The eye reads the print. Written from published descriptions of the mode (the Feld
// Hell Club's description of Feld-Hell; Murray Greenman, ZL1BPU, on Hellschreiber modes; the Wikipedia article "Hellschreiber"); no
// other program's code is used.
//   Feld-Hell: each character is 7 columns, each column 14 pixels sent from the bottom up, the tone on for a black pixel. 2.5 characters
//   a second, so 17.5 columns and 245 pixels a second: a pixel is 4.08 ms, and the smallest mark the font uses (two pixels, one dot of
//   its 7 dot high characters) 8.16 ms, the mode's 122.5 baud. Keyed with soft edges it takes about 350 Hz. X5 and X9 are the same at
//   five and nine times the speed.
//   The audio is brought down to about 12 kHz, mixed down from the signal's centre, filtered (a low-pass of half the bandwidth either
//   side of the centre), and its envelope taken. Each column is read as HELL_ROWS rows (each pixel twice), each row the envelope averaged
//   over its time, at the mode's column rate less a small trim (a sender's or a sound card's clock a little off slants the print; the
//   trim straightens it). An AGC follows the tone's peak and the noise under it, and a row's brightness is where it lies between them.
//   Each column sent out holds two columns' time, one above the other, as Hell's receivers printed it twice (their helix had two turns):
//   a print that's mistimed and wraps out of one copy is whole in the other.
//   The centre: the one given (a click on the waterfall), or else the strongest on-off keyed carrier between minHz and maxHz. Ten times
//   a second a spectrum (an FFT, averaged over a couple of seconds) is taken, and each place's power in a band about it followed: how
//   much it is over the noise, and how much it changes frame to frame (a keyed signal's does, a steady carrier's doesn't). One found in
//   HELL_FIND_FRAMES frames running is locked; while locked it's followed as it drifts, and another takes over only when it's twice as
//   strong for a second, or the one locked has gone.
// Columns are sent only once there's a centre. Nothing is ever decided, so noise prints as noise.
// In:  { type: "init", rate }, { type: "audio", samples }, { type: "reset" },
//      { type: "config", mode: "feld" | "x5" | "x9", center (Hz, or null: found), minHz, maxHz (where the centre is looked for),
//      bandwidth (Hz, or null: the mode's), trim (ppm: positive reads faster; print running downhill to the right wants it raised) }
//      (each field optional: those left out stay as they were)
// Out: { type: "columns", center, count, rows, pixels }: count columns (Uint8Array, count * rows, column after column, each from its top
//      row down; 0 nothing, 255 the tone's full level), rows HELL_ROWS * 2 (the newer column's copy above the older one's), after each
//      audio block that completed any;
//      { type: "lock", center (Hz, or null), snr (dB, the signal's average power over the noise in the bandwidth), auto (found, not
//      given) } when the centre is found or moves, and once a second while there is one

// Each mode's columns a second, and the bandwidth it's filtered to unless another is given (Hz; narrower than the signal: the print is
// a little softer, but the noise much less, and weak signals read better)
const HELL_MODES = {
  feld: { columns: 17.5, bandwidth: 200 },
  x5: { columns: 87.5, bandwidth: 1000 },
  x9: { columns: 157.5, bandwidth: 1800 }
};
// Rows each column is read as: its 14 pixels, each twice
const HELL_ROWS = 28;
// The highest audio frequency kept (Hz), and the rate it's brought down to (about)
const HELL_TOP_HZ = 5000;
const HELL_WORK_RATE = 12000;
// The envelope is worked out at least this many times a row (fewer only at X9's speed)
const HELL_ENV_PER_ROW = 8;
// The filter's length: this many periods of its bandwidth (a longer one is sharper, but blurs the pixels)
const HELL_FIR_SPAN = 4;
// The trim allowed either way (ppm)
const HELL_TRIM_MAX = 50000;
// The AGC (seconds): the peak follows the tone up in HELL_ATTACK and down in HELL_DECAY, the noise under it down in HELL_ATTACK and up
// in HELL_FLOOR_RISE; the peak is kept at least HELL_CONTRAST times the noise, so noise alone prints dim
const HELL_ATTACK = 0.01;
const HELL_DECAY = 4;
const HELL_FLOOR_RISE = 1;
const HELL_CONTRAST = 3;
// The spectrum: its bins (about, Hz), its averaging (each new one's share), frames needed before the centre is looked for
const HELL_BIN_HZ = 12;
const HELL_SPECTRUM_SHARE = 0.06;
const HELL_SPECTRUM_FRAMES = 10;
// A spectrum's lower quarter, taken as its noise, is below the noise's average: brought up by this
const HELL_FLOOR_BIAS = 1.2;
// A centre is found where the band about it (half the bandwidth wide) holds this share over the noise there, and its power's swing from
// frame to frame (less the noise's own) is this share of it
const HELL_FIND_OVER = 0.6;
const HELL_KEYED = 0.25;
// Frames running a centre must be found in to lock (none locked), or to take over from the one locked; how much stronger that must be
const HELL_FIND_FRAMES = 3;
const HELL_MOVE_FRAMES = 10;
const HELL_MOVE_RATIO = 2;
// The share of the way a locked centre moves to where it's found each frame (it drifts)
const HELL_AFC = 0.2;
// The lock is sent again when the centre has moved this far (Hz), or a second on
const HELL_MOVED_HZ = 3;

let hellRate = 48000;
let hellMode = "feld";
let hellMinHz = 300;
let hellMaxHz = 3000;
// The centre given (a click on the waterfall), or null: found
let hellManual = null;
let hellBandwidthSet = null;
let hellBandwidth = 350;
let hellTrim = 0;
// The rate the work's done at, and the stage bringing the audio down to it
let hellFd = 12000;
let hellFront = null;
// Samples (at hellFd) so far, and the newest of them for the spectrum
let hellNow = 0;
let hellHistory = new Float32Array(1);
let hellHistoryMask = 0;
let hellSpec = null;
// The centre printed at (Hz, or null), the mixer's phase, the signal to noise ratio, where the finder is
let hellCenter = null;
let hellPhase = 0;
let hellSnr = -30;
let hellCandidate = null;
let hellPosted = { center: null, frames: 0 };
// The filter and envelope ({ taps, n, re, im, pos, step, count })
let hellFilter = null;
// Reading rows: a row's length (envelope samples), what's added up of the row so far and how much is left of it
let hellRowLength = 1;
let hellSum = 0;
let hellLeft = 1;
// The column being read (rows in time order, the first the bottom), the one before it (for the twin print), and the AGC
let hellColumn = new Float32Array(HELL_ROWS);
let hellRow = 0;
let hellPrevious = null;
let hellPeak = 0;
let hellFloor = 0;
let hellAgc = { attack: 0.3, decay: 0.001, rise: 0.003 };
// Columns ready to send
let hellOut = [];

self.onmessage = (event) =>
{
  const m = event.data;
  if (m.type == "init") hellInit(m.rate);
  else if (m.type == "reset") hellInit(hellRate);
  else if (m.type == "config") hellConfig(m);
  else if (m.type == "audio")
  {
    if (!hellFront) hellInit(hellRate);
    hellAudio(m.samples);
  }
};

function hellInit(rate)
{
  hellRate = rate > 0 ? rate : 48000;
  const d = Math.max(1, Math.floor(hellRate / HELL_WORK_RATE));
  hellFd = hellRate / d;
  hellFront = hellDecimator(hellRate, d, Math.min(HELL_TOP_HZ, hellFd * 0.42));
  hellSpec = hellSpectrum();
  let size = 1;
  while (size < hellSpec.n) size *= 2;
  hellHistory = new Float32Array(size);
  hellHistoryMask = size - 1;
  hellNow = 0;
  hellCenter = hellManual;
  hellPhase = 0;
  hellSnr = -30;
  hellCandidate = null;
  hellPosted = { center: null, frames: 0 };
  hellPeak = 0;
  hellFloor = 0;
  hellOut = [];
  hellSetup();
}

// The settings: each one given changes; a new mode or bandwidth starts the print's reading over (the centre is kept)
function hellConfig(m)
{
  let rebuild = false;
  if ("mode" in m && HELL_MODES[m.mode] && m.mode != hellMode)
  {
    hellMode = m.mode;
    rebuild = true;
  }
  if ("bandwidth" in m)
  {
    const bw = Number(m.bandwidth);
    const set = m.bandwidth != null && Number.isFinite(bw) && bw > 0 ? Math.max(50, Math.min(bw, 4000)) : null;
    if (set != hellBandwidthSet)
    {
      hellBandwidthSet = set;
      rebuild = true;
    }
  }
  if ("minHz" in m || "maxHz" in m)
  {
    const min = Number("minHz" in m ? m.minHz : hellMinHz);
    const max = Number("maxHz" in m ? m.maxHz : hellMaxHz);
    hellMinHz = Number.isFinite(min) ? Math.max(50, Math.min(min, HELL_TOP_HZ - 100)) : 300;
    hellMaxHz = Number.isFinite(max) && max >= hellMinHz + 100 ? Math.min(max, HELL_TOP_HZ) : Math.max(hellMinHz + 100, 3000);
  }
  if ("trim" in m)
  {
    const trim = Number(m.trim);
    hellTrim = Number.isFinite(trim) ? Math.max(-HELL_TRIM_MAX, Math.min(trim, HELL_TRIM_MAX)) : 0;
  }
  if ("center" in m)
  {
    const c = Number(m.center);
    hellManual = m.center != null && Number.isFinite(c) && c > 0 ? Math.min(c, HELL_TOP_HZ) : null;
    hellCandidate = null;
    // A centre given is printed at straight away; back to finding, the one printed at is kept until the finder decides
    if (hellManual != null) hellCenter = hellManual;
    if (hellFront) hellPostLock();
  }
  // Before init, everything's set up there
  if (!hellFront) return;
  if (rebuild) hellSetup();
  else hellTiming();
}

// The filter, envelope rate and row timing for the mode and bandwidth; the column being read starts over
function hellSetup()
{
  const mode = HELL_MODES[hellMode];
  hellBandwidth = hellBandwidthSet || mode.bandwidth;
  hellFilter = hellLowPass(hellBandwidth / 2, mode.columns * HELL_ROWS);
  hellColumn = new Float32Array(HELL_ROWS);
  hellRow = 0;
  hellPrevious = null;
  hellSum = 0;
  hellTiming();
  hellLeft = hellRowLength;
  // The AGC's steps, per row
  const rows = mode.columns * HELL_ROWS;
  hellAgc = { attack: 1 - Math.exp(-1 / (rows * HELL_ATTACK)), decay: 1 - Math.exp(-1 / (rows * HELL_DECAY)), rise: 1 - Math.exp(-1 / (rows * HELL_FLOOR_RISE)) };
}

// A row's length in envelope samples, the trim taken in (positive: the rows shorter, read faster)
function hellTiming()
{
  const mode = HELL_MODES[hellMode];
  const envRate = hellFd / hellFilter.step;
  hellRowLength = envRate / (mode.columns * (1 + hellTrim * 1e-6) * HELL_ROWS);
  hellLeft = Math.min(hellLeft, hellRowLength);
}

// ---- The audio brought down to hellFd: a low-pass filter (a windowed sinc, Blackman) keeping up to top, worked out only for the samples
// kept (every dth)
function hellDecimator(rate, d, top)
{
  if (d <= 1) return (x) => Float32Array.from(x);
  const fd = rate / d;
  const pass = top + 100;
  // What's above fd less pass folds back above pass when brought down: the filter's way down fits between
  const width = Math.max(fd - 2 * pass, fd * 0.1);
  const n = Math.ceil((5.5 * rate) / width) | 1;
  const cut = fd / 2 / rate;
  const taps = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++)
  {
    const t = i - (n - 1) / 2;
    const sinc = t == 0 ? 2 * cut : Math.sin(2 * Math.PI * cut * t) / (Math.PI * t);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (n - 1));
    taps[i] = sinc * w;
    sum += taps[i];
  }
  for (let i = 0; i < n; i++) taps[i] /= sum;
  // Each sample written twice, so the last n are always side by side
  const buf = new Float64Array(2 * n);
  let pos = 0;
  let count = 0;
  return (x) =>
  {
    const out = new Float32Array(Math.ceil((x.length + count) / d) + 1);
    let k = 0;
    for (let j = 0; j < x.length; j++)
    {
      buf[pos] = buf[pos + n] = x[j];
      pos = pos + 1 == n ? 0 : pos + 1;
      if (++count < d) continue;
      count = 0;
      let s = 0;
      for (let i = 0; i < n; i++) s += taps[i] * buf[pos + i];
      out[k++] = s;
    }
    return out.subarray(0, k);
  };
}

// The low-pass the mixed-down signal goes through (cut Hz, a windowed sinc, Blackman, HELL_FIR_SPAN periods of the bandwidth long), worked
// out every step samples: often enough for HELL_ENV_PER_ROW envelope samples a row at rows a second
function hellLowPass(cut, rows)
{
  const n = Math.ceil((HELL_FIR_SPAN * hellFd) / (2 * cut)) | 1;
  const fc = cut / hellFd;
  const taps = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++)
  {
    const t = i - (n - 1) / 2;
    const sinc = t == 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * t) / (Math.PI * t);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * (i + 1)) / (n + 1)) + 0.08 * Math.cos((4 * Math.PI * (i + 1)) / (n + 1));
    taps[i] = sinc * w;
    sum += taps[i];
  }
  // Summing to 2: a tone at the centre of peak a comes out of size a
  for (let i = 0; i < n; i++) taps[i] *= 2 / sum;
  const step = Math.max(1, Math.floor(hellFd / (rows * HELL_ENV_PER_ROW)));
  return { taps, n, re: new Float64Array(2 * n), im: new Float64Array(2 * n), pos: 0, step, count: 0 };
}

// ---- Each block of audio: brought down, kept for the spectrum, mixed down from the centre and its envelope read into rows; the spectrum
// ten times a second; the columns completed sent
function hellAudio(samples)
{
  const x = hellFront(samples);
  const f = hellFilter;
  const taps = f.taps;
  const fre = f.re;
  const fim = f.im;
  const hop = Math.round(hellFd / 10);
  for (let j = 0; j < x.length; j++)
  {
    hellHistory[hellNow & hellHistoryMask] = x[j];
    hellNow++;
    if (hellNow % hop == 0) hellFrame();
    if (hellCenter == null) continue;
    hellPhase += (2 * Math.PI * hellCenter) / hellFd;
    if (hellPhase > Math.PI) hellPhase -= 2 * Math.PI;
    fre[f.pos] = fre[f.pos + f.n] = x[j] * Math.cos(hellPhase);
    fim[f.pos] = fim[f.pos + f.n] = -x[j] * Math.sin(hellPhase);
    f.pos = f.pos + 1 == f.n ? 0 : f.pos + 1;
    if (++f.count < f.step) continue;
    f.count = 0;
    let re = 0;
    let im = 0;
    for (let i = 0, p = f.pos, n = f.n; i < n; i++, p++)
    {
      re += taps[i] * fre[p];
      im += taps[i] * fim[p];
    }
    hellEnvelope(Math.sqrt(re * re + im * im));
  }
  if (hellOut.length == 0) return;
  const rows = 2 * HELL_ROWS;
  const pixels = new Uint8Array(hellOut.length * rows);
  for (let i = 0; i < hellOut.length; i++) pixels.set(hellOut[i], i * rows);
  self.postMessage({ type: "columns", center: hellCenter == null ? null : Math.round(hellCenter * 10) / 10, count: hellOut.length, rows, pixels }, [pixels.buffer]);
  hellOut = [];
}

// One envelope sample, its time shared out between the rows it falls in (a row is hellRowLength samples, not a whole number)
function hellEnvelope(v)
{
  let w = 1;
  while (w > 0)
  {
    const take = Math.min(w, hellLeft);
    hellSum += v * take;
    hellLeft -= take;
    w -= take;
    if (hellLeft > 1e-9) continue;
    hellAddRow(hellSum / hellRowLength);
    hellSum = 0;
    hellLeft += hellRowLength;
  }
}

// A row read: through the AGC into the column; a column complete goes out with the one before it below it (each copy from its newest
// row, the top, down)
function hellAddRow(v)
{
  const a = hellAgc;
  // The first row starts the AGC (what's first heard taken as noise, until more's known)
  if (hellPeak == 0) hellPeak = hellFloor = v;
  if (v > hellPeak) hellPeak += (v - hellPeak) * a.attack;
  else hellPeak += (v - hellPeak) * a.decay;
  if (v < hellFloor) hellFloor += (v - hellFloor) * a.attack;
  else hellFloor += (v - hellFloor) * a.rise;
  const top = Math.max(hellPeak, hellFloor * HELL_CONTRAST, 1e-9);
  const b = (v - hellFloor) / (top - hellFloor);
  hellColumn[hellRow++] = Math.round(255 * Math.max(0, Math.min(1, b)));
  if (hellRow < HELL_ROWS) return;
  hellRow = 0;
  const twin = new Uint8Array(2 * HELL_ROWS);
  for (let r = 0; r < HELL_ROWS; r++)
  {
    twin[r] = hellColumn[HELL_ROWS - 1 - r];
    if (hellPrevious) twin[HELL_ROWS + r] = hellPrevious[HELL_ROWS - 1 - r];
  }
  hellPrevious = Uint8Array.from(hellColumn);
  hellOut.push(twin);
}

// ---- The spectrum: an FFT of the last n samples (a Hann window); each bin's power averaged frame to frame, and the power in a band
// about each bin, averaged with its square (how much it swings)
function hellSpectrum()
{
  let n = 1;
  while (n < hellFd / HELL_BIN_HZ) n *= 2;
  const win = new Float64Array(n);
  for (let i = 0; i < n; i++) win[i] = Math.pow(Math.sin((Math.PI * i) / n), 2);
  const half = n / 2;
  return { n, win, fft: hellFft(n), re: new Float64Array(n), im: new Float64Array(n), avg: new Float64Array(half), mean: new Float64Array(half),
    square: new Float64Array(half), cum: new Float64Array(half + 1), binHz: hellFd / n, frames: 0 };
}

// A complex FFT in place (radix 2), n a power of 2
function hellFft(n)
{
  const bits = Math.round(Math.log2(n));
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++)
  {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++)
  {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  return (re, im) =>
  {
    for (let i = 0; i < n; i++)
    {
      const j = rev[i];
      if (j <= i) continue;
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
    for (let size = 2; size <= n; size *= 2)
    {
      const half = size / 2;
      const step = n / size;
      for (let i = 0; i < n; i += size)
      {
        for (let j = 0; j < half; j++)
        {
          const a = i + j;
          const b = a + half;
          const c = cos[j * step];
          const s = sin[j * step];
          const tr = re[b] * c + im[b] * s;
          const ti = im[b] * c - re[b] * s;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  };
}

// The value a quarter of the way up a list of numbers
function hellQuarter(values)
{
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 4)] || 0;
}

// ---- Ten times a second: the spectrum taken, the centre looked for (or followed), the SNR measured, the lock sent when it changed
function hellFrame()
{
  const sp = hellSpec;
  if (hellNow < sp.n) return;
  for (let i = 0; i < sp.n; i++)
  {
    sp.re[i] = hellHistory[(hellNow - sp.n + i) & hellHistoryMask] * sp.win[i];
    sp.im[i] = 0;
  }
  sp.fft(sp.re, sp.im);
  const half = sp.n / 2;
  // At first a plain average of the frames so far (the first one not standing for the rest)
  const share = Math.max(HELL_SPECTRUM_SHARE, 1 / (sp.frames + 1));
  for (let k = 0; k < half; k++)
  {
    const p = sp.re[k] * sp.re[k] + sp.im[k] * sp.im[k];
    sp.avg[k] += (p - sp.avg[k]) * share;
    sp.cum[k + 1] = sp.cum[k] + p;
  }
  // The band about each bin: half the bandwidth wide
  const h = Math.max(1, Math.round(hellBandwidth / 4 / sp.binHz));
  for (let k = 0; k < half; k++)
  {
    const b = sp.cum[Math.min(half, k + h + 1)] - sp.cum[Math.max(0, k - h)];
    sp.mean[k] += (b - sp.mean[k]) * share;
    sp.square[k] += (b * b - sp.square[k]) * share;
  }
  sp.frames++;
  if (sp.frames < HELL_SPECTRUM_FRAMES) return;
  // The noise: from the range looked over, and about the centre (one given may be outside it)
  let lo = hellMinHz;
  let hi = hellMaxHz;
  if (hellCenter != null)
  {
    lo = Math.min(lo, hellCenter - 500);
    hi = Math.max(hi, hellCenter + 500);
  }
  const k0 = Math.max(h + 1, Math.floor(lo / sp.binHz));
  const k1 = Math.min(half - h - 2, Math.ceil(hi / sp.binHz));
  const powers = [];
  const swings = [];
  for (let k = k0; k <= k1; k++)
  {
    powers.push(sp.avg[k]);
    swings.push(Math.max(0, sp.square[k] - sp.mean[k] * sp.mean[k]));
  }
  const noise = hellQuarter(powers) * HELL_FLOOR_BIAS;
  const noiseBand = noise * (2 * h + 1);
  const noiseSwing = hellQuarter(swings) * HELL_FLOOR_BIAS;
  // Where a band is far enough over the noise, and its power swings: keyed. The strongest such between minHz and maxHz
  const over = (k) => sp.mean[k] - noiseBand;
  const keyed = (k) => over(k) >= HELL_FIND_OVER * noiseBand && Math.sqrt(Math.max(0, sp.square[k] - sp.mean[k] * sp.mean[k] - noiseSwing)) >= HELL_KEYED * over(k);
  const f0 = Math.max(h + 1, Math.ceil(hellMinHz / sp.binHz));
  const f1 = Math.min(half - h - 2, Math.floor(hellMaxHz / sp.binHz));
  let best = -1;
  for (let k = f0; k <= f1; k++) if (keyed(k) && (best < 0 || over(k) > over(best))) best = k;
  let found = null;
  if (best >= 0)
  {
    // Between its neighbors: a parabola through the three
    const a = sp.mean[best - 1];
    const b = sp.mean[best];
    const c = sp.mean[best + 1];
    const den = a - 2 * b + c;
    const delta = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
    found = (best + delta) * sp.binHz;
  }
  if (hellManual == null) hellFollow(found, best >= 0 ? over(best) : 0, over, sp.binHz);
  // The SNR: the power over the noise within the bandwidth about the centre
  if (hellCenter != null)
  {
    const kc = Math.round(hellCenter / sp.binHz);
    const hb = Math.max(1, Math.round(hellBandwidth / 2 / sp.binHz));
    let signal = 0;
    for (let k = Math.max(1, kc - hb); k <= Math.min(half - 1, kc + hb); k++) signal += sp.avg[k] - noise;
    const n = noise * (2 * hb + 1);
    hellSnr = n > 0 ? 10 * Math.log10(Math.max(signal, n * 1e-3) / n) : -30;
  }
  hellPosted.frames++;
  if (hellCenter != null && (hellPosted.center == null || Math.abs(hellCenter - hellPosted.center) >= HELL_MOVED_HZ || hellPosted.frames >= 10)) hellPostLock();
}

// The centre found (Hz, or null) and its band's power over the noise: the one locked followed as it drifts; another (or the first)
// locked when found HELL_FIND_FRAMES frames running with none locked, or HELL_MOVE_FRAMES running HELL_MOVE_RATIO times as strong as what's
// at the one locked (gone, that's nothing)
function hellFollow(found, strength, over, binHz)
{
  const near = hellBandwidth / 4;
  if (found == null) return;
  if (hellCenter != null && Math.abs(found - hellCenter) <= near)
  {
    hellCenter += (found - hellCenter) * HELL_AFC;
    hellCandidate = null;
    return;
  }
  if (hellCandidate && Math.abs(found - hellCandidate.freq) <= near)
  {
    hellCandidate.freq = found;
    hellCandidate.frames++;
  }
  else hellCandidate = { freq: found, frames: 1 };
  let needed = HELL_FIND_FRAMES;
  if (hellCenter != null) needed = strength >= HELL_MOVE_RATIO * Math.max(0, over(Math.round(hellCenter / binHz))) ? HELL_MOVE_FRAMES : Infinity;
  if (hellCandidate.frames < needed) return;
  hellCenter = hellCandidate.freq;
  hellCandidate = null;
  hellPostLock();
}

function hellPostLock()
{
  hellPosted = { center: hellCenter, frames: 0 };
  self.postMessage({ type: "lock", center: hellCenter == null ? null : Math.round(hellCenter * 10) / 10, snr: Math.round(hellSnr), auto: hellManual == null });
}
