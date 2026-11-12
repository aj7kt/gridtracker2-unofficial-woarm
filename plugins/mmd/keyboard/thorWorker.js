// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Multi-Mode Decoder's DominoEX and THOR modes: every DominoEX or THOR signal in the passband at once, at one speed or all six
// (config's baud), as the keyboard modes list every PSK31 or RTTY signal.
//   How the modes are sent (Murray Greenman's description of DominoEX, ZL1BPU, with its Nibble Varicode table, version 2.0 of 28 July
//   2009; THOR is DominoEX with Dave Freese's, W1HKJ, FEC, as ZL1BPU describes it, using the MFSK16 coder and varicode of Nino Porcino,
//   IZ8BLY, and ZL1BPU): 18 tones, one at a time, each a steady tone; each symbol's tone is the last one's moved up by 2 plus the nibble
//   (0 to 15) it carries, round the 18 (IFK+), so a tone never follows itself or the one just above it. Speeds 4, 5, 8, 11, 16 and 22
//   are 3.90625, 5.3833, 7.8125, 10.766, 15.625 and 21.533 baud (8000 or 11025 over 2048, 1024 or 512); the tones are the baud apart,
//   twice it at 4, 5 and 8. DominoEX sends each character as one to three nibbles of its varicode: the first under 8, the others 8 and
//   over, so a character starts at each nibble under 8; a primary alphabet (the text) and a secondary one (sent while the keyboard is
//   idle: an ID or beacon). THOR sends the MFSK16 varicode's bits (each character's code ends in 00, and no code has 001 in it, so a
//   character ends where 00 is followed by a 1) through a rate 1/2 K = 7 convolutional code (each bit's two outputs the parity of
//   stages 1 3 4 6 7, then of 1 2 3 4 7, of the register, the newest bit stage 1), four of those bits to a nibble (the first the highest)
//   and a diagonal interleaver ten symbols deep (a nibble's second bit sent 10 symbols after its first, the third 20, the fourth 30).
//   Here: the audio brought down to about 8 kHz. For each speed (a lane), eight times a symbol a spectrum (an FFT over a symbol's length,
//   padded to a quarter of the baud a bin or finer) of the band, kept for several seconds. The finder: at every second bin (for an 18 tone
//   signal's lowest tone) and every second point in a symbol, how much of the 18 tones' energy the strongest holds, counted only when the
//   strongest isn't one of the two tones just outside and isn't the last symbol's tone or the one above it (IFK+ never sends those, a
//   carrier always does), averaged over a dozen symbols: noise scores about 0.16, a clean signal near 1. A place well over noise in two
//   looks running gets a channel, which first runs over the spectra kept (twice: the second time from the place and timing the first
//   settled on), so the first words aren't lost.
//   A channel reads one spectrum a symbol (the point where its strongest tone is strongest, which follows the sender's clock) and follows
//   drift from where its tones peak. A place a few tones off fits nearly as well in the finder, so a channel counts where its strongest
//   tone falls, six tones either side of its 18 too, and moves to where the signal's tones are (read again from the spectra kept, if it
//   hasn't printed yet). Each symbol is read both ways, from each tone's chance (its energy against the noise's) and each nibble's chance
//   (the last symbol's tones' chances, each times that of the tone 2 plus the nibble above it, so a weak symbol doesn't spoil the next):
//   as DominoEX (the likeliest nibble, the nibbles the characters), and as THOR (the nibble chances as four soft bits, deinterleaved and
//   run through a Viterbi decoder). Where the published descriptions leave THOR's plumbing open (the interleaver's direction, the nibble
//   Gray coded or not, the code's taps counted from either end, and where the pairs of bits start), every one of the 16 ways is tried at
//   once; the right one is the one whose bits keep the code's parity check (a rate 1/2 code's two outputs, each run through the other's
//   taps, are equal: true for nearly every bit of a THOR signal, half of them for anything else), and it's kept while THOR is printed.
//   A channel's text goes out only while its signal reads cleanly, at this speed (the strongest tone read at its symbol's best point
//   well above half a symbol from it, and IFK+'s forbidden steps hardly ever turning up): as THOR while the parity check holds; as
//   DominoEX while the strongest tone stands above the rest, nearly every character is in the varicode table, and the THOR parity check
//   has had long enough to say it isn't THOR. Characters are held a moment before they go out; when a signal stops, what came after its
//   last strong symbol is dropped (THOR's decoder reads on until the last bits sent are out). Secondary (idle) DominoEX text isn't printed.
//   One channel per signal: a signal heard by another speed's lane too (a speed half or twice its own reads it after a fashion) is left
//   to the lane reading it best.
// In:  { type: "init", rate }, { type: "audio", samples }, { type: "reset" },
//      { type: "config", mode: "dominoex" | "thor" | "any", baud: 4 | 5 | 8 | 11 | 16 | 22 | "all" (or an array of those), minHz, maxHz },
//      { type: "rsid", freq }: an RSID heard there (its tones aren't taken for a signal)
// Out: { type: "channels", list: [{ id, freq (Hz, the signal's centre), snr (dB in 2500 Hz), active, mode ("dominoex" | "thor"),
//      submode (4 to 22) }] }, four times a second; { type: "text", id, text }: what a channel decoded since its last one, every 100 ms or so

