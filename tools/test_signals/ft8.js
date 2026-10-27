// FT8 and FT4 test signals (tools/make_test_signals.js): two periods of each, several stations at once on different audio frequencies and
// SNRs, the second period the first one's replies. Fictional Q-prefixed calls (no country has Q prefixes), real-shaped grids. Each file
// starts on a period boundary (sync "ft8" / "ft4": the app plays it from one), each transmission 0.5 s into its period as WSJT-X sends.
// The encoder is ft8_lib's (MIT, Karlis Goba: src/wasm/ft8/ft8_lib), ported here: the standard message packing (message.c), the CRC
// (crc.c), the LDPC (174,91) code (encode.c; its generator read from constants.c in the repo) and the GFSK waveform (as its gen_ft8 demo
// makes it: FT8 BT 2, FT4 BT 1)
const fs = require("fs");
const path = require("path");

const NTOKENS = 2063592;
const MAX22 = 4194304;
const MAXGRID4 = 32400;

// ---- ft8_lib's tables
const COSTAS8 = [3, 1, 4, 0, 6, 5, 2];
const COSTAS4 = [[0, 1, 3, 2], [1, 0, 2, 3], [2, 3, 1, 0], [3, 2, 0, 1]];
const GRAY8 = [0, 1, 3, 2, 5, 6, 4, 7];
const GRAY4 = [0, 1, 3, 2];
const FT4_XOR = [0x4a, 0x5e, 0x89, 0xb4, 0xb0, 0x8a, 0x79, 0x55, 0xbe, 0x28];

// The LDPC generator (83 rows of 12 bytes), from ft8_lib's constants.c as vendored in the repo
let generator = null;
function ldpcGenerator()
{
  if (generator) return generator;
  const text = fs.readFileSync(path.join(__dirname, "..", "..", "src", "wasm", "ft8", "ft8_lib", "ft8", "constants.c"), "utf8");
  const body = /kFTX_LDPC_generator[^=]*=\s*\{([\s\S]*?)\};/.exec(text)[1];
  generator = [...body.matchAll(/\{([^}]*)\}/g)].map((m) => m[1].split(",").map((v) => parseInt(v.trim(), 16)));
  if (generator.length != 83 || generator.some((row) => row.length != 12)) throw new Error("ft8: constants.c's LDPC generator not read");
  return generator;
}

// ---- Packing (message.c: pack_basecall, pack28, packgrid, ftx_message_encode_std)
const ALNUM_SPACE = " 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LETTERS_SPACE = " ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const isDigit = (c) => c >= "0" && c <= "9";

function packBasecall(call)
{
  let c6 = null;
  if (call.length > 2 && isDigit(call[2]) && call.length <= 6) c6 = call.padEnd(6);
  else if (call.length > 2 && isDigit(call[1]) && call.length <= 5) c6 = (" " + call).padEnd(6);
  if (!c6) return -1;
  const idx = [ALNUM_SPACE.indexOf(c6[0]), ALNUM.indexOf(c6[1]), "0123456789".indexOf(c6[2]), LETTERS_SPACE.indexOf(c6[3]), LETTERS_SPACE.indexOf(c6[4]), LETTERS_SPACE.indexOf(c6[5])];
  if (idx.some((i) => i < 0)) return -1;
  return ((((idx[0] * 36 + idx[1]) * 10 + idx[2]) * 27 + idx[3]) * 27 + idx[4]) * 27 + idx[5];
}

function pack28(call)
{
  if (call == "DE") return 0;
  if (call == "QRZ") return 1;
  if (call == "CQ") return 2;
  const cq = /^CQ ([A-Z]{1,4}|\d{3})$/.exec(call);
  if (cq) return 3 + (/^\d{3}$/.test(cq[1]) ? Number(cq[1]) : 1000 + [...cq[1]].reduce((m, c) => 27 * m + c.charCodeAt(0) - 64, 0));
  const n = packBasecall(call);
  // Standard calls only here (no hashed ones, no /P /R)
  if (n < 0) throw new Error("ft8: " + call + " isn't a standard call");
  return NTOKENS + MAX22 + n;
}

function packGrid(extra)
{
  if (!extra) return MAXGRID4 + 1;
  if (extra == "RRR") return MAXGRID4 + 2;
  if (extra == "RR73") return MAXGRID4 + 3;
  if (extra == "73") return MAXGRID4 + 4;
  if (/^[A-R]{2}\d\d$/.test(extra)) return (((extra.charCodeAt(0) - 65) * 18 + extra.charCodeAt(1) - 65) * 10 + Number(extra[2])) * 10 + Number(extra[3]);
  const r = /^(R?)([+-]\d\d)$/.exec(extra);
  if (!r) throw new Error("ft8: " + extra + " isn't a grid or report");
  return (MAXGRID4 + 35 + Number(r[2])) | (r[1] ? 0x8000 : 0);
}

