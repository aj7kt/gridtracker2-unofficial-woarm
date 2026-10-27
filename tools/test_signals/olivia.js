// Olivia and Contestia test signals (tools/make_test_signals.js): olivia-3.wav, three transmissions one after another, each in another
// submode at another centre and each after its RSID (which in the Multi-Mode Decoder's Olivia mode sets the submode and centre).
// Written from Pawel Jalocha's (SP9VRC) description of Olivia and Nick Fedoseev's (UT2UZ) of Contestia, as oliviaWorker.js's header
// puts it: T tones B / T Hz apart around the centre, one every T / B seconds, each the Gray code of log2(T) bits; a block of 64 tones
// (Contestia 32) carries log2(T) characters of 7 bits (Contestia 6), each a Walsh function scrambled by E257E6D0291574EC (Contestia
// EDB88320) and spread over the block's tones; each tone a shaped pulse two tones long starting with a quarter turn of phase either way.
// oliviaSend() is used by mixed.js too. Fictional calls only (Q prefixes are never issued)

const OLIVIA_FORMATS = {
  olivia: { bits: 7, code: 0xe257e6d0291574ecn, shift: 13 },
  contestia: { bits: 6, code: 0xedb88320n, shift: 5 }
};
// The pulse's shape (x from -pi to pi over two tones): 1 + a1 cos x + a2 cos 2x + a3 cos 3x + a4 cos 4x
const OLIVIA_SHAPE = [1, 1.1913785723, -0.0793018558, -0.2171442026, -0.0014526076];

// Contestia's 6-bit characters: ASCII 33 to 90 as 1 to 58 (lower case sent as capitals), a space 59, a new line 60
function contestiaCode(ch)
{
  let c = ch.charCodeAt(0);
  if (c >= 97 && c <= 122) c -= 32;
  if (c == 32) return 59;
  if (c == 10 || c == 13) return 60;
  if (c >= 33 && c <= 90) return c - 32;
  throw new Error("contestia: can't send " + ch);
}

// The tones (0 the lowest) for text
function oliviaTones(mode, tones, text)
{
  const fmt = OLIVIA_FORMATS[mode];
  const n = 1 << (fmt.bits - 1);
  const bps = Math.round(Math.log2(tones));
  const chars = [];
  for (const ch of text) chars.push(mode == "contestia" ? contestiaCode(ch) : ch.charCodeAt(0) & 127);
  while (chars.length % bps) chars.push(0);
  const out = [];
  for (let blk = 0; blk < chars.length; blk += bps)
  {
    const sym = new Array(n).fill(0);
    for (let i = 0; i < bps; i++)
    {
      const c = chars[blk + i];
      const row = c % n;
      for (let j = 0; j < n; j++)
      {
        // The Walsh function's sign j (upside down for c of n and over), then scrambled
        let neg = c >= n;
        let p = row & ~j & (n - 1);
        p ^= p >> 4;
        p ^= p >> 2;
        p ^= p >> 1;
        if (p & 1) neg = !neg;
        if ((fmt.code >> BigInt((i * fmt.shift + j) % n)) & 1n) neg = !neg;
        if (neg) sym[j] |= 1 << ((i + j) % bps);
      }
    }
    for (const b of sym) out.push(b ^ (b >> 1));
  }
  return out;
}

function oliviaSeconds(mode, tones, bandwidth, text)
{
  return ((oliviaTones(mode, tones, text).length + 1) * tones) / bandwidth;
}

// Text sent in mode ("olivia" or "contestia") tones / bandwidth, centred on center (Hz), into s from at (seconds), amp about its peak;
// seed for the phase jumps. Returns the time it ends
function oliviaSend(common, s, mode, tones, bandwidth, center, text, at, amp, seed = 1)
{
  const list = oliviaTones(mode, tones, text);
  const rate = common.RATE;
  const spacing = bandwidth / tones;
  const ts = 1 / spacing;
  const random = common.random(seed);
  // The pulse peaks near 2.1 (its shape's sum): scaled so a tone's peak is about amp
  const gain = amp / 2.1;
  let phase = 0;
  for (let m = 0; m < list.length; m++)
  {
    const t0 = at + m * ts;
    phase += random() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
    const f = center + (list[m] - (tones - 1) / 2) * spacing;
    const a = Math.ceil(t0 * rate);
    const b = Math.floor((t0 + 2 * ts) * rate);
    for (let i = a; i <= b && i < s.length; i++)
    {
      const t = i / rate - t0;
      const x = -Math.PI + (Math.PI * t) / ts;
      let w = 0;
      for (let h = 0; h < OLIVIA_SHAPE.length; h++) w += OLIVIA_SHAPE[h] * Math.cos(h * x);
      s[i] += gain * w * Math.cos(2 * Math.PI * f * t + phase);
    }
  }
  return at + (list.length + 1) * ts;
}

// RSID numbers by submode
const OLIVIA_RSID = { "olivia 8/250": 69, "olivia 8/500": 72, "olivia 16/500": 70, "olivia 16/1000": 73, "olivia 32/1000": 71,
  "olivia 4/250": 75, "contestia 4/250": 55, "contestia 8/250": 49, "contestia 8/500": 52, "contestia 16/500": 50,
  "contestia 16/1000": 53, "contestia 32/1000": 51 };

// The three, one after another: [mode, tones, bandwidth, centre Hz, peak, text]
const OLIVIA_SIGNALS = [
  ["olivia", 8, 500, 900, 0.3, "CQ CQ DE Q1TST Q1TST K\n"],
  ["contestia", 8, 250, 1600, 0.3, "Q1TST DE Q2ABC 599 599 BK\n"],
  ["olivia", 16, 500, 2350, 0.3, "GRIDTRACKER2 TEST DE Q3XYZ K\n"]
];

function build(common)
{
  // Each RSID 5 seconds after the one before ends, as overs are (the decoder takes an RSID only once the signal it is on has gone
  // quiet: mmdOlivia.js)
  let t = 0.5;
  const plan = [];
  for (const [mode, tones, bandwidth, center, amp, text] of OLIVIA_SIGNALS)
  {
    plan.push({ mode, tones, bandwidth, center, amp, text, at: t });
    t += 1.858 + oliviaSeconds(mode, tones, bandwidth, text) + 5;
  }
  const s = common.buffer(Math.max(30, Math.ceil(t + 0.5)));
  plan.forEach((p, i) =>
  {
    const from = common.rsid(s, common.rsidTones(OLIVIA_RSID[p.mode + " " + p.tones + "/" + p.bandwidth]), p.center, p.at, p.amp * 0.7);
    oliviaSend(common, s, p.mode, p.tones, p.bandwidth, p.center, p.text, from, p.amp, 41 + i);
  });
  common.noise(s, 0.02, 41);
  common.normalize(s, 0.7);
  const names = { olivia: "Olivia", contestia: "Contestia" };
  return [{
    file: "olivia-3.wav",
    modes: ["olivia"],
    signals: OLIVIA_SIGNALS.length,
    rsid: true,
    sync: null,
    description: "Olivia and Contestia one after another, each after its RSID: " +
      OLIVIA_SIGNALS.map(([mode, tones, bw, center]) => names[mode] + " " + tones + "/" + bw + " at " + center + " Hz").join(", "),
    samples: s
  }];
}

module.exports = { build, oliviaSend, oliviaSeconds, OLIVIA_RSID };
