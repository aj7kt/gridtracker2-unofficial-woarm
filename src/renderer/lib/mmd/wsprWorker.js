// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// WSPR (the Multi-Mode Decoder's WSPR mode, mmdWspr.js): each 2 minute period's 12 kHz audio decoded once it has been heard. Written
// from the published protocol (K1JT's WSPR description and G4JNT's specification: the message packing, the K=32 rate 1/2 code and its
// two polynomials, the bit-reversed interleave, the 162 symbol sync vector, 4-FSK at 12000/8192 Hz): every signal between 1350 and 1650
// Hz of audio is found, timed, its drift followed, demodulated and Fano decoded.
// In: { type: "decode", start, samples (12 kHz, from the period's start) }. Out: { type: "decoded", start, list: [{ snr, dt, freq
// (audio Hz, the signal's middle), drift (Hz over the transmission), call, grid, power, message }], ms }

const WSPR_RATE = 12000;
// The audio searched: its middle and the baseband's rate (the 12 kHz audio taken down 32 times)
const WSPR_CENTER = 1500;
const WSPR_FS = 375;
const WSPR_HALF_SPAN = 150;
// A symbol at the baseband rate (8192 samples at 12 kHz), the tones' spacing, and the symbols
const WSPR_SYMBOL = 256;
const WSPR_DF = WSPR_FS / WSPR_SYMBOL;
const WSPR_SYMBOLS = 162;
// The spectrogram: each frame two symbols' FFT (half a tone's spacing a bin), half a symbol apart
const WSPR_NFFT = 512;
const WSPR_HOP = 128;
// The code: K=32, rate 1/2
const WSPR_POLY = [0xf2d05351, 0xe4613c47];
const WSPR_BITS = 81;
const WSPR_SYNC = [
  1, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0,
  0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0,
  0, 1, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0,
  0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0
];
// Candidates tried, at most, and how far over the noise one must stand; a sync this good or better goes on to be decoded
const WSPR_MAX_CANDIDATES = 60;
const WSPR_CANDIDATE_DB = 1.0;
const WSPR_MIN_SYNC = 0.12;
// The Fano decoder: its threshold step (bits) and how many steps it may take for each bit
const WSPR_FANO_DELTA = 2.0;
const WSPR_FANO_CYCLES = 4000;
// SNR in 2500 Hz from the spectrum's (calibrated on synthetic signals)
const WSPR_SNR_OFFSET = -25.0;

// ---- FFT (radix 2, in place, complex as re/im arrays)

const FFT_CACHE = {};

function fftTables(n)
{
  if (FFT_CACHE[n]) return FFT_CACHE[n];
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++)
  {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  const rev = new Uint32Array(n);
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++)
  {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  return (FFT_CACHE[n] = { cos, sin, rev });
}

