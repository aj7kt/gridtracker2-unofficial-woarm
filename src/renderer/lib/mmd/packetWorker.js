// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Multi-Mode Decoder's Packet mode (mmdPacket.js): AX.25 frames from the input's audio at its own rate, four ways at once (HF
// packet's 300 baud is AFSK 1200's way with its own tones, a pair 200 Hz apart; GMSK 4800 FSK 9600's at half the speed).
//   HF 300 baud: an HF station's tones land wherever its sideband and dial put them, so they are looked for all across the audio decoded
//   (between [ and ]), from the audio taken down to about PACKET_HF_RATE: each tone on a grid PACKET_HF_STEP Hz apart measured once (mixed
//   down, summed in blocks of PACKET_HF_BLOCK samples, those summed over a bit), and every pair of them PACKET_HF_SHIFT apart sliced as
//   AFSK 1200's are (packetHfBank). A strong frame decodes on many pairs round its own; where it was heard is the middle of the one of them
//   hearing the most (both its tones on the signal: packetHfFound). Locked on a place (a click on the waterfall), only frames heard within
//   PACKET_HF_LOCK_HALF of it go out,
//   and the pairs there are sliced more ways (PACKET_SPACE_GAINS).
//   AFSK 1200 (Bell 202: 1200 Hz mark, 2200 Hz space; APRS on 144.390 MHz, the ISS's digipeater): each tone's strength over a bit
//   (mixed down and summed over one bit's samples), then mark less space, weighed several ways (an FM rig's de-emphasis leaves 2200 Hz
//   weaker, a transmitter's pre-emphasis stronger), each weighing with its own clock, as Direwolf's slicers: one catches what another misses.
//   FSK 9600 (G3RUH, from a rig's flat 9600 audio): the audio summed over a bit, its level's middle taken off, sliced; descrambled
//   (x^17 + x^12 + 1).
// Each bit stream: a clock recovered from its transitions (a phase nudged toward them), NRZI, HDLC (flags, bit stuffing, aborts), the
// frame's CRC (CCITT, as X.25) checked. A good frame is read: its addresses, and for APRS its position, message, status ... A frame two
// demodulators both decode goes out once
// In:  { type: "init", rate }, { type: "audio", samples }, { type: "reset" }, { type: "hf", min, max, lock } (the audio decoded, Hz, and
//      the place locked on, Hz, or null)
// Out: { type: "frame", baud, src, dst, path, info, aprs, hz (300 baud: where it was heard) }

const PACKET_MARK = 1200;
const PACKET_SPACE = 2200;
// HF 300 baud: its tones' shift, the grid the tones are measured on (a pair a quarter of its shift off still decodes), the rate the audio
// is taken down to, the samples summed into a block (the slicers run a block at a time: 10 blocks a bit), a frame heard within this of a
// place locked on (the signal's middle on it, give or take its grid step and a little: the guard lines either side, mmdPacket.js
// PACKET_LOCK_HALF, show the signal's whole width), and how many audio chunks a frame waits for the other pairs that decode it (each chunk
// a tenth of a second)
const PACKET_HF_SHIFT = 200;
const PACKET_HF_STEP = 50;
const PACKET_HF_RATE = 12000;
const PACKET_HF_BLOCK = 4;
const PACKET_HF_LOCK_HALF = 100;
const PACKET_HF_WAIT_CHUNKS = 2;
// A pair's strength (its tones' together) followed over about this long (s): the frame's, as it ends
const PACKET_HF_ENERGY_S = 0.3;
// HF's slicers: mark less space at these weighings (an SSB rig's tones come through alike: fewer than VHF FM needs); near a lock, all of
// PACKET_SPACE_GAINS
const PACKET_HF_GAINS = [0.7, 1, 1.4];
// AFSK 1200 through SSB: its tones looked for up to this far (Hz) either way of 1200 and 2200, on a grid this far apart (a pair about a
// quarter of the grid's step off still decodes a weak signal: packetSsbBank)
const PACKET_SSB_SPREAD = 600;
const PACKET_SSB_STEP = 100;
// Frame length in bytes, the CRC's two included: the shortest with two addresses and a control byte, the longest AX.25 allows
const PACKET_MIN_BYTES = 17;
const PACKET_MAX_BYTES = 340;
// The same frame from another demodulator within this long goes out once (ms)
const PACKET_DEDUPE_MS = 3000;

