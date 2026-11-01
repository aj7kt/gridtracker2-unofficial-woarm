// MFSK16 and MFSK32 test signals (tools/make_test_signals.js): mfsk-3.wav, three stations a moment apart, two MFSK16 and one MFSK32,
// with no RSID. Written from Murray Greenman's (ZL1BPU) and Nino Porcino's (IZ8BLY) published description of MFSK, as mfskWorker.js's
// header puts it: 16 tones a baud apart (MFSK16 15.625 baud, MFSK32 31.25), continuous phase, tone t carrying the bits t ^ (t >> 1);
// the text in IZ8BLY's MFSK varicode, through the rate 1/2, K = 7 code (0x6D then 0x4F, bit 0 the newest), four coded bits to a symbol
// (the first its top bit), then ten 4 x 4 diagonal interleavers (each bit 10 symbols later than the one above it). Zeros before the
// text, and after it a character that prints nothing (NUL, which ends the last one) and zeros to empty the interleaver.
// mfskSend() can be used by other modules too. Fictional calls only (Q prefixes are never issued)

const MFSK_BAUDS = { mfsk16: 15.625, mfsk32: 31.25 };
const MFSK_DEPTH = 10;
// Zero bits sent before the text (the lowest tone, 8 symbols) and after it (the interleaver emptied, and the decoder's last bits out)
const MFSK_PRE_BITS = 16;
const MFSK_POST_BITS = 80;

// IZ8BLY's MFSK varicode for character codes 0 to 255 (ISO 8859-1), each ending in its 00; sent left bit first
const MFSK_VARICODE = [
  "11101011100", "11101100000", "11101101000", "11101101100", "11101110000", "11101110100", "11101111000", "11101111100",
  "10101000", "11110000000", "11110100000", "11110101000", "11110101100", "10101100", "11110110000", "11110110100",
  "11110111000", "11110111100", "11111000000", "11111010000", "11111010100", "11111011000", "11111011100", "11111100000",
  "11111101000", "11111101100", "11111110000", "11111110100", "11111111000", "11111111100", "100000000000", "101000000000",
  "100", "111000000", "111111100", "1011011000", "1010101000", "1010100000", "1000000000", "110111100",
  "111110100", "111110000", "1010110100", "111100000", "10100000", "111011000", "111010100", "111101000",
  "11100000", "11110000", "101000000", "101010100", "101110100", "101100000", "101101100", "110100000",
  "110000000", "110101100", "111101100", "111111000", "1011000000", "111011100", "1010111100", "111010000",
  "1010000000", "10111100", "100000000", "11010100", "11011100", "10111000", "11111000", "101010000",
  "101011000", "11000000", "110110100", "101111100", "11110100", "11101000", "11111100", "11010000",
  "11101100", "110110000", "11011000", "10110100", "10110000", "101011100", "110101000", "101101000",
  "101110000", "101111000", "110111000", "1011101000", "1011010000", "1011101100", "1011010100", "1010110000",
  "1010101100", "10100", "1100000", "111000", "110100", "1000", "1010000", "1011000",
  "110000", "11000", "10000000", "1110000", "101100", "1000000", "11100", "10000",
  "1010100", "1111000", "100000", "101000", "1100", "111100", "1101100", "1101000",
  "1110100", "1011100", "1111100", "1011011100", "1010111000", "1011100000", "1011110000", "101010000000",
  "101010100000", "101010101000", "101010101100", "101010110000", "101010110100", "101010111000", "101010111100", "101011000000",
  "101011010000", "101011010100", "101011011000", "101011011100", "101011100000", "101011101000", "101011101100", "101011110000",
  "101011110100", "101011111000", "101011111100", "101100000000", "101101000000", "101101010000", "101101010100", "101101011000",
  "101101011100", "101101100000", "101101101000", "101101101100", "101101110000", "101101110100", "101101111000", "101101111100",
  "1011110100", "1011111000", "1011111100", "1100000000", "1101000000", "1101010000", "1101010100", "1101011000",
  "1101011100", "1101100000", "1101101000", "1101101100", "1101110000", "1101110100", "1101111000", "1101111100",
  "1110000000", "1110100000", "1110101000", "1110101100", "1110110000", "1110110100", "1110111000", "1110111100",
  "1111000000", "1111010000", "1111010100", "1111011000", "1111011100", "1111100000", "1111101000", "1111101100",
  "1111110000", "1111110100", "1111111000", "1111111100", "10000000000", "10100000000", "10101000000", "10101010000",
  "10101010100", "10101011000", "10101011100", "10101100000", "10101101000", "10101101100", "10101110000", "10101110100",
  "10101111000", "10101111100", "10110000000", "10110100000", "10110101000", "10110101100", "10110110000", "10110110100",
  "10110111000", "10110111100", "10111000000", "10111010000", "10111010100", "10111011000", "10111011100", "10111100000",
  "10111101000", "10111101100", "10111110000", "10111110100", "10111111000", "10111111100", "11000000000", "11010000000",
  "11010100000", "11010101000", "11010101100", "11010110000", "11010110100", "11010111000", "11010111100", "11011000000",
  "11011010000", "11011010100", "11011011000", "11011011100", "11011100000", "11011101000", "11011101100", "11011110000",
  "11011110100", "11011111000", "11011111100", "11100000000", "11101000000", "11101010000", "11101010100", "11101011000"
];

