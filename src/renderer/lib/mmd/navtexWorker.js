// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Multi-Mode Decoder's NAVTEX mode: maritime safety broadcasts (518 and 490 kHz, 4209.5 kHz HF NAVTEX) in SITOR collective B-mode,
// as the published recommendations lay it out:
//   ITU-R M.476-5 (direct-printing telegraph equipment in the maritime mobile service): 100 baud FSK, 170 Hz shift; the 7-unit code
//   (its Table 1, Table 2), every signal 4 B (the higher frequency) and 3 Y (the lower), so one with a bit wrong is seen; mode B (FEC):
//   each character sent twice, the first (DX) followed by four others and then the repeat (RX), so 5 character positions (350 ms)
//   apart; the receiver prints whichever copy is a good signal, or an error symbol if neither is; phasing signal 1 (β) in the RX
//   positions and phasing signal 2 (α) in the DX positions before a message; the end of emission three α in the DX positions.
//   ITU-R M.625-3: the same tables and mode B. ITU-R M.540-2 Annex II: the message format, "ZCZC B1B2B3B4" (B1 the transmitter's
//   coverage area, B2 the subject, B3B4 a serial number, 00 always printed), the text, "NNNN". IMO NAVTEX Manual (MSC.1/Circ.1403):
//   the subject indicators, and a message satisfactorily received when its character error rate is under 4%.
// How it runs:
//   The audio is first brought down to about 9.6 kHz (a low-pass filter, then every Nth sample kept), which keeps up to 4 kHz.
//   Four times a second a spectrum (an FFT, averaged over a second or two) finds signals: two tones 170 Hz apart, both 3 dB over the
//   noise; one seen for 0.75 s gets its own demodulator, which first runs over the last 2.5 s of audio (kept for this).
//   A channel: mixed down, filtered to 2 kHz, each tone (85 Hz either side) filtered over about a bit (a Hann shape whose first null
//   falls near the other tone), their sizes weighed against each other (an ATC, as RTTY's), a bit clock locked to the level's
//   crossings (running on by itself through fades and crashes), and every bit read at its middle. The 7 bits ending at each bit are a
//   signal at one of 7 places in the character; each place and DX or RX position (14 in all), both ways round (a reversed signal is
//   one heard on the other sideband), is scored by how often its signal matches the one 35 bits before (an RX repeating its DX, both
//   4B/3Y), or is β after α (phasing). Noise and other modes (RTTY's 170 Hz FSK too) almost never do that three times running, so a
//   channel locks only on SITOR B, and prints only while locked. Each character is then its DX if that's a good signal, else its RX
//   (both good but not the same: the one whose bits were clearer), else an error ("_", shown only inside a message). An AFC follows
//   the signal's drift while locked. The bit order (M.476's first unit sent first) is checked against the phasing, and read the other
//   way round if that's how phasing reads.
// Characters are held a moment (8 characters, 1.1 s) before they go out, so the errors decoded after a signal stops, before the lock
// drops, can be taken back. A channel nothing comes from for 15 s is dropped. A channel's id stays the same while it's tracked.
// In:  { type: "init", rate }, { type: "audio", samples }, { type: "reset" }, { type: "config", minHz, maxHz }
// Out: { type: "channels", list: [{ id, freq (Hz, midway between the tones), snr (dB in 100 Hz), active, receiving (a message open) }] },
//      four times a second;
//      { type: "text", id, text }: what a channel decoded since its last one, every 100 ms or so;
//      { type: "message", id, station, subject, number, subjectName, text, complete, errors, chars }: once a ZCZC ... NNNN message
//      ends (complete), or is cut short (another ZCZC, the end of emission, the lock lost for NAVTEX_MESSAGE_TIMEOUT, the channel
//      dropped: not complete). errors: the error symbols in it, of chars characters (under 4% of them: satisfactorily received)

const NAVTEX_BAUD = 100;
const NAVTEX_SHIFT = 170;
// The highest audio frequency kept (Hz), and the rate it's brought down to (about)
const NAVTEX_TOP_HZ = 4000;
const NAVTEX_WORK_RATE = 9000;
// A channel's rate after its first filter (about)
const NAVTEX_CHANNEL_RATE = 2000;
// At most this many channels at once (stations share a frequency by time slots, so mostly one)
const NAVTEX_MAX = 4;
// Two channels closer than this (Hz) are one signal read twice: a 100 baud signal's spectrum is wide enough that pairs of humps off its
// own tones look like signals too, and a strong one read 300 Hz off its centre still decodes (a DX and its RX still match). Stations
// share NAVTEX's frequencies by time slots, so two this close are rare. A channel is moved onto the strongest pair within this when
// that pair is this many times its own (navtexFind)
const NAVTEX_NEAR_HZ = 350;
const NAVTEX_RECENTRE = 1.3;
// Seconds: a channel with nothing for this long is dropped; one that never locked is given this long; the place it was then isn't
// tried again for this long
const NAVTEX_DROP_SECONDS = 15;
const NAVTEX_TRIAL_SECONDS = 8;
const NAVTEX_BLOCK_SECONDS = 15;
// Seconds of audio kept, and run through a new channel's demodulator before it goes on live
const NAVTEX_HISTORY_SECONDS = 4;
const NAVTEX_CATCHUP_SECONDS = 2.5;
// The spectrum: its averaging (each new one's share), and frames needed before signals are looked for
const NAVTEX_SPECTRUM_SHARE = 0.15;
const NAVTEX_SPECTRUM_FRAMES = 6;
// A spectrum's lower quarter, taken as its noise, is below the noise's average: brought up by this
const NAVTEX_FLOOR_BIAS = 1.2;
// A signal is looked at when both its tones hold this much over the noise there (2: 3 dB) ...
const NAVTEX_FIND_RATIO = 2;
// ... in this many spectrum frames running (0.75 s)
const NAVTEX_FIND_FRAMES = 3;
// The tone filters' length, in bits: a Hann shape's first null is at 2 / its length (154 Hz here), so each tone's filter passes
// little of the other, 170 Hz off (tried: 1.0 to 1.3, 1.3 the fewest bad characters in noise)
const NAVTEX_FILTER = 1.3;
// The lock: each place's score (its share of characters that repeat or phase, averaged over 8) opens it over the first, with
// NAVTEX_LOCK_RUN running (noise matches by chance about once in 470 characters at a place, so three running about once in 100
// million); once locked, the share of characters with at least one good copy (averaged over 8) under the second closes it; another
// place scoring this much more than the locked one takes over (the bit clock slipped)
const NAVTEX_LOCK = 0.33;
const NAVTEX_LOCK_RUN = 3;
const NAVTEX_UNLOCK = 0.35;
const NAVTEX_RELOCK_EDGE = 0.3;
// The bit clock follows a crossing only after a clear bit: its tones' sizes this far apart (of their sum), and the stronger this share
// of its peak (clock)
const NAVTEX_CLOCK_CONTRAST = 0.5;
const NAVTEX_CLOCK_LEVEL = 0.25;
// Characters held before they go out (8: 1.1 s)
const NAVTEX_HOLD = 8;
// Characters looked back over when the lock opens (those before it whose copies were good are printed too), and the bits kept for it
// (a power of 2, over the look back's 14 bits a character and the 35 between a DX and its RX)
const NAVTEX_BACKFILL = 24;
const NAVTEX_WORDS = 512;
// Seconds a message is kept open with the lock lost (a fade), before it goes out as not complete; and its most characters
const NAVTEX_MESSAGE_TIMEOUT = 30;
const NAVTEX_MESSAGE_MAX = 10000;
// A ZCZC is due within this many characters after phasing (parse)
const NAVTEX_ZCZC_DUE = 6;

