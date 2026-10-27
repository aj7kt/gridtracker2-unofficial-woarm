// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Multi-Mode Decoder's keyboard modes: PSK31 (BPSK, varicode) or RTTY (45.45 baud, 170 Hz shift, Baudot), every signal in the
// passband at once, as the CW decoder lists every CW signal. One mode runs at a time (config's mode).
//   The audio is first brought down to about 9.6 kHz (a low-pass filter, then every Nth sample kept), which keeps up to 4 kHz.
//   Four times a second a spectrum (an FFT, averaged over a second or two) finds signals: for PSK31 a hump about 60 Hz wide that isn't a
//   bare carrier, for RTTY two tones 170 Hz apart; one seen for 0.75 s gets its own demodulator, which first runs over the last 2.5 s
//   of audio (kept for this), so a signal's first words aren't lost while the spectrum was making up its mind.
//   PSK31: the carrier found closely first (keyPskCarrier); mixed down, filtered to 500 Hz, a matched filter (a Hann shape 1.5 symbols
//   long, near the PSK31 pulse's own), a symbol clock found from where the signal's size dips between reversed symbols, each symbol's
//   phase against the one before (a reversal a 0), an AFC that follows the signal's drift, and varicode (a character ends at two 0s).
//   A channel's text goes out only while its symbols look like PSK (their phase changes near 0 or 180 degrees, some reversals, a steady
//   size), so noise, carriers and CW print nothing.
//   RTTY: mixed down, filtered to 1 kHz, the mark and space tones each filtered over about a bit, their sizes weighed against each
//   other (an ATC: each tone's peak followed, so a faded tone is still read right), then start-stop framing: a start bit (space), five
//   bits, a stop bit (mark), each bit read over its middle. Both ways round are tried (a reversed signal is one sent with the other
//   sideband), and the one whose characters frame cleanly is kept. Text goes out only while most characters frame cleanly.
// Characters are held a moment (0.4 to 0.8 s) before they go out, so the noise decoded in the moment after a signal stops, before the
// squelch shuts, can be taken back. A channel nothing comes from for 15 s is dropped. A channel's id stays the same while it's tracked.
// In:  { type: "init", rate }, { type: "audio", samples }, { type: "reset" }, { type: "config", mode: "psk31" | "rtty", minHz, maxHz }
// Out: { type: "channels", list: [{ id, freq (Hz: PSK31's carrier, RTTY's centre), snr (dB in the signal's own bandwidth), active }] },
//      four times a second; { type: "text", id, text }: what a channel decoded since its last one, every 100 ms or so

const KEY_PSK_BAUD = 31.25;
const KEY_RTTY_BAUD = 45.45;
const KEY_RTTY_SHIFT = 170;
// The highest audio frequency kept (Hz), and the rate it's brought down to (about)
const KEY_TOP_HZ = 4000;
const KEY_WORK_RATE = 9000;
// At most this many channels at once
const KEY_PSK_MAX = 24;
const KEY_RTTY_MAX = 16;
// Seconds: a channel with nothing for this long is dropped; one that never decoded is given this long; the place it was then isn't
// tried again for this long
const KEY_DROP_SECONDS = 15;
const KEY_TRIAL_SECONDS = 6;
const KEY_BLOCK_SECONDS = 15;
// After an RSID: the channels on trial within this of it dropped, and none opened there for this long (keyRsid)
const KEY_RSID_NEAR_HZ = 60;
const KEY_RSID_HOLD_SECONDS = 3;
// Seconds of audio kept, and run through a new channel's demodulator before it goes on live
const KEY_HISTORY_SECONDS = 4;
const KEY_CATCHUP_SECONDS = 2.5;
// The spectrum: its averaging (each new one's share), and frames needed before signals are looked for
const KEY_SPECTRUM_SHARE = 0.15;
const KEY_SPECTRUM_FRAMES = 6;
// A spectrum's lower quarter, taken as its noise, is below the noise's average: brought up by this
const KEY_FLOOR_BIAS = 1.2;
// A signal is looked at when its band holds this much over the noise there (2: 3 dB)
const KEY_FIND_RATIO = 2;
// ... in this many spectrum frames running (0.75 s)
const KEY_FIND_FRAMES = 3;
// PSK31: the squelch opens when the symbols' phase quality (cos 2θ of each phase change, averaged) is over the first, and some of
// them are reversals; closes under the second
const KEY_PSK_OPEN = 0.3;
const KEY_PSK_CLOSE = 0.2;
const KEY_PSK_REVERSALS = 0.1;
// PSK31: and its size is steady from symbol to symbol, this much (symbol()): a carrier keyed on and off, CW or one RTTY tone, isn't
const KEY_PSK_STEADY = 0.8;
// PSK31: symbols a character is held before it goes out
const KEY_PSK_HOLD = 24;
// RTTY: the squelch opens when this share of characters (averaged) frame cleanly, closes under the second; a clean one has each bit
// at least this far (of a clean bit's size) from the middle
const KEY_RTTY_OPEN = 0.5;
const KEY_RTTY_CLOSE = 0.3;
const KEY_RTTY_MARGIN = 0.1;
// RTTY: seconds a character is held before it goes out
const KEY_RTTY_HOLD = 0.4;
// RTTY: back to letters after a space in figures (unshift on space)
const KEY_RTTY_USOS = true;
// RTTY: the tone filters' length, in bits
const KEY_RTTY_FILTER = 1.25;

