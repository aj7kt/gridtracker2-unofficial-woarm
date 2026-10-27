// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// SPY Server by Airspy as a Rig Control VFO (its protocol "spyserver", rig.js): the VFO is the frequency the server's I/Q stream is
// centred on, read as the server tells it and tuned by setting it. An SDR has no mode: the VFO says USB, which is what the I/Q gives
// the Multi-Mode Decoder (its Input Device menu lists each SPY Server VFO's I/Q: rigIq.js). One TCP connection carries both.
//   The protocol (SPY Server 2.0, little-endian): each command a header (its type, its body's size) and a body; HELLO first, with the
//   protocol version and the client's name. The server answers with DEVICE_INFO (the device, its sample rate, its decimation stages)
//   and CLIENT_SYNC (whether this client may tune, the gain, where the I/Q is centred), and sends CLIENT_SYNC again as the device itself
//   is retuned (not when the I/Q moves within its span: what this client set is taken as the frequency, setFreq).
//   Each server message has a 20-byte header: protocol, type (its upper 16 bits: the I/Q's digital gain in dB), stream, sequence, body size.
//   The I/Q comes only while asked for: 16-bit pairs, at the device's sample rate divided by 2 to the power of the decimation asked.
// A PING each poll keeps the connection alive; its PONG marks a whole read (rigReadWhole)

const SPY_PROTOCOL_VERSION = (2 << 24) | (0 << 16) | 1700;
const SPY_CMD_HELLO = 0;
const SPY_CMD_SET_SETTING = 2;
const SPY_CMD_PING = 3;
const SPY_SETTING_STREAMING_MODE = 0;
const SPY_SETTING_STREAMING_ENABLED = 1;
const SPY_SETTING_IQ_FORMAT = 100;
const SPY_SETTING_IQ_FREQUENCY = 101;
const SPY_SETTING_IQ_DECIMATION = 102;
const SPY_SETTING_IQ_DIGITAL_GAIN = 103;
const SPY_STREAM_MODE_IQ = 1;
const SPY_FORMAT_INT16 = 2;
const SPY_MSG_DEVICE_INFO = 0;
const SPY_MSG_CLIENT_SYNC = 1;
const SPY_MSG_PONG = 2;
const SPY_MSG_INT16_IQ = 101;
const SPY_HEADER_BYTES = 20;
// A message bigger than this is taken as the stream gone wrong (the server's own limit is 1 MiB)
const SPY_BODY_MAX = 1 << 21;
const SPY_DEVICES = { 1: "Airspy", 2: "Airspy HF+", 3: "RTL-SDR" };
// The share of an I/Q stream's sample rate that is usable (the rest is the decimation filter's skirts)
const SPY_IQ_USABLE = 0.8;

RIG_PROTOCOLS.spyserver = {
  name: "SPY Server by Airspy",
  serial: false,
  // Bytes, not text lines; its own TCP port (spyPort)
  raw: true,
  portKey: "spyPort",
  portDefault: 5555,
  caps: (R) =>
  {
    R.spyIn = Buffer.alloc(0);
    R.spyInfo = null;
    R.spySync = null;
    R.spyTuned = null;
    R.dual = false;
    const name = Buffer.from("GridTracker2", "ascii");
    // The I/Q its stream from the start (nothing comes until it is turned on): the server takes an I/Q frequency only in that mode
    return Buffer.concat([rigSpyCommand(SPY_CMD_HELLO, [SPY_PROTOCOL_VERSION], name), rigSpySetting(SPY_SETTING_STREAMING_MODE, SPY_STREAM_MODE_IQ)]);
  },
  poll: () => rigSpyCommand(SPY_CMD_PING, []),
  // Within what the server allows the I/Q to be centred on; nothing while this client may not tune it. The server says nothing back when
  // the I/Q moves within the device's own span (CLIENT_SYNC comes when the device itself is retuned, and may be late): what was set is
  // the VFO's frequency from the PONG after it on (the server answers in order), and only this client can tune it
  setFreq: (hz, R) =>
  {
    const S = R.spySync;
    if (!S || !S.canControl) return null;
    const freq = Math.round(Math.max(S.minIq || 0, Math.min(S.maxIq || hz, hz)));
    R.spyTuned = freq;
    return rigSpySetting(SPY_SETTING_IQ_FREQUENCY, freq);
  },
  setMode: () => null,
  receive: (data, R) => rigSpyReceive(data, R),
  // Its I/Q, for the Multi-Mode Decoder (rigIq.js)
  iq: { name: "SPY Server", start: (R, minRate, onIq) => rigSpyIqStart(R, minRate, onIq), stop: (R) => rigSpyIqStop(R) }
};

function rigSpyCommand(type, words, tail = null)
{
  const body = Buffer.alloc(words.length * 4);
  words.forEach((word, i) => body.writeUInt32LE(word >>> 0, i * 4));
  const all = tail ? Buffer.concat([body, tail]) : body;
  const head = Buffer.alloc(8);
  head.writeUInt32LE(type, 0);
  head.writeUInt32LE(all.length, 4);
  return Buffer.concat([head, all]);
}

function rigSpySetting(setting, value)
{
  return rigSpyCommand(SPY_CMD_SET_SETTING, [setting, value]);
}

