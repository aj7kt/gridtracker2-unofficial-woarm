// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Multi-Mode Decoder's WWV mode: NIST's time stations WWV (Fort Collins, Colorado) and WWVH (Kauai, Hawaii) on 2.5, 5, 10, 15, 20
// and 25 MHz, read as NIST Special Publication 432 (2002, chapter 3) describes them:
//   AM, double sideband with the full carrier. Every second a pulse of 5 ms of 1000 Hz (WWV) or 1200 Hz (WWVH), its start the
//   second; none at seconds 29 and 59; second 0 an 800 ms pulse of 1000 or 1200 Hz (the minute), 1500 Hz at the hour (both stations).
//   From 10 ms before each second to 25 ms after the pulse (40 ms) nothing else is sent (the protected zone). The pulses and marks are
//   100 % modulation, the tones and the time code 50 %. UT1 (DUT1) is sent as doubled ticks in seconds 1-16 too (not used here: the time
//   code carries it).
//   The time code: BCD on a 100 Hz subcarrier, a bit a second, a frame a minute (a modified IRIG-H). Each second's 100 Hz pulse is high
//   for 200 ms (a 0), 500 ms (a 1) or 800 ms (a position marker, at seconds 9, 19, 29, 39, 49 and 59), its first 30 ms taken out by the
//   protected zone; second 0 has none (the hole). Bits sent least significant first: 2 DST at 0000 UTC (changes 24 h after bit 55), 3
//   leap second warning, 4-7 year units, 10-13 and 15-17 the minute, 20-23 and 25-26 the hour, 30-33, 35-38 and 40-41 the day of the
//   year, 50 UT1's sign (1 positive), 51-54 the year's tens, 55 DST (changes at 0000 UTC on the day of a change), 56-58 UT1 in tenths of
//   a second; the others are 0. The time is the time at the start of the frame's minute; its seconds are counted from the pulses.
// How it runs (on the 12 kHz audio, as FT8's):
//   Tuned the usual way for a rig whose filter cuts low audio (USB, the dial 1 kHz under the carrier), the carrier is a strong steady
//   tone in the audio: found by a spectrum each second (and only taken for one when it holds through the protected zone, which a tone
//   doesn't), the audio made analytic, mixed down to 0 Hz and filtered, and read in phase with the carrier (the carrier itself, averaged
//   over 20 ms, is the phase: a 20 ms average has nulls at every multiple of 50 Hz, so the 100 Hz code and the 1000 and 1200 Hz pulses
//   don't move it), divided by its level (so a fade doesn't change the depths). That's the AM's modulation, whichever sideband the rig
//   passes. An AM receiver's audio is the modulation already: both are tried, and the one whose pulses come clearer is read.
//   Each station's pulse: the audio against 5 ms of its tone (a matched filter: 5 ms of 1000 Hz and 6 cycles of 1200 Hz are orthogonal
//   when they line up; a few ms apart one still shows through the other's filter, WWV_LEAK_NEAR), its power folded onto a second
//   (averaged second over second) shows where its pulses fall long before a single one stands out. The seconds are then counted from
//   there: each station's pulse looked for near where it should be every second, singly (its peak read between samples) and averaged
//   over the seconds (followed when single pulses are too weak), the count kept on the pulses (through fades too, on the rate they have
//   shown).
//   Each second's code: the 100 Hz's level (mixed to 0 Hz, two 10 ms averages: nulls at every multiple of 100 Hz, so the tones and
//   pulses are gone) in four parts of the second, against its usual high and low: high to 200 ms only, a 0; to 500 ms, a 1; to 800 ms,
//   a marker; none, the hole. Which second is second 0 is found from the minute marks (and the hour's) and from the markers and the hole
//   at their places, scored over the last three minutes. Each minute's frame is then read and checked (markers, the bits that are always
//   0, each digit in range): the minute after the last one taken, or one the next minute confirms, is read ("code"); a first reading
//   not yet confirmed is "unconfirmed"; a minute too garbled to read, counted on from the last one read and confirmed, within the hour
//   ("flywheel").
//   The PC clock against the signal: each audio chunk comes with the PC clock's time of its last sample (the audio's own latency taken
//   off by the page), the line through those (over the last two minutes, the odd one left out) gives the PC clock's time of any
//   sample, so of each pulse's start. Less the second the time code says it is: that's the PC clock's offset plus the radio path's
//   delay (taken off by the page, which knows where you are). Each minute's pulses from seconds 17 to 58 (not 0, the minute mark; not
//   1-16, where doubled ticks may be; none at 29 and 59), each station's on its own: the median of those that stood out singly, else
//   the peak of their sum.
// In:  { type: "init", rate }, { type: "audio", samples, wall (PC clock ms of the last sample, or null) }, { type: "reset" }
// Out: { type: "status", path, carrier, counting, aligned, sec, utc (the second just heard, by the minute taken), codeSnr, stations:
//      [{ name, tone, locked (heard), ratio, snr (dB), heard (this second), delayMs }] } each second (each second of audio until the
//      seconds are counted); { type: "frame", read, mode, markers, weak, codeSnr, fields: { minuteStart, year, doy, hour, minute, dut1,
//      lsw, dst1, dst2 } or null } each minute; { type: "minute", minuteStart, mode ("code", "flywheel", "unconfirmed" or "nearest"),
//      stations: [{ name, n, median (ms: the PC clock less the second, path not taken off), mad, sigma (ms), snr (dB), summed }] }

const WWV_RATE = 12000;
// The stations and their pulse tones; the hour mark's tone (both)
const WWV_STATIONS = [{ name: "WWV", tone: 1000 }, { name: "WWVH", tone: 1200 }];
const WWV_HOUR_HZ = 1500;
// The pulse: 5 ms
const WWV_TICK = 60;
// Rings of samples kept (a power of 2, over 2.5 s)
const WWV_RING = 32768;
const WWV_MASK = WWV_RING - 1;
// The carrier: looked for each second in a spectrum of this many samples (1.5 Hz a bin), averaged (each new one's share), between
// these (Hz), this many times the power of the spectrum around it (15 dB); lost after this many seconds without
const WWV_FFT = 8192;
const WWV_SPECTRUM_SHARE = 0.25;
const WWV_CARRIER_MIN_HZ = 400;
const WWV_CARRIER_MAX_HZ = 3000;
const WWV_CARRIER_PROMINENCE = 30;
const WWV_CARRIER_LOST_S = 10;
// A carrier holds steady through every part of the second (its level folded onto a second: its least over its median, over this many
// seconds at least); a tone found instead (an AM receiver's 500 or 600 Hz, the minute's 800 ms) drops out in the protected zone, or
// for most of the second
const WWV_STEADY = 0.5;
const WWV_STEADY_SECONDS = 5;
// The carrier's way: the audio first made analytic (a Hilbert filter of this many taps: its frequencies under 0 Hz gone, which the
// mixing would otherwise fold over the pulses' tones: a 500 Hz tone's lower sideband onto 1500 Hz), then mixed to 0 Hz and filtered (its
// taps and edge, Hz); the carrier's phase averaged over 2 x this + 1 samples (20 ms)
const WWV_HILBERT_TAPS = 127;
const WWV_LPF_TAPS = 129;
const WWV_LPF_HZ = 1650;
const WWV_REF_HALF = 120;
const WWV_CARRIER_DELAY = (WWV_HILBERT_TAPS - 1) / 2 + (WWV_LPF_TAPS - 1) / 2 + WWV_REF_HALF;
// The code's level: two averages of 2 x this + 1 samples (10 ms)
const WWV_BCD_HALF = 60;
// The fold: a bin every this many samples (1 ms), each second's share; how many seconds before a lock is judged; a lock when the fold's
// peak stands this many deviations over its median (its spread, MAD), let go under the second
const WWV_FOLD_BIN = 12;
const WWV_FOLD_SHARE = 0.06;
const WWV_FOLD_MIN = 4;
const WWV_LOCK_ON = 7;
const WWV_LOCK_OFF = 4;
// Each station's pulse averaged over the seconds (each second's share), around where it should be: followed when single pulses are too
// weak to stand out; a minute's timing from the minute's sum of them when fewer than this many of its pulses stood out on their own, if
// the sum's peak stands this many deviations over its median
const WWV_PROFILE_SHARE = 0.2;
const WWV_PROFILE_TICKS = 20;
const WWV_PROFILE_Z = 8;
// One station's 5 ms pulse shows through the other's filter when they're a few ms apart (at 2.5 ms, about 10 dB under it: the two
// tones are orthogonal over the whole 5 ms only). A station whose averaged pulse is this near the other's (samples: 6 ms) and under this
// share of its strength (-4 dB) is taken as the other's showing through, not heard (where the two arrive this close together, a
// station that much weaker can't be told from it)
const WWV_LEAK_NEAR = 72;
const WWV_LEAK_SHARE = 0.4;
// A station's pulse is its tone alone: where the other station's filter has this share of its power or more at the same place, it's the
// other station's pulse showing through, or something with every tone in it (the click of the tones starting again after the
// protected zone), not taken for this station's
const WWV_FOREIGN = 0.5;
// The other way of reading (carrier or AM audio) is taken when its pulses come this many times clearer
const WWV_PATH_SWITCH = 1.5;
// A second's pulse: looked for this far either side of where it should be (samples: 35 ms at first, 15 ms after 5 pulses, 6 ms after
// 10: the other station's pulse, often a few ms away, shows faintly through this one's filter), taken when its power is this many times
// the second's median (9 dB) and the 100-700 ms after it hold under this share of it (not a minute's 800 ms mark)
const WWV_SEARCH_FIRST = 420;
const WWV_SEARCH = 180;
const WWV_SEARCH_NEAR = 72;
const WWV_TICK_SNR = 8;
const WWV_PLATEAU = 0.2;
// The seconds counted again from scratch after this many running with no station heard and the fold's pulses not where the count has
// them (lost), or with no station heard at all; the time shown only while one has been heard within the last this many
const WWV_LOST_S = 20;
const WWV_UNHEARD_S = 120;
const WWV_SHOWN_S = 20;
// The seconds whose pulses time the PC clock, and how many of a station's at least make a minute's timing
const WWV_TIMING = (sec) => (sec >= 17 && sec <= 58 && sec != 29);
const WWV_TIMED_MIN = 10;
const WWV_STEADY_SECONDS_MIN = 40;
// The two stations' minutes, both timed, differ by the paths' difference, which hardly changes: one this far (ms) from what the last
// minutes' differences have been is a station timed wrong (the weaker of the two is left out)
const WWV_PAIR_MS = 3;
// A station's minute whose single pulses scatter more than this (ms, as a standard deviation) isn't timed
const WWV_MAD_MAX = 3;
// Seconds kept (records), and those the code's usual levels are taken over
const WWV_KEEP = 180;
const WWV_LEVELS = 30;
// A mark scored against the pulses of this many seconds heard at least; one scoring over this many times the pulses' power isn't one
const WWV_MARK_PULSES = 20;
const WWV_MARK_MAX = 2.5;
// Second 0 is found once the best place scores this much over the next, over this many seconds at least; another place takes over
// only by this much
const WWV_ALIGN_MARGIN = 4;
const WWV_ALIGN_MIN = 40;
const WWV_ALIGN_SWITCH = 6;
// The PC clock's time of a sample: from the chunks of the last this long (ms), a chunk this far off the line through the others left
// out; this far off three times running, the PC clock was set, or audio was lost or doubled (the line starts again, and the minutes
// heard across it aren't timed)
const WWV_WALL_KEEP_MS = 120000;
const WWV_WALL_OUTLIER_MS = 20;
const WWV_WALL_STEP_MS = 20;
// A minute too garbled to read is taken as the one after the last when no more than this many of its bits differ from that
const WWV_FLYWHEEL_BITS = 4;
// The grid (the last minute read and confirmed, by its sample): a minute's second 0 within this (ms) of one of its seconds is on it;
// counted on for this many hours at most
const WWV_GRID_MS = 300;
const WWV_GRID_HOURS = 6;
// An unconfirmed reading's date is given only within this of the PC clock (ms)
const WWV_SHOW_UNCONFIRMED_MS = 3600000;
// A station's pulse this far (ms) from where the minute before had it, by the samples between them, is the audio's own delay changing
// (the sound card or its driver: the stations don't move), when its offset moved with it (within WWV_DELAY_AGREE_MS), each station
// compared moved alike, each against the last minute it was timed in, within WWV_DELAY_AGE_S (one minute between not timed at most: the
// PC clock's drift over longer, a ms a minute or so, would look like one)
const WWV_DELAY_STEP_MS = 5;
// The time code's flags: shown changed only once two minutes running read them so (wwvMinute)
const WWV_FLAGS = ["dut1", "lsw", "dst1", "dst2"];
const WWV_DELAY_AGREE_MS = 2;
const WWV_DELAY_AGE_S = 150;
// The bits that are always 0, and where the markers are
const WWV_ZERO_BITS = [1, 8, 14, 18, 24, 27, 28, 34, 42, 43, 44, 45, 46, 47, 48];
const WWV_MARKERS = [9, 19, 29, 39, 49, 59];