// Speeds by name: baud, and the tone spacing in bauds
const THOR_SPEEDS = {
  4: [8000 / 2048, 2],
  5: [11025 / 2048, 2],
  8: [8000 / 1024, 2],
  11: [11025 / 1024, 1],
  16: [8000 / 512, 1],
  22: [11025 / 512, 1]
};
const THOR_TONES = 18;
// A channel reads its 18 tones and the place just outside either end
const THOR_SEEN = THOR_TONES + 2;
// The audio's rate is brought down to about this, keeping up to this frequency
const THOR_WORK_RATE = 8000;
const THOR_TOP_HZ = 4000;
// Spectra a symbol, and the FFT padded to a power of 2 at least this many symbols long (a bin a quarter of the baud or finer)
const THOR_POINTS = 8;
const THOR_PAD = 4;
// The finder looks at every second bin and every second point (the channel then finds the best of each)
const THOR_FIND_EVERY = 2;
// Spectra kept: this many symbols, and at least this many seconds
const THOR_HISTORY_SYMBOLS = 48;
const THOR_HISTORY_SECONDS = 4;
// The finder: each symbol's share of its average; a place is looked at when its average is over this (noise's is about 0.16, and its
// best place over a passband reached 0.245 at most in a minute); looks every this many seconds (at least once a symbol), a place seen in
// this many running gets a channel
const THOR_FIND_SHARE = 1 / 12;
const THOR_FIND = 0.3;
const THOR_SCAN_SECONDS = 0.25;
const THOR_FIND_LOOKS = 2;
// At most this many channels a lane
const THOR_MAX = 12;
// Seconds (and symbols, whichever is longer): a channel not decoding for this long is dropped; one that never decoded is given this long;
// the place it was then isn't tried again for this long
const THOR_DROP = [15, 40];
const THOR_TRIAL = [8, 90];
const THOR_BLOCK_SECONDS = 15;
// After an RSID: the channels on trial within this of it dropped, and none opened there for this long
const THOR_RSID_NEAR_HZ = 100;
const THOR_RSID_HOLD_SECONDS = 3;
// A channel: its averages' shares a symbol (the strongest tone's share of the 18, the forbidden steps, the timing points' strength, the
// SNR's parts) and a DominoEX character's share of the varicode average
const THOR_QUAL_SHARE = 1 / 8;
const THOR_BAD_SHARE = 1 / 24;
const THOR_POINT_SHARE = 1 / 6;
const THOR_SNR_SHARE = 1 / 16;
const THOR_CHAR_SHARE = 1 / 10;
// The AFC: a symbol's error (bins, from where its tone peaks) moves the place by this share of it and the drift by this; a symbol counts
// when its strongest tone holds this share of the 18
const THOR_AFC_SHARE = 0.15;
const THOR_AFC_DRIFT = 0.006;
const THOR_AFC_CLEAR = 0.4;
// The whole-tone check: places this many tones either side of the 18 looked at; a place taken for one of the signal's tones once it's
// held the strongest at least this many times; judged once this many symbols have counted since the last move; in place once the places
// hit span this many tones
const THOR_WIDE = 6;
const THOR_HITS_OUT = 2;
const THOR_HITS_AFTER = 18;
const THOR_PLACED_SPAN = 16;
// ... a symbol counting when its strongest place holds this share of the strongest tone's average energy; a channel not yet printing
// read again from the spectra kept (moved) at most this many times
const THOR_HITS_TONE = 0.4;
const THOR_RESPAWNS = 3;
// A new channel's place: those within this of the best fit (in symbols' worth) taken as fitting as well
const THOR_SPAWN_NEAR = 0.75;
// DominoEX's squelch: opens when the strongest tone's share is over the first, the forbidden steps' share under the second, the share of
// characters in the table over the third, and THOR's parity check under THOR_NOT once it's had THOR_VERDICT symbols; closes when the
// share is under the fourth, the steps over the fifth or the characters under the sixth. The fourth is also the share a symbol's read
// cleanly at (THOR_VERDICT's symbols, the whole-tone check's)
const THOR_DEX_QUAL_OPEN = 0.3;
const THOR_DEX_BAD_OPEN = 0.05;
const THOR_DEX_VALID_OPEN = 0.9;
const THOR_DEX_QUAL_CLOSE = 0.24;
const THOR_DEX_BAD_CLOSE = 0.1;
const THOR_DEX_VALID_CLOSE = 0.7;
// THOR's parity check (the share of bits keeping it, averaged with this share a bit, after a plain average over the first bits): opens
// over the first, closes under the second; a signal is taken as not THOR under the third, once it's been read cleanly for this many
// symbols running (the deinterleaver's 31, and more)
const THOR_SYND_SHARE = 1 / 32;
const THOR_SYND_OPEN = 0.8;
const THOR_SYND_CLOSE = 0.65;
const THOR_NOT = 0.7;
const THOR_VERDICT = 46;
// Both: the strongest tone read at the symbol's best point against half a symbol from it (about 1 for noise, another mode or another
// speed; several times for a signal at this speed): over the first to open (and forbidden steps under THOR_DEX_BAD_CLOSE), under the
// second closes
const THOR_CONTRAST_OPEN = 2;
const THOR_CONTRAST_CLOSE = 1.2;
// ... its averages' share a symbol (the timing's own follow faster: THOR_POINT_SHARE); DominoEX opens only once all its tests have passed
// this many symbols running
const THOR_SLOW_POINT_SHARE = 1 / 24;
const THOR_STEADY = 16;
// Each tone's chance: its energy against the noise's, times this, as a log likelihood; THOR's soft bits kept within this. The Viterbi
// decoder's decisions are taken this many bits back; the interleaver's depth (symbols)
const THOR_SOFT_GAIN = 1;
const THOR_SOFT_CLIP = 8;
const THOR_TRACEBACK = 45;
const THOR_DEPTH = 10;
// Symbols a character is held before it goes out. A signal's gone when its strongest tone is suddenly under the first share of its
// average, or its nibbles are read less surely than THOR_SURE (their chance among the 18 steps) this many symbols running; what was read after
// its last symbol read more surely than THOR_SURE_END, the one before surely too (of THOR_LEVELS kept), is dropped. THOR's decoder reads
// on for THOR_LAG symbols after that (its decisions are taken that far back, two bits a symbol; the deinterleaver's last 30 symbols before
// it went are partly noise, the sender's to fill with idle)
const THOR_HOLD = 12;
const THOR_GONE = 0.15;
const THOR_GONE_RUN = 3;
const THOR_LEVELS = 64;
const THOR_SURE = 0.5;
const THOR_SURE_END = 0.8;
const THOR_LAG = Math.ceil(THOR_TRACEBACK / 2) + 1;

// DominoEX's primary varicode for ASCII 0 to 127, each nibble a hex digit in the order sent. "<" (60) is listed as 0, 8, 10 in the table,
// the same as ":"; 0, 10, 8, the one code in its row the table leaves unused, is taken as "<"
const THOR_DEX_PRIMARY = [
  "1f9", "1fa", "1fb", "1fc", "1fd", "1fe", "1ff", "288", "2c", "289", "28a", "28b", "28c", "2d", "28d", "28e",
  "28f", "298", "299", "29a", "29b", "29c", "29d", "29e", "29f", "2a8", "2a9", "2aa", "2ab", "2ac", "2ad", "2ae",
  "0", "7b", "08e", "0ab", "09a", "099", "08f", "7a", "08c", "08b", "09d", "088", "2b", "7e", "7d", "089",
  "3f", "4a", "4f", "59", "68", "5c", "5e", "6c", "6b", "6e", "08a", "08d", "0a8", "7f", "09f", "7c",
  "098", "39", "4e", "3c", "3e", "38", "4c", "58", "5a", "3a", "78", "6a", "4b", "48", "4d", "3b",
  "49", "6f", "3d", "2f", "2e", "5b", "6d", "5d", "5f", "69", "79", "0ae", "0a9", "0af", "0aa", "09c",
  "09b", "4", "1b", "0c", "0b", "1", "0f", "19", "0a", "5", "2a", "1e", "09", "0e", "6", "3",
  "18", "28", "7", "08", "2", "0d", "1d", "1c", "1f", "1a", "29", "0ac", "09e", "0ad", "0b8", "2af"
];

// The whole DominoEX table: a code (its nibbles, the first the highest of 12 bits, and their number times 4096) to its character
// (0 to 255, plus 256 for the secondary alphabet's). The extended characters run on from the table's last codes: 128 to 159 from 2, 11, 8;
// 160 to 198 from 0, 11, 9; 199 to 255 from 1, 8, 8 (counting the second and third nibbles 8 to 15). A secondary character's code is its
// primary one's moved on: one nibble n becomes 3, 8, 8 + n; two a, b become 4, 8 + a, b; three a, b, c become 5 + a, b, c
const THOR_DEX = (() =>
{
  const table = new Map();
  const key = (nibbles) => nibbles.length * 4096 + nibbles.reduce((v, n, i) => v | (n << (8 - 4 * i)), 0);
  const add = (ascii, nibbles) =>
  {
    table.set(key(nibbles), ascii);
    let second;
    if (nibbles.length == 1) second = [3, 8, 8 + nibbles[0]];
    else if (nibbles.length == 2) second = [4, 8 + nibbles[0], nibbles[1]];
    else second = [5 + nibbles[0], nibbles[1], nibbles[2]];
    table.set(key(second), 256 + ascii);
  };
  THOR_DEX_PRIMARY.forEach((code, ascii) => add(ascii, [...code].map((d) => parseInt(d, 16))));
  const run = (from, to, first, at) =>
  {
    for (let c = from; c <= to; c++, at++) add(c, [first, 8 + (at >> 3), 8 + (at & 7)]);
  };
  run(128, 159, 2, 3 * 8);
  run(160, 198, 0, 3 * 8 + 1);
  run(199, 255, 1, 0);
  return { table, key };
})();

// The MFSK16 varicode (IZ8BLY): characters most used first; the nth one's code is the nth of the bit strings starting 1 and ending 00
// with no 001 in them, shortest first, then by value. A code (as a number, its leading 1 marking its length) to its character
const THOR_MFSK_ORDER = [32, 101, 116, 111, 97, 105, 110, 114, 115, 108, 104, 100, 99, 117, 109, 102, 112, 103, 121, 98, 119, 118, 107,
  120, 113, 122, 106, 44, 8, 13, 84, 83, 69, 65, 73, 79, 67, 82, 68, 48, 77, 80, 49, 76, 70, 78, 66, 50, 71, 51, 72, 85, 53, 87, 54,
  88, 52, 89, 75, 56, 55, 86, 57, 81, 74, 90, 39, 33, 63, 46, 45, 61, 43, 47, 58, 41, 40, 59, 34, 38, 64, 37, 36, 96, 95, 42, 124, 62,
  60, 92, 94, 35, 123, 125, 91, 93, 126];
const THOR_MFSK = (() =>
{
  const order = THOR_MFSK_ORDER.slice();
  for (let c = 160; c < 256; c++) order.push(c);
  for (let c = 0; c < 32; c++) if (c != 8 && c != 13) order.push(c);
  order.push(127);
  for (let c = 128; c < 160; c++) order.push(c);
  const table = new Map();
  let n = 0;
  for (let len = 3; n < order.length; len++)
  {
    for (let v = 1 << (len - 1); v < 1 << len && n < order.length; v++)
    {
      const s = v.toString(2);
      if (s.endsWith("00") && !s.includes("001")) table.set(v, order[n++]);
    }
  }
  return table;
})();

