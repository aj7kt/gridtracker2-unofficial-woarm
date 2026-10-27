// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Multi-Mode Decoder's RSID finder: the Reed-Solomon Identifier fldigi, MultiPSK and others send before a transmission, which says
// what mode follows. It runs in every mode, over the audio decoded (Min Freq to Max Freq).
//   An RSID is 15 tones one after another, each 1024 samples at 11025 Hz long (about 93 ms), each one of 16 tones 11025 / 1024 Hz
//   (about 10.8 Hz) apart; the mode's own frequency is the 8th tone (tone 7). Which 15 tones are sent is the mode's number (12 bits)
//   coded with a Reed-Solomon code over GF(16): 3 symbols of number and 12 of check, so any two RSIDs differ in at least 13 tones.
//   A few modes are named in two parts: an escape RSID (number 6), then 10 tones' gap later a second one from the second list.
//   The audio is brought to a multiple of 11025 Hz (a low-pass filter, then read in between its samples), and every half tone a spectrum
//   of the last tone's length is taken (zero-padded to twice that, so its bins are half a tone apart). For every place in the passband
//   the strongest of the 16 tones there is kept, for the last 29 spectra; the tones 2 spectra apart for the last 15 tones are compared
//   with each mode's RSID, and one that differs in no more than RSID_MAX_ERRORS tones is a find. A find is held a few spectra so the
//   best place and timing of it is the one reported, and the same mode near there isn't reported again for a while.
//   Two errors at most also lets each RSID be looked up rather than compared: one of its three runs of 5 tones must then be whole.
// In:  { type: "init", rate }, { type: "audio", samples }, { type: "reset" }, { type: "config", minHz, maxHz }
// Out: { type: "rsid", code, name, freq (Hz: the mode's own, the RSID's tone 7), errors }

const RSID_BASE_RATE = 11025;
const RSID_SYMBOLS = 15;
const RSID_TONES = 16;
// Tones that may be wrong in a find
const RSID_MAX_ERRORS = 2;
// Spectra a find is held for a better one, and the same mode near it (bins) isn't reported again for (spectra)
const RSID_HOLD_FRAMES = 3;
const RSID_NEAR_BINS = 8;
const RSID_QUIET_FRAMES = 40;
// The second part of a two-part RSID ends this many spectra after the escape (10 tones' gap, 15 tones), give or take
const RSID_SECOND_FRAMES = 50;
const RSID_SECOND_SLACK = 12;
const RSID_ESCAPE = 6;

