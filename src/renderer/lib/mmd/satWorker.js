// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Multi-Mode Decoder's satellite telemetry: frames from a satellite's downlink in the input's audio at its own rate, three kinds,
// each through its own error correction, so what comes out is the frame as the satellite sent it (kept exact, for SatNOGS).
//   FUNcube (AO-73, EO-88, JO-97 ...): 1200 bps DBPSK in SSB audio. The carrier found anywhere from 700 to 3000 Hz (the audio squared
//   has a line at twice the carrier: BPSK's data squared away), mixed down, filtered (root raised cosine), the symbol clock recovered
//   (Gardner), each symbol taken against the one before (differential: no carrier phase needed), the carrier's drift followed from the
//   same. Then AO-40 FEC (Phil Karn's): 5200 symbols a frame, its 65 bit sync vector every 80th symbol, deinterleaved, Viterbi
//   (r = 1/2, k = 7), descrambled (CCSDS), two Reed-Solomon (160,128) codewords: 256 bytes
//   AX100 (GomSpace's radio, many cubesats; 1200 to 9600 baud, 19200 at 96 kHz): FSK, GFSK or GMSK from a rig's flat FM audio, sliced
//   as Packet's G3RUH path is. Mode 5: the sync word (ASM 0x930B51DE), a Golay (24,12) coded length, CCSDS descrambled, Reed-Solomon
//   (255,223). Mode 6 as well: the bits G3RUH descrambled, the sync word, a length byte, Reed-Solomon (255,223)
//   GENESIS (AMSAT-EA's HADES-SA, HADES-L, HADES-R ...): FSK, two tones in SSB audio, 800 bps 1600 Hz apart or 200 bps 1125 Hz apart,
//   the pair found in the spectrum. The sync word (0xBF35), a packet whose type gives its length, its CRC (CCITT) checked, descrambled
//   (x^17 + x^12 + 1, seven bits of each byte, as AMSAT-EA's own code). SSDV packets are checked by their own CRC; Codec2 voice and the
//   PN9 test packets carry no check and are let go
// In:  { type: "init", rate }, { type: "audio", samples }, { type: "reset" }, { type: "config", kinds, baud } (kinds: any of SAT_KINDS;
//      no config, every kind at its usual bauds)
// Out: { type: "frame", kind, baud, ok, bytes, hex, fec, audioHz, snr, summary }: bytes the frame after its FEC (FUNcube's 256, AX100's
//      data without the RS parity, GENESIS's packet descrambled with its CRC as sent), hex the same; audioHz where it was (the SSB kinds:
//      FUNcube's carrier, GENESIS's tones' middle); snr dB (FUNcube Es/N0, the FSK kinds their bits' eye)
//      GENESIS's SSDV packets also ssdv: the whole 256 byte SSDV packet as AMSAT-EA rebuilds it (ssdv.js, ssdvGenesisPacket)
//      { type: "status", kind, locked, audioHz } once a second, for the SSB kinds

// SSDV's packet rebuilt and its CRC checked (ssdv.js, shared with the window)
importScripts("ssdv.js");

const SAT_KINDS = ["funcube", "ax100", "genesis"];
// The same frame again within this long (of audio) goes out once (ms)
const SAT_DEDUPE_MS = 10000;
// The SSB kinds' audio: the input low passed below 3.8 kHz and taken down to about 9.6 kHz
const SAT_LOW_HZ = 9600;
const SAT_LOW_CUTOFF = 3800;
// Their spectrum: this many of those samples at a time (0.43 s)
const SAT_FFT_N = 4096;

let satRate = 48000;
let satKindsOn = SAT_KINDS.slice();
let satBaud = 0;
let satReady = false;
let satParts = [];
let satLow = null;
let satSpec = null;
let satSamples = 0;
let satStatusAt = 0;
const satRecent = new Map();

self.onmessage = (event) =>
{
  const m = event.data;
  if (m.type == "init") satInit(m.rate);
  else if (m.type == "reset") satInit(satRate);
  else if (m.type == "config")
  {
    // No list (or no config at all): every kind
    satKindsOn = Array.isArray(m.kinds) ? m.kinds.filter((k) => SAT_KINDS.includes(k)) : SAT_KINDS.slice();
    satBaud = Number(m.baud) > 0 ? Number(m.baud) : 0;
    satInit(satRate);
  }
  else if (m.type == "audio")
  {
    if (!satReady) satInit(satRate);
    satRun(m.samples);
  }
};

// The demodulators for the kinds on. A baud from config is used by each kind that can run at it (AX100: any it has the samples for;
// GENESIS: 800 or 200); a kind that can't keeps its usual ones
function satInit(rate)
{
  satRate = rate > 0 ? rate : 48000;
  satParts = [];
  satRecent.clear();
  satSamples = 0;
  satStatusAt = 0;
  const on = (k) => satKindsOn.includes(k);
  satLow = on("funcube") || on("genesis") ? satDecimator(satRate) : null;
  satSpec = satLow ? satSpectrum(satLow.fs, on("funcube")) : null;
  if (on("funcube")) satParts.push(satFuncube(satLow.fs));
  if (on("genesis"))
  {
    const fixed = SAT_GENESIS_MODES.find((g) => g.baud == satBaud);
    for (const g of SAT_GENESIS_MODES) if (!fixed || g == fixed) satParts.push(satGenesis(satLow.fs, g.baud, g.shift));
  }
  if (on("ax100"))
  {
    // Each baud needs four samples a bit
    const bauds = satBaud >= 300 && satRate >= satBaud * 4 ? [satBaud] : [1200, 2400, 4800, 9600, 19200].filter((b) => satRate >= b * 4);
    for (const baud of bauds) satParts.push(satAx100(satRate, baud));
  }
  satReady = true;
}

function satRun(x)
{
  for (const p of satParts) if (p.run) p.run(x);
  if (satLow)
  {
    const y = satLow.run(x);
    satSpec.add(y, (spec) =>
    {
      for (const p of satParts) if (p.spectrum) p.spectrum(spec);
    });
    for (const p of satParts) if (p.runLow) p.runLow(y);
  }
  satSamples += x.length;
  // Once a second of audio: each kind tracking a carrier says where (two of a kind, as GENESIS's two speeds: the one locked)
  if (satSamples - satStatusAt >= satRate)
  {
    satStatusAt = satSamples;
    const byKind = new Map();
    for (const p of satParts)
    {
      if (!p.status) continue;
      const s = p.status();
      const had = byKind.get(p.kind);
      if (!had || (s.locked && !had.locked)) byKind.set(p.kind, s);
    }
    for (const [kind, s] of byKind) self.postMessage({ type: "status", kind, locked: s.locked, audioHz: s.audioHz });
  }
}

// A frame out, once: the same bytes of the same kind again within SAT_DEDUPE_MS of audio are left
function satFrameOut(kind, baud, bytes, fec, audioHz, snr, summary, ssdv)
{
  const hex = satHex(bytes, "");
  const key = kind + hex;
  const now = (satSamples / satRate) * 1000;
  for (const [k, at] of satRecent) if (now - at > SAT_DEDUPE_MS) satRecent.delete(k);
  if (satRecent.has(key)) return;
  satRecent.set(key, now);
  const m = { type: "frame", kind, baud, ok: true, bytes, hex, fec, summary };
  if (audioHz > 0) m.audioHz = Math.round(audioHz);
  if (Number.isFinite(snr)) m.snr = Math.round(snr * 10) / 10;
  if (ssdv) m.ssdv = ssdv;
  self.postMessage(m);
}