// THOR's ways tried: the code's taps (bit 0 the newest; the second pair is the first read from the other end), the first sent first
const THOR_POLYS = [[0x6d, 0x4f], [0x5b, 0x79]];

let thorRate = 48000;
let thorMode = "dominoex";
let thorSpeeds = [11];
let thorMinHz = 200;
let thorMaxHz = 3000;
// The rate the work's done at, the highest frequency kept, and the stage bringing the audio down to it
let thorFd = 8000;
let thorTop = THOR_TOP_HZ;
let thorFront = null;
// Samples (at thorFd) so far: the clock everything's timed by; the audio kept
let thorNow = 0;
let thorHistory = new Float32Array(1);
let thorHistoryMask = 0;
let thorLanes = [];
let thorNextId = 1;
let thorRsidHolds = [];
let thorLastPost = 0;
let thorLastFlush = 0;

self.onmessage = (event) =>
{
  const m = event.data;
  if (m.type == "init") thorInit(m.rate);
  else if (m.type == "reset")
  {
    thorInit(thorRate);
    thorPostChannels();
  }
  else if (m.type == "config") thorConfig(m);
  else if (m.type == "rsid") thorRsid(Number(m.freq));
  else if (m.type == "audio")
  {
    if (!thorFront) thorInit(thorRate);
    thorAudio(m.samples);
  }
};

function thorInit(rate)
{
  thorRate = rate > 0 ? rate : 48000;
  const d = Math.max(1, Math.floor(thorRate / THOR_WORK_RATE));
  thorFd = thorRate / d;
  thorTop = Math.min(THOR_TOP_HZ, thorFd * 0.45);
  thorFront = thorDecimator(thorRate, d, thorTop);
  // The longest lane's window and a little
  let size = 1;
  while (size < thorFd * 0.6) size *= 2;
  thorHistory = new Float32Array(size);
  thorHistoryMask = size - 1;
  thorNow = 0;
  thorLastPost = 0;
  thorLastFlush = 0;
  thorRsidHolds = [];
  thorLanes = thorSpeeds.map((speed) => new ThorLane(speed));
}

// The mode, speeds and range: other speeds or another range start the lanes over; another mode only changes what's printed
function thorConfig(m)
{
  const mode = m.mode == "thor" || m.mode == "any" ? m.mode : "dominoex";
  let speeds = m.baud == "all" ? Object.keys(THOR_SPEEDS).map(Number) : [].concat(m.baud === undefined ? m.submode : m.baud).map(Number);
  speeds = speeds.filter((s, i) => THOR_SPEEDS[s] && speeds.indexOf(s) == i).sort((a, b) => a - b);
  if (speeds.length == 0) speeds = [11];
  const min = Number(m.minHz);
  const max = Number(m.maxHz);
  const minHz = Number.isFinite(min) ? Math.max(50, Math.min(min, THOR_TOP_HZ - 200)) : 200;
  const maxHz = Number.isFinite(max) && max >= minHz + 100 ? Math.min(max, THOR_TOP_HZ) : Math.max(minHz + 100, 3000);
  const restart = speeds.join() != thorSpeeds.join() || minHz != thorMinHz || maxHz != thorMaxHz;
  thorMode = mode;
  thorSpeeds = speeds;
  thorMinHz = minHz;
  thorMaxHz = maxHz;
  if (restart && thorFront)
  {
    thorFlush();
    thorLanes = thorSpeeds.map((speed) => new ThorLane(speed));
  }
  thorPostChannels();
}

// ---- The audio brought down to thorFd: a low-pass filter (a windowed sinc, Blackman) keeping up to top, worked out only for the
// samples kept (every dth)
function thorDecimator(rate, d, top)
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

