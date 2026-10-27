// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// SSDV (Slow Scan Digital Video): pictures from high altitude balloons and satellites (AMSAT-EA's HADES among them), a baseline JPEG
// cut into 256 byte packets that each stand on their own, so a packet lost costs only its part of the picture. Written from the format
// as the UKHAS wiki describes it and from JPEG itself (ITU-T T.81); the packet:
//   0      sync, 0x55
//   1      type: 0x66 (normal: 205 bytes of data, then the CRC, then 32 bytes of Reed-Solomon parity) or 0x67 (no FEC: 237 bytes of data)
//   2-5    the sender's callsign (base 40), here only part of the image's key. AMSAT-EA's GENESIS packets carry something else there
//   6      image ID, one more for each picture
//   7-8    packet ID, from 0 in each picture (big endian)
//   9, 10  width and height, pixels / 16
//   11     flags, 00qqqexx: the quality level XOR 4 (qqq), the picture's last packet (e), the luma sampling (xx: 2x2, 1x2, 2x1, 1x1;
//          horizontal by vertical)
//   12     where in the data the first MCU that begins in this packet begins (0xFF: none does)
//   13-14  that MCU's number in the picture (0xFFFF: none)
//   15 ... the data, then the CRC-32 (the usual one, as zip's) over the bytes from the type to the data's end
// The data is the JPEG's scan alone, one stream through the packets: the MCUs (Y blocks, then Cb, then Cr) in the standard Huffman
// tables (T.81 Annex K), no 0xFF00 stuffing, an MCU running on into the next packet. The first MCU that begins in a packet begins on a
// byte (the bits before it padded with ones), and its DC values are its own, not the difference from the MCU before. The quantisation
// tables are SSDV's own two, scaled by the quality level, and the picture is always Y'CbCr, both sides a multiple of 16
// Here the packets of a picture are kept as they come (in any order, again or not); a JPEG is built when asked: the MCUs read again from
// each run of packets in a row, from the first MCU that begins in the run (what comes before it belongs to an MCU begun in a packet not
// heard), and written out again as one baseline JPEG, each MCU not heard left flat mid-grey, so a picture half in is still a picture.
//   ssdvStore()                a store of pictures (a plain object)
//   ssdvAdd(store, packet)     a 256 byte packet (Uint8Array) in: { key, image, isNew, complete, held (the same packet was held
//                              already: nothing changed) }, or null when it isn't one (its CRC
//                              wrong, its header impossible). Pictures are told apart by callsign and image ID; the same ID heard again
//                              for a new picture (its size, sampling or quality changed, a packet ID seen before with other bytes, or
//                              the packet IDs gone back more than SSDV_BACK_JUMP a while after its last packet) starts a new picture
//                              under a new key
//   ssdvJpeg(image)            the picture so far as a baseline JPEG (Uint8Array)
//   ssdvInfo(image)            { width, height, packets, missing, lastPacketId, imageId, quality } for showing
//   ssdvGenesisPacket(q, size) a GENESIS SSDV packet (the 251 bytes from the type byte) made the whole 256 byte SSDV packet AMSAT-EA
//                              rebuilds, or null when its CRC is wrong; the size byte before it, when not known, found by the CRC
//                              (satWorker.js knows it, and sends the packet made here)

const SSDV_PACKET = 256;
const SSDV_HEADER = 15;
// Data bytes in a packet by type: 0x66 normal (FEC), 0x67 no FEC
const SSDV_DATA = { 0x66: 205, 0x67: 237 };
// Packet IDs gone back more than this: a new picture with the same image ID, once SSDV_BACK_JUMP_MS has gone by since the picture's last
// packet (sooner it is the picture sent again, or its signal back after a fade: the packets it misses filled in)
const SSDV_BACK_JUMP = 64;
const SSDV_BACK_JUMP_MS = 30 * 60 * 1000;
// GENESIS's sync word, which AMSAT-EA puts in the callsign's place (as satWorker.js's SAT_GENESIS_SYNC)
const SSDV_GENESIS_SYNC = 0xbf35;

// The luma sampling (horizontal, vertical) by the flags' two low bits; chroma is always one block each
const SSDV_SAMPLING = [[2, 2], [1, 2], [2, 1], [1, 1]];

