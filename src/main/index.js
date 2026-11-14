const {
  app,
  dialog,
  Notification,
  shell,
  BrowserWindow,
  ipcMain,
  Menu,
  screen,
  clipboard,
  nativeTheme,
} = require('electron');

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("enable-speech-dispatcher");

const fs = require('fs');
const timers = require('timers');
const remoteMain = require('@electron/remote/main');
const { autoUpdater } = require('electron-updater');
const { electronApp, optimizer } = require('@electron-toolkit/utils');
const path = require('path');
const { join } = require('path');
const log = require('electron-log');
const { inputLevel, inputLevelQuit, inputLevelFolder } = require('./inputLevel');
const { serialInit, serialCloseAll } = require('./serial');
const { clockAdjust } = require('./clockAdjust');
const isMac = process.platform === 'darwin';
const disableAutoUpdate = app.commandLine.hasSwitch("disable-auto-updates");

let gtName = "";

if (app.commandLine.hasSwitch("gt-name")) {
  let appInstance = app.getPath('userData');
  gtName = slugify(app.commandLine.getSwitchValue("gt-name"));
  if (gtName.length > 0 ) {
    app.setPath('userData', appInstance + " - " + gtName);
  }
  console.log("Running from: " + app.getPath('userData') + "\r\n");
}

const singleInstanceLock = app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  app.quit();
}

if (app.isPackaged) {
  if (process.platform.toLowerCase().indexOf("win") == 0 && !("ELECTRON_NO_ATTACH_CONSOLE" in process.env)) {
    console.log("To launch GridTracker2 from command line add the following before launching:");
    console.log("\r\nset ELECTRON_NO_ATTACH_CONSOLE=true\r\n");
  }
  console.log("GridTracker2 starting up!\r\n");
  // we send to the log file instead
  console.log = log.error;
  console.error = log.error;
}

// Needed for direct accsess to Menu and MenuItem
remoteMain.initialize();

const template = [
  ...(isMac
    ? [
        {
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide', label: 'Hide GridTracker2' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { click: function () { allowedWindows.GridTracker2.window.close(); }, label: 'Quit GridTracker2' },
          ],
        },
      ]
    : []),
  {
    label: 'File',
    submenu: [ { role: 'close' } ],
  },
  // include developer menu items if the app is not packaged
  ...(!app.isPackaged
    ? [
        {
          label: 'View',
          submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }],
        },
      ]
    : []),
  {
    label: 'Window',
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      ...(isMac
        ? [{ type: 'separator' }, { role: 'front' }, { type: 'separator' }, { role: 'window' }]
        : [{ role: 'close' }]),
    ],
  },
  // Add about menu on Windows
  ...(!isMac
    ? [
        {
          label: 'Help',
          submenu: [
            { role: 'about' },
          ],
        },
      ]
    : []),
];

const menu = Menu.buildFromTemplate(template);

if (isMac || !app.isPackaged) {
  Menu.setApplicationMenu(menu);
}
else {
  Menu.setApplicationMenu(null);
}

// Every window accounted for here
const allowedWindows = {
  GridTracker2: {
    window: null,
    honorVisibility: true,
    options: { x: 40, y: 40, width: 860, height: 652, show: true, zoom: 0 },
    static: {
      minWidth: 217,
      minHeight: 398,
      icon: join(__dirname, '../renderer/img/gt-icon.png'),
    },
  },
  gt_popup: {
    window: null,
    honorVisibility: false,
    options: { x: 45, y: 45, width: 200, height: 200, show: false, zoom: 0 },
    static: { minWidth: 100, minHeight: 50 },
  },
  gt_transmitters: {
    window: null,
    honorVisibility: true,
    options: { x: 60, y: 60, width: 640, height: 200, show: false, zoom: 0 },
    static: { minWidth: 200, minHeight: 60, icon: join(__dirname, '../renderer/img/sat-doppler.png') },
  },
  gt_events: {
    window: null,
    honorVisibility: true,
    options: { x: 70, y: 70, width: 620, height: 300, show: false, zoom: 0 },
    static: { minWidth: 240, minHeight: 80, icon: join(__dirname, '../renderer/img/events.png') },
  },
  gt_stats: {
    window: null,
    honorVisibility: true,
    options: { x: 55, y: 55, width: 640, height: 480, show: false, zoom: 0 },
    static: {
      minWidth: 620,
      minHeight: 200,
      icon: join(__dirname, '../renderer/img/stats-button.png'),
    },
  },
  gt_lookup: {
    window: null,
    honorVisibility: true,
    options: { x: 75, y: 75, width: 680, height: 420, show: false, zoom: 0 },
    static: {
      minWidth: 680,
      minHeight: 200,
      icon: join(__dirname, '../renderer/img/lookup-icon.png'),
    },
  },
  gt_bandactivity: {
    window: null,
    honorVisibility: true,
    options: { x: 250, y: 250, width: 198, height: 52, show: false, zoom: 0 },
    static: { minWidth: 198, minHeight: 52, frame: false, alwaysOnTop: true, skipTaskbar: true },
  },
  gt_alert: {
    window: null,
    honorVisibility: false,
    options: { x: 50, y: 50, width: 600, height: 52, show: false, zoom: 0 },
    static: { resizable: false, alwaysOnTop: true },
  },
  gt_conditions: {
    window: null,
    honorVisibility: true,
    options: { x: 75, y: 75, width: 492, height: 308, show: false, zoom: 0 },
    static: {
      minWidth: 492,
      minHeight: 308,
      icon: join(__dirname, '../renderer/img/conditions.png'),
    },
  },
  gt_roster: {
    window: null,
    honorVisibility: true,
    options: { x: 55, y: 55, width: 760, height: 400, show: false, zoom: 0 },
    static: {
      minWidth: 150,
      minHeight: 250,
      icon: join(__dirname, '../renderer/img/roster-icon.png'),
    },
  },
  gt_mmdecoder: {
    window: null,
    honorVisibility: true,
    options: { x: 80, y: 80, width: 720, height: 420, show: false, zoom: 0 },
    static: { minWidth: 300, minHeight: 200, icon: join(__dirname, '../renderer/img/mm-decoder.png') },
  },
  // Log QSO (Settings -> Logging, Log QSO): one QSO typed in, or filled in from the rig, a Feed Roster spot or the decoder
  gt_logqso: {
    window: null,
    honorVisibility: true,
    options: { x: 90, y: 90, width: 690, height: 431, show: false, zoom: 0 },
    static: { minWidth: 360, minHeight: 300, icon: join(__dirname, '../renderer/img/log-qso.png') },
  },
  // Its size and position are kept, but not whether it was showing
  gt_guide: {
    window: null,
    honorVisibility: false,
    options: { x: 80, y: 80, width: 900, height: 700, show: false, zoom: 0 },
    static: {
      minWidth: 400,
      minHeight: 300,
      icon: join(__dirname, '../renderer/img/help.png'),
    },
  },
};

