// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Multi-Mode Decoder's MFSK mode: MFSK16 or MFSK32 (config's mode), every signal in the passband at once, as the keyboard modes'
// worker (keyWorker.js) lists every PSK31 or RTTY signal.
//   How the modes are sent (Murray Greenman's, ZL1BPU, and Nino Porcino's, IZ8BLY, published description of MFSK): 16 tones a baud
//   apart (MFSK16 15.625 baud, MFSK32 31.25), one at a time, continuous phase, each carrying 4 bits: tone t (0 the lowest) carries the
//   bits t ^ (t >> 1), the Gray code of t, so neighbouring tones differ in one bit (Olivia's is the other way round). The text: each
//   character's code in IZ8BLY's MFSK varicode (every code starts with a 1 and ends with 00, with no 001 in it, so the next code's first
//   1 ends it), through a rate 1/2, K = 7 convolutional code (the NASA polynomials: for each bit in, two out, the parity of the last
//   seven bits under 0x6D and then under 0x4F, bit 0 the newest); four coded bits to a symbol, the first its top bit; then ten of
//   IZ8BLY's 4 x 4 diagonal interleavers one after another, which come to each symbol's top bit going out as it is and each bit below
//   it 10 symbols later than the one above (the lowest 30 symbols late). Idle is zeros (the lowest tone); a character with nothing
//   after it is ended by one that prints nothing.
//   Here: the audio brought down to about 8 kHz (a low-pass filter, every Nth sample kept). The finder: four times a symbol an FFT of
//   the last symbol's length of audio, and from it, every half a tone spacing across the passband and at each of the four timings, a
//   candidate signal's 16 tone energies, and how much its strongest tone stands out (conc, averaged: noise's about 0.21). Only where
//   that's over noise's, its soft bits, the interleaver undone and the code's Viterbi decoder run, for how well the bits fit the code
//   (q: the best path's gain over the most it could gain, about 0.88 for noise, whose bits a rate 1/2 code can always fit fairly well,
//   and near 1 for a clean signal). A candidate whose q stays well over noise's, its tones changing (not a carrier), whose strongest tone
//   stands out more than any other's overlapping it (not a strong signal read a few tones off), gets its own channel, which first runs
//   over the last 200 symbols of audio (kept for this), so a signal's first words aren't lost while the finder made up its mind.
//   A channel: mixed down at its centre, filtered and brought down to about 64 samples a symbol (complex), the 16 tones' energies 8
//   times a symbol over a symbol's length (each a DFT), the symbol clock where the strongest tone stands out most, an AFC from how the
//   strongest tone's phase turns over a symbol (which follows drift), soft bits, the interleaver undone, the Viterbi decoder (its
//   decisions traced back 48 bits), then the varicode.
//   A character goes out only when the code fitted well (q) over its bits and 40 steps either side, and over each side alone; where the
//   symbols its bits came in stood out of the noise (not the interleaver mixing a signal's start or end with the noise around it); and
//   once its stretch of good decoding has shown MFSK's spread of tones (MFSK_SPREAD). So noise, carriers (which decode as all 0s or 1s,
//   no characters) and other modes print nothing. A channel nothing comes from for 15 s is dropped; one that printed nothing in its
//   first 10 s too, and the place it was then isn't tried again for 15 s. A channel's id stays the same while it's tracked.
// In:  { type: "init", rate }, { type: "audio", samples (Float32Array at rate, about 0.1 s) }, { type: "reset" },
//      { type: "config", mode: "mfsk16" | "mfsk32", minHz, maxHz } (the passband signals' centres are looked for in),
//      { type: "rsid", freq } (an RSID for this mode was just heard, freq its centre: a signal there is taken on more readily for a while)
// Out: { type: "channels", list: [{ id, freq (Hz: the centre, midway between the lowest and highest tones), snr (dB in the signal's own
//      bandwidth, 16 spacings), active, mode }] } four times a second (channels that have printed something);
//      { type: "text", id, text }: what a channel decoded since its last one, every 100 ms or so

// The submodes: baud (also the tone spacing, Hz) and the interleavers one after another
const MFSK_SUBMODES = {
  mfsk16: { baud: 15.625, depth: 10 },
  mfsk32: { baud: 31.25, depth: 10 }
};
const MFSK_TONES = 16;
// The code's polynomials (bit 0 the newest bit), the first's bit sent first
const MFSK_POLY1 = 0x6d;
const MFSK_POLY2 = 0x4f;
// The highest audio frequency kept (Hz), and the rate it's brought down to (about)
const MFSK_TOP_HZ = 4000;
const MFSK_WORK_RATE = 8000;
// The finder: timings a symbol, places a tone spacing (each half a spacing apart), its FFT's bins no wider than this share of a spacing
const MFSK_PHASES = 4;
const MFSK_GRID = 0.5;
const MFSK_BIN_SHARE = 1 / 3.5;
// A symbol's 16 tone energies kept, and the noise in one
const MFSK_KEEP = MFSK_TONES + 1;
// Soft bits: the energies over the noise's times this, kept within the clip
const MFSK_SOFT_GAIN = 1;
const MFSK_SOFT_CLIP = 12;
// conc (the strongest tone's share of the 16's energy: noise's about 0.21) averaged, each symbol's share; a candidate is worked out
// (awake) while it's over the first, until under the second
const MFSK_CONC_SHARE = 1 / 16;
const MFSK_WAKE = 0.25;
const MFSK_SLEEP = 0.235;
// q averaged: each Viterbi step's share (the finder's, the channel's); the finder's steps worked out before its q is trusted
const MFSK_FIND_SHARE = 1 / 48;
const MFSK_Q_SHARE = 1 / 64;
const MFSK_FIND_STEPS = 64;
// The finder takes a candidate on when its q is over the first (the second for a while after an RSID near it), its tones changing
// this share of symbols (averaged)
const MFSK_FIND_Q = 0.92;
const MFSK_FIND_Q_RSID = 0.89;
const MFSK_CHANGES = 0.3;
// A character goes out when q over its bits and this many steps either side is over the first, and over the steps after it alone the
// second (noise's q over 64 to 96 steps came to 0.937 at most in half an hour of channels on noise; a signal's is 0.98 or more down to
// about -14 dB, MFSK32 -12 dB, in 3 kHz). The steps after alone stop the characters at a signal's end, decoded from it and the noise
// after it together
const MFSK_CHAR_SIDE = 40;
const MFSK_CHAR_Q = 0.945;
const MFSK_SIDE_Q = 0.92;
// The varicode is read only where q over this many steps either side of the bit is over MFSK_SIDE_Q, and the signal was there when its
// bits came: the strongest tones of the symbols they came in (five averaged) this many times the noise in a tone (noise's own about 3.4)
const MFSK_SYNC_SIDE = 24;
const MFSK_STAND = 5;
// A stretch of good decoding prints only once, somewhere in it, the strongest tones of the last MFSK_SPREAD_SYMBOLS symbols were
// spread as MFSK's are (its coded, interleaved bits come out near random): of those standing out (MFSK_STAND) and not the idle tone
// (0), at least a third of them, two picked at random (without putting the first back) the same tone less often than this (15 tones
// evenly 0.067, 8 tones 0.125: a strong signal read 8 tones off). Other modes read as MFSK, which can fit the code where they hold a
// tone or two for a while (SSTV, Olivia, RTTY), don't print. Its characters wait meanwhile (at most MFSK_PENDING), and are dropped if
// it ends first
const MFSK_SPREAD_SYMBOLS = 64;
const MFSK_SPREAD = 0.095;
const MFSK_PENDING = 400;
// A channel is active while its q (averaged) is over the first, until under the second
const MFSK_OPEN = 0.94;
const MFSK_CLOSE = 0.92;
// The Viterbi decoder's decisions traced back this many steps; this many kept
const MFSK_TRACEBACK = 48;
const MFSK_RING = 128;
// A channel: hops a symbol (for its clock), samples a symbol it works at (about)
const MFSK_SLOTS = 8;
const MFSK_SPS = 64;
// The AFC: a symbol's strongest tone counts when it holds this share of the tones' energy; each symbol's share of the error, at first
// and after
const MFSK_AFC_CONC = 0.45;
const MFSK_AFC_FAST = 0.15;
const MFSK_AFC_SLOW = 0.04;
const MFSK_AFC_FAST_SYMBOLS = 48;
// At most this many channels at once
const MFSK_MAX = 8;
// Seconds: a channel with nothing for this long is dropped; one that never printed is given this long; the place it was then isn't
// tried again for this long; after an RSID a signal near it is taken on more readily for this long
const MFSK_DROP_SECONDS = 15;
const MFSK_TRIAL_SECONDS = 10;
const MFSK_BLOCK_SECONDS = 15;
const MFSK_RSID_SECONDS = 12;
// A channel that decoded well this recently keeps the places overlapping its tones to itself
const MFSK_HOLD_SECONDS = 3;
// Symbols of audio kept, and run through a new channel before it goes on live
const MFSK_HISTORY_SYMBOLS = 200;

