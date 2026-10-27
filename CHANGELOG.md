# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),

## [v2.261024.0]

### MD Markup Format
#### Map / UI

- Five new base maps: Topographical by OpenTopoMap, Satellite (no labels), Topographical and Satellite Topo by USGS (best coverage in the US), and Satellite Firefly by Esri
- New Santa Tracker: a new button in the button panel will appear on Dec 12th that follows Santa and his reindeer around the world, using amateur radio tracking technology
  - Move the mouse over a stop to see its DXCC entity, and state or province
- The Kp button now grows smoothly under the mouse, like the other buttons in the button panel

#### Multi-Mode Decoder

- New Multi-Mode Decoder (Settings, Features, Service): decodes every CW signal in your receiver's passband, or FT8, and shows them in its new window, opened with the Toggle Multi-Mode Decoder button
  - A waterfall of the passband with each signal found marked on it, and a line of decoded text for each signal with its frequency and speed
  - A CQ and the call after it are highlighted
  - Follows each operator's own speed and weighting, and copes with fading
  - With Rig Control connected, signals are shown at their frequency on the air
  - Wide Filter: while decoding, Rig Control opens the rig's filter to its widest so more signals are heard, and puts it back afterwards (an Icom over CI-V, or Hamlib rigctld)
  - The waterfall always runs from low frequencies on the left to high on the right, in LSB and CW-R as well
  - Text already decoded is corrected as the decoder learns more of an operator's timing: the start of a transmission, or a change of speed part way through (corrected text glows for a moment)
  - Click a signal to tune the rig to it (with Rig Control)
  - Scan Band: steps the rig through the CW part of the band it is on, a few seconds at each step, until stopped
  - The mouse over a signal's line marks the signal on the waterfall, and the mouse over a signal on the waterfall shades its line
  - Clear: forgets everything decoded and starts again from scratch
  - Right-click a signal to pin it: its marks stay on the waterfall and its line stays listed
  - Drag the [ and ] on the scale to set the lowest and highest audio decoded (hum and noise below a few hundred Hz left out)
  - Bandwidth: decode a rig's passband (2.5k to 4.5k), or much more of an SDR's audio (up to the whole of a 96 kHz stream)
  - The mouse wheel over the waterfall tunes the rig up or down by its tuning step, 1 kHz at the least (with Rig Control)
  - FT8 mode (Mode menu): decodes each 15 second FT8 period on its own, without WSJT-X (fewer decodes than WSJT-X: about two in three on a busy band)
    - Built on ft8_lib by Kārlis Goba, YL3JG
    - Signals decoded are taken out and each period searched again, finding the weaker ones they covered: the method of WSJT-X, with thanks to Joe Taylor, K1JT, and the WSJT development team
    - A signal the usual way can't decode is tried twice more, as WSJT-X does: by ordered statistics decoding (marked o), and by guessing it is a CQ (a1) or a call to you (a2). Again with thanks to Joe Taylor, K1JT, and the WSJT development team
    - Each period is decoded early, as WSJT-X does, so most messages show about 3 seconds sooner; any new at the period's end are added under them

#### App

- Settings, Audio: Device is now Output Device, and the new Input Device picks what the Multi-Mode Decoder listens to (your rig's audio)

### HTML List

```html
<h4>Map / UI</h4>
<ul>
  <li>Five new base maps: Topographical by OpenTopoMap, Satellite (no labels), Topographical and Satellite Topo by USGS (best coverage in the US), and Satellite Firefly by Esri</li>
  <li>New Santa Tracker: a new button in the button panel will appear on Dec 12th that follows Santa and his reindeer around the world, using amateur radio tracking technology
    <ul>
      <li>Move the mouse over a stop to see its DXCC entity, and state or province</li>
    </ul>
  </li>
  <li>The Kp button now grows smoothly under the mouse, like the other buttons in the button panel</li>
</ul>
<h4>Multi-Mode Decoder</h4>
<ul>
  <li>New Multi-Mode Decoder (Settings, Features, Service): decodes every CW signal in your receiver's passband, or FT8, and shows them in its new window, opened with the Toggle Multi-Mode Decoder button
    <ul>
      <li>A waterfall of the passband with each signal found marked on it, and a line of decoded text for each signal with its frequency and speed</li>
      <li>A CQ and the call after it are highlighted</li>
      <li>Follows each operator's own speed and weighting, and copes with fading</li>
      <li>With Rig Control connected, signals are shown at their frequency on the air</li>
      <li>Wide Filter: while decoding, Rig Control opens the rig's filter to its widest so more signals are heard, and puts it back afterwards (an Icom over CI-V, or Hamlib rigctld)</li>
      <li>The waterfall always runs from low frequencies on the left to high on the right, in LSB and CW-R as well</li>
      <li>Text already decoded is corrected as the decoder learns more of an operator's timing: the start of a transmission, or a change of speed part way through (corrected text glows for a moment)</li>
      <li>Click a signal to tune the rig to it (with Rig Control)</li>
      <li>Scan Band: steps the rig through the CW part of the band it is on, a few seconds at each step, until stopped</li>
      <li>The mouse over a signal's line marks the signal on the waterfall, and the mouse over a signal on the waterfall shades its line</li>
      <li>Clear: forgets everything decoded and starts again from scratch</li>
      <li>Right-click a signal to pin it: its marks stay on the waterfall and its line stays listed</li>
      <li>Drag the [ and ] on the scale to set the lowest and highest audio decoded (hum and noise below a few hundred Hz left out)</li>
      <li>Bandwidth: decode a rig's passband (2.5k to 4.5k), or much more of an SDR's audio (up to the whole of a 96 kHz stream)</li>
      <li>The mouse wheel over the waterfall tunes the rig up or down by its tuning step, 1 kHz at the least (with Rig Control)</li>
      <li>FT8 mode (Mode menu): decodes each 15 second FT8 period on its own, without WSJT-X (fewer decodes than WSJT-X: about two in three on a busy band)
        <ul>
          <li>Built on ft8_lib by Kārlis Goba, YL3JG</li>
          <li>Signals decoded are taken out and each period searched again, finding the weaker ones they covered: the method of WSJT-X, with thanks to Joe Taylor, K1JT, and the WSJT development team</li>
          <li>A signal the usual way can't decode is tried twice more, as WSJT-X does: by ordered statistics decoding (marked o), and by guessing it is a CQ (a1) or a call to you (a2). Again with thanks to Joe Taylor, K1JT, and the WSJT development team</li>
          <li>Each period is decoded early, as WSJT-X does, so most messages show about 3 seconds sooner; any new at the period's end are added under them</li>
        </ul>
      </li>
    </ul>
  </li>
</ul>
<h4>App</h4>
<ul>
  <li>Settings, Audio: Device is now Output Device, and the new Input Device picks what the Multi-Mode Decoder listens to (your rig's audio)</li>
</ul>
```
