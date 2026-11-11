const validSettings = [
  "N1MM",
  "acLog",
  "adifLog",
  "app",
  "BirdWatch",
  "appLogs",
  "audio",
  "awardTracker",
  "bandActivity",
  "ByBandMode",
  "ignoredCQ",
  "ignoredCalls",
  "ignoredGrid",
  "ignoredDxcc",
  "ignoredCQz",
  "ignoredITUz",
  "ignoredSpotters",
  "callsignLookups",
  "audioAlerts",
  "currentVersion",
  "dxkLog",
  "log4OM",
  "n3fjpContest",
  "mapMemory",
  "map",
  "msg",
  "reception",
  "roster",
  "feedRoster",
  "feedAudioAlerts",
  "customAlerts",
  "startupLogs",
  "trustedQsl",
  "legendColors",
  "bandColors",
  "modeColors",
  "pstrotator",
  "rotor",
  "Rigs",
  "MMD",
  "NetAudio",
  "HRDLogbookLog",
  "defaultsApplied"
];

// The Gridsquare Colors (Settings -> Grids); the "legend" name is kept to match the saved settings key
const def_legendColors = {
  QSO: "#EEEE00",
  QSL: "#EE0000",
  QSX: "#1111EE",
  CQ: "#00FF00",
  CQDX: "#00FFFF",
  QRZ: "#FFFF00",
  QTH: "#FFA600"
};

const def_maps = {
  mapIndex: "Street by Esri (English)",
  offlineMapIndex: "Satellite by MapTiler (No Labels)(Offline)",
  nightMapIndex: "Dark Gray by Esri (English)",
  offlineNightMapIndex: "Toner by Stamen (No Labels)(Offline)"
};

const k_valid_projections = [ "EPSG:3857", "AEQD" ];

const k_max_aeqd_grid_in_miles = 11500.0;

// Roster column colors (6-digit hex, no "#"), edited in each roster window's Settings -> Colors; each table lists
// exactly the columns that roster has (Band and Mode use the band and mode colors instead). The hunting colors
// (Callsign, Calling, Grid, POTA, DXCC, DXM, State, County, Cont, CQz, ITUz, PX) also tint a wanted entry's background.
const k_callRosterColumnColors = {
  Callsign: "FFFF00", Calling: "90EE90", Rig: "EEEEEE", Wanted: "EEEEEE", Grid: "00FFFF", Msg: "EEEEEE", POTA: "FBB6FC", SOTA: "40FFD8",
  DXCC: "FFA500", DXM: "7398FF", State: "90EE90", County: "CCDD00", Cont: "00DDDD",
  dB: "CCCCCC", Freq: "00FF00", DT: "5CAEFF", Dist: "00FFFF", Azim: "FFFF00",
  CQz: "DDDDDD", ITUz: "DDDDDD", PX: "FFFF00",
  LoTW: "00FF00", eQSL: "00FF00", OQRS: "00FF00",
  Life: "EEEEEE", Spot: "EEEEEE", Age: "EEEEEE", UTC: "EEEEEE"
};

// The Feed Roster swaps the Call Roster's callsign (yellow) and grid (cyan) colors, like its window colors
const k_feedRosterColumnColors = {
  Callsign: "00FFFF", Spotter: "5CAEFF", CQ: "00FF00", Wanted: "EEEEEE", Grid: "FFFF00", Msg: "EEEEEE", POTA: "FBB6FC", SOTA: "40FFD8",
  DXCC: "FFA500", DEDXCCv2: "80FFB0", DXM: "7398FF", State: "90EE90", County: "CCDD00", Cont: "00DDDD", DEContv2: "FF8080",
  Freq: "00FF00", Dist: "00FFFF", Azim: "FFFF00",
  CQz: "DDDDDD", ITUz: "DDDDDD", PX: "FFFF00",
  LoTW: "00FF00", eQSL: "00FF00", OQRS: "00FF00",
  Life: "EEEEEE", Age: "EEEEEE", UTC: "EEEEEE"
};