// IZ8BLY's MFSK varicode for character codes 0 to 255 (ISO 8859-1), each with its closing 00, the left bit sent first
const MFSK_VARICODE_BITS = [
  "11101011100", "11101100000", "11101101000", "11101101100", "11101110000", "11101110100", "11101111000", "11101111100",
  "10101000", "11110000000", "11110100000", "11110101000", "11110101100", "10101100", "11110110000", "11110110100",
  "11110111000", "11110111100", "11111000000", "11111010000", "11111010100", "11111011000", "11111011100", "11111100000",
  "11111101000", "11111101100", "11111110000", "11111110100", "11111111000", "11111111100", "100000000000", "101000000000",
  "100", "111000000", "111111100", "1011011000", "1010101000", "1010100000", "1000000000", "110111100",
  "111110100", "111110000", "1010110100", "111100000", "10100000", "111011000", "111010100", "111101000",
  "11100000", "11110000", "101000000", "101010100", "101110100", "101100000", "101101100", "110100000",
  "110000000", "110101100", "111101100", "111111000", "1011000000", "111011100", "1010111100", "111010000",
  "1010000000", "10111100", "100000000", "11010100", "11011100", "10111000", "11111000", "101010000",
  "101011000", "11000000", "110110100", "101111100", "11110100", "11101000", "11111100", "11010000",
  "11101100", "110110000", "11011000", "10110100", "10110000", "101011100", "110101000", "101101000",
  "101110000", "101111000", "110111000", "1011101000", "1011010000", "1011101100", "1011010100", "1010110000",
  "1010101100", "10100", "1100000", "111000", "110100", "1000", "1010000", "1011000",
  "110000", "11000", "10000000", "1110000", "101100", "1000000", "11100", "10000",
  "1010100", "1111000", "100000", "101000", "1100", "111100", "1101100", "1101000",
  "1110100", "1011100", "1111100", "1011011100", "1010111000", "1011100000", "1011110000", "101010000000",
  "101010100000", "101010101000", "101010101100", "101010110000", "101010110100", "101010111000", "101010111100", "101011000000",
  "101011010000", "101011010100", "101011011000", "101011011100", "101011100000", "101011101000", "101011101100", "101011110000",
  "101011110100", "101011111000", "101011111100", "101100000000", "101101000000", "101101010000", "101101010100", "101101011000",
  "101101011100", "101101100000", "101101101000", "101101101100", "101101110000", "101101110100", "101101111000", "101101111100",
  "1011110100", "1011111000", "1011111100", "1100000000", "1101000000", "1101010000", "1101010100", "1101011000",
  "1101011100", "1101100000", "1101101000", "1101101100", "1101110000", "1101110100", "1101111000", "1101111100",
  "1110000000", "1110100000", "1110101000", "1110101100", "1110110000", "1110110100", "1110111000", "1110111100",
  "1111000000", "1111010000", "1111010100", "1111011000", "1111011100", "1111100000", "1111101000", "1111101100",
  "1111110000", "1111110100", "1111111000", "1111111100", "10000000000", "10100000000", "10101000000", "10101010000",
  "10101010100", "10101011000", "10101011100", "10101100000", "10101101000", "10101101100", "10101110000", "10101110100",
  "10101111000", "10101111100", "10110000000", "10110100000", "10110101000", "10110101100", "10110110000", "10110110100",
  "10110111000", "10110111100", "10111000000", "10111010000", "10111010100", "10111011000", "10111011100", "10111100000",
  "10111101000", "10111101100", "10111110000", "10111110100", "10111111000", "10111111100", "11000000000", "11010000000",
  "11010100000", "11010101000", "11010101100", "11010110000", "11010110100", "11010111000", "11010111100", "11011000000",
  "11011010000", "11011010100", "11011011000", "11011011100", "11011100000", "11011101000", "11011101100", "11011110000",
  "11011110100", "11011111000", "11011111100", "11100000000", "11101000000", "11101010000", "11101010100", "11101011000"
];
// A code (its bits as a number: each starts with a 1) to its character
const MFSK_VARICODE = new Map(MFSK_VARICODE_BITS.map((bits, code) => [parseInt(bits, 2), code]));

