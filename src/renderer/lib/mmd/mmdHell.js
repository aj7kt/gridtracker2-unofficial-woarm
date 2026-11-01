// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Multi-Mode Decoder's Feld-Hell mode (the Mode menu): the input's own samples (the worklet's raw stream) go to hellWorker.js, which
// reads the strongest Hell signal (or the one clicked on the waterfall) and sends its columns, each the tone's loudness from top to bottom.
// Here they're printed onto a tape (hellTape), line after line as a teleprinter's, the newest line at the bottom: nothing is decided, the
// eye reads the print (each line twice, one copy above the other, as Hell's own receivers printed it, so a print that slants out of one
// copy is whole in the other). The second line has the submode (Feld-Hell, X5, X9) and Trim, which straightens a slanting print
// (MMD.hellSubmode, MMD.hellTrim). A click on the waterfall reads the signal there; a click inside its band goes back to finding one

// The submodes: [value, name, bandwidth drawn on the waterfall (Hz)]
const HELL_SUBS = [["feld", "Feld-Hell", 350], ["x5", "Feld-Hell X5", 1750], ["x9", "Feld-Hell X9", 3150]];
// The tape: each row (of a column's 56: each pixel twice, twice over) this many CSS pixels high, each column twice that wide (a pixel
// square); a gap between lines
const HELL_ROW_PX = 1.5;
const HELL_LINE_GAP = 6;
// The trim's step and limit (ppm)
const HELL_TRIM_STEP = 500;
const HELL_TRIM_MAX = 20000;

const HELL = {
  worker: null,
  rate: 0,
  config: "",
  fixed: null,   // the centre clicked (Hz), else null: found
  center: null,  // where the worker reads (Hz), as it says
  snr: null,
  x: 0,          // where the next column goes on the bottom line (device pixels)
  lines: 0       // lines printed
};

function mmdHellMode(mode = DEC.mode)
{
  return mode == "hell";
}

function mmdHellSub()
{
  const value = GT.settings.MMD.hellSubmode;
  return HELL_SUBS.find((s) => s[0] == value) || HELL_SUBS[0];
}

function mmdHellTrim()
{
  const trim = Number(GT.settings.MMD.hellTrim) || 0;
  return Math.max(-HELL_TRIM_MAX, Math.min(HELL_TRIM_MAX, trim));
}

// hellWorker.js, set up for the input's rate, told the submode, the centre, the audio decoded and the trim whenever they change
function mmdHellLoad(rate)
{
  if (!HELL.worker)
  {
    HELL.worker = new Worker("lib/mmd/hellWorker.js");
    HELL.worker.onmessage = (event) => mmdHellMessage(event.data);
  }
  if (HELL.rate != rate)
  {
    HELL.rate = rate;
    HELL.config = "";
    HELL.worker.postMessage({ type: "init", rate });
  }
  const message = { type: "config", mode: mmdHellSub()[0], center: HELL.fixed, minHz: mmdMinHz(), maxHz: mmdMaxHz(), trim: mmdHellTrim() };
  const config = JSON.stringify(message);
  if (HELL.config != config)
  {
    HELL.config = config;
    HELL.worker.postMessage(message);
  }
  return HELL.worker;
}

function mmdHellAudio(data)
{
  mmdHellLoad(data.rate).postMessage({ type: "audio", samples: data.samples }, [data.samples.buffer]);
}

// Listening starts again (the mode chosen, a retune, Clear): the signal let go, found afresh
function mmdHellReset()
{
  if (HELL.worker) HELL.worker.postMessage({ type: "reset" });
  HELL.center = null;
  HELL.snr = null;
  mmdHellHead();
}

// Clear: the tape emptied too
function mmdHellClear()
{
  mmdHellReset();
  HELL.fixed = null;
  HELL.x = 0;
  HELL.lines = 0;
  const ctx = hellTape.getContext("2d");
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, hellTape.width, hellTape.height);
  mmdOverlay();
}

function mmdHellMessage(m)
{
  if (!mmdHellMode()) return;
  if (m.type == "lock")
  {
    const moved = m.center != HELL.center;
    HELL.center = m.center;
    HELL.snr = m.snr;
    mmdHellHead();
    if (moved) mmdOverlay();
  }
  else if (m.type == "columns") mmdHellPrint(m);
}

// The tape's canvas at its size (device pixels); a new size starts it afresh
function mmdHellFit()
{
  const ratio = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(hellTape.clientWidth * ratio));
  const h = Math.max(1, Math.round(hellTape.clientHeight * ratio));
  if (hellTape.width == w && hellTape.height == h) return;
  hellTape.width = w;
  hellTape.height = h;
  const ctx = hellTape.getContext("2d");
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, w, h);
  HELL.x = 0;
}

