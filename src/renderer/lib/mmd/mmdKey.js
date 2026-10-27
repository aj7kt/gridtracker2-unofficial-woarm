// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Multi-Mode Decoder's PSK31 and RTTY modes (the Mode menu): the input's own samples (the worklet's raw stream) go to keyWorker.js,
// which finds every signal of the mode in the passband (PSK31's carriers, RTTY's 170 Hz tone pairs at 45.45 baud) and decodes each on
// its own. Here each is a signal of CW's list (DEC.signals: its line, its marks on the waterfall, hovered and pinned as CW's), its text
// added as it comes; the WPM column shows the mode's baud

// Its signals' ids, apart from CW's (the worklet's, small numbers)
const KEY_ID_BASE = 100000;
const KEY_BAUD = { psk31: 31, rtty: 45 };

const KEY = {
  worker: null,
  rate: 0,      // the sample rate the worker was set up for
  config: ""    // the mode and audio range it was last told
};

// PSK31 or RTTY
function mmdKeyMode(mode = DEC.mode)
{
  return mode == "psk31" || mode == "rtty";
}

// keyWorker.js, set up for the input's rate, told the mode and the audio decoded (Min Freq and Max Freq) whenever they change
function mmdKeyLoad(rate)
{
  if (!KEY.worker)
  {
    KEY.worker = new Worker("lib/mmd/keyWorker.js");
    KEY.worker.onmessage = (event) => mmdKeyMessage(event.data);
  }
  if (KEY.rate != rate)
  {
    KEY.rate = rate;
    KEY.config = "";
    KEY.worker.postMessage({ type: "init", rate });
  }
  const config = DEC.mode + "|" + mmdMinHz() + "|" + mmdMaxHz();
  if (KEY.config != config)
  {
    KEY.config = config;
    KEY.worker.postMessage({ type: "config", mode: DEC.mode, minHz: mmdMinHz(), maxHz: mmdMaxHz() });
  }
  return KEY.worker;
}

// A tenth of a second of the input's samples from the worklet
function mmdKeyAudio(data)
{
  mmdKeyLoad(data.rate).postMessage({ type: "audio", samples: data.samples }, [data.samples.buffer]);
}

// Listening starts again (the mode chosen, a retune, Clear): every signal let go
function mmdKeyReset()
{
  if (KEY.worker) KEY.worker.postMessage({ type: "reset" });
}

function mmdKeyMessage(m)
{
  if (!mmdKeyMode()) return;
  if (m.type == "channels")
  {
    const seen = {};
    for (const c of m.list)
    {
      const signal = mmdSignal(KEY_ID_BASE + c.id);
      seen[signal.id] = true;
      signal.freq = c.freq;
      signal.air = window.opener.mmDecoderAirHz(c.freq);
      signal.snr = c.snr;
      signal.wpm = KEY_BAUD[DEC.mode];
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
}
