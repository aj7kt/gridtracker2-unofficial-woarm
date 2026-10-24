// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// BirdWatch: satellite tracking (Settings -> Features -> Online -> BirdWatch)

// Settings checkbox: shows or hides the button; its toggle (birdWatchActive) is left as it was
function changeBirdWatchEnable()
{
  GT.settings.birdWatch.enable = birdWatchEnable.checked;
  updateBirdWatchViews();
}

// The main button panel's BirdWatch button shows while it's on, grey while its toggle is off. Offline Mode doesn't
// matter here: the shipped satellite data and the tracking work offline (only the data sync stops, birdWatchSync.js)
function updateBirdWatchViews()
{
  birdWatchEnable.checked = GT.settings.birdWatch.enable;
  birdWatchButton.style.display = GT.settings.birdWatch.enable ? "" : "none";
  birdWatchImg.style.filter = GT.settings.birdWatch.active ? "" : "grayscale(1)";
  birdWatchAutoImg.style.filter = GT.settings.birdWatch.auto ? "" : "grayscale(1)";
  birdWatchDopplerButtonUpdate();

  // The SatNOGS data on disk follows BirdWatch being on (birdWatchSync.js)
  birdWatchSyncUpdate();
  birdWatchTleWatchUpdate();
  birdWatchTrackUpdate();
  if (!GT.settings.birdWatch.enable)
  {
    closeBirdWatchSettings();
    birdWatchTimelineClose();
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
  return GT.settings.birdWatch.enable && GT.settings.birdWatch.active;
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

// The BirdWatch panel's settings button opens the satellite settings window, like the main Settings window: its tabs,
// the X button and Esc close it. One of the two is open at a time
function showBirdWatchSettings()
{
  if (birdWatchSettingsDiv.style.display == "inline-flex")
  {
    closeBirdWatchSettings();
    return;
  }
  rootSettingsDiv.style.display = "none";
  helpDiv.style.display = "none";
  GT.helpShow = false;
  // The tab that was last shown (the main Settings hides every tab's content at startup, so show it again)
  const tab = birdWatchSettingsDiv.querySelector(".settingsTablinks.active") || birdWatchGeneralBut;
  openBirdWatchSettingsTab(tab, tab.dataset.tab);
  birdWatchTleRender();
  birdWatchColorsRender();
  birdWatchSettingsDiv.style.display = "inline-flex";
  // After it is shown: the lists draw the rows that fit their height
  birdWatchSatsRender();
  birdWatchAlertsRender();
}

function closeBirdWatchSettings()
{
  birdWatchSettingsDiv.style.display = "none";
}

function openBirdWatchSettingsTab(evt, tabName)
{
  for (const content of birdWatchSettingsDiv.getElementsByClassName("settingsTabcontent")) content.style.display = "none";
  for (const link of birdWatchSettingsDiv.getElementsByClassName("settingsTablinks")) link.classList.remove("active");
  document.getElementById(tabName).style.display = "block";
  (evt.currentTarget || evt).classList.add("active");
  birdWatchTabsFit();
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
  T.worker.postMessage({ type: "observer", lat: GT.myLat, lon: GT.myLon, alt: 0, minEl: 0 });
  birdWatchTrackSendTles();
}

// The element sets in use go to the worker; it keeps what it tracks if they are still there
function birdWatchTrackSendTles()
{
  const worker = GT.birdWatchTrack.worker;
  if (!worker) return;
  worker.postMessage({ type: "tles", list: birdWatchTleList() });
  worker.postMessage({ type: "track", norad: GT.settings.birdWatch.tracked });
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
  GT.settings.birdWatch.active = !GT.settings.birdWatch.active;
  if (GT.settings.birdWatch.active)
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

// The BirdWatch panel's buttons are dragged into the order wanted, like the control panel's (buttonPanel.js), and kept in
// birdWatch.buttonOrder; Reset Button Panel (BirdWatch settings, General) puts them back
function birdWatchButtonsInit()
{
  const buttons = birdWatchButtonsDiv.querySelectorAll(".iconButton");
  GT.birdWatchDefaultButtons = [...buttons].map((button) => button.id);
  for (const button of buttons)
  {
    button.draggable = true;
    button.addEventListener("dragstart", birdWatchButtonDragStart);
  }
  birdWatchButtonsDiv.addEventListener("dragover", (event) =>
  {
    if (event.dataTransfer.types.includes("birdwatchbutton")) event.preventDefault();
  });
  birdWatchButtonsDiv.addEventListener("drop", birdWatchButtonDrop);
  const watcher = new ResizeObserver(birdWatchClearControls);
  watcher.observe(birdWatchDiv);
  watcher.observe(menuDiv);
  watcher.observe(legendDiv);
  window.addEventListener("resize", birdWatchClearControls);

  // The saved order, less any button that is no more and with any new one at the end
  const order = GT.settings.birdWatch.buttonOrder.filter((id) => GT.birdWatchDefaultButtons.includes(id));
  for (const id of GT.birdWatchDefaultButtons) if (!order.includes(id)) order.push(id);
  birdWatchButtonsSet(order);
}

function birdWatchButtonsSet(order)
{
  const byId = new Map([...birdWatchButtonsDiv.querySelectorAll(".iconButton")].map((button) => [button.id, button]));
  for (const id of order) birdWatchButtonsDiv.appendChild(byId.get(id));
  GT.settings.birdWatch.buttonOrder = [...order];
}

function birdWatchButtonDragStart(event)
{
  event.dataTransfer.setData("BirdWatchButton", event.currentTarget.id);
  event.dataTransfer.effectAllowed = "move";
}

function birdWatchButtonDrop(event)
{
  const id = event.dataTransfer.getData("BirdWatchButton");
  if (!id) return;
  event.stopPropagation();
  event.preventDefault();
  const moving = document.getElementById(id);
  const target = event.target.closest(".iconButton");
  if (!moving || !target || target == moving) return;
  const buttons = [...birdWatchButtonsDiv.querySelectorAll(".iconButton")];
  // Dropped on a button further along it goes after it, dropped on one before it goes before it
  birdWatchButtonsDiv.insertBefore(moving, buttons.indexOf(moving) < buttons.indexOf(target) ? target.nextElementSibling : target);
  GT.settings.birdWatch.buttonOrder = [...birdWatchButtonsDiv.querySelectorAll(".iconButton")].map((button) => button.id);
}
