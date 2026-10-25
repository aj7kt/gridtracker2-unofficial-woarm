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

// The active transmitters of a satellite: the amateur ones first, two-way ones before beacons
function birdWatchTransmitters(norad)
{
  try
  {
    const file = path.join(satDir(), "transmitters.json");
    const stat = fs.statSync(file);
    const stamp = stat.mtimeMs + ":" + stat.size;
    if (stamp != birdWatchTransmitterStamp)
    {
      const map = new Map();
      for (const t of JSON.parse(fs.readFileSync(file, "utf8")))
      {
        if (t.status != "active" || !t.alive || !(t.downlink_low > 0 || t.uplink_low > 0)) continue;
        const list = map.get(t.norad_cat_id) || [];
        list.push(t);
        map.set(t.norad_cat_id, list);
      }
      birdWatchTransmitterMap = map;
      birdWatchTransmitterStamp = stamp;
    }
  }
  catch (e)
  {
    return [];
  }
  const rank = (t) => (birdWatchAmateurTransmitter(t) ? 0 : 10) + (t.uplink_low > 0 ? 0 : 1);
  return (birdWatchTransmitterMap.get(Number(norad)) || []).slice().sort((a, b) => rank(a) - rank(b));
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

// A frequency in MHz as a rig's dial shows it (formatDialFreq); a range as low - high
function birdWatchFrequency(low, high, factor)
{
  if (!(low > 0)) return "";
  const one = (hz) => formatDialFreq(hz * factor);
  return high > low ? one(low) + " - " + one(high) : one(low);
}

// The rig's mode for a transmitter: FM for the FM voice and packet ones, USB for the PSK data ones, SSB / CW / AM as they are; null for a
// mode the rig has no name for (none is set then)
function birdWatchRigMode(t)
{
  const mode = String(t.mode || "").toUpperCase();
  if (/^(LSB|USB|CW|AM|FM)$/.test(mode)) return mode;
  if (/SSB/.test(mode)) return "USB";
  if (/FM|AFSK|FSK|SSTV|DUV|GMSK|APRS|GFSK|MSK/.test(mode)) return "FM";
  if (/PSK|QPSK|OFDM/.test(mode)) return "USB";
  if (/CW/.test(mode)) return "CW";
  return null;
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

// The transmitters of the table as it was last drawn (in its order: a click in the window names one by its place)
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
  const cell = (text, color, right, title, part) => "<td style='color:" + color + (right ? ";text-align:right" : "") + "'" + (title ? " title='" + title + "'" : "") + partAttrs(part) + ">" + text + "</td>";
  // With Rig Control connected the name, mode, downlink and uplink cells tune the rig (a click in the window), and the mode, downlink and uplink the rig was set to are marked
  const D = GT.rigDoppler && GT.rigDoppler.norad == Number(norad) ? GT.rigDoppler : null;
  const clickable = GT.rig && GT.rig.status == "connected";
  let current = null;
  const partAttrs = (part) =>
  {
    if (!part) return "";
    const followed = D && current && D.uuid == current.uuid && part != "name" && D[part];
    return " data-part='" + part + "' class='" + (clickable ? "birdTxClick" : "") + (followed ? " birdTxFollow" : "") + "'";
  };
  GT.birdWatchTxList = [];
  const original = (low, high) => (low > 0 ? I18N("birdWatch.doppler.original").replace("{f}", birdWatchFrequency(low, high, 1) + " MHz") : "");
  // The one frequency the rig is tuned to (birdWatchTransmitterTuning: a range's middle, shifted), as the tracking programs show it; a
  // range's half width after it, in grey: 145.910.125 ±15 kHz
  const tuned = (hz, low, high) =>
  {
    if (!(hz > 0)) return "";
    const half = high > low ? (high - low) / 2000 : 0;
    return formatDialFreq(hz) + (half > 0 ? " <span style='color:#aaa'>±" + (Number.isInteger(half) ? half : half.toFixed(1)) + " kHz</span>" : "");
  };
  let rows = "";
  for (const t of birdWatchTransmitters(norad))
  {
    if (GT.settings.Birdwatch.hideNoUplink && !(t.uplink_low > 0)) continue;
    current = t;
    const index = GT.birdWatchTxList.push(t) - 1;
    let shift = "";
    if (factor !== null)
    {
      const hz = t.downlink_low > 0 ? t.downlink_low * (factor - 1) : t.uplink_low * (1 / factor - 1);
      shift = (hz >= 0 ? "+" : "") + (hz / 1000).toFixed(2) + " kHz";
    }
    const about = [t.description, t.type, t.service, t.invert ? "inverting" : ""].filter(Boolean).join("  ·  ");
    const tuning = birdWatchTransmitterTuning(t, factor === null ? 1 : factor);
    rows += "<tr data-tx='" + index + "'" + (birdWatchAmateurTransmitter(t) ? "" : " style='opacity:0.6'") + ">" +
      "<td style='color:yellow' title='" + htmlEntities(about) + "'" + partAttrs("name") + ">" + htmlEntities(t.description) + "</td>" +
      cell(htmlEntities(t.mode + (t.baud > 0 ? " " + t.baud : "")), "lightgreen", false, null, birdWatchRigMode(t) ? "mode" : null) +
      cell(tuned(tuning.rx, t.downlink_low, t.downlink_high), "cyan", true, original(t.downlink_low, t.downlink_high), t.downlink_low > 0 ? "rx" : null) +
      // The satellite hears the uplink shifted too, so it is sent that much the other way
      cell(tuned(tuning.tx, t.uplink_low, t.uplink_high), "orange", true, original(t.uplink_low, t.uplink_high), t.uplink_low > 0 ? "tx" : null) +
      cell(shift, "white", true) + "</tr>";
  }
  if (rows == "") rows = "<tr><td colspan='5' style='color:#aaa'>" + I18N("birdWatch.doppler.empty") + "</td></tr>";
  const heads = ["transmitter", "mode", "downlink", "uplink", "shift"].map((key) => "<th>" + I18N("birdWatch.doppler." + key + ".label") + "</th>").join("");
  return "<table id='tooltipTable' class='darkTable birdDopplerTable' style='text-align:left'><tr>" + heads + "</tr>" + rows + "</table>";
}

// The hover tooltip: the satellite's name over its table
function birdWatchTransmitterHtml(norad)
{
  const tle = birdWatchTleGet(norad);
  return "<div style='color:cyan;font-weight:bold;text-align:center;padding:2px 0'>" + htmlEntities(tle ? tle.name : String(norad)) + "</div>" + birdWatchTransmitterTableHtml(norad);
}

// The Doppler button (BirdWatch panel) opens the transmitters window of the selected satellite: greyed out while none is selected
function birdWatchDopplerButtonUpdate()
{
  const selected = GT.birdWatchTrack && GT.birdWatchTrack.selected;
  birdWatchDopplerImg.style.filter = selected ? "" : "grayscale(1)";
  birdWatchDopplerButton.style.opacity = selected ? "" : "0.5";
  birdWatchDopplerButton.style.cursor = selected ? "" : "default";
}

function birdWatchDopplerPressed()
{
  if (GT.birdWatchTrack && GT.birdWatchTrack.selected) birdWatchTransmitterWindowOpen();
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
      birdWatchTransmitterWindowUpdate(true, true);
      GT.birdWatchTxEverShown = true;
      electron.ipcRenderer.send("showWin", "gt_transmitters");
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
  birdWatchTransmitterWindowUpdate(true, true);
  GT.birdWatchTxEverShown = true;
  electron.ipcRenderer.send("showWin", "gt_transmitters");
}

// Each tracker tick (and when a setting of the table changes): the selected satellite's name and its transmitters in the window. Its width
// follows the table's whenever that changes (another satellite, other transmitters, longer numbers); its height is the user's. Not before it
// has been shown (it is made hidden at startup), unless it is about to be (showing)
function birdWatchTransmitterWindowUpdate(fit = false, showing = false)
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
    if (target.innerHTML != html) target.innerHTML = html;
    doc.getElementById("birdTxName").textContent = tle ? tle.name : "";
    doc.getElementById("birdTxHead").style.display = norad ? "" : "none";
    doc.getElementById("birdTxFollowing").textContent = GT.rigDoppler && GT.rigDoppler.norad == norad ? I18N("rig.following") : "";
    doc.title = I18N("birdWatch.doppler.label") + (tle ? " - " + tle.name : "");
    // Shown, or another satellite: the height too, to the table's (no taller than the screen); in between it is the user's, who can make it
    // smaller and have the table scroll
    const fitHeight = fit || norad != GT.birdWatchTxShown;
    GT.birdWatchTxShown = norad;
    const box = doc.getElementById("birdTxWrap").getBoundingClientRect();
    const win = handle.window;
    // The table's width, the page's margins and a vertical scroll bar's room, plus the window's frame. resizeBy, not resizeTo: the
    // size read from the window can lag behind, and only the change asked for is made. No bigger than fits from where the window is to
    // the screen's right and bottom edges: a window resized past them is moved back onto the screen, and it only moves when the user moves it
    const screen = win.screen;
    const roomWidth = (screen.availLeft || 0) + screen.availWidth - win.screenX;
    const roomHeight = (screen.availTop || 0) + screen.availHeight - win.screenY;
    const width = Math.min(Math.ceil(box.width) + 28 + (win.outerWidth - win.innerWidth), Math.max(roomWidth, win.outerWidth));
    const height = Math.min(Math.ceil(box.height) + 16 + (win.outerHeight - win.innerHeight), Math.max(roomHeight, win.outerHeight));
    const dw = Math.abs(win.outerWidth - width) > 2 ? width - win.outerWidth : 0;
    const dh = fitHeight && Math.abs(win.outerHeight - height) > 2 ? height - win.outerHeight : 0;
    if (dw || dh) win.resizeBy(dw, dh);
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
function birdWatchDopplerClick(index, part)
{
  const T = GT.birdWatchTrack;
  const t = GT.birdWatchTxList[index];
  if (!t || !T || !T.selected || GT.rig.status != "connected") return;
  const canTx = rigTuneCanTx() && t.uplink_low > 0;
  let D = GT.rigDoppler && GT.rigDoppler.norad == T.selected && GT.rigDoppler.uuid == t.uuid ? GT.rigDoppler : null;
  const hasMode = !!birdWatchRigMode(t);
  let setMode = false;
  if (part == "name")
  {
    // All it can: the mode, RX and TX; again (all of them on), none
    const all = D && D.rx == (t.downlink_low > 0) && D.tx == canTx && D.mode == hasMode;
    D = all ? null : { norad: T.selected, uuid: t.uuid, rx: t.downlink_low > 0, tx: canTx, mode: hasMode };
    setMode = !!D && hasMode;
  }
  else if (part == "mode" && hasMode)
  {
    D = D ? Object.assign(D, { mode: !D.mode }) : { norad: T.selected, uuid: t.uuid, rx: false, tx: false, mode: true };
    setMode = D.mode;
  }
  else if (part == "rx" && t.downlink_low > 0)
  {
    D = D ? Object.assign(D, { rx: !D.rx }) : { norad: T.selected, uuid: t.uuid, rx: true, tx: false, mode: false };
  }
  else if (part == "tx" && canTx)
  {
    D = D ? Object.assign(D, { tx: !D.tx }) : { norad: T.selected, uuid: t.uuid, rx: false, tx: true, mode: false };
  }
  else return;
  const setTone = !!D && D.tx && (part == "name" || part == "tx");
  GT.rigDoppler = D && (D.rx || D.tx || D.mode) ? D : null;
  if (GT.rigDoppler)
  {
    birdWatchStickyRemember(GT.rigDoppler);
    GT.rigDoppler.sentRx = GT.rigDoppler.sentTx = null;
    // The mode is set once (it doesn't move with the satellite); RX and TX are followed
    birdWatchDopplerFollow(setMode ? birdWatchRigMode(t) : null);
    if (setTone) rigTune({ tone: birdWatchTransmitterTone(t) || 0 });
  }
  birdWatchTransmitterWindowUpdate();
}

// ---- A satellite selected (by the user or by Auto-Track), the rig follows one of its transmitters, as a click on its name would. Always:
// the one last followed on this satellite, when there is one (settings.Birdwatch.stickyLast keeps it, whichever way it was picked).
// With Sticky Mode (BirdWatch settings, General) the previous satellite's mode comes first: the first transmitter in the mode of the one
// followed before (one with an uplink, when that had one); then the one last followed on this satellite; then the first in the table

function birdWatchStickyRemember(D)
{
  GT.settings.Birdwatch.stickyLast[D.norad] = D.uuid;
}

// The transmitter followed now, or null
function birdWatchStickyPrevious()
{
  const D = GT.rigDoppler;
  return D ? birdWatchTransmitters(D.norad).find((x) => x.uuid == D.uuid) || null : null;
}

// The transmitter to follow on a satellite, from the ones the Doppler table shows; null for none (Sticky Mode off and none followed here yet)
function birdWatchStickyPick(norad, previous, sticky = GT.settings.Birdwatch.sticky)
{
  const list = birdWatchTransmitters(norad).filter((t) => !(GT.settings.Birdwatch.hideNoUplink && !(t.uplink_low > 0)));
  if (list.length == 0) return null;
  if (sticky && previous)
  {
    const mode = String(previous.mode || "").toUpperCase();
    const same = list.filter((t) => String(t.mode || "").toUpperCase() == mode);
    const pick = (previous.uplink_low > 0 && same.find((t) => t.uplink_low > 0)) || same[0];
    if (pick) return pick;
  }
  const last = GT.settings.Birdwatch.stickyLast[norad];
  return list.find((t) => t.uuid == last) || (sticky ? list[0] : null);
}

function birdWatchStickyFollow(norad, previous)
{
  if (GT.rig.status != "connected") return;
  const t = birdWatchStickyPick(norad, previous);
  if (!t) return;
  const canTx = rigTuneCanTx() && t.uplink_low > 0;
  const mode = birdWatchRigMode(t);
  // The mode and the tone go with the first frequencies sent (the satellite's place may only come at the next tick)
  const D = { norad: norad, uuid: t.uuid, rx: t.downlink_low > 0, tx: canTx, mode: !!mode, sentRx: null, sentTx: null, pendingMode: mode, pendingTone: canTx ? birdWatchTransmitterTone(t) || 0 : undefined };
  if (!(D.rx || D.tx || D.mode)) return;
  GT.rigDoppler = D;
  birdWatchStickyRemember(D);
  birdWatchDopplerFollow();
  birdWatchTransmitterWindowUpdate();
}

// Another satellite selected: the rig no longer follows the last one's transmitter
function birdWatchDopplerStopFollow()
{
  if (!GT.rigDoppler) return;
  GT.rigDoppler = null;
  birdWatchTransmitterWindowUpdate();
}

// The rig set to the followed transmitter's sides, where the satellite is now: sent when a side moved 5 Hz or more (a mode only with it;
// a second rig for VFO-B gets the uplink's mode, rigTune's txMode)
function birdWatchDopplerFollow(mode = null)
{
  const D = GT.rigDoppler;
  const T = GT.birdWatchTrack;
  if (!D || !T || T.selected != D.norad || GT.rig.status != "connected") return;
  const sat = T.last.get(D.norad);
  const t = birdWatchTransmitters(D.norad).find((x) => x.uuid == D.uuid);
  if (!sat || sat.error || !t) return;
  const tuning = birdWatchTransmitterTuning(t, sat.doppler);
  // A mode still to be set (Sticky Mode's) goes with these frequencies
  mode = mode || D.pendingMode || null;
  const spec = { mode: mode, txMode: mode && t.uplink_low > 0 ? birdWatchRigMode({ mode: t.uplink_mode || t.mode }) : null };
  if (D.rx && tuning.rx && (D.sentRx === null || D.sentRx === undefined || Math.abs(tuning.rx - D.sentRx) >= 5)) spec.rx = tuning.rx;
  if (D.tx && tuning.tx && rigTuneCanTx() && (D.sentTx === null || D.sentTx === undefined || Math.abs(tuning.tx - D.sentTx) >= 5)) spec.tx = tuning.tx;
  if (!spec.rx && !spec.tx && !spec.mode) return;
  if (rigTune(spec))
  {
    if (spec.rx) D.sentRx = spec.rx;
    if (spec.tx) D.sentTx = spec.tx;
    D.pendingMode = null;
    if (D.pendingTone !== undefined)
    {
      rigTune({ tone: D.pendingTone });
      D.pendingTone = undefined;
    }
  }
}

// Each tracker tick: the transmitters window follows the satellite (and the hover tooltip, while one is under the mouse), and the rig the
// transmitter clicked
function birdWatchDopplerUpdate()
{
  birdWatchDopplerFollow();
  birdWatchTransmitterWindowUpdate();
}