let W = null;

self.onmessage = (event) =>
{
  const m = event.data;
  if (m.type == "init" || m.type == "reset") wwvInit();
  else if (m.type == "audio")
  {
    if (!W) wwvInit();
    wwvAudio(m.samples, m.wall);
  }
};

function wwvOut(message)
{
  self.postMessage(message);
}

function wwvInit()
{
  W = {
    n: 0,                                  // samples so far: the clock everything's timed by
    raw: new Float32Array(WWV_RING),
    spectrum: null,
    spectrumFrames: 0,
    carrier: null,                          // Hz in the audio, or null
    carrierLostAt: 0,
    mixPhase: 0,
    lpf: wwvLowPass(WWV_LPF_TAPS, WWV_LPF_HZ / WWV_RATE),
    hilbert: wwvHilbert(WWV_HILBERT_TAPS),
    zi: new Float32Array(WWV_RING),
    zq: new Float32Array(WWV_RING),
    mi: new Float32Array(256),
    mq: new Float32Array(256),
    refI: 0,
    refQ: 0,
    steadyFold: new Float32Array(WWV_RATE / WWV_FOLD_BIN),
    steadyAcc: new Float32Array(WWV_RATE / WWV_FOLD_BIN),
    steadyCount: 0,
    steady: false,
    paths: [wwvPath("direct", 0), wwvPath("carrier", WWV_CARRIER_DELAY)],
    chosen: 0,
    tones: [1000, 1200, WWV_HOUR_HZ].map((hz) => wwvTone(hz)),
    bcdCos: new Float32Array(120),
    bcdSin: new Float32Array(120),
    // The seconds counted: { j, T (where the next second's pulse is, sample: each station's is T + its delta), period, refTicks: [[j, t]],
    // unheard, lost (seconds running), heardJ (the last second a station was heard) }
    clock: null,
    // Each station: where its pulse is against the count's (samples), the dB of its pulses that stood out, how many have, its averaged
    // pulse (prof), how far that stands out (profZ, strength: its peak over its level) and its peak's error against where it should be
    stations: WWV_STATIONS.map(() => ({ delta: null, snrs: [], measured: 0, prof: null, profZ: 0, strength: 0, profErr: 0 })),
    // Each second: its count (j), where its pulse should be (T), each station's pulse found (ticks: { t, snr, ok }) and the power around
    // it (segs: { base, seg }), each filter's level (noise) and power over 100-700 ms (mk), the power where each averaged pulse peaks
    // (tick), the mark's score (mark, hour), the code's levels (sA to sD) and its place in the minute (sec)
    records: [],
    align: null,                            // the second-0 place found: j mod 60, its score's margin
    frames: [],                             // the minutes taken: { fields, mode, j0 (the count at its second 0), confirmed }
    candidate: null,                        // a minute read cleanly but not the one expected: { fields, j0 }
    lastReadJ0: null,                       // the count at second 0 of the last minute read and confirmed
    pairDiffs: [],                          // the last minutes' WWVH less WWV (ms), both timed
    // Kept through restarts of the count (the samples go on counting): the grid (the last minute read and confirmed: { fields, n0 (its
    // second 0's sample), period }), each station's pulse at the last minute timed ({ pos (its second 0's sample), median, T, stepAt }),
    // the rate the pulses last came at (samples a second)
    grid: null,
    offGrid: 0,
    lastRead: null,                         // the last minute read cleanly: { minuteStart, f } (its flags: dut1, lsw, dst1, dst2)
    posRef: [null, null],
    lastPeriod: WWV_RATE,
    walls: [],                              // [n (the chunk's last sample), the wall ms less n's time]
    wallPending: [],                        // chunks far off the line, three running a step
    wallFit: null,
    stepAt: -1                              // the sample the PC clock was last seen set at
  };
  for (let k = 0; k < 120; k++)
  {
    W.bcdCos[k] = Math.cos((2 * Math.PI * k) / 120);
    W.bcdSin[k] = Math.sin((2 * Math.PI * k) / 120);
  }
}

// A low-pass filter's taps (Blackman window), its edge a share of the rate
function wwvLowPass(taps, fc)
{
  const h = new Float32Array(taps);
  let sum = 0;
  for (let k = 0; k < taps; k++)
  {
    const m = k - (taps - 1) / 2;
    const sinc = m == 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * m) / (Math.PI * m);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * k) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * k) / (taps - 1));
    h[k] = sinc * w;
    sum += h[k];
  }
  for (let k = 0; k < taps; k++) h[k] /= sum;
  return h;
}

// A Hilbert filter's taps (Blackman window): 2 / (pi m) at the odd places m from its middle, 0 at the even
function wwvHilbert(taps)
{
  const h = new Float32Array(taps);
  const M = (taps - 1) / 2;
  for (let k = 0; k < taps; k++)
  {
    const m = k - M;
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * k) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * k) / (taps - 1));
    h[k] = m % 2 ? (2 / (Math.PI * m)) * w : 0;
  }
  return h;
}

// A tone's 5 ms matched filter
function wwvTone(hz)
{
  const c = new Float32Array(WWV_TICK), s = new Float32Array(WWV_TICK);
  for (let k = 0; k < WWV_TICK; k++)
  {
    c[k] = Math.cos((2 * Math.PI * hz * k) / WWV_RATE);
    s[k] = Math.sin((2 * Math.PI * hz * k) / WWV_RATE);
  }
  return { hz, c, s };
}

// A way of reading the audio: its modulation (b), each tone's matched filter power (y: WWV's, WWVH's, the hour's), the code's level
// (env), each station's fold; all by the sample they're of (delay: how far behind the audio they come)
function wwvPath(name, delay)
{
  return {
    name: name,
    delay: delay,
    b: new Float32Array(WWV_RING),
    y: [0, 1, 2].map(() => new Float32Array(WWV_RING)),
    env: new Float32Array(WWV_RING),
    u: new Float32Array(WWV_RING),
    w: new Float32Array(WWV_RING),
    sumU: 0,
    sumW: 0,
    sumU2: 0,
    sumW2: 0,
    u2: new Float32Array(WWV_RING),
    w2: new Float32Array(WWV_RING),
    last: -1,                               // the newest sample of b
    folds: [0, 1].map(() => new Float32Array(WWV_RATE / WWV_FOLD_BIN)),
    acc: [0, 1].map(() => new Float32Array(WWV_RATE / WWV_FOLD_BIN)),
    foldCount: 0,
    ratio: [0, 0],
    phase: [0, 0],
    lock: [false, false]
  };
}

