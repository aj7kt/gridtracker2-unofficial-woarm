// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Multi-Mode Decoder's AudioWorklet (its audio thread, mmDecoder.js): the Input Device's samples into cwdecoder.wasm (built
// from src/wasm/cwdecoder by tools/build_cw_wasm.js), and out to the page with each waterfall row: the row, the channels' table, the
// characters decoded since the last, and the texts of transmissions read again. The .wasm's bytes come from the page
// (processorOptions.wasm): a worklet can't read files

const CW_CHANNEL_FIELDS = 8;
// FT8 mode: the audio at 12 kHz (ft8_lib's rate), sent on in chunks of this many samples (0.4 s)
const FT8_RATE = 12000;
const FT8_CHUNK = 4800;

class CwDecoderProcessor extends AudioWorkletProcessor
{
  constructor(options)
  {
    super();
    this.ok = false;
    // The rig was retuned (mmdRetune): what was found is let go, and the rows after carry the retune's number
    this.seq = 0;
    // The audio decoded (Settings, Min Freq and Max Freq: "range", Hz)
    this.port.onmessage = (event) =>
    {
      if (!this.ok || !event.data) return;
      if (event.data.type == "retune")
      {
        // The characters decoded before it still go out with the next row: they are the signals' that were there
        this.wasm.cw_retune();
        this.seq = event.data.seq;
      }
      else if (event.data.type == "range") this.wasm.cw_set_range(event.data.min, event.data.max);
      else if (event.data.type == "ft8") this.ft8Start(event.data.on);
    };
    try
    {
      const module = new WebAssembly.Module(options.processorOptions.wasm);
      this.wasm = new WebAssembly.Instance(module, {}).exports;
      // A standalone module's own setup (its C runtime) runs once, before anything else
      if (this.wasm._initialize) this.wasm._initialize();
      // The span to decode (the viewer's Bandwidth): as much of it as this sample rate carries
      this.ok = this.wasm.cw_init(sampleRate, options.processorOptions.span || 4000) == 1;
      this.bins = this.wasm.cw_row_bins();
      this.channelCount = this.wasm.cw_max_channels();
      this.port.postMessage({ type: "ready", ok: this.ok, bins: this.bins, binHz: this.wasm.cw_bin_hz(), sampleRate: sampleRate, span: this.wasm.cw_span() });
    }
    catch (e)
    {
      this.port.postMessage({ type: "ready", ok: false, error: String(e) });
    }
  }

  // FT8 mode on or off. On: a low-pass at 5 kHz (a Blackman-windowed sinc) run at the context's rate, and its output taken every
  // sampleRate / 12000 samples (between two samples, the straight line between them)
  ft8Start(on)
  {
    this.ft8 = !!on;
    if (!this.ft8) return;
    const taps = 63;
    const fc = 5000 / sampleRate;
    this.ft8Fir = new Float32Array(taps);
    let sum = 0;
    for (let i = 0; i < taps; i++)
    {
      const m = i - (taps - 1) / 2;
      const sinc = m == 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * m) / (Math.PI * m);
      const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (taps - 1));
      this.ft8Fir[i] = sinc * w;
      sum += this.ft8Fir[i];
    }
    for (let i = 0; i < taps; i++) this.ft8Fir[i] /= sum;
    // The filter's history kept twice over, so its taps read it in one straight run
    this.ft8Hist = new Float32Array(taps * 2);
    this.ft8HistPos = 0;
    this.ft8Step = sampleRate / FT8_RATE;
    this.ft8In = 0;
    this.ft8Next = 0;
    this.ft8Prev = 0;
    this.ft8Out = new Float32Array(FT8_CHUNK);
    this.ft8Count = 0;
  }

  // The samples of a block into the 12 kHz stream; each full chunk to the page with the audio clock at its last sample
  ft8Feed(samples)
  {
    const taps = this.ft8Fir.length;
    for (let j = 0; j < samples.length; j++)
    {
      this.ft8Hist[this.ft8HistPos] = samples[j];
      this.ft8Hist[this.ft8HistPos + taps] = samples[j];
      this.ft8HistPos = this.ft8HistPos + 1 >= taps ? 0 : this.ft8HistPos + 1;
      let y = 0;
      for (let t = 0; t < taps; t++) y += this.ft8Hist[this.ft8HistPos + t] * this.ft8Fir[taps - 1 - t];
      this.ft8In++;
      while (this.ft8Next <= this.ft8In)
      {
        const frac = this.ft8Next - (this.ft8In - 1);
        this.ft8Out[this.ft8Count++] = this.ft8Prev + (y - this.ft8Prev) * frac;
        this.ft8Next += this.ft8Step;
        if (this.ft8Count == FT8_CHUNK)
        {
          this.port.postMessage({ type: "ft8audio", samples: this.ft8Out, end: currentTime + (j + 1) / sampleRate, seq: this.seq }, [this.ft8Out.buffer]);
          this.ft8Out = new Float32Array(FT8_CHUNK);
          this.ft8Count = 0;
        }
      }
      this.ft8Prev = y;
    }
  }

  process(inputs)
  {
    const input = inputs[0];
    if (!this.ok || !input || input.length == 0) return true;
    // The first channel: a rig's USB audio has the receiver on both (or on the left only)
    const samples = input[0];
    if (this.ft8) this.ft8Feed(samples);
    const X = this.wasm;
    new Float32Array(X.memory.buffer, X.cw_input(), samples.length).set(samples);
    if (X.cw_process(samples.length))
    {
      const row = new Uint8Array(X.memory.buffer, X.cw_row(), this.bins).slice();
      const channels = new Float32Array(X.memory.buffer, X.cw_channels(), this.channelCount * CW_CHANNEL_FIELDS).slice();
      const count = X.cw_event_count();
      const events = new Int32Array(X.memory.buffer, X.cw_events(), count * 2).slice();
      // A transmission read again (an event below 0): its text, by its slot. Plain ASCII, read byte by byte
      const revisions = {};
      for (let i = 1; i < events.length; i += 2)
      {
        if (events[i] >= 0) continue;
        const slot = -events[i] - 1;
        const at = X.cw_revision_text(slot);
        const bytes = new Uint8Array(X.memory.buffer);
        let text = "";
        for (let k = at; at && bytes[k]; k++) text += String.fromCharCode(bytes[k]);
        revisions[slot] = text;
      }
      X.cw_events_clear();
      this.port.postMessage({ type: "row", seq: this.seq, row: row, channels: channels, events: events, revisions: revisions }, [row.buffer, channels.buffer, events.buffer]);
    }
    return true;
  }
}

registerProcessor("cw-decoder", CwDecoderProcessor);
