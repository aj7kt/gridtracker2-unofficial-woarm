// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The rig's band scope (Rig Control's Use Scope If Present: an Icom's own spectrum scope over CI-V, rig.js rigScopeSync): a strip over the
// audio waterfall while the decoder's VFO's rig has it on. Along its top the frequencies of the rig's span, under them the rig's own
// waterfall (a row a sweep, the newest on top), what's outside the amateur bands shaded in the warning color with a line at each band
// edge. Where the rig is tuned is marked (its dial in the frequency color,
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
// Out Of Band Shading (Settings, Rig Scope): the warning color's opacity over what's outside the amateur bands, percent, unless changed
const SCOPE_OOB_DEFAULT = 18;

const SCOPE = {
  status: null,  // rigScopeStatus for the decoder's VFO, as last asked (null: the strip hidden)
  sweep: null,   // the newest sweep shown
  fall: null,    // the waterfall: a canvas a row a sweep (as wide as the sweeps' points), the newest row on top
  fallKey: "",   // the span the waterfall's rows were drawn for (another one: it starts again)
  fallLow: 0,    // the low edge (Hz) the waterfall's columns stand for (a retune slides them: mmdScopeFallRow)
  floor: null,   // the noise floor the colors start at, followed from sweep to sweep (null: taken afresh from the next one)
  hoverX: null,  // the mouse across the strip (CSS pixels), or null
  guardKey: "",  // the span the guard bands were worked out for, and them (mmdScopeGuards)
  guards: [],
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
  // The span either side: −500 kHz at the left edge (after −), +500 kHz at the right (before +)
  const span = status.span != null && !fixed ? mmdScopeHz(status.span) : "";
  const low = span ? "−" + span : "";
  const high = span ? "+" + span : "";
  if (mmdScopeSpanLow.textContent != low) mmdScopeSpanLow.textContent = low;
  if (mmdScopeSpanHigh.textContent != high) mmdScopeSpanHigh.textContent = high;
  // Why none comes, in yellow (waiting: gray)
  const why = { waiting: "cwViewer.scope.waiting", noRig: "cwViewer.scope.noRig", slow: "rig.scope.slow", refused: "rig.scope.refused", radioOff: "rig.scope.radioOff" }[status.state];
  const text = why ? I18N(why) : "";
  if (mmdScopeWarn.textContent != text) mmdScopeWarn.textContent = text;
  mmdScopeWarn.style.color = status.state == "waiting" ? "#aaa" : "var(--gt-warning)";
  mmdScopeWarn.style.display = text ? "" : "none";
  // A sweep that stopped coming isn't left showing as if it were live
  if (status.state != "ok" && SCOPE.sweep)
  {
    SCOPE.sweep = null;
    mmdScopeDraw();
  }
}

// ---- Settings, Rig Scope: Out Of Band Shading (kept: MMD.scopeOob). (The rig's own sweep speed, 27 1A, isn't offered: an IC-7300 sends
// about 4 sweeps a second over USB at Slow, Mid and Fast alike, at every span)

// Out Of Band Shading, 0 to 100 (percent)
function mmdScopeOob()
{
  const v = Number(GT.settings.MMD.scopeOob);
  return Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : SCOPE_OOB_DEFAULT;
}

// The tab as things are (as it opens)
function mmdScopeSettingsRender()
{
  if (mmdScopeTab.style.display == "none") return;
  const oob = mmdScopeOob();
  if (document.activeElement !== mmdScopeOobValue) mmdScopeOobValue.value = oob;
  mmdScopeOobTd.textContent = oob + "%";
}

