// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// FT8 (or FT4) decoded in the background for GridTracker's instance "MMD" (the window's Settings, Decoders, FT8 or FT4: Enable GridTracker
// Instance, one of the two: mmdInstanceMode), whatever the window shows or decodes, and with it closed: while the Multi-Mode Decoder is on
// and the window isn't decoding that mode itself. That mode's Input Device heard by the window's own pipeline when it is the one the window
// listens to already (its worklet's 12 kHz stream turned on, mmdMessage), else opened here on its own (mmdWorklet.js's ftx-feed: the 12 kHz
// stream alone, no waterfall). Each period decoded as the window's mode does (FT8's Depth; FT4 the Normal way; no focus or time skew), its
// messages to the instance only (nothing shown in the window)

const MMD_BG_SYNC_MS = 3000;

const BG = {
  generation: 0, // the own pipeline's start under way is the newest; an older one that finishes stops what it opened
  syncing: false,
  again: false,
  mode: null,     // the mode decoded ("ft8" or "ft4"), while one is
  tap: false,     // fed by the window's own pipeline (DEC.node's ft8audio)
  starting: false,
  deviceId: null, // the own pipeline's Input Device
  stream: null,
  ctx: null,
  node: null,
  spyVfo: null,   // an SDR server's I/Q as its input: the VFO's id
  spyNode: null,
  spyRate: 0,
  F: null         // { worker, ring, total, endWall, next, cutTotal, early, dial, cycle, sent }
};

function mmdBgInit()
{
  nodeTimers.setInterval(mmdBgSync, MMD_BG_SYNC_MS);
}

// The mode to decode here: the instance's, with the decoder on and the window not in that mode (it decodes for the instance itself then,
// mmdListen); else null
function mmdBgMode()
{
  const mode = GT.settings.MMD.enable === true ? mmdInstanceMode() : null;
  return mode && DEC.mode != mode ? mode : null;
}

// Heard: from the window's pipeline, or the own one up
function mmdBgRunning()
{
  return BG.tap || BG.node != null;
}

function mmdBgPeriodMs()
{
  return BG.mode == "ft4" ? FT4_PERIOD_MS : FT8_PERIOD_MS;
}

// Decoded the Normal way (ft8_lib as it comes): FT4 always, FT8 at Depth Normal (as mmdFt8Plain)
function mmdBgPlain()
{
  return BG.mode == "ft4" || GT.settings.MMD.ft8Depth == "normal";
}

// As the window starts, stops, changes mode or input, and every few seconds: tapping the window's pipeline, an own one, or nothing. One at a
// time; asked again meanwhile, done again after
async function mmdBgSync()
{
  if (BG.syncing)
  {
    BG.again = true;
    return;
  }
  BG.syncing = true;
  try
  {
    do
    {
      BG.again = false;
      await mmdBgSyncOnce();
    }
    while (BG.again);
  }
  catch (e)
  {
    // Tried again by the next sync
  }
  BG.syncing = false;
  mmdInstanceSay();
}

async function mmdBgSyncOnce()
{
  const mode = mmdBgMode();
  // Another mode (or none): what was heard is let go, the periods counted afresh, and a decode still under way in the worker is the old
  // mode's (dropped as it comes back: mmdBgDecoded)
  if (mode != BG.mode)
  {
    BG.mode = mode;
    if (BG.F)
    {
      BG.F.total = 0;
      BG.F.cycle++;
    }
  }
  if (!mode)
  {
    mmdBgTapSet(false);
    mmdBgOwnStop();
    return;
  }
  const devices = await mmdInputDevices();
  const device = window.opener.mmDecoderInputFind(mode, devices) || devices[0];
  if (!device)
  {
    mmdBgTapSet(false);
    mmdBgOwnStop();
    return;
  }
  // The window's pipeline already listens to it: its stream taken (an SDR server's I/Q has one listener only)
  if (DEC.running && DEC.node && DEC.deviceId == device.deviceId)
  {
    mmdBgOwnStop();
    mmdBgTapSet(true);
    return;
  }
  // The window's pipeline starting: decided once it is up (or has failed), it may be on this input
  if (DEC.running && !DEC.node) return;
  mmdBgTapSet(false);
  if (BG.node && BG.deviceId != device.deviceId) mmdBgOwnStop();
  if (!BG.node && !BG.starting) await mmdBgOwnStart(device);
}

// The window's worklet's 12 kHz stream on or off for it (left on in FT8, FT4 and SSTV, which use it: mmdFt8StreamWanted). What was heard is
// let go either way (the other source's audio isn't one with it)
function mmdBgTapSet(on)
{
  if (BG.tap == on) return;
  BG.tap = on;
  if (BG.F) BG.F.total = 0;
  if (DEC.node && !(mmdFtx() || DEC.mode == "sstv")) DEC.node.port.postMessage({ type: "ft8", on: on });
}