// Columns printed on the bottom line; one that would run off its end starts a new line (the tape moved up a line)
function mmdHellPrint(m)
{
  mmdHellFit();
  const ratio = window.devicePixelRatio || 1;
  const rowPx = Math.max(1, Math.round(HELL_ROW_PX * ratio));
  const colPx = rowPx * 2;
  const lineH = m.rows * rowPx;
  const gap = Math.round(HELL_LINE_GAP * ratio);
  const w = hellTape.width, h = hellTape.height;
  const ctx = hellTape.getContext("2d");
  const top = h - lineH;
  const image = ctx.createImageData(colPx, lineH);
  for (let c = 0; c < m.count; c++)
  {
    if (HELL.x + colPx > w || HELL.lines == 0)
    {
      // Up a line: what was printed moved up, the bottom line blank
      ctx.drawImage(hellTape, 0, -(lineH + gap));
      ctx.fillStyle = "black";
      ctx.fillRect(0, h - lineH - gap, w, lineH + gap);
      HELL.x = 0;
      HELL.lines++;
    }
    const d = image.data;
    for (let r = 0; r < m.rows; r++)
    {
      // The tone's loudness as the ink: loud is bright
      const v = m.pixels[c * m.rows + r];
      for (let y = r * rowPx; y < (r + 1) * rowPx; y++)
      {
        for (let x = 0; x < colPx; x++)
        {
          const p = (y * colPx + x) * 4;
          d[p] = v;
          d[p + 1] = v;
          d[p + 2] = Math.min(255, v + 20);
          d[p + 3] = 255;
        }
      }
    }
    ctx.putImageData(image, HELL.x, top);
    HELL.x += colPx;
  }
}

// The status: where the signal is read, and how strong (or what's listened for)
function mmdHellHead()
{
  if (!mmdHellMode() || !DEC.running) return;
  if (HELL.center == null) mmdStatus(I18N("cwViewer.hell.idle"));
  else mmdStatus(mmdHellSub()[1] + " · " + Math.round(HELL.center) + " Hz" + (HELL.snr != null ? " · " + Math.round(HELL.snr) + " dB" : "") + (HELL.fixed != null ? "" : " · " + I18N("cwViewer.hell.found")));
}

// A click on the waterfall (audio Hz): the signal there read; inside the band read now, back to finding one
function mmdHellTune(hz)
{
  if (hz == null) return;
  const half = mmdHellSub()[2] / 2;
  HELL.fixed = HELL.fixed != null && Math.abs(hz - HELL.fixed) < half ? null : Math.round(hz);
  if (HELL.fixed != null) HELL.center = HELL.fixed;
  mmdHellHead();
  mmdOverlay();
}

// The second line: its submode menu and Trim
function mmdHellMenu()
{
  cwHellSub.innerHTML = "";
  const sub = mmdHellSub();
  for (const [value, name] of HELL_SUBS) cwHellSub.add(new Option(name, value, false, value == sub[0]));
  cwHellTrimValue.textContent = (mmdHellTrim() > 0 ? "+" : "") + mmdHellTrim();
}

function mmdHellPicked()
{
  GT.settings.MMD.hellSubmode = cwHellSub.value;
  HELL.fixed = null;
  mmdHellReset();
  mmdOverlay();
}

// Trim: the print's slant (step: -1 or 1; 0 back to none)
function mmdHellTrimStep(step)
{
  GT.settings.MMD.hellTrim = step == 0 ? 0 : Math.max(-HELL_TRIM_MAX, Math.min(HELL_TRIM_MAX, mmdHellTrim() + step * HELL_TRIM_STEP));
  mmdHellMenu();
}

// On the waterfall: dashed lines at the edges of the band read, its name in a box at the bottom between them
function mmdHellDraw(ctx, x, ratio, w, h)
{
  if (!mmdHellMode() || HELL.center == null) return;
  const sub = mmdHellSub();
  const a = x(HELL.center - sub[2] / 2), b = x(HELL.center + sub[2] / 2);
  const left = Math.min(a, b), right = Math.max(a, b);
  const rgb = HELL.fixed != null ? "255, 200, 80" : "120, 220, 255";
  ctx.strokeStyle = "rgba(" + rgb + ", 0.8)";
  ctx.lineWidth = Math.max(1, Math.round(ratio));
  ctx.setLineDash([4 * ratio, 4 * ratio]);
  ctx.beginPath();
  ctx.moveTo(Math.round(left) + 0.5, 0);
  ctx.lineTo(Math.round(left) + 0.5, h);
  ctx.moveTo(Math.round(right) + 0.5, 0);
  ctx.lineTo(Math.round(right) + 0.5, h);
  ctx.stroke();
  ctx.setLineDash([]);
  mmdOverlayLabel(ctx, sub[1], (left + right) / 2, h - 19 * ratio, "center", 11, ratio, w, "rgb(" + rgb + ")");
}