// Varicode (PSK31's alphabet) for ASCII 0 to 127; a character ends at 00, and none has 00 in it
const KEY_VARICODE_BITS = [
  "1010101011", "1011011011", "1011101101", "1101110111", "1011101011", "1101011111", "1011101111", "1011111101",
  "1011111111", "11101111", "11101", "1101101111", "1011011101", "11111", "1101110101", "1110101011",
  "1011110111", "1011110101", "1110101101", "1110101111", "1101011011", "1101101011", "1101101101", "1101010111",
  "1101111011", "1101111101", "1110110111", "1101010101", "1101011101", "1110111011", "1011111011", "1101111111",
  "1", "111111111", "101011111", "111110101", "111011011", "1011010101", "1010111011", "101111111",
  "11111011", "11110111", "101101111", "111011111", "1110101", "110101", "1010111", "110101111",
  "10110111", "10111101", "11101101", "11111111", "101110111", "101011011", "101101011", "110101101",
  "110101011", "110110111", "11110101", "110111101", "111101101", "1010101", "111010111", "1010101111",
  "1010111101", "1111101", "11101011", "10101101", "10110101", "1110111", "11011011", "11111101",
  "101010101", "1111111", "111111101", "101111101", "11010111", "10111011", "11011101", "10101011",
  "11010101", "111011101", "10101111", "1101111", "1101101", "101010111", "110110101", "101011101",
  "101110101", "101111011", "1010101101", "111110111", "111101111", "111111011", "1010111111", "101101101",
  "1011011111", "1011", "1011111", "101111", "101101", "11", "111101", "1011011",
  "101011", "1101", "111101011", "10111111", "11011", "111011", "1111", "111",
  "111111", "110111111", "10101", "10111", "101", "110111", "1111011", "1101011",
  "11011111", "1011101", "111010101", "1010110111", "110111011", "1010110101", "1011010111", "1110110101"
];
// A code (its bits as a number) to its character
const KEY_VARICODE = new Map(KEY_VARICODE_BITS.map((bits, ascii) => [parseInt(bits, 2), ascii]));

// Baudot (ITA2) with the US figures, as amateur RTTY uses; "" is nothing printed, 27 is figures, 31 letters, 2 a line feed
const KEY_LETTERS = ["", "E", "\n", "A", " ", "S", "I", "U", "", "D", "R", "J", "N", "F", "C", "K",
  "T", "Z", "L", "W", "H", "Y", "P", "Q", "O", "B", "G", "", "M", "X", "V", ""];
const KEY_FIGURES = ["", "3", "\n", "-", " ", "", "8", "7", "", "$", "4", "'", ",", "!", ":", "(",
  "5", "\"", ")", "2", "#", "6", "0", "1", "9", "?", "&", "", ".", "/", ";", ""];

let keyRate = 48000;
let keyMode = "psk31";
let keyMinHz = 200;
let keyMaxHz = 3000;
// The rate the work's done at, the highest frequency kept, and the stage bringing the audio down to it
let keyFd = 9600;
let keyTop = KEY_TOP_HZ;
let keyFront = null;
// Samples (at keyFd) so far: the clock everything's timed by
let keyNow = 0;
let keyHistory = new Float32Array(1);
let keyHistoryMask = 0;
let keySpec = null;
let keyChannels = [];
let keyNextId = 1;
let keyBlocked = [];
// Places left alone for a moment after an RSID (keyRsid)
let keyRsidHolds = [];
// Signals the spectrum has shown, and in how many frames running ({ freq, frames, seen })
let keyCandidates = [];
let keyLastFlush = 0;

self.onmessage = (event) =>
{
  const m = event.data;
  if (m.type == "init") keyInit(m.rate);
  else if (m.type == "reset")
  {
    keyInit(keyRate);
    keyPostChannels();
  }
  else if (m.type == "config") keyConfig(m);
  else if (m.type == "rsid") keyRsid(Number(m.freq));
  else if (m.type == "audio")
  {
    if (!keyFront) keyInit(keyRate);
    keyAudio(m.samples);
  }
};

function keyInit(rate)
{
  keyRate = rate > 0 ? rate : 48000;
  const d = Math.max(1, Math.floor(keyRate / KEY_WORK_RATE));
  keyFd = keyRate / d;
  keyTop = Math.min(KEY_TOP_HZ, keyFd * 0.42);
  keyFront = keyDecimator(keyRate, d, keyTop);
  let size = 1;
  while (size < keyFd * KEY_HISTORY_SECONDS) size *= 2;
  keyHistory = new Float32Array(size);
  keyHistoryMask = size - 1;
  keySpec = keySpectrum();
  keyNow = 0;
  keyLastFlush = 0;
  keyChannels = [];
  keyBlocked = [];
  keyRsidHolds = [];
  keyCandidates = [];
}

// The mode and range: another mode starts over; a narrower range drops the channels outside it
function keyConfig(m)
{
  const mode = m.mode == "rtty" ? "rtty" : "psk31";
  const min = Number(m.minHz);
  const max = Number(m.maxHz);
  keyMinHz = Number.isFinite(min) ? Math.max(50, Math.min(min, KEY_TOP_HZ - 100)) : 200;
  keyMaxHz = Number.isFinite(max) && max >= keyMinHz + 100 ? Math.min(max, KEY_TOP_HZ) : Math.max(keyMinHz + 100, 3000);
  if (mode != keyMode)
  {
    keyMode = mode;
    keyFlush();
    keyChannels = [];
    keyBlocked = [];
    keyCandidates = [];
    keyPostChannels();
    return;
  }
  const before = keyChannels.length;
  keyFlush();
  keyChannels = keyChannels.filter((c) => c.freq >= keyMinHz - 20 && c.freq <= keyMaxHz + 20);
  if (keyChannels.length != before) keyPostChannels();
}

// ---- The audio brought down to keyFd: a low-pass filter (a windowed sinc, Blackman) keeping up to top, worked out only for the samples
// kept (every dth)
function keyDecimator(rate, d, top)
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

// Three running sums of m samples one after another (a CIC filter's shape), as one filter: a channel's first step down, from keyFd to
// keyFd / m. Its nulls fall on everything that would fold back onto the channel
function keyBoxcar3(m)
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

// A Hann window's shape over n taps, summing to 1: PSK31's pulse, and RTTY's tone filters
function keyHann(n)
{
  const t = new Float64Array(n);
  for (let i = 0; i < n; i++) t[i] = Math.pow(Math.sin((Math.PI * (i + 0.5)) / n), 2);
  const sum = t.reduce((s, v) => s + v, 0);
  return t.map((v) => v / sum);
}

