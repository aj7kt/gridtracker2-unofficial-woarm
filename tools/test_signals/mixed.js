// A mixed test signal (tools/make_test_signals.js): mixed-rsid.wav, CW, PSK31, RTTY and Olivia 8/500 at once, each in its own part of
// the passband, the three digital ones after their RSID (sent two seconds apart, so no two RSIDs overlap). Made with the other
// modules' senders (cw.js, psk31.js, rtty.js, olivia.js). Fictional calls only (Q prefixes are never issued)
const { cwKey } = require("./cw.js");
const { pskSend, PSK_RSID } = require("./psk31.js");
const { rttySend, RTTY_RSID } = require("./rtty.js");
const { oliviaSend, OLIVIA_RSID } = require("./olivia.js");

function build(common)
{
  const s = common.buffer(40);
  const ends = [];
  ends.push(cwKey(common, s, 500, "CQ CQ CQ DE Q1TST Q1TST K", 18, 0.5, 0.2));
  let at = common.rsid(s, common.rsidTones(PSK_RSID), 900, 1.0, 0.18);
  ends.push(pskSend(common, s, 900, "CQ CQ de Q2ABC Q2ABC pse k", at, 0.18));
  at = common.rsid(s, common.rsidTones(RTTY_RSID), 1400, 3.0, 0.18);
  ends.push(rttySend(common, s, 1400, "CQ CQ DE Q3XYZ Q3XYZ K", at, 0.18));
  at = common.rsid(s, common.rsidTones(OLIVIA_RSID["olivia 8/500"]), 2100, 5.0, 0.2);
  ends.push(oliviaSend(common, s, "olivia", 8, 500, 2100, "GRIDTRACKER2 TEST SIGNAL DE N0CALL K\n", at, 0.28, 51));
  if (Math.max(...ends) > 39) throw new Error("mixed: runs past the end");
  common.noise(s, 0.02, 51);
  common.normalize(s, 0.7);
  return [{
    file: "mixed-rsid.wav",
    modes: ["cw", "psk31", "rtty", "olivia"],
    signals: 4,
    rsid: true,
    sync: null,
    description: "CW at 500 Hz, then after their RSIDs PSK31 at 900 Hz, RTTY centred on 1400 Hz and Olivia 8/500 at 2100 Hz, all at once",
    samples: s
  }];
}

module.exports = { build };
