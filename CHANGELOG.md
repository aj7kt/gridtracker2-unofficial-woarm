# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),

## [v2.261113.2]

### MD Markup Format
#### Map / UI

- New App Themes (Settings, General, Display): GridTracker2's own colors, now with one meaning each everywhere (frequency, band, mode, callsign, grid and the rest), plus Opus' Choice and 27 more themes
  - Retro computers (EGA, CGA, VGA, Amber CRT, Apple ][e, VIC-20, C-64), nature and seasons, just for fun, and easy on the eyes (High Contrast, Colorblind Safe, Night Vision, OLED Minimal and more)
  - A theme colors every window and control at once; the Call Roster and Feed Roster keep the colors you set in their Settings
- New Casting (Settings, Features, Casting): show the map live on your TV through a Chromecast, a Google TV Streamer or a DLNA player such as Kodi, with a new Cast button in the button panel
  - Cast to one TV or to several at once; GridTracker2 remembers them and casts to them again at the next start
  - A number on the Cast button shows how many are watching
  - The video is standard HLS, so VLC, Safari, Kodi and most other players on your network can show the map too
  - Turn on Announce On Network and the map shows up as a media server on your network, so Kodi, VLC, the Roku Media Player app and smart TVs find it themselves
- DX Feeds and SOTA markers now show when you've worked them, as POTA's parks do: with a radio on the spot's band and mode, a check mark replaces the target once you've worked that call, as the Feed Roster counts it (DX Feeds), or worked that summit today (SOTA)
- Band Activity, the counts and the Map View Filters can be rearranged in the control panel: drag a box by its top border (Settings, General, Reset Panels puts them back)
- The Kp button now grows smoothly under the mouse, like the other buttons
- New Mode Colors (Settings, Colors): choose the color of each mode, as Band Colors does for bands; the rosters and the Statistics window show them

#### Multi-Mode Decoder

- New Multi-Mode Decoder (Settings, Features): decode signals right inside GridTracker2, without another program, from your rig's audio or an SDR, with a waterfall of the whole passband
  - Modes: CW, SSTV, satellite data (FUNcube, AX.100, GENESIS) and WWV / WWVH
  - Manage Decoders..., the Mode menu's last entry: download more decoders, update or remove them, and turn them on or off
  - In most modes every signal in the passband is decoded at once
  - It keeps decoding while its window is hidden or minimized; a green dot on its button shows it's listening
  - With Rig Control: signals shown at their frequency on the air, a Frequency menu with each mode's usual frequencies on every band, and picking a mode tunes the rig to its main frequency
  - SSTV pictures are kept and can be saved
  - WWV / WWVH: NIST's time stations' time code (UTC, date, DUT1, leap second and daylight saving time), each station heard, and how far your PC clock is off from them, with a Set PC Clock button that asks your system for permission first (and notes the change in the Event Viewer)
  - WWV / WWVH's Best Signal Search: with Rig Control, listens on each WWV frequency in turn and tunes your rig to the one heard best
  - An Icom's own band scope (IC-7300 and others) can show above the waterfall
  - Detect Modes names every signal it hears, and Test Signals play recordings so you can try each mode
  - Log QSO: a decoded CW or SSTV QSO, or a phone QSO on your rig, opens the new Log QSO window filled in (with Log QSOs By Hand on)
  - Listens to any sound card, SDR++, SPY Server, or Network Audio (below)
  - The modes are written from their published specifications
  - The User Guide's Multi-Mode Decoder chapters describe every mode and setting
- WEFAX Auto-Tune now chooses each chart by how its station reaches the locator in Settings, General, My Grid: ground wave before the first F2 hop before a sporadic-E or two-hop path, falling back to the soonest chart when no modeled path reaches you
  - It takes the soonest chart unless that one would still be on when a chart with a better path is due, so charts that fit one after the other are all received
  - Changing My Grid while it waits makes it choose again
- WEFAX charts show the UTC date as well as the time in their caption
- WEFAX charts show the station they're from above their caption, and saved charts have its call sign in their file name
- WEFAX chart right-click: Print, Show In Folder, Auto-Align (a chart that started partway across the line put back in place) and Auto-Crop
  - Settings, Decoders, WEFAX: Auto-Align and Auto-Crop do the same to each chart as it ends, before it's saved- WEFAX and SSTV: the Up and Down arrow keys show the next picture up or down the strip