const asarResourcesPath = join(__dirname, '../../resources');

const gtInternalPath = join(app.getPath('userData'), 'Ginternal');
inputLevelFolder(gtInternalPath);

if (!fs.existsSync(gtInternalPath)) {
  fs.mkdirSync(gtInternalPath);
}

const gtScreenshotPath = join(app.getPath('userData'), 'Screenshots');

if (!fs.existsSync(gtScreenshotPath)) {
  fs.mkdirSync(gtScreenshotPath);
}

// We will allow updating of this by the user, copy existing into Ginternal
let dxccInfoPath = join(gtInternalPath, 'dxcc-info.json');
let asarInfoPath = join(asarResourcesPath, 'data/dxcc-info.json');
if (!fs.existsSync(dxccInfoPath)) {
  fs.copyFileSync(
    asarInfoPath,
    dxccInfoPath,
    fs.constants.COPYFILE_EXCL,
  );
}
else {
  try {
    // Update gtInternal with newer version when found
    const asarInfo = require(asarInfoPath);
    const gtInternalInfo = require(dxccInfoPath);
    if ("version" in asarInfo["1"] && "version" in gtInternalInfo["1"] && parseInt(asarInfo["1"].version) > parseInt(gtInternalInfo["1"].version)) {
      fs.copyFileSync(
        asarInfoPath,
        dxccInfoPath,
      );
    }
  }
  catch (e)
  {
    console.log("Error checking dxcc-info files");
  }
}

// BirdWatch's satellite data (resources/data/sat, made by tools/sat_update.js) ships with the release, so a fresh
// install has it offline. The copy in Ginternal\sat is kept up to date by BirdWatch while online; like dxcc-info.json,
// the release's copy replaces it when that one is newer (version.json holds the date of each, as YYYYMMDD)
try {
  const asarSatPath = join(asarResourcesPath, 'data/sat');
  const gtSatPath = join(gtInternalPath, 'sat');
  const readVersion = (file) => {
    try { return parseInt(JSON.parse(fs.readFileSync(file, 'utf8')).version) || 0; }
    catch (e) { return 0; }
  };
  if (readVersion(join(asarSatPath, 'version.json')) > readVersion(join(gtSatPath, 'version.json'))) {
    fs.mkdirSync(gtSatPath, { recursive: true });
    // version.json last: until it's there, the copy is looked at again next time
    for (const file of fs.readdirSync(asarSatPath).filter((f) => f != 'version.json')) {
      fs.copyFileSync(join(asarSatPath, file), join(gtSatPath, file));
    }
    fs.copyFileSync(join(asarSatPath, 'version.json'), join(gtSatPath, 'version.json'));
  }
}
catch (e) {
  console.log("Error checking satellite data files");
}

const windowIdToAllowedWindows = {};
const windowSettingsPath = join(gtInternalPath, 'windows.json');

if (fs.existsSync(windowSettingsPath)) {
  try {
    const settings = require(windowSettingsPath);
    for (let windowName in settings) {
      if (windowName in allowedWindows) {
        allowedWindows[windowName].options = {
          ...allowedWindows[windowName].options,
          ...settings[windowName],
        };
      }
    }
  }
  catch (e)
  {
    log.error(e);
  }
}

let mainWindowClosing = false;

let mapKeys = {};

try {
  const mapKeysPath = path.join(__dirname, 'map_keys.json');
  if (fs.existsSync(mapKeysPath)) {
    mapKeys = JSON.parse(fs.readFileSync(mapKeysPath, 'utf8'));
  }
} catch (error) {
  console.error('Failed to load map keys', error);
}

ipcMain.on('getResourcesPath', (event) => {
  event.returnValue = asarResourcesPath;
});

ipcMain.on('getPath', (event, what) => {
  event.returnValue = app.getPath(what);
});

ipcMain.on('getAppName', (event) => {
  event.returnValue = gtName;
});

