// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The frequencies the connected rig can receive and transmit on (BirdWatch's Scan By Rig): as rigctld says them (its capabilities: the
// RX and TX ranges), else a serial rig's (an Icom, a Kenwood, a Yaesu) from the table below, by its model (rigModelName). flrig doesn't
// say them. The table is the US
// version's of each model (others can differ a little, and a rig modified, or with an option fitted, can do more): a guide, not a promise

// MHz; the amateur bands a rig of these transmits on
const RIG_HF_TX = [[1.8, 2], [3.5, 4], [5.3305, 5.4065], [7, 7.3], [10.1, 10.15], [14, 14.35], [18.068, 18.168], [21, 21.45], [24.89, 24.99], [28, 29.7]];
const RIG_6M = [[50, 54]];
const RIG_4M = [[70, 70.5]];
const RIG_2M = [[144, 148]];
const RIG_70CM = [[430, 450]];
const RIG_23CM = [[1240, 1300]];

// The Icoms of RIG_CIV_MODELS and the Kenwoods and Yaesus their ID names (rig.js): rx and tx, in MHz. The TS-2000's 23 cm is an
// option (the TS-2000X), so it isn't counted
const RIG_MODEL_RANGES = {
  "FT-817/818/857/897": { rx: [[0.1, 56], [76, 154], [420, 470]], tx: [...RIG_HF_TX, ...RIG_6M, ...RIG_2M, ...RIG_70CM] },
  "TS-2000": { rx: [[0.03, 60], [142, 152], [420, 450]], tx: [...RIG_HF_TX, ...RIG_6M, ...RIG_2M, ...RIG_70CM] },
  "TS-480": { rx: [[0.03, 60]], tx: [...RIG_HF_TX, ...RIG_6M] },
  "TS-590S": { rx: [[0.03, 60]], tx: [...RIG_HF_TX, ...RIG_6M] },
  "TS-590SG": { rx: [[0.03, 60]], tx: [...RIG_HF_TX, ...RIG_6M] },
  "TS-990S": { rx: [[0.03, 60]], tx: [...RIG_HF_TX, ...RIG_6M] },
  "TS-890S": { rx: [[0.03, 60]], tx: [...RIG_HF_TX, ...RIG_6M] },
  "FT-450": { rx: [[0.03, 56]], tx: [...RIG_HF_TX, ...RIG_6M] },
  "FT-450D": { rx: [[0.03, 56]], tx: [...RIG_HF_TX, ...RIG_6M] },
  "FT-950": { rx: [[0.03, 56]], tx: [...RIG_HF_TX, ...RIG_6M] },
  "FT-2000": { rx: [[0.03, 60]], tx: [...RIG_HF_TX, ...RIG_6M] },
  "FT-2000D": { rx: [[0.03, 60]], tx: [...RIG_HF_TX, ...RIG_6M] },
  "FTDX1200": { rx: [[0.03, 56]], tx: [...RIG_HF_TX, ...RIG_6M] },
  "FTDX3000": { rx: [[0.03, 60]], tx: [...RIG_HF_TX, ...RIG_6M] },
  "FTDX5000": { rx: [[0.03, 60]], tx: [...RIG_HF_TX, ...RIG_6M] },
  "FT-991": { rx: [[0.03, 56], [118, 164], [420, 470]], tx: [...RIG_HF_TX, ...RIG_6M, ...RIG_2M, ...RIG_70CM] },
  "FT-991A": { rx: [[0.03, 56], [118, 164], [420, 470]], tx: [...RIG_HF_TX, ...RIG_6M, ...RIG_2M, ...RIG_70CM] },
  "FT-891": { rx: [[0.03, 56]], tx: [...RIG_HF_TX, ...RIG_6M] },
  "FT-710": { rx: [[0.03, 56]], tx: [...RIG_HF_TX, ...RIG_6M] },
  "FTDX10": { rx: [[0.03, 75]], tx: [...RIG_HF_TX, ...RIG_6M] },
  "FTDX101D": { rx: [[0.03, 75]], tx: [...RIG_HF_TX, ...RIG_6M] },
  "FTDX101MP": { rx: [[0.03, 75]], tx: [...RIG_HF_TX, ...RIG_6M] },
  "IC-7300": { rx: [[0.03, 74.8]], tx: [...RIG_HF_TX, ...RIG_6M, ...RIG_4M] },
  "IC-9700": { rx: [...RIG_2M, ...RIG_70CM, ...RIG_23CM], tx: [...RIG_2M, ...RIG_70CM, ...RIG_23CM] },
  "IC-705": { rx: [[0.03, 199.999], [400, 470]], tx: [...RIG_HF_TX, ...RIG_6M, ...RIG_2M, ...RIG_70CM] },
  "IC-7100": { rx: [[0.03, 199.999], [400, 470]], tx: [...RIG_HF_TX, ...RIG_6M, ...RIG_2M, ...RIG_70CM] },
  "IC-7000": { rx: [[0.03, 199.999], [400, 470]], tx: [...RIG_HF_TX, ...RIG_6M, ...RIG_2M, ...RIG_70CM] },
  "IC-706MKIIG": { rx: [[0.03, 199.999], [400, 470]], tx: [...RIG_HF_TX, ...RIG_6M, ...RIG_2M, ...RIG_70CM] },
  "IC-9100": { rx: [[0.03, 60], [136, 174], [420, 480], [1240, 1320]], tx: [...RIG_HF_TX, ...RIG_6M, ...RIG_2M, ...RIG_70CM, ...RIG_23CM] },
  "IC-910H": { rx: [...RIG_2M, ...RIG_70CM, ...RIG_23CM], tx: [...RIG_2M, ...RIG_70CM, ...RIG_23CM] },
  "IC-746PRO": { rx: [[0.03, 60], [108, 174]], tx: [...RIG_HF_TX, ...RIG_6M, ...RIG_2M] },
  "IC-7610": { rx: [[0.03, 60]], tx: [...RIG_HF_TX, ...RIG_6M] },
  "IC-7600": { rx: [[0.03, 60]], tx: [...RIG_HF_TX, ...RIG_6M] },
  "IC-7700": { rx: [[0.03, 60]], tx: [...RIG_HF_TX, ...RIG_6M] },
  "IC-7800": { rx: [[0.03, 60]], tx: [...RIG_HF_TX, ...RIG_6M] },
  "IC-7851": { rx: [[0.03, 60]], tx: [...RIG_HF_TX, ...RIG_6M] },
  "IC-7200": { rx: [[0.03, 60]], tx: [...RIG_HF_TX, ...RIG_6M] },
  "IC-7410": { rx: [[0.03, 60]], tx: [...RIG_HF_TX, ...RIG_6M] },
  "IC-756PROIII": { rx: [[0.03, 60]], tx: [...RIG_HF_TX, ...RIG_6M] },
  "IC-756PROII": { rx: [[0.03, 60]], tx: [...RIG_HF_TX, ...RIG_6M] },
  "IC-756PRO": { rx: [[0.03, 60]], tx: [...RIG_HF_TX, ...RIG_6M] },
  "IC-756": { rx: [[0.03, 60]], tx: [...RIG_HF_TX, ...RIG_6M] },
  "IC-718": { rx: [[0.03, 30]], tx: RIG_HF_TX },
  "IC-R8600": { rx: [[0.01, 3000]], tx: [] },
  "IC-905": { rx: [...RIG_2M, ...RIG_70CM, ...RIG_23CM, [2300, 2450], [5650, 5925], [10000, 10500]], tx: [...RIG_2M, ...RIG_70CM, ...RIG_23CM, [2300, 2450], [5650, 5925], [10000, 10500]] }
};