// The 7-unit signals (M.476-5 Table 1, combination numbers 1 to 32: A to Z, carriage return, line feed, letters, figures, space,
// unperforated tape; then Table 2's α and β (phasing signals 2 and 1, idle signals a and b) and the signal repetition), each read
// with its first unit (sent first) the highest bit, B a 1
const NAVTEX_SIGNALS = [
  "BBBYYYB", "YBYYBBB", "BYBBBYY", "BBYYBYB", "YBBYBYB", "BBYBBYY", "BYBYBBY", "BYYBYBB", "BYBBYYB", "BBBYBYY", "YBBBBYY", "BYBYYBB",
  "BYYBBBY", "BYYBBYB", "BYYYBBB", "BYBBYBY", "YBBBYBY", "BYBYBYB", "BBYBYYB", "YYBYBBB", "YBBBYYB", "YYBBBBY", "BBBYYBY", "YBYBBBY",
  "BBYBYBY", "BBYYYBB", "YYYBBBB", "YYBBYBB", "YBYBBYB", "YBBYBBY", "YYBBBYB", "YBYBYBB"
].map((s) => parseInt(s.replace(/B/g, "1").replace(/Y/g, "0"), 2));
const NAVTEX_ALPHA = 0x78;
const NAVTEX_BETA = 0x66;
const NAVTEX_REP = 0x33;
// What each of the 128 7-bit words is, read first unit first and the other way round (a receiver wired backward): 0 to 31 a
// traffic signal (combination number less 1), 32 α, 33 β, 34 the repetition, -1 not 4B/3Y
const NAVTEX_CR = 26;
const NAVTEX_LF = 27;
const NAVTEX_LTRS = 28;
const NAVTEX_FIGS = 29;
const NAVTEX_SPACE = 30;
const NAVTEX_SYMBOL_ALPHA = 32;
const NAVTEX_SYMBOL_BETA = 33;
const NAVTEX_VALID = new Uint8Array(128);
const NAVTEX_DECODE = [new Int8Array(128).fill(-1), new Int8Array(128).fill(-1)];
for (let w = 0; w < 128; w++)
{
  let ones = 0;
  for (let b = 0; b < 7; b++) ones += (w >> b) & 1;
  NAVTEX_VALID[w] = ones == 4 ? 1 : 0;
}
[...NAVTEX_SIGNALS, NAVTEX_ALPHA, NAVTEX_BETA, NAVTEX_REP].forEach((w, i) =>
{
  NAVTEX_DECODE[0][w] = i;
  NAVTEX_DECODE[1][navtexReverse(w)] = i;
});

// ITA2 (ITU-T F.1), letters and figures, for combination numbers 1 to 26; figures' D (who are you), F, G, H (national) and J (bell)
// print nothing
const NAVTEX_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const NAVTEX_FIGURES = ["-", "?", ":", "", "3", "", "", "", "8", "", "(", ")", ".", ",", "9", "0", "1", "4", "'", "5", "7", "=", "2", "/", "6", "+"];

// The subject indicators (B2), from the IMO NAVTEX Manual; the others are unassigned
const NAVTEX_SUBJECTS = {
  A: "Navigational warning",
  B: "Meteorological warning",
  C: "Ice report",
  D: "Search and rescue",
  E: "Weather forecast",
  F: "Pilot and VTS service",
  G: "AIS service",
  H: "LORAN",
  J: "GNSS",
  K: "Other electronic navaid",
  L: "Navigational warning (additional)",
  Z: "No messages on hand"
};

let navtexRate = 48000;
let navtexMinHz = 200;
let navtexMaxHz = 3000;
// The rate the work's done at, the highest frequency kept, and the stage bringing the audio down to it
let navtexFd = 9600;
let navtexTop = NAVTEX_TOP_HZ;
let navtexFront = null;
// Samples (at navtexFd) so far: the clock everything's timed by
let navtexNow = 0;
let navtexHistory = new Float32Array(1);
let navtexHistoryMask = 0;
let navtexSpec = null;
let navtexChannels = [];
let navtexNextId = 1;
let navtexBlocked = [];
// Signals the spectrum has shown, and in how many frames running ({ freq, frames, seen })
let navtexCandidates = [];
let navtexLastFlush = 0;

self.onmessage = (event) =>
{
  const m = event.data;
  if (m.type == "init") navtexInit(m.rate);
  else if (m.type == "reset")
  {
    for (const c of navtexChannels) c.close();
    navtexInit(navtexRate);
    navtexPostChannels();
  }
  else if (m.type == "config") navtexConfig(m);
  else if (m.type == "audio")
  {
    if (!navtexFront) navtexInit(navtexRate);
    navtexAudio(m.samples);
  }
};

function navtexInit(rate)
{
  navtexRate = rate > 0 ? rate : 48000;
  const d = Math.max(1, Math.floor(navtexRate / NAVTEX_WORK_RATE));
  navtexFd = navtexRate / d;
  navtexTop = Math.min(NAVTEX_TOP_HZ, navtexFd * 0.42);
  navtexFront = navtexDecimator(navtexRate, d, navtexTop);
  let size = 1;
  while (size < navtexFd * NAVTEX_HISTORY_SECONDS) size *= 2;
  navtexHistory = new Float32Array(size);
  navtexHistoryMask = size - 1;
  navtexSpec = navtexSpectrum();
  navtexNow = 0;
  navtexLastFlush = 0;
  navtexChannels = [];
  navtexBlocked = [];
  navtexCandidates = [];
}

