// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Multi-Mode Decoder's Olivia mode: one Olivia or Contestia signal, its submode (tones / bandwidth) and its centre told by config
// (from an RSID heard, or a click on the waterfall). The centre may be out by a quarter of the bandwidth either way: it's searched for.
//   How the modes are sent (Pawel Jalocha's description of Olivia, SP9VRC; Contestia is Nick Fedoseev's, UT2UZ, cut-down version):
//   T tones B / T Hz apart, centred on the signal's centre, one every T / B seconds, each carrying log2(T) bits; the tone sent is the Gray
//   code of its bits (n ^ n >> 1), the lowest tone 0. A block is 64 tones (Contestia 32) and carries log2(T) characters, 7 bits each
//   (Contestia 6). Each character c is a Walsh function: for c under 64, sign j (0 to 63) is -1 when c AND NOT j has an odd number of
//   bits set (a row of the Hadamard matrix, upside down when c itself has an odd number of bits); for 64 and over, c - 64's upside down.
//   Character i's (0 first) Walsh function is then scrambled: its jth sign flipped when bit (13 i + j) mod 64 of E257E6D0291574EC is 1
//   (Contestia: bit (5 i + j) mod 32 of EDB88320), and its jth sign (a 1 for -1) goes in tone j's bit (i + j) mod log2(T), so a tone
//   lost costs each character in the block only a bit or two. Each tone is a shaped pulse two tones long, starting with a jump in phase,
//   so the tones overlap by half. Contestia's characters: 1 to 58 are ASCII 33 to 90 (capitals only), 59 a space, 60 a new line.
//   Here: the audio brought down to about 12 kHz (a low-pass filter, every Nth sample kept), then mixed down by the centre told and
//   brought down again, to a few times the bandwidth (complex, the centre at 0 Hz). Four times a tone, the energy at every half a tone
//   spacing across the band and the search either side, each over a window shaped as the pulse sent (a matched filter); for each place
//   the signal might be (half a spacing apart), each tone's bits as soft decisions from its T energies. For every such place and every
//   one of a block's 4 x 64 starting points, the last block of soft bits is unscrambled and run through a fast Hadamard transform per
//   character: the largest output is the character, and how far it stands above the rest (z, the largest against the root of the sum
//   of squares, about 2.5 for noise and 8 for a clean Olivia block) is how sure. Each place's z, averaged over the blocks, finds the
//   signal's frequency and its block timing together: the best one, once over the noise's, is locked to, and once a block its
//   characters go out (the best of the nine places a step around it, which follows drift). While locked only the places near the lock
//   are worked out, which saves most of the work. The blocks kept from before the lock are decoded too, so the first words aren't lost.
//   A character goes out only when its block and its own z say it's real, so noise prints nothing; and none from a signal half a
//   bandwidth away (olAliased), which can decode as other characters.
// In:  { type: "init", rate }, { type: "config", mode: "olivia" | "contestia", tones, bandwidth, center (audio Hz) },
//      { type: "audio", samples (Float32Array at rate, about 0.1 s) }, { type: "reset" }
// Out: { type: "text", text }: the characters decoded since the last (printable ASCII and "\n"), once a block while locked;
//      { type: "lock", center (audio Hz, as found), snr (dB in 2500 Hz) }: on locking, and when either moves notably

