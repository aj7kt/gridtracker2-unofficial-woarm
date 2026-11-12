// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Multi-Mode Decoder's mode registry and plugin host ("MMD Plugin Loader Design"): every mode registers one object with
// mmdRegisterMode, and the core (mmDecoder.js) calls the registered modes at each of its hook points instead of naming them. The
// built-in modes register themselves where they are, at the bottom of their own files. Plugins (plugins/mmd/<id>/, packed as <id>.asar),
// found and checked by the main window (services/mmdPlugins.js, GT.mmdPlugins), are added here as the window opens (mmdPluginsLoad):
// their styles, their UI (ui.html's templates, each into its slot), their Mode menu entry, then their scripts, each of which registers
// its mode. Loaded before every mode's script
//
// A registration (every field optional but id):
//   id                   its own name (a plugin's: its id, also its settings' prefix)
//   name                 shown in the Event Viewer if it fails
//   modes                the Mode menu's values it decodes (DEC.mode): ["psk31", "rtty", ...]
//   input                the audio it decodes: "audio12" (the worklet's 12 kHz stream), "raw" (the input's own samples), else none
//                        (CW: the worklet's own decoder)
//   signals              true: what it hears are the decoder's signals (host.channels): their guard lines on the waterfall, as CW's
//   periodMs()           a mode decoded in periods (FT8, FT4, WSPR): its period (ms); its status goes on the divider, no UTC menu
//   periodShift()        ... and how far its periods are shifted (ms: FT8's time skew)
//   skew                 true: its periods can be skewed (the core's time skew: a right-click on the waterfall turns it on or off, the
//                        wheel moves it; host.skew()), for a station whose clock is off. FT8's and FT4's
//   focusHalf            Hz: the left button on the waterfall puts a focus there this far either side (and drags it), in place of its
//                        tune; host.bandFocus(). FT8's and FT4's (searched harder there)
//   scaleMinorHz         Hz: the scale's short ticks this far apart where they fit (FT8's and FT4's every 100 Hz)
//   instance             true: what it decodes is GridTracker's instance MMD's (host.instanceDecodes): the map, the Call Roster
//   detect               Detect Modes' decoders of its own (its detectAudio, detectRaw): { <mode>: { color, sameHz, rank, width, floor,
//                        checked } }, each mode's label colour, how near (Hz) two of its finds are the same signal, its rank where two
//                        overlap (mmdDetect.js: FT8's 10, CW's 3), its signal's width (Hz, or a function of the find: f.by, f.label, f.sub),
//                        floor: its text read worse than this not shown (PSK's, RTTY's 0.5), checked: its decodes checked (a CRC), read as
//                        perfect text
//   cwList               true: its signals are listed in CW's list (host.channels, signalText: PSK's, Olivia's), the WPM column its baud
//   snrWide              ... its modes whose dB there is measured wider than the signal's filter, shown under 0 too: ["mfsk", "thor"]
//   listName()           ... the mode's name as the empty list says it ("No PSK63 decoded yet")
//   listKey()            ... what its signals are of (the submode): another, and the list starts afresh (host.listRefresh)
// Hooks, called for the mode showing (DEC.mode one of its modes):
//   audio(data)          a block of its input's audio
//   tune(hz)             the waterfall clicked there
//   entered()            the mode picked (after its Input Device is set): listened for afresh
// Hooks, called for every registered mode (each checks its own mode where it matters, as the calls in mmDecoder.js always did):
//   init(host)           once, the window open
//   shown(on)            its lists and bars shown or hidden: on, it's the mode now
//   drawBack(ctx, x, ratio, w, h), draw(...)   over the waterfall, under the RSIDs heard, and over them
//   tick()               four times a second
//   clear()              the window's Clear
//   retune()             the rig moved, or another part of the band is in the passband
//   start(), stop()      the decoder started, stopped
//   range()              the audio decoded (Min Freq and Max Freq) changed
//   layout()             the waterfall's share of the window changed (also as the window first lays itself out, before init)
//   settingsRender(S)    the Settings panel drawn (S: GT.settings.MMD): its own boxes' controls set
//   skewAlign(back)      its time skew turned on, moved or off (skew: true): its periods decoded from now on the new timing (back: the
//                        last one heard whole first; not after a retune). The core draws the period lines again after it
//   fallRow(row)         a row of the waterfall as it comes (its bins' bytes: 5 dB under the floor at 0, 40 dB over at 255), only rows
//                        heard since the last retune, before the waterfall has it
//   drawScale(ctx, x, ratio, w, h)   over the scale, under the signals' marks; returns when (ms) it should be drawn again, else 0
//   detectAudio(data)    Detect Modes on: a block of the 12 kHz audio for its own detect decoders (copied: the block goes on to SSTV's)
//   detectRaw(data)      ... a block of the input's own samples for them (copied, never handed over: the next registration's gets it too)
//   detectReset()        Detect Modes' decoders listening afresh (it started, Clear, it stopped)
//   detectRsid(freq)     ... an RSID heard there: its decoders leave the place alone a moment
//   detectBefore(f), detectAfter(f)   a signal it found picked (f.mode one of its modes): before its mode is chosen (its submode set), and
//                        after (aimed at it: Packet's HF place locked)
//   rsidMode(name)       an RSID's mode name ("BPSK63", "Olivia 8/500") decoded by one of its modes: [mode, submode or null], else null
//   rsidHeard(name, freq) an RSID heard (every registration's: Olivia's takes its submode and place, the keyboard modes' leave it alone)
//   rsidBefore(mark, sub) one of its RSIDs clicked, before its mode is chosen: its submode (and place) set; false when the mode already
//                        decodes it (nothing done)
//   rsidAfter(mark, sub, chunks, switched)   ... after: the audio kept since just before the RSID (chunks: [{ rate, samples }]) decoded
//                        as its own input's, from there on (switched: its mode was chosen now; else already showing)
//   logQso()             Log QSO in its mode: { sub (the submode as the window keeps it), signalId (the signal Log QSO on the second line
//                        takes when none is pinned: host.signalId), airHz, firstAt (where and since when it hears one, with no signal) }
//   testStart(t), testEnd()   a test signal (t: index.json's) starts playing in its mode (its own settings kept, t's set: Olivia's), ends
// A hook that throws: that registration off for the rest of the session (none of its hooks called again), one line in the Event Viewer
// saying which and why; the core and the other modes go on

