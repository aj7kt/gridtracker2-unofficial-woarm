// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// Log QSO (Settings -> Logging: adifLog.logQso), the part with no page in it: what the form is filled in with, how what was typed is
// checked, and the ADIF record made of it (the Log QSO window, gt_logqso.html with logQsoWindow.js, has the form; the decoder's
// mmdLogQso.js fills it in from what it heard). GridTracker is a log viewer, not a logger:
// this makes ONE new QSO and hands it to the main window's sendToLogger (adif.js), which fills in the rest (DXCC, country, your call and
// grid, the grid from live decodes or a lookup, the SOTA summit of a Feed Roster spot, BirdWatch's satellite) and logs it where every
// QSO goes (GridTracker's own log, the backup log, every logger and service set up in Settings -> Logging). Nothing here edits, deletes
// or looks for dupes of a QSO already logged.
//
// Modes and submodes are the ADIF 3.1.6 Mode enumeration's (adif.org/316/ADIF_316.htm, Enumerations: Mode and Submode, read
// 2026-11-11): CW; SSTV; PSK with PSK31, PSK63, PSK125, QPSK31; RTTY; MFSK with MFSK16, MFSK32; DOMINO with DOM4 to DOM22 (the
// DominoEX speeds: the spec lists DOM4, DOM5, DOM8, DOM11, DOM16, DOM22, DOM44, DOM88 under DOMINO, DominoEX's own speeds, and
// DOMINOEX for one whose speed isn't known); THOR with THOR4 to THOR22; OLIVIA with "OLIVIA 4/250" ... "OLIVIA 32/1000" (its tones and
// bandwidth, as the spec writes them); CONTESTI (Contestia, no submodes); HELL (Feld-Hell itself has no submode) with HELLX5 and HELLX9;
// SSB with USB and LSB; AM; FM; DIGITALVOICE with C4FM, DMR, DSTAR, FREEDV, M17. All times UTC.
//
// Loaded in the Log QSO window and the Multi-Mode Decoder's window (a plain script, its globals) and by the offline tests in Node
// (module.exports below)

// The modes a QSO is made in (the Mode menu's): not WEFAX, NAVTEX, WWV, Packet, Sat Data, nor FT8, FT4 and WSPR
// (WSJT-X logs those)
const LOG_QSO_MODES = ["cw", "psk31", "rtty", "mfsk", "thor", "olivia", "hell", "sstv"];
// DominoEX's and THOR's speeds that have a submode of their own (DOM4 ... DOM22, THOR4 ... THOR22)
const LOG_QSO_DOMINO_SPEEDS = [4, 5, 8, 11, 16, 22];
// The modes spoken: their default report is 59 (a CW or digital QSO's 599, SSTV's RSV 595)
const LOG_QSO_PHONE_MODES = ["SSB", "AM", "FM", "DIGITALVOICE"];
// How far from a Feed Roster spot the rig may be for the phone form to take it (Hz), and for how long after the click
const LOG_QSO_SPOT_HZ = 1000;
const LOG_QSO_SPOT_MS = 3600000;

// The Mode menu's choices, in this order: [MODE, SUBMODE ("" none)]. A QSO filled in with another (a Feed Roster spot's) has it added
const LOG_QSO_MODE_CHOICES = [
  ["CW", ""], ["SSB", "USB"], ["SSB", "LSB"], ["AM", ""], ["FM", ""],
  ["DIGITALVOICE", "C4FM"], ["DIGITALVOICE", "DMR"], ["DIGITALVOICE", "DSTAR"], ["DIGITALVOICE", "FREEDV"], ["DIGITALVOICE", "M17"],
  ["PSK", "PSK31"], ["PSK", "PSK63"], ["PSK", "PSK125"], ["PSK", "QPSK31"], ["RTTY", ""], ["MFSK", "MFSK16"], ["MFSK", "MFSK32"]
].concat(LOG_QSO_DOMINO_SPEEDS.map((b) => ["DOMINO", "DOM" + b]), [["DOMINO", "DOMINOEX"]], [["THOR", ""]], LOG_QSO_DOMINO_SPEEDS.map((b) => ["THOR", "THOR" + b]),
  [[4, 250], [8, 250], [8, 500], [16, 500], [16, 1000], [32, 1000]].map(([t, w]) => ["OLIVIA", "OLIVIA " + t + "/" + w]),
  [["CONTESTI", ""], ["HELL", ""], ["HELL", "HELLX5"], ["HELL", "HELLX9"], ["SSTV", ""]]);

// A mode and submode as the menu shows it: "PSK / PSK31", "CW"
function logQsoModeLabel(mode, submode)
{
  return submode ? mode + " / " + submode : mode;
}

// ---- Times (UTC)

function logQsoPad(n, width = 2)
{
  return String(n).padStart(width, "0");
}

// A moment (ms) as the form shows it: { date: "2026-11-11", time: "05:12:33" }
function logQsoUtcParts(ms)
{
  const d = new Date(ms);
  return {
    date: d.getUTCFullYear() + "-" + logQsoPad(d.getUTCMonth() + 1) + "-" + logQsoPad(d.getUTCDate()),
    time: logQsoPad(d.getUTCHours()) + ":" + logQsoPad(d.getUTCMinutes()) + ":" + logQsoPad(d.getUTCSeconds())
  };
}

// What was typed as a moment (ms), else null: the date as 2026-11-11 or 20261111, the time as 05:12:33, 051233, 05:12 or 0512
function logQsoParseUtc(date, time)
{
  const dm = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(String(date || "").trim());
  const tm = /^(\d{2}):?(\d{2})(?::?(\d{2}))?$/.exec(String(time || "").trim());
  if (!dm || !tm) return null;
  const [y, mo, d] = [Number(dm[1]), Number(dm[2]), Number(dm[3])];
  const [h, mi, s] = [Number(tm[1]), Number(tm[2]), Number(tm[3] || 0)];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const ms = Date.UTC(y, mo - 1, d, h, mi, s);
  // (Not a day the month hasn't got: 2026-02-30)
  if (new Date(ms).getUTCDate() != d) return null;
  return ms;
}

