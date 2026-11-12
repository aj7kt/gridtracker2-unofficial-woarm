# Olivia

Olivia is a Multi-Mode Decoder plugin. It decodes one Olivia or Contestia signal at a time.

Once the plugin is installed, pick **Olivia** in the decoder's **Mode** menu. How the decoder itself works (its waterfall, Input Device, Rig Control and the Frequency menu) is in the GridTracker2 User Guide, under *The Multi-Mode Decoder*.

## Decoding a Signal

* **Submode** (the row under the decoder's second line): **Olivia** or **Contestia** at 4/250, 8/250, 8/500, 16/500, 16/1000 or 32/1000 (tones / bandwidth in Hz). The default is Olivia 8/500.
* **Where to listen:** click the signal on the waterfall. Dashed lines on the waterfall show the band decoded, with the submode at the bottom between them.
* An RSID heard for one of these submodes sets both the submode and where to listen, unless the signal being decoded is still printing. Click an Olivia or Contestia RSID label on the waterfall to switch to Olivia at it, its transmission decoded from its start.
* **The list:** the signal's line, in the decoder's list as CW's are, with its **Baud**. A **CQ** and the call after it are highlighted. Right-click it and pick **Delete** to remove it.
* **Log QSO:** with **Log QSOs By Hand** on (GridTracker2's Settings → Logging), the line's right-click, or **Log QSO** on the decoder's second line, opens the Log QSO window with the call, frequency, time, mode and submode filled in.

## Frequencies

The Frequency menu lists the Olivia calling frequencies from 160 to 6 meters (8/250 on HF, 16/500 on 6 meters), a 60 meter and a 2 meter frequency, and the 32/1000 frequencies on 30 and 20 meters. Pick a frequency and put the signal at 1500 Hz on the waterfall. **Set Mode** sets the rig to USB.

## Settings

In the decoder window's **Settings** → **Decoders**, under **Olivia**:

* **Input Device** and **VFO:** as every mode has them. A new install starts on CW's Input Device.
* **Set Frequency** and **Set Mode:** what picking a frequency in the Frequency menu sends the rig. Shown with **Rig Control** on. Each is on unless you turn it off.

The decoder's **Test Signals** plays Olivia and Contestia recordings; while one plays, its submode and place are set, and yours come back when it ends.
