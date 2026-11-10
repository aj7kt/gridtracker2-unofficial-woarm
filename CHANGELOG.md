# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),

## [v2.261110.0]

### MD Markup Format
#### Map / UI

- New App Themes (Settings, General, Display): GridTracker2's own colors, now with one meaning each everywhere (frequency, band, mode, callsign, grid and the rest), plus Opus' Choice and 27 more themes
  - Retro computers (EGA, CGA, VGA, Amber CRT, Apple ][e, VIC-20, C-64), nature and seasons, just for fun, and easy on the eyes (High Contrast, Colorblind Safe, Night Vision, OLED Minimal and more)
  - A theme colors every window and control at once; the Call Roster and Feed Roster keep the colors you set in their Settings
- New Casting (Settings, General, Display, Enable Casting): show the map live on your TV through a Google TV Streamer or Chromecast, with a new Cast button in the button panel
  - Cast to one TV or to several at once; GridTracker2 remembers them and casts to them again at the next start
  - A number on the Cast button shows how many are watching
  - The video is standard HLS, so VLC, Safari, Kodi and most other players on your network can show the map too
- Band Activity, the counts and the Map View Filters can be rearranged in the control panel: drag a box by its top border (Settings, General, Reset Panels puts them back)
- The Kp button now grows smoothly under the mouse, like the other buttons

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

- New Skeds: the stations you share satellite passes with, and your mutual passes for the next 72 hours
  - Save them as calendar files, copy them as text to send, or swap Sked Lines with other GridTracker2 users
  - Shown in the Pass Timeline, on the map and in the BirdWatch panel; Announce Mutual Passes tells you before one opens
- Auto-Track can prefer mutual passes (Skeds First) or follow only them (Skeds Only)
- BirdWatch's settings are split into more tabs
- The selected satellite's name on the map now stands out in black on light green

#### Network Audio

- New Network Audio (Settings, Features): decode a rig connected to another computer over your home network, and send SSTV pictures back to it, with VBAN (Voicemeeter and others), RTP (PipeWire, PulseAudio) or PipeWire / PulseAudio over TCP
- Rig Control: two new protocols that bring the rig's audio as well: FlexRadio SmartSDR, and Icom LAN (IC-705, IC-7610, IC-9700 and IC-905 over the network, with no computer at the radio)

#### App

- Settings: a new Radios tab holds Rig Control, Rotor Control and Network Audio
- Rig Control: SSB Data sends the digital modes to the rig's data mode (USB-D, PKTUSB, DATA-U), and DTR and RTS can be set for interfaces that need them
- Settings, Audio: Device is now called Output Device
- Lookup: the Callsign Lookup window has a new, shorter look, and a callsign pasted with a space or in lower case no longer shows Unknown
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
  <li>Band Activity, the counts and the Map View Filters can be rearranged in the control panel: drag a box by its top border (Settings, General, Reset Panels puts them back)</li>
  <li>The Kp button now grows smoothly under the mouse, like the other buttons</li>
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
  <li>New Skeds: the stations you share satellite passes with, and your mutual passes for the next 72 hours
    <ul>
      <li>Save them as calendar files, copy them as text to send, or swap Sked Lines with other GridTracker2 users</li>
      <li>Shown in the Pass Timeline, on the map and in the BirdWatch panel; Announce Mutual Passes tells you before one opens</li>
    </ul>
  </li>
  <li>Auto-Track can prefer mutual passes (Skeds First) or follow only them (Skeds Only)</li>
  <li>BirdWatch's settings are split into more tabs</li>
  <li>The selected satellite's name on the map now stands out in black on light green</li>
</ul>
<h4>Network Audio</h4>
<ul>
  <li>New Network Audio (Settings, Features): decode a rig connected to another computer over your home network, and send SSTV pictures back to it, with VBAN (Voicemeeter and others), RTP (PipeWire, PulseAudio) or PipeWire / PulseAudio over TCP</li>
  <li>Rig Control: two new protocols that bring the rig's audio as well: FlexRadio SmartSDR, and Icom LAN (IC-705, IC-7610, IC-9700 and IC-905 over the network, with no computer at the radio)</li>
</ul>
<h4>App</h4>
<ul>
  <li>Settings: a new Radios tab holds Rig Control, Rotor Control and Network Audio</li>
  <li>Rig Control: SSB Data sends the digital modes to the rig's data mode (USB-D, PKTUSB, DATA-U), and DTR and RTS can be set for interfaces that need them</li>
  <li>Settings, Audio: Device is now called Output Device</li>
  <li>Lookup: the Callsign Lookup window has a new, shorter look, and a callsign pasted with a space or in lower case no longer shows Unknown</li>
  <li>At startup the map goes back to the instance it was showing when you closed GridTracker2</li>
</ul>
```