// The range: a narrower one drops the channels outside it
function navtexConfig(m)
{
  const min = Number(m.minHz);
  const max = Number(m.maxHz);
  navtexMinHz = Number.isFinite(min) ? Math.max(50, Math.min(min, NAVTEX_TOP_HZ - 200)) : 200;
  navtexMaxHz = Number.isFinite(max) && max >= navtexMinHz + 200 ? Math.min(max, NAVTEX_TOP_HZ) : Math.max(navtexMinHz + 200, 3000);
  navtexFlush();
  const before = navtexChannels.length;
  const keep = navtexChannels.filter((c) => c.freq >= navtexMinHz - 20 && c.freq <= navtexMaxHz + 20);
  for (const c of navtexChannels) if (!keep.includes(c)) c.close();
  navtexChannels = keep;
  if (navtexChannels.length != before) navtexPostChannels();
}

// The bit read the other way round (7 bits)
function navtexReverse(w)
{
  let r = 0;
  for (let b = 0; b < 7; b++) r |= ((w >> b) & 1) << (6 - b);
  return r;
}

// Whether s (4 characters) is word (4 letters) with at most one of them wrong
function navtexNear(s, word)
{
  if (s.length != 4) return false;
  let same = 0;
  for (let i = 0; i < 4; i++) if (s[i] == word[i]) same++;
  return same >= 3;
}

// Whether s (3 characters) is word with one of its letters lost
function navtexDropped(s, word)
{
  if (s.length != word.length - 1) return false;
  for (let i = 0; i < word.length; i++) if (word.slice(0, i) + word.slice(i + 1) == s) return true;
  return false;
}

// ---- The audio brought down to navtexFd: a low-pass filter (a windowed sinc, Blackman) keeping up to top, worked out only for the
// samples kept (every dth)
function navtexDecimator(rate, d, top)
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

// Three running sums of m samples one after another (a CIC filter's shape), as one filter: a channel's first step down, from
// navtexFd to navtexFd / m. Its nulls fall on everything that would fold back onto the channel
function navtexBoxcar3(m)
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

// A Hann window's shape over n taps, summing to 1: the tone filters
function navtexHann(n)
{
  const t = new Float64Array(n);
  for (let i = 0; i < n; i++) t[i] = Math.pow(Math.sin((Math.PI * (i + 0.5)) / n), 2);
  const sum = t.reduce((s, v) => s + v, 0);
  return t.map((v) => v / sum);
}

// ---- Each block of audio: brought down, kept, run through every channel; the spectrum four times a second, the text ten
function navtexAudio(samples)
{
  const x = navtexFront(samples);
  if (x.length == 0) return;
  for (let i = 0; i < x.length; i++) navtexHistory[(navtexNow + i) & navtexHistoryMask] = x[i];
  for (const c of navtexChannels) c.run(x);
  navtexNow += x.length;
  if (navtexNow - navtexSpec.last >= navtexSpec.hop)
  {
    navtexSpec.last = navtexNow;
    navtexFrame();
  }
  if (navtexNow - navtexLastFlush >= navtexFd / 10)
  {
    navtexLastFlush = navtexNow;
    navtexFlush();
  }
}

function navtexFlush()
{
  for (const c of navtexChannels)
  {
    // A new channel's text waits its first second (it may yet lose to another, navtexTidy)
    if (c.text.length == 0 || navtexNow - c.born < navtexFd) continue;
    self.postMessage({ type: "text", id: c.id, text: c.text });
    c.text = "";
  }
}

function navtexPostChannels()
{
  const list = navtexChannels.filter((c) => c.everActive).sort((a, b) => a.freq - b.freq);
  self.postMessage({ type: "channels", list: list.map((c) => ({ id: c.id, freq: Math.round(c.freq * 10) / 10, snr: Math.round(c.snr), active: c.active, receiving: !!c.msg })) });
}

// ---- The spectrum: an FFT of the last n samples (a Hann window), its power averaged frame to frame, and the noise under it
function navtexSpectrum()
{
  let n = 1;
  while (n < navtexFd / 2.5) n *= 2;
  const win = new Float64Array(n);
  for (let i = 0; i < n; i++) win[i] = Math.pow(Math.sin((Math.PI * i) / n), 2);
  return { n, win, fft: navtexFft(n), re: new Float64Array(n), im: new Float64Array(n), avg: new Float64Array(n / 2), floor: new Float64Array(n / 2),
    binHz: navtexFd / n, hop: Math.round(navtexFd / 4), last: 0, frames: 0 };
}

// A complex FFT in place (radix 2), n a power of 2
function navtexFft(n)
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

// The noise under the spectrum, bin by bin: the lower quarter of the bins around it (about 450 Hz), so signals don't count
function navtexFloor(sp, k0, k1)
{
  const block = 16;
  const reach = Math.round(225 / sp.binHz);
  const lo = Math.max(1, k0 - reach);
  const hi = Math.min(sp.n / 2 - 1, k1 + reach);
  // (a typed array's own sort: numbers, and much quicker than an array's with a compare)
  if (!sp.values || sp.values.length < 2 * reach + 1) sp.values = new Float64Array(2 * reach + 1);
  for (let start = lo; start <= hi; start += block)
  {
    const centre = start + block / 2;
    const from = Math.max(lo, centre - reach);
    const count = Math.min(hi, centre + reach) - from + 1;
    const values = sp.values.subarray(0, count);
    values.set(sp.avg.subarray(from, from + count));
    values.sort();
    const noise = values[Math.floor(count / 4)] * NAVTEX_FLOOR_BIAS;
    for (let j = start; j < Math.min(start + block, hi + 1); j++) sp.floor[j] = noise;
  }
  for (let j = 1; j < lo; j++) sp.floor[j] = sp.floor[lo];
  for (let j = hi + 1; j < sp.n / 2; j++) sp.floor[j] = sp.floor[hi];
}

// A band's power over the noise there (bins lo to hi), and the noise's power in one bin
function navtexBand(sp, fromHz, toHz)
{
  const lo = Math.max(1, Math.round(fromHz / sp.binHz));
  const hi = Math.min(sp.n / 2 - 1, Math.round(toHz / sp.binHz));
  let s = 0;
  let noise = 0;
  for (let j = lo; j <= hi; j++)
  {
    s += sp.avg[j] - sp.floor[j];
    noise += sp.floor[j];
  }
  return { signal: s, noise: noise / Math.max(1, hi - lo + 1) };
}

// Where a band's power above the noise is centred (Hz), or -1
function navtexCentroid(sp, fromHz, toHz)
{
  const lo = Math.max(1, Math.round(fromHz / sp.binHz));
  const hi = Math.min(sp.n / 2 - 1, Math.round(toHz / sp.binHz));
  let s = 0;
  let sf = 0;
  for (let j = lo; j <= hi; j++)
  {
    const p = Math.max(0, sp.avg[j] - sp.floor[j]);
    s += p;
    sf += p * j;
  }
  return s > 0 ? (sf / s) * sp.binHz : -1;
}