let packetRate = 48000;
let packetDemods = [];
// HF 300 baud: the audio decoded and the place locked on (as last told), the audio taken down (packetHf), and its demodulators
let packetHfRange = { min: 300, max: 3000, lock: null };
let packetHf = null;
// AFSK 1200 through SSB: its bank (packetSsbBank)
let packetSsb = null;
// HF frames waiting for the other pairs that decode them: by their bytes, { frame, hz, energy (the strongest pair's so far), chunk }; and
// the audio chunks taken in
const packetHfPending = new Map();
let packetChunk = 0;
const packetRecent = new Map();

self.onmessage = (event) =>
{
  const m = event.data;
  if (m.type == "init") packetInit(m.rate);
  else if (m.type == "reset") packetInit(packetRate);
  else if (m.type == "hf")
  {
    packetHfRange = { min: Number(m.min) || 0, max: Number(m.max) || 0, lock: m.lock > 0 ? Number(m.lock) : null };
    packetHf = packetHfBank(packetRate);
  }
  else if (m.type == "audio")
  {
    if (packetDemods.length == 0) packetInit(packetRate);
    const x = m.samples;
    for (const d of packetDemods) d.run(x);
    packetHf.run(x);
    packetSsb.run(x);
    packetChunk++;
    packetHfFlush();
  }
};

function packetInit(rate)
{
  packetRate = rate > 0 ? rate : 48000;
  // AFSK 1200 (VHF)
  packetDemods = [packetAfsk(packetRate)];
  // G3RUH at 9600 and 4800 (cubesats' GMSK), each needing over twice its baud rate in samples
  for (const baud of [9600, 4800]) if (packetRate >= baud * 2) packetDemods.push(packetFsk(packetRate, baud));
  // HF packet's 300 baud, looked for across the audio decoded (or where it is locked on); AFSK 1200 a little off, through SSB
  packetHf = packetHfBank(packetRate);
  packetSsb = packetSsbBank(packetRate);
  packetHfPending.clear();
  packetRecent.clear();
}

// HF 300 baud's bank: its tones on a grid between [ and ] (clear of the edges), each pair where it is heard (packetHfFound), and locked on
// a place, its pairs there sliced more ways
function packetHfBank(rate)
{
  const down = Math.max(1, Math.floor(rate / PACKET_HF_RATE));
  const R = packetHfRange;
  const nyquist = rate / down / 2;
  return packetToneBank(rate, {
    baud: 300, shift: PACKET_HF_SHIFT, step: PACKET_HF_STEP, block: PACKET_HF_BLOCK,
    low: Math.max(R.min, 100), high: Math.min(R.max > 0 ? R.max : nyquist, nyquist - 100), skip: null, report: true,
    gains: (middle) => (R.lock && Math.abs(middle - R.lock) <= PACKET_HF_STEP ? PACKET_SPACE_GAINS : PACKET_HF_GAINS)
  });
}

// AFSK 1200 heard through an SSB receiver (a satellite's packet, a rig a little off): its tones up to PACKET_SSB_SPREAD either way of
// 1200 and 2200 Hz, on a grid PACKET_SSB_STEP apart; the exact pair left to the full rate demodulator (packetAfsk). Its frames go out as
// any other's
function packetSsbBank(rate)
{
  return packetToneBank(rate, {
    baud: 1200, shift: PACKET_SPACE - PACKET_MARK, step: PACKET_SSB_STEP, block: 1,
    low: PACKET_MARK - PACKET_SSB_SPREAD, high: PACKET_SPACE + PACKET_SSB_SPREAD, skip: (PACKET_MARK + PACKET_SPACE) / 2, report: false,
    gains: () => PACKET_HF_GAINS
  });
}