function satHex(bytes, gap)
{
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += (i && gap ? gap : "") + (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16).toUpperCase();
  return s;
}

// ---- The SSB kinds' audio: low passed (a windowed sinc) and every D-th sample kept, about SAT_LOW_HZ
function satDecimator(rate)
{
  const D = Math.max(1, Math.floor(rate / SAT_LOW_HZ));
  const L = 8 * D + 1;
  const taps = new Float32Array(L);
  const fc = Math.min(0.45, SAT_LOW_CUTOFF / rate);
  let total = 0;
  for (let i = 0; i < L; i++)
  {
    const m = i - (L - 1) / 2;
    const sinc = m == 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * m) / (Math.PI * m);
    taps[i] = sinc * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (L - 1)));
    total += taps[i];
  }
  for (let i = 0; i < L; i++) taps[i] /= total;
  let tail = new Float32Array(L - 1);
  let next = 0;
  return {
    fs: rate / D,
    run(x)
    {
      // The last chunk's end, then this chunk: each output a full window of them
      const all = new Float32Array(tail.length + x.length);
      all.set(tail);
      all.set(x, tail.length);
      const out = new Float32Array(Math.max(0, Math.ceil((all.length - L + 1 - next) / D)));
      let o = 0;
      for (; next + L <= all.length; next += D)
      {
        let s = 0;
        for (let k = 0; k < L; k++) s += taps[k] * all[next + k];
        out[o++] = s;
      }
      next -= all.length - (L - 1);
      tail = all.slice(all.length - (L - 1));
      return o == out.length ? out : out.subarray(0, o);
    }
  };
}

// ---- The SSB kinds' spectrum, SAT_FFT_N samples at a time (Hann windowed): each block's power (GENESIS, for its bursts), its average
// and the noise floor under it; for FUNcube the analytic signal squared, its power averaged (BPSK squared is a line at twice the
// carrier)
function satSpectrum(fs, squared)
{
  const N = SAT_FFT_N;
  const buf = new Float32Array(N);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  let fill = 0;
  let blocks = 0;
  const low = new Float64Array(N / 2);
  const spec = { fs, N, binHz: fs / N, power: new Float64Array(N / 2), average: new Float64Array(N / 2), noise: new Float64Array(N / 2), square: squared ? new Float64Array(N) : null };
  const analyse = () =>
  {
    for (let i = 0; i < N; i++)
    {
      re[i] = buf[i] * win[i];
      im[i] = 0;
    }
    satFft(re, im, false);
    for (let k = 0; k < N / 2; k++)
    {
      const p = re[k] * re[k] + im[k] * im[k];
      spec.power[k] = p;
      spec.average[k] = blocks ? spec.average[k] + (p - spec.average[k]) * 0.3 : p;
      // The noise floor: the average's lowest lately (let rise 3% a block, so a signal that stays is in it after a minute or so)
      low[k] = blocks ? Math.min(low[k] * 1.03, spec.average[k]) : p;
    }
    // ... smoothed over 17 bins, and doubled (the lowest of an average sits about half below its mean)
    let run = 0;
    for (let k = 0; k < 17; k++) run += low[k];
    for (let k = 0; k < N / 2; k++)
    {
      const add = k + 8 < N / 2 ? low[k + 8] : 0;
      const drop = k - 9 >= 0 ? low[k - 9] : 0;
      if (k > 8) run += add - drop;
      spec.noise[k] = (2 * run) / 17;
    }
    blocks++;
    if (!squared) return;
    // The analytic signal (negative frequencies dropped, positive doubled), squared, and its spectrum
    for (let k = 1; k < N / 2; k++)
    {
      re[k] *= 2;
      im[k] *= 2;
    }
    for (let k = N / 2 + 1; k < N; k++)
    {
      re[k] = 0;
      im[k] = 0;
    }
    satFft(re, im, true);
    for (let i = 0; i < N; i++)
    {
      const a = re[i], b = im[i];
      re[i] = a * a - b * b;
      im[i] = 2 * a * b;
    }
    satFft(re, im, false);
    for (let k = 0; k < N; k++) spec.square[k] += (re[k] * re[k] + im[k] * im[k] - spec.square[k]) * 0.3;
  };
  return {
    add(y, ready)
    {
      for (let j = 0; j < y.length; j++)
      {
        buf[fill++] = y[j];
        if (fill == N)
        {
          fill = 0;
          analyse();
          ready(spec);
        }
      }
    }
  };
}

// An FFT in place (radix 2; the inverse unscaled)
const satFftTables = new Map();