// The newest sample each path has done everything for (its code level is the last thing made)
function wwvReady(p)
{
  return p.last - 2 * WWV_BCD_HALF;
}

function wwvAudio(samples, wall)
{
  for (let i = 0; i < samples.length; i++)
  {
    const n = W.n++;
    const x = samples[i];
    W.raw[n & WWV_MASK] = x;
    wwvPathSample(W.paths[0], n, x);
    if (W.carrier != null) wwvCarrierSample(n);
    // Each second of audio: the spectrum (the carrier), the folds
    if (n % WWV_RATE == WWV_RATE - 1) wwvSecond();
  }
  if (wall != null && isFinite(wall)) wwvWall(W.n - 1, wall);
  wwvSlots();
}

// The carrier's way: the audio made analytic, mixed to 0 Hz, filtered, read in phase with the carrier's own 20 ms average, divided by
// its power
function wwvCarrierSample(n)
{
  // The analytic sample (taps - 1) / 2 back: itself, and the Hilbert filter's output as its imaginary part
  const hm = (WWV_HILBERT_TAPS - 1) / 2;
  const a = n - hm;
  const xr = W.raw[a & WWV_MASK];
  let xi = 0;
  const hb = W.hilbert;
  for (let t = 0; t < WWV_HILBERT_TAPS; t += 2) xi += hb[t] * W.raw[(n - t) & WWV_MASK];
  W.mixPhase += (2 * Math.PI * W.carrier) / WWV_RATE;
  if (W.mixPhase > Math.PI) W.mixPhase -= 2 * Math.PI;
  const cos = Math.cos(W.mixPhase), sin = Math.sin(W.mixPhase);
  const k = a & 255;
  W.mi[k] = xr * cos + xi * sin;
  W.mq[k] = xi * cos - xr * sin;
  let zi = 0, zq = 0;
  const h = W.lpf;
  for (let t = 0; t < WWV_LPF_TAPS; t++)
  {
    const at = (a - t) & 255;
    zi += h[t] * W.mi[at];
    zq += h[t] * W.mq[at];
  }
  // (z for the sample (taps - 1) / 2 back)
  const m = a - (WWV_LPF_TAPS - 1) / 2;
  W.zi[m & WWV_MASK] = zi;
  W.zq[m & WWV_MASK] = zq;
  W.refI += zi - W.zi[(m - 2 * WWV_REF_HALF - 1) & WWV_MASK];
  W.refQ += zq - W.zq[(m - 2 * WWV_REF_HALF - 1) & WWV_MASK];
  // The sample at the middle of the average
  const c = m - WWV_REF_HALF;
  if (c < 2 * WWV_REF_HALF + WWV_LPF_TAPS) return;
  const pi = W.refI, pq = W.refQ;
  const p2 = pi * pi + pq * pq;
  if (!(p2 > 0)) return;
  // Its level folded onto the second: steady (a carrier) or not
  W.steadyAcc[((c % WWV_RATE) / WWV_FOLD_BIN) | 0] += p2;
  if (c % WWV_RATE == WWV_RATE - 1) wwvSteady();
  const n2 = 2 * WWV_REF_HALF + 1;
  let b = ((W.zi[c & WWV_MASK] * pi + W.zq[c & WWV_MASK] * pq) * n2) / p2 - 1;
  if (b > 4) b = 4;
  else if (b < -4) b = -4;
  wwvPathSample(W.paths[1], c, b);
}

// A sample of a path's modulation: each tone's 5 ms filter over the 5 ms ending here (its value is the pulse starting 5 ms back), the
// code's 100 Hz level (two centered 10 ms averages, 10 ms back each)
function wwvPathSample(p, m, v)
{
  p.b[m & WWV_MASK] = v;
  p.last = m;
  const s = m - (WWV_TICK - 1);
  if (s >= 0)
  {
    for (let t = 0; t < 3; t++)
    {
      const T = W.tones[t];
      let re = 0, im = 0;
      for (let k = 0; k < WWV_TICK; k++)
      {
        const x = p.b[(s + k) & WWV_MASK];
        re += x * T.c[k];
        im += x * T.s[k];
      }
      const pow = re * re + im * im;
      p.y[t][s & WWV_MASK] = pow;
      if (t < 2) p.acc[t][((s % WWV_RATE) / WWV_FOLD_BIN) | 0] += pow;
    }
    // The fold's second is done: folded in, and each station's lock judged
    if (s % WWV_RATE == WWV_RATE - 1) wwvFold(p);
  }
  // The code's level
  const ph = m % 120;
  p.u[m & WWV_MASK] = v * W.bcdCos[ph];
  p.w[m & WWV_MASK] = -v * W.bcdSin[ph];
  const n2 = 2 * WWV_BCD_HALF + 1;
  p.sumU += p.u[m & WWV_MASK] - p.u[(m - n2) & WWV_MASK];
  p.sumW += p.w[m & WWV_MASK] - p.w[(m - n2) & WWV_MASK];
  const c1 = m - WWV_BCD_HALF;
  p.u2[c1 & WWV_MASK] = p.sumU / n2;
  p.w2[c1 & WWV_MASK] = p.sumW / n2;
  p.sumU2 += p.u2[c1 & WWV_MASK] - p.u2[(c1 - n2) & WWV_MASK];
  p.sumW2 += p.w2[c1 & WWV_MASK] - p.w2[(c1 - n2) & WWV_MASK];
  const c2 = c1 - WWV_BCD_HALF;
  if (c2 >= 0) p.env[c2 & WWV_MASK] = Math.hypot(p.sumU2, p.sumW2) / n2;
}

function wwvMedian(list)
{
  if (!list.length) return 0;
  const s = Array.from(list).sort((a, b) => a - b);
  return s[s.length >> 1];
}

// How many deviations (its median absolute deviation, as a standard deviation) a value stands over a list's median
function wwvZ(list, value)
{
  const median = wwvMedian(list);
  const mad = wwvMedian(Array.from(list, (v) => Math.abs(v - median))) * 1.4826;
  return mad > 0 ? (value - median) / mad : 0;
}

// A profile's peak (its place read between samples) and how far it stands out: { at, z }; mask: [from, to] left out (the other
// station's pulse showing through), or null; cross: the other station's filter over the same place, where it's WWV_FOREIGN of this one's
// or more not taken for a peak (or null)
function wwvProfilePeak(prof, mask, cross)
{
  let top = -Infinity, at = 0;
  const rest = [];
  // (Each over its own level: the noise is in both)
  const mp = cross ? wwvMedian(prof) : 0, mc = cross ? wwvMedian(cross) : 0;
  for (let k = 0; k < prof.length; k++)
  {
    if (mask && k >= mask[0] && k <= mask[1]) continue;
    rest.push(prof[k]);
    if (cross && cross[k] - mc >= WWV_FOREIGN * (prof[k] - mp)) continue;
    if (prof[k] > top)
    {
      top = prof[k];
      at = k;
    }
  }
  const l = prof[Math.max(0, at - 1)], r = prof[Math.min(prof.length - 1, at + 1)];
  const d = l - 2 * top + r;
  const off = d < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / d)) : 0;
  return { at: at + off, z: wwvZ(rest, top) };
}

// Where in a station's window (around where its pulse should be, WWV_SEARCH either side) the other station's pulse is, when that one is
// the stronger and its averaged pulse stands out: that and WWV_LEAK_NEAR either side, [from, to]; else null
function wwvMask(st)
{
  const S = W.stations[st], O = W.stations[1 - st];
  if (S.delta == null || O.delta == null || O.profZ < WWV_PROFILE_Z || O.strength <= S.strength) return null;
  const at = O.delta + O.profErr - S.delta + WWV_SEARCH;
  return [Math.floor(at - WWV_LEAK_NEAR), Math.ceil(at + WWV_LEAK_NEAR)];
}

// The carrier's level, a second of it folded in (as shares of its median): steady once its least is over WWV_STEADY of its median
function wwvSteady()
{
  const a = W.steadyAcc, f = W.steadyFold;
  const level = wwvMedian(a);
  if (level > 0)
  {
    W.steadyCount++;
    const share = W.steadyCount == 1 ? 1 : Math.max(WWV_FOLD_SHARE, 1 / W.steadyCount);
    for (let k = 0; k < f.length; k++) f[k] += share * (a[k] / level - f[k]);
    let least = Infinity;
    for (let k = 0; k < f.length; k++) least = Math.min(least, f[k]);
    W.steady = W.steadyCount >= WWV_STEADY_SECONDS && least > WWV_STEADY * wwvMedian(f);
  }
  a.fill(0);
}

// A second folded in, as shares of its own median (so a minute's 800 ms mark, or a fade, weighs no more than any other second): each
// station's peak against the fold's median, and where in the second it is
function wwvFold(p)
{
  // (A second of silence, as the carrier's way has before its carrier is found: not folded)
  if (!(wwvMedian(p.acc[0]) > 0 && wwvMedian(p.acc[1]) > 0))
  {
    p.acc[0].fill(0);
    p.acc[1].fill(0);
    return;
  }
  p.foldCount++;
  const share = p.foldCount == 1 ? 1 : Math.max(WWV_FOLD_SHARE, 1 / p.foldCount);
  const bins = p.folds[0].length;
  const tops = [0, 1].map((st) =>
  {
    const f = p.folds[st], a = p.acc[st];
    const level = wwvMedian(a);
    let top = 0, at = 0;
    for (let k = 0; k < bins; k++)
    {
      f[k] += share * (a[k] / level - f[k]);
      a[k] = 0;
      if (f[k] > top)
      {
        top = f[k];
        at = k;
      }
    }
    return { top, at, z: wwvZ(f, top) };
  });
  // The weaker station's peak looked for away from the stronger's (WWV_LEAK_NEAR: the stronger's pulse shows through its filter there)
  const weak = tops[0].z < tops[1].z ? 0 : 1;
  const near = Math.ceil(WWV_LEAK_NEAR / WWV_FOLD_BIN);
  const strongAt = tops[1 - weak].at;
  const fw = p.folds[weak];
  let top = 0, at = 0;
  for (let k = 0; k < bins; k++)
  {
    const d = Math.min((k - strongAt + bins) % bins, (strongAt - k + bins) % bins);
    if (d > near && fw[k] > top)
    {
      top = fw[k];
      at = k;
    }
  }
  tops[weak] = { top, at, z: wwvZ(fw, top) };
  for (let st = 0; st < 2; st++)
  {
    const f = p.folds[st];
    const { top, at, z } = tops[st];
    p.ratio[st] = p.foldCount >= WWV_FOLD_MIN ? z : 0;
    // Where in the second (samples), between bins
    const l = f[(at + f.length - 1) % f.length], r = f[(at + 1) % f.length];
    const d = l - 2 * top + r;
    const off = d < 0 ? (0.5 * (l - r)) / d : 0;
    p.phase[st] = (((at + off) * WWV_FOLD_BIN + WWV_FOLD_BIN / 2) % WWV_RATE + WWV_RATE) % WWV_RATE;
    if (p.ratio[st] >= WWV_LOCK_ON) p.lock[st] = true;
    else if (p.ratio[st] < WWV_LOCK_OFF) p.lock[st] = false;
  }
}

