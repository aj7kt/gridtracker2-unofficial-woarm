// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// How the waterfall is drawn (the window's Settings, Decoders, under Waterfall Speed; GT.settings.MMD.fallView). The worklet's own
// spectrum for it (cwdecoder.c, cw_set_view: never what is decoded) has a Resolution, its window's length against the decoder's FFT: a
// quarter (sharpest in time: a CW dit its own rows), half, the same, or twice (sharpest in frequency); By Mode picks one for each mode. Its
// Window: Hann, or Blackman-Harris (less leakage: a darker floor beside a strong signal). Each row's bins are then drawn by its Style:
//   Auto Level (as it always was): each bin against its own noise floor, 5 dB under it black, 40 dB over it white
//   WSJT-X: each bin's level as heard (dB re full scale), Gain (contrast) and Zero (black level) set by hand, as WSJT-X's sliders
//   Crisp: each bin against its own floor, Floor dB over it still black (a clean background) and Range dB over that white
// Sharp Pixels draws each bin as a block (not smoothed when the waterfall is wider than its bins). Palette: its colours (MMD_PALETTES)

const FALL_VIEW_DEFAULTS = { style: "auto", gain: 0, zero: 0, floor: 3, range: 30, res: "mode", window: "hann", sharp: false, palette: "classic" };

// The Palette menu's other colour sets (Classic is mmdPalette's own), each from the noise up, evenly spaced. Ember, Twilight, Neon, Aurora
// and Clear Sight follow the inferno, magma, plasma, viridis and cividis colour maps (public domain, CC0); Prism a rainbow (turbo's); the
// rest drawn here
const MMD_PALETTES = {
  ember: ["#000004", "#1f0c48", "#550f6d", "#88226a", "#ba3655", "#e35932", "#f98c0a", "#fcffa4"],
  twilight: ["#000004", "#1c1044", "#4f127b", "#812581", "#b5367a", "#e55964", "#fb8761", "#fec287", "#fcfdbf"],
  neon: ["#0d0887", "#46039f", "#7201a8", "#9c179e", "#bd3786", "#d8576b", "#ed7953", "#fb9f3a", "#fdca26", "#f0f921"],
  aurora: ["#440154", "#482878", "#3e4989", "#31688e", "#26828e", "#1f9e89", "#35b779", "#6ece58", "#b5de2b", "#fde725"],
  clearsight: ["#00204d", "#00336f", "#39486b", "#575c6d", "#707173", "#8a8779", "#a69d75", "#c4b56c", "#e4cf5b", "#ffea46"],
  prism: ["#30123b", "#4145ab", "#4675ed", "#39a2fc", "#1bcfd4", "#24eca6", "#61fc6c", "#a4fc3b", "#d1e834", "#f3c63a", "#fe9b2d", "#f36315", "#d93806", "#b11901", "#7a0402"],
  glacier: ["#000000", "#001033", "#002a66", "#0055a0", "#0088cc", "#33bbee", "#99e6ff", "#ffffff"],
  phosphor: ["#000000", "#001a00", "#003d00", "#006b00", "#00a000", "#33d633", "#99ff99", "#e6ffe6"],
  moonlight: ["#000000", "#ffffff"],
  paper: ["#ffffff", "#c8c8c8", "#787878", "#282828", "#000000"]
};
// By Mode: the Resolution each mode is drawn at (0 a quarter, 1 half, 2 the same, 3 twice the FFT)
const FALL_VIEW_MODE_SCALE = { cw: 1, psk31: 1, rtty: 1, mfsk: 1, thor: 1, navtex: 1, hell: 1, ft8: 3, ft4: 3 };
const FALL_VIEW_SCALES = { quarter: 0, half: 1, same: 2, twice: 3 };