// For each of the code's 128 registers (the state before and the new bit), its two bits out as 0 to 3 (the first the higher)
const MFSK_OUT = (() =>
{
  const parity = (n) =>
  {
    n ^= n >> 4;
    n ^= n >> 2;
    n ^= n >> 1;
    return n & 1;
  };
  const out = new Uint8Array(128);
  for (let reg = 0; reg < 128; reg++) out[reg] = (parity(reg & MFSK_POLY1) << 1) | parity(reg & MFSK_POLY2);
  return out;
})();
// For each of a symbol's bits p (0 the top) and tone t, at p * 16 + t: 1 when tone t carries it as a 1 (tone t carries t ^ (t >> 1))
const MFSK_BIT = (() =>
{
  const bit = new Uint8Array(4 * MFSK_TONES);
  for (let p = 0; p < 4; p++) for (let t = 0; t < MFSK_TONES; t++) bit[p * MFSK_TONES + t] = ((t ^ (t >> 1)) >> (3 - p)) & 1;
  return bit;
})();

let mfskRate = 48000;
let mfskMode = "mfsk16";
let mfskMinHz = 200;
let mfskMaxHz = 3000;
// The submode: baud (and spacing), interleavers, and the ring the interleaver is undone in (symbols)
let mfskBaud = 15.625;
let mfskDepth = 10;
let mfskSpan = 32;
// The rate the work's done at, the highest frequency kept, and the stage bringing the audio down to it
let mfskFd = 8000;
let mfskTop = MFSK_TOP_HZ;
let mfskFront = null;
// Samples (at mfskFd) so far: the clock everything's timed by
let mfskNow = 0;
let mfskHistory = new Float32Array(1);
let mfskHistoryMask = 0;
let mfskFinder = null;
let mfskChannels = [];
let mfskNextId = 1;
let mfskBlocked = [];
let mfskRsidHints = [];
let mfskLastFlush = 0;
let mfskLastList = 0;
// Work arrays: the four branch metrics, a step's new path metrics, a symbol's tone energies
const mfskBranch = new Float64Array(4);
const mfskNext = new Float64Array(64);
const mfskE = new Float64Array(MFSK_TONES);

self.onmessage = (event) =>
{
  const m = event.data;
  if (m.type == "init")
  {
    mfskRate = m.rate > 0 ? m.rate : 48000;
    mfskInit();
  }
  else if (m.type == "reset")
  {
    mfskInit();
    mfskPostChannels();
  }
  else if (m.type == "config") mfskConfig(m);
  else if (m.type == "rsid") mfskRsid(Number(m.freq));
  else if (m.type == "audio")
  {
    if (!mfskFront) mfskInit();
    mfskAudio(m.samples);
  }
};

// ---- Everything set up again for the rate and submode: nothing heard is kept
function mfskInit()
{
  const sub = MFSK_SUBMODES[mfskMode];
  mfskBaud = sub.baud;
  mfskDepth = sub.depth;
  mfskSpan = 1;
  while (mfskSpan < 3 * mfskDepth + 1) mfskSpan *= 2;
  const d = Math.max(1, Math.floor(mfskRate / MFSK_WORK_RATE));
  mfskFd = mfskRate / d;
  mfskTop = Math.min(MFSK_TOP_HZ, mfskFd * 0.42);
  mfskFront = mfskDecimator(mfskRate, d, mfskTop);
  let size = 1;
  while (size < (mfskFd * MFSK_HISTORY_SYMBOLS) / mfskBaud) size *= 2;
  mfskHistory = new Float32Array(size);
  mfskHistoryMask = size - 1;
  mfskNow = 0;
  mfskLastFlush = 0;
  mfskLastList = 0;
  mfskChannels = [];
  mfskBlocked = [];
  mfskRsidHints = [];
  mfskFinder = mfskFinderSetup();
}

// The submode and range: another submode starts over; another range sets the finder up again (its candidates are where the range is)
// and drops the channels outside it
function mfskConfig(m)
{
  const mode = MFSK_SUBMODES[m.mode] ? m.mode : "mfsk16";
  const min = Number(m.minHz);
  const max = Number(m.maxHz);
  const minHz = Number.isFinite(min) ? Math.max(100, Math.min(min, MFSK_TOP_HZ - 300)) : 200;
  const maxHz = Number.isFinite(max) && max >= minHz + 100 ? Math.min(max, MFSK_TOP_HZ) : Math.max(minHz + 100, 3000);
  if (mode != mfskMode)
  {
    mfskFlush();
    mfskMode = mode;
    mfskMinHz = minHz;
    mfskMaxHz = maxHz;
    mfskInit();
    mfskPostChannels();
    return;
  }
  if (minHz == mfskMinHz && maxHz == mfskMaxHz) return;
  mfskMinHz = minHz;
  mfskMaxHz = maxHz;
  mfskFinder = mfskFinderSetup();
  mfskFlush();
  const before = mfskChannels.length;
  mfskChannels = mfskChannels.filter((c) => c.center() >= mfskMinHz - 20 && c.center() <= mfskMaxHz + 20);
  if (mfskChannels.length != before) mfskPostChannels();
}

// An RSID for this mode just heard at freq (its centre): a signal there is taken on more readily for a while
function mfskRsid(freq)
{
  if (!(freq > 0)) return;
  mfskRsidHints = mfskRsidHints.filter((h) => h.until > mfskNow);
  mfskRsidHints.push({ freq, until: mfskNow + MFSK_RSID_SECONDS * mfskFd });
  mfskBlocked = mfskBlocked.filter((b) => Math.abs(b.freq - freq) > 8 * mfskBaud);
}

// ---- The audio brought down by d: a low-pass filter (a windowed sinc, Blackman) keeping up to top, worked out only for the samples
// kept (every dth)
function mfskDecimator(rate, d, top)
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

// Three running sums of m samples one after another (a CIC filter's shape), as one filter: a channel's step down, from mfskFd to
// mfskFd / m. Its nulls fall on everything that would fold back onto the channel
function mfskBoxcar3(m)
{
  let t = new Float64Array(m).fill(1);
  for (let r = 0; r < 2; r++)
  {
    const next = new Float64Array(t.length + m - 1);
    for (let i = 0; i < t.length; i++) for (let k = 0; k < m; k++) next[i + k] += t[i];
    t = next;
  }
  const sum = t.reduce((s, v) => s + v, 0);
  return t.map((v) => v / sum);
}

// A complex FFT in place (radix 2), n a power of 2
function mfskFft(n)
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

