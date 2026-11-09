// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// BirdWatch: satellite tracking (Settings -> Features -> Online -> BirdWatch)

// Settings checkbox: shows or hides the button; its toggle (birdWatchActive) is left as it was
function changeBirdWatchEnable()
{
  GT.settings.BirdWatch.enable = birdWatchEnable.checked;
  updateBirdWatchViews();
}

// The main button panel's BirdWatch button shows while it's on, grey while its toggle is off. Offline Mode doesn't
// matter here: the shipped satellite data and the tracking work offline (only the data sync stops, birdWatchSync.js)
function updateBirdWatchViews()
{
  birdWatchEnable.checked = GT.settings.BirdWatch.enable;
  // The Satellite Tracking button and its row of Settings tabs; BirdWatch's own buttons after it only while its tracking is toggled on
  birdWatchButton.style.display = GT.settings.BirdWatch.enable ? "" : "none";
  for (const button of [birdWatchAutoButton, birdWatchDopplerButton, birdWatchTimelineButton]) button.style.display = birdWatchPanelShown() ? "" : "none";
  // (Its row also holds About when the main row is full: panel.js)
  settingsTabsFit();
  birdWatchImg.style.filter = GT.settings.BirdWatch.active ? "" : "grayscale(1)";
  birdWatchAutoImg.style.filter = GT.settings.BirdWatch.auto ? "" : "grayscale(1)";
  birdWatchDopplerButtonUpdate();

  // The SatNOGS data on disk follows BirdWatch being on (birdWatchSync.js)
  birdWatchSyncUpdate();
  birdWatchTleWatchUpdate();
  birdWatchTrackUpdate();
  if (!GT.settings.BirdWatch.enable) closeBirdWatchSettings();
  // Its tracking toggled off (or BirdWatch off): the pass timeline and the Doppler window go with its buttons (opened again from them)
  if (!birdWatchPanelShown())
  {
    birdWatchTimelineClose();
    if (GT.birdWatchTxWindowHandle) birdWatchTransmitterWindowOpen(false);
  }

  // Show or hide the BirdWatch panel (updateLayout places it), keeping the control panel as it is
  if (GT.map) updateLayout(GT.menuShowing == false);
}

// The Grayline (Toggle Grayline, Ctrl+N) is showing the night on the map
function birdWatchGraylineOn()
{
  try
  {
    return dayNight.isVisible();
  }
  catch (e)
  {
    return false;
  }
}

// The BirdWatch panel is in use while BirdWatch is enabled and toggled on;
// it may still be collapsed to its breadcrumb
function birdWatchPanelShown()
{
  return GT.settings.BirdWatch.enable && GT.settings.BirdWatch.active;
}

// The panel's BirdWatch button (false) and its breadcrumb (true), like the control panel's GridTracker2 button.
// Not saved: like the control panel, it opens again on the next start
function showBirdWatchPanel(show)
{
  GT.birdWatchPanelCollapsed = !show;
  updateLayout(GT.menuShowing == false);
}

// Called by updateLayout after the control panel's layout is applied: the BirdWatch panel goes on the other side
// (right when "Map on Right Side" puts the control panel on the left), only as tall as it needs to be, over the map's
// corner. The map is under it, so the map's controls (zoom and north at the left, full screen at the right) move clear of it
// (style.css, gtPanelLeft and gtPanelRight, set by applyMapPanelOverlays in ui.js) and so does the mouse-track readout. Collapsed, the panel leaves only its breadcrumb, placed like the control panel's would be on
// that side. Each panel's breadcrumb stays on its own side, so they never cover each other.
function applyBirdWatchLayout()
{
  const shown = birdWatchPanelShown();
  birdWatchBoxesInit();
  const collapsed = shown && GT.birdWatchPanelCollapsed == true;
  birdWatchDiv.style.display = (shown && !collapsed) ? "block" : "none";
  birdWatchChevronDiv.style.display = collapsed ? "block" : "none";
  if (!shown) return;

  const chevron = birdWatchChevronDiv.style;
  if (GT.settings.app.mapRight)
  {
    if (collapsed)
    {
      Object.assign(chevron, { right: "7px", top: "28px", left: "", width: "21px" });
      birdWatchChevronDiv.innerHTML = "◀☰";
      return;
    }
    birdWatchDiv.style.left = "";
    birdWatchDiv.style.right = "0";
  }
  else
  {
    if (collapsed)
    {
      Object.assign(chevron, { left: "6px", top: "67px", right: "", width: "23px" });
      birdWatchChevronDiv.innerHTML = "☰▶";
      return;
    }
    birdWatchDiv.style.left = "0";
    birdWatchDiv.style.right = "";
    mouseTrackDiv.style.left = "236px";
  }
}

