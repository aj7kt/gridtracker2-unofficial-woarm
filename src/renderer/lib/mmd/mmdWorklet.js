// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Multi-Mode Decoder's AudioWorklet (its audio thread, mmDecoder.js): the Input Device's samples into cwdecoder.wasm (built
// from src/wasm/cwdecoder by tools/build_cw_wasm.js), and out to the page with each waterfall row: the row, the channels' table, the
// characters decoded since the last, and the texts of transmissions read again. The .wasm's bytes come from the page
// (processorOptions.wasm): a worklet can't read files. Also iq-usb (below): a SPY Server's I/Q as the audio it decodes

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
      // CW decoded only in CW mode (FT8 and SSTV decode their own audio): otherwise the waterfall's rows alone
      else if (event.data.type == "decode") this.wasm.cw_set_decode(event.data.on ? 1 : 0);
      else if (event.data.type == "ft8") this.ft8Start(event.data.on);
      else if (event.data.type == "raw") this.rawStart(event.data.on);
      // The waterfall's own spectrum: its window's length (0 to 3: a quarter to twice the FFT) and shape (0 Hann, 1 Blackman-Harris)
      else if (event.data.type == "view") this.wasm.cw_set_view(event.data.scale | 0, event.data.window | 0);
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

  // Packet mode on or off. On: the input's samples as they come (at the context's rate: FSK 9600 needs more than 12 kHz), sent on in
  // chunks of a tenth of a second
  rawStart(on)
  {
    // Already on (another mode that takes it too): the chunk under way kept, so the stream has no gap (a decoder carried on across the
    // change, as one an RSID was clicked for, would lose its place)
    if (on && this.raw) return;
    this.raw = !!on;
    // The chunk's size kept apart: a chunk sent is handed over (its buffer detached, its length 0 after)
    this.rawSize = Math.round(sampleRate / 10);
    this.rawOut = this.raw ? new Float32Array(this.rawSize) : null;
    this.rawCount = 0;
  }

  rawFeed(samples)
  {
    for (let j = 0; j < samples.length; j++)
    {
      this.rawOut[this.rawCount++] = samples[j];
      if (this.rawCount == this.rawSize)
      {
        this.port.postMessage({ type: "rawaudio", samples: this.rawOut, rate: sampleRate, seq: this.seq }, [this.rawOut.buffer]);
        this.rawOut = new Float32Array(this.rawSize);
        this.rawCount = 0;
      }
    }
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
    if (this.raw) this.rawFeed(samples);
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
      // The waterfall's spectrum (cw_view): each bin's dB over its floor, then its dB re full scale
      const view = new Float32Array(X.memory.buffer, X.cw_view(), this.bins * 2).slice();
      this.port.postMessage({ type: "row", seq: this.seq, row: row, view: view, channels: channels, events: events, revisions: revisions }, [row.buffer, view.buffer, channels.buffer, events.buffer]);
    }
    return true;
  }
}

registerProcessor("cw-decoder", CwDecoderProcessor);

// A SPY Server's I/Q (the page's mmdSpyIq: I and Q in turn, at the context's rate) made into the audio above its centre, as a rig in USB
// gives it: a complex filter that passes the frequencies above 0 Hz and not those below (a half-band low-pass, cut at a quarter of the
// rate, moved up by a quarter), its real part out. A half-band filter's taps are 0 at every even distance from its middle but the middle:
// moved up, the I side is the middle tap alone (a delay, times a half) and the Q side a Hilbert transformer, its taps at odd distances
// only and opposite either side, so each sample takes one multiply for each pair (IQ_TAPS / 4), whatever the rate.
// The server's clock and the sound card's differ a little: the samples wait in a queue, played from once it holds IQ_START_S; emptied
// (a gap), it fills to that again; grown past IQ_MAX_S, the oldest are dropped down to IQ_START_S
const IQ_TAPS = 255;
const IQ_START_S = 0.15;
const IQ_MAX_S = 0.6;