// Bit p's soft value (positive for a 1; p 0 the top bit) from a symbol's 16 tone energies (e from base) and the noise in one: its
// strongest tone carrying a 1 against its strongest carrying a 0 (quick, the finder's), or every tone weighed by its energy (a channel's,
// better at low SNR)
function mfskSoftBit(e, base, noise, p, full)
{
  const scale = MFSK_SOFT_GAIN / noise;
  const row = p * MFSK_TONES;
  if (!full)
  {
    let m1 = 0;
    let m0 = 0;
    for (let t = 0; t < MFSK_TONES; t++)
    {
      const v = e[base + t];
      if (MFSK_BIT[row + t]) m1 = v > m1 ? v : m1;
      else m0 = v > m0 ? v : m0;
    }
    const s = (m1 - m0) * scale;
    return s > MFSK_SOFT_CLIP ? MFSK_SOFT_CLIP : s < -MFSK_SOFT_CLIP ? -MFSK_SOFT_CLIP : s;
  }
  let max = 0;
  for (let t = 0; t < MFSK_TONES; t++) if (e[base + t] > max) max = e[base + t];
  let s1 = 1e-300;
  let s0 = 1e-300;
  for (let t = 0; t < MFSK_TONES; t++)
  {
    const w = Math.exp((e[base + t] - max) * scale);
    if (MFSK_BIT[row + t]) s1 += w;
    else s0 += w;
  }
  const s = Math.log(s1 / s0);
  return s > MFSK_SOFT_CLIP ? MFSK_SOFT_CLIP : s < -MFSK_SOFT_CLIP ? -MFSK_SOFT_CLIP : s;
}

// One step of the Viterbi decoder over the path metrics m (64, from base; the best 0) for the two soft bits a, b (positive for a 1):
// each state's best way in kept (its oldest bit, in dec from decBase if given), the metrics set so the best is 0 again. Returns the best
// path's gain (with the state it's in as mfskAcs.best)
function mfskAcs(m, base, a, b, dec, decBase)
{
  mfskBranch[0] = -a - b;
  mfskBranch[1] = -a + b;
  mfskBranch[2] = a - b;
  mfskBranch[3] = a + b;
  let best = -Infinity;
  let bestState = 0;
  for (let ns = 0; ns < 64; ns++)
  {
    // The state before was ns >> 1 with its oldest bit 0 or 1; the register is the state before and the new bit (ns's bit 0)
    const p0 = m[base + (ns >> 1)] + mfskBranch[MFSK_OUT[ns]];
    const p1 = m[base + (ns >> 1) + 32] + mfskBranch[MFSK_OUT[ns | 64]];
    const v = p1 > p0 ? p1 : p0;
    if (dec) dec[decBase + ns] = p1 > p0 ? 1 : 0;
    mfskNext[ns] = v;
    if (v > best)
    {
      best = v;
      bestState = ns;
    }
  }
  for (let ns = 0; ns < 64; ns++) m[base + ns] = mfskNext[ns] - best;
  mfskAcs.best = bestState;
  return best;
}
mfskAcs.best = 0;

// ---- Each block of audio: brought down, kept, run through every channel and the finder; the text ten times a second, the list four
function mfskAudio(samples)
{
  const x = mfskFront(samples);
  if (x.length == 0) return;
  for (let i = 0; i < x.length; i++) mfskHistory[(mfskNow + i) & mfskHistoryMask] = x[i];
  for (const c of mfskChannels) c.run(x);
  mfskNow += x.length;
  mfskFind();
  if (mfskNow - mfskLastFlush >= mfskFd / 10)
  {
    mfskLastFlush = mfskNow;
    mfskFlush();
  }
  if (mfskNow - mfskLastList >= mfskFd / 4)
  {
    mfskLastList = mfskNow;
    mfskTidy();
    mfskPostChannels();
  }
}

function mfskFlush()
{
  for (const c of mfskChannels)
  {
    // A new channel's text waits its first second (it may yet lose to another, mfskTidy)
    if (c.text.length == 0 || mfskNow - c.born < mfskFd) continue;
    self.postMessage({ type: "text", id: c.id, text: c.text });
    c.text = "";
  }
}

function mfskPostChannels()
{
  const list = mfskChannels.filter((c) => c.everActive).sort((a, b) => a.f0 - b.f0);
  self.postMessage({ type: "channels", list: list.map((c) => ({ id: c.id, freq: Math.round(c.center() * 10) / 10, snr: Math.round(c.snr()), active: c.active, mode: mfskMode })) });
}

// ---- The finder: its FFT (a symbol's length of audio, no window, padded to bins no wider than MFSK_BIN_SHARE of a spacing), and its
// candidates, every MFSK_GRID of a spacing (their lowest tones f0, their tones' bins) at each of MFSK_PHASES timings: each one's tone
// energies kept (and the noise in one; to undo the interleaver), how much its strongest tone stands out (conc, averaged) and how often
// it changes; while awake, its path metrics, and its q (averaged) and the steps it's been worked out over
function mfskFinderSetup()
{
  const len = Math.round(mfskFd / mfskBaud);
  let n = 1;
  while (n < len || mfskFd / n > mfskBaud * MFSK_BIN_SHARE) n *= 2;
  const binHz = mfskFd / n;
  const half = 7.5 * mfskBaud;
  const f0 = [];
  for (let center = mfskMinHz; center <= mfskMaxHz + 0.001; center += MFSK_GRID * mfskBaud)
  {
    if (center - half < 50 || center + half > mfskTop) continue;
    f0.push(center - half);
  }
  const places = f0.length;
  const bins = new Int32Array(places * MFSK_TONES);
  for (let i = 0; i < places; i++) for (let t = 0; t < MFSK_TONES; t++) bins[i * MFSK_TONES + t] = Math.round((f0[i] + t * mfskBaud) / binHz);
  const count = places * MFSK_PHASES;
  return {
    len, n, fft: mfskFft(n), re: new Float64Array(n), im: new Float64Array(n), power: new Float64Array(n / 2),
    f0, places, bins, hop: len / MFSK_PHASES, frame: 0,
    energy: new Float32Array(count * mfskSpan * MFSK_KEEP), conc: new Float32Array(count).fill(1 / 5), changes: new Float32Array(count),
    last: new Int8Array(count), awake: new Uint8Array(count), metrics: new Float64Array(count * 64), qNum: new Float32Array(count),
    qDen: new Float32Array(count).fill(1e-9), steps: new Int32Array(count), symbols: new Int32Array(MFSK_PHASES)
  };
}

// Every finder frame the audio now completes: the FFT, then each candidate at this frame's timing given its symbol
function mfskFind()
{
  const fi = mfskFinder;
  while (true)
  {
    const end = Math.round((fi.frame + 1) * fi.hop);
    if (end > mfskNow) break;
    const phase = fi.frame % MFSK_PHASES;
    fi.frame++;
    if (end < fi.len) continue;
    for (let i = 0; i < fi.n; i++)
    {
      fi.re[i] = i < fi.len ? mfskHistory[(end - fi.len + i) & mfskHistoryMask] : 0;
      fi.im[i] = 0;
    }
    fi.fft(fi.re, fi.im);
    for (let k = 0; k < fi.n / 2; k++) fi.power[k] = fi.re[k] * fi.re[k] + fi.im[k] * fi.im[k];
    for (let i = 0; i < fi.places; i++) mfskCandidate(fi, i, phase);
    fi.symbols[phase]++;
    if (fi.symbols[phase] > 3 * mfskDepth + 24) mfskLook(fi, phase);
  }
}