// A moment as ADIF's QSO_DATE (YYYYMMDD) and TIME_ON (HHMMSS)
function logQsoAdifDate(ms)
{
  const d = new Date(ms);
  return d.getUTCFullYear() + logQsoPad(d.getUTCMonth() + 1) + logQsoPad(d.getUTCDate());
}

function logQsoAdifTime(ms)
{
  const d = new Date(ms);
  return logQsoPad(d.getUTCHours()) + logQsoPad(d.getUTCMinutes()) + logQsoPad(d.getUTCSeconds());
}

// ---- Band and frequency

// ADIF 3.1.6's Band Enumeration: [band, lower MHz, upper MHz] (both inclusive)
const LOG_QSO_BANDS = [
  ["2190m", 0.1357, 0.1378], ["630m", 0.472, 0.479], ["560m", 0.501, 0.504], ["160m", 1.8, 2.0], ["80m", 3.5, 4.0], ["60m", 5.06, 5.45],
  ["40m", 7.0, 7.3], ["30m", 10.1, 10.15], ["20m", 14.0, 14.35], ["17m", 18.068, 18.168], ["15m", 21.0, 21.45], ["12m", 24.89, 24.99],
  ["10m", 28.0, 29.7], ["8m", 40, 45], ["6m", 50, 54], ["5m", 54.000001, 69.9], ["4m", 70, 71], ["2m", 144, 148], ["1.25m", 222, 225],
  ["70cm", 420, 450], ["33cm", 902, 928], ["23cm", 1240, 1300], ["13cm", 2300, 2450], ["9cm", 3300, 3500], ["6cm", 5650, 5925],
  ["3cm", 10000, 10500], ["1.25cm", 24000, 24250], ["6mm", 47000, 47200], ["4mm", 75500, 81000], ["2.5mm", 119980, 123000],
  ["2mm", 134000, 149000], ["1mm", 241000, 250000], ["submm", 300000, 7500000]
];

// A frequency's band as ADIF has it (LOG_QSO_BANDS), "" off them
function logQsoBand(hz)
{
  const mhz = hz / 1e6;
  const band = hz > 0 ? LOG_QSO_BANDS.find(([, lo, hi]) => mhz >= lo && mhz <= hi) : null;
  return band ? band[0] : "";
}

// A frequency (Hz) as the form shows it: MHz to the hertz, 14.074000
function logQsoMhz(hz)
{
  return hz > 0 ? (Math.round(hz) / 1e6).toFixed(6) : "";
}

// ---- The call

// The call sign the decoded text says the station is, else "": a word GridTracker takes for a call sign (CALLSIGN_REGEXP, first.js),
// not your own call. The one after the last DE ("N0TTL DE K1ABC", "CQ CQ DE K1ABC K1ABC"), else the first after the last CQ ("CQ POTA
// K1ABC"), else the last one in the text
function logQsoCallFromText(text, myCall)
{
  const mine = String(myCall || "").toUpperCase();
  const words = String(text || "").toUpperCase().split(/\s+/).map((w) => w.replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, "")).filter(Boolean);
  const isCall = (w) => w != mine && logQsoCallRegexp().test(w) && w.split("/").every(Boolean);
  for (let i = words.length - 2; i >= 0; i--)
  {
    if (words[i] == "DE" && isCall(words[i + 1])) return words[i + 1];
  }
  for (let i = words.length - 1; i >= 0; i--)
  {
    if (words[i] != "CQ") continue;
    const after = words.slice(i + 1).find(isCall);
    if (after) return after;
    break;
  }
  for (let i = words.length - 1; i >= 0; i--) if (isCall(words[i])) return words[i];
  return "";
}

// A callsign with any pre- and post-indicators: first.js's CALLSIGN_REGEXP, every window's
function logQsoCallRegexp()
{
  return CALLSIGN_REGEXP;
}

// ---- Modes

// The ADIF mode and submode of a Multi-Mode Decoder mode (mmdMode: "cw", "psk31" ...) and its submode as the window keeps it (sub:
// "psk63", "dominoex 11", "olivia 8/500", "x5" ...); speed: the signal's own (DominoEX / THOR with Every Speed: the one it was read at).
// null for a mode no QSO is made in here
function logQsoDigitalMode(mmdMode, sub, speed)
{
  sub = String(sub || "").toLowerCase().trim();
  switch (mmdMode)
  {
    case "cw":
      return { mode: "CW", submode: "" };
    case "rtty":
      return { mode: "RTTY", submode: "" };
    case "sstv":
      return { mode: "SSTV", submode: "" };
    case "psk31":
      return { mode: "PSK", submode: { psk63: "PSK63", psk125: "PSK125", qpsk31: "QPSK31" }[sub] || "PSK31" };
    case "mfsk":
      return { mode: "MFSK", submode: sub == "mfsk32" ? "MFSK32" : "MFSK16" };
    case "thor":
    {
      // "dominoex 11", "thor 16", "dominoex all" (every speed: the signal's own, if it has one of the submodes)
      const [kind, baud] = sub.split(" ");
      const b = baud == "all" || !baud ? Number(speed) : Number(baud);
      const known = LOG_QSO_DOMINO_SPEEDS.includes(b);
      if (kind == "thor") return { mode: "THOR", submode: known ? "THOR" + b : "" };
      return { mode: "DOMINO", submode: known ? "DOM" + b : "DOMINOEX" };
    }
    case "olivia":
    {
      // "olivia 8/500"; Contestia is a mode of its own in ADIF (CONTESTI), with no submodes
      const m = /^(olivia|contestia) (\d+)\/(\d+)$/.exec(sub || "olivia 8/500");
      if (m && m[1] == "contestia") return { mode: "CONTESTI", submode: "" };
      const name = m ? "OLIVIA " + m[2] + "/" + m[3] : "OLIVIA 8/500";
      return { mode: "OLIVIA", submode: LOG_QSO_MODE_CHOICES.some(([mo, s]) => mo == "OLIVIA" && s == name) ? name : "" };
    }
    case "hell":
      return { mode: "HELL", submode: sub == "x5" ? "HELLX5" : sub == "x9" ? "HELLX9" : "" };
    default:
      return null;
  }
}