// ---- Four times a second: the spectrum taken, the channels' SNR measured, dead channels dropped, new signals looked for, the list
// sent
function navtexFrame()
{
  const sp = navtexSpec;
  if (navtexNow < sp.n) return;
  for (let i = 0; i < sp.n; i++)
  {
    sp.re[i] = navtexHistory[(navtexNow - sp.n + i) & navtexHistoryMask] * sp.win[i];
    sp.im[i] = 0;
  }
  sp.fft(sp.re, sp.im);
  const share = sp.frames == 0 ? 1 : NAVTEX_SPECTRUM_SHARE;
  for (let k = 0; k < sp.n / 2; k++) sp.avg[k] += (sp.re[k] * sp.re[k] + sp.im[k] * sp.im[k] - sp.avg[k]) * share;
  sp.frames++;
  const k0 = Math.max(2, Math.floor(navtexMinHz / sp.binHz));
  const k1 = Math.min(sp.n / 2 - 2, Math.ceil(Math.min(navtexMaxHz, navtexTop) / sp.binHz));
  navtexFloor(sp, k0, k1);
  for (const c of navtexChannels)
  {
    c.measure(sp);
    if (c.active) c.lastGood = navtexNow;
    c.timeout();
  }
  navtexTidy();
  if (sp.frames >= NAVTEX_SPECTRUM_FRAMES) navtexFind(sp, k0, k1);
  navtexPostChannels();
}

// Channels dropped: silent too long, never locked in their trial, wandered out of range, or on top of another (the newer one goes,
// unless only it has locked)
function navtexTidy()
{
  const drop = new Set();
  for (const c of navtexChannels)
  {
    if (c.active) continue;
    if (c.everActive && navtexNow - c.lastGood > NAVTEX_DROP_SECONDS * navtexFd) drop.add(c);
    else if (!c.everActive && navtexNow - c.born > NAVTEX_TRIAL_SECONDS * navtexFd)
    {
      drop.add(c);
      navtexBlocked.push({ freq: c.freq, until: navtexNow + NAVTEX_BLOCK_SECONDS * navtexFd });
    }
    else if (c.freq < navtexMinHz - 30 || c.freq > Math.min(navtexMaxHz, navtexTop) + 30) drop.add(c);
  }
  // Two within NAVTEX_NEAR_HZ are one signal read twice: the one that has locked stays, or if both have, the stronger (the one on the
  // signal's centre has both tones in its bands), or the older. The loser's text was most likely the signal read off its centre, so it
  // goes unsent
  const lost = new Set();
  for (let i = 0; i < navtexChannels.length; i++)
  {
    for (let j = i + 1; j < navtexChannels.length; j++)
    {
      const a = navtexChannels[i];
      const b = navtexChannels[j];
      if (drop.has(a) || drop.has(b) || Math.abs(a.freq - b.freq) >= NAVTEX_NEAR_HZ) continue;
      const loser = a.everActive != b.everActive ? (a.everActive ? b : a) : Math.abs(a.snr - b.snr) > 2 ? (a.snr < b.snr ? a : b) : a.id > b.id ? a : b;
      drop.add(loser);
      lost.add(loser);
    }
  }
  if (drop.size)
  {
    for (const c of drop) c.close(lost.has(c));
    navtexChannels = navtexChannels.filter((c) => !drop.has(c));
  }
  navtexBlocked = navtexBlocked.filter((b) => b.until > navtexNow);
}

// Room for one more channel: under the limit, or one still on trial (the oldest) made way for
function navtexRoom()
{
  if (navtexChannels.length < NAVTEX_MAX) return true;
  let oldest = null;
  for (const c of navtexChannels) if (!c.everActive && (!oldest || c.born < oldest.born)) oldest = c;
  if (!oldest) return false;
  navtexChannels = navtexChannels.filter((c) => c != oldest);
  return true;
}

// The signals found this frame matched to those found before (within 10 Hz); those seen in NAVTEX_FIND_FRAMES frames running come
// back, the strongest first
function navtexSteadyCandidates(found)
{
  const frame = navtexSpec.frames;
  for (const f of found)
  {
    let c = navtexCandidates.find((k) => Math.abs(k.freq - f.freq) < 10);
    if (!c)
    {
      c = { freq: f.freq, frames: 0, seen: 0 };
      navtexCandidates.push(c);
    }
    c.frames = c.seen == frame - 1 ? c.frames + 1 : 1;
    c.seen = frame;
    c.freq = f.freq;
    c.ratio = f.ratio;
  }
  navtexCandidates = navtexCandidates.filter((c) => c.seen == frame);
  return navtexCandidates.filter((c) => c.frames >= NAVTEX_FIND_FRAMES).sort((a, b) => b.ratio - a.ratio);
}

// Two tones 170 Hz apart, each 3 dB over the noise in 24 Hz, the pair's weaker the strongest for 40 Hz each way, and the two near
// the same strength (within 13 dB: not one tone and another's edge); placed midway between the tones' centres
function navtexFind(sp, k0, k1)
{
  const w = Math.max(2, Math.round(12 / sp.binHz));
  const top = sp.n / 2 - 1;
  const sumS = new Float64Array(top + 2);
  const sumN = new Float64Array(top + 2);
  for (let j = 1; j <= top; j++)
  {
    sumS[j + 1] = sumS[j] + sp.avg[j];
    sumN[j + 1] = sumN[j] + sp.floor[j];
  }
  const tone = (k) =>
  {
    const lo = Math.max(1, k - w), hi = Math.min(top, k + w);
    if (hi < lo) return 0;
    const noise = sumN[hi + 1] - sumN[lo];
    return noise > 0 ? (sumS[hi + 1] - sumS[lo]) / noise : 0;
  };
  const near = Math.round(40 / sp.binHz);
  const half = NAVTEX_SHIFT / 2 / sp.binHz;
  const ratio = new Float64Array(k1 + 1);
  for (let k = k0; k <= k1; k++) ratio[k] = Math.min(tone(Math.round(k + half)), tone(Math.round(k - half)));
  const found = [];
  for (let k = k0; k <= k1; k++)
  {
    if (ratio[k] < NAVTEX_FIND_RATIO) continue;
    let best = true;
    for (let j = Math.max(k0, k - near); j <= Math.min(k1, k + near) && best; j++) if (ratio[j] > ratio[k]) best = false;
    if (!best) continue;
    const a = tone(Math.round(k + half)) - 1;
    const b = tone(Math.round(k - half)) - 1;
    if (Math.max(a, b) > 20 * Math.min(a, b)) continue;
    const f = k * sp.binHz;
    const up = navtexCentroid(sp, f + NAVTEX_SHIFT / 2 - 20, f + NAVTEX_SHIFT / 2 + 20);
    const down = navtexCentroid(sp, f - NAVTEX_SHIFT / 2 - 20, f - NAVTEX_SHIFT / 2 + 20);
    const freq = up > 0 && down > 0 ? (up + down) / 2 : f;
    if (freq >= navtexMinHz && freq <= navtexMaxHz) found.push({ freq, ratio: ratio[k] });
  }
  // Each channel moved onto the strongest pair near it, if that's clearly stronger than where it is (it was found on one of the
  // signal's side humps)
  for (const c of navtexChannels)
  {
    let best = null;
    for (const f of found) if (Math.abs(f.freq - c.freq) < NAVTEX_NEAR_HZ && (!best || f.ratio > best.ratio)) best = f;
    const k = Math.round(c.freq / sp.binHz);
    const here = k >= k0 && k <= k1 ? ratio[k] : 0;
    if (best && Math.abs(best.freq - c.freq) > 20 && best.ratio > NAVTEX_RECENTRE * here) c.setFreq(best.freq);
  }
  // A pair is one signal's own unless it's the strongest within NAVTEX_NEAR_HZ, and not a strong signal's far side humps (under a
  // tenth of a pair's within twice that)
  const real = found.filter((f) => !found.some((g) => g != f && ((Math.abs(g.freq - f.freq) < NAVTEX_NEAR_HZ && g.ratio > f.ratio) ||
    (Math.abs(g.freq - f.freq) < 2 * NAVTEX_NEAR_HZ && g.ratio > 10 * f.ratio))));
  for (const f of navtexSteadyCandidates(real)) navtexSpawn(f.freq);
}