// Format: bits per character, the scrambling sequence (its high and low 32 bits) and its step from one character to the next
const OLIVIA_FORMATS = {
  olivia: { bits: 7, codeHigh: 0xe257e6d0, codeLow: 0x291574ec, shift: 13 },
  contestia: { bits: 6, codeHigh: 0, codeLow: 0xedb88320, shift: 5 }
};
// The audio's first step down: to about this rate, keeping up to this frequency
const OLIVIA_FIRST_RATE = 11000;
const OLIVIA_TOP_HZ = 4200;
// The second, mixed down: to at least this many times the bandwidth
const OLIVIA_RATE_PER_HZ = 2.5;
// Spectra per tone, and blocks of them kept (for what came before the lock)
const OLIVIA_SPS = 4;
const OLIVIA_BLOCKS_KEPT = 4;
// The pulse's shape (x from -pi to pi over two tones): 1 + a1 cos x + a2 cos 2x + a3 cos 3x + a4 cos 4x
const OLIVIA_SHAPE = [1, 1.1913785723, -0.0793018558, -0.2171442026, -0.0014526076];
// Soft bits: each tone's energy against the noise (the others' average), times this, as a log likelihood; kept within this
const OLIVIA_SOFT_GAIN = 1.75;
const OLIVIA_SOFT_CLIP = 8;
// Each place's z, averaged over blocks: each block's share
const OLIVIA_SHARE = 0.35;
// Once locked, places (half a spacing apart) either side of the lock's still looked at
const OLIVIA_TRACK = 2;
// By bits per character (Olivia 7, Contestia 6), set from noise alone (its best place's average z reached about 3.2 and 2.9 at most
// in six minutes, and one character's z in 10000 is over 4.45 and 4.0): locked when the best place's average z is over the first,
// let go under the second; a block's characters go out each when its own z is over the third (the block's average far enough
// over noise's, OLIVIA_SURE); a block from before the lock when its average is over the fourth
const OLIVIA_LOCK = { 7: 3.55, 6: 3.25 };
const OLIVIA_UNLOCK = { 7: 3.05, 6: 2.8 };
const OLIVIA_CHAR = { 7: 3.7, 6: 3.45 };
const OLIVIA_CATCHUP = { 7: 3.5, 6: 3.2 };
// ... whose characters need this much more z each (one may hold the start of the signal and noise from before it)
const OLIVIA_CATCHUP_CHAR = 0.4;
// One character's z from noise: its mean and spread; a block's characters go out only when their average is this many spreads (of
// the average: the spread over the root of the characters in a block) over noise's, which a noise block reaches about one time in 700
const OLIVIA_NOISE_Z = { 7: [2.56, 0.45], 6: [2.32, 0.42] };
const OLIVIA_SURE = 3;
// ... and not under this share of the blocks' that went out before it (averaged) either: a block far worse than those is most
// likely the one after the signal stopped, holding only the last tone's tail
const OLIVIA_DROP = 0.6;
// The SNR: the pulse's energy found in its window against a steady tone's of the same power; and by tones, the energy the signal's own
// pulses put on the other tones (the median of them, against the tone sent: none of it noise), measured with no noise at all
const OLIVIA_LEAK = { 4: 0.022, 8: 0.0087, 16: 0.001 };
const OLIVIA_SNR_PULSE = 0.8;
// A lock message again when the centre moves this share of a tone spacing, or the SNR this many dB
const OLIVIA_MOVE_SHARE = 0.25;
const OLIVIA_MOVE_DB = 3;

// Contestia's 6-bit characters as text
const OLIVIA_CONTESTIA = (() =>
{
  const table = new Array(64).fill("");
  for (let v = 1; v < 59; v++) table[v] = String.fromCharCode(v + 32);
  table[0] = "";
  table[59] = " ";
  table[60] = "\n";
  return table;
})();

let olRate = 48000;
let olMode = "olivia";
let olTones = 8;
let olBandwidth = 500;
let olCenter = 1500;
let olFront = null;
let olMixer = null;
// The format: bits per tone, tones per block, bits per character, the tone spacing (Hz)
let olBps = 3;
let olN = 64;
let olBits = 7;
let olSpacing = 62.5;
// The working rate (complex), samples per tone there, the window's length, its taps (cos and sin, a row per frequency) and its gain
let olFs = 1000;
let olS = 16;
let olL = 32;
let olCos = null;
let olSin = null;
let olEnbw = 1;
// Frequencies: G at half a spacing apart, the middle one gc (the centre told); places F, Q either side (half a spacing apart)
let olG = 0;
let olGc = 0;
let olQ = 0;
let olF = 0;
// The complex samples kept, how many so far, and the next spectrum's number
let olRe = null;
let olIm = null;
let olMask = 0;
let olCount = 0;
let olSlice = 0;
// Spectra kept (their energies) and soft bits kept (per place), a ring of olKept spectra; a block is olP spectra
let olP = 256;
let olKept = 1024;
let olEnergy = null;
let olSoft = null;
// Per place and starting point (row: point, column: place): z averaged over blocks
let olAvg = null;
let olBest = 0;
// Each tone's bits (Gray decoded), a character's bit for each of a block's tones and the sign unscrambling it
let olToneBits = null;
let olBitOf = null;
let olSign = null;
// Locked, the blocks gone out lately (the spectrum each ended at), the text waiting, the last lock message's centre and SNR, the SNR
// averaged
let olLocked = false;
let olPrinted = [];
// The last block due looked at (the spectrum it ended at)
let olLastLook = -1e9;
// The average z of the blocks that went out
let olGood = 0;
let olText = "";
let olAfterCr = false;
let olSentCenter = 0;
let olSentSnr = -100;
let olSnr = null;
// Work arrays
let olWr = null;
let olWi = null;
let olE = null;
let olVec = null;
let olFound = null;
let olSum0 = null;
let olSum1 = null;
let olBlockTones = null;
let olNoise = null;
// Blocks running that decoded no better than noise while locked
let olWeak = 0;