// The rig's mode as Rig Control reads it (rig.js: an Icom's LSB, USB, AM, FM, WFM, CW, CW-R, RTTY, RTTY-R, DV and USB-D ...; a Kenwood's;
// a newer Yaesu's PKT-U, FM-N, AM-N, C4FM ...; an FT-817's with -N; rigctld's Hamlib names PKTUSB, FMN, AMS, D-STAR ...; flrig's; a
// FlexRadio's DIGU, NFM, SAM, FDV ...; an SDR server's) as a phone QSO's ADIF mode: { kind: "voice", mode, submode }; kind "data" for a
// mode no one speaks in (CW, RTTY, and every data mode: USB-D, PKT-U, DATA-U, DIGU, PKTUSB ...: those aren't phone); "unknown" for a
// mode it doesn't know (the user picks one); "none" with no mode read
function logQsoPhoneMode(rigMode)
{
  const m = String(rigMode || "").toUpperCase().trim();
  if (!m) return { kind: "none", mode: "", submode: "" };
  const voice = (mode, submode = "") => ({ kind: "voice", mode, submode });
  if (/-D\d?$|^PKT|DATA|^DIG|^DFM|^USBD|^LSBD|RTTY|^CW|FSK|PSK|FAX|^IQ$|^RAW$|^SPEC$|^DD$/.test(m)) return { kind: "data", mode: "", submode: "" };
  // An FT-817's narrow filter (USB-N), and a Yaesu's or Hamlib's narrow FM and AM (FM-N, FMN, NFM, AM-N, AMN): the mode itself
  const base = m.replace(/-N$/, "").replace(/^(FM|AM)N$/, "$1").replace(/^NFM$/, "FM");
  switch (base)
  {
    case "USB":
    case "ECSSUSB":
      return voice("SSB", "USB");
    case "LSB":
    case "ECSSLSB":
      return voice("SSB", "LSB");
    case "AM":
    case "AMS":
    case "SAM":
    case "SAL":
    case "SAH":
      return voice("AM");
    case "FM":
    case "WFM":
      return voice("FM");
    case "DV":
    case "DSTAR":
    case "D-STAR":
      return voice("DIGITALVOICE", "DSTAR");
    case "C4FM":
      return voice("DIGITALVOICE", "C4FM");
    case "FDV":
    case "FREEDV":
      return voice("DIGITALVOICE", "FREEDV");
    case "DMR":
      return voice("DIGITALVOICE", "DMR");
    case "M17":
      return voice("DIGITALVOICE", "M17");
    default:
      return { kind: "unknown", mode: "", submode: "" };
  }
}

// A Feed Roster spot's mode (its feed's: SSB, CW, FT8 ...) as an ADIF mode, else null (the user picks). SSB: the rig's sideband when it
// reads one, else the band's (LSB below 10 MHz but on 60m, as AC Log's rule has it: acLog.js)
function logQsoSpotMode(spotMode, rigMode, hz)
{
  const m = String(spotMode || "").toUpperCase().trim();
  if (m == "SSB" || m == "PHONE" || m == "USB" || m == "LSB")
  {
    const rig = logQsoPhoneMode(rigMode);
    if (rig.mode == "SSB") return { mode: "SSB", submode: rig.submode };
    if (m == "USB" || m == "LSB") return { mode: "SSB", submode: m };
    return { mode: "SSB", submode: hz > 0 && hz < 10000000 && !(hz >= 5000000 && hz < 5500000) ? "LSB" : "USB" };
  }
  const known = {
    CW: ["CW", ""], AM: ["AM", ""], FM: ["FM", ""], RTTY: ["RTTY", ""], SSTV: ["SSTV", ""], PSK31: ["PSK", "PSK31"], PSK63: ["PSK", "PSK63"],
    PSK125: ["PSK", "PSK125"], C4FM: ["DIGITALVOICE", "C4FM"], DSTAR: ["DIGITALVOICE", "DSTAR"], "D-STAR": ["DIGITALVOICE", "DSTAR"],
    DMR: ["DIGITALVOICE", "DMR"], FREEDV: ["DIGITALVOICE", "FREEDV"], M17: ["DIGITALVOICE", "M17"], FT8: ["FT8", ""], FT4: ["MFSK", "FT4"]
  }[m];
  return known ? { mode: known[0], submode: known[1] } : null;
}

// The reports a mode starts with: 59 spoken, 595 (RSV) for SSTV, 599 otherwise
function logQsoDefaultRst(mode)
{
  if (LOG_QSO_PHONE_MODES.includes(mode)) return "59";
  return mode == "SSTV" ? "595" : "599";
}

// ---- The form filled in. Each a form's values as typed (strings): { call, dateOn, timeOn, dateOff, timeOff, freq (MHz), mode, submode,
// rstSent, rstRcvd, grid, name, power, comment }, and potaRef (a Feed Roster spot's park: sendToLogger's options.potaRef)

function logQsoBlank(now)
{
  const at = logQsoUtcParts(now);
  return { call: "", dateOn: at.date, timeOn: at.time, dateOff: at.date, timeOff: at.time, freq: "", mode: "", submode: "", rstSent: "", rstRcvd: "", grid: "", name: "", power: "", comment: "", potaRef: "" };
}

// A decoder's QSO: o = { mmdMode, sub (its submode), speed (the signal's), text (its row's), firstAt (when its first character came),
// airHz (its frequency on the air), dialHz (the rig's dial), now, myCall; SSTV's picture: pictureName ("Martin 1"), pictureAt, pictureDial }.
// Time on: its row's first character, the picture's start (else now); time off now; the frequency its own on the air (else the dial)
function logQsoPrefillDigital(o)
{
  const f = logQsoBlank(o.now);
  const m = logQsoDigitalMode(o.mmdMode, o.sub, o.speed) || { mode: "", submode: "" };
  f.mode = m.mode;
  f.submode = m.submode;
  f.call = logQsoCallFromText(o.text, o.myCall);
  const onAt = o.mmdMode == "sstv" ? o.pictureAt : o.firstAt;
  if (onAt > 0 && onAt <= o.now)
  {
    const at = logQsoUtcParts(onAt);
    f.dateOn = at.date;
    f.timeOn = at.time;
  }
  const hz = o.mmdMode == "sstv" ? o.pictureDial || o.dialHz : o.airHz || o.dialHz;
  f.freq = logQsoMhz(hz);
  f.rstSent = f.rstRcvd = logQsoDefaultRst(f.mode);
  // SSTV: the picture's mode (Martin 1, Scottie 2, PD120 ...) in the comment
  if (o.mmdMode == "sstv" && o.pictureName) f.comment = String(o.pictureName);
  return f;
}