// Whether this is an installed copy (false: a dev run from the repo, where the MMD plugins load from plugins/mmd/ too)
ipcMain.on('isPackaged', (event) => {
  event.returnValue = app.isPackaged;
});

ipcMain.on('appVersion', (event) => {
  event.returnValue = app.getVersion();
});

// Saves text to a file the user picks (the SOTA chaser log export): { title, defaultPath, filters, content } ->
// the saved path, null if cancelled, or { error }
ipcMain.on('saveTextFile', (event, opts) => {
  let result = null;
  try {
    const o = opts || {};
    const parent = BrowserWindow.fromWebContents(event.sender);
    const savePath = dialog.showSaveDialogSync(parent, {
      title: o.title || "Save File",
      defaultPath: o.defaultPath || "export.txt",
      filters: o.filters || [{ name: "All Files", extensions: ["*"] }]
    });
    if (savePath) {
      fs.writeFileSync(savePath, String(o.content || ""));
      result = savePath;
    }
  } catch (e) {
    result = { error: e.message };
  }
  event.returnValue = result;
});

ipcMain.on('mapKeys', (event) => {
  event.returnValue = mapKeys;
});

ipcMain.on('updateAvailable', (event) => {
    checkForUpdates();
});

ipcMain.on('downloadUpdate', (event) => {
    downloadUpdate();
});


ipcMain.on('showWin', (event, what) => {
  if (allowedWindows[what]?.window) {
    allowedWindows[what].window.show();
    allowedWindows[what].options.show = true;
  }
});

// A window fitted to its content, in the page's CSS pixels (the zoom applied here): its width, and its height when given (else it keeps
// the user's), no bigger than fits from where it is to the screen's right and bottom edges (unless it already is); then shown, when asked.
// Done here, before showing, so it never shows at one size and then another
ipcMain.on('fitWin', (event, what, width, height, show) => {
  const win = allowedWindows[what]?.window;
  if (!win || win.isDestroyed()) return;
  const zoom = win.webContents.getZoomFactor() || 1;
  const content = win.getContentBounds();
  const area = screen.getDisplayMatching(win.getBounds()).workArea;
  const w = Math.min(Math.ceil(width * zoom), Math.max(area.x + area.width - content.x, content.width));
  const h = height ? Math.min(Math.ceil(height * zoom), Math.max(area.y + area.height - content.y, content.height)) : content.height;
  if (Math.abs(w - content.width) > 1 || Math.abs(h - content.height) > 1) win.setContentSize(w, h);
  if (show) {
    win.show();
    allowedWindows[what].options.show = true;
  }
});

ipcMain.on('hideWin', (event, what) => {
  if (allowedWindows[what]?.window) {
    allowedWindows[what].window.hide();
    allowedWindows[what].options.show = false;
  }
});

ipcMain.on('isWinVisible', (event, what) => {
  const win = allowedWindows[what]?.window;
  event.returnValue = !!(win && !win.isDestroyed() && win.isVisible());
});

ipcMain.on('toggleWin', (event, what) => {
  if (allowedWindows[what]?.window) {
    if (allowedWindows[what].window.isVisible()) {
      allowedWindows[what].window.hide();
      allowedWindows[what].options.show = false;
    } else {
      allowedWindows[what].window.show();
      allowedWindows[what].options.show = true;
    }
  }
});

ipcMain.on('focusWin', (event, what) => {
  if (allowedWindows[what]?.window) {
    allowedWindows[what].window.focus();
  }
});

async function screenshot(window) {
  await window.capturePage().then((image) => {
    clipboard.writeImage(image);
    let filename = path.join(gtScreenshotPath, "GT2 " + currentTimeStampString() + ".png");
    fs.writeFileSync(filename, image.toPNG());
  });
}

ipcMain.on('capturePageToClipboard', (event, what) => {
  if (allowedWindows[what]?.window) {
    screenshot(allowedWindows[what].window);
  }
});

// A window's picture (all of it, or the part rect gives: { x, y, width, height } in its own pixels) as a PNG data URL, "" when it can't be
// taken (the Multi-Mode Decoder's Send Picture: the map as the main window shows it)
ipcMain.handle('captureWindowImage', async (event, what, rect) => {
  const win = allowedWindows[what]?.window;
  if (!win) return "";
  try {
    const image = await (rect ? win.capturePage(rect) : win.capturePage());
    return image.isEmpty() ? "" : image.toDataURL();
  } catch (e) {
    return "";
  }
});

// Map Cast (mapCast.js): the main window captures itself (getDisplayMedia, answered with its own frame: setDisplayMediaRequestHandler
// below) and Element Capture cuts that to its map; only while it has asked for that here ('mapCastCaptureAllowed'), and for no other window
const mapCast = { captureAllowed: false, restoreSize: null };

function mapCastDisplayMedia(request, callback) {
  const win = allowedWindows['GridTracker2']?.window;
  const main = win?.webContents.mainFrame;
  if (mapCast.captureAllowed && main && request.frame && request.frame.processId == main.processId && request.frame.routingId == main.routingId) {
    mapCast.captureAllowed = false;
    callback({ video: request.frame });
  } else {
    callback({});
  }
}

ipcMain.on('mapCastCaptureAllowed', () => {
  mapCast.captureAllowed = true;
});

