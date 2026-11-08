# Other Programs

## Decoding Programs

GridTracker2 listens to the WSJT-X UDP messages, so it works with every program that sends them:

* **WSJT-X** and **JTDX**: see [Appendix B](../Appendices/Appendix-B-Configuring-WSJT-X-and-JTDX-for-GridTracker.md).
* **WS – Digital Mode Suite** (formerly WSJT-X Improved): set up like WSJT-X. Its logs are found automatically.
* **MSHV**: set up its UDP messages like WSJT-X.
* **JS8Call-Improved**: turn on its WSJT-X UDP server. JS8Call doesn't send its receiving and decoding status or regular heartbeats, and clicking a callsign in the Call Roster can't reply in JS8Call.

You can run several of these at once, for example one WSJT-X per radio. Give each WSJT-X its own name (`wsjtx --rig-name=HF`), and send them all to GridTracker2, using multicast if other programs need the messages too. GridTracker2 shows a radio selector, and the Call Roster can show all their decodes together, with a tick box for each instance.

## Logging Programs That Broadcast ADIF

Programs such as **fldigi** can broadcast each logged QSO as an ADIF record over UDP. Turn on **Receive ADIF UDP Broadcasts For Logging** in [Settings → General](../GridTracker-Overview/Settings-Sub-Menus.md#general-tab) and set the same port in the program. GridTracker2 then adds those QSOs to your logbook and sends them on to your logs, as if WSJT-X had logged them. Old QSOs replayed this way aren't spotted to POTA.

## Logging Programs and Online Logbooks

[Settings → Logging](../GridTracker-Overview/Settings-Sub-Menus.md#logging-tab) can send each new QSO to:

* **N1MM Logger+**, **HRD Logbook 6.9 and later**, and other programs that accept ADIF over UDP, through the **ADIF UDP / N1MM** row;
* **Log4OM** ([details](Log4OM-Integration.md)) and **N3FJP AC Log** ([details](N3FJP-AC-Log-Integration.md));
* **DXKeeper**;
* **HRD Logbook 6.8 and earlier**;
* **QRZ.com**, **ClubLog**, **LoTW** (through TQSL), **eQSL.cc**, **HRDLOG.net**, **Cloudlog / Wavelog** and **HamCQ.cn**.

It can load your logbook from QRZ.com, ClubLog, LoTW, N3FJP AC Log and PSK-Reporter. See [Logging Options](../Making-GridTracker-Work-For-You/GridTracker-Logging-Options-and-Functions.md).

## Rotators

With **CatRotator / PstRotator** turned on in [Settings → Features](../GridTracker-Overview/Settings-Sub-Menus.md#features-tab), GridTracker2 can turn your antenna through PstRotator or CatRotator, over UDP (port 12000 by default). Right-click a callsign in the Call Roster and choose **Aim Rotator**, or **Ctrl**+click a point on the map.

## Forwarding to Other Programs

**Forward UDP Messages** in Settings → General passes every WSJT-X message GridTracker2 receives on to other programs, for example [HamClock](HamClock-Integration.md), another copy of GridTracker2, or an online service such as ft8battle.com. It accepts several addresses or hostnames, separated by commas.
