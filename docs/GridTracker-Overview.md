# The Main Window

GridTracker2's main window has two parts: the **map**, and the **side panel** next to it.

![The GridTracker2 main window](img/GT2_Main_Window.jpg)

The map shows your QSOs and the stations you are hearing by Maidenhead grid square, along with the paths between stations and any overlays you choose: grayline, award progress, POTA parks, SOTA summits, DX spots, propagation predictions and more.

A standard WSJT-X message carries the sender's grid:

> **CQ N0TTL CN84**\
> **N0TTL N2VFL FN20**

GridTracker2 reads the grid from each decode and colors that square on the map as it is heard. When two stations are in a QSO, it draws a path between them.

Your logbook is loaded when GridTracker2 starts: the log files of WSJT-X, JTDX and similar programs, GridTracker2's own backup log, and any other logs you choose in [Settings → Logging](GridTracker-Overview/Settings-Sub-Menus.md#logging-tab). The grids you have worked are colored in your QSO color, and the confirmed ones in your QSL color.

The side panel shows what your radio is doing, your QSO and QSL counts, the Map View Filters, and the buttons that open the other windows and turn map layers on and off.

The next chapters describe:

* [The Map](GridTracker-Overview/GridTracker-Map-View-—-Main-WIndow.md): grids, paths, pins, projections, overlays, award layers and spot markers.
* [The Side Panel](GridTracker-Overview/Control-Panel.md): every part of the panel, including each button.
* [Settings](GridTracker-Overview/Settings-Sub-Menus.md): every tab of the Settings panel.

Other windows open from the side panel: the [Call Roster](Making-GridTracker-Work-For-You/Using-Call-Roster.md), [Statistics](Making-GridTracker-Work-For-You/GridTracker-Statistics.md), and the [Lookup, Conditions and Band Activity windows](Making-GridTracker-Work-For-You/Other-Windows.md). Each window remembers its position and size. Closing one only hides it; the button opens it again.

```{tip}
Every window can be zoomed: **Ctrl** with **+** or **–**, or **Ctrl+Alt** with the mouse wheel. **Ctrl+0** resets it.
```