function wwvPathBest(p)
{
  return Math.max(p.lock[0] ? p.ratio[0] : 0, p.lock[1] ? p.ratio[1] : 0);
}

// Each second of audio: the carrier looked for; which way is read; nothing found yet, a status anyway
function wwvSecond()
{
  wwvCarrierFind();
  // (The carrier's way only with a carrier: one found steady through the second)
  const carrier = W.carrier != null && W.steady;
  const now = W.paths[W.chosen], other = W.paths[1 - W.chosen];
  const a = W.chosen == 1 && !carrier ? 0 : wwvPathBest(now), b = W.chosen == 0 && !carrier ? 0 : wwvPathBest(other);
  if ((b > 0 && (a == 0 || b > a * WWV_PATH_SWITCH)) || (W.chosen == 1 && !carrier))
  {
    W.chosen = 1 - W.chosen;
    wwvClockReset();
  }
  if (!W.clock) wwvStatus(null);
}

// The spectrum of the last WWV_FFT samples (Hann), averaged: its strongest bin between WWV_CARRIER_MIN_HZ and WWV_CARRIER_MAX_HZ, when
// it stands that far over what's around it, is the carrier (its frequency read between bins)
function wwvCarrierFind()
{
  if (W.n < WWV_FFT) return;
  const re = new Float64Array(WWV_FFT), im = new Float64Array(WWV_FFT);
  for (let k = 0; k < WWV_FFT; k++) re[k] = W.raw[(W.n - WWV_FFT + k) & WWV_MASK] * (0.5 - 0.5 * Math.cos((2 * Math.PI * k) / WWV_FFT));
  wwvFft(re, im);
  const bins = WWV_FFT / 2;
  if (!W.spectrum) W.spectrum = new Float64Array(bins);
  W.spectrumFrames++;
  const share = W.spectrumFrames == 1 ? 1 : WWV_SPECTRUM_SHARE;
  for (let k = 0; k < bins; k++) W.spectrum[k] += share * (re[k] * re[k] + im[k] * im[k] - W.spectrum[k]);
  const binHz = WWV_RATE / WWV_FFT;
  const lo = Math.ceil(WWV_CARRIER_MIN_HZ / binHz), hi = Math.floor(WWV_CARRIER_MAX_HZ / binHz);
  let top = 0, at = -1;
  for (let k = lo; k <= hi; k++)
  {
    if (W.spectrum[k] > top)
    {
      top = W.spectrum[k];
      at = k;
    }
  }
  let found = null;
  if (at > 0)
  {
    const around = [];
    const span = Math.round(200 / binHz);
    for (let k = Math.max(1, at - span); k <= Math.min(bins - 1, at + span); k++) if (Math.abs(k - at) > 4) around.push(W.spectrum[k]);
    if (top > WWV_CARRIER_PROMINENCE * wwvMedian(around))
    {
      const l = Math.log(W.spectrum[at - 1] + 1e-30), c = Math.log(top), r = Math.log(W.spectrum[at + 1] + 1e-30);
      const d = l - 2 * c + r;
      found = (at + (d < 0 ? (0.5 * (l - r)) / d : 0)) * binHz;
    }
  }
  if (found != null)
  {
    // A carrier somewhere else (retuned): the carrier's way starts afresh
    if (W.carrier == null || Math.abs(found - W.carrier) > 20)
    {
      W.paths[1] = wwvPath("carrier", WWV_CARRIER_DELAY);
      W.refI = W.refQ = 0;
      W.zi.fill(0);
      W.zq.fill(0);
      W.steadyFold.fill(0);
      W.steadyAcc.fill(0);
      W.steadyCount = 0;
      W.steady = false;
      if (W.chosen == 1)
      {
        W.chosen = 0;
        wwvClockReset();
      }
    }
    W.carrier = found;
    W.carrierLostAt = 0;
  }
  else if (W.carrier != null)
  {
    if (!W.carrierLostAt) W.carrierLostAt = W.n;
    if (W.n - W.carrierLostAt > WWV_CARRIER_LOST_S * WWV_RATE)
    {
      W.carrier = null;
      if (W.chosen == 1)
      {
        W.chosen = 0;
        wwvClockReset();
      }
    }
  }
}

// An in-place radix-2 FFT
function wwvFft(re, im)
{
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++)
  {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j)
    {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1)
  {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len)
    {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++)
      {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

// The seconds counted again from scratch (another way of reading, or none heard for a long time)
function wwvClockReset()
{
  W.clock = null;
  W.records = [];
  W.align = null;
  // (The minutes taken are counted on from the count: with it gone, so are they)
  W.frames = [];
  W.candidate = null;
  W.lastReadJ0 = null;
  W.stations = WWV_STATIONS.map(() => ({ delta: null, snrs: [], measured: 0, prof: null, profZ: 0, strength: 0, profErr: 0 }));
}

// Each second the read way has all of: its pulses, marks and code read (wwvSlot)
function wwvSlots()
{
  const p = W.paths[W.chosen];
  const ready = wwvReady(p);
  if (!W.clock)
  {
    // Started on the clearest station's pulse, a second and more back (so it and the second after are all in the rings)
    const st = p.lock[1] && p.ratio[1] > p.ratio[0] ? 1 : p.lock[0] ? 0 : -1;
    if (st < 0 || ready < 3 * WWV_RATE) return;
    const back = ready - WWV_RATE - 600;
    const T = back - ((((back - p.phase[st]) % WWV_RATE) + WWV_RATE) % WWV_RATE);
    W.clock = { j: 0, T: T, period: W.lastPeriod, refTicks: [], unheard: 0, lost: 0, heardJ: null, anchor: null };
    W.stations.forEach((s, i) => (s.delta = i == st ? 0 : ((((p.phase[i] - p.phase[st]) % WWV_RATE) + WWV_RATE * 1.5) % WWV_RATE) - WWV_RATE / 2));
  }
  while (W.clock && wwvReady(p) >= W.clock.T + W.clock.period + WWV_SEARCH_FIRST + 10) wwvSlot(p);
}

// Where a station's power peaks between from and to (samples), read between samples: { t, v }
function wwvPeak(y, from, to)
{
  let top = -1, at = from;
  for (let i = from; i <= to; i++)
  {
    const v = y[i & WWV_MASK];
    if (v > top)
    {
      top = v;
      at = i;
    }
  }
  const l = y[(at - 1) & WWV_MASK], r = y[(at + 1) & WWV_MASK];
  const d = l - 2 * top + r;
  const off = d < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / d)) : 0;
  return { t: at + off, v: top, edge: at <= from + 1 || at >= to - 1 };
}

function wwvMean(y, from, to, step)
{
  let s = 0, n = 0;
  for (let i = Math.round(from); i <= to; i += step)
  {
    s += y[i & WWV_MASK];
    n++;
  }
  return n ? s / n : 0;
}

