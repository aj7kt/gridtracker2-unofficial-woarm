// DominoEX and THOR test signals (tools/make_test_signals.js): dominoex-thor.wav, DominoEX and THOR stations at several speeds, some at
// once on different frequencies, no RSID. Written from Murray Greenman's (ZL1BPU) descriptions of DominoEX (IFK+ and its Nibble Varicode
// table, version 2.0 of 28 July 2009) and of THOR (Dave Freese's, W1HKJ, FEC version), as thorWorker.js's header puts it:
//   18 tones, each symbol's tone the last one's moved up by 2 plus the nibble sent (round the 18), tone spacing the baud rate (twice it
//   at 4, 5 and 8 baud); DominoEX sends each character as one to three nibbles of its varicode, THOR sends the MFSK16 varicode's bits
//   (IZ8BLY) through a rate 1/2 K = 7 convolutional code (each bit's two outputs, the taps 1 3 4 6 7 then 1 2 3 4 7 of the register, the
//   newest stage 1), four of those to a nibble (the first the highest) and a diagonal interleaver ten symbols deep (a nibble's second bit
//   sent 10 symbols after its first, the third 20, the fourth 30). Each tone is a steady tone, the phase carried on from one to the next.
// thorSend() also builds the offline tests' signals (at any rate: common.RATE). Fictional calls only (Q prefixes are never issued)

// Speeds by name: baud, and the tone spacing in bauds
const THOR_SPEEDS = {
  4: [8000 / 2048, 2],
  5: [11025 / 2048, 2],
  8: [8000 / 1024, 2],
  11: [11025 / 1024, 1],
  16: [8000 / 512, 1],
  22: [11025 / 512, 1]
};
const THOR_TONES = 18;

// DominoEX's primary varicode for ASCII 0 to 127, each nibble a hex digit sent in turn
const THOR_DEX = [
  "1f9", "1fa", "1fb", "1fc", "1fd", "1fe", "1ff", "288", "2c", "289", "28a", "28b", "28c", "2d", "28d", "28e",
  "28f", "298", "299", "29a", "29b", "29c", "29d", "29e", "29f", "2a8", "2a9", "2aa", "2ab", "2ac", "2ad", "2ae",
  "0", "7b", "08e", "0ab", "09a", "099", "08f", "7a", "08c", "08b", "09d", "088", "2b", "7e", "7d", "089",
  "3f", "4a", "4f", "59", "68", "5c", "5e", "6c", "6b", "6e", "08a", "08d", "0a8", "7f", "09f", "7c",
  "098", "39", "4e", "3c", "3e", "38", "4c", "58", "5a", "3a", "78", "6a", "4b", "48", "4d", "3b",
  "49", "6f", "3d", "2f", "2e", "5b", "6d", "5d", "5f", "69", "79", "0ae", "0a9", "0af", "0aa", "09c",
  "09b", "4", "1b", "0c", "0b", "1", "0f", "19", "0a", "5", "2a", "1e", "09", "0e", "6", "3",
  "18", "28", "7", "08", "2", "0d", "1d", "1c", "1f", "1a", "29", "0ac", "09e", "0ad", "0b8", "2af"
];

// The MFSK16 varicode (IZ8BLY): characters most used first; the nth one's code is the nth of the bit strings starting 1 and ending 00
// with no 001 in them, shortest first, then by value
const THOR_MFSK_ORDER = [32, 101, 116, 111, 97, 105, 110, 114, 115, 108, 104, 100, 99, 117, 109, 102, 112, 103, 121, 98, 119, 118, 107,
  120, 113, 122, 106, 44, 8, 13, 84, 83, 69, 65, 73, 79, 67, 82, 68, 48, 77, 80, 49, 76, 70, 78, 66, 50, 71, 51, 72, 85, 53, 87, 54,
  88, 52, 89, 75, 56, 55, 86, 57, 81, 74, 90, 39, 33, 63, 46, 45, 61, 43, 47, 58, 41, 40, 59, 34, 38, 64, 37, 36, 96, 95, 42, 124, 62,
  60, 92, 94, 35, 123, 125, 91, 93, 126];
function thorMfskCodes()
{
  const order = THOR_MFSK_ORDER.slice();
  for (let c = 160; c < 256; c++) order.push(c);
  for (let c = 0; c < 32; c++) if (c != 8 && c != 13) order.push(c);
  order.push(127);
  for (let c = 128; c < 160; c++) order.push(c);
  const codes = new Array(256);
  let n = 0;
  for (let len = 3; n < order.length; len++)
  {
    for (let v = 1 << (len - 1); v < 1 << len && n < order.length; v++)
    {
      const s = v.toString(2);
      if (s.endsWith("00") && !s.includes("001")) codes[order[n++]] = s;
    }
  }
  return codes;
}
const THOR_MFSK = thorMfskCodes();

// The convolutional code's taps (bit 0 the newest), the first sent first
const THOR_POLYS = [0x6d, 0x4f];
const THOR_DEPTH = 10;

// DominoEX: the nibbles for text; a few of the secondary alphabet's spaces (3, 8, 8: what's sent idle) before and after
function dexNibbles(text)
{
  const idle = [3, 8, 8];
  const out = [];
  for (let i = 0; i < 4; i++) out.push(...idle);
  for (const ch of text)
  {
    const c = ch == "\n" ? 13 : ch.charCodeAt(0) & 127;
    for (const d of THOR_DEX[c]) out.push(parseInt(d, 16));
  }
  for (let i = 0; i < 3; i++) out.push(...idle);
  return out;
}