class IqUsbProcessor extends AudioWorkletProcessor
{
  constructor()
  {
    super();
    const c = (IQ_TAPS - 1) / 2;
    let sum = 0;
    const lp = new Float32Array(IQ_TAPS);
    for (let i = 0; i < IQ_TAPS; i++)
    {
      const m = i - c;
      const sinc = m == 0 ? 0.5 : Math.sin((Math.PI / 2) * m) / (Math.PI * m);
      const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (IQ_TAPS - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (IQ_TAPS - 1));
      lp[i] = sinc * w;
      sum += lp[i];
    }
    // The middle tap (I's), and the Q side's for each odd distance m from the middle: the tap m after it (the one m before it is that,
    // turned over)
    this.mid = lp[c] / sum;
    this.odd = [];
    this.gain = [];
    for (let m = 1; m <= c; m += 2)
    {
      this.odd.push(m);
      this.gain.push((lp[c + m] / sum) * Math.sin((Math.PI / 2) * m));
    }
    this.c = c;
    // The filter's history, I and Q, each kept twice over so its taps read it in one straight run
    this.xi = new Float32Array(IQ_TAPS * 2);
    this.xq = new Float32Array(IQ_TAPS * 2);
    this.pos = 0;
    // The queue: I and Q in turn, a ring
    this.queue = new Float32Array(Math.ceil(sampleRate * IQ_MAX_S * 2) * 2);
    this.head = 0;
    this.count = 0;
    this.playing = false;
    this.port.onmessage = (event) => this.push(event.data);
  }

  push(iq)
  {
    const size = this.queue.length;
    for (let i = 0; i < iq.length; i++)
    {
      this.queue[(this.head + this.count) % size] = iq[i];
      if (this.count < size) this.count++;
      else this.head = (this.head + 1) % size;
    }
    // Too far behind: the oldest dropped, down to where it starts from (a whole pair at a time)
    if (this.count > sampleRate * IQ_MAX_S * 2)
    {
      const drop = (this.count - Math.round(sampleRate * IQ_START_S) * 2) & ~1;
      this.head = (this.head + drop) % size;
      this.count -= drop;
    }
  }

  process(inputs, outputs)
  {
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;
    const size = this.queue.length;
    if (!this.playing && this.count >= sampleRate * IQ_START_S * 2) this.playing = true;
    for (let j = 0; j < out.length; j++)
    {
      if (!this.playing || this.count < 2)
      {
        this.playing = false;
        out[j] = 0;
        continue;
      }
      const i = this.queue[this.head];
      const q = this.queue[(this.head + 1) % size];
      this.head = (this.head + 2) % size;
      this.count -= 2;
      this.xi[this.pos] = this.xi[this.pos + IQ_TAPS] = i;
      this.xq[this.pos] = this.xq[this.pos + IQ_TAPS] = q;
      this.pos = this.pos + 1 >= IQ_TAPS ? 0 : this.pos + 1;
      // The real part of the filtered sample: the history runs oldest to newest from pos, its middle (c samples ago) at pos + c; the
      // sample m before the middle is at pos + c - m, the one m after it at pos + c + m
      const middle = this.pos + this.c;
      let y = this.mid * this.xi[middle];
      for (let k = 0; k < this.odd.length; k++)
      {
        const m = this.odd[k];
        y -= this.gain[k] * (this.xq[middle - m] - this.xq[middle + m]);
      }
      out[j] = y;
    }
    return true;
  }
}

registerProcessor("iq-usb", IqUsbProcessor);

// A network stream's audio (the page's mmdNetPcm: mono samples at the stream's rate, processorOptions.rate) as the decoder's input. The
// stream's clock and the context's differ a little, and packets come in bursts: the samples wait in a queue, played from once it holds
// NET_START_S. The queue is held near NET_TARGET_S by reading it a little faster or slower (at most NET_MAX_TRIM), the fill smoothed over a
// few seconds so the jitter of the packets doesn't move it, each sample read between its neighbors (a cubic through four of them). Emptied
// (the stream stopped): silence until it holds NET_START_S again; grown past NET_MAX_S (a stall let go all at once), the oldest dropped down
// to NET_TARGET_S. A stream at another rate than the context's is read at the ratio between them
const NET_START_S = 0.2;
const NET_TARGET_S = 0.2;
const NET_MAX_S = 1.5;
const NET_MAX_TRIM = 0.005;
// How hard the fill's distance from the target trims the rate (per second of it), and the smoothing of the fill (s)
const NET_TRIM_GAIN = 0.02;
const NET_SMOOTH_S = 4;

