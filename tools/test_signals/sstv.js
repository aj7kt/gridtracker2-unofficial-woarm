// SSTV test signal (tools/make_test_signals.js): one Robot 36 picture (36 s, VIS code 8), a test card drawn here (colour bars, a grey
// ramp, a grid, and GRIDTRACKER2 / TEST in block letters). Written from the published mode specifications (JL Barber, N7CXI, "Proposal
// for SSTV Mode Specifications"): the VIS code (leader 1900 Hz, break, start and stop bits 1200 Hz, seven data bits least significant
// first, 1100 Hz a 1 and 1300 Hz a 0, even parity), then 240 lines of 150 ms: sync 9 ms 1200 Hz, porch 3 ms 1500 Hz, luminance 88 ms,
// separator 4.5 ms (1500 Hz before R-Y on even lines, 2300 Hz before B-Y on odd ones), porch 1.5 ms 1900 Hz, colour difference 44 ms;
// black 1500 Hz, white 2300 Hz, the colour differences about the middle, as the app's decoder reads them (sstvWorker.js). The test card
// is shared with the Sat Data module (sat.js: its SSDV picture)

// ---- The test card: width x height RGB (Uint8Array, 3 bytes a pixel)

// 5 x 7 block letters (each row 5 bits, the left one highest)
const FONT = {
  A: [14, 17, 17, 31, 17, 17, 17],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  G: [14, 17, 16, 23, 17, 17, 15],
  I: [14, 4, 4, 4, 4, 4, 14],
  K: [17, 18, 20, 24, 20, 18, 17],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30],
  T: [31, 4, 4, 4, 4, 4, 4],
  2: [14, 17, 1, 2, 4, 8, 31]
};

// (grid false: none, for the SSDV picture, its fine lines costing many packets)
function testCard(width = 320, height = 240, grid = true)
{
  const rgb = new Uint8Array(width * height * 3);
  const set = (x, y, c) =>
  {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    rgb.set(c, (y * width + x) * 3);
  };
  const fill = (x0, y0, x1, y1, c) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) set(x, y, c); };
  const barsEnd = Math.round(height * 0.29), rampEnd = Math.round(height * 0.42);
  // Colour bars: white, yellow, cyan, green, magenta, red, blue, black
  const bars = [[255, 255, 255], [255, 255, 0], [0, 255, 255], [0, 255, 0], [255, 0, 255], [255, 0, 0], [0, 0, 255], [0, 0, 0]];
  bars.forEach((c, i) => fill(Math.round((i * width) / 8), 0, Math.round(((i + 1) * width) / 8), barsEnd, c));
  // A grey ramp in 16 steps, black to white
  for (let i = 0; i < 16; i++)
  {
    const v = Math.round((i * 255) / 15);
    fill(Math.round((i * width) / 16), barsEnd, Math.round(((i + 1) * width) / 16), rampEnd, [v, v, v]);
  }
  // A grid on dark blue below
  fill(0, rampEnd, width, height, [16, 24, 64]);
  const step = Math.round(width / 16);
  if (grid)
  {
    for (let x = 0; x < width; x += step) fill(x, rampEnd, x + 1, height, [140, 140, 140]);
    for (let y = height - 1; y >= rampEnd; y -= step) fill(0, y, width, y + 1, [140, 140, 140]);
  }
  // The words, each centred, in letters scale pixels a dot (a dot's gap, a letter's gap after each)
  const words = (text, scale, y0, color) =>
  {
    const w = text.length * 6 * scale - scale;
    let x0 = Math.round((width - w) / 2);
    for (const ch of text)
    {
      const rows = FONT[ch];
      for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) if (rows[r] & (16 >> c)) fill(x0 + c * scale, y0 + r * scale, x0 + (c + 1) * scale, y0 + (r + 1) * scale, color);
      x0 += 6 * scale;
    }
  };
  const area = height - rampEnd;
  const big = Math.max(1, Math.floor(width / (12 * 6))), huge = Math.max(1, Math.floor(area / 18));
  words("GRIDTRACKER2", big, rampEnd + Math.round(area * 0.12), [255, 255, 255]);
  words("TEST", huge, rampEnd + Math.round(area * 0.12) + 7 * big + Math.round(area * 0.1), [255, 220, 0]);
  return rgb;
}