// ---- A bank of AFSK demodulators on a grid of tones: the audio taken down to about PACKET_HF_RATE (two running sums, every down-th kept),
// then each tone of the grid (o.step apart, from o.low to o.high) mixed down and summed in blocks of o.block samples; a tone's strength the
// size of its last bit's blocks summed. Each pair of tones o.shift apart (its middle where its frames are heard, but o.skip; its energy
// their strength together, followed) sliced at each of its gains (o.gains(middle)), a block at a time, its own clock and HDLC at o.baud.
// o.report: its frames say where they were heard (HF 300 baud), else they go out as any other demodulator's
function packetToneBank(rate, o)
{
  const down = Math.max(1, Math.floor(rate / PACKET_HF_RATE));
  const hfRate = rate / down;
  const blockRate = hfRate / o.block;
  const perBit = Math.max(2, Math.round(blockRate / o.baud));
  const half = o.shift / 2;
  const freqs = [];
  for (let hz = Math.ceil(o.low / o.step) * o.step; hz <= o.high; hz += o.step) freqs.push(hz);
  const tones = freqs.map((hz) => ({ c: Math.cos((2 * Math.PI * hz) / hfRate), s: Math.sin((2 * Math.PI * hz) / hfRate), re: 1, im: 0, ai: 0, aq: 0, bi: new Float32Array(perBit), bq: new Float32Array(perBit), si: 0, sq: 0, size: 0 }));
  const apart = Math.round(o.shift / o.step);
  const follow = 1 / (blockRate * PACKET_HF_ENERGY_S);
  const pairs = [];
  for (let k = 0; k + apart < tones.length; k++)
  {
    const middle = freqs[k] + half;
    if (o.skip !== null && Math.abs(middle - o.skip) < o.step / 2) continue;
    const pair = { lo: tones[k], hi: tones[k + apart], middle, energy: 0, report: o.report, slicers: [] };
    pair.slicers = o.gains(middle).map((gain) => ({ gain, clock: packetClock(o.baud, blockRate, packetHdlc((bits, length) => packetFrameOut(bits, length, o.baud, pair))) }));
    pairs.push(pair);
  }
  const a = new Float32Array(down), b = new Float32Array(down);
  let sa = 0, sb = 0, at = 0, phase = 0, inBlock = 0, slot = 0, turns = 0;
  return {
    run(x)
    {
      for (let j = 0; j < x.length; j++)
      {
        sa += x[j] - a[at];
        a[at] = x[j];
        const va = sa / down;
        sb += va - b[at];
        b[at] = va;
        at = at + 1 >= down ? 0 : at + 1;
        if (++phase < down) continue;
        phase = 0;
        // A sample at the bank's rate: each tone mixed down into its block
        const v = sb / down;
        for (const t of tones)
        {
          const re = t.re * t.c - t.im * t.s;
          t.im = t.re * t.s + t.im * t.c;
          t.re = re;
          t.ai += v * t.re;
          t.aq += v * t.im;
        }
        if (++inBlock < o.block) continue;
        inBlock = 0;
        // A block: each tone's last bit summed, its size; each pair sliced
        for (const t of tones)
        {
          t.si += t.ai - t.bi[slot];
          t.sq += t.aq - t.bq[slot];
          t.bi[slot] = t.ai;
          t.bq[slot] = t.aq;
          t.ai = t.aq = 0;
          t.size = Math.sqrt(t.si * t.si + t.sq * t.sq);
        }
        slot = slot + 1 >= perBit ? 0 : slot + 1;
        for (const p of pairs)
        {
          p.energy += (p.lo.size + p.hi.size - p.energy) * follow;
          for (const sl of p.slicers) sl.clock(p.lo.size - sl.gain * p.hi.size);
        }
        // The oscillators kept at unit size, and the running sums summed again (rounding would let them drift)
        if (++turns >= 1024)
        {
          turns = 0;
          for (const t of tones)
          {
            const g = 1 / Math.sqrt(t.re * t.re + t.im * t.im);
            t.re *= g;
            t.im *= g;
            t.si = t.bi.reduce((s, w) => s + w, 0);
            t.sq = t.bq.reduce((s, w) => s + w, 0);
          }
        }
      }
    }
  };
}

// An HF frame decoded on a pair: kept a moment for the other pairs that decode it too (key: its bytes), heard at the strongest one's middle
function packetHfFound(key, frame, pair)
{
  if (packetRecent.has(key)) return;
  const p = packetHfPending.get(key);
  if (p)
  {
    if (pair.energy > p.energy)
    {
      p.energy = pair.energy;
      p.hz = pair.middle;
    }
    return;
  }
  packetHfPending.set(key, { frame, hz: pair.middle, energy: pair.energy, chunk: packetChunk });
}

