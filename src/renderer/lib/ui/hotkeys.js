// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// Keyboard: hotkey registration and handling (moved from GridTracker2.js)

function onMyKeyDown(event)
{
  if (event.keyCode == 27)
  {
    rootSettingsDiv.style.display = "none";
    closeEventViewer();
    birdWatchTimelineClose();
    helpDiv.style.display = "none";
    GT.helpShow = false;
    event.preventDefault();
  }

  if (spotsDiv.style.display !== "none")
  {
    let activeId = document.activeElement ? document.activeElement.id : "";
    if (activeId === "spotHistoryH" || activeId === "spotHistoryM")
    {
      if ((event.key >= '0' && event.key <= '9') || 
          ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(event.key)) 
      {
        return; 
      }
    }
  }

  if (rootSettingsDiv.style.display == "none")
  {
    const hotKey = hotKeyOf(event);
    if (hotKey)
    {
      if (hotKey.param1 != null)
      {
        let param2 = null;
        if (hotKey.param2 != null)
        {
          if (hotKey.param2 in event) { param2 = event[hotKey.param2]; }
        }
        hotKey.func(hotKey.param1, param2);
        event.preventDefault();
      }
      else
      {
        hotKey.func();
        event.preventDefault();
      }
    }
  }
}

// The hotkey a key press is (by its code, else its key): one held with its modifier (Ctrl+F12) before one without it (F12), so the two can
// be different hotkeys; one that needs a modifier not held isn't it
const HOTKEY_MODIFIERS = ["ctrlKey", "shiftKey", "altKey"];
function hotKeyOf(event)
{
  for (const key of [event.code, event.key])
  {
    for (const mod of HOTKEY_MODIFIERS)
    {
      if (event[mod] && hotKeyId(key, mod) in GT.hotKeys) return GT.hotKeys[hotKeyId(key, mod)];
    }
    if (key in GT.hotKeys) return GT.hotKeys[key];
  }
  return null;
}

// Where a hotkey is kept in GT.hotKeys: by its key, and one needing a modifier by both (so Ctrl+F12 doesn't take F12's place)
function hotKeyId(key, extKey)
{
  return extKey ? extKey + "+" + key : key;
}

function registerHotKey(name, key, func, param1 = null, param2 = null, extKey = null, descPrefix = null)
{
  const id = hotKeyId(key, extKey);
  GT.hotKeys[id] = {};
  GT.hotKeys[id].key = key;
  GT.hotKeys[id].name = name;
  GT.hotKeys[id].func = func;
  GT.hotKeys[id].param1 = param1;
  GT.hotKeys[id].param2 = param2;
  GT.hotKeys[id].extKey = extKey;
  GT.hotKeys[id].descPrefix = descPrefix;
}

