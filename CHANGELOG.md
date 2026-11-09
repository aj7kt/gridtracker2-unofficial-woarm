# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),

## [v2.261109.3]

### MD Markup Format
#### Map / UI

- Five new base maps: Topographical by OpenTopoMap, Satellite (no labels), Topographical and Satellite Topo by USGS (best coverage in the US), and Satellite Firefly by Esri
- New Santa Tracker: a new button in the button panel will appear on Dec 1st that follows Santa and his reindeer around the world, using amateur radio tracking technology
  - Move the mouse over a stop to see its DXCC entity, and state or province
- The Kp button now grows smoothly under the mouse, like the other buttons in the button panel
- Band Activity, the counts and Map View Filters can be rearranged in the control panel, above or below the buttons: drag a box by its top border (the cursor shows a hand there)
  - Settings, General: Reset Panels puts them back in their usual order; Reset Button Panel is now called Reset Button Order
- The help button in the button panel has a new icon and now opens the new GridTracker2 User Guide in its own window, with search, page thumbnails, contents, zoom, print and save
  - Click the button to show or hide the window, right-click it to only show it; Esc closes it
  - F1 still shows the hotkey list

#### Multi-Mode Decoder

- New Multi-Mode Decoder (Settings, Features, Service): decodes every CW signal in your receiver's passband, or FT8, and shows them in its new window, opened with the Toggle Multi-Mode Decoder button
  - A waterfall of the passband with each signal found marked on it, and a line of decoded text for each signal with its frequency and speed
  - A CQ and the call after it are highlighted
  - Settings, on the window's top line: Rig Control (off unless turned on: the decoder has nothing to do with the rigs and shows audio frequencies only), then each decoder's own settings (the Multi-Mode Decoder itself is still turned on in Settings, Features)
  - Follows each operator's own speed, weighting and spacing (Farnsworth too), and copes with fading
  - A strong signal is taken out of the audio the others are decoded from, so a weaker one close beside it can be read
  - With Rig Control connected, signals are shown at their frequency on the air
  - The waterfall always runs from low frequencies on the left to high on the right, in LSB and CW-R as well
  - Text already decoded is corrected as the decoder learns more of an operator's timing: the start of a transmission, or a change of speed part way through (corrected text glows for a moment)
  - The mouse over a signal's line marks the signal on the waterfall, and the mouse over a signal on the waterfall shades its line
  - Clear: forgets everything decoded and starts again from scratch
  - Click a signal to pin it: its marks stay on the waterfall and its line stays listed
  - Drag the [ and ] on the scale to set the lowest and highest audio decoded (hum and noise below a few hundred Hz left out)
  - Bandpass (the window's Settings, General): decode a rig's passband (2.5k to 4.5k), or much more of an SDR's audio (up to the whole of a 96 kHz stream)
  - A band change, or a frequency picked from the Frequency menu (on the same band too), is marked on the waterfall with a bar, the band and frequency on it, and the waterfall is kept
  - Whenever the rig is retuned, FT8 doesn't decode a period with audio from both frequencies (only what the new one gave), nor SSTV a picture across the change
  - VFO (the window's Settings, Decoders): the Rig Control VFO each mode reads and tunes, so an SDR on a VFO of its own can be decoded while the rig's other VFOs are busy
    - A VFO removed in Settings, Rig Control is taken out of every mode's and BirdWatch's menus at once, and what used it uses None until another is picked
  - Common Input Device and Common VFO (the window's Settings, Decoders; both on unless turned off): every mode listens to one Input Device and reads one VFO, each picked under its checkbox; turned off, each decoder's own comes back as it was. The common VFO is None until one is picked
  - SDR++ (Server) (a VFO's connection in Settings, Rig Control; SDR++ started with --server): its device is a VFO of its own, tuned like a rig, its Source, Device and Sample Rate picked from its own menus in the VFO's box (Refresh looks for devices again), and its I/Q in every mode's Input Device menu, as SPY Server's is; the server streams only while a decoder uses it
  - SDR++ (rigctl) (a VFO's connection in Settings, Rig Control): the SDR++ window's own VFO through its Rigctl Server module, read and tuned like a rig (SDR++ keeps its audio; one client at a time)
  - SPY Server by Airspy (a VFO's connection in Settings, Rig Control): an Airspy or RTL-SDR shared by SPY Server is a VFO of its own, its frequency read and tuned like a rig's, and its I/Q stream is in every mode's Input Device menu, decoded as the audio above that frequency (USB)
  - Frequency: the rig's frequency, band and mode are shown centered on the bar between the waterfall and the decoded lines (drag the bar to size the waterfall; in FT8, FT4 and WSPR its right end shows how far into the period it is, as [ 7 / 15 ]), and with Rig Control a menu on the second line lists each mode's usual frequencies, CW's QRP calling frequencies, FT8's and SSTV's; picking one sets the rig's frequency (Set Frequency) and its mode (Set Mode: CW's CW, SSTV's the sideband, FT8's USB), each allowed on its own for each mode in the window's Settings, Decoders (both on unless turned off)
  - SSB Data (each VFO's, Settings, Rig Control; off unless checked): the digital modes the decoder sets on that VFO in USB or LSB go to its data mode (USB-D, PKTUSB, DATA-U); BirdWatch's voice modes stay as they are
  - DTR and RTS (each serial VFO's, Settings, Rig Control; Low unless set High): the serial port's two lines while the rig is connected, High only for an interface that needs it; the line PTT Method uses stays low until the decoder keys the rig, and on Windows neither goes high for a moment as the port opens
  - Band scope: with Use Scope If Present (an Icom CI-V VFO's, Settings, Rig Control; off unless checked), the radio's own scope waterfall shows in a strip over the decoder's waterfall, its colors starting at the band's noise floor so it looks the same at every span (IC-7300 and other Icoms that send it over USB)
    - Where the radio is tuned is marked, with the audio the decoder takes shaded; click the strip to tune there, and − and + in its top corners narrow and widen the radio's span (from ±2.5 kHz to ±500 kHz, going round at either end), shown beside them as −500 kHz and +500 kHz
    - The radio needs its CI-V USB Baud Rate at 115200 (and Rig Control the same) and its CI-V USB Port set to Unlink from [REMOTE]; a yellow note under the checkbox and over the strip says which is missing, or that the radio's scope is turned off
  - Input Device (the window's Settings, Decoders): the audio decoded (your rig's), picked for each mode on its own; Warning On Change (Settings, Audio) warns of input devices changed or missing as it does for the Output Device
    - Its levels beside it: hover over them for two sliders and the peak of the audio heard. HW is the device's own recording level (as in your system's sound settings), so a loud rig can be kept from clipping the sound card (on macOS, the default input's only); SW is a gain inside the decoder, each mode's own
  - FT8 mode (Mode menu): decodes each 15 second FT8 period on its own, without WSJT-X (a few fewer decodes than WSJT-X: about nine in ten on a busy band)
    - Built on ft8_lib by Kārlis Goba, YL3JG
    - Set Mode (the window's Settings, Decoders): picking an FT8 frequency sets the rig's mode, USB (its data mode with the VFO's SSB Data)
    - Depth (the window's Settings, Decoders): Normal, the default, decodes with ft8_lib as it comes, quickly; Deep adds the three below for more decodes, at more processor time
    - Signals decoded are taken out and each period searched again, finding the weaker ones they covered: the method of WSJT-X, with thanks to Joe Taylor, K1JT, and the WSJT development team
    - A signal the usual way can't decode is tried twice more, as WSJT-X does: by ordered statistics decoding (marked o), and by guessing it is a CQ (a1) or a call to you (a2). Again with thanks to Joe Taylor, K1JT, and the WSJT development team
    - Each period is decoded early, as WSJT-X does, so most messages show about 3 seconds sooner; any new at the period's end are added under them
    - FT8 decodes go to GridTracker's map and alerts through its instance MMD, as a WSJT-X instance's do, with the window closed too; with Send Decodes To Call Roster (the window's Settings, Decoders) they go to the Call Roster as well; a green dot on the Toggle Multi-Mode Decoder button shows it is listening in the background. Their band comes from Rig Control reading the FT8 VFO, and MMD can't be answered (it doesn't transmit)
- FT4 mode (Mode menu): decodes FT4's 7.5 second periods with the FT8 decoder (its Normal depth), with WSJT-X's FT4 dial frequencies in the Frequency menu; Send Decodes To Call Roster sends FT4 decodes too
- Instance MMD: while the Multi-Mode Decoder is on (Settings, Features), GridTracker has an instance named MMD on the band of the VFO Rig Control reads for it (frequency 0 when there is none), in the decoder's mode (CW, PSK63, RTTY, Olivia, FT8 ...), whether its window is open or not; the mode last used is kept when GridTracker restarts
- FT8 and FT4 focus: click anywhere on the waterfall, or a message, to mark a 50 Hz band in red that is searched harder each period (FT8 at its Deep depth, FT4 always); drag it along the waterfall to move it, and click inside it to let go
- FT8 and FT4: a yellow mark on the scale for each station decoded in the last two periods
- FT8 and FT4 time skew, for a station whose clock is off (as a DXpedition's with no time source): right-click the waterfall, then turn the scroll wheel (Shift: a second at a time) to move the decoding's timing until the orange lines, drawn across the whole waterfall in place of the usual gray ones with the skew and their UTC shown above them, line up with the station's transmissions. Every period is decoded on that timing, DT shown in orange from the usual timing; stations on time aren't decoded meanwhile. Right-click again to go back on time; the skew is kept until GridTracker closes (FT8's and FT4's each), so turning it on again comes back at it. Clear leaves it on; tuning the rig elsewhere turns it off
- CW, PSK, RTTY, MFSK, DominoEX / THOR and Olivia: right-click a decoded line to delete it (a station still sending is listed again with what it sends next)
- With Rig Control, a lock before the rig's frequency on the divider: unlocked, the mouse wheel on the waterfall tunes the rig 10 Hz a step (Shift 100 Hz, Ctrl 1 Hz)
- PSK and RTTY modes (Mode menu): every PSK signal in the passband (PSK31, PSK63, PSK125 or QPSK31, picked on the second line), or every RTTY signal (170, 425 or 850 Hz shift, at 45.45, 50 or 75 baud, each found by itself), each decoded on its own and listed as CW's are, with its frequency, its signal over the noise, its baud and its text; the Frequency menu has each mode's usual frequencies
- MFSK mode (Mode menu): every MFSK16 or MFSK32 signal in the passband (picked on the second line), each found by itself and decoded on its own, listed as PSK's are; MFSK16 copies down to about 13 dB below the noise (in 3 kHz)
  - Written from ZL1BPU's published MFSK16 specification and IZ8BLY's varicode
- DominoEX / THOR mode (Mode menu): every DominoEX or THOR signal in the passband at the speed picked on the second line (4, 5, 8, 11, 16 or 22), or at All Speeds at once, each found by itself and decoded on its own, listed as PSK's are; no tuning needed, and a drifting signal is followed
  - Written from ZL1BPU's published DominoEX descriptions, with THOR's error correction as W1HKJ describes it
- NAVTEX mode (Mode menu): the maritime safety broadcasts on 518 and 490 kHz and HF NAVTEX, each message (ZCZC to NNNN) in a block of its own, the newest on top: its station, subject (navigational warning, weather forecast, search and rescue ...), number, time, frequency and how cleanly it was received, then its text as sent; the Frequency menu has NAVTEX's and the HF maritime safety channels, each named
  - A message received cleanly already isn't listed again when its station repeats it, just marked as heard again, as NAVTEX receivers do
  - Right-click a message to copy, save or delete it; Save Messages (the window's Settings, Decoders) saves each complete one as a text file in NAVTEX Messages
- Feld-Hell mode (Mode menu): Hellschreiber printed on a tape as it is heard, each line twice as Hell's own machines printed it, so a slanting print is whole in one copy; Feld-Hell, X5 or X9 picked on the second line, with Trim to straighten a slanting print
  - The strongest Hell signal is found by itself; click one on the waterfall to read it instead, and click inside its band to go back
- WEFAX mode (Mode menu): weather fax charts from the coast and weather stations that still send them, received in SSTV's picture view, each started by its start tone with its line rate and width found by themselves (or picked on the second line), and saved as SSTV's pictures are
  - Start Now begins a chart already being sent, and Stop ends one
  - Right-click a chart (or an SSTV picture) to rotate it 90° either way or 180°, for the charts some stations send sideways; it is saved and copied as shown
  - Charts are kept straight and lined up by themselves: by the black mark many stations send at the start of each line, else by the chart's own upright lines, even when the sound card's clock is off or audio is lost for a moment; Trim and a click on the chart's left edge do it by hand (Trim is kept for next time)
  - The Frequency menu lists the stations heard around the world (NOAA's, Germany's, Japan's, Australia's and others), each named, with its schedule where it has one
  - Auto-Tune (with Rig Control): the rig is tuned to each next chart from the stations' published schedules (NOAA's, Germany's, Japan's, Korea's, Australia's and the UK's), one chart after another; a frequency that doesn't come in is passed over for a while, and tuning the rig by hand turns it off
- Every decoder now hears the rig's audio on its own sound card's clock, so no audio is dropped or doubled now and then (which slanted and stepped weather fax charts and SSTV pictures)
- WSPR mode (Mode menu): each 2 minute period decoded once it has ended, every station between 1350 and 1650 Hz of audio (down to about -28 dB), listed with its time, dB, DT, frequency, drift, call, grid, power (dBm) and distance (in your distance unit), and sent to GridTracker's map as WSJT-X's WSPR decodes are, with the window closed too
  - Written from the published WSPR protocol (K1JT's description and G4JNT's specification)
- Olivia mode (Mode menu): an Olivia or Contestia signal decoded, its submode picked on the second line (4/250, 8/250, 8/500, 16/500, 16/1000, 32/1000); click the signal on the waterfall, or let an RSID heard set the submode and where it is; dashed lines on the waterfall show the band decoded, and its text is listed as PSK31's is
- Follow BirdWatch (the window's Settings, Decoders; off unless turned on, and shown only while BirdWatch is on with its Satellite Tracking toggled on): as BirdWatch's rig starts following a satellite transmitter, the decoder switches to its mode (CW, SSTV, Packet, Sat Data, FT8, FT4)
  - While BirdWatch is on with its Rig Control, every mode reads BirdWatch's Downlink VFO; each mode's VFO menu shows it, grayed out
- RSID (the window's Settings, Decoders; on unless turned off): in every mode, a transmission whose sender starts it with an RSID (as fldigi, MultiPSK and others can) is named on the waterfall where it starts: Olivia 8/500, MT63-1000L, BPSK31, THOR16 and the rest of RSID's modes
  - Click an RSID of a mode decoded here (BPSK31, BPSK63, BPSK125, QPSK31, RTTY 45, MFSK16, MFSK32, DominoEX, THOR, Packet 1200, Olivia, Contestia) to switch to that mode and submode; its transmission is decoded from its start, and nothing already decoded is cleared
- SSTV mode (Mode menu): receives slow-scan TV pictures in Martin 1 and 2, Scottie 1, 2 and DX, Robot 36 and 72, and PD 90, 120 and 180, each found by the VIS code that starts it
  - Each picture is drawn as it comes in, and the newest 12 are kept in a strip beside it: click one to see it large
  - No need to tune exactly: a picture is found anywhere up to 1000 Hz either side of where its tones belong, and read there
  - A sender whose sound card runs a little fast or slow (a slanted picture) is put right
  - A sender that drifts while sending, or a satellite's Doppler, is followed line by line, so the picture's colors stay true
  - A sender that fades out part way: the picture is read on to its end, so one that comes back still gives the rest, and nothing that was shown is thrown away
  - Dashed lines on the waterfall show where a picture's sync (1200 Hz), black (1500 Hz) and white (2300 Hz) tones are, moved to where the newest picture was found
  - Save Pictures (the window's Settings, Decoders) saves each as a PNG named by its UTC time, mode and frequency, however much of it came; or right-click a picture to save it, copy it to the clipboard or delete it
  - Above the picture, in color: its mode, the UTC time it started, its frequency with its band, and Saved once it is
  - Written from the published SSTV mode specifications (JL Barber, N7CXI), with ideas from slowrx by Oona Räisänen, OH2EIQ
- Packet mode (Mode menu): decodes AX.25 packets, listening for all of these at once: AFSK 1200 (APRS, the ISS's digipeater), FSK 9600 and GMSK 4800 (G3RUH, from a rig's 9600 data audio), and HF packet at 300 baud
  - Each packet a line, the newest on top: UTC, baud, from, to and its path, and what it says
  - A packet with one bit wrong, or two side by side, is put right rather than lost
  - HF packet is found wherever its tones land in the audio decoded (between [ and ]), so a station a little off frequency is still decoded; each place one was heard lately is ticked at the top of the waterfall, and its line says where (hover its Baud)
    - Click the waterfall, or a 300 baud line, to lock onto that place: only it is decoded, marked by a tick with guard lines either side; click inside the guards to let go
  - AFSK 1200 heard through an SSB receiver (a satellite's packets, or a rig tuned a little off) is decoded up to 600 Hz off its usual tones
  - APRS is read: positions (plain, compressed and Mic-E, with the grid, course, speed and altitude), messages, status, objects, items, weather and telemetry; other packets as they are
  - A packet heard while BirdWatch follows a satellite with the rig is marked with that satellite, and a message to you is highlighted
  - Frequency menu: HF APRS (7.0486, 10.1476, 14.103 and 28.14 MHz), 10 meter APRS (29.25 MHz FM), the VHF APRS frequencies around the world, and the ISS's digipeater (145.825 MHz)
- Sat Data mode (Mode menu): satellite telemetry frames, each a line with its type, baud, the satellite BirdWatch follows and a summary (its bytes in the tooltip)
  - FUNcube BPSK 1200 (AO-73 and its family, from SSB audio): its telemetry read (battery, photocurrent, sequence)
  - GomSpace AX.100 Modes 5 and 6, the common cubesat framing, at 1200 to 9600 baud (from a rig's flat 9600 data audio)
  - AMSAT-EA's GENESIS FSK at 800 and 200 bps (HADES-SA, HADES-L and the other HADES satellites, from SSB audio): telemetry, BBS and SSDV packets
  - SSDV pictures: a satellite's SSDV packets put together into its pictures above the frames, each filling in as its packets come (what hasn't come yet shown gray), with its image number and packets received and missing; right-click a picture to save it as a JPEG, copy it to the clipboard or delete it
  - With Follow BirdWatch, the transmitter followed picks which of them listen
- Band Plans (the window's Settings, its own tab): each mode's usual frequencies (CW, FT8, FT4, SSTV, Packet, PSK31, RTTY, MFSK, DominoEX / THOR, Olivia, WSPR), which the Frequency menu lists, with their sources' notes (region, net, DXpedition)
  - Every row can be edited in place, added or deleted; your edited copy is used from then on, and Restore Shipped goes back to GridTracker's
- Waterfall Speed (the window's Settings, Decoders): one for every mode
- How the waterfall is drawn (the window's Settings, Decoders, under Waterfall Speed):
  - Waterfall Style: Auto Level (as before), WSJT-X (levels as heard, with Gain and Zero sliders), or Crisp (the noise black, with Floor and Range sliders)
  - Resolution: sharper in time or in frequency; By Mode draws CW, PSK31 and RTTY sharp in time (crisp dots and dashes) and FT8 and FT4 sharp in frequency
  - Window (Hann or Blackman-Harris), and Sharp Pixels for crisp edges
  - Palette: Classic, Ember, Twilight, Neon, Aurora, Clear Sight (easy to read with red-green color blindness), Prism, Glacier, Phosphor, Moonlight and Paper
- Test Signals (beside the levels): clears the window, then plays a recording of the mode's signals into the decoder, on its own over a band's noise floor (what the radio hears is silenced while it plays), to see what it decodes, often several stations at once, some starting with an RSID; FT8 and FT4 start on a period's boundary
  - Every mode has some: CW, FT8, FT4, PSK31 and RTTY with five stations each, PSK63, PSK125 and QPSK31, RTTY at other bauds and shifts, MFSK16 and MFSK32, DominoEX and THOR at several speeds, Olivia and Contestia, a mix of CW, PSK31, RTTY and Olivia, an SSTV picture, APRS packets, and satellite frames (FUNcube, AX100, and a GENESIS SSDV picture)
  - What they decode stays in the window: it isn't sent to the Call Roster, and pictures aren't saved by themselves
- Detect Modes (beside Test Signals): listens for every mode here at once and names each signal it finds, once it decodes: CW (with its speed), PSK31, PSK63, PSK125, QPSK31, RTTY (with its baud and shift), MFSK16, MFSK32, DominoEX and THOR (with their speed), Packet, SSTV (with its mode), each FT8 and FT4 station (with its message), and any mode an RSID names
  - Each one is labeled on the waterfall and listed in the mode's place with its frequency, its signal over the noise and what was heard; the mode you were in waits meanwhile
  - Click one, on the waterfall or in the list, to decode it: its mode and submode are chosen and Detect Modes turns off (a CW signal pinned, an HF packet station locked onto, the FT8 or FT4 focus put on the station)
- PSK31 and RTTY: a signal that starts with an RSID is now found as soon as it starts

#### BirdWatch

- New Skeds (BirdWatch settings, Skeds): the stations you share passes with, by callsign and grid (and their height and lowest elevation if known), and the mutual passes of the next 72 hours, when a tracked satellite is up for you both
  - Each with its time, how long it lasts and both elevations; listen-only satellites are marked RX only
  - Save one or all as a calendar file (.ics), or copy them as text to send to the other station; Copy My Sked Line and Paste Sked Line swap stations between GridTracker2 users
  - Minimum Mutual Duration leaves out windows too short for a QSO
  - A station too far away to ever share a pass with you, for the satellites you track, says so
  - Click a station on the map, a pass in the list or a bar in the timeline to make it the active station: its satellite is selected, the panel shows its mutual pass, and Skeds First prefers it
  - Shown in the Pass Timeline (a row for each station), on the map (each station's marker, bright while a mutual pass is under way) and in the BirdWatch panel (the selected satellite's next mutual pass)
  - Announce Mutual Passes (BirdWatch settings, Alerts) announces them before they open
- Auto-Track's Mode: Next Pass, Skeds First (a mutual pass wins, from a few minutes before it opens, and is kept until it ends) or Skeds Only; a satellite you select yourself stays selected until its LOS when it is up or rises within 15 minutes, else for 15 minutes
- BirdWatch's settings are split into more tabs: BirdWatch, Skeds, Display (Panel View, Map), Alerts, Telemetry and Satellites
- The selected satellite's name on the map is now black on light green, so it stands out

#### Network Audio

- New Network Audio (Settings, Features, Service): audio over your home network as the Multi-Mode Decoder's Input and Output Devices, beside your sound cards, to decode a rig connected to another computer and send SSTV pictures back to it
  - VBAN, as Voicemeeter and many other programs and devices send it
  - RTP, the way PipeWire and PulseAudio send audio over a network: streams they announce are found by themselves, and they pick up the streams GridTracker2 announces (Announce: on for a multicast group, off for one computer's address)
  - PipeWire / PulseAudio (TCP), their simple protocol, where multicast doesn't get through
  - Each stream in a box of its own (the new Radios tab): Input or Output, Found (streams announced on the network), and a status line saying what it hears or sends
  - The audio is kept steady against the sender's clock, and lost packets are filled with silence, so SSTV pictures and weather faxes stay straight
- Rig Control: two new protocols, each bringing the rig's own audio to the Multi-Mode Decoder too
  - FlexRadio SmartSDR: the slice's frequency and mode, PTT, and DAX audio in and out (a blank Host finds the radio on your network)
  - Icom LAN: an IC-705, IC-7610, IC-9700 or IC-905 over the network with no computer at the radio, with the user and password set in the radio: frequency, mode, PTT and its receive and transmit audio

#### App

- Settings: new Radios tab, to the right of Features, while Rig Control, Rotor Control or Network Audio is on: their settings are there now (turned on and off in Features, Service as before)
  - In a narrow window, About moves up to the row above so the tabs fit on one line
- Settings, Audio: Device is now Output Device
- Lookup: a callsign pasted or typed with a space before it, or in lower case, no longer shows its country as Unknown under the card
- Lookup: the Callsign Lookup window has a new look, and resizes itself to fit each lookup
  - Clear and Generate Messages are at the top, under GridTracker's acknowledgement of the station
  - The grid, distance and bearing are under the station's card; in your log for the call, bands only worked have a dashed outline and confirmed ones are filled
  - The Details are laid out in columns, so the window is shorter
- At startup the map goes back to the WSJT-X, JTDX or other instance it was showing when GridTracker2 was closed, once that instance starts sending (within 30 seconds), even if another one, such as the Multi-Mode Decoder, was heard first; picking an instance yourself before then keeps your choice

### HTML List

```html
<h4>Map / UI</h4>
<ul>
  <li>Five new base maps: Topographical by OpenTopoMap, Satellite (no labels), Topographical and Satellite Topo by USGS (best coverage in the US), and Satellite Firefly by Esri</li>
  <li>New Santa Tracker: a new button in the button panel will appear on Dec 1st that follows Santa and his reindeer around the world, using amateur radio tracking technology
    <ul>
      <li>Move the mouse over a stop to see its DXCC entity, and state or province</li>
    </ul>
  </li>
  <li>The Kp button now grows smoothly under the mouse, like the other buttons in the button panel</li>
  <li>Band Activity, the counts and Map View Filters can be rearranged in the control panel, above or below the buttons: drag a box by its top border (the cursor shows a hand there)
    <ul>
      <li>Settings, General: Reset Panels puts them back in their usual order; Reset Button Panel is now called Reset Button Order</li>
    </ul>
  </li>
  <li>The help button in the button panel has a new icon and now opens the new GridTracker2 User Guide in its own window, with search, page thumbnails, contents, zoom, print and save
    <ul>
      <li>Click the button to show or hide the window, right-click it to only show it; Esc closes it</li>
      <li>F1 still shows the hotkey list</li>
    </ul>
  </li>
</ul>
<h4>Multi-Mode Decoder</h4>
<ul>
  <li>New Multi-Mode Decoder (Settings, Features, Service): decodes every CW signal in your receiver's passband, or FT8, and shows them in its new window, opened with the Toggle Multi-Mode Decoder button
    <ul>
      <li>A waterfall of the passband with each signal found marked on it, and a line of decoded text for each signal with its frequency and speed</li>
      <li>A CQ and the call after it are highlighted</li>
      <li>Settings, on the window's top line: Rig Control (off unless turned on: the decoder has nothing to do with the rigs and shows audio frequencies only), then each decoder's own settings (the Multi-Mode Decoder itself is still turned on in Settings, Features)</li>
      <li>Follows each operator's own speed, weighting and spacing (Farnsworth too), and copes with fading</li>
      <li>A strong signal is taken out of the audio the others are decoded from, so a weaker one close beside it can be read</li>
      <li>With Rig Control connected, signals are shown at their frequency on the air</li>
      <li>The waterfall always runs from low frequencies on the left to high on the right, in LSB and CW-R as well</li>
      <li>Text already decoded is corrected as the decoder learns more of an operator's timing: the start of a transmission, or a change of speed part way through (corrected text glows for a moment)</li>
      <li>The mouse over a signal's line marks the signal on the waterfall, and the mouse over a signal on the waterfall shades its line</li>
      <li>Clear: forgets everything decoded and starts again from scratch</li>
      <li>Click a signal to pin it: its marks stay on the waterfall and its line stays listed</li>
      <li>Drag the [ and ] on the scale to set the lowest and highest audio decoded (hum and noise below a few hundred Hz left out)</li>
      <li>Bandpass (the window's Settings, General): decode a rig's passband (2.5k to 4.5k), or much more of an SDR's audio (up to the whole of a 96 kHz stream)</li>
      <li>A band change, or a frequency picked from the Frequency menu (on the same band too), is marked on the waterfall with a bar, the band and frequency on it, and the waterfall is kept</li>
      <li>Whenever the rig is retuned, FT8 doesn't decode a period with audio from both frequencies (only what the new one gave), nor SSTV a picture across the change</li>
      <li>VFO (the window's Settings, Decoders): the Rig Control VFO each mode reads and tunes, so an SDR on a VFO of its own can be decoded while the rig's other VFOs are busy
        <ul>
          <li>A VFO removed in Settings, Rig Control is taken out of every mode's and BirdWatch's menus at once, and what used it uses None until another is picked</li>
        </ul>
      </li>
      <li>Common Input Device and Common VFO (the window's Settings, Decoders; both on unless turned off): every mode listens to one Input Device and reads one VFO, each picked under its checkbox; turned off, each decoder's own comes back as it was. The common VFO is None until one is picked</li>
      <li>SDR++ (Server) (a VFO's connection in Settings, Rig Control; SDR++ started with --server): its device is a VFO of its own, tuned like a rig, its Source, Device and Sample Rate picked from its own menus in the VFO's box (Refresh looks for devices again), and its I/Q in every mode's Input Device menu, as SPY Server's is; the server streams only while a decoder uses it</li>
      <li>SDR++ (rigctl) (a VFO's connection in Settings, Rig Control): the SDR++ window's own VFO through its Rigctl Server module, read and tuned like a rig (SDR++ keeps its audio; one client at a time)</li>
      <li>SPY Server by Airspy (a VFO's connection in Settings, Rig Control): an Airspy or RTL-SDR shared by SPY Server is a VFO of its own, its frequency read and tuned like a rig's, and its I/Q stream is in every mode's Input Device menu, decoded as the audio above that frequency (USB)</li>
      <li>Frequency: the rig's frequency, band and mode are shown centered on the bar between the waterfall and the decoded lines (drag the bar to size the waterfall; in FT8, FT4 and WSPR its right end shows how far into the period it is, as [ 7 / 15 ]), and with Rig Control a menu on the second line lists each mode's usual frequencies, CW's QRP calling frequencies, FT8's and SSTV's; picking one sets the rig's frequency (Set Frequency) and its mode (Set Mode: CW's CW, SSTV's the sideband, FT8's USB), each allowed on its own for each mode in the window's Settings, Decoders (both on unless turned off)</li>
      <li>SSB Data (each VFO's, Settings, Rig Control; off unless checked): the digital modes the decoder sets on that VFO in USB or LSB go to its data mode (USB-D, PKTUSB, DATA-U); BirdWatch's voice modes stay as they are</li>
      <li>DTR and RTS (each serial VFO's, Settings, Rig Control; Low unless set High): the serial port's two lines while the rig is connected, High only for an interface that needs it; the line PTT Method uses stays low until the decoder keys the rig, and on Windows neither goes high for a moment as the port opens</li>
      <li>Band scope: with Use Scope If Present (an Icom CI-V VFO's, Settings, Rig Control; off unless checked), the radio's own scope waterfall shows in a strip over the decoder's waterfall, its colors starting at the band's noise floor so it looks the same at every span (IC-7300 and other Icoms that send it over USB)
        <ul>
          <li>Where the radio is tuned is marked, with the audio the decoder takes shaded; click the strip to tune there, and − and + in its top corners narrow and widen the radio's span (from ±2.5 kHz to ±500 kHz, going round at either end), shown beside them as −500 kHz and +500 kHz</li>
          <li>The radio needs its CI-V USB Baud Rate at 115200 (and Rig Control the same) and its CI-V USB Port set to Unlink from [REMOTE]; a yellow note under the checkbox and over the strip says which is missing, or that the radio's scope is turned off</li>
        </ul>
      </li>
      <li>Input Device (the window's Settings, Decoders): the audio decoded (your rig's), picked for each mode on its own; Warning On Change (Settings, Audio) warns of input devices changed or missing as it does for the Output Device
        <ul>
          <li>Its levels beside it: hover over them for two sliders and the peak of the audio heard. HW is the device's own recording level (as in your system's sound settings), so a loud rig can be kept from clipping the sound card (on macOS, the default input's only); SW is a gain inside the decoder, each mode's own</li>
        </ul>
      </li>
      <li>FT8 mode (Mode menu): decodes each 15 second FT8 period on its own, without WSJT-X (a few fewer decodes than WSJT-X: about nine in ten on a busy band)
        <ul>
          <li>Built on ft8_lib by Kārlis Goba, YL3JG</li>
          <li>Set Mode (the window's Settings, Decoders): picking an FT8 frequency sets the rig's mode, USB (its data mode with the VFO's SSB Data)</li>
          <li>Depth (the window's Settings, Decoders): Normal, the default, decodes with ft8_lib as it comes, quickly; Deep adds the three below for more decodes, at more processor time</li>
          <li>Signals decoded are taken out and each period searched again, finding the weaker ones they covered: the method of WSJT-X, with thanks to Joe Taylor, K1JT, and the WSJT development team</li>
          <li>A signal the usual way can't decode is tried twice more, as WSJT-X does: by ordered statistics decoding (marked o), and by guessing it is a CQ (a1) or a call to you (a2). Again with thanks to Joe Taylor, K1JT, and the WSJT development team</li>
          <li>Each period is decoded early, as WSJT-X does, so most messages show about 3 seconds sooner; any new at the period's end are added under them</li>
          <li>FT8 decodes go to GridTracker's map and alerts through its instance MMD, as a WSJT-X instance's do, with the window closed too; with Send Decodes To Call Roster (the window's Settings, Decoders) they go to the Call Roster as well; a green dot on the Toggle Multi-Mode Decoder button shows it is listening in the background. Their band comes from Rig Control reading the FT8 VFO, and MMD can't be answered (it doesn't transmit)</li>
        </ul>
      </li>
    </ul>
  </li>
  <li>FT4 mode (Mode menu): decodes FT4's 7.5 second periods with the FT8 decoder (its Normal depth), with WSJT-X's FT4 dial frequencies in the Frequency menu; Send Decodes To Call Roster sends FT4 decodes too</li>
  <li>Instance MMD: while the Multi-Mode Decoder is on (Settings, Features), GridTracker has an instance named MMD on the band of the VFO Rig Control reads for it (frequency 0 when there is none), in the decoder's mode (CW, PSK63, RTTY, Olivia, FT8 ...), whether its window is open or not; the mode last used is kept when GridTracker restarts</li>
  <li>FT8 and FT4 focus: click anywhere on the waterfall, or a message, to mark a 50 Hz band in red that is searched harder each period (FT8 at its Deep depth, FT4 always); drag it along the waterfall to move it, and click inside it to let go</li>
  <li>FT8 and FT4: a yellow mark on the scale for each station decoded in the last two periods</li>
  <li>FT8 and FT4 time skew, for a station whose clock is off (as a DXpedition's with no time source): right-click the waterfall, then turn the scroll wheel (Shift: a second at a time) to move the decoding's timing until the orange lines, drawn across the whole waterfall in place of the usual gray ones with the skew and their UTC shown above them, line up with the station's transmissions. Every period is decoded on that timing, DT shown in orange from the usual timing; stations on time aren't decoded meanwhile. Right-click again to go back on time; the skew is kept until GridTracker closes (FT8's and FT4's each), so turning it on again comes back at it. Clear leaves it on; tuning the rig elsewhere turns it off</li>
  <li>CW, PSK, RTTY, MFSK, DominoEX / THOR and Olivia: right-click a decoded line to delete it (a station still sending is listed again with what it sends next)</li>
  <li>With Rig Control, a lock before the rig's frequency on the divider: unlocked, the mouse wheel on the waterfall tunes the rig 10 Hz a step (Shift 100 Hz, Ctrl 1 Hz)</li>
  <li>PSK and RTTY modes (Mode menu): every PSK signal in the passband (PSK31, PSK63, PSK125 or QPSK31, picked on the second line), or every RTTY signal (170, 425 or 850 Hz shift, at 45.45, 50 or 75 baud, each found by itself), each decoded on its own and listed as CW's are, with its frequency, its signal over the noise, its baud and its text; the Frequency menu has each mode's usual frequencies</li>
  <li>MFSK mode (Mode menu): every MFSK16 or MFSK32 signal in the passband (picked on the second line), each found by itself and decoded on its own, listed as PSK's are; MFSK16 copies down to about 13 dB below the noise (in 3 kHz)
    <ul>
      <li>Written from ZL1BPU's published MFSK16 specification and IZ8BLY's varicode</li>
    </ul>
  </li>
  <li>DominoEX / THOR mode (Mode menu): every DominoEX or THOR signal in the passband at the speed picked on the second line (4, 5, 8, 11, 16 or 22), or at All Speeds at once, each found by itself and decoded on its own, listed as PSK's are; no tuning needed, and a drifting signal is followed
    <ul>
      <li>Written from ZL1BPU's published DominoEX descriptions, with THOR's error correction as W1HKJ describes it</li>
    </ul>
  </li>
  <li>NAVTEX mode (Mode menu): the maritime safety broadcasts on 518 and 490 kHz and HF NAVTEX, each message (ZCZC to NNNN) in a block of its own, the newest on top: its station, subject (navigational warning, weather forecast, search and rescue ...), number, time, frequency and how cleanly it was received, then its text as sent; the Frequency menu has NAVTEX's and the HF maritime safety channels, each named
    <ul>
      <li>A message received cleanly already isn't listed again when its station repeats it, just marked as heard again, as NAVTEX receivers do</li>
      <li>Right-click a message to copy, save or delete it; Save Messages (the window's Settings, Decoders) saves each complete one as a text file in NAVTEX Messages</li>
    </ul>
  </li>
  <li>Feld-Hell mode (Mode menu): Hellschreiber printed on a tape as it is heard, each line twice as Hell's own machines printed it, so a slanting print is whole in one copy; Feld-Hell, X5 or X9 picked on the second line, with Trim to straighten a slanting print
    <ul>
      <li>The strongest Hell signal is found by itself; click one on the waterfall to read it instead, and click inside its band to go back</li>
    </ul>
  </li>
  <li>WEFAX mode (Mode menu): weather fax charts from the coast and weather stations that still send them, received in SSTV's picture view, each started by its start tone with its line rate and width found by themselves (or picked on the second line), and saved as SSTV's pictures are
    <ul>
      <li>Start Now begins a chart already being sent, and Stop ends one</li>
      <li>Right-click a chart (or an SSTV picture) to rotate it 90° either way or 180°, for the charts some stations send sideways; it is saved and copied as shown</li>
      <li>Charts are kept straight and lined up by themselves: by the black mark many stations send at the start of each line, else by the chart's own upright lines, even when the sound card's clock is off or audio is lost for a moment; Trim and a click on the chart's left edge do it by hand (Trim is kept for next time)</li>
      <li>The Frequency menu lists the stations heard around the world (NOAA's, Germany's, Japan's, Australia's and others), each named, with its schedule where it has one</li>
      <li>Auto-Tune (with Rig Control): the rig is tuned to each next chart from the stations' published schedules (NOAA's, Germany's, Japan's, Korea's, Australia's and the UK's), one chart after another; a frequency that doesn't come in is passed over for a while, and tuning the rig by hand turns it off</li>
    </ul>
  </li>
  <li>Every decoder now hears the rig's audio on its own sound card's clock, so no audio is dropped or doubled now and then (which slanted and stepped weather fax charts and SSTV pictures)</li>
  <li>WSPR mode (Mode menu): each 2 minute period decoded once it has ended, every station between 1350 and 1650 Hz of audio (down to about -28 dB), listed with its time, dB, DT, frequency, drift, call, grid, power (dBm) and distance (in your distance unit), and sent to GridTracker's map as WSJT-X's WSPR decodes are, with the window closed too
    <ul>
      <li>Written from the published WSPR protocol (K1JT's description and G4JNT's specification)</li>
    </ul>
  </li>
  <li>Olivia mode (Mode menu): an Olivia or Contestia signal decoded, its submode picked on the second line (4/250, 8/250, 8/500, 16/500, 16/1000, 32/1000); click the signal on the waterfall, or let an RSID heard set the submode and where it is; dashed lines on the waterfall show the band decoded, and its text is listed as PSK31's is</li>
  <li>Follow BirdWatch (the window's Settings, Decoders; off unless turned on, and shown only while BirdWatch is on with its Satellite Tracking toggled on): as BirdWatch's rig starts following a satellite transmitter, the decoder switches to its mode (CW, SSTV, Packet, Sat Data, FT8, FT4)
    <ul>
      <li>While BirdWatch is on with its Rig Control, every mode reads BirdWatch's Downlink VFO; each mode's VFO menu shows it, grayed out</li>
    </ul>
  </li>
  <li>RSID (the window's Settings, Decoders; on unless turned off): in every mode, a transmission whose sender starts it with an RSID (as fldigi, MultiPSK and others can) is named on the waterfall where it starts: Olivia 8/500, MT63-1000L, BPSK31, THOR16 and the rest of RSID's modes
    <ul>
      <li>Click an RSID of a mode decoded here (BPSK31, BPSK63, BPSK125, QPSK31, RTTY 45, MFSK16, MFSK32, DominoEX, THOR, Packet 1200, Olivia, Contestia) to switch to that mode and submode; its transmission is decoded from its start, and nothing already decoded is cleared</li>
    </ul>
  </li>
  <li>SSTV mode (Mode menu): receives slow-scan TV pictures in Martin 1 and 2, Scottie 1, 2 and DX, Robot 36 and 72, and PD 90, 120 and 180, each found by the VIS code that starts it
    <ul>
      <li>Each picture is drawn as it comes in, and the newest 12 are kept in a strip beside it: click one to see it large</li>
      <li>No need to tune exactly: a picture is found anywhere up to 1000 Hz either side of where its tones belong, and read there</li>
      <li>A sender whose sound card runs a little fast or slow (a slanted picture) is put right</li>
      <li>A sender that drifts while sending, or a satellite's Doppler, is followed line by line, so the picture's colors stay true</li>
      <li>A sender that fades out part way: the picture is read on to its end, so one that comes back still gives the rest, and nothing that was shown is thrown away</li>
      <li>Dashed lines on the waterfall show where a picture's sync (1200 Hz), black (1500 Hz) and white (2300 Hz) tones are, moved to where the newest picture was found</li>
      <li>Save Pictures (the window's Settings, Decoders) saves each as a PNG named by its UTC time, mode and frequency, however much of it came; or right-click a picture to save it, copy it to the clipboard or delete it</li>
      <li>Above the picture, in color: its mode, the UTC time it started, its frequency with its band, and Saved once it is</li>
      <li>Written from the published SSTV mode specifications (JL Barber, N7CXI), with ideas from slowrx by Oona Räisänen, OH2EIQ</li>
    </ul>
  </li>
  <li>Packet mode (Mode menu): decodes AX.25 packets, listening for all of these at once: AFSK 1200 (APRS, the ISS's digipeater), FSK 9600 and GMSK 4800 (G3RUH, from a rig's 9600 data audio), and HF packet at 300 baud
    <ul>
      <li>Each packet a line, the newest on top: UTC, baud, from, to and its path, and what it says</li>
      <li>A packet with one bit wrong, or two side by side, is put right rather than lost</li>
      <li>HF packet is found wherever its tones land in the audio decoded (between [ and ]), so a station a little off frequency is still decoded; each place one was heard lately is ticked at the top of the waterfall, and its line says where (hover its Baud)
        <ul>
          <li>Click the waterfall, or a 300 baud line, to lock onto that place: only it is decoded, marked by a tick with guard lines either side; click inside the guards to let go</li>
        </ul>
      </li>
      <li>AFSK 1200 heard through an SSB receiver (a satellite's packets, or a rig tuned a little off) is decoded up to 600 Hz off its usual tones</li>
      <li>APRS is read: positions (plain, compressed and Mic-E, with the grid, course, speed and altitude), messages, status, objects, items, weather and telemetry; other packets as they are</li>
      <li>A packet heard while BirdWatch follows a satellite with the rig is marked with that satellite, and a message to you is highlighted</li>
      <li>Frequency menu: HF APRS (7.0486, 10.1476, 14.103 and 28.14 MHz), 10 meter APRS (29.25 MHz FM), the VHF APRS frequencies around the world, and the ISS's digipeater (145.825 MHz)</li>
    </ul>
  </li>
  <li>Sat Data mode (Mode menu): satellite telemetry frames, each a line with its type, baud, the satellite BirdWatch follows and a summary (its bytes in the tooltip)
    <ul>
      <li>FUNcube BPSK 1200 (AO-73 and its family, from SSB audio): its telemetry read (battery, photocurrent, sequence)</li>
      <li>GomSpace AX.100 Modes 5 and 6, the common cubesat framing, at 1200 to 9600 baud (from a rig's flat 9600 data audio)</li>
      <li>AMSAT-EA's GENESIS FSK at 800 and 200 bps (HADES-SA, HADES-L and the other HADES satellites, from SSB audio): telemetry, BBS and SSDV packets</li>
      <li>SSDV pictures: a satellite's SSDV packets put together into its pictures above the frames, each filling in as its packets come (what hasn't come yet shown gray), with its image number and packets received and missing; right-click a picture to save it as a JPEG, copy it to the clipboard or delete it</li>
      <li>With Follow BirdWatch, the transmitter followed picks which of them listen</li>
    </ul>
  </li>
  <li>Band Plans (the window's Settings, its own tab): each mode's usual frequencies (CW, FT8, FT4, SSTV, Packet, PSK31, RTTY, MFSK, DominoEX / THOR, Olivia, WSPR), which the Frequency menu lists, with their sources' notes (region, net, DXpedition)
    <ul>
      <li>Every row can be edited in place, added or deleted; your edited copy is used from then on, and Restore Shipped goes back to GridTracker's</li>
    </ul>
  </li>
  <li>Waterfall Speed (the window's Settings, Decoders): one for every mode</li>
  <li>How the waterfall is drawn (the window's Settings, Decoders, under Waterfall Speed):
    <ul>
      <li>Waterfall Style: Auto Level (as before), WSJT-X (levels as heard, with Gain and Zero sliders), or Crisp (the noise black, with Floor and Range sliders)</li>
      <li>Resolution: sharper in time or in frequency; By Mode draws CW, PSK31 and RTTY sharp in time (crisp dots and dashes) and FT8 and FT4 sharp in frequency</li>
      <li>Window (Hann or Blackman-Harris), and Sharp Pixels for crisp edges</li>
      <li>Palette: Classic, Ember, Twilight, Neon, Aurora, Clear Sight (easy to read with red-green color blindness), Prism, Glacier, Phosphor, Moonlight and Paper</li>
    </ul>
  </li>
  <li>Test Signals (beside the levels): clears the window, then plays a recording of the mode's signals into the decoder, on its own over a band's noise floor (what the radio hears is silenced while it plays), to see what it decodes, often several stations at once, some starting with an RSID; FT8 and FT4 start on a period's boundary
    <ul>
      <li>Every mode has some: CW, FT8, FT4, PSK31 and RTTY with five stations each, PSK63, PSK125 and QPSK31, RTTY at other bauds and shifts, MFSK16 and MFSK32, DominoEX and THOR at several speeds, Olivia and Contestia, a mix of CW, PSK31, RTTY and Olivia, an SSTV picture, APRS packets, and satellite frames (FUNcube, AX100, and a GENESIS SSDV picture)</li>
      <li>What they decode stays in the window: it isn't sent to the Call Roster, and pictures aren't saved by themselves</li>
    </ul>
  </li>
  <li>Detect Modes (beside Test Signals): listens for every mode here at once and names each signal it finds, once it decodes: CW (with its speed), PSK31, PSK63, PSK125, QPSK31, RTTY (with its baud and shift), MFSK16, MFSK32, DominoEX and THOR (with their speed), Packet, SSTV (with its mode), each FT8 and FT4 station (with its message), and any mode an RSID names
    <ul>
      <li>Each one is labeled on the waterfall and listed in the mode's place with its frequency, its signal over the noise and what was heard; the mode you were in waits meanwhile</li>
      <li>Click one, on the waterfall or in the list, to decode it: its mode and submode are chosen and Detect Modes turns off (a CW signal pinned, an HF packet station locked onto, the FT8 or FT4 focus put on the station)</li>
    </ul>
  </li>
  <li>PSK31 and RTTY: a signal that starts with an RSID is now found as soon as it starts</li>
</ul>
<h4>BirdWatch</h4>
<ul>
  <li>New Skeds (BirdWatch settings, Skeds): the stations you share passes with, by callsign and grid (and their height and lowest elevation if known), and the mutual passes of the next 72 hours, when a tracked satellite is up for you both
    <ul>
      <li>Each with its time, how long it lasts and both elevations; listen-only satellites are marked RX only</li>
      <li>Save one or all as a calendar file (.ics), or copy them as text to send to the other station; Copy My Sked Line and Paste Sked Line swap stations between GridTracker2 users</li>
      <li>Minimum Mutual Duration leaves out windows too short for a QSO</li>
      <li>A station too far away to ever share a pass with you, for the satellites you track, says so</li>
      <li>Click a station on the map, a pass in the list or a bar in the timeline to make it the active station: its satellite is selected, the panel shows its mutual pass, and Skeds First prefers it</li>
      <li>Shown in the Pass Timeline (a row for each station), on the map (each station's marker, bright while a mutual pass is under way) and in the BirdWatch panel (the selected satellite's next mutual pass)</li>
      <li>Announce Mutual Passes (BirdWatch settings, Alerts) announces them before they open</li>
    </ul>
  </li>
  <li>Auto-Track's Mode: Next Pass, Skeds First (a mutual pass wins, from a few minutes before it opens, and is kept until it ends) or Skeds Only; a satellite you select yourself stays selected until its LOS when it is up or rises within 15 minutes, else for 15 minutes</li>
  <li>BirdWatch's settings are split into more tabs: BirdWatch, Skeds, Display (Panel View, Map), Alerts, Telemetry and Satellites</li>
  <li>The selected satellite's name on the map is now black on light green, so it stands out</li>
</ul>
<h4>Network Audio</h4>
<ul>
  <li>New Network Audio (Settings, Features, Service): audio over your home network as the Multi-Mode Decoder's Input and Output Devices, beside your sound cards, to decode a rig connected to another computer and send SSTV pictures back to it
    <ul>
      <li>VBAN, as Voicemeeter and many other programs and devices send it</li>
      <li>RTP, the way PipeWire and PulseAudio send audio over a network: streams they announce are found by themselves, and they pick up the streams GridTracker2 announces (Announce: on for a multicast group, off for one computer's address)</li>
      <li>PipeWire / PulseAudio (TCP), their simple protocol, where multicast doesn't get through</li>
      <li>Each stream in a box of its own (the new Radios tab): Input or Output, Found (streams announced on the network), and a status line saying what it hears or sends</li>
      <li>The audio is kept steady against the sender's clock, and lost packets are filled with silence, so SSTV pictures and weather faxes stay straight</li>
    </ul>
  </li>
  <li>Rig Control: two new protocols, each bringing the rig's own audio to the Multi-Mode Decoder too
    <ul>
      <li>FlexRadio SmartSDR: the slice's frequency and mode, PTT, and DAX audio in and out (a blank Host finds the radio on your network)</li>
      <li>Icom LAN: an IC-705, IC-7610, IC-9700 or IC-905 over the network with no computer at the radio, with the user and password set in the radio: frequency, mode, PTT and its receive and transmit audio</li>
    </ul>
  </li>
</ul>
<h4>App</h4>
<ul>
  <li>Settings: new Radios tab, to the right of Features, while Rig Control, Rotor Control or Network Audio is on: their settings are there now (turned on and off in Features, Service as before)
    <ul>
      <li>In a narrow window, About moves up to the row above so the tabs fit on one line</li>
    </ul>
  </li>
  <li>Settings, Audio: Device is now Output Device</li>
  <li>Lookup: a callsign pasted or typed with a space before it, or in lower case, no longer shows its country as Unknown under the card</li>
  <li>Lookup: the Callsign Lookup window has a new look, and resizes itself to fit each lookup
    <ul>
      <li>Clear and Generate Messages are at the top, under GridTracker's acknowledgement of the station</li>
      <li>The grid, distance and bearing are under the station's card; in your log for the call, bands only worked have a dashed outline and confirmed ones are filled</li>
      <li>The Details are laid out in columns, so the window is shorter</li>
    </ul>
  </li>
  <li>At startup the map goes back to the WSJT-X, JTDX or other instance it was showing when GridTracker2 was closed, once that instance starts sending (within 30 seconds), even if another one, such as the Multi-Mode Decoder, was heard first; picking an instance yourself before then keeps your choice</li>
</ul>
```
