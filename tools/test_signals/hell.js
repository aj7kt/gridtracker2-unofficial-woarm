// Feld-Hell test signal (tools/make_test_signals.js): feld-hell.wav, one Feld-Hell signal at 1000 Hz (a CQ and a reply). Feld-Hell as
// the Feld Hell Club and Murray Greenman, ZL1BPU, describe it (after Rudolf Hell's Feldfernschreiber): each character 7 columns, each
// column 14 pixels sent from the bottom up, the tone on for a black pixel, 2.5 characters (17.5 columns, 245 pixels) a second, so a pixel
// is 4.08 ms. The characters are drawn on 5 by 7 dots, each dot two pixels high (8.16 ms: the mode's 122.5 baud), with a blank column
// either side. The font is GridTracker's own, drawn for these tests (no other font's table is copied). Each key-down's edges are shaped
// over one pixel (a raised cosine), which keeps the signal to about 350 Hz.
// hellKey() makes any text, at X5 or X9 speed (speed 5 or 9) and with the sender's clock off (ppm), for the decoder's offline tests.
// Fictional calls only (Q prefixes are never issued)

// Each character's 7 rows of dots, top first, 5 dots across ("#" on)
const HELL_FONT = {
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".####"],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: [".###.", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "#.#.#", ".#.#."],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  0: [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  1: ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  2: [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  3: ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
  4: ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  5: ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  6: ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  7: ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  8: [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  9: [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
  "/": [".....", "....#", "...#.", "..#..", ".#...", "#....", "....."],
  "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
  ".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."],
  ",": [".....", ".....", ".....", ".....", ".##..", "..#..", ".#..."],
  "-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
  "=": [".....", ".....", "#####", ".....", "#####", ".....", "....."],
  "+": [".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."]
};

// Feld-Hell's timing: columns a second, columns a character, pixels a column
const HELL_COLUMNS = 17.5;
const HELL_CHAR_COLUMNS = 7;
const HELL_PIXELS = 14;

// Text's key, column by column (each HELL_PIXELS pixels, the first the bottom; 1 on)
function hellColumns(text)
{
  const columns = [];
  for (const ch of text.toUpperCase())
  {
    const glyph = HELL_FONT[ch];
    if (!glyph) throw new Error("hell: no glyph for " + ch);
    columns.push(new Uint8Array(HELL_PIXELS));
    for (let x = 0; x < 5; x++)
    {
      const column = new Uint8Array(HELL_PIXELS);
      for (let p = 0; p < HELL_PIXELS; p++) column[p] = glyph[6 - (p >> 1)][x] == "#" ? 1 : 0;
      columns.push(column);
    }
    columns.push(new Uint8Array(HELL_PIXELS));
  }
  return columns;
}

// The seconds text takes (speed 1 Feld-Hell, 5 X5, 9 X9)
function hellSeconds(text, speed = 1)
{
  return (text.length * HELL_CHAR_COLUMNS) / (HELL_COLUMNS * speed);
}

// Text keyed at freq (Hz) into s from at (seconds), amp its peak; speed 1 (Feld-Hell), 5 or 9; ppm the sender's clock off (positive:
// fast). Returns the time it ends
function hellKey(common, s, freq, text, at, amp, speed = 1, ppm = 0)
{
  const rate = common.RATE;
  const pixel = 1 / (HELL_COLUMNS * speed * HELL_PIXELS * (1 + ppm * 1e-6));
  const columns = hellColumns(text);
  const total = columns.length * HELL_PIXELS;
  const a = Math.round(at * rate);
  const n = Math.min(s.length - a, Math.ceil((total * pixel + 2 * pixel) * rate));
  // The key, sample by sample, then smoothed over a pixel (a raised cosine), which shapes each edge
  const key = new Float32Array(n);
  for (let i = 0; i < n; i++)
  {
    const p = Math.floor(i / rate / pixel);
    if (p < total) key[i] = columns[Math.floor(p / HELL_PIXELS)][p % HELL_PIXELS];
  }
  const width = Math.max(3, Math.round(pixel * rate) | 1);
  const shape = new Float32Array(width);
  let sum = 0;
  for (let j = 0; j < width; j++) sum += shape[j] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (j + 0.5)) / width);
  for (let i = 0; i < n; i++)
  {
    let e = 0;
    for (let j = 0; j < width; j++)
    {
      const k = i - j + (width >> 1);
      if (k >= 0 && k < n) e += key[k] * shape[j];
    }
    // The tone's phase runs on from the file's start
    s[a + i] += ((amp * e) / sum) * Math.sin((2 * Math.PI * freq * (a + i)) / rate);
  }
  return at + total * pixel;
}

const HELL_TEXT = "CQ CQ CQ DE Q1HEL Q1HEL PSE K   Q1HEL DE Q2ABC GM UR 599 0123456789 /?.,-=+ BK";

function build(common)
{
  const end = 1 + hellSeconds(HELL_TEXT);
  const s = common.buffer(Math.ceil(end + 1.5));
  hellKey(common, s, 1000, HELL_TEXT, 1, 0.2);
  // A band's noise floor: about 17 dB below the tone (in 2.5 kHz)
  common.noise(s, 0.03, 31);
  common.normalize(s, 0.7);
  return [{
    file: "feld-hell.wav",
    name: "Feld-Hell",
    modes: ["hell"],
    signals: 1,
    rsid: false,
    sync: null,
    description: "Feld-Hell at 1000 Hz: a CQ from Q1HEL and a reply from Q2ABC",
    samples: s
  }];
}

module.exports = { build, hellKey, hellSeconds, HELL_FONT, HELL_TEXT };
