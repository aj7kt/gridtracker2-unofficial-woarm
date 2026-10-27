// RTTY test signals (tools/make_test_signals.js): rtty-5.wav, five RTTY signals at once (45.45 baud, 170 Hz shift), starting a moment
// apart, two of them after their RSID (RTTY 45, at the signal's centre, midway between its tones). RTTY as sent: Baudot (ITA2, the US
// figures), each character a start bit (space), five bits (the lowest first, a 1 mark) and 1.5 stop bits (mark); mark the upper tone;
// the frequency moved smoothly (over 2 ms) and its phase kept running. LTRS and FIGS sent as the text needs them, FIGS again after a
// space (a receiver goes back to letters at one); CR LF before and after the text. rttySend() is used by mixed.js too. Fictional calls
// only (Q prefixes are never issued)

const RTTY_BAUD = 45.45;
const RTTY_SHIFT = 170;
// Baudot (ITA2) code by character: letters, figures; CR 8 and LF 2 in both, space 4, FIGS 27, LTRS 31
const RTTY_LETTERS = { E: 1, A: 3, S: 5, I: 6, U: 7, D: 9, R: 10, J: 11, N: 12, F: 13, C: 14, K: 15, T: 16, Z: 17, L: 18, W: 19,
  H: 20, Y: 21, P: 22, Q: 23, O: 24, B: 25, G: 26, M: 28, X: 29, V: 30 };
const RTTY_FIGURES = { 3: 1, "-": 3, 8: 6, 7: 7, $: 9, 4: 10, "'": 11, ",": 12, "!": 13, ":": 14, "(": 15, 5: 16, "\"": 17, ")": 18,
  2: 19, "#": 20, 6: 21, 0: 22, 1: 23, 9: 24, "?": 25, "&": 26, ".": 28, "/": 29, ";": 30 };
const RTTY_FIGS = 27;
const RTTY_LTRS = 31;

// The Baudot codes for text
function rttyCodes(text)
{
  const codes = [RTTY_LTRS, RTTY_LTRS, 8, 2];
  let figures = false;
  for (const ch of text.toUpperCase())
  {
    if (ch == " ")
    {
      codes.push(4);
      figures = false;
    }
    else if (ch == "\n") codes.push(8, 2);
    else if (RTTY_LETTERS[ch] != null)
    {
      if (figures) codes.push(RTTY_LTRS);
      figures = false;
      codes.push(RTTY_LETTERS[ch]);
    }
    else if (RTTY_FIGURES[ch] != null)
    {
      if (!figures) codes.push(RTTY_FIGS);
      figures = true;
      codes.push(RTTY_FIGURES[ch]);
    }
    else throw new Error("rtty: no Baudot for " + ch);
  }
  codes.push(8, 2, RTTY_LTRS);
  return codes;
}

// The bits sent (1 mark), in half bits: half a second of mark first, then each character (start, five bits, 1.5 stop), a quarter
// second of mark after
function rttyHalfBits(text)
{
  const lead = Math.round(0.5 * RTTY_BAUD * 2);
  const out = new Array(lead).fill(1);
  for (const code of rttyCodes(text))
  {
    out.push(0, 0);
    for (let k = 0; k < 5; k++)
    {
      const b = (code >> k) & 1;
      out.push(b, b);
    }
    out.push(1, 1, 1);
  }
  for (let i = 0; i < Math.round(0.25 * RTTY_BAUD * 2); i++) out.push(1);
  return out;
}

function rttySeconds(text)
{
  return rttyHalfBits(text).length / (2 * RTTY_BAUD);
}

// Text sent centred on freq (Hz) into s from at (seconds), amp its peak; returns the time it ends
function rttySend(common, s, freq, text, at, amp)
{
  const half = rttyHalfBits(text);
  const rate = common.RATE;
  const start = Math.round(at * rate);
  const n = Math.round((half.length / (2 * RTTY_BAUD)) * rate);
  // The keying, sample by sample (+1 mark), then smoothed over 2 ms
  const key = new Float64Array(n);
  for (let i = 0; i < n; i++) key[i] = half[Math.min(half.length - 1, Math.floor((i * 2 * RTTY_BAUD) / rate))] ? 1 : -1;
  const w = Math.round(0.002 * rate);
  const ramp = Math.round(0.005 * rate);
  let phase = 0;
  // The w samples before the first taken as mark (the lead is)
  let sum = w * key[0];
  for (let i = 0; i < n; i++)
  {
    sum += key[i] - (i >= w ? key[i - w] : key[0]);
    const k = sum / w;
    phase += (2 * Math.PI * (freq + (k * RTTY_SHIFT) / 2)) / rate;
    const edge = Math.min(1, i / ramp, (n - 1 - i) / ramp);
    if (start + i < s.length) s[start + i] += amp * edge * Math.sin(phase);
  }
  return at + n / rate;
}

// The five: [centre Hz, start (s), peak, RSID first, text]
const RTTY_SIGNALS = [
  [550, 0.5, 0.2, true, "CQ CQ CQ DE Q1TST Q1TST K"],
  [1000, 3.0, 0.18, false, "Q1TST DE Q2ABC UR 599 599 NAME AL BK"],
  [1450, 1.5, 0.2, false, "CQ TEST DE Q3XYZ Q3XYZ TEST"],
  [1900, 4.5, 0.16, true, "Q3XYZ DE Q4KLM 599 001 001 BK"],
  [2350, 2.0, 0.17, false, "GRIDTRACKER2 TEST SIGNAL DE N0CALL"]
];

// RTTY 45's RSID number
const RTTY_RSID = 39;

function build(common)
{
  const plan = RTTY_SIGNALS.map(([freq, at, amp, rsid, text]) => ({ freq, at, amp, rsid, text, start: rsid ? at + 1.858 : at }));
  const end = Math.max(...plan.map((p) => p.start + rttySeconds(p.text)));
  const s = common.buffer(Math.max(30, Math.ceil(end + 1.5)));
  for (const p of plan)
  {
    const from = p.rsid ? common.rsid(s, common.rsidTones(RTTY_RSID), p.freq, p.at, p.amp) : p.at;
    rttySend(common, s, p.freq, p.text, from, p.amp);
  }
  // A band's noise floor (heard alone, the Input Device silenced): a quieter one lets a lone tone of a neighbour read as a station
  common.noise(s, 0.04, 31);
  common.normalize(s, 0.7);
  return [{
    file: "rtty-5.wav",
    modes: ["rtty"],
    signals: RTTY_SIGNALS.length,
    rsid: true,
    sync: null,
    description: "Five RTTY signals at once, 45.45 baud 170 Hz shift, centred on " + RTTY_SIGNALS.map(([f]) => f).join(", ") +
      " Hz; those at " + RTTY_SIGNALS.filter((p) => p[3]).map(([f]) => f).join(" and ") + " Hz after their RSID",
    samples: s
  }];
}

module.exports = { build, rttySend, rttySeconds, RTTY_RSID };