function thorParity(v)
{
  let p = 0;
  for (; v; v >>= 1) p ^= v & 1;
  return p;
}

// THOR: the nibbles for text. Idle characters (NUL, printing nothing) before it fill the receiver's deinterleaver, one after it ends the
// last character, then 0s (nothing) clear the code and the interleaver
function thorNibbles(text)
{
  let bits = "";
  for (let i = 0; i < 6; i++) bits += THOR_MFSK[0];
  for (const ch of text) bits += THOR_MFSK[ch == "\n" ? 13 : ch.charCodeAt(0) & 255];
  bits += THOR_MFSK[0] + "0".repeat(120);
  const coded = [];
  let reg = 0;
  for (const b of bits)
  {
    reg = ((reg << 1) | (b == "1" ? 1 : 0)) & 127;
    coded.push(thorParity(reg & THOR_POLYS[0]), thorParity(reg & THOR_POLYS[1]));
  }
  // Four bits to a nibble, the first the highest; then the interleaver: bit i of each nibble sent 10 i symbols later
  const symbols = coded.length / 4;
  const out = [];
  for (let t = 0; t < symbols; t++)
  {
    let n = 0;
    for (let i = 0; i < 4; i++)
    {
      const from = t - THOR_DEPTH * i;
      const bit = from >= 0 ? coded[4 * from + i] : 0;
      n |= bit << (3 - i);
    }
    out.push(n);
  }
  return out;
}

// The seconds a transmission takes
function thorSeconds(mode, speed, text)
{
  const n = (mode == "thor" ? thorNibbles(text) : dexNibbles(text)).length;
  return (n + 1) / THOR_SPEEDS[speed][0];
}

// Text sent in mode ("dominoex" or "thor") at speed (4, 5, 8, 11, 16 or 22), centred on center (Hz), into s from at (seconds), amp its
// peak; drift (Hz a second) moves it along. Returns the time it ends
function thorSend(common, s, mode, speed, center, text, at, amp, drift = 0)
{
  const rate = common.RATE;
  const [baud, mult] = THOR_SPEEDS[speed];
  const spacing = baud * mult;
  const nibbles = mode == "thor" ? thorNibbles(text) : dexNibbles(text);
  // The tones: each the last moved up by 2 plus the nibble, round the 18 (the first tone 0, before the first nibble)
  const tones = [];
  let tone = 0;
  for (const n of nibbles)
  {
    tone = (tone + 2 + n) % THOR_TONES;
    tones.push(tone);
  }
  const start = Math.round(at * rate);
  const total = Math.round((tones.length / baud) * rate);
  const ramp = Math.round(0.005 * rate);
  let phase = 0;
  for (let i = 0; i < total && start + i < s.length; i++)
  {
    const t = i / rate;
    const k = Math.min(tones.length - 1, Math.floor(t * baud));
    const f = center + drift * t + (tones[k] - (THOR_TONES - 1) / 2) * spacing;
    phase += (2 * Math.PI * f) / rate;
    if (phase > Math.PI) phase -= 2 * Math.PI;
    const edge = Math.min(1, i / ramp, (total - 1 - i) / ramp);
    s[start + i] += amp * edge * Math.sin(phase);
  }
  return at + total / rate;
}

// The stations: [mode, speed, centre Hz, start (s), peak, text]
const THOR_SIGNALS = [
  ["dominoex", 11, 800, 1.0, 0.2, "CQ CQ CQ de Q1DEX Q1DEX Q1DEX pse k\n"],
  ["thor", 16, 1500, 2.0, 0.2, "CQ CQ de Q2THR Q2THR THOR16 test pse k\n"],
  ["dominoex", 22, 2300, 0.5, 0.18, "Q1DEX de Q3FST ur 599 599 name Al qth Nowhere btu\n"],
  ["dominoex", 8, 1150, 28.0, 0.2, "CQ de Q4SLO Q4SLO k\n"],
  ["thor", 11, 2000, 26.0, 0.18, "Q2THR de Q5ABC tnx fer call 73\n"],
  ["dominoex", 16, 2700, 30.0, 0.17, "GRIDTRACKER2 DOMINOEX TEST de Q6XYZ 73\n"]
];

function build(common)
{
  const names = { dominoex: "DominoEX", thor: "THOR" };
  const end = Math.max(...THOR_SIGNALS.map(([mode, speed, , at, , text]) => at + thorSeconds(mode, speed, text)));
  const s = common.buffer(Math.max(30, Math.ceil(end + 1.5)));
  for (const [mode, speed, center, at, amp, text] of THOR_SIGNALS) thorSend(common, s, mode, speed, center, text, at, amp);
  common.noise(s, 0.02, 61);
  common.normalize(s, 0.7);
  return [{
    file: "dominoex-thor.wav",
    name: "DominoEX / THOR",
    modes: ["thor"],
    signals: THOR_SIGNALS.length,
    rsid: false,
    sync: null,
    description: "DominoEX and THOR at several speeds, two or three at once: " +
      THOR_SIGNALS.map(([mode, speed, center]) => names[mode] + " " + speed + " at " + center + " Hz").join(", "),
    samples: s
  }];
}

module.exports = { build, thorSend, thorSeconds, THOR_SPEEDS };