// The main window's content size as casting makes it: the nearest 16:9 (the TV's shape) that fits its screen, or with target (the
// video's size picked, in the screen's pixels: the software encoder's Software Resolution) that size, so the map is captured at it
// (the biggest 16:9 that fits the screen when it's bigger). As it is while maximized, full screen or snapped already (but for a target:
// Lock Window Size To 1080p ticked again while casting makes the window that size again; and reshape: resized by hand while casting, it
// goes to the nearest 16:9 again)
function mapCastSnapSize(win, target = null, reshape = false) {
  const [width, height] = win.getContentSize();
  if ((mapCast.restoreSize && !target && !reshape) || win.isMaximized() || win.isFullScreen()) return { width: width, height: height };
  const bounds = win.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const area = display.workArea;
  const maxWidth = area.width - (bounds.width - width);
  const maxHeight = area.height - (bounds.height - height);
  const byWidth = { width: width, height: Math.round((width * 9) / 16) };
  const byHeight = { width: Math.round((height * 16) / 9), height: height };
  let size = Math.abs(byWidth.height - height) <= Math.abs(byHeight.width - width) ? byWidth : byHeight;
  if (target && target.width > 0 && target.height > 0) {
    size = { width: Math.round(target.width / display.scaleFactor), height: Math.round(target.height / display.scaleFactor) };
  }
  if (size.width > maxWidth || size.height > maxHeight) {
    const scale = Math.min(maxWidth / size.width, maxHeight / size.height);
    size = { width: Math.floor(size.width * scale), height: Math.floor((size.width * scale * 9) / 16) };
  }
  return size;
}

// That size in the screen's pixels (the cast video's, before it's fitted into the largest the video is), null without the window
ipcMain.handle('mapCastSize', () => {
  const win = allowedWindows['GridTracker2']?.window;
  if (!win) return null;
  const size = mapCastSnapSize(win);
  const scale = screen.getDisplayMatching(win.getBounds()).scaleFactor;
  return { width: Math.round(size.width * scale), height: Math.round(size.height * scale) };
});

// The main window's content size now in the screen's pixels (Settings -> Features -> Casting, beside Enable Casting), null without it
ipcMain.handle('mapCastWindowSize', () => {
  const win = allowedWindows['GridTracker2']?.window;
  if (!win || win.isDestroyed()) return null;
  const [width, height] = win.getContentSize();
  const scale = screen.getDisplayMatching(win.getBounds()).scaleFactor;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
});

// While casting the main window's content is snapped to that size (target, reshape: mapCastSnapSize's), and the size it had after (not
// while maximized or full screen)
ipcMain.handle('mapCastSnap', (event, on, target = null, reshape = false) => {
  const win = allowedWindows['GridTracker2']?.window;
  if (!win || win.isMaximized() || win.isFullScreen()) return false;
  if (!on) {
    if (mapCast.restoreSize) win.setContentSize(mapCast.restoreSize[0], mapCast.restoreSize[1]);
    mapCast.restoreSize = null;
    return true;
  }
  const [width, height] = win.getContentSize();
  const size = mapCastSnapSize(win, target, reshape === true);
  const area = screen.getDisplayMatching(win.getBounds()).workArea;
  if (!mapCast.restoreSize) mapCast.restoreSize = [width, height];
  win.setContentSize(size.width, size.height);
  // Kept on its screen
  const moved = win.getBounds();
  const x = Math.max(area.x, Math.min(moved.x, area.x + area.width - moved.width));
  const y = Math.max(area.y, Math.min(moved.y, area.y + area.height - moved.height));
  if (x != moved.x || y != moved.y) win.setPosition(x, y);
  return true;
});

ipcMain.on('setAlwaysOnTop', (event, what, value) => {
  if (allowedWindows[what]?.window) {
    allowedWindows[what].window.setAlwaysOnTop(value);
  }
});

// A window's size fixed or not (the Log QSO card: fixed while its lock is shut)
ipcMain.on('setResizable', (event, what, value) => {
  const win = allowedWindows[what]?.window;
  if (win && !win.isDestroyed()) win.setResizable(!!value);
});

ipcMain.on('openFileFolder', (event, what, value) => {
  if (allowedWindows[what]?.window) {
    shell.openPath(value);
  }
});

ipcMain.on('saveZoom', (event, zoom) => {
  if (event.sender.id in windowIdToAllowedWindows) {
    allowedWindows[windowIdToAllowedWindows[event.sender.id]].options.zoom = zoom;
  }
});

ipcMain.on('setTheme', (event, theme) => {
  nativeTheme.themeSource = theme;
});

// The App Theme picked in Settings: every open window takes its colors at once (first.js applyAppTheme)
ipcMain.on('setAppTheme', (event, theme) => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('appTheme', theme);
  }
});

ipcMain.on('spawnScript', (event, scriptPath) => {
  try {
    const cp = require("child_process");
    let dirPath = path.dirname(scriptPath);
    let child = cp.spawn(`"${scriptPath}"`, [], {
      detached: true,
      cwd: dirPath,
      shell: true,
      stdio: ["ignore", "ignore", "ignore"]
    });
    child.unref();
  }
  catch (e) {
  }
});

let isShuttingDown = false; 

// A rig keyed here (the Multi-Mode Decoder's transmit: rig.js rigPtt) is unkeyed before GridTracker2 closes or restarts. The main window
// says whenever its rigs' keying changes (rigPttKeyed); while one is keyed, the main window's close, a restart and an update's install
// wait until it answers that the unkey has had the time to go out (rig.js rigPttUnkeyBeforeClose), but never longer than
// RIG_PTT_UNKEY_WAIT_MS. Nothing keyed: nothing waits
const RIG_PTT_UNKEY_WAIT_MS = 2000;
let rigPttKeyed = false;
// The ask under way: { waiting: what goes ahead on the answer, timer }. Once asked, GridTracker2 is closing: what the window says after
// isn't taken
let rigPttUnkeying = null;
let rigPttUnkeyAsked = false;