// A phone QSO: o = { rigMode, dialHz, now, opened (when the form opened: time on), spot (the main window's last Feed Roster spot clicked:
// { call, freq (Hz), mode, pota, grid, at }, or null), fromSpot (opened from the Feed Roster's menu on that spot) }. The spot is taken
// when it was opened from it, or while the rig is still within LOG_QSO_SPOT_HZ of it (and clicked in the last LOG_QSO_SPOT_MS): its
// call, park and grid, time on its click
function logQsoPrefillPhone(o)
{
  const f = logQsoBlank(o.now);
  const opened = logQsoUtcParts(o.opened || o.now);
  f.dateOn = opened.date;
  f.timeOn = opened.time;
  const rig = logQsoPhoneMode(o.rigMode);
  if (rig.kind == "voice")
  {
    f.mode = rig.mode;
    f.submode = rig.submode;
  }
  let hz = o.dialHz > 0 ? o.dialHz : 0;
  const spot = o.spot;
  const near = spot && spot.freq > 0 && hz > 0 && Math.abs(hz - spot.freq) <= LOG_QSO_SPOT_HZ && o.now - spot.at <= LOG_QSO_SPOT_MS;
  if (spot && (o.fromSpot || near))
  {
    f.call = String(spot.call || "").toUpperCase();
    if (LOG_QSO_PARK_REGEXP.test(String(spot.pota || ""))) f.potaRef = spot.pota;
    // Its summit (a SOTA spot's): the form's SOTA_REF field
    if (spot.sota) f.sotaRef = String(spot.sota).toUpperCase();
    if (LOG_QSO_GRID_REGEXP.test(String(spot.grid || "").toUpperCase())) f.grid = String(spot.grid).toUpperCase();
    if (spot.at > 0 && spot.at <= o.now)
    {
      const at = logQsoUtcParts(spot.at);
      f.dateOn = at.date;
      f.timeOn = at.time;
    }
    // Opened from the spot with the rig elsewhere (or not read): the spot's frequency and mode
    if (!near && spot.freq > 0) hz = spot.freq;
    if (!near || rig.kind != "voice")
    {
      const m = logQsoSpotMode(spot.mode, o.rigMode, hz);
      if (m)
      {
        f.mode = m.mode;
        f.submode = m.submode;
      }
    }
  }
  f.freq = logQsoMhz(hz);
  f.rstSent = f.rstRcvd = logQsoDefaultRst(f.mode || "SSB");
  return f;
}

// ---- Checked, and made a record

// A grid square as ADIF 3.1.6 has it: 4, 6, 8 or 10 characters. The first 8 are GRIDSQUARE (GridSquare), the 9th and 10th its _EXT
// field (GridSquareExt: A-X)
const LOG_QSO_GRID_REGEXP = /^[A-R]{2}[0-9]{2}([A-X]{2}([0-9]{2}([A-X]{2})?)?)?$/;
const LOG_QSO_PARK_REGEXP = /^[A-Z0-9]{1,4}-\d{4,5}$/;

// ADIF 3.1.6's rules for the fields the card can add (a field not here is a String: plain ASCII). int / num: an Integer / a Number,
// never negative (signed: it may be), min and max inclusive; choice: an Enumeration's values (those still current); suggest: values
// offered, not required; pattern + example: the data type's format; call: a callsign; grid: a grid square (and its _EXT field); list: a
// comma-separated list of the pattern (POTARefList); date: a Date (YYYYMMDD); location: a Location ("lat" / "lon": XDDD MM.MMM); vucc:
// a GridSquareList of 2 or 4 four-character squares; band: one of ADIF's bands
const LOG_QSO_PROP_MODES = ["AS", "AUE", "AUR", "BS", "ECH", "EME", "ES", "F2", "FAI", "GWAVE", "INTERNET", "ION", "IRL", "LOS", "MS",
  "RPT", "RS", "SAT", "TEP", "TR"];
// The ARRL_Section Enumeration (ARRL and RAC sections)
const LOG_QSO_ARRL_SECTIONS = ["AL", "AK", "AB", "AR", "AZ", "BC", "CO", "CT", "DE", "EB", "EMA", "ENY", "EPA", "EWA", "GA", "GH", "ID",
  "IL", "IN", "IA", "KS", "KY", "LAX", "LA", "ME", "MB", "MDC", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NB", "NH", "NM", "NLI", "NL", "NC",
  "ND", "NTX", "NFL", "NNJ", "NNY", "NS", "OH", "OK", "ONE", "ONN", "ONS", "ORG", "OR", "PAC", "PE", "PR", "QC", "RI", "SV", "SDG", "SF",
  "SJV", "SB", "SCV", "SK", "SC", "SD", "STX", "SFL", "SNJ", "TN", "TER", "VI", "UT", "VT", "VA", "WCF", "WTX", "WV", "WMA", "WNY", "WPA",
  "WWA", "WI", "WY"];