// 1 when n has an odd number of bits set
function mfskParity(n)
{
  n ^= n >> 4;
  n ^= n >> 2;
  n ^= n >> 1;
  return n & 1;
}

// The tones (0 the lowest) for text
function mfskTones(text)
{
  let bits = "0".repeat(MFSK_PRE_BITS);
  for (const ch of text) bits += MFSK_VARICODE[ch == "\n" ? 13 : ch.charCodeAt(0) & 255];
  bits += MFSK_VARICODE[0] + "0".repeat(MFSK_POST_BITS);
  // The code: two bits out for each in, 0x6D's first
  const coded = [];
  let reg = 0;
  for (const b of bits)
  {
    reg = ((reg << 1) | (b == "1" ? 1 : 0)) & 0x7f;
    coded.push(mfskParity(reg & 0x6d), mfskParity(reg & 0x4f));
  }
  // Four to a symbol, the first the top bit
  const symbols = [];
  for (let i = 0; i + 4 <= coded.length; i += 4) symbols.push((coded[i] << 3) | (coded[i + 1] << 2) | (coded[i + 2] << 1) | coded[i + 3]);
  // The interleaver: bit p (0 the top) of symbol k goes out in symbol k + 10 p
  const out = new Array(symbols.length + 3 * MFSK_DEPTH).fill(0);
  for (let k = 0; k < symbols.length; k++) for (let p = 0; p < 4; p++) if ((symbols[k] >> (3 - p)) & 1) out[k + MFSK_DEPTH * p] |= 8 >> p;
  // Tone t carries the bits t ^ (t >> 1): the tone for bits v is v's Gray code undone
  return out.map((v) => v ^ (v >> 1) ^ (v >> 2) ^ (v >> 3));
}

function mfskSeconds(submode, text)
{
  return mfskTones(text).length / MFSK_BAUDS[submode];
}

// Text sent in submode ("mfsk16" or "mfsk32"), its centre (Hz, midway between the lowest and highest tones) center, into s from at
// (seconds), amp its peak; drift (Hz a second) moves it while it's sent. Returns the time it ends
function mfskSend(common, s, submode, center, text, at, amp, drift = 0)
{
  const baud = MFSK_BAUDS[submode];
  const list = mfskTones(text);
  const rate = common.RATE;
  const a = Math.round(at * rate);
  const n = Math.round((list.length / baud) * rate);
  const ramp = Math.round(0.005 * rate);
  let phase = 0;
  for (let i = 0; i < n && a + i < s.length; i++)
  {
    const t = i / rate;
    const tone = list[Math.min(list.length - 1, Math.floor(t * baud))];
    const f = center + drift * t + (tone - 7.5) * baud;
    phase += (2 * Math.PI * f) / rate;
    if (phase > Math.PI) phase -= 2 * Math.PI;
    const edge = Math.min(1, i / ramp, (n - 1 - i) / ramp);
    s[a + i] += amp * edge * Math.sin(phase);
  }
  return at + n / rate;
}

// The three: [submode, centre Hz, start (s), peak, text]
const MFSK_SIGNALS = [
  ["mfsk16", 700, 0.5, 0.2, "CQ CQ CQ de Q1ABC Q1ABC Q1ABC pse k\n"],
  ["mfsk32", 1500, 3.0, 0.18, "Q1ABC de Q2XYZ Q2XYZ ge om, ur rst 599 599 name Bo qth Nowhere, hw? Q1ABC de Q2XYZ k\n"],
  ["mfsk16", 2300, 6.0, 0.16, "GRIDTRACKER2 MFSK16 TEST de Q3KLM Q3KLM 73\n"]
];

function build(common)
{
  const end = Math.max(...MFSK_SIGNALS.map(([submode, , at, , text]) => at + mfskSeconds(submode, text)));
  const s = common.buffer(Math.max(30, Math.ceil(end + 1.5)));
  for (const [submode, center, at, amp, text] of MFSK_SIGNALS) mfskSend(common, s, submode, center, text, at, amp);
  common.noise(s, 0.02, 51);
  common.normalize(s, 0.7);
  const names = { mfsk16: "MFSK16", mfsk32: "MFSK32" };
  return [{
    file: "mfsk-3.wav",
    modes: ["mfsk"],
    signals: MFSK_SIGNALS.length,
    rsid: false,
    sync: null,
    description: "Three MFSK signals a moment apart: " + MFSK_SIGNALS.map(([submode, center]) => names[submode] + " at " + center + " Hz").join(", "),
    samples: s
  }];
}

module.exports = { build, mfskSend, mfskSeconds, mfskTones };
