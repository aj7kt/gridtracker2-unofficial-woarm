// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// An SDR server's I/Q at the device's full rate (SDR++ Server's baseband: rigSdrpp.js) brought down to the rate the Multi-Mode Decoder
// asked for, off the main window's thread. Each packet: 8 bytes (its sample type at 2, a 16-bit number: 0 8-bit, 1 16-bit, 2 float; its
// scale at 4, a float: a sample is its value over the type's full scale, times it), then I and Q in turn.
// Then stages, each halving the rate, each run over the whole packet at once: a half-band low-pass, 31 taps, every other output kept.
// A half-band filter's taps are 0 at every even distance from its middle but the middle, and the same either side: each output is the
// middle sample times a half, and 8 pairs each times one tap (written out below).
// In:  { type: "config", stages }, { type: "data", buf: ArrayBuffer }, { type: "reset" }
// Out: Float32Array of I and Q in turn, at the device's rate / 2^stages, one for each packet that gave any

const HB_TAPS = 31;
const HB_C = 15;

// The taps at distances 1, 3 ... 15 from the middle, and the middle's: a Blackman-windowed sinc cut at a quarter of the rate, its sum 1
const HB = (() =>
{
  let sum = 0;
  const lp = [];
  for (let i = 0; i < HB_TAPS; i++)
  {
    const m = i - HB_C;
    const sinc = m == 0 ? 0.5 : Math.sin((Math.PI / 2) * m) / (Math.PI * m);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (HB_TAPS - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (HB_TAPS - 1));
    lp.push(sinc * w);
    sum += sinc * w;
  }
  return { mid: lp[HB_C] / sum, odd: [1, 3, 5, 7, 9, 11, 13, 15].map((m) => lp[HB_C + m] / sum) };
})();
const [G1, G3, G5, G7, G9, G11, G13, G15] = HB.odd;
const GMID = HB.mid;

// Each stage: I's and Q's history, each kept twice over so its taps read it in one straight run; whether the next input makes an output
let stages = [];

function makeStage()
{
  return { xi: new Float32Array(HB_TAPS * 2), xq: new Float32Array(HB_TAPS * 2), pos: 0, odd: false };
}

// A stage over n samples (I and Q in turn in input): its outputs into output, how many
function stageRun(s, input, n, output)
{
  const xi = s.xi, xq = s.xq;
  let pos = s.pos, odd = s.odd, o = 0;
  for (let j = 0; j < n; j++)
  {
    const i = input[2 * j], q = input[2 * j + 1];
    xi[pos] = xi[pos + HB_TAPS] = i;
    xq[pos] = xq[pos + HB_TAPS] = q;
    pos = pos + 1 == HB_TAPS ? 0 : pos + 1;
    odd = !odd;
    if (odd) continue;
    // The history runs oldest to newest from pos: its middle at pos + 15
    const c = pos + HB_C;
    output[o++] = GMID * xi[c] + G1 * (xi[c - 1] + xi[c + 1]) + G3 * (xi[c - 3] + xi[c + 3]) + G5 * (xi[c - 5] + xi[c + 5]) + G7 * (xi[c - 7] + xi[c + 7]) +
      G9 * (xi[c - 9] + xi[c + 9]) + G11 * (xi[c - 11] + xi[c + 11]) + G13 * (xi[c - 13] + xi[c + 13]) + G15 * (xi[c - 15] + xi[c + 15]);
    output[o++] = GMID * xq[c] + G1 * (xq[c - 1] + xq[c + 1]) + G3 * (xq[c - 3] + xq[c + 3]) + G5 * (xq[c - 5] + xq[c + 5]) + G7 * (xq[c - 7] + xq[c + 7]) +
      G9 * (xq[c - 9] + xq[c + 9]) + G11 * (xq[c - 11] + xq[c + 11]) + G13 * (xq[c - 13] + xq[c + 13]) + G15 * (xq[c - 15] + xq[c + 15]);
  }
  s.pos = pos;
  s.odd = odd;
  return o >> 1;
}

// A packet in: its samples as floats, then through each stage; what comes out of the last posted
function data(buf)
{
  if (buf.byteLength < 8) return;
  const view = new DataView(buf);
  const type = view.getUint16(2, true);
  const scale = view.getFloat32(4, true);
  let samples;
  if (type == 1)
  {
    const s = new Int16Array(buf, 8, (buf.byteLength - 8) >> 1);
    samples = new Float32Array(s.length & ~1);
    const k = scale / 32768;
    for (let j = 0; j < samples.length; j++) samples[j] = s[j] * k;
  }
  else if (type == 0)
  {
    const s = new Int8Array(buf, 8, buf.byteLength - 8);
    samples = new Float32Array(s.length & ~1);
    const k = scale / 128;
    for (let j = 0; j < samples.length; j++) samples[j] = s[j] * k;
  }
  else if (type == 2) samples = new Float32Array(buf, 8, ((buf.byteLength - 8) >> 3) * 2);
  else return;
  let n = samples.length >> 1;
  for (const s of stages)
  {
    // Each stage writes into a fresh array half the size (or one more), its input left as it was
    const out = new Float32Array(((n >> 1) + 1) * 2);
    n = stageRun(s, samples, n, out);
    samples = out;
  }
  if (n == 0) return;
  const result = samples.slice(0, n * 2);
  postMessage(result, [result.buffer]);
}

onmessage = (event) =>
{
  const m = event.data;
  if (m.type == "config")
  {
    stages = [];
    for (let k = 0; k < m.stages; k++) stages.push(makeStage());
  }
  else if (m.type == "reset") for (let k = 0; k < stages.length; k++) stages[k] = makeStage();
  else if (m.type == "data") data(m.buf);
};