// The Contest_ID Enumeration (CONTEST_ID is a String: these are offered, not required)
const LOG_QSO_CONTEST_IDS = ["070-160M-SPRINT", "070-3-DAY", "070-31-FLAVORS", "070-40M-SPRINT", "070-80M-SPRINT", "070-PSKFEST",
  "070-ST-PATS-DAY", "070-VALENTINE-SPRINT", "10-RTTY", "1010-OPEN-SEASON", "7QP", "AL-QSO-PARTY", "ALL-ASIAN-DX-CW", "ALL-ASIAN-DX-PHONE",
  "ANARTS-RTTY", "ANATOLIAN-RTTY", "AP-SPRINT", "AR-QSO-PARTY", "ARI-DX", "ARI-EME", "ARI-IAC-13CM", "ARI-IAC-23CM", "ARI-IAC-6M",
  "ARI-IAC-UHF", "ARI-IAC-VHF", "ARRL-10", "ARRL-10-GHZ", "ARRL-160", "ARRL-222", "ARRL-DIGI", "ARRL-DX-CW", "ARRL-DX-SSB", "ARRL-EME",
  "ARRL-FIELD-DAY", "ARRL-RR-CW", "ARRL-RR-RTTY", "ARRL-RR-SSB", "ARRL-RTTY", "ARRL-SCR", "ARRL-SS-CW", "ARRL-SS-SSB", "ARRL-UHF-AUG",
  "ARRL-VHF-JAN", "ARRL-VHF-JUN", "ARRL-VHF-SEP", "AZ-QSO-PARTY", "BANGGAI-DX", "BARTG-RTTY", "BARTG-SPRINT", "BC-QSO-PARTY",
  "BEKASI-MERDEKA-CONTEST", "CA-QSO-PARTY", "CIS-DX", "CO-QSO-PARTY", "CQ-160-CW", "CQ-160-SSB", "CQ-M", "CQ-VHF", "CQ-WPX-CW",
  "CQ-WPX-RTTY", "CQ-WPX-SSB", "CQ-WW-CW", "CQ-WW-RTTY", "CQ-WW-SSB", "CT-QSO-PARTY", "CVA-DX-CW", "CVA-DX-SSB", "CWOPS-CW-OPEN",
  "CWOPS-CWT", "DARC-10", "DARC-CWA", "DARC-FT4", "DARC-HELL", "DARC-MICROWAVE", "DARC-TRAINEE", "DARC-UKW-SPRING", "DARC-UKW-FIELD-DAY",
  "DARC-VHF-UHF-MICROWAVE", "DARC-WAEDC-CW", "DARC-WAEDC-RTTY", "DARC-WAEDC-SSB", "DARC-WAG", "DE-QSO-PARTY", "DL-DX-RTTY", "DMC-RTTY",
  "EA-CNCW", "EA-DME", "EA-MAJESTAD-CW", "EA-MAJESTAD-SSB", "EA-PSK63", "EA-RTTY", "EA-SMRE-CW", "EA-SMRE-SSB", "EA-VHF-ATLANTIC",
  "EA-VHF-COM", "EA-VHF-COSTA-SOL", "EA-VHF-EA", "EA-VHF-EA1RCS", "EA-VHF-QSL", "EA-VHF-SADURNI", "EA-WW-RTTY", "EASTER", "EPC-PSK63",
  "EU Sprint", "EU-HF", "EU-PSK-DX", "EUCW160M", "FALL SPRINT", "FL-QSO-PARTY", "GA-QSO-PARTY", "HA-DX", "HELVETIA", "HI-QSO-PARTY",
  "HOLYLAND", "IA-QSO-PARTY", "IARU-FIELD-DAY", "IARU-HF", "ICWC-MST", "ID-QSO-PARTY", "IL QSO Party", "IN-QSO-PARTY", "JARTS-WW-RTTY",
  "JIDX-CW", "JIDX-SSB", "JT-DX-RTTY", "K1USN-SSO", "K1USN-SST", "KS-QSO-PARTY", "KY-QSO-PARTY", "LA-QSO-PARTY", "LDC-RTTY", "LZ DX",
  "MAR-QSO-PARTY", "MD-QSO-PARTY", "ME-QSO-PARTY", "MI-QSO-PARTY", "MIDATLANTIC-QSO-PARTY", "MN-QSO-PARTY", "MO-QSO-PARTY", "MS-QSO-PARTY",
  "MT-QSO-PARTY", "NA-SPRINT-CW", "NA-SPRINT-RTTY", "NA-SPRINT-SSB", "NAQP-CW", "NAQP-RTTY", "NAQP-SSB", "NAVAL", "NC-QSO-PARTY",
  "ND-QSO-PARTY", "NE-QSO-PARTY", "NEQP", "NH-QSO-PARTY", "NJ-QSO-PARTY", "NM-QSO-PARTY", "NRAU-BALTIC-CW", "NRAU-BALTIC-SSB",
  "NV-QSO-PARTY", "NY-QSO-PARTY", "OCEANIA-DX-CW", "OCEANIA-DX-SSB", "OH-QSO-PARTY", "OK-DX-RTTY", "OK-OM-DX", "OK-QSO-PARTY",
  "OMISS-QSO-PARTY", "ON-QSO-PARTY", "OR-QSO-PARTY", "ORARI-DX", "PA-QSO-PARTY", "PACC", "PCC", "PSK-DEATHMATCH", "QC-QSO-PARTY", "RAC",
  "RAC-CANADA-DAY", "RAC-CANADA-WINTER", "RDAC", "RDXC", "REF-160M", "REF-CW", "REF-SSB", "REP-PORTUGAL-DAY-HF", "RI-QSO-PARTY", "RSGB-160",
  "RSGB-21/28-CW", "RSGB-21/28-SSB", "RSGB-80M-CC", "RSGB-AFS-CW", "RSGB-AFS-SSB", "RSGB-CLUB-CALLS", "RSGB-COMMONWEALTH", "RSGB-IOTA",
  "RSGB-LOW-POWER", "RSGB-NFD", "RSGB-ROPOCO", "RSGB-SSB-FD", "RUSSIAN-RTTY", "SAC-CW", "SAC-SSB", "SARTG-RTTY", "SC-QSO-PARTY", "SCC-RTTY",
  "SD-QSO-PARTY", "ShortRY", "SMP-AUG", "SMP-MAY", "SP-DX-RTTY", "SPAR-WINTER-FD", "SPDXContest", "SPRING SPRINT", "SR-MARATHON",
  "STEW-PERRY", "SUMMER SPRINT", "TARA-GRID-DIP", "TARA-RTTY", "TARA-RUMBLE", "TARA-SKIRMISH", "TEN-RTTY", "TMC-RTTY", "TN-QSO-PARTY",
  "TX-QSO-PARTY", "UBA-DX-CW", "UBA-DX-SSB", "UK-DX-BPSK63", "UK-DX-RTTY", "UKR-CHAMP-RTTY", "UKRAINIAN DX", "UKSMG-6M-MARATHON",
  "UKSMG-SUMMER-ES", "URE-DX", "US-COUNTIES-QSO", "UT-QSO-PARTY", "VA-QSO-PARTY", "VENEZ-IND-DAY", "VIRGINIA QSO PARTY", "VOLTA-RTTY",
  "VT-QSO-PARTY", "WA-QSO-PARTY", "WFD", "WI-QSO-PARTY", "WIA-HARRY ANGEL", "WIA-JMMFD", "WIA-OCDX", "WIA-REMEMBRANCE", "WIA-ROSS HULL",
  "WIA-TRANS TASMAN", "WIA-VHF/UHF FD", "WIA-VK SHIRES", "WINTER SPRINT", "WV-QSO-PARTY", "WW-DIGI", "WY-QSO-PARTY", "XE-INTL-RTTY",
  "YOHFDX", "YUDXC"];