// BirdWatch's settings are tabs of the main Settings, a row of their own in its colors (BirdWatch, Telemetry, Satellites), there while
// BirdWatch is on. The main Settings opened on one of them (the BirdWatch tab unless another is named)
function showBirdWatchSettings(tabName = "birdWatchGeneralDiv")
{
  closeEventViewer();
  helpDiv.style.display = "none";
  GT.helpShow = false;
  rootSettingsDiv.style.display = "inline-flex";
  openSettingsTab(document.querySelector(".birdWatchTab[data-tab='" + tabName + "']"), tabName);
}

// From openSettingsTab when one of BirdWatch's tabs is shown (and from showSettingsBox when the Settings open on one): its values
// filled in, after it is shown, so the lists draw the rows that fit their height
function birdWatchSettingsTabShown()
{
  birdWatchTleRender();
  birdWatchColorsRender();
  birdWatchSatsRender();
  birdWatchAlertsRender();
  birdWatchTabsFit();
}

// BirdWatch switched off: a BirdWatch tab that is showing makes way for General
function closeBirdWatchSettings()
{
  const active = document.querySelector(".settingstab .birdWatchTab.active");
  if (active) openSettingsTab(generalbut, "generalSettingsDiv");
}

// The tracker (birdWatchWorker.js) runs while the BirdWatch panel is in use. It follows the satellites in
// birdWatchTracked and draws them on the "birdWatch" map layer

function birdWatchTrackUpdate()
{
  const T = GT.birdWatchTrack || (GT.birdWatchTrack = { worker: null, markers: new Map(), rings: new Map(), last: new Map(), passes: new Map(), selected: null, hover: null });
  const want = birdWatchPanelShown() && GT.layerSources.birdWatch;
  if (!want)
  {
    if (T.worker)
    {
      T.worker.terminate();
      T.worker = null;
    }
    birdWatchPredictReset();
    T.markers.clear();
    T.rings.clear();
    T.last.clear();
    T.passes.clear();
    T.selected = null;
    T.hover = null;
    T.autoPick = null;
    birdWatchInfoDiv.style.display = "none";
    if (GT.layerSources.birdWatch) GT.layerSources.birdWatch.clear();
    return;
  }
  if (T.worker) return;

  T.worker = new Worker("./lib/services/birdWatch/birdWatchWorker.js");
  T.worker.onmessage = birdWatchWorkerMessage;
  if (!T.listening)
  {
    T.listening = true;
    birdWatchTleListen(birdWatchTrackSendTles);
  }
  birdWatchObserverSend();
  birdWatchTrackSendTles();
}

// The horizon seen from a height (meters above sea level), in degrees: below 0 by the dip, acos(R / (R + h)) (0.3° at 100 m, 1° at
// 1000 m); 0 at sea level or below
function birdWatchHorizonEl(meters)
{
  return meters > 0 ? -Math.acos(EARTH_RADIUS_KM / (EARTH_RADIUS_KM + meters / 1000)) * 180 / Math.PI : 0;
}

// The station to the tracker: its place, its height (Settings -> General -> Station -> Elevation) and the horizon from there, which a
// satellite is up above and rises and sets at. Again whenever one of them changes: the passes worked out from the old ones go
function birdWatchObserverSend()
{
  const T = GT.birdWatchTrack;
  if (!T || !T.worker) return;
  const meters = Number(GT.settings.app.myElevation) || 0;
  T.worker.postMessage({ type: "observer", lat: GT.myLat, lon: GT.myLon, alt: meters, minEl: birdWatchHorizonEl(meters) });
  T.passes.clear();
}

// The element sets in use go to the worker; it keeps what it tracks if they are still there
function birdWatchTrackSendTles()
{
  const worker = GT.birdWatchTrack.worker;
  if (!worker) return;
  worker.postMessage({ type: "tles", list: birdWatchTleList() });
  worker.postMessage({ type: "track", norad: GT.settings.BirdWatch.tracked });
  birdWatchPanelRefresh();
}

