// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The rig's band scope (Rig Control's Use Scope If Present: an Icom's own spectrum scope over CI-V, rig.js rigScopeSync): a strip over the
// audio waterfall while the decoder's VFO's rig has it on. Along its top the frequencies of the rig's span, under them the rig's own
// waterfall (a row a sweep, the newest on top). Where the rig is tuned is marked (its dial in orange,
// the audio the decoder takes, between [ and ], shaded) and a click tunes the rig to put what was clicked in the middle of that audio
// (mmdTuneDial). − and + in its top corners narrow and widen the rig's span, going round past either end (Center mode; Fixed mode's
// edges are set at the rig). Why
// no scope comes (too slow a baud rate, the rig refusing it, its own scope off, not connected) shows over it in yellow

// The strip's layout (CSS pixels): the frequencies' row; the waterfall has the rest
const SCOPE_SCALE_H = 16;
// Waterfall rows kept (one a sweep)
const SCOPE_FALL_ROWS = 160;
// A sweep's points run 0 to 160, the rig's own scale (its scope's height), and are shown as they are: a block a point, not smoothed. Their
// colors start at the band's noise floor (Auto Level): black at it, the palette's top SCOPE_FALL_RANGE points over it. The floor is each
// sweep's SCOPE_FLOOR_SHARE percentile (the noise between the signals), followed from sweep to sweep by SCOPE_FLOOR_FOLLOW of the change
// (so the rows don't flicker) and taken afresh with another span: a wider span's points each take in more of the band, so its noise sits
// far higher on the rig's scale (about 5 at ±50 kHz, 30 at ±500 kHz)
const SCOPE_FALL_RANGE = 40;
const SCOPE_FLOOR_SHARE = 0.2;
const SCOPE_FLOOR_FOLLOW = 0.2;
// The frequencies' steps (Hz): the smallest that keeps labels this far apart (CSS pixels)
const SCOPE_STEPS = [500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000, 200000, 250000];
const SCOPE_LABEL_GAP = 70;

const SCOPE = {
  status: null,  // rigScopeStatus for the decoder's VFO, as last asked (null: the strip hidden)
  sweep: null,   // the newest sweep shown
  fall: null,    // the waterfall: a canvas a row a sweep (as wide as the sweeps' points), the newest row on top
  fallKey: "",   // the span the waterfall's rows were drawn for (another one: it starts again)
  floor: null,   // the noise floor the colors start at, followed from sweep to sweep (null: taken afresh from the next one)
  hoverX: null,  // the mouse across the strip (CSS pixels), or null
  drawQueued: false
};

function mmdScopeInit()
{
  mmdScopeNarrow.addEventListener("click", () => mmdScopeSpan(-1));
  mmdScopeWider.addEventListener("click", () => mmdScopeSpan(1));
  mmdScopeCanvas.addEventListener("click", mmdScopeClick);
  mmdScopeCanvas.addEventListener("mousemove", (event) =>
  {
    SCOPE.hoverX = event.offsetX;
    mmdScopeDraw();
  });
  mmdScopeCanvas.addEventListener("mouseleave", () =>
  {
    SCOPE.hoverX = null;
    mmdScopeDraw();
  });
  window.addEventListener("resize", mmdScopeDraw);
}

// Each render (mmdRender, 4 a second): the scope of the decoder's VFO's rig while the window shows (Rig Control told it is wanted, so
// it is asked of the rig only meanwhile), the strip shown or hidden with it, and why none comes
function mmdScopeTick()
{
  const opener = window.opener;
  const vfo = DEC.shown && GT.settings.MMD.rigControl === true ? opener.mmDecoderVfo() : null;
  const status = vfo ? opener.rigScopeStatus(vfo.id) : null;
  opener.rigScopeWant(status ? vfo.id : null);
  const shown = !!status;
  if ((mmdScope.style.display != "none") != shown)
  {
    mmdScope.style.display = shown ? "" : "none";
    // The audio waterfall's room changes with it
    mmdResize();
  }
  SCOPE.status = status;
  if (!status) return;
  // (Past the narrowest or widest span they go round to the other end: rigScopeSpanStep)
  const fixed = !status.center;
  mmdScopeButton(mmdScopeNarrow, !fixed && status.state == "ok", fixed ? "cwViewer.scope.fixed.hover" : "cwViewer.scope.narrow.hover");
  mmdScopeButton(mmdScopeWider, !fixed && status.state == "ok", fixed ? "cwViewer.scope.fixed.hover" : "cwViewer.scope.wider.hover");
  const label = status.span != null && !fixed ? "±" + mmdScopeHz(status.span) : "";
  if (mmdScopeSpanText.textContent != label) mmdScopeSpanText.textContent = label;
  // Why none comes, in yellow (waiting: gray)
  const why = { waiting: "cwViewer.scope.waiting", noRig: "cwViewer.scope.noRig", slow: "rig.scope.slow", refused: "rig.scope.refused", radioOff: "rig.scope.radioOff" }[status.state];
  const text = why ? I18N(why) : "";
  if (mmdScopeWarn.textContent != text) mmdScopeWarn.textContent = text;
  mmdScopeWarn.style.color = status.state == "waiting" ? "#aaa" : "yellow";
  mmdScopeWarn.style.display = text ? "" : "none";
  // A sweep that stopped coming isn't left showing as if it were live
  if (status.state != "ok" && SCOPE.sweep)
  {
    SCOPE.sweep = null;
    mmdScopeDraw();
  }
}

