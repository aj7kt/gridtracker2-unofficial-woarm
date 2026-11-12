# The Multi-Mode Decoder

The **Multi-Mode Decoder** decodes the signals your receiver hears, right inside GridTracker2, without another program. It listens to your rig's audio (or an SDR's), shows the whole passband as a waterfall, and decodes every signal it finds there in the mode you pick: CW, SSTV, satellite data and WWV / WWVH.

You don't need Rig Control to use it. Without it, the decoder shows audio frequencies (Hz in your receiver's passband). With it, the decoder shows each signal at its frequency on the air, and can tune your rig.

This chapter covers the window and the settings shared by every mode. Each mode is described in [Decoder Modes](Decoder-Modes.md).

## Turning It On

In [Settings → Features](../GridTracker-Overview/Settings-Sub-Menus.md#features-tab), under **Service**, tick **Multi-Mode Decoder**. This adds the **Toggle Multi-Mode Decoder** button to the button panel.

* Click the button to show or hide the Multi-Mode Decoder window.
* Right-click it to show the window (it is never hidden by a right-click).
* The window opens where you last left it. If it was open when you closed GridTracker2, it opens again at the next start.

Turning **Multi-Mode Decoder** off hides the window, stops it listening and removes the button.

### Listening in the Background

While **Multi-Mode Decoder** is on, the decoder listens and decodes all the time in the mode you picked, whether its window is showing, hidden or minimized. Hidden, it only stops drawing the waterfall. GridTracker2's **MMD** instance stays open (see [Decodes in GridTracker2](#decodes-in-gridtracker2)). Pictures and charts keep coming in, and are saved if you set them to be. Show the window again to see everything that came meanwhile. A picture being sent stops when you hide the window.

A green dot on the **Toggle Multi-Mode Decoder** button shows that it is listening in the background. Hover over the button and its tooltip says so. Turn **Multi-Mode Decoder** off to stop it listening and let go of the sound card.

## The Window

![The Multi-Mode Decoder in CW mode during a contest on 15 meters](../img/GT2_MMD_Window.jpg)

From top to bottom, the window has:

1. the top line: **Settings**, **Clear**, the audio levels, **Test Signals**, **Detect Modes** and the status;
2. the second line: **Mode**, the Frequency menu, and the mode's own controls;
3. the band scope strip, for an Icom radio that sends its scope (see [The Band Scope](#the-band-scope));
4. the scale, with the **[** and **]** handles;
5. the waterfall;
6. the frequency bar, with the frequency, band and mode;
7. the decoded lines (or, in SSTV, the pictures).

### The Top Line

* **Settings:** opens the window's own settings panel (see [Settings](#settings)). Click it again, or the red **X**, to close it.
* **Clear:** forgets every signal decoded and starts again from scratch: the lines, the waterfall, and what the decoder has learned about each signal.
* **Levels:** the audio levels of the Input Device, for example `-3 dB  45%`. Hover over them to set them (see [Audio Levels](#audio-levels)).
* **Test Signals:** plays recordings of the mode's signals into the decoder (see [Test Signals](#test-signals)).
* **Detect Modes:** listens for every mode at once and names each signal it finds (see [Detect Modes](#detect-modes)).
* The status, on the right: **Listening**, **Starting audio…**, or an error in orange, such as an Input Device that couldn't be opened.

### The Second Line

* **Mode:** what is decoded. The modes are listed in [The Modes](#the-modes). The mode you pick is kept when GridTracker2 restarts. The menu's last entry, **Manage Decoders...**, lists more decoders you can download, and turns the ones you have on or off (see [Managing Decoders](#managing-decoders)).
* **Frequency menu:** each mode's usual frequencies. Pick one to tune your rig there. It appears only with Rig Control (see [The Frequency Menu](#the-frequency-menu)).
* **UTC:** lines across the waterfall on the UTC clock, each with its time: **Off**, 10s, 15s, 30s or 1m.

A mode can add a row of its own under the second line, such as a **Submode** menu. See [Decoder Modes](Decoder-Modes.md).

### The Scale and the Waterfall

The waterfall shows the passband as it is heard, the newest at the top. Low frequencies are always on the left and high on the right, in LSB and CW-R too. Each signal found is marked on it.

The scale above it shows the frequencies: audio frequencies without Rig Control, frequencies on the air with it.

**[** and **]** on the scale set the lowest and highest audio decoded. Drag them to leave out hum and noise at the low end, or a busy part of the passband. What is outside them is dimmed and not decoded. Hover over a handle to see its frequency. Each mode keeps its own **[** and **]**.


When you change band, or pick a frequency from the Frequency menu, a bar is drawn across the waterfall with the new band and frequency on it. The waterfall is kept. When you turn the dial on the same band, the waterfall slides across so each signal stays at its frequency on the air.

How the waterfall moves and looks is set in [Settings → General](#general): **Waterfall Speed**, **Waterfall Style**, **Palette**, **Resolution**, **Window** and **Sharp Pixels**.

### The Frequency Bar

The bar between the waterfall and the decoded lines shows, in its center:

* with Rig Control, the rig's frequency, band and mode, for example **14.074.00 (20m) USB** (the frequency in green, the band in yellow, the mode in orange);
* without it, the audio decoded, from the **[** to the **Bandpass**, for example **250 Hz - 4 kHz** in cyan.

Drag the bar up or down to give the waterfall or the decoded lines more room.

### The Decoded Lines

Under the bar are the decoded lines, the newest kept in view. Their columns depend on the mode. In CW, for example, each signal has one line with its **Frequency**, **dB** (its signal over the noise), **WPM** and **Decoded Text**. A mode can use the same list, with the **Baud** in place of WPM.

A **CQ** is highlighted in yellow, the call after it in cyan, and its line is shaded green.

## Working With Signals

These work in CW, and in the modes listed the same way.

* **Hover linking:** hover over a line and its signal is marked on the waterfall. Hover over a signal on the waterfall and its line is shaded.
* **Pinning:** click a line to pin its signal (in CW, a click on the signal on the waterfall does it too). Its marks stay on the waterfall and its line stays listed, even while you tune elsewhere. Its line has a light red edge. Click it again to let it go.
* **Deleting a line:** right-click a line and pick **Delete**. A station that is still sending is listed again with what it sends next.
* **Copying text:** select text in a line with the mouse to copy it. A click that selects text doesn't pin.

Other modes can have clicks of their own. See [Decoder Modes](Decoder-Modes.md).

### Tuning Lock

With Rig Control on, a lock sits before the rig's frequency on the divider. Gold and closed, tuning is locked (as it starts); grey and open, it is unlocked. Click the lock to unlock it: the mouse wheel on the waterfall then tunes your rig, 10 Hz a step (hold Shift for 100 Hz, Ctrl for 1 Hz), each step landing on that step's round number. A label over the waterfall shows the frequency tuned to and the change (its total while you keep turning the wheel), then fades; a click on the band scope shows one over the scope the same way. Click it again to lock it; a middle-click on the waterfall locks or unlocks it too. While BirdWatch follows a satellite with the rig, the lock stays closed: the decoder sends nothing to the rig then.

## Test Signals

**Test Signals** (beside the levels) lets you see what the decoder does without waiting for signals on the air. Click it and pick a recording from the menu. Each entry gives the number of signals in it, and whether it starts with an RSID or was recorded off the air.

* The window is cleared first. The recording is then played into the decoder over a band's noise floor, and what your radio hears is silenced while it plays.
* Many recordings have several stations at once. Every mode has some.
* While one plays, the button shows **Stop Test** and the seconds left. Click it to stop.
* What a test decodes stays in the window. It isn't sent to the map or the Call Roster, and its pictures aren't saved by themselves.

The button is shown while the decoder is listening and the mode has test signals.

## Detect Modes

Not sure what a signal is? Click **Detect Modes**. The decoder listens for every mode at once and names each signal it finds, once it decodes: CW (with its speed), SSTV (with its mode), the modes of the decoders you've added, and any mode an RSID names.

![Detect Modes: signals found and named](../img/GT2_MMD_Detect.jpg)

* Each signal is labeled on the waterfall, and listed in place of the decoded lines with its **Mode**, **Frequency**, **dB** and what was **Heard**.
* Click one, on the waterfall or in the list, to decode it: its mode and submode are picked and Detect Modes turns off. A CW signal is pinned.
* The button is orange while Detect Modes is on. Click it again to go back to the mode you were in. Picking a mode in **Mode** also ends it.

## RSID

Many digital-mode programs (fldigi, MultiPSK and others) can start a transmission with an RSID, a short burst that names its mode. With **RSID** on (in [Settings → General](#general), on unless you turn it off), the decoder names each RSID it hears on the waterfall where the transmission starts, in every mode: for example **RSID Olivia 8/500**, **RSID MT63-1000L** or **RSID BPSK31**.

Click an RSID of a mode decoded here (one of the decoders you've added) to switch to that mode and submode. The transmission is decoded from its start, and nothing already decoded is cleared.

## Audio Levels

The levels on the top line are those of the mode's Input Device. Hover over them for two sliders and a peak meter:

* **SW:** a gain inside the decoder, from -20 to +20 dB. Each mode keeps its own. It can't undo clipping in the sound card.
* **HW:** the Input Device's own recording level, the same one your computer's sound settings set. It is shown only when your computer has one for that device (on macOS, only for the default input). It changes the level for every program using that device.
* The meter beside them shows the peak of the audio the sound card hands over, in dBFS. It turns yellow within 6 dB of full scale and red within 1 dB.

Set **HW** so the loudest signals stay out of the red: a sound card driven into clipping garbles every signal in the passband. The wheel steps either slider.

```{tip}
If your rig's audio is too loud, turn down **HW** (or the rig's own USB audio level) first. **SW** only helps a signal that is too quiet.
```

## The Modes

Pick the mode in **Mode** on the second line. Each one is described in [Decoder Modes](Decoder-Modes.md).

| Mode | What it decodes |
| --- | --- |
| [CW](Decoder-Modes.md#cw) | Every CW signal in the passband, each on its own line with its speed. |
| [Sat Data](Decoder-Modes.md#sat-data) | Satellite telemetry frames and SSDV pictures. |
| [SSTV](Decoder-Modes.md#sstv) | Slow-scan TV pictures, received and sent. |
| [WWV / WWVH](Decoder-Modes.md#wwv-and-wwvh) | NIST's time stations: their time code, and how far your PC clock is off. |

The right-click menus of pictures, charts and messages (copy, save, delete, rotate) are described with each mode.

### Managing Decoders

More modes come as decoders you download. Pick **Manage Decoders...**, the last entry of the **Mode** menu, to see the ones for your version of GridTracker2:

* **Install** downloads a decoder. **Update To** downloads a newer version of one you have, and **Remove** takes one away.
* **Enabled** turns a decoder you have on or off. One turned off isn't loaded and its modes leave the **Mode** menu; its settings are kept for when you turn it on again.
* Each change waits until GridTracker2 restarts. Click **Restart Now** to restart it at once (your settings and open windows are kept), or **Undo** to cancel an install or removal before then.
* Nothing is downloaded until you click. Each download is checked against GridTracker's signature before it is used.

Once installed, a decoder's modes appear in the **Mode** menu. Each decoder has its own guide: click **Guide** in its box in [Settings → Decoders](#decoders).

## Using Rig Control

The decoder works on its own, from audio alone. Rig Control is optional. It lets the decoder:

* read the rig's frequency and mode, so signals are shown at their frequency on the air and the frequency bar shows the band;
* tune the rig, from the Frequency menu, the mouse wheel on the waterfall (unlocked) or a click on the band scope;
* set the rig's mode when you pick a frequency;
* give GridTracker2's MMD instance its band.

To use it:

1. Set up your rig as a VFO in Settings → Radios → **Rig Control**. See [Rig and Rotor Control](../Rig-and-Rotor-Control.md).
2. In the decoder window, open **Settings**, and on the **General** tab tick **Rig Control**. It is off until you turn it on: while it is off, the decoder sends your rig nothing at all.
3. Pick the VFO the decoder reads: under **Common VFO** on the **General** tab, or for each mode on the **Decoders** tab (see [Settings](#settings)).

```{note}
**Common VFO** is **None** until you pick one. With Rig Control on and no VFO picked, the decoder still shows audio frequencies only.
```

While BirdWatch follows a satellite with a rig, the decoder sends that rig nothing: the Frequency menu is grayed out until BirdWatch stops following it.

### The Frequency Menu

With Rig Control on and the mode's VFO read, the Frequency menu appears on the second line. It lists the mode's usual frequencies, each with its band, for example **20m (14.074.00)**. WWV / WWVH lists its stations by name instead. The frequency your rig is on is picked in the menu; on another frequency, the menu shows **-**.

Picking a frequency sends your rig what that mode allows in [Settings → Decoders](#decoders):

* **Set Frequency:** tunes the rig there;
* **Set Mode:** sets the rig's mode, for example CW for CW, USB for the digital modes, and LSB below 10 MHz and USB above for SSTV.

Both are on unless you turn them off. With both off, the menu isn't shown. With **Data** ticked for the VFO's **SSB** in Rig Control, the digital modes use the rig's data mode (USB-D, PKTUSB, DATA-U) instead of plain USB or LSB.

Sat Data has no Frequency menu.

The frequencies come from the [Band Plans](#band-plans) tab, where you can change them.

With a mode's **Set Frequency** on, picking that mode in the **Mode** menu tunes the rig to the mode's main frequency on the band you're on (its usual calling or activity frequency, ticked **Main** in [Band Plans](#band-plans)). A band without a main frequency for the mode uses the one nearest the dial. When the mode has no frequency on that band, the rig goes to the band of the mode's nearest frequency, and to its main frequency there. A rig already on one of the mode's frequencies is left there. A mode picked any other way (by an RSID, Detect Modes or Follow BirdWatch) doesn't tune the rig, since the signal is where the rig already is.

## The Band Scope

An Icom radio that sends its spectrum scope over USB (the IC-7300 and others) can show its own scope in a strip above the decoder's waterfall. You see the whole span the radio shows, not only the audio passband.

![An IC-7300's band scope above the decoder's waterfall](../img/GT2_MMD_Band_Scope.jpg)

To turn it on, tick **Use Scope If Present** in the Icom CI-V VFO's box in Settings → Radios → Rig Control (see [Rig and Rotor Control](../Rig-and-Rotor-Control.md)). It is off until you check it. The strip then shows while the decoder window is open, its Rig Control is on, and the mode's VFO is that radio.

* The frequencies run along its top, and the radio's own waterfall under them, the newest at the top. Its colors start at the band's noise floor, so it looks the same at every span.
* Where the radio is tuned is marked with a line in the theme's frequency color, and the audio the decoder takes (between **[** and **]**) is shaded.
* What's outside the amateur bands is shaded in the theme's warning color (orange in the GridTracker2 theme), with a line at each band edge. **Out Of Band Shading** in the window's Settings, [Rig Scope](#rig-scope) tab, sets how strongly.
* Move the mouse over the strip to see the frequency under it, with a line. Outside the amateur bands (5.1000 MHz, for example) the line and frequency are in the warning color.
* Click the strip to tune the radio there: what you click is put in the middle of the audio decoded.
* **−** and **+** in its top corners narrow and widen the radio's span, from ±2.5 kHz to ±500 kHz, going round at either end. The span is shown beside them, for example **−500 kHz** and **+500 kHz**. In the radio's Fixed mode, the edges are set at the radio, and **−** and **+** are grayed out.

The radio needs these settings for the scope to come:

* **CI-V USB Baud Rate** at 115200, on the radio and in Rig Control.
* **CI-V USB Port** set to **Unlink from [REMOTE]**, on the radio.
* The radio's scope turned on.

If one is missing, a yellow note under **Use Scope If Present** and over the strip says which, for example: "The scope needs 115200 baud: set it here and on the radio (CI-V USB Baud Rate)". While the strip waits for the first sweep it shows "Waiting for the radio's scope" in gray.

## SDR Inputs

A **SPY Server** (an Airspy or RTL-SDR shared over the network) or an **SDR++ (Server)** set up as a VFO in Rig Control sends its I/Q stream to the decoder. Its stream is listed in every **Input Device** menu by the server type and its VFO's name, for example **SPY Server: VFO-C (HF+)**. Setting up these VFOs is described in [Rig and Rotor Control](../Rig-and-Rotor-Control.md).

* Pick it as the **Input Device**, and pick the same VFO as the mode's **VFO**, so the signals are shown at their frequency on the air.
* The decoder hears the audio above the VFO's frequency, as in USB.
* An SDR gives far more than a rig's 3 kHz: set **Bandpass** in [Settings → General](#general) to decode more of it, up to the whole of a 96 kHz stream.
* While the server can't be reached, the status says **Waiting for** and the input's name, and the decoder tries again by itself.
* The server only streams while a decoder uses it.

## Network Inputs and Outputs

Audio from another computer, or from a networked rig, is in the **Input Device** and **Output Device** menus too:

* The streams set up in [Network Audio](../Network-Audio.md) (Settings → Audio), by protocol and name, for example **VBAN: Shack PC** or **RTP (PipeWire / PulseAudio / AES67): Desktop**.
* A FlexRadio or Icom LAN VFO's own audio, for example **FlexRadio DAX: VFO-A (Flex)** or **Icom LAN: VFO-B (IC-9700)**.

While a network input's first audio hasn't arrived yet, the status says **Waiting for audio from** the input, with the stream's own status after it. The decoder runs at the stream's own sample rate, and starts again by itself if the stream changes rate. With a rig's own network audio as the Input Device and no Output Device picked, SSTV pictures are sent back to the same rig.

The HW level isn't shown for an SDR input; SW still works.

## Decodes in GridTracker2

While the Multi-Mode Decoder is turned on in Settings → Features, GridTracker2 has an instance named **MMD**, as it has one for each WSJT-X or JTDX. Its mode is the decoder's mode (CW, SSTV ...), and its band is the one Rig Control reads on that mode's VFO. Without Rig Control, its frequency is 0 and GridTracker2 doesn't know its band. It is there whether the window is open or not, and the Event Viewer notes when it starts and closes.

## Sending SSTV Pictures

In **SSTV** mode the picture view has two tabs on its header: **Receive** (the pictures received) and **Send**, which builds a picture and transmits it through your rig. See [Sending Pictures](Decoder-Modes.md#sending-pictures).

## Logging a QSO

The decoder can fill in a QSO you made in CW, SSTV, the modes of the decoders you've added that QSOs are made in, or on phone, in GridTracker2's [Log QSO](../Making-GridTracker-Work-For-You/Other-Windows.md#log-qso) window, which logs it. Turn on **Log QSOs By Hand** in [Settings → Logging](../GridTracker-Overview/Settings-Sub-Menus.md#logging-tab) (off until you turn it on); the decoder's Log QSO buttons and menu items show with it.

The **Log QSO** window opens filled in from:

* **A line's right-click, Log QSO...** (CW, and the modes listed the same way), or **an SSTV picture's right-click**. The call is the one the decoded text names (the call after the last DE, else after CQ); the frequency is the signal's own on the air (with Rig Control), the time on is when its line started (an SSTV picture's start), the mode and submode are the ones decoded. An SSTV picture's mode (Martin 1, Scottie 2 ...) goes in the comment.
* **Log QSO** on the second line, in those modes: the pinned line (SSTV: the picture shown), else a form with the mode, the frequency and the time filled in for you to type the call.
* **Log Phone QSO** on the top line, shown while Rig Control reads the decoder's VFO in a voice mode (USB, LSB, AM, FM, D-STAR, C4FM, FreeDV ...), whatever mode is shown. The frequency and mode are the rig's, and the time on is when you opened it. If you clicked a station in the Feed Roster (or a spot on the map) and the rig is still within 1 kHz of that spot, its call, park and grid are filled in, and the time on is when you clicked it.

The reports start at 599 (59 on phone, 595 for SSTV). Check the window, fill in what's missing, and log it there: see [Log QSO](../Making-GridTracker-Work-For-You/Other-Windows.md#log-qso).

```{note}
The decoder has no Log QSO for the modes no QSO is made in (WWV, Sat Data).
```

## Settings

Click **Settings** on the window's top line to open its settings panel. It has four tabs: **General**, **Rig Scope**, **Decoders** and **Band Plans**. Close it with **Settings** again or the red **X**.

![The decoder's Settings, General tab](../img/GT2_MMD_Settings_General.png){width=330px}

### General

The waterfall, for every mode:

* **Waterfall Speed:** how fast the waterfall moves down, from 0.1× to 4×. At 1× it is as heard (about 7 seconds in view); slower holds more time (about a minute at 0.1×), faster gives each moment more room.
* **Waterfall Style:** how the levels are colored:
  * **Auto Level:** the colors follow the band's level by themselves.
  * **WSJT-X:** the levels as heard, with **Gain** (contrast) and **Zero** (the level drawn black) sliders.
  * **Crisp:** the noise drawn black, with **Floor** (dB over the noise still drawn black) and **Range** (dB from black to white) sliders.
* **Palette:** the waterfall's colors: **Classic**, **Ember**, **Twilight**, **Neon**, **Aurora**, **Clear Sight** (easy to read with red-green color blindness), **Prism**, **Glacier**, **Phosphor**, **Moonlight** or **Paper**.
* **Resolution:** sharper in time or in frequency: **By Mode** (CW sharp in time for crisp dots and dashes), **Sharpest Time**, **Sharp Time**, **Balanced** or **Sharp Frequency**.
* **Window:** **Hann** or **Blackman-Harris** (a darker floor beside strong signals).
* **Sharp Pixels:** each frequency drawn as a sharp block.

Then:

* **Bandpass:** the audio decoded, from 0 Hz up. 2.5k to 4.5k suits a rig's passband; 10k, 44.1k, 48k and 96k are for an SDR's wider stream (the last three are the whole of a stream at that sample rate). Changing it starts the decoder again.
* **Rig Control:** lets the decoder read each mode's VFO and send the rig what each mode allows. Off until you turn it on; off, the decoder has nothing to do with your rigs and shows audio frequencies only. See [Using Rig Control](#using-rig-control).
* **Follow BirdWatch:** shown while BirdWatch is on with its Satellite Tracking toggled on. As BirdWatch's rig starts following a satellite transmitter, the decoder switches to its mode (CW, SSTV or Sat Data). You can still change **Mode** afterwards. While BirdWatch is on with its Rig Control, every mode reads BirdWatch's Downlink VFO, and the VFO menus show it grayed out. Off until you turn it on.
* **RSID:** names the mode of a transmission on the waterfall when its sender starts it with an RSID (see [RSID](#rsid)). On unless you turn it off.
* **Common Input Device:** one Input Device for every mode, picked in the menu under it. Off, each mode uses its own (on the **Decoders** tab), as you left it. On unless you turn it off.
* **Common Output Device:** one Output Device for every mode that transmits (SSTV), picked in the menu under it. Off, SSTV uses its own. On unless you turn it off.
* **Common VFO:** shown with **Rig Control** on. One Rig Control VFO for every mode to read and tune, picked in the menu under it (**None** until you pick one). Off, each mode uses its own VFO (on the **Decoders** tab). On unless you turn it off.

```{tip}
Pick the sound card your rig's audio comes in on, often called "USB Audio CODEC", as the **Input Device**. Don't pick it as GridTracker2's own **Output Device** in Settings → Audio, or GridTracker2's alerts would be transmitted.
```

If an Input Device you picked has gone missing, or your computer's audio inputs have changed, GridTracker2 warns you, with **Warning when audio devices change** on in [Settings → Audio](../GridTracker-Overview/Settings-Sub-Menus.md#audio-tab). A missing Input Device is replaced by your computer's default input until it comes back.

### Rig Scope

The [band scope](#the-band-scope) strip:

* **Out Of Band Shading:** how strongly what's outside the amateur bands is shaded in the theme's warning color, from 0% (not at all) to 100% (solid). 18% unless you change it.
### Decoders

The **Decoders** tab has a box for each mode. (The decoder's Log QSO buttons and menu items show with **Log QSOs By Hand** on in GridTracker2's Settings → Logging: see [Logging a QSO](#logging-a-qso).) Each box can have:

* **Input Device:** the rig's audio this mode listens to. Shown while **Common Input Device** is off.
* **Output Device** (SSTV): the audio output pictures are sent to (the rig's audio input). Shown while **Common Output Device** is off.
* **VFO:** the Rig Control VFO this mode reads (the frequency shown, and the signals' frequencies on the air) and, with Rig Control, tunes. **None**, or one of your VFOs by name. Shown with **Rig Control** on and **Common VFO** off. With Common VFO off, a mode with none picked reads your first VFO.
* **Set Frequency** and **Set Mode:** what picking a frequency in the Frequency menu sends the rig (see [The Frequency Menu](#the-frequency-menu)). Shown with **Rig Control** on. Each is on unless you turn it off.

Some modes have settings of their own here, described in [Decoder Modes](Decoder-Modes.md):

* **SSTV:** **Save Pictures**, and its **Folder** (click it to open it, **Choose** to pick another).

Running one sound card for several radios? Turn off **Common Input Device** and **Common VFO**, and give each mode its own. For example, SSTV can listen to an SDR on a VFO of its own while CW listens to your HF rig.

A VFO removed in Rig Control is taken out of every mode's menu at once; a mode that used it uses **None** until you pick another.

### Band Plans

The **Band Plans** tab lists each mode's usual frequencies: the ones the Frequency menu lists.

![The Band Plans tab](../img/GT2_MMD_Band_Plans.png)

* Pick a mode in the **Frequencies** menu, or **All Modes**.
* Each row has the **Mode**, **Band**, **Frequency (MHz)**, **Rig Mode** (USB, LSB, CW, FM or AM), **Main** and a **Note** (its region, net or DXpedition, or a station's name and schedule).
* **Main** marks the band's main frequency for the mode: the one the rig is tuned to when you pick the mode in the **Mode** menu. A band has one main frequency per mode; ticking another unticks it.
* Click a value to edit it in place.
* To add a frequency, fill in the top row and click **Add**. The **×** at the end of a row deletes it.

Your edited copy is used from then on, and **Your edited band plans are in use** is shown at the top. **Restore Shipped** deletes your edits and goes back to the band plans GridTracker2 ships.
