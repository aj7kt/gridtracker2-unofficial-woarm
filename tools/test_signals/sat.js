// Sat Data test signals (tools/make_test_signals.js), one file a kind, each the way its satellite sends it:
//   sat-genesis-ssdv.wav: AMSAT-EA GENESIS (HADES-SA's layout), 800 bps FSK, tones 1600 Hz apart in SSB audio: a whole SSDV picture (the
//     SSTV module's test card, sstv.js) in back to back packets, so Sat Data shows the picture complete
//   sat-funcube.wav: FUNcube, 1200 bps DBPSK (root raised cosine) on a carrier in SSB audio, AO-40 FEC: two frames of made-up telemetry
//   sat-ax100.wav: GomSpace AX100 as a rig's flat FM audio (NRZ levels, Gaussian smoothed, a little DC): two mode 5 frames at 1200 baud,
//     two mode 6 frames at 2400
// One kind a file: the FM kind's baseband audio can't share SSB audio, and the picture alone is most of a minute.
// Written from the specifications: AO-40 FEC (Phil Karn, KA9Q: RS(160,128) twice interleaved, CCSDS scrambling, r = 1/2 k = 7
// convolutional code, the 80 x 65 interleaver with its sync vector), CCSDS RS(255,223), Golay (24,12), G3RUH scrambling, AMSAT-EA's
// GENESIS framing, and SSDV (the UKHAS packet format; the JPEG coding from ITU T.81, with the tables the app's ssdv.js reads it with)
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const parity = (x) =>
{
  let p = 0;
  for (; x; x >>>= 1) p ^= x & 1;
  return p;
};
const toBits = (bytes) => bytes.flatMap((v) => [7, 6, 5, 4, 3, 2, 1, 0].map((k) => (v >> k) & 1));

// ---- CCSDS: the PN sequence (x^8 + x^7 + x^5 + x^3 + 1, all ones), RS(255,223) (field 0x187, generator roots 11 x (112 + i))
function ccsdsPn(n)
{
  const out = new Uint8Array(n);
  let reg = 0xff;
  for (let i = 0; i < n * 8; i++)
  {
    out[i >> 3] |= ((reg >> 7) & 1) << (7 - (i & 7));
    reg = ((reg << 1) | (((reg >> 7) ^ (reg >> 4) ^ (reg >> 2) ^ reg) & 1)) & 0xff;
  }
  return out;
}

const GF = (() =>
{
  const alpha = new Uint8Array(256), index = new Uint8Array(256);
  for (let i = 0, sr = 1; i < 255; i++)
  {
    alpha[i] = sr;
    index[sr] = i;
    sr <<= 1;
    if (sr & 256) sr ^= 0x187;
  }
  index[0] = 255;
  // The generator's coefficients (as alpha exponents), from its roots
  const g = new Uint8Array(33);
  g[0] = 1;
  for (let i = 0, root = 112 * 11; i < 32; i++, root += 11)
  {
    g[i + 1] = 1;
    for (let j = i; j > 0; j--) g[j] = g[j] ? g[j - 1] ^ alpha[(index[g[j]] + root) % 255] : g[j - 1];
    g[0] = alpha[(index[g[0]] + root) % 255];
  }
  return { alpha, index, gen: Array.from(g, (v) => index[v]) };
})();

// The 32 parity bytes of up to 223 data bytes
function rsParity(data)
{
  const { alpha, index, gen } = GF;
  const par = new Uint8Array(32);
  for (const d of data)
  {
    const fb = index[d ^ par[0]];
    if (fb != 255) for (let j = 1; j < 32; j++) par[j] ^= alpha[(fb + gen[32 - j]) % 255];
    par.copyWithin(0, 1);
    par[31] = fb != 255 ? alpha[(fb + gen[0]) % 255] : 0;
  }
  return par;
}

// ---- FUNcube: AO-40 FEC, 256 bytes to 5200 channel bits
const AO40_SYNC = "11111110000111011110010110010010000001000100110001011101011011000";