function mmdScopeButton(el, enabled, hoverKey)
{
  el.classList.toggle("mmdScopeOff", !enabled);
  const hover = I18N(hoverKey);
  if (el.title != hover) el.title = hover;
}

// A span either side, as shown: 2.5 kHz, 50 kHz, 500 kHz
function mmdScopeHz(hz)
{
  return (hz >= 1000 ? +(hz / 1000).toFixed(1) + " kHz" : hz + " Hz");
}

// − or +: the rig's span the next narrower or wider (Rig Control sends it; the next sweep shows it)
function mmdScopeSpan(step)
{
  const vfo = window.opener.mmDecoderVfo();
  if (!vfo || !SCOPE.status || !SCOPE.status.center || SCOPE.status.state != "ok") return;
  window.opener.rigScopeSpanStep(vfo.id, step);
}

// A sweep from Rig Control (rig.js, rigScopeDone): its row onto the waterfall, and drawn
function mmdScopeSweep(sweep)
{
  if (!sweep || mmdScope.style.display == "none") return;
  // Copied: the main window's objects aren't kept here
  const copy = { low: sweep.low, high: sweep.high, center: sweep.center, outOfRange: sweep.outOfRange, points: Uint8Array.from(sweep.points) };
  SCOPE.sweep = copy;
  if (!copy.outOfRange && copy.points.length > 0) mmdScopeFallRow(copy);
  mmdScopeDraw();
}

// The waterfall a row lower, this sweep's row on top: each point over the noise floor, a share of SCOPE_FALL_RANGE up the decoder's palette
function mmdScopeFallRow(sweep)
{
  const n = sweep.points.length;
  const key = n + ":" + (sweep.high - sweep.low);
  if (!SCOPE.fall || SCOPE.fall.width != n || SCOPE.fallKey != key)
  {
    SCOPE.fall = document.createElement("canvas");
    SCOPE.fall.width = n;
    SCOPE.fall.height = SCOPE_FALL_ROWS;
    const ctx = SCOPE.fall.getContext("2d");
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, n, SCOPE_FALL_ROWS);
    SCOPE.fallKey = key;
    SCOPE.floor = null;
  }
  const sorted = Array.from(sweep.points).sort((a, b) => a - b);
  const floor = sorted[Math.floor((sorted.length - 1) * SCOPE_FLOOR_SHARE)];
  SCOPE.floor = SCOPE.floor === null ? floor : SCOPE.floor + (floor - SCOPE.floor) * SCOPE_FLOOR_FOLLOW;
  const ctx = SCOPE.fall.getContext("2d");
  ctx.drawImage(SCOPE.fall, 0, 0, n, SCOPE_FALL_ROWS - 1, 0, 1, n, SCOPE_FALL_ROWS - 1);
  const row = ctx.createImageData(n, 1);
  const palette = DEC.palette;
  for (let i = 0; i < n; i++)
  {
    const level = Math.max(0, Math.min(255, Math.round(((sweep.points[i] - SCOPE.floor) * 255) / SCOPE_FALL_RANGE)));
    row.data[i * 4] = palette[level * 3];
    row.data[i * 4 + 1] = palette[level * 3 + 1];
    row.data[i * 4 + 2] = palette[level * 3 + 2];
    row.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(row, 0, 0);
}

