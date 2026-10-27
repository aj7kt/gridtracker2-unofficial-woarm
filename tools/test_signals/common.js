// What every test signal module shares (tools/make_test_signals.js): the rate, a buffer of silence, tones added to it, a little noise,
// the level set, and the WAV file made of it
const RATE = 12000;

// A buffer of this many seconds
function buffer(seconds)
{
  return new Float32Array(Math.round(seconds * RATE));
}

// A steady tone added (from and to in seconds, amp its peak), with 5 ms ramps at each end
function tone(s, freq, from, to, amp)
{
  const a = Math.round(from * RATE), b = Math.min(s.length, Math.round(to * RATE));
  const ramp = Math.round(0.005 * RATE);
  for (let i = a; i < b; i++)
  {
    const edge = Math.min(1, (i - a) / ramp, (b - 1 - i) / ramp);
    s[i] += amp * edge * Math.sin((2 * Math.PI * freq * (i - a)) / RATE);
  }
}

// White noise added, at this RMS; seeded, so the files come out the same each time
function noise(s, rms, seed = 1)
{
  let x = seed >>> 0 || 1;
  const rand = () =>
  {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
  for (let i = 0; i < s.length; i += 2)
  {
    // Box-Muller: two at a time
    const r = Math.sqrt(-2 * Math.log(rand() || 1e-12)) * rms;
    const t = 2 * Math.PI * rand();
    s[i] += r * Math.cos(t);
    if (i + 1 < s.length) s[i + 1] += r * Math.sin(t);
  }
}

// A seeded random number source (0 to 1), for the modules' own use
function random(seed = 1)
{
  let x = seed >>> 0 || 1;
  return () =>
  {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
}

// Scaled so its peak is this (0 to 1)
function normalize(s, peak = 0.7)
{
  let max = 0;
  for (let i = 0; i < s.length; i++) max = Math.max(max, Math.abs(s[i]));
  if (max > 0) for (let i = 0; i < s.length; i++) s[i] *= peak / max;
  return s;
}

// RSID (as fldigi sends it): 15 tones of 1024/11025 s each, 11025/1024 Hz apart, tone 0 seven spacings below the mode's frequency; the
// tones for a mode's code are rsidTones(code). Returns the time just after it plus the 5 tones' gap fldigi leaves before the mode starts
function rsid(s, tones, freq, at, amp)
{
  const len = 1024 / 11025;
  const step = 11025 / 1024;
  const f0 = freq - 7 * step;
  let p = Math.round(at * RATE), phase = 0;
  for (const t of tones)
  {
    const inc = (2 * Math.PI * (f0 + t * step)) / RATE;
    const n = Math.round(len * RATE);
    for (let j = 0; j < n && p < s.length; j++, p++)
    {
      phase += inc;
      s[p] += amp * Math.sin(phase);
    }
  }
  return p / RATE + 5 * len;
}

// An RSID's 15 tones for a mode's number (as rsidWorker.js lists them): the number's three 4-bit parts, then a Reed-Solomon code over
// GF(16) (x^4 + x^3 + 1) made by multiplying by (x + root) for each of its 12 roots
function rsidTones(code)
{
  const mul = (a, b) =>
  {
    let p = 0;
    for (let i = 0; i < 4; i++)
    {
      if (b & (1 << i)) p ^= a;
      a <<= 1;
      if (a & 0x10) a ^= 0x19;
    }
    return p;
  };
  const c = new Array(15).fill(0);
  c[0] = (code >> 8) & 15;
  c[1] = (code >> 4) & 15;
  c[2] = code & 15;
  for (const root of [2, 4, 8, 9, 11, 15, 7, 14, 5, 10, 13, 3])
  {
    for (let j = 14; j > 0; j--) c[j] = c[j - 1] ^ mul(c[j], root);
    c[0] = mul(c[0], root);
  }
  return c;
}

// A mono 16 bit PCM WAV of the samples (-1 to 1) at RATE
function wav(s)
{
  const data = Buffer.alloc(s.length * 2);
  for (let i = 0; i < s.length; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s[i] * 32767))), i * 2);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVE", 8);
  head.write("fmt ", 12);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

module.exports = { RATE, buffer, tone, noise, random, normalize, rsid, rsidTones, wav };
