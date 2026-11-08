# Log4OM

[Log4OM](https://www.log4om.com/) works with GridTracker2 in two ways:

* **Logging:** QSOs from WSJT-X and JTDX are sent to Log4OM.
* **Connected:** through Log4OM's UDP remote control, GridTracker2 follows Log4OM's rig, sends spots to its QSO entry, and can tune your rig through it.

## Logging

In [Settings → Logging](../GridTracker-Overview/Settings-Sub-Menus.md#logging-tab), on the **Log4OM** row of the **Logging Programs** box, enter Log4OM's **IP** address and **Port** (2236 by default) and tick **Log QSO**. Each QSO is sent as an ADIF record over UDP. In Log4OM, add a UDP inbound connection on the same port to receive them (see Log4OM's documentation of its connection settings).

## Connected Operation

Tick **Connect** on the Log4OM row. GridTracker2 talks to Log4OM's UDP remote control on Log4OM's default ports (it sends to port 2241 and listens on 2242). Turn on the remote control in Log4OM if it isn't already. The dot next to Connect shows green while Log4OM answers, red while it doesn't.

While connected:

* Log4OM becomes one of your radios. Its rig frequency, band and mode show at the top of the side panel, and the status bar shows **CONNECTED** while Log4OM is the active radio.
* When Log4OM runs on the same computer, GridTracker2 reads your station callsign and locator from Log4OM's settings.
* Clicking a callsign in the Feed Roster, or a POTA, SOTA or DX Feeds marker on the map, sends the call to Log4OM's QSO entry, unless you have already typed a call there yourself. The side panel shows the call and grid sent.

### Rig Control

Tick **Enable Rig Control** (shown while Connect is ticked) to have a spot click also tune your rig, through Log4OM, to the spot's frequency and mode. Log4OM must have your rig connected (CAT).

See [Working a Spot](../Making-GridTracker-Work-For-You/Using-Feed-Roster.md#working-a-spot) for how GridTracker2 chooses where a spot goes when you have several radios and programs.