// The server's messages, whole ones as they complete
function rigSpyReceive(data, R)
{
  R.spyIn = R.spyIn && R.spyIn.length ? Buffer.concat([R.spyIn, data]) : Buffer.from(data);
  while (R.spyIn.length >= SPY_HEADER_BYTES)
  {
    const type = R.spyIn.readUInt32LE(4);
    const size = R.spyIn.readUInt32LE(16);
    if (size > SPY_BODY_MAX)
    {
      rigFail(R, "bad message");
      return;
    }
    if (R.spyIn.length < SPY_HEADER_BYTES + size) break;
    const body = R.spyIn.subarray(SPY_HEADER_BYTES, SPY_HEADER_BYTES + size);
    R.spyIn = R.spyIn.subarray(SPY_HEADER_BYTES + size);
    rigSpyMessage(R, type & 0xffff, type >>> 16, body);
  }
}

function rigSpyMessage(R, type, flags, body)
{
  const word = (i) => (body.length >= (i + 1) * 4 ? body.readUInt32LE(i * 4) : 0);
  if (type == SPY_MSG_DEVICE_INFO)
  {
    R.spyInfo = { device: word(0), maxRate: word(2), stages: word(4), maxGain: word(6), minDecimation: word(10) };
    R.model = (SPY_DEVICES[R.spyInfo.device] || "SDR") + " (SPY Server)";
    // A decoder already listening to it (connected again): its stream asked for again
    if (R.spyIq) rigSpyIqSend(R);
  }
  else if (type == SPY_MSG_CLIENT_SYNC)
  {
    R.spySync = { canControl: word(0) == 1, gain: word(1), iqCenter: word(3), minIq: word(5), maxIq: word(6) };
    // Its centre only until this client has tuned it (rigSpy setFreq)
    if (R.spyTuned === null) R.freq = R.spySync.iqCenter || null;
    R.mode = "USB";
  }
  else if (type == SPY_MSG_PONG)
  {
    if (R.spyTuned !== null) R.freq = R.spyTuned;
    R.mode = R.mode || "USB";
    R.readSeq = R.tuneSeq;
    rigReadWhole(R);
  }
  else if (type == SPY_MSG_INT16_IQ && R.spyIq && body.length >= 4)
  {
    // The samples scaled to ±1, the digital gain the server added taken off
    const n = body.length >> 1;
    const scale = 1 / (32768 * Math.pow(10, flags / 20));
    const iq = new Float32Array(n);
    for (let i = 0; i < n; i++) iq[i] = body.readInt16LE(i * 2) * scale;
    try
    {
      R.spyIq.onIq(iq, R.spyIq.rate);
    }
    catch (e)
    {
      // The listener's window gone: its stream turned off
      rigSpyIqStop(R);
    }
  }
}

// ---- The I/Q, for the Multi-Mode Decoder's Input Device (rigIq.js)

// The rate a stream asked to carry at least minRate (complex samples a second, usable) comes at: the device's rate halved by the most
// decimation stages that still give it; null before the server has said what it is
function rigSpyIqRate(R, minRate)
{
  const info = R.spyInfo;
  if (!info || !(info.maxRate > 0)) return null;
  let stage = Math.max(0, info.minDecimation || 0);
  while (stage + 1 < Math.max(1, info.stages) && (info.maxRate / Math.pow(2, stage + 1)) * SPY_IQ_USABLE >= minRate) stage++;
  return { stage: stage, rate: info.maxRate / Math.pow(2, stage) };
}

// A SPY Server's I/Q (its rig), at least minRate wide: onIq(samples: Float32Array of I and Q in turn, rate) as it comes. One listener per
// server: a new one takes its place. Asked for again whenever the server is connected again. The rate it will come at (null: not known
// yet, the server not connected)
function rigSpyIqStart(R, minRate, onIq)
{
  R.spyIq = { minRate: minRate, onIq: onIq, rate: null };
  if (!R.spyInfo || R.status != "connected") return null;
  rigSpyIqSend(R);
  return R.spyIq.rate;
}

function rigSpyIqStop(R)
{
  if (!R || !R.spyIq) return;
  R.spyIq = null;
  if (R.status == "connected") rigWrite(R, rigSpySetting(SPY_SETTING_STREAMING_ENABLED, 0));
}

// The stream's settings to the server: I/Q only, 16-bit, the decimation for the rate wanted and its digital gain, then on. Each stage
// halves the bandwidth and takes 3 dB of noise with it, the 16-bit scale staying as it is: the gain (dB) puts that back, so the samples
// aren't left a few counts big (an Airspy One's own gain range not used is added too). Each message says the gain it carries, and it is
// taken off again as the samples are read (rigSpyMessage)
function rigSpyIqSend(R)
{
  const pick = rigSpyIqRate(R, R.spyIq.minRate);
  if (!pick) return;
  R.spyIq.rate = pick.rate;
  const info = R.spyInfo;
  const spare = info.device == 1 && R.spySync ? Math.max(0, info.maxGain - R.spySync.gain) : 0;
  const gain = Math.round(spare + pick.stage * 3.01);
  for (const [setting, value] of [[SPY_SETTING_STREAMING_MODE, SPY_STREAM_MODE_IQ], [SPY_SETTING_IQ_FORMAT, SPY_FORMAT_INT16], [SPY_SETTING_IQ_DECIMATION, pick.stage], [SPY_SETTING_IQ_DIGITAL_GAIN, gain], [SPY_SETTING_STREAMING_ENABLED, 1]])
  {
    rigWrite(R, rigSpySetting(setting, value));
  }
}