function mmdScopeSetOob()
{
  GT.settings.MMD.scopeOob = Number(mmdScopeOobValue.value);
  mmdScopeOobTd.textContent = mmdScopeOob() + "%";
  mmdScopeDraw();
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

// The waterfall a row lower, this sweep's row on top: each point over the noise floor, a share of SCOPE_FALL_RANGE up the decoder's palette.
// Another span starts it afresh; the same span somewhere else (the rig retuned) slides what it had across by whole points, so each signal
// stays at its frequency (what slid out is gone, the side uncovered black; smaller moves add up until they make a point)
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
    SCOPE.fallLow = sweep.low;
    SCOPE.floor = null;
  }
  const pointHz = (sweep.high - sweep.low) / n;
  // Whole points only (truncated, not rounded: a retune left half a point off would otherwise slide it back and forth a point each sweep)
  const dx = pointHz > 0 ? Math.trunc((sweep.low - SCOPE.fallLow) / pointHz) : 0;
  if (dx)
  {
    const ctx = SCOPE.fall.getContext("2d");
    const copy = document.createElement("canvas");
    copy.width = n;
    copy.height = SCOPE_FALL_ROWS;
    if (Math.abs(dx) < n) copy.getContext("2d").drawImage(SCOPE.fall, 0, 0);
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, n, SCOPE_FALL_ROWS);
    if (Math.abs(dx) < n) ctx.drawImage(copy, -dx, 0);
    SCOPE.fallLow += dx * pointHz;
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
      ctx.fillStyle = gtThemeColor("warning");
      ctx.font = Math.round(11 * ratio) + "px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(I18N("cwViewer.scope.outOfRange"), A.left + A.width / 2, scaleH + (h - scaleH) / 2);
    }
    // Only over the scope's own area: what's outside the amateur bands shaded in the warning color, a line at each band edge (guard bands);
    // where the rig is tuned: the audio decoded (between [ and ]) shaded, the dial a line in the frequency color
    ctx.save();
    ctx.beginPath();
    ctx.rect(A.left, 0, A.width, h);
    ctx.clip();
    ctx.fillStyle = gtThemeColor("warning");
    const oob = mmdScopeOob() / 100;
    for (const [lo, hi] of mmdScopeGuards(sweep))
    {
      // (Out Of Band Shading, Settings' Rig Scope)
      if (oob > 0)
      {
        ctx.globalAlpha = oob;
        ctx.fillRect(x(lo), scaleH, Math.max(ratio, x(hi) - x(lo)), h - scaleH);
        ctx.globalAlpha = 1;
      }
      for (const edge of [lo, hi]) if (edge > sweep.low && edge < sweep.high) ctx.fillRect(Math.round(x(edge)), scaleH, Math.max(1, Math.round(ratio)), h - scaleH);
    }
    ctx.globalAlpha = 1;
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
      ctx.fillStyle = gtThemeColor("frequency");
      ctx.fillRect(Math.round(x(dial) - ratio), scaleH, Math.max(2, Math.round(2 * ratio)), h - scaleH);
    }
    ctx.restore();
    mmdScopeScale(ctx, sweep, w, A, scaleH, ratio, x);
    // The frequency under the mouse (over the scope's area); outside the amateur bands its line and frequency in the warning color
    const hx = SCOPE.hoverX != null ? SCOPE.hoverX * ratio : null;
    if (hx != null && hx >= A.left && hx < A.left + A.width)
    {
      const hz = sweep.low + ((hx - A.left) / A.width) * (sweep.high - sweep.low);
      const band = mmdBandOf(hz);
      const ham = !!band && band != "OOB";
      ctx.fillStyle = ham ? "rgba(255, 255, 255, 0.6)" : gtThemeColor("warning");
      ctx.fillRect(Math.round(hx), scaleH, Math.max(1, Math.round(ratio)), h - scaleH);
      ctx.font = Math.round(11 * ratio) + "px sans-serif";
      ctx.textBaseline = "top";
      const text = (hz / 1e6).toFixed(4);
      const tw = ctx.measureText(text).width;
      const tx = Math.max(2 * ratio, Math.min(w - tw - 2 * ratio, hx + 4 * ratio));
      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.fillRect(tx - 2 * ratio, scaleH + 2 * ratio, tw + 4 * ratio, 13 * ratio);
      ctx.fillStyle = gtThemeColor(ham ? "frequency" : "warning");
      ctx.textAlign = "left";
      ctx.fillText(text, tx, scaleH + 3 * ratio);
    }
  });
}

// The parts of a sweep's span outside the amateur bands (mmdBandOf: none, or out of its band's edges), [[low Hz, high Hz], ...]: each
// edge found between two points that differ, then to the Hz between them; worked out again only for another span
function mmdScopeGuards(sweep)
{
  const key = sweep.low + ":" + sweep.high;
  if (SCOPE.guardKey == key) return SCOPE.guards;
  const ham = (hz) =>
  {
    const band = mmdBandOf(hz);
    return !!band && band != "OOB";
  };
  const n = Math.max(2, sweep.points.length || 475);
  const step = (sweep.high - sweep.low) / (n - 1);
  const guards = [];
  let from = ham(sweep.low) ? null : sweep.low;
  let was = from === null;
  for (let i = 1; i < n; i++)
  {
    const hz = sweep.low + i * step;
    const now = ham(hz);
    if (now == was) continue;
    // The edge to the Hz, between the point before and this one
    let lo = hz - step, hi = hz;
    while (hi - lo > 1)
    {
      const mid = (lo + hi) / 2;
      if (ham(mid) == was) lo = mid;
      else hi = mid;
    }
    if (now) guards.push([from, hi]);
    else from = hi;
    was = now;
  }
  if (!was) guards.push([from, sweep.high]);
  SCOPE.guardKey = key;
  SCOPE.guards = guards;
  return guards;
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

// A click: the rig tuned so what was clicked is in the middle of the audio decoded, the change shown over the scope (mmdTuneToast)
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
  const to = Math.round(dial + (hz - middle));
  if (mmdTuneDial(to)) mmdTuneToast(mmdScopeToast, to - dial, to, false);
}