// "TO DE EXTRA" (TO may be "CQ" or "CQ DX"): the 77 bit payload, 10 bytes
function packMessage(text)
{
  const w = text.split(" ");
  const cq = w[0] == "CQ" && w.length == 4;
  const to = cq ? w[0] + " " + w[1] : w[0];
  const [de, extra] = cq ? [w[2], w[3]] : [w[1], w[2]];
  const a = pack28(to) * 2, b = pack28(de) * 2, g = packGrid(extra || ""), i3 = 1;
  return Uint8Array.from([a >>> 21, a >>> 13, a >>> 5, ((a << 3) | (b >>> 26)) & 255, b >>> 18, b >>> 10, b >>> 2, ((b << 6) | (g >>> 10)) & 255, g >>> 2, ((g << 6) | (i3 << 3)) & 255].map((v) => v & 255));
}

// ---- The CRC (crc.c: 14 bits, polynomial 0x2757, over the payload zero extended to 82 bits) and the LDPC code (encode.c)
function addCrc(payload)
{
  const a91 = new Uint8Array(12);
  a91.set(payload.subarray(0, 10));
  a91[9] &= 0xf8;
  a91[10] = 0;
  let rem = 0;
  for (let bit = 0; bit < 82; bit++)
  {
    if (bit % 8 == 0) rem ^= a91[bit >> 3] << 6;
    rem = rem & 0x2000 ? (rem << 1) ^ 0x2757 : rem << 1;
  }
  const crc = rem & 0x3fff;
  a91[9] |= crc >> 11;
  a91[10] = (crc >> 3) & 255;
  a91[11] = (crc << 5) & 255;
  return a91;
}

function parity8(x)
{
  x ^= x >> 4;
  x ^= x >> 2;
  x ^= x >> 1;
  return x & 1;
}

function encode174(a91)
{
  const gen = ldpcGenerator();
  const cw = new Uint8Array(22);
  cw.set(a91);
  let mask = 0x80 >> (91 % 8), idx = 11;
  for (let i = 0; i < 83; i++)
  {
    let sum = 0;
    for (let j = 0; j < 12; j++) sum ^= parity8(a91[j] & gen[i][j]);
    if (sum) cw[idx] |= mask;
    mask >>= 1;
    if (!mask)
    {
      mask = 0x80;
      idx++;
    }
  }
  return cw;
}

const cwBit = (cw, n) => (cw[n >> 3] >> (7 - (n & 7))) & 1;

// The 79 tones of an FT8 message (S7 D29 S7 D29 S7)
function ft8Tones(text)
{
  const cw = encode174(addCrc(packMessage(text)));
  const tones = [];
  let n = 0;
  for (let i = 0; i < 79; i++)
  {
    if (i < 7 || (i >= 36 && i < 43) || i >= 72) tones.push(COSTAS8[i < 7 ? i : i < 43 ? i - 36 : i - 72]);
    else
    {
      tones.push(GRAY8[(cwBit(cw, n) << 2) | (cwBit(cw, n + 1) << 1) | cwBit(cw, n + 2)]);
      n += 3;
    }
  }
  return tones;
}

// The 105 tones of an FT4 message (R S4 D29 S4 D29 S4 D29 S4 R), its payload whitened first
function ft4Tones(text)
{
  const payload = packMessage(text).map((v, i) => v ^ FT4_XOR[i]);
  const cw = encode174(addCrc(payload));
  const tones = [];
  let n = 0;
  for (let i = 0; i < 105; i++)
  {
    if (i == 0 || i == 104) tones.push(0);
    else if ((i - 1) % 33 < 4) tones.push(COSTAS4[Math.floor((i - 1) / 33)][(i - 1) % 33]);
    else
    {
      tones.push(GRAY4[(cwBit(cw, n) << 1) | cwBit(cw, n + 1)]);
      n += 2;
    }
  }
  return tones;
}

// ---- The waveform (gen_ft8.c's synth_gfsk): each tone's frequency step smoothed by a Gaussian pulse, the first and last tones held past
// the ends, an eighth of a symbol's ramp at each end
function erf(x)
{
  // Abramowitz and Stegun 7.1.26
  const s = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
}

