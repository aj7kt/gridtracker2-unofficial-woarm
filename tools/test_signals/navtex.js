// NAVTEX test signal (tools/make_test_signals.js): navtex.wav, one NAVTEX broadcast as a coast station sends it in SITOR collective
// B-mode (ITU-R M.476-5 and M.625-3 mode B, M.540-2 Annex II): 100 baud FSK, 170 Hz shift, B (the 7-unit code's 1) the upper tone;
// each 7-unit signal sent first unit first; phasing first (α, phasing signal 2, in the DX positions and β, phasing signal 1, in the
// RX positions), then each character sent twice, its DX and, four characters later, its RX; the message "ZCZC QA01", a line, the
// text, "NNNN", a carriage return and two line feeds (the IMO NAVTEX Manual's format), then the end of emission (three α in the DX
// positions only). The frequency moved smoothly (over 1 ms) and its phase kept running. A fictional station (Q) and a message plainly
// marked as a test. navtexSend() is used by the decoder's own tests too
const NAVTEX_BAUD = 100;
const NAVTEX_SHIFT = 170;
// The 7-unit signals (M.476-5 Table 1) for A to Z, carriage return, line feed, letters, figures, space; α and β (Table 2)
const NAVTEX_UNITS = [
  "BBBYYYB", "YBYYBBB", "BYBBBYY", "BBYYBYB", "YBBYBYB", "BBYBBYY", "BYBYBBY", "BYYBYBB", "BYBBYYB", "BBBYBYY", "YBBBBYY", "BYBYYBB",
  "BYYBBBY", "BYYBBYB", "BYYYBBB", "BYBBYBY", "YBBBYBY", "BYBYBYB", "BBYBYYB", "YYBYBBB", "YBBBYYB", "YYBBBBY", "BBBYYBY", "YBYBBBY",
  "BBYBYBY", "BBYYYBB", "YYYBBBB", "YYBBYBB", "YBYBBYB", "YBBYBBY", "YYBBBYB"
].map((s) => parseInt(s.replace(/B/g, "1").replace(/Y/g, "0"), 2));
const NAVTEX_ALPHA = 0x78;
const NAVTEX_BETA = 0x66;
const NAVTEX_CR = 26;
const NAVTEX_LF = 27;
const NAVTEX_LTRS = 28;
const NAVTEX_FIGS = 29;
const NAVTEX_SPACE = 30;
// ITA2 (ITU-T F.1) figures, by the letter sharing their combination
const NAVTEX_FIGURES = { "-": "A", "?": "B", ":": "C", 3: "E", 8: "I", "(": "K", ")": "L", ".": "M", ",": "N", 9: "O", 0: "P", 1: "Q",
  4: "R", "'": "S", 5: "T", 7: "U", "=": "V", 2: "W", "/": "X", 6: "Y", "+": "Z" };

// The traffic signals for text (combination numbers less 1), shifts as it needs them and again after each new line (M.540's
// redundant shifts); "\n" a carriage return and line feed
function navtexCodes(text)
{
  const codes = [NAVTEX_LTRS];
  let figures = false;
  for (const ch of text.toUpperCase())
  {
    if (ch == " ") codes.push(NAVTEX_SPACE);
    else if (ch == "\n") codes.push(NAVTEX_CR, NAVTEX_LF, figures ? NAVTEX_FIGS : NAVTEX_LTRS);
    else if (ch >= "A" && ch <= "Z")
    {
      if (figures) codes.push(NAVTEX_LTRS);
      figures = false;
      codes.push(ch.charCodeAt(0) - 65);
    }
    else if (NAVTEX_FIGURES[ch] != null)
    {
      if (!figures) codes.push(NAVTEX_FIGS);
      figures = true;
      codes.push(NAVTEX_FIGURES[ch].charCodeAt(0) - 65);
    }
    else throw new Error("navtex: no ITA2 for " + ch);
  }
  return codes;
}