// The modes: [number, name]; the second list's only after an escape
const RSID_MODES_1 = [
  [1, "BPSK31"], [110, "QPSK31"], [2, "BPSK63"], [3, "QPSK63"], [4, "BPSK125"], [5, "QPSK125"], [126, "BPSK250"], [127, "QPSK250"],
  [173, "BPSK500"], [183, "PSK125R"], [186, "PSK250R"], [187, "PSK500R"], [7, "PSKFEC31"], [8, "PSK10"],
  [9, "MT63-500L"], [10, "MT63-500S"], [11, "MT63-500VS"], [12, "MT63-1000L"], [13, "MT63-1000S"], [14, "MT63-1000VS"],
  [15, "MT63-2000L"], [17, "MT63-2000S"], [18, "MT63-2000VS"], [19, "PSKAM10"], [20, "PSKAM31"], [21, "PSKAM50"], [22, "PSK63F"],
  [23, "PSK220F"], [24, "CHIP64"], [25, "CHIP128"], [26, "CW"], [27, "CCW-OOK 12"], [28, "CCW-OOK 24"], [29, "CCW-OOK 48"],
  [30, "CCW-FSK 12"], [31, "CCW-FSK 24"], [33, "CCW-FSK 48"], [34, "PACTOR-I FEC"], [113, "Packet 110"], [35, "Packet 300"],
  [36, "Packet 1200"], [37, "RTTY ASCII-7"], [38, "RTTY ASCII-8"], [39, "RTTY 45"], [40, "RTTY 50"], [41, "RTTY 75"],
  [42, "AMTOR FEC"], [43, "THROB1"], [44, "THROB2"], [45, "THROB4"], [46, "THROBX1"], [47, "THROBX2"], [146, "THROBX4"],
  [204, "Contestia 4/125"], [55, "Contestia 4/250"], [54, "Contestia 4/500"], [255, "Contestia 4/1000"], [254, "Contestia 4/2000"],
  [169, "Contestia 8/125"], [49, "Contestia 8/250"], [52, "Contestia 8/500"], [117, "Contestia 8/1000"], [247, "Contestia 8/2000"],
  [275, "Contestia 16/250"], [50, "Contestia 16/500"], [53, "Contestia 16/1000"], [259, "Contestia 16/2000"],
  [51, "Contestia 32/1000"], [201, "Contestia 32/2000"], [194, "Contestia 64/500"], [193, "Contestia 64/1000"],
  [191, "Contestia 64/2000"], [56, "Voice"], [60, "MFSK8"], [57, "MFSK16"], [147, "MFSK32"], [148, "MFSK11"], [152, "MFSK22"],
  [61, "RTTYM 8/250"], [62, "RTTYM 16/500"], [63, "RTTYM 32/1000"], [65, "RTTYM 8/500"], [66, "RTTYM 16/1000"], [67, "RTTYM 4/500"],
  [68, "RTTYM 4/250"], [119, "RTTYM 8/1000"], [170, "RTTYM 8/125"],
  [203, "Olivia 4/125"], [75, "Olivia 4/250"], [74, "Olivia 4/500"], [229, "Olivia 4/1000"], [238, "Olivia 4/2000"],
  [163, "Olivia 8/125"], [69, "Olivia 8/250"], [72, "Olivia 8/500"], [116, "Olivia 8/1000"], [214, "Olivia 8/2000"],
  [70, "Olivia 16/500"], [73, "Olivia 16/1000"], [234, "Olivia 16/2000"], [71, "Olivia 32/1000"], [221, "Olivia 32/2000"],
  [211, "Olivia 64/2000"], [76, "PAX"], [77, "PAX2"], [78, "DominoF"], [79, "FAX"], [81, "SSTV"],
  [84, "DominoEX 4"], [85, "DominoEX 5"], [86, "DominoEX 8"], [87, "DominoEX 11"], [88, "DominoEX 16"], [90, "DominoEX 22"],
  [92, "DominoEX 4 FEC"], [93, "DominoEX 5 FEC"], [97, "DominoEX 8 FEC"], [98, "DominoEX 11 FEC"], [99, "DominoEX 16 FEC"],
  [101, "DominoEX 22 FEC"], [104, "Feld Hell"], [105, "PSK Hell"], [106, "Hell 80"], [107, "FM Hell 105"], [108, "FM Hell 245"],
  [114, "MIL-STD-188-141A"], [123, "DTMF"], [125, "ALE400"], [131, "FDMDV"], [132, "JT65A"], [134, "JT65B"], [135, "JT65C"],
  [136, "THOR4"], [137, "THOR8"], [138, "THOR16"], [139, "THOR5"], [143, "THOR11"], [145, "THOR22"], [153, "Call ID"],
  [155, "Packet PSK1200"], [156, "Packet PSK250"], [159, "Packet PSK63"], [172, "MIL-STD-188-110A"], [263, "EOT"],
  [RSID_ESCAPE, ""]
];
const RSID_MODES_2 = [
  [450, "PSK63R x4"], [457, "PSK63R x5"], [458, "PSK63R x10"], [460, "PSK63R x20"], [462, "PSK63R x32"], [467, "PSK125R x4"],
  [497, "PSK125R x5"], [513, "PSK125R x10"], [519, "PSK125 x12"], [522, "PSK125R x12"], [527, "PSK125R x16"], [529, "PSK250R x2"],
  [533, "PSK250R x3"], [539, "PSK250R x5"], [541, "PSK250 x6"], [545, "PSK250R x6"], [551, "PSK250R x7"], [553, "PSK500R x2"],
  [558, "PSK500R x3"], [564, "PSK500R x4"], [566, "PSK500 x2"], [569, "PSK500 x4"], [570, "PSK1000"], [580, "PSK1000R"],
  [587, "PSK1000 x2"], [595, "PSK1000R x2"], [604, "PSK800R x2"], [610, "PSK800 x2"], [620, "MFSK64"], [625, "MFSK128"],
  [639, "THOR25 x4"], [649, "THOR50 x1"], [653, "THOR50 x2"], [658, "THOR100"], [662, "DominoEX 44"], [681, "DominoEX 88"],
  [687, "MFSK31"], [691, "DominoEX Micro"], [693, "THOR Micro"], [1026, "MFSK64L"], [1029, "MFSK128L"], [1066, "8PSK125"],
  [1071, "8PSK250"], [1076, "8PSK500"], [1047, "8PSK1000"], [1037, "8PSK125F"], [1038, "8PSK250F"], [1043, "8PSK500F"],
  [1078, "8PSK1000F"], [1058, "8PSK1200F"], [1239, "8PSK125FL"], [2052, "8PSK250FL"], [2053, "OFDM-500F"], [2094, "OFDM-750F"],
  [2118, "OFDM-2000"], [2110, "OFDM-2000F"], [1171, "IFKP"]
];

