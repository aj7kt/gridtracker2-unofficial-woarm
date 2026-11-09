# What's New in GridTracker2

This guide was last revised for version 2.261109.2. If you used GridTracker2 before 2025, these are the biggest changes since the previous edition of this guide. Each one is covered in detail in its own chapter.

## New Features

* **DX Feeds and the Feed Roster.** GridTracker2 can now receive DX Cluster and CW Skimmer spots. They appear in their own **Feed Roster**, next to the Call Roster in the same window, and on the map as DX Feed spots. The Feed Roster has its own Logbook, Hunting, Wanted, Exceptions, Watchers, Ignores and audio alerts. See [The Feed Roster and DX Feeds](../Making-GridTracker-Work-For-You/Using-Feed-Roster.md).
* **SOTA Chasing.** Summits on the Air activators spotted in DX Feeds are shown in a SOTA column, with a SOTA Wanted choice and their own map markers. A QSO logged with a spotted activator gets the summit's reference (SOTA_REF). The Logbook can export your chases as a CSV file for the SOTA database. See [Summits On The Air](../Third-Party-Integrations/GridTracker2-and-Summits-On-The-Air.md).
* **POTA improvements.** Park information now also comes from DX Feeds spots, the POTA tooltip has a new header, and you can click a park on the map to work the spot. See [Parks On The Air](../Third-Party-Integrations/GridTracker2-and-Parks-On-The-Air.md).
* **Log4OM connection.** GridTracker2 can connect to Log4OM through its UDP remote control. It shows Log4OM's frequency, band and mode, sends spots to its QSO entry, and can tune your rig through Log4OM. See [Log4OM](../Third-Party-Integrations/Log4OM-Integration.md).
* **N3FJP AC Log, expanded.** Connection status lights, "Enable Rig Control" (clicking a spot tunes your rig through AC Log), POTA_REF and SOTA_REF Other fields, and more reliable logging.
* **Colors tab.** Change the color of any band, and of the Gridsquare Colors on the map, from Settings → Colors. Map pins are now drawn in the band colors.
* **Roster Columns tab.** Each roster has a Columns tab where you can show, hide, reorder and recolor every column.
* **New map layers and buttons.** Range Rings, Major Parallels and Meridians, a Tropospheric Inversion VHF prediction layer (with 6 m Es areas), a choice of grayline terminator (Horizon, Civil, Nautical or Astronomical), the US weather radar restored, new base maps, and the option to put the side panel on the left side of the window.
* **Multi-Mode Decoder.** Decode CW, FT8, FT4, PSK, RTTY, MFSK, DominoEX and THOR, Olivia, NAVTEX, Feld-Hell, WEFAX, WSPR, SSTV, Packet and satellite data right in GridTracker2, from your rig's or an SDR's audio, with a waterfall of the whole passband. FT8, FT4 and WSPR decodes can go to the map and Call Roster, and SSTV pictures can be sent. See [The Multi-Mode Decoder](../Multi-Mode-Decoder/Multi-Mode-Decoder.md).
* **BirdWatch satellite tracking.** Amateur satellites on the map with their footprints and ground tracks, a BirdWatch panel with each satellite's position, AOS and LOS and sky views, a pass timeline you can export to your calendar, and pass alerts. With Rig Control your radio follows a satellite's downlink and uplink, Doppler-corrected through the pass, and with Rotor Control your antenna follows it too. See [BirdWatch](../BirdWatch.md).
* **Network Audio.** Audio in and out over your home network, for the Multi-Mode Decoder: VBAN (Voicemeeter), RTP and the simple TCP protocol of PipeWire and PulseAudio, and the audio of a FlexRadio (DAX) or a networked Icom. See [Network Audio](../Network-Audio.md).
* **Rig and Rotor Control.** GridTracker2 can now read and tune your rigs and SDRs itself (rigctld, flrig, Icom CI-V, Icom LAN, FlexRadio SmartSDR, Kenwood and Yaesu CAT, SPY Server, SDR++), and turn your antenna rotator (Yaesu GS-232, Easycomm II, SPID, rotctld, CatRotator / PstRotator). See [Rig and Rotor Control](../Rig-and-Rotor-Control.md).
* **Event Viewer.** What happened this session (QSOs logged, alerts, errors, BirdWatch announcements) in a list of its own, over the map or in a window. It replaces the side panel's message list. See [Event Viewer](../GridTracker-Overview/Control-Panel.md#event-viewer).
* **Rearrangeable side panel.** Drag the band activity graph, Quick Stats and Map View Filters above or below each other and the buttons. See [Rearranging the Panel](../GridTracker-Overview/Control-Panel.md#rearranging-the-panel).
* **Santa Tracker.** From December 1st a button appears that follows Santa and his reindeer around the world.
* **More languages.** The interface is now available in Chinese (Simplified and Traditional), Dutch, English, French, French (Canada), German, Italian, Japanese, Polish, Portuguese (Brazil and Portugal) and Spanish.
* **More programs supported.** JS8Call-Improved, WS – Digital Mode Suite, MSHV, ADIF UDP broadcasts from programs such as fldigi, HRD Logbook, and improved Cloudlog / Wavelog logging.
* **Multiple instances.** Run more than one copy of GridTracker2 with the `--gt-name=` command-line option, for example one per radio.

## Changed

* **Settings regrouped.** Most Settings tabs are now arranged in titled boxes, with dependent options indented under the option they depend on. Several options were renamed:
  * "Merge Award Overlay" is now **Keep Other Layers With Award View**.
  * "'CQ' Highlighting" is now **Outline Directed CQ Areas**.
  * "Clear on CQ" is now **Clear WSJT-X / JTDX On CQ**.
  * The Grids tab is now the **Grids** box in Settings → Map.
* **Station callsign.** Settings → General → Station has a **Callsign** for when no WSJT-X, JTDX, AC Log or Log4OM is connected.
* **Logbook window.** The Logbook is one scrolling list instead of pages, with sticky search boxes and column headers, sort arrows, and County, POTA and SOTA columns.
* **Lookup-derived grids** are marked with a diamond (◇): the location is likely, not certain.
* **Hotkeys.** Animate Active Paths moved to **Ctrl+J** and the Conditions window to **Ctrl+E**. Letter hotkeys now use **Ctrl**, see [Appendix C](../Appendices/Appendix-C-Hotkeys.md).

## Removed

* The **Off-Air Message Service (OAMS)** chat and on-air status sharing were removed. The current online features are described in [Settings → Features](../GridTracker-Overview/Settings-Sub-Menus.md).
* Automatic highlighting of US 1x1 special-event callsigns was removed. To get it back, add a Watcher with the Callsign Regex `^[KNW][0-9][A-WYZ]$`.