// Candidate (place i, timing phase) given its symbol: its energies kept, its conc and changes brought up to date; awake (its conc over
// noise's), the symbol the interleaver has now completed (each bit p, 0 the top, came mfskDepth p symbols after the top bit) through its
// decoder, and its q brought up to date
function mfskCandidate(fi, i, phase)
{
  const c = i * MFSK_PHASES + phase;
  const sym = fi.symbols[phase];
  const energy = fi.energy;
  const span = mfskSpan - 1;
  const base = c * mfskSpan * MFSK_KEEP;
  const row = base + (sym & span) * MFSK_KEEP;
  const bins = fi.bins;
  const power = fi.power;
  let sum = 0;
  let max = 0;
  let at = 0;
  for (let t = 0, b = i * MFSK_TONES; t < MFSK_TONES; t++, b++)
  {
    const e = power[bins[b]];
    energy[row + t] = e;
    sum += e;
    if (e > max)
    {
      max = e;
      at = t;
    }
  }
  const noise = (sum - max) / (MFSK_TONES - 1);
  energy[row + MFSK_TONES] = noise;
  if (!(sum > 0)) return;
  fi.conc[c] += (max / sum - fi.conc[c]) * MFSK_CONC_SHARE;
  fi.changes[c] += ((at != fi.last[c] ? 1 : 0) - fi.changes[c]) * MFSK_CONC_SHARE;
  fi.last[c] = at;
  if (!fi.awake[c])
  {
    if (fi.conc[c] < MFSK_WAKE) return;
    fi.awake[c] = 1;
    fi.steps[c] = 0;
    fi.qNum[c] = 0;
    fi.qDen[c] = 1e-9;
    fi.metrics.fill(0, c * 64, c * 64 + 64);
  }
  else if (fi.conc[c] < MFSK_SLEEP)
  {
    fi.awake[c] = 0;
    return;
  }
  const from = sym - 3 * mfskDepth;
  if (from < 0) return;
  const r0 = base + (from & span) * MFSK_KEEP;
  const r1 = base + ((from + mfskDepth) & span) * MFSK_KEEP;
  const r2 = base + ((from + 2 * mfskDepth) & span) * MFSK_KEEP;
  const r3 = base + ((from + 3 * mfskDepth) & span) * MFSK_KEEP;
  if (!(energy[r0 + MFSK_TONES] > 0 && energy[r1 + MFSK_TONES] > 0 && energy[r2 + MFSK_TONES] > 0 && energy[r3 + MFSK_TONES] > 0)) return;
  const s0 = mfskSoftBit(energy, r0, energy[r0 + MFSK_TONES], 0, false);
  const s1 = mfskSoftBit(energy, r1, energy[r1 + MFSK_TONES], 1, false);
  const s2 = mfskSoftBit(energy, r2, energy[r2 + MFSK_TONES], 2, false);
  const s3 = mfskSoftBit(energy, r3, energy[r3 + MFSK_TONES], 3, false);
  const g = mfskAcs(fi.metrics, c * 64, s0, s1, null, 0) + mfskAcs(fi.metrics, c * 64, s2, s3, null, 0);
  const most = Math.abs(s0) + Math.abs(s1) + Math.abs(s2) + Math.abs(s3);
  fi.qNum[c] += (g - fi.qNum[c]) * MFSK_FIND_SHARE * 2;
  fi.qDen[c] += (most - fi.qDen[c]) * MFSK_FIND_SHARE * 2;
  fi.steps[c] += 2;
}

// The candidates at this timing awake long enough that fit the code well, their tones changing, whose strongest tone stands out more
// than any other's whose tones overlap (at any timing): a strong signal read a few tones off can fit the code well too (the few of its
// symbols that fall inside are sure of themselves, and the code can be fitted to those), but has fewer symbols standing out. Not near a
// channel or a blocked place: each a new channel
function mfskLook(fi, phase)
{
  const reach = Math.round((MFSK_TONES - 1) / MFSK_GRID);
  for (let i = 0; i < fi.places; i++)
  {
    const c = i * MFSK_PHASES + phase;
    if (!fi.awake[c] || fi.steps[c] < MFSK_FIND_STEPS) continue;
    const q = fi.qNum[c] / fi.qDen[c];
    if (q < MFSK_FIND_Q_RSID || fi.changes[c] < MFSK_CHANGES) continue;
    const f0 = fi.f0[i];
    const center = f0 + 7.5 * mfskBaud;
    if (q < MFSK_FIND_Q && !mfskRsidHints.some((h) => h.until > mfskNow && Math.abs(h.freq - center) < 8 * mfskBaud)) continue;
    let best = true;
    for (let j = Math.max(0, i - reach); j <= Math.min(fi.places - 1, i + reach) && best; j++)
    {
      for (let ph = 0; ph < MFSK_PHASES; ph++)
      {
        const d = j * MFSK_PHASES + ph;
        if (d != c && fi.conc[d] > fi.conc[c]) best = false;
      }
    }
    if (!best) continue;
    // A channel with tones overlapping that decoded well in the last MFSK_HOLD_SECONDS (unless this one's strongest tone stands out
    // clearly more), or any channel within two spacings, is this signal already: when a strong signal ends, the finder still holds it
    // read a few tones off for a moment
    const near = (ch) => Math.abs(ch.f0 - f0) < (MFSK_TONES - 0.5) * mfskBaud && mfskNow - ch.lastGood < MFSK_HOLD_SECONDS * mfskFd && fi.conc[c] < 1.15 * ch.conc;
    if (mfskChannels.some((ch) => Math.abs(ch.f0 - f0) < 2 * mfskBaud || near(ch))) continue;
    if (mfskBlocked.some((b) => Math.abs(b.freq - center) < mfskBaud)) continue;
    if (!mfskRoom()) return;
    const n = Math.min(mfskNow, mfskHistory.length - 1);
    const back = new Float32Array(n);
    for (let k = 0; k < n; k++) back[k] = mfskHistory[(mfskNow - n + k) & mfskHistoryMask];
    mfskChannels.push(new MfskChannel(mfskNextId++, f0, back));
  }
}

// Room for one more channel: under the limit, or the oldest still on trial made way for
function mfskRoom()
{
  if (mfskChannels.length < MFSK_MAX) return true;
  let oldest = null;
  for (const c of mfskChannels) if (!c.everActive && (!oldest || c.born < oldest.born)) oldest = c;
  if (!oldest) return false;
  mfskChannels = mfskChannels.filter((c) => c != oldest);
  return true;
}