// A new channel at freq, unless one's near it or the place is blocked; it runs over the audio kept before going on live
function navtexSpawn(freq)
{
  for (const c of navtexChannels) if (Math.abs(c.freq - freq) < NAVTEX_NEAR_HZ) return;
  for (const b of navtexBlocked) if (Math.abs(b.freq - freq) < 25) return;
  if (!navtexRoom()) return;
  const n = Math.min(navtexNow, Math.round(NAVTEX_CATCHUP_SECONDS * navtexFd));
  const back = new Float32Array(n);
  for (let i = 0; i < n; i++) back[i] = navtexHistory[(navtexNow - n + i) & navtexHistoryMask];
  const c = new NavtexChannel(navtexNextId++, freq);
  c.run(back);
  navtexChannels.push(c);
}

// ---- A NAVTEX channel. Its frequency mixed down to 0 and the first filter (navtexBoxcar3) bringing it to about 2 kHz; each tone
// (85 Hz either side) mixed to 0 and filtered over about a bit, their sizes weighed against each other (atc), the bit clock (clock),
// each bit read at its middle (bit), the 7-bit words scored for the lock (score), and once locked each character chosen from its two
// copies (character) and printed
class NavtexChannel
{
  constructor(id, freq)
  {
    this.id = id;
    this.m = Math.max(1, Math.round(navtexFd / NAVTEX_CHANNEL_RATE));
    this.rate2 = navtexFd / this.m;
    this.oRe = 1;
    this.oIm = 0;
    this.setFreq(freq);
    this.dTaps = navtexBoxcar3(this.m);
    this.dLen = this.dTaps.length;
    this.dRe = new Float64Array(2 * this.dLen);
    this.dIm = new Float64Array(2 * this.dLen);
    this.dPos = 0;
    this.dCount = 0;
    this.active = false;
    this.everActive = false;
    this.text = "";
    this.snr = 0;
    this.born = navtexNow;
    this.lastGood = navtexNow;
    // The tones' oscillator (at half the shift), and their filters
    this.tRe = 1;
    this.tIm = 0;
    const w = (2 * Math.PI * (NAVTEX_SHIFT / 2)) / this.rate2;
    this.tsRe = Math.cos(w);
    this.tsIm = Math.sin(w);
    this.spb = this.rate2 / NAVTEX_BAUD;
    this.h = navtexHann(Math.round(NAVTEX_FILTER * this.spb));
    this.hLen = this.h.length;
    this.buf = [0, 1, 2, 3].map(() => new Float64Array(2 * this.hLen));
    this.hPos = 0;
    this.n = 0;
    this.markPeak = 0;
    this.spacePeak = 0;
    this.markFloor = 0;
    this.spaceFloor = 0;
    this.lastV = 0;
    // The bit clock: where in a bit it is (0 its edge, 0.5 its middle), and its rate's trim
    this.phase = 0;
    this.rateAdjust = 0;
    this.clear = false;
    // The bits so far, the 7-bit word ending at each (its first bit highest), kept for NAVTEX_WORDS bits
    this.bits = 0;
    this.word = 0;
    this.words = new Uint8Array(NAVTEX_WORDS);
    // ... and each bit's clearness, signed as the bit (bit())
    this.soft = new Float32Array(NAVTEX_WORDS);
    // Each place's score (both ways round: [0] B the upper tone, [1] reversed; 14 places, a bit's count mod 14 at an RX's last bit),
    // the RX matches running there, and which bit order the phasing reads as
    this.scores = [new Float64Array(14), new Float64Array(14)];
    this.runs = [new Uint8Array(14), new Uint8Array(14)];
    this.orders = [0, 0];
    // Locked: the way round, the place, the order; the share of characters with a good copy; α running in the DX position
    this.sign = 0;
    this.place = 0;
    this.order = 0;
    this.quality = 0;
    this.alphas = 0;
    // The characters decided, held a moment ({ ch, ok }); the shift; the message being read
    this.held = [];
    this.figures = false;
    this.recent = "";
    this.sincePhasing = NAVTEX_ZCZC_DUE + 1;
    this.msg = null;
    this.lostAt = 0;
    // Copies seen bad, for the diversity's working (pairs, DX bad, RX bad, both bad), and the times it locked, slipped (another place
    // took over) and lost the lock
    this.stats = { pairs: 0, dx: 0, rx: 0, both: 0, locks: 0, slips: 0, lost: 0 };
    // The AFC: the tones' phase turn, summed over a bit
    this.lastMr = 0;
    this.lastMi = 0;
    this.lastSr = 0;
    this.lastSi = 0;
    this.afcSum = 0;
    this.afcWeight = 0;
    this.afcCount = 0;
  }

