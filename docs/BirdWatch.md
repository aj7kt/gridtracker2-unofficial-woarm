# BirdWatch

**BirdWatch** tracks amateur satellites. It shows where they are on the map, when they will pass over you, and the frequencies to tune to as they move. With [Rig Control](Rig-and-Rotor-Control.md) it can also keep your radio on a satellite's downlink and uplink through the whole pass, and with Rotor Control it can point your antenna at it.

A few terms used in this chapter:

* **AOS** (Acquisition Of Signal): the moment a satellite rises above your horizon.
* **LOS** (Loss Of Signal): the moment it sets below your horizon again. The time between them is a **pass**.
* **TLE** (Two-Line Element set): the two lines of numbers that describe a satellite's orbit. BirdWatch works out every position and pass from them, so they need to be fairly recent.
* **Doppler shift**: as a satellite comes toward you its signals are heard higher in frequency, and lower as it moves away. BirdWatch works out the shift for every second of the pass.

## Turning It On

In [Settings → Features](GridTracker-Overview/Settings-Sub-Menus.md#features-tab), under **Service**, tick **BirdWatch (Satellite Tracking)**. This adds:

* the **Toggle Satellite Tracking** button to the button panel;
* the **BirdWatch** panel on the map;
* a row of BirdWatch tabs in Settings: **BirdWatch**, **Skeds**, **Display**, **Alerts**, **Telemetry** and **Satellites**.

BirdWatch works offline: the satellite data it needs comes with GridTracker2. While you are online (and BirdWatch is on), the data is kept up to date automatically.

```{tip}
Enter your station's height above sea level in **Elevation** in Settings → General → Station (feet when your distance unit is miles or nautical miles, meters otherwise). BirdWatch uses it for the satellites' positions, their Doppler shift, and when they rise and set.
```

```{tip}
Pass times are shown in UTC until you switch them: click the date and time in the side panel's GridTracker2 box (just below the frequency) to change between UTC and your local time. The BirdWatch panel, the Pass Timeline and the times on the map all follow it. The Skeds tab's mutual passes stay in UTC, since you share them with another station.
```

## The Buttons

| Button | Name | What it does | Hotkey |
| --- | --- | --- | --- |
| ![](img/buttons/birdWatchButton.png){width=32px} | Toggle Satellite Tracking | Turns satellite tracking on and off: the BirdWatch panel, the satellites on the map and the three buttons below. Gray while off. | Ctrl+F12 |
| ![](img/buttons/birdWatchAutoButton.png){width=32px} | Auto Select Next AOS Satellite | Turns Auto-Track on and off (see [Auto-Track](#auto-track)). Gray while off. | Ctrl+\\ |
| ![](img/buttons/birdWatchDopplerButton.png){width=32px} | Doppler | Opens the transmitters window of the selected satellite (see [The Transmitters Window](#the-transmitters-window)). Gray while no satellite is selected. Right-click to bring the window forward without closing it. | |
| ![](img/buttons/birdWatchTimelineButton.png){width=32px} | Pass Timeline | Shows the passes of your tracked satellites over the next 24 hours (see [Pass Timeline](#pass-timeline)). | |

The last three only appear while satellite tracking is on. Like the other buttons, you can drag them to another place in the button panel.

**Ctrl+]** and **Ctrl+[** select the next and the previous of your tracked satellites, in the order of the Tracked Satellites list.

## The BirdWatch Panel

![The BirdWatch panel with AO-91 selected, its Skybox and Earth views below](img/GT2_BirdWatch_Panel.jpg){width=200px .gt-float-right}

The BirdWatch panel is as wide as the side panel and sits on the opposite side of the window, over the map's corner. It is only as tall as what it shows.

* Click the title **BirdWatch** to hide the panel. Click the **☰** that appears in its place to bring it back.
* Right-click the title (or the side panel's GridTracker2 title) to swap the two panels from one side to the other. This is the same as **Control Panel On Left Side** in Settings → General.
* The boxes under the title can be put in another order: drag a box by its top border. **Reset Panels** in the Display tab of Settings puts them back.

Most of the panel is about the **selected satellite**. Click a satellite on the map to select it (click it again to clear the selection), or let [Auto-Track](#auto-track) select one for you. The selection is also noted in the Event Viewer.

### Satellite Information

The first box shows the selected satellite's name in cyan, and under it its longer name if it has one.

* Hold the mouse over the name to see what the satellite database knows about it: its other names, status, launch date, operator and countries.
* Click the name to center the map on the satellite.
* Right-click the name to open the satellite's page in the SatNOGS database in your browser (not in Offline Mode).
* The **–** in the corner folds the box down to the name; **+** opens it again.

Under the name, one item is shown large at the top (the **featured** item, with its name in brackets under it). By default it is **Time To AOS**, counting down to the next rise, which becomes **Time To LOS** while the satellite is up: orange while it is below your horizon, green while it is up.

The rows below it can be:

* **Azimuth** and **Elevation:** where to point your antenna: the compass direction to the satellite, and its angle above your horizon (green while it is up, red while it is below).
* **Latitude/Longitude** and **Grid:** the point on the ground under the satellite, and its grid square.
* **Slant Range:** the straight-line distance from you to the satellite. **Range Rate:** how fast it is moving away from you (+) or toward you (–).
* **Ground Distance:** the distance along the ground to the point under it.
* **Altitude**, **Velocity** and **Heading:** its height, its speed, and the direction it is moving over the ground.
* **Footprint:** the diameter of the area on the ground the satellite can be heard from.
* **Doppler:** the Doppler shift right now, **Signal Loss** (free-space path loss) and **Signal Delay** (one way). Hover to see the frequency they are worked out for: the satellite's first downlink.
* **AOS**, **LOS** and **TCA** (Time Of Closest Approach, when it is highest): the time of each and the azimuth at it. **DOS** (Duration Of Signal): how long the pass lasts.
* **Max Elevation:** how high this pass climbs. An 👁 after it marks a **visible pass**: the satellite is high enough and in sunlight while your sky is dark, so you may see it with your own eyes.
* **Rotor Control:** where your rotator points (while Rotor Control is on). Orange until it is connected. Click it to open its settings.

These are hidden until you turn them on: **Pass Progress** (how much of the pass has gone by), **Orbital Period**, **Inclination**, **Apogee**, **Perigee**, **Revolution** (the orbit number since launch) and **Sun Elevation** (the sun's height at your location, measured from the map's Terminator setting; below 0 is night).

Hold the mouse over a row to see what it means. To arrange the list:

* **Right-click a row's name** for a menu: **Featured** makes it the large item at the top, the ticks show or hide each row, **Enable All** shows every row, and **Default List** puts the list back as it was (the colors you picked stay).
* **Right-click a value** to pick its color.
* **Drag a row** to move it up or down the list.

Times are shown in UTC or your local time: click the date and time in the side panel's GridTracker2 box, just below the frequency, to switch. Distances use the unit in Settings → General.

### Rig Box

While Rig Control is on, a box with a yellow border shows your radio's two frequencies for the satellite: the downlink VFO (the one you receive on) on the first row in yellow, and the uplink VFO (the one you transmit on) on the second. Each has its mode after it. The uplink row is left out while you follow a transmitter with no uplink, such as a beacon.

* The small icon before each frequency is that VFO's **Connect**: click it to connect or disconnect. It is light blue while connected, orange while connecting, red when the radio can't be reached, and gray while off.
* **Re-center** (beside the frequencies, while the radio follows a satellite) puts both VFOs back on the transmitter's Doppler-corrected frequency, dropping your own tuning away from it. It lights up while you have tuned away; hover over it to see by how much.
* The lock beside the uplink row is **Lock VFOs** (see [Following a Satellite With Your Rig](#following-a-satellite-with-your-rig)).
* **Follow** and **Unfollow** (while a satellite is selected and the radio is connected) start and stop following the selected satellite. Unfollow leaves the radio where it is.
* Click the box to open the transmitters window. Right-click it to open BirdWatch's settings.

### Sky Views

Four drawings of the selected satellite's pass can be shown under the information. Pick them in **Panel View** in the Display tab of Settings. In each, AOS is green, LOS red, and a cyan dot shows where the satellite is now while it is up. Hold the mouse over one for a reminder of how to read it.

* **Skybox** (on by default): the whole sky as a circle seen from below, north at the top and east on the right. The horizon is the outer circle and straight overhead is the center. The pass's track runs across it, with its highest point marked.
* **Pass Profile:** the satellite's elevation through the pass, with the AOS and LOS times under its ends.
* **Horizon:** the pass as you would see it facing the horizon: compass directions along the bottom, elevation up the side.
* **Earth** (on by default): the satellite seen from the side, above the curve of the Earth. Your station is on top with your horizon dashed. The line to the satellite is green while it is above your horizon and red while it is below, with its height (↑) and its distance from you (↔).

## Satellites on the Map

![Satellites on the map: AO-91 selected, with its footprint and predicted path](img/GT2_BirdWatch_Map.jpg)

Each tracked satellite is drawn on the map as a small satellite icon with its name under it (yellow on blue, and black on light green for the selected satellite), and moves as it goes around the Earth. An icon is drawn dim while the satellite is in the Earth's shadow (while the Grayline is on).

* **Click** a satellite to select it; it is ringed. Click it again to clear the selection.
* **Right-click** a satellite to select it and open its transmitters window.
* **Hold the mouse over** a satellite to see its transmitters, with their frequencies corrected for where it is right now.

For the selected satellite (and the one under the mouse) BirdWatch also draws:

* its **Footprint:** the circle on the ground that can hear it right now. Stations inside it can work each other through the satellite.
* its **Predicted Path:** its ground track, from a little behind it to up to an orbit ahead. The part already flown and the part to come are drawn differently, and a mark with its time is placed every ten minutes ahead.

Their colors and styles are in **Map** in the Display tab of Settings. The stations of your [Skeds](#skeds-passes-with-another-station) are drawn on the map too.

## Pass Timeline

![The Pass Timeline](img/GT2_BirdWatch_Timeline.png)

The **Pass Timeline** button opens a chart at the top of the map with the next 24 hours of passes of every tracked satellite, one row each. Now is at the left edge (the red line), and the hours are marked along the top.

* Each pass is a yellow bar from its AOS to its LOS. The higher the pass climbs, the taller and brighter the bar. Where there is room, its highest elevation and its length in minutes are written on it, and an 👁 marks a visible pass.
* Hold the mouse over a bar to see its AOS and LOS times and azimuths, the time to AOS and LOS, its duration and its highest elevation. The hours along the top and these times are in UTC or your local time, as you chose for the clock in the side panel.
* Click a bar to select its satellite.
* Under the satellites, each active station of your [Skeds](#skeds-passes-with-another-station) has a row of its own (its callsign in light green), with a bar for each mutual pass: green for a two-way satellite, cyan for a listen-only one.
* **Export Passes (.ics)** saves the next three days of passes as a calendar file you can open in your phone's or computer's calendar. Each pass has a reminder before it rises. Only passes that climb at least the **Lowest Max Elevation** of Pass Alerts are saved, and the reminder comes **Minutes Before AOS** (both in the Alerts tab of Settings).
* The red **X** closes the timeline.

## The Transmitters Window

![The transmitters window for RS-44](img/GT2_BirdWatch_Transmitters.png)

The transmitters window lists the selected satellite's active transmitters, from the SatNOGS database. Open it with the **Doppler** button, a right-click on the satellite on the map, or a click on the rig box. It follows the selection: select another satellite and the window shows its transmitters.

The columns are:

* **Transmitter:** its name, in yellow. Hover for its details (its type, service, and whether it is an inverting transponder).
* **Mode:** its downlink mode (FM, USB, CW, a data mode and its baud...). Where the uplink's mode is different, as on an inverting transponder, it follows in orange.
* **Downlink:** the frequency to tune to *right now*, corrected for Doppler. For a transponder (a range of frequencies) it is the middle of the range, with its half width after it in gray (±15 kHz). Hover to see the satellite's own frequency.
* **Uplink:** the frequency to transmit on right now, corrected the other way.
* **Shift:** the Doppler shift right now.

Amateur transmitters come first, and two-way ones (repeaters and transponders) before beacons. Transmitters outside the amateur service are drawn dim. With Rig Control on, a small letter after each frequency shows which VFO it would go to. The table takes its colors from the [App Theme](GridTracker-Overview/Settings-Sub-Menus.md#display).

With Rig Control connected you can click the table to tune your radio, see [Following a Satellite With Your Rig](#following-a-satellite-with-your-rig).

## Pass Alerts

BirdWatch can announce a tracked satellite a few minutes before it rises, for example: "AO-91 rises in 5 minutes, max elevation 42 degrees". Each pass is announced only once, and only passes that climb high enough. Turn on **Announce Upcoming Passes** in the Alerts tab of Settings, see [Pass Alerts](#pass-alerts-settings) below.

## Logging Satellite QSOs

With **Log Satellite Contacts** ticked (BirdWatch tab of Settings), a QSO you log while the selected satellite is up is logged as a satellite contact: its propagation mode is set to Satellite and the satellite's name is added (the ADIF `PROP_MODE` SAT and `SAT_NAME`). If your logging program already set them, its values are kept. Your satellite QSOs then show under **Prop: Satellite** in the Map View Filters.

## Settings: BirdWatch Tab

The BirdWatch tabs sit in a row of their own above the other Settings tabs, in BirdWatch's colors. They are there while BirdWatch is ticked in Settings → Features. Right-click the rig box in the BirdWatch panel to go straight to the BirdWatch tab.

![The BirdWatch tab of the Settings panel](img/GT2_BirdWatch_Settings.png)

### Rig Control

The box in the title turns BirdWatch's use of your radio on or off. While it is ticked, your radio follows the selected satellite, whether you selected it or Auto-Track did. While it is off, BirdWatch sends your radio nothing. It is on by default; the radio itself is set up in Rig Control, see [Rig and Rotor Control](Rig-and-Rotor-Control.md).

* The note under it is a reminder that each VFO's **Satellites** row in Rig Control says what it receives and transmits on, and that you can right-click a transmitter's downlink or uplink to pick its VFO.
* **Lock VFOs:** turning one VFO's dial tunes the other with it, for a linear transponder. The other VFO moves by the same amount, the other way for an inverting transponder. Both keep following the Doppler shift. The lock in the rig box is the same setting.

### Auto-Track

* **Mode:** what Auto-Track picks, see [Auto-Track](#auto-track):
  * **Next Pass:** the satellite that is up, or the next to rise.
  * **Skeds First** (the default): a mutual pass with an active station in the [Skeds](#skeds-passes-with-another-station) tab wins, from three minutes before it opens. Otherwise, as Next Pass.
  * **Skeds Only:** only mutual passes. Between them the selection is left as it is.
* **Lowest Max Elevation:** Auto-Track only selects a satellite whose pass climbs at least this high, 0° to 60°. At 0° every pass counts.

### Logging

* **Log Satellite Contacts:** see [Logging Satellite QSOs](#logging-satellite-qsos).

### Doppler Table

* **Hide Rows With No Uplink:** leaves the transmitters you can't transmit to, such as beacons, out of the transmitters window.
* **Sticky Mode:** when Auto-Track selects a satellite, the radio first follows a transmitter in the same mode as the one you followed before (FM to FM, for example). Otherwise, and for a satellite you select, it follows the transmitter you last followed on that satellite, else the first in the table. A click in the table always sets what you click.

## Settings: Skeds Tab

The stations you share passes with, and your mutual passes with them. See [Skeds: Passes With Another Station](#skeds-passes-with-another-station).

![The Skeds tab](img/GT2_BirdWatch_Skeds.png)

### Stations

Each station is a row:

* **Active:** the station counts for Auto-Track, the Mutual Passes, the Pass Timeline, the map and the alerts. Untick it to keep a station in the list without using it.
* **Callsign** and **Grid:** the other fields wait for a callsign (a callsign that isn't one is shown in orange). A moment after you stop typing it, it is looked up with your lookup service (Settings, Lookups), and the grid from the answer is filled in if **Grid** is empty. A 6-character grid (CN87XX) puts the station within a few kilometers; a 4-character one only within about 100 km, which can move a low pass's start by up to a minute. A grid that isn't one is shown in orange.
* **Height:** the station's height above sea level, if you know it (feet with miles or nautical miles as your distance unit, meters otherwise). It changes little.
* **Min El:** the lowest elevation the station can work, for its trees and buildings. Leave it blank to use your own.
* **Notes:** anything you like, such as "FM satellites only".
* **✕** removes the station.

A station too far away to ever share a pass with you, for the satellites you track, gets a note in orange under its row (and on the map), for example "A mutual pass will never happen: 5433 mi apart, too far for the satellites you track". Two stations can only both see a satellite when they are closer together than what each can see of it at its highest point; tracking a higher satellite (AO-07 reaches about 7,900 km, the ISS about 4,500 km) can change that.

The buttons under the list:

* **Add Station** adds an empty row.
* **Paste Sked Line** adds the stations in the lines you have copied, for example from an email: each line needs a callsign and a grid, and may have a height (`120m`, `400ft`) and a lowest elevation (`min 15°`). A station already in the list, by its callsign, is updated.
* **Copy My Sked Line** copies your own line, for example `K7ABC CN87XX 120m min 10°`, for the other station to paste.

Under them:

* **Your Min Elevation:** the lowest elevation you can work a mutual pass at, 0° to 45°. At 0°, your horizon.
* **Minimum Mutual Duration:** mutual windows shorter than this, 1 to 10 minutes, are left out everywhere: the list, Auto-Track, the timeline and the alerts. Off by default.

### Mutual Passes

The mutual passes of the next 72 hours, in order. Each row shows the satellite (with **(RX only)** for one with no uplink), the day and time in UTC, how long it lasts, the station, and both elevations at the best moment (yours / theirs). A pass under way is shaded green. Hold the mouse over a row for each side's azimuths and highest elevation; click the satellite's name to select it.

* **ICS** saves that pass as a calendar event, and **Copy** copies it as a line of text, for example:

  `SO-50  2026-11-12 18:42–18:49 UTC (7m 10s)  K7ABC CN87 31° / W1XYZ FN31 22°  145.850 up / 436.795 down FM`

* **Save All As ICS** and **Copy All** do the same for every pass in the list.

The calendar event runs from the start to the end of the mutual window, with both callsigns and its length in the title. Its description has the line above, each station's whole pass, and the date of the satellite's TLE. A reminder comes the Alerts tab's **Minutes Before AOS** before it. Times hold to a few seconds only while both stations use fresh TLEs, so the TLE's date is included when you copy too.

## Settings: Display Tab

### Panel View

The drawings shown in the BirdWatch panel: **Skybox**, **Pass Profile**, **Horizon** and **Earth** (see [Sky Views](#sky-views)). **Reset Panels** puts the panel's boxes back in their first order.

### Map

* **Footprint:** draws the footprint of the selected satellite and the one under the mouse. Pick its **Ring** and **Fill** colors and the fill's **Transparency**.
* **Predicted Path:** draws the selected satellite's ground track. Pick its **Line** color, **Dash** (dotted behind the satellite, dashed ahead), **Outline** (a halo in a color of your choice, so the line stands out on any map) and **Width**. **Time** adds a mark with its time every ten minutes ahead, in the size you set.

Options are grayed out while their item is off.

## Settings: Alerts Tab

(pass-alerts-settings)=
### Pass Alerts

* **Announce Upcoming Passes:** announces each pass of a tracked satellite before it rises.
* **Announce Mutual Passes:** announces a mutual pass with an active station (see [Skeds](#skeds-passes-with-another-station)) before it opens, for example: "Mutual pass with W1XYZ on SO-50 in 5 minutes, 7 minutes long". It uses the same minutes and the same ways as the passes' announcements, and can be on by itself.

The options below them appear while one of them is on:

  * **Minutes Before AOS:** how long before it rises, 1 to 30 minutes.
  * **Lowest Max Elevation:** only passes that climb at least this high, 0° to 80° (10° by default). This also chooses which passes Export Passes saves.
  * **Also When It Rises:** a second announcement at AOS, with the azimuth to look at.
  * **Speak:** says it aloud, with the voice, rate and volume of Audio Alerts (and their mute).
    * **Before AOS** and **When It Rises:** your own wording, if you like. In it, `{N}` is the satellite's name, `{T}` the minutes to AOS and `{D}` the degrees (its highest elevation before AOS, the azimuth it rises at). Leave a box empty to use the wording shown in gray.
    * **Mutual Pass:** your own wording for mutual passes: `{C}` is the station's callsign, `{N}` the satellite's name, `{T}` the minutes to it and `{M}` how many minutes it lasts.
  * **Show In Traffic List:** adds the announcement to the Event Viewer.
  * **Send With Pushover / Simplepush:** sends it to your phone as well, with the services set up in Settings → Features → Online (see [Push Notifications](Third-Party-Integrations/PushNotifications-Integrations.md)). Not in Offline Mode.
  * **Test Alert:** makes an announcement now, in every way that is turned on.

## Settings: Telemetry Tab

The Telemetry tab chooses where BirdWatch gets its TLEs. A satellite can only be tracked while one of these sources has a TLE for it.

![The Telemetry tab](img/GT2_BirdWatch_Telemetry.png)

### AMSAT.org

**AMSAT TLE** is AMSAT's daily set of TLEs for the amateur satellites, built in and kept up to date. Tick **Enable** to use it (it is on by default). The line shows how many element sets it holds and their date, or Off.

### SatNOGS

BirdWatch also takes TLEs from [SatNOGS DB](https://db.satnogs.org) for the amateur satellites none of your sources has, such as one launched recently that AMSAT doesn't list yet. Only satellites with a working downlink on an amateur satellite band are taken. These TLEs are always used, and always last: AMSAT's and your own always win. They are downloaded once a day while BirdWatch is on and GridTracker2 is online, so a new install has them after its first update.

### TLE Precedence

When a satellite is in more than one source, the first source in this order that has it is used (AMSAT, Local, Remote, TLE by default). An override (below) always wins, and SatNOGS's TLEs come after all of them.

### Add TLE

Pick what to add, then click **+**:

* **Local:** a TLE file on your computer. **+** opens a file chooser.
* **Remote:** a TLE file on the internet, by its address (https:// or ftp://). If the site needs a login, fill in the **Username** and **Password** under it; otherwise leave them empty. Press **Enter** or click **+** to load it.
* **TLE:** paste or type the two lines of a TLE (a name line before them is optional). As you type, the line under the box says whether they are valid: each line must be 69 characters, the first starting with 1 and the second with 2, with correct checksums, both for the same satellite. **+** waits until they are.
* **Manual:** a form for a TLE's values, one by one: **Name**, **Catalog Number**, **Revolution**, **Epoch (UTC)**, **Inclination**, **RAAN**, **Eccentricity**, **Argument Of Perigee**, **Mean Anomaly**, **Mean Motion** (revolutions per day) and **BSTAR**. Hover over a field for what it means; a value out of range is pointed out. The form has its own Save and Cancel.

If you add a satellite that is already in another source, BirdWatch asks whether to make your TLE an **override**: it is then used for that satellite instead of the other source's. AMSAT's own address can't be added as a remote source; use the AMSAT TLE line instead.

### Your Sources

Each kind you have added gets its own box. Every row starts with **Enable**, so you can turn a source off without removing it, and ends with **✕** to remove it.

* **Local TLE Files:** the end of each file's path (hover for the whole path) and how many element sets it holds, or "File not found". A changed file is noticed and loaded again by itself.
* **Manual TLEs:** each satellite you typed in, with the date of its TLE and an **Override** badge if it overrides another source. **✎** edits it.
* **Remote TLE:** HTTP or FTP, the address, and how many element sets it holds (or "Not loaded yet", or what went wrong). **Refresh Every 24 Hours** loads it again each day (on by default once it has loaded). **🔑** shows its username and password so you can change them, and **↻** loads it now.

## Settings: Satellites Tab

![The Satellites tab](img/GT2_BirdWatch_Satellites.png)

### Tracked Satellites

The satellites BirdWatch tracks. At first these are the ISS, SO-50, AO-91, RS-44 and AO-07. Each row shows the satellite's name (hover for its details), its catalog number, its longer name, its modes and, when it is not simply in orbit, its status.

The **Modes** column shows what a satellite can be worked with (hover over a tag for what it means):

* **FM:** an FM voice repeater, that you can work with an FM handheld (SO-50, AO-91, the ISS).
* **LIN:** a linear transponder, for SSB and CW with a full-duplex radio (AO-07, RS-44, FO-29).
* **DIG:** packet, APRS or another data mode.
* **SSTV:** it sends SSTV pictures (the ISS on its SSTV events). You only listen, so this one shows for a satellite with no uplink too. The Multi-Mode Decoder can receive them.

A satellite with none of these only has beacons or telemetry. They come from the satellite database, so a satellite whose listing is wrong or out of date can show the wrong ones.

* **✕** stops tracking a satellite; the **⊖** in the header stops tracking all of them.
* **✎** opens the satellite's TLE in the Manual form of the Telemetry tab. What you save there overrides the TLE it had, for example when a new satellite's TLE has changed after launch and your sources haven't caught up.

### Add Satellite

* Type part of a name or a catalog number in the search box. The list shows the satellites in your TLE sources that match, with how many were found.
* **Only With Uplinks:** only satellites with a transmitter you can transmit to.
* **Mode:** only satellites you can work in that mode: **FM Voice**, **Linear (SSB/CW)**, **Digital** or **SSTV** (see the Modes column above). **All** lists every one. Going out with an FM handheld? Pick **FM Voice** and press **Scan Near AOS** to see which FM satellites are coming up.
* **Scan By Rig:** only satellites your connected radio **Can Hear** (a downlink in its receive range) or **Can Work** (a downlink it can hear and an uplink it can transmit on, with a second VFO). It needs Rig Control connected to a radio whose frequency ranges are known: rigctld, or an Icom over CI-V (flrig doesn't report them). It is a guide only: BirdWatch doesn't know about a second radio or a transverter.
* **Scan Near AOS:** checks every satellite the filters let through, and lists the ones that are up now and will stay up for five more minutes, and the ones that will rise within the hour. Their **AOS In** column counts down to their rise.
* **+** tracks a satellite (**✓** means it already is); the **⊕** in the header tracks every satellite in the results. **✎** opens a satellite's TLE in the Manual form.

## Auto-Track

With the **Auto Select Next AOS Satellite** button on (it is on by default), BirdWatch selects a satellite for you:

* While satellites are up, it picks the most useful one: first one you can work (an amateur repeater or transponder), then one you can hear. Of equally useful ones, it picks the one that sets first.
* It keeps that satellite until it sets, even if a better one rises meanwhile.
* While none is up, it selects the next one to rise.
* Only passes that climb at least Auto-Track's **Lowest Max Elevation** count.

You can still click another satellite. Your choice stays until Auto-Track's pick moves on to the next pass. The Event Viewer notes each satellite Auto-Track selects.

With an active station in the Skeds tab, Auto-Track's **Mode** (BirdWatch tab of Settings) also counts mutual passes:

* **Skeds First** (the default): from three minutes before a mutual pass opens until it ends, its satellite is selected, even if another one is still up, so your rotator and radio are there in time. A two-way satellite wins over a listen-only one at the same time, then the one that lasts longer. The rest of the time, Auto-Track works as above.
* **Skeds Only:** only mutual passes are selected; between them, the selection is left as it is.
* **Next Pass:** mutual passes make no difference.

In Skeds First and Skeds Only, a satellite you select yourself, even while a sked is under way, stays selected until its LOS if it is up or rises within 15 minutes, otherwise for 15 minutes; then Auto-Track picks again. A mutual pass Auto-Track has picked is kept until it ends, even if another one opens meanwhile. A satellite that is always up for both stations (a geostationary one such as QO-100) is listed, but Auto-Track doesn't select it and it isn't announced.

## Skeds: Passes With Another Station

Skeds help you set up a QSO through a satellite with a station you know, or listen to the same pass. Add the station's callsign and grid in the [Skeds tab](#settings-skeds-tab), and BirdWatch works out the **mutual passes** of the next three days: the times when a tracked satellite is up for you both at once, above your own lowest elevation and theirs. Satellites with an uplink count for a QSO; listen-only ones are marked **(RX only)**. Mutual passes are worked out again every ten minutes, and at once when you change a station, your QTH or the satellites you track.

You see them:

* In the Skeds tab's **Mutual Passes** list, with how long each lasts and both elevations.
* In the [Pass Timeline](#pass-timeline): a row for each active station, under the satellites, with a bar for each mutual pass (green for a two-way satellite, cyan for a listen-only one) and its satellite and length on it. Hold the mouse over a bar for the details; click it to select the satellite.
* On the map: each active station as a light green diamond with its callsign, larger and bright green while a mutual pass with it is under way. Hold the mouse over it for its next mutual passes in full: the satellite, the time, how long, the time to it (or left), both elevations at the best moment, and each side's azimuths and highest elevation.
* In the BirdWatch panel: a **Mutual Pass** row with the station and the time to the selected satellite's next mutual pass (`W1XYZ  AOS 55m 11s`), or to its end while it is under way (`LOS 4m 12s`). Made the featured item, the time goes on its own line under the callsign. Hold the mouse over it for the details; click it to open the Skeds tab.
* As an announcement, with **Announce Mutual Passes** (Alerts tab).

**The active station.** Click a station's diamond on the map, a pass in the Mutual Passes list, or a bar in its timeline row to make that station the active one. Its satellite (for the map, the one of its next mutual pass) is selected, as if you had clicked it (kept until its LOS if it is up or rises within 15 minutes, else for 15 minutes). The Mutual Pass row then shows that station's pass, Skeds First prefers its passes over the others', and the station is marked in yellow on the map, in the list and in the timeline. It is kept when GridTracker2 restarts. Click the active station's diamond again to have no active station (the satellite stays selected).

To arrange the sked, send the other station the pass: **Copy** (a line of text) or **ICS** (a calendar event) in the Mutual Passes list. If they use GridTracker2 too, **Copy My Sked Line** gives them your callsign, grid, height and lowest elevation to paste into their own list.

## Following a Satellite With Your Rig

With [Rig Control](Rig-and-Rotor-Control.md) set up and connected, BirdWatch tunes your radio for the selected satellite and keeps correcting the Doppler shift through the pass: the downlink VFO is kept where the signal is heard, and the uplink VFO where the satellite will hear you.

### Which VFO Does What

In Settings → Radios → Rig Control, each VFO has a **Satellites** row that tells BirdWatch what it may use that VFO for: a band (10m to 1.2cm), **All Frequencies**, or a **Custom** range in MHz, each for **RX**, **TX** or **RX/TX**. Add as many ranges as you need. A new VFO is set to All Frequencies RX; a VFO with no ranges is not used for satellites. For example, for a 2m/70cm FM satellite on a dual-band radio, you might give VFO-A "70cm RX" and its second VFO "2m TX".

When BirdWatch needs a VFO for a downlink or an uplink, it uses the first VFO in the list whose ranges fit. Use the **▲** and **▼** beside a VFO's name to change the order. See [Rig and Rotor Control](Rig-and-Rotor-Control.md) for setting up the VFOs themselves.

To send one transmitter's downlink or uplink to a particular VFO, right-click it in the transmitters window and pick the **Downlink VFO** or **Uplink VFO**. **Automatic** goes back to the first VFO that fits. A picked VFO's letter is shown after the frequency in the App Theme's accent color.

### Starting and Stopping

When a satellite is selected, the radio follows one of its transmitters: the one you last followed on that satellite, else (with Sticky Mode and Auto-Track's pick) one in the same mode as before, else the first in the table. The Event Viewer notes which transmitter is followed, and its downlink and uplink.

In the transmitters window, with Rig Control connected:

* Click a transmitter's **name** to follow all of it: its mode is set, and its downlink and uplink are followed. The uplink is only followed on a radio with a second VFO. Click the name again to stop.
* Click its **Mode** to set only the mode, its **Downlink** to follow only the receive side, or its **Uplink** to follow only the transmit side. Click again to stop that part.
* What is followed is highlighted, and a green line at the top of the window says that the radio is following.

When the uplink is followed and the transmitter's description gives a CTCSS (PL) tone, the tone is set too, on radios that can set one.

**Unfollow** in the rig box stops following and leaves the radio where it is; **Follow** starts again.

### Voice and Data Modes

The mode set on the radio comes from the transmitter: FM for FM voice and packet, USB for SSB and for PSK data, and CW or AM as they are. On an inverting transponder the uplink gets its own mode (for example LSB up, USB down). Modes the radio has no name for are left alone. BirdWatch's voice modes stay as they are even when a VFO's **SSB Data** is ticked in Rig Control.

### Your Own Tuning

You can still tune the radio yourself. When you move a VFO's dial away from the Doppler-corrected frequency, for example to find a station on a linear transponder, BirdWatch keeps your offset and goes on correcting the Doppler shift around it. **Re-center** in the rig box drops your offsets. Following another transmitter starts again with no offset.

With **Lock VFOs** on, turning one VFO's dial moves the other with it, so you stay on the same spot of a linear transponder; on an inverting transponder the other VFO moves the other way.

```{note}
If a VFO reads far from the frequency BirdWatch sent (for example the radio can't tune that band), it is set again, and after a few tries it is no longer followed. If setting the uplink moves the downlink, your radio has no separate VFO for the uplink, and the uplink is no longer followed. Both are explained in the Event Viewer.
```

### Rotor Control: Follow Satellite

With Rotor Control on, tick **Follow Satellite** in its box in Settings → Radios. Your rotator then follows the selected satellite while it is up, and a few minutes before it rises points at where it will come up. The rotator's position is shown in the BirdWatch panel's information. See [Rig and Rotor Control](Rig-and-Rotor-Control.md) for connecting the rotator.

### Multi-Mode Decoder

The Multi-Mode Decoder's **Follow BirdWatch** switches the decoder to the mode of the transmitter your radio follows (CW, SSTV or Sat Data), and listens on BirdWatch's downlink VFO. See [The Multi-Mode Decoder](Multi-Mode-Decoder/Multi-Mode-Decoder.md).

## Data Credits

* Satellite names, details, modes and transmitters come from [SatNOGS DB](https://db.satnogs.org), by the [Libre Space Foundation](https://libre.space) and its volunteer contributors, licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
* The amateur satellites' element sets (TLE) and frequencies come from [AMSAT](https://www.amsat.org), The Radio Amateur Satellite Corporation. Thank you, AMSAT, for keeping the amateur satellites flying and their element sets up to date.
* Element sets for the satellites AMSAT doesn't list come from SatNOGS DB, which gets them from [Space-Track.org](https://www.space-track.org).

These credits are also shown at the bottom of the Satellites tab. See [License Agreement and Copyright](License-Agreement-and-Copyright.md#satellite-data) for the full notices.
