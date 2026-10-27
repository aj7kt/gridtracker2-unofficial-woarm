// Packet test signals (tools/make_test_signals.js): AX.25 UI frames carrying APRS, one after another. AFSK 1200 (Bell 202: 1200 Hz mark,
// 2200 Hz space, VHF APRS) with five different packets: a position with its symbol and a comment (via WIDE1-1,WIDE2-1), a status passed
// on by a digipeater, a message to another station, a weather report and an object. And HF packet's 300 baud (1600 and 1800 Hz, HF APRS)
// with three, one after another (the decoder listens there only). Written from the AX.25 2.2 and APRS 1.01 specifications: flags, the
// addresses (six letters shifted up a bit, the SSID byte, the last one's lowest bit set; a digipeater that has passed it on its H bit),
// control 0x03, PID 0xF0, the information, the FCS (CRC-16 CCITT, least significant bit first), bit stuffing, NRZI (a 0 changes the
// tone). Fictional calls (Q-prefixed: no country has them)

// ---- AX.25
function address(call, last, high)
{
  const [base, ssid] = call.replace("*", "").split("-");
  const out = [];
  for (let i = 0; i < 6; i++) out.push((i < base.length ? base.charCodeAt(i) : 32) << 1);
  // The SSID byte: reserved bits set (0x60), the SSID, the last address's bit; high: the C bit (destination) or H bit (a digipeater used)
  out.push(0x60 | (Number(ssid || 0) << 1) | (last ? 1 : 0) | (high ? 0x80 : 0));
  return out;
}

function fcs(bytes)
{
  let crc = 0xffff;
  for (const b of bytes)
  {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0x8408 : crc >>> 1;
  }
  return crc ^ 0xffff;
}

// A UI frame's bytes (FCS included): dst, src, path (a call ending in * has passed it on)
function frame(src, dst, path, info)
{
  const calls = [dst, src, ...path];
  const bytes = [];
  calls.forEach((c, i) => bytes.push(...address(c, i == calls.length - 1, i == 0 || (i >= 2 && c.endsWith("*")))));
  bytes.push(0x03, 0xf0, ...Buffer.from(info, "latin1"));
  const crc = fcs(bytes);
  bytes.push(crc & 255, crc >> 8);
  return bytes;
}

// The bits sent: flags, the frame least significant bit first with a 0 stuffed after five 1s, flags; NRZI'd into tones (0 or 1)
function frameTones(bytes, leadFlags, tailFlags)
{
  const bits = [];
  const flag = () => { for (let k = 0; k < 8; k++) bits.push((0x7e >> k) & 1); };
  for (let i = 0; i < leadFlags; i++) flag();
  let ones = 0;
  for (const b of bytes)
  {
    for (let k = 0; k < 8; k++)
    {
      const bit = (b >> k) & 1;
      bits.push(bit);
      ones = bit ? ones + 1 : 0;
      if (ones == 5)
      {
        bits.push(0);
        ones = 0;
      }
    }
  }
  for (let i = 0; i < tailFlags; i++) flag();
  let tone = 0;
  return bits.map((bit) => (tone = bit ? tone : 1 - tone));
}

// The tones as AFSK (continuous phase), from at (s); the time after
function afsk(common, s, tones, baud, mark, space, at, amp)
{
  let phase = 0;
  const from = Math.round(at * common.RATE), n = Math.round((tones.length / baud) * common.RATE);
  const ramp = Math.round(0.005 * common.RATE);
  for (let i = 0; i < n && from + i < s.length; i++)
  {
    const hz = tones[Math.min(tones.length - 1, Math.floor((i * baud) / common.RATE))] ? space : mark;
    phase += (2 * Math.PI * hz) / common.RATE;
    s[from + i] += amp * Math.min(1, i / ramp, (n - 1 - i) / ramp) * Math.sin(phase);
  }
  return at + tones.length / baud;
}

// [src, dst, path, info]
const VHF = [
  ["Q1TST-9", "APRS", ["WIDE1-1", "WIDE2-1"], "=4737.25N/12220.50W>GridTracker2 test signal, mobile on 146.520"],
  ["Q2ABC", "APRS", ["Q3DIG-1*", "WIDE2-1"], ">GridTracker2 test: status via a digipeater"],
  ["Q1TST-9", "APRS", ["WIDE2-2"], ":Q5RX-7   :Hello from the GridTracker2 test signal{01"],
  ["Q4WX-13", "APRS", [], "_10301230c220s004g009t054r000p012P008h87b10152"],
  ["Q3DIG-1", "APRS", ["WIDE2-1"], ";TESTNET  *301900z4736.00N/12219.00W-Test net Thursdays 1900 on 146.520"]
];
const HF = [
  ["Q6HF", "APRS", [], "=4041.00N/07400.00W-GridTracker2 HF packet test, 300 baud"],
  ["Q7HF-10", "APRS", [], ">HF APRS test: 10.1476 MHz LSB"],
  ["Q6HF", "APRS", [], ":Q7HF-10  :QSL, 300 baud copied{02"]
];

function make(common, list, baud, mark, space, lead, gap, seed)
{
  const parts = list.map(([src, dst, path, info]) => frameTones(frame(src, dst, path, info), lead, 3));
  const length = parts.reduce((t, p) => t + p.length / baud + gap, 0.5);
  const s = common.buffer(length + 0.5);
  let at = 0.5;
  for (const p of parts) at = afsk(common, s, p, baud, mark, space, at, 0.5) + gap;
  common.noise(s, 0.04, seed);
  return common.normalize(s, 0.7);
}

const show = (list) => list.map(([src, dst, path, info]) => src + ">" + [dst, ...path].join(",") + ":" + info).join(" | ");

function build(common)
{
  return [
    { file: "packet-aprs.wav", modes: ["packet"], signals: 1, description: "AFSK 1200 APRS, five packets one after another: " + show(VHF), samples: make(common, VHF, 1200, 1200, 2200, 30, 0.6, 51) },
    { file: "packet-hf300.wav", modes: ["packet"], signals: 1, description: "HF packet, 300 baud AFSK (1600 / 1800 Hz), three APRS packets one after another: " + show(HF), samples: make(common, HF, 300, 1600, 1800, 12, 0.8, 52) }
  ];
}

module.exports = { build, VHF, HF };