// ---- Robot 36
const ROBOT36 = { vis: 8, width: 320, height: 240 };

// The tones (Hz) and how long each (s), one after another
function robot36Tones(rgb)
{
  const { width, height } = ROBOT36;
  const out = [];
  const tone = (hz, s) => out.push([hz, s]);
  // VIS: leader, break, leader, start bit, 7 data bits (least significant first), even parity, stop bit
  tone(1900, 0.3);
  tone(1200, 0.01);
  tone(1900, 0.3);
  tone(1200, 0.03);
  let ones = 0;
  for (let b = 0; b < 7; b++)
  {
    const bit = (ROBOT36.vis >> b) & 1;
    ones += bit;
    tone(bit ? 1100 : 1300, 0.03);
  }
  tone(ones % 2 ? 1100 : 1300, 0.03);
  tone(1200, 0.03);
  const level = (v) => 1500 + (Math.max(0, Math.min(255, v)) * 800) / 255;
  const px = (x, y) => { const i = (y * width + x) * 3; return [rgb[i], rgb[i + 1], rgb[i + 2]]; };
  const yOf = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;
  const scan = (values, s) => { for (const v of values) tone(level(v), s / values.length); };
  for (let y = 0; y < height; y++)
  {
    const even = y % 2 == 0;
    const pair = even ? y : y - 1;
    tone(1200, 0.009);
    tone(1500, 0.003);
    const row = Array.from({ length: width }, (_, x) => px(x, y));
    scan(row.map(yOf), 0.088);
    tone(even ? 1500 : 2300, 0.0045);
    tone(1900, 0.0015);
    // The pair's colour difference (both rows averaged): R-Y on the even line, B-Y on the odd one (the decoder's 1.402 and 1.772)
    const diff = Array.from({ length: width }, (_, x) =>
    {
      const a = px(x, pair), b = px(x, Math.min(height - 1, pair + 1));
      const ya = yOf(a), yb = yOf(b);
      return even ? 128 + (a[0] - ya + b[0] - yb) / 2 / 1.402 : 128 + (a[2] - ya + b[2] - yb) / 2 / 1.772;
    });
    scan(diff, 0.044);
  }
  return out;
}

// The tones as audio: continuous phase, each tone's samples by where its time falls (so the lines keep their exact length)
function render(common, tones, at, amp, s)
{
  let t = at, phase = 0, i = Math.round(at * common.RATE);
  for (const [hz, len] of tones)
  {
    t += len;
    const end = Math.round(t * common.RATE);
    for (; i < end && i < s.length; i++)
    {
      phase += (2 * Math.PI * hz) / common.RATE;
      s[i] += amp * Math.sin(phase);
    }
  }
  return t;
}

function build(common)
{
  const tones = robot36Tones(testCard(ROBOT36.width, ROBOT36.height));
  const length = tones.reduce((a, [, len]) => a + len, 0);
  const s = common.buffer(0.5 + length + 1);
  // 5 ms ramps: the tones' start and end
  const end = render(common, tones, 0.5, 0.5, s);
  const ramp = Math.round(0.005 * common.RATE), a = Math.round(0.5 * common.RATE), b = Math.round(end * common.RATE);
  for (let i = 0; i < ramp; i++)
  {
    s[a + i] *= i / ramp;
    s[b - 1 - i] *= i / ramp;
  }
  common.noise(s, 0.03, 36);
  return [{ file: "sstv-robot36.wav", modes: ["sstv"], signals: 1, description: "SSTV Robot 36 (VIS code 8, 1500 to 2300 Hz): a test card, colour bars, a grey ramp, a grid, GRIDTRACKER2 and TEST", samples: common.normalize(s, 0.7) }];
}

module.exports = { build, testCard };