// The HF frames whose wait is over; with a lock, only those heard within its guards go out
function packetHfFlush()
{
  for (const [key, p] of packetHfPending)
  {
    if (packetChunk - p.chunk < PACKET_HF_WAIT_CHUNKS) continue;
    packetHfPending.delete(key);
    const hz = p.hz;
    if (packetHfRange.lock && Math.abs(hz - packetHfRange.lock) > PACKET_HF_LOCK_HALF) continue;
    packetRecent.set(key, Date.now());
    p.frame.hz = hz;
    self.postMessage(Object.assign({ type: "frame" }, p.frame));
  }
}

// ---- A bit clock: a phase from -0.5 to 0.5 a bit, each bit read where it wraps (the bit's middle); a change of level (a transition,
// due at phase 0) pulls the phase toward 0, harder until frames come
function packetClock(baud, rate, onBit)
{
  const step = baud / rate;
  let phase = 0;
  let last = 0;
  return (level) =>
  {
    const now = level > 0 ? 1 : 0;
    if (now != last) phase *= 0.74;
    last = now;
    phase += step;
    if (phase >= 0.5)
    {
      phase -= 1;
      onBit(now);
    }
  };
}

// ---- HDLC: NRZI decoded (no change a 1, a change a 0); five 1s then a 0 is a stuffed 0, dropped; six 1s then a 0 a flag (a frame's end
// and the next one's start); seven 1s an abort
function packetHdlc(onFrame)
{
  let prev = 0;
  let ones = 0;
  let bits = new Uint8Array(PACKET_MAX_BYTES * 8 + 16);
  let count = 0;
  let inFrame = false;
  return (level) =>
  {
    const bit = level == prev ? 1 : 0;
    prev = level;
    if (bit)
    {
      ones++;
      if (ones >= 7)
      {
        inFrame = false;
        count = 0;
        return;
      }
    }
    else
    {
      if (ones == 5)
      {
        // A stuffed 0
        ones = 0;
        return;
      }
      if (ones == 6)
      {
        // A flag: what came before it (less the flag's own 0 and six 1s, already taken in) is a frame
        const n = count - 7;
        if (inFrame && n >= PACKET_MIN_BYTES * 8 && n % 8 == 0) onFrame(bits, n / 8);
        inFrame = true;
        count = 0;
        ones = 0;
        return;
      }
      ones = 0;
    }
    if (!inFrame) return;
    if (count < bits.length) bits[count++] = bit;
    else
    {
      inFrame = false;
      count = 0;
    }
  };
}

// A step of the CRC (CCITT, least significant bit first) on one bit
function packetCrcStep(crc)
{
  return crc & 1 ? (crc >>> 1) ^ 0x8408 : crc >>> 1;
}

function packetCrc(bytes, length)
{
  let crc = 0xffff;
  for (let i = 0; i < length; i++)
  {
    crc ^= bytes[i];
    for (let k = 0; k < 8; k++) crc = packetCrcStep(crc);
  }
  return crc ^ 0xffff;
}

