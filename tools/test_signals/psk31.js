// PSK31 test signals (tools/make_test_signals.js): psk31-5.wav, five BPSK31 signals at once on different carriers, starting a moment
// apart, two of them after their RSID (BPSK31). BPSK31 as sent: 31.25 symbols a second, a 0 a phase reversal and a 1 none, the size
// following a raised cosine through each reversal (so the signal is about 60 Hz wide); text in varicode, each character followed by
// 00; 32 reversals before the text and after it. psk-variants.wav: PSK63 and PSK125 (BPSK31 sent two and four times as fast, two and
// four times as wide) and QPSK31, two of each at once. QPSK31 (as Peter Martinez G3PLX describes PSK31's QPSK mode): the same varicode
// through a rate 1/2 convolutional code (constraint length 5, generator polynomials 0x19 and 0x17), its two bits a symbol's phase change
// (00 180 degrees, so a run of 0s is reversals as in BPSK; 10 none; 01 -90, 11 +90). pskSend() is used by mixed.js too. Fictional
// calls only (Q prefixes are never issued)

const PSK_BAUD = 31.25;
// Varicode (PSK31's alphabet) for ASCII 0 to 127
const PSK_VARICODE = [
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
const PSK_PREAMBLE = 32;
const PSK_POSTAMBLE = 32;
// QPSK31's convolutional code: the generator polynomials over the last five bits (the newest the lowest), and each pair of bits'
// phase change (radians, by the first polynomial's bit times 2 plus the second's)
const PSK_QPSK_POLYS = [0x19, 0x17];
const PSK_QPSK_TURNS = [Math.PI, -Math.PI / 2, 0, Math.PI / 2];

// The bits sent for text: the reversals before, each character's varicode and 00, the reversals after
function pskBits(text)
{
  let bits = "0".repeat(PSK_PREAMBLE);
  for (const ch of text)
  {
    const code = PSK_VARICODE[ch.charCodeAt(0) & 127];
    bits += code + "00";
  }
  return bits + "0".repeat(PSK_POSTAMBLE);
}

// The seconds text takes (with a symbol each to fade in and out), at baud
function pskSeconds(text, baud = PSK_BAUD)
{
  return (pskBits(text).length + 2) / baud;
}

// A bit's parity (the number of 1s, odd or even)
function pskParity(v)
{
  let p = 0;
  for (; v; v >>= 1) p ^= v & 1;
  return p;
}

// Text sent at freq (Hz) into s from at (seconds), amp its peak; returns the time it ends. opts: baud (31.25), qpsk (false)
function pskSend(common, s, freq, text, at, amp, opts = {})
{
  if (opts.qpsk) return pskSendQpsk(common, s, freq, text, at, amp, opts.baud || PSK_BAUD);
  const baud = opts.baud || PSK_BAUD;
  const sps = common.RATE / baud;
  // The levels symbol by symbol: 0 (off), then +-1, then 0 again
  const levels = [0];
  let level = 1;
  levels.push(level);
  for (const b of pskBits(text))
  {
    if (b == "0") level = -level;
    levels.push(level);
  }
  levels.push(0);
  const start = Math.round(at * common.RATE);
  for (let k = 1; k < levels.length; k++)
  {
    const prev = levels[k - 1], cur = levels[k];
    const a = start + Math.round((k - 1) * sps), b = start + Math.round(k * sps);
    for (let i = a; i < b && i < s.length; i++)
    {
      const c = Math.cos((Math.PI * (i - a)) / (b - a));
      const env = (prev * (1 + c)) / 2 + (cur * (1 - c)) / 2;
      s[i] += amp * env * Math.sin((2 * Math.PI * freq * i) / common.RATE);
    }
  }
  return at + (levels.length - 1) / baud;
}

// QPSK: each bit into the encoder, its two bits the phase change; the size and phase moving from one symbol's point to the next's
// along a raised cosine (as BPSK's do)
function pskSendQpsk(common, s, freq, text, at, amp, baud)
{
  const sps = common.RATE / baud;
  const points = [[0, 0]];
  let phase = 0;
  let reg = 0;
  points.push([1, 0]);
  for (const b of pskBits(text))
  {
    reg = ((reg << 1) | (b == "1" ? 1 : 0)) & 31;
    phase += PSK_QPSK_TURNS[(pskParity(reg & PSK_QPSK_POLYS[0]) << 1) | pskParity(reg & PSK_QPSK_POLYS[1])];
    points.push([Math.cos(phase), Math.sin(phase)]);
  }
  points.push([0, 0]);
  const start = Math.round(at * common.RATE);
  for (let k = 1; k < points.length; k++)
  {
    const prev = points[k - 1], cur = points[k];
    const a = start + Math.round((k - 1) * sps), b = start + Math.round(k * sps);
    for (let i = a; i < b && i < s.length; i++)
    {
      const c = Math.cos((Math.PI * (i - a)) / (b - a));
      const re = (prev[0] * (1 + c)) / 2 + (cur[0] * (1 - c)) / 2;
      const im = (prev[1] * (1 + c)) / 2 + (cur[1] * (1 - c)) / 2;
      const w = (2 * Math.PI * freq * i) / common.RATE;
      s[i] += amp * (re * Math.sin(w) + im * Math.cos(w));
    }
  }
  return at + (points.length - 1) / baud;
}

// The five: [carrier Hz, start (s), peak, RSID first, text]
const PSK_SIGNALS = [
  [600, 0.5, 0.2, true, "CQ CQ CQ de Q1TST Q1TST pse k"],
  [900, 3.0, 0.18, false, "Q1TST de Q2ABC Q2ABC gm, ur 599 599 name Al, hw? btu"],
  [1250, 1.5, 0.2, false, "CQ CQ de Q3XYZ Q3XYZ Q3XYZ pse k"],
  [1650, 4.5, 0.16, true, "Q3XYZ de Q4KLM tnx fer call, rst 579 579 op Ed qth Nowhere btu"],
  [2100, 2.0, 0.17, false, "GRIDTRACKER2 TEST SIGNAL de N0CALL 73"]
];

// psk-variants.wav's six: [carrier Hz, baud, QPSK, start (s), peak, text]
const PSK_VARIANTS = [
  [600, 62.5, false, 1.0, 0.18, "CQ CQ CQ de Q5SIX Q5SIX Q5SIX PSK63 pse k"],
  [900, 31.25, true, 2.0, 0.18, "CQ CQ de Q6QPK Q6QPK QPSK31 pse k"],
  [1300, 125, false, 1.5, 0.2, "Q7FST de Q7FST PSK125 test, 599 599 name Bo qth Nowhere btu"],
  [1750, 62.5, false, 3.0, 0.16, "Q5SIX de Q8ABC ur 579 579 op Di, hw? btu"],
  [2250, 125, false, 4.0, 0.17, "GRIDTRACKER2 PSK125 TEST SIGNAL de Q9XYZ 73"],
  [2700, 31.25, true, 0.5, 0.17, "Q6QPK de Q4KLM tnx fer call 73"]
];

// BPSK31's RSID number
const PSK_RSID = 1;

function build(common)
{
  const plan = PSK_SIGNALS.map(([freq, at, amp, rsid, text]) => ({ freq, at, amp, rsid, text, start: rsid ? at + 1.858 : at }));
  const end = Math.max(...plan.map((p) => p.start + pskSeconds(p.text)));
  const s = common.buffer(Math.max(30, Math.ceil(end + 1.5)));
  for (const p of plan)
  {
    const from = p.rsid ? common.rsid(s, common.rsidTones(PSK_RSID), p.freq, p.at, p.amp) : p.at;
    pskSend(common, s, p.freq, p.text, from, p.amp);
  }
  common.noise(s, 0.02, 21);
  common.normalize(s, 0.7);
  const v = common.buffer(Math.max(20, Math.ceil(Math.max(...PSK_VARIANTS.map(([, baud, , at, , text]) => at + pskSeconds(text, baud))) + 1.5)));
  for (const [freq, baud, qpsk, at, amp, text] of PSK_VARIANTS) pskSend(common, v, freq, text, at, amp, { baud, qpsk });
  common.noise(v, 0.02, 22);
  common.normalize(v, 0.7);
  return [{
    file: "psk31-5.wav",
    modes: ["psk31"],
    signals: PSK_SIGNALS.length,
    rsid: true,
    sync: null,
    description: "Five BPSK31 signals at once (" + PSK_SIGNALS.map(([f]) => f).join(", ") + " Hz), those at " +
      PSK_SIGNALS.filter((p) => p[3]).map(([f]) => f).join(" and ") + " Hz after their RSID",
    samples: s
  }, {
    file: "psk-variants.wav",
    name: "PSK63, PSK125, QPSK31",
    modes: ["psk31"],
    signals: PSK_VARIANTS.length,
    rsid: false,
    sync: null,
    description: "PSK63 at " + PSK_VARIANTS.filter((p) => p[1] == 62.5).map(([f]) => f).join(" and ") + " Hz, PSK125 at " +
      PSK_VARIANTS.filter((p) => p[1] == 125).map(([f]) => f).join(" and ") + " Hz and QPSK31 at " +
      PSK_VARIANTS.filter((p) => p[2]).map(([f]) => f).join(" and ") + " Hz, all at once",
    samples: v
  }];
}

module.exports = { build, pskSend, pskSeconds, PSK_RSID };