async function mmdBgOwnStart(device)
{
  const generation = ++BG.generation;
  BG.starting = true;
  let stream = null;
  let ctx = null;
  try
  {
    let rate = null;
    if (device.spyVfo)
    {
      BG.spyVfo = device.spyVfo;
      rate = window.opener.rigIqStart(device.spyVfo, 2 * FT8_AUDIO[1], (iq, at) => mmdBgSpyIq(iq, at, generation));
      // Not connected yet: tried again by the next sync
      if (!(rate > 0)) throw null;
      BG.spyRate = rate;
    }
    else
    {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: device.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }
      });
      rate = (stream.getAudioTracks()[0].getSettings() || {}).sampleRate;
    }
    try
    {
      ctx = new AudioContext(rate > 0 ? { latencyHint: "playback", sampleRate: rate } : { latencyHint: "playback" });
    }
    catch (e)
    {
      ctx = new AudioContext({ latencyHint: "playback" });
    }
    await ctx.audioWorklet.addModule("lib/mmd/mmdWorklet.js");
    if (generation != BG.generation) throw null;
    const node = new AudioWorkletNode(ctx, "ftx-feed", { numberOfInputs: 1, numberOfOutputs: 0 });
    node.port.onmessage = (event) =>
    {
      if (generation == BG.generation && event.data && event.data.type == "ft8audio") mmdBgAudio(event.data, ctx);
    };
    let source;
    if (device.spyVfo)
    {
      source = new AudioWorkletNode(ctx, "iq-usb", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
      BG.spyNode = source;
    }
    else source = ctx.createMediaStreamSource(stream);
    // The mode's SW level (the window's levels, in that mode)
    const gain = ctx.createGain();
    const db = Number((GT.settings.MMD.swGain || {})[BG.mode]);
    gain.gain.value = Number.isFinite(db) ? Math.pow(10, Math.max(-MMD_SW_MAX_DB, Math.min(MMD_SW_MAX_DB, db)) / 20) : 1;
    source.connect(gain);
    gain.connect(node);
    BG.stream = stream;
    BG.ctx = ctx;
    BG.node = node;
    BG.deviceId = device.deviceId;
    if (BG.F) BG.F.total = 0;
  }
  catch (e)
  {
    if (stream) stream.getTracks().forEach((track) => track.stop());
    if (ctx) ctx.close().catch(() => {});
    if (generation == BG.generation) mmdBgSpyStop();
  }
  if (generation == BG.generation) BG.starting = false;
}

function mmdBgOwnStop()
{
  BG.generation++;
  BG.starting = false;
  if (BG.node) BG.node.port.onmessage = null;
  if (BG.stream) BG.stream.getTracks().forEach((track) => track.stop());
  if (BG.ctx) BG.ctx.close().catch(() => {});
  mmdBgSpyStop();
  BG.stream = null;
  BG.ctx = null;
  BG.node = null;
  BG.deviceId = null;
  if (BG.F) BG.F.total = 0;
}

// The server's samples into iq-usb (as mmdSpyIq). Come at another rate: the own pipeline stopped, started again by the next sync
function mmdBgSpyIq(iq, rate, generation)
{
  if (generation != BG.generation || !BG.spyNode) return;
  if (rate != BG.spyRate)
  {
    setTimeout(mmdBgOwnStop, 0);
    return;
  }
  const samples = new Float32Array(iq);
  BG.spyNode.port.postMessage(samples, [samples.buffer]);
}

// The server's stream let go, unless the window's pipeline has taken it over meanwhile (one listener per server)
function mmdBgSpyStop()
{
  if (BG.spyVfo && BG.spyVfo != DEC.spyVfo)
  {
    try
    {
      window.opener.rigIqStop(BG.spyVfo);
    }
    catch (e)
    {
      // The main window going away
    }
  }
  BG.spyVfo = null;
  BG.spyNode = null;
}

// ---- The decoding (as the window's mmdFt8Load, mmdFt8Audio, mmdFt8Decode and mmdFt8Decoded, with no focus or time skew)