// The strip drawn at the next frame: the frequencies, the waterfall, where the rig is tuned, and the frequency under the mouse
function mmdScopeDraw()
{
  if (SCOPE.drawQueued) return;
  SCOPE.drawQueued = true;
  window.requestAnimationFrame(() =>
  {
    SCOPE.drawQueued = false;
    if (mmdScope.style.display == "none") return;
    const ratio = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(mmdScopeCanvas.clientWidth * ratio));
    const h = Math.max(1, Math.round(mmdScopeCanvas.clientHeight * ratio));
    if (mmdScopeCanvas.width != w || mmdScopeCanvas.height != h)
    {
      mmdScopeCanvas.width = w;
      mmdScopeCanvas.height = h;
    }
    const ctx = mmdScopeCanvas.getContext("2d");
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, w, h);
    const sweep = SCOPE.sweep;
    if (!sweep || !(sweep.high > sweep.low)) return;
    const scaleH = SCOPE_SCALE_H * ratio;
    const A = mmdScopeArea(w, sweep.points.length);
    const x = (hz) => A.left + ((hz - sweep.low) / (sweep.high - sweep.low)) * A.width;
    // The waterfall, each point a block A.each pixels wide (not smoothed; its rows a CSS pixel each)
    if (SCOPE.fall)
    {
      const rows = Math.min(SCOPE_FALL_ROWS, Math.ceil((h - scaleH) / ratio));
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(SCOPE.fall, 0, 0, SCOPE.fall.width, rows, A.left, scaleH, A.width, rows * ratio);
    }
    if (sweep.outOfRange)
    {
      ctx.fillStyle = "yellow";
      ctx.font = Math.round(11 * ratio) + "px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(I18N("cwViewer.scope.outOfRange"), A.left + A.width / 2, scaleH + (h - scaleH) / 2);
    }
    // Where the rig is tuned: the audio decoded (between [ and ]) shaded, the dial a line; only over the scope's own area
    ctx.save();
    ctx.beginPath();
    ctx.rect(A.left, 0, A.width, h);
    ctx.clip();
    const opener = window.opener;
    const a = opener.mmDecoderAirHz(mmdMinHz()), b = opener.mmDecoderAirHz(mmdMaxHz());
    if (a != null && b != null)
    {
      ctx.fillStyle = "rgba(255, 255, 255, 0.14)";
      ctx.fillRect(Math.min(x(a), x(b)), scaleH, Math.max(ratio, Math.abs(x(b) - x(a))), h - scaleH);
    }
    const dial = mmdDial();
    if (dial != null)
    {
      ctx.fillStyle = "orange";
      ctx.fillRect(Math.round(x(dial) - ratio), scaleH, Math.max(2, Math.round(2 * ratio)), h - scaleH);
    }
    ctx.restore();
    mmdScopeScale(ctx, sweep, w, A, scaleH, ratio, x);
    // The frequency under the mouse (over the scope's area)
    const hx = SCOPE.hoverX != null ? SCOPE.hoverX * ratio : null;
    if (hx != null && hx >= A.left && hx < A.left + A.width)
    {
      ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
      ctx.fillRect(Math.round(hx), scaleH, Math.max(1, Math.round(ratio)), h - scaleH);
      const hz = sweep.low + ((hx - A.left) / A.width) * (sweep.high - sweep.low);
      ctx.font = Math.round(11 * ratio) + "px sans-serif";
      ctx.textBaseline = "top";
      const text = (hz / 1e6).toFixed(4);
      const tw = ctx.measureText(text).width;
      const tx = Math.max(2 * ratio, Math.min(w - tw - 2 * ratio, hx + 4 * ratio));
      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.fillRect(tx - 2 * ratio, scaleH + 2 * ratio, tw + 4 * ratio, 13 * ratio);
      ctx.fillStyle = "white";
      ctx.textAlign = "left";
      ctx.fillText(text, tx, scaleH + 3 * ratio);
    }
  });
}

// Where a sweep of n points is drawn across a strip w device pixels wide: each point a whole number of pixels (as many as fit, at least
// one: 2 to a point in a window wide enough, 1 to 1 in a narrower one), the sweep centered. { left, width, each }
function mmdScopeArea(w, n)
{
  const points = n > 0 ? n : 475;
  const each = Math.max(1, Math.floor(w / points));
  const width = Math.min(w, each * points);
  return { left: Math.floor((w - width) / 2), width: width, each: each };
}

// The frequencies along the top of the scope's area: MHz at each step (the smallest of SCOPE_STEPS keeping labels SCOPE_LABEL_GAP apart),
// a tick under each
function mmdScopeScale(ctx, sweep, w, A, scaleH, ratio, x)
{
  const span = sweep.high - sweep.low;
  const step = SCOPE_STEPS.find((s) => (s / span) * (A.width / ratio) >= SCOPE_LABEL_GAP) || SCOPE_STEPS[SCOPE_STEPS.length - 1];
  const decimals = step % 1000 == 0 ? 3 : 4;
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, w, scaleH);
  ctx.font = Math.round(10 * ratio) + "px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let hz = Math.ceil(sweep.low / step) * step; hz <= sweep.high; hz += step)
  {
    const px = x(hz);
    ctx.fillStyle = "#666";
    ctx.fillRect(Math.round(px), scaleH - 4 * ratio, Math.max(1, Math.round(ratio)), 4 * ratio);
    // Not under the corners' buttons and the span beside the left one
    if (px < 110 * ratio || px > w - 40 * ratio) continue;
    ctx.fillStyle = "#ccc";
    ctx.fillText((hz / 1e6).toFixed(decimals), px, scaleH / 2 - ratio);
  }
}

// A click: the rig tuned so what was clicked is in the middle of the audio decoded
function mmdScopeClick(event)
{
  const sweep = SCOPE.sweep;
  const dial = mmdDial();
  if (!sweep || dial == null || event.offsetY < SCOPE_SCALE_H) return;
  // Over the scope's own area only
  const ratio = window.devicePixelRatio || 1;
  const A = mmdScopeArea(mmdScopeCanvas.width, sweep.points.length);
  const at = event.offsetX * ratio;
  if (at < A.left || at >= A.left + A.width) return;
  const hz = sweep.low + ((at - A.left) / A.width) * (sweep.high - sweep.low);
  const middle = window.opener.mmDecoderAirHz((mmdMinHz() + mmdMaxHz()) / 2);
  if (middle == null) return;
  mmdTuneDial(dial + (hz - middle));
}