// A complex FFT in place (radix 2), n a power of 2. The swaps putting the input in bit-reversed order listed once; each stage's turns
// side by side (stage of half h at h to 2h - 1), each worked through every block before the next is taken
function thorFft(n)
{
  const bits = Math.round(Math.log2(n));
  const swaps = [];
  for (let i = 0; i < n; i++)
  {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    if (r > i) swaps.push(i, r);
  }
  const swap = Uint32Array.from(swaps);
  const cos = new Float64Array(n);
  const sin = new Float64Array(n);
  for (let half = 1; half < n; half *= 2)
  {
    for (let j = 0; j < half; j++)
    {
      cos[half + j] = Math.cos((Math.PI * j) / half);
      sin[half + j] = Math.sin((Math.PI * j) / half);
    }
  }
  return (re, im) =>
  {
    for (let k = 0; k < swap.length; k += 2)
    {
      const i = swap[k];
      const j = swap[k + 1];
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
    // The first stage's turn is 1
    for (let a = 0; a < n; a += 2)
    {
      const tr = re[a + 1];
      const ti = im[a + 1];
      re[a + 1] = re[a] - tr;
      im[a + 1] = im[a] - ti;
      re[a] += tr;
      im[a] += ti;
    }
    for (let half = 2; half < n; half *= 2)
    {
      const size = 2 * half;
      for (let j = 0; j < half; j++)
      {
        const c = cos[half + j];
        const s = sin[half + j];
        for (let a = j; a < n; a += size)
        {
          const b = a + half;
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

// 1 when v has an odd number of bits set
function thorParity(v)
{
  v ^= v >> 16;
  v ^= v >> 8;
  v ^= v >> 4;
  v ^= v >> 2;
  v ^= v >> 1;
  return v & 1;
}

// ---- Each block of audio: brought down, kept, every lane's spectra it completes worked through; the channel list four times a second,
// the text ten
function thorAudio(samples)
{
  const x = thorFront(samples);
  if (x.length == 0) return;
  for (let i = 0; i < x.length; i++) thorHistory[(thorNow + i) & thorHistoryMask] = x[i];
  thorNow += x.length;
  for (const lane of thorLanes) lane.run();
  if (thorLanes.length > 1) thorConflicts();
  if (thorNow - thorLastFlush >= thorFd / 10)
  {
    thorLastFlush = thorNow;
    thorFlush();
  }
  if (thorNow - thorLastPost >= thorFd / 4)
  {
    thorLastPost = thorNow;
    for (const lane of thorLanes) lane.tidy();
    thorPostChannels();
  }
}

// Whether a channel's mode is one printed
function thorShown(c)
{
  return c.mode != null && (thorMode == "any" || thorMode == c.mode);
}

function thorFlush()
{
  for (const lane of thorLanes)
  {
    for (const c of lane.channels)
    {
      if (c.text.length == 0) continue;
      if (thorShown(c) && !c.conflict) self.postMessage({ type: "text", id: c.id, text: c.text });
      c.text = "";
    }
  }
}

function thorPostChannels()
{
  const list = [];
  for (const lane of thorLanes) for (const c of lane.channels) if (c.everActive && thorShown(c) && !c.conflict) list.push(c);
  list.sort((a, b) => a.freq - b.freq);
  self.postMessage({ type: "channels", list: list.map((c) => ({ id: c.id, freq: Math.round(c.freq * 10) / 10, snr: Math.round(c.snr), active: c.active, mode: c.mode, submode: c.lane.speed })) });
}

// Channels in different lanes on one signal (their centres closer than a quarter of their widths together): only the one reading it best
// (its strongest tone's share) prints
function thorConflicts()
{
  const all = [];
  for (const lane of thorLanes) for (const c of lane.channels) all.push(c);
  for (const c of all) c.conflict = false;
  for (let i = 0; i < all.length; i++)
  {
    for (let j = i + 1; j < all.length; j++)
    {
      const a = all[i];
      const b = all[j];
      if (a.lane == b.lane || !a.everActive || !b.everActive) continue;
      if (Math.abs(a.freq - b.freq) > (a.lane.width + b.lane.width) / 4) continue;
      if (a.qual < b.qual) a.conflict = true;
      else b.conflict = true;
    }
  }
}

// An RSID just heard at freq (mmdRsid.js): its tones look like a signal to the finder, so the channels still on trial near there go, and
// the place is left alone a moment
function thorRsid(freq)
{
  if (!(freq > 0)) return;
  for (const lane of thorLanes) lane.channels = lane.channels.filter((c) => c.everActive || Math.abs(c.freq - freq) > THOR_RSID_NEAR_HZ);
  thorRsidHolds = thorRsidHolds.filter((h) => h.until > thorNow);
  thorRsidHolds.push({ freq, until: thorNow + THOR_RSID_HOLD_SECONDS * thorFd });
  thorPostChannels();
}

// ---- A lane: one speed's spectra, finder and channels
class ThorLane
{
  constructor(speed)
  {
    this.speed = speed;
    const [baud, mult] = THOR_SPEEDS[speed];
    this.baud = baud;
    this.spacing = baud * mult;
    this.width = THOR_TONES * this.spacing;
    // A symbol's length (samples, not a whole number), the window (a whole number), the FFT's size and its bins
    this.sym = thorFd / baud;
    this.len = Math.round(this.sym);
    let n = 1;
    while (n < THOR_PAD * this.len) n *= 2;
    this.n = n;
    this.binHz = thorFd / n;
    this.fft = thorFft(n);
    this.re = new Float64Array(n);
    this.im = new Float64Array(n);
    // Where each tone falls (bins from the lowest), from the one just below (-1) to the one just above (18)
    this.off = new Int32Array(THOR_TONES + 2);
    for (let j = 0; j < THOR_TONES + 2; j++) this.off[j] = Math.round(((j - 1) * this.spacing) / this.binHz);
    this.toneBins = this.spacing / this.binHz;
    // ... and from THOR_WIDE tones below the lowest to THOR_WIDE above the highest (a channel's whole-tone check)
    this.wide = new Int32Array(THOR_TONES + 2 * THOR_WIDE);
    for (let j = 0; j < this.wide.length; j++) this.wide[j] = Math.round(((j - THOR_WIDE) * this.spacing) / this.binHz);
    // The places looked at (the lowest tone's bin, k0) put the centre in the range; the bins kept cover their tones and the ones just
    // outside
    const half = ((THOR_TONES - 1) / 2) * this.spacing;
    const top = Math.min(thorMaxHz, thorTop - half - this.spacing);
    this.k0Min = Math.ceil((thorMinHz - half) / this.binHz);
    this.k0Max = Math.floor((top - half) / this.binHz);
    this.kLo = Math.max(1, this.k0Min + this.off[0] - 4);
    this.k0Min = Math.max(this.k0Min, this.kLo - this.off[0] + 4);
    this.kHi = Math.min(n / 2 - 2, this.k0Max + this.off[THOR_TONES + 1] + 4);
    this.k0Max = Math.min(this.k0Max, this.kHi - this.off[THOR_TONES + 1] - 4);
    this.k = Math.max(0, Math.floor((this.k0Max - this.k0Min) / THOR_FIND_EVERY) + 1);
    this.w = this.kHi - this.kLo + 1;
    this.kept = THOR_POINTS * Math.max(THOR_HISTORY_SYMBOLS, Math.ceil(THOR_HISTORY_SECONDS * baud));
    this.spec = new Float32Array(this.kept * this.w);
    // The finder's averages and each place's strongest tone a symbol ago, by point in the symbol (every THOR_FIND_EVERY places and points)
    this.avg = new Float32Array((THOR_POINTS / THOR_FIND_EVERY) * this.k);
    this.last = new Int8Array((THOR_POINTS / THOR_FIND_EVERY) * this.k).fill(-1);
    this.next = 0;
    this.scanEvery = Math.max(THOR_POINTS, Math.round(THOR_SCAN_SECONDS * THOR_POINTS * baud));
    this.lastScan = 0;
    this.candidates = [];
    this.channels = [];
    this.blocked = [];
  }

  // Where spectrum i's window starts (samples at thorFd)
  start(i)
  {
    return Math.round((i * this.sym) / THOR_POINTS);
  }

  // Spectrum i's row of the ring (its bins from kLo)
  row(i)
  {
    const r = i % this.kept;
    return this.spec.subarray(r * this.w, (r + 1) * this.w);
  }

  // Every spectrum the audio now completes, two at a time (two real windows in one complex FFT)
  run()
  {
    while (this.start(this.next + 1) + this.len <= thorNow)
    {
      if (this.start(this.next) < thorNow - thorHistory.length)
      {
        // Fallen behind the audio kept (never in practice): skipped
        this.next += 2;
        continue;
      }
      this.pair(this.next);
      for (const i of [this.next, this.next + 1])
      {
        this.find(i);
        for (const c of this.channels) c.spectrum(i);
        for (let n = 0; n < this.channels.length; n++) if (this.channels[n].respawn) this.channels[n] = this.again(this.channels[n], i);
      }
      this.next += 2;
      if (this.next - this.lastScan >= this.scanEvery)
      {
        this.lastScan = this.next;
        this.scan();
      }
    }
  }

  // Spectra i and i + 1: the first window as the real part, the second as the imaginary, each one's power then taken apart
  pair(i)
  {
    const a = this.start(i);
    const b = this.start(i + 1);
    const re = this.re;
    const im = this.im;
    re.fill(0);
    im.fill(0);
    for (let n = 0; n < this.len; n++)
    {
      re[n] = thorHistory[(a + n) & thorHistoryMask];
      im[n] = thorHistory[(b + n) & thorHistoryMask];
    }
    this.fft(re, im);
    const r0 = this.row(i);
    const r1 = this.row(i + 1);
    const n = this.n;
    const scale = 1 / this.len;
    for (let k = this.kLo; k <= this.kHi; k++)
    {
      const xr = re[k] + re[n - k];
      const xi = im[k] - im[n - k];
      const yr = im[k] + im[n - k];
      const yi = re[k] - re[n - k];
      r0[k - this.kLo] = (xr * xr + xi * xi) * scale;
      r1[k - this.kLo] = (yr * yr + yi * yi) * scale;
    }
  }

  // The finder's averages brought up to date with spectrum i: at each place, the strongest of the 18 tones' share of them, unless it's
  // a tone just outside, the last symbol's tone or the one above it
  find(i)
  {
    if (i % THOR_FIND_EVERY) return;
    const row = this.row(i);
    const p = (i % THOR_POINTS) / THOR_FIND_EVERY;
    const avg = this.avg;
    const last = this.last;
    const off = this.off;
    const base = p * this.k;
    for (let c = 0; c < this.k; c++)
    {
      const at = this.k0Min + c * THOR_FIND_EVERY - this.kLo;
      let top = -1;
      let best = 0;
      let sum = 0;
      for (let j = 0; j < THOR_TONES + 2; j++)
      {
        const e = row[at + off[j]];
        if (e > best)
        {
          best = e;
          top = j;
        }
        if (j > 0 && j <= THOR_TONES) sum += e;
      }
      let m = 0;
      const tone = top - 1;
      if (tone >= 0 && tone < THOR_TONES && sum > 0)
      {
        const before = last[base + c];
        const step = before < 0 ? 2 : (tone - before + THOR_TONES) % THOR_TONES;
        if (step >= 2) m = best / sum;
      }
      last[base + c] = tone >= 0 && tone < THOR_TONES ? tone : -1;
      avg[base + c] += THOR_FIND_SHARE * (m - avg[base + c]);
    }
  }

  // The places over THOR_FIND, the best for the width of a signal around; one seen in THOR_FIND_LOOKS looks running (within two bins)
  // gets a channel, unless a channel's already there or the place is blocked
  scan()
  {
    if (this.next < THOR_POINTS * 12) return;
    const found = [];
    for (let p = 0; p < THOR_POINTS / THOR_FIND_EVERY; p++)
    {
      for (let c = 0; c < this.k; c++)
      {
        const v = this.avg[p * this.k + c];
        if (v >= THOR_FIND) found.push({ v, k0: this.k0Min + c * THOR_FIND_EVERY, p: p * THOR_FIND_EVERY });
      }
    }
    found.sort((a, b) => b.v - a.v);
    const reach = (THOR_TONES - 1) * this.toneBins;
    const picked = [];
    for (const f of found)
    {
      if (picked.some((q) => Math.abs(q.k0 - f.k0) < reach)) continue;
      picked.push(f);
    }
    const candidates = [];
    for (const f of picked)
    {
      const before = this.candidates.find((q) => Math.abs(q.k0 - f.k0) <= 2);
      f.looks = before ? before.looks + 1 : 1;
      candidates.push(f);
    }
    this.candidates = candidates;
    this.blocked = this.blocked.filter((b) => b.until > thorNow);
    for (const f of candidates)
    {
      if (f.looks < THOR_FIND_LOOKS) continue;
      const freq = this.centre(f.k0);
      if (this.channels.some((c) => Math.abs(c.k0 - f.k0) < reach)) continue;
      if (this.blocked.some((b) => Math.abs(b.freq - freq) < this.spacing * 2)) continue;
      if (thorRsidHolds.some((h) => h.until > thorNow && Math.abs(h.freq - freq) < THOR_RSID_NEAR_HZ)) continue;
      if (!this.room()) break;
      this.spawn(f.k0, f.p);
    }
  }

  // Room for one more channel: under the limit, or the oldest still on trial made way for
  room()
  {
    if (this.channels.length < THOR_MAX) return true;
    let oldest = null;
    for (const c of this.channels) if (!c.everActive && (!oldest || c.born < oldest.born)) oldest = c;
    if (!oldest) return false;
    this.channels = this.channels.filter((c) => c != oldest);
    return true;
  }

  // The centre (Hz) of a signal whose lowest tone is at bin k0
  centre(k0)
  {
    return k0 * this.binHz + ((THOR_TONES - 1) / 2) * this.spacing;
  }

  // A channel at k0, or within two tones of it where the 18 tones fit the spectra kept (at point p) best: each symbol's strongest of the
  // 18 less the stronger of the two just outside, against the strongest anywhere near (the finder's places are two bins apart, and a
  // place a tone off scores nearly as well there). A signal's first symbols needn't have visited its highest or lowest tones, so places
  // a tone or two apart can fit as well: the middle of those nearly as good as the best is taken. It runs over the spectra kept first
  spawn(k0, p)
  {
    const first = Math.max(0, this.next - this.kept + 2);
    const tb = Math.round(2 * this.toneBins);
    const lo = Math.max(this.k0Min, k0 - tb);
    const hi = Math.min(this.k0Max, k0 + tb);
    const scores = new Float64Array(hi - lo + 1);
    for (let i = first + ((p - (first % THOR_POINTS) + THOR_POINTS) % THOR_POINTS); i < this.next; i += THOR_POINTS)
    {
      const row = this.row(i);
      let most = 0;
      for (let k = lo - this.kLo + this.off[0]; k <= hi - this.kLo + this.off[THOR_TONES + 1]; k++) most = Math.max(most, row[k]);
      if (!(most > 0)) continue;
      for (let k = lo; k <= hi; k++)
      {
        const at = k - this.kLo;
        let inside = 0;
        for (let j = 1; j <= THOR_TONES; j++) inside = Math.max(inside, row[at + this.off[j]]);
        scores[k - lo] += (inside - Math.max(row[at + this.off[0]], row[at + this.off[THOR_TONES + 1]])) / most;
      }
    }
    let top = -Infinity;
    for (const s of scores) top = Math.max(top, s);
    const near = [];
    for (let k = lo; k <= hi; k++) if (scores[k - lo] >= top - THOR_SPAWN_NEAR) near.push(k);
    const best = near[near.length >> 1];
    const c = new ThorChannel(this, thorNextId++, best, p, first);
    for (let i = first; i < this.next; i++) c.spectrum(i);
    this.channels.push(this.settled(c, c.respawn, this.next - 1));
  }

  // Channel c run over the spectra kept up to i has settled its place, drift and timing: it's made again there (its timing's averages
  // kept; its place where its drift says it was at the first spectrum kept) and run over them again, so its first symbols are read as
  // well as the rest; dir tones over when it was found that far off
  settled(c, dir, i)
  {
    const first = Math.max(0, this.next - this.kept + 2);
    const pos = c.pos + dir * this.toneBins - (c.drift * (i - first)) / THOR_POINTS;
    const fresh = new ThorChannel(this, c.id, c.k0, c.nextRead % THOR_POINTS, first);
    fresh.place(pos);
    fresh.drift = c.drift;
    fresh.points.set(c.points);
    fresh.slowPoints.set(c.slowPoints);
    fresh.respawns = c.respawns + (dir ? 1 : 0);
    fresh.born = c.born;
    for (let k = first; k <= i; k++) fresh.spectrum(k);
    return fresh;
  }

  // Channel c, found a tone off before it decoded anything (at spectrum i), made again a tone over
  again(c, i)
  {
    return this.settled(c, c.respawn, i);
  }

  // Channels dropped: silent too long, never decoded in their trial, wandered out of range, or on top of another (the newer one goes,
  // unless only it has decoded)
  tidy()
  {
    const drop = new Set();
    const symbols = (pair) => Math.max(pair[0] * thorFd, (pair[1] * this.sym));
    for (const c of this.channels)
    {
      if (c.everActive && thorNow - c.lastGood > symbols(THOR_DROP)) drop.add(c);
      else if (!c.everActive && thorNow - c.born > symbols(THOR_TRIAL))
      {
        drop.add(c);
        this.blocked.push({ freq: c.freq, until: thorNow + THOR_BLOCK_SECONDS * thorFd });
      }
      else if (c.pos <= this.k0Min - 2 || c.pos >= this.k0Max + 2) drop.add(c);
    }
    const reach = (THOR_TONES / 2) * this.toneBins;
    for (let i = 0; i < this.channels.length; i++)
    {
      for (let j = i + 1; j < this.channels.length; j++)
      {
        const a = this.channels[i];
        const b = this.channels[j];
        if (drop.has(a) || drop.has(b) || Math.abs(a.k0 - b.k0) >= reach) continue;
        drop.add(a.everActive != b.everActive ? (a.everActive ? b : a) : a.id > b.id ? a : b);
      }
    }
    if (drop.size)
    {
      for (const c of drop) if (c.text.length && thorShown(c) && !c.conflict) self.postMessage({ type: "text", id: c.id, text: c.text });
      this.channels = this.channels.filter((c) => !drop.has(c));
    }
  }
}

// ---- One way of reading THOR's bits (the code's taps, and where the pairs start): the parity check, the Viterbi decoder and the
// varicode. Fed one soft bit at a time (a log likelihood, positive for a 0)
class ThorDecoder
{
  constructor(polys, skip)
  {
    this.p1 = polys[0];
    this.p2 = polys[1];
    // Each register value's (the newest bit 0) two outputs, as 1 - 2 x bit
    this.out1 = new Float64Array(128);
    this.out2 = new Float64Array(128);
    for (let r = 0; r < 128; r++)
    {
      this.out1[r] = 1 - 2 * thorParity(r & this.p1);
      this.out2[r] = 1 - 2 * thorParity(r & this.p2);
    }
    this.skip = skip;
    this.held = null;
    this.y1 = 0;
    this.y2 = 0;
    this.bits = 0;
    this.checks = 0;
    this.synd = 0.5;
    this.metric = new Float64Array(64);
    this.fresh = new Float64Array(64);
    this.choice = new Uint32Array(2 * THOR_TRACEBACK);
    this.steps = 0;
    this.acc = 0;
    this.accLen = 0;
    this.chars = [];
  }

  feed(llr, at)
  {
    if (this.skip)
    {
      this.skip = false;
      return;
    }
    if (this.held == null)
    {
      this.held = llr;
      return;
    }
    const l1 = this.held;
    this.held = null;
    this.step(l1, llr, at);
  }

  step(l1, l2, at)
  {
    // The parity check on the hard bits: the first output run through the second's taps equals the second run through the first's
    this.y1 = ((this.y1 << 1) | (l1 < 0 ? 1 : 0)) & 127;
    this.y2 = ((this.y2 << 1) | (l2 < 0 ? 1 : 0)) & 127;
    this.bits++;
    // (A run of 0s keeps every way's parity check, so says nothing)
    if (this.bits >= 7 && (this.y1 || this.y2))
    {
      const keep = 1 - (thorParity(this.y1 & this.p2) ^ thorParity(this.y2 & this.p1));
      this.checks++;
      this.synd += Math.max(THOR_SYND_SHARE, 1 / this.checks) * (keep - this.synd);
    }
    // The Viterbi decoder: state the last six bits (the newest bit 0); each new state from the two it can follow
    const old = this.metric;
    const fresh = this.fresh;
    let lo = 0;
    let hi = 0;
    let best = -Infinity;
    let bestState = 0;
    for (let s = 0; s < 64; s++)
    {
      const a = s >> 1;
      const b = a | 32;
      const ra = s;
      const rb = s | 64;
      const ma = old[a] + this.out1[ra] * l1 + this.out2[ra] * l2;
      const mb = old[b] + this.out1[rb] * l1 + this.out2[rb] * l2;
      let m = ma;
      if (mb > ma)
      {
        m = mb;
        if (s < 32) lo |= 1 << s;
        else hi |= 1 << (s - 32);
      }
      fresh[s] = m;
      if (m > best)
      {
        best = m;
        bestState = s;
      }
    }
    for (let s = 0; s < 64; s++) old[s] = fresh[s] - best;
    const slot = this.steps % THOR_TRACEBACK;
    this.choice[2 * slot] = lo >>> 0;
    this.choice[2 * slot + 1] = hi >>> 0;
    this.steps++;
    if (this.steps < THOR_TRACEBACK) return;
    // Traced back from the best state: the oldest bit kept is decided
    let state = bestState;
    for (let back = 0; back < THOR_TRACEBACK - 1; back++)
    {
      const k = (this.steps - 1 - back) % THOR_TRACEBACK;
      const word = state < 32 ? this.choice[2 * k] : this.choice[2 * k + 1];
      const h = (word >>> (state & 31)) & 1;
      state = (state >> 1) | (h << 5);
    }
    this.bit(state & 1, at);
  }

  // A decoded bit into the varicode: a 1 after 00 ends the character before it
  bit(b, at)
  {
    if (b && this.accLen >= 3 && (this.acc & 3) == 0)
    {
      const ascii = THOR_MFSK.get(this.acc);
      if (ascii !== undefined) this.chars.push({ ascii, at, synd: this.synd });
      if (this.chars.length > 200) this.chars.splice(0, 100);
      this.acc = 0;
      this.accLen = 0;
    }
    if (this.accLen == 0 && !b) return;
    this.acc = (this.acc << 1) | b;
    this.accLen++;
    if (this.accLen > 14)
    {
      this.acc = 0;
      this.accLen = 0;
    }
  }
}

// ---- A channel: one signal, read both as DominoEX and as THOR
class ThorChannel
{
  constructor(lane, id, k0, p, first)
  {
    this.lane = lane;
    this.id = id;
    this.k0 = k0;
    this.freq = lane.centre(k0);
    // The next spectrum read (one a symbol), and each point's strongest tone, averaged (for the timing)
    this.nextRead = first + ((p - (first % THOR_POINTS) + THOR_POINTS) % THOR_POINTS);
    this.points = new Float64Array(THOR_POINTS);
    this.slowPoints = new Float64Array(THOR_POINTS);
    // How often each place has held the strongest tone (the whole-tone check) and in how many symbols, since it last moved the channel;
    // and the AFC's place (k0, not a whole number) and drift (bins a symbol)
    this.hits = new Float64Array(lane.wide.length);
    this.counted = 0;
    this.pos = k0;
    this.drift = 0;
    this.respawn = 0;
    this.respawns = 0;
    this.e = new Float64Array(THOR_SEEN);
    this.symbols = 0;
    this.lastTone = -1;
    this.qual = 0;
    this.clean = 0;
    this.steady = 0;
    this.bad = 0.1;
    this.quick = 0;
    this.slow = 0;
    this.sure = new Float64Array(THOR_LEVELS);
    this.signal = 0;
    this.noise = 0;
    this.snr = -30;
    // DominoEX: the character's nibbles so far (null once it's too long: waiting for the next start), the share of characters in the
    // table, and the characters read ({ ascii, at (symbol), qual })
    this.nibbles = [];
    this.nibbleAt = 0;
    this.valid = 0.5;
    this.dexChars = [];
    // THOR: each way's soft bits kept for the deinterleaver (two codings of the nibble, 31 symbols of 4), and the 16 decoders (by coding,
    // interleaver direction, taps and where the pairs start)
    this.soft = [new Float32Array(32 * 4), new Float32Array(32 * 4)];
    // Each place's chance this symbol and the last, and each nibble's
    this.prob = new Float64Array(THOR_SEEN);
    this.lastProb = new Float64Array(THOR_SEEN);
    this.nib = new Float64Array(16);
    this.decoders = [];
    for (let coding = 0; coding < 2; coding++)
    {
      for (let dir = 0; dir < 2; dir++)
      {
        for (const polys of THOR_POLYS) for (const skip of [false, true]) this.decoders.push({ coding, dir, d: new ThorDecoder(polys, skip) });
      }
    }
    this.best = 0;
    // The squelch, and what's been printed (the last character's symbol, per kind)
    this.mode = null;
    this.placed = false;
    this.ending = -1;
    this.active = false;
    this.everActive = false;
    this.conflict = false;
    this.printed = -1;
    this.afterCr = false;
    this.text = "";
    this.born = thorNow;
    this.lastGood = thorNow;
  }

  // Spectrum i: each point's strength brought up to date; the symbol read when it's due
  spectrum(i)
  {
    const lane = this.lane;
    const row = lane.row(i);
    const at = this.k0 - lane.kLo;
    let top = 0;
    for (let j = 1; j <= THOR_TONES; j++) top = Math.max(top, row[at + lane.off[j]]);
    const p = i % THOR_POINTS;
    this.points[p] += THOR_POINT_SHARE * (top - this.points[p]);
    this.slowPoints[p] += THOR_SLOW_POINT_SHARE * (top - this.slowPoints[p]);
    if (i < this.nextRead) return;
    this.symbol(row);
    // The next read a symbol on, a point earlier or later when that point's strongest tone is stronger
    const before = this.points[(p + THOR_POINTS - 1) % THOR_POINTS];
    const after = this.points[(p + 1) % THOR_POINTS];
    const here = this.points[p];
    let move = 0;
    if (after > here * 1.03 && after >= before) move = 1;
    else if (before > here * 1.03 && before > after) move = -1;
    this.nextRead = i + THOR_POINTS + move;
  }

  // A symbol: the energies of its 18 tones and the places just outside (THOR_SEEN, place j the tone j - 1: a nibble is the step from one
  // symbol's tone to the next, round the 18, wherever the 18 start, so a channel a tone off still reads it), the strongest; the AFC and
  // whole-tone check; the quality averages; the DominoEX nibble and THOR's soft bits; the squelch
  symbol(row)
  {
    const lane = this.lane;
    const off = lane.off;
    const at = this.k0 - lane.kLo;
    const e = this.e;
    let sum = 0;
    let tone = 0;
    for (let j = 0; j < THOR_SEEN; j++)
    {
      e[j] = row[at + off[j]];
      sum += e[j];
      if (e[j] > e[tone]) tone = j;
    }
    const noise = Math.max(1e-20, (sum - e[tone]) / (THOR_SEEN - 1));
    const share = sum > 0 ? e[tone] / sum : 0;
    this.qual += THOR_QUAL_SHARE * (share - this.qual);
    this.quick += (e[tone] - this.quick) / 3;
    this.slow += (e[tone] - this.slow) / 30;
    // The SNR, while there's a signal to measure: the strongest tone (less the noise in it) against the others' average, in a symbol's
    // bandwidth (the window's: the baud), then in 2500 Hz
    if (this.ending < 0 && (this.active || this.qual > THOR_DEX_QUAL_OPEN))
    {
      this.signal += THOR_SNR_SHARE * (Math.max(0, e[tone] - noise) - this.signal);
      this.noise += THOR_SNR_SHARE * (noise - this.noise);
      if (this.noise > 0) this.snr = Math.max(-30, 10 * Math.log10(Math.max(1e-3, this.signal / this.noise) * (lane.baud / 2500)));
    }
    this.afc(row, tone - 1, share);
    const moved = this.wholeTone(row, at);
    // Each place's chance (its energy against the noise's, as a likelihood)
    const prob = this.prob;
    let total = 0;
    for (let j = 0; j < THOR_SEEN; j++)
    {
      prob[j] = Math.exp((THOR_SOFT_GAIN * (e[j] - e[tone])) / noise);
      total += prob[j];
    }
    for (let j = 0; j < THOR_SEEN; j++) prob[j] /= total;
    if (this.lastTone >= 0)
    {
      const step = (((tone - this.lastTone) % THOR_TONES) + THOR_TONES) % THOR_TONES;
      this.bad += THOR_BAD_SHARE * ((step < 2 ? 1 : 0) - this.bad);
      // Each nibble's chance: each pair of places (the last symbol's and this one's) a step of 2 plus the nibble apart, round the 18, their
      // chances multiplied (so one weak symbol doesn't spoil the next as a hard choice of the last tone would). DominoEX takes the likeliest
      const last = this.lastProb;
      const nib = this.nib;
      nib.fill(0);
      let forbidden = 0;
      for (let p = 0; p < THOR_SEEN; p++)
      {
        const lp = last[p];
        for (let q = 0; q < THOR_SEEN; q++)
        {
          const n = (((q - p - 2) % THOR_TONES) + THOR_TONES) % THOR_TONES;
          if (n < 16) nib[n] += lp * prob[q];
          else forbidden += lp * prob[q];
        }
      }
      let nibble = 0;
      let all = forbidden;
      for (let n = 0; n < 16; n++) all += nib[n];
      for (let n = 1; n < 16; n++) if (nib[n] > nib[nibble]) nibble = n;
      // How sure the nibble is (its chance among every step, the two IFK+ never sends too): near 1 for a signal's symbol, seldom over a
      // third for noise's or a tone held on
      this.sure[this.symbols % THOR_LEVELS] = all > 0 ? nib[nibble] / all : 0;
      this.dexNibble(nibble);
      this.thorSoft();
    }
    else this.sure[this.symbols % THOR_LEVELS] = 0;
    this.prob = this.lastProb;
    this.lastProb = prob;
    this.lastTone = tone;
    if (moved)
    {
      // The channel moved: this symbol's places numbered as the next one's will be (a place moved out of reach counts for nothing)
      const old = Float64Array.from(prob);
      for (let j = 0; j < THOR_SEEN; j++) prob[j] = j + moved >= 0 && j + moved < THOR_SEEN ? old[j + moved] : 0;
      this.lastTone = tone - moved >= 0 && tone - moved < THOR_SEEN ? tone - moved : -1;
    }
    this.symbols++;
    this.squelch();
  }

  // The AFC, a second order loop following the signal's place (pos: its lowest tone's bin, not a whole number) and its drift (bins a
  // symbol): on each clear symbol, where its strongest tone peaks (the best bin within half a tone of where it should be, then a parabola
  // through it and its neighbours) against where it should; then the place moved on by the drift for the next symbol
  afc(row, tone, share)
  {
    const lane = this.lane;
    const want = this.pos - lane.kLo + tone * lane.toneBins;
    const reach = Math.max(2, Math.floor(lane.toneBins / 2));
    const k = Math.round(want);
    if (share >= THOR_AFC_CLEAR && k - reach >= 1 && k + reach < lane.w - 1)
    {
      let peak = k;
      for (let j = k - reach; j <= k + reach; j++) if (row[j] > row[peak]) peak = j;
      const a = row[peak - 1];
      const b = row[peak];
      const c = row[peak + 1];
      const bend = a - 2 * b + c;
      const shift = bend < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / bend)) : 0;
      const err = peak + shift - want;
      this.pos += THOR_AFC_SHARE * err;
      this.drift += THOR_AFC_DRIFT * err;
    }
    this.place(this.pos + this.drift);
  }

  // The channel's place set (its lowest tone's bin, not a whole number), kept where its tones' bins are kept (it's dropped near the edges)
  place(pos)
  {
    const lane = this.lane;
    this.pos = Math.max(lane.k0Min - 2, Math.min(lane.k0Max + 2, pos));
    this.k0 = Math.round(this.pos);
    this.freq = lane.centre(this.pos);
  }

  // Where the signal's tones are: how often each place from THOR_WIDE tones below the lowest to THOR_WIDE above the highest holds the
  // strongest, counted since the channel last moved (a signal visits all 18 tones only over a few dozen symbols; a new channel can be
  // several tones off, as a place a few tones off scores nearly as well in the finder). The places hit at least THOR_HITS_OUT times are
  // the signal's: when they reach outside the 18, the channel moves by as many tones as it takes; when they're wider than a signal, to
  // the 18 holding the most. Returns the tones it moved (now; a channel that hasn't printed yet is read again instead, by its lane), or 0
  wholeTone(row, at)
  {
    const lane = this.lane;
    const hits = this.hits;
    const wide = lane.wide;
    const n = wide.length;
    // Only symbols whose strongest place holds a tone count (noise hits every place alike, and would move a channel whose signal has gone;
    // a tone further out leaves only its spill), and only while the signal's there
    if (this.qual < THOR_DEX_QUAL_CLOSE) return 0;
    let top = -1;
    let most = 0;
    for (let j = 0; j < n; j++)
    {
      const k = at + wide[j];
      if (k >= 0 && k < lane.w && row[k] > most)
      {
        most = row[k];
        top = j;
      }
    }
    if (top < 0 || most < THOR_HITS_TONE * this.slow) return 0;
    hits[top]++;
    this.counted++;
    if (this.counted >= 4 * THOR_TONES)
    {
      // The counts halved now and then, so a channel that drifts a tone over is still followed
      for (let j = 0; j < n; j++) hits[j] /= 2;
      this.counted /= 2;
    }
    if (this.counted < THOR_HITS_AFTER) return 0;
    let lo = -1;
    let hi = -1;
    for (let j = 0; j < n; j++)
    {
      if (hits[j] < THOR_HITS_OUT) continue;
      if (lo < 0) lo = j;
      hi = j;
    }
    let shift = 0;
    if (lo >= 0 && hi - lo < THOR_TONES)
    {
      if (lo < THOR_WIDE) shift = lo - THOR_WIDE;
      else if (hi >= THOR_WIDE + THOR_TONES) shift = hi - THOR_WIDE - THOR_TONES + 1;
    }
    else if (lo >= 0)
    {
      const sum = (m) =>
      {
        let s = 0;
        for (let j = m; j < m + THOR_TONES; j++) s += hits[j];
        return s;
      };
      let best = THOR_WIDE;
      for (let m = 0; m + THOR_TONES <= n; m++) if (sum(m) > sum(best) + THOR_HITS_OUT) best = m;
      shift = best - THOR_WIDE;
    }
    if (!shift)
    {
      // In place, as near as it can be told, once the places hit at least once span all but a tone or two of the 18 and sit in their
      // middle (a tone either way is then covered by reading a place either side): the squelch may open. Off the middle, moved there
      let first = -1;
      let last = -1;
      for (let j = THOR_WIDE - 1; j <= THOR_WIDE + THOR_TONES; j++)
      {
        if (hits[j] < 1) continue;
        if (first < 0) first = j;
        last = j;
      }
      if (first < 0 || last - first + 1 < THOR_PLACED_SPAN) return 0;
      shift = Math.round((first + last - (THOR_TONES - 1)) / 2) - THOR_WIDE;
      if (!shift)
      {
        this.placed = true;
        return 0;
      }
    }
    if (!this.everActive && this.respawns < THOR_RESPAWNS)
    {
      // Not yet decoding: read again from the spectra kept, moved (what was read so far may have been misread)
      this.respawn = shift;
      return 0;
    }
    this.place(this.pos + shift * lane.toneBins);
    hits.fill(0);
    this.counted = 0;
    return shift;
  }

  // ---- DominoEX: a nibble under 8 starts a character (ending the one before); 8 and over carries it on, to three at most. A character
  // is timed by its last nibble
  dexNibble(n)
  {
    if (n < 8)
    {
      if (this.nibbles && this.nibbles.length) this.dexChar(this.nibbles, this.nibbleAt);
      else if (!this.nibbles) this.dexValid(false);
      this.nibbles = [n];
      this.nibbleAt = this.symbols;
      return;
    }
    if (!this.nibbles) return;
    if (this.nibbles.length == 0 || this.nibbles.length == 3)
    {
      // A carrying-on nibble with no start, or a fourth: not a character
      this.nibbles = null;
      return;
    }
    this.nibbles.push(n);
    this.nibbleAt = this.symbols;
  }

  dexValid(ok)
  {
    this.valid += THOR_CHAR_SHARE * ((ok ? 1 : 0) - this.valid);
  }

  dexChar(nibbles, at)
  {
    const ascii = THOR_DEX.table.get(THOR_DEX.key(nibbles));
    this.dexValid(ascii !== undefined);
    if (ascii === undefined || ascii >= 256) return;
    // Its least sure nibble
    let sure = 1;
    for (let s = Math.max(0, at - nibbles.length + 1); s <= at; s++) sure = Math.min(sure, this.sure[s % THOR_LEVELS]);
    this.dexChars.push({ ascii, at, qual: this.qual, sure });
    if (this.dexChars.length > 200) this.dexChars.splice(0, 100);
  }

  // ---- THOR: the 16 nibble values' chances (nib) as each of the four bits' log likelihood, for both codings (the nibble as it is, or Gray
  // coded); into the deinterleavers, and each one's bits to its decoders
  thorSoft()
  {
    const slot = this.symbols % 32;
    const w = this.nib;
    for (let coding = 0; coding < 2; coding++)
    {
      const soft = this.soft[coding];
      for (let i = 0; i < 4; i++)
      {
        let zero = 1e-300;
        let one = 1e-300;
        for (let n = 0; n < 16; n++)
        {
          const bits = coding ? n ^ (n >> 1) : n;
          if ((bits >> (3 - i)) & 1) one += w[n];
          else zero += w[n];
        }
        soft[slot * 4 + i] = Math.max(-THOR_SOFT_CLIP, Math.min(THOR_SOFT_CLIP, Math.log(zero / one)));
      }
    }
    if (this.symbols < 3 * THOR_DEPTH + 1) return;
    // The nibble sent 30 symbols ago put back together: its bit i was sent 10 i symbols after its first (or, the other way, 10 (3 - i))
    for (const way of this.decoders)
    {
      const soft = this.soft[way.coding];
      for (let i = 0; i < 4; i++)
      {
        const back = way.dir ? THOR_DEPTH * i : 3 * THOR_DEPTH - THOR_DEPTH * i;
        way.d.feed(soft[((this.symbols - back) % 32) * 4 + i], this.symbols);
      }
    }
    // The way read: the best by its parity check, a clear margin needed to change; kept while THOR's being printed (a run of 0s, as idle
    // and at the end, keeps every way's parity check)
    if (this.active && this.mode == "thor") return;
    let best = this.best;
    for (let k = 0; k < this.decoders.length; k++) if (this.decoders[k].d.synd > this.decoders[best].d.synd + 0.05) best = k;
    this.best = best;
  }

  // ---- The squelch: opened as THOR or DominoEX, closed when the reading goes bad or the signal's gone; the characters held go out a
  // moment after they came
  squelch()
  {
    const synd = this.decoders[this.best].d.synd;
    // The parity check has its say once the signal's been read cleanly long enough to fill the deinterleaver and more
    this.clean = this.qual > THOR_DEX_QUAL_CLOSE ? this.clean + 1 : 0;
    const thorReady = this.clean >= THOR_VERDICT;
    // Gone: the strongest tone suddenly far under its average, or a few nibbles running read unsurely
    let weak = this.symbols > 10;
    for (let s = this.symbols - THOR_GONE_RUN; s < this.symbols && weak; s++) if (this.sure[s % THOR_LEVELS] >= THOR_SURE) weak = false;
    const gone = this.symbols > 10 && (this.quick < THOR_GONE * this.slow || weak);
    // The timing's contrast: the strongest tone read at the best point against half a symbol from it (averaged slowly: another mode's can
    // reach a signal's now and then)
    const points = this.slowPoints;
    let peak = 0;
    for (let p = 1; p < THOR_POINTS; p++) if (points[p] > points[peak]) peak = p;
    const contrast = points[peak] / Math.max(1e-20, points[(peak + THOR_POINTS / 2) % THOR_POINTS]);
    this.contrast = contrast;
    // DominoEX, with no code to check, is taken only when it's read like one for a while running
    const dex = this.qual > THOR_DEX_QUAL_OPEN && this.bad < THOR_DEX_BAD_OPEN && this.valid > THOR_DEX_VALID_OPEN && contrast > THOR_CONTRAST_OPEN;
    this.steady = dex ? this.steady + 1 : 0;
    if (this.active)
    {
      if (this.ending >= 0)
      {
        // THOR after its signal went: the decoder still holds what was sent before it went, read on until that's out
        if (this.symbols >= this.ending + THOR_LAG)
        {
          this.release(this.ending + THOR_LAG, -1);
          this.shut(true);
        }
      }
      else if (gone)
      {
        // The signal gone: what came up to its last sure symbols goes out (DominoEX's last character too, which no next one has ended),
        // what came after is dropped
        const end = this.lastLoud();
        if (this.mode == "thor" && end >= 0) this.ending = end;
        else
        {
          if (this.mode == "dominoex" && this.nibbles && this.nibbles.length && this.nibbleAt <= end) this.dexChar(this.nibbles, this.nibbleAt);
          this.nibbles = null;
          this.release(end, -1);
          this.shut(true);
        }
      }
      else
      {
        let close = contrast < THOR_CONTRAST_CLOSE || this.bad > THOR_DEX_BAD_CLOSE;
        if (this.mode == "thor") close = close || synd < THOR_SYND_CLOSE;
        else close = close || this.qual < THOR_DEX_QUAL_CLOSE || this.valid < THOR_DEX_VALID_CLOSE || (thorReady && synd > THOR_SYND_OPEN);
        if (close)
        {
          // What's still held was most likely read after the reading went bad
          this.shut(false);
        }
      }
    }
    else if (!gone && this.placed && contrast > THOR_CONTRAST_OPEN && this.bad < THOR_DEX_BAD_CLOSE)
    {
      let open = null;
      if (thorReady && synd > THOR_SYND_OPEN && this.qual > THOR_DEX_QUAL_CLOSE) open = "thor";
      else if (thorReady && synd < THOR_NOT && this.steady >= THOR_STEADY) open = "dominoex";
      // A channel keeps the mode it first opened in (one that reads poorly as one can look like the other a moment)
      if (open && this.mode && open != this.mode) open = null;
      if (open)
      {
        this.mode = open;
        this.active = true;
        this.everActive = true;
        // What came just before it opened goes out too (read while it was reading cleanly)
        this.release(this.symbols - THOR_HOLD, open == "thor" ? THOR_SYND_CLOSE : THOR_DEX_QUAL_CLOSE);
      }
    }
    if (this.active)
    {
      // (DominoEX: no further than its last sure symbols, so nothing read after a signal stops goes out)
      this.lastGood = thorNow;
      if (this.ending < 0) this.release(this.mode == "thor" ? this.symbols - THOR_HOLD : Math.min(this.symbols - THOR_HOLD, this.lastLoud()), -1);
    }
  }

  // The squelch shut; after a signal's gone, opening again takes a while of clean reading
  shut(gone)
  {
    this.active = false;
    this.ending = -1;
    this.printed = this.symbols;
    if (gone)
    {
      this.qual = Math.min(this.qual, 0.2);
      this.valid = Math.min(this.valid, 0.5);
      this.clean = 0;
    }
  }

  // The last symbol (of the last 64) whose nibble was read very surely, and the one before's surely: where the signal ended (noise's
  // first symbol after it, read against the signal's last, is sure now and then, seldom very sure)
  lastLoud()
  {
    const sure = (s, least) => this.sure[s % THOR_LEVELS] >= least;
    for (let s = this.symbols - 1; s > this.symbols - THOR_LEVELS && s >= 1; s--) if (sure(s, THOR_SURE_END) && sure(s - 1, THOR_SURE)) return s;
    return -1;
  }

  // The characters read up to symbol upTo not yet printed, those read while the reading was at least least's (-1: all) into the text;
  // (DominoEX) and then only those whose nibbles were all read surely (not one read against the noise before a signal starts)
  release(upTo, least)
  {
    const thor = this.mode == "thor";
    const list = thor ? this.decoders[this.best].d.chars : this.dexChars;
    for (const c of list)
    {
      if (c.at <= this.printed) continue;
      if (c.at > upTo) break;
      this.printed = c.at;
      if (least >= 0 && (thor ? c.synd : c.qual) < least) continue;
      if (least >= 0 && !thor && c.sure < THOR_SURE) continue;
      let ch = "";
      if (c.ascii == 13 || (c.ascii == 10 && !this.afterCr)) ch = "\n";
      else if (c.ascii >= 32 && c.ascii < 127) ch = String.fromCharCode(c.ascii);
      this.afterCr = c.ascii == 13;
      this.text += ch;
    }
  }
}