// ---- Each block of audio: brought down, kept, run through every channel; the spectrum four times a second, the text ten
function keyAudio(samples)
{
  const x = keyFront(samples);
  if (x.length == 0) return;
  for (let i = 0; i < x.length; i++) keyHistory[(keyNow + i) & keyHistoryMask] = x[i];
  for (const c of keyChannels) c.run(x);
  keyNow += x.length;
  if (keyNow - keySpec.last >= keySpec.hop)
  {
    keySpec.last = keyNow;
    keyFrame();
  }
  if (keyNow - keyLastFlush >= keyFd / 10)
  {
    keyLastFlush = keyNow;
    keyFlush();
  }
}

function keyFlush()
{
  for (const c of keyChannels)
  {
    // A new channel's text waits its first second (it may yet lose to another, keyTidy)
    if (c.text.length == 0 || c.conflict || keyNow - c.born < keyFd) continue;
    self.postMessage({ type: "text", id: c.id, text: c.text });
    c.text = "";
  }
}

function keyPostChannels()
{
  const list = keyChannels.filter((c) => c.everActive).sort((a, b) => a.freq - b.freq);
  self.postMessage({ type: "channels", list: list.map((c) => ({ id: c.id, freq: Math.round(c.freq * 10) / 10, snr: Math.round(c.snr), active: c.active })) });
}

// ---- The spectrum: an FFT of the last n samples (a Hann window), its power averaged frame to frame, and the noise under it
function keySpectrum()
{
  let n = 1;
  while (n < keyFd / 2.5) n *= 2;
  const win = new Float64Array(n);
  for (let i = 0; i < n; i++) win[i] = Math.pow(Math.sin((Math.PI * i) / n), 2);
  return { n, win, fft: keyFft(n), re: new Float64Array(n), im: new Float64Array(n), avg: new Float64Array(n / 2), floor: new Float64Array(n / 2),
    binHz: keyFd / n, hop: Math.round(keyFd / 4), last: 0, frames: 0 };
}

// A complex FFT in place (radix 2), n a power of 2
function keyFft(n)
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
function keyFloor(sp, k0, k1)
{
  const block = 16;
  const reach = Math.round(225 / sp.binHz);
  const lo = Math.max(1, k0 - reach);
  const hi = Math.min(sp.n / 2 - 1, k1 + reach);
  const values = [];
  for (let start = lo; start <= hi; start += block)
  {
    const centre = start + block / 2;
    values.length = 0;
    for (let j = Math.max(lo, centre - reach); j <= Math.min(hi, centre + reach); j++) values.push(sp.avg[j]);
    values.sort((a, b) => a - b);
    const noise = values[Math.floor(values.length / 4)] * KEY_FLOOR_BIAS;
    for (let j = start; j < Math.min(start + block, hi + 1); j++) sp.floor[j] = noise;
  }
  for (let j = 1; j < lo; j++) sp.floor[j] = sp.floor[lo];
  for (let j = hi + 1; j < sp.n / 2; j++) sp.floor[j] = sp.floor[hi];
}

// A band's power over the noise there (bins lo to hi), and the noise's power in one bin
function keyBand(sp, fromHz, toHz)
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
function keyCentroid(sp, fromHz, toHz)
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

// ---- Four times a second: the spectrum taken, the channels' SNR measured, dead channels dropped, new signals looked for, the list sent
function keyFrame()
{
  const sp = keySpec;
  if (keyNow < sp.n) return;
  for (let i = 0; i < sp.n; i++)
  {
    sp.re[i] = keyHistory[(keyNow - sp.n + i) & keyHistoryMask] * sp.win[i];
    sp.im[i] = 0;
  }
  sp.fft(sp.re, sp.im);
  const share = sp.frames == 0 ? 1 : KEY_SPECTRUM_SHARE;
  for (let k = 0; k < sp.n / 2; k++) sp.avg[k] += (sp.re[k] * sp.re[k] + sp.im[k] * sp.im[k] - sp.avg[k]) * share;
  sp.frames++;
  const k0 = Math.max(2, Math.floor(keyMinHz / sp.binHz));
  const k1 = Math.min(sp.n / 2 - 2, Math.ceil(Math.min(keyMaxHz, keyTop) / sp.binHz));
  keyFloor(sp, k0, k1);
  for (const c of keyChannels)
  {
    c.measure(sp);
    if (c.active || c.wasActive) c.lastGood = keyNow;
    c.wasActive = false;
  }
  keyTidy();
  if (sp.frames >= KEY_SPECTRUM_FRAMES)
  {
    if (keyMode == "rtty") keyFindRtty(sp, k0, k1);
    else keyFindPsk(sp, k0, k1);
  }
  keyPostChannels();
}

// Channels dropped: silent too long, never decoded in their trial, wandered out of range, or on top of another (the newer one goes,
// unless only it has decoded)
function keyTidy()
{
  const drop = new Set();
  for (const c of keyChannels)
  {
    if (c.everActive && keyNow - c.lastGood > KEY_DROP_SECONDS * keyFd) drop.add(c);
    else if (!c.everActive && keyNow - c.born > KEY_TRIAL_SECONDS * keyFd)
    {
      drop.add(c);
      keyBlocked.push({ freq: c.freq, until: keyNow + KEY_BLOCK_SECONDS * keyFd });
    }
    else if (c.freq < keyMinHz - 30 || c.freq > Math.min(keyMaxHz, keyTop) + 30) drop.add(c);
  }
  // A channel that loses to another keeps its text back (it was most likely the other's signal read wrongly)
  const lost = new Set();
  for (const c of keyChannels) c.conflict = false;
  for (let i = 0; i < keyChannels.length; i++)
  {
    for (let j = i + 1; j < keyChannels.length; j++)
    {
      const a = keyChannels[i];
      const b = keyChannels[j];
      if (drop.has(a) || drop.has(b)) continue;
      const apart = Math.abs(a.freq - b.freq);
      if (keyMode == "rtty" && Math.abs(apart - KEY_RTTY_SHIFT) < 40)
      {
        // One tone shared: one of them is reading a tone keyed on and off, with another signal's edge or nothing as its other tone (the
        // ATC copes with that). Both are given a second, their text held back meanwhile; then the one framing worse goes, or if they
        // frame alike, the weaker
        if (keyNow - Math.max(a.born, b.born) < keyFd)
        {
          a.conflict = true;
          b.conflict = true;
          continue;
        }
        const qa = a.framers[a.chosen].q;
        const qb = b.framers[b.chosen].q;
        const loser = Math.abs(qa - qb) > 0.15 ? (qa < qb ? a : b) : a.snr < b.snr ? a : b;
        drop.add(loser);
        lost.add(loser);
        keyBlocked.push({ freq: loser.freq, until: keyNow + KEY_BLOCK_SECONDS * keyFd });
        continue;
      }
      if (apart >= (keyMode == "rtty" ? 40 : 15)) continue;
      const loser = a.everActive != b.everActive ? (a.everActive ? b : a) : a.id > b.id ? a : b;
      drop.add(loser);
      lost.add(loser);
    }
  }
  if (drop.size)
  {
    for (const c of drop) if (c.text.length && !lost.has(c)) self.postMessage({ type: "text", id: c.id, text: c.text });
    keyChannels = keyChannels.filter((c) => !drop.has(c));
  }
  keyBlocked = keyBlocked.filter((b) => b.until > keyNow);
}