// A second: each station's pulse found near where it should be; the minute or hour mark's power; the code's levels; the seconds counted
// on (the pulse's place against where it was expected, half of it taken); second 0 found; a minute read once its second 59 is
function wwvSlot(p)
{
  const C = W.clock;
  // The station the count follows this second (wwvAnchor), and the count kept on its pulse (each station's place against it moved to
  // match): the code's levels and the marks are read from that pulse on, whichever station it is
  const anchor = wwvAnchor(p);
  const A0 = anchor == null ? null : W.stations[anchor];
  if (A0 && A0.delta)
  {
    const shift = A0.delta;
    C.T += shift;
    for (const S of W.stations) if (S.delta != null) S.delta -= shift;
    for (const r of C.refTicks) r[1] += shift;
  }
  const T = C.T;
  const rec = { j: C.j, T: T, ticks: [null, null], segs: [null, null], mark: 0, hour: false, sA: 0, sB: 0, sC: 0, sD: 0 };
  const ms = (x) => (x * WWV_RATE) / 1000;
  // Each filter's own level this second (its median, every 4 ms)
  rec.noise = [0, 1, 2].map((t) =>
  {
    const levels = [];
    for (let i = Math.round(T + ms(40)); i < T + ms(990); i += 48) levels.push(p.y[t][i & WWV_MASK]);
    return wwvMedian(levels) || 1e-30;
  });
  const recent = W.records.slice(-60);
  // A station not heard (its averaged pulse doesn't stand out), the other one than the anchor, looked for where its fold says
  for (let st = 0; st < 2; st++)
  {
    const S = W.stations[st];
    if (st != anchor && !wwvHeard(st) && p.lock[st])
    {
      const d = wwvWrap(p.phase[st] - T);
      // (Moved far: its averaged pulse, of the old place, starts over)
      if (S.delta != null && Math.abs(d - S.delta) > WWV_SEARCH) wwvProfileReset(S);
      S.delta = d;
    }
    // (Once the seconds are counted, each station whose place is known is looked for every second, heard or not: its averaged pulse
    // shows whether it is)
    if (S.delta == null) continue;
    const y = p.y[st];
    const pred = T + S.delta;
    const span = S.measured >= 10 ? WWV_SEARCH_NEAR : S.measured >= 5 ? WWV_SEARCH : WWV_SEARCH_FIRST;
    const pk = wwvPeak(y, Math.round(pred - span), Math.round(pred + span));
    const noise = rec.noise[st];
    const plateau = wwvMean(y, pk.t + ms(100), pk.t + ms(700), 12) / (pk.v || 1e-30);
    const snr = pk.v / noise;
    // (Not where the stronger station's pulse shows through)
    const mask = wwvMask(st);
    const leak = mask && pk.t - (Math.round(pred) - WWV_SEARCH) >= mask[0] && pk.t - (Math.round(pred) - WWV_SEARCH) <= mask[1];
    const foreign = p.y[1 - st][Math.round(pk.t) & WWV_MASK] / rec.noise[1 - st] - 1 >= WWV_FOREIGN * (snr - 1);
    const ok = snr >= WWV_TICK_SNR && plateau < WWV_PLATEAU && !pk.edge && !leak && !foreign;
    rec.ticks[st] = { t: pk.t, snr: snr, ok: ok, plateau: plateau };
    // The power around where the pulse should be, over the second's level (for the station's averaged pulse, and the minute's sum)
    // and the other station's filter's there (WWV_FOREIGN)
    const base = Math.round(pred);
    const seg = new Float32Array(2 * WWV_SEARCH + 1), cross = new Float32Array(2 * WWV_SEARCH + 1);
    const yo = p.y[1 - st], no = rec.noise[1 - st];
    for (let k = 0; k < seg.length; k++)
    {
      seg[k] = y[(base - WWV_SEARCH + k) & WWV_MASK] / noise;
      cross[k] = yo[(base - WWV_SEARCH + k) & WWV_MASK] / no;
    }
    rec.segs[st] = { base: base, seg: seg, cross: cross };
    // Half a minute without one (a fade, or the pulses wandered off): looked for widely again
    S.misses = ok ? 0 : (S.misses || 0) + 1;
    if (S.misses >= 30) S.measured = 0;
    if (ok)
    {
      S.measured++;
      S.snrs.push(snr);
      if (S.snrs.length > 60) S.snrs.shift();
    }
  }
  // The minute's mark (each station's own tone) or the hour's (1500 Hz, both): each filter's power over 100-700 ms, less what that
  // usually is (its median over the last minute: two carriers beating, or a fade, raise it for a moment), against how far the station's
  // pulses usually stand over it (the power where its averaged pulse peaks, its median over the last minute's seconds but the marks':
  // the marks are sent as strongly as the pulses)
  rec.mk = [0, 1, 2].map((t) => wwvMean(p.y[t], T + ms(100), T + ms(700), 12));
  rec.tick = [0, 1].map((st) =>
  {
    const S = W.stations[st];
    return S.delta == null ? 0 : p.y[st][Math.round(T + S.delta + (S.profZ >= WWV_PROFILE_Z ? S.profErr : 0)) & WWV_MASK];
  });
  // (The pulses' power only from seconds the station was heard steadily in, WWV_MARK_PULSES of them at least: else none, no mark. A
  // score far over 1 is something else (the pulses' power not yet known well), not a mark)
  const usual = [0, 1, 2].map((t) => (recent.length ? wwvMedian(recent.map((r) => r.mk[t])) : rec.mk[t]));
  const pulse = [0, 1].map((st) =>
  {
    const plain = recent.filter((r) => r.mark < 0.3 && r.heardSt && r.heardSt[st]);
    return plain.length >= WWV_MARK_PULSES ? wwvMedian(plain.map((r) => r.tick[st])) : 0;
  });
  const scores = [0, 1, 2].map((t) =>
  {
    const top = t < 2 ? pulse[t] : Math.max(...pulse);
    const floor = t < 2 ? usual[t] : Math.min(usual[0], usual[1]);
    const score = top > 1.3 * floor && top > 0 ? (rec.mk[t] - usual[t]) / (top - floor) : 0;
    return score > WWV_MARK_MAX ? 0 : score;
  });
  rec.mark = Math.max(...scores);
  rec.hour = scores[2] > 0.3 && scores[2] >= Math.max(scores[0], scores[1]);
  // Each station's averaged pulse (not from its own minute or hour mark's second: its tone holding on after the pulse's place): how far
  // it stands out, and where its peak is against where it should be
  for (let st = 0; st < 2; st++)
  {
    const S = W.stations[st], g = rec.segs[st];
    if (!g || rec.ticks[st].plateau >= WWV_PLATEAU) continue;
    if (!S.prof) S.prof = new Float32Array(g.seg.length);
    if (!S.cross) S.cross = new Float32Array(g.seg.length);
    S.profCount = (S.profCount || 0) + 1;
    const share = Math.max(WWV_PROFILE_SHARE, 1 / S.profCount);
    for (let k = 0; k < g.seg.length; k++)
    {
      S.prof[k] += share * (g.seg[k] - S.prof[k]);
      S.cross[k] += share * (g.cross[k] - S.cross[k]);
    }
    const peak = wwvProfilePeak(S.prof, wwvMask(st), S.cross);
    S.profZ = S.profCount >= 10 ? peak.z : 0;
    S.profErr = peak.at - WWV_SEARCH + (g.base - (T + S.delta));
    S.strength = Math.max(0, S.prof[Math.round(peak.at)] - wwvMedian(S.prof));
  }
  // The code's level in the second's four parts
  rec.sA = wwvMean(p.env, T + ms(50), T + ms(180), 6);
  rec.sB = wwvMean(p.env, T + ms(230), T + ms(470), 6);
  rec.sC = wwvMean(p.env, T + ms(530), T + ms(770), 6);
  rec.sD = wwvMean(p.env, T + ms(830), T + ms(980), 6);
  W.records.push(rec);
  if (W.records.length > WWV_KEEP) W.records.shift();
  // The seconds counted on: corrected by the anchor station's averaged pulse's error when it's heard (a fifth of it: it's an average
  // already), else by where its fold says its pulses are (the fold stands out at far weaker signals than the averaged pulse). The other
  // station, heard too, keeps its place against the anchor by its averaged pulse (not by single pulses: the anchor's own pulse showing
  // through its filter would pull it there)
  let err = null;
  const A = anchor == null ? null : W.stations[anchor];
  const anchorHeard = anchor != null && wwvHeard(anchor);
  if (A && A.delta != null)
  {
    err = anchorHeard ? A.profErr : wwvWrap(p.phase[anchor] - (T + A.delta));
    const o = W.stations[1 - anchor];
    if (anchorHeard && wwvHeard(1 - anchor)) o.delta += 0.2 * (o.profErr - A.profErr);
  }
  // (Its fold far from the count, as after audio lost for a moment, a stretch of a second gone: the seconds no longer line up with the
  // ones counted, so the count starts again from scratch, from the fold, at the end of this second)
  let restart = false;
  if (err != null)
  {
    if (Math.abs(err) < WWV_SEARCH)
    {
      C.refTicks.push([C.j, T + err]);
      if (C.refTicks.length > 120) C.refTicks.shift();
      C.T = T + 0.2 * err;
    }
    else restart = true;
  }
  // Lost: no station heard, and the fold's pulses not where the count has them (or no fold either), for WWV_LOST_S seconds running; or no
  // station heard for WWV_UNHEARD_S: counted again from scratch (from the fold, at once if it still stands out)
  // (Each station heard this second, steadily: its averaged pulse standing out, the count's correction small. Only those seconds of it
  // time the PC clock: wwvTiming)
  rec.heardSt = [0, 1].map((st) => wwvHeard(st) && err != null && Math.abs(err) < WWV_SEARCH_NEAR);
  const heardNow = wwvHeard(0) || wwvHeard(1);
  C.unheard = heardNow ? 0 : (C.unheard || 0) + 1;
  if (heardNow) C.heardJ = C.j;
  C.lost = heardNow || (err != null && Math.abs(err) < WWV_SEARCH) ? 0 : (C.lost || 0) + 1;
  // The rate the pulses come at (samples a second), from the last two minutes' of them
  if (C.refTicks.length >= 20)
  {
    const L = C.refTicks;
    const mj = L.reduce((s, x) => s + x[0], 0) / L.length, mt = L.reduce((s, x) => s + x[1], 0) / L.length;
    let sjj = 0, sjt = 0;
    for (const [j, t] of L)
    {
      sjj += (j - mj) * (j - mj);
      sjt += (j - mj) * (t - mt);
    }
    if (sjj > 0) C.period = W.lastPeriod = Math.max(WWV_RATE * 0.999, Math.min(WWV_RATE * 1.001, sjt / sjj));
  }
  wwvAlign();
  const sec = W.align ? ((((C.j - W.align.h) % 60) + 60) % 60) : null;
  rec.sec = sec;
  if (sec == 59) wwvMinute();
  wwvStatus(rec);
  C.j++;
  C.T += C.period;
  if (restart || C.lost >= WWV_LOST_S || C.unheard >= WWV_UNHEARD_S) wwvClockReset();
}

// A station's averaged pulse and single pulses started over (its place moved: what it had is of the old place)
function wwvProfileReset(S)
{
  S.prof = null;
  S.cross = null;
  S.profCount = 0;
  S.profZ = 0;
  S.profErr = 0;
  S.strength = 0;
  S.measured = 0;
  S.snrs = [];
}