// list: the registrations; off: the ids of those turned off; loaded: the plugins added to this window (GT.mmdPlugins' records);
// lists: the elements their "list" templates put in the lists' place (hidden while Detect Modes runs); loading: the plugin whose script
// runs now (its registrations are its)
const MMD_PLUGINS = { list: [], off: new Set(), loaded: [], lists: [], loading: null };
// Plugins' signals' ids (host.channels: the keyboard modes', Olivia's, NAVTEX's), apart from CW's (the worklet's, under MMD_CW_ID_MAX)
const MMD_PLUGIN_ID_BASE = 400000;
const MMD_PLUGIN_ID_SPAN = 100000;

function mmdRegisterMode(def)
{
  if (!def || typeof def.id != "string" || MMD_PLUGINS.list.some((d) => d.id == def.id)) return;
  def.modes = Array.isArray(def.modes) ? def.modes : [];
  if (MMD_PLUGINS.loading) def.plugin = MMD_PLUGINS.loading;
  MMD_PLUGINS.list.push(def);
}

// The registration decoding a mode (DEC.mode by default), or null
function mmdPluginOf(mode = DEC.mode)
{
  return MMD_PLUGINS.list.find((d) => d.modes.includes(mode) && !MMD_PLUGINS.off.has(d.id)) || null;
}

// A registration's hook called, guarded: undefined if it hasn't the hook, it's off, or it threw (then off for the session)
function mmdPluginCall(def, hook, ...args)
{
  if (!def || MMD_PLUGINS.off.has(def.id) || typeof def[hook] != "function") return undefined;
  return mmdPluginGuard(def, () => def[hook](...args));
}

