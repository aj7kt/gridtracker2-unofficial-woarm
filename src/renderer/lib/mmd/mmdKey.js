// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Multi-Mode Decoder's keyboard modes (the Mode menu): PSK31 (with PSK63, PSK125 and QPSK31, its submodes), RTTY, MFSK (MFSK16,
// MFSK32), DominoEX / THOR and NAVTEX (navtexWorker.js). The input's own samples (the worklet's raw stream) go to the mode's worker, which finds every signal of
// the mode in the passband and decodes each on its own: keyWorker.js (PSK's carriers; RTTY's tone pairs 170, 425 or 850 Hz apart, at
// 45.45, 50 or 75 baud), mfskWorker.js, thorWorker.js (each speed, or every one). Here each is a signal of CW's list (DEC.signals: its
// line, its marks on the waterfall, hovered and pinned as CW's), its text added as it comes; the WPM column shows its baud (RTTY's as
// read, the others' their own). A mode with submodes has its menu on the second line (cwKeySub)

// Its signals' ids, apart from CW's (the worklet's, small numbers)
const KEY_ID_BASE = 100000;
// Each mode: its worker; its submodes ([value, name, baud shown]; the default, else the first) and the setting keeping the one picked; what the
// worker is told of it
const KEY_MODES = {
  psk31: {
    worker: "lib/mmd/keyWorker.js",
    setting: "pskSubmode",
    subs: [["psk31", "PSK31", 31], ["psk63", "PSK63", 63], ["psk125", "PSK125", 125], ["qpsk31", "QPSK31", 31]],
    config: (sub) => ({ mode: sub })
  },
  rtty: {
    worker: "lib/mmd/keyWorker.js",
    baud: 45,
    config: () => ({ mode: "rtty" })
  },
  // NAVTEX (SITOR-B, 100 baud): its messages as text, ZCZC to NNNN
  navtex: {
    worker: "lib/mmd/navtexWorker.js",
    baud: 100,
    config: () => ({})
  },
  mfsk: {
    worker: "lib/mmd/mfskWorker.js",
    setting: "mfskSubmode",
    subs: [["mfsk16", "MFSK16", 16], ["mfsk32", "MFSK32", 31]],
    config: (sub) => ({ mode: sub })
  },
  thor: {
    worker: "lib/mmd/thorWorker.js",
    setting: "thorSubmode",
    def: "dominoex 11",
    subs: [4, 5, 8, 11, 16, 22, "all"].map((b) => ["dominoex " + b, "DominoEX " + (b == "all" ? "" : b), b == "all" ? 0 : b])
      .concat([4, 5, 8, 11, 16, 22, "all"].map((b) => ["thor " + b, "THOR " + (b == "all" ? "" : b), b == "all" ? 0 : b])),
    config: (sub) =>
    {
      const [mode, baud] = sub.split(" ");
      return { mode, baud: baud == "all" ? "all" : Number(baud) };
    }
  }
};
// An RSID's mode name (rsidWorker.js) for a mode and submode here
const KEY_RSID_NAMES = {
  "BPSK31": ["psk31", "psk31"], "BPSK63": ["psk31", "psk63"], "BPSK125": ["psk31", "psk125"], "QPSK31": ["psk31", "qpsk31"],
  "RTTY 45": ["rtty", null], "MFSK16": ["mfsk", "mfsk16"], "MFSK32": ["mfsk", "mfsk32"]
};
for (const b of [4, 5, 8, 11, 16, 22])
{
  KEY_RSID_NAMES["DominoEX " + b] = ["thor", "dominoex " + b];
  KEY_RSID_NAMES["THOR" + b] = ["thor", "thor " + b];
}

const KEY = {
  workers: {},  // by file: { worker, rate (it was set up for), config (what it was last told) }
  subKey: ""    // the mode and submode the list's signals are of
};

// One of these modes
function mmdKeyMode(mode = DEC.mode)
{
  return Object.hasOwn(KEY_MODES, mode);
}

// The mode's submode picked ([value, name, baud]), else null (a mode with none)
function mmdKeySub(mode = DEC.mode)
{
  const m = KEY_MODES[mode];
  if (!m || !m.subs) return null;
  const value = GT.settings.MMD[m.setting];
  return m.subs.find((s) => s[0] == value) || m.subs.find((s) => s[0] == m.def) || m.subs[0];
}

// The mode's name as shown ("PSK63", "DominoEX 11", "RTTY")
function mmdKeyName(mode = DEC.mode)
{
  const sub = mmdKeySub(mode);
  if (sub) return sub[1].trim();
  return mode == "rtty" ? "RTTY" : mode == "navtex" ? "NAVTEX" : mode.toUpperCase();
}

