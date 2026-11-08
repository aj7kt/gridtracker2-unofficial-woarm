# What's New in GridTracker2

This guide was last revised for version 2.261108.0. If you used GridTracker2 before 2025, these are the biggest changes since the previous edition of this guide. Each one is covered in detail in its own chapter.

## New Features

* **DX Feeds and the Feed Roster.** GridTracker2 can now receive DX Cluster and CW Skimmer spots. They appear in their own **Feed Roster**, next to the Call Roster in the same window, and on the map as DX Feed spots. The Feed Roster has its own Logbook, Hunting, Wanted, Exceptions, Watchers, Ignores and audio alerts. See [The Feed Roster and DX Feeds](../Making-GridTracker-Work-For-You/Using-Feed-Roster.md).
* **SOTA Chasing.** Summits on the Air activators spotted in DX Feeds are shown in a SOTA column, with a SOTA Wanted choice and their own map markers. A QSO logged with a spotted activator gets the summit's reference (SOTA_REF). The Logbook can export your chases as a CSV file for the SOTA database. See [Summits On The Air](../Third-Party-Integrations/GridTracker2-and-Summits-On-The-Air.md).
* **POTA improvements.** Park information now also comes from DX Feeds spots, the POTA tooltip has a new header, and you can click a park on the map to work the spot. See [Parks On The Air](../Third-Party-Integrations/GridTracker2-and-Parks-On-The-Air.md).
* **Log4OM connection.** GridTracker2 can connect to Log4OM through its UDP remote control. It shows Log4OM's frequency, band and mode, sends spots to its QSO entry, and can tune your rig through Log4OM. See [Log4OM](../Third-Party-Integrations/Log4OM-Integration.md).
* **N3FJP AC Log, expanded.** Connection status lights, "Enable Rig Control" (clicking a spot tunes your rig through AC Log), POTA_REF and SOTA_REF Other fields, and more reliable logging.
* **Colors tab.** Change the color of any band, and of the Gridsquare Colors on the map, from Settings → Colors. Map pins are now drawn in the band colors.
* **Roster Columns tab.** Each roster has a Columns tab where you can show, hide, reorder and recolor every column.
* **New map layers and buttons.** Range Rings, Major Parallels and Meridians, a Tropospheric Inversion VHF prediction layer (with 6 m Es areas), a choice of grayline terminator (Horizon, Civil, Nautical or Astronomical), the US weather radar restored, new base maps, and the option to put the map on the right side of the window.
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