const def_settings = {
  defaultsApplied: true,
  // BirdWatch (satellite tracking): all of its settings (its settings window, and the panel and button panel)
  BirdWatch: {
    // BirdWatch (Settings -> Features -> Service): satellite tracking, shows its button in the main button panel
    enable: false,
    // The BirdWatch button's toggle (grey when off); enabling or disabling BirdWatch doesn't change it
    active: true,
    // Auto Select Next AOS Satellite (a button in the BirdWatch panel): the satellite that is up, or the next to rise, is selected for you
    auto: true,
    // Auto Select only picks a satellite whose pass climbs at least this many degrees (BirdWatch settings, General): 0 to 60
    autoMinElevation: 0,
    // Auto-Track's mode (BirdWatch settings, General): "next" (the satellite up, or the next to rise), "skedsFirst" (a mutual pass with
    // an active station wins), "skedsOnly" (only mutual passes)
    autoMode: "skedsFirst",
    // Skeds (BirdWatch settings, Skeds; birdWatchSkeds.js): the stations a pass is shared with, each { id ("s1" ...), call, grid,
    // height (meters, 0 not known), minEl (the lowest elevation they work, degrees; null: yours), notes, active (counted for Auto-Track,
    // the mutual passes, the timeline, the map and the alerts) }. skedMyMinEl: your own lowest elevation for a mutual pass (0: your
    // horizon). skedMinSeconds: shorter mutual windows are left out (0: none)
    skeds: [],
    skedMyMinEl: 0,
    skedMinSeconds: 0,
    // The active station's id (picked on the map, in the Mutual Passes list or on the timeline): the panel's Mutual Pass row shows its
    // pass, Skeds First prefers it; "" none
    skedFocus: "",
    // The highest station id given ("s7" is 7): a new station gets the next, so a removed one's id is never given again
    skedLastId: 0,
    // A transmitter's own VFOs, picked in the transmitters window (a right-click on its downlink or uplink): { uuid: { rx, tx } }, by the
    // VFOs' ids; the others go to the first VFO whose Satellites ranges fit (settings.Rigs.vfos[].satRanges, rig.js rigRoles)
    vfoPins: {},
    // Lock VFOs: turning one side's dial tunes the other too (a transponder followed on both: birdWatchLockFollow)
    lockVfos: false,
    // BirdWatch's Rig Control (BirdWatch settings, General): the rig follows the selected satellite, Auto-Track's pick or the user's; off,
    // BirdWatch sends the rig nothing (birdWatchStickyFollow)
    autoRig: true,
    // The Satellites tab's search and scan only list the satellites with a transmitter that has an uplink (the SatNOGS transmitters, not beacons alone)
    uplinkOnly: false,
    // Scan By Rig (Add Satellite): "off", "hear" (a downlink the rig can receive), "work" (and an uplink it can transmit on)
    rigFilter: "off",
    // Mode (Add Satellite): "all", or what the satellites must be workable with: "fm", "linear", "digital", "sstv" (birdWatchSatKinds)
    modeFilter: "all",
    // A QSO logged while the selected satellite is up is tagged PROP_MODE SAT and its SAT_NAME (BirdWatch settings, Satellites)
    logTag: false,
    // The sky plot of the selected satellite in the BirdWatch panel (BirdWatch settings, General)
    skybox: true,
    // The side views under it, each on its own (BirdWatch settings, General, Bird Views): the pass's profile (elevation over its time), the
    // pass across the horizon (azimuth along it), the satellite above the curve of the Earth (at its height and range)
    sideProfile: false,
    sideHorizon: false,
    sideEarth: true,
    // The BirdWatch panel's boxes under its title, in the order dragged to (birdWatchBoxesInit), and the satellite's info box minimized to
    // its name
    boxOrder: ["info", "rig", "sky", "profile", "horizon", "earth"],
    infoCollapsed: false,
    // The satellite info panel's list (BirdWatch panel, right click): the featured item (large, at the top), the order of the others,
    // the ones hidden, and the colors picked for values, by name (birdWatchInfo.js)
    info: { featured: "ttgo", order: [], hidden: [], known: [], colors: {} },
    // The Doppler table leaves out the transmitters with no uplink, the beacons and other downlink-only ones (BirdWatch settings, General)
    hideNoUplink: false,
    // Sticky Mode (BirdWatch settings, General): a satellite selected, the rig follows the previous satellite's mode first (birdWatchStickyFollow)
    sticky: false,
    // The transmitter last followed on each satellite, by catalog number (its uuid): followed again whenever it is selected
    stickyLast: {},
    // Pass alerts (BirdWatch settings, Alerts): a tracked satellite about to rise is announced this many minutes before its AOS (and at
    // it), when its pass climbs at least minElevation degrees, by voice, in the traffic list, and with Pushover / Simplepush
    // soonText / risingText: the user's own wording of the two announcements ({N} name, {T} minutes, {D} degrees); "" the built-in one
    // mutual: a mutual pass with an active station (Skeds) announced too, with the same minutes and ways; mutualText its wording ({C}
    // callsign, {N} name, {T} minutes to it, {M} minutes long)
    alerts: { enable: false, minutes: 5, minElevation: 10, atAos: true, speech: true, traffic: true, push: false, soonText: "", risingText: "", mutual: false, mutualText: "" },
    // BirdWatch's colors (its settings window, Colors tab): the footprint's outline and fill, and how transparent the fill is
    colors: {
      footprintOn: true, footprintRing: "#000000", footprintFill: "#8f8f8f", footprintTransparency: 0.86,
      pathOn: true, pathLine: "#00008b", pathWidth: 1.5, pathTimeSize: 11, pathTimeOn: true, pathDashOn: true, pathOutlineOn: true, pathOutline: "#ffffff"
    },
    // The satellites tracked, by catalog number: ISS, SO-50, AO-91, RS-44, AO-7
    tracked: [25544, 27607, 43017, 44909, 7530],
    // BirdWatch's element sets (Telemetry tab): AMSAT's daily file, and the user's own, each { id, kind, enabled, ... }: kind
    // "local" (path), "remote" (url, user, pass if the address needs a login, refresh every 24 hours: on by default) or
    // "tle" (a typed one: name, norad, line1, line2, override); with loaded, count and error for the first two
    tle: {
      amsat: true,
      // Which source wins when a satellite is in more than one: letters for AMSAT, Local, Remote and Manual (typed TLEs),
      // first wins. Typed overrides always win and aren't in it
      precedence: "alrm",
      sources: []
    }
  },
  app: {
    mapRight: false,
    clearOnCQ: false,
    crScript: 0,
    wantedByBandMode: false,
    includeExceptions: true,
    includeCustomAlerts: false,
    distanceUnit: "MI",
    graylineImgSrc: 0,
    gridViewMode: 3,
    gridsquareDecayTime: 300,
    gtBandFilter: "",
    gtFlagImgSrc: 0,
    gtModeFilter: "",
    gtPropFilter: "mixed",

    offAirServicesEnable: true,
    spottingEnable: true,
    // DX Feeds (DX Cluster / CW Skimmer / Spothole spots): Digital and Phone always, CW while Settings -> Feeds ->
    // Modes -> CW is ticked (feeds.modes.CW)
    dxFeeds: false,
    // Seconds a feed spot is kept (shown on the map) after it was last spotted
    feedMaxAge: 300,
    // Settings -> Feeds: which feed spots the Feed Roster and the map (DX Feeds and SOTA markers) show, and what the
    // Feed Roster may alert through. Was feedRoster.feeds (the Feed Roster's Spots tab) until v2.261017, moved at startup
    feeds: {
      // Feed Roster audio alerts come from Settings -> Audio Alerts -> Feed Roster; these cover the script and push
      alertScript: false,
      notifications: false,
      // Bands the user unticked; anything not listed is shown
      hiddenBands: {},
      // Every mode seen in feed spots (mode: shown); false = unticked. Starts with the ones the feed is known to send
      // and only grows. CW unticked also stops the server sending CW (gtChatSendFeeds)
      modes: {
        CW: true, FT4: true, FT8: true, SSB: true,
        AM: true, DATA: true, DIGVOICE: true, FM: true, FSK: true, HELL: true, JS8: true, JS8CALL: true,
        PHONE: true, PSK: true, PSK31: true, PSK63: true, RTTY: true, SSTV: true, WSPR: true
      }
    },
    loadAdifAtStartup: false,
    locale: "en",
    lookupLoginCq: "",
    lookupLoginQrz: "",
    lookupLoginQth: "",
    lookupOnTx: false,
    lookupCloseLog: false,
    lookupMerge: true,
    lookupMissingGrid: false,
    lookupPasswordCq: "",
    lookupPasswordQrz: "",
    lookupPasswordQth: "",
    lookupService: "CALLOOK",
    moonTrack: 0,
    mouseTracking: true,
    multicast: false,
    myBand: "OOB",
    myGrid: "",
    myCall: "NOCALL",
    myMode: "",
    myRawCall: "NOCALL",
    myRawFreq: "",
    myRawGrid: "",
    // Settings -> General -> Station Callsign: used while no connected instance gives a callsign (applyStationCallsign)
    stationCallsign: "",
    // The instance the map showed at the last exit, shown again when it comes back soon after the start (handleInstanceStatus)
    expectedInstance: "",
    oamsBandActivity: true,
    oamsBandActivityNeighbors: false,
    pathWidthWeight: 1.0,
    potaFeatureEnabled: true,
    // SOTA Chasing (Settings -> Features -> Online): SOTA activators from DX Feeds spots in the Feed Roster
    sotaFeatureEnabled: false,
    // Logbook -> Export SOTA Chaser Log: where the last export ended (seconds), and the station of its newest QSO, so
    // the next export starts there without sending that QSO twice
    sotaLastChaserExport: 0,
    sotaLastChaserExportCall: "",
    potaMapEnabled: false,
    pushPinMode: false,
    qrzPathWidthWeight: 1.2,
    sixWideMode: 0,
    soundCard: "default",
    soundCardName: null,
    soundcards: null,
    warnOnSoundcardsChange: false,
    spotView: 0,
    windowTheme: "dark",
    appTheme: "ega80s",
    useLocalTime: 0,
    wsjtForwardUdpEnable: false,
    wsjtForwardUdpIp: "127.0.0.1",
    wsjtForwardUdpPort: 2238,
    wsjtIP: "",
    wsjtUdpPort: 0,

    adifBroadcastEnable: false,
    adifBroadcastPort: 2333,
    adifBroadcastIP: "",
    adifBroadcastMulticast: false,

    workingCallsignEnable: false,
    workingCallsigns: {},
    workingGridEnable: false,
    workingGrids: {},
    workingDateEnable: false,
    workingDate: 0,
    // No longer used: the Logbook scrolls its whole list (kept so saved settings don't change)
    qsoItemsPerPage: 100,
    qslAuthority: "L",
    collapsedMapViewFilters: false,
    logEventMedia: "Ping-coin.mp3",
    buttonPanelOrder: [],
    // The control panel's boxes (Band Activity, the counts, Map View Filters, the button grid) in the order dragged to by their top
    // borders (panelBoxes.js); empty: the page's order
    panelBoxOrder: [],
    // The Event Viewer button (ui/events.js): "main" shows the events in a panel in the main window, "window" in a window of their own
    eventViewer: "main",
    // Where the user dragged the main window's Event Viewer panel to ({ x, y } in the window), null while it is where it comes up
    eventViewerPos: null,
    // Settings -> General -> Station: the station's height above sea level, in meters (shown in feet with miles or nautical miles);
    // BirdWatch reckons look angles, Doppler and the horizon (rise and set) from it
    myElevation: 0,
    // The size the user gave the main window's Event Viewer panel ({ w, h } in px, its corner dragged), null while it fits its columns
    eventViewerSize: null,
    // Settings -> General: an error (an event in red: a log upload that failed, ...) opens the Event Viewer where it is set to show.
    // It took over from the traffic list's Decode Traffic Waterfall (map.trafficDecode), whose choice it carries over
    openEventViewerOnError: true
  },
  appLogs: [],
  map: {
    allGridOpacity: 1,
    animate: true,
    // Flight path animation steps per second, 1 to 30 (was animateSpeed, screen frames per step: converted at startup)
    animateFps: 15,
    CQhilite: true,
    predMode: 0,
    predOpacity: 0.4,
    predLegend: true,
    spotLegend: true,
    fitQRZ: false,
    focusRig: true,
    gridAlpha: 136,
    // POTA, SOTA and DX Feeds markers that would overlap are drawn as one (groupOverlappingFeatures)
    groupSpots: true,
    // Settings -> General -> Display -> Enable Casting (the button panel's Cast button), the device cast to last, the port its video is
    // served on, and without a hardware encoder the software encoder's frame rate and resolution (its height: 480 to 2160) (mapCast.js)
    castEnable: false,
    castDevice: { id: "", name: "", host: "" },
    // The devices being cast to ([{ id, name, host }]), kept as the app closes: cast to again at the next start (each taken off as its
    // cast stops while the app runs)
    castDevices: [],
    castPort: 21575,
    castSoftwareFps: 10,
    castSoftwareHeight: 720,
    haltAllOnTx: true,
    longitude: 0.0,
    latitude: 0.0,
    mapOpacity: 1,
    mapIndex: "Street by Esri (English)",
    terminatorDegreeIndex: 1,
    offlineMapIndex: "Satellite by MapTiler (No Labels)(Offline)",
    mergeOverlay: false,
    mouseOver: true,
    nightMapOpacity: 0.8,
    nightMapEnable: false,
    nightMapIndex: "Dark Gray by Esri (English)",
    offlineNightMapIndex: "Toner by Stamen (No Labels)(Offline)",
    nightPathColor: 361,
    nightQrzPathColor: 1,
    offlineMode: false,
    pathColor: 0,
    qrzDxccFallback: false,
    qrzPathColor: 1,
    graylineOpacity: 0.1,
    splitQSL: true,
    showRangeRings: false,
    rangeRingDistance: 2500,
    rangeRingColor: 0,
    equator: false,
    equatorColor: 0,
    dxcwFeed: false,
    // Button panel SOTA button (shown while SOTA Chasing runs): summits with activators on the map
    sotaMap: true,
    usRadar: false,
    timezonesEnable: 0,
    showAllGrids: false,
    trophyOverlay: 0,
    zoom: 4,
    mapTrans: 0.5,
    apiKeys: {},
    projection: "EPSG:3857",
    backgroundColor: {
      "Bathymetric Oceans by GEBCO (No Labels)": "#396ca7",
      "City Lights by NASA (No Labels)": "#000000",
      "Dark Gray by Esri (English)": "#232227",
      "Dark Matter by Carto (English)": "#262626",
      "Dark Matter by Carto (No Labels)": "#262626",
      "HamGames by N0TTL (Intl)(Offline)": "#000000",
      "Humanitarian by OpenStreetMap (Intl)": "#90cccb",
      "Light Gray by Esri (English)": "#d0ced2",
      "Mapnik by OpenStreetMap (Deutsch)": "#aad3df",
      "Mapnik by OpenStreetMap (français)": "#b4d0d0",
      "National Geographic by Esri (English)": "#80b3de",
      "Oceans by Esri (No Labels)": "#94b9e5",
      "Physical by Esri (No Labels)": "#76abcb",
      "Positron by Carto (English)": "#d4dadc",
      "Positron by Carto (No Labels)": "#d4dadc",
      "Satellite by Esri (No Labels)": "#002f45",
      "Satellite by MapTiler (No Labels)(Offline)": "#0e2034",
      "Shaded Relief by Esri (No Labels)": "#9ebcd8",
      "Street by Esri (English)": "#99d9f2",
      "Terrain by Esri (No Labels)": "#63d7db",
      "Toner by Stamen (No Labels)(Offline)": "#000000",
      "Topographical by Esri (English)": "#b8e6fe",
      "Voyager by Carto (English)": "#d5e8eb",
      "Voyager by Carto (No Labels)": "#d5e8eb",
      "天地图 卫星 (Chinese)": "#000000",
      "天地图 地形 (Chinese)": "#000000",
      "天地图 矢量 (Chinese)": "#000000"
    }
  },
  adifLog: {
    menu: {
      buttonAdifCheckBox: false,
      buttonClubCheckBox: false,
      buttonLOTWCheckBox: false,
      buttonQRZCheckBox: false,
      buttonPsk24CheckBox: false
    },
    startup: {
      loadGTCheckBox: true,
      loadAdifCheckBox: false,
      loadPsk24CheckBox: false,
      loadQRZCheckBox: false,
      loadLOTWCheckBox: false,
      loadClubCheckBox: false
    },
    qsolog: {
      logQRZqsoCheckBox: false,
      logGTqsoCheckBox: true,
      logLOTWqsoCheckBox: false,
      logHRDLOGqsoCheckBox: false,
      logClubqsoCheckBox: false,
      logCloudlogQSOCheckBox: false,
      logeQSLQSOCheckBox: false,
      logHamCQqsoCheckBox: false
    },
    nickname: {
      nicknameeQSLCheckBox: false
    },
    text: {
      lotwLogin: "",
      clubCall: "",
      clubEmail: "",
      clubPassword: "",
      lotwPassword: "",
      lotwTrusted: "",
      lotwStation: "",
      qrzApiKey: "",
      HRDLOGCallsign: "",
      HRDLOGUploadCode: "",
      CloudlogURL: "http://127.0.0.1",
      CloudlogAPI: "",
      CloudlogStationProfileID: "1",
      eQSLUser: "",
      eQSLPassword: "",
      eQSLNickname: "",
      HamCQApiKey: ""
    },
    lastFetch: {
      lotw_qsl: 0
    }
  },
  msg: {
    msgSimplepush: false,
    msgSimplepushApiKey: "",
    msgSimplepushNotifyOnly: false,
    msgSimplepushDailySchedule: false,
    msgSimplepushScheduleStart: 0,
    msgSimplepushScheduleEnd: 0,
    msgPushover: false,
    msgPushoverUserKey: "",
    msgPushoverToken: "",
    msgPushoverDailySchedule: false,
    msgPushoverScheduleStart: 0,
    msgPushoverScheduleEnd: 0,

  },
  reception: {
    viewHistoryTimeSec: 900,
    pathColor: -1,
    pathNightColor: 361,
    spotWidth: 0.8,
    mergeSpots: true
  },
  N1MM: {
    enable: false,
    port: 2333,
    ip: "127.0.0.1"
  },
  log4OM: {
    enable: false,
    port: 2236,
    ip: "127.0.0.1",
    // Remote control (log4om.js): Connect, Enable Rig Control, Log4OM's remote-control port and its data-output port
    // (where its Radio Status goes; Log4OM's own defaults)
    connect: false,
    rigControl: false,
    rcPort: 2241,
    rcOutputPort: 2242
  },
  dxkLog: {
    enable: false,
    port: 52000,
    ip: "127.0.0.1"
  },
  HRDLogbookLog: {
    enable: false,
    port: 7826,
    ip: "127.0.0.1"
  },
  acLog: {
    enable: false,
    port: 1100,
    ip: "127.0.0.1",
    menu: false,
    startup: false,
    qsl: "A",
    connect: false,
    rigControl: false
  },
  // N3FJP Contest Log (n3fjpContest.js): Connect, its API's address and port (AC Log keeps 1100), Enable Rig Control, and
  // Also Log To My Other Logs (its QSOs to the logs and services GridTracker logs to)
  n3fjpContest: {
    connect: false,
    ip: "127.0.0.1",
    port: 1101,
    rigControl: false,
    logOthers: false
  },
  trustedQsl: {
    stationFile: "",
    stationFileValid: false,
    binaryFile: "",
    binaryFileValid: false
  },
  callsignLookups: {
    lotwUseEnable: true,
    lotwWeeklyEnable: true,
    lotwLastUpdate: 0,
    eqslUseEnable: true,
    eqslWeeklyEnable: true,
    eqslLastUpdate: 0,
    ulsUseEnable: true,
    ulsWeeklyEnable: true,
    ulsLastUpdate: 0,
    cacUseEnable: true,
    cacWeeklyEnable: true,
    cacLastUpdate: 0,
    oqrsUseEnable: false,
    oqrsWeeklyEnable: false,
    oqrsLastUpdate: 0
  },
  bandActivity: {
    lastUpdate: {},
    lines: {}
  },
  // The Gridsquare Colors; saved under this name in existing settings files, so it is not renamed
  legendColors: {
    QSO: "#EEEE00",
    QSL: "#EE0000",
    QSX: "#1111EE",
    CQ: "#00FF00",
    CQDX: "#00FFFF",
    QRZ: "#FFFF00",
    QTH: "#FFA600"
  },
  // CatRotator / PstRotator as the service it was: kept for the settings files that have it, carried over to rotor by rotorMigrate
  pstrotator: {
    enable: false,
    port: 12000,
    ip: "127.0.0.1"
  },
  // Rotor Control (Settings -> Features -> Service, rotor.js): an antenna rotator on a serial port (gs232, easycomm, spid) or through
  // Hamlib's rotctld (host, netPort) or CatRotator / PstRotator (host, udpPort). The serial port chosen is kept by its identity, so it
  // is opened again at each start. follow: the rotator tracks BirdWatch's selected satellite
  rotor: { enable: false, protocol: "gs232", baud: 9600, dataBits: 8, parity: "none", stopBits: 1, port: null, host: "127.0.0.1", netPort: 4533, udpPort: 12000, follow: true, connect: true },
  // Rig Control (Settings -> Features -> Service, rig.js): the VFOs, VFO-A, VFO-B ... by their place in vfos. Each { id, name (the
  // user's own, shown after its letter), connect (unchecked: let go while its settings are changed; unchecked until the user checks it,
  // so nothing is opened before the VFO is set up), offset (its converter: an LNB, an
  // upconverter, a transverter, in Hz: the rig's dial is the frequency on the air plus it), source: "own" a rig of its own, through
  // Hamlib's rigctld (host, netPort), flrig (host, flrigPort), SPY Server by Airspy (host, spyPort), SDR++ Server (host, sdrppPort;
  // sdrppFreq where it was last tuned) or on a serial port (port, baud ...; civAddress in hex only to insist on
  // one: the rig is asked for its own; forceVfo: rigctld's VFO mode asked for on Rig Control's own connection, as rigctld --vfo gives),
  // or "of" the second VFO (VFO B, or Sub) of the VFO whose id is in of; satRanges: what BirdWatch may use it for, [{ lo, hi (MHz on the air;
  // both 0 every frequency), dir ("rx", "tx" or "both") }], left out every frequency receive only }. The list's order is BirdWatch's priority.
  // BirdWatch and the Multi-Mode Decoder pick theirs by id
  Rigs: {
    enable: false,
    vfos: [
      { id: "v1", name: "", connect: false, offset: 0, ssbData: false, source: "own", of: null, protocol: "rigctld", host: "127.0.0.1", netPort: 4532, flrigPort: 12345, spyPort: 5555, sdrppPort: 5259, port: null, baud: 19200, dataBits: 8, parity: "none", stopBits: 1, civAddress: "", forceVfo: false },
      { id: "v2", name: "", connect: false, offset: 0, ssbData: false, source: "of", of: "v1", protocol: "rigctld", host: "127.0.0.1", netPort: 4532, flrigPort: 12345, spyPort: 5555, sdrppPort: 5259, port: null, baud: 19200, dataBits: 8, parity: "none", stopBits: 1, civAddress: "", forceVfo: false }
    ]
  },
  // Multi-Mode Decoder (Settings -> Features -> Service, mmDecoder.js): decodes in its window from the Input Device. span: its Bandwidth, the audio decoded from 0 Hz up (an SDR's can be wide). minHz, maxHz: within it, the audio decoded (Hz;
  // the Multi-Mode Decoder's [ and ], dragged on its scale; maxHz 0 is the span's top; the mode shown's, each mode's own kept in ranges:
  // { cw: { minHz, maxHz } }, a mode with none starting with the last one's). fallSpeed: the Waterfall
  // Speed, every mode's (1 as heard; set at startup from the mode shown's own, from before). fallShare: the waterfall's height as a share of its window, dragged on the bar under it (0: as laid out).
  // ft8Depth: the FT8 Decoder's Depth, "normal" (ft8_lib as it comes) or "deep" (ft8wasm.c's passes, fine reading, guesses ...).
  // ft8SendDecodes, ft4SendDecodes: Send Decodes To Call Roster, FT8's (or FT4's) decodes into the Call Roster too, not only the map,
  // through GridTracker's instance MMD (open while the decoder is on, in the window's Mode) (both off).
  // PSK31, RTTY, MFSK and DominoEX / THOR (thor): their Set Frequency and Set Mode (USB). pskSubmode ("psk31", "psk63", "psk125",
  // "qpsk31"), mfskSubmode ("mfsk16", "mfsk32"), thorSubmode ("dominoex 11", "thor 16", "dominoex all" ...): their submode menus. NAVTEX (navtex), Feld-Hell (hell) and WEFAX (wefax): their Set Frequency and Set
  // Mode (USB); hellSubmode ("feld", "x5", "x9"), hellTrim (ppm: the print's slant), wefaxLpm and wefaxIoc ("auto" or a number), wefaxTrim (ppm: the chart's slant).
  // navtexSave: NAVTEX's Save Messages, each complete message as a text file in NAVTEX Messages (off).
  // Olivia: oliviaSubmode ("olivia 8/500", "contestia 16/500" ...: its menu), oliviaCenter (audio Hz: where its signal is).
  // followBirdWatch: the mode follows the transmitter BirdWatch's rig follows (off). utcLines: the waterfall's UTC menu, a line on the
  // UTC clock every 10, 15, 30 or 60 s (0 none) in every mode but FT8 and FT4. ft8SlotFinder, ft4SlotFinder: the clearest places to
  // transmit marked on the waterfall (off unless turned on). rsid: the RSIDs heard in every mode named on the waterfall (on). commonInput, commonVfo:
  // every mode on the one Input Device (inputs.common) and the one VFO (vfos.common: None until picked), each mode's own kept for when
  // they're off (on).
  // viewMode: the mode the window decodes (its Mode menu): "cw", "ft8", "ft4", "sstv", "packet" ...; the instance MMD's mode too, with the
  // window closed. FT4's own: ft4SetFreq, ft4SetMode (its mode
  // USB). USB or LSB is set as the rig's data mode when the VFO's SSB Data is checked (Rigs.vfos[].ssbData).
  // rigControl (the window's Settings, Decoders): whether the decoder may send the rig anything at all; then for each mode, a frequency
  // picked in the window's Frequency menu: ft8SetFreq, cwSetFreq, sstvSetFreq, packetSetFreq tune the rig there, ft8SetMode, cwSetMode,
  // sstvSetMode, packetSetMode set its mode (each on its own; FT8 USB, its data mode with the VFO's SSB Data; CW CW; SSTV its sideband; Packet FM,
  // HF packet LSB), on unless turned off.
  // rigControl off: nothing is sent unless turned on.
  // WEFAX's own the same way: wefaxSave each chart saved as it ends, into wefaxFolder ("": WEFAX Charts beside it, mmDecoderWefaxFolder).
  // The SSTV Decoder's: sstvSave each picture saved as it ends, into sstvFolder ("": SSTV Pictures in
  // GridTracker's own folder, mmDecoderSstvFolder). saveAsDir: where a picture was last saved with Save, by kind, { sstv, wefax }
  // (mmdSstvSaveAs: the dialog opens there next time). inputs: each mode's Input Device, { cw: { id, name } } (its menu in the window);
  // inputCards: the audio inputs last seen, { id: name }, so a change is warned of (mmDecoderInputsCheck). swGain: each mode's SW level
  // (a gain inside the decoder, dB), { cw: 0 }. vfos: the Rig Control VFO each mode reads and tunes, by its id, { cw: "v1" } ("": none;
  // a mode not in it: the first VFO). tuneLocked: the lock on the divider beside the frequency (mmdTuneLockClick): unlocked, the mouse
  // wheel over the frequency tunes the rig (mmdTuneWheel); locked unless unlocked
  MMD: { vfos: {}, tuneLocked: true, enable: false, viewMode: "cw", span: 4000, minHz: 250, maxHz: 0, fallShare: 0, ft8Depth: "normal", rigControl: false, ft8SetFreq: true, ft8SetMode: true, ft8SendDecodes: false, ft4SetFreq: true, ft4SetMode: true, ft4SendDecodes: false, followBirdWatch: false, utcLines: 30, ft8SlotFinder: false, ft4SlotFinder: false, rsid: true, commonInput: true, commonVfo: true, psk31SetFreq: true, psk31SetMode: true, rttySetFreq: true, rttySetMode: true, mfskSetFreq: true, mfskSetMode: true, thorSetFreq: true, thorSetMode: true, navtexSetFreq: true, navtexSetMode: true, hellSetFreq: true, hellSetMode: true, wefaxSetFreq: true, wefaxSetMode: true, wsprSetFreq: true, wsprSetMode: true, oliviaSetFreq: true, oliviaSetMode: true, hellSubmode: "feld", hellTrim: 0, navtexSave: false, wefaxLpm: "auto", wefaxIoc: "auto", wefaxTrim: 0, pskSubmode: "psk31", mfskSubmode: "mfsk16", thorSubmode: "dominoex 11", oliviaSubmode: "olivia 8/500", oliviaCenter: 1500, cwSetFreq: true, cwSetMode: true, sstvSetFreq: true, sstvSetMode: true, packetSetFreq: true, packetSetMode: true, sstvSave: false, sstvFolder: "", wefaxSave: false, wefaxFolder: "", saveAsDir: {}, inputs: {}, inputCards: null, swGain: {}, scopeOob: 18 },
  // Network Audio (Settings -> Features -> Service, its streams in the Radios tab; netAudio.js): audio streams on the LAN, each an Input Device or an Output Device of the
  // Multi-Mode Decoder. streams: [{ id ("n1" ...), name (the user's own), connect (unchecked: not opened, its settings free to change),
  // protocol ("vban", "rtp", "pulse": NET_AUDIO_PROTOCOLS), dir ("in", "out"), host, port, streamName, rate, channels, channel ("left",
  // "right", "mix": what a stereo input gives the decoder) }]. The audio of a Rig Control VFO whose protocol carries it (FlexRadio DAX,
  // Icom LAN) is listed too, without being set up here
  NetAudio: { enable: false, streams: [] },
  audio: {
    alertMute: 0,
    speechRate: 1,
    speechPitch: 1,
    speechVolume: 1,
    speechVoice: 0,
    speechPhonetics: true,
    volume: 1
  },
  audioAlerts: {
    rules: {
      everyDecode: false
    },
    wanted: {
      huntCallsign: false,
      huntGrid: false,
      huntDXCC: false,
      huntCQz: false,
      huntDXM: false,
      huntITUz: false,
      huntState: false,
      huntCounty: false,
      huntCont: false,
      huntPX: false,
      huntPOTA: false,
      // Feed Roster only (SOTA Chasing); listed here so Settings -> Audio Alerts builds its row
      huntSOTA: false,
      huntWatcher: false,
      huntAward: false,
      huntMultiple: false,
    },
    media: {
      huntCallsignType: "tts",
      huntGridType: "tts",
      huntDXCCType: "tts",
      huntCQzType: "tts",
      huntDXMType: "tts",
      huntITUzType: "tts",
      huntStateType: "tts",
      huntCountyType: "tts",
      huntContType: "tts",
      huntPXType: "tts",
      huntPOTAType: "tts",
      huntSOTAType: "tts",
      huntWatcherType: "tts",
      huntAwardType: "tts",
      huntMultipleType: "tts",

      huntCallsignFileSingle: "none",
      huntGridFileSingle: "none",
      huntDXCCFileSingle: "none",
      huntCQzFileSingle: "none",
      huntDXMSingle: "none",
      huntITUzFileSingle: "none",
      huntStateFileSingle: "none",
      huntCountyFileSingle: "none",
      huntContFileSingle: "none",
      huntPXFileSingle: "none",
      huntPOTAFileSingle: "none",
      huntSOTAFileSingle: "none",

      huntWatcherFileSingle: "none",
      huntAwardFileSingle: "none",
      huntMultipleFileSingle: "none",

      huntCallsignFileMulti: "none",
      huntGridFileMulti: "none",
      huntDXCCFileMulti: "none",
      huntCQzFileMulti: "none",
      huntDXMMulti: "none",
      huntITUzFileMulti: "none",
      huntStateFileMulti: "none",
      huntCountyFileMulti: "none",
      huntContFileMulti: "none",
      huntPXFileMulti: "none",
      huntPOTAFileMulti: "none",
      huntSOTAFileMulti: "none",

      huntWatcherFileMulti: "none",
      huntAwardFileMulti: "none",
      huntMultipleFileMulti: "none",

      huntCallsignSpeechSingle: "Wanted Callsign",
      huntGridSpeechSingle: "Wanted Grid",
      huntDXCCSpeechSingle: "Wanted DXCC",
      huntCQzSpeechSingle: "Wanted CQ zone",
      huntDXMSpeechSingle: "Wanted DX Marathon",
      huntITUzSpeechSingle: "Wanted I-T-U zone",
      huntStateSpeechSingle: "Wanted State",
      huntCountySpeechSingle: "Wanted County",
      huntContSpeechSingle: "Wanted Continent",
      huntPXSpeechSingle: "Wanted Prefix",
      huntPOTASpeechSingle: "Wanted Park",
      huntSOTASpeechSingle: "Wanted Summit",

      huntWatcherSpeechSingle: "Wanted Watcher",
      huntAwardSpeechSingle: "Wanted Award",
      huntMultipleSpeechSingle: "not visible",

      huntCallsignSpeechMulti: "Many Callsigns",
      huntGridSpeechMulti: "Many Grids",
      huntDXCCSpeechMulti: "Many DXCCs",
      huntCQzSpeechMulti: "Many CQ zones",
      huntDXMSpeechMulti: "Many DX Marathon",
      huntITUzSpeechMulti: "Many I-T-U zones",
      huntStateSpeechMulti: "Many States",
      huntCountySpeechMulti: "Many Counties",
      huntContSpeechMulti: "Many Continents",
      huntPXSpeechMulti: "Many Prefixes",
      huntPOTASpeechMulti: "Many Parks",
      huntSOTASpeechMulti: "Many Summits",

      huntWatcherSpeechMulti: "Many Watchers",
      huntAwardSpeechMulti: "Many Awards",
      huntMultipleSpeechMulti: "Many Wanted Entities",

      // On ATNO: said / played in place of On Single / On Multiple when one of the alerting stations is an ATNO (DXCC
      // never worked, park never hunted, summit never chased); Multiple's when that comes with other wanted types.
      // Empty text or no file: the usual alert
      huntDXCCFileAtno: "Phazzz-3.mp3",
      huntPOTAFileAtno: "Phazzz-2.mp3",
      huntSOTAFileAtno: "Phazzz-1.mp3",
      huntMultipleFileAtno: "Longlaser1.mp3",

      huntDXCCSpeechAtno: "ATNO DXCC",
      huntPOTASpeechAtno: "ATNO Park",
      huntSOTASpeechAtno: "ATNO Summit",
      huntMultipleSpeechAtno: "Many ATNO",
    }
  },
  customAlerts: {},
  mapMemory: [],
  startupLogs: [],
  awardTracker: {},
  ignoredCQ: {},
  ignoredCalls: {},
  ignoredGrid: {},
  ignoredDxcc: {},
  ignoredCQz: {},
  ignoredITUz: {},
  // Band colors the user changed (band -> 6-digit hex); bands not listed use the built-in GT.bandColors table
  bandColors: {},
  // Mode colors the user changed (mode -> 6-digit hex); modes not listed use their color in data/modes.json
  modeColors: {},
  // Feed Roster: DX Cluster / CW Skimmer spotters (base callsign) whose spots are dropped
  ignoredSpotters: {},
  roster: {
    exceptions: {
      onlyHits: false,
      requireGrid: false,
      wantMaxDT: false,
      wantMinDB: false,
      wantMinFreq: false,
      wantMaxFreq: false,
      wantRRCQ: false,
      maxDT: 0.5,
      minDb: -25,
      minFreq: 0,
      maxFreq: 3500,
      noMyDxcc: false,
      onlyMyDxcc: false,
      cqOnly: false,
      usesLoTW: false,
      maxLoTW: 27,
      useseQSL: false,
      usesOQRS: false,
      onlySpot: false,
      allOnlyNew: false,
    },
    logbook: {
      huntNeed: "confirmed",
      referenceNeed: "0",
    },
    wanted: {
      huntCallsign: false,
      huntGrid: true,
      huntDXCC: true,
      huntCQz: false,
      huntITUz: false,
      huntState: true,
      huntCounty: false,
      huntCont: false,
      huntPX: false,
      huntPOTA: false,
      huntSOTA: false,
      huntWatcher: false,
      huntDXM: false,
    },
    columns: {
      Callsign: true,
      Band: false,
      Mode: false,
      Calling: true,
      Rig: false,
      Wanted: false,
      Grid: true,
      Msg: false,
      DXCC: true,
      Flag: true,
      State: true,
      County: false,
      POTA: false,
      // Shown while SOTA Chasing runs: decoded activators DX Feeds spots on a summit
      SOTA: false,
      Cont: false,
      dB: true,
      Freq: false,
      DT: false,
      Dist: false,
      Azim: false,
      DXM: false,
      CQz: false,
      ITUz: false,
      PX: false,
      LoTW: false,
      eQSL: false,
      OQRS: false,
      Spot: false,
      Life: false,
      Age: true,
      UTC: false
    },
    columnOrder: [
      "Callsign", "Band", "Mode", "Calling", "Grid", "DXCC", "Flag", "State", "County",
      "POTA", "SOTA", "DXM", "Cont", "Msg",
      "dB", "Freq", "DT", "Dist", "Azim",
      "CQz", "ITUz", "PX",
      "Rig", "Wanted", "LoTW", "eQSL", "OQRS",
      "Life", "Spot", "Age", "UTC"
    ],
    // Column colors, edited in the Call Roster's Settings -> Colors (column -> 6-digit hex)
    colors: { ...k_callRosterColumnColors },
    // Window-wide (both roster tabs): displayFilters, realtime, controls, controlsExtended,
    // clearRosterOnBandChange, rosterAlwaysOnTop, rosterDelayOnFocus, rosterDelayTime, activeTab
    activeTab: "call",
    displayFilters: {
      brightness: 100,
      contrast: 100,
      saturate: 100,
      invert: 0,
      sepia: 0,
      huerotate: 0
    },
    realtime: true,
    controls: true,
    controlsExtended: true,
    compact: false,
    sortColumn: "Age",
    sortReverse: true,
    watcherSortColumn: "name",
    watcherSortReverse: false,
    clearRosterOnBandChange: true,
    rosterAlwaysOnTop: false,
    rosterDelayOnFocus: false,
    rosterDelayTime: 1500,
    rosterTime: 120,
    compactEntity: "DXCC",
    watchers: {}
  },
  // Feed Roster (DX Cluster / CW Skimmer spots): its own copy of the Call Roster's per-roster settings,
  // one fixed profile (no Band/Mode Memory). Window-wide settings stay in roster
  feedRoster: {
    exceptions: {
      onlyHits: false,
      requireGrid: false,
      wantMaxDT: false,
      wantMinDB: false,
      wantMinFreq: false,
      wantMaxFreq: false,
      wantRRCQ: false,
      maxDT: 0.5,
      minDb: -25,
      minFreq: 0,
      maxFreq: 3500,
      // DX DXCC (the spotted station's)
      noMyDxcc: false,
      onlyMyDxcc: false,
      // Spots where the station spotted itself
      hideSelfSpots: false,
      // Only spots on a band / in a mode one of the connected rigs (WSJT-X, JTDX, AC Log) is on
      autoBand: false,
      autoMode: false,
      cqOnly: false,
      usesLoTW: false,
      maxLoTW: 27,
      useseQSL: false,
      usesOQRS: false,
      onlySpot: false,
      allOnlyNew: false,
    },
    logbook: {
      huntNeed: "confirmed",
      referenceNeed: "0",
    },
    wanted: {
      huntCallsign: false,
      huntGrid: true,
      huntDXCC: true,
      huntCQz: false,
      huntITUz: false,
      huntState: true,
      huntCounty: false,
      huntCont: false,
      huntPX: false,
      huntPOTA: false,
      huntSOTA: false,
      huntWatcher: false,
      huntDXM: false,
    },
    columns: {
      Callsign: true,
      Band: true,
      Mode: true,
      CQ: true,
      Spotter: true,
      Wanted: false,
      Grid: true,
      Msg: false,
      DXCC: true,
      DEDXCCv2: true,
      Flag: true,
      State: true,
      County: false,
      POTA: false,
      SOTA: false,
      Cont: false,
      DEContv2: true,
      Freq: true,
      Dist: false,
      Azim: false,
      DXM: false,
      CQz: false,
      ITUz: false,
      PX: false,
      LoTW: false,
      eQSL: false,
      OQRS: false,
      Life: false,
      Age: true,
      UTC: false
    },
    columnOrder: [
      "Callsign", "Band", "Mode", "Spotter", "CQ", "Grid", "DXCC", "Flag", "State", "County", "Wanted", "Msg",
      "POTA", "SOTA", "DEDXCCv2", "DXM", "Cont", "DEContv2",
      "Freq", "Dist", "Azim",
      "CQz", "ITUz", "PX",
      "LoTW", "eQSL", "OQRS",
      "Life", "Age", "UTC"
    ],
    // Column colors, edited in the Feed Roster's Settings -> Colors, independent of the Call Roster's
    colors: { ...k_feedRosterColumnColors },
    compact: false,
    compactEntity: "DXCC",
    sortColumn: "Age",
    sortReverse: true,
    watcherSortColumn: "name",
    watcherSortReverse: false,
    // Feed Roster Max Age: 2 minutes (the map's Feed Spots Max Age is app.feedMaxAge)
    rosterTime: 120,
    watchers: {},
    // (Its Spots settings, feeds, moved to app.feeds: Settings -> Feeds)
    // Feed Roster ignores, independent of the Call Roster's (the top-level ignored* keys), no CQ ignores;
    // spotter ignores are feed-only already and stay in the top-level ignoredSpotters
    ignoredCalls: {},
    ignoredGrid: {},
    ignoredDxcc: {},
    // DE DXCC: spots from spotters in these DXCC entities
    ignoredDeDxcc: {},
    // DE Cont: spots from spotters on these continents
    ignoredDeCont: {},
    ignoredCQz: {},
    ignoredITUz: {}
  },
  // Feed Roster audio alerts: which wanted types alert, and their own sounds and speech
  // (media defaults to the same as audioAlerts.media, set below)
  feedAudioAlerts: {
    wanted: {
      huntCallsign: false,
      huntGrid: false,
      huntDXCC: false,
      huntCQz: false,
      huntDXM: false,
      huntITUz: false,
      huntState: false,
      huntCounty: false,
      huntCont: false,
      huntPX: false,
      huntPOTA: false,
      huntSOTA: false,
      huntWatcher: false,
      huntAward: false,
      huntMultiple: false,
    }
  },
  ByBandMode: {
    roster: {},
    exceptions: {},
    audioAlerts: {},
    customAlerts: {}
  },
};

