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

// What Scan By Rig goes by: receiving on VFO-A's rig, transmitting on the uplink's (VFO-B: the same rig, a second one, or none), as the
// satellite's frequencies (each VFO's converter offset taken off the rig's ranges): { rx, tx, model, canTx }, canTx false when no uplink
// can be tuned (VFO-B is None; the rig has no second VFO; the second rig isn't connected, or its ranges aren't known); null while VFO-A's
// rig isn't connected or its ranges aren't known
function rigRanges()
{
  const a = rigRangesOf(GT.rig);
  if (!a) return null;
  const shift = (list, vfo) => list.map(([low, high]) => [low - rigOffset(vfo), high - rigOffset(vfo)]);
  const choice = rigVfoBChoice();
  if (choice == "none") return { rx: shift(a.rx, "a"), tx: [], model: a.model, canTx: false };
  if (choice == "same") return { rx: shift(a.rx, "a"), tx: shift(a.tx, "b"), model: a.model, canTx: GT.rig.dual !== false };
  const b = rigRangesOf(GT.rigB);
  return { rx: shift(a.rx, "a"), tx: b ? shift(b.tx, "b") : [], model: a.model + " + " + ((b && b.model) || rigModelName(GT.rigB) || "?"), canTx: !!b };
}

// Whether a frequency (or a range of them, low to high) is inside one of the ranges
function rigRangesCover(list, low, high = low)
{
  if (!(low > 0)) return false;
  if (!(high >= low)) high = low;
  return list.some(([from, to]) => low <= to && high >= from);
}
