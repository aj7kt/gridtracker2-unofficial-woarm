// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// BirdWatch transmitters: a satellite's transmitters from the SatNOGS database, in the tooltip of a satellite under the mouse on the map and
// in a window of their own (a right click on a satellite; it follows the selected satellite)
// (transmitters.json in the satellite data), each with the frequency to tune to and to transmit on right now, as the satellite's
// speed toward or away from you shifts them (the tracker's Doppler factor: the frequency heard is the transmitted one times it)

let birdWatchTransmitterStamp = "";
let birdWatchTransmitterMap = new Map();

// The amateur bands, in MHz (the ones satellites use: a transmitter whose database entry has no service listed, as many on the old
// amateur satellites do, is still an amateur one when it is on one of these)
const BIRD_WATCH_HAM_BANDS = [[1.8, 2], [3.5, 4], [7, 7.3], [10.1, 10.15], [14, 14.35], [18.068, 18.168], [21, 21.45], [24.89, 24.99], [28, 29.7], [50, 54], [144, 148], [222, 225], [420, 450], [902, 928], [1240, 1300], [2300, 2450], [3300, 3500], [5650, 5925], [10000, 10500], [24000, 24250]];

// An amateur transmitter: the database says so, or it is on an amateur band (its downlink or its uplink)
function birdWatchAmateurTransmitter(t)
{
  if (t.service == "Amateur") return true;
  return [t.downlink_low, t.uplink_low].some((hz) => hz > 0 && BIRD_WATCH_HAM_BANDS.some(([low, high]) => hz / 1e6 >= low && hz / 1e6 <= high));
}

const BIRD_WATCH_MIN_SIDE_HZ = 100000;
function birdWatchSaneSides(t)
{
  const low = (side) => t[side + "_low"] > 0 && t[side + "_low"] < BIRD_WATCH_MIN_SIDE_HZ;
  if (!low("downlink") && !low("uplink")) return t;
  const out = Object.assign({}, t);
  for (const side of ["downlink", "uplink"])
  {
    if (!low(side)) continue;
    out[side + "_low"] = null;
    out[side + "_high"] = null;
  }
  return out;
}

// The active transmitters of a satellite: the amateur ones first, two-way ones before beacons.
// The file looked at again at most this often (it's asked for on every rig line drawn, many a second with a scope streaming); one
// that doesn't parse is kept as its stamp, not read again until it changes (the transmitters read before kept meanwhile)
const BIRD_WATCH_TX_CHECK_MS = 1000;
let birdWatchTransmitterCheckedAt = 0;
function birdWatchTransmitters(norad)
{
  const now = Date.now();
  if (now - birdWatchTransmitterCheckedAt >= BIRD_WATCH_TX_CHECK_MS || now < birdWatchTransmitterCheckedAt) birdWatchTransmittersRead(now);
  const rank = (t) => (birdWatchAmateurTransmitter(t) ? 0 : 10) + (t.uplink_low > 0 ? 0 : 1);
  return (birdWatchTransmitterMap.get(Number(norad)) || []).slice().sort((a, b) => rank(a) - rank(b));
}

function birdWatchTransmittersRead(now)
{
  birdWatchTransmitterCheckedAt = now;
  let stamp;
  const file = path.join(satDir(), "transmitters.json");
  try
  {
    const stat = fs.statSync(file);
    stamp = stat.mtimeMs + ":" + stat.size;
  }
  catch (e)
  {
    // None (not synced yet): none listed
    birdWatchTransmitterMap = new Map();
    birdWatchTransmitterStamp = "";
    return;
  }
  if (stamp == birdWatchTransmitterStamp) return;
  // (stamped before it's read: one that doesn't parse isn't read again until it changes)
  birdWatchTransmitterStamp = stamp;
  try
  {
    const map = new Map();
    for (const entry of JSON.parse(fs.readFileSync(file, "utf8")))
    {
      // A side under BIRD_WATCH_MIN_SIDE_HZ is a slip in the database (98533's uplink "13820 - 28820" Hz, meant as MHz): left out,
      // never sent to a rig
      const t = birdWatchSaneSides(entry);
      if (t.status != "active" || !t.alive || !(t.downlink_low > 0 || t.uplink_low > 0)) continue;
      const list = map.get(t.norad_cat_id) || [];
      list.push(t);
      map.set(t.norad_cat_id, list);
    }
    birdWatchTransmitterMap = map;
  }
  catch (e)
  {
    console.error("BirdWatch: transmitters.json not read", e);
  }
}

// The CTCSS (PL) tone a transmitter's uplink needs, in Hz, as its description says it ("CTCSS 67.0 Hz", "PL 88.5Hz", "67.0 PL",
// "67 Hz tone"); null when it says none ("no CTCSS") or doesn't say
function birdWatchTransmitterTone(t)
{
  const text = String(t.description || "");
  if (/\bno\s+(?:ctcss|pl)\b/i.test(text)) return null;
  const m = /\b(?:CTCSS|PL)(?:\s*tone)?\s*[:=]?\s*(\d{2,3}(?:\.\d)?)\s*(?:Hz)?\b/i.exec(text) || /\b(\d{2,3}(?:\.\d)?)\s*(?:Hz\s*)?(?:CTCSS|PL|tone)\b/i.exec(text);
  const hz = m ? Number(m[1]) : 0;
  return hz >= 60 && hz <= 260 ? hz : null;
}

// Whether the connected rig can hear a satellite (a transmitter's downlink in its receive ranges) or work it (one transmitter's downlink it
// can hear and uplink it can transmit on, and a second VFO to transmit on while it listens); need: "hear" or "work"
function birdWatchRigCan(norad, need, ranges)
{
  if (need == "work" && !ranges.canTx) return false;
  return birdWatchTransmitters(norad).some((t) => rigRangesCover(ranges.rx, t.downlink_low, t.downlink_high) && (need != "work" || rigRangesCover(ranges.tx, t.uplink_low, t.uplink_high)));
}

// Whether a satellite has an active transmitter with an uplink (the Satellites tab's Only With Uplinks)
function birdWatchHasUplink(norad)
{
  return birdWatchTransmitters(norad).some((t) => t.uplink_low > 0);
}

// What a satellite can be worked with (the Satellites tab's Mode filter and its rows' tags), from its active amateur transmitters, in
// this order: "fm" (an FM voice repeater, for a handheld), "linear" (a linear transponder: SSB and CW), "digital" (packet, APRS and the
// other data modes) need an uplink; "sstv" is any SSTV it sends, two-way or not (it is only listened to). The database's mode is not
// always the one used (Es'hail 2's SSB transponders say FM), so the description has the last word. Commands only (DTMF) count as none
const BIRD_WATCH_SAT_KINDS = ["fm", "linear", "digital", "sstv"];
const BIRD_WATCH_DATA_TEXT = /aprs|packet|digi|bbs|ax\.?25|1200|9600|baud|bps|sstv|data/i;
let birdWatchSatKindStamp = "";
const birdWatchSatKindMap = new Map();

function birdWatchTransmitterKind(t)
{
  const mode = String(t.mode || "").toUpperCase();
  const text = String(t.description || "");
  if (mode == "SSTV" || /\bsstv\b/i.test(text)) return "sstv";
  if (!(t.uplink_low > 0) || /command|dtmf/i.test(text)) return null;
  if (/^(USB|LSB|CW|SSB|DSB)$/.test(mode) || /linear|\blin\b|ssb|\bcw\b/i.test(text)) return "linear";
  if (/^FMN?$/.test(mode) && t.type == "Transponder") return /\bN?FM\b/i.test(text) ? "fm" : "linear";
  if (t.type == "Transponder" && !/^(AFSK|FSK|GFSK|GMSK|BPSK)/.test(mode)) return "linear";
  if (/^FMN?$/.test(mode) && !BIRD_WATCH_DATA_TEXT.test(text)) return "fm";
  return "digital";
}