// GF(16) as the RSID's code has it (x^4 + x^3 + 1), and the 12 roots its check symbols are made with
const RSID_GF_POLY = 0x19;
const RSID_ROOTS = [2, 4, 8, 9, 11, 15, 7, 14, 5, 10, 13, 3];

function rsidGfMul(a, b)
{
  let p = 0;
  for (let i = 0; i < 4; i++)
  {
    if (b & (1 << i)) p ^= a;
    a <<= 1;
    if (a & 0x10) a ^= RSID_GF_POLY;
  }
  return p;
}

// A mode's number to its 15 tones: its three 4-bit parts, times (x + root) for each root
function rsidEncode(code)
{
  const c = new Array(RSID_SYMBOLS).fill(0);
  c[0] = (code >> 8) & 15;
  c[1] = (code >> 4) & 15;
  c[2] = code & 15;
  for (const root of RSID_ROOTS)
  {
    for (let j = RSID_SYMBOLS - 1; j > 0; j--) c[j] = c[j - 1] ^ rsidGfMul(c[j], root);
    c[0] = rsidGfMul(c[0], root);
  }
  return c;
}

// Every mode's tones, and three lookups by each run of 5 of them (the run's tones as one number) to the modes with that run
const RSID_CODES = [];
const RSID_RUNS = [new Map(), new Map(), new Map()];
for (const [list, second] of [[RSID_MODES_1, false], [RSID_MODES_2, true]])
{
  for (const [code, name] of list)
  {
    const entry = { code, name, second, tones: rsidEncode(code) };
    RSID_CODES.push(entry);
    for (let r = 0; r < 3; r++)
    {
      let key = 0;
      for (let i = r * 5; i < r * 5 + 5; i++) key = (key << 4) | entry.tones[i];
      const at = RSID_RUNS[r].get(key);
      if (at) at.push(entry);
      else RSID_RUNS[r].set(key, [entry]);
    }
  }
}

let rsidRate = 48000;
let rsidMinHz = 200;
let rsidMaxHz = 3000;
// The work's rate (a multiple of 11025 Hz), a tone's length there, the spectrum's size (twice that), and its bins (Hz)
let rsidFd = RSID_BASE_RATE;
let rsidSymLen = 1024;
let rsidFftSize = 2048;
let rsidBinHz = RSID_BASE_RATE / 2048;
// The low-pass before the audio is read at rsidFd: its taps, its history (kept twice over), and where it's read next
let rsidFir = null;
let rsidHist = null;
let rsidHistPos = 0;
let rsidIn = 0;
let rsidNext = 0;
let rsidStep = 1;
let rsidPrevY = 0;
// The audio at rsidFd (the last tone's length), samples since the last spectrum, and the spectrum's window and work arrays
let rsidBuf = null;
let rsidBufPos = 0;
let rsidSinceFrame = 0;
let rsidWindow = null;
let rsidRe = null;
let rsidIm = null;
let rsidCos = null;
let rsidSin = null;
let rsidRev = null;
let rsidPower = null;
// The places looked at (the first bin of tone 0), the strongest tone at each for the last frames (a ring), and the frame count
let rsidLowBin = 0;
let rsidHighBin = 0;
let rsidRing = [];
let rsidFrame = 0;
// A find held for a better one, finds not to report again ({ code, bin, until }), and escapes heard ({ bin, frame })
let rsidHeld = null;
let rsidQuiet = [];
let rsidEscapes = [];

