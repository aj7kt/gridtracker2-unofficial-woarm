# Packet

Packet is a Multi-Mode Decoder plugin. It decodes AX.25 packets, listening for all of these at once: AFSK 1200 (APRS, the ISS's digipeater), FSK 9600 and GMSK 4800 (G3RUH, from a rig's 9600 data audio), and HF packet at 300 baud.

Once the plugin is installed, pick **Packet** in the decoder's **Mode** menu. How the decoder itself works (its waterfall, Input Device, Rig Control and the Frequency menu) is in the GridTracker2 User Guide, under *The Multi-Mode Decoder*.

## The List

* **UTC**, **Baud**, **From**, **To / Path** and **Message**, one packet a line, the newest on top. A packet with one bit wrong, or two side by side, is put right rather than lost.
* APRS is read: positions (plain, compressed and Mic-E, with the grid, course, speed and altitude), messages, status, objects, items, weather and telemetry. Other packets are shown as they are.
* A message to you is highlighted.
* AFSK 1200 heard through an SSB receiver (a satellite's packets, or a rig tuned a little off) is decoded up to 600 Hz off its usual tones.
* A packet heard while BirdWatch follows a satellite with the rig is marked **via** that satellite, in cyan.

## HF Packet

HF packet is found wherever its tones land between the **[** and **]**, so a station a little off frequency is still decoded. Each place one was heard lately is ticked at the top of the waterfall; hover over a 300 baud line's **Baud** to see where it was heard.

* Click the waterfall, or a 300 baud line, to lock onto that place: only it is decoded, marked by a tick with guard lines either side. Click inside the guards to let go.

## Frequencies

The Frequency menu lists HF APRS (7.0486, 10.1476, 14.103 and 28.14 MHz), 300 baud packet on 80, 17, 15 and 12 meters, 10 meter APRS (29.25 MHz FM), 6 meter packet calling (50.62 MHz FM), the VHF APRS frequencies around the world, and the ISS's digipeater (145.825 MHz, and 437.825 MHz). **Set Mode** sets the rig to FM for VHF and LSB for HF packet.

With **Follow BirdWatch**, a satellite transmitter sending AFSK, AX.25 or G3RUH switches the decoder to Packet.

## RSID and Detect Modes

* A Packet 1200 RSID clicked on the waterfall switches the decoder to Packet, its transmission decoded from its start.
* The decoder's **Detect Modes** also names each packet it hears (with its baud). Click one to decode it: an HF station's place is locked onto.

## Settings

In the decoder window's **Settings** → **Decoders**, under **Packet**:

* **Input Device** and **VFO:** as every mode has them. A new install starts on FT8's Input Device (a rig's data audio).
* **Set Frequency** and **Set Mode:** what picking a frequency in the Frequency menu sends the rig. Shown with **Rig Control** on. Each is on unless you turn it off.

The decoder's **Test Signals** plays APRS at AFSK 1200 and HF packet at 300 baud.
