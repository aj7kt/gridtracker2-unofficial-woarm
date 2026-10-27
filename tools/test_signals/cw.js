// CW test signals (tools/make_test_signals.js): cw-5.wav, five CW signals at once at different pitches and speeds, starting a moment
// apart (calls CQ, a reply, a 599 exchange). Morse timing as sent by a keyer: a dit one unit (1.2 / WPM seconds), a dah three, one unit
// between a letter's elements, three between letters, seven between words; each element's edges shaped over 5 ms (no clicks).
// cwKey() is used by mixed.js too. Fictional calls only (Q prefixes are never issued)

const CW_MORSE = {
  A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.", H: "....", I: "..", J: ".---", K: "-.-", L: ".-..", M: "--",
  N: "-.", O: "---", P: ".--.", Q: "--.-", R: ".-.", S: "...", T: "-", U: "..-", V: "...-", W: ".--", X: "-..-", Y: "-.--", Z: "--..",
  0: "-----", 1: ".----", 2: "..---", 3: "...--", 4: "....-", 5: ".....", 6: "-....", 7: "--...", 8: "---..", 9: "----.",
  "?": "..--..", "/": "-..-.", "=": "-...-", ".": ".-.-.-", ",": "--..--"
};

// The key-down times of text at wpm, in units from its start: [[from, to], ...], and its length in units
function cwElements(text)
{
  const on = [];
  let t = 0;
  const words = text.toUpperCase().split(/ +/).filter((w) => w);
  words.forEach((word, wi) =>
  {
    if (wi) t += 7;
    [...word].forEach((ch, ci) =>
    {
      const code = CW_MORSE[ch];
      if (!code) throw new Error("cw: no Morse for " + ch);
      if (ci) t += 3;
      [...code].forEach((el, ei) =>
      {
        if (ei) t += 1;
        const len = el == "." ? 1 : 3;
        on.push([t, t + len]);
        t += len;
      });
    });
  });
  return { on, units: t };
}

// The seconds text takes at wpm
function cwSeconds(text, wpm)
{
  return (cwElements(text).units * 1.2) / wpm;
}

// Text keyed at freq (Hz) and wpm into s from at (seconds), amp its peak; returns the time it ends
function cwKey(common, s, freq, text, wpm, at, amp)
{
  const unit = 1.2 / wpm;
  const ramp = Math.round(0.005 * common.RATE);
  const { on, units } = cwElements(text);
  for (const [from, to] of on)
  {
    const a = Math.round((at + from * unit) * common.RATE);
    const b = Math.min(s.length, Math.round((at + to * unit) * common.RATE));
    for (let i = a; i < b; i++)
    {
      // A raised cosine over the first and last 5 ms; the tone's phase runs on from the file's start
      const edge = Math.min(1, (i - a) / ramp, (b - 1 - i) / ramp);
      const shape = 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, edge));
      s[i] += amp * shape * Math.sin((2 * Math.PI * freq * i) / common.RATE);
    }
  }
  return at + units * unit;
}

// The five: [Hz, WPM, start (s), peak, text]
const CW_SIGNALS = [
  [500, 18, 0.5, 0.22, "CQ CQ CQ DE Q1TST Q1TST PSE K"],
  [800, 25, 3.0, 0.18, "Q1TST DE Q2ABC GM UR RST 599 599 NAME AL QTH NOWHERE HW? K"],
  [1100, 12, 1.5, 0.2, "CQ DE Q3XYZ Q3XYZ K"],
  [1450, 30, 5.0, 0.15, "Q3XYZ DE Q4KLM TNX FER CALL UR RST 579 579 OP ED BK"],
  [1900, 20, 2.0, 0.17, "GRIDTRACKER2 TEST SIGNAL DE N0CALL K"]
];

function build(common)
{
  const end = Math.max(...CW_SIGNALS.map(([, wpm, at, , text]) => at + cwSeconds(text, wpm)));
  const s = common.buffer(Math.max(30, Math.ceil(end + 1.5)));
  for (const [freq, wpm, at, amp, text] of CW_SIGNALS) cwKey(common, s, freq, text, wpm, at, amp);
  // A band's noise floor: heard alone (the Input Device silenced), a quieter one lets the decoder's carrier finder key on its peaks
  common.noise(s, 0.03, 12);
  common.normalize(s, 0.7);
  return [{
    file: "cw-5.wav",
    modes: ["cw"],
    signals: CW_SIGNALS.length,
    rsid: false,
    sync: null,
    description: "Five CW signals at once: " + CW_SIGNALS.map(([f, wpm]) => f + " Hz " + wpm + " WPM").join(", "),
    samples: s
  }];
}

module.exports = { build, cwKey, cwSeconds, CW_SIGNALS };
