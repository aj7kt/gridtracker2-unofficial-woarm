# FAQ and Troubleshooting

## The map doesn't show all my QSOs

You have almost certainly limited what is shown:

* Check the [Map View Filters](GridTracker-Overview/Control-Panel.md#map-view-filters). To see everything, set Band, Mode and Prop to **Mixed**, Data to **Logbook**, and Award to **None**.
* Check [Settings → Logbook](GridTracker-Overview/Settings-Sub-Menus.md#logbook-tab): are **Working Callsign(s)**, **Working Grid(s)** or **Working Date** enabled? If they leave QSOs out, the side panel shows **Log Entries Filtered**.
* Check [Settings → Logging](GridTracker-Overview/Settings-Sub-Menus.md#logging-tab): are all the logs you want ticked **Load At Startup**, including your WSJT-X logs under **App Log(s)**?

## The QSO or QSL count looks wrong

The counts depend on which logs you load, and on the Logbook Filters. GridTracker2 combines all your loaded logs, so check Settings → Logging. Remember that WSJT-X's own log has no confirmations: load your LoTW log, or your logging program's log, to see QSLs.

## Nothing happens in GridTracker2 when WSJT-X decodes

See [Connecting to WSJT-X or JTDX](Getting-Started.md#connecting-to-wsjt-x-or-jtdx). Check that the status bar isn't showing **IGNORE**: click it to resume reading messages.

## Clicking a callsign in the Call Roster doesn't call the station

Check the WSJT-X or JTDX settings in [Appendix B](Appendices/Appendix-B-Configuring-WSJT-X-and-JTDX-for-GridTracker.md), especially **Accept UDP requests**. If it works for stations calling CQ but not for others, untick **CQ only** and tick **Hold Tx Freq** in WSJT-X's main window. JTDX replies according to its **Accept UDP Reply Message** setting. JS8Call can't reply from GridTracker2.

## I don't hear any alerts

* Is the **Audio Mute** button on? Press **Ctrl+M** to toggle it.
* Is the right **Device** chosen in Settings → Audio? Don't use your radio's sound card.
* Are the alerts ticked in Settings → Audio Alerts, and do your roster Exceptions let the station through?

## My spots turned into colored areas

The spot view is set to **RX Heatmap**. Click the Spot Reports button (or press **Ctrl+O**) to cycle to RX Spots, or right-click the button to choose.

## The Feeds tab, Feed Roster or DX Feed Spots button is missing

They only appear while **Off-Air Services** and **DX Feeds** are on in Settings → Features, and Offline Mode is off. The SOTA features also need **SOTA Chasing**.

## A park shows "?-????"

The station is calling CQ POTA but hasn't been spotted or scheduled on pota.app yet. The park appears as soon as GridTracker2 learns it. See [Parks On The Air](Third-Party-Integrations/GridTracker2-and-Parks-On-The-Air.md).

## The hotkeys don't work

Hotkeys only work while the main window is active and the Settings panel is closed, and letter hotkeys need **Ctrl**. See [Appendix C](Appendices/Appendix-C-Hotkeys.md).

## GridTracker2 doesn't start

* Only one copy can run at a time. If GridTracker2 is already running (check the taskbar), starting it again does nothing. To run more than one copy, see [Running Several Copies](GridTracker-File-Storage.md#running-several-copies).
* On Linux, if the window opens but shows no text, run `fc-cache -fv` and start it again. If that doesn't help, try starting it with `--disable-gpu`.

## Windows Firewall and antivirus software

GridTracker2 receives WSJT-X's messages over your network, even when both run on the same computer, so firewalls and antivirus programs can block it. Allow GridTracker2 (and WSJT-X) on private and public networks. Check again after an update.

## Where are my settings and logs?

See [Files, Folders and Command-Line Options](GridTracker-File-Storage.md).