// Room for one more channel: under the limit, or one still on trial (the oldest) made way for
function keyRoom(max)
{
  if (keyChannels.length < max) return true;
  let oldest = null;
  for (const c of keyChannels) if (!c.everActive && (!oldest || c.born < oldest.born)) oldest = c;
  if (!oldest) return false;
  keyChannels = keyChannels.filter((c) => c != oldest);
  return true;
}

// The signals found this frame matched to those found before (within 10 Hz); those seen in KEY_FIND_FRAMES frames running come back,
// the strongest first. A signal just started has its demodulator's 2.5 s of audio kept mostly before it, so it's left a moment
function keySteadyCandidates(found)
{
  const frame = keySpec.frames;
  for (const f of found)
  {
    let c = keyCandidates.find((k) => Math.abs(k.freq - f.freq) < 10);
    if (!c)
    {
      c = { freq: f.freq, frames: 0, seen: 0 };
      keyCandidates.push(c);
    }
    c.frames = c.seen == frame - 1 ? c.frames + 1 : 1;
    c.seen = frame;
    c.freq = f.freq;
    c.ratio = f.ratio;
  }
  keyCandidates = keyCandidates.filter((c) => c.seen == frame);
  return keyCandidates.filter((c) => c.frames >= KEY_FIND_FRAMES).sort((a, b) => b.ratio - a.ratio);
}

// An RSID just heard at freq (mmdRsid.js): its tones look like a signal to the finder, so the channels still on trial it opened near
// there go, and the place is left alone for KEY_RSID_HOLD_SECONDS (its tones out of the spectrum by then); the mode's own signal, which
// starts a moment after, is then found where it is, and its first words read from the audio kept
function keyRsid(freq)
{
  if (!(freq > 0)) return;
  keyChannels = keyChannels.filter((c) => c.everActive || Math.abs(c.freq - freq) > KEY_RSID_NEAR_HZ);
  keyBlocked = keyBlocked.filter((b) => Math.abs(b.freq - freq) > KEY_RSID_NEAR_HZ);
  keyRsidHolds = keyRsidHolds.filter((h) => h.until > keyNow);
  keyRsidHolds.push({ freq, until: keyNow + KEY_RSID_HOLD_SECONDS * keyFd });
  keyPostChannels();
}

// A new channel at freq, unless one's near it or the place is blocked (or held after an RSID); it runs over the audio kept before going on
// live
function keySpawn(freq, near, make, max)
{
  for (const c of keyChannels) if (Math.abs(c.freq - freq) < near) return;
  for (const b of keyBlocked) if (Math.abs(b.freq - freq) < 25) return;
  for (const h of keyRsidHolds) if (h.until > keyNow && Math.abs(h.freq - freq) < KEY_RSID_NEAR_HZ) return;
  if (!keyRoom(max)) return;
  const n = Math.min(keyNow, Math.round(KEY_CATCHUP_SECONDS * keyFd));
  const back = new Float32Array(n);
  for (let i = 0; i < n; i++) back[i] = keyHistory[(keyNow - n + i) & keyHistoryMask];
  const c = make(keyNextId++, freq, back);
  c.run(back);
  keyChannels.push(c);
}

// PSK31 signals: a band 40 Hz wide 3 dB over the noise, the strongest for 40 Hz each way; not a bare carrier (most of its power within
// a few Hz); placed where its power's centred
function keyFindPsk(sp, k0, k1)
{
  const w = Math.max(2, Math.round(20 / sp.binHz));
  const near = Math.round(40 / sp.binHz);
  const narrow = 1 + Math.round(2 / sp.binHz);
  const ratio = new Float64Array(k1 + 1);
  for (let k = k0; k <= k1; k++)
  {
    let s = 0;
    let noise = 0;
    for (let j = Math.max(1, k - w); j <= k + w; j++)
    {
      s += sp.avg[j];
      noise += sp.floor[j];
    }
    ratio[k] = noise > 0 ? s / noise : 0;
  }
  const found = [];
  for (let k = k0; k <= k1; k++)
  {
    if (ratio[k] < KEY_FIND_RATIO) continue;
    let best = true;
    for (let j = Math.max(k0, k - near); j <= Math.min(k1, k + near) && best; j++) if (ratio[j] > ratio[k]) best = false;
    if (!best) continue;
    let inner = 0;
    let all = 0;
    for (let j = Math.max(1, k - w - near / 2); j <= k + w + near / 2; j++)
    {
      const p = Math.max(0, sp.avg[j] - sp.floor[j]);
      all += p;
      if (Math.abs(j - k) <= narrow) inner += p;
    }
    if (inner > 0.6 * all) continue;
    const freq = keyCentroid(sp, (k - 0.5) * sp.binHz - 40, (k + 0.5) * sp.binHz + 40);
    if (freq >= keyMinHz && freq <= keyMaxHz) found.push({ freq, ratio: ratio[k] });
  }
  for (const f of keySteadyCandidates(found)) keySpawn(f.freq, 40, (id, freq, back) => new KeyPsk(id, keyPskCarrier(freq, back)), KEY_PSK_MAX);
}