// The mode's worker, set up for the input's rate, told the mode and the audio decoded (Min Freq and Max Freq) whenever they change
function mmdKeyLoad(rate, mode = DEC.mode)
{
  const m = KEY_MODES[mode];
  const w = KEY.workers[m.worker] || (KEY.workers[m.worker] = { worker: null, rate: 0, config: "" });
  if (!w.worker)
  {
    w.worker = new Worker(m.worker);
    w.worker.onmessage = (event) => mmdKeyMessage(m.worker, event.data);
  }
  if (w.rate != rate)
  {
    w.rate = rate;
    w.config = "";
    w.worker.postMessage({ type: "init", rate });
  }
  const sub = mmdKeySub(mode);
  const message = Object.assign({ type: "config" }, m.config(sub ? sub[0] : null), { minHz: mmdMinHz(), maxHz: mmdMaxHz() });
  const config = JSON.stringify(message);
  if (w.config != config)
  {
    w.config = config;
    w.worker.postMessage(message);
  }
  return w.worker;
}

// A tenth of a second of the input's samples from the worklet
function mmdKeyAudio(data)
{
  mmdKeyLoad(data.rate).postMessage({ type: "audio", samples: data.samples }, [data.samples.buffer]);
}

// Listening starts again (the mode chosen, a retune, Clear): every signal let go
function mmdKeyReset()
{
  for (const file in KEY.workers) if (KEY.workers[file].worker) KEY.workers[file].worker.postMessage({ type: "reset" });
}

// An RSID heard: the mode's worker leaves its place alone a moment, so its tones aren't taken for a signal
function mmdKeyRsid(freq)
{
  const m = KEY_MODES[DEC.mode];
  const w = m && KEY.workers[m.worker];
  if (w && w.worker) w.worker.postMessage({ type: "rsid", freq });
}

// The mode and submode for an RSID's mode name ([mode, submode or null]), else null
function mmdKeyRsidMode(name)
{
  return KEY_RSID_NAMES[name] || null;
}

// The submode menu on the second line: this mode's, hidden for a mode with none
function mmdKeyMenu()
{
  const m = KEY_MODES[DEC.mode];
  const subs = (m && m.subs) || null;
  cwKeyBox.style.display = subs ? "" : "none";
  if (!subs) return;
  cwKeySub.innerHTML = "";
  const picked = mmdKeySub();
  for (const [value, name] of subs) cwKeySub.add(new Option(value.endsWith(" all") ? name + I18N("cwViewer.key.allSpeeds") : name, value, false, value == picked[0]));
}

// A submode picked (the menu, or an RSID's): the list's signals of the last one go, the worker listens afresh
function mmdKeySubSet(value)
{
  const m = KEY_MODES[DEC.mode];
  if (!m || !m.subs || !m.subs.some((s) => s[0] == value)) return;
  GT.settings.MMD[m.setting] = value;
  cwKeySub.value = value;
  mmdKeyListed();
  mmdKeyReset();
}

function mmdKeyPicked()
{
  mmdKeySubSet(cwKeySub.value);
}

// The list shows this mode's and submode's signals only: another's, they go
function mmdKeyListed()
{
  const sub = mmdKeySub();
  const key = DEC.mode + "|" + (sub ? sub[0] : "");
  if (KEY.subKey == key) return;
  const was = KEY.subKey;
  KEY.subKey = key;
  if (was.split("|")[0] != DEC.mode) return;
  DEC.signals = {};
  DEC.focus = null;
  cwRows.innerHTML = "";
  cwEmpty.textContent = I18N("cwViewer.empty").replace("CW", mmdKeyName());
  DEC.dirty = true;
}

function mmdKeyMessage(file, m)
{
  if (!mmdKeyMode() || KEY_MODES[DEC.mode].worker != file) return;
  if (m.type == "channels")
  {
    const sub = mmdKeySub();
    const seen = {};
    for (const c of m.list)
    {
      const signal = mmdSignal(KEY_ID_BASE + c.id);
      seen[signal.id] = true;
      signal.freq = c.freq;
      signal.air = window.opener.mmDecoderAirHz(c.freq);
      signal.snr = c.snr;
      // The baud: the worker's (RTTY's as read, PSK's its own), DominoEX's and THOR's speed, else the submode's
      signal.wpm = c.baud > 0 ? Math.round(c.baud) : c.submode > 0 ? c.submode : sub ? sub[2] : KEY_MODES[DEC.mode].baud;
      signal.alive = c.active !== false;
    }
    for (const id in DEC.signals) if (Number(id) >= KEY_ID_BASE && !seen[id]) DEC.signals[id].alive = false;
    DEC.dirty = true;
  }
  else if (m.type == "text")
  {
    const signal = mmdSignal(KEY_ID_BASE + m.id);
    // Lines run on: a new line as a space, one space between words
    let text = signal.text + String(m.text).replace(/[\r\n]+/g, " ");
    text = text.replace(/ {2,}/g, " ");
    mmdText(signal, text);
    signal.last = Date.now();
    if (/(^| )CQ $/.test(signal.text)) signal.cqAt = signal.last;
    DEC.dirty = true;
  }
  // NAVTEX: a whole message (ZCZC ... NNNN) to its list (mmdNavtex.js); the channel's running text starts afresh for the next
  else if (m.type == "message" && mmdNavtexMode())
  {
    const signal = DEC.signals[KEY_ID_BASE + m.id];
    mmdNavtexMessage(m, signal ? signal.freq : null);
    if (signal) signal.text = "";
  }
}