// SSDV's quantisation tables (luma, chroma), in zigzag order as a DQT segment holds them, and each quality level's scale (percent): an
// entry is (entry * scale + 50) / 100, kept to 1 ... 255. Level 4 (the usual) is the tables as they are. These are the format's own
// numbers, which every SSDV encoder and decoder must share
const SSDV_DQT = [
  [16, 12, 12, 14, 12, 10, 16, 14, 14, 14, 18, 18, 16, 20, 24, 40, 26, 24, 22, 22, 24, 50, 36, 38, 30, 40, 58, 52, 62, 60, 58, 52,
    56, 56, 64, 72, 92, 78, 64, 68, 88, 70, 56, 56, 80, 110, 82, 88, 96, 98, 104, 104, 104, 62, 78, 114, 122, 112, 100, 120, 92, 102, 104, 100],
  [18, 18, 18, 22, 22, 22, 48, 26, 26, 48, 100, 66, 56, 66, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100,
    100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100]
];
const SSDV_QUALITY_SCALE = [5000, 357, 172, 116, 100, 58, 28, 0];

// The standard Huffman tables, T.81 Annex K.3: codes of each length 1 ... 16, then the values in code order
const SSDV_HUFF = {
  dc0: {
    bits: [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
    vals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
  },
  dc1: {
    bits: [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0],
    vals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
  },
  ac0: {
    bits: [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d],
    vals: [
      0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
      0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
      0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
      0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
      0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
      0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
      0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
      0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
      0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
      0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
      0xf9, 0xfa
    ]
  },
  ac1: {
    bits: [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77],
    vals: [
      0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
      0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0,
      0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
      0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
      0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
      0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
      0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
      0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
      0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
      0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
      0xf9, 0xfa
    ]
  }
};

// Each table's codes (T.81 Annex C): for writing, the code and its length by value; for reading, the largest code of each length and
// where that length's values start
let ssdvTables = null;

function ssdvHuffTables()
{
  if (ssdvTables) return ssdvTables;
  ssdvTables = {};
  for (const name of Object.keys(SSDV_HUFF))
  {
    const t = SSDV_HUFF[name];
    const code = new Uint16Array(256);
    const size = new Uint8Array(256);
    const maxCode = new Int32Array(17).fill(-1);
    const valPtr = new Int32Array(17);
    const minCode = new Int32Array(17);
    let c = 0;
    let k = 0;
    for (let len = 1; len <= 16; len++)
    {
      valPtr[len] = k;
      minCode[len] = c;
      for (let i = 0; i < t.bits[len - 1]; i++)
      {
        code[t.vals[k]] = c;
        size[t.vals[k]] = len;
        c++;
        k++;
      }
      if (t.bits[len - 1]) maxCode[len] = c - 1;
      c <<= 1;
    }
    ssdvTables[name] = { bits: t.bits, vals: t.vals, code, size, maxCode, valPtr, minCode };
  }
  return ssdvTables;
}

function ssdvStore()
{
  return { images: {}, current: {}, count: {} };
}

// CRC-32 (reflected, 0xEDB88320, from and XORed with 0xFFFFFFFF) of p from ... to - 1
let ssdvCrcTable = null;

function ssdvCrc32(p, from, to)
{
  if (!ssdvCrcTable)
  {
    ssdvCrcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++)
    {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
      ssdvCrcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = from; i < to; i++) c = ssdvCrcTable[(c ^ p[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// A packet's header, its CRC checked; null when it isn't an SSDV packet
function ssdvParse(packet)
{
  if (!packet || packet.length < SSDV_PACKET) return null;
  const type = packet[1];
  const dataLength = SSDV_DATA[type];
  if (!dataLength) return null;
  const end = SSDV_HEADER + dataLength;
  const crc = ((packet[end] << 24) | (packet[end + 1] << 16) | (packet[end + 2] << 8) | packet[end + 3]) >>> 0;
  if (ssdvCrc32(packet, 1, end) != crc) return null;
  const h = {
    type,
    callsign: ssdvHex(packet.subarray(2, 6)),
    imageId: packet[6],
    packetId: (packet[7] << 8) | packet[8],
    width: packet[9] * 16,
    height: packet[10] * 16,
    quality: ((packet[11] >> 3) & 7) ^ 4,
    eoi: (packet[11] & 4) != 0,
    mode: packet[11] & 3,
    mcuOffset: packet[12],
    mcuIndex: (packet[13] << 8) | packet[14],
    data: packet.slice(SSDV_HEADER, end)
  };
  const [hs, vs] = SSDV_SAMPLING[h.mode];
  h.mcus = (h.width / (8 * hs)) * (h.height / (8 * vs));
  if (!h.width || !h.height || h.mcus > 65535) return null;
  // An MCU beginning here: inside the data, and one of the picture's
  if (h.mcuOffset != 0xff && (h.mcuOffset >= dataLength || h.mcuIndex >= h.mcus)) return null;
  return h;
}

function ssdvHex(bytes)
{
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16).toUpperCase();
  return s;
}

function ssdvAdd(store, packet)
{
  const h = ssdvParse(packet);
  if (!h) return null;
  const base = h.callsign + "/" + h.imageId;
  let key = store.current[base];
  let image = key ? store.images[key] : null;
  if (image)
  {
    const had = image.packets.get(h.packetId);
    if (had && ssdvSameBytes(had.data, h.data)) return { key, image, isNew: false, complete: ssdvComplete(image), held: true };
    const changed = image.width != h.width || image.height != h.height || image.mode != h.mode || image.quality != h.quality;
    if (changed || had || (h.packetId + SSDV_BACK_JUMP < image.highest && Date.now() - image.heardAt > SSDV_BACK_JUMP_MS)) image = null;
  }
  let isNew = false;
  if (!image)
  {
    isNew = true;
    const n = (store.count[base] || 0) + 1;
    store.count[base] = n;
    key = n == 1 ? base : base + "#" + n;
    store.current[base] = key;
    image = {
      key,
      callsign: h.callsign,
      imageId: h.imageId,
      width: h.width,
      height: h.height,
      mode: h.mode,
      quality: h.quality,
      packets: new Map(),
      highest: -1,
      eoiId: -1
    };
    store.images[key] = image;
  }
  image.packets.set(h.packetId, h);
  image.highest = Math.max(image.highest, h.packetId);
  image.heardAt = Date.now();
  if (h.eoi) image.eoiId = h.packetId;
  return { key, image, isNew, complete: ssdvComplete(image), held: false };
}

function ssdvSameBytes(a, b)
{
  if (a.length != b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] != b[i]) return false;
  return true;
}

// Every packet up to the one marked last
function ssdvComplete(image)
{
  return image.eoiId >= 0 && image.packets.size == image.eoiId + 1 && image.highest == image.eoiId;
}

function ssdvInfo(image)
{
  const last = image.eoiId >= 0 ? image.eoiId : image.highest;
  return {
    width: image.width,
    height: image.height,
    packets: image.packets.size,
    missing: Math.max(0, last + 1 - image.packets.size),
    lastPacketId: last,
    imageId: image.imageId,
    quality: image.quality
  };
}

// ---- Reading the scan back: each MCU's blocks' coefficients (zigzag order, DC its own value), and which MCUs were read whole

// Bits from the bytes of a run of packets, most significant first; reading past the end throws
function ssdvBitReader(bytes)
{
  return {
    bytes,
    pos: 0,
    bit()
    {
      if (this.pos >= this.bytes.length * 8) throw new Error("end");
      const b = (this.bytes[this.pos >> 3] >> (7 - (this.pos & 7))) & 1;
      this.pos++;
      return b;
    },
    bits(n)
    {
      let v = 0;
      for (let i = 0; i < n; i++) v = (v << 1) | this.bit();
      return v;
    }
  };
}

// A Huffman coded value (T.81 F.2.2.3)
function ssdvDecodeHuff(r, t)
{
  let code = r.bit();
  for (let len = 1; len <= 16; len++)
  {
    if (t.maxCode[len] >= 0 && code <= t.maxCode[len] && code >= t.minCode[len]) return t.vals[t.valPtr[len] + code - t.minCode[len]];
    code = (code << 1) | r.bit();
  }
  throw new Error("bad code");
}

// A size category's extra bits as the value they stand for (T.81 F.2.2.1, EXTEND)
function ssdvExtend(v, s)
{
  return s && v < 1 << (s - 1) ? v - (1 << s) + 1 : v;
}

// One block into out (64 coefficients at at), its DC predicted from pred; the DC's own value back
function ssdvDecodeBlock(r, dcT, acT, pred, out, at)
{
  const s = ssdvDecodeHuff(r, dcT);
  if (s > 11) throw new Error("bad DC");
  const dc = pred + ssdvExtend(r.bits(s), s);
  out[at] = dc;
  for (let k = 1; k < 64; )
  {
    const rs = ssdvDecodeHuff(r, acT);
    const run = rs >> 4;
    const size = rs & 15;
    if (!size)
    {
      if (run == 15)
      {
        k += 16;
        continue;
      }
      break;
    }
    k += run;
    if (k > 63) throw new Error("bad AC");
    out[at + k] = ssdvExtend(r.bits(size), size);
    k++;
  }
  return dc;
}

// The picture's MCUs from what has come: coefficients for every MCU (zero where nothing came) and which were read whole
function ssdvDecodeImage(image)
{
  const t = ssdvHuffTables();
  const [hs, vs] = SSDV_SAMPLING[image.mode];
  const perMcu = hs * vs + 2;
  const mcus = (image.width / (8 * hs)) * (image.height / (8 * vs));
  const coef = new Int16Array(mcus * perMcu * 64);
  const have = new Uint8Array(mcus);
  const ids = Array.from(image.packets.keys()).sort((a, b) => a - b);
  const block = new Int32Array(64);
  // Each run of packets in a row: their data end to end, and where in it each packet's first MCU begins
  for (let i = 0; i < ids.length; )
  {
    let j = i;
    while (j + 1 < ids.length && ids[j + 1] == ids[j] + 1) j++;
    const run = ids.slice(i, j + 1).map((id) => image.packets.get(id));
    i = j + 1;
    let length = 0;
    for (const p of run) length += p.data.length;
    const bytes = new Uint8Array(length);
    const starts = [];
    let off = 0;
    for (const p of run)
    {
      bytes.set(p.data, off);
      if (p.mcuOffset != 0xff) starts.push({ pos: (off + p.mcuOffset) * 8, mcu: p.mcuIndex });
      off += p.data.length;
    }
    if (!starts.length) continue;
    const r = ssdvBitReader(bytes);
    let next = 0;
    let mcu = -1;
    const pred = [0, 0, 0];
    while (true)
    {
      // At a packet's first MCU (or past where it should be: out of step), on from there, its DC values its own
      if (next < starts.length && (mcu < 0 || mcu >= starts[next].mcu || r.pos > starts[next].pos))
      {
        r.pos = starts[next].pos;
        mcu = starts[next].mcu;
        pred[0] = pred[1] = pred[2] = 0;
        next++;
        while (next < starts.length && starts[next].pos <= r.pos) next++;
      }
      if (mcu >= mcus) break;
      const at = mcu * perMcu * 64;
      try
      {
        for (let b = 0; b < perMcu; b++)
        {
          const c = b < hs * vs ? 0 : b - hs * vs + 1;
          block.fill(0);
          pred[c] = ssdvDecodeBlock(r, c ? t.dc1 : t.dc0, c ? t.ac1 : t.ac0, pred[c], block, 0);
          coef.set(block, at + b * 64);
        }
        // Ran into where the next packet's first MCU begins: out of step, so not this MCU
        if (next < starts.length && r.pos > starts[next].pos) throw new Error("overran");
      }
      catch (e)
      {
        // The run's end (the MCU goes on in a packet not heard) or bits that make no sense: what was read of it let go, and on
        // from the next packet's first MCU
        coef.fill(0, at, at + perMcu * 64);
        if (next >= starts.length) break;
        mcu = -1;
        continue;
      }
      have[mcu] = 1;
      mcu++;
    }
  }
  return { hs, vs, perMcu, mcus, coef, have };
}

// ---- Writing the JPEG

function ssdvBitWriter()
{
  return {
    out: [],
    acc: 0,
    n: 0,
    put(code, len)
    {
      for (let i = len - 1; i >= 0; i--)
      {
        this.acc = (this.acc << 1) | ((code >> i) & 1);
        if (++this.n == 8)
        {
          this.out.push(this.acc);
          // Byte stuffing, as a JPEG scan needs (SSDV's data has none)
          if (this.acc == 0xff) this.out.push(0);
          this.acc = 0;
          this.n = 0;
        }
      }
    },
    // The last byte's spare bits ones (T.81 F.1.2.3)
    flush()
    {
      if (this.n) this.put(0xff, 8 - this.n);
    }
  };
}

// A value's size category and its extra bits (T.81 F.1.2.1)
function ssdvPutValue(w, t, v, run)
{
  let a = Math.abs(v);
  let s = 0;
  while (a)
  {
    s++;
    a >>= 1;
  }
  const sym = (run << 4) | s;
  w.put(t.code[sym], t.size[sym]);
  if (s) w.put(v < 0 ? v + (1 << s) - 1 : v, s);
}

function ssdvEncodeBlock(w, dcT, acT, coef, at, pred)
{
  ssdvPutValue(w, dcT, coef[at] - pred, 0);
  let run = 0;
  for (let k = 1; k < 64; k++)
  {
    const v = coef[at + k];
    if (!v)
    {
      run++;
      continue;
    }
    while (run > 15)
    {
      w.put(acT.code[0xf0], acT.size[0xf0]);
      run -= 16;
    }
    ssdvPutValue(w, acT, v, run);
    run = 0;
  }
  if (run) w.put(acT.code[0], acT.size[0]);
  return coef[at];
}

function ssdvJpeg(image)
{
  const t = ssdvHuffTables();
  const d = ssdvDecodeImage(image);
  const out = [];
  const word = (v) => out.push((v >> 8) & 255, v & 255);
  const segment = (marker, body) =>
  {
    out.push(0xff, marker);
    word(body.length + 2);
    for (const b of body) out.push(b);
  };
  out.push(0xff, 0xd8);
  // JFIF APP0: version 1.01, no density, no thumbnail
  segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  // The quantisation tables at the picture's quality
  const scale = SSDV_QUALITY_SCALE[Math.min(7, image.quality)];
  for (let q = 0; q < 2; q++)
  {
    const body = [q];
    for (const e of SSDV_DQT[q]) body.push(Math.max(1, Math.min(255, Math.floor((e * scale + 50) / 100))));
    segment(0xdb, body);
  }
  // Baseline frame: 8 bits, height, width, Y (its sampling, table 0), Cb and Cr (1x1, table 1)
  segment(0xc0, [8, image.height >> 8, image.height & 255, image.width >> 8, image.width & 255, 3,
    1, (d.hs << 4) | d.vs, 0, 2, 0x11, 1, 3, 0x11, 1]);
  for (const [name, tc] of [["dc0", 0x00], ["ac0", 0x10], ["dc1", 0x01], ["ac1", 0x11]]) segment(0xc4, [tc].concat(t[name].bits, t[name].vals));
  segment(0xda, [3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]);
  // The scan: every MCU, those not heard all zero (flat mid-grey)
  const w = ssdvBitWriter();
  const pred = [0, 0, 0];
  const ny = d.hs * d.vs;
  for (let m = 0; m < d.mcus; m++)
  {
    const at = m * d.perMcu * 64;
    for (let b = 0; b < d.perMcu; b++)
    {
      const c = b < ny ? 0 : b - ny + 1;
      pred[c] = ssdvEncodeBlock(w, c ? t.dc1 : t.dc0, c ? t.ac1 : t.ac0, d.coef, at + b * 64, pred[c]);
    }
  }
  w.flush();
  for (const b of w.out) out.push(b);
  out.push(0xff, 0xd9);
  return Uint8Array.from(out);
}

// ---- AMSAT-EA's GENESIS (HADES): an SSDV packet from satWorker.js's frame (the 251 bytes from the type byte on) as AMSAT-EA rebuilds
// it, 0x55 0x66, the sync word and the size byte (the "callsign", with the type byte), then the frame. The size byte isn't in the frame,
// so when not given each is tried until the CRC is right; null when none is
function ssdvGenesisPacket(q, sizeByte)
{
  if (!q || q.length != 251) return null;
  const pkt = new Uint8Array(SSDV_PACKET);
  pkt.set([0x55, 0x66, SSDV_GENESIS_SYNC >> 8, SSDV_GENESIS_SYNC & 255, 0]);
  pkt.set(q, 5);
  const crc = ((pkt[220] << 24) | (pkt[221] << 16) | (pkt[222] << 8) | pkt[223]) >>> 0;
  const tries = Number.isInteger(sizeByte) ? [sizeByte & 255] : Array.from({ length: 256 }, (_, i) => i);
  for (const s of tries)
  {
    pkt[4] = s;
    if (ssdvCrc32(pkt, 1, 220) == crc) return pkt;
  }
  return null;
}