function satFft(re, im, inverse)
{
  const n = re.length;
  let t = satFftTables.get(n);
  if (!t)
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
    t = { rev, cos, sin };
    satFftTables.set(n, t);
  }
  for (let i = 0; i < n; i++)
  {
    const j = t.rev[i];
    if (j > i)
    {
      let v = re[i];
      re[i] = re[j];
      re[j] = v;
      v = im[i];
      im[i] = im[j];
      im[j] = v;
    }
  }
  const sign = inverse ? 1 : -1;
  for (let size = 2; size <= n; size <<= 1)
  {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size)
    {
      for (let k = 0; k < half; k++)
      {
        const wr = t.cos[k * step], wi = sign * t.sin[k * step];
        const a = start + k, b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

// ---- A bit clock for the FSK kinds: a phase from -0.5 to 0.5 a bit, a bit read where it wraps (its middle, the level's strongest after
// a bit long matched filter). A change of sign (a transition, due at phase 0) is placed between the two samples either side of it; at a
// low SNR noise makes several of one, so their average over the bit moves the phase, once a bit, a little of the way to 0 (one nudge
// for each crossing made it wander off by whole bits). The level is handed on (its size for the SNR)
function satClock(baud, rate, onBit)
{
  const step = baud / rate;
  let phase = 0;
  let last = 0;
  let cross = 0;
  let crosses = 0;
  return (level) =>
  {
    phase += step;
    if ((level > 0) != (last > 0))
    {
      // Where between this sample and the last it crossed
      const at = phase - (step * level) / (level - last);
      cross += at > 0.5 ? at - 1 : at < -0.5 ? at + 1 : at;
      crosses++;
    }
    const before = last;
    last = level;
    if (phase >= 0.5)
    {
      // The level where the phase was 0.5, between this sample and the last (few samples a bit at 9600 baud)
      const back = Math.min(1, (phase - 0.5) / step);
      phase -= 1;
      onBit(level - (level - before) * back);
      if (crosses)
      {
        phase -= (0.15 * cross) / crosses;
        cross = 0;
        crosses = 0;
      }
    }
  };
}

// A frame's SNR from its bits' levels (the eye): their mean size squared over its spread (dB)
function satEyeSnr(sum, sumSquares, count)
{
  if (count < 8) return NaN;
  const mean = sum / count;
  const spread = Math.max(sumSquares / count - mean * mean, 1e-12);
  return 10 * Math.log10((mean * mean) / spread);
}

// ---- Bit helpers
function satParity(x)
{
  x ^= x >>> 16;
  x ^= x >>> 8;
  x ^= x >>> 4;
  x ^= x >>> 2;
  x ^= x >>> 1;
  return x & 1;
}

function satPopcount(x)
{
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

// The CCSDS pseudo-random sequence (x^8 + x^7 + x^5 + x^3 + 1, all 1s at the start: FF 48 0E C0 ...), as bytes; AO-40 FEC's scrambler
// and AX100's
const SAT_CCSDS_PN = satCcsdsPn(320);

function satCcsdsPn(n)
{
  const bits = new Uint8Array(n * 8 + 8);
  for (let i = 0; i < 8; i++) bits[i] = 1;
  for (let i = 0; i < n * 8; i++) bits[i + 8] = bits[i + 7] ^ bits[i + 5] ^ bits[i + 3] ^ bits[i];
  const out = new Uint8Array(n);
  for (let i = 0; i < n * 8; i++) out[i >> 3] |= bits[i] << (7 - (i & 7));
  return out;
}

// ---- Reed-Solomon (255,223) as CCSDS's, in the conventional basis (as Phil Karn's libfec decode_rs_8): GF(256) on x^8 + x^7 + x^2 + x
// + 1, the generator's roots alpha^(11 j), j from 112 to 143. AO-40's (160,128) is it shortened (95 zeros in front), AX100's by its
// frame's length
const SAT_RS = satRsInit();

function satRsInit()
{
  const alpha = new Uint8Array(256);
  const index = new Uint8Array(256);
  let sr = 1;
  for (let i = 0; i < 255; i++)
  {
    alpha[i] = sr;
    index[sr] = i;
    sr <<= 1;
    if (sr & 256) sr ^= 0x187;
  }
  // 255 stands for zero in index form
  alpha[255] = 0;
  index[0] = 255;
  return { alpha, index };
}

// The codeword (its 255 - pad bytes: data then the 32 parity) put right in place. The number of bytes put right, or -1 if it can't be
// (more than 16 wrong, or an error found in the padding, which can't be one of this code's)
function satRsDecode(data, pad)
{
  const { alpha, index } = SAT_RS;
  const NR = 32;
  const A0 = 255;
  const FCR = 112;
  const PRIM = 11;
  const IPRIM = 116;
  const len = 255 - pad;
  const s = new Int32Array(NR);
  for (let i = 0; i < NR; i++) s[i] = data[0];
  for (let j = 1; j < len; j++)
  {
    const d = data[j];
    for (let i = 0; i < NR; i++) s[i] = s[i] == 0 ? d : d ^ alpha[(index[s[i]] + (FCR + i) * PRIM) % 255];
  }
  let any = 0;
  for (let i = 0; i < NR; i++)
  {
    any |= s[i];
    s[i] = index[s[i]];
  }
  if (!any) return 0;
  // Berlekamp-Massey: the error locator
  const lambda = new Int32Array(NR + 1);
  lambda[0] = 1;
  const b = new Int32Array(NR + 1);
  const t = new Int32Array(NR + 1);
  for (let i = 0; i <= NR; i++) b[i] = index[lambda[i]];
  let el = 0;
  for (let r = 1; r <= NR; r++)
  {
    let discr = 0;
    for (let i = 0; i < r; i++) if (lambda[i] != 0 && s[r - i - 1] != A0) discr ^= alpha[(index[lambda[i]] + s[r - i - 1]) % 255];
    discr = index[discr];
    if (discr == A0)
    {
      b.copyWithin(1, 0, NR);
      b[0] = A0;
      continue;
    }
    t[0] = lambda[0];
    for (let i = 0; i < NR; i++) t[i + 1] = b[i] != A0 ? lambda[i + 1] ^ alpha[(discr + b[i]) % 255] : lambda[i + 1];
    if (2 * el <= r - 1)
    {
      el = r - el;
      for (let i = 0; i <= NR; i++) b[i] = lambda[i] == 0 ? A0 : (index[lambda[i]] - discr + 255) % 255;
    }
    else
    {
      b.copyWithin(1, 0, NR);
      b[0] = A0;
    }
    lambda.set(t);
  }
  let deg = 0;
  for (let i = 0; i <= NR; i++)
  {
    lambda[i] = index[lambda[i]];
    if (lambda[i] != A0) deg = i;
  }
  // Chien search: the locator's roots, the errors' places
  const reg = Int32Array.from(lambda);
  const root = [];
  const loc = [];
  for (let i = 1, k = IPRIM - 1; i <= 255; i++, k = (k + IPRIM) % 255)
  {
    let q = 1;
    for (let j = deg; j > 0; j--)
    {
      if (reg[j] != A0)
      {
        reg[j] = (reg[j] + j) % 255;
        q ^= alpha[reg[j]];
      }
    }
    if (q != 0) continue;
    root.push(i);
    loc.push(k);
    if (root.length == deg) break;
  }
  if (root.length != deg) return -1;
  for (const l of loc) if (l < pad) return -1;
  // Forney: each error's value
  const omega = new Int32Array(NR + 1);
  for (let i = 0; i < deg; i++)
  {
    let tmp = 0;
    for (let j = i; j >= 0; j--) if (s[i - j] != A0 && lambda[j] != A0) tmp ^= alpha[(s[i - j] + lambda[j]) % 255];
    omega[i] = index[tmp];
  }
  for (let j = deg - 1; j >= 0; j--)
  {
    let num1 = 0;
    for (let i = deg - 1; i >= 0; i--) if (omega[i] != A0) num1 ^= alpha[(omega[i] + i * root[j]) % 255];
    const num2 = alpha[(root[j] * (FCR - 1) + 255) % 255];
    let den = 0;
    for (let i = Math.min(deg, NR - 1) & ~1; i >= 0; i -= 2) if (lambda[i + 1] != A0) den ^= alpha[(lambda[i + 1] + i * root[j]) % 255];
    if (den == 0) return -1;
    if (num1 != 0) data[loc[j] - pad] ^= alpha[(index[num1] + index[num2] + 255 - index[den]) % 255];
  }
  return deg;
}

// ==== FUNcube: 1200 bps DBPSK, AO-40 FEC
const SAT_FC_BAUD = 1200;
// The sync vector (x^7 + x^3 + 1, all 1s at the start), its 65 bits one every 80 symbols (the interleaver's first row)
const SAT_FC_SYNC = "11111110000111011110010110010010000001000100110001011101011011000";
const SAT_FC_SYMBOLS = 5200;
const SAT_FC_CODED = 5132;
// Where the carrier may be (Hz): BPSK 1200 is 1.6 kHz wide, so lower and SSB's filter has cut half of it
const SAT_FC_LOW = 700;
const SAT_FC_HIGH = 3000;
// The sync vector's soft correlation (-1 to 1) a frame is tried at: noise's is about 0.15 (one sigma), a frame's 0.85 or more even
// where the FEC gives out
const SAT_FC_SYNC_MIN = 0.6;
// A carrier with no frame for this long (s) gives way to another; frames coming hold it
const SAT_FC_HOLD = 12;
// Locked: the symbol to symbol turns this steady (0 to 1, averaged over about 1300 symbols): noise's about 0.1, an AFSK signal's up to
// 0.28, FUNcube's 0.32 at the FEC's limit (an SNR of -2 dB in 2500 Hz), 0.46 at 0 dB, 0.9 at 10 dB
const SAT_FC_LOCK = 0.3;
const SAT_FC_SATS = ["FUNcube-1 EM", "FUNcube-2 (UKube-1)", "FUNcube-1 (AO-73)", "FUNcube"];
const SAT_FC_TYPES = ["WO1", "WO2", "WO3", "WO4", "WO5", "WO6", "WO7", "WO8", "WO9", "WO10", "WO11", "WO12", "HR1", "FM1", "FM2", "FM3", "HR2", "FM4", "FM5", "FM6", "HR3", "FM7", "FM8", "FM9"];
const SAT_FC_TYPES_EXT = ["WO1", "WO2", "WO3", "WO4", "WO5", "WO6", "WO7", "WO8", "WO9", "WO10", "WO11", "WO12", "HR1", "HR2", "HR3", "HR4", "HR5", "FM1", "FM2", "FM3", "FM4", "FM5", "FM6", "FM7"];

function satFuncube(fs)
{
  const sps = fs / SAT_FC_BAUD;
  const taps = satRrc(sps, 0.35, 8);
  const L = taps.length;
  // The mixed down audio, kept twice over so the filter reads it in one run
  const ri = new Float32Array(2 * L);
  const rq = new Float32Array(2 * L);
  let at = 0;
  let f0 = 0;
  let step = 0;
  let phase = 0;
  // The filtered samples, the last 64, for the symbols read between them
  const hi = new Float32Array(64);
  const hq = new Float32Array(64);
  let n = 0;
  let tNext = sps;
  let lastI = 0, lastQ = 0;
  let power = 1e-9;
  // The symbols: soft (+ a 1, or all the other way: the sync vector says which) and size (for the SNR), the last 8192
  const RM = 8191;
  const soft = new Float32Array(RM + 1);
  const size = new Float32Array(RM + 1);
  let k = 0;
  let best = null;
  let quietTill = 0;
  // The carrier's drift: each symbol against the one before, squared (BPSK's data gone), summed over 64
  let ar = 0, ai = 0, aa = 0, ac = 0;
  let lock = 0;
  let samples = 0;
  let tunedAt = -1e9;
  let frameAt = -1e9;
  let banned = [];
  const sync = Float32Array.from(SAT_FC_SYNC, (c) => (c == "1" ? 1 : -1));

  const interp = (h, t) =>
  {
    const i = Math.floor(t);
    const fr = t - i;
    return h[i & 63] * (1 - fr) + h[(i + 1) & 63] * fr;
  };

  const tune = (hz, now) =>
  {
    f0 = hz;
    step = (2 * Math.PI * f0) / fs;
    tunedAt = now;
    lock = 0;
    best = null;
    ar = ai = aa = ac = 0;
  };

  const decode = (found) =>
  {
    const start = found.at - 64 * 80;
    const sign = found.rho > 0 ? 1 : -1;
    const frame = new Float32Array(SAT_FC_SYMBOLS);
    let m2 = 0, m4 = 0;
    for (let t = 0; t < SAT_FC_SYMBOLS; t++)
    {
      frame[t] = sign * soft[(start + t) & RM];
      const p = size[(start + t) & RM];
      m2 += p;
      m4 += p * p;
    }
    const out = satAo40(frame);
    if (!out) return;
    // The sync vector shifted (by its 80 symbol steps) correlates too: the rest of this frame left alone
    quietTill = found.at + 4000;
    frameAt = samples / fs;
    // SNR (Es/N0) from the symbols' sizes (M2M4)
    m2 /= SAT_FC_SYMBOLS;
    m4 /= SAT_FC_SYMBOLS;
    const S = Math.sqrt(Math.max(2 * m2 * m2 - m4, 0));
    const snr = 10 * Math.log10(Math.max(S, 1e-9) / Math.max(m2 - S, 1e-9));
    satFrameOut("funcube", SAT_FC_BAUD, out.bytes, `Viterbi ${out.fixed} of ${SAT_FC_CODED} symbols, RS ${out.corrected} bytes corrected`, f0, snr, satFuncubeSummary(out.bytes));
  };

  const symbol = () =>
  {
    const yi = interp(hi, tNext), yq = interp(hq, tNext);
    const mi = interp(hi, tNext - sps / 2), mq = interp(hq, tNext - sps / 2);
    // Gardner: the sample between two symbols leans toward the later one when the clock is late
    const e = ((yi - lastI) * mi + (yq - lastQ) * mq) / power;
    tNext += sps - Math.max(-sps / 8, Math.min(sps / 8, 0.006 * sps * e));
    const dr = yi * lastI + yq * lastQ;
    const di = yq * lastI - yi * lastQ;
    const p = yi * yi + yq * yq;
    power += (p - power) * 0.01;
    lastI = yi;
    lastQ = yq;
    soft[k & RM] = Math.max(-4, Math.min(4, dr / power));
    size[k & RM] = p / power;
    // The drift: the turn from one symbol to the next (half the squared product's angle)
    ar += dr * dr - di * di;
    ai += 2 * dr * di;
    aa += dr * dr + di * di;
    if (++ac == 64)
    {
      const turn = 0.5 * Math.atan2(ai, ar);
      lock += (Math.hypot(ar, ai) / (aa + 1e-30) - lock) * 0.05;
      f0 = Math.max(SAT_FC_LOW - 100, Math.min(SAT_FC_HIGH + 100, f0 + (0.15 * turn * SAT_FC_BAUD) / (2 * Math.PI)));
      step = (2 * Math.PI * f0) / fs;
      ar = ai = aa = ac = 0;
    }
    const last = k++;
    if (last < 64 * 80) return;
    // The sync vector: the newest symbol its last bit?
    const base = last - 64 * 80;
    let c = 0, a = 0;
    for (let j = 0; j < 65; j++)
    {
      const s = soft[(base + 80 * j) & RM];
      c += s * sync[j];
      a += Math.abs(s);
    }
    const rho = c / (a + 1e-12);
    if (last >= quietTill && Math.abs(rho) >= SAT_FC_SYNC_MIN && (!best || Math.abs(rho) > Math.abs(best.rho))) best = { at: last, rho };
    // The best within 80 symbols: its frame's last symbol (80 after the sync vector's last) in, decoded
    if (best && last == best.at + 79)
    {
      decode(best);
      best = null;
    }
  };

  return {
    kind: "funcube",
    runLow(y)
    {
      samples += y.length;
      if (!f0) return;
      for (let j = 0; j < y.length; j++)
      {
        phase += step;
        if (phase > 2 * Math.PI) phase -= 2 * Math.PI;
        const v = y[j];
        ri[at] = ri[at + L] = v * Math.cos(phase);
        rq[at] = rq[at + L] = -v * Math.sin(phase);
        at = at + 1 == L ? 0 : at + 1;
        let fi = 0, fq = 0;
        for (let t = 0; t < L; t++)
        {
          fi += taps[t] * ri[at + t];
          fq += taps[t] * rq[at + t];
        }
        hi[n & 63] = fi;
        hq[n & 63] = fq;
        n++;
        while (tNext <= n - 1) symbol();
      }
    },
    spectrum(spec)
    {
      const now = samples / fs;
      banned = banned.filter((b) => b.until > now);
      // Frames coming, or a carrier still being given its chance: kept, its own tracking follows it
      if (now - frameAt < SAT_FC_HOLD) return;
      if (f0 && lock > SAT_FC_LOCK && now - tunedAt < SAT_FC_HOLD) return;
      // A carrier held this long with no frame gives way to another for a while, if there is one
      const stale = f0 && now - tunedAt >= SAT_FC_HOLD;
      if (stale) banned.push({ hz: f0, until: now + 30 });
      let hz = satFuncubeFind(spec, banned);
      if (!hz && stale) hz = satFuncubeFind(spec, []);
      if (hz && (!f0 || stale || Math.abs(hz - f0) > 25)) tune(hz, now);
    },
    status()
    {
      return { locked: f0 > 0 && (lock > SAT_FC_LOCK || samples / fs - frameAt < SAT_FC_HOLD), audioHz: f0 > 0 ? Math.round(f0) : null };
    }
  };
}

// A BPSK carrier in the spectrum: the squared signal's strongest line (at twice the carrier, SAT_FC_LOW to SAT_FC_HIGH) well above
// that range's mean, not one of those passed over, and not a plain tone (a carrier's power spread around it, not in a line). Hz, or 0
function satFuncubeFind(spec, banned)
{
  const sq = spec.square;
  const bin = spec.binHz;
  const k0 = Math.ceil((2 * SAT_FC_LOW) / bin);
  const k1 = Math.min(spec.N - 2, Math.floor((2 * SAT_FC_HIGH) / bin));
  let mean = 0;
  for (let k = k0; k <= k1; k++) mean += sq[k];
  mean /= k1 - k0 + 1;
  const skip = [];
  for (let tries = 0; tries < 3; tries++)
  {
    let bestK = -1;
    for (let k = k0; k <= k1; k++)
    {
      if (bestK >= 0 && sq[k] <= sq[bestK]) continue;
      const hz = (k * bin) / 2;
      if (banned.some((b) => Math.abs(b.hz - hz) < 50) || skip.some((s) => Math.abs(s - hz) < 50)) continue;
      bestK = k;
    }
    if (bestK < 0 || sq[bestK] < mean * 12) return 0;
    // Between bins (a parabola through the peak and its neighbours)
    const a = sq[bestK - 1], b = sq[bestK], c = sq[bestK + 1];
    const d = a - 2 * b + c;
    const hz = ((bestK + (d < 0 ? (0.5 * (a - c)) / d : 0)) * bin) / 2;
    const at = Math.round(hz / bin);
    let narrow = 0, wide = 0, peak = 0, count = 0;
    for (let k = Math.max(0, at - Math.round(600 / bin)); k <= Math.min(spec.N / 2 - 1, at + Math.round(600 / bin)); k++)
    {
      wide += spec.average[k];
      count++;
      peak = Math.max(peak, spec.average[k]);
      if (Math.abs(k - at) * bin <= 10) narrow += spec.average[k];
    }
    // Two strong carriers make a line in the square too, halfway between them: a line 20 dB over the rest there isn't BPSK's hump
    if (narrow < 0.3 * wide && peak < (100 * wide) / count) return hz;
    skip.push(hz);
  }
  return 0;
}

// Root raised cosine taps: sps samples a symbol, roll off alpha, span symbols long, sum 1
function satRrc(sps, alpha, span)
{
  const L = 2 * Math.round((span * sps) / 2) + 1;
  const taps = new Float32Array(L);
  let total = 0;
  for (let i = 0; i < L; i++)
  {
    const t = (i - (L - 1) / 2) / sps;
    let h;
    if (Math.abs(t) < 1e-9) h = 1 - alpha + (4 * alpha) / Math.PI;
    else if (Math.abs(Math.abs(t) - 1 / (4 * alpha)) < 1e-9)
    {
      h = (alpha / Math.SQRT2) * ((1 + 2 / Math.PI) * Math.sin(Math.PI / (4 * alpha)) + (1 - 2 / Math.PI) * Math.cos(Math.PI / (4 * alpha)));
    }
    else h = (Math.sin(Math.PI * t * (1 - alpha)) + 4 * alpha * t * Math.cos(Math.PI * t * (1 + alpha))) / (Math.PI * t * (1 - (4 * alpha * t) ** 2));
    taps[i] = h;
    total += h;
  }
  for (let i = 0; i < L; i++) taps[i] /= total;
  return taps;
}

// ---- AO-40 FEC: a frame's 5200 soft symbols (+ a 1) to its 256 bytes, or null. The interleaver: 80 rows of 65, written a row at a time
// from the second (the first is the sync vector), sent a column at a time; the coded symbols (5132: 320 bytes and 6 tail bits, at
// r = 1/2) Viterbi decoded, CCSDS descrambled, the bytes dealt alternately to two RS (160,128) codewords, data then parity
const SAT_VIT_POLY_A = 0x4f;
const SAT_VIT_POLY_B = 0x6d;
// Each 7 bit encoder state's two symbols (the second sent inverted), as 2 bits
const SAT_VIT_OUT = Uint8Array.from({ length: 128 }, (_, sr) => (satParity(sr & SAT_VIT_POLY_A) << 1) | (1 ^ satParity(sr & SAT_VIT_POLY_B)));
let satVitDecisions = null;

function satAo40(frame)
{
  const sym = new Float32Array(SAT_FC_CODED);
  for (let i = 0; i < SAT_FC_CODED; i++) sym[i] = frame[(i % 65) * 80 + 1 + Math.floor(i / 65)];
  const nbits = SAT_FC_CODED / 2;
  const bits = satViterbi(sym, nbits);
  // The symbols the decoded bits would have been, against those heard: how many the code put right
  let fixed = 0;
  let sr = 0;
  for (let i = 0; i < nbits; i++)
  {
    sr = ((sr << 1) | bits[i]) & 127;
    const o = SAT_VIT_OUT[sr];
    if (o >> 1 != (sym[2 * i] > 0 ? 1 : 0)) fixed++;
    if ((o & 1) != (sym[2 * i + 1] > 0 ? 1 : 0)) fixed++;
  }
  const raw = new Uint8Array(320);
  for (let i = 0; i < 2560; i++) raw[i >> 3] |= bits[i] << (7 - (i & 7));
  for (let i = 0; i < 320; i++) raw[i] ^= SAT_CCSDS_PN[i];
  const cw = [new Uint8Array(160), new Uint8Array(160)];
  for (let j = 0; j < 320; j++)
  {
    if (j < 256) cw[j & 1][j >> 1] = raw[j];
    else cw[(j - 256) & 1][128 + ((j - 256) >> 1)] = raw[j];
  }
  const a = satRsDecode(cw[0], 95);
  if (a < 0) return null;
  const b = satRsDecode(cw[1], 95);
  if (b < 0) return null;
  const bytes = new Uint8Array(256);
  for (let j = 0; j < 256; j++) bytes[j] = cw[j & 1][j >> 1];
  return { bytes, corrected: a + b, fixed };
}

// Viterbi (k = 7, r = 1/2: 0x4F and 0x6D, the second inverted; the newest bit lowest), soft symbols (+ a 1), ending in state 0 (the
// tail's zeros). The bits
function satViterbi(sym, nbits)
{
  if (!satVitDecisions || satVitDecisions.length < nbits * 64) satVitDecisions = new Uint8Array(nbits * 64);
  const dec = satVitDecisions;
  let pm = new Float64Array(64).fill(-1e30);
  let nm = new Float64Array(64);
  pm[0] = 0;
  const bm = new Float64Array(4);
  for (let i = 0; i < nbits; i++)
  {
    const s0 = sym[2 * i], s1 = sym[2 * i + 1];
    bm[0] = -s0 - s1;
    bm[1] = -s0 + s1;
    bm[2] = s0 - s1;
    bm[3] = s0 + s1;
    const row = i * 64;
    // Each state reached from two: its own bits shifted down, the oldest 0 or 1
    for (let ns = 0; ns < 64; ns++)
    {
      const p0 = ns >> 1;
      const m0 = pm[p0] + bm[SAT_VIT_OUT[ns]];
      const m1 = pm[p0 | 32] + bm[SAT_VIT_OUT[ns | 64]];
      if (m1 > m0)
      {
        nm[ns] = m1;
        dec[row + ns] = 1;
      }
      else
      {
        nm[ns] = m0;
        dec[row + ns] = 0;
      }
    }
    const t = pm;
    pm = nm;
    nm = t;
  }
  const bits = new Uint8Array(nbits);
  let s = 0;
  for (let i = nbits - 1; i >= 0; i--)
  {
    bits[i] = s & 1;
    s = dec[i * 64 + s] ? (s >> 1) | 32 : s >> 1;
  }
  return bits;
}

// What a FUNcube frame says, briefly: the satellite and frame type, and from the real time data (as gr-satellites reads it) the battery
// voltage, photocurrent and sequence number where the satellite's layout is known
function satFuncubeSummary(b)
{
  const bits = (off, len) =>
  {
    let v = 0;
    for (let i = 0; i < len; i++) v = v * 2 + ((b[(off + i) >> 3] >> (7 - ((off + i) & 7))) & 1);
    return v;
  };
  const id = b[0] >> 6;
  const type = b[0] & 63;
  let name = SAT_FC_SATS[id];
  let types = SAT_FC_TYPES;
  if (id == 3)
  {
    types = SAT_FC_TYPES_EXT;
    name = b[1] == 8 ? "Nayif-1 (EO-88)" : "FUNcube extended id " + b[1];
  }
  const parts = [name + " " + (types[type] || "type " + type)];
  if (id == 0 || id == 2) parts.push(`battery ${bits(72, 16)} mV`, `photocurrent ${bits(56, 16)} mA`, `seq ${bits(400, 24)}`);
  else if (id == 3 && b[1] == 8) parts.push(`battery ${bits(58, 14)} mV`, `photocurrent ${bits(102, 10)} mA`, `seq ${bits(400, 24)}`);
  else if (id == 1) parts.push(`seq ${bits(412, 24)}`);
  return parts.join(", ");
}

// ==== AX100: FSK from flat FM audio, ASM sync word
const SAT_AX100_ASM = 0x930b51de;
// The sync word's bits allowed wrong
const SAT_AX100_SYNC_ERRORS = 4;
// Frames being read at once (a sync word in noise starts one too)
const SAT_MAX_CAPTURES = 8;
// Golay (24,12), as gr-satellites' (its parity check matrix's rows)
const SAT_GOLAY_H = [0x8008ed, 0x4001db, 0x2003b5, 0x100769, 0x80ed1, 0x40da3, 0x20b47, 0x1068f, 0x8d1d, 0x4a3b, 0x2477, 0x1ffe];

function satAx100(rate, baud)
{
  // The audio summed over a bit (its matched filter), its middle (a slow average) taken off, sliced, as Packet's G3RUH
  const n = Math.max(1, Math.round(rate / baud));
  const buf = new Float32Array(n);
  let at = 0;
  let sum = 0;
  let middle = 0;
  const slow = 1 / (rate * 0.05);
  let turns = 0;
  let raw = 0;
  let plain = 0;
  let shift = 0;
  let seen = 0;
  let caps = [];

  const done = (cap, bytes, fec) =>
  {
    cap.done = true;
    const show = `${bytes.length} bytes (mode ${cap.mode}): ${satHex(bytes.subarray(0, 8), " ")}${bytes.length > 8 ? " ..." : ""}`;
    satFrameOut("ax100", baud, bytes, fec, null, satEyeSnr(cap.e1, cap.e2, cap.ne), show);
  };

  // A byte in: mode 5 (the Golay coded length, then that many bytes, CCSDS scrambled, RS parity included) or mode 6 (a length byte
  // counting itself and the RS codeword after it)
  const byte = (cap) =>
  {
    const d = cap.bytes;
    if (cap.mode == 5)
    {
      if (cap.got == 3)
      {
        const g = satGolayDecode((d[0] << 16) | (d[1] << 8) | d[2]);
        const len = g ? g.data & 0xff : 0;
        if (len < 33)
        {
          cap.done = true;
          return;
        }
        cap.golay = g.errors;
        cap.need = 3 + len;
      }
      if (cap.got < cap.need) return;
      const len = cap.need - 3;
      // CCSDS scrambled, as gr-satellites takes it; plain tried too
      for (const scrambled of [true, false])
      {
        const cw = d.slice(3, cap.need);
        if (scrambled) for (let i = 0; i < len; i++) cw[i] ^= SAT_CCSDS_PN[i];
            const fixed = satRsDecode(cw, 255 - len);
        if (fixed >= 0)
        {
          done(cap, cw.slice(0, len - 32), `Golay ${cap.golay} bits, RS ${fixed} bytes corrected${scrambled ? "" : ", not scrambled"}`);
          return;
        }
      }
      cap.done = true;
      return;
    }
    if (cap.got == 1)
    {
      if (d[0] < 34)
      {
        cap.done = true;
        return;
      }
      cap.need = d[0];
    }
    if (cap.got < cap.need) return;
    const cw = d.slice(1, cap.need);
    const fixed = satRsDecode(cw, 255 - cw.length);
    if (fixed >= 0) done(cap, satAx100Data(cw, d.subarray(1, cap.need)), `RS ${fixed} bytes corrected`);
    else cap.done = true;
  };

  const feed = (cap, bit, level) =>
  {
    cap.cur = (cap.cur << 1) | (bit ^ cap.inv);
    cap.e1 += Math.abs(level);
    cap.e2 += level * level;
    cap.ne++;
    if (++cap.nb < 8) return;
    cap.bytes[cap.got++] = cap.cur & 255;
    cap.cur = 0;
    cap.nb = 0;
    byte(cap);
  };

  const start = (mode, inv) =>
  {
    if (caps.length < SAT_MAX_CAPTURES) caps.push({ mode, inv, bytes: new Uint8Array(258), got: 0, need: mode == 5 ? 3 : 1, cur: 0, nb: 0, e1: 0, e2: 0, ne: 0, golay: 0, done: false });
  };

  const clock = satClock(baud, rate, (level) =>
  {
    const bit = level > 0 ? 1 : 0;
    // G3RUH descrambled (x^17 + x^12 + 1) for mode 6
    const g = bit ^ ((shift >>> 11) & 1) ^ ((shift >>> 16) & 1);
    shift = ((shift << 1) | bit) & 0x1ffff;
    if (caps.length)
    {
      for (const cap of caps) feed(cap, cap.mode == 5 ? bit : g, level);
      caps = caps.filter((c) => !c.done);
    }
    raw = ((raw << 1) | bit) >>> 0;
    plain = ((plain << 1) | g) >>> 0;
    if (++seen < 32) return;
    // The sync word, or it the other way up (FSK's tones either way round)
    const e5 = satPopcount((raw ^ SAT_AX100_ASM) >>> 0);
    if (e5 <= SAT_AX100_SYNC_ERRORS) start(5, 0);
    else if (32 - e5 <= SAT_AX100_SYNC_ERRORS) start(5, 1);
    const e6 = satPopcount((plain ^ SAT_AX100_ASM) >>> 0);
    if (e6 <= SAT_AX100_SYNC_ERRORS) start(6, 0);
    else if (32 - e6 <= SAT_AX100_SYNC_ERRORS) start(6, 1);
  });

  return {
    kind: "ax100",
    run(x)
    {
      for (let j = 0; j < x.length; j++)
      {
        sum += x[j] - buf[at];
        buf[at] = x[j];
        at = at + 1 >= n ? 0 : at + 1;
        const v = sum / n;
        middle += (v - middle) * slow;
        clock(v - middle);
      }
      // The running sum kept from drifting: summed again now and then
      if ((turns += x.length) >= 65536)
      {
        turns = 0;
        sum = buf.reduce((s, v) => s + v, 0);
      }
    }
  };
}

// Mode 6's data from its corrected codeword. Its length byte has no protection, and one read too long by k bytes still decodes: the
// true codeword shifted up k places is a codeword of the longer length too, so the k bytes after it get "corrected" to zeros and its
// first k parity bytes would pass as data. So trailing bytes heard as something but corrected to zeros are dropped (what's left is the
// true codeword: any codeword less a trailing zero is one), then the 32 parity
function satAx100Data(cw, heard)
{
  let len = cw.length;
  while (len > 33 && cw[len - 1] == 0 && heard[len - 1] != 0) len--;
  return cw.slice(0, len - 32);
}

// The 24 bits (the 12 parity, then the 12 data) put right (up to 3 wrong): { data, errors }, or null
function satGolayDecode(r)
{
  let s = 0;
  for (let i = 0; i < 12; i++) s = (s << 1) | satParity(SAT_GOLAY_H[i] & r);
  let e = -1;
  if (satPopcount(s) <= 3) e = s << 12;
  for (let i = 0; i < 12 && e < 0; i++)
  {
    const t = s ^ (SAT_GOLAY_H[i] & 0xfff);
    if (satPopcount(t) <= 2) e = (t << 12) | (1 << (11 - i));
  }
  if (e < 0)
  {
    let q = 0;
    for (let i = 0; i < 12; i++) q = (q << 1) | satParity(SAT_GOLAY_H[i] & 0xfff & s);
    if (satPopcount(q) <= 3) e = q;
    for (let i = 0; i < 12 && e < 0; i++)
    {
      const t = q ^ (SAT_GOLAY_H[i] & 0xfff);
      if (satPopcount(t) <= 2) e = (1 << (23 - i)) | t;
    }
  }
  if (e < 0) return null;
  return { data: (r ^ e) & 0xfff, errors: satPopcount(e) };
}

// ==== GENESIS: AMSAT-EA's FSK, two tones in SSB audio
const SAT_GENESIS_MODES = [
  { baud: 800, shift: 1600 },
  { baud: 200, shift: 1125 }
];
const SAT_GENESIS_SYNC = 0xbf35;
// The tones may be from 300 Hz to this (the upper one)
const SAT_GENESIS_HIGH = 3200;
// A tone pair: each tone's window this many times the noise floor's power there
const SAT_GENESIS_FIND = 2.5;
// The demodulator runs this far (s) behind the audio, so a burst's tones, found in the spectrum once it has begun, are set before
// its first bit is read
const SAT_GENESIS_DELAY = 1.5;
// Packet lengths by type (the type byte and the CRC counted). After the sync word a size byte, then the packet (HADES-SA, HADES-L,
// GENESIS-M: AMSAT-EA's decoders' tables); or the packet straight after it (HADES-D, HADES-R, HADES-ICM: gr-satellites' tables)
const SAT_GENESIS_SIZED = [
  [0, 31, 17, 41, 35, 27, 135, 45, 31, 123, 251, 37, 64, 249, 38, 73],
  [0, 31, 17, 41, 35, 27, 0, 23, 31, 123, 251, 37, 64, 249, 38, 101]
];
const SAT_GENESIS_BARE = [
  [0, 26, 13, 26, 54, 33, 135, 67, 28, 123, 0, 0, 64, 0, 0, 0],
  [0, 31, 17, 29, 35, 27, 135, 101, 31, 123, 17, 9, 64, 0, 38, 41]
];
const SAT_GENESIS_SSDV = 10;
const SAT_GENESIS_NAMES = { 2: "HADES-ICM", 3: "HADES-SA", 5: "HADES-L", 9: "GENESIS-M", 11: "MARIA-G", 12: "UNNE-1B", 13: "HADES-R" };
const SAT_GENESIS_TYPES = ["", "power", "temperatures", "status", "power ranges", "temperature ranges", "type 6", "payload", "antenna", "extended power", "SSDV", "Codec2 voice", "ephemeris", "PN9 test", "time series", "BBS"];

function satGenesis(fs, baud, shift)
{
  const n = Math.max(2, Math.round(fs / baud));
  const delay = Math.round(fs * SAT_GENESIS_DELAY);
  let ringN = 1;
  while (ringN < delay + 16384) ringN <<= 1;
  const ring = new Float32Array(ringN);
  const mask = ringN - 1;
  let wrote = 0;
  // The two tones: each mixed down and summed over a bit (its matched filter)
  const tones = [0, 1].map(() => ({ hz: 0, step: 0, phase: 0, bi: new Float64Array(n), bq: new Float64Array(n), si: 0, sq: 0 }));
  let at = 0;
  let turns = 0;
  let center = 0;
  let foundAt = -1e9;
  let samples = 0;
  let reg = 0;
  let seen = 0;
  let caps = [];
  // Where the tones were found, when (each block's middle, s), smoothed: the demodulator, behind, takes them for its own time
  let track = 0;
  let far = 0;
  let history = [];

  const setTones = (hz) =>
  {
    if (Math.abs(hz - center) < 0.5) return;
    center = hz;
    tones[0].hz = hz - shift / 2;
    tones[1].hz = hz + shift / 2;
    for (const t of tones) t.step = (2 * Math.PI * t.hz) / fs;
  };

  // A packet's bytes as sent (the size byte left off): its CRC (over the bytes as sent) right, or for SSDV its own CRC, and it goes out
  // descrambled, its CRC as sent (as AMSAT-EA's decoders take it)
  const tryPacket = (cap, p, sized) =>
  {
    const type = p[0] >> 4;
    const L = p.length;
    if (sized && type == SAT_GENESIS_SSDV)
    {
      for (const plainSsdv of [true, false])
      {
        const q = p.slice();
        if (!plainSsdv) satGenesisDescramble(q, 1, L);
        const ssdv = ssdvGenesisPacket(q, cap.bytes[0]);
        if (!ssdv) continue;
        const show = `${satGenesisName(p[0])} SSDV, image ${q[1]}, packet ${(q[2] << 8) | q[3]}`;
        satFrameOut("genesis", baud, q, "SSDV CRC32 good", center, satEyeSnr(cap.e1, cap.e2, cap.ne), show, ssdv);
        return true;
      }
      return false;
    }
    // HADES-SA's Codec2 voice and PN9 test packets have no CRC: nothing to tell them from noise
    if (sized && (type == 11 || type == 13)) return false;
    const crc = satCrc16(p, L - 2);
    if (crc != ((p[L - 2] << 8) | p[L - 1])) return false;
    const q = p.slice();
    satGenesisDescramble(q, 1, L - 2);
    const show = `${satGenesisName(p[0])} ${SAT_GENESIS_TYPES[type]}, ${L} bytes: ${satHex(q.subarray(0, 8), " ")}${L > 8 ? " ..." : ""}`;
    satFrameOut("genesis", baud, q, "CRC16 good", center, satEyeSnr(cap.e1, cap.e2, cap.ne), show);
    return true;
  };

  // A byte in: each layout's packet tried at each length its type may have
  const byte = (cap) =>
  {
    const d = cap.bytes;
    const got = cap.got;
    if (got == 2)
    {
      let most = 0;
      for (const t of SAT_GENESIS_SIZED) most = Math.max(most, 1 + t[d[1] >> 4]);
      for (const t of SAT_GENESIS_BARE) most = Math.max(most, t[d[0] >> 4]);
      cap.most = most;
    }
    if (got >= 2)
    {
      const type = d[1] >> 4;
      if (SAT_GENESIS_SIZED.some((t) => t[type] > 2 && 1 + t[type] == got) && tryPacket(cap, d.subarray(1, got), true))
      {
        cap.done = true;
        return;
      }
      const bare = d[0] >> 4;
      if (SAT_GENESIS_BARE.some((t) => t[bare] > 2 && t[bare] == got) && tryPacket(cap, d.subarray(0, got), false))
      {
        cap.done = true;
        return;
      }
    }
    if (got >= cap.most) cap.done = true;
  };

  const clock = satClock(baud, fs, (level) =>
  {
    const bit = level > 0 ? 1 : 0;
    if (caps.length)
    {
      for (const cap of caps)
      {
        cap.cur = (cap.cur << 1) | (bit ^ cap.inv);
        cap.e1 += Math.abs(level);
        cap.e2 += level * level;
        cap.ne++;
        if (++cap.nb < 8) continue;
        cap.bytes[cap.got++] = cap.cur & 255;
        cap.cur = 0;
        cap.nb = 0;
        byte(cap);
      }
      caps = caps.filter((c) => !c.done);
    }
    reg = ((reg << 1) | bit) & 0xffff;
    if (++seen < 16 || caps.length >= SAT_MAX_CAPTURES) return;
    // The sync word exactly (a packet has no error correction: a bit wrong anywhere loses it anyway), either way up
    if (reg == SAT_GENESIS_SYNC || reg == (SAT_GENESIS_SYNC ^ 0xffff))
    {
      caps.push({ inv: reg == SAT_GENESIS_SYNC ? 0 : 1, bytes: new Uint8Array(256), got: 0, most: 256, cur: 0, nb: 0, e1: 0, e2: 0, ne: 0, done: false });
    }
  });

  const demod = (v) =>
  {
    const amp = [0, 0];
    for (let i = 0; i < 2; i++)
    {
      const t = tones[i];
      t.phase += t.step;
      if (t.phase > 2 * Math.PI) t.phase -= 2 * Math.PI;
      const ci = v * Math.cos(t.phase), cq = v * Math.sin(t.phase);
      t.si += ci - t.bi[at];
      t.sq += cq - t.bq[at];
      t.bi[at] = ci;
      t.bq[at] = cq;
      amp[i] = Math.sqrt(t.si * t.si + t.sq * t.sq);
    }
    at = at + 1 >= n ? 0 : at + 1;
    if (++turns >= 65536)
    {
      turns = 0;
      for (const t of tones)
      {
        t.si = t.bi.reduce((s, x) => s + x, 0);
        t.sq = t.bq.reduce((s, x) => s + x, 0);
      }
    }
    // The upper tone less the lower, over both (so no gain control is needed)
    clock((amp[1] - amp[0]) / (amp[1] + amp[0] + 1e-12));
  };

  return {
    kind: "genesis",
    runLow(y)
    {
      samples += y.length;
      // The tones for the audio about to be demodulated: between the two findings either side of its time, or the nearest
      if (history.length)
      {
        const t = (wrote - delay) / fs;
        history = history.filter((h, i) => i == history.length - 1 || history[i + 1].t > t - 2);
        let hz = history[history.length - 1].hz;
        for (let i = 0; i + 1 < history.length; i++)
        {
          const a = history[i], b = history[i + 1];
          if (t < a.t)
          {
            hz = a.hz;
            break;
          }
          if (t <= b.t)
          {
            hz = a.hz + ((b.hz - a.hz) * (t - a.t)) / (b.t - a.t);
            break;
          }
        }
        setTones(hz);
      }
      for (let j = 0; j < y.length; j++)
      {
        ring[wrote & mask] = y[j];
        wrote++;
        if (wrote > delay && center) demod(ring[(wrote - 1 - delay) & mask]);
      }
    },
    spectrum(spec)
    {
      const hz = satGenesisFind(spec, baud, shift);
      if (!hz) return;
      // Far from where they were: only once a second block agrees (one block's noise, or a burst's edge, mustn't move them)
      if (track && Math.abs(hz - track) >= baud / 2)
      {
        if (!far || Math.abs(hz - far) >= baud / 4)
        {
          far = hz;
          return;
        }
        track = hz;
        history = [];
      }
      else track = track ? track + (hz - track) * 0.5 : hz;
      far = 0;
      foundAt = samples / fs;
      history.push({ t: foundAt - (spec.N / spec.fs) / 2, hz: track });
    },
    status()
    {
      return { locked: center > 0 && samples / fs - foundAt < 2 + SAT_GENESIS_DELAY, audioHz: center > 0 ? Math.round(center) : null };
    }
  };
}

// The tone pair in one block's spectrum: two places shift apart, the weaker of the two (each summed over half the baud) well above the
// noise there (the spectrum's noise floor, so an SSB filter's slopes aren't taken for tones). Their middle (Hz, each tone at its
// power's centroid over a baud), or 0
function satGenesisFind(spec, baud, shift)
{
  const P = spec.power;
  const noise = spec.noise;
  const bin = spec.binHz;
  const w = Math.max(2, Math.round(baud / 4 / bin));
  const k0 = Math.ceil(300 / bin);
  const k1 = Math.min(P.length - 1, Math.floor(SAT_GENESIS_HIGH / bin));
  const cum = new Float64Array(P.length + 1);
  const cumNoise = new Float64Array(P.length + 1);
  for (let k = 0; k < P.length; k++)
  {
    cum[k + 1] = cum[k] + P[k];
    cumNoise[k + 1] = cumNoise[k] + noise[k];
  }
  // A window's power over the noise's there
  const around = (k) =>
  {
    const a = Math.max(0, k - w), b = Math.min(P.length, k + w + 1);
    return (cum[b] - cum[a]) / (cumNoise[b] - cumNoise[a] + 1e-30);
  };
  const apart = shift / bin;
  let best = 0, bestK = -1;
  for (let k = k0 + w; k + apart + w <= k1; k++)
  {
    const s = Math.min(around(k), around(Math.round(k + apart)));
    if (s > best)
    {
      best = s;
      bestK = k;
    }
  }
  if (bestK < 0 || best < SAT_GENESIS_FIND) return 0;
  const centroid = (c) =>
  {
    let m = 0, total = 0;
    for (let k = Math.max(0, c - 2 * w); k <= Math.min(P.length - 1, c + 2 * w); k++)
    {
      const p = Math.max(0, P[k] - noise[k]);
      m += p * k;
      total += p;
    }
    return total > 0 ? (m / total) * bin : c * bin;
  };
  const low = centroid(bestK);
  const high = centroid(Math.round(bestK + apart));
  return (low + high) / 2;
}

function satGenesisName(first)
{
  const a = first & 15;
  return SAT_GENESIS_NAMES[a] || "GENESIS id " + a;
}

// AMSAT-EA's descrambler: x^17 + x^12 + 1, self synchronising, on each byte's seven upper bits (its lowest is sent as it is and doesn't
// move the register), from byte `from` to before `to`
function satGenesisDescramble(p, from, to)
{
  let state = 1 << 16;
  for (let j = from; j < to; j++)
  {
    let out = 0;
    for (let k = 0; k < 7; k++)
    {
      const b = (p[j] >> (7 - k)) & 1;
      out = (out << 1) | (b ^ (((state >> 16) ^ (state >> 11)) & 1));
      state = ((state << 1) | b) & 0x1ffff;
    }
    p[j] = (out << 1) | (p[j] & 1);
  }
}

// CRC-16 (CCITT, from 0xFFFF, not reflected), as AMSAT-EA's crc16(), over the first length bytes
function satCrc16(p, length)
{
  let crc = 0xffff;
  for (let i = 0; i < length; i++)
  {
    let x = ((crc >> 8) ^ p[i]) & 0xff;
    x ^= x >> 4;
    crc = ((crc << 8) ^ (x << 12) ^ (x << 5) ^ x) & 0xffff;
  }
  return crc;
}