// A frame whose CRC is wrong, put right where one bit, or two side by side (one bit wrong on the air is two after NRZI), was read wrong,
// as Direwolf's "fix bits" does. The CRC is linear: a bit flipped k bits before the frame's end changes it by the same amount (a 1 run
// through k steps) whatever the frame says, so the bit whose change is the CRC's error is found in one pass. Only a frame whose addresses
// look like ones (their letters, at most one out) is tried, so noise between flags isn't. True when put right (bytes changed)
function packetFix(bytes, length, error)
{
  let bad = 0;
  for (let i = 0; i < 14; i++)
  {
    const c = bytes[i] >> 1;
    if ((i % 7 < 6 && !((c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c == 32)) || (i % 7 < 6 && bytes[i] & 1)) bad++;
  }
  if (bad > 1) return false;
  const bits = length * 8;
  let one = 0;
  let before = 0;
  for (let k = 1; k <= bits; k++)
  {
    one = packetCrcStep(k == 1 ? 1 : one);
    // One bit (k from the end), or it and the one after it
    const pair = one ^ before;
    if (one == error || (k > 1 && pair == error))
    {
      const p = bits - k;
      bytes[p >> 3] ^= 1 << (p & 7);
      if (one != error) bytes[(p + 1) >> 3] ^= 1 << ((p + 1) & 7);
      return true;
    }
    before = one;
  }
  return false;
}

// The bits, least significant first, as bytes; the frame kept when its CRC (the last two bytes) is right, or once put right (packetFix).
// pair: the HF 300 baud pair that decoded it (packetHfBank), or null
function packetFrameOut(bits, length, baud, pair = null)
{
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++)
  {
    let b = 0;
    for (let k = 0; k < 8; k++) b |= bits[i * 8 + k] << k;
    bytes[i] = b;
  }
  const fcs = bytes[length - 2] | (bytes[length - 1] << 8);
  let fixed = false;
  const crc = packetCrc(bytes, length - 2);
  if (crc != fcs)
  {
    if (!packetFix(bytes, length - 2, crc ^ fcs) || packetCrc(bytes, length - 2) != fcs) return;
    fixed = true;
  }
  const frame = packetAx25(bytes.subarray(0, length - 2));
  if (!frame) return;
  frame.fixed = fixed;
  // Heard by another demodulator a moment ago: once only
  const key = String.fromCharCode(...bytes);
  const now = Date.now();
  for (const [k, at] of packetRecent) if (now - at > PACKET_DEDUPE_MS) packetRecent.delete(k);
  if (packetRecent.has(key)) return;
  frame.baud = baud;
  frame.hz = null;
  frame.aprs = frame.ui ? packetAprs(frame) : null;
  // HF 300 baud: out once the other pairs that decode it are in (packetHfFlush); a bank's frame that doesn't say where goes out as any
  if (pair && pair.report)
  {
    packetHfFound(key, frame, pair);
    return;
  }
  packetRecent.set(key, now);
  self.postMessage(Object.assign({ type: "frame" }, frame));
}

// ---- AFSK 1200: each tone mixed down (an oscillator turned a step each sample) and summed over one bit's samples; its strength the sum's
// size. Mark less space, the space weighed by each of PACKET_SPACE_GAINS, each its own clock and HDLC
const PACKET_SPACE_GAINS = [0.5, 0.7, 1, 1.4, 2, 2.8];

function packetAfsk(rate, baud = 1200, mark = PACKET_MARK, space = PACKET_SPACE)
{
  const n = Math.max(4, Math.round(rate / baud));
  const tones = [mark, space].map((hz) => ({ c: Math.cos((2 * Math.PI * hz) / rate), s: Math.sin((2 * Math.PI * hz) / rate), re: 1, im: 0, bi: new Float32Array(n), bq: new Float32Array(n), si: 0, sq: 0 }));
  let at = 0;
  let turns = 0;
  const slicers = PACKET_SPACE_GAINS.map((gain) => ({ gain, clock: packetClock(baud, rate, packetHdlc((bits, length) => packetFrameOut(bits, length, baud))) }));
  const strength = [0, 0];
  return {
    run(x)
    {
      for (let j = 0; j < x.length; j++)
      {
        const v = x[j];
        for (let t = 0; t < 2; t++)
        {
          const o = tones[t];
          const re = o.re * o.c - o.im * o.s;
          o.im = o.re * o.s + o.im * o.c;
          o.re = re;
          const i = v * o.re, q = v * o.im;
          o.si += i - o.bi[at];
          o.sq += q - o.bq[at];
          o.bi[at] = i;
          o.bq[at] = q;
          strength[t] = Math.sqrt(o.si * o.si + o.sq * o.sq);
        }
        for (const sl of slicers) sl.clock(strength[0] - sl.gain * strength[1]);
        at = at + 1 >= n ? 0 : at + 1;
        // The oscillators kept at unit size (rounding would let them drift)
        if (++turns >= 4096)
        {
          turns = 0;
          for (const o of tones)
          {
            const g = 1 / Math.sqrt(o.re * o.re + o.im * o.im);
            o.re *= g;
            o.im *= g;
          }
          // The running sums kept from drifting too: summed again
          for (const o of tones)
          {
            o.si = o.bi.reduce((s, v) => s + v, 0);
            o.sq = o.bq.reduce((s, v) => s + v, 0);
          }
        }
      }
    }
  };
}

