// Weather fax test signal (tools/make_test_signals.js): one HF radiofax chart at 120 lines a minute, IOC 576, as the app's decoder reads it
// (wefaxWorker.js). Written from the published characteristics of meteorological analogue facsimile (WMO Manual on the Global
// Telecommunication System, WMO-No. 386; the broadcasters' own technical notes): frequency modulated, black 1500 Hz and white 2300 Hz;
// the start signal, black and white keyed at 300 Hz (IOC 576) for 5 s; phasing lines, black with a white pulse over the first 5% of each
// line (shortened here to 10 s from the usual 30); the chart, 1809 pixels a line (576 x pi); the stop signal, black and white keyed at
// 450 Hz for 5 s, then black (2 s here, 10 s on the air). The chart is drawn here: a border, a grid, gray steps, fine stripes, circles
// and a triangle, and GRIDTRACKER2 TEST in block letters. wefaxSignal() makes others (other rates, line rates, a sender's clock off,
// the tones moved), for tests

// 5 x 7 block letters (each row 5 bits, the left one highest)
const WEFAX_FONT = {
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
  2: [14, 17, 1, 2, 4, 8, 31],
  " ": [0, 0, 0, 0, 0, 0, 0]
};

// The chart: width x height levels (Uint8Array, 0 black to 255 white), white with black lines as a weather chart is
function wefaxChart(width, height)
{
  const g = new Uint8Array(width * height).fill(255);
  const fill = (x0, y0, x1, y1, v) =>
  {
    for (let y = Math.max(0, y0); y < Math.min(height, y1); y++) for (let x = Math.max(0, x0); x < Math.min(width, x1); x++) g[y * width + x] = v;
  };
  // A grid, as a chart's latitude and longitude
  for (let x = 150; x < width; x += 150) fill(x, 0, x + 2, height, 0);
  for (let y = 20; y < height; y += 40) fill(0, y, width, y + 2, 0);
  // A border
  fill(0, 0, width, 2, 0);
  fill(0, height - 2, width, height, 0);
  fill(0, 0, 6, height, 0);
  fill(width - 6, 0, width, height, 0);
  // Gray steps, black to white in 8, and stripes 1, 2 and 4 pixels wide
  for (let i = 0; i < 8; i++) fill(30 + i * 40, 5, 70 + i * 40, 17, Math.round((i * 255) / 7));
  [1, 2, 4].forEach((w, i) =>
  {
    const x0 = 380 + i * 110;
    for (let x = x0; x < x0 + 100; x++) fill(x, 5, x + 1, 17, Math.floor((x - x0) / w) % 2 ? 255 : 0);
  });
  // The words, on white, in letters scale pixels a dot
  const text = "GRIDTRACKER2 TEST", scale = 7;
  const tx = 560, ty = 26;
  fill(tx - 10, ty - 4, tx + text.length * 6 * scale, ty + 7 * scale + 4, 255);
  let x0 = tx;
  for (const ch of text)
  {
    const rows = WEFAX_FONT[ch];
    for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) if (rows[r] & (16 >> c)) fill(x0 + c * scale, ty + r * scale, x0 + (c + 1) * scale, ty + (r + 1) * scale, 0);
    x0 += 6 * scale;
  }
  // Rings (isobars), a filled circle and a triangle
  for (let y = 0; y < height; y++)
  {
    for (let x = 0; x < width; x++)
    {
      const r = Math.hypot(x - 1560, y - 44);
      if ([12, 24, 36].some((ring) => Math.abs(r - ring) < 1.2)) g[y * width + x] = 0;
      if (Math.hypot(x - 1380, y - 50) < 16) g[y * width + x] = 0;
      if (y >= 28 && y < 72 && Math.abs(x - 300) < (y - 28) * 0.8) g[y * width + x] = 0;
    }
  }
  return g;
}

// A radiofax transmission at rate (samples a second), its levels as frequencies: { samples, start (s, where the chart's first line
// begins), line (s) }. o: ioc, lpm, phasing (s), lines, ppm (the sender's clock: everything that much longer), offset (Hz: every tone
// moved, a receiver mistuned), startTone, stop (false: none), lead (s of silence before), tail (s after)
function wefaxSignal(rate, o = {})
{
  const ioc = o.ioc || 576, lpm = o.lpm || 120, lines = o.lines || 80;
  const phasing = o.phasing !== undefined ? o.phasing : 10, lead = o.lead !== undefined ? o.lead : 0.5, tail = o.tail !== undefined ? o.tail : 0.5;
  const scale = 1 + (o.ppm || 0) * 1e-6, offset = o.offset || 0;
  const width = Math.floor(ioc * Math.PI), chart = o.chart || wefaxChart(width, lines);
  const line = (60 / lpm) * scale;
  const toneLength = o.startTone === false ? 0 : 5 * scale;
  const startTone = ioc == 288 ? 675 : 300;
  const phasingLength = Math.round(phasing / (60 / lpm)) * line;
  const chartFrom = lead + toneLength + phasingLength;
  const stopFrom = chartFrom + lines * line;
  const stopLength = o.stop === false ? 0 : 7 * scale;
  const end = stopFrom + stopLength;
  const s = new Float32Array(Math.round((end + tail) * rate));
  let phase = 0;
  for (let i = 0; i < s.length; i++)
  {
    const t = i / rate;
    if (t < lead || t >= end) continue;
    let level;
    if (t < lead + toneLength) level = Math.floor(((t - lead) / scale) * 2 * startTone) % 2;
    else if (t < chartFrom) level = ((t - lead - toneLength) % line) / line < 0.05 ? 1 : 0;
    else if (t < stopFrom)
    {
      const u = (t - chartFrom) / line, y = Math.floor(u), x = Math.min(width - 1, Math.floor((u - y) * width));
      level = chart[y * width + x] / 255;
    }
    else if (t < stopFrom + 5 * scale) level = Math.floor(((t - stopFrom) / scale) * 2 * 450) % 2;
    else level = 0;
    phase += (2 * Math.PI * (1500 + 800 * level + offset)) / rate;
    s[i] = 0.5 * Math.sin(phase);
  }
  return { samples: s, start: chartFrom, line, width, chart };
}

function build(common)
{
  const { samples } = wefaxSignal(common.RATE);
  common.noise(samples, 0.03, 576);
  return [{
    file: "wefax.wav",
    name: "WEFAX 120 LPM, IOC 576",
    modes: ["wefax"],
    signals: 1,
    rsid: false,
    sync: null,
    description: "Weather fax (HF radiofax, 120 LPM, IOC 576, black 1500 Hz to white 2300 Hz): start tone, 10 s of phasing, an 80 line test chart (GRIDTRACKER2 TEST, gray steps, a grid, rings), stop tone",
    samples: common.normalize(samples, 0.7)
  }];
}

module.exports = { build, wefaxSignal, wefaxChart };