class PcmInProcessor extends AudioWorkletProcessor
{
  constructor(options)
  {
    super();
    const rate = (options && options.processorOptions && options.processorOptions.rate) || sampleRate;
    this.rate = rate;
    this.base = rate / sampleRate;
    this.queue = new Float32Array(Math.ceil(rate * NET_MAX_S) + 4096);
    this.head = 0;
    this.count = 0;
    // Where the next sample is read, between queue[head] and queue[head + 1]
    this.frac = 0;
    this.playing = false;
    this.fill = NET_TARGET_S;
    this.port.onmessage = (event) => this.push(event.data);
  }

  push(samples)
  {
    const size = this.queue.length;
    for (let i = 0; i < samples.length; i++)
    {
      this.queue[(this.head + this.count) % size] = samples[i];
      if (this.count < size) this.count++;
      else this.head = (this.head + 1) % size;
    }
    if (this.count > this.rate * NET_MAX_S)
    {
      const drop = this.count - Math.round(this.rate * NET_TARGET_S);
      this.head = (this.head + drop) % size;
      this.count -= drop;
      this.fill = NET_TARGET_S;
    }
  }

  at(k)
  {
    return this.queue[(this.head + k) % this.queue.length];
  }

  process(inputs, outputs)
  {
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;
    if (!this.playing && this.count >= this.rate * NET_START_S)
    {
      this.playing = true;
      this.fill = this.count / this.rate;
    }
    // The fill smoothed, and the rate trimmed from how far it is from the target
    const alpha = out.length / (sampleRate * NET_SMOOTH_S);
    this.fill += alpha * (this.count / this.rate - this.fill);
    const trim = Math.max(-NET_MAX_TRIM, Math.min(NET_MAX_TRIM, NET_TRIM_GAIN * (this.fill - NET_TARGET_S)));
    const step = this.base * (1 + trim);
    const size = this.queue.length;
    for (let j = 0; j < out.length; j++)
    {
      // Four samples needed around where it reads: the one before, the two it is between, the one after
      if (!this.playing || this.count < 4)
      {
        this.playing = false;
        out[j] = 0;
        continue;
      }
      const t = this.frac;
      const y0 = this.at(0), y1 = this.at(1), y2 = this.at(2), y3 = this.at(3);
      out[j] = y1 + 0.5 * t * (y2 - y0 + t * (2 * y0 - 5 * y1 + 4 * y2 - y3 + t * (3 * (y1 - y2) + y3 - y0)));
      this.frac += step;
      const whole = Math.floor(this.frac);
      if (whole > 0)
      {
        const used = Math.min(whole, this.count);
        this.head = (this.head + used) % size;
        this.count -= used;
        this.frac -= whole;
      }
    }
    return true;
  }
}

registerProcessor("pcm-in", PcmInProcessor);

// What is sent to a network stream (an Output Device that is one: mmdSstvTx.js): the audio reaching this node, mono, handed to the page in
// pieces of processorOptions.chunk samples as the context plays them, so they go out at the pace they are made. Nothing connected (yet):
// silence, so the stream stays steady
class PcmOutProcessor extends AudioWorkletProcessor
{
  constructor(options)
  {
    super();
    this.chunk = Math.max(128, (options && options.processorOptions && options.processorOptions.chunk) || 960);
    this.buffer = new Float32Array(this.chunk);
    this.fill = 0;
  }

  process(inputs)
  {
    const input = inputs[0] && inputs[0][0];
    const n = input ? input.length : 128;
    for (let i = 0; i < n; i++)
    {
      this.buffer[this.fill++] = input ? input[i] : 0;
      if (this.fill == this.chunk)
      {
        this.port.postMessage(this.buffer, [this.buffer.buffer]);
        this.buffer = new Float32Array(this.chunk);
        this.fill = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm-out", PcmOutProcessor);