function ao40Encode(data)
{
  const cw = [new Uint8Array(128), new Uint8Array(128)];
  for (let i = 0; i < 256; i++) cw[i & 1][i >> 1] = data[i];
  const par = [rsParity(cw[0]), rsParity(cw[1])];
  const stream = new Uint8Array(320);
  stream.set(data);
  for (let j = 0; j < 64; j++) stream[256 + j] = par[j & 1][j >> 1];
  const pn = ccsdsPn(320);
  for (let i = 0; i < 320; i++) stream[i] ^= pn[i];
  const syms = [];
  let sr = 0;
  const enc = (bit) =>
  {
    sr = ((sr << 1) | bit) & 127;
    syms.push(parity(sr & 0x4f), 1 ^ parity(sr & 0x6d));
  };
  for (let i = 0; i < 2560; i++) enc((stream[i >> 3] >> (7 - (i & 7))) & 1);
  for (let i = 0; i < 6; i++) enc(0);
  // Row 0 the sync vector, then the symbols a row at a time; sent a column at a time
  const m = new Uint8Array(80 * 65);
  for (let c = 0; c < 65; c++) m[c] = AO40_SYNC[c] == "1" ? 1 : 0;
  m.set(syms, 65);
  const out = new Uint8Array(5200);
  for (let c = 0; c < 65; c++) for (let r = 0; r < 80; r++) out[c * 80 + r] = m[r * 65 + c];
  return out;
}

// A FUNcube-1 (id 2) frame: its real time data (battery, photocurrent, sequence as the app reads them) and text in the payload
function funcubeFrame(type, seq, rand)
{
  const d = Uint8Array.from({ length: 256 }, () => Math.floor(rand() * 256));
  d[0] = (2 << 6) | type;
  const put = (off, len, v) =>
  {
    for (let i = 0; i < len; i++)
    {
      const p = off + i, bit = Math.floor(v / 2 ** (len - 1 - i)) & 1;
      d[p >> 3] = (d[p >> 3] & ~(1 << (7 - (p & 7)))) | (bit << (7 - (p & 7)));
    }
  };
  put(72, 16, 8123 - seq * 7);
  put(56, 16, 345 + seq * 11);
  put(400, 24, 104800 + seq);
  d.set(Buffer.from(("GRIDTRACKER2 TEST SIGNAL - FUNCUBE FRAME " + (seq + 1) + " - NOT REAL TELEMETRY ").repeat(4).slice(0, 199), "latin1"), 56);
  return d;
}

function rrc(sps, alpha, span)
{
  const L = 2 * Math.round((span * sps) / 2) + 1;
  const h = new Float64Array(L);
  for (let i = 0; i < L; i++)
  {
    const t = (i - (L - 1) / 2) / sps;
    if (Math.abs(t) < 1e-9) h[i] = 1 - alpha + (4 * alpha) / Math.PI;
    else if (Math.abs(Math.abs(t) - 1 / (4 * alpha)) < 1e-9) h[i] = (alpha / Math.SQRT2) * ((1 + 2 / Math.PI) * Math.sin(Math.PI / (4 * alpha)) + (1 - 2 / Math.PI) * Math.cos(Math.PI / (4 * alpha)));
    else h[i] = (Math.sin(Math.PI * t * (1 - alpha)) + 4 * alpha * t * Math.cos(Math.PI * t * (1 + alpha))) / (Math.PI * t * (1 - (4 * alpha * t) ** 2));
  }
  return h;
}