function gfsk(tones, f0, bt, symbolPeriod, rate)
{
  const sps = Math.round(rate * symbolPeriod), n = tones.length * sps;
  const K = Math.PI * Math.sqrt(2 / Math.LN2);
  const pulse = new Float64Array(3 * sps);
  for (let i = 0; i < 3 * sps; i++)
  {
    const t = i / sps - 1.5;
    pulse[i] = (erf(K * bt * (t + 0.5)) - erf(K * bt * (t - 0.5))) / 2;
  }
  const peak = (2 * Math.PI) / sps;
  const dphi = new Float64Array(n + 2 * sps).fill((2 * Math.PI * f0) / rate);
  tones.forEach((tone, i) => { for (let j = 0; j < 3 * sps; j++) dphi[j + i * sps] += peak * tone * pulse[j]; });
  for (let j = 0; j < 2 * sps; j++)
  {
    dphi[j] += peak * pulse[j + sps] * tones[0];
    dphi[j + n] += peak * pulse[j] * tones[tones.length - 1];
  }
  const out = new Float32Array(n);
  let phi = 0;
  for (let k = 0; k < n; k++)
  {
    out[k] = Math.sin(phi);
    phi = (phi + dphi[k + sps]) % (2 * Math.PI);
  }
  const ramp = Math.floor(sps / 8);
  for (let i = 0; i < ramp; i++)
  {
    const env = (1 - Math.cos((2 * Math.PI * i) / (2 * ramp))) / 2;
    out[i] *= env;
    out[n - 1 - i] *= env;
  }
  return out;
}

// ---- The files: [period, audio Hz (lowest tone), SNR dB in 2500 Hz, message]
const FT8 = [
  [0, 600, -4, "CQ Q1TST CN87"],
  [0, 1000, -12, "CQ DX Q2ABC FN31"],
  [0, 1450, -1, "Q3XYZ Q4GRD EM12"],
  [0, 1900, 3, "Q5RX Q6KLM -07"],
  [0, 2400, -13, "Q7ABC Q8DEF R-11"],
  [1, 800, -9, "Q1TST Q9AA DM79"],
  [1, 1250, -6, "Q4GRD Q3XYZ -04"],
  [1, 1700, 0, "Q6KLM Q5RX R-02"],
  [1, 2150, -11, "Q8DEF Q7ABC RR73"],
  [1, 2600, -13, "Q2ABC Q9ZZ FN20"]
];
const FT4 = [
  [0, 500, -2, "CQ Q1TST CN87"],
  [0, 1000, -8, "CQ Q2ABC FN31"],
  [0, 1500, 4, "Q3XYZ Q4GRD EM12"],
  [0, 2000, -5, "Q5RX Q6KLM -07"],
  [0, 2500, -10, "Q7ABC Q8DEF R-11"],
  [1, 700, -6, "Q1TST Q9AA DM79"],
  [1, 1250, 0, "Q4GRD Q3XYZ -04"],
  [1, 1800, -9, "Q6KLM Q5RX R+02"],
  [1, 2300, -3, "Q8DEF Q7ABC RR73"]
];

function makeFile(common, list, ft4)
{
  const period = ft4 ? 7.5 : 15;
  const s = common.buffer(2 * period);
  // Noise of RMS 1 over the whole 6 kHz: its power in 2500 Hz is 2500 / 6000; a tone's (A^2 / 2) that many dB above it
  common.noise(s, 1, ft4 ? 41 : 8);
  const noise2500 = 2500 / (common.RATE / 2);
  for (const [p, hz, snr, text] of list)
  {
    const wave = gfsk(ft4 ? ft4Tones(text) : ft8Tones(text), hz, ft4 ? 1 : 2, ft4 ? 0.048 : 0.16, common.RATE);
    const amp = Math.sqrt(2 * noise2500 * Math.pow(10, snr / 10));
    const at = Math.round((p * period + 0.5) * common.RATE);
    for (let i = 0; i < wave.length && at + i < s.length; i++) s[at + i] += amp * wave[i];
  }
  return common.normalize(s, 0.7);
}

function describe(list, name, period)
{
  return name + ": " + [0, 1].map((p) => "period " + (p + 1) + " (" + p * period + " s): " + list.filter((m) => m[0] == p).map((m) => m[3] + " (" + m[1] + " Hz, " + (m[2] > 0 ? "+" : "") + m[2] + " dB)").join(", ")).join("; ");
}

function build(common)
{
  return [
    { file: "ft8-5.wav", modes: ["ft8"], signals: 5, sync: "ft8", description: describe(FT8, "FT8, two 15 s periods", 15), samples: makeFile(common, FT8, false) },
    { file: "ft4-5.wav", modes: ["ft4"], signals: 5, sync: "ft4", description: describe(FT4, "FT4, two 7.5 s periods", 7.5), samples: makeFile(common, FT4, true) }
  ];
}

module.exports = { build, ft8Tones, ft4Tones, packMessage, FT8, FT4 };