// A connected rig's ranges, in Hz: { rx: [[low, high], ...], tx: [...], model }; null while it isn't connected or they aren't known
function rigRangesOf(R)
{
  if (R.status != "connected" || !R.protocol) return null;
  if (R.ranges && R.ranges.rx.length) return { rx: R.ranges.rx, tx: R.ranges.tx, model: rigModelName(R) };
  if (!R.protocol.serial) return null;
  const model = rigModelName(R);
  const known = RIG_MODEL_RANGES[String(model).toUpperCase()];
  if (!known) return null;
  const hz = (list) => list.map(([low, high]) => [low * 1e6, high * 1e6]);
  return { rx: hz(known.rx), tx: hz(known.tx), model: model };
}

// What Scan By Rig goes by: what BirdWatch's VFOs can receive and transmit on together, as the satellite's frequencies. Each VFO in use
// whose rig is connected: its rig's ranges, its converter offset taken off, within its own Satellites ranges for that side
// (rigVfoSatRanges; a second VFO its rig hasn't transmits on nothing); a rig whose ranges aren't known is taken as able to tune anywhere,
// as BirdWatch takes every VFO (rigRoles). { rx, tx, model (the rigs'), canTx: some VFO can transmit }; null while no VFO's rig is
// connected with its ranges known
const RIG_RANGES_ANY = { rx: [[1, 1e12]], tx: [[1, 1e12]] };

function rigRanges()
{
  const out = { rx: [], tx: [], models: [], canTx: false };
  let known = false;
  for (const v of rigVfos())
  {
    if (!rigVfoReady(v)) continue;
    const R = rigVfoLink(v);
    const found = rigRangesOf(R);
    if (found) known = true;
    const a = found || Object.assign({ model: rigModelName(R) || "?" }, RIG_RANGES_ANY);
    if (!out.models.includes(a.model)) out.models.push(a.model);
    const offset = rigOffset(v);
    // The rig's ranges (Hz, on the air) cut to the VFO's own for a side
    const within = (list, side) =>
    {
      const own = rigVfoSatRanges(v).filter((r) => r.dir == "both" || r.dir == side);
      const cut = [];
      for (const [low, high] of list.map(([lo, hi]) => [lo - offset, hi - offset]))
      {
        for (const r of own)
        {
          const from = r.lo == 0 && r.hi == 0 ? low : Math.max(low, r.lo * 1e6);
          const to = r.lo == 0 && r.hi == 0 ? high : Math.min(high, r.hi * 1e6);
          if (to >= from) cut.push([from, to]);
        }
      }
      return cut;
    };
    out.rx.push(...within(a.rx, "rx"));
    if (!rigVfoIsSecond(v) || R.dual !== false) out.tx.push(...within(a.tx, "tx"));
  }
  if (!known) return null;
  return { rx: out.rx, tx: out.tx, model: out.models.join(" + "), canTx: out.tx.length > 0 };
}

// Whether a frequency (or a range of them, low to high) is inside one of the ranges
function rigRangesCover(list, low, high = low)
{
  if (!(low > 0)) return false;
  if (!(high >= low)) high = low;
  return list.some(([from, to]) => low <= to && high >= from);
}