function birdWatchSatKinds(norad)
{
  // Worked out again when the transmitters were read again (birdWatchTransmitters keeps its stamp)
  const list = birdWatchTransmitters(norad);
  if (birdWatchSatKindStamp != birdWatchTransmitterStamp)
  {
    birdWatchSatKindMap.clear();
    birdWatchSatKindStamp = birdWatchTransmitterStamp;
  }
  const key = Number(norad);
  if (birdWatchSatKindMap.has(key)) return birdWatchSatKindMap.get(key);
  const kinds = new Set();
  for (const t of list)
  {
    if (!birdWatchAmateurTransmitter(t)) continue;
    const kind = birdWatchTransmitterKind(t);
    if (kind) kinds.add(kind);
  }
  const result = BIRD_WATCH_SAT_KINDS.filter((kind) => kinds.has(kind));
  birdWatchSatKindMap.set(key, result);
  return result;
}

// A frequency in MHz as a rig's dial shows it (formatDialFreq); a range as low - high
function birdWatchFrequency(low, high, factor)
{
  if (!(low > 0)) return "";
  const one = (hz) => formatDialFreq(hz * factor);
  return high > low ? one(low) + " - " + one(high) : one(low);
}

// The rig's mode for a transmitter: FM for the FM voice and packet ones, USB for the PSK data ones, SSB / CW / AM as they are; null for a
// mode the rig has no name for (none is set then). A linear transponder the database calls FM (Es'hail 2's SSB segments, as
// birdWatchTransmitterKind reads them) is USB, or CW for a segment its description gives to CW alone
function birdWatchRigMode(t)
{
  const mode = birdWatchRigModeOf(t.mode);
  if (mode == "FM" && birdWatchTransmitterKind(t) == "linear") return /\bcw\b/i.test(String(t.description || "")) && !/ssb|usb|lsb|mixed|digi|voice/i.test(String(t.description || "")) ? "CW" : "USB";
  return mode;
}

// The rig's name for a database mode, else null
function birdWatchRigModeOf(name)
{
  const mode = String(name || "").toUpperCase();
  if (/^(LSB|USB|CW|AM|FM)$/.test(mode)) return mode;
  if (/SSB/.test(mode)) return "USB";
  if (/FM|AFSK|FSK|SSTV|DUV|GMSK|APRS|GFSK|MSK/.test(mode)) return "FM";
  if (/PSK|QPSK|OFDM/.test(mode)) return "USB";
  if (/CW/.test(mode)) return "CW";
  return null;
}

// The rig's mode for a transmitter's uplink (its own mode, else the downlink's), as birdWatchRigMode has it; null for none or no
// uplink. An inverting transponder whose uplink the database gives the downlink's sideband: the other one (LSB under a USB downlink)
function birdWatchRigUpMode(t)
{
  if (!(t.uplink_low > 0)) return null;
  const mode = birdWatchRigMode(Object.assign({}, t, { mode: t.uplink_mode || t.mode }));
  if (t.invert === true && birdWatchTransponder(t) && (mode == "USB" || mode == "LSB") && mode == birdWatchRigMode(t)) return mode == "USB" ? "LSB" : "USB";
  return mode;
}

// What to tune the rig to for a transmitter, where the satellite is now: the middle of a range, shifted (the uplink the other way)
function birdWatchTransmitterTuning(t, factor)
{
  const middle = (low, high) => (high > low ? (low + high) / 2 : low);
  return {
    rx: t.downlink_low > 0 ? Math.round(middle(t.downlink_low, t.downlink_high) * factor) : null,
    tx: t.uplink_low > 0 ? Math.round(middle(t.uplink_low, t.uplink_high) / factor) : null
  };
}

// The transmitters of the table as it was last drawn, in its order (the transmitters window's or the map tooltip's: the window names one
// by its uuid, birdWatchPinTransmitter)
GT.birdWatchTxList = [];
// What the rig follows: { norad, uuid, rx, tx } (the transmitter clicked, and which of its sides), null for nothing
GT.rigDoppler = null;