function funcube(common)
{
  const rand = common.random(73);
  const frames = [funcubeFrame(1, 0, rand), funcubeFrame(2, 1, rand)];
  // Filler bits (the satellite sends without a break): a second before, between the frames, after
  const bits = [];
  const filler = (n) => { for (let i = 0; i < n; i++) bits.push(rand() < 0.5 ? 1 : 0); };
  filler(1200);
  for (const f of frames)
  {
    bits.push(...ao40Encode(f));
    filler(600);
  }
  filler(600);
  // Differential: a 0 turns the phase over
  const sps = common.RATE / 1200, h = rrc(sps, 0.35, 8);
  const base = new Float64Array(Math.ceil(bits.length * sps) + h.length);
  let a = 1;
  bits.forEach((bit, i) =>
  {
    if (!bit) a = -a;
    const t0 = Math.round(i * sps);
    for (let k = 0; k < h.length; k++) base[t0 + k] += a * h[k];
  });
  const s = common.buffer(base.length / common.RATE + 0.5);
  const carrier = 1200;
  for (let i = 0; i < base.length; i++) s[i] = 0.1 * base[i] * Math.cos((2 * Math.PI * carrier * i) / common.RATE);
  common.noise(s, 0.02, 74);
  return { samples: common.normalize(s, 0.7), frames };
}

// ---- AX100: mode 5 (ASM, Golay coded length, CCSDS scrambled RS codeword) and mode 6 (G3RUH scrambled: ASM, length byte, codeword)
const ASM = [0x93, 0x0b, 0x51, 0xde];
const GOLAY_H = [0x8008ed, 0x4001db, 0x2003b5, 0x100769, 0x80ed1, 0x40da3, 0x20b47, 0x1068f, 0x8d1d, 0x4a3b, 0x2477, 0x1ffe];

function golay(r)
{
  let s = 0;
  for (let i = 0; i < 12; i++) s = (s << 1) | parity(GOLAY_H[i] & r);
  return ((s & 0xfff) << 12) | (r & 0xfff);
}

function ax100Bits(data, mode)
{
  const cw = [...data, ...rsParity(data)];
  let body;
  if (mode == 5)
  {
    const pn = ccsdsPn(cw.length);
    const g = golay(0x600 | cw.length);
    body = [...ASM, (g >> 16) & 255, (g >> 8) & 255, g & 255, ...cw.map((v, i) => v ^ pn[i])];
  }
  else body = [...ASM, cw.length + 1, ...cw];
  return toBits([...new Array(40).fill(0xaa), ...body, ...new Array(8).fill(0xaa)]);
}

// A CSP header (priority 2, source 1, destination 10, ports 0 and 8) and text
function cspPacket(text)
{
  return [0x88, 0x2a, 0x08, 0x00, ...Buffer.from(text, "latin1")];
}

function ax100(common)
{
  const rand = common.random(91);
  const sends = [
    [5, 1200, cspPacket("GRIDTRACKER2 TEST AX100 MODE 5 FRAME 1")],
    [5, 1200, cspPacket("GRIDTRACKER2 TEST AX100 MODE 5 FRAME 2 / 1200 BAUD")],
    [6, 2400, cspPacket("GRIDTRACKER2 TEST AX100 MODE 6 FRAME 1")],
    [6, 2400, cspPacket("GRIDTRACKER2 TEST AX100 MODE 6 FRAME 2 / 2400 BAUD")]
  ];
  // Each frame's levels in turn (random bits before and after), Gaussian smoothed (BT 1), a little DC
  const levels = [];
  for (const [mode, baud, data] of sends)
  {
    let bits = [];
    for (let i = 0; i < 0.3 * baud; i++) bits.push(rand() < 0.5 ? 1 : 0);
    bits.push(...ax100Bits(data, mode));
    for (let i = 0; i < 0.2 * baud; i++) bits.push(rand() < 0.5 ? 1 : 0);
    if (mode == 6)
    {
      // G3RUH: each bit sent is it and the bits sent 12 and 17 before
      let sh = 0;
      bits = bits.map((b) =>
      {
        const o = b ^ ((sh >>> 11) & 1) ^ ((sh >>> 16) & 1);
        sh = ((sh << 1) | o) & 0x1ffff;
        return o;
      });
    }
    const per = common.RATE / baud;
    const n = Math.ceil(bits.length * per);
    const nrz = Float32Array.from({ length: n }, (_, i) => (bits[Math.floor(i / per)] ? 0.3 : -0.3));
    const sigma = (Math.sqrt(Math.LN2) / (2 * Math.PI)) * per, half = Math.ceil(3 * sigma);
    const g = Array.from({ length: 2 * half + 1 }, (_, i) => Math.exp(-((i - half) ** 2) / (2 * sigma * sigma)));
    const gs = g.reduce((x, y) => x + y, 0);
    for (let i = 0; i < n; i++)
    {
      let v = 0;
      for (let k = 0; k < g.length; k++) v += g[k] * nrz[Math.max(0, Math.min(n - 1, i + k - half))];
      levels.push(v / gs + 0.03);
    }
  }
  const s = common.buffer(levels.length / common.RATE + 0.5);
  s.set(levels, Math.round(0.25 * common.RATE));
  common.noise(s, 0.02, 92);
  return { samples: common.normalize(s, 0.7), frames: sends.map((x) => x[2]) };
}