// RTTY signals: two tones 170 Hz apart, each 3 dB over the noise in 24 Hz, the pair's weaker the strongest for 40 Hz each way; placed
// midway between the tones' centres
function keyFindRtty(sp, k0, k1)
{
  const w = Math.max(2, Math.round(12 / sp.binHz));
  const near = Math.round(40 / sp.binHz);
  const half = KEY_RTTY_SHIFT / 2 / sp.binHz;
  const tone = (k) =>
  {
    let s = 0;
    let noise = 0;
    for (let j = Math.max(1, k - w); j <= Math.min(sp.n / 2 - 1, k + w); j++)
    {
      s += sp.avg[j];
      noise += sp.floor[j];
    }
    return noise > 0 ? s / noise : 0;
  };
  const ratio = new Float64Array(k1 + 1);
  for (let k = k0; k <= k1; k++) ratio[k] = Math.min(tone(Math.round(k + half)), tone(Math.round(k - half)));
  const found = [];
  for (let k = k0; k <= k1; k++)
  {
    if (ratio[k] < KEY_FIND_RATIO) continue;
    let best = true;
    for (let j = Math.max(k0, k - near); j <= Math.min(k1, k + near) && best; j++) if (ratio[j] > ratio[k]) best = false;
    if (!best) continue;
    // The two tones near the same strength (within 13 dB): not one tone and another's edge
    const a = tone(Math.round(k + half)) - 1;
    const b = tone(Math.round(k - half)) - 1;
    if (Math.max(a, b) > 20 * Math.min(a, b)) continue;
    const f = k * sp.binHz;
    const up = keyCentroid(sp, f + KEY_RTTY_SHIFT / 2 - 20, f + KEY_RTTY_SHIFT / 2 + 20);
    const down = keyCentroid(sp, f - KEY_RTTY_SHIFT / 2 - 20, f - KEY_RTTY_SHIFT / 2 + 20);
    const freq = up > 0 && down > 0 ? (up + down) / 2 : f;
    if (freq >= keyMinHz && freq <= keyMaxHz) found.push({ freq, ratio: ratio[k] });
  }
  for (const f of keySteadyCandidates(found)) keySpawn(f.freq, 80, (id, freq) => new KeyRtty(id, freq), KEY_RTTY_MAX);
}

// PSK31's carrier found closely (the spectrum's guess can be several Hz out, past what the AFC pulls in): the audio kept mixed down at the
// guess (a probe channel, its first filter only), filtered a little more (a Hann shape 0.6 of a symbol long, which passes the
// signal's two sides alike), squared (BPSK squared is a steady tone at twice its offset, the phase reversals gone), and that tone found
// (a DFT over offsets up to 20 Hz each way, every 0.1 Hz: an idling signal is two tones 15.6 Hz either side of its carrier, and the
// guess may have landed on one). The matched filter isn't used here: with the carrier off, it passes one side of an idling signal more
// than the other, and the square's tone would be found half a symbol rate away. The guess stands if the tone isn't clear of the rest
function keyPskCarrier(freq, back)
{
  const probe = new KeyPsk(0, freq);
  probe.capture = [];
  probe.run(back);
  const y = probe.capture;
  const h = keyHann(Math.max(2, Math.round((0.6 * probe.rate2) / KEY_PSK_BAUD)));
  // The first tenth of a second (the filters filling) left out
  const from = Math.round(probe.rate2 * 0.1);
  const count = y.length / 2 - from - h.length;
  if (count < probe.rate2) return freq;
  const zr = new Float64Array(count);
  const zi = new Float64Array(count);
  for (let i = 0; i < count; i++)
  {
    let re = 0;
    let im = 0;
    for (let k = 0; k < h.length; k++)
    {
      re += h[k] * y[2 * (from + i + k)];
      im += h[k] * y[2 * (from + i + k) + 1];
    }
    zr[i] = re * re - im * im;
    zi[i] = 2 * re * im;
  }
  let best = 0;
  let bestPower = 0;
  let total = 0;
  let tries = 0;
  for (let off = -20; off <= 20.001; off += 0.1)
  {
    const w = (-2 * Math.PI * 2 * off) / probe.rate2;
    const c = Math.cos(w);
    const s = Math.sin(w);
    let oRe = 1;
    let oIm = 0;
    let sr = 0;
    let si = 0;
    for (let i = 0; i < count; i++)
    {
      sr += zr[i] * oRe - zi[i] * oIm;
      si += zr[i] * oIm + zi[i] * oRe;
      const re = oRe * c - oIm * s;
      oIm = oRe * s + oIm * c;
      oRe = re;
    }
    const p = sr * sr + si * si;
    total += p;
    tries++;
    if (p > bestPower)
    {
      bestPower = p;
      best = off;
    }
  }
  return bestPower > (4 * total) / tries ? freq + best : freq;
}

// ---- What both kinds of channel share: an oscillator mixing the channel's frequency down to 0, and the first filter (keyBoxcar3)
// bringing it down to rate (about), each sample out handed to sample()
class KeyChannel
{
  constructor(id, freq, rate)
  {
    this.id = id;
    this.m = Math.max(1, Math.round(keyFd / rate));
    this.rate2 = keyFd / this.m;
    this.oRe = 1;
    this.oIm = 0;
    this.setFreq(freq);
    this.dTaps = keyBoxcar3(this.m);
    this.dLen = this.dTaps.length;
    this.dRe = new Float64Array(2 * this.dLen);
    this.dIm = new Float64Array(2 * this.dLen);
    this.dPos = 0;
    this.dCount = 0;
    this.active = false;
    this.wasActive = false;
    this.everActive = false;
    this.text = "";
    this.snr = 0;
    this.born = keyNow;
    this.lastGood = keyNow;
  }