function birdWatchWorkerMessage(event)
{
  const m = event.data;
  const T = GT.birdWatchTrack;
  if (m.type == "positions")
  {
    const source = GT.layerSources.birdWatch;
    // The map was rebuilt (changing the projection makes new layers): the markers go onto the new one
    if (T.source !== source)
    {
      T.source = source;
      T.markers.clear();
      T.rings.clear();
      if (T.predict) { T.predict.features.clear(); T.predict.paths.clear(); }
      T.hover = null;
    }
    for (const sat of m.sats)
    {
      let marker = T.markers.get(sat.norad);
      if (sat.error)
      {
        if (marker) source.removeFeature(marker);
        T.markers.delete(sat.norad);
        continue;
      }
      if (!marker)
      {
        marker = new ol.Feature({ prop: "birdWatch", norad: sat.norad });
        birdWatchStyleMarker(marker, sat.norad == T.selected);
        source.addFeature(marker);
        T.markers.set(sat.norad, marker);
      }
      marker.setGeometry(new ol.geom.Point(ol.proj.fromLonLat([sat.lon, sat.lat], GT.settings.map.projection)));
      // In the Earth's shadow (no sunlight on its solar panels): the icon is drawn dim, while the Grayline is on
      const dim = !sat.sunlit && birdWatchGraylineOn();
      if (marker.dim !== dim)
      {
        marker.dim = dim;
        marker.baseStyle.getImage().setOpacity(dim ? 0.4 : 1);
        marker.changed();
      }
    }
    birdWatchPanelUpdate(m.sats);
  }
  else if (m.type == "passes")
  {
    birdWatchPanelPasses(m);
    birdWatchExportCollect(m);
  }
  else if (m.type == "path" || m.type == "arc") birdWatchPredictMessage(m);
  else if (m.type == "scan") birdWatchSatScanResult(m);
}

// Main button panel: "Toggle Satellite Tracking"; toggling it on opens the panel even if it was collapsed
function toggleBirdWatch()
{
  GT.settings.BirdWatch.active = !GT.settings.BirdWatch.active;
  if (GT.settings.BirdWatch.active)
  {
    GT.birdWatchPanelCollapsed = false;
  }
  updateBirdWatchViews();
}

// The map's distance scale, the attribution and the legend move clear of the panels over the map (the BirdWatch panel, and the
// control panel while Decode Traffic Waterfall is off and it is only as tall as it needs to be) when they would cover them (a
// tall panel in a short window): each is put aside by the panel's width when it overlaps one (style.css, gtPanelClearLeft and
// gtPanelClearRight). Run whenever a panel, the legend or the window changes size, and each tracker tick
function birdWatchClearControls()
{
  // The control panel is at the left with "Map on Right Side", the BirdWatch panel at the other side
  const left = GT.settings.app.mapRight;
  const panels = [[menuDiv, left ? "gtPanelClearLeft" : "gtPanelClearRight"], [birdWatchDiv, left ? "gtPanelClearRight" : "gtPanelClearLeft"]]
    .filter(([div]) => div.style.display != "none")
    .map(([div, side]) => [div.getBoundingClientRect(), side]);
  for (const el of [document.querySelector(".ol-scale-line"), document.querySelector(".ol-attribution"), legendDiv])
  {
    if (!el) continue;
    // Measured where it would be without being put aside
    el.classList.remove("gtPanelClearLeft", "gtPanelClearRight");
    const r = el.getBoundingClientRect();
    if (r.width == 0) continue;
    for (const [panel, side] of panels)
    {
      if (r.left < panel.right && r.right > panel.left && r.top < panel.bottom && r.bottom > panel.top) el.classList.add(side);
    }
  }
}

// BirdWatch's buttons are the main button panel's now (buttonPanel.js orders and drags them); the map's controls are kept clear of the
// panels as they change size
function birdWatchButtonsInit()
{
  const watcher = new ResizeObserver(birdWatchClearControls);
  watcher.observe(birdWatchDiv);
  watcher.observe(menuDiv);
  watcher.observe(legendDiv);
  window.addEventListener("resize", birdWatchClearControls);
}