// The station the count follows: the one it follows already while that's heard (so the count doesn't hop the 10 ms or so between the
// two stations' pulses), else the heard one whose averaged pulse stands out most, else the one whose fold does (locked), else none
function wwvAnchor(p)
{
  const C = W.clock;
  if (C && C.anchor != null && wwvHeard(C.anchor)) return C.anchor;
  const heard = [0, 1].filter((st) => wwvHeard(st));
  let anchor = null;
  if (heard.length) anchor = heard.reduce((a, b) => (W.stations[b].profZ > W.stations[a].profZ ? b : a));
  else
  {
    const locked = [0, 1].filter((st) => p.lock[st] && W.stations[st].delta != null);
    if (locked.length) anchor = locked.reduce((a, b) => (p.ratio[b] > p.ratio[a] ? b : a));
  }
  if (C) C.anchor = anchor;
  return anchor;
}

// Samples from where the count is, wrapped into the half second either side
function wwvWrap(d)
{
  return (((d % WWV_RATE) + WWV_RATE * 1.5) % WWV_RATE) - WWV_RATE / 2;
}

// A station heard: its averaged pulse stands out, where its fold (its pulses over the whole second) has them when that stands out too
// (anything else that comes at the same place each second, near where the pulses were, isn't them), and isn't the other's showing
// through its filter (WWV_LEAK_NEAR)
function wwvHeard(st)
{
  const S = W.stations[st], O = W.stations[1 - st];
  if (S.delta == null || S.profZ < WWV_PROFILE_Z) return false;
  const p = W.paths[W.chosen];
  if (W.clock && p.lock[st] && Math.abs(wwvWrap(p.phase[st] - (W.clock.T + S.delta + S.profErr))) > WWV_SEARCH_NEAR) return false;
  if (O.delta == null || O.profZ < WWV_PROFILE_Z) return true;
  const near = Math.abs(S.delta + S.profErr - (O.delta + O.profErr)) < WWV_LEAK_NEAR;
  return !(near && S.strength < WWV_LEAK_SHARE * O.strength);
}

// The code's usual high (the second's first part) and low (its last), over the last WWV_LEVELS seconds; and how clearly they differ
function wwvLevels()
{
  const R = W.records.slice(-WWV_LEVELS);
  const hi = wwvMedian(R.map((r) => r.sA)), lo = wwvMedian(R.map((r) => r.sD));
  const dev = wwvMedian(R.map((r) => Math.abs(r.sD - lo))) * 1.4826 + 1e-12;
  return { hi, lo, snr: (hi - lo) / dev };
}

// A second's code as shares of high over low: q1 (to 180 ms: high but in the hole), q2 (to 470 ms: a 1 or a marker), q3 (to 770 ms: a
// marker)
function wwvQ(rec, L)
{
  const d = L.hi - L.lo || 1e-12;
  const clip = (v) => Math.max(-0.5, Math.min(1.5, v));
  return { q1: clip((rec.sA - L.lo) / d), q2: clip((rec.sB - L.lo) / d), q3: clip((rec.sC - L.lo) / d) };
}

// Second 0: each place in the count scored over the seconds kept, the minute (and hour) marks at it and nowhere else, and (the code
// clear enough) the hole at it and the markers 9, 19 ... 59 seconds on
function wwvAlign()
{
  const R = W.records;
  // With a grid (a minute read and confirmed earlier, by its sample, wwvMinute): second 0 is where its seconds say, when the newest
  // second falls on one of them within WWV_GRID_MS: at once, through a restart of the count too
  // (Unless the marks and the code, scored as below, clearly say another place: the audio lost a whole second or so, and the grid is let
  // go)
  const G = W.grid, r = R[R.length - 1];
  let gridH = null;
  if (G && r)
  {
    const secs = (r.T - G.n0) / G.period;
    const whole = Math.round(secs);
    if (Math.abs(secs - whole) * 1000 < WWV_GRID_MS && whole <= WWV_GRID_HOURS * 3600) gridH = (((r.j - whole) % 60) + 60) % 60;
  }
  if (R.length < WWV_ALIGN_MIN)
  {
    if (gridH != null && (!W.align || W.align.h != gridH)) W.align = { h: gridH, margin: 0, grid: true };
    return;
  }
  const L = wwvLevels();
  const code = L.snr > 3;
  const scores = new Float64Array(60);
  for (const r of R)
  {
    const mark = Math.max(0, Math.min(1.5, r.mark));
    const q = code ? wwvQ(r, L) : null;
    for (let h = 0; h < 60; h++)
    {
      const sec = (((r.j - h) % 60) + 60) % 60;
      let s = sec == 0 ? 3 * mark : -mark;
      if (q)
      {
        if (sec == 0) s += 1.5 * (0.5 - q.q1);
        else if (WWV_MARKERS.includes(sec)) s += 2 * (q.q3 - 0.5);
        else s += 0.7 * (0.5 - q.q3);
      }
      scores[h] += s;
    }
  }
  let best = 0;
  for (let h = 1; h < 60; h++) if (scores[h] > scores[best]) best = h;
  let next = -Infinity;
  for (let h = 0; h < 60; h++) if (h != best && scores[h] > next) next = scores[h];
  const margin = scores[best] - next;
  if (gridH != null)
  {
    // The grid's place, unless the scores say another clearly
    if (best != gridH && scores[best] - scores[gridH] >= WWV_ALIGN_SWITCH)
    {
      W.grid = null;
      W.align = { h: best, margin: margin };
    }
    else if (!W.align || W.align.h != gridH) W.align = { h: gridH, margin: margin, grid: true };
    return;
  }
  if (!W.align)
  {
    if (margin >= WWV_ALIGN_MARGIN) W.align = { h: best, margin: margin };
  }
  else if (best != W.align.h)
  {
    if (scores[best] - scores[W.align.h] >= WWV_ALIGN_SWITCH) W.align = { h: best, margin: margin };
  }
  else W.align.margin = margin;
}

// The bits of a minute's frame, as its time and flags give them (to compare a minute read with the one expected)
function wwvBits(f)
{
  const b = new Array(60).fill(0);
  const put = (value, at) => at.forEach((s, i) => (b[s] = (value >> i) & 1));
  b[2] = f.dst1;
  b[3] = f.lsw;
  put(f.year % 10, [4, 5, 6, 7]);
  put(f.minute % 10, [10, 11, 12, 13]);
  put(Math.floor(f.minute / 10), [15, 16, 17]);
  put(f.hour % 10, [20, 21, 22, 23]);
  put(Math.floor(f.hour / 10), [25, 26]);
  put(f.doy % 10, [30, 31, 32, 33]);
  put(Math.floor(f.doy / 10) % 10, [35, 36, 37, 38]);
  put(Math.floor(f.doy / 100), [40, 41]);
  b[50] = f.dut1 >= 0 ? 1 : 0;
  put(Math.floor(f.year / 10), [51, 52, 53, 54]);
  b[55] = f.dst2;
  put(Math.round(Math.abs(f.dut1) * 10), [56, 57, 58]);
  return b;
}

// A frame's fields from its bits; valid when every digit is in range and the day is in its year
function wwvFields(b)
{
  const v = (at) => at.reduce((s, sec, i) => s + (b[sec] << i), 0);
  const f = {
    dst1: b[2], lsw: b[3],
    year: v([4, 5, 6, 7]) + 10 * v([51, 52, 53, 54]),
    minute: v([10, 11, 12, 13]) + 10 * v([15, 16, 17]),
    hour: v([20, 21, 22, 23]) + 10 * v([25, 26]),
    doy: v([30, 31, 32, 33]) + 10 * v([35, 36, 37, 38]) + 100 * v([40, 41]),
    dut1: (b[50] ? 1 : -1) * v([56, 57, 58]) / 10,
    dst2: b[55]
  };
  if (f.dut1 == 0) f.dut1 = 0;
  const year = 2000 + f.year;
  const days = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 ? 366 : 365;
  f.valid = v([10, 11, 12, 13]) <= 9 && f.minute <= 59 && v([20, 21, 22, 23]) <= 9 && f.hour <= 23 && v([30, 31, 32, 33]) <= 9 && v([35, 36, 37, 38]) <= 9 &&
    f.doy >= 1 && f.doy <= days && v([4, 5, 6, 7]) <= 9 && v([51, 52, 53, 54]) <= 9;
  f.minuteStart = Date.UTC(year, 0, 1) + (f.doy - 1) * 86400000 + f.hour * 3600000 + f.minute * 60000;
  return f;
}

// The minute after a frame (its flags kept)
function wwvNextFields(f, minutes = 1)
{
  const t = f.minuteStart + minutes * 60000;
  const d = new Date(t);
  const year = d.getUTCFullYear();
  return Object.assign({}, f, { year: year % 100, doy: Math.floor((t - Date.UTC(year, 0, 1)) / 86400000) + 1, hour: d.getUTCHours(), minute: d.getUTCMinutes(), minuteStart: t, valid: true });
}

// A frame with another's flags (WWV_FLAGS) when theirs differ: the time code's flags not yet read alike twice running
function wwvFlagsFrom(f, from)
{
  return WWV_FLAGS.every((k) => from[k] == f[k]) ? f : Object.assign({}, f, ...WWV_FLAGS.map((k) => ({ [k]: from[k] })));
}