  setFreq(freq)
  {
    this.freq = freq;
    const w = (2 * Math.PI * freq) / keyFd;
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
}

// ---- A PSK31 channel. After the first filter (500 Hz), the matched filter (a Hann shape 1.5 symbols long: PSK31's pulse is the same
// shape two symbols long, and a little shorter smears less from one symbol into the next), then the symbol clock: the filtered signal's size, averaged at 16 points through a symbol, peaks at the symbol's middle (it dips where a
// reversal crosses zero); the clock is pulled toward that peak, and its rate follows a sender's clock that's off
class KeyPsk extends KeyChannel
{
  constructor(id, freq)
  {
    super(id, freq, 500);
    const sps = this.rate2 / KEY_PSK_BAUD;
    this.h = keyHann(Math.round(1.5 * sps));
    this.hLen = this.h.length;
    this.mRe = new Float64Array(2 * this.hLen);
    this.mIm = new Float64Array(2 * this.hLen);
    this.mPos = 0;
    this.baseStep = KEY_PSK_BAUD / this.rate2;
    this.rateAdjust = 0;
    this.phase = 0;
    this.profile = new Float64Array(16);
    this.lastRe = 0;
    this.lastIm = 0;
    this.symRe = 0;
    this.symIm = 0;
    // The phase quality (slow, for the squelch; fast, for the AFC's weight), and the share of reversals
    this.quality = 0;
    this.fast = 0;
    this.reversals = 0;
    this.reg = 0;
    this.len = 0;
    this.pending = [];
    // Characters decoded while open, held a moment (so the noise read before the squelch shuts at a signal's end can be taken back)
    this.held = [];
    this.symbols = 0;
    this.quick = 0;
    this.slow = 0;
    this.envelope = 0;
    this.envelopePower = 0;
  }

  sample(zr, zi)
  {
    if (this.capture)
    {
      // A probe (keyPskCarrier): the signal kept, nothing decoded
      this.capture.push(zr, zi);
      return;
    }
    const L = this.hLen;
    const h = this.h;
    const p = this.mPos;
    this.mRe[p] = this.mRe[p + L] = zr;
    this.mIm[p] = this.mIm[p + L] = zi;
    this.mPos = p + 1 == L ? 0 : p + 1;
    let yr = 0;
    let yi = 0;
    for (let k = 0, q = this.mPos; k < L; k++, q++)
    {
      yr += h[k] * this.mRe[q];
      yi += h[k] * this.mIm[q];
    }
    const slot = (Math.floor(this.phase * 16) + 16) & 15;
    this.profile[slot] += (Math.sqrt(yr * yr + yi * yi) - this.profile[slot]) * 0.05;
    const before = this.phase;
    const step = this.baseStep * (1 - this.rateAdjust);
    this.phase += step;
    if (this.phase >= 1)
    {
      this.phase -= 1;
      // The symbol's middle fell between the last sample and this one
      const f = (1 - before) / step;
      this.symbol(this.lastRe + f * (yr - this.lastRe), this.lastIm + f * (yi - this.lastIm));
      this.clock();
    }
    this.lastRe = yr;
    this.lastIm = yi;
  }

  // Where the size peaks within a symbol (-0.5 to 0.5 of one, 0 where it's read): the clock moved toward it, and its rate nudged
  clock()
  {
    let c = 0;
    let s = 0;
    for (let k = 0; k < 16; k++)
    {
      const a = (2 * Math.PI * (k + 0.5)) / 16;
      c += this.profile[k] * Math.cos(a);
      s += this.profile[k] * Math.sin(a);
    }
    if (c == 0 && s == 0) return;
    const centre = Math.atan2(s, c) / (2 * Math.PI);
    this.phase -= 0.05 * centre;
    this.rateAdjust = Math.max(-0.01, Math.min(0.01, this.rateAdjust + 0.0005 * centre));
  }

  // A symbol: its phase against the last one's (near 0 a 1, near 180 degrees a 0); how far off those it is, its quality; the AFC
  // turned by it; the squelch; the bit into varicode
  symbol(sr, si)
  {
    const dr = sr * this.symRe + si * this.symIm;
    const di = si * this.symRe - sr * this.symIm;
    this.symRe = sr;
    this.symIm = si;
    const power = dr * dr + di * di;
    if (!(power > 0)) return;
    const c2 = (dr * dr - di * di) / power;
    this.quality += (c2 - this.quality) / 48;
    this.fast += (c2 - this.fast) / 10;
    const bit = dr > 0 ? 1 : 0;
    this.reversals += (1 - bit - this.reversals) / 64;
    let err = Math.atan2(di, dr);
    if (err > Math.PI / 2) err -= Math.PI;
    else if (err < -Math.PI / 2) err += Math.PI;
    if (this.fast > 0) this.setFreq(this.freq + (0.05 * this.fast * err * KEY_PSK_BAUD) / (2 * Math.PI));
    // The symbols' size, quick and slow: a sudden drop is the signal gone
    const size = sr * sr + si * si;
    this.quick += (size - this.quick) / 4;
    this.slow += (size - this.slow) / 64;
    // How steady the size is from symbol to symbol (its average squared over its power: 1 steady, π/4 noise, about 0.5 for CW or one
    // RTTY tone, keyed on and off)
    this.envelope += (Math.sqrt(size) - this.envelope) / 32;
    this.envelopePower += (size - this.envelopePower) / 32;
    const steady = this.envelopePower > 0 ? (this.envelope * this.envelope) / this.envelopePower : 0;
    if (!this.active && this.quality > KEY_PSK_OPEN && this.fast > 0.15 && this.reversals > KEY_PSK_REVERSALS && steady > KEY_PSK_STEADY)
    {
      // Open: what came just before it (while it was opening) goes out too
      this.active = true;
      this.everActive = true;
      for (const p of this.pending) if (p.fast > 0.5) this.hold(p.ch);
      this.pending = [];
    }
    else if (this.active && (this.quality < KEY_PSK_CLOSE || this.fast < -0.05 || this.quick < 0.08 * this.slow || steady < KEY_PSK_STEADY - 0.1))
    {
      // Closed: what's still held was most likely the noise after the signal ended. A drop in size is seen within about 10 symbols, so
      // then what came before that is kept
      this.active = false;
      const gone = this.quick < 0.08 * this.slow;
      const keep = gone ? 12 : KEY_PSK_HOLD;
      for (const h of this.held) if (this.symbols - h.at > keep) this.text += h.ch;
      this.held.length = 0;
      // The signal gone: opening again takes a while of PSK-like symbols (the noise after it looks like PSK now and then)
      if (gone) this.quality = Math.min(this.quality, 0);
    }
    if (this.active) this.wasActive = true;
    else if (this.fast < 0.1) this.pending = [];
    // Held characters go out KEY_PSK_HOLD symbols after they came
    this.symbols++;
    while (this.held.length && this.symbols - this.held[0].at > KEY_PSK_HOLD) this.text += this.held.shift().ch;
    this.reg = ((this.reg << 1) | bit) & 0x3fff;
    this.len++;
    if ((this.reg & 3) == 0)
    {
      if (this.len > 2 && this.len <= 12)
      {
        const ascii = KEY_VARICODE.get(this.reg >> 2);
        if (ascii !== undefined) this.put(ascii);
      }
      this.reg = 0;
      this.len = 0;
    }
  }

