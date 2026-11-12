# WSPR

WSPR is a Multi-Mode Decoder plugin. It decodes each 2 minute WSPR period once it has ended: every station between 1350 and 1650 Hz of audio, down to about -28 dB.

Once the plugin is installed, pick **WSPR** in the decoder's **Mode** menu. How the decoder itself works (its waterfall, Input Device, Rig Control and the Frequency menu) is in the GridTracker2 User Guide, under *The Multi-Mode Decoder*.

## The List

* **UTC**, **dB**, **DT**, **Frequency** (MHz on the air with Rig Control, otherwise audio Hz), **Drift**, **Call**, **Grid**, **dBm** and **Distance** (in the distance unit of Settings). The newest period is on top.
* Each station has one row per band: heard again, its new decode replaces its old row, at the top. Decoded twice in one period, only its strongest is kept.
* The status and how far into the period the decoder is show at the right of the frequency bar under the waterfall, for example **[ 47 / 120 ]**. The waterfall marks each period instead of the **UTC** menu's lines.
* Decodes go to GridTracker2's map, as WSJT-X's WSPR decodes do.

## Frequencies

The Frequency menu lists the WSPR dial frequencies from 2200 meters (136 kHz) to 70 cm. **Set Mode** sets the rig to USB (its data mode with the VFO's **SSB Data**).

## Settings

In the decoder window's **Settings** → **Decoders**, under **WSPR**:

* **Input Device** and **VFO:** as every mode has them. A new install starts on FT8's Input Device.
* **Set Frequency** and **Set Mode:** what picking a frequency in the Frequency menu sends the rig. Shown with **Rig Control** on. Each is on unless you turn it off.

Written from the published WSPR protocol (K1JT's description and G4JNT's specification).