ipcMain.on('rigPttKeyed', (event, keyed) => {
  if (!rigPttUnkeyAsked) rigPttKeyed = keyed === true;
});

ipcMain.on('rigPttUnkeyed', () => {
  rigPttUnkeyDone();
});

// then() once the main window has unkeyed its rigs; at once with none keyed, or no main window to ask
function rigPttUnkeyThen(then) {
  if (rigPttUnkeying) {
    rigPttUnkeying.waiting.push(then);
    return;
  }
  if (!rigPttKeyed || !mainWindow || mainWindow.isDestroyed()) {
    rigPttKeyed = false;
    then();
    return;
  }
  rigPttUnkeyAsked = true;
  rigPttUnkeying = { waiting: [then], timer: timers.setTimeout(rigPttUnkeyDone, RIG_PTT_UNKEY_WAIT_MS) };
  mainWindow.webContents.send('rigPttUnkeyBeforeClose');
}

function rigPttUnkeyDone() {
  if (!rigPttUnkeying) return;
  const { waiting, timer } = rigPttUnkeying;
  rigPttUnkeying = null;
  rigPttKeyed = false;
  timers.clearTimeout(timer);
  for (const then of waiting) then();
}

// The main window's close, held while a rig is keyed (rigPttUnkeyThen) and made again once it has been unkeyed: true when held
function rigPttHoldClose(event, window) {
  if (!rigPttKeyed) return false;
  event.preventDefault();
  rigPttUnkeyThen(() => {
    if (!window.isDestroyed()) window.close();
  });
  return true;
}

// Map Cast: the DLNA players watching the map (Kodi, a smart TV) told to stop as GridTracker2 closes or restarts (mapCast.js mapCastClose),
// sent from here so they go out: the main window is gone before its own requests could. The exit waits for their answers, never longer
// than CAST_STOP_WAIT_MS. None watching: nothing waits
const CAST_STOP_WAIT_MS = 1500;
let castStopping = null;

ipcMain.on('mapCastStopDevices', (event, controls) => {
  event.returnValue = true;
  if (!Array.isArray(controls)) return;
  const sends = controls.filter((control) => typeof control == 'string' && /^http:\/\//i.test(control)).map(castStopSend);
  if (sends.length) castStopping = Promise.all(sends);
});

// A player's AVTransport (control: its address) told Stop; resolves when it answers, fails or takes too long
function castStopSend(control) {
  return new Promise((resolve) => {
    try {
      const url = new URL(control);
      const body = Buffer.from('<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:Stop xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID></u:Stop></s:Body></s:Envelope>', 'utf8');
      const request = require('http').request({ host: url.hostname, port: url.port || 80, path: url.pathname + url.search, method: 'POST', timeout: CAST_STOP_WAIT_MS, headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPACTION: '"urn:schemas-upnp-org:service:AVTransport:1#Stop"', 'Content-Length': body.length } }, (response) => {
        response.resume();
        response.on('end', resolve);
        response.on('error', resolve);
      });
      request.on('timeout', () => request.destroy());
      request.on('error', resolve);
      request.end(body);
    }
    catch (e) {
      resolve();
    }
  });
}

// then() once the players told to stop have answered (or CAST_STOP_WAIT_MS has passed); at once when none were
function castStopThen(then) {
  const pending = castStopping;
  castStopping = null;
  if (!pending) {
    then();
    return;
  }
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    then();
  };
  timers.setTimeout(finish, CAST_STOP_WAIT_MS);
  pending.then(finish, finish);
}

ipcMain.on('installAndRestart', (event, what) => {
    if (isShuttingDown) {
        event.returnValue = true;
        return; // Ignore duplicate clicks
    }
    isShuttingDown = true;

    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.autoRunAppAfterInstall = true;
    
    saveWindowPositions(); 
    
    event.returnValue = true;
    
    timers.setTimeout(() => {
        castStopThen(() => rigPttUnkeyThen(() => autoUpdater.quitAndInstall(true, true)));
    }, 100);
});

ipcMain.on('restartGridTracker2', (event, resetWindowPositions = false) => {
    if (isShuttingDown) {
        event.returnValue = true;
        return;
    }
    isShuttingDown = true;

    if (resetWindowPositions === true) {
        if (fs.existsSync(windowSettingsPath)) {
            fs.unlinkSync(windowSettingsPath);
        }
    } else {
        saveWindowPositions();
    }
  
    event.returnValue = true; 
  
    timers.setTimeout(() => {
        castStopThen(() => rigPttUnkeyThen(() => {
            app.relaunch();
            app.exit();
        }));
    }, 100);
});

ipcMain.on('log', (event, value) => {
  log.error(value);
});

// Serial ports (Web Serial, renderer/lib/services/serialPorts.js): the renderer picks from the list the browser offers, and the port each
// service (rotor, rig) keeps is granted again at each start (getPorts() finds it), matched by Chromium's identity for it: on Windows
// { device_instance_id, name }, elsewhere { vendor_id, product_id, serial_number, name } for a USB port, { name } alone otherwise. As
// the browser doesn't say which granted port is which, a service asks for its own alone (serialPortGrantOnly) while it looks
const serialPortsWanted = {};
let serialPortGrantOnly = null;