  // A character: printable ones and line feeds kept
  put(ascii)
  {
    let ch = "";
    if (ascii >= 32 && ascii < 127) ch = String.fromCharCode(ascii);
    else if (ascii == 10) ch = "\n";
    if (!ch) return;
    if (this.active) this.hold(ch);
    else
    {
      // Kept with how PSK-like the symbols were then: the noise before a signal starts decodes too
      this.pending.push({ ch, fast: this.fast });
      if (this.pending.length > 40) this.pending.shift();
    }
  }

  hold(ch)
  {
    this.held.push({ ch, at: this.symbols });
  }

  // The SNR in PSK31's bandwidth (31.25 Hz), from the spectrum: the power within 25 Hz each way over the noise
  measure(sp)
  {
    const b = keyBand(sp, this.freq - 25, this.freq + 25);
    this.snr = b.signal > 0 && b.noise > 0 ? Math.max(-30, 10 * Math.log10(b.signal / (b.noise * (KEY_PSK_BAUD / sp.binHz)))) : -30;
  }
}

// ---- An RTTY channel. After the first filter (1 kHz), each tone (85 Hz above and below the channel's centre) mixed to 0 and filtered
// over about a bit (a Hann shape 1.25 bits long); their sizes weighed against each other (atc), the level that gives (above 0 a mark)
// read by two framers, one each way round
class KeyRtty extends KeyChannel
{
  constructor(id, freq)
  {
    super(id, freq, 1000);
    this.spb = this.rate2 / KEY_RTTY_BAUD;
    this.h = keyHann(Math.round(KEY_RTTY_FILTER * this.spb));
    this.hLen = this.h.length;
    this.buf = [0, 1, 2, 3].map(() => new Float64Array(2 * this.hLen));
    this.hPos = 0;
    this.tRe = 1;
    this.tIm = 0;
    const w = (2 * Math.PI * (KEY_RTTY_SHIFT / 2)) / this.rate2;
    this.tsRe = Math.cos(w);
    this.tsIm = Math.sin(w);
    this.markPeak = 0;
    this.spacePeak = 0;
    this.markFloor = 0;
    this.spaceFloor = 0;
    this.scale = 1;
    // The level's last 1024 samples (over 20 bits), as the framers read back
    this.v = new Float64Array(1024);
    this.n = 0;
    this.framers = [new KeyRttyFramer(1), new KeyRttyFramer(-1)];
    this.chosen = 0;
    // Characters decoded while open, held a moment (so the noise read before the squelch shuts at a signal's end can be taken back)
    this.held = [];
    this.quick = 0;
    this.slow = 0;
    this.lastMr = 0;
    this.lastMi = 0;
    this.lastSr = 0;
    this.lastSi = 0;
    this.afcSum = 0;
    this.afcWeight = 0;
    this.afcCount = 0;
  }

  sample(zr, zi)
  {
    // The tones' oscillator (at half the shift), kept at unit size now and then
    const re = this.tRe * this.tsRe - this.tIm * this.tsIm;
    this.tIm = this.tRe * this.tsIm + this.tIm * this.tsRe;
    this.tRe = re;
    if ((this.n & 1023) == 0)
    {
      const g = 1 / Math.sqrt(this.tRe * this.tRe + this.tIm * this.tIm);
      this.tRe *= g;
      this.tIm *= g;
    }
    // Mark (the upper tone) brought down to 0, space up to 0
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
    this.atc(mark, space);
    this.afc(mr, mi, sr, si, mark, space);
    // The signal's size, quick (a bit) and slow (30 bits): a sudden drop is the signal gone, the squelch shut, and what was held from
    // after it dropped (0.15 s) taken back
    const level = Math.max(mark, space);
    this.quick += (level - this.quick) / this.spb;
    this.slow += (level - this.slow) / (this.spb * 30);
    if (this.active && this.quick < 0.25 * this.slow)
    {
      this.active = false;
      // Opening again takes characters that frame (the noise after it frames now and then)
      for (const f of this.framers) f.q = Math.min(f.q, 0.3);
      const keep = 0.15 * this.rate2;
      for (const h of this.held) if (this.n - h.at > keep) this.text += h.ch;
      this.held.length = 0;
    }
    for (const f of this.framers) f.step(this, this.n);
    if (this.held.length) this.release();
    this.n++;
  }

  // The ATC: each tone's peak followed (quick up, slow down), and the decision's middle moved by half the peaks' difference, so a tone
  // that has faded (selective fading) is still read right: mark less space, less that. Above 0 a mark. Each tone's floor (quick down,
  // slow up) gives the size of a clean bit
  atc(mark, space)
  {
    const spb = this.spb;
    this.markPeak += (mark - this.markPeak) / (mark > this.markPeak ? spb / 4 : spb * 16);
    this.spacePeak += (space - this.spacePeak) / (space > this.spacePeak ? spb / 4 : spb * 16);
    this.markFloor += (mark - this.markFloor) / (mark < this.markFloor ? spb / 4 : spb * 48);
    this.spaceFloor += (space - this.spaceFloor) / (space < this.spaceFloor ? spb / 4 : spb * 48);
    const a = Math.max(0, this.markPeak - this.markFloor);
    const b = Math.max(0, this.spacePeak - this.spaceFloor);
    this.v[this.n & 1023] = (mark - space - 0.5 * (this.markPeak - this.spacePeak)) * (a + b) * 0.5;
    // A clean bit's level, for the framers' margin
    this.scale = Math.max(1e-30, 0.5 * (a * a + b * b));
  }