def_settings.feedAudioAlerts.media = { ...def_settings.audioAlerts.media };
// Feed Roster speech says "Feed", to tell it from the Call Roster's: "Wanted Feed Grid", "Many Feed Grids"
for (const key in def_settings.feedAudioAlerts.media)
{
  if (/Speech(Single|Multi)$/.test(key))
  {
    def_settings.feedAudioAlerts.media[key] = def_settings.feedAudioAlerts.media[key].replace(/^(Wanted|Many) /, "$1 Feed ");
  }
}
// ... and "Feed ATNO DXCC", "Many Feed ATNO" (On ATNO)
for (const key of ["huntDXCCSpeechAtno", "huntPOTASpeechAtno", "huntSOTASpeechAtno"])
{
  def_settings.feedAudioAlerts.media[key] = "Feed " + def_settings.feedAudioAlerts.media[key];
}
def_settings.feedAudioAlerts.media.huntMultipleSpeechAtno = "Many Feed ATNO";

// Each roster's default columns, copied before anything can change them (new users' settings start as
// these very objects): for the roster windows' "Reset Columns to Default"
const def_rosterColumns = JSON.parse(JSON.stringify({
  call: { columns: def_settings.roster.columns, columnOrder: def_settings.roster.columnOrder },
  feed: { columns: def_settings.feedRoster.columns, columnOrder: def_settings.feedRoster.columnOrder }
}));

// Likewise each roster's default column colors, for "Reset Colors"
const def_rosterColors = JSON.parse(JSON.stringify({
  call: def_settings.roster.colors,
  feed: def_settings.feedRoster.colors
}));

const def_mapMemory = {
  zoom: -1,
  LoLa: [0, 0],
  bearing: 0
};

