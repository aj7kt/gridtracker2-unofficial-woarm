# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),

## [v2.261110.1]

### MD Markup Format
#### Map / UI

- New App Themes (Settings, General, Display): GridTracker2's own colors, now with one meaning each everywhere (frequency, band, mode, callsign, grid and the rest), plus Opus' Choice and 27 more themes
  - Retro computers (EGA, CGA, VGA, Amber CRT, Apple ][e, VIC-20, C-64), nature and seasons, just for fun, and easy on the eyes (High Contrast, Colorblind Safe, Night Vision, OLED Minimal and more)
  - A theme colors every window and control at once; the Call Roster and Feed Roster keep the colors you set in their Settings
- New Casting (Settings, General, Display, Enable Casting): show the map live on your TV through a Google TV Streamer or Chromecast, with a new Cast button in the button panel
  - Cast to one TV or to several at once; GridTracker2 remembers them and casts to them again at the next start
  - A number on the Cast button shows how many are watching
  - The video is standard HLS, so VLC, Safari, Kodi and most other players on your network can show the map too
- DX Feeds and SOTA markers now show when you've worked them, as POTA's parks do: with a radio on the spot's band and mode, a check mark replaces the target once you've worked that call, as the Feed Roster counts it (DX Feeds), or worked that summit today (SOTA)
- Band Activity, the counts and the Map View Filters can be rearranged in the control panel: drag a box by its top border (Settings, General, Reset Panels puts them back)
- The Kp button now grows smoothly under the mouse, like the other buttons
- New Mode Colors (Settings, Colors): choose the color of each mode, as Band Colors does for bands; the rosters and the Statistics window show them

#### Multi-Mode Decoder

- New Multi-Mode Decoder (Settings, Features): decode signals right inside GridTracker2, without another program, from your rig's audio or an SDR, with a waterfall of the whole passband
  - Modes: CW, FT8, FT4, WSPR, PSK, RTTY, MFSK, DominoEX and THOR, Olivia and Contestia, Feld-Hell, SSTV, WEFAX, NAVTEX, Packet and APRS, and satellite data (FUNcube, AX.100, GENESIS)
  - In most modes every signal in the passband is decoded at once
  - FT8, FT4 and WSPR decodes go to the map and alerts as WSJT-X's do (and FT8 and FT4 to the Call Roster if you like), through a new instance named MMD
  - It keeps decoding while its window is hidden or minimized; a green dot on its button shows it's listening
  - With Rig Control: signals shown at their frequency on the air, a Frequency menu with each mode's usual frequencies on every band, and picking a mode tunes the rig to its main frequency (FT8 to 14.074 on 20 meters)
  - SSTV pictures, weather fax charts and NAVTEX messages are kept and can be saved; WEFAX can tune the rig to each chart from the stations' schedules
  - An Icom's own band scope (IC-7300 and others) can show above the waterfall
  - Detect Modes names every signal it hears, and Test Signals play recordings so you can try each mode
  - Listens to any sound card, SDR++, SPY Server, or Network Audio (below)
  - FT8 is built on ft8_lib by Kārlis Goba, YL3JG, with WSJT-X's methods for more decodes, with thanks to Joe Taylor, K1JT, and the WSJT development team; the other modes are written from their published specifications
  - The User Guide's Multi-Mode Decoder chapters describe every mode and setting

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
  - The User Guide's BirdWatch chapter describes it all

#### Network Audio

- New Network Audio (Settings, Features): decode a rig connected to another computer over your home network, and send SSTV pictures back to it, with VBAN (Voicemeeter and others), RTP (PipeWire, PulseAudio) or PipeWire / PulseAudio over TCP
- Rig Control: two new protocols that bring the rig's audio as well: FlexRadio SmartSDR, and Icom LAN (IC-705, IC-7610, IC-9700 and IC-905 over the network, with no computer at the radio)

#### App

- New N3FJP Contest Log (Settings, Logging): chase stations from the Feed Roster during a contest with any of N3FJP's contest logs (CQ WW, WPX, Field Day, NAQP, the State QSO Parties and more), alongside AC Log
  - A spot you click goes to the contest log (with Enable Rig Control, your rig is tuned there too), and each QSO you log there shows as worked in GridTracker2 at once
  - Also Log To My Other Logs (off unless ticked) sends those QSOs on to AC Log and the other logs and services GridTracker2 logs to