// The 7-unit signals sent, slot by slot (a DX, then an RX, ...): phasing for the seconds given, the text's characters each in its DX
// and 5 slots later in its RX (β wherever an RX has no character to repeat), then three α in the DX positions
function navtexSlots(text, phasing)
{
  const pairs = Math.max(4, Math.round(phasing / 0.14));
  const dx = new Array(pairs).fill(-1).concat(navtexCodes(text), [-1, -1, -1]);
  const slots = [];
  for (let k = 0; k < dx.length; k++)
  {
    slots.push(dx[k] < 0 ? NAVTEX_ALPHA : NAVTEX_UNITS[dx[k]]);
    const r = k - 2;
    slots.push(r >= 0 && dx[r] >= 0 ? NAVTEX_UNITS[dx[r]] : NAVTEX_BETA);
  }
  return slots;
}

function navtexSeconds(text, phasing = 10)
{
  return (navtexSlots(text, phasing).length * 7) / NAVTEX_BAUD;
}

// Text sent centred on freq (Hz) into s from at (seconds), amp its peak; returns the time it ends. Options: phasing (seconds, 10),
// reversed (B the lower tone: heard on the other sideband), ppm (the sender's clock off by this), drift (Hz a second)
function navtexSend(common, s, freq, text, at, amp, options = {})
{
  const slots = navtexSlots(text, options.phasing === undefined ? 10 : options.phasing);
  const bits = [];
  for (const w of slots) for (let b = 6; b >= 0; b--) bits.push((w >> b) & 1);
  const rate = common.RATE;
  const baud = NAVTEX_BAUD * (1 + (options.ppm || 0) / 1e6);
  const start = Math.round(at * rate);
  const n = Math.round((bits.length / baud) * rate);
  const sign = options.reversed ? -1 : 1;
  const key = new Float64Array(n);
  for (let i = 0; i < n; i++) key[i] = bits[Math.min(bits.length - 1, Math.floor((i * baud) / rate))] ? sign : -sign;
  const w = Math.max(1, Math.round(0.001 * rate));
  const ramp = Math.round(0.005 * rate);
  let phase = 0;
  let sum = w * key[0];
  for (let i = 0; i < n; i++)
  {
    sum += key[i] - (i >= w ? key[i - w] : key[0]);
    const k = sum / w;
    const f = freq + (options.drift || 0) * (i / rate) + (k * NAVTEX_SHIFT) / 2;
    phase += (2 * Math.PI * f) / rate;
    const edge = Math.min(1, i / ramp, (n - 1 - i) / ramp);
    if (start + i < s.length) s[start + i] += amp * edge * Math.sin(phase);
  }
  return at + n / rate;
}

// The broadcast: [centre Hz, start (s), peak, phasing (s), text]
const NAVTEX_SIGNAL = [1000, 1.0, 0.25, 6,
  "ZCZC QA01\n311200 UTC OCT 26\nGRIDTRACKER2 TEST MESSAGE\nTHIS IS A TEST SIGNAL, NOT A REAL WARNING.\nFICTIONAL STATION Q, MESSAGE 01.\nNNNN\n\n"];

function build(common)
{
  const [freq, at, amp, phasing, text] = NAVTEX_SIGNAL;
  const s = common.buffer(Math.ceil(at + navtexSeconds(text, phasing) + 1.5));
  navtexSend(common, s, freq, text, at, amp, { phasing });
  common.noise(s, 0.04, 41);
  common.normalize(s, 0.7);
  return [{
    file: "navtex.wav",
    modes: ["navtex"],
    signals: 1,
    rsid: false,
    sync: null,
    description: "A NAVTEX broadcast (SITOR B, 100 baud, 170 Hz shift) centred on " + freq + " Hz: phasing, then a test message ZCZC QA01 from a fictional station",
    samples: s
  }];
}

module.exports = { build, navtexSend, navtexSeconds, navtexCodes, NAVTEX_SIGNAL };