// Second 59 done: the minute's 60 seconds read into a frame, checked, taken (or the minute after the last taken, when it's too garbled to
// read but mostly agrees), then each station's pulses in it timed against the PC clock
function wwvMinute()
{
  const R = W.records;
  if (R.length < 60) return;
  const recs = R.slice(-60);
  // (Each second's place in the minute as second 0 is found now)
  recs.forEach((r, s) => (r.sec = s));
  const L = wwvLevels();
  const code = L.snr > 3;
  const q = recs.map((r) => wwvQ(r, L));
  const bits = q.map((x) => (x.q2 >= 0.5 ? 1 : 0));
  const markers = WWV_MARKERS.filter((s) => q[s].q3 >= 0.5).length;
  const falseMarkers = q.filter((x, s) => s != 0 && !WWV_MARKERS.includes(s) && x.q3 >= 0.5).length;
  const zeros = WWV_ZERO_BITS.filter((s) => bits[s] == 0).length;
  const weak = q.filter((x, s) => !WWV_MARKERS.includes(s) && s != 0 && Math.abs(x.q2 - 0.5) < 0.15).length;
  const f = wwvFields(bits);
  const shaped = code && markers >= 5 && falseMarkers <= 2 && zeros >= WWV_ZERO_BITS.length - 2 && q[0].q1 < 0.5;
  const j0 = recs[0].j;
  const last = W.frames.length ? W.frames[W.frames.length - 1] : null;
  // The minute expected: by the grid (the last minute read and confirmed, by its sample: kept through a restart of the count) when this
  // minute's second 0 falls on one of the grid's minutes, within WWV_GRID_MS; else the one after the last taken, as many minutes on as
  // the count has gone since. Counted on (flywheel) only from a minute read and confirmed, within the last hour (the grid's, the last
  // WWV_GRID_HOURS). Second 0 off the grid's minutes: this minute isn't taken at all (the count's second 0 is wrong)
  const G = W.grid;
  let predicted = null, counted = false, offGrid = false;
  if (G)
  {
    const secs = (recs[0].T - G.n0) / G.period;
    const whole = Math.round(secs);
    if (Math.abs(secs - whole) * 1000 < WWV_GRID_MS && whole % 60 == 0 && whole > 0 && whole <= WWV_GRID_HOURS * 3600)
    {
      predicted = wwvNextFields(G.fields, whole / 60);
      counted = true;
    }
    else if (Math.abs(secs - whole) * 1000 < WWV_GRID_MS && whole % 60 != 0) offGrid = true;
  }
  if (!predicted && last)
  {
    const minutes = Math.round((j0 - last.j0) / 60);
    if (minutes >= 1) predicted = wwvNextFields(last.fields, minutes);
    counted = !!predicted && last.confirmed && W.lastReadJ0 != null && j0 - W.lastReadJ0 <= 3600;
  }
  let taken = null, mode = null, confirmed = false;
  if (offGrid)
  {
    // (Nothing taken. Read cleanly off the grid twice running: the grid is let go, as after a leap second, and minutes are taken as
    // without one)
    W.offGrid = shaped && f.valid ? (W.offGrid || 0) + 1 : 0;
    if (W.offGrid >= 2)
    {
      W.grid = null;
      W.offGrid = 0;
    }
  }
  else if (shaped && f.valid && G && predicted && counted && f.minuteStart == predicted.minuteStart)
  {
    // The minute the grid says. Its flags as read only when they're the grid's or the minute before read them alike: DUT1, DST and the
    // leap second warning change rarely (at 0000 UTC), so one bit misread isn't shown as a change; else the grid's
    const lr = W.lastRead;
    const twice = lr && lr.minuteStart == f.minuteStart - 60000 && WWV_FLAGS.every((k) => lr.f[k] == f[k]);
    taken = twice ? f : wwvFlagsFrom(f, predicted);
    mode = "code";
    confirmed = true;
  }
  else if (shaped && f.valid && G && counted)
  {
    // Read "cleanly" as another minute than the grid's: not taken; the grid's, counted on
    taken = predicted;
    mode = "flywheel";
    confirmed = true;
  }
  else if (shaped && f.valid)
  {
    const fromCandidate = W.candidate ? wwvNextFields(W.candidate.fields, Math.round((j0 - W.candidate.j0) / 60)) : null;
    const before = predicted && predicted.minuteStart == f.minuteStart ? predicted : fromCandidate && fromCandidate.minuteStart == f.minuteStart ? fromCandidate : null;
    if (before)
    {
      // The minute after one read before: both confirmed, by their time (the flags of the one before, when they differ: which of the
      // two was misread can't be told, and the grid's rule then takes a change only once two minutes running read it)
      taken = wwvFlagsFrom(f, before);
      mode = "code";
      confirmed = true;
    }
    else
    {
      // Read cleanly, but not the minute expected: taken once the next minute confirms it; meanwhile the one counted on, if it
      // mostly agrees, else this one, not confirmed
      W.candidate = { fields: f, j0: j0 };
      if (counted && wwvDiffer(bits, predicted) <= WWV_FLYWHEEL_BITS)
      {
        taken = predicted;
        mode = "flywheel";
        confirmed = true;
      }
      else
      {
        taken = f;
        mode = "unconfirmed";
      }
    }
  }
  else if (counted)
  {
    // Too garbled to read: the minute counted on from the last one read
    taken = predicted;
    mode = "flywheel";
    confirmed = true;
  }
  if (shaped && f.valid) W.lastRead = { minuteStart: f.minuteStart, f: f };
  if (taken)
  {
    if (mode == "code")
    {
      W.candidate = null;
      W.lastReadJ0 = j0;
      // The grid from here on
      W.grid = { fields: taken, n0: recs[0].T, period: W.clock.period };
    }
    W.frames.push({ fields: taken, mode: mode, j0: j0, confirmed: confirmed });
    if (W.frames.length > 10) W.frames.shift();
  }
  // (An unconfirmed reading's date isn't given unless it's within WWV_SHOW_UNCONFIRMED_MS of the PC clock: a misread one can be any date)
  const wall = wwvWallAt(recs[0].T);
  const shown = taken && (mode != "unconfirmed" || (wall != null && Math.abs(taken.minuteStart - wall) < WWV_SHOW_UNCONFIRMED_MS));
  wwvOut({
    type: "frame", read: shaped && f.valid, mode: mode, markers: markers, weak: weak, codeSnr: L.snr,
    fields: shown ? { minuteStart: taken.minuteStart, year: 2000 + taken.year, doy: taken.doy, hour: taken.hour, minute: taken.minute, dut1: taken.dut1, lsw: taken.lsw, dst1: taken.dst1, dst2: taken.dst2 } : null
  });
  // (Timed by its minute only when that's confirmed: a reading not yet confirmed may be another minute, so its pulses are timed to the
  // nearest second, and said to be: with the PC clock 0.5 s or more off, that's another second)
  wwvTiming(recs, confirmed ? taken.minuteStart : null, confirmed ? mode : "nearest");
}

// How many of the frame's data bits differ from a frame's
function wwvDiffer(bits, f)
{
  const want = wwvBits(f);
  let n = 0;
  for (let s = 1; s < 59; s++) if (!WWV_MARKERS.includes(s) && bits[s] != want[s]) n++;
  return n;
}