- Settings: a new Radios tab holds Rig Control, Rotor Control and Network Audio, and a new Radios button in the button panel opens it
- Rig Control: SSB Data sends the digital modes to the rig's data mode (USB-D, PKTUSB, DATA-U), and DTR and RTS can be set for interfaces that need them
- Rig Control: a rig found to have a second VFO gets one set up for satellite uplinks, not connected until you tick its Connect, shown side by side with the rig's own; a second VFO that's off still shows its frequency
- Settings: Open Event Viewer On Error is now in Features, Operational
- Settings, Audio: Device is now called Output Device
- Lookup: the Callsign Lookup window has a new, shorter look in your App Theme's colors, and a callsign pasted with a space or in lower case no longer shows Unknown
- Statistics: the tables in every tab have a new look in your App Theme's colors, with every other row shaded and the row under the mouse highlighted, and bands and modes in their colors
- At startup the map goes back to the instance it was showing when you closed GridTracker2

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
  <li>New Casting (Settings, General, Display, Enable Casting): show the map live on your TV through a Google TV Streamer or Chromecast, with a new Cast button in the button panel
    <ul>
      <li>Cast to one TV or to several at once; GridTracker2 remembers them and casts to them again at the next start</li>
      <li>A number on the Cast button shows how many are watching</li>
      <li>The video is standard HLS, so VLC, Safari, Kodi and most other players on your network can show the map too</li>
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
      <li>Modes: CW, FT8, FT4, WSPR, PSK, RTTY, MFSK, DominoEX and THOR, Olivia and Contestia, Feld-Hell, SSTV, WEFAX, NAVTEX, Packet and APRS, and satellite data (FUNcube, AX.100, GENESIS)</li>
      <li>In most modes every signal in the passband is decoded at once</li>
      <li>FT8, FT4 and WSPR decodes go to the map and alerts as WSJT-X's do (and FT8 and FT4 to the Call Roster if you like), through a new instance named MMD</li>
      <li>It keeps decoding while its window is hidden or minimized; a green dot on its button shows it's listening</li>
      <li>With Rig Control: signals shown at their frequency on the air, a Frequency menu with each mode's usual frequencies on every band, and picking a mode tunes the rig to its main frequency (FT8 to 14.074 on 20 meters)</li>
      <li>SSTV pictures, weather fax charts and NAVTEX messages are kept and can be saved; WEFAX can tune the rig to each chart from the stations' schedules</li>
      <li>An Icom's own band scope (IC-7300 and others) can show above the waterfall</li>
      <li>Detect Modes names every signal it hears, and Test Signals play recordings so you can try each mode</li>
      <li>Listens to any sound card, SDR++, SPY Server, or Network Audio (below)</li>
      <li>FT8 is built on ft8_lib by Kārlis Goba, YL3JG, with WSJT-X's methods for more decodes, with thanks to Joe Taylor, K1JT, and the WSJT development team; the other modes are written from their published specifications</li>
      <li>The User Guide's Multi-Mode Decoder chapters describe every mode and setting</li>
    </ul>
  </li>
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
  <li>Settings: a new Radios tab holds Rig Control, Rotor Control and Network Audio, and a new Radios button in the button panel opens it</li>
  <li>Rig Control: SSB Data sends the digital modes to the rig's data mode (USB-D, PKTUSB, DATA-U), and DTR and RTS can be set for interfaces that need them</li>
  <li>Rig Control: a rig found to have a second VFO gets one set up for satellite uplinks, not connected until you tick its Connect, shown side by side with the rig's own; a second VFO that's off still shows its frequency</li>
  <li>Settings: Open Event Viewer On Error is now in Features, Operational</li>
  <li>Settings, Audio: Device is now called Output Device</li>
  <li>Lookup: the Callsign Lookup window has a new, shorter look in your App Theme's colors, and a callsign pasted with a space or in lower case no longer shows Unknown</li>
  <li>Statistics: the tables in every tab have a new look in your App Theme's colors, with every other row shaded and the row under the mouse highlighted, and bands and modes in their colors</li>
  <li>At startup the map goes back to the instance it was showing when you closed GridTracker2</li>
</ul>
```
