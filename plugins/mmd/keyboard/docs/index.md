# PSK / RTTY / MFSK / DominoEX / THOR

PSK / RTTY / MFSK / DominoEX / THOR is a Multi-Mode Decoder plugin with four modes, each its own entry in the decoder's **Mode** menu: **PSK**, **RTTY**, **MFSK** and **DominoEX / THOR**. Each finds every signal of its mode in the passband and decodes each on its own line, in the decoder's list, as CW's signals are.

Once the plugin is installed, pick one in the decoder's **Mode** menu. How the decoder itself works (its waterfall, Input Device, Rig Control and the Frequency menu) is in the GridTracker2 User Guide, under *The Multi-Mode Decoder*.

## In Every Mode

* **The list:** **Frequency** (on the air with Rig Control, otherwise the audio frequency), **dB**, **Baud** and **Decoded Text**. A **CQ** and the call after it are highlighted, and the line is shaded green.
* Hover over a line and its signal is marked on the waterfall; hover over a signal on the waterfall and its line is shaded.
* Click a line, or a signal on the waterfall, to pin it: its marks stay on the waterfall and its line stays listed. Click it again to let it go.
* Right-click a line and pick **Delete** to remove it. A station that is still sending is listed again with what it sends next.
* **Submode** (the row under the decoder's second line): the submode decoded, in PSK, MFSK and DominoEX / THOR. Changing it clears the list and listens afresh.
* **RSID:** a signal that starts with an RSID is found as soon as it starts. Click its RSID label on the waterfall to switch to its mode and submode; its transmission is decoded from its start.
* **Log QSO:** with **Log QSOs By Hand** on (GridTracker2's Settings → Logging), a line's right-click has **Log QSO...**, which opens the Log QSO window with the call, frequency, time, mode and submode filled in.
* **Detect Modes:** the decoder's Detect Modes also names each PSK31, PSK63, PSK125, QPSK31, RTTY (with its baud and shift), MFSK16, MFSK32, DominoEX and THOR signal it hears (with its speed). Click one to decode it: its mode and submode are picked.

## PSK

PSK decodes every PSK signal in the passband. Pick the submode: **PSK31**, **PSK63**, **PSK125** or **QPSK31**.

* **Frequency menu:** PSK31's usual frequencies from 160 to 2 meters. **Set Mode** sets the rig to USB.

## RTTY

RTTY decodes every RTTY signal in the passband. Each signal's shift (170, 425 or 850 Hz) and speed (45.45, 50 or 75 baud) is found by itself, so there is no submode to pick. Its **Baud** is the speed as read.

* **Frequency menu:** the usual RTTY frequencies from 160 to 10 meters, and W1AW's RTTY bulletin frequencies on 6 and 2 meters. **Set Mode** sets the rig to USB.

## MFSK

MFSK decodes every MFSK16 or MFSK32 signal in the passband, each found by itself. Pick **MFSK16** or **MFSK32**. MFSK16 copies down to about 13 dB below the noise (in 3 kHz).

* **Frequency menu:** MFSK16 from 160 to 2 meters: the W1AW bulletin frequencies (6 and 2 meters among them), the frequencies used in New Zealand, and others. **Set Mode** sets the rig to USB.

Written from ZL1BPU's published MFSK16 specification and IZ8BLY's varicode.

## DominoEX and THOR

**DominoEX / THOR** decodes every DominoEX or THOR signal in the passband, each found by itself. No tuning is needed, and a signal that drifts is followed.

* **Submode:** **DominoEX** or **THOR** at speed 4, 5, 8, 11, 16 or 22, or **DominoEX All Speeds** / **THOR All Speeds** to decode every speed at once. The default is DominoEX 11. Its **Baud** is the speed.
* **Frequency menu:** a DominoEX frequency on each band from 160 to 2 meters, and the THOR22 NBEMS net frequency on 80 meters. **Set Mode** sets the rig to USB.

Written from ZL1BPU's published DominoEX descriptions, with THOR's error correction as W1HKJ describes it.

## Settings

In the decoder window's **Settings** → **Decoders**, under **PSK31**, **RTTY**, **MFSK** and **DominoEX / THOR**:

* **Input Device** and **VFO:** as every mode has them. A new install starts on CW's Input Device.
* **Set Frequency** and **Set Mode:** what picking a frequency in the Frequency menu sends the rig. Shown with **Rig Control** on. Each is on unless you turn it off.

## Test Signals

The decoder's **Test Signals** plays recordings of each mode, several stations at once: BPSK31, the other PSK submodes, RTTY at several bauds and shifts, MFSK16 and MFSK32, and DominoEX and THOR at several speeds. Pick the submode a recording holds to decode it. What a test decodes stays in the window.