function registerHotKeys()
{
  registerHotKey("Show Grid Map Layer", "1", setTrophyOverlay, 0);
  registerHotKey("Show CQ Zones Award Layer", "2", setTrophyOverlay, 1);
  registerHotKey("Show ITU Zones Award Layer", "3", setTrophyOverlay, 2);
  registerHotKey("Show WAC Award Layer", "4", setTrophyOverlay, 3);
  registerHotKey("Show WAS Award Layer", "5", setTrophyOverlay, 4);
  registerHotKey("Show DXCC Award Layer", "6", setTrophyOverlay, 5);
  registerHotKey("Show US Counties Award Layer", "7", setTrophyOverlay, 6);
  registerHotKey("Show US48 Grids Award Layer", "8", setTrophyOverlay, 7);
  registerHotKey("Show CA Provinces Award Layer", "9", setTrophyOverlay, 8);
  registerHotKey("Toggle US Radar Overlay", "0", toggleRadar);
  registerHotKey("Cycle Award Layers", "Equal", cycleTrophyOverlay);
  
  // KeyA reserved in first.js
  registerHotKey("Toggle All Grid Overlay", "KeyB", toggleAllGrids, null, null, "ctrlKey");
  // KeyC reserved in first.js
  registerHotKey("Toggle Moon Tracking", "KeyD", toggleMoon, null, null, "ctrlKey");
  registerHotKey("Open Conditions Windows", "KeyE", showConditionsWindow, null, null, "ctrlKey");
  registerHotKey("Open Call Roster Window", "KeyF", openCallRosterWindow, null, null, "ctrlKey");
  registerHotKey("Toggle GridTracker Users", "KeyG", toggleGtMap, null, null, "ctrlKey");
  registerHotKey("Toggle Timezone Overlay", "KeyH", toggleTimezones, null, null, "ctrlKey");
  registerHotKey("Open Statistics Window", "KeyI", showRootInfoBox, null, null, "ctrlKey");
  registerHotKey("Toggle Active Path Animation", "KeyJ", toggleAnimate, null, null, "ctrlKey");
  registerHotKey("Capture Window to Clipboard", "KeyK", captureScreenshot, null, null, "ctrlKey");
  registerHotKey("Open ADIF file", "KeyL", adifLoadDialog, null, null, "ctrlKey");
  registerHotKey("Toggle Audio Mute", "KeyM", toggleAlertMute, null, null, "ctrlKey");
  registerHotKey("Toggle Grayline", "KeyN", toggleEarth, null, null, "ctrlKey");
  registerHotKey("Cycle Spot View", "KeyO", cycleSpotsView, null, null, "ctrlKey");
  registerHotKey("Toggle Grid/PushPin Mode", "KeyP", togglePushPinMode, null, null, "ctrlKey");
  registerHotKey("Cycle Logbook/Live View", "KeyQ", cycleGridView, null, null, "ctrlKey");
  // KeyR reserved and broken
  registerHotKey("Open Settings", "KeyS", showSettingsBox, null, null, "ctrlKey");
  registerHotKey("Toggle RX Spots over Grids", "KeyT", toggleSpotOverGrids, null, null, "ctrlKey");
  registerHotKey("Toggle Award Layer Merge", "KeyU", toggleMergeOverlay, null, null, "ctrlKey");
  // KeyV reserved in first.js
  registerHotKey("Toggle AEQD Projection", "KeyW", changeMapProjection, null, null, "ctrlKey");
  registerHotKey("Toggle Map Position Info", "KeyX", toggleMouseTrack, null, null, "ctrlKey");
  registerHotKey("Toggle Offline Mode", "KeyY", toggleOffline, null, null, "ctrlKey");
  registerHotKey("Center Map on QTH Grid", "KeyZ", setCenterQTH, null, null, "ctrlKey");

  registerHotKey("Select Next Satellite", "]", birdWatchSelectStep, 1, null, "ctrlKey");
  registerHotKey("Select Previous Satellite", "[", birdWatchSelectStep, -1, null, "ctrlKey");
  registerHotKey("Toggle Auto Select Next AOS Satellite", "\\", birdWatchAutoToggle, null, null, "ctrlKey");
  registerHotKey("Toggle BirdWatch Panel", "F12", toggleBirdWatch, null, null, "ctrlKey");
  registerHotKey("Toggle Call Roster Scripts", "Minus", toggleCRScript, null, null, "shiftKey");
  registerHotKey("Map Memory 1", "F5", mapMemory, 0, "shiftKey", null, "Save");
  registerHotKey("Map Memory 2", "F6", mapMemory, 1, "shiftKey", null, "Save");
  registerHotKey("Map Memory 3", "F7", mapMemory, 2, "shiftKey", null, "Save");
  registerHotKey("Map Memory 4", "F8", mapMemory, 3, "shiftKey", null, "Save");
  registerHotKey("Map Memory 5", "F9", mapMemory, 4, "shiftKey", null, "Save");
  registerHotKey("Map Memory 6", "F10", mapMemory, 5, "shiftKey", null, "Save");
  registerHotKey("Toggle Fullscreen", "F11", toggleFullscreen);
  registerHotKey("Toggle Sidebar Panel", "F12", toggleMenu);
  registerHotKey("Hot Key List (This List)", "F1", toggleHelp);
  // With Log QSO on (Settings -> Logging): as its button in the button panel
  registerHotKey("Open Log QSO Window", "F2", logQsoButton, true);

  generatePrintTable();
}