  setFreq(freq)
  {
    this.freq = freq;
    const w = (2 * Math.PI * freq) / navtexFd;
    this.sRe = Math.cos(w);
    this.sIm = -Math.sin(w);
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
    let sRe = this.sRe;
    let sIm = this.sIm;
    let pos = this.dPos;
    let count = this.dCount;
    for (let i = 0; i < x.length; i++)
    {
      const v = x[i];
      const re = oRe * sRe - oIm * sIm;
      oIm = oRe * sIm + oIm * sRe;
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
      // The AFC may have moved the oscillator
      sRe = this.sRe;
      sIm = this.sIm;
    }
    // The oscillator kept at unit size (rounding would let it drift)
    const g = 1 / Math.sqrt(oRe * oRe + oIm * oIm);
    this.oRe = oRe * g;
    this.oIm = oIm * g;
    this.dPos = pos;
    this.dCount = count;
  }

  // A sample at about 2 kHz: the upper tone (B, as sent) brought down to 0 and the lower up to 0, each filtered; the ATC's level; the
  // AFC; the bit clock
  sample(zr, zi)
  {
    const re = this.tRe * this.tsRe - this.tIm * this.tsIm;
    this.tIm = this.tRe * this.tsIm + this.tIm * this.tsRe;
    this.tRe = re;
    if ((this.n & 1023) == 0)
    {
      const g = 1 / Math.sqrt(this.tRe * this.tRe + this.tIm * this.tIm);
      this.tRe *= g;
      this.tIm *= g;
    }
    const tr = this.tRe;
    const ti = this.tIm;
    const L = this.hLen;
    const p = this.hPos;
    const [mRe, mIm, sRe, sIm] = this.buf;
    mRe[p] = mRe[p + L] = zr * tr + zi * ti;
    mIm[p] = mIm[p + L] = zi * tr - zr * ti;
    sRe[p] = sRe[p + L] = zr * tr - zi * ti;
    sIm[p] = sIm[p + L] = zi * tr + zr * ti;
    this.hPos = p + 1 == L ? 0 : p + 1;
    let mr = 0;
    let mi = 0;
    let sr = 0;
    let si = 0;
    const h = this.h;
    for (let k = 0, q = this.hPos; k < L; k++, q++)
    {
      mr += h[k] * mRe[q];
      mi += h[k] * mIm[q];
      sr += h[k] * sRe[q];
      si += h[k] * sIm[q];
    }
    const mark = Math.sqrt(mr * mr + mi * mi);
    const space = Math.sqrt(sr * sr + si * si);
    const v = this.atc(mark, space);
    if (this.active) this.afc(mr, mi, sr, si, mark, space);
    this.clock(v, mark, space);
    this.n++;
  }

  // The ATC (as RTTY's): each tone's peak followed (quick up, slow down), and the decision's middle moved by half the peaks'
  // difference, so a tone that has faded is still read right. Above 0 the upper tone
  atc(mark, space)
  {
    const spb = this.spb;
    this.markPeak += (mark - this.markPeak) / (mark > this.markPeak ? spb / 4 : spb * 16);
    this.spacePeak += (space - this.spacePeak) / (space > this.spacePeak ? spb / 4 : spb * 16);
    this.markFloor += (mark - this.markFloor) / (mark < this.markFloor ? spb / 4 : spb * 48);
    this.spaceFloor += (space - this.spaceFloor) / (space < this.spaceFloor ? spb / 4 : spb * 48);
    return mark - space - 0.5 * (this.markPeak - this.spacePeak);
  }

  // The AFC: while a tone's clearly on, how fast its phase turns is how far off it is; averaged over a bit, the channel moved a tenth
  // of it (only while locked, so noise doesn't drag it away)
  afc(mr, mi, sr, si, mark, space)
  {
    if (mark > 2 * space && mark > 3 * this.markFloor)
    {
      const w = mark * mark;
      this.afcSum += Math.atan2(mi * this.lastMr - mr * this.lastMi, mr * this.lastMr + mi * this.lastMi) * w;
      this.afcWeight += w;
    }
    else if (space > 2 * mark && space > 3 * this.spaceFloor)
    {
      const w = space * space;
      this.afcSum += Math.atan2(si * this.lastSr - sr * this.lastSi, sr * this.lastSr + si * this.lastSi) * w;
      this.afcWeight += w;
    }
    this.lastMr = mr;
    this.lastMi = mi;
    this.lastSr = sr;
    this.lastSi = si;
    if (++this.afcCount < this.spb) return;
    this.afcCount = 0;
    if (this.afcWeight > 0)
    {
      const hz = ((this.afcSum / this.afcWeight) * this.rate2) / (2 * Math.PI);
      this.setFreq(this.freq + 0.1 * Math.max(-20, Math.min(20, hz)));
    }
    this.afcSum = 0;
    this.afcWeight = 0;
  }

  // The bit clock: the level's crossings fall on bits' edges (phase 0), so each pulls the clock toward it, and its rate is nudged
  // (a sender's or sound card's clock that's off); a bit is read where the phase passes 0.5, between two samples. Only a crossing
  // after a clear bit counts (one tone well over the other, and not faded far under its peak): through a fade or a crash of noise
  // the clock runs on at its rate, so a character's two copies, 350 ms apart, still fall where they're read
  clock(v, mark, space)
  {
    const step = (1 + this.rateAdjust) / this.spb;
    const before = this.phase;
    this.phase += step;
    if (this.clear && (v > 0) != (this.lastV > 0) && v != this.lastV)
    {
      const f = this.lastV / (this.lastV - v);
      let at = before + f * step;
      at -= Math.round(at);
      const gain = this.active ? 0.04 : 0.1;
      this.phase -= gain * at;
      this.rateAdjust = Math.max(-0.005, Math.min(0.005, this.rateAdjust - 0.002 * gain * at));
    }
    if (before < 0.5 && this.phase >= 0.5)
    {
      const f = (0.5 - before) / step;
      const level = Math.max(mark, space);
      const contrast = mark + space > 0 ? Math.abs(mark - space) / (mark + space) : 0;
      this.clear = contrast > NAVTEX_CLOCK_CONTRAST && level > NAVTEX_CLOCK_LEVEL * Math.max(this.markPeak, this.spacePeak);
      this.bit(this.lastV + f * (v - this.lastV), contrast);
    }
    if (this.phase >= 1) this.phase -= 1;
    else if (this.phase < 0) this.phase += 1;
    this.lastV = v;
  }

  // A bit read (above 0 the upper tone) and how clear it was (its tones' sizes apart, of their sum: near 1 a clean bit, about 0.3
  // noise, whether a fade's quiet or a crash's loud): the 7-bit word ending at it, scored for the lock; once locked, at each RX's last
  // bit, a character
  bit(level, contrast)
  {
    this.word = ((this.word << 1) | (level > 0 ? 1 : 0)) & 127;
    const t = this.bits++;
    this.words[t & (NAVTEX_WORDS - 1)] = this.word;
    this.soft[t & (NAVTEX_WORDS - 1)] = level > 0 ? contrast : -contrast;
    if (t < 35) return;
    this.score(t);
    if (this.active && t % 14 == this.place) this.character(t, true);
  }