// ---- FSK 9600 and GMSK 4800 (G3RUH, as a rig's FM receiver gives them: flat audio): the audio summed over a bit (its matched filter),
// its middle (a slow average) taken off, sliced; each bit read descrambled (it, less the bits 12 and 17 back: x^17 + x^12 + 1), then NRZI
// and HDLC as AFSK's
function packetFsk(rate, baud)
{
  const n = Math.max(1, Math.round(rate / baud));
  const buf = new Float32Array(n);
  let at = 0;
  let sum = 0;
  let middle = 0;
  const slow = 1 / (rate * 0.05);
  let shift = 0;
  const hdlc = packetHdlc((bits, length) => packetFrameOut(bits, length, baud));
  const clock = packetClock(baud, rate, (bit) =>
  {
    const out = bit ^ ((shift >>> 11) & 1) ^ ((shift >>> 16) & 1);
    shift = ((shift << 1) | bit) & 0x1ffff;
    hdlc(out);
  });
  return {
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
    }
  };
}

// ---- AX.25: the addresses (seven bytes each: six letters shifted up a bit, then the SSID; the last one's lowest bit set), up to 10;
// then the control byte, and for a UI frame (the APRS one) its protocol byte and the information. A digipeater that has passed it on
// has its H bit (0x80 in the SSID byte), shown as * after the last such one
function packetAx25(bytes)
{
  const calls = [];
  let i = 0;
  for (;;)
  {
    if (i + 7 > bytes.length || calls.length >= 10) return null;
    let call = "";
    for (let k = 0; k < 6; k++)
    {
      const c = bytes[i + k] >> 1;
      if (c < 32 || c > 126 || (bytes[i + k] & 1)) return null;
      if (c != 32) call += String.fromCharCode(c);
    }
    const ssidByte = bytes[i + 6];
    const ssid = (ssidByte >> 1) & 15;
    if (!/^[A-Z0-9]{1,6}$/.test(call)) return null;
    calls.push({ call: ssid ? call + "-" + ssid : call, repeated: (ssidByte & 0x80) != 0 });
    i += 7;
    if (ssidByte & 1) break;
  }
  if (calls.length < 2 || i >= bytes.length) return null;
  const control = bytes[i];
  const ui = (control & 0xef) == 0x03;
  let info = "";
  if (ui && i + 1 < bytes.length)
  {
    for (let k = i + 2; k < bytes.length; k++) info += String.fromCharCode(bytes[k]);
  }
  const digis = calls.slice(2);
  let lastRepeated = -1;
  digis.forEach((d, k) => { if (d.repeated) lastRepeated = k; });
  const path = digis.map((d, k) => d.call + (k == lastRepeated ? "*" : ""));
  return { dst: calls[0].call, src: calls[1].call, path, ui, info };
}

// ---- APRS: what the information says, by its first character. { kind, lat, lon, symbol, text, to (a message's), name (an object's) };
// kind: position, status, message, object, item, weather, telemetry, mice, other
function packetAprs(frame)
{
  const s = frame.info;
  if (!s) return null;
  const t = s[0];
  try
  {
    if (t == "!" || t == "=") return packetAprsPosition(s.slice(1), "position");
    if (t == "/" || t == "@") return packetAprsPosition(s.slice(8), "position");
    if (t == ";")
    {
      const p = packetAprsPosition(s.slice(18), "object");
      if (p) p.name = s.slice(1, 10).trim() + (s[10] == "_" ? " (killed)" : "");
      return p;
    }
    if (t == ")")
    {
      const m = /^\)([^!_]{3,9})[!_](.*)$/.exec(s);
      if (!m) return { kind: "other", text: s };
      const p = packetAprsPosition(m[2], "item");
      if (p) p.name = m[1];
      return p;
    }
    if (t == ":" && s.length >= 11 && s[10] == ":")
    {
      const to = s.slice(1, 10).trim();
      let text = s.slice(11);
      let id = "";
      const m = /^(.*)\{([A-Za-z0-9}]{1,6})$/.exec(text);
      if (m)
      {
        text = m[1];
        id = m[2];
      }
      return { kind: "message", to, text, id };
    }
    if (t == ">") return { kind: "status", text: s.slice(1) };
    if (t == "`" || t == "'" || t == "\x1c" || t == "\x1d") return packetMicE(frame.dst.replace(/-\d+$/, ""), s);
    if (t == "_") return { kind: "weather", text: s.slice(9) };
    if (t == "T" && s[1] == "#") return { kind: "telemetry", text: s.slice(2) };
  }
  catch (e)
  {
    // As it is, below
  }
  return { kind: "other", text: s };
}