ipcMain.on('serialPortWanted', (event, purpose, wanted) => {
  serialPortsWanted[purpose] = wanted;
});

// An audio input's recording level, as the system sets it (inputLevel.js): the Multi-Mode Decoder's Input Device level
ipcMain.handle('inputLevel', (event, op, label, isDefault, level) => inputLevel(op, label, isDefault, level));

// The PC clock moved by this many seconds (clockAdjust.js), through the system's own administrator prompt: only when the Multi-Mode
// Decoder's WWV mode's Set PC Clock is clicked (and confirmed), never by itself
ipcMain.handle('clockAdjust', (event, seconds) => clockAdjust(seconds));

ipcMain.handle('serialPortGrantOnly', (event, purpose) => {
  serialPortGrantOnly = purpose;
});

function serialPortMatches(device) {
  if (!device) return false;
  for (const purpose in serialPortsWanted) {
    if (serialPortGrantOnly && purpose !== serialPortGrantOnly) continue;
    const want = serialPortsWanted[purpose];
    if (!want) continue;
    if (device.device_instance_id !== undefined) {
      if (want.deviceInstanceId && device.device_instance_id === want.deviceInstanceId) return true;
    } else if (device.serial_number !== undefined) {
      if (want.serialNumber && device.serial_number === want.serialNumber) return true;
    } else if (device.name && (device.name === want.displayName || device.name === want.portName)) {
      return true;
    }
  }
  return false;
}

// Serial ports through Node's serialport (serial.js), opened here for the page; Web Serial above is what the page uses where that isn't
// available (serialAvailable)
serialInit(ipcMain);

let mainWindow = null;
// frameName of the window being opened by setWindowOpenHandler, consumed in browser-window-created
let pendingWindowFrameName = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    //...allowedWindows['GridTracker2'].options,
    ...allowedWindows['GridTracker2'].static,
    tabbingIdentifier: 'GridTracker2',
    title: 'GridTracker2',
    show: false,
    backgroundColor: 'black',
    autoHideMenuBar: true,
    enableLargerThanScreen: true,
    acceptFirstMouse: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      backgroundThrottling: false,
      contextIsolation: false,
      nodeIntegration: true,
      nodeIntegrationInWorker: true,
      sandbox: false,
      devTools: !app.isPackaged,
    },
  });

  // Web Serial (Rotor Control, Rig Control): the port list goes to the renderer, which answers with the one picked (or nothing); the ports kept are
  // granted without asking. Permission checks are passed as they are without a handler
  const session = mainWindow.webContents.session;
  session.on('select-serial-port', (event, portList, webContents, callback) => {
    event.preventDefault();
    ipcMain.once('serialPortChosen', (reply, portId) => callback(portId || ''));
    webContents.send('serialPortList', portList.map((port) => ({ portId: port.portId, portName: port.portName, displayName: port.displayName || '', vendorId: port.vendorId || '', productId: port.productId || '', serialNumber: port.serialNumber || '', deviceInstanceId: port.deviceInstanceId || '' })));
  });
  session.setPermissionCheckHandler(() => true);
  session.setDevicePermissionHandler((details) => details.deviceType === 'serial' && serialPortMatches(details.device));
  session.setDisplayMediaRequestHandler(mapCastDisplayMedia);

  // Electron adds a 'current-render-view-deleted' listener here for each window opened from the main window (removed when it closes); more than
  // Node's default of 10 open together is normal, not a leak, so its MaxListenersExceededWarning is kept quiet
  mainWindow.webContents.setMaxListeners(30);

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (details.frameName == 'printHotKeys') {
      let options = {
        show: false,
        // for macOS
        tabbingIdentifier: details.frameName,
        // for Windows
        title: details.frameName,
        webPreferences: {
          autoHideMenuBar: true,
          devTools: !app.isPackaged,
        },
      };
      return { action: 'allow', overrideBrowserWindowOptions: options };
    } else if (details.frameName in allowedWindows) {
      let options = {
        //...allowedWindows[details.frameName].options,
        ...allowedWindows[details.frameName].static,
        autoHideMenuBar: true,
        backgroundColor: 'black',
        enableLargerThanScreen: true,
        acceptFirstMouse: true,
        show: false,
        // for macOS
        tabbingIdentifier: details.frameName,
        // for Windows
        title: details.frameName,
        webPreferences: {
          backgroundThrottling: false,
          contextIsolation: false,
          nodeIntegration: true,
          nodeIntegrationInWorker: true,
          preload: join(__dirname, '../preload/index.js'),
          sandbox: false,
          devTools: !app.isPackaged,
          // The User Guide window shows the PDF in a <webview>, so its search stays inside the guide
          webviewTag: details.frameName == 'gt_guide',
        },
      };

      pendingWindowFrameName = details.frameName;
      return { action: 'allow', overrideBrowserWindowOptions: options };
    } else {
      shell.openExternal(details.url);
      return { action: 'deny' };
    }
  });

  mainWindow.loadFile(join(__dirname, '../renderer/GridTracker2.html'));
}