function mmdFallView()
{
  const S = GT.settings.MMD;
  if (!S.fallView || typeof S.fallView != "object") S.fallView = {};
  for (const [key, value] of Object.entries(FALL_VIEW_DEFAULTS)) if (typeof S.fallView[key] != typeof value) S.fallView[key] = value;
  // A palette that isn't one any more: Classic. Terrain View's, from before it was taken out
  if (S.fallView.palette != "classic" && !(S.fallView.palette in MMD_PALETTES)) S.fallView.palette = "classic";
  for (const key of ["terrain", "depth", "height"]) delete S.fallView[key];
  return S.fallView;
}

// The worklet told the Resolution and Window (as the decoder starts, the mode changes, or either is picked)
function mmdFallViewApply()
{
  const V = mmdFallView();
  const scale = V.res in FALL_VIEW_SCALES ? FALL_VIEW_SCALES[V.res] : DEC.mode in FALL_VIEW_MODE_SCALE ? FALL_VIEW_MODE_SCALE[DEC.mode] : 2;
  if (DEC.node) DEC.node.port.postMessage({ type: "view", scale, window: V.window == "blackman" ? 1 : 0 });
  cwFall.style.imageRendering = V.sharp ? "pixelated" : "auto";
  // The Palette: the rows from now on in its colours
  if (DEC.paletteName != V.palette)
  {
    DEC.paletteName = V.palette;
    DEC.palette = mmdPalette(V.palette);
  }
}

// A row's levels (0 to 255, the palette's) from the worklet's spectrum (view: each bin's dB over its floor, then dB re full scale) by the
// Style; no spectrum (an old worklet): the decoder's row as it is
function mmdFallLevels(view, row)
{
  const bins = row.length;
  if (!view || view.length != bins * 2) return row;
  const V = mmdFallView();
  const out = new Uint8Array(bins);
  let from, scale, offset;
  if (V.style == "wsjtx")
  {
    // Zero: the black level (dB re full scale, -80 at 0); Gain: the dB from black to white (60 at 0, half as many every 25 up)
    from = bins;
    offset = -80 + V.zero;
    scale = 255 / (60 * Math.pow(2, -V.gain / 25));
  }
  else if (V.style == "crisp")
  {
    from = 0;
    offset = V.floor;
    scale = 255 / Math.max(5, V.range);
  }
  else
  {
    from = 0;
    offset = -5;
    scale = 255 / 45;
  }
  for (let k = 0; k < bins; k++)
  {
    const v = (view[from + k] - offset) * scale;
    out[k] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return out;
}

// ---- Its settings (the window's Settings, Decoders)

function mmdFallViewRender()
{
  const V = mmdFallView();
  mmdFallStyleSelect.value = V.style;
  mmdFallResSelect.value = V.res;
  mmdFallWindowSelect.value = V.window;
  mmdFallSharpValue.checked = V.sharp;
  mmdFallPaletteSelect.value = V.palette in MMD_PALETTES ? V.palette : "classic";
  for (const [id, key, unit] of [["mmdFallGain", "gain", ""], ["mmdFallZero", "zero", ""], ["mmdFallFloor", "floor", " dB"], ["mmdFallRange", "range", " dB"]])
  {
    window[id + "Value"].value = V[key];
    window[id + "Td"].textContent = V[key] + unit;
  }
  mmdFallWsjtxRow.style.display = V.style == "wsjtx" ? "" : "none";
  mmdFallCrispRow.style.display = V.style == "crisp" ? "" : "none";
}

// Any of them changed: kept, and applied from the next row (Resolution and Window: the worklet's spectrum learns its floor again)
function mmdFallViewSet()
{
  const V = mmdFallView();
  V.style = mmdFallStyleSelect.value;
  V.res = mmdFallResSelect.value;
  V.window = mmdFallWindowSelect.value;
  V.sharp = mmdFallSharpValue.checked;
  V.palette = mmdFallPaletteSelect.value;
  for (const [id, key] of [["mmdFallGain", "gain"], ["mmdFallZero", "zero"], ["mmdFallFloor", "floor"], ["mmdFallRange", "range"]]) V[key] = Number(window[id + "Value"].value);
  mmdFallViewRender();
  mmdFallViewApply();
}
