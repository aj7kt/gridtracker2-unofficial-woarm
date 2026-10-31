// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// SSTV pictures as audio (the Multi-Mode Decoder's Send Picture, mmdSstvTx.js): the modes as the decoder reads them (sstvWorker.js, from
// JL Barber N7CXI's "Proposal for SSTV Mode Specifications" and the VIS code table), each tone one after another with its phase carried
// on. The VIS code (1900 Hz leader, a 10 ms break at 1200 Hz, the leader again, the start bit, seven data bits least significant first
// at 1100 Hz for a 1 and 1300 Hz for a 0, even parity, the stop bit, each bit 30 ms at 1200 Hz where it isn't data), then the lines:
// the sync pulse at 1200 Hz, porches and separators at 1500 Hz (1900 and 2300 Hz where a mode says), and each pixel's level from 1500 Hz
// (black) to 2300 Hz (white). Color differences as the decoder takes them (Y = 0.299 R + 0.587 G + 0.114 B; R-Y over 1.402 and B-Y over
// 1.772, about 128)

const SSTV_TX_BLACK = 1500;
const SSTV_TX_WHITE = 2300;
const SSTV_TX_SYNC = 1200;
const SSTV_TX_PORCH = 1500;
const SSTV_TX_LEADER = 1900;
// The 5 ms ramps at the audio's start and end, and the silence left after it (s)
const SSTV_TX_RAMP_S = 0.005;
const SSTV_TX_TAIL_S = 0.2;

// The modes (the decoder's table, sstvWorker.js, with how each line is sent): kind, VIS code, name, size, the time of a line (s; a PD line
// holds two rows), the pixel scan's length (s)
function sstvTxMartin(vis, name, scan)
{
  const sync = 4.862e-3, porch = 0.572e-3, sep = 0.572e-3;
  return { kind: "martin", vis, name, width: 320, height: 256, line: sync + porch + 3 * (scan + sep), scan, sync, porch, sep };
}

function sstvTxScottie(vis, name, scan)
{
  const sync = 9e-3, porch = 1.5e-3, sep = 1.5e-3;
  return { kind: "scottie", vis, name, width: 320, height: 256, line: sep + scan + sep + scan + sync + porch + scan, scan, sync, porch, sep, lead: sync };
}

function sstvTxPd(vis, name, pixel, width, height)
{
  const sync = 20e-3, porch = 2.08e-3, scan = pixel * width;
  return { kind: "pd", vis, name, width, height, line: sync + porch + 4 * scan, scan, sync, porch };
}

const SSTV_TX_MODES = [
  sstvTxMartin(0x2c, "Martin 1", 146.432e-3),
  sstvTxMartin(0x28, "Martin 2", 73.216e-3),
  sstvTxScottie(0x3c, "Scottie 1", 138.24e-3),
  sstvTxScottie(0x38, "Scottie 2", 88.064e-3),
  sstvTxScottie(0x4c, "Scottie DX", 345.6e-3),
  // Robot 36: luminance, then one color difference a line (R-Y on even lines, B-Y on odd), each for the pair of rows
  { kind: "r36", vis: 0x08, name: "Robot 36", width: 320, height: 240, line: 150e-3, sync: 9e-3, porch: 3e-3, scan: 88e-3, sep: 4.5e-3, porch2: 1.5e-3, scan2: 44e-3 },
  // Robot 72: luminance, R-Y, B-Y every line
  { kind: "r72", vis: 0x0c, name: "Robot 72", width: 320, height: 240, line: 300e-3, sync: 9e-3, porch: 3e-3, scan: 138e-3, sep: 4.5e-3, porch2: 1.5e-3, scan2: 69e-3 },
  sstvTxPd(0x63, "PD 90", 0.532e-3, 320, 256),
  sstvTxPd(0x5f, "PD 120", 0.19e-3, 640, 496),
  sstvTxPd(0x60, "PD 180", 0.286e-3, 640, 496)
];

function sstvTxModeByName(name)
{
  return SSTV_TX_MODES.find((m) => m.name == name) || SSTV_TX_MODES[0];
}

// The VIS code's length (s): the leaders and break, the start bit, 8 bits, the stop bit
const SSTV_TX_VIS_S = 0.3 + 0.01 + 0.3 + 0.03 * 10;