- No "(OOB)" after the frequency in WEFAX, NAVTEX and WWV / WWVH, whose frequencies are all outside the amateur bands

#### BirdWatch

- New BirdWatch (Settings, Features): amateur satellite tracking, right in GridTracker2
  - See your satellites move on the map with their footprints and ground tracks, and when each will pass over you
  - A BirdWatch panel for the selected satellite: when it rises or sets, where to point your antenna, its next pass, and views of it in your sky and over the Earth
  - A Pass Timeline of the next 24 hours, which you can also save to your calendar
  - The Transmitters window lists each satellite's downlinks and uplinks, corrected for Doppler as it moves
  - With Rig Control your radio follows the satellite's downlink and uplink through the whole pass, and with Rotor Control your antenna points at it
  - Auto-Track selects the next satellite to rise, and Pass Alerts tell you a few minutes before a pass begins
  - Each satellite shows what it can be worked with (FM voice, a linear transponder for SSB and CW, digital modes, or SSTV pictures), and Add Satellite can list only the FM ones for your handheld, or any of the others
  - Skeds: the stations you share passes with, and your mutual passes for the next 72 hours; save them to your calendar, send them as text, or swap Sked Lines with other GridTracker2 users
  - QSOs you log while a satellite is up are logged as satellite contacts, with its name
  - The Multi-Mode Decoder can follow it, switching to the mode of the transmitter your radio follows
  - Works offline with the satellite data that comes with GridTracker2, and keeps it up to date while you're online, thanks to SatNOGS DB (Libre Space Foundation) and AMSAT
  - Newly launched amateur satellites that AMSAT doesn't list yet can be tracked too, from SatNOGS DB
  - The User Guide's BirdWatch chapter describes it all

#### Network Audio

- New Network Audio (Settings, Features): decode a rig connected to another computer over your home network, and send SSTV pictures back to it, with VBAN (Voicemeeter and others), RTP (PipeWire, PulseAudio) or PipeWire / PulseAudio over TCP
- Rig Control: two new protocols that bring the rig's audio as well: FlexRadio SmartSDR, and Icom LAN (IC-705, IC-7610, IC-9700 and IC-905 over the network, with no computer at the radio)

#### App

- New N3FJP Contest Log (Settings, Logging): chase stations from the Feed Roster during a contest with any of N3FJP's contest logs (CQ WW, WPX, Field Day, NAQP, the State QSO Parties and more), alongside AC Log
  - A spot you click goes to the contest log (with Enable Rig Control, your rig is tuned there too), and each QSO you log there shows as worked in GridTracker2 at once
  - Also Log To My Other Logs (off unless ticked) sends those QSOs on to AC Log and the other logs and services GridTracker2 logs to