// Channels dropped: silent too long, never printed in their trial (the place blocked a while), wandered out of range, or on top of
// another (the newer goes, unless only it has printed)
function mfskTidy()
{
  const drop = new Set();
  for (const c of mfskChannels)
  {
    if (c.everActive && mfskNow - c.lastGood > MFSK_DROP_SECONDS * mfskFd) drop.add(c);
    else if (!c.everActive && mfskNow - c.born > MFSK_TRIAL_SECONDS * mfskFd)
    {
      drop.add(c);
      mfskBlocked.push({ freq: c.center(), until: mfskNow + MFSK_BLOCK_SECONDS * mfskFd });
    }
    else if (c.center() < mfskMinHz - 30 || c.center() > mfskMaxHz + 30) drop.add(c);
  }
  const lost = new Set();
  for (let i = 0; i < mfskChannels.length; i++)
  {
    for (let j = i + 1; j < mfskChannels.length; j++)
    {
      const a = mfskChannels[i];
      const b = mfskChannels[j];
      const apart = Math.abs(a.f0 - b.f0);
      if (drop.has(a) || drop.has(b) || apart >= (MFSK_TONES - 0.5) * mfskBaud) continue;
      // Tones overlapping: two readings of one signal (one a few tones off), or one signal after another a little apart (a reply).
      // Both decoding well: the one whose strongest tone stands out less goes; only one: the other (the signal it had is gone, or it
      // never had one); neither: both kept for now. Within a spacing and a half: the newer, unless only it has printed
      const ga = a.q() > MFSK_CLOSE;
      const gb = b.q() > MFSK_CLOSE;
      let loser = null;
      if (apart < 1.5 * mfskBaud) loser = a.everActive != b.everActive ? (a.everActive ? b : a) : a.id > b.id ? a : b;
      else if (ga && gb) loser = a.conc < b.conc ? a : b;
      else if (ga != gb) loser = ga ? b : a;
      if (!loser) continue;
      drop.add(loser);
      lost.add(loser);
    }
  }
  if (drop.size)
  {
    for (const c of drop) if (c.text.length && !lost.has(c)) self.postMessage({ type: "text", id: c.id, text: c.text });
    mfskChannels = mfskChannels.filter((c) => !drop.has(c));
  }
  mfskBlocked = mfskBlocked.filter((b) => b.until > mfskNow);
}

// ---- A channel: its lowest tone f0 (Hz, moved by the AFC). Mixed down at its centre, brought down by m (mfskBoxcar3) to about
// MFSK_SPS samples a symbol (complex, kept in a ring), then MFSK_SLOTS times a symbol the 16 tones' energies over the last symbol's
// length (a DFT each, in two halves for the AFC). Its symbol clock: how much the strongest tone stands out, averaged at each of the
// slots, peaks where whole symbols are read (between them a window holds two tones); the symbols are read there, the read moved a slot
// at a time toward the peak. The audio kept is first run through for the clock and the AFC alone (prime), then again from its start,
// decoded
class MfskChannel
{
  constructor(id, f0, back)
  {
    this.id = id;
    this.m = Math.max(1, Math.round(mfskFd / (MFSK_SPS * mfskBaud)));
    this.rate2 = mfskFd / this.m;
    this.sps = this.rate2 / mfskBaud;
    this.N = Math.round(this.sps);
    this.half = this.N >> 1;
    this.dTaps = mfskBoxcar3(this.m);
    this.dLen = this.dTaps.length;
    let size = 1;
    while (size < 2 * this.N) size *= 2;
    this.ring = size;
    this.cRe = new Float64Array(size);
    this.cIm = new Float64Array(size);
    // Each tone's DFT taps, the tones (t - 7.5) spacings from the centre
    this.twRe = new Float64Array(MFSK_TONES * this.N);
    this.twIm = new Float64Array(MFSK_TONES * this.N);
    for (let t = 0; t < MFSK_TONES; t++)
    {
      const w = (2 * Math.PI * (t - 7.5) * mfskBaud) / this.rate2;
      for (let n = 0; n < this.N; n++)
      {
        this.twRe[t * this.N + n] = Math.cos(w * n);
        this.twIm[t * this.N + n] = -Math.sin(w * n);
      }
    }
    this.profile = new Float64Array(MFSK_SLOTS);
    this.text = "";
    this.active = false;
    this.everActive = false;
    this.born = mfskNow;
    this.lastGood = mfskNow;
    this.f0 = f0;
    this.prime = true;
    this.restart();
    this.run(back);
    // The clock found: read at the profile's peak from the start
    let best = 0;
    for (let s = 1; s < MFSK_SLOTS; s++) if (this.profile[s] > this.profile[best]) best = s;
    this.prime = false;
    this.restart();
    this.nextRead = MFSK_SLOTS + best;
    this.run(back);
  }

  // The demodulator and decoder from the start (the clock's profile and f0 kept)
  restart()
  {
    this.oRe = 1;
    this.oIm = 0;
    this.setFreq(this.f0);
    this.dRe = new Float64Array(2 * this.dLen);
    this.dIm = new Float64Array(2 * this.dLen);
    this.dPos = 0;
    this.dCount = 0;
    this.cRe.fill(0);
    this.cIm.fill(0);
    this.count = 0;
    this.hop = 0;
    this.nextRead = MFSK_SLOTS;
    this.symbols = 0;
    this.afcSum = 0;
    this.afcWeight = 0;
    this.changes = 0;
    this.conc = 1 / 5;
    this.lastTone = -1;
    this.sigE = 0;
    this.noiseE = 0;
    // The interleaver undone (soft bits, a ring of mfskSpan symbols), the Viterbi decoder (its metrics, decisions and q a step, rings
    // of MFSK_RING), q averaged
    this.rx = new Float32Array(mfskSpan * MFSK_KEEP);
    // Each symbol's strongest tone over the noise (a ring of mfskSpan); for each step, whether its bits came while the signal was there
    // (1) and while the tones were spread as MFSK's are (2; a ring of MFSK_RING); the last MFSK_SPREAD_SYMBOLS strongest tones, and
    // how many times each
    this.stand = new Float32Array(mfskSpan);
    this.there = new Uint8Array(MFSK_RING);
    this.tones = new Int8Array(MFSK_SPREAD_SYMBOLS).fill(-1);
    this.hist = new Int32Array(MFSK_TONES);
    // A stretch of good decoding shown to be MFSK, and the characters of one not yet
    this.credible = false;
    this.pending = "";
    this.metrics = new Float64Array(64);
    this.dec = new Uint8Array(MFSK_RING * 64);
    this.qNum = new Float32Array(MFSK_RING);
    this.qDen = new Float32Array(MFSK_RING);
    this.step = 0;
    this.qAvgNum = 0;
    this.qAvgDen = 1e-9;
    // The varicode: the code so far (its bits, how many, the step it started), the 0s it ends in, and whether a code's end has been seen
    this.vCode = 0;
    this.vLen = 0;
    this.vStart = 0;
    this.vZeros = 0;
    this.vSynced = false;
    this.vOk = false;
    this.afterCr = false;
  }