function rsidSetup()
{
  rsidFd = RSID_BASE_RATE * (rsidMaxHz > 4300 ? (rsidMaxHz > 8600 ? 4 : 2) : 1);
  const k = rsidFd / RSID_BASE_RATE;
  rsidSymLen = 1024 * k;
  rsidFftSize = 2048 * k;
  rsidBinHz = rsidFd / rsidFftSize;
  // The low-pass: flat to 0.4 of rsidFd, gone by 0.6 (whatever is above folds back to above 0.4); a Blackman-windowed sinc
  const fc = (0.5 * rsidFd) / rsidRate;
  let taps = Math.ceil((5.5 * rsidRate) / (0.2 * rsidFd)) | 1;
  if (rsidRate <= rsidFd)
  {
    // The input no faster than the work's rate: read as it is
    taps = 1;
  }
  rsidFir = new Float32Array(taps);
  let sum = 0;
  for (let i = 0; i < taps; i++)
  {
    const m = i - (taps - 1) / 2;
    const sinc = m == 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * m) / (Math.PI * m);
    const w = taps == 1 ? 1 : 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (taps - 1));
    rsidFir[i] = sinc * w;
    sum += rsidFir[i];
  }
  for (let i = 0; i < taps; i++) rsidFir[i] /= sum;
  rsidHist = new Float32Array(taps * 2);
  rsidStep = rsidRate / rsidFd;
  rsidBuf = new Float32Array(rsidSymLen);
  rsidWindow = new Float32Array(rsidSymLen);
  for (let i = 0; i < rsidSymLen; i++) rsidWindow[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / rsidSymLen);
  rsidRe = new Float64Array(rsidFftSize);
  rsidIm = new Float64Array(rsidFftSize);
  rsidPower = new Float64Array(rsidFftSize / 2);
  rsidCos = new Float64Array(rsidFftSize / 2);
  rsidSin = new Float64Array(rsidFftSize / 2);
  for (let i = 0; i < rsidFftSize / 2; i++)
  {
    rsidCos[i] = Math.cos((2 * Math.PI * i) / rsidFftSize);
    rsidSin[i] = -Math.sin((2 * Math.PI * i) / rsidFftSize);
  }
  const bits = Math.log2(rsidFftSize);
  rsidRev = new Uint32Array(rsidFftSize);
  for (let i = 0; i < rsidFftSize; i++)
  {
    let r = 0;
    for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
    rsidRev[i] = r;
  }
  // The places: the RSID's tone 7 from Min Freq to Max Freq, all 16 tones under 0.4 of rsidFd
  const top = Math.min(rsidFftSize / 2 - 1, Math.floor((0.4 * rsidFd) / rsidBinHz));
  rsidLowBin = Math.max(1, Math.floor(rsidMinHz / rsidBinHz) - 14);
  rsidHighBin = Math.min(top - 2 * (RSID_TONES - 1), Math.ceil(rsidMaxHz / rsidBinHz) - 14);
  rsidReset();
}

function rsidReset()
{
  if (!rsidHist) return;
  rsidHist.fill(0);
  rsidHistPos = 0;
  rsidIn = 0;
  rsidNext = 0;
  rsidPrevY = 0;
  rsidBuf.fill(0);
  rsidBufPos = 0;
  rsidSinceFrame = 0;
  rsidRing = [];
  for (let i = 0; i < 2 * RSID_SYMBOLS - 1; i++) rsidRing.push(new Uint8Array(rsidFftSize / 2));
  rsidFrame = 0;
  rsidHeld = null;
  rsidQuiet = [];
  rsidEscapes = [];
}

// The input's samples into the work's rate: each filtered sample is worked out only where a sample at rsidFd falls next to it
function rsidFeed(samples)
{
  const taps = rsidFir.length;
  for (let j = 0; j < samples.length; j++)
  {
    rsidHist[rsidHistPos] = samples[j];
    rsidHist[rsidHistPos + taps] = samples[j];
    rsidHistPos = rsidHistPos + 1 >= taps ? 0 : rsidHistPos + 1;
    const i = rsidIn++;
    if (rsidNext > i + 1) continue;
    let y = 0;
    for (let t = 0; t < taps; t++) y += rsidHist[rsidHistPos + t] * rsidFir[taps - 1 - t];
    while (rsidNext <= i)
    {
      const frac = rsidNext - (i - 1);
      rsidSample(rsidPrevY + (y - rsidPrevY) * frac);
      rsidNext += rsidStep;
    }
    rsidPrevY = y;
  }
}

// A sample at rsidFd: every half tone, a spectrum
function rsidSample(v)
{
  rsidBuf[rsidBufPos] = v;
  rsidBufPos = rsidBufPos + 1 >= rsidSymLen ? 0 : rsidBufPos + 1;
  if (++rsidSinceFrame < rsidSymLen / 2) return;
  rsidSinceFrame = 0;
  rsidSpectrum();
  rsidSearch();
}