// Forward (sign -1) or inverse (sign 1, unscaled)
function fft(re, im, sign = -1)
{
  const n = re.length;
  const { cos, sin, rev } = fftTables(n);
  for (let i = 0; i < n; i++)
  {
    const j = rev[i];
    if (j > i)
    {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let size = 2; size <= n; size *= 2)
  {
    const half = size / 2, step = n / size;
    for (let i = 0; i < n; i += size)
    {
      for (let j = 0, k = 0; j < half; j++, k += step)
      {
        const wr = cos[k], wi = sign * sin[k];
        const a = i + j, b = a + half;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

// ---- The period's audio at baseband: one FFT of it all, the bins around WSPR_CENTER taken, back at WSPR_FS (complex)

function wsprBaseband(samples)
{
  let n = 1;
  while (n < samples.length) n *= 2;
  const re = new Float64Array(n), im = new Float64Array(n);
  re.set(samples);
  fft(re, im, -1);
  const m = (n * WSPR_FS) / WSPR_RATE;
  const bre = new Float64Array(m), bim = new Float64Array(m);
  const center = Math.round((WSPR_CENTER * n) / WSPR_RATE);
  // Up to 172 Hz either side (the rest left out, as a low-pass)
  const keep = Math.floor((172 * n) / WSPR_RATE);
  for (let k = -keep; k <= keep; k++)
  {
    const from = center + k;
    const to = (k + m) % m;
    bre[to] = re[from];
    bim[to] = im[from];
  }
  fft(bre, bim, 1);
  // The baseband's own length: the audio's, taken down
  const length = Math.floor((samples.length * WSPR_FS) / WSPR_RATE);
  const scale = 1 / n;
  const out = { re: new Float32Array(length), im: new Float32Array(length) };
  for (let i = 0; i < length; i++)
  {
    out.re[i] = bre[i] * scale;
    out.im[i] = bim[i] * scale;
  }
  return out;
}

// ---- The spectrogram: frame f covers samples f*HOP .. +SYMBOL (zero-padded to NFFT); bins as offsets, -NFFT/2 .. NFFT/2-1, by index
// + NFFT/2

function wsprSpectrogram(bb)
{
  const frames = Math.floor((bb.re.length - WSPR_SYMBOL) / WSPR_HOP) + 1;
  const power = [];
  const re = new Float64Array(WSPR_NFFT), im = new Float64Array(WSPR_NFFT);
  for (let f = 0; f < frames; f++)
  {
    re.fill(0);
    im.fill(0);
    const at = f * WSPR_HOP;
    for (let i = 0; i < WSPR_SYMBOL; i++)
    {
      re[i] = bb.re[at + i];
      im[i] = bb.im[at + i];
    }
    fft(re, im, -1);
    const p = new Float32Array(WSPR_NFFT);
    for (let k = 0; k < WSPR_NFFT; k++)
    {
      const src = (k + WSPR_NFFT / 2) % WSPR_NFFT;
      p[k] = re[src] * re[src] + im[src] * im[src];
    }
    power.push(p);
  }
  return power;
}

// The bin (index) of an offset in Hz from the middle, and back
const WSPR_BIN_HZ = WSPR_FS / WSPR_NFFT;

// ---- Candidates: the average spectrum smoothed over a signal's four tones, its peaks over the noise

function wsprCandidates(spec)
{
  const n = WSPR_NFFT;
  const avg = new Float64Array(n);
  for (const p of spec) for (let k = 0; k < n; k++) avg[k] += p[k];
  const smooth = new Float64Array(n);
  const lo = n / 2 - Math.round(WSPR_HALF_SPAN / WSPR_BIN_HZ), hi = n / 2 + Math.round(WSPR_HALF_SPAN / WSPR_BIN_HZ);
  for (let k = lo; k <= hi; k++)
  {
    let s = 0;
    for (let j = -4; j <= 4; j++) s += avg[k + j];
    smooth[k] = s;
  }
  // The noise: the spectrum's 30th percentile over the span
  const sorted = Array.from(smooth.slice(lo, hi + 1)).sort((a, b) => a - b);
  const noise = sorted[Math.floor(sorted.length * 0.3)] || 1;
  const list = [];
  for (let k = lo + 1; k < hi; k++)
  {
    const db = 10 * Math.log10(smooth[k] / noise);
    if (db >= WSPR_CANDIDATE_DB && smooth[k] >= smooth[k - 1] && smooth[k] > smooth[k + 1]) list.push({ bin: k - n / 2, db, power: smooth[k] - noise, noise });
  }
  list.sort((a, b) => b.db - a.db);
  return list.slice(0, WSPR_MAX_CANDIDATES);
}

// ---- Coarse sync on the spectrogram: the start (in frames), the middle's bin (the tones at -3, -1, 1, 3 from it) and the drift
// (bins over the transmission) where the sync vector reads best

function wsprSyncCoarse(spec, cand)
{
  const n = WSPR_NFFT;
  const frames = spec.length;
  const last = frames - 2 * (WSPR_SYMBOLS - 1) - 1;
  let best = { sync: -1 };
  for (let drift = -4; drift <= 4; drift++)
  {
    for (let db = -1; db <= 1; db++)
    {
      for (let lag = 0; lag <= last; lag++)
      {
        let ss = 0, all = 0;
        for (let i = 0; i < WSPR_SYMBOLS; i++)
        {
          const shift = Math.round((drift * (i - 81)) / 162);
          const b = n / 2 + cand.bin + db + shift;
          const p = spec[lag + 2 * i];
          const p0 = p[b - 3], p1 = p[b - 1], p2 = p[b + 1], p3 = p[b + 3];
          ss += (WSPR_SYNC[i] ? 1 : -1) * (p1 + p3 - p0 - p2);
          all += p0 + p1 + p2 + p3;
        }
        const sync = all > 0 ? ss / all : 0;
        if (sync > best.sync) best = { sync, lag, bin: cand.bin + db, drift };
      }
    }
  }
  return best;
}

// ---- Coherent demodulation: each symbol's four tones' amplitudes, at a start (baseband samples), a middle (Hz from WSPR_CENTER) and
// a drift (Hz over the transmission)

function wsprDemod(bb, start, hz, drift)
{
  const amps = new Float64Array(WSPR_SYMBOLS * 4);
  for (let i = 0; i < WSPR_SYMBOLS; i++)
  {
    const at = start + i * WSPR_SYMBOL;
    const f0 = hz + (drift * (i - 81)) / 162;
    for (let k = 0; k < 4; k++)
    {
      const f = f0 + (k - 1.5) * WSPR_DF;
      const w = (-2 * Math.PI * f) / WSPR_FS;
      let sr = 0, si = 0;
      // The tone's phasor stepped by a rotation (one cos and sin a symbol)
      let cr = Math.cos(w * at), ci = Math.sin(w * at);
      const dr = Math.cos(w), di = Math.sin(w);
      for (let j = 0; j < WSPR_SYMBOL; j++)
      {
        const s = at + j;
        if (s >= 0 && s < bb.re.length)
        {
          const xr = bb.re[s], xi = bb.im[s];
          sr += xr * cr - xi * ci;
          si += xr * ci + xi * cr;
        }
        const t = cr * dr - ci * di;
        ci = cr * di + ci * dr;
        cr = t;
      }
      amps[i * 4 + k] = Math.sqrt(sr * sr + si * si);
    }
  }
  return amps;
}

function wsprSyncOf(amps)
{
  let ss = 0, all = 0;
  for (let i = 0; i < WSPR_SYMBOLS; i++)
  {
    const p0 = amps[i * 4] ** 2, p1 = amps[i * 4 + 1] ** 2, p2 = amps[i * 4 + 2] ** 2, p3 = amps[i * 4 + 3] ** 2;
    ss += (WSPR_SYNC[i] ? 1 : -1) * (p1 + p3 - p0 - p2);
    all += p0 + p1 + p2 + p3;
  }
  return all > 0 ? ss / all : 0;
}

// The coarse sync refined: the start within half a symbol, the middle within half a bin, the drift within a Hz
function wsprSyncFine(bb, coarse)
{
  let start = coarse.lag * WSPR_HOP;
  let hz = coarse.bin * WSPR_BIN_HZ;
  let drift = coarse.drift * WSPR_BIN_HZ;
  let amps = wsprDemod(bb, start, hz, drift);
  let sync = wsprSyncOf(amps);
  for (const [what, steps] of [["start", [-64, -32, -16, 16, 32, 64]], ["hz", [-0.4, -0.2, -0.1, 0.1, 0.2, 0.4]], ["drift", [-1, -0.5, 0.5, 1]], ["start", [-8, 8]], ["hz", [-0.05, 0.05]]])
  {
    let bestStep = 0;
    for (const step of steps)
    {
      const s = what == "start" ? start + step : start, h = what == "hz" ? hz + step : hz, d = what == "drift" ? drift + step : drift;
      const a = wsprDemod(bb, s, h, d);
      const y = wsprSyncOf(a);
      if (y > sync)
      {
        sync = y;
        amps = a;
        bestStep = step;
      }
    }
    if (what == "start") start += bestStep;
    else if (what == "hz") hz += bestStep;
    else drift += bestStep;
  }
  return { start, hz, drift, sync, amps };
}

// ---- The code

function parity(x)
{
  x ^= x >>> 16;
  x ^= x >>> 8;
  x ^= x >>> 4;
  x ^= x >>> 2;
  x ^= x >>> 1;
  return x & 1;
}

function bitReverse8(i)
{
  let r = 0;
  for (let b = 0; b < 8; b++) r |= ((i >> b) & 1) << (7 - b);
  return r;
}

// The channel's order of the code's symbols: ORDER[p] is where the p-th code symbol is sent
const WSPR_ORDER = (() =>
{
  const order = [];
  for (let i = 0; i < 256; i++)
  {
    const j = bitReverse8(i);
    if (j < WSPR_SYMBOLS) order.push(j);
  }
  return order;
})();

// ln I0(x), the modified Bessel function's log (x >= 0)
function lnI0(x)
{
  if (x < 3.75)
  {
    const t = (x / 3.75) ** 2;
    return Math.log(1 + t * (3.5156229 + t * (3.0899424 + t * (1.2067492 + t * (0.2659732 + t * (0.0360768 + t * 0.0045813))))));
  }
  const t = 3.75 / x;
  return x - 0.5 * Math.log(x) + Math.log(0.39894228 + t * (0.01328592 + t * (0.00225319 + t * (-0.00157565 + t * (0.00916281 + t * (-0.02057706 + t * (0.02635537 + t * (-0.01647633 + t * 0.00392377))))))));
}

// Each data bit's log-likelihood ratio (positive: a 1; in the code's order), non-coherent: a data bit's tone is the sync bit's plus 2 for
// a 1, the other two tones are noise alone (the noise's power from them, the signal's amplitude from the ones that carry it)
function wsprSoft(amps)
{
  let noise = 0, both = 0;
  for (let i = 0; i < WSPR_SYMBOLS; i++)
  {
    const s = WSPR_SYNC[i];
    noise += amps[i * 4 + (1 - s)] ** 2 + amps[i * 4 + (1 - s) + 2] ** 2;
    both += Math.max(amps[i * 4 + s], amps[i * 4 + s + 2]) ** 2;
  }
  noise = Math.max(noise / (2 * WSPR_SYMBOLS), 1e-30);
  const a = Math.sqrt(Math.max(both / WSPR_SYMBOLS - noise, noise / 100));
  const y = new Float64Array(WSPR_SYMBOLS);
  for (let p = 0; p < WSPR_SYMBOLS; p++)
  {
    const i = WSPR_ORDER[p];
    const s = WSPR_SYNC[i];
    y[p] = lnI0((2 * a * amps[i * 4 + s + 2]) / noise) - lnI0((2 * a * amps[i * 4 + s]) / noise);
  }
  return y;
}

// Each bit's Fano metric for a 0 and for a 1 (bits, less the rate): log2(2 P(bit | y) ) - 1/2
function wsprMetrics(y)
{
  const m0 = new Float64Array(y.length), m1 = new Float64Array(y.length);
  for (let p = 0; p < y.length; p++)
  {
    const llr = Math.max(-50, Math.min(50, y[p]));
    m1[p] = Math.log2(2 / (1 + Math.exp(-llr))) - 0.5;
    m0[p] = Math.log2(2 / (1 + Math.exp(llr))) - 0.5;
  }
  return { m0, m1 };
}

// Fano sequential decoding of the 81 bits (50 and the 31 zeros that flush the coder), or null
function wsprFano(metrics)
{
  const { m0, m1 } = metrics;
  const nodes = [];
  for (let k = 0; k <= WSPR_BITS; k++) nodes.push({ reg: 0, gamma: 0, tm: [0, 0], bits: [0, 0], i: 0 });
  const branches = (k, reg) =>
  {
    const out = [];
    const choices = k >= 50 ? [0] : [0, 1];
    for (const b of choices)
    {
      const r = ((reg << 1) | b) >>> 0;
      const s0 = parity(r & WSPR_POLY[0]), s1 = parity(r & WSPR_POLY[1]);
      const bm = (s0 ? m1[2 * k] : m0[2 * k]) + (s1 ? m1[2 * k + 1] : m0[2 * k + 1]);
      out.push([bm, b]);
    }
    out.sort((a, b) => b[0] - a[0]);
    return out;
  };
  const setNode = (k) =>
  {
    const node = nodes[k];
    const br = branches(k, node.reg);
    node.tm = br.map((x) => x[0]);
    node.bits = br.map((x) => x[1]);
    node.i = 0;
  };
  setNode(0);
  let k = 0;
  let T = 0;
  const limit = WSPR_FANO_CYCLES * WSPR_BITS;
  for (let cycle = 0; cycle < limit; cycle++)
  {
    const node = nodes[k];
    const ngamma = node.gamma + node.tm[node.i];
    if (ngamma >= T)
    {
      // Forward. A node visited for the first time: the threshold raised as far as it goes
      if (node.gamma < T + WSPR_FANO_DELTA) while (ngamma >= T + WSPR_FANO_DELTA) T += WSPR_FANO_DELTA;
      const next = nodes[k + 1];
      next.gamma = ngamma;
      next.reg = ((node.reg << 1) | node.bits[node.i]) >>> 0;
      k++;
      if (k == WSPR_BITS)
      {
        // The 50 bits: the first 50 branches taken
        const bits = [];
        for (let j = 0; j < 50; j++) bits.push(nodes[j].bits[nodes[j].i]);
        return { bits, metric: ngamma, cycles: cycle };
      }
      setNode(k);
      continue;
    }
    // Back, while the way back is over the threshold; else the threshold lowered and forward again
    for (;;)
    {
      if (k == 0 || nodes[k - 1].gamma < T)
      {
        T -= WSPR_FANO_DELTA;
        if (nodes[k].i != 0) nodes[k].i = 0;
        break;
      }
      k--;
      const back = nodes[k];
      if (back.i == 0 && back.tm.length > 1)
      {
        back.i = 1;
        break;
      }
      // Both of its branches tried: further back
    }
  }
  return null;
}

// ---- The message

function wsprEncodeBits(bits)
{
  // The 162 code symbols (the code's order), from 50 bits and 31 zeros
  const out = [];
  let reg = 0;
  for (let k = 0; k < WSPR_BITS; k++)
  {
    reg = ((reg << 1) | (k < 50 ? bits[k] : 0)) >>> 0;
    out.push(parity(reg & WSPR_POLY[0]), parity(reg & WSPR_POLY[1]));
  }
  return out;
}

const WSPR_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ ";

function wsprCallOf(n)
{
  const c6 = (n % 27) + 10;
  n = Math.floor(n / 27);
  const c5 = (n % 27) + 10;
  n = Math.floor(n / 27);
  const c4 = (n % 27) + 10;
  n = Math.floor(n / 27);
  const c3 = n % 10;
  n = Math.floor(n / 10);
  const c2 = n % 36;
  n = Math.floor(n / 36);
  const c1 = n;
  if (c1 > 36) return null;
  return [c1, c2, c3, c4, c5, c6].map((v) => WSPR_CHARS[v] || " ").join("");
}

function wsprPrefixed(n3, call)
{
  if (n3 < 60000)
  {
    let pfx = "";
    for (let i = 0; i < 3; i++)
    {
      pfx = WSPR_CHARS[n3 % 37] + pfx;
      n3 = Math.floor(n3 / 37);
    }
    return pfx.trim() + "/" + call;
  }
  const nc = n3 - 60000;
  if (nc < 36) return call + "/" + WSPR_CHARS[nc];
  if (nc < 136) return call + "/" + String(nc - 36).padStart(2, "0");
  return null;
}

const WSPR_POWERS = new Set([0, 3, 7, 10, 13, 17, 20, 23, 27, 30, 33, 37, 40, 43, 47, 50, 53, 57, 60]);

// The 50 bits as a message: { call, grid, power, message } (a type 3's call unknown: "<...>"), else null
function wsprUnpack(bits)
{
  let n = 0;
  for (let i = 0; i < 28; i++) n = n * 2 + bits[i];
  let m = 0;
  for (let i = 28; i < 50; i++) m = m * 2 + bits[i];
  const ntype = (m % 128) - 64;
  const m1 = Math.floor(m / 128);
  const call6 = wsprCallOf(n);
  if (!call6) return null;
  const call = call6.trim();
  if (ntype >= 0 && WSPR_POWERS.has(ntype))
  {
    // Type 1: call, 4-character locator, power
    if (m1 >= 32400) return null;
    const a = 179 - Math.floor(m1 / 180), b = m1 % 180;
    const l1 = Math.floor(a / 10), l3 = a % 10, l2 = Math.floor(b / 10), l4 = b % 10;
    if (l1 > 17 || l2 > 17 || a < 0) return null;
    const grid = String.fromCharCode(65 + l1, 65 + l2) + l3 + l4;
    if (!wsprCallOk(call)) return null;
    return { call, grid, power: ntype, message: call + " " + grid + " " + ntype };
  }
  if (ntype > 0)
  {
    // Type 2: a call with a prefix or suffix, its power, no locator
    const nu = ntype % 10;
    let nadd = nu;
    if (nu > 3) nadd = nu - 3;
    if (nu > 7) nadd = nu - 7;
    const power = ntype - nadd;
    if (!WSPR_POWERS.has(power)) return null;
    const full = wsprPrefixed(m1 + 32768 * (nadd - 1), call);
    if (!full || !wsprCallOk(call)) return null;
    return { call: full, grid: "", power, message: full + " " + power };
  }
  // Type 3: a hashed call, a 6-character locator (sent in the call's place, turned by one), its power
  const power = -(ntype + 1);
  if (!WSPR_POWERS.has(power)) return null;
  const grid = (call6.slice(1) + call6[0]).trim();
  if (!/^[A-R]{2}[0-9]{2}[A-X]{2}$/.test(grid)) return null;
  return { call: "<...>", grid, power, message: "<...> " + grid + " " + power };
}

function wsprCallOk(call)
{
  return /^[A-Z0-9]{1,3}[0-9][A-Z]{1,3}$/.test(call);
}

// ---- A period

function wsprDecode(samples)
{
  const bb = wsprBaseband(samples);
  const spec = wsprSpectrogram(bb);
  const found = [];
  for (const cand of wsprCandidates(spec))
  {
    // Already decoded within a tone's spacing
    if (found.some((f) => Math.abs(f.bin - cand.bin) < 3)) continue;
    const coarse = wsprSyncCoarse(spec, cand);
    if (coarse.sync < WSPR_MIN_SYNC) continue;
    const fine = wsprSyncFine(bb, coarse);
    const decoded = wsprFano(wsprMetrics(wsprSoft(fine.amps)));
    if (!decoded) continue;
    const msg = wsprUnpack(decoded.bits);
    if (!msg) continue;
    // Its symbols again from what was decoded: most of the hard decisions must agree
    const code = wsprEncodeBits(decoded.bits);
    const soft = wsprSoft(fine.amps);
    let wrong = 0;
    for (let p = 0; p < WSPR_SYMBOLS; p++) if ((soft[p] > 0 ? 1 : 0) != code[p]) wrong++;
    if (wrong > 50) continue;
    found.push({
      bin: cand.bin,
      snr: Math.round(10 * Math.log10(Math.max(1e-6, cand.power / cand.noise)) + WSPR_SNR_OFFSET),
      dt: Math.round((fine.start / WSPR_FS - 1) * 10) / 10,
      freq: WSPR_CENTER + fine.hz,
      drift: Math.round(fine.drift),
      call: msg.call,
      grid: msg.grid,
      power: msg.power,
      message: msg.message,
      sync: fine.sync,
      wrong
    });
  }
  return found;
}

self.onmessage = (event) =>
{
  const data = event.data;
  if (!data || data.type != "decode") return;
  const began = performance.now();
  let list = [];
  try
  {
    list = wsprDecode(data.samples);
  }
  catch (e)
  {
    postMessage({ type: "error", start: data.start, message: e.message });
    return;
  }
  postMessage({ type: "decoded", start: data.start, list: list.map(({ bin, sync, wrong, ...d }) => d), ms: Math.round(performance.now() - began) });
};