self.onmessage = (event) =>
{
  const m = event.data;
  if (m.type == "init")
  {
    olRate = m.rate >= 8000 ? m.rate : 48000;
    olSetup();
  }
  else if (m.type == "config")
  {
    olMode = m.mode == "contestia" ? "contestia" : "olivia";
    const tones = Math.round(Number(m.tones));
    olTones = tones >= 2 && tones <= 256 && (tones & (tones - 1)) == 0 ? tones : 8;
    const bandwidth = Number(m.bandwidth);
    olBandwidth = bandwidth >= 100 && bandwidth <= 4000 ? bandwidth : 500;
    const center = Number(m.center);
    olCenter = Number.isFinite(center) ? center : 1500;
    olSetup();
  }
  else if (m.type == "reset") olSetup();
  else if (m.type == "audio")
  {
    if (!olFront) olSetup();
    olAudio(m.samples);
  }
};

// ---- Everything set up again for the rate, mode and submode: nothing heard is kept
function olSetup()
{
  const fmt = OLIVIA_FORMATS[olMode];
  olBits = fmt.bits;
  olN = 1 << (olBits - 1);
  olBps = Math.round(Math.log2(olTones));
  olSpacing = olBandwidth / olTones;

  // The first step down, then the mix down: what's wanted is the band and the search either side, and a little for the window
  const d1 = Math.max(1, Math.floor(olRate / OLIVIA_FIRST_RATE));
  const rate1 = olRate / d1;
  olFront = olDecimator(olRate, d1, Math.min(OLIVIA_TOP_HZ, rate1 * 0.42));
  const d2 = Math.max(1, Math.floor(rate1 / (OLIVIA_RATE_PER_HZ * olBandwidth)));
  olFs = rate1 / d2;
  const keep = 0.75 * olBandwidth + olSpacing / 2;
  olMixer = olMixDown(rate1, d2, olCenter, keep);

  // The window: the pulse's shape, two tones long
  olS = olFs / olSpacing;
  olL = Math.round(2 * olS);
  const shape = new Float64Array(olL);
  let sum = 0;
  let sum2 = 0;
  for (let n = 0; n < olL; n++)
  {
    const x = -Math.PI + (2 * Math.PI * (n + 0.5)) / olL;
    let w = 0;
    for (let h = 0; h < OLIVIA_SHAPE.length; h++) w += OLIVIA_SHAPE[h] * Math.cos(h * x);
    shape[n] = w;
    sum += w;
    sum2 += w * w;
  }
  // Its noise bandwidth (Hz): the noise in it against a steady tone's energy
  olEnbw = (olFs * sum2) / (sum * sum);

  // The frequencies looked at: every tone of every place, half a spacing apart; the places reach a quarter of the bandwidth and half a
  // spacing either side
  olQ = olTones / 2 + 1;
  olF = 2 * olQ + 1;
  olGc = olTones - 1 + olQ;
  olG = 2 * olGc + 1;
  olCos = new Float64Array(olG * olL);
  olSin = new Float64Array(olG * olL);
  for (let g = 0; g < olG; g++)
  {
    const f = ((g - olGc) * olSpacing) / 2;
    for (let n = 0; n < olL; n++)
    {
      const a = (2 * Math.PI * f * n) / olFs;
      olCos[g * olL + n] = shape[n] * Math.cos(a);
      olSin[g * olL + n] = shape[n] * Math.sin(a);
    }
  }

  let size = 1;
  while (size < 4 * olL + olFs) size *= 2;
  olRe = new Float64Array(size);
  olIm = new Float64Array(size);
  olMask = size - 1;
  olCount = 0;
  olSlice = 0;

  olP = olN * OLIVIA_SPS;
  olKept = olP * OLIVIA_BLOCKS_KEPT;
  olEnergy = new Float32Array(olKept * olG);
  olSoft = [];
  for (let u = 0; u < olF; u++) olSoft.push(new Float32Array(olKept * olBps));
  olAvg = new Float32Array(olP * olF);
  olBest = 0;

  // Tone t carries the bits whose Gray code is t
  olToneBits = new Int32Array(olTones);
  for (let bits = 0; bits < olTones; bits++) olToneBits[bits ^ (bits >> 1)] = bits;
  olBitOf = new Int32Array(olBps * olN);
  olSign = new Float32Array(olBps * olN);
  for (let i = 0; i < olBps; i++)
  {
    for (let j = 0; j < olN; j++)
    {
      olBitOf[i * olN + j] = (i + j) % olBps;
      olSign[i * olN + j] = olCodeBit(fmt, (i * fmt.shift + j) % olN) ? -1 : 1;
    }
  }

  olLocked = false;
  olPrinted = [];
  olLastLook = -1e9;
  olGood = 0;
  olText = "";
  olAfterCr = false;
  olSentCenter = 0;
  olSentSnr = -100;
  olSnr = null;
  olWr = new Float64Array(olL);
  olWi = new Float64Array(olL);
  olE = new Float64Array(olTones);
  olVec = new Float64Array(olN);
  olFound = { chars: new Int32Array(olBps), z: new Float64Array(olBps), sum: 0 };
  olSum0 = new Float64Array(olBps);
  olSum1 = new Float64Array(olBps);
  olBlockTones = new Int32Array(olN);
  olNoise = new Float64Array(olN * olTones);
  olWeak = 0;
}

