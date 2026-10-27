// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Multi-Mode Decoder's Packet mode (mmdPacket.js): AX.25 frames from the input's audio at its own rate, four ways at once (HF
// packet's 300 baud is AFSK 1200's way with its own tones, 1600 and 1800 Hz; GMSK 4800 FSK 9600's at half the speed).
//   AFSK 1200 (Bell 202: 1200 Hz mark, 2200 Hz space; APRS on 144.390 MHz, the ISS's digipeater): each tone's strength over a bit
//   (mixed down and summed over one bit's samples), then mark less space, weighed several ways (an FM rig's de-emphasis leaves 2200 Hz
//   weaker, a transmitter's pre-emphasis stronger), each weighing with its own clock, as Direwolf's slicers: one catches what another misses.
//   FSK 9600 (G3RUH, from a rig's flat 9600 audio): the audio summed over a bit, its level's middle taken off, sliced; descrambled
//   (x^17 + x^12 + 1).
// Each bit stream: a clock recovered from its transitions (a phase nudged toward them), NRZI, HDLC (flags, bit stuffing, aborts), the
// frame's CRC (CCITT, as X.25) checked. A good frame is read: its addresses, and for APRS its position, message, status ... A frame two
// demodulators both decode goes out once
// In:  { type: "init", rate }, { type: "audio", samples }, { type: "reset" }
// Out: { type: "frame", baud, src, dst, path, info, aprs }

const PACKET_MARK = 1200;
const PACKET_SPACE = 2200;
// Frame length in bytes, the CRC's two included: the shortest with two addresses and a control byte, the longest AX.25 allows
const PACKET_MIN_BYTES = 17;
const PACKET_MAX_BYTES = 340;
// The same frame from another demodulator within this long goes out once (ms)
const PACKET_DEDUPE_MS = 3000;

let packetRate = 48000;
let packetDemods = [];
const packetRecent = new Map();

self.onmessage = (event) =>
{
  const m = event.data;
  if (m.type == "init") packetInit(m.rate);
  else if (m.type == "reset") packetInit(packetRate);
  else if (m.type == "audio")
  {
    if (packetDemods.length == 0) packetInit(packetRate);
    const x = m.samples;
    for (const d of packetDemods) d.run(x);
  }
};

function packetInit(rate)
{
  packetRate = rate > 0 ? rate : 48000;
  // AFSK 1200 (VHF), and HF packet's 300 baud (1600 and 1800 Hz: HF APRS on 10.1476 MHz)
  packetDemods = [packetAfsk(packetRate), packetAfsk(packetRate, 300, 1600, 1800)];
  // G3RUH at 9600 and 4800 (cubesats' GMSK), each needing over twice its baud rate in samples
  for (const baud of [9600, 4800]) if (packetRate >= baud * 2) packetDemods.push(packetFsk(packetRate, baud));
  packetRecent.clear();
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

// The bits, least significant first, as bytes; the frame kept when its CRC (the last two bytes) is right, or once put right (packetFix)
function packetFrameOut(bits, length, baud)
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
  packetRecent.set(key, now);
  frame.baud = baud;
  frame.aprs = frame.ui ? packetAprs(frame) : null;
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