// The User Guide window (gt_guide) shows the PDF in a <webview>: only a local PDF, with no Node access or preload;
// links clicked in it open in the browser, and Esc closes the window like its X, even while the PDF has the keyboard
function setupUserGuideWindow(window) {
  const escCloses = (inputEvent, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      window.close();
    }
  };
  window.webContents.on('before-input-event', escCloses);

  window.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    if (!/^file:.*\.pdf(#.*)?$/i.test(params.src)) {
      event.preventDefault();
      return;
    }
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.plugins = true;
  });

  window.webContents.on('did-attach-webview', (event, guest) => {
    guest.on('before-input-event', escCloses);
    guest.on('will-navigate', (navEvent, url) => {
      navEvent.preventDefault();
      if (/^(https?|mailto):/i.test(url)) {
        shell.openExternal(url);
      }
    });
    guest.setWindowOpenHandler((details) => {
      if (/^(https?|mailto):/i.test(details.url)) {
        shell.openExternal(details.url);
      }
      return { action: 'deny' };
    });
  });
}

let autoUpdateInitialized = false;
let autoUpdateTimer = null;

function checkForUpdates() {
  if (!autoUpdateInitialized) {
      if (process.env.DEBUG_AUTO_UPDATING === 'true') {
      const log = require('electron-log');

      log.transports.file.level = 'debug';

      autoUpdater.logger = log;
      autoUpdater.forceDevUpdateConfig = true;
    }

    if (disableAutoUpdate == true)
    {
      autoUpdater.autoDownload = false;
    }

    autoUpdater.on('update-available', notifyOnUpdate);
    autoUpdater.on('update-downloaded', updateDownloaded);

    autoUpdateInitialized = true;
  }

  try {
    if (disableAutoUpdate == true) {
      autoUpdater.checkForUpdates();
    }
    else {
      autoUpdater.checkForUpdatesAndNotify();
    }
  }
  catch (e) {
    log.error("Failed to update check");
    log.error(e.message);
  }

  if (autoUpdateTimer) timers.clearTimeout(autoUpdateTimer);
  autoUpdateTimer = timers.setTimeout(checkForUpdates, 86400000);
}

function downloadUpdate() {
  autoUpdater.autoDownload = true;
  autoUpdater.checkForUpdatesAndNotify();
}

function notifyOnUpdate(info) {
  if (mainWindow) {
    info.autoDownload = autoUpdater.autoDownload;
    mainWindow.webContents.send("versionInfo", info);
  }
}

