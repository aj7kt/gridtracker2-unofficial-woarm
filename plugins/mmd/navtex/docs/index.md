# NAVTEX

NAVTEX is a Multi-Mode Decoder plugin. It receives the maritime safety broadcasts: weather forecasts, navigational warnings, search and rescue and more. They are sent on 518 kHz (international, in English), 490 kHz (national languages) and HF channels. Each station sends in its own 10 minute slot every 4 hours.

Once the plugin is installed, pick **NAVTEX** in the decoder's **Mode** menu. How the decoder itself works (its waterfall, Input Device, Rig Control and the Frequency menu) is in the GridTracker2 User Guide, under *The Multi-Mode Decoder*.

## The Messages

* **The list:** each message (ZCZC to NNNN) in a block of its own, the newest on top. Its header shows the station, subject and number (for example **WA42**), the subject's name (**Navigational warning**, **Weather forecast**, **Search and rescue** ...), the UTC time, the frequency, and how cleanly it was received: the share of errors in green (received well), yellow, or **incomplete** in red. The message's text follows, as sent.
* A station in the middle of a message shows in a **Receiving** block on top.
* A message already received cleanly isn't listed again when its station repeats it: its header says **heard 2×** (and so on) instead, as NAVTEX receivers do.
* Right-click a message for **Copy To Clipboard**, **Save Message...** or **Delete**.
* **Test Signals** plays a NAVTEX broadcast into the decoder, to see what it decodes. What it decodes stays in the window and is never saved.

## Frequencies

The Frequency menu lists NAVTEX 490 and 518 kHz, HF NAVTEX 4209.5 kHz and the HF maritime safety channels from 4210 to 26100.5 kHz, each by name. **Set Mode** sets the rig to USB.

## Settings

In the decoder window's **Settings** → **Decoders**, under **NAVTEX**:

* **Input Device** and **VFO:** as every mode has them.
* **Set Frequency** and **Set Mode:** what picking a frequency in the Frequency menu sends the rig. Shown with **Rig Control** on. Each is on unless you turn it off.
* **Save Messages** (off at first): saves each complete message as a text file in the **NAVTEX Messages** folder, beside GridTracker2's own folders, named by its UTC time, station, subject and number (for example `20261101-054012Z_WA42.txt`). A saved message's header says **saved**.