// ---- SSDV (the UKHAS format: 256 byte packets, here type 0x66, 205 bytes of data, as GENESIS carries them): the picture in JPEG's
// baseline coding, 2x2 sampled colour, its MCUs' bits run on from packet to packet, each packet saying where its first MCU starts; the
// CRC-32, then RS(255,223) parity over bytes 1 to 223
let ssdvApp = null;
function ssdvTables()
{
  if (ssdvApp) return ssdvApp;
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "..", "src", "renderer", "lib", "mmd", "ssdv.js"), "utf8"), ctx);
  ssdvApp = vm.runInContext("({ huff: SSDV_HUFF, dqt: SSDV_DQT, scale: SSDV_QUALITY_SCALE })", ctx);
  return ssdvApp;
}

function crc32(p, from, to)
{
  let c = 0xffffffff;
  for (let i = from; i < to; i++)
  {
    c ^= p[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

// Zigzag order: its index to the block's (row * 8 + column)
const ZIGZAG = (() =>
{
  const z = [];
  for (let s = 0; s < 15; s++)
  {
    const cells = [];
    for (let r = 0; r < 8; r++) if (s - r >= 0 && s - r < 8) cells.push(r * 8 + s - r);
    if (s % 2 == 0) cells.reverse();
    z.push(...cells);
  }
  return z;
})();

function fdct(px)
{
  const out = new Float64Array(64);
  for (let v = 0; v < 8; v++)
  {
    for (let u = 0; u < 8; u++)
    {
      let sum = 0;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) sum += px[y * 8 + x] * Math.cos(((2 * x + 1) * u * Math.PI) / 16) * Math.cos(((2 * y + 1) * v * Math.PI) / 16);
      out[v * 8 + u] = 0.25 * (u ? 1 : Math.SQRT1_2) * (v ? 1 : Math.SQRT1_2) * sum;
    }
  }
  return out;
}

function huffCodes(t)
{
  const codes = new Map();
  let c = 0, k = 0;
  for (let len = 1; len <= 16; len++)
  {
    for (let i = 0; i < t.bits[len - 1]; i++) codes.set(t.vals[k++], [c++, len]);
    c <<= 1;
  }
  return codes;
}

// RGB (3 bytes a pixel) to SSDV packets (Uint8Array(256) each); header: the 4 "callsign" bytes (GENESIS: its sync word, size byte, type)
function ssdvEncode(rgb, width, height, quality, imageId, header)
{
  const T = ssdvTables();
  const q = T.dqt.map((t) => t.map((e) => Math.max(1, Math.min(255, Math.floor((e * T.scale[quality] + 50) / 100)))));
  const H = { dc0: huffCodes(T.huff.dc0), ac0: huffCodes(T.huff.ac0), dc1: huffCodes(T.huff.dc1), ac1: huffCodes(T.huff.ac1) };
  const planes = [new Float64Array(width * height), new Float64Array(width * height), new Float64Array(width * height)];
  for (let i = 0; i < width * height; i++)
  {
    const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
    planes[0][i] = 0.299 * r + 0.587 * g + 0.114 * b;
    planes[1][i] = -0.168736 * r - 0.331264 * g + 0.5 * b + 128;
    planes[2][i] = 0.5 * r - 0.418688 * g - 0.081312 * b + 128;
  }
  // An 8x8 block (sub: its pixels averaged sub x sub), level shifted, transformed, quantized, in zigzag order
  const block = (plane, bx, by, sub, table) =>
  {
    const px = new Float64Array(64);
    for (let y = 0; y < 8; y++)
    {
      for (let x = 0; x < 8; x++)
      {
        let sum = 0;
        for (let dy = 0; dy < sub; dy++) for (let dx = 0; dx < sub; dx++) sum += plane[(by * 8 * sub + y * sub + dy) * width + bx * 8 * sub + x * sub + dx];
        px[y * 8 + x] = sum / (sub * sub) - 128;
      }
    }
    const f = fdct(px);
    return Int32Array.from({ length: 64 }, (_, k) => Math.round(f[ZIGZAG[k]] / table[k]));
  };
  const put = (bits, codes, sym) =>
  {
    const [c, l] = codes.get(sym);
    for (let i = l - 1; i >= 0; i--) bits.push((c >> i) & 1);
  };
  const value = (bits, codes, v, run) =>
  {
    let size = 0;
    for (let a = Math.abs(v); a; a >>= 1) size++;
    put(bits, codes, (run << 4) | size);
    const e = v < 0 ? v + (1 << size) - 1 : v;
    for (let i = size - 1; i >= 0; i--) bits.push((e >> i) & 1);
  };
  const encodeBlock = (bits, z, dc, ac, pred) =>
  {
    value(bits, dc, z[0] - pred, 0);
    let run = 0;
    for (let k = 1; k < 64; k++)
    {
      if (!z[k])
      {
        run++;
        continue;
      }
      for (; run > 15; run -= 16) put(bits, ac, 0xf0);
      value(bits, ac, z[k], run);
      run = 0;
    }
    if (run) put(bits, ac, 0);
    return z[0];
  };
  const dataLen = 205, packets = [];
  let cur = [], acc = 0, nb = 0, start = null, id = 0;
  const flush = (last) =>
  {
    const p = new Uint8Array(256);
    p.set([0x55, 0x66, ...header, imageId, id >> 8, id & 255, width / 16, height / 16, ((quality ^ 4) << 3) | (last ? 4 : 0), start ? start.off : 0xff, start ? start.mcu >> 8 : 0xff, start ? start.mcu & 255 : 0xff]);
    // The rest of the last packet: filler
    for (let i = 0; i < dataLen; i++) p[15 + i] = i < cur.length ? cur[i] : 0x00;
    const c = crc32(p, 1, 15 + dataLen);
    p.set([c >>> 24, (c >> 16) & 255, (c >> 8) & 255, c & 255], 15 + dataLen);
    p.set(rsParity(p.subarray(1, 224)), 224);
    packets.push(p);
    id++;
    cur = [];
    start = null;
  };
  const pushBit = (b) =>
  {
    acc = (acc << 1) | b;
    if (++nb == 8)
    {
      cur.push(acc);
      acc = 0;
      nb = 0;
      if (cur.length == dataLen) flush(false);
    }
  };
  const mx = width / 16, my = height / 16, pred = [0, 0, 0];
  for (let m = 0; m < mx * my; m++)
  {
    if (!start)
    {
      // A packet's first MCU starts on a byte, its DC predictions from 0 (the bits before padded with ones)
      while (nb) pushBit(1);
      start = { off: cur.length, mcu: m };
      pred.fill(0);
    }
    const bits = [], x = m % mx, y = Math.floor(m / mx);
    for (let by = 0; by < 2; by++) for (let bx = 0; bx < 2; bx++) pred[0] = encodeBlock(bits, block(planes[0], x * 2 + bx, y * 2 + by, 1, q[0]), H.dc0, H.ac0, pred[0]);
    pred[1] = encodeBlock(bits, block(planes[1], x, y, 2, q[1]), H.dc1, H.ac1, pred[1]);
    pred[2] = encodeBlock(bits, block(planes[2], x, y, 2, q[1]), H.dc1, H.ac1, pred[2]);
    for (const b of bits) pushBit(b);
  }
  while (nb) pushBit(1);
  if (cur.length || start) flush(true);
  else
  {
    // The last packet filled exactly: marked the last, its CRC again
    const p = packets[packets.length - 1];
    p[11] |= 4;
    const c = crc32(p, 1, 15 + dataLen);
    p.set([c >>> 24, (c >> 16) & 255, (c >> 8) & 255, c & 255], 15 + dataLen);
    p.set(rsParity(p.subarray(1, 224)), 224);
  }
  return packets;
}

// ---- GENESIS: each SSDV packet from its type byte on (251 bytes), framed: training (0xAA), the sync word 0xBF35, the size byte, the
// packet (an SSDV packet is sent as it is), two bytes of 0xAA; FSK 800 bps, tones 1600 Hz apart
const GENESIS_SIZE = 251;
const GENESIS_TYPE = 0xa3; // SSDV (type 10) from HADES-SA (address 3)

function genesis(common, card)
{
  const packets = ssdvEncode(card.rgb, card.width, card.height, card.quality, 1, [0xbf, 0x35, GENESIS_SIZE, GENESIS_TYPE]);
  const frames = packets.map((p) => p.slice(5));
  const baud = 800, shift = 1600, low = 800, per = common.RATE / baud;
  const bursts = frames.map((f) => toBits([...new Array(12).fill(0xaa), 0xbf, 0x35, GENESIS_SIZE, ...f, 0xaa, 0xaa]));
  const gap = 0.25, lead = 1, tail = 2;
  const s = common.buffer(lead + bursts.reduce((t, b) => t + b.length / baud + gap, 0) + tail);
  let at = lead, phase = 0;
  const ramp = Math.round(0.005 * common.RATE);
  for (const bits of bursts)
  {
    const from = Math.round(at * common.RATE), n = Math.round((bits.length / baud) * common.RATE);
    for (let i = 0; i < n; i++)
    {
      phase += (2 * Math.PI * (low + (bits[Math.min(bits.length - 1, Math.floor(i / per))] ? shift : 0))) / common.RATE;
      s[from + i] += 0.2 * Math.min(1, i / ramp, (n - 1 - i) / ramp) * Math.cos(phase);
    }
    at += bits.length / baud + gap;
  }
  common.noise(s, 0.01, 81);
  return { samples: common.normalize(s, 0.7), frames, packets };
}

// The picture: the SSTV module's test card (no grid), as small as reads well, so the whole of it fits in under a minute
const CARD = { width: 192, height: 144, quality: 4 };

function build(common)
{
  const card = Object.assign({ rgb: require("./sstv.js").testCard(CARD.width, CARD.height, false) }, CARD);
  const g = genesis(common, card);
  return [
    { file: "sat-genesis-ssdv.wav", modes: ["sat"], signals: 1, description: `GENESIS (HADES-SA) 800 bps FSK, 800 / 2400 Hz: a ${card.width}x${card.height} SSDV picture (the test card) in ${g.frames.length} packets`, samples: g.samples },
    { file: "sat-funcube.wav", modes: ["sat"], signals: 1, description: "FUNcube 1200 bps DBPSK on 1200 Hz, AO-40 FEC: two frames of made-up FUNcube-1 telemetry", samples: funcube(common).samples },
    { file: "sat-ax100.wav", modes: ["sat"], signals: 1, description: "GomSpace AX100 as FM audio: two mode 5 frames at 1200 baud, two mode 6 frames at 2400 baud", samples: ax100(common).samples }
  ];
}

module.exports = { build, genesis, funcube, ax100, ssdvEncode, CARD };