  center()
  {
    return this.f0 + 7.5 * mfskBaud;
  }

  // q averaged
  q()
  {
    return this.qAvgNum / this.qAvgDen;
  }

  setFreq(f0)
  {
    this.f0 = f0;
    const w = (2 * Math.PI * this.center()) / mfskFd;
    this.sRe = Math.cos(w);
    this.sIm = -Math.sin(w);
  }

  // The SNR (dB in 16 spacings): the strongest tone's energy over the others' (averaged), a symbol's energy against the noise in one
  // tone's bandwidth, shared over the 16
  snr()
  {
    if (!(this.noiseE > 0)) return -30;
    return Math.max(-30, 10 * Math.log10(Math.max(1e-3, (this.sigE - this.noiseE) / this.noiseE) / MFSK_TONES));
  }

  run(x)
  {
    const taps = this.dTaps;
    const n = this.dLen;
    const m = this.m;
    const dRe = this.dRe;
    const dIm = this.dIm;
    let oRe = this.oRe;
    let oIm = this.oIm;
    let pos = this.dPos;
    let count = this.dCount;
    for (let i = 0; i < x.length; i++)
    {
      const v = x[i];
      const re = oRe * this.sRe - oIm * this.sIm;
      oIm = oRe * this.sIm + oIm * this.sRe;
      oRe = re;
      dRe[pos] = dRe[pos + n] = v * oRe;
      dIm[pos] = dIm[pos + n] = v * oIm;
      pos = pos + 1 == n ? 0 : pos + 1;
      if (++count < m) continue;
      count = 0;
      let zr = 0;
      let zi = 0;
      for (let k = 0; k < n; k++)
      {
        zr += taps[k] * dRe[pos + k];
        zi += taps[k] * dIm[pos + k];
      }
      this.sample(zr, zi);
      // The oscillator kept at unit size now and then (rounding would let it drift)
      if ((this.count & 255) == 0)
      {
        const g = 1 / Math.sqrt(oRe * oRe + oIm * oIm);
        oRe *= g;
        oIm *= g;
      }
    }
    this.oRe = oRe;
    this.oIm = oIm;
    this.dPos = pos;
    this.dCount = count;
  }

  // A sample (at rate2) kept; each hop it completes worked out
  sample(zr, zi)
  {
    const k = this.count & (this.ring - 1);
    this.cRe[k] = zr;
    this.cIm[k] = zi;
    this.count++;
    if (this.count < Math.round(((this.hop + 1) * this.sps) / MFSK_SLOTS)) return;
    this.slot(this.hop);
    this.hop++;
  }

  // Hop j (its window ending at the sample just kept): the tones' energies, the clock's profile, and the symbol if it's read here
  slot(j)
  {
    const N = this.N;
    if (this.count < N) return;
    const start = this.count - N;
    const mask = this.ring - 1;
    let sum = 0;
    let max = 0;
    let at = 0;
    let h1r = 0;
    let h1i = 0;
    let h2r = 0;
    let h2i = 0;
    const read = j == this.nextRead;
    for (let t = 0; t < MFSK_TONES; t++)
    {
      const base = t * N;
      let ar = 0;
      let ai = 0;
      let br = 0;
      let bi = 0;
      for (let n = 0; n < N; n++)
      {
        const x = this.cRe[(start + n) & mask];
        const y = this.cIm[(start + n) & mask];
        const c = this.twRe[base + n];
        const s = this.twIm[base + n];
        if (n < this.half)
        {
          ar += x * c - y * s;
          ai += x * s + y * c;
        }
        else
        {
          br += x * c - y * s;
          bi += x * s + y * c;
        }
      }
      const re = ar + br;
      const im = ai + bi;
      const e = re * re + im * im;
      mfskE[t] = e;
      sum += e;
      if (e > max)
      {
        max = e;
        at = t;
        h1r = ar;
        h1i = ai;
        h2r = br;
        h2i = bi;
      }
    }
    if (!(sum > 0)) return;
    const conc = max / sum;
    const s = j % MFSK_SLOTS;
    this.profile[s] += (conc - this.profile[s]) * 0.08;
    if (!read) return;
    // The next read a symbol on, moved a slot toward the profile's peak
    let best = 0;
    for (let k = 1; k < MFSK_SLOTS; k++) if (this.profile[k] > this.profile[best]) best = k;
    let move = ((best - s + MFSK_SLOTS + MFSK_SLOTS / 2) % MFSK_SLOTS) - MFSK_SLOTS / 2;
    if (this.profile[best] < this.profile[s] * 1.03) move = 0;
    this.nextRead = j + MFSK_SLOTS + Math.max(-1, Math.min(1, move));
    this.symbol(sum, max, at, conc, h1r, h1i, h2r, h2i);
  }