  // The AFC: while a tone's clearly on, how fast its phase turns is how far off it is; averaged over a bit, the channel moved a tenth
  // of it, once its characters frame (so noise doesn't drag it away)
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
    if (this.afcWeight > 0 && this.framers[this.chosen].q > 0.5)
    {
      const hz = ((this.afcSum / this.afcWeight) * this.rate2) / (2 * Math.PI);
      this.setFreq(this.freq + 0.1 * Math.max(-20, Math.min(20, hz)));
    }
    this.afcSum = 0;
    this.afcWeight = 0;
  }

  // After each character a framer reads: the way round that frames better is kept (a clear lead needed to swap), and the squelch set
  // by how well it frames
  judge()
  {
    const other = 1 - this.chosen;
    if (this.framers[other].q > this.framers[this.chosen].q + 0.25)
    {
      this.chosen = other;
      this.active = false;
    }
    const f = this.framers[this.chosen];
    if (!this.active && f.q > KEY_RTTY_OPEN && f.fails == 0)
    {
      this.active = true;
      this.everActive = true;
      for (const ch of f.pending) this.held.push({ ch, at: this.n });
      f.pending = "";
    }
    else if (this.active && (f.q < KEY_RTTY_CLOSE || f.fails >= 3))
    {
      // Closed (three characters running that didn't frame is most likely the signal gone): what's held was the noise after it, and
      // opening again takes characters that frame
      this.active = false;
      this.held.length = 0;
      for (const g of this.framers) g.q = Math.min(g.q, 0.3);
    }
    if (this.active) this.wasActive = true;
    for (const g of this.framers) if (g.q < 0.3) g.pending = "";
  }

  put(framer, ch)
  {
    if (this.active && framer == this.framers[this.chosen]) this.held.push({ ch, at: this.n });
    else framer.pending = (framer.pending + ch).slice(-40);
  }

  // Held characters go out KEY_RTTY_HOLD seconds after they came
  release()
  {
    const hold = KEY_RTTY_HOLD * this.rate2;
    while (this.held.length && this.n - this.held[0].at > hold) this.text += this.held.shift().ch;
  }

  // The SNR in RTTY's bandwidth (45.45 Hz), from the spectrum: both tones' power within 25 Hz each way over the noise
  measure(sp)
  {
    const half = KEY_RTTY_SHIFT / 2;
    const a = keyBand(sp, this.freq + half - 25, this.freq + half + 25);
    const b = keyBand(sp, this.freq - half - 25, this.freq - half + 25);
    const s = a.signal + b.signal;
    const noise = (a.noise + b.noise) / 2;
    this.snr = s > 0 && noise > 0 ? Math.max(-30, 10 * Math.log10(s / (noise * (KEY_RTTY_BAUD / sp.binHz)))) : -30;
  }
}

// ---- Start-stop framing, one way round (sign 1: mark the upper tone; -1 reversed). It waits for a mark to space change (a start bit's
// edge), then reads each bit over its middle: the start bit must be a space and the stop bit (the seventh) a mark, or it wasn't a
// character's start, and the bits after the edge are looked through again. q: how many characters frame cleanly (averaged)
class KeyRttyFramer
{
  constructor(sign)
  {
    this.sign = sign;
    this.scan = 1;
    this.t0 = -1;
    this.figures = false;
    this.q = 0.3;
    // Characters running that didn't frame
    this.fails = 0;
    this.pending = "";
  }

  step(ch, n)
  {
    const v = ch.v;
    const s = this.sign;
    while (this.scan <= n)
    {
      if (this.t0 < 0)
      {
        const i = this.scan++;
        const a = s * v[(i - 1) & 1023];
        const b = s * v[i & 1023];
        // The edge, placed between the two samples where it crossed
        if (a > 0 && b <= 0) this.t0 = i - 1 + a / (a - b);
      }
      else
      {
        if (n < this.t0 + 6.8 * ch.spb + 1) break;
        this.frame(ch);
      }
    }
  }

  // A bit's level: the middle 60% of it averaged
  bit(ch, b)
  {
    const from = Math.ceil(this.t0 + (b + 0.2) * ch.spb);
    const to = Math.floor(this.t0 + (b + 0.8) * ch.spb);
    let sum = 0;
    for (let j = from; j <= to; j++) sum += ch.v[j & 1023];
    return (this.sign * sum) / Math.max(1, to - from + 1);
  }

  frame(ch)
  {
    const start = this.bit(ch, 0);
    const stop = this.bit(ch, 6);
    const ok = start < 0 && stop > 0;
    let code = 0;
    let margin = Math.min(-start, stop);
    if (ok)
    {
      for (let k = 0; k < 5; k++)
      {
        const level = this.bit(ch, 1 + k);
        if (level > 0) code |= 1 << k;
        margin = Math.min(margin, Math.abs(level));
      }
    }
    const clean = ok && margin > KEY_RTTY_MARGIN * ch.scale;
    this.q += ((clean ? 1 : 0) - this.q) * 0.12;
    this.fails = ok ? 0 : this.fails + 1;
    // A character: the next start can come from the stop bit's middle on; not one: look again from half a bit after this edge
    this.scan = ok ? Math.floor(this.t0 + 6.5 * ch.spb) : Math.ceil(this.t0 + 0.5 * ch.spb);
    this.t0 = -1;
    ch.judge();
    if (ok) this.decode(ch, code);
  }

  decode(ch, code)
  {
    if (code == 31)
    {
      this.figures = false;
      return;
    }
    if (code == 27)
    {
      this.figures = true;
      return;
    }
    const c = (this.figures ? KEY_FIGURES : KEY_LETTERS)[code];
    if (code == 4 && KEY_RTTY_USOS) this.figures = false;
    if (c) ch.put(this, c);
  }
}