// fn called for a registration (a hook, or its own callback: a worker's message), guarded: its value, or undefined if it's off or fn
// threw (then off for the session)
function mmdPluginGuard(def, fn)
{
  if (MMD_PLUGINS.off.has(def.id)) return undefined;
  try
  {
    return fn();
  }
  catch (e)
  {
    mmdPluginFailed(def, e);
    return undefined;
  }
}

// A registration (or a plugin as it loads: { id, name }) failed: off for the session, its Mode menu entries grayed, one line in the
// Event Viewer saying which and why
function mmdPluginFailed(def, e)
{
  console.error(e);
  MMD_PLUGINS.off.add(def.id);
  for (const option of cwMode.options) if ((def.modes || [def.id]).includes(option.value)) option.disabled = true;
  try
  {
    const text = I18N("mmd.plugin.failed").replace("{name}", def.name || def.id).replace("{error}", (e && e.message) || String(e));
    window.opener.addEvent("mmd", "<font style='color:var(--gt-error)'>" + window.opener.htmlEntities(text) + "</font>");
  }
  catch (e2)
  {
    console.error(e2);
  }
}

// The mode showing's hook (its registration's)
function mmdPluginActive(hook, ...args)
{
  return mmdPluginCall(mmdPluginOf(), hook, ...args);
}

// A hook of every registration, in the order they registered
function mmdPluginsEach(hook, ...args)
{
  for (const def of MMD_PLUGINS.list) mmdPluginCall(def, hook, ...args);
}

// What the mode showing decodes ("audio12", "raw", or "" for none), from its registration (mode: another's)
function mmdPluginInput(mode = DEC.mode)
{
  const def = mmdPluginOf(mode);
  return def && typeof def.input == "string" ? def.input : "";
}

// The mode showing's period (ms) when it's decoded in periods, else 0
function mmdPluginPeriodMs()
{
  return Number(mmdPluginActive("periodMs")) || 0;
}

// Whether a mode's (DEC.mode's by default) registration hears signals of the decoder's (signals: true)
function mmdPluginSignals(mode = DEC.mode)
{
  const def = mmdPluginOf(mode);
  return !!def && def.signals === true;
}

// A field of the mode showing's registration (DEC.mode's by default: skew, focusHalf, scaleMinorHz, instance), else undefined
function mmdPluginFlag(name, mode = DEC.mode)
{
  const def = mmdPluginOf(mode);
  return def ? def[name] : undefined;
}

// Detect Modes' spec of a mode found by a registration's own detect decoders ({ color, sameHz, rank, width, checked }), else null
function mmdPluginDetectSpec(mode)
{
  for (const def of MMD_PLUGINS.list)
  {
    if (MMD_PLUGINS.off.has(def.id) || !def.detect || typeof def.detect != "object") continue;
    if (Object.hasOwn(def.detect, mode)) return def.detect[mode];
  }
  return null;
}