  // A symbol (its energies in mfskE): the AFC, the SNR, how often the tone changes; unless priming, its soft bits into the decoder
  symbol(sum, max, at, conc, h1r, h1i, h2r, h2i)
  {
    this.symbols++;
    const noise = (sum - max) / (MFSK_TONES - 1);
    // The AFC: how far the strongest tone's phase turned from the first half of the symbol to the second is how far off it is; once
    // the signal's found, only while it decodes (so noise doesn't drag it away)
    const fast = this.symbols < MFSK_AFC_FAST_SYMBOLS;
    if (conc > MFSK_AFC_CONC && (this.prime || fast || this.qAvgNum > MFSK_CLOSE * this.qAvgDen))
    {
      const turn = Math.atan2(h2i * h1r - h2r * h1i, h2r * h1r + h2i * h1i);
      const hz = (turn * this.rate2) / (Math.PI * 2 * this.half);
      const share = this.prime || fast ? MFSK_AFC_FAST : MFSK_AFC_SLOW;
      this.setFreq(this.f0 + share * Math.max(-mfskBaud / 2, Math.min(mfskBaud / 2, hz)));
    }
    this.sigE += (max - this.sigE) * 0.05;
    this.noiseE += (noise - this.noiseE) * 0.05;
    this.changes += ((at != this.lastTone ? 1 : 0) - this.changes) * 0.05;
    this.conc += (conc - this.conc) * MFSK_CONC_SHARE;
    this.lastTone = at;
    if (this.prime || !(noise > 0)) return;
    const sym = this.symbols - 1;
    const span = mfskSpan - 1;
    const row = (sym & span) * MFSK_KEEP;
    for (let t = 0; t < MFSK_TONES; t++) this.rx[row + t] = mfskE[t];
    this.rx[row + MFSK_TONES] = noise;
    this.stand[sym & span] = max / noise;
    // The tones' spread over the last MFSK_SPREAD_SYMBOLS: those standing out as noise's don't (the idle tone left out)
    const old = this.tones[sym % MFSK_SPREAD_SYMBOLS];
    if (old >= 0) this.hist[old]--;
    const tone = max > MFSK_STAND * noise ? at : -1;
    this.tones[sym % MFSK_SPREAD_SYMBOLS] = tone;
    if (tone >= 0) this.hist[tone]++;
    let busy = 0;
    let pairs = 0;
    for (let t = 1; t < MFSK_TONES; t++)
    {
      busy += this.hist[t];
      pairs += this.hist[t] * (this.hist[t] - 1);
    }
    const spread = busy >= MFSK_SPREAD_SYMBOLS / 3 && pairs < MFSK_SPREAD * busy * (busy - 1);
    const from = sym - 3 * mfskDepth;
    if (from < 0) return;
    // The signal there: the symbols the first and last of these bits came in (30 apart; for each, it and the four after or before it),
    // their strongest tones standing out (on average) as noise's don't
    let first = 0;
    let last = 0;
    for (let d = -2; d <= 2; d++)
    {
      first += this.stand[(from + 2 + d) & span];
      last += this.stand[(sym - 2 + d) & span];
    }
    const there = Math.min(first, last) / 5 > MFSK_STAND;
    const flag = (there ? 1 : 0) | (spread ? 2 : 0);
    this.there[(2 * from) % MFSK_RING] = flag;
    this.there[(2 * from + 1) % MFSK_RING] = flag;
    const soft = [0, 1, 2, 3].map((p) =>
    {
      const r = ((from + p * mfskDepth) & span) * MFSK_KEEP;
      return this.rx[r + MFSK_TONES] > 0 ? mfskSoftBit(this.rx, r, this.rx[r + MFSK_TONES], p, true) : 0;
    });
    this.viterbi(soft[0], soft[1]);
    this.viterbi(soft[2], soft[3]);
  }

  // A Viterbi step for one coded pair: its q kept, the decisions traced back MFSK_TRACEBACK steps for the bit that far back
  viterbi(a, b)
  {
    const k = this.step++;
    const r = k % MFSK_RING;
    const g = mfskAcs(this.metrics, 0, a, b, this.dec, r * 64);
    const most = Math.abs(a) + Math.abs(b);
    this.qNum[r] = g;
    this.qDen[r] = most;
    this.qAvgNum += (g - this.qAvgNum) * MFSK_Q_SHARE;
    this.qAvgDen += (most - this.qAvgDen) * MFSK_Q_SHARE;
    const q = this.qAvgNum / this.qAvgDen;
    if (!this.active && q > MFSK_OPEN && this.changes > MFSK_CHANGES) this.active = true;
    else if (this.active && q < MFSK_CLOSE) this.active = false;
    if (q > MFSK_CLOSE) this.lastGood = mfskNow;
    if (k < MFSK_TRACEBACK) return;
    let s = mfskAcs.best;
    for (let j = k; j > k - MFSK_TRACEBACK; j--) s = (s >> 1) | (this.dec[(j % MFSK_RING) * 64 + s] << 5);
    this.bit(s & 1, k - MFSK_TRACEBACK);
  }

  // q over steps from to to (as far back as kept)
  quality(from, to)
  {
    let num = 0;
    let den = 1e-9;
    for (let j = Math.max(from, this.step - MFSK_RING + 1, 0); j <= Math.min(to, this.step - 1); j++)
    {
      num += this.qNum[j % MFSK_RING];
      den += this.qDen[j % MFSK_RING];
    }
    return num / den;
  }

  // A decoded bit (at step k) into the varicode: a 1 after two or more 0s ends the code before it (one of 12 bits or fewer) and starts
  // the next. A code is read only if, when it started, a code's end had been seen (so one joined part way through isn't) where the code
  // fitted well (q over the bits around), and it hasn't fitted badly since: at a signal's start the interleaver mixes the noise before
  // it with the signal for a while, and what's decoded there is half noise
  bit(v, k)
  {
    const flag = this.there[k % MFSK_RING];
    const good = (flag & 1) == 1 && this.quality(k - MFSK_SYNC_SIDE, k + MFSK_SYNC_SIDE) >= MFSK_SIDE_Q;
    if (!good)
    {
      this.vSynced = false;
      this.vOk = false;
      this.credible = false;
      this.pending = "";
    }
    else if (!this.credible && (flag & 2) == 2)
    {
      this.credible = true;
      this.put(this.pending);
      this.pending = "";
    }
    if (v == 1)
    {
      if (this.vZeros >= 2)
      {
        if (this.vOk && this.vLen > 0 && this.vLen <= 12) this.code(this.vCode, this.vStart, k);
        this.vOk = this.vSynced;
        this.vCode = 1;
        this.vLen = 1;
        this.vStart = k;
      }
      else if (this.vLen > 0 && this.vLen <= 12)
      {
        this.vCode = this.vCode * 2 + 1;
        this.vLen++;
      }
      this.vZeros = 0;
      return;
    }
    this.vZeros++;
    if (this.vZeros >= 2 && good) this.vSynced = true;
    // (past 12 bits it's no code: vLen stays 13 until the next one starts)
    if (this.vLen > 0 && this.vLen <= 12)
    {
      this.vCode *= 2;
      this.vLen++;
    }
  }

  // A code (from step start to end): its character goes out if the code fitted well over it and a little either side
  code(value, start, end)
  {
    const ch = MFSK_VARICODE.get(value);
    if (ch === undefined) return;
    if (this.quality(start - MFSK_CHAR_SIDE, end + MFSK_CHAR_SIDE) < MFSK_CHAR_Q) return;
    if (this.quality(end, end + MFSK_CHAR_SIDE) < MFSK_SIDE_Q) return;
    let out = "";
    if (ch == 13 || (ch == 10 && !this.afterCr)) out = "\n";
    else if ((ch >= 32 && ch < 127) || ch >= 160) out = String.fromCharCode(ch);
    this.afterCr = ch == 13;
    if (!out) return;
    if (this.credible) this.put(out);
    else this.pending = (this.pending + out).slice(-MFSK_PENDING);
  }

  // Text that goes out
  put(text)
  {
    if (!text) return;
    this.text += text;
    this.everActive = true;
  }
}