const LOG_QSO_MORSE_KEYS = ["SK", "SS", "BUG", "FAB", "SP", "DP", "CPU"];
const LOG_QSO_QSL_VIA = ["B", "D", "E"];
const LOG_QSO_YES_NO = ["Y", "N"];
const LOG_QSO_IOTA_REGEXP = /^(AF|AN|AS|EU|NA|OC|SA)-\d{3}$/;
const LOG_QSO_CONTINENTS = ["AF", "AN", "AS", "EU", "NA", "OC", "SA"];
// The Propagation_Mode Enumeration's descriptions (ADIF's own, offered beside each value)
const LOG_QSO_PROP_MODE_NAMES = {
  AS: "Aircraft Scatter", AUE: "Aurora-E", AUR: "Aurora", BS: "Back scatter", ECH: "EchoLink", EME: "Earth-Moon-Earth", ES: "Sporadic E",
  F2: "F2 Reflection", FAI: "Field Aligned Irregularities", GWAVE: "Ground Wave", INTERNET: "Internet-assisted", ION: "Ionoscatter",
  IRL: "IRLP", LOS: "Line of Sight", MS: "Meteor scatter", RPT: "Terrestrial or atmospheric repeater or transponder", RS: "Rain scatter",
  SAT: "Satellite", TEP: "Trans-equatorial", TR: "Tropospheric ducting"
};
// Other Enumerations' descriptions, ADIF's own, offered beside each value
const LOG_QSO_CHOICE_NAMES = {
  PROP_MODE: LOG_QSO_PROP_MODE_NAMES,
  ANT_PATH: { G: "grayline", O: "other", S: "short path", L: "long path" },
  MORSE_KEY_TYPE: { SK: "straight key", SS: "sideswiper", BUG: "mechanical semi-automatic keyer", FAB: "mechanical fully-automatic keyer",
    SP: "single paddle", DP: "dual paddle", CPU: "computer driven" },
  QSL_SENT_VIA: { B: "bureau", D: "direct", E: "electronic" },
  REGION: { NONE: "not within a WAE or CQ region", IV: "ITU Vienna", AI: "African Italy", SY: "Sicily", BI: "Bear Island", SI: "Shetland Islands",
    KO: "Kosovo", ET: "European Turkey" },
  QSO_COMPLETE: { Y: "yes", N: "no", NIL: "not heard", "?": "uncertain" }
};
LOG_QSO_CHOICE_NAMES.MY_MORSE_KEY_TYPE = LOG_QSO_CHOICE_NAMES.MORSE_KEY_TYPE;
LOG_QSO_CHOICE_NAMES.QSL_RCVD_VIA = LOG_QSO_CHOICE_NAMES.QSL_SENT_VIA;
const LOG_QSO_WWFF_REGEXP = /^[A-Z0-9]{1,4}FF-\d{4}$/;
const LOG_QSO_FIELD_RULES = {
  POTA_REF: { pattern: LOG_QSO_PARK_REGEXP, example: "US-1234" },
  MY_POTA_REF: { pattern: LOG_QSO_PARK_REGEXP, example: "US-1234", list: true },
  WWFF_REF: { pattern: LOG_QSO_WWFF_REGEXP, example: "KFF-1234" }, MY_WWFF_REF: { pattern: LOG_QSO_WWFF_REGEXP, example: "KFF-1234" },
  CQZ: { int: true, min: 1, max: 40 }, ITUZ: { int: true, min: 1, max: 90 },
  MY_CQ_ZONE: { int: true, min: 1, max: 40 }, MY_ITU_ZONE: { int: true, min: 1, max: 90 }, MY_DXCC: { int: true }, DXCC: { int: true },
  IOTA: { pattern: LOG_QSO_IOTA_REGEXP, example: "NA-065" }, MY_IOTA: { pattern: LOG_QSO_IOTA_REGEXP, example: "NA-065" },
  IOTA_ISLAND_ID: { int: true, min: 1, max: 99999999 }, MY_IOTA_ISLAND_ID: { int: true, min: 1, max: 99999999 },
  CONT: { choice: LOG_QSO_CONTINENTS },
  REGION: { choice: Object.keys(LOG_QSO_CHOICE_NAMES.REGION) },
  VUCC_GRIDS: { vucc: true }, MY_VUCC_GRIDS: { vucc: true },
  LAT: { location: "lat" }, LON: { location: "lon" }, MY_LAT: { location: "lat" }, MY_LON: { location: "lon" },
  ALTITUDE: { num: true, signed: true }, MY_ALTITUDE: { num: true, signed: true }, DISTANCE: { num: true },
  CONTEST_ID: { suggest: LOG_QSO_CONTEST_IDS },
  STX: { int: true }, SRX: { int: true },
  ARRL_SECT: { choice: LOG_QSO_ARRL_SECTIONS }, MY_ARRL_SECT: { choice: LOG_QSO_ARRL_SECTIONS },
  QSL_SENT: { choice: ["Y", "N", "R", "Q", "I"] }, QSL_RCVD: { choice: ["Y", "N", "R", "I"] },
  QSL_SENT_VIA: { choice: LOG_QSO_QSL_VIA }, QSL_RCVD_VIA: { choice: LOG_QSO_QSL_VIA },
  QSLSDATE: { date: true }, QSLRDATE: { date: true },
  STATION_CALLSIGN: { call: true }, OPERATOR: { call: true }, OWNER_CALLSIGN: { call: true }, CONTACTED_OP: { call: true }, EQ_CALL: { call: true },
  MY_GRIDSQUARE: { grid: true },
  MORSE_KEY_TYPE: { choice: LOG_QSO_MORSE_KEYS }, MY_MORSE_KEY_TYPE: { choice: LOG_QSO_MORSE_KEYS },
  FISTS: { int: true, min: 1 }, MY_FISTS: { int: true, min: 1 }, FISTS_CC: { int: true, min: 1 }, TEN_TEN: { int: true, min: 1 },
  UKSMG: { int: true, min: 1 },
  FORCE_INIT: { choice: LOG_QSO_YES_NO }, QSO_RANDOM: { choice: LOG_QSO_YES_NO },
  SWL: { choice: LOG_QSO_YES_NO },
  RX_PWR: { num: true }, ANT_AZ: { num: true, min: 0, max: 360 }, ANT_EL: { num: true, signed: true, min: -90, max: 90 },
  ANT_PATH: { choice: Object.keys(LOG_QSO_CHOICE_NAMES.ANT_PATH) },
  FREQ_RX: { num: true, positive: true }, BAND_RX: { band: true },
  NR_BURSTS: { int: true }, NR_PINGS: { int: true }, MAX_BURSTS: { num: true },
  A_INDEX: { num: true, min: 0, max: 400 }, K_INDEX: { int: true, min: 0, max: 9 }, SFI: { int: true, min: 0, max: 300 },
  PROP_MODE: { choice: LOG_QSO_PROP_MODES },
  QSO_COMPLETE: { choice: Object.keys(LOG_QSO_CHOICE_NAMES.QSO_COMPLETE) },
  EMAIL: { pattern: /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/, example: "name@example.com" },
  AGE: { num: true, min: 0, max: 120 }
};

