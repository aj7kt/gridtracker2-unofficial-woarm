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

// The rig's mode for a transmitter's uplink (its own mode, else the downlink's); null for none or no uplink
function birdWatchRigUpMode(t)
{
  return t.uplink_low > 0 ? birdWatchRigMode({ mode: t.uplink_mode || t.mode }) : null;
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
  const cell = (text, color, right, title, part) => "<td style='color:" + color + (right ? ";text-align:right" : "") + "'" + (title ? " title='" + title + "'" : "") + partAttrs(part) + ">" + text + "</td>";
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
    const color = rigRolePin(current, side) ? "yellow" : "#888";
    // Its letter, as its name has it ("VFO-C (SDR)": C)
    const letter = rigVfoLabel(v).replace(/^VFO-/, "").charAt(0);
    return " <span style='color:" + color + ";font-size:10px'>" + letter + "</span>";
  };
  const vfoTitle = (title, side) =>
  {
    if (!rigOn) return title;
    const v = roles && roles[side];
    const text = I18N("birdWatch.pin.hover").replace("{vfo}", rigVfoLabel(v));
    return (title ? title + "\n" : "") + htmlEntities(text).replace(/'/g, "&#39;");
  };
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
    rows += "<tr data-tx='" + index + "' data-uuid='" + htmlEntities(String(t.uuid)).replace(/'/g, "&#39;") + "'" + (birdWatchAmateurTransmitter(t) ? "" : " style='opacity:0.6'") + ">" +
      "<td style='color:yellow' title='" + htmlEntities(about) + "'" + partAttrs("name") + ">" + htmlEntities(t.description) + "</td>" +
      // The downlink's mode, and the uplink's after it where it differs (an inverting transponder: USB / LSB), in the Uplink column's colour
      cell(htmlEntities(downMode) + (upMode ? " / <span style='color:orange'>" + htmlEntities(upMode) + "</span>" : "") + htmlEntities(t.baud > 0 ? " " + t.baud : ""), "lightgreen", false,
        upMode ? htmlEntities(I18N("birdWatch.doppler.modes.hover").replace("{down}", downMode).replace("{up}", upMode)).replace(/'/g, "&#39;") : null, birdWatchRigMode(t) || birdWatchRigUpMode(t) ? "mode" : null) +
      cell(tuned(tuning.rx, t.downlink_low, t.downlink_high) + (t.downlink_low > 0 ? vfoBadge("rx") : ""), "cyan", true,
        t.downlink_low > 0 ? vfoTitle(original(t.downlink_low, t.downlink_high), "rx") : "", t.downlink_low > 0 ? "rx" : null) +
      // The satellite hears the uplink shifted too, so it is sent that much the other way
      cell(tuned(tuning.tx, t.uplink_low, t.uplink_high) + (t.uplink_low > 0 ? vfoBadge("tx") : ""), "orange", true,
        t.uplink_low > 0 ? vfoTitle(original(t.uplink_low, t.uplink_high), "tx") : "", t.uplink_low > 0 ? "tx" : null) +
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
    // The mode is set once (it doesn't move with the satellite); RX and TX are followed
    birdWatchDopplerFollow(setMode);
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
  const side = (on, low, high) => (on && low > 0 ? birdWatchFrequency(low, high, 1) + " MHz" : "-");
  const text = I18N("birdWatch.event.following").replace("{sat}", () => name).replace("{tx}", () => t.description || "")
    .replace("{down}", () => side(D.rx, t.downlink_low, t.downlink_high)).replace("{up}", () => side(D.tx, t.uplink_low, t.uplink_high));
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
const BIRD_WATCH_TUNE_LIMIT_HZ = 50000;
// A side set waits for a read that reflects it, but no longer than this (a rig or server whose reads can't be told apart)
const BIRD_WATCH_READ_WAIT_MS = 3000;
// Read far from what was sent this many times in a row, and for this long: the side is no longer followed (a rig changing bands has
// the time it takes)
const BIRD_WATCH_FAR_STOP = 3;
const BIRD_WATCH_FAR_STOP_MS = 5000;

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
  const sentSeq = D.sentSeq[side] || 0;
  // Not read since it was set: waited for, but not without end (a rig whose reads can't be told apart)
  if (R.readSeq < sentSeq) return Date.now() - (D.sentAt[side] || 0) < BIRD_WATCH_READ_WAIT_MS ? null : doppler + D.offset[side];
  const base = D.base[side];
  // (A baseline read on another rig, the side's VFO being another rig's now, is none: each rig counts its own reads)
  if (!base || base.R !== R || base.seq < sentSeq)
  {
    // The first read since it was set: what the rig made of it, which later reads are measured from. Not set again before the next
    if (Math.abs(read.hz - sent) > BIRD_WATCH_TUNE_LIMIT_HZ) return birdWatchSideFar(D, side, read, sent);
    D.farCount[side] = 0;
    D.base[side] = { hz: read.hz, seq: R.readSeq, count: R.readCount, R: R };
    return null;
  }
  // No newer read yet
  if (R.readCount <= base.count) return null;
  const moved = read.hz - base.hz;
  // The rig moved off by itself (another band, the VFOs swapped): not the user's tuning
  if (Math.abs(moved) > BIRD_WATCH_TUNE_LIMIT_HZ) return birdWatchSideFar(D, side, read, sent);
  if (Math.abs(moved) > BIRD_WATCH_TUNE_DEADBAND_HZ)
  {
    D.offset[side] += moved;
    birdWatchLockFollow(D, side, moved);
  }
  D.base[side] = { hz: read.hz, seq: R.readSeq, count: R.readCount, R: R };
  return doppler + D.offset[side];
}

// A linear transponder: a downlink and an uplink that are ranges (a passband), not single frequencies
function birdWatchTransponder(t)
{
  return !!t && t.downlink_high > t.downlink_low && t.uplink_high > t.uplink_low;
}

// Lock VFOs (BirdWatch settings, General, and the BirdWatch panel's rig box): the user's tuning of one side (moved Hz) is given to the other
// side too, the same amount (a linear transponder's passband is as wide on its uplink as on its downlink, so the same spot of it moves by
// as much on both), the other way for an inverting transponder; both keep following the Doppler. Only for a transponder followed on both
// sides
function birdWatchLockFollow(D, side, moved)
{
  if (GT.settings.BirdWatch.lockVfos !== true || !D.rx || !D.tx) return;
  const t = D.lockT;
  const tuning = D.tuning;
  if (!birdWatchTransponder(t) || !tuning || !(tuning.rx > 0 && tuning.tx > 0)) return;
  const other = side == "rx" ? "tx" : "rx";
  D.offset[other] += (t.invert ? -1 : 1) * moved;
}

// Lock VFOs turned on or off (from either checkbox)
function birdWatchLockVfosSet(on)
{
  GT.settings.BirdWatch.lockVfos = on === true;
  if (typeof birdWatchLockVfosValue != "undefined") birdWatchLockVfosValue.checked = GT.settings.BirdWatch.lockVfos;
  rigLineRender();
}

// A side read far from what was sent: set again (said in the Event Viewer); a rig that stays there (it can't tune to the satellite's band)
// is let be, that side no longer followed. Null: nothing sent this tick
function birdWatchSideFar(D, side, read, sent)
{
  // Both sides on one rig (the uplink on the downlink rig's second VFO), and this one reads what the other was sent: setting the uplink
  // moves the downlink (the rig, or what speaks for it, has no separate VFO for the uplink). Set again they would take turns without end:
  // the second time, the uplink is no longer followed and the downlink is set again
  const other = side == "rx" ? "tx" : "rx";
  const otherSent = D[other == "rx" ? "sentRx" : "sentTx"];
  const otherRead = birdWatchSideRead(other);
  const dial = (hz, s) => hz + rigOffset(rigRoleVfo(s));
  if (D[other] && otherSent && otherRead && otherRead.R === read.R && Math.abs(dial(read.hz, side) - dial(otherSent, other)) <= BIRD_WATCH_TUNE_LIMIT_HZ)
  {
    D.clash = (D.clash || 0) + 1;
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
// more. setModes: the downlink's mode and the uplink's (rigTune's txMode) set too, each one the rig has a name for
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
  // Modes still to be set (Sticky Mode's) go with these frequencies
  const spec = setModes || D.pendingMode ? { mode: birdWatchRigMode(t), txMode: birdWatchRigUpMode(t) } : {};
  for (const side of ["rx", "tx"])
  {
    if (!D[side] || !tuning[side] || (side == "tx" && !rigTuneCanTx())) continue;
    const target = birdWatchSideTarget(D, side, tuning[side]);
    const sent = D[side == "rx" ? "sentRx" : "sentTx"];
    if (target !== null && (sent === null || sent === undefined || Math.abs(target - sent) >= 5)) spec[side] = target;
  }
  if (!spec.rx && !spec.tx && !spec.mode && !spec.txMode) return;
  // Each side is read back here (birdWatchSideTarget), with its own warnings: not by rigTune too
  spec.verify = false;
  if (rigTune(spec))
  {
    const polled = new Set();
    for (const side of ["rx", "tx"])
    {
      if (!spec[side]) continue;
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
    D.pendingMode = null;
    if (D.pendingTone !== undefined)
    {
      rigTune({ tone: D.pendingTone });
      D.pendingTone = undefined;
    }
  }
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
