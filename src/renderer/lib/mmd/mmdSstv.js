// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Multi-Mode Decoder's SSTV mode (the Mode menu): the 12 kHz audio the worklet sends (as for FT8) goes to sstvWorker.js, which reads
// the pictures; each one goes to the picture view (mmdPictures.js: drawn as it comes in, kept in its strip, saved with Settings' Save
// Pictures or a right-click). Its Send tab is mmdSstvTx.js

const SSTV = {
  worker: null,  // sstvWorker.js, once
  status: { state: "idle", snr: -20, line: 0, lines: 0 },
  tab: "receive" // the view's tab: "receive" (the pictures) or "send" (Send Picture, mmdSstvTx.js)
};

// SSTV's pictures in the picture view: saved in Save Pictures' folder (MMD.sstvFolder, else SSTV Pictures beside GridTracker's own
// folders: services/mmDecoder.js) with Save Pictures (MMD.sstvSave); a saved file's name part is its mode's ("Martin1": Martin 1), any
// name the other kinds don't claim
mmdPicturesKind({
  kind: "sstv",
  modes: ["sstv"],
  folder: () => window.opener.mmDecoderSstvFolder(),
  saveKey: "sstvSave",
  idleKey: "cwViewer.sstv.idle",
  grows: false,
  background: "black",
  planes: 3,
  tabs: true,
  // Its mode's spaces put back (Martin 1, Scottie DX, PD 120)
  fromFile: (name) => name.replace(/^([A-Za-z]+?)(\d+|DX)$/, "$1 $2"),
  catchAll: true
});

// SSTV mode
function mmdSstvMode(mode = DEC.mode)
{
  return mode == "sstv";
}

// The worker, once
function mmdSstvLoad()
{
  if (SSTV.worker) return SSTV.worker;
  SSTV.worker = new Worker("lib/mmd/sstvWorker.js");
  SSTV.worker.onmessage = (event) => mmdSstvMessage(event.data);
  return SSTV.worker;
}

// A chunk of 12 kHz audio from the worklet
function mmdSstvAudio(data)
{
  mmdSstvLoad().postMessage({ type: "audio", samples: data.samples }, [data.samples.buffer]);
}

// The audio starts again (SSTV mode chosen, the input started, Clear, a retune): what the worker was reading is let go
function mmdSstvReset()
{
  if (SSTV.worker) SSTV.worker.postMessage({ type: "reset" });
  SSTV.status = { state: "idle", snr: -20, line: 0, lines: 0 };
  mmdPicReset("sstv");
}

// Clear: the strip emptied as well (saved pictures stay where they are)
function mmdSstvClear()
{
  mmdSstvReset();
  mmdPicClear("sstv");
}

function mmdSstvMessage(m)
{
  // Another kind's mode showing (WEFAX's): nothing of SSTV's shown meanwhile
  const shown = mmdPicKind();
  if (shown && shown != "sstv") return;
  if (m.type == "status")
  {
    SSTV.status = m;
    mmdPicHead();
    return;
  }
  if (m.type == "start")
  {
    mmdPicStart("sstv", { id: m.id, name: m.name, width: m.width, height: m.height, shift: m.shift || 0 });
    return;
  }
  if (m.type == "rows") mmdPicRows("sstv", m.id, m.from, m.count, m.rgba);
  // Drawn again: over the rows it had; every row ever shown stays shown
  else if (m.type == "redraw" && m.count > 0) mmdPicRedraw("sstv", m.id, m.count, m.rgba);
  else if (m.type == "done")
  {
    if (m.count > 0) mmdPicRedraw("sstv", m.id, m.count, m.rgba, false);
    mmdPicDone("sstv", m.id, m.complete);
  }
}

// Where a picture's tones belong, to tune by (dashed): its sync pulses (1200 Hz, orange), black (1500 Hz) and white (2300 Hz); moved to
// where the newest picture's sender was found, when it was off (drawn under the RSIDs heard)
function mmdSstvDrawMarks(ctx, x, ratio, w, h)
{
  if (!mmdSstvMode()) return;
  const shift = mmdPicShift("sstv");
  ctx.lineWidth = Math.max(1, Math.round(ratio));
  ctx.setLineDash([4 * ratio, 4 * ratio]);
  for (const [hz, color] of [[1200, "rgba(255, 165, 0, 0.8)"], [1500, "rgba(200, 200, 200, 0.6)"], [2300, "rgba(200, 200, 200, 0.6)"]])
  {
    const at = Math.round(x(hz + shift)) + 0.5;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(at, 0);
    ctx.lineTo(at, h);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

// SSTV in the decoder's mode registry (mmdPluginHost.js): its pictures from the 12 kHz stream, its Send (mmdSstvTx.js) with it
mmdRegisterMode({
  id: "sstv",
  name: "SSTV",
  modes: ["sstv"],
  input: "audio12",
  init: () => mmdSstvTxInit(),
  audio: (data) => mmdSstvAudio(data),
  // (the view and its tabs: mmdPicShowView) A picture being sent stopped in another mode, its Send tab put away
  shown: () =>
  {
    if (DEC.mode != "sstv")
    {
      if (mmdSstvTxKeying()) mmdSstvTxStop(I18N("sstvTx.status.stopped"));
      mmdSstvTxShow(false);
    }
  },
  // Listening afresh (what it had heard before is gone); the first time in this window, its saved pictures in its strip
  entered: () =>
  {
    mmdSstvReset();
    mmdPicEntered("sstv");
  },
  drawBack: (ctx, x, ratio, w, h) => mmdSstvDrawMarks(ctx, x, ratio, w, h),
  // Send's Power the band's, as the rig moves
  tick: () =>
  {
    if (DEC.mode == "sstv" && sstvSendBody.style.display != "none") mmdSstvTxPowerRender();
  },
  // (as before: Clear in SSTV mode, or in a mode with no pictures)
  clear: () =>
  {
    const shown = mmdPicKind();
    if (!shown || shown == "sstv") mmdSstvClear();
  },
  // (a picture coming in ends here: it is kept as far as it got)
  retune: () =>
  {
    if (mmdSstvMode()) mmdSstvReset();
  },
  // It hears the audio from the start (a picture under way when it stopped can't go on)
  start: () => mmdSstvReset(),
  layout: () =>
  {
    mmdPicDraw();
    mmdSstvTxDraw();
  }
});