// A Number as ADIF writes it (no leading zeros, "." for the decimal point; a minus sign only when signed), or null
function logQsoNumber(text, int = false, signed = false)
{
  const plain = String(text || "").trim().replace(",", ".");
  const sign = signed ? "-?" : "";
  if (!new RegExp(int ? `^${sign}\\d+$` : `^${sign}(\\d+(\\.\\d*)?|\\.\\d+)$`).test(plain)) return null;
  return String(Number(plain));
}

// A Location as ADIF writes it, "XDDD MM.MMM" (N044 37.800, W123 05.400), from degrees (a minus sign: south or west)
function logQsoLocation(degrees, lat)
{
  const hem = lat ? (degrees < 0 ? "S" : "N") : degrees < 0 ? "W" : "E";
  const abs = Math.abs(degrees);
  let deg = Math.floor(abs);
  let min = Math.round((abs - deg) * 60000) / 1000;
  if (min >= 60)
  {
    deg += 1;
    min = 0;
  }
  return hem + String(deg).padStart(3, "0") + " " + min.toFixed(3).padStart(6, "0");
}

// A Location typed: ADIF's own form (any spacing), or decimal degrees; the ADIF form, or null
function logQsoParseLocation(text, lat)
{
  const value = String(text || "").trim().toUpperCase();
  let degrees = null;
  const adif = value.match(/^([NSEW])\s*(\d{1,3})\s+(\d{1,2}(\.\d+)?)$/);
  if (adif)
  {
    if (lat != "NS".includes(adif[1]) || Number(adif[3]) >= 60) return null;
    degrees = (Number(adif[2]) + Number(adif[3]) / 60) * ("SW".includes(adif[1]) ? -1 : 1);
  }
  else if (/^-?(\d+(\.\d*)?|\.\d+)$/.test(value)) degrees = Number(value);
  if (degrees == null || Math.abs(degrees) > (lat ? 90 : 180)) return null;
  return logQsoLocation(degrees, lat);
}

// A Date typed (YYYYMMDD or YYYY-MM-DD, a real day from 1930 on): YYYYMMDD, or null
function logQsoParseDate(text)
{
  const m = String(text || "").trim().match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
  if (!m) return null;
  const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number(m[1]) < 1930 || day.getUTCMonth() != Number(m[2]) - 1 || day.getUTCDate() != Number(m[3])) return null;
  return m[1] + m[2] + m[3];
}

// An added field's value (ASCII already, capitals where the card keeps them) checked against LOG_QSO_FIELD_RULES: { fields: { FIELD:
// value } (a 10-character grid's 9th and 10th characters in FIELD_EXT) } or { error: [i18n key, ...the text's {0}, {1}] }
function logQsoFieldCheck(field, value)
{
  const rule = LOG_QSO_FIELD_RULES[field] || {};
  if (rule.grid)
  {
    if (!LOG_QSO_GRID_REGEXP.test(value)) return { error: ["logQso.error.grid"] };
    const fields = { [field]: value.slice(0, 8) };
    if (value.length > 8) fields[field + "_EXT"] = value.slice(8);
    return { fields };
  }
  if (rule.call && !logQsoCallRegexp().test(value)) return { error: ["logQso.error.format", field, "W1AW"] };
  if (rule.int || rule.num)
  {
    const n = logQsoNumber(value, rule.int, rule.signed);
    if (n == null || (rule.positive && Number(n) <= 0)) return { error: ["logQso.error.number"] };
    if ((rule.min != null && Number(n) < rule.min) || (rule.max != null && Number(n) > rule.max))
    {
      return { error: rule.max == null ? ["logQso.error.min", field, rule.min] : ["logQso.error.range", field, rule.min, rule.max] };
    }
    value = n;
  }
  if (rule.date)
  {
    const date = logQsoParseDate(value);
    if (!date) return { error: ["logQso.error.format", field, "20261111"] };
    value = date;
  }
  if (rule.location)
  {
    const lat = rule.location == "lat";
    const at = logQsoParseLocation(value, lat);
    if (!at) return { error: ["logQso.error.format", field, lat ? "N044 37.800" : "W123 05.400"] };
    value = at;
  }
  // VUCC grids: the 2 or 4 four-character squares a station on their line or corner was in
  if (rule.vucc)
  {
    const parts = value.split(",").map((p) => p.trim());
    if (![2, 4].includes(parts.length) || !parts.every((p) => /^[A-R]{2}\d{2}$/.test(p))) return { error: ["logQso.error.format", field, "CN87,CN88"] };
    value = parts.join(",");
  }
  if (rule.band)
  {
    value = value.toLowerCase();
    if (!LOG_QSO_BANDS.some(([band]) => band == value)) return { error: ["logQso.error.band"] };
  }
  if (rule.choice && !rule.choice.includes(value)) return { error: ["logQso.error.choice", field, rule.choice.join(", ")] };
  if (rule.pattern)
  {
    const parts = rule.list ? value.split(",").map((p) => p.trim()) : [value];
    if (!parts.every((p) => rule.pattern.test(p))) return { error: ["logQso.error.format", field, rule.example] };
    value = parts.join(",");
  }
  return { fields: { [field]: value } };
}