// The host: what a mode may use of GridTracker2 (a mode once it's a plugin uses nothing else). Versioned with the manifest's api
// (MMD_HOST_API, the one the main window checks plugins against: MMD_PLUGIN_API in services/mmdPlugins.js); the built-in modes don't
// need it yet, as they still reach the core's globals. More (the map, geography) comes with the plugins that need it
const MMD_HOST_API = 1;
function mmdHostFor(def)
{
  // (its own settings: those starting with its id or one of its modes': FT8 / FT4's ft8Depth, ft4SendDecodes; and those its plugin.json
  // names that aren't the decoder's: services/mmdPlugins.js, p.ownKeys)
  const ownKeys = (def.plugin && def.plugin.ownKeys) || [];
  const own = (key) => ownKeys.includes(String(key)) || [def.id].concat(def.modes).some((prefix) => String(key).startsWith(prefix));
  // Its signals (channels, signalText ...): ids from MMD_PLUGIN_ID_BASE, the worker's channel id added
  const base = MMD_PLUGIN_ID_BASE;
  const mine = (id) => Number(id) >= base && Number(id) < base + MMD_PLUGIN_ID_SPAN;
  return {
    api: MMD_HOST_API,
    mode: () => DEC.mode,
    dialHz: () => mmdDial(),
    // (the input's sample rate: its audio context's, 0 while stopped)
    rate: () => (DEC.ctx ? DEC.ctx.sampleRate : 0),
    status: (text, error = false) => mmdStatus(text, error),
    overlay: () =>
    {
      DEC.dirty = true;
      mmdOverlay();
    },
    tune: (hz, rigMode) => mmdTuneToFreq(hz, rigMode),
    vfo: () => window.opener.mmDecoderVfo(),
    // (its own settings only: own's)
    get: (key) => (own(key) ? GT.settings.MMD[key] : undefined),
    set: (key, value) =>
    {
      if (own(key)) GT.settings.MMD[key] = value;
    },
    t: (key) => I18N(key),
    timers: nodeTimers,
    event: (text) => window.opener.addEvent("mmd", window.opener.htmlEntities(String(text))),
    // (a plugin's worker by its path in the plugin, its folder or its .asar; a built-in mode's in lib/mmd)
    workerUrl: (file) => (def.plugin ? def.plugin.url + "/" + file : "lib/mmd/" + file),
    // fn guarded as its hooks are (a worker's onmessage): it throwing turns the mode off, with its Event Viewer line
    guard: (fn) => mmdPluginGuard(def, fn),
    // The audio decoded (Min Freq and Max Freq, Hz)
    range: () => ({ minHz: mmdMinHz(), maxHz: mmdMaxHz() }),
    // An audio frequency on the air (Hz; null with no dial read), shown as the window shows frequencies; text escaped for HTML
    airHz: (audioHz) => window.opener.mmDecoderAirHz(audioHz),
    freqText: (hz) => mmdFreq(hz),
    escape: (text) => mmdEscape(String(text)),
    // Whether what was heard from (and to) these times (ms) was a test signal's (Test Signals: not saved, not sent on)
    testHeard: (from, to = from) => mmdTestHeard(from, to),
    // A folder beside GridTracker's own (NAVTEX Messages, as SSTV Pictures): its path (made by the plugin as it saves)
    folder: (name) => path.join(path.dirname(GT.appData), String(name).replace(/[\\/:*?"<>|]/g, "_")),
    // The stations it hears, its worker's channels ([{ id, freq (audio Hz), snr, baud, wpm, active, receiving }]): each one of the
    // decoder's signals (its mark on the waterfall), the others it had let go; baud: shown for one with none of its own (wpm: shown as
    // it is, Olivia's 31.3)
    channels: (list, baud = 0) =>
    {
      const seen = {};
      for (const c of list)
      {
        const signal = mmdSignal(base + c.id);
        seen[signal.id] = true;
        signal.freq = c.freq;
        signal.air = window.opener.mmDecoderAirHz(c.freq);
        signal.snr = c.snr;
        signal.snrSeen = true;
        signal.wpm = c.wpm != null ? c.wpm : c.baud > 0 ? Math.round(c.baud) : baud;
        signal.alive = c.active !== false;
        // (a message open: kept while the lock drops for a moment)
        signal.receiving = c.receiving === true;
      }
      for (const id in DEC.signals) if (mine(id) && !seen[id]) DEC.signals[id].alive = DEC.signals[id].receiving = false;
      DEC.dirty = true;
    },
    // A channel's text as it comes: added to its signal's, lines run on (a new line as a space, one space between words)
    signalText: (id, text) =>
    {
      const signal = mmdSignal(base + id);
      mmdText(signal, (signal.text + String(text).replace(/[\r\n]+/g, " ")).replace(/ {2,}/g, " "));
      signal.last = Date.now();
      if (/(^| )CQ $/.test(signal.text)) signal.cqAt = signal.last;
      DEC.dirty = true;
    },
    signalTextClear: (id) =>
    {
      const signal = DEC.signals[base + id];
      if (signal) signal.text = "";
    },
    // A channel's signal ({ freq, air, snr, snrSeen, text, alive, receiving ... }), else null; all of them; its id among the decoder's
    // (DEC.signals': the one logQso names)
    signal: (id) => DEC.signals[base + id] || null,
    signals: () => Object.values(DEC.signals).filter((s) => mine(s.id)),
    signalId: (id) => base + id,
    // Its signals in CW's list (cwList) are of another submode now (listKey): the list started afresh, its empty line named again
    listRefresh: () => mmdListRefresh(),
    // The waterfall clicked: the signal there pinned (as CW's), or let go
    focusNear: (hz) => mmdFocus(mmdSignalNear(hz)),
    // The worklet's 12 kHz stream (input "audio12"): its rate, and when a chunk's last sample was heard (ms, the wall clock: its audio
    // context's time, less the latency measured against WSJT-X, as the FT8 decoder takes it; null while stopped)
    rate12: FT8_RATE,
    heardAt: (data) =>
    {
      if (!DEC.ctx) return null;
      const stamp = DEC.ctx.getOutputTimestamp();
      return performance.timeOrigin + stamp.performanceTime + (data.end - stamp.contextTime) * 1000 - FT8_LATENCY_MS;
    },
    // The band a frequency on the air is in ("20m"), else ""
    bandOf: (hz) => (hz > 0 ? mmdBandOf(hz) || "" : ""),
    // How far a grid is from you ({ distance, unit } in Settings' distance unit; distance null for no grid)
    gridDistance: (grid) => window.opener.mmDecoderGridDistance(grid),
    // A WSPR period's stations on to GridTracker2 (its instance MMD: the map, as WSJT-X's WSPR decodes; services/mmDecoder.js)
    sendWspr: (start, list) => window.opener.mmDecoderInstanceWspr(start, list),
    // The rig's dial set (Hz on the air) and its mode, through Rig Control as the decoder sends it (data: USB's data variant); false if
    // nothing was sent. Whether the decoder may send the rig anything (Settings, Rig Control); whether it's listening
    tuneDial: (dial, mode, data) => mmdTuneDial(dial, mode, data),
    rigControl: () => GT.settings.MMD.rigControl === true,
    running: () => !!DEC.running,
    // A file of the plugin's own (its folder's or its .asar's: read with fs)
    file: (name) => (def.plugin ? path.join(def.plugin.base, name) : null),
    // A save folder shown in an element as the Settings boxes show them (… and its last two folders, the whole path in its tooltip)
    showFolder: (el, folder, hoverKey) => mmdShortFolder(el, folder, hoverKey),
    // The 12 kHz stream's latency (ms: a sample heard is taken as heard this much earlier, heardAt's), as the waterfall's rows are timed
    latencyMs: FT8_LATENCY_MS,
    // The waterfall: its bins' width (Hz, 0 until the decoder is ready), its span (Hz), a label drawn on it as the core's are (bold, in a
    // dark box with an edge; align "center" about x or "right" ending at x; its box { left, top, height })
    binHz: () => DEC.binHz || 0,
    span: () => (DEC.bins > 0 ? DEC.bins * DEC.binHz : 0),
    overlayLabel: (ctx, text, x, y, align, px, ratio, w, color) => mmdOverlayLabel(ctx, text, x, y, align, px, ratio, w, color),
    // Its time skew (skew: true): ms either way, 0 while it's off
    skew: () => mmdSkewShift(),
    // Its focus (focusHalf): where it is (audio Hz, 0 none); put at hz (a click there again, inside it, or 0, lets it go)
    bandFocus: () => DEC.bandFocus || 0,
    bandFocusSet: (hz) => mmdBandFocusSet(hz),
    // Your call sign as GridTracker2 has it (upper case, "" none), and its call sign prefixes (one a line) for a decoder telling a real
    // call from noise
    myCall: () => String(GT.settings.app.myCall || "").trim().toUpperCase(),
    callPrefixes: () => Object.keys(GT.prefixToDXCC || {}).filter((prefix) => /^[A-Z0-9]+$/.test(prefix)).join("\n"),
    // GridTracker's instance MMD (instance: true): whether what it decodes now is the instance's (listening, in one of its modes), a period
    // being decoded or done (its Status' Decoding; busy: whether it says so now), and a period's messages as WSJT-X's Decodes (mode; start:
    // the period's start, ms UTC; lines [[dB, DT, audio Hz, message]]; modeChar: WSJT-X's for the mode, "~" FT8's): the map, alerts, the
    // Call Roster with its mode's <mode>SendDecodes on (services/mmDecoder.js). VFO read: whether Rig Control reads that mode's VFO's dial
    instanceMain: () => mmdInstanceMain(),
    instanceDecoding: (on) => window.opener.mmDecoderInstanceDecoding(!!on),
    instanceBusy: () => !!(GT.mmdInstance && GT.mmdInstance.decoding),
    instanceDecodes: (mode, start, lines, modeChar) => window.opener.mmDecoderInstanceDecodes(mode, start, lines, modeChar),
    vfoRead: (mode) => !!window.opener.mmDecoderVfoRead(mode).up,
    // Detect Modes: whether it's on, and a signal its own decoders found (detectAudio, detectRaw: mode one of its detect's; label as listed,
    // hz its middle, dB, what was heard; sub: what picking it needs, its detectBefore's and detectAfter's f.sub; by: which of its decoders,
    // PSK63's and PSK31's each their own finds, else the mode)
    detectOn: () => mmdDetectOn(),
    detectFound: (mode, label, hz, snr, text, sub = {}, by = mode) => mmdDetectFound(mode, label, hz, snr, text, sub || {}, by),
    // The satellite BirdWatch's rig follows (its name, heard through it), else ""; a place's grid square (chars: 4, 6 ...)
    satellite: () => window.opener.mmDecoderSatellite() || "",
    gridOf: (lat, lon, chars = 6) => window.opener.latLonToGridSquare(lat, lon, chars),
    // Its pictures in the picture view (mmdPictures.js), as its own kind (kind: its id), shown in its modes
    pictures: {
      kind: (spec) => mmdPicturesKind(Object.assign({}, spec, { kind: def.id, modes: def.modes })),
      start: (m) => mmdPicStart(def.id, m),
      rows: (id, from, count, rgba) => mmdPicRows(def.id, id, from, count, rgba),
      redraw: (id, count, rgba, thumb = true) => mmdPicRedraw(def.id, id, count, rgba, thumb),
      done: (id, complete) => mmdPicDone(def.id, id, complete),
      reset: () => mmdPicReset(def.id),
      clear: () => mmdPicClear(def.id),
      entered: () => mmdPicEntered(def.id),
      // (the one coming in, when it's its own)
      live: () => (PICS.live && PICS.live.kind == def.id ? PICS.live : null),
      shift: () => mmdPicShift(def.id),
      shown: () => mmdPicKind() == def.id,
      draw: () => mmdPicDraw(),
      head: () => mmdPicHead(),
      grey: (levels) => mmdPicGrey(levels)
    }
  };
}

// Every registration's init, once, with its host
function mmdPluginsInit()
{
  for (const def of MMD_PLUGINS.list) mmdPluginCall(def, "init", mmdHostFor(def));
}

// ---- Plugins: added before the window's init (mmdInit) draws its strings and calls every registration's init

// Each plugin the main window found (GT.mmdPlugins: { id, name, manifest, base (its folder, or its .asar's path), url (base as a file
// URL), disabled }), not disabled: added. One that fails as it's added: its registrations off, one Event Viewer line
function mmdPluginsLoad()
{
  for (const p of GT.mmdPlugins || [])
  {
    if (p.disabled) continue;
    try
    {
      mmdPluginLoad(p);
      MMD_PLUGINS.loaded.push(p);
    }
    catch (e)
    {
      mmdPluginFailed({ id: p.id, name: p.name, modes: p.modes.map((d) => d.id) }, e);
      for (const def of MMD_PLUGINS.list) if (def.plugin === p) MMD_PLUGINS.off.add(def.id);
    }
  }
}

// One plugin: its styles, its UI, its Mode menu entry and the core's tables, then its scripts (each registering its mode)
function mmdPluginLoad(p)
{
  const m = p.manifest;
  const read = (file) => fs.readFileSync(path.join(p.base, file), "utf8");
  if (m.css)
  {
    const style = document.createElement("style");
    style.dataset.plugin = p.id;
    style.textContent = read(m.css);
    document.head.appendChild(style);
  }
  // ui.html: <template data-slot="list"> (in the lists' place), "settings" (its boxes on Settings, Decoders), "bar" (a row under the
  // second line), "barItem" (on the second line)
  if (m.ui)
  {
    const holder = document.createElement("template");
    holder.innerHTML = read(m.ui);
    for (const t of holder.content.querySelectorAll("template[data-slot]")) mmdPluginSlot(t.dataset.slot, t.content, p);
  }
  // Each of its modes (one, or its plugin.json's modes: services/mmdPlugins.js, mmdPluginModesOf)
  for (const d of p.modes)
  {
    mmdPluginMenu(d);
    if (!MMD_MODES.includes(d.id)) MMD_MODES.push(d.id);
    // Its Frequency menu (mmdBands.js: its rows added to the band plans, mmdPluginsBands), its stations named there (a broadcast's)
    if (d.bands) BANDS_MODE_NAMES[d.id] = d.bands;
    if ((d.freqGrouping == "note" || d.freqGrouping == "place") && !BANDS_NOTE_MODES.includes(d.id)) BANDS_NOTE_MODES.push(d.id);
    // (place: grouped by the station's location too, its note after the call sign: WEFAX's)
    if (d.freqGrouping == "place" && !BANDS_PLACE_MODES.includes(d.id)) BANDS_PLACE_MODES.push(d.id);
    // The waterfall's Resolution By Mode (mmdFallView.js)
    if (typeof d.fallScale == "number") FALL_VIEW_MODE_SCALE[d.id] = d.fallScale;
  }
  for (const file of m.scripts || []) mmdPluginScript(p, file, read(file));
}

// A template's contents into its slot (p: the plugin's; its settings box gets a Guide button on its title line when it has a guide)
function mmdPluginSlot(slot, content, p)
{
  if (slot == "list")
  {
    for (const el of content.children) MMD_PLUGINS.lists.push(el);
    detectList.before(content);
  }
  // A row of its own under the second line (WEFAX's controls), after the submode menus' and the plugins' before it (shown and hidden by
  // its registration's shown)
  else if (slot == "bar")
  {
    const els = [...content.children];
    (MMD_PLUGINS.barAfter || cwSubBar).after(content);
    if (els.length) MMD_PLUGINS.barAfter = els[els.length - 1];
  }
  // On the second line itself, after the UTC menu (FT8's and FT4's Slot Finder; shown and hidden by its registration's shown)
  else if (slot == "barItem")
  {
    cwLogQsoBox.before(content);
  }
  // In the submode menus' row under the second line (shown while one of its items is: mmdModeSet), its items hidden but its mode's
  // (PSK's, Olivia's, Feld-Hell's submode menus; its registration's shown)
  else if (slot == "subBar")
  {
    cwSubBar.appendChild(content);
  }
  else if (slot == "settings")
  {
    // Among the Decoders tab's boxes by its title, after CW's (the first)
    const group = document.querySelector("#mmdModesTab .mapGroup");
    for (const box of [...content.children])
    {
      const title = (el) => (el.querySelector(".rigVfoTitle") || el).textContent.trim();
      const after = [...group.children].slice(1).find((b) => b.classList.contains("rigVfoBox") && title(b).localeCompare(title(box)) > 0);
      group.insertBefore(box, after || null);
      const head = box.querySelector(".rigVfoTitle");
      if (head && p.manifest.guide) head.appendChild(mmdPluginGuideButton(p));
    }
  }
  else throw new Error("unknown slot " + slot);
}

// A Guide button: the plugin's own guide opened (mmdPluginGuide). Its words from the app's strings, its tooltip naming the plugin
function mmdPluginGuideButton(p)
{
  const button = document.createElement("span");
  button.className = "cwButton mmdPluginGuide";
  button.dataset.i18n = "mmd.plugin.guide.label";
  button.textContent = "Guide";
  button.onclick = () => mmdPluginGuide(p.id);
  // (a key of its own, not the label's .hover: renderI18n would put that one back without the name)
  button.title = I18N("mmd.plugin.guideOpen").replace("{name}", p.name);
  return button;
}

// A plugin's own guide (its plugin.json's guide: a PDF in its folder or .asar) opened in the User Guide window, by its id. False when
// it has none. (The way to it from anywhere in the window: its Settings box's Guide button now)
function mmdPluginGuide(id)
{
  const p = MMD_PLUGINS.loaded.find((x) => x.id == id);
  if (!p || !p.manifest.guide) return false;
  window.opener.openUserGuideWindow(false, path.join(p.base, p.manifest.guide));
  return true;
}

// A mode's Mode menu entry (d: one of its plugin's modes): among its group's (ham modes A to Z after CW, then the utility modes A to Z:
// data-group="utility") by its label
function mmdPluginMenu(d)
{
  // (its label in the app's language: its plugin.json's menu.i18n, its own string)
  const option = new Option((d.i18n && GT.i18n[d.i18n]) || d.label, d.id);
  if (d.i18n) option.dataset.i18n = d.i18n;
  option.dataset.group = d.group == "utility" ? "utility" : "ham";
  // (Get More... stays last: MMD_MORE)
  const more = [...cwMode.options].find((o) => o.value == MMD_MORE) || null;
  const group = [...cwMode.options].filter((o) => (o.dataset.group || "ham") == option.dataset.group && o.value != "cw" && o.value != MMD_MORE);
  const after = group.find((o) => o.text.localeCompare(option.text) > 0);
  if (after) cwMode.insertBefore(option, after);
  else if (group.length) group[group.length - 1].after(option);
  else cwMode.insertBefore(option, option.dataset.group == "ham" ? [...cwMode.options].find((o) => o.dataset.group == "utility") || more : more);
}

// A script of the plugin run as one of the page's own (its top-level names global, as the built-in modes' are; named by its path in
// DevTools). One that throws as it runs: thrown here
function mmdPluginScript(p, file, code)
{
  let error = null;
  const onError = (event) =>
  {
    error = event.error || new Error(event.message);
  };
  window.addEventListener("error", onError);
  MMD_PLUGINS.loading = p;
  try
  {
    const script = document.createElement("script");
    script.dataset.plugin = p.id;
    script.textContent = code + "\n//# sourceURL=" + p.url + "/" + file;
    document.head.appendChild(script);
  }
  finally
  {
    MMD_PLUGINS.loading = null;
    window.removeEventListener("error", onError);
  }
  if (error) throw error;
}

// The band plans read (mmdBands.js): each plugin's rows (its bands.json) added for each of its modes, unless the plans have that mode's
// rows already (an edited copy saved with them)
function mmdPluginsBands(data)
{
  for (const p of MMD_PLUGINS.loaded)
  {
    const b = p.manifest.bands;
    if (!b || !b.file) continue;
    const names = p.modes.map((d) => d.bands).filter((name) => name && !data.frequencies.some((f) => f.mode == name));
    if (!names.length) continue;
    try
    {
      const rows = JSON.parse(fs.readFileSync(path.join(p.base, b.file), "utf8")).frequencies || [];
      for (const row of rows) if (row && names.includes(row.mode)) data.frequencies.push(row);
    }
    catch (e)
    {
      console.error(e);
    }
  }
}

// The Test Signals (mmdTest.js): each plugin's (its test-signals index.json, the same shape as resources/test-signals'), each with dir,
// the folder its file is in
function mmdPluginsTestSignals()
{
  const list = [];
  for (const p of MMD_PLUGINS.loaded)
  {
    const file = p.manifest.testSignals;
    if (!file) continue;
    try
    {
      const dir = path.dirname(path.join(p.base, file));
      for (const t of JSON.parse(fs.readFileSync(path.join(p.base, file), "utf8")).signals || []) list.push(Object.assign({}, t, { dir }));
    }
    catch (e)
    {
      console.error(e);
    }
  }
  return list;
}
