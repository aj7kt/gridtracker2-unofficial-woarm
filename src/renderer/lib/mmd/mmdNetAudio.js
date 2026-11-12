// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// Network Audio (the main window's netAudio.js) as the decoder's Input and Output Devices: a stream on the LAN (VBAN, RTP, PipeWire /
// PulseAudio), or a Rig Control VFO's own audio (FlexRadio DAX, Icom LAN). An input's samples come from the main window, are copied into
// this window and queued in the worklet's pcm-in, which keeps them steady against the context's clock; the context runs at the stream's
// rate, so they are decoded as they came. An output is the worklet's pcm-out, handing what the context plays to the main window to send

// How often the start looks again while it waits for a stream's first audio (its rate is known from it)
const MMD_NET_WAIT_MS = 500;
// The audio kept while the context is made (s): the queue starts from it, so only the newest, as much as the worklet's pcm-in holds its
// queue at (NET_TARGET_S). More (the rate is known only at the second look, MMD_NET_WAIT_MS in) would be read up to 0.5% fast for a
// minute or two to come down to it, slanting a picture or a chart begun meanwhile
const MMD_NET_EARLY_S = 0.2;
// The pieces an output's samples are handed over in (s)
const MMD_NET_OUT_CHUNK_S = 0.02;

// The network inputs there are, as the Input Device menus list them: { deviceId: "net:n1" or "rig:v1", label, netAudio: that id }
function mmdNetInputDevices()
{
  const opener = window.opener;
  if (typeof opener.netAudioDevices != "function") return [];
  return opener.netAudioDevices("in").map((d) => ({ deviceId: d.id, label: d.label, kind: "audioinput", netAudio: d.id }));
}

function mmdNetOutputDevices()
{
  const opener = window.opener;
  if (typeof opener.netAudioDevices != "function") return [];
  return opener.netAudioDevices("out").map((d) => ({ deviceId: d.id, label: d.label, kind: "audiooutput", netAudio: d.id }));
}

// ---- Input

// Listening to a network input for the decoder started (generation): resolves with its rate once its first audio comes; meanwhile the
// status says it waits, and what the stream's own status says. Stopped (or started again) meanwhile: rejected with nothing (mmdStart
// then says nothing)
function mmdNetStart(device, generation)
{
  DEC.netRate = null;
  DEC.netEarly = [];
  DEC.netNode = null;
  DEC.netToken = window.opener.netAudioListen(device.netAudio, (samples, rate) => mmdNetPcm(samples, rate, generation));
  if (DEC.netToken == null) return Promise.reject(new Error(I18N("cwViewer.status.netGone").replace("{name}", mmdInputLabel(device))));
  return new Promise((resolve, reject) =>
  {
    const look = () =>
    {
      if (generation != DEC.generation)
      {
        reject(null);
        return;
      }
      if (DEC.netRate > 0)
      {
        resolve(DEC.netRate);
        return;
      }
      const status = window.opener.netAudioStatus(device.netAudio);
      mmdStatus(I18N("cwViewer.status.netWait").replace("{name}", mmdInputLabel(device)) + (status.text ? " (" + status.text + ")" : ""), status.error);
      nodeTimers.setTimeout(look, MMD_NET_WAIT_MS);
    };
    look();
  });
}

// A piece heard, for the decoder started (generation) only: copied into this window's own array, into the worklet (kept until it is
// made). Come at another rate (the stream set up again at the far end): the decoder started again at it
function mmdNetPcm(samples, rate, generation)
{
  if (generation != DEC.generation) return;
  if (!(rate > 0)) return;
  if (DEC.netRate === null) DEC.netRate = rate;
  else if (rate != DEC.netRate)
  {
    DEC.netRate = rate;
    nodeTimers.setTimeout(mmDecoderRestart, 0);
    return;
  }
  const own = new Float32Array(samples);
  if (DEC.netNode)
  {
    DEC.netNode.port.postMessage(own, [own.buffer]);
    return;
  }
  DEC.netEarly.push(own);
  let kept = DEC.netEarly.reduce((sum, piece) => sum + piece.length, 0);
  while (kept > rate * MMD_NET_EARLY_S && DEC.netEarly.length > 1) kept -= DEC.netEarly.shift().length;
}

// The worklet's node the samples go into, made: what came meanwhile handed to it first
function mmdNetNode(ctx)
{
  const node = new AudioWorkletNode(ctx, "pcm-in", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { rate: DEC.netRate } });
  for (const piece of DEC.netEarly) node.port.postMessage(piece, [piece.buffer]);
  DEC.netEarly = [];
  DEC.netNode = node;
  return node;
}

// Let go (the decoder stopped)
function mmdNetStop()
{
  if (DEC.netToken != null)
  {
    try
    {
      window.opener.netAudioUnlisten(DEC.netToken);
    }
    catch (e)
    {
      // The main window going away
    }
  }
  DEC.netToken = null;
  DEC.netNode = null;
  DEC.netEarly = [];
}

// ---- Output

// The context a mode sends on when its Output Device is a network one: at the rate the stream takes, everything played into the node it
// returns (in place of the context's destination) sent as it plays. { ctx, node, token }; it throws when the stream isn't there
async function mmdNetOutput(device)
{
  const opener = window.opener;
  const send = opener.netAudioSendStart(device.netAudio);
  if (!send) throw new Error(I18N("cwViewer.status.netGone").replace("{name}", mmdInputLabel(device)));
  let ctx = null;
  try
  {
    // (Only at the stream's rate: at another, the audio sent would be off pitch. "interactive", never "playback": a "playback" context
    // misses a render callback now and then, measured 2026-11-11, and the audio of it would be lost)
    ctx = new AudioContext({ latencyHint: "interactive", sampleRate: send.rate });
    await ctx.audioWorklet.addModule("lib/mmd/mmdWorklet.js");
    const node = new AudioWorkletNode(ctx, "pcm-out", { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: "explicit", processorOptions: { chunk: Math.round(ctx.sampleRate * MMD_NET_OUT_CHUNK_S) } });
    node.port.onmessage = (event) =>
    {
      try
      {
        opener.netAudioSend(send.token, event.data);
      }
      catch (e)
      {
        // The main window going away
      }
    };
    return { ctx: ctx, node: node, token: send.token };
  }
  catch (e)
  {
    if (ctx) ctx.close().catch(() => {});
    mmdNetOutputStop(send.token);
    throw e;
  }
}

function mmdNetOutputStop(token)
{
  if (token == null) return;
  try
  {
    window.opener.netAudioSendStop(token);
  }
  catch (e)
  {
    // The main window going away
  }
}