// Text as ADIF can carry it (GridTracker's logging leaves out a field that isn't plain ASCII: finishSendingReport): accents taken off,
// else null where something else is left
function logQsoAscii(text)
{
  const plain = String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  return /^[\x20-\x7e]*$/.test(plain) ? plain : null;
}

// The form's values checked (now: the time now, ms): { errors: { field: its message's i18n key } (none: {}), record (ordered ADIF
// fields, the QSO) or null. The messages the roster's Log POTA / SOTA QSO has are its own (sotaLog.*: a call, the UTC date and time,
// not in the future: a few minutes' slack for a fast clock, as it allows)
function logQsoValidate(f, now = Date.now())
{
  const errors = {};
  const record = {};
  const call = String(f.call || "").toUpperCase().trim();
  if (!logQsoCallRegexp().test(call)) errors.call = "sotaLog.needCall";
  const on = logQsoParseUtc(f.dateOn, f.timeOn);
  const off = logQsoParseUtc(f.dateOff, f.timeOff);
  if (on == null) errors.timeOn = "sotaLog.needTime";
  else if (on > now + 300000) errors.timeOn = "sotaLog.future";
  if (off == null) errors.timeOff = "sotaLog.needTime";
  else if (off > now + 300000) errors.timeOff = "sotaLog.future";
  if (on != null && off != null && off < on && !errors.timeOff) errors.timeOff = "logQso.error.order";
  // FREQ and BAND: a frequency in one of ADIF's bands, or a band picked with no frequency; both, the frequency in that band
  const freqText = String(f.freq || "").trim();
  const mhz = Number(freqText.replace(",", "."));
  const fromFreq = mhz > 0 ? logQsoBand(mhz * 1e6) : "";
  const picked = String(f.band || "").trim().toLowerCase();
  if (freqText && !fromFreq) errors.freq = "logQso.error.freq";
  else if (!freqText && !picked) errors.freq = "logQso.error.freq";
  if (picked && !LOG_QSO_BANDS.some(([b]) => b == picked)) errors.band = "logQso.error.band";
  else if (picked && fromFreq && picked != fromFreq) errors.band = "logQso.error.bandFreq";
  const band = picked || fromFreq;
  const mode = String(f.mode || "").toUpperCase().trim();
  if (!/^[A-Z0-9]+$/.test(mode)) errors.mode = "logQso.error.mode";
  const grid = String(f.grid || "").trim().toUpperCase();
  if (grid && !LOG_QSO_GRID_REGEXP.test(grid)) errors.grid = "logQso.error.grid";
  // TX_PWR: a Number of watts, as typed (0.5 W stays 0.5)
  const power = String(f.power || "").trim() ? logQsoNumber(f.power) : "";
  if (power == null) errors.power = "logQso.error.power";
  const texts = {};
  for (const key of ["name", "comment", "rstSent", "rstRcvd"])
  {
    texts[key] = logQsoAscii(f[key]);
    if (texts[key] == null) errors[key] = "logQso.error.ascii";
  }
  if (Object.keys(errors).length) return { errors, record: null };
  record.CALL = call;
  record.QSO_DATE = logQsoAdifDate(on);
  record.TIME_ON = logQsoAdifTime(on);
  record.QSO_DATE_OFF = logQsoAdifDate(off);
  record.TIME_OFF = logQsoAdifTime(off);
  record.BAND = band;
  if (freqText) record.FREQ = mhz.toFixed(6);
  record.MODE = mode;
  const submode = String(f.submode || "").toUpperCase().trim();
  if (submode) record.SUBMODE = submode;
  if (texts.rstSent) record.RST_SENT = texts.rstSent;
  if (texts.rstRcvd) record.RST_RCVD = texts.rstRcvd;
  if (grid) record.GRIDSQUARE = grid.slice(0, 8);
  if (grid.length > 8) record.GRIDSQUARE_EXT = grid.slice(8);
  if (texts.name) record.NAME = texts.name;
  if (power) record.TX_PWR = power;
  if (texts.comment) record.COMMENT = texts.comment;
  return { errors, record };
}

// A record as the message sendToLogger takes: a header, its fields, <EOR> (as n3fjpContest.js writes a contest log's QSO). A field with
// nothing in it is never written (no <POTA_REF:0>)
function logQsoAdif(record)
{
  let adif = "<EOH>";
  for (const key in record)
  {
    const value = record[key] == null ? "" : String(record[key]);
    if (value.length == 0) continue;
    adif += "<" + key + ":" + value.length + ">" + value + " ";
  }
  return adif + "<EOR>";
}

// The mode GridTracker files a QSO under (adifWorker.js: MFSK's and DATA's by their submode, every other by its mode): a QSO already in
// its log on the same band in it is "worked"
function logQsoWorkedMode(mode, submode)
{
  mode = String(mode || "").toUpperCase();
  return (mode == "MFSK" || mode == "DATA") && submode ? String(submode).toUpperCase() : mode;
}

// (Node's tests only: the window has no module of its own to fill)
if (typeof window == "undefined" && typeof module == "object" && module.exports)
{
  module.exports = {
    LOG_QSO_MODES, LOG_QSO_MODE_CHOICES, logQsoModeLabel, logQsoUtcParts, logQsoParseUtc, logQsoAdifDate, logQsoAdifTime, logQsoBand,
    logQsoMhz, logQsoCallFromText, logQsoDigitalMode, logQsoPhoneMode, logQsoSpotMode, logQsoDefaultRst, logQsoBlank, logQsoPrefillDigital,
    LOG_QSO_BANDS, logQsoPrefillPhone, logQsoAscii, logQsoNumber, logQsoFieldCheck, LOG_QSO_FIELD_RULES, logQsoValidate, logQsoAdif, logQsoWorkedMode,
    logQsoLocation, logQsoParseLocation, logQsoParseDate, LOG_QSO_CHOICE_NAMES
  };
}