// The tones of a picture (rgba: its pixels, the mode's width x height, 4 bytes each): { hz: [], len: [] } one after another. lead: seconds
// of the leader tone before the VIS code (for VOX)
function sstvTxTones(mode, rgba, lead = 0)
{
  const hz = [], len = [];
  const tone = (f, s) => { hz.push(f); len.push(s); };
  const { width, height } = mode;
  if (lead > 0) tone(SSTV_TX_LEADER, lead);
  // VIS
  tone(SSTV_TX_LEADER, 0.3);
  tone(SSTV_TX_SYNC, 0.01);
  tone(SSTV_TX_LEADER, 0.3);
  tone(SSTV_TX_SYNC, 0.03);
  let ones = 0;
  for (let b = 0; b < 7; b++)
  {
    const bit = (mode.vis >> b) & 1;
    ones += bit;
    tone(bit ? 1100 : 1300, 0.03);
  }
  tone(ones % 2 ? 1100 : 1300, 0.03);
  tone(SSTV_TX_SYNC, 0.03);
  // The pixels
  const level = (v) => SSTV_TX_BLACK + (Math.max(0, Math.min(255, v)) * (SSTV_TX_WHITE - SSTV_TX_BLACK)) / 255;
  const at = (x, y) => (y * width + x) * 4;
  const yOf = (i) => 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  const scan = (values, s) =>
  {
    const each = s / values.length;
    for (const v of values) tone(level(v), each);
  };
  const channel = (y, c) => Array.from({ length: width }, (_, x) => rgba[at(x, y) + c]);
  const luma = (y) => Array.from({ length: width }, (_, x) => yOf(at(x, y)));
  // R-Y (c 0) or B-Y (c 2) of a row, or of two rows averaged
  const diff = (c, y0, y1 = y0) => Array.from({ length: width }, (_, x) =>
  {
    const a = at(x, y0), b = at(x, y1);
    const d = (rgba[a + c] - yOf(a) + rgba[b + c] - yOf(b)) / 2;
    return 128 + d / (c == 0 ? 1.402 : 1.772);
  });
  if (mode.kind == "martin")
  {
    for (let y = 0; y < height; y++)
    {
      tone(SSTV_TX_SYNC, mode.sync);
      tone(SSTV_TX_PORCH, mode.porch);
      for (const c of [1, 2, 0])
      {
        scan(channel(y, c), mode.scan);
        tone(SSTV_TX_PORCH, mode.sep);
      }
    }
  }
  else if (mode.kind == "scottie")
  {
    // The sync pulse comes between blue and red (and once before the first line)
    tone(SSTV_TX_SYNC, mode.lead);
    for (let y = 0; y < height; y++)
    {
      tone(SSTV_TX_PORCH, mode.sep);
      scan(channel(y, 1), mode.scan);
      tone(SSTV_TX_PORCH, mode.sep);
      scan(channel(y, 2), mode.scan);
      tone(SSTV_TX_SYNC, mode.sync);
      tone(SSTV_TX_PORCH, mode.porch);
      scan(channel(y, 0), mode.scan);
    }
  }
  else if (mode.kind == "r36")
  {
    for (let y = 0; y < height; y++)
    {
      const even = y % 2 == 0;
      const pair = even ? y : y - 1;
      tone(SSTV_TX_SYNC, mode.sync);
      tone(SSTV_TX_PORCH, mode.porch);
      scan(luma(y), mode.scan);
      // The separator says which color difference follows: 1500 Hz before R-Y, 2300 Hz before B-Y
      tone(even ? 1500 : 2300, mode.sep);
      tone(1900, mode.porch2);
      scan(diff(even ? 0 : 2, pair, Math.min(height - 1, pair + 1)), mode.scan2);
    }
  }
  else if (mode.kind == "r72")
  {
    for (let y = 0; y < height; y++)
    {
      tone(SSTV_TX_SYNC, mode.sync);
      tone(SSTV_TX_PORCH, mode.porch);
      scan(luma(y), mode.scan);
      tone(1500, mode.sep);
      tone(1900, mode.porch2);
      scan(diff(0, y), mode.scan2);
      tone(2300, mode.sep);
      tone(1900, mode.porch2);
      scan(diff(2, y), mode.scan2);
    }
  }
  else if (mode.kind == "pd")
  {
    // A line holds two rows: luminance of the first, R-Y and B-Y of both, luminance of the second
    for (let y = 0; y < height; y += 2)
    {
      const y1 = Math.min(height - 1, y + 1);
      tone(SSTV_TX_SYNC, mode.sync);
      tone(SSTV_TX_PORCH, mode.porch);
      scan(luma(y), mode.scan);
      scan(diff(0, y, y1), mode.scan);
      scan(diff(2, y, y1), mode.scan);
      scan(luma(y1), mode.scan);
    }
  }
  return { hz, len };
}

// The tones as audio at rate (samples a second), amp its peak: continuous phase, each tone's samples by where its time falls (so the lines
// keep their exact length), 5 ms ramps at the start and end, a little silence after. { samples (Float32Array), seconds (the tones') }
function sstvTxRender(tones, rate, amp)
{
  let seconds = 0;
  for (const s of tones.len) seconds += s;
  const total = Math.round((seconds + SSTV_TX_TAIL_S) * rate);
  const samples = new Float32Array(total);
  let t = 0, phase = 0, i = 0;
  const twoPi = 2 * Math.PI;
  for (let k = 0; k < tones.hz.length; k++)
  {
    t += tones.len[k];
    const end = Math.min(total, Math.round(t * rate));
    const step = (twoPi * tones.hz[k]) / rate;
    for (; i < end; i++)
    {
      phase += step;
      if (phase > twoPi) phase -= twoPi;
      samples[i] = amp * Math.sin(phase);
    }
  }
  const ramp = Math.round(SSTV_TX_RAMP_S * rate), last = Math.min(total, Math.round(seconds * rate));
  for (let k = 0; k < ramp && k < last; k++)
  {
    samples[k] *= k / ramp;
    samples[last - 1 - k] *= k / ramp;
  }
  return { samples, seconds };
}

// A picture (rgba at the mode's size) as audio: { samples, seconds, lead, lines }
function sstvTxEncode(mode, rgba, rate, amp, lead = 0)
{
  const out = sstvTxRender(sstvTxTones(mode, rgba, lead), rate, amp);
  return { samples: out.samples, seconds: out.seconds, lead: lead + SSTV_TX_VIS_S + (mode.lead || 0), lines: mode.kind == "pd" ? mode.height / 2 : mode.height };
}