function mmdBgLoad()
{
  if (BG.F) return BG.F;
  const bytes = fs.readFileSync(NodeURL.fileURLToPath(new URL("lib/mmd/ft8.wasm", location.href)));
  const worker = new Worker("lib/mmd/ft8Worker.js");
  const prefixes = Object.keys(GT.prefixToDXCC || {}).filter((prefix) => /^[A-Z0-9]+$/.test(prefix)).join("\n");
  worker.postMessage({ type: "init", wasm: bytes, audio: FT8_AUDIO, passes: FT8_PASSES, prefixes: prefixes });
  // cycle: counts the mode changes; sent: each period sent to decode, by its start, with the cycle it was sent in
  const F = { worker: worker, ring: new Float32Array(FT8_KEEP_S * FT8_RATE), total: 0, endWall: 0, next: 0, dial: null, cycle: 0, sent: new Map() };
  worker.onmessage = (event) => mmdBgDecoded(F, event.data);
  BG.F = F;
  return F;
}

// A chunk of 12 kHz audio (ctx: the context it was heard in, for its clock). The mode's VFO's dial moved: the period under way decoded from
// here on only (as mmdRetune)
function mmdBgAudio(data, ctx)
{
  if (!BG.mode) return;
  let F;
  try
  {
    F = mmdBgLoad();
  }
  catch (e)
  {
    return;
  }
  const stamp = ctx.getOutputTimestamp();
  const endWall = performance.timeOrigin + stamp.performanceTime + (data.end - stamp.contextTime) * 1000 - FT8_LATENCY_MS;
  const read = window.opener.mmDecoderVfoRead(BG.mode);
  const dial = read.up ? Math.round(read.freq) : null;
  if (F.total > 0 && dial !== F.dial)
  {
    F.cutTotal = F.total;
    if (F.early == F.next) F.early = null;
  }
  F.dial = dial;
  const n = data.samples.length;
  const size = F.ring.length;
  for (let i = 0; i < n; i++) F.ring[(F.total + i) % size] = data.samples[i];
  const periodMs = mmdBgPeriodMs();
  if (F.total == 0)
  {
    F.next = Math.ceil((endWall - (n / FT8_RATE) * 1000) / periodMs) * periodMs;
    F.cutTotal = 0;
    F.early = null;
  }
  F.total += n;
  F.endWall = endWall;
  while (F.endWall >= F.next + periodMs + FT8_LATE_MS)
  {
    mmdBgDecode(F, F.next, periodMs);
    F.next += periodMs;
  }
  // The early decode is Deep's (FT8 only)
  if (!mmdBgPlain() && F.early != F.next && F.endWall >= F.next + FT8_EARLY_MS + FT8_LATE_MS) mmdBgDecode(F, F.next, FT8_EARLY_MS);
}

function mmdBgDecode(F, start, heard)
{
  const first = F.total - Math.round(((F.endWall - start) / 1000) * FT8_RATE);
  const count = Math.round((heard / 1000) * FT8_RATE);
  if (first < 0 || first < F.total - F.ring.length) return;
  const samples = new Float32Array(count);
  const cut = first + count > (F.cutTotal || 0) ? F.cutTotal || 0 : 0;
  for (let i = 0; i < count; i++) samples[i] = first + i < cut ? 0 : F.ring[(first + i) % F.ring.length];
  const periodMs = mmdBgPeriodMs();
  const ft4 = BG.mode == "ft4";
  const more = heard == periodMs && F.early == start;
  if (heard < periodMs) F.early = start;
  const myCall = (GT.settings.app.myCall || "").trim().toUpperCase();
  const deadline = heard < periodMs ? start + FT8_EARLY_DEADLINE_MS : Date.now() + (ft4 ? FT4_BUDGET_MS : FT8_FULL_BUDGET_MS);
  F.worker.postMessage({ type: "decode", start: start, samples: samples, more: more, myCall: myCall, focus: 0, shift: 0, deadline: deadline, plain: mmdBgPlain(), ft4: ft4 }, [samples.buffer]);
  // Sent in this mode (the old periods' entries let go)
  F.sent.set(start, F.cycle);
  for (const at of F.sent.keys()) if (start - at > 4 * periodMs) F.sent.delete(at);
  window.opener.mmDecoderInstanceDecoding(true);
}

// A period's messages: to GridTracker's instance, DT from half a second into the period (as WSJT-X's). One sent before the mode changed
// (FT8's with FT4's instance on now, or the other way) is dropped
function mmdBgDecoded(F, data)
{
  if (data.type != "decoded" || BG.F != F) return;
  if (mmdBgRunning() && F.sent.get(data.start) === F.cycle)
  {
    const lines = data.text.split("\n").filter(Boolean).map((line) => line.split("\t"));
    window.opener.mmDecoderInstanceDecodes(data.start, lines.map(([snr, dt, freq, message]) => [Number(snr), Number(dt) - FT8_DT_ZERO, Number(freq), message || ""]));
  }
  window.opener.mmDecoderInstanceDecoding(false);
}