// Each station's pulses of the minute, from seconds 17 to 58, against the PC clock: the PC clock's time of the pulse's start less the
// second it is (the minute's start from its frame, else the nearest whole second to the PC clock's time). The median of the pulses that
// stood out on their own, with WWV_PROFILE_TICKS of them; else the minute's pulses summed, their sum's peak (when it stands out), its
// uncertainty half the difference between the even seconds' sum's and the odd's. sigma: the minute's own uncertainty (ms). A minute
// the PC clock was set in isn't timed
function wwvTiming(recs, minuteStart, mode)
{
  if (!W.wallFit || recs[0].T <= W.stepAt) return;
  // (A minute the count wasn't steady through, a station heard steadily in WWV_STEADY_SECONDS_MIN of its seconds at least, isn't timed)
  if (recs.filter((r) => r.heardSt && (r.heardSt[0] || r.heardSt[1])).length < WWV_STEADY_SECONDS_MIN) return;
  const stations = [];
  // (Samples a second by the PC clock's line through the chunks, not by the pulses: the pulses are what's being checked)
  const P = WWV_RATE / (1 + (W.wallFit.b * WWV_RATE) / 1000);
  const second = (r, wall) => (minuteStart != null ? minuteStart + r.sec * 1000 : Math.round(wall / 1000) * 1000);
  for (let st = 0; st < 2; st++)
  {
    // (Only the seconds it was heard steadily in, singly or summed: a station not heard, or the count just moved, may have its pulse
    // placed wrong)
    const heard = wwvHeard(st);
    if (W.stations[st].delta == null) continue;
    // (pos: where its pulse is, as the sample its second 0 would have it at)
    const offs = [], snrs = [], pos = [];
    for (const r of recs)
    {
      const tick = r.ticks[st];
      if (!tick || !tick.ok || !WWV_TIMING(r.sec) || !(r.heardSt && r.heardSt[st])) continue;
      const wall = wwvWallAt(tick.t);
      if (wall == null) continue;
      offs.push(wall - second(r, wall));
      snrs.push(tick.snr);
      pos.push(tick.t - r.sec * P);
    }
    const name = WWV_STATIONS[st].name;
    if (heard && offs.length >= WWV_PROFILE_TICKS)
    {
      const median = wwvMedian(offs);
      const mad = wwvMedian(offs.map((o) => Math.abs(o - median))) * 1.4826;
      // (Pulses that far apart within a minute aren't one station's at one place)
      if (mad > WWV_MAD_MAX) continue;
      stations.push({ st: st, name: name, n: offs.length, median: median, mad: mad, sigma: (1.2533 * mad) / Math.sqrt(offs.length), snr: 10 * Math.log10(wwvMedian(snrs)), summed: false, pos: wwvMedian(pos) });
      continue;
    }
    // The pulses summed
    const width = 2 * WWV_SEARCH + 1;
    const sums = [new Float64Array(width), new Float64Array(width), new Float64Array(width)], cross = new Float64Array(width);
    let n = 0, at0 = 0, pos0 = 0;
    for (const r of recs)
    {
      const g = r.segs[st];
      if (!g || !WWV_TIMING(r.sec) || !(r.heardSt && r.heardSt[st])) continue;
      const wall = wwvWallAt(g.base - WWV_SEARCH);
      if (wall == null) continue;
      at0 += wall - second(r, wall);
      pos0 += g.base - WWV_SEARCH - r.sec * P;
      for (let k = 0; k < width; k++)
      {
        sums[0][k] += g.seg[k];
        sums[1 + (r.sec & 1)][k] += g.seg[k];
        cross[k] += g.cross[k];
      }
      n++;
    }
    if (n < WWV_TIMED_MIN) continue;
    const mask = wwvMask(st);
    const all = wwvProfilePeak(sums[0], mask, cross);
    if (all.z < WWV_PROFILE_Z) continue;
    const even = wwvProfilePeak(sums[1], mask), odd = wwvProfilePeak(sums[2], mask);
    const sigma = Math.max(0.1, (Math.abs(even.at - odd.at) / 2) * (1000 / WWV_RATE));
    const peak = sums[0][Math.round(all.at)] / n;
    stations.push({ st: st, name: name, n: n, median: at0 / n + (all.at * 1000) / WWV_RATE, mad: sigma * Math.sqrt(n), sigma: sigma, snr: 10 * Math.log10(Math.max(1e-3, peak - 1)), summed: true, pos: pos0 / n + all.at });
  }
  // Both, a few ms apart and one much the weaker: that one is the other showing through its filter (WWV_LEAK_NEAR)
  if (stations.length == 2 && Math.abs(stations[0].median - stations[1].median) < (WWV_LEAK_NEAR * 1000) / WWV_RATE)
  {
    const weak = stations[0].snr < stations[1].snr ? 0 : 1;
    if (stations[weak].snr < stations[1 - weak].snr + 10 * Math.log10(WWV_LEAK_SHARE)) stations.splice(weak, 1);
  }
  // Both timed: their difference against the last minutes' (WWV_PAIR_MS)
  if (stations.length == 2)
  {
    const diff = stations[1].median - stations[0].median;
    const was = W.pairDiffs.length >= 2 ? wwvMedian(W.pairDiffs) : null;
    if (was != null && Math.abs(diff - was) > WWV_PAIR_MS) stations.splice(stations[0].snr < stations[1].snr ? 0 : 1, 1);
    else
    {
      W.pairDiffs.push(diff);
      if (W.pairDiffs.length > 10) W.pairDiffs.shift();
    }
  }
  if (!stations.length) return;
  // Each station's pulse against where it was at the last minute it was timed, by the samples between (through restarts of the count
  // too): moved, the audio's own delay changed (WWV_DELAY_STEP_MS: the stations' pulses don't move). Not across a step of the PC clock's
  // line (the PC clock set, or samples lost: their pulses move with it, and which it was can't be told). Only when its offset moved as
  // much too (moved in the samples alone, the PC clock's line moved with it: the offset isn't touched) and every station compared moved
  // alike: one station's weak pulses can move its alone
  const steps = [];
  for (const s of stations)
  {
    const ref = W.posRef[s.st];
    if (ref && ref.stepAt == W.stepAt && (recs[0].T - ref.T) / P <= WWV_DELAY_AGE_S)
    {
      const d = s.pos - ref.pos;
      steps.push({ s: s, step: ((d - Math.round(d / P) * P) * 1000) / WWV_RATE, moved: s.median - ref.median });
    }
    W.posRef[s.st] = { pos: s.pos, median: s.median, T: recs[0].T, stepAt: W.stepAt };
  }
  const real = (x) => Math.abs(x.step) > WWV_DELAY_STEP_MS && Math.abs(x.moved - x.step) < WWV_DELAY_AGREE_MS;
  if (steps.length && steps.every(real) && (steps.length == 1 || Math.abs(steps[0].step - steps[1].step) < WWV_DELAY_AGREE_MS))
  {
    for (const x of steps) x.s.delayStepMs = Math.round(x.step * 10) / 10;
  }
  for (const s of stations)
  {
    delete s.pos;
    delete s.st;
  }
  const startWall = wwvWallAt(recs[0].T);
  wwvOut({ type: "minute", minuteStart: minuteStart != null ? minuteStart : Math.round(startWall / 60000) * 60000, mode: mode, stations: stations });
}

// A chunk's PC clock time (of its last sample, n): kept, the line through the last two minutes' fitted again; one far off the line three
// times running is the PC clock set (the line starts again from it)
function wwvWall(n, wall)
{
  const y = wall - (n * 1000) / WWV_RATE;
  if (W.wallFit && Math.abs(y - (W.wallFit.a + W.wallFit.b * (n - W.wallFit.n0))) > WWV_WALL_STEP_MS)
  {
    W.wallPending.push([n, y]);
    if (W.wallPending.length < 3) return;
    // Set: the line from the new clock's chunks on, and the minutes heard across it not timed
    W.walls = W.wallPending;
    W.stepAt = n;
    W.wallPending = [];
  }
  else
  {
    W.wallPending = [];
    W.walls.push([n, y]);
  }
  const keep = (WWV_WALL_KEEP_MS * WWV_RATE) / 1000;
  while (W.walls.length > 2 && W.walls[0][0] < n - keep) W.walls.shift();
  // The line: through the chunks within WWV_WALL_OUTLIER_MS of their median, least squares
  const med = wwvMedian(W.walls.map((p) => p[1]));
  const use = W.walls.filter((p) => Math.abs(p[1] - med) < WWV_WALL_OUTLIER_MS);
  if (!use.length) return;
  const n0 = use.reduce((s, p) => s + p[0], 0) / use.length;
  const a = use.reduce((s, p) => s + p[1], 0) / use.length;
  let sxx = 0, sxy = 0;
  for (const [x, v] of use)
  {
    sxx += (x - n0) * (x - n0);
    sxy += (x - n0) * (v - a);
  }
  // (Under 20 s of chunks: the sound card's clock against the PC's not yet worth a slope)
  const span = use[use.length - 1][0] - use[0][0];
  const b = sxx > 0 && span > 20 * WWV_RATE ? sxy / sxx : 0;
  // (A sound card's clock off by up to 500 ppm: ms a sample)
  const most = (500e-6 * 1000) / WWV_RATE;
  W.wallFit = { n0: n0, a: a, b: Math.max(-most, Math.min(most, b)) };
}

// The PC clock's time (ms) of a sample
function wwvWallAt(t)
{
  const F = W.wallFit;
  if (!F) return null;
  return (t * 1000) / WWV_RATE + F.a + F.b * (t - F.n0);
}

// What's heard: the way read, the carrier, each station's pulses (heard, how clearly, how loud), the second counted and the time it is
// by the last minute taken: only while a station has been heard within WWV_SHOWN_S (lost, the count isn't a clock to show). diag: the
// count's state as it is, for a recording made alongside to be checked against offline (nothing in the window shows it)
function wwvStatus(rec)
{
  const p = W.paths[W.chosen];
  const C = W.clock;
  const last = W.frames.length ? W.frames[W.frames.length - 1] : null;
  const lost = !!C && (C.heardJ == null || C.j - C.heardJ >= WWV_SHOWN_S);
  let utc = null;
  if (rec && rec.sec != null && last && !lost)
  {
    const minutes = Math.round((rec.j - rec.sec - last.j0) / 60);
    if (minutes >= 0 && minutes <= 10) utc = last.fields.minuteStart + minutes * 60000 + rec.sec * 1000;
    // (Not an unconfirmed reading's time far from the PC clock's: WWV_SHOW_UNCONFIRMED_MS)
    const wall = wwvWallAt(rec.T);
    if (utc != null && !last.confirmed && (wall == null || Math.abs(utc - wall) >= WWV_SHOW_UNCONFIRMED_MS)) utc = null;
  }
  const L = W.records.length >= 10 ? wwvLevels() : null;
  wwvOut({
    type: "status",
    path: p.name,
    carrier: W.carrier,
    counting: !!C,
    lost: lost,
    aligned: !!W.align,
    sec: rec ? rec.sec : null,
    utc: utc,
    codeSnr: L ? L.snr : 0,
    stations: WWV_STATIONS.map((s, i) =>
    {
      const S = W.stations[i];
      // (Before the seconds are counted, its fold's lock; then its averaged pulse, not the other's showing through. Its dB: its pulses
      // that stood out on their own, else its averaged pulse's)
      const heard = C ? wwvHeard(i) : p.lock[i];
      const snr = !heard ? null : S.snrs.length >= 10 ? 10 * Math.log10(wwvMedian(S.snrs)) : S.strength > 0 ? 10 * Math.log10(S.strength) : null;
      return { name: s.name, tone: s.tone, locked: heard, ratio: p.ratio[i], snr: snr, heard: !!(rec && rec.ticks[i] && rec.ticks[i].ok), delayMs: S.delta != null ? (S.delta * 1000) / WWV_RATE : null };
    }),
    diag: {
      n: W.n, chosen: W.chosen, steady: W.steady, carrier: W.carrier,
      fold: [0, 1].map((i) => ({ z: Math.round(p.ratio[i] * 10) / 10, lock: p.lock[i], phase: Math.round(p.phase[i]) })),
      clock: C ? { j: C.j, T: Math.round(C.T * 10) / 10, period: Math.round(C.period * 1000) / 1000, unheard: C.unheard, lost: C.lost, heardJ: C.heardJ } : null,
      align: W.align ? { h: W.align.h, margin: Math.round(W.align.margin * 10) / 10 } : null,
      stations: W.stations.map((S) => ({ delta: S.delta == null ? null : Math.round(S.delta * 10) / 10, profZ: Math.round(S.profZ * 10) / 10, profErr: Math.round(S.profErr * 10) / 10, strength: Math.round(S.strength * 10) / 10, measured: S.measured })),
      wall: W.wallFit ? { a: Math.round(W.wallFit.a * 100) / 100, b: W.wallFit.b, n0: Math.round(W.wallFit.n0), pending: W.wallPending.length, stepAt: W.stepAt } : null
    }
  });
}