- New Log QSO window (Settings, Logging, Log QSOs By Hand; off unless ticked): log a QSO you made by hand, from its new button in the side panel (or F2), a Feed Roster spot's right-click, or the Multi-Mode Decoder, into GridTracker2 and every logging program and online logbook you log to
  - A card in your App Theme's colors: the call large on top with its band, mode, grid, bearing and distance (in your Distance Units) and UTC, each field a tile, filled in from your rig, the spot (its park and summit too) and your callsign lookup
  - Unlock it to drag the fields where you want them; right-click to add any other ADIF field a QSO can have (parks and summits, location, contest, QSL, the contacted station, propagation ...), which stays on the card; each field is labeled by name, such as Station Callsign or Propagation Mode
  - Unlock Widths (right-click) makes each field one or two columns wide and sets how wide a column is; kept for each field, even one taken off and added again
  - A Retain switch on Power, Comment, Propagation Mode, Satellite, Satellite Mode and Rx Freq keeps what you type there for the next QSO, also after a restart (Power on to start with)
  - The lock is the card's master lock: while it's shut, the card can't be rearranged, no field can be taken off, and its window can't be resized; the card always opens with it shut
  - Double-click a call in the Feed Roster to log it
  - Two tabs: QSO and My Station (your callsign, grid, zones, state and county, DXCC and rig filled in from what GridTracker2 knows, and every other field of your own station to add); what you type on My Station is kept for every card from then on
  - Clearing the call, or typing one on a card that came without one, clears the other fields for the next QSO and sets the time to now, keeping the mode and your rig's frequency
  - It follows your rig's frequency and voice mode while open, and starts in the last mode you used this session when nothing else gives it one
  - Each field's tooltip names its ADIF field and says what ADIF puts in it; fields with a set list (band, propagation mode, continent, ARRL section, QSL codes, contest names, DXCC, the states of the QSO's DXCC entity ...) offer its values, and a county box offers the counties of the state filled in
  - The POTA and SOTA boxes search POTA's parks (with POTA Hunting on) and SOTA's summits (with SOTA Chasing on) by reference or name as you type
  - Each field is checked as you type against the ADIF rules for it, such as a 4, 6, 8 or 10 character grid, the CQ and ITU zones, IOTA and WWFF references, dates, latitude and longitude (decimal degrees are changed to ADIF's form)
  - The Feed Roster's POTA and SOTA columns now log through it too
- Add Lookup Data to QSO Log Event: lookup details only fill what the QSO has empty (name, state, county, zones ...), what your logging program sent or you typed is kept; a grid the QSO already has (the one the station sent, or one typed in) is kept, the lookup's grid only replaces one that isn't a real grid square
- A QSO's power keeps its fraction (0.5 W is logged as 0.5, no longer 0)
- Bands follow ADIF's band edges: 8m is 40 to 45 MHz and 4m 70 to 71 MHz, 141 to 143 MHz is no longer counted as 2m nor 219 to 221 MHz as 1.25m, 2200m ends at 137.8 kHz, 2.5mm starts at 119.98 GHz and 2mm reaches 149 GHz
  - New bands from ADIF: 560m, 5m (55 to 69 MHz) and submm, each with its own color and in the map's Band filter
- New Queue QSOs To Send Later (Settings, Logging, Send Later; off unless ticked): QSOs show as worked in GridTracker2 at once, and wait to go to your logging programs and online logbooks until you click Send All, online or offline, for example after a POTA trip; Export ADIF saves them to a file, and Send All After sends them on its own once that many are waiting
- Settings: a new Radios tab holds Rig Control, Rotor Control and Network Audio, and a new Radios button in the button panel opens it
- Rig Control: SSB Data sends the digital modes to the rig's data mode (USB-D, PKTUSB, DATA-U), and DTR and RTS can be set for interfaces that need them
- Rig Control: a rig found to have a second VFO gets one set up for satellite uplinks, not connected until you tick its Connect, shown side by side with the rig's own; a second VFO that's off still shows its frequency
- Settings: Open Event Viewer On Error is now in Features, Operational
- Event Viewer: View As Waterfall (right-click its button, or drag it onto the control panel) shows the events in the control panel, under the buttons, with the panel running the full height of the window beside the map; drag the line above them out over the map to put it back. Over the map, its header now shows how many events there are, with Clear and the X beside it
- Settings, Audio: Device is now called Output Device
- Lookup: the Callsign Lookup window has a new, shorter look in your App Theme's colors, and a callsign pasted with a space or in lower case no longer shows Unknown
- Statistics: the tables in every tab have a new look in your App Theme's colors, with every other row shaded and the row under the mouse highlighted, and bands and modes in their colors
- At startup the map goes back to the instance it was showing when you closed GridTracker2
- Every mode and submode in the ADIF standard is now known: QSOs and spots in them count as Digital or Phone, and each submode shows in its mode's color (THOR16 as THOR, USB as SSB)
  - New in Mode Colors and the map's Mode filter: CONTESTI, DMR, FREEDV, FSK, FSQCALL, JT44, JTMS, M17, MFSK11, MFSK64L, MFSK128L and MTONE
  - Statistics, Scores: a new Image type for SSTV, FAX and ATV QSOs, which counted as Other before; they now count toward Phone as well, as for DXCC, there and in the Call Roster's award tracking
- Fixed: a Feed Roster QSO logged by hand with a Park now keeps its park, in your logs and in its POTA spot

### HTML List

```html
<h4>Map / UI</h4>
<ul>
  <li>New App Themes (Settings, General, Display): GridTracker2's own colors, now with one meaning each everywhere (frequency, band, mode, callsign, grid and the rest), plus Opus' Choice and 27 more themes
    <ul>
      <li>Retro computers (EGA, CGA, VGA, Amber CRT, Apple ][e, VIC-20, C-64), nature and seasons, just for fun, and easy on the eyes (High Contrast, Colorblind Safe, Night Vision, OLED Minimal and more)</li>
      <li>A theme colors every window and control at once; the Call Roster and Feed Roster keep the colors you set in their Settings</li>
    </ul>
  </li>
  <li>New Casting (Settings, Features, Casting): show the map live on your TV through a Chromecast, a Google TV Streamer or a DLNA player such as Kodi, with a new Cast button in the button panel
    <ul>
      <li>Cast to one TV or to several at once; GridTracker2 remembers them and casts to them again at the next start</li>
      <li>A number on the Cast button shows how many are watching</li>
      <li>The video is standard HLS, so VLC, Safari, Kodi and most other players on your network can show the map too</li>
      <li>Turn on Announce On Network and the map shows up as a media server on your network, so Kodi, VLC, the Roku Media Player app and smart TVs find it themselves</li>
    </ul>
  </li>
  <li>DX Feeds and SOTA markers now show when you've worked them, as POTA's parks do: with a radio on the spot's band and mode, a check mark replaces the target once you've worked that call, as the Feed Roster counts it (DX Feeds), or worked that summit today (SOTA)</li>
  <li>Band Activity, the counts and the Map View Filters can be rearranged in the control panel: drag a box by its top border (Settings, General, Reset Panels puts them back)</li>
  <li>The Kp button now grows smoothly under the mouse, like the other buttons</li>
  <li>New Mode Colors (Settings, Colors): choose the color of each mode, as Band Colors does for bands; the rosters and the Statistics window show them</li>
</ul>
<h4>Multi-Mode Decoder</h4>
<ul>
  <li>New Multi-Mode Decoder (Settings, Features): decode signals right inside GridTracker2, without another program, from your rig's audio or an SDR, with a waterfall of the whole passband
    <ul>
      <li>Modes: CW, SSTV, satellite data (FUNcube, AX.100, GENESIS) and WWV / WWVH</li>
      <li>Manage Decoders..., the Mode menu's last entry: download more decoders, update or remove them, and turn them on or off</li>
      <li>In most modes every signal in the passband is decoded at once</li>
      <li>It keeps decoding while its window is hidden or minimized; a green dot on its button shows it's listening</li>
      <li>With Rig Control: signals shown at their frequency on the air, a Frequency menu with each mode's usual frequencies on every band, and picking a mode tunes the rig to its main frequency</li>
      <li>SSTV pictures are kept and can be saved</li>
      <li>WWV / WWVH: NIST's time stations' time code (UTC, date, DUT1, leap second and daylight saving time), each station heard, and how far your PC clock is off from them, with a Set PC Clock button that asks your system for permission first (and notes the change in the Event Viewer)</li>
      <li>WWV / WWVH's Best Signal Search: with Rig Control, listens on each WWV frequency in turn and tunes your rig to the one heard best</li>
      <li>An Icom's own band scope (IC-7300 and others) can show above the waterfall</li>
      <li>Detect Modes names every signal it hears, and Test Signals play recordings so you can try each mode</li>
      <li>Log QSO: a decoded CW or SSTV QSO, or a phone QSO on your rig, opens the new Log QSO window filled in (with Log QSOs By Hand on)</li>
      <li>Listens to any sound card, SDR++, SPY Server, or Network Audio (below)</li>
      <li>The modes are written from their published specifications</li>
      <li>The User Guide's Multi-Mode Decoder chapters describe every mode and setting</li>
    </ul>
  </li>
  <li>WEFAX Auto-Tune now chooses each chart by how its station reaches the locator in Settings, General, My Grid: ground wave before the first F2 hop before a sporadic-E or two-hop path, falling back to the soonest chart when no modeled path reaches you
    <ul>
      <li>It takes the soonest chart unless that one would still be on when a chart with a better path is due, so charts that fit one after the other are all received</li>
      <li>Changing My Grid while it waits makes it choose again</li>
    </ul>
  </li>
  <li>WEFAX charts show the UTC date as well as the time in their caption</li>
  <li>WEFAX charts show the station they're from above their caption, and saved charts have its call sign in their file name</li>
  <li>WEFAX chart right-click: Print, Show In Folder, Auto-Align (a chart that started partway across the line put back in place) and Auto-Crop
    <ul>
      <li>Settings, Decoders, WEFAX: Auto-Align and Auto-Crop do the same to each chart as it ends, before it's saved- WEFAX and SSTV: the Up and Down arrow keys show the next picture up or down the strip</li>
    </ul>
  </li>
  <li>No "(OOB)" after the frequency in WEFAX, NAVTEX and WWV / WWVH, whose frequencies are all outside the amateur bands</li>
</ul>
<h4>BirdWatch</h4>
<ul>
  <li>New BirdWatch (Settings, Features): amateur satellite tracking, right in GridTracker2
    <ul>
      <li>See your satellites move on the map with their footprints and ground tracks, and when each will pass over you</li>
      <li>A BirdWatch panel for the selected satellite: when it rises or sets, where to point your antenna, its next pass, and views of it in your sky and over the Earth</li>
      <li>A Pass Timeline of the next 24 hours, which you can also save to your calendar</li>
      <li>The Transmitters window lists each satellite's downlinks and uplinks, corrected for Doppler as it moves</li>
      <li>With Rig Control your radio follows the satellite's downlink and uplink through the whole pass, and with Rotor Control your antenna points at it</li>
      <li>Auto-Track selects the next satellite to rise, and Pass Alerts tell you a few minutes before a pass begins</li>
      <li>Each satellite shows what it can be worked with (FM voice, a linear transponder for SSB and CW, digital modes, or SSTV pictures), and Add Satellite can list only the FM ones for your handheld, or any of the others</li>
      <li>Skeds: the stations you share passes with, and your mutual passes for the next 72 hours; save them to your calendar, send them as text, or swap Sked Lines with other GridTracker2 users</li>
      <li>QSOs you log while a satellite is up are logged as satellite contacts, with its name</li>
      <li>The Multi-Mode Decoder can follow it, switching to the mode of the transmitter your radio follows</li>
      <li>Works offline with the satellite data that comes with GridTracker2, and keeps it up to date while you're online, thanks to SatNOGS DB (Libre Space Foundation) and AMSAT</li>
      <li>Newly launched amateur satellites that AMSAT doesn't list yet can be tracked too, from SatNOGS DB</li>
      <li>The User Guide's BirdWatch chapter describes it all</li>
    </ul>
  </li>
</ul>
<h4>Network Audio</h4>
<ul>
  <li>New Network Audio (Settings, Features): decode a rig connected to another computer over your home network, and send SSTV pictures back to it, with VBAN (Voicemeeter and others), RTP (PipeWire, PulseAudio) or PipeWire / PulseAudio over TCP</li>
  <li>Rig Control: two new protocols that bring the rig's audio as well: FlexRadio SmartSDR, and Icom LAN (IC-705, IC-7610, IC-9700 and IC-905 over the network, with no computer at the radio)</li>
</ul>
<h4>App</h4>
<ul>
  <li>New N3FJP Contest Log (Settings, Logging): chase stations from the Feed Roster during a contest with any of N3FJP's contest logs (CQ WW, WPX, Field Day, NAQP, the State QSO Parties and more), alongside AC Log
    <ul>
      <li>A spot you click goes to the contest log (with Enable Rig Control, your rig is tuned there too), and each QSO you log there shows as worked in GridTracker2 at once</li>
      <li>Also Log To My Other Logs (off unless ticked) sends those QSOs on to AC Log and the other logs and services GridTracker2 logs to</li>
    </ul>
  </li>
  <li>New Log QSO window (Settings, Logging, Log QSOs By Hand; off unless ticked): log a QSO you made by hand, from its new button in the side panel (or F2), a Feed Roster spot's right-click, or the Multi-Mode Decoder, into GridTracker2 and every logging program and online logbook you log to
    <ul>
      <li>A card in your App Theme's colors: the call large on top with its band, mode, grid, bearing and distance (in your Distance Units) and UTC, each field a tile, filled in from your rig, the spot (its park and summit too) and your callsign lookup</li>
      <li>Unlock it to drag the fields where you want them; right-click to add any other ADIF field a QSO can have (parks and summits, location, contest, QSL, the contacted station, propagation ...), which stays on the card; each field is labeled by name, such as Station Callsign or Propagation Mode</li>
      <li>Unlock Widths (right-click) makes each field one or two columns wide and sets how wide a column is; kept for each field, even one taken off and added again</li>
      <li>A Retain switch on Power, Comment, Propagation Mode, Satellite, Satellite Mode and Rx Freq keeps what you type there for the next QSO, also after a restart (Power on to start with)</li>
      <li>The lock is the card's master lock: while it's shut, the card can't be rearranged, no field can be taken off, and its window can't be resized; the card always opens with it shut</li>
      <li>Double-click a call in the Feed Roster to log it</li>
      <li>Two tabs: QSO and My Station (your callsign, grid, zones, state and county, DXCC and rig filled in from what GridTracker2 knows, and every other field of your own station to add); what you type on My Station is kept for every card from then on</li>
      <li>Clearing the call, or typing one on a card that came without one, clears the other fields for the next QSO and sets the time to now, keeping the mode and your rig's frequency</li>
      <li>It follows your rig's frequency and voice mode while open, and starts in the last mode you used this session when nothing else gives it one</li>
      <li>Each field's tooltip names its ADIF field and says what ADIF puts in it; fields with a set list (band, propagation mode, continent, ARRL section, QSL codes, contest names, DXCC, the states of the QSO's DXCC entity ...) offer its values, and a county box offers the counties of the state filled in</li>
      <li>The POTA and SOTA boxes search POTA's parks (with POTA Hunting on) and SOTA's summits (with SOTA Chasing on) by reference or name as you type</li>
      <li>Each field is checked as you type against the ADIF rules for it, such as a 4, 6, 8 or 10 character grid, the CQ and ITU zones, IOTA and WWFF references, dates, latitude and longitude (decimal degrees are changed to ADIF's form)</li>
      <li>The Feed Roster's POTA and SOTA columns now log through it too</li>
    </ul>
  </li>
  <li>Add Lookup Data to QSO Log Event: lookup details only fill what the QSO has empty (name, state, county, zones ...), what your logging program sent or you typed is kept; a grid the QSO already has (the one the station sent, or one typed in) is kept, the lookup's grid only replaces one that isn't a real grid square</li>
  <li>A QSO's power keeps its fraction (0.5 W is logged as 0.5, no longer 0)</li>
  <li>Bands follow ADIF's band edges: 8m is 40 to 45 MHz and 4m 70 to 71 MHz, 141 to 143 MHz is no longer counted as 2m nor 219 to 221 MHz as 1.25m, 2200m ends at 137.8 kHz, 2.5mm starts at 119.98 GHz and 2mm reaches 149 GHz
    <ul>
      <li>New bands from ADIF: 560m, 5m (55 to 69 MHz) and submm, each with its own color and in the map's Band filter</li>
    </ul>
  </li>
  <li>New Queue QSOs To Send Later (Settings, Logging, Send Later; off unless ticked): QSOs show as worked in GridTracker2 at once, and wait to go to your logging programs and online logbooks until you click Send All, online or offline, for example after a POTA trip; Export ADIF saves them to a file, and Send All After sends them on its own once that many are waiting</li>
  <li>Settings: a new Radios tab holds Rig Control, Rotor Control and Network Audio, and a new Radios button in the button panel opens it</li>
  <li>Rig Control: SSB Data sends the digital modes to the rig's data mode (USB-D, PKTUSB, DATA-U), and DTR and RTS can be set for interfaces that need them</li>
  <li>Rig Control: a rig found to have a second VFO gets one set up for satellite uplinks, not connected until you tick its Connect, shown side by side with the rig's own; a second VFO that's off still shows its frequency</li>
  <li>Settings: Open Event Viewer On Error is now in Features, Operational</li>
  <li>Event Viewer: View As Waterfall (right-click its button, or drag it onto the control panel) shows the events in the control panel, under the buttons, with the panel running the full height of the window beside the map; drag the line above them out over the map to put it back. Over the map, its header now shows how many events there are, with Clear and the X beside it</li>
  <li>Settings, Audio: Device is now called Output Device</li>
  <li>Lookup: the Callsign Lookup window has a new, shorter look in your App Theme's colors, and a callsign pasted with a space or in lower case no longer shows Unknown</li>
  <li>Statistics: the tables in every tab have a new look in your App Theme's colors, with every other row shaded and the row under the mouse highlighted, and bands and modes in their colors</li>
  <li>At startup the map goes back to the instance it was showing when you closed GridTracker2</li>
  <li>Every mode and submode in the ADIF standard is now known: QSOs and spots in them count as Digital or Phone, and each submode shows in its mode's color (THOR16 as THOR, USB as SSB)
    <ul>
      <li>New in Mode Colors and the map's Mode filter: CONTESTI, DMR, FREEDV, FSK, FSQCALL, JT44, JTMS, M17, MFSK11, MFSK64L, MFSK128L and MTONE</li>
      <li>Statistics, Scores: a new Image type for SSTV, FAX and ATV QSOs, which counted as Other before; they now count toward Phone as well, as for DXCC, there and in the Call Roster's award tracking</li>
    </ul>
  </li>
  <li>Fixed: a Feed Roster QSO logged by hand with a Park now keeps its park, in your logs and in its POTA spot</li>
</ul>
```