  // The word at t (both ways round) scored at its place (t mod 14) as an RX's: 1 if it's 4B/3Y and the same as the word 35 bits
  // before (its DX), or β after α (phasing), else 0, averaged over 8. A place scoring NAVTEX_LOCK, with NAVTEX_LOCK_RUN such running,
  // locks; a locked one is closed by its characters' quality (character), or taken over by a place clearly better
  score(t)
  {
    const place = t % 14;
    const mask = NAVTEX_WORDS - 1;
    const w = this.words[t & mask];
    const w7 = this.words[(t - 7) & mask];
    const w35 = this.words[(t - 35) & mask];
    for (let s = 0; s < 2; s++)
    {
      const x = s ? 127 - w : w;
      const x7 = s ? 127 - w7 : w7;
      const x35 = s ? 127 - w35 : w35;
      const forward = x7 == NAVTEX_ALPHA && x == NAVTEX_BETA;
      const backward = x7 == navtexReverse(NAVTEX_ALPHA) && x == navtexReverse(NAVTEX_BETA);
      const hit = (NAVTEX_VALID[x] && x == x35) || forward || backward;
      const scores = this.scores[s];
      scores[place] += ((hit ? 1 : 0) - scores[place]) / 8;
      this.runs[s][place] = hit ? Math.min(255, this.runs[s][place] + 1) : 0;
      if (s == this.sign && place == this.place && this.active)
      {
        if (forward) this.orders[0]++;
        if (backward) this.orders[1]++;
      }
    }
    if (this.active)
    {
      const mine = this.scores[this.sign][this.place];
      for (let s = 0; s < 2; s++)
      {
        for (let p = 0; p < 14; p++)
        {
          if (this.scores[s][p] > NAVTEX_LOCK && this.scores[s][p] > mine + NAVTEX_RELOCK_EDGE && this.runs[s][p] >= NAVTEX_LOCK_RUN)
          {
            this.sign = s;
            this.place = p;
            this.stats.slips++;
          }
        }
      }
      return;
    }
    for (let s = 0; s < 2 && !this.active; s++)
    {
      if (this.scores[s][place] > NAVTEX_LOCK && this.runs[s][place] >= NAVTEX_LOCK_RUN) this.lock(t, s, place);
    }
  }

  // Locked at an RX's last bit: the bit order from what phasing came, and the characters before (back while their copies were good)
  // read too
  lock(t, sign, place)
  {
    this.active = true;
    this.everActive = true;
    this.stats.locks++;
    this.sign = sign;
    this.place = place;
    this.quality = 1;
    this.alphas = 0;
    this.lastGood = navtexNow;
    if (this.msg) this.lostAt = 0;
    // Which order the phasing (if any, in the words kept) reads as
    let forward = 0;
    let backward = 0;
    for (let k = t; k >= Math.max(7, t - 49); k -= 14)
    {
      const x = this.signed(k), x7 = this.signed(k - 7);
      if (x7 == NAVTEX_ALPHA && x == NAVTEX_BETA) forward++;
      if (x7 == navtexReverse(NAVTEX_ALPHA) && x == navtexReverse(NAVTEX_BETA)) backward++;
    }
    this.orders = [forward, backward];
    this.order = backward > forward ? 1 : 0;
    // The characters before it, from the words kept, back to the earliest whose copies agree (an RX the same as its DX, or β after
    // α), with at most one that doesn't between: noise before the signal started has a good copy now and then, but almost never two
    // that agree
    let from = t;
    let misses = 0;
    for (let k = t - 14; k >= 49 && t - k <= 14 * NAVTEX_BACKFILL && misses < 2; k -= 14)
    {
      const rx = this.signed(k);
      const agree = (NAVTEX_VALID[rx] && rx == this.signed(k - 35)) || (this.signed(k - 7) == (this.order ? navtexReverse(NAVTEX_ALPHA) : NAVTEX_ALPHA) &&
        rx == (this.order ? navtexReverse(NAVTEX_BETA) : NAVTEX_BETA));
      if (agree)
      {
        from = k;
        misses = 0;
      }
      else misses++;
    }
    // (the one at t itself is read live, by bit())
    for (let k = from; k < t; k += 14) this.character(k, false);
  }

  // How clear the 7 bits ending at k were, added up
  clearness(k)
  {
    let sum = 0;
    for (let b = 0; b < 7; b++) sum += Math.abs(this.soft[(k - b) & (NAVTEX_WORDS - 1)]);
    return sum;
  }

  // The word ending at bit k, the locked way round
  signed(k)
  {
    const w = this.words[k & (NAVTEX_WORDS - 1)];
    return this.sign ? 127 - w : w;
  }

  // A character at an RX's last bit k: its DX (35 bits before) if that's 4B/3Y, else its RX, else an error; then printed. Live (not
  // the look back when locking) the lock's quality is kept, and the end of emission looked for
  character(k, live)
  {
    const dx = this.signed(k - 35);
    const rx = this.signed(k);
    const dxOk = NAVTEX_VALID[dx] == 1;
    const rxOk = NAVTEX_VALID[rx] == 1;
    const order = this.order;
    // The bit order switched: phasing heard read the other way round
    if (live && this.orders[1 - order] > this.orders[order] + 1) this.order = 1 - order;
    // Both good but not the same: one is noise that happens to be 4B/3Y (a fade or crash over it: 35 of the 128 words are), so the
    // clearer one is taken
    let word = -1;
    if (dxOk && rxOk) word = dx == rx || this.clearness(k - 35) >= this.clearness(k) ? dx : rx;
    else if (dxOk || rxOk) word = dxOk ? dx : rx;
    const symbol = word >= 0 ? NAVTEX_DECODE[this.order][word] : -1;
    if (live)
    {
      this.stats.pairs++;
      if (!dxOk) this.stats.dx++;
      if (!rxOk) this.stats.rx++;
      if (!dxOk && !rxOk) this.stats.both++;
      this.quality += ((word >= 0 ? 1 : 0) - this.quality) / 8;
      // The end of emission: α in the DX position (the newest, 7 bits back) twice running, with no β (phasing) in the RX position
      const newest = NAVTEX_DECODE[this.order][this.signed(k - 7)];
      this.alphas = newest == NAVTEX_SYMBOL_ALPHA && NAVTEX_DECODE[this.order][rx] != NAVTEX_SYMBOL_BETA ? this.alphas + 1 : 0;
    }
    this.put(symbol);
    if (!live) return;
    if (this.quality < NAVTEX_UNLOCK) this.unlock(false);
    else if (this.alphas >= 2) this.unlock(true);
  }