// The last tone's length, windowed, zero-padded to twice that: the power in each bin
function rsidSpectrum()
{
  const n = rsidFftSize;
  rsidRe.fill(0);
  rsidIm.fill(0);
  for (let i = 0; i < rsidSymLen; i++)
  {
    const v = rsidBuf[(rsidBufPos + i) % rsidSymLen] * rsidWindow[i];
    rsidRe[rsidRev[i]] = v;
  }
  for (let size = 2; size <= n; size <<= 1)
  {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size)
    {
      for (let k = 0; k < half; k++)
      {
        const c = rsidCos[k * step], s = rsidSin[k * step];
        const a = start + k, b = a + half;
        const tr = rsidRe[b] * c - rsidIm[b] * s;
        const ti = rsidRe[b] * s + rsidIm[b] * c;
        rsidRe[b] = rsidRe[a] - tr;
        rsidIm[b] = rsidIm[a] - ti;
        rsidRe[a] += tr;
        rsidIm[a] += ti;
      }
    }
  }
  for (let i = 0; i < n / 2; i++) rsidPower[i] = rsidRe[i] * rsidRe[i] + rsidIm[i] * rsidIm[i];
}

// The strongest tone at every place, into the ring; then each place's last 15 tones (2 spectra apart) looked up
function rsidSearch()
{
  const row = rsidRing.shift();
  for (let b = rsidLowBin; b <= rsidHighBin; b++)
  {
    let best = 0, max = rsidPower[b];
    for (let k = 1; k < RSID_TONES; k++)
    {
      const p = rsidPower[b + 2 * k];
      if (p > max)
      {
        max = p;
        best = k;
      }
    }
    row[b] = best;
  }
  rsidRing.push(row);
  rsidFrame++;
  if (rsidFrame < rsidRing.length) return;
  const tones = new Array(RSID_SYMBOLS);
  let found = null;
  for (let b = rsidLowBin; b <= rsidHighBin; b++)
  {
    for (let i = 0; i < RSID_SYMBOLS; i++) tones[i] = rsidRing[2 * i][b];
    const tried = new Set();
    for (let r = 0; r < 3; r++)
    {
      let key = 0;
      for (let i = r * 5; i < r * 5 + 5; i++) key = (key << 4) | tones[i];
      for (const entry of RSID_RUNS[r].get(key) || [])
      {
        if (tried.has(entry)) continue;
        tried.add(entry);
        let errors = 0;
        for (let i = 0; i < RSID_SYMBOLS && errors <= RSID_MAX_ERRORS; i++) if (tones[i] != entry.tones[i]) errors++;
        if (errors > RSID_MAX_ERRORS) continue;
        if (!found || errors < found.errors) found = { entry, bin: b, errors, frame: rsidFrame };
      }
    }
  }
  if (found && !rsidQuietFor(found))
  {
    if (!rsidHeld || found.errors < rsidHeld.errors) rsidHeld = found;
  }
  if (rsidHeld && rsidFrame - rsidHeld.frame >= RSID_HOLD_FRAMES) rsidReport();
}

// A find near one reported a moment ago (the same RSID seen again a spectrum later or a bin over)
function rsidQuietFor(find)
{
  rsidQuiet = rsidQuiet.filter((q) => q.until > rsidFrame);
  return rsidQuiet.some((q) => q.code == find.entry.code && Math.abs(q.bin - find.bin) <= RSID_NEAR_BINS);
}

function rsidReport()
{
  const find = rsidHeld;
  rsidHeld = null;
  rsidQuiet.push({ code: find.entry.code, bin: find.bin, until: rsidFrame + RSID_QUIET_FRAMES });
  rsidEscapes = rsidEscapes.filter((e) => rsidFrame - e.frame <= RSID_SECOND_FRAMES + RSID_SECOND_SLACK);
  if (find.entry.code == RSID_ESCAPE)
  {
    rsidEscapes.push({ bin: find.bin, frame: find.frame });
    return;
  }
  // The second list's only where an escape was heard, its gap before
  if (find.entry.second)
  {
    const gap = (e) => Math.abs(find.frame - e.frame - RSID_SECOND_FRAMES) <= RSID_SECOND_SLACK && Math.abs(e.bin - find.bin) <= RSID_NEAR_BINS;
    if (!rsidEscapes.some(gap)) return;
  }
  postMessage({ type: "rsid", code: find.entry.code, name: find.entry.name, freq: Math.round((find.bin + 14) * rsidBinHz), errors: find.errors });
}

onmessage = (event) =>
{
  const m = event.data;
  if (m.type == "init")
  {
    rsidRate = m.rate;
    rsidSetup();
  }
  else if (m.type == "config")
  {
    rsidMinHz = m.minHz;
    rsidMaxHz = m.maxHz;
    rsidSetup();
  }
  else if (m.type == "reset") rsidReset();
  else if (m.type == "audio" && rsidFir) rsidFeed(m.samples);
};