// A position: uncompressed (4903.50N/07201.75W> and a comment) or compressed (/5L!!<*e7> and a comment), in either case the symbol (its
// table and code) and the comment after it; with course and speed (ccc/sss, knots), and altitude (/A=, feet) read from it where they are
function packetAprsPosition(s, kind)
{
  let lat, lon, symbol, comment;
  // Spaces in the digits are a position given less precisely (ambiguity): read as 0
  const m = /^(\d{2})([\d ]{2}\.[\d ]{2})([NS])(.)(\d{3})([\d ]{2}\.[\d ]{2})([EW])(.)(.*)$/.exec(s);
  if (m)
  {
    lat = (Number(m[1]) + Number(m[2].replace(/ /g, "0")) / 60) * (m[3] == "S" ? -1 : 1);
    lon = (Number(m[5]) + Number(m[6].replace(/ /g, "0")) / 60) * (m[7] == "W" ? -1 : 1);
    symbol = m[4] + m[8];
    comment = m[9];
  }
  else
  {
    const c = /^([\/\\A-Za-j])([!-{]{4})([!-{]{4})(.)(...)?(.*)$/.exec(s);
    if (!c) return { kind: "other", text: s };
    const b91 = (q) => [...q].reduce((v, ch) => v * 91 + ch.charCodeAt(0) - 33, 0);
    lat = 90 - b91(c[2]) / 380926;
    lon = -180 + b91(c[3]) / 190463;
    symbol = c[1] + c[4];
    comment = c[6] || "";
  }
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return { kind: "other", text: s };
  const out = { kind, lat, lon, symbol, text: comment.trim() };
  const cs = /^(\d{3})\/(\d{3})/.exec(comment);
  if (cs)
  {
    out.course = Number(cs[1]);
    out.speed = Number(cs[2]);
    out.text = comment.slice(7).trim();
  }
  const alt = /\/A=(-?\d{6})/.exec(comment);
  if (alt)
  {
    out.altitude = Number(alt[1]);
    out.text = out.text.replace(/\/A=-?\d{6}/, "").trim();
  }
  return out;
}

// Mic-E: the latitude and three message bits in the destination's six letters, the longitude, speed, course and symbol in the information's
// first bytes (APRS 1.01, chapter 10)
const PACKET_MICE_MESSAGES = ["Emergency", "Priority", "Special", "Committed", "Returning", "In Service", "En Route", "Off Duty"];

function packetMicE(dst, s)
{
  if (dst.length != 6 || s.length < 9) return { kind: "other", text: s };
  const digit = (c) => (c >= "0" && c <= "9" ? c : c >= "A" && c <= "J" ? String(c.charCodeAt(0) - 65) : c >= "P" && c <= "Y" ? String(c.charCodeAt(0) - 80) : "0");
  const digits = [...dst].map(digit).join("");
  let lat = Number(digits.slice(0, 2)) + Number(digits.slice(2, 4) + "." + digits.slice(4, 6)) / 60;
  const high = (c) => c >= "P" && c <= "Z";
  if (!high(dst[3])) lat = -lat;
  const b = (k) => s.charCodeAt(k) - 28;
  let deg = b(1) + (high(dst[4]) ? 100 : 0);
  if (deg >= 180 && deg <= 189) deg -= 80;
  else if (deg >= 190 && deg <= 199) deg -= 190;
  let min = b(2);
  if (min >= 60) min -= 60;
  let lon = deg + (min + b(3) / 100) / 60;
  if (high(dst[5])) lon = -lon;
  let speed = b(4) * 10 + Math.floor(b(5) / 10);
  if (speed >= 800) speed -= 800;
  let course = (b(5) % 10) * 100 + b(6);
  if (course >= 400) course -= 400;
  // The message: the first three letters' bits, standard (P to Y: 1) ones only
  const bits = [0, 1, 2].map((k) => (high(dst[k]) ? 1 : 0));
  const custom = [0, 1, 2].some((k) => dst[k] >= "A" && dst[k] <= "K");
  const message = custom ? "Custom" : PACKET_MICE_MESSAGES[bits[0] * 4 + bits[1] * 2 + bits[2]];
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return { kind: "other", text: s };
  return { kind: "mice", lat, lon, symbol: s[8] + s[7], course, speed, message, text: s.slice(9).trim() };
}