  // The lock dropped: the errors held since the last good character were the signal gone, taken back; the rest goes out. At the end of
  // emission (ended) a message still open is closed
  unlock(ended)
  {
    this.active = false;
    if (!ended) this.stats.lost++;
    for (const s of this.scores) s.fill(0);
    for (const r of this.runs) r.fill(0);
    let last = this.held.length - 1;
    while (last >= 0 && !this.held[last].ok) last--;
    for (let i = 0; i <= last; i++) this.print(this.held[i]);
    this.held.length = 0;
    if (ended) this.endMessage(false);
    else if (this.msg) this.lostAt = navtexNow;
  }

  // A symbol decided (traffic 0 to 31, α, β, the repetition, or -1 an error): what it prints, held a moment
  put(symbol)
  {
    let ch = "";
    let ok = true;
    if (symbol < 0)
    {
      ch = "_";
      ok = false;
    }
    else if (symbol < 26) ch = this.figures ? NAVTEX_FIGURES[symbol] : NAVTEX_LETTERS[symbol];
    else if (symbol == NAVTEX_LF) ch = "\n";
    else if (symbol == NAVTEX_SPACE) ch = " ";
    else if (symbol == NAVTEX_LTRS) this.figures = false;
    else if (symbol == NAVTEX_FIGS) this.figures = true;
    // Phasing marked (once) in what's held, so the message parser knows a ZCZC is due; carriage return, the unperforated tape, phasing
    // and the repetition print nothing
    if ((symbol == NAVTEX_SYMBOL_ALPHA || symbol == NAVTEX_SYMBOL_BETA) && !(this.held.length && this.held[this.held.length - 1].phasing))
    {
      this.held.push({ ch: "", ok: true, phasing: true });
    }
    if (!ch) return;
    this.held.push({ ch, ok });
    while (this.held.length > NAVTEX_HOLD) this.print(this.held.shift());
  }

  // A character out: an error shown only inside a message; and into the message being read
  print(c)
  {
    if (c.phasing)
    {
      this.sincePhasing = 0;
      return;
    }
    if (c.ok || this.msg) this.text += c.ch;
    this.parse(c.ch);
  }

  // The message format (M.540 Annex II): "ZCZC", a space, B1B2B3B4, a new line, the text, "NNNN" on a line of its own. A weak signal
  // loses letters (an error, or now and then another letter: a 4B/3Y signal with two bits wrong), so ZCZC is taken with one of its
  // letters wrong, or one lost (three of it before the space), or in the first characters after phasing (where only a ZCZC comes) with
  // two of its letters right; and NNNN with one wrong or lost (at a line's start). A ZCZC inside a message closes it, not complete
  parse(ch)
  {
    this.recent = (this.recent + ch).slice(-6);
    this.sincePhasing++;
    const msg = this.msg;
    const tail = this.recent.slice(-4);
    // (not again for the ZCZC just taken: its space, after 3 of its letters, would look like one lost)
    const fresh = msg && msg.header && msg.id.length == 0;
    const due = !msg && this.sincePhasing <= NAVTEX_ZCZC_DUE && tail.length == 4 && [...tail].filter((c, i) => c == "ZCZC"[i]).length >= 2;
    if (!fresh && (due || navtexNear(tail, "ZCZC") || (ch == " " && navtexDropped(this.recent.slice(-4, -1), "ZCZC"))))
    {
      if (msg) this.endMessage(false);
      this.msg = { id: "", header: true, text: "", line: "", errors: 0, chars: 0 };
      this.lostAt = 0;
      return;
    }
    if (!msg) return;
    if (msg.header)
    {
      if (ch == "\n")
      {
        if (msg.id.length) msg.header = false;
      }
      else if (ch != " " && msg.id.length < 4) msg.id += ch;
      else if (ch == " " && msg.id.length) msg.header = false;
      return;
    }
    msg.text += ch;
    if (ch == "_") msg.errors++;
    if (ch != "\n" && ch != " ") msg.chars++;
    const line = msg.line;
    msg.line = ch == "\n" ? "" : line + ch;
    if ((msg.line.length == 4 && navtexNear(msg.line, "NNNN")) || (ch == "\n" && navtexDropped(line, "NNNN")))
    {
      // The NNNN line isn't the text's
      const end = ch == "\n" ? line : msg.line;
      msg.text = msg.text.slice(0, msg.text.length - end.length - (ch == "\n" ? 1 : 0));
      for (const c of end)
      {
        if (c == "_") msg.errors--;
        if (c != " ") msg.chars--;
      }
      this.endMessage(true);
    }
    else if (msg.text.length >= NAVTEX_MESSAGE_MAX) this.endMessage(false);
  }

  // The message out (complete: its NNNN came), its header's four characters as station, subject and number
  endMessage(complete)
  {
    const msg = this.msg;
    this.msg = null;
    this.lostAt = 0;
    if (!msg) return;
    const id = (msg.id + "____").slice(0, 4);
    const subject = id[1];
    self.postMessage({ type: "message", id: this.id, station: id[0], subject, number: id.slice(2), subjectName: NAVTEX_SUBJECTS[subject] || "",
      text: msg.text.replace(/^\n+/, "").replace(/\s+$/, ""), complete, errors: Math.max(0, msg.errors), chars: Math.max(0, msg.chars) });
  }

  // A message left open with the lock lost: closed after NAVTEX_MESSAGE_TIMEOUT
  timeout()
  {
    if (this.msg && !this.active && this.lostAt && navtexNow - this.lostAt > NAVTEX_MESSAGE_TIMEOUT * navtexFd) this.endMessage(false);
  }

  // The channel dropped: what's held goes out, and a message open is closed; unless it lost to another (lost), when nothing does
  close(lost = false)
  {
    if (lost)
    {
      this.text = "";
      this.held.length = 0;
      this.msg = null;
      return;
    }
    if (this.active) this.unlock(false);
    if (this.text.length) self.postMessage({ type: "text", id: this.id, text: this.text });
    this.text = "";
    this.endMessage(false);
  }

  // The SNR in 100 Hz (the baud), from the spectrum: both tones' power within 50 Hz each way over the noise
  measure(sp)
  {
    const half = NAVTEX_SHIFT / 2;
    const a = navtexBand(sp, this.freq + half - 50, this.freq + half + 50);
    const b = navtexBand(sp, this.freq - half - 50, this.freq - half + 50);
    const s = a.signal + b.signal;
    const noise = (a.noise + b.noise) / 2;
    this.snr = s > 0 && noise > 0 ? Math.max(-30, 10 * Math.log10(s / (noise * (NAVTEX_BAUD / sp.binHz)))) : -30;
  }
}