// The satellite's transmitters as a table of html: the hover tooltip's, and the transmitters window's (the selected satellite's). The downlink
// is what to tune to now and the uplink what to transmit on now, shifted for where the satellite is at this moment (the frequency the rig
// is set to, a range's half width after it); the satellite's own frequencies are in their tooltips
function birdWatchTransmitterTableHtml(norad)
{
  const sat = GT.birdWatchTrack.last.get(Number(norad));
  // None yet: the frequencies are the satellite's own, and the shift is left blank
  const factor = sat && !sat.error ? sat.doppler : null;
  // A cell, its colors and alignment the App Theme's (its class: style.css .birdDopplerTable)
  // (an apostrophe in a title, a SatNOGS description's or a translation's, would end the attribute: htmlEntities leaves it)
  const cell = (text, kind, title, part) => "<td" + partAttrs(part, kind) + (title ? " title='" + String(title).replace(/'/g, "&#39;") + "'" : "") + ">" + text + "</td>";
  // With Rig Control connected the name, mode, downlink and uplink cells tune the rig (a click in the window), and the mode, downlink and uplink the rig was set to are marked
  const D = GT.rigDoppler && GT.rigDoppler.norad == Number(norad) ? GT.rigDoppler : null;
  // Each transmitter's own VFOs (rigRoles): clickable when one of them is connected; its downlink's and uplink's VFO letter after the
  // frequency (yellow: its own pick), and in the tooltip with how to pick another
  const rigOn = GT.settings.Rigs.enable && GT.settings.BirdWatch.autoRig !== false;
  let clickable = false;
  let current = null;
  let roles = null;
  const vfoBadge = (side) =>
  {
    const v = roles && roles[side];
    if (!v) return "";
    // Its letter, as its name has it ("VFO-C (SDR)": C), in a pill (the accent's: its own pick)
    const letter = rigVfoLabel(v).replace(/^VFO-/, "").charAt(0);
    return "<span class='birdTxVfo" + (rigRolePin(current, side) ? " birdTxVfoPin" : "") + "'>" + letter + "</span>";
  };
  const vfoTitle = (title, side) =>
  {
    if (!rigOn) return title;
    const v = roles && roles[side];
    const text = I18N("birdWatch.pin.hover").replace("{vfo}", rigVfoLabel(v));
    return (title ? title + "\n" : "") + htmlEntities(text).replace(/'/g, "&#39;");
  };
  const partAttrs = (part, kind) =>
  {
    const classes = [kind];
    if (part && clickable) classes.push("birdTxClick");
    if (part && D && current && D.uuid == current.uuid && part != "name" && D[part]) classes.push("birdTxFollow");
    return (part ? " data-part='" + part + "'" : "") + " class='" + classes.join(" ") + "'";
  };
  GT.birdWatchTxList = [];
  const original = (low, high) => (low > 0 ? I18N("birdWatch.doppler.original").replace("{f}", birdWatchFrequency(low, high, 1) + " MHz") : "");
  // The one frequency the rig is tuned to (birdWatchTransmitterTuning: a range's middle, shifted), as the tracking programs show it; a
  // range's half width after it, dimmer: 145.910.125 ±15 kHz
  const tuned = (hz, low, high) =>
  {
    if (!(hz > 0)) return "";
    const half = high > low ? (high - low) / 2000 : 0;
    return formatDialFreq(hz) + (half > 0 ? " <span class='birdTxRange'>±" + (Number.isInteger(half) ? half : half.toFixed(1)) + " kHz</span>" : "");
  };
  let rows = "";
  for (const t of birdWatchTransmitters(norad))
  {
    if (GT.settings.BirdWatch.hideNoUplink && !(t.uplink_low > 0)) continue;
    current = t;
    roles = rigOn ? rigRoles(t) : null;
    clickable = !!roles && (rigVfoReady(roles.rx) || rigVfoReady(roles.tx));
    const index = GT.birdWatchTxList.push(t) - 1;
    let shift = "";
    if (factor !== null)
    {
      const hz = t.downlink_low > 0 ? t.downlink_low * (factor - 1) : t.uplink_low * (1 / factor - 1);
      shift = (hz >= 0 ? "+" : "") + (hz / 1000).toFixed(2) + " kHz";
    }
    const about = [t.description, t.type, t.service, t.invert ? "inverting" : ""].filter(Boolean).join("  ·  ");
    const tuning = birdWatchTransmitterTuning(t, factor === null ? 1 : factor);
    // The downlink's mode ("-" where SatNOGS has none, as for a carrier), and the uplink's where it isn't the downlink's
    const downMode = t.mode || "-";
    const upMode = t.uplink_low > 0 && t.uplink_mode && t.uplink_mode != t.mode ? t.uplink_mode : null;
    rows += "<tr data-tx='" + index + "' data-uuid='" + htmlEntities(String(t.uuid)).replace(/'/g, "&#39;") + "'" + (birdWatchAmateurTransmitter(t) ? "" : " class='birdTxOther'") + ">" +
      cell(htmlEntities(t.description), "birdTxName", htmlEntities(about), "name") +
      // The downlink's mode in a chip, and the uplink's after it where it differs (an inverting transponder: USB / LSB), in the Uplink
      // column's color
      cell("<span class='birdTxModeChip'>" + htmlEntities(downMode) + (upMode ? " / <span class='birdTxUpMode'>" + htmlEntities(upMode) + "</span>" : "") + htmlEntities(t.baud > 0 ? " " + t.baud : "") + "</span>", "birdTxMode",
        upMode ? htmlEntities(I18N("birdWatch.doppler.modes.hover").replace("{down}", downMode).replace("{up}", upMode)).replace(/'/g, "&#39;") : null, birdWatchRigMode(t) || birdWatchRigUpMode(t) ? "mode" : null) +
      cell(tuned(tuning.rx, t.downlink_low, t.downlink_high) + (t.downlink_low > 0 ? vfoBadge("rx") : ""), "birdTxDown",
        t.downlink_low > 0 ? vfoTitle(original(t.downlink_low, t.downlink_high), "rx") : "", t.downlink_low > 0 ? "rx" : null) +
      // The satellite hears the uplink shifted too, so it is sent that much the other way
      cell(tuned(tuning.tx, t.uplink_low, t.uplink_high) + (t.uplink_low > 0 ? vfoBadge("tx") : ""), "birdTxUp",
        t.uplink_low > 0 ? vfoTitle(original(t.uplink_low, t.uplink_high), "tx") : "", t.uplink_low > 0 ? "tx" : null) +
      cell(shift, "birdTxShift") + "</tr>";
  }
  if (rows == "") rows = "<tr><td colspan='5' class='birdTxEmpty'>" + I18N("birdWatch.doppler.empty") + "</td></tr>";
  const heads = ["transmitter", "mode", "downlink", "uplink", "shift"].map((key) => "<th>" + I18N("birdWatch.doppler." + key + ".label") + "</th>").join("");
  return "<table id='tooltipTable' class='birdDopplerTable'><thead><tr>" + heads + "</tr></thead><tbody>" + rows + "</tbody></table>";
}

// The hover tooltip: the satellite's name over its table
function birdWatchTransmitterHtml(norad)
{
  const tle = birdWatchTleGet(norad);
  return "<div style='color:var(--gt-title);font-weight:bold;text-align:center;padding:2px 0'>" + htmlEntities(tle ? tle.name : String(norad)) + "</div>" + birdWatchTransmitterTableHtml(norad);
}

// The Doppler button (BirdWatch panel) opens the transmitters window of the selected satellite: greyed out while none is selected
function birdWatchDopplerButtonUpdate()
{
  const selected = GT.birdWatchTrack && GT.birdWatchTrack.selected;
  birdWatchDopplerImg.style.filter = selected ? "" : "grayscale(1)";
  birdWatchDopplerButton.style.opacity = selected ? "" : "0.5";
  birdWatchDopplerButton.style.cursor = selected ? "" : "default";
}

// Like the other window buttons: a click shows or hides the window, a right click (toggle false) shows it
function birdWatchDopplerPressed(toggle = true)
{
  if (!GT.birdWatchTrack || !GT.birdWatchTrack.selected) return;
  if (toggle && GT.birdWatchTxWindowInitialized && electron.ipcRenderer.sendSync("isWinVisible", "gt_transmitters")) birdWatchTransmitterWindowOpen(false);
  else birdWatchTransmitterWindowOpen();
}

// Right click on a satellite on the map: it is the selected one, and its transmitters are in a window of their own
function birdWatchPopOut(norad)
{
  const T = GT.birdWatchTrack;
  if (T.selected != Number(norad)) birdWatchSelect(norad);
  birdWatchTransmitterWindowOpen();
}

// Like the other windows: made hidden at startup (show false), so the main process has put it where it was saved before it is first
// shown; then shown (or hidden) as asked, fitted to the table first
function birdWatchTransmitterWindowOpen(show = true)
{
  if (GT.birdWatchTxWindowHandle == null)
  {
    // The page tells when it is ready (birdWatchTransmitterWindowReady)
    GT.birdWatchTxShowPending = show;
    GT.birdWatchTxWindowHandle = window.open("gt_transmitters.html", "gt_transmitters");
  }
  else if (GT.birdWatchTxWindowInitialized)
  {
    if (show)
    {
      // Fitted, then shown (by the main process, in that order)
      birdWatchTransmitterWindowUpdate(true, true, true);
      GT.birdWatchTxEverShown = true;
    }
    else electron.ipcRenderer.send("hideWin", "gt_transmitters");
  }
  else if (show) GT.birdWatchTxShowPending = true;
}

// From the window's page once the main process has placed it: shown by it (it was open at exit), the table is filled in
function birdWatchTransmitterWindowPlaced(visible)
{
  if (!visible || GT.birdWatchTxEverShown) return;
  GT.birdWatchTxEverShown = true;
  birdWatchTransmitterWindowUpdate(false, true);
}

// From the transmitters window's page once it has loaded: shown if that was asked while it was loading
function birdWatchTransmitterWindowReady()
{
  GT.birdWatchTxWindowInitialized = true;
  if (!GT.birdWatchTxShowPending) return;
  GT.birdWatchTxShowPending = false;
  birdWatchTransmitterWindowUpdate(true, true, true);
  GT.birdWatchTxEverShown = true;
}

// Each tracker tick (and when a setting of the table changes): the selected satellite's name and its transmitters in the window. Its width
// follows the table's whenever that changes (another satellite, other transmitters, longer numbers); its height is the user's. Not before it
// has been shown (it is made hidden at startup), unless it is about to be (showing). show: shown once fitted
function birdWatchTransmitterWindowUpdate(fit = false, showing = false, show = false)
{
  const handle = GT.birdWatchTxWindowHandle;
  if (!handle || !GT.birdWatchTxWindowInitialized || !(showing || GT.birdWatchTxEverShown)) return;
  const T = GT.birdWatchTrack;
  const norad = T ? T.selected : null;
  const tle = norad ? birdWatchTleGet(norad) : null;
  const html = norad ? birdWatchTransmitterTableHtml(norad) : "<div style='color:#aaa;padding:6px 10px'>" + I18N("birdWatch.doppler.none") + "</div>";
  try
  {
    const doc = handle.window.document;
    const target = doc.getElementById("birdTx");
    // Written only when it changed: compared with what was written (innerHTML reads back in the browser's own form)
    if (target.birdTxHtml !== html)
    {
      target.birdTxHtml = html;
      target.innerHTML = html;
    }
    doc.getElementById("birdTxName").textContent = tle ? tle.name : "";
    doc.getElementById("birdTxHead").style.display = norad ? "" : "none";
    doc.getElementById("birdTxFollowing").textContent = GT.rigDoppler && GT.rigDoppler.norad == norad ? I18N("rig.following") : "";
    doc.title = I18N("birdWatch.doppler.label") + (tle ? " - " + tle.name : "");
    // Shown, or another satellite: the height too, to the table's (no taller than the screen); in between it is the user's, who can make it
    // smaller and have the table scroll
    const fitHeight = fit || norad != GT.birdWatchTxShown;
    GT.birdWatchTxShown = norad;
    // The table's size (laid out now, shown or not) with the page's margins and a vertical scroll bar's room; the main process sets the
    // window's content to it (fitWin: no frame to reckon with here), and shows it after when asked. Asked only when it would change
    const box = doc.getElementById("birdTxWrap").getBoundingClientRect();
    const width = Math.ceil(box.width) + 28;
    const height = fitHeight ? Math.ceil(box.height) + 16 : 0;
    const win = handle.window;
    if (show || Math.abs(win.innerWidth - width) > 2 || (fitHeight && Math.abs(win.innerHeight - height) > 2)) electron.ipcRenderer.send("fitWin", "gt_transmitters", width, height, show);
  }
  catch (e)
  {
    // The window is going away
  }
}

// A click in the transmitters window (gt_transmitters.html): the name sets the mode, the RX and the TX (the TX only on a rig with a second
// VFO), the mode cell the mode alone, the downlink the RX alone, the uplink the TX alone; the rig then follows the RX and TX set as the
// satellite moves. The same click again stops it. With the TX set, so is the uplink's CTCSS tone, where the rig can set one (and one
// turned on for another transmitter is turned off when this one has none)
function birdWatchDopplerClick(uuid, part)
{
  const T = GT.birdWatchTrack;
  // By its uuid, among the selected satellite's (birdWatchPinTransmitter)
  const t = birdWatchPinTransmitter(uuid);
  // (Its own VFOs: rigRoles)
  if (!t || !T || !T.selected || !rigRolesConnected(t) || GT.settings.BirdWatch.autoRig === false) return;
  const canTx = rigTuneCanTx(t) && t.uplink_low > 0;
  // The downlink only with a downlink VFO (none: not followed)
  const canRx = rigRoleConnected("rx", t) && t.downlink_low > 0;
  let D = GT.rigDoppler && GT.rigDoppler.norad == T.selected && GT.rigDoppler.uuid == t.uuid ? GT.rigDoppler : null;
  const hasMode = !!(birdWatchRigMode(t) || birdWatchRigUpMode(t));
  let setMode = false;
  if (part == "name")
  {
    // All it can: the mode, RX and TX; again (all of them on), none
    const all = D && D.rx == canRx && D.tx == canTx && D.mode == hasMode;
    D = all ? null : { norad: T.selected, uuid: t.uuid, rx: canRx, tx: canTx, mode: hasMode };
    setMode = !!D && hasMode;
  }
  else if (part == "mode" && hasMode)
  {
    D = D ? Object.assign(D, { mode: !D.mode }) : { norad: T.selected, uuid: t.uuid, rx: false, tx: false, mode: true };
    setMode = D.mode;
  }
  else if (part == "rx" && canRx)
  {
    D = D ? Object.assign(D, { rx: !D.rx }) : { norad: T.selected, uuid: t.uuid, rx: true, tx: false, mode: false };
  }
  else if (part == "tx" && canTx)
  {
    D = D ? Object.assign(D, { tx: !D.tx }) : { norad: T.selected, uuid: t.uuid, rx: false, tx: true, mode: false };
  }
  else return;
  // The sides the user wants followed: the name all the transmitter has (one a rig can't take yet is followed once it can), a side's
  // own click that side as it is now
  if (D) D.wanted = part == "name" ? { rx: t.downlink_low > 0, tx: t.uplink_low > 0 } : Object.assign(D.wanted || { rx: false, tx: false }, part == "rx" ? { rx: D.rx } : part == "tx" ? { tx: D.tx } : {});
  const setTone = !!D && D.tx && (part == "name" || part == "tx");
  GT.rigDoppler = D && (D.rx || D.tx || D.mode) ? D : null;
  if (GT.rigDoppler)
  {
    birdWatchStickyRemember(GT.rigDoppler);
    birdWatchFollowEvent(GT.rigDoppler);
    // Set as clicked: the user's offsets start again
    GT.rigDoppler.sentRx = GT.rigDoppler.sentTx = null;
    GT.rigDoppler.offset = { rx: 0, tx: 0 };
    // The mode is set once (it doesn't move with the satellite), the mode cell's at once (birdWatchDopplerModes); RX and TX are followed
    birdWatchDopplerFollow(setMode ? (part == "mode" ? "now" : true) : false);
    if (setTone) rigTune({ tone: birdWatchTransmitterTone(t) || 0 });
  }
  birdWatchTransmitterWindowUpdate();
}

// The selected satellite's transmitter by its uuid (the transmitters window's row: by its uuid, not its place, as the table drawn for the
// map's tooltip makes GT.birdWatchTxList another satellite's), else null
function birdWatchPinTransmitter(uuid)
{
  const T = GT.birdWatchTrack;
  return T && T.selected ? birdWatchTransmitters(T.selected).find((t) => t.uuid == uuid) || null : null;
}

// A right-click on a transmitter's downlink or uplink in the transmitters window: what can be picked for that side, for the window's
// menu: { title, items: [{ id ("": Automatic, the first VFO that fits), label, checked, enabled }] }; null with nothing to pick (Rig Control off,
// or no such side)
function birdWatchPinChoices(uuid, side)
{
  const t = birdWatchPinTransmitter(uuid);
  if (!t || !(side == "rx" ? t.downlink_low > 0 : t.uplink_low > 0) || !GT.settings.Rigs.enable || GT.settings.BirdWatch.autoRig === false) return null;
  const pin = rigRolePin(t, side);
  // Automatic: the VFO it goes to without a pick of its own
  const auto = rigRoles(Object.assign({}, t, { uuid: null }));
  const items = [{ id: "", label: I18N("birdWatch.pin.auto").replace("{vfo}", rigVfoLabel(auto[side])), checked: !pin, enabled: true }];
  // (The uplink never on the downlink's own VFO: that one can't be picked for it)
  const down = side == "tx" ? rigRoleVfo("rx", t) : null;
  for (const v of rigVfos()) items.push({ id: v.id, label: rigVfoLabel(v), checked: pin == v.id, enabled: v !== down });
  return { title: I18N(side == "rx" ? "birdWatch.pin.rx.label" : "birdWatch.pin.tx.label"), items: items };
}

// A VFO picked for a transmitter's side ("" back to Automatic)
function birdWatchPinSet(uuid, side, id)
{
  const t = birdWatchPinTransmitter(uuid);
  if (t && (side == "rx" || side == "tx")) rigRolePinSet(t, side, id);
}

// ---- A satellite selected (by the user or by Auto-Track), the rig follows one of its transmitters, as a click on its name would. Always:
// the one last followed on this satellite, when there is one (settings.BirdWatch.stickyLast keeps it, whichever way it was picked).
// With Sticky Mode (BirdWatch settings, General) and the satellite Auto-Track's pick, the previous satellite's mode comes first (a click
// in the transmitters window always sets what was clicked): the first transmitter in the mode of the one
// followed before (one with an uplink, when that had one, in its uplink's mode first); then the one last followed on this satellite; then the first in the table

function birdWatchStickyRemember(D)
{
  GT.settings.BirdWatch.stickyLast[D.norad] = D.uuid;
}

// In the Event Viewer: the transmitter the rig follows from now on, and its sides followed (the satellite's own frequencies; "-" for a
// side not followed). Only when what is followed changes, never for the Doppler steps
function birdWatchFollowEvent(D)
{
  const t = birdWatchTransmitters(D.norad).find((x) => x.uuid == D.uuid);
  if (!t) return;
  const tle = birdWatchTleGet(D.norad);
  const name = tle ? tle.name : String(D.norad);
  // Each side's mode after it, where it is set (the rig's name for it: USB, LSB, FM ...)
  const side = (on, low, high, mode) => (on && low > 0 ? birdWatchFrequency(low, high, 1) + " MHz" + (D.mode && mode ? " " + mode : "") : "-");
  const text = I18N("birdWatch.event.following").replace("{sat}", () => name).replace("{tx}", () => t.description || "")
    .replace("{down}", () => side(D.rx, t.downlink_low, t.downlink_high, birdWatchRigMode(t))).replace("{up}", () => side(D.tx, t.uplink_low, t.uplink_high, birdWatchRigUpMode(t)));
  addEvent("birdwatch", "<font style='color:var(--gt-label)'>" + htmlEntities(text) + "</font>");
}

// The transmitter followed now, or null
function birdWatchStickyPrevious()
{
  const D = GT.rigDoppler;
  return D ? birdWatchTransmitters(D.norad).find((x) => x.uuid == D.uuid) || null : null;
}

// The transmitter to follow on a satellite, from the ones the Doppler table shows; null when it shows none
function birdWatchStickyPick(norad, previous, sticky = GT.settings.BirdWatch.sticky)
{
  const list = birdWatchTransmitters(norad).filter((t) => !(GT.settings.BirdWatch.hideNoUplink && !(t.uplink_low > 0)));
  if (list.length == 0) return null;
  if (sticky && previous)
  {
    const mode = String(previous.mode || "").toUpperCase();
    const same = list.filter((t) => String(t.mode || "").toUpperCase() == mode);
    const upMode = (t) => String(t.uplink_mode || t.mode || "").toUpperCase();
    const pick = (previous.uplink_low > 0 && (same.find((t) => t.uplink_low > 0 && upMode(t) == upMode(previous)) || same.find((t) => t.uplink_low > 0))) || same[0];
    if (pick) return pick;
  }
  const last = GT.settings.BirdWatch.stickyLast[norad];
  return list.find((t) => t.uuid == last) || list[0];
}

// The satellite following was last started for (with the rig connected): one selected before the rig was (at startup) is started
// once it is (birdWatchDopplerUpdate); one the user stopped following stays stopped
GT.birdWatchFollowTried = null;

function birdWatchStickyFollow(norad, previous, auto = false)
{
  // A rig connected at all (the transmitter's own VFOs are its own: rigRoles, a pick of its own included)
  if (!rigVfos().some(rigVfoReady)) return;
  // Followed while BirdWatch's Rig Control is on (BirdWatch settings, General), Auto-Track's pick or the user's; each side on its VFO
  // (None: not followed)
  const S = GT.settings.BirdWatch;
  if (S.autoRig === false)
  {
    GT.birdWatchFollowTried = norad;
    return;
  }
  const t = birdWatchStickyPick(norad, previous, auto && S.sticky);
  // No transmitter to follow yet (at startup the transmitters may not be read yet): tried again at the next update (birdWatchDopplerUpdate)
  if (!t) return;
  GT.birdWatchFollowTried = norad;
  // Its own VFOs (rigRoles)
  const sideA = !!rigRoleVfo("rx", t);
  const sideB = !!rigRoleVfo("tx", t);
  const rx = sideA && rigRoleConnected("rx", t) && t.downlink_low > 0;
  const canTx = sideB && rigTuneCanTx(t) && t.uplink_low > 0;
  const mode = !!((sideA && birdWatchRigMode(t)) || (sideB && birdWatchRigUpMode(t)));
  // The modes and the tone go with the first frequencies sent (the satellite's place may only come at the next tick)
  // Wanted: every side the transmitter has, one with no VFO yet followed once it has one (birdWatchRefollow: a VFO given a range for it)
  const D = { norad: norad, uuid: t.uuid, rx: rx, tx: canTx, mode: mode, sentRx: null, sentTx: null, pendingMode: mode, pendingTone: canTx ? birdWatchTransmitterTone(t) || 0 : undefined,
    wanted: { rx: t.downlink_low > 0, tx: t.uplink_low > 0 } };
  if (!(D.rx || D.tx || D.mode)) return;
  GT.rigDoppler = D;
  // No uplink sent: no tone left on from the last one (rig.js)
  if (!canTx) rigToneRelease();
  birdWatchStickyRemember(D);
  birdWatchFollowEvent(D);
  birdWatchDopplerFollow();
  birdWatchTransmitterWindowUpdate();
}

// Another satellite selected: the rig no longer follows the last one's transmitter
function birdWatchDopplerStopFollow()
{
  if (!GT.rigDoppler) return;
  GT.rigDoppler = null;
  // (split and the tone turned on for its uplink off again: rig.js)
  rigSplitRelease();
  rigToneRelease();
  birdWatchTransmitterWindowUpdate();
}

// The rig box's Follow / Unfollow (rigLineRender): unfollowed, the rig stays where it is and the satellite stays unfollowed until
// Follow, a click in the transmitters window or another satellite; Follow follows the transmitter last followed on it (birdWatchStickyPick)
function birdWatchFollowToggle()
{
  const T = GT.birdWatchTrack;
  if (GT.rigDoppler)
  {
    GT.rigDoppler = null;
    rigSplitRelease();
    rigToneRelease();
    GT.birdWatchFollowTried = T ? T.selected : null;
    birdWatchTransmitterWindowUpdate();
  }
  else if (T && T.selected) birdWatchStickyFollow(T.selected, null, false);
  rigLineRender();
}

// The rig box's Re-center: the user's tuning away from the Doppler frequency dropped on both sides, and each side set again where it
// belongs
function birdWatchRecenter()
{
  const D = GT.rigDoppler;
  if (!D) return;
  D.offset = { rx: 0, tx: 0 };
  D.sentRx = D.sentTx = null;
  D.base = {};
  D.farCount = {};
  birdWatchDopplerFollow();
  rigLineRender();
}

// ---- The user's own tuning, kept as the satellite moves: each side (rx the downlink's VFO, tx the uplink's) is read before it is set again. The first read
// after a setting is what the rig made of it (a tuning step may have rounded it: an FM step of 5 kHz), the baseline; a later read away
// from it is the user's tuning, added to the Doppler frequency from then on. Within the deadband it is noise; past the limit (or a first
// read that far from what was sent) it isn't fine tuning (the rig wouldn't take it, another band, the VFOs swapped) and the side is set
// again as it was. A new transmitter followed (or a click in the transmitters window) starts with no offset
const BIRD_WATCH_TUNE_DEADBAND_HZ = 25;
// The least a rig's own rounding of what it's sent is taken to be (birdWatchSideTarget's first read after a setting)
const BIRD_WATCH_ROUND_MIN_HZ = 100;
const BIRD_WATCH_TUNE_LIMIT_HZ = 50000;
// A side set waits for a read that reflects it, but no longer than this (a rig or server whose reads can't be told apart)
const BIRD_WATCH_READ_WAIT_MS = 3000;
// Read far from what was sent this many times in a row, and for this long: the side is no longer followed (a rig changing bands has
// the time it takes)
const BIRD_WATCH_FAR_STOP = 3;
const BIRD_WATCH_FAR_STOP_MS = 5000;
// Keyed by hand in split (birdWatchTxLook): an Icom, and others, read the TX VFO's frequency as the dial while transmitting. A side read
// within this of what the same rig's other VFO holds is taken as that: nothing sent to the rig, nothing counted against it, for up to
// this long (an over; a rig with no separate VFO for the uplink reads so for good: after it, the clash is handled as before)
const BIRD_WATCH_TX_LOOK_HZ = 3000;
const BIRD_WATCH_TX_HOLD_MS = 90000;
// Two clashes this far apart aren't one rig moving both sides: the first is forgotten
const BIRD_WATCH_CLASH_FORGET_MS = 60000;

// A side's rig (its VFO's, rigRoleVfo) and what its dial reads, as the satellite's frequency (less the VFO's converter offset); hz null
// when it can't be read; null without a VFO in use
function birdWatchSideRead(side)
{
  const v = rigRoleVfo(side);
  if (!v || !rigVfoOn(v)) return null;
  const read = rigVfoRead(v);
  if (!read.R) return null;
  return { R: read.R, hz: read.up ? read.dial - rigOffset(v) : null };
}

// What to send a side: its Doppler frequency plus the user's offset, the rig read first; null to wait for a read
function birdWatchSideTarget(D, side, doppler)
{
  D.offset = D.offset || { rx: 0, tx: 0 };
  D.sentSeq = D.sentSeq || {};
  D.sentAt = D.sentAt || {};
  D.base = D.base || {};
  D.farCount = D.farCount || {};
  const sentKey = side == "rx" ? "sentRx" : "sentTx";
  const sent = D[sentKey];
  // Nothing sent yet: set as it is
  if (sent === null || sent === undefined) return doppler + D.offset[side];
  const read = birdWatchSideRead(side);
  // A side that can't be read follows the Doppler frequency as it is
  if (!read || read.hz === null) return doppler + D.offset[side];
  const R = read.R;
  // The rig looks keyed in split (the other side's read, birdWatchSideFar): this side left as it is meanwhile too
  if (birdWatchTxHeld(D) && D.txHold.side != side) return null;
  const sentSeq = D.sentSeq[side] || 0;
  // Not read since it was set: waited for, but not without end (a rig whose reads can't be told apart)
  if (R.readSeq < sentSeq) return Date.now() - (D.sentAt[side] || 0) < BIRD_WATCH_READ_WAIT_MS ? null : doppler + D.offset[side];
  const base = D.base[side];
  // (A baseline read on another rig, the side's VFO being another rig's now, is none: each rig counts its own reads)
  if (!base || base.R !== R || base.seq < sentSeq)
  {
    // The first read since it was set: what the rig made of it, which later reads are measured from. Not set again before the next
    if (Math.abs(read.hz - sent) > BIRD_WATCH_TUNE_LIMIT_HZ) return birdWatchSideFar(D, side, read, sent);
    birdWatchSideGood(D, side, read);
    D.farCount[side] = 0;
    D.base[side] = { hz: read.hz, seq: R.readSeq, count: R.readCount, R: R };
    // A rig that says its tuning step (CI-V, rigctld) rounds what it's sent to it: read further from it than a step (BIRD_WATCH_ROUND_MIN_HZ
    // at least), the dial was turned between the setting and this read, and that's the user's tuning (sent again with it next time). A
    // rig that doesn't say: the whole difference is its rounding, as before
    const round = R.tuningStep > 0 ? Math.max(R.tuningStep, BIRD_WATCH_ROUND_MIN_HZ) : 0;
    const turned = read.hz - sent;
    if (round && Math.abs(turned) > round)
    {
      birdWatchUserTuned(D, side, turned);
      return doppler + D.offset[side];
    }
    return null;
  }
  // No newer read yet
  if (R.readCount <= base.count) return null;
  const moved = read.hz - base.hz;
  // The rig moved off by itself (another band, the VFOs swapped): not the user's tuning
  if (Math.abs(moved) > BIRD_WATCH_TUNE_LIMIT_HZ) return birdWatchSideFar(D, side, read, sent);
  birdWatchSideGood(D, side, read);
  if (Math.abs(moved) > BIRD_WATCH_TUNE_DEADBAND_HZ) birdWatchUserTuned(D, side, moved);
  D.base[side] = { hz: read.hz, seq: R.readSeq, count: R.readCount, R: R };
  return doppler + D.offset[side];
}

// A side tuned by the user (moved Hz): added to its offset, and noted for Lock VFOs (given to the other side once both are read:
// birdWatchDopplerFollow). Unless Lock VFOs gave this side the other's tuning a moment ago and the rig moved it by as much itself (a rig
// tracking its own VFOs, the IC-9700's satellite mode): counted already
function birdWatchUserTuned(D, side, moved)
{
  const expect = D.lockExpect;
  if (expect && expect.side == side && Date.now() < expect.until && Math.abs(moved - expect.hz) <= BIRD_WATCH_LOCK_MATCH_HZ)
  {
    D.lockExpect = null;
    return;
  }
  D.offset[side] += moved;
  if (D.movedNow) D.movedNow[side] = moved;
}

// A linear transponder: a downlink and an uplink that are ranges (a passband), not single frequencies
function birdWatchTransponder(t)
{
  return !!t && t.downlink_high > t.downlink_low && t.uplink_high > t.uplink_low;
}

// Lock VFOs (BirdWatch settings, General, and the BirdWatch panel's rig box): the user's tuning of one side (moved Hz) is given to the other
// side too, the same amount (a linear transponder's passband is as wide on its uplink as on its downlink, so the same spot of it moves by
// as much on both), the other way for an inverting transponder; both keep following the Doppler. Only for a transponder followed on both
// sides. Given only when one side alone moved this poll: a rig that tracks its own VFOs moved the other itself, and that move is its
// own tuning already (given to it again, the user's tuning would count twice). The other side's own move to match, read a poll later,
// is taken as this (D.lockExpect, for BIRD_WATCH_LOCK_EXPECT_MS)
const BIRD_WATCH_LOCK_EXPECT_MS = 3000;
const BIRD_WATCH_LOCK_MATCH_HZ = 50;
function birdWatchLockFollow(D, side, moved)
{
  if (GT.settings.BirdWatch.lockVfos !== true || !D.rx || !D.tx) return;
  const t = D.lockT;
  const tuning = D.tuning;
  if (!birdWatchTransponder(t) || !tuning || !(tuning.rx > 0 && tuning.tx > 0)) return;
  const other = side == "rx" ? "tx" : "rx";
  const hz = (t.invert ? -1 : 1) * moved;
  D.offset[other] += hz;
  D.lockExpect = { side: other, hz: hz, until: Date.now() + BIRD_WATCH_LOCK_EXPECT_MS };
}

// Lock VFOs turned on or off (from either checkbox)
function birdWatchLockVfosSet(on)
{
  GT.settings.BirdWatch.lockVfos = on === true;
  if (typeof birdWatchLockVfosValue != "undefined") birdWatchLockVfosValue.checked = GT.settings.BirdWatch.lockVfos;
  rigLineRender();
}

// A side read as expected: the rig isn't keyed in split (any hold that side's read began ends), and what its other VFO holds noted (the
// uplink set by hand when only the downlink is followed: birdWatchTxLook)
function birdWatchSideGood(D, side, read)
{
  if (D.txHold && D.txHold.side == side) D.txHold = null;
  const v = rigRoleVfo(side);
  D.secondDial = D.secondDial || {};
  if (v && !rigVfoIsSecond(v) && read.R.freqB > 0) D.secondDial[side] = { R: read.R, dial: read.R.freqB };
  // The downlink read where it was sent after the uplink was set on the same rig (both at once, or the uplink last): the rig keeps them
  // apart, a real split. Until then a downlink read on the uplink is that rig moving both with one dial (birdWatchSideFar's clash)
  const sentSeq = D.sentSeq || {};
  const txRead = side == "rx" && D.sentTx ? birdWatchSideRead("tx") : null;
  if (txRead && txRead.R === read.R && (sentSeq.tx || 0) >= (sentSeq.rx || 0) && read.R.readSeq >= (sentSeq.tx || 0)) D.splitProven = true;
}

// Whether a rig's PTT is read with its poll (rig.js rigPttWanted): the downlink's, while a transmitter of the selected satellite is followed
function birdWatchPttWanted(R)
{
  const D = GT.rigDoppler;
  const T = GT.birdWatchTrack;
  if (!D || !T || T.selected != D.norad || GT.settings.BirdWatch.autoRig === false) return false;
  const read = birdWatchSideRead("rx");
  return !!read && read.R === R;
}

// Whether the rig looks keyed in split, held for no longer than BIRD_WATCH_TX_HOLD_MS
function birdWatchTxHeld(D)
{
  return !!D.txHold && Date.now() - D.txHold.since < BIRD_WATCH_TX_HOLD_MS;
}

// A side read far from what was sent, on a frequency the same rig's other VFO holds: the rig keyed by hand in split, its dial reading the
// TX VFO meanwhile. "sent": what the other side was sent (taken as keyed only once the rig has shown a real split, D.splitProven; before
// that it's one dial moved by both: the clash); "seen": what that VFO read while all was well (the uplink set by hand, BirdWatch not
// sending one); else null
function birdWatchTxLook(D, side, read)
{
  const dial = read.hz + rigOffset(rigRoleVfo(side));
  const near = (hz) => hz > 0 && Math.abs(dial - hz) <= BIRD_WATCH_TX_LOOK_HZ;
  const other = side == "rx" ? "tx" : "rx";
  const otherSent = D[other == "rx" ? "sentRx" : "sentTx"];
  const otherRead = birdWatchSideRead(other);
  if (D[other] && otherSent && otherRead && otherRead.R === read.R && near(otherSent + rigOffset(rigRoleVfo(other)))) return "sent";
  const seen = D.secondDial && D.secondDial[side];
  return seen && seen.R === read.R && near(seen.dial) && !(D[other] && otherSent) ? "seen" : null;
}

// A side read far from what was sent: set again (said in the Event Viewer); a rig that stays there (it can't tune to the satellite's band)
// is let be, that side no longer followed. Null: nothing sent this tick. One that looks keyed in split (birdWatchTxLook) is left as it is
// meanwhile, nothing counted: nothing is sent to a transmitting rig
function birdWatchSideFar(D, side, read, sent)
{
  const look = birdWatchTxLook(D, side, read);
  if (look == "seen" || (look == "sent" && D.splitProven))
  {
    if (!D.txHold || D.txHold.side != side) D.txHold = { side: side, since: Date.now() };
    if (birdWatchTxHeld(D)) return null;
    // Still there after the hold: not an over. The one dial moved by both after all (the clash below, at once)
    if (look == "sent")
    {
      D.clash = Math.max(D.clash || 0, 1);
      D.clashAt = Date.now();
    }
  }
  // Both sides on one rig (the uplink on the downlink rig's second VFO), and this one reads what the other was sent: setting the uplink
  // moves the downlink (the rig, or what speaks for it, has no separate VFO for the uplink). Set again they would take turns without end:
  // the second time, the uplink is no longer followed and the downlink is set again
  const other = side == "rx" ? "tx" : "rx";
  const otherSent = D[other == "rx" ? "sentRx" : "sentTx"];
  const otherRead = birdWatchSideRead(other);
  const dial = (hz, s) => hz + rigOffset(rigRoleVfo(s));
  if (D[other] && otherSent && otherRead && otherRead.R === read.R && Math.abs(dial(read.hz, side) - dial(otherSent, other)) <= BIRD_WATCH_TUNE_LIMIT_HZ)
  {
    const now = Date.now();
    D.clash = now - (D.clashAt || 0) > BIRD_WATCH_CLASH_FORGET_MS ? 1 : (D.clash || 0) + 1;
    D.clashAt = now;
    if (D.clash >= 2)
    {
      D.tx = false;
      D.stoppedOn = D.stoppedOn || {};
      D.stoppedOn.tx = read.R.key + ":" + read.R.generation;
      D.sentRx = null;
      D.base = {};
      D.farCount = {};
      const up = side == "tx" ? sent : otherSent;
      addEvent("birdwatch", "<font style='color:var(--gt-warning)'>" + htmlEntities(I18N("birdWatch.event.vfoClash").replace("{up}", formatDialFreq(dial(up, "tx")))) + "</font>");
      birdWatchTransmitterWindowUpdate();
      return null;
    }
  }
  D.farCount[side] = (D.farCount[side] || 0) + 1;
  D.farSince = D.farSince || {};
  if (D.farCount[side] == 1) D.farSince[side] = Date.now();
  D.base[side] = null;
  if (D.farCount[side] >= BIRD_WATCH_FAR_STOP && Date.now() - D.farSince[side] >= BIRD_WATCH_FAR_STOP_MS)
  {
    D[side] = false;
    // Followed again once that rig is connected anew (birdWatchRefollow), not on this connection
    D.stoppedOn = D.stoppedOn || {};
    D.stoppedOn[side] = read.R.key + ":" + read.R.generation;
    const text = I18N("birdWatch.event.sideStopped").replace("{vfo}", rigVfoLabel(rigRoleVfo(side))).replace("{read}", formatDialFreq(read.hz)).replace("{sent}", formatDialFreq(sent));
    addEvent("birdwatch", "<font style='color:var(--gt-warning)'>" + htmlEntities(text) + "</font>");
    birdWatchTransmitterWindowUpdate();
    return null;
  }
  birdWatchFarReadEvent(D, side, read.hz, sent);
  // Sent again on the next tick, whatever the step
  D[side == "rx" ? "sentRx" : "sentTx"] = null;
  return null;
}

// In the Event Viewer: a side read far from what was sent (not taken as the user's tuning), at most every ten seconds a side
function birdWatchFarReadEvent(D, side, readHz, sentHz)
{
  D.farAt = D.farAt || {};
  const now = Date.now();
  if (now - (D.farAt[side] || 0) < 10000) return;
  D.farAt[side] = now;
  const text = I18N("birdWatch.event.farRead").replace("{vfo}", rigVfoLabel(rigRoleVfo(side))).replace("{read}", formatDialFreq(readHz)).replace("{sent}", formatDialFreq(sentHz));
  addEvent("birdwatch", "<font style='color:var(--gt-warning)'>" + htmlEntities(text) + "</font>");
}

// The rig set to the followed transmitter's sides, where the satellite is now, with the user's offsets: sent when a side moved 5 Hz or
// more. setModes: the downlink's mode and the uplink's (rigTune's txMode) set too, each one the rig has a name for, once its side's
// frequency is there ("now": at once; birdWatchDopplerModes)
function birdWatchDopplerFollow(setModes = false)
{
  const D = GT.rigDoppler;
  const T = GT.birdWatchTrack;
  if (!D || !T || T.selected != D.norad || !rigRolesConnected() || GT.settings.BirdWatch.autoRig === false) return;
  const sat = T.last.get(D.norad);
  const t = birdWatchTransmitters(D.norad).find((x) => x.uuid == D.uuid);
  if (!sat || sat.error || !t) return;
  const tuning = birdWatchTransmitterTuning(t, sat.doppler);
  // Its VFOs other ones than last time by themselves (a rig connected or let go: rigRoles takes a connected one first): sent again to
  // these, their modes with it
  const roles = rigRoles(t);
  const roleKey = (roles.rx ? roles.rx.id : "") + "|" + (roles.tx ? roles.tx.id : "");
  if (D.roleKey !== undefined && D.roleKey != roleKey)
  {
    D.sentRx = D.sentTx = null;
    if (D.mode) D.pendingMode = true;
    if (D.farCount) D.farCount = { rx: 0, tx: 0 };
  }
  D.roleKey = roleKey;
  // Lock VFOs reads the transmitter and both sides' frequencies (birdWatchLockFollow)
  D.lockT = t;
  D.tuning = tuning;
  // Modes still to be set (Sticky Mode's, a click's): each side's due until it is sent (birdWatchDopplerModes)
  if (setModes || D.pendingMode)
  {
    D.modesDue = { rx: !!birdWatchRigMode(t), tx: !!birdWatchRigUpMode(t), now: setModes == "now" };
    D.pendingMode = null;
  }
  if (!D.mode) D.modesDue = null;
  // The downlink's rig keyed (it says so: rigKeyed, CI-V's 1C 00): nothing read as tuning, nothing sent until it's unkeyed (keyed in
  // split, an Icom reads its TX frequency; a rig that can't say is left to birdWatchTxLook)
  const rxRead = birdWatchSideRead("rx");
  if (rxRead && rigKeyed(rxRead.R)) return;
  const spec = {};
  // The user's tuning read on each side this poll (birdWatchSideTarget), for Lock VFOs
  D.movedNow = {};
  for (const side of ["rx", "tx"])
  {
    if (!D[side] || !tuning[side] || (side == "tx" && !rigTuneCanTx())) continue;
    const target = birdWatchSideTarget(D, side, tuning[side]);
    const sent = D[side == "rx" ? "sentRx" : "sentTx"];
    if (target !== null && (sent === null || sent === undefined || Math.abs(target - sent) >= 5)) spec[side] = target;
  }
  // Lock VFOs: one side tuned, the other given it (sent with it now if it's being sent anyway: then it's set, nothing to expect of it)
  const movedSides = Object.keys(D.movedNow);
  if (movedSides.length == 1)
  {
    birdWatchLockFollow(D, movedSides[0], D.movedNow[movedSides[0]]);
    const other = movedSides[0] == "rx" ? "tx" : "rx";
    if (spec[other] && D.lockExpect && D.lockExpect.side == other)
    {
      spec[other] = tuning[other] + D.offset[other];
      D.lockExpect = null;
    }
  }
  // Keyed in split by hand (birdWatchSideFar): nothing at all sent until it isn't (its modes neither)
  if (birdWatchTxHeld(D)) return;
  const modes = birdWatchDopplerModes(D, t, tuning, spec);
  if (modes.rx) spec.mode = birdWatchRigMode(t);
  if (modes.tx) spec.txMode = birdWatchRigUpMode(t);
  if (!spec.rx && !spec.tx && !spec.mode && !spec.txMode) return;
  // Each side is read back here (birdWatchSideTarget), with its own warnings: not by rigTune too
  spec.verify = false;
  if (rigTune(spec))
  {
    const polled = new Set();
    for (const side of ["rx", "tx"])
    {
      // (a side whose rig wasn't sent anything, dropped meanwhile or the uplink blocked: as it was, sent again next time)
      if (!spec[side] || !(spec.sent && spec.sent[side])) continue;
      D[side == "rx" ? "sentRx" : "sentTx"] = spec[side];
      const read = birdWatchSideRead(side);
      D.sentSeq[side] = read ? read.R.tuneSeq : 0;
      D.sentAt[side] = Date.now();
      // Read again now, not at the next poll: what the rig made of it comes back in a moment (the baseline), so the next tick can set it again
      if (read && !polled.has(read.R))
      {
        polled.add(read.R);
        rigPollSoon(read.R);
      }
    }
    if (D.modesDue)
    {
      if (modes.rx && spec.sent && spec.sent.rx) D.modesDue.rx = false;
      if (modes.tx && spec.sent && spec.sent.tx) D.modesDue.tx = false;
    }
    if (D.pendingTone !== undefined)
    {
      rigTune({ tone: D.pendingTone });
      D.pendingTone = undefined;
    }
  }
}

// The sides whose mode is sent now ({ rx, tx }), of those due (D.modesDue). A side followed gets it once its frequency is there: its
// first read back near what was sent (its baseline, birdWatchSideTarget), or with its frequency when it can't be read. Sent with the
// frequency, a rig that can't tune there (an HF rig, a 70 cm downlink) would take the mode and stay in it. A side wanted but not
// followed (its rig not connected yet, or it wouldn't tune there) waits; one not wanted, or the mode cell clicked (due.now), gets it now
function birdWatchDopplerModes(D, t, tuning, spec)
{
  const out = { rx: false, tx: false };
  const due = D.modesDue;
  if (!due) return out;
  for (const side of ["rx", "tx"])
  {
    if (!due[side] || (side == "tx" && !rigTuneCanTx())) continue;
    const sentKey = side == "rx" ? "sentRx" : "sentTx";
    if (due.now) out[side] = true;
    else if (D[side] && tuning[side])
    {
      const read = birdWatchSideRead(side);
      const sent = D[sentKey];
      const base = D.base ? D.base[side] : null;
      if (!read || read.hz === null) out[side] = spec[side] > 0 || (sent !== null && sent !== undefined);
      else out[side] = sent !== null && sent !== undefined && !!base && base.R === read.R && base.seq >= ((D.sentSeq && D.sentSeq[side]) || 0);
    }
    else if (!(D.wanted && D.wanted[side])) out[side] = true;
  }
  return out;
}

// A side wanted followed but not (its rig wasn't connected, or it wouldn't tune there: birdWatchSideTarget) is followed again once its
// rig is connected, and for one that wouldn't, connected anew (another connection, or another rig); its offset starts again and its mode
// is set with it, and the uplink's CTCSS tone with the uplink (as when it is followed from the start)
function birdWatchRefollow()
{
  const D = GT.rigDoppler;
  if (!D || !D.wanted) return;
  let again = false;
  let uplink = false;
  for (const side of ["rx", "tx"])
  {
    if (!D.wanted[side] || D[side]) continue;
    const read = birdWatchSideRead(side);
    const R = read ? read.R : null;
    if (!R || R.status != "connected" || (side == "tx" && !rigTuneCanTx())) continue;
    if (D.stoppedOn && D.stoppedOn[side] == R.key + ":" + R.generation) continue;
    D[side] = true;
    if (D.stoppedOn) delete D.stoppedOn[side];
    if (D.farCount) D.farCount[side] = 0;
    if (D.offset) D.offset[side] = 0;
    D[side == "rx" ? "sentRx" : "sentTx"] = null;
    again = true;
    if (side == "tx") uplink = true;
  }
  if (!again) return;
  D.clash = 0;
  if (D.mode) D.pendingMode = true;
  const t = uplink ? birdWatchStickyPrevious() : null;
  if (t) D.pendingTone = birdWatchTransmitterTone(t) || 0;
  birdWatchFollowEvent(D);
  birdWatchTransmitterWindowUpdate();
}

// Each tracker tick: the transmitters window follows the satellite (and the hover tooltip, while one is under the mouse), and the rig the
// transmitter clicked
function birdWatchDopplerUpdate()
{
  const T = GT.birdWatchTrack;
  if (T && T.selected && !GT.rigDoppler && GT.birdWatchFollowTried != T.selected && rigVfos().some(rigVfoReady)) birdWatchStickyFollow(T.selected, null, T.selectedByAuto === true);
  birdWatchRefollow();
  birdWatchDopplerFollow();
  birdWatchTransmitterWindowUpdate();
  // The rig box's Follow / Unfollow follows what is followed now (a click in the transmitters window, another satellite)
  if (typeof birdWatchRigButtons != "undefined" && GT.settings.Rigs.enable && GT.settings.BirdWatch.autoRig !== false) birdWatchRigButtonsRender();
}