function updateDownloaded(info) {
  if (mainWindow) {
    mainWindow.webContents.send("updateDownloaded", info);
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  // Unofficial WoARM build: its own id (electron-builder.github.yml's appId), so it doesn't share the official app's taskbar entry
  electronApp.setAppUserModelId('io.github.aj7kt.gridtracker2-woarm');
  app.setAppUserModelId('io.github.aj7kt.gridtracker2-woarm');

  dialog.showErrorBox = (title, content) => {
    log.error(`${title}\n${content}`);
  };


  app.on('browser-window-created', (_, window) => {
    // window.title works on Windows, window.tabbingIdentifier works on macOS,
    // except frameless windows (band activity) which get no tabbingIdentifier and an empty title,
    // so fall back to the frameName captured in setWindowOpenHandler
    const title = (isMac ? window.tabbingIdentifier : window.title) || pendingWindowFrameName;
    pendingWindowFrameName = null;

    if (title in allowedWindows) {
      // save the window handle (not the dom handle);
      allowedWindows[title].window = window;
      windowIdToAllowedWindows[window.id] = title;

      if (title == 'gt_guide') {
        setupUserGuideWindow(window);
      }

      // set up events here...
      window.on('ready-to-show', () => {
        // Options are being applied as bounds to the window, but if there is a scaleFactor
        // this call corrects the sizing
        let options = allowedWindows[windowIdToAllowedWindows[window.id]].options;
        allowedWindows[windowIdToAllowedWindows[window.id]].window.setContentBounds(
          options
        );

        // is the top left corner on screen?
        if (!(isWithinDisplayBounds(options.x + parseInt(options.width / 2), options.y + parseInt(options.height / 2)))) {
          options.x = 40;
          options.y = 40;
          allowedWindows[windowIdToAllowedWindows[window.id]].window.setContentBounds(
            options
          );
        }

        allowedWindows[windowIdToAllowedWindows[window.id]].placed = true;

        if (
          allowedWindows[windowIdToAllowedWindows[window.id]].honorVisibility == true &&
          options.show == true
        ) {
          window.show();
        }

        // Send this event to first.js, this windows zoom level
        allowedWindows[windowIdToAllowedWindows[window.id]].window.webContents.send(
          'loadZoom',
          options.zoom,
        );

        // The window is where it was saved, and shown if it was open at exit: a page that fills itself in once shown
        // (the Doppler and Event Viewer windows) is told
        allowedWindows[windowIdToAllowedWindows[window.id]].window.webContents.send(
          'windowPlaced',
          window.isVisible(),
        );

      });

      // Shown and hidden: told to the page (the Multi-Mode Decoder draws only while it shows). The Page Visibility API can't say it, as
      // backgroundThrottling is off
      window.on('show', () => {
        if (!window.isDestroyed()) window.webContents.send('windowVisible', true);
      });
      window.on('hide', () => {
        if (!window.isDestroyed()) window.webContents.send('windowVisible', false);
      });

      window.on('move', (event) => {
        let bounds = window.getContentBounds();
        // Not before ready-to-show has put the window where it was saved: a page that sizes or shows itself as it loads would
        // otherwise record the window's first, default place over the saved one
        let saveBounds = allowedWindows[windowIdToAllowedWindows[window.id]].placed == true && !(window.isMinimized() || window.isFullScreen() || (isMac && window.isMaximized()));
        if (saveBounds) {
          allowedWindows[windowIdToAllowedWindows[window.id]].options = {
            ...allowedWindows[windowIdToAllowedWindows[window.id]].options,
            ...bounds,
          };
        }
      });

      window.on('moved', (event) => {
        let bounds = window.getContentBounds();
        // Not before ready-to-show has put the window where it was saved: a page that sizes or shows itself as it loads would
        // otherwise record the window's first, default place over the saved one
        let saveBounds = allowedWindows[windowIdToAllowedWindows[window.id]].placed == true && !(window.isMinimized() || window.isFullScreen() || (isMac && window.isMaximized()));
        if (saveBounds) {
          allowedWindows[windowIdToAllowedWindows[window.id]].options = {
            ...allowedWindows[windowIdToAllowedWindows[window.id]].options,
            ...bounds,
          };
        }
      });

      window.on('resize', (event) => {
        let bounds = window.getContentBounds();
        // Not before ready-to-show has put the window where it was saved: a page that sizes or shows itself as it loads would
        // otherwise record the window's first, default place over the saved one
        let saveBounds = allowedWindows[windowIdToAllowedWindows[window.id]].placed == true && !(window.isMinimized() || window.isFullScreen() || (isMac && window.isMaximized()));
        if (saveBounds) {
          allowedWindows[windowIdToAllowedWindows[window.id]].options = {
            ...allowedWindows[windowIdToAllowedWindows[window.id]].options,
            ...bounds,
          };
        }
      });

      window.on('resized', (event) => {
        let bounds = window.getContentBounds();
        // Not before ready-to-show has put the window where it was saved: a page that sizes or shows itself as it loads would
        // otherwise record the window's first, default place over the saved one
        let saveBounds = allowedWindows[windowIdToAllowedWindows[window.id]].placed == true && !(window.isMinimized() || window.isFullScreen() || (isMac && window.isMaximized()));
        if (saveBounds) {
          allowedWindows[windowIdToAllowedWindows[window.id]].options = {
            ...allowedWindows[windowIdToAllowedWindows[window.id]].options,
            ...bounds,
          };
        }
      });

      window.on('close', (event) => {
        if (window.id != 1) {
          // save vis, but don't close
          event.preventDefault();        
          window.hide();
          timers.setTimeout(onChildWindowCloseTimeout, 200, windowIdToAllowedWindows[window.id]);
        } else {
          // A rig keyed here is unkeyed first: the close is made again once it has been (rigPttHoldClose)
          if (rigPttHoldClose(event, window)) return;
          mainWindowClosing = true;
          // Main window is 1, so really destroy all the others
          for (const windowId in windowIdToAllowedWindows) {
            if (windowId != 1 &&
                allowedWindows[windowIdToAllowedWindows[windowId]].window &&
                !allowedWindows[windowIdToAllowedWindows[windowId]].window.isDestroyed() ) {
              allowedWindows[windowIdToAllowedWindows[windowId]].window.destroy();
            }
          }
        }
      });

      remoteMain.enable(window.webContents);

      window.webContents.setWindowOpenHandler((details) => {
        shell.openExternal(details.url);
        return { action: 'deny' };
      });
    } else if (window.id !== 1) {
      // console.log(`WARNING: id: "${window.id}"  title: "${title}" not found in allowedWindows`);
    }

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
    optimizer.watchWindowShortcuts(window);
  });

  createMainWindow();

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  saveWindowPositions();
  // (the DLNA players told to stop as the main window closed answered first: at once when there were none)
  castStopThen(() => app.quit());
});

app.on('will-quit', () => {
  inputLevelQuit();
  serialCloseAll();
});

function onChildWindowCloseTimeout(windowName) {
  if (mainWindowClosing == false) {
    allowedWindows[windowName].options.show = false;
  }
}

function saveWindowPositions() {
  const finalSettings = {};
  for (let window in allowedWindows) {
    finalSettings[window] = allowedWindows[window].options;
  }
  // Snapped to 16:9 while casting (mapCastSnap): the size it had before is the one kept
  if (mapCast.restoreSize && finalSettings['GridTracker2']) {
    finalSettings['GridTracker2'] = { ...finalSettings['GridTracker2'], width: mapCast.restoreSize[0], height: mapCast.restoreSize[1] };
  }
  fs.writeFileSync(windowSettingsPath, JSON.stringify(finalSettings, null, 2), { flush: true });
}

function isWithinDisplayBounds( x, y ) {
  const displays = screen.getAllDisplays();
  return displays.reduce((result, display) => {
    const area = display.workArea
    return (
      result ||
      (x >= area.x &&
       y >= area.y &&
       x < area.x + area.width &&
       y < area.y + area.height)
    );
  }, false);
}

function currentTimeStampString() {
  let now = new Date();
  return (
    now.getFullYear() +
    "-" +
    (now.getMonth() + 1) +
    "-" +
    now.getDate() +
    " " +
    padNumber(now.getHours()) +
    "." +
    padNumber(now.getMinutes()) +
    "." +
    padNumber(now.getSeconds())
  );
}

function padNumber(number, size) {
  let s = String(number);
  while (s.length < (size || 2)) {
    s = "0" + s;
  }
  return s;
};

function slugify(string) {
  return string
    .trim()
    .replace(/ +/g, '-')
    .replace(/[^A-Za-z0-9\-_]/g, '');
}

process.on('uncaughtException', function (error) {
  log.error(error);
});