// Bit k of the scrambling sequence (0 the lowest)
function olCodeBit(fmt, k)
{
  return k < 32 ? (fmt.codeLow >>> k) & 1 : (fmt.codeHigh >>> (k - 32)) & 1;
}

// ---- The audio brought down by d: a low-pass filter (a windowed sinc, Blackman) keeping up to top, worked out only for the samples
// kept (every dth)
function olDecimator(rate, d, top)
{
  if (d <= 1) return (x) => Float64Array.from(x);
  const fd = rate / d;
  // What's above fd less top folds back above top when brought down: the filter's way down fits between
  const width = Math.max(fd - 2 * top, fd * 0.1);
  const n = Math.ceil((5.5 * rate) / width) | 1;
  const taps = olLowPass(n, fd / 2 / rate);
  // Each sample written twice, so the last n are always side by side
  const buf = new Float64Array(2 * n);
  let pos = 0;
  let count = 0;
  return (x) =>
  {
    const out = new Float64Array(Math.ceil((x.length + count) / d) + 1);
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

// A windowed sinc (Blackman) n taps long, cutting at cut (a share of the rate), summing to 1
function olLowPass(n, cut)
{
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
  return taps;
}

// The audio (at rate) mixed down by center, so the signal sits at 0 Hz, and brought down by d (complex): keep (Hz) either side is
// kept, and what would fold back onto it filtered out first. Returns a function giving { re, im } for each block
function olMixDown(rate, d, center, keep)
{
  const fd = rate / d;
  const width = Math.max(fd - 2 * keep, fd * 0.1);
  const n = Math.min(4095, Math.ceil((5.5 * rate) / width) | 1);
  const taps = olLowPass(n, fd / 2 / rate);
  const bufRe = new Float64Array(2 * n);
  const bufIm = new Float64Array(2 * n);
  const step = (2 * Math.PI * center) / rate;
  let phase = 0;
  let pos = 0;
  let count = 0;
  return (x) =>
  {
    const re = new Float64Array(Math.ceil((x.length + count) / d) + 1);
    const im = new Float64Array(re.length);
    let k = 0;
    for (let j = 0; j < x.length; j++)
    {
      bufRe[pos] = bufRe[pos + n] = x[j] * Math.cos(phase);
      bufIm[pos] = bufIm[pos + n] = -x[j] * Math.sin(phase);
      phase += step;
      if (phase > Math.PI) phase -= 2 * Math.PI;
      pos = pos + 1 == n ? 0 : pos + 1;
      if (++count < d) continue;
      count = 0;
      let sr = 0;
      let si = 0;
      for (let i = 0; i < n; i++)
      {
        sr += taps[i] * bufRe[pos + i];
        si += taps[i] * bufIm[pos + i];
      }
      re[k] = sr;
      im[k++] = si;
    }
    return { re: re.subarray(0, k), im: im.subarray(0, k) };
  };
}

// ---- Each block of audio: brought down, kept, and every spectrum it completes worked through
function olAudio(samples)
{
  const y = olMixer(olFront(samples));
  for (let i = 0; i < y.re.length; i++)
  {
    olRe[(olCount + i) & olMask] = y.re[i];
    olIm[(olCount + i) & olMask] = y.im[i];
  }
  olCount += y.re.length;
  while (olStart(olSlice) + olL <= olCount)
  {
    olSpectrum(olSlice);
    olSlice++;
  }
  if (olText.length)
  {
    self.postMessage({ type: "text", text: olText });
    olText = "";
  }
}

// Where spectrum k's window starts (in samples at olFs): four to a tone
function olStart(k)
{
  return Math.round((k * olS) / OLIVIA_SPS);
}

// Spectrum k: the energies, each place's soft bits, each place's block ending here decoded and its average z brought up to date,
// and the text sent when it's time
function olSpectrum(k)
{
  const start = olStart(k);
  for (let n = 0; n < olL; n++)
  {
    olWr[n] = olRe[(start + n) & olMask];
    olWi[n] = olIm[(start + n) & olMask];
  }
  const ring = k % olKept;
  const energy = olEnergy.subarray(ring * olG, (ring + 1) * olG);
  for (let g = 0; g < olG; g++)
  {
    const base = g * olL;
    let re = 0;
    let im = 0;
    for (let n = 0; n < olL; n++)
    {
      const c = olCos[base + n];
      const s = olSin[base + n];
      re += olWr[n] * c + olWi[n] * s;
      im += olWi[n] * c - olWr[n] * s;
    }
    energy[g] = re * re + im * im;
  }
  for (let u = 0; u < olF; u++) olSoftBits(energy, u, olSoft[u].subarray(ring * olBps, (ring + 1) * olBps));

  if (k < (olN - 1) * OLIVIA_SPS) return;
  // Every place while searching; once locked only those near the lock's
  const point = k % olP;
  const row = point * olF;
  const lo = olLocked ? Math.max(0, (olBest % olF) - OLIVIA_TRACK) : 0;
  const hi = olLocked ? Math.min(olF - 1, (olBest % olF) + OLIVIA_TRACK) : olF - 1;
  let rescan = false;
  for (let u = lo; u <= hi; u++)
  {
    olDecode(k, u);
    const z = olFound.sum / olBps;
    const before = olAvg[row + u];
    const after = before + OLIVIA_SHARE * (z - before);
    olAvg[row + u] = after;
    if (row + u == olBest && after < before) rescan = true;
    else if (after > olAvg[olBest]) olBest = row + u;
  }
  if (rescan)
  {
    for (let p = 0; p < olP; p++)
    {
      for (let u = lo; u <= hi; u++) if (olAvg[p * olF + u] > olAvg[olBest]) olBest = p * olF + u;
    }
  }

  // Let go when the best is no better than noise, or its blocks were two running
  const best = olAvg[olBest];
  if (olLocked && (best < OLIVIA_UNLOCK[olBits] || olWeak >= 2))
  {
    olUnlock();
    return;
  }
  // The block due: the last to end at the best's starting point (not this spectrum's, a step around it is tried), unless it was
  // looked at already. The best's starting point can move a step back and forth between two as good, so it's not waited for
  const bestPoint = Math.floor(olBest / olF);
  const due = k - 1 - ((((k - 1 - bestPoint) % olP) + olP) % olP);
  if (due - (olN - 1) * OLIVIA_SPS < 1 || due - olLastLook <= olP / 2) return;
  if (!olLocked)
  {
    if (best < OLIVIA_LOCK[olBits]) return;
    olLocked = true;
    olSentSnr = -100;
    olCatchUp(due, olBest % olF);
  }
  olSend(due + 1, olBest % olF);
}

// The lock let go (the signal gone, or under the noise two blocks running): the search starts afresh
function olUnlock()
{
  olLocked = false;
  olWeak = 0;
  olLastLook = -1e9;
  olGood = 0;
  olAvg.fill(0);
  olBest = 0;
}

// A tone's soft bits at place u, from its T energies: for each bit, how much likelier it's a 0 than a 1 (a log likelihood, positive
// for 0), the tones weighed by their energy against the noise's
function olSoftBits(energy, u, out)
{
  const first = olGc - (olTones - 1) + (u - olQ);
  let sum = 0;
  let max = 0;
  for (let t = 0; t < olTones; t++)
  {
    const e = energy[first + 2 * t];
    olE[t] = e;
    sum += e;
    if (e > max) max = e;
  }
  const noise = olTones > 1 ? (sum - max) / (olTones - 1) : sum;
  if (!(noise > 0))
  {
    out.fill(0);
    return;
  }
  // Each tone's likelihood (taken from the largest's, so nothing overflows), summed for each bit's 0s and 1s
  const scale = OLIVIA_SOFT_GAIN / noise;
  const top = max * scale;
  for (let b = 0; b < olBps; b++)
  {
    olSum0[b] = 1e-300;
    olSum1[b] = 1e-300;
  }
  for (let t = 0; t < olTones; t++)
  {
    const w = Math.exp(olE[t] * scale - top);
    const bits = olToneBits[t];
    for (let b = 0; b < olBps; b++)
    {
      if ((bits >> b) & 1) olSum1[b] += w;
      else olSum0[b] += w;
    }
  }
  for (let b = 0; b < olBps; b++)
  {
    const llr = Math.log(olSum0[b] / olSum1[b]);
    out[b] = Math.max(-OLIVIA_SOFT_CLIP, Math.min(OLIVIA_SOFT_CLIP, llr));
  }
}

// The block ending at spectrum k, at place u, decoded into olFound: each character, its z, and their sum
function olDecode(k, u)
{
  const soft = olSoft[u];
  olFound.sum = 0;
  for (let i = 0; i < olBps; i++)
  {
    let energy = 0;
    for (let j = 0; j < olN; j++)
    {
      const ring = (k - (olN - 1 - j) * OLIVIA_SPS) % olKept;
      const v = soft[ring * olBps + olBitOf[i * olN + j]] * olSign[i * olN + j];
      olVec[j] = v;
      energy += v * v;
    }
    // The fast Hadamard transform: output c is the vector's match with Walsh function c
    for (let h = 1; h < olN; h *= 2)
    {
      for (let a = 0; a < olN; a += 2 * h)
      {
        for (let j = a; j < a + h; j++)
        {
          const x = olVec[j];
          const y = olVec[j + h];
          olVec[j] = x + y;
          olVec[j + h] = x - y;
        }
      }
    }
    let top = 0;
    let at = 0;
    for (let c = 0; c < olN; c++)
    {
      const m = Math.abs(olVec[c]);
      if (m > top)
      {
        top = m;
        at = c;
      }
    }
    const z = energy > 0 ? top / Math.sqrt(energy) : 0;
    // The sign: Walsh function c is upside down when c has an odd number of bits set (see the top), and c + 64 upside down again
    olFound.chars[i] = (olVec[at] > 0) != (olPopParity(at) == 1) ? at : at + olN;
    olFound.z[i] = z;
    olFound.sum += z;
  }
}

// The block due (ending a spectrum before k, at place u): the best of it and the eight around it (a spectrum and a place either
// way) goes out, its characters that are sure, unless one went out less than half a block ago
function olSend(k, u)
{
  olLastLook = k - 1;
  let bestSum = -1;
  let bestK = k - 1;
  let bestU = u;
  for (let kk = k - 2; kk <= k; kk++)
  {
    for (let uu = Math.max(0, u - 1); uu <= Math.min(olF - 1, u + 1); uu++)
    {
      olDecode(kk, uu);
      if (olFound.sum > bestSum)
      {
        bestSum = olFound.sum;
        bestK = kk;
        bestU = uu;
      }
    }
  }
  if (olPrintedNear(bestK)) return;
  olDecode(bestK, bestU);
  olWeak = olFound.sum / olBps < OLIVIA_UNLOCK[olBits] ? olWeak + 1 : 0;
  olTonesSent();
  if (olAliased(bestK, bestU)) return;
  if (olEmit(bestK, 0)) olMeasure(bestK, bestU);
}

// True when a block ending less than half a block from spectrum k has gone out (it would be this one again)
function olPrintedNear(k)
{
  return olPrinted.some((p) => Math.abs(k - p) < olP / 2);
}

// olFound's characters encoded again, as the sender did: each of the block's tones into olBlockTones
function olTonesSent()
{
  const fmt = OLIVIA_FORMATS[olMode];
  for (let j = 0; j < olN; j++)
  {
    let bits = 0;
    for (let i = 0; i < olBps; i++)
    {
      const v = olFound.chars[i];
      let negative = v >= olN;
      if (olPopParity(v & (olN - 1) & ~j)) negative = !negative;
      if (olCodeBit(fmt, (i * fmt.shift + j) % olN)) negative = !negative;
      if (negative) bits |= 1 << olBitOf[i * olN + j];
    }
    olBlockTones[j] = bits ^ (bits >> 1);
  }
}

// A signal half a bandwidth off (half its tones outside the band looked at) can still decode, wrongly: the tones half the band away
// differ in every bit, which upside-down Walsh functions survive, so its characters come out as others. Seen here as the block's
// tones (olBlockTones, at place u) being the strongest in one half of the band and almost never in the other
function olAliased(k, u)
{
  const first = olGc - (olTones - 1) + (u - olQ);
  const half = olTones >> 1;
  const hits = [0, 0];
  const counts = [0, 0];
  for (let j = 0; j < olN; j++)
  {
    const ring = (k - (olN - 1 - j) * OLIVIA_SPS) % olKept;
    const base = ring * olG + first;
    const tone = olBlockTones[j];
    let top = 0;
    for (let t = 1; t < olTones; t++) if (olEnergy[base + 2 * t] > olEnergy[base + 2 * top]) top = t;
    const side = tone < half ? 0 : 1;
    counts[side]++;
    if (top == tone) hits[side]++;
  }
  if (counts[0] < 4 || counts[1] < 4) return false;
  const a = hits[0] / counts[0];
  const b = hits[1] / counts[1];
  return Math.max(a, b) >= 0.4 && Math.min(a, b) < 0.3 * Math.max(a, b);
}

// On locking at spectrum k, place u: the blocks kept from before, oldest first, each that decodes well enough
function olCatchUp(k, u)
{
  for (let back = OLIVIA_BLOCKS_KEPT - 1; back >= 1; back--)
  {
    const kk = k - back * olP;
    if (kk - (olN - 1) * OLIVIA_SPS < Math.max(0, olSlice - olKept + 1)) continue;
    if (olPrintedNear(kk)) continue;
    olDecode(kk, u);
    if (olFound.sum / olBps < OLIVIA_CATCHUP[olBits]) continue;
    olTonesSent();
    if (!olAliased(kk, u)) olEmit(kk, OLIVIA_CATCHUP_CHAR);
  }
}

// olFound's characters that are sure (their z over the threshold and more), as text, the block (ending at spectrum k) noted as gone
// out; none from a block no better than noise. True when the block was good enough
function olEmit(k, more)
{
  const [mean, spread] = OLIVIA_NOISE_Z[olBits];
  const z = olFound.sum / olBps;
  if (z < mean + (OLIVIA_SURE * spread) / Math.sqrt(olBps) || z < OLIVIA_DROP * olGood) return false;
  olGood = olGood > 0 ? olGood + OLIVIA_SHARE * (z - olGood) : z;
  olPrinted.push(k);
  if (olPrinted.length > 2 * OLIVIA_BLOCKS_KEPT) olPrinted.shift();
  for (let i = 0; i < olBps; i++)
  {
    if (olFound.z[i] < OLIVIA_CHAR[olBits] + more) continue;
    const v = olFound.chars[i];
    let ch = "";
    if (olMode == "contestia") ch = OLIVIA_CONTESTIA[v & 63];
    else if (v == 13 || v == 10) ch = "\n";
    else if (v >= 32 && v < 127) ch = String.fromCharCode(v);
    // A CR LF is one new line
    if (v == 10 && olAfterCr && olMode == "olivia") ch = "";
    olAfterCr = olMode == "olivia" && v == 13;
    olText += ch;
  }
  return true;
}

// The block just sent (ending at spectrum k, place u): its tones (olBlockTones) against the others give the SNR; a lock message when
// locking, or the centre or SNR moved
function olMeasure(k, u)
{
  const first = olGc - (olTones - 1) + (u - olQ);
  let signal = 0;
  let count = 0;
  // The noise: the median of the other tones' energies (not this one's or its neighbours', whose pulses overlap its window), as the
  // mean (noise's energy is spread so its median is ln 2 of its mean): the median, as some of them still catch a little of the signal
  for (let j = 0; j < olN; j++)
  {
    const tone = olBlockTones[j];
    const before = j > 0 ? olBlockTones[j - 1] : tone;
    const after = j < olN - 1 ? olBlockTones[j + 1] : tone;
    const ring = (k - (olN - 1 - j) * OLIVIA_SPS) % olKept;
    const base = ring * olG + first;
    signal += olEnergy[base + 2 * tone];
    for (let t = 0; t < olTones; t++)
    {
      if (t == tone || t == before || t == after) continue;
      olNoise[count++] = olEnergy[base + 2 * t];
    }
  }
  if (count < 8) return;
  const sorted = olNoise.subarray(0, count).sort();
  signal /= olN;
  // Less what the signal's own pulses put there (measured with no noise at all), kept to a tenth of it at least
  const leak = (OLIVIA_LEAK[olTones] || 0) * signal;
  const noise = Math.max(sorted[count >> 1] / Math.LN2 - leak, leak / 10);
  if (!(noise > 0)) return;
  const ratio = Math.max(1e-3, (signal - noise) / noise);
  const snr = 10 * Math.log10((ratio * olEnbw) / (2500 * OLIVIA_SNR_PULSE));
  olSnr = olSnr == null ? snr : olSnr + 0.4 * (snr - olSnr);

  // The centre: the place, moved between its neighbours by how their averages lean (a parabola through the three)
  const row = Math.floor(olBest / olF) * olF;
  let shift = 0;
  if (u > 0 && u < olF - 1)
  {
    const a = olAvg[row + u - 1];
    const b = olAvg[row + u];
    const c = olAvg[row + u + 1];
    const bend = a - 2 * b + c;
    if (bend < 0) shift = Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / bend));
  }
  const center = olCenter + ((u - olQ + shift) * olSpacing) / 2;
  if (olSentSnr > -100 && Math.abs(center - olSentCenter) < OLIVIA_MOVE_SHARE * olSpacing && Math.abs(olSnr - olSentSnr) < OLIVIA_MOVE_DB) return;
  olSentCenter = center;
  olSentSnr = olSnr;
  self.postMessage({ type: "lock", center: Math.round(center * 10) / 10, snr: Math.round(olSnr) });
}

// 1 when n has an odd number of bits set
function olPopParity(n)
{
  n ^= n >> 16;
  n ^= n >> 8;
  n ^= n >> 4;
  n ^= n >> 2;
  n ^= n >> 1;
  return n & 1;
}
