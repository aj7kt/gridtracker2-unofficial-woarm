// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The FT8 / FT4 plugin (plugin.json beside this file): one plugin, two modes. ft8_lib (ft8.wasm, built from src/wasm/ft8 by
// tools/build_ft8_wasm.js, in its worker ft8Worker.js) decodes each period of the 12 kHz audio (the worklet's stream, input "audio12")
// once it has been heard: FT8's 15 s periods, FT4's 7.5 s (FT4 decoded the Normal way only). Its messages listed, the newest period on
// top, and sent on to GridTracker2 as WSJT-X's Decodes are (host.instanceDecodes: the map, alerts, the Call Roster with that mode's
// Send Decodes To Call Roster on). Listened to with the window closed too, as every mode is. Also:
//   the focus (focusHalf): a place on the waterfall searched harder (Deep's in FT8, and FT4's), put by the left button or a click on a row
//   the time skew (skew: the core's): a station whose clock is off decoded on its own timing (skewAlign)
//   Slot Finder (its box on the second line): the clearest places to transmit, from the waterfall's rows (fallRow) and the decodes
//   the decoded signals' marks on the scale (drawScale), and Detect Modes' FT8 and FT4 decoders (detect, detectAudio)

// The 12 kHz audio kept this long (s), each period decoded once this much past its end (ms: the last chunk in), the audio searched (Hz,
// as WSJT-X's default), and at most this many lines kept
const FT8_KEEP_S = 40;
const FT8_PERIOD_MS = 15000;
const FT4_PERIOD_MS = 7500;
const FT8_LATE_MS = 500;
const FT8_AUDIO = [100, 4000];
const FT8_ROWS_MAX = 5000;
const FT8_PASSES = 3;
// FT4's decode, as it is the Normal way only, is given this long at most (ms)
const FT4_BUDGET_MS = 4000;
// Each period is first decoded early, this far into it (ms), as WSJT-X does: most messages are all there by then, and they are shown
// about 3 s sooner. Decoded again at its end, only the messages new then are added (late starters, and weak ones under those found)
const FT8_EARLY_MS = 11800;
// The time a decode may take: the early decode until this far into its period (ms), the full one this long; the candidates left when it
// runs out are the weakest (they are tried strongest first)
const FT8_EARLY_DEADLINE_MS = 14500;
const FT8_FULL_BUDGET_MS = 8000;
// FT8 sends start half a second into the period, which WSJT-X's DT counts from (s)
const FT8_DT_ZERO = 0.5;
// The focus: 50 Hz wide, centered where it was put (any frequency); the signals whose middle is in it are searched harder (ft8wasm.c)
const FTX_FOCUS_HALF = 25;
// The known signals' marks on the scale: those decoded in the last two periods (both sides of a QSO)
const FTX_MARK_PERIODS = 2;
// Slot Finder: the clearest place to transmit, from what was heard in the last this many periods of each (even and odd) and the one under
// way, between [ and ] (the user's own range), with this much clear either side of it (Hz)
const FTX_SLOT_PERIODS = 2;
const FTX_SLOT_GUARD_HZ = 4;
// A waterfall bin is busy in a period when it was this far over its noise floor (dB; a row's byte is 5 dB under the floor at 0, 40 dB
// over at 255) in this share of the period's rows or more; the period under way counts once this far into it (ms)
const FTX_SLOT_BUSY_LEVEL = Math.round(((6 + 5) * 255) / 45);
const FTX_SLOT_BUSY_SHARE = 0.2;
const FTX_SLOT_UNDER_WAY_MS = 2000;
// The list scrolls virtually, as the rosters do: only the lines in view, and this many either side, are in the page
const FT8_VIRTUAL_BUFFER = 20;
// Detect Modes' own decoders (each period decoded the Normal way as it ends): each mode's period (ms), and its spec for the core (its
// label colour, how near two finds are the same signal, its rank, its signal's width: a station found in the middle of its tones; a
// decode checked by its CRC is that mode, so it reads best wherever it overlaps another)
const FTX_DETECT_PERIOD_MS = { ft8: FT8_PERIOD_MS, ft4: FT4_PERIOD_MS };
const FTX_DETECT = {
  ft8: { color: "#4dffc3", sameHz: 20, rank: 10, width: 50, checked: true },
  ft4: { color: "#9999ff", sameHz: 30, rank: 10, width: 250 / 3, checked: true }
};

const FTX = {
  host: null,   // the decoder's host (mmdPluginHost.js), from init
  wasm: null,   // ft8.wasm's bytes, read once
  // The mode's decoder: { worker, ring, total (samples ever), cutTotal (the rig moved there), endWall (ms: when the newest was heard),
  // next (the period to decode, ms), early (the period decoded early), decoded (the periods decoded whole lately), periodCount }
  F: null,
  // Every line, the newest first ({ start, utc, snr, dt, offTime, freq, message, how, first: the first of its period }); the slice in
  // the page, the measured heights it is laid out by, and a redraw waiting for the next frame
  lines: [],
  slice: { first: 0, last: 0 },
  rowHeight: 18,
  headerHeight: 22,
  scrollQueued: false,
  // The messages last sent on to GridTracker2, by text: the period's start (not sent again when a period is decoded again)
  sent: new Map(),
  // Slot Finder: what the waterfall heard, by period (mmdFtxSlotRow), and the places found (drawn again when they move)
  slot: null,
  slots: [],
  // Detect Modes' decoders: by mode, as F
  detect: {}
};

// FT8 or FT4 showing, and the period of the one decoded (ms)
function mmdFtxOn()
{
  const mode = FTX.host ? FTX.host.mode() : "";
  return mode == "ft8" || mode == "ft4";
}

// (a hook can come before init: the window laying itself out)
function mmdFtxFt4()
{
  return !!FTX.host && FTX.host.mode() == "ft4";
}

function mmdFtxPeriodMs()
{
  return mmdFtxFt4() ? FT4_PERIOD_MS : FT8_PERIOD_MS;
}

// A signal's width (Hz): FT8's 8 tones 6.25 Hz apart, FT4's 4 tones 20.8 Hz apart
function mmdFtxWidth()
{
  return mmdFtxFt4() ? 250 / 3 : 50;
}

// ft8.wasm in a worker (ft8Worker.js; ondata: its messages): a period's decode takes up to about half a second, which would stop the
// waterfall. Three passes: after each, the signals decoded taken out of the audio and the period searched again for the ones they
// covered; GridTracker's callsign prefixes, for the decoder to tell a real call from noise
function mmdFtxWorker(ondata)
{
  const H = FTX.host;
  if (!FTX.wasm) FTX.wasm = fs.readFileSync(H.file("ft8.wasm"));
  const worker = new Worker(H.workerUrl("ft8Worker.js"));
  worker.postMessage({ type: "init", wasm: FTX.wasm, audio: FT8_AUDIO, passes: FT8_PASSES, prefixes: H.callPrefixes() });
  const F = { worker: worker, ring: new Float32Array(FT8_KEEP_S * H.rate12), total: 0, cutTotal: 0, endWall: 0, next: 0 };
  worker.onmessage = (event) => H.guard(() => ondata(F, event.data));
  return F;
}

// The mode's decoder, once
function mmdFtxLoad()
{
  if (!FTX.F) FTX.F = mmdFtxWorker(mmdFtxDecoded);
  return FTX.F;
}

// A chunk of 12 kHz audio from the worklet: into the ring, with when its last sample was heard; then each period heard to its end is
// decoded
function mmdFtxAudio(data)
{
  const H = FTX.host;
  let F;
  try
  {
    F = mmdFtxLoad();
  }
  catch (e)
  {
    H.status(H.t("cwViewer.status.failed") + " FT8: " + e.message, true);
    return;
  }
  const endWall = H.heardAt(data);
  if (endWall == null) return;
  const n = data.samples.length;
  const size = F.ring.length;
  for (let i = 0; i < n; i++) F.ring[(F.total + i) % size] = data.samples[i];
  const periodMs = mmdFtxPeriodMs();
  // Heard from scratch: the first period to decode is the first that starts after the audio does
  if (F.total == 0)
  {
    const shift = H.skew();
    F.next = Math.ceil((endWall - (n / H.rate12) * 1000 - shift) / periodMs) * periodMs + shift;
    F.cutTotal = 0;
  }
  F.total += n;
  F.endWall = endWall;
  while (F.endWall >= F.next + periodMs + FT8_LATE_MS)
  {
    mmdFtxDecode(F, F.next, periodMs);
    F.next += periodMs;
  }
  // The early decode is Deep's (Depth Normal: each period once, when it ends)
  if (!mmdFtxPlain() && F.early != F.next && F.endWall >= F.next + FT8_EARLY_MS + FT8_LATE_MS) mmdFtxDecode(F, F.next, FT8_EARLY_MS);
}

// The FT8 Decoder's Depth (Settings) is Normal: ft8_lib as it comes (ft8wasm.c, ft8_set_plain); FT4 always is
function mmdFtxPlain()
{
  return FTX.host.get("ft8Depth") != "deep" || mmdFtxFt4();
}

// The period starting at start (ms, on a period's boundary, or skewed: host.skew) out of the ring and sent to the worker to decode, the
// first heard ms of it (FT8_EARLY_MS, or all of it). All of it after an early decode: only the messages new since then
function mmdFtxDecode(F, start, heard)
{
  const H = FTX.host;
  const first = F.total - Math.round(((F.endWall - start) / 1000) * H.rate12);
  const count = Math.round((heard / 1000) * H.rate12);
  if (first < 0 || first < F.total - F.ring.length) return;
  // A period heard partly before the rig last moved (retune) and partly after: what came before is silence here, only what the new
  // frequency gave is decoded. One heard wholly before is decoded as it was heard
  const samples = new Float32Array(count);
  const cut = first + count > (F.cutTotal || 0) ? F.cutTotal || 0 : 0;
  for (let i = 0; i < count; i++) samples[i] = first + i < cut ? 0 : F.ring[(first + i) % F.ring.length];
  const periodMs = mmdFtxPeriodMs();
  const ft4 = mmdFtxFt4();
  const more = heard == periodMs && F.early == start;
  if (heard < periodMs) F.early = start;
  // The periods decoded whole lately (not decoded again when the timing moves: mmdFtxSkewAlign)
  if (heard == periodMs) F.decoded = (F.decoded || []).concat(start).slice(-8);
  // Done by its deadline: the early decode before the period ends, the full one well before the next period's early decode
  const deadline = heard < periodMs ? start + FT8_EARLY_DEADLINE_MS : Date.now() + (ft4 ? FT4_BUDGET_MS : FT8_FULL_BUDGET_MS);
  const plain = mmdFtxPlain();
  // The focus is Deep's in FT8, and FT4's (always decoded the Normal way, with one more pass at the focus)
  const focus = !plain || ft4 ? H.bandFocus() : 0;
  F.worker.postMessage({ type: "decode", start: start, samples: samples, more: more, myCall: H.myCall(), focus: focus, shift: H.skew(), deadline: deadline, plain: plain, ft4: ft4 }, [samples.buffer]);
  // GridTracker's instance (if open) says it is decoding
  if (H.instanceMain()) H.instanceDecoding(true);
}

// A period's messages back from the worker (one line each, ft8wasm.c's ft8_decode)
function mmdFtxDecoded(F, data)
{
  const H = FTX.host;
  // (Not one to go on with: GridTracker's instance no longer decoding it, its Status says so)
  const dropped = () =>
  {
    if (H.instanceBusy()) H.instanceDecoding(false);
  };
  if (data.type == "error")
  {
    dropped();
    H.status(H.t("cwViewer.status.failed") + " FT8: " + data.message, true);
    return;
  }
  // Switched to another mode meanwhile, or from FT8 to FT4 or back (the period is the other mode's): not shown, nor sent on
  if (FTX.F != F || !mmdFtxOn() || !!data.ft4 != mmdFtxFt4())
  {
    dropped();
    return;
  }
  F.periodCount = (data.more ? F.periodCount : 0) + Math.max(0, data.count);
  const lines = data.text.split("\n").filter(Boolean).map((line) => line.split("\t"));
  // Decoded skewed (shift ms): DT from the usual timing, shown orange
  const shift = data.shift || 0;
  mmdFtxRows(data.start, lines, data.more, shift);
  // To GridTracker's instance (if open) as its Decodes, in the usual period, DT as shown (from half a second into it), then its decoding
  // done. A message sent in the last period and a half isn't sent again: a period decoded again (the time skew moved, or taken off) gives
  // what was decoded the first time once more, while a station's next transmission comes two periods on
  const periodMs = mmdFtxPeriodMs();
  const sent = FTX.sent;
  for (const [message, at] of sent) if (data.start - at > 2 * periodMs || at - data.start > 2 * periodMs) sent.delete(message);
  const fresh = lines.filter(([snr, dt, freq, message]) =>
  {
    const at = sent.get(message || "");
    if (at !== undefined && Math.abs(data.start - at) < 1.5 * periodMs) return false;
    sent.set(message || "", data.start);
    return true;
  });
  // (A period heard while a test signal played stays in the window)
  if (H.instanceMain())
  {
    if (!H.testHeard(data.start, data.start + periodMs)) H.instanceDecodes(H.mode(), data.start - shift, fresh.map(([snr, dt, freq, message]) => [Number(snr), Number(dt) - FT8_DT_ZERO + shift / 1000, Number(freq), message || ""]), mmdFtxFt4() ? "+" : "~");
    H.instanceDecoding(false);
  }
  // (Not listening any more, the mode the same: stopped meanwhile, a restart that failed)
  else dropped();
  const utc = new Date(data.start).toISOString().slice(11, 19);
  // (FT4's the same, the mode's name in it swapped)
  const status = H.t("cwViewer.ft8.status").replace("{count}", F.periodCount).replace("{utc}", utc);
  H.status(mmdFtxFt4() ? status.replace("FT8", "FT4") : status);
}

// A period's lines on top of the list (UTC, dB, DT, Freq, Message; a line above the period's first), the oldest let go past
// FT8_ROWS_MAX; more: lines new at the period's end, added under its early ones. Scrolled down the list, the view is moved down by as
// much, so the lines being read stay put. shift: decoded skewed (ms), their DT from the usual timing
function mmdFtxRows(start, lines, more, shift = 0)
{
  const utc = new Date(start).toISOString().slice(11, 19).replace(/:/g, "");
  let at = 0;
  if (more) while (at < FTX.lines.length && FTX.lines[at].utc == utc) at++;
  // DT as WSJT-X shows it: from half a second into the period
  const added = lines.map(([snr, dt, freq, message, how], index) => ({ start: start, utc: utc, snr: snr, dt: (Number(dt) - FT8_DT_ZERO + shift / 1000).toFixed(1), offTime: shift != 0, freq: freq, message: message || "", how: how || "", first: index == 0 && at == 0 }));
  if (added.length == 0) return;
  FTX.lines = FTX.lines.slice(0, at).concat(added, FTX.lines.slice(at)).slice(0, FT8_ROWS_MAX);
  if (ftxList.scrollTop > 0) ftxList.scrollTop += added.length * FTX.rowHeight;
  mmdFtxRender();
  // Their marks on the scale
  FTX.host.overlay();
}

// ---- The list

function mmdFtxLine(line)
{
  const H = FTX.host;
  return "<tr data-freq='" + Number(line.freq) + "'" + (line.first ? " class='ftxFirst'" : "") + "><td class='ftxNum'>" + line.utc + "</td><td class='ftxNum'>" + H.escape(line.snr) +
    "</td><td class='ftxNum" + (line.offTime ? " ftxOffTime" : "") + "'>" + H.escape(line.dt) + "</td><td class='ftxNum'>" + H.escape(line.freq) + "</td><td>" + H.escape(line.message) + (line.how ? " <span class='ftxHow' title=\"" + H.escape(H.t("cwViewer.ft8.how." + line.how + ".hover")).replace(/"/g, "&quot;") + "\">" + H.escape(line.how) + "</span>" : "") + "</td></tr>";
}

// The lines in view now ({ shownFirst, shownLast }) and the slice to draw, with the buffer ({ first, last }); last indexes are exclusive
function mmdFtxRange()
{
  const count = FTX.lines.length;
  const viewTop = ftxList.scrollTop - FTX.headerHeight;
  const shownFirst = Math.max(0, Math.min(count, Math.floor(viewTop / FTX.rowHeight)));
  const shownLast = Math.max(shownFirst, Math.min(count, Math.ceil((viewTop + ftxList.clientHeight) / FTX.rowHeight)));
  return { shownFirst, shownLast, first: Math.max(0, shownFirst - FT8_VIRTUAL_BUFFER), last: Math.min(count, shownLast + FT8_VIRTUAL_BUFFER) };
}

// The slice drawn between two spacer rows standing in for the lines above and below it; the heights measured from what was drawn
function mmdFtxRender()
{
  const { first, last } = mmdFtxRange();
  FTX.slice = { first, last };
  const lines = FTX.lines;
  const spacer = (height) => "<tr class='virtualSpacer' style='height:" + height + "px;'><td colspan='5'></td></tr>";
  let html = first > 0 ? spacer(first * FTX.rowHeight) : "";
  for (let i = first; i < last; i++) html += mmdFtxLine(lines[i]);
  if (last < lines.length) html += spacer((lines.length - last) * FTX.rowHeight);
  ftxRows.innerHTML = html;
  ftxEmpty.style.display = lines.length ? "none" : "";
  if (ftxTable.tHead) FTX.headerHeight = ftxTable.tHead.getBoundingClientRect().height;
  let height = 0, count = 0;
  for (const row of ftxRows.rows)
  {
    if (row.className == "virtualSpacer") continue;
    height += row.getBoundingClientRect().height;
    count++;
  }
  if (count > 0) FTX.rowHeight = height / count;
}

// Scrolling or resizing: a redraw once the slice no longer covers the view (at most once a frame)
function mmdFtxScrolled()
{
  if (FTX.scrollQueued) return;
  FTX.scrollQueued = true;
  window.requestAnimationFrame(() => FTX.host.guard(() =>
  {
    FTX.scrollQueued = false;
    const { shownFirst, shownLast } = mmdFtxRange();
    if (shownFirst < FTX.slice.first || shownLast > FTX.slice.last) mmdFtxRender();
  }));
}

// ---- The time skew (the core's: host.skew): the periods decoded moved to the timing now, the last one heard whole decoded next (not one
// decoded already); not back (the rig moved), the one under way
function mmdFtxSkewAlign(back)
{
  const F = FTX.F;
  if (!F || !(F.total > 0)) return;
  const periodMs = mmdFtxPeriodMs();
  const shift = FTX.host.skew();
  let next = Math.floor((F.endWall - FT8_LATE_MS - shift) / periodMs) * periodMs + shift - (back ? periodMs : 0);
  while (F.decoded && F.decoded.includes(next)) next += periodMs;
  F.next = next;
  F.early = null;
}

// ---- The scale: each signal decoded in the last two periods, yellow at its middle (its line's Freq is its lowest tone); when the oldest
// of them goes (ms), drawn again
function mmdFtxDrawScale(ctx, x, ratio, w, h)
{
  if (!mmdFtxOn()) return 0;
  const periodMs = mmdFtxPeriodMs();
  const since = Date.now() - (FTX_MARK_PERIODS + 1) * periodMs;
  const half = mmdFtxWidth() / 2;
  let until = 0;
  ctx.fillStyle = "#ee3";
  for (const line of FTX.lines)
  {
    if (!(line.start >= since)) break;
    const end = line.start + (FTX_MARK_PERIODS + 1) * periodMs;
    if (!until || end < until) until = end;
    const sx = x(Number(line.freq) + half);
    ctx.beginPath();
    ctx.moveTo(sx, h);
    ctx.lineTo(sx - 4 * ratio, h - 7 * ratio);
    ctx.lineTo(sx + 4 * ratio, h - 7 * ratio);
    ctx.closePath();
    ctx.fill();
  }
  return until;
}

// ---- Slot Finder

// Its box on the second line: the mode's own (FT8's, FT4's)
function mmdFtxSetSlotFinder()
{
  if (mmdFtxOn()) FTX.host.set(FTX.host.mode() + "SlotFinder", ftxSlot.checked);
}

function mmdFtxSlotOn()
{
  return mmdFtxOn() && FTX.host.get(FTX.host.mode() + "SlotFinder") === true;
}

// From the waterfall: each row's bins counted while over FTX_SLOT_BUSY_LEVEL, by period (the time skew's while it is on); as each period
// ends, its busy bins kept for its parity (the last FTX_SLOT_PERIODS of each). Only with Slot Finder on
function mmdFtxSlotRow(row)
{
  const H = FTX.host;
  const binHz = H.binHz();
  if (!mmdFtxSlotOn() || !(binHz > 0))
  {
    if (FTX.slot && FTX.slot.binHz) mmdFtxSlotReset();
    return;
  }
  const periodMs = mmdFtxPeriodMs();
  const now = Date.now() - H.latencyMs;
  const index = Math.floor((now - H.skew()) / periodMs);
  let S = FTX.slot;
  // Started afresh: another mode, span or period length
  if (!S || S.binHz != binHz || S.bins != row.length || S.periodMs != periodMs)
  {
    S = FTX.slot = { since: S ? S.since : Date.now(), binHz: binHz, bins: row.length, periodMs: periodMs, done: [[], []], index: index, startedAt: now, rows: 0, hits: new Uint16Array(row.length) };
  }
  if (index != S.index)
  {
    // A period heard for at least half of it is kept
    if (S.rows && now - S.startedAt >= periodMs / 2 - H.latencyMs)
    {
      const list = S.done[S.index % 2];
      list.unshift(mmdFtxSlotMask(S));
      list.length = Math.min(list.length, FTX_SLOT_PERIODS);
    }
    S.index = index;
    S.startedAt = now;
    S.rows = 0;
    S.hits.fill(0);
  }
  S.rows++;
  for (let k = 0; k < row.length; k++) if (row[k] >= FTX_SLOT_BUSY_LEVEL) S.hits[k]++;
}

// A period's busy bins so far (1 busy)
function mmdFtxSlotMask(S)
{
  const mask = new Uint8Array(S.bins);
  const need = Math.max(1, S.rows * FTX_SLOT_BUSY_SHARE);
  for (let k = 0; k < S.bins; k++) mask[k] = S.hits[k] >= need ? 1 : 0;
  return mask;
}

// Heard afresh (a retune, Clear, Slot Finder off): the periods kept let go, and the decodes from before now no longer counted
function mmdFtxSlotReset()
{
  FTX.slot = { since: Date.now() };
}

// The clearest places to transmit, from the signals decoded lately in each period (even: the first of each pair, WSJT-X's Tx even/1st;
// odd). A slot is open where a signal fits with FTX_SLOT_GUARD_HZ clear either side of it (from the signals and the edges of the range
// between [ and ]); every open one is as good, and the one nearest the middle of the range is taken. The one open in both periods first,
// as "both"; then each period's own (where it isn't that one). [{ freq (Hz, its lowest tone, as WSJT-X's Tx), period ("both", "even" or
// "odd") }], empty when off, nothing was decoded lately, or no slot is open
function mmdFtxSlots()
{
  if (!mmdFtxSlotOn()) return [];
  const periodMs = mmdFtxPeriodMs();
  const width = mmdFtxWidth();
  const range = FTX.host.range();
  const low = range.minHz;
  const top = range.maxHz;
  if (top - low < width) return [];
  const S = FTX.slot;
  const busy = [[], []];
  let heard = [false, false];
  // What the waterfall heard: each period's busy bins as runs of Hz, the last FTX_SLOT_PERIODS of each and the one under way (once far
  // enough into it)
  if (S && S.binHz)
  {
    const masks = [0, 1].map((parity) => S.done[parity].slice());
    if (S.rows && Date.now() - S.startedAt >= FTX_SLOT_UNDER_WAY_MS) masks[S.index % 2].push(mmdFtxSlotMask(S));
    for (const parity of [0, 1])
    {
      for (const mask of masks[parity])
      {
        heard[parity] = true;
        for (let k = 0; k < mask.length; k++)
        {
          if (!mask[k]) continue;
          let end = k;
          while (end + 1 < mask.length && mask[end + 1]) end++;
          busy[parity].push([k * S.binHz, (end + 1) * S.binHz]);
          k = end;
        }
      }
    }
  }
  // And every signal decoded in those periods (since the last retune), even where the waterfall shows little: newest first, the period's
  // parity from its start (a skewed one's too)
  const since = Math.max(Date.now() - (2 * FTX_SLOT_PERIODS + 1) * periodMs, (S ? S.since : 0) - periodMs);
  for (const line of FTX.lines)
  {
    if (!(line.start >= since)) break;
    const freq = Number(line.freq);
    const parity = Math.round(line.start / periodMs) % 2;
    busy[parity].push([freq, freq + width]);
    heard[parity] = true;
  }
  // Nothing heard yet in either period
  if (!heard[0] && !heard[1]) return [];
  // The open slot nearest the middle, as its lowest tone, or null: in each gap, the lowest tones that keep the guard either side, the
  // one of them nearest the middle
  const middle = (low + top) / 2;
  const guard = FTX_SLOT_GUARD_HZ;
  const nearest = (signals) =>
  {
    let best = null;
    let from = low;
    for (const [start, end] of signals.sort((p, q) => p[0] - q[0]).concat([[top, top]]))
    {
      const first = from + guard;
      const last = Math.min(start, top) - guard - width;
      if (last >= first)
      {
        const freq = Math.min(last, Math.max(first, middle - width / 2));
        const off = Math.abs(freq + width / 2 - middle);
        if (!best || off < best.off) best = { off: off, freq: Math.round(freq) };
      }
      from = Math.max(from, end);
    }
    return best ? best.freq : null;
  };
  // Even's and odd's own too, each where it isn't the one open in both (overlapping it, in the same gap a few Hz along: only "both" shown)
  const both = nearest(busy[0].concat(busy[1]));
  const slots = both == null ? [] : [{ freq: both, period: "both" }];
  for (const [period, signals] of [["even", busy[0]], ["odd", busy[1]]])
  {
    const freq = nearest(signals);
    if (freq != null && (both == null || Math.abs(freq - both) >= width)) slots.push({ freq: freq, period: period });
  }
  return slots;
}

// On the waterfall: the clearest places to transmit, each shaded in its period's color (Even + Odd green, Even light blue, Odd cyan)
// with dashed edges a signal's width apart, its Hz (its lowest tone, as WSJT-X's Tx) and its period in a box at the bottom, each box
// higher than the one before so they can't cover each other
function mmdFtxDrawSlots(ctx, x, ratio, w, h)
{
  if (!mmdFtxOn()) return;
  const H = FTX.host;
  const slotRgb = { both: "80, 255, 80", even: "120, 180, 255", odd: "0, 255, 255" };
  for (const [index, slot] of FTX.slots.entries())
  {
    const a = x(slot.freq), b = x(slot.freq + mmdFtxWidth());
    const left = Math.min(a, b), right = Math.max(a, b);
    const rgb = slotRgb[slot.period];
    ctx.fillStyle = "rgba(" + rgb + ", 0.10)";
    ctx.fillRect(left, 0, right - left, h);
    ctx.strokeStyle = "rgba(" + rgb + ", 0.8)";
    ctx.lineWidth = Math.max(1, Math.round(ratio));
    ctx.setLineDash([4 * ratio, 4 * ratio]);
    ctx.beginPath();
    ctx.moveTo(Math.round(left) + 0.5, 0);
    ctx.lineTo(Math.round(left) + 0.5, h);
    ctx.moveTo(Math.round(right) + 0.5, 0);
    ctx.lineTo(Math.round(right) + 0.5, h);
    ctx.stroke();
    ctx.setLineDash([]);
    const text = H.t("cwViewer.ft8.slot.label").replace("{hz}", slot.freq).replace("{period}", H.t("cwViewer.ft8.slot." + slot.period));
    H.overlayLabel(ctx, text, (left + right) / 2, h - (19 + index * 22) * ratio, "center", 11, ratio, w, "rgb(" + rgb + ")");
  }
}

// Four times a second: Slot Finder's places, drawn again when they move
function mmdFtxTick()
{
  if (!FTX.host) return;
  const slots = mmdFtxSlots();
  if (JSON.stringify(slots) != JSON.stringify(FTX.slots))
  {
    FTX.slots = slots;
    FTX.host.overlay();
  }
}

// ---- Detect Modes: FT8's and FT4's own decoders, each its own worker and ring, each period decoded the Normal way as it ends

function mmdFtxDetectAudio(data)
{
  const H = FTX.host;
  const endWall = H.heardAt(data);
  if (endWall == null) return;
  const n = data.samples.length;
  for (const mode in FTX_DETECT_PERIOD_MS)
  {
    let F = FTX.detect[mode];
    if (!F)
    {
      try
      {
        F = FTX.detect[mode] = mmdFtxWorker((D, m) => mmdFtxDetectDecoded(mode, m));
      }
      catch (e)
      {
        continue;
      }
    }
    const periodMs = FTX_DETECT_PERIOD_MS[mode];
    const size = F.ring.length;
    for (let i = 0; i < n; i++) F.ring[(F.total + i) % size] = data.samples[i];
    // Heard from scratch: the first period decoded is the first that starts after the audio does
    if (F.total == 0) F.next = Math.ceil((endWall - (n / H.rate12) * 1000) / periodMs) * periodMs;
    F.total += n;
    F.endWall = endWall;
    while (F.endWall >= F.next + periodMs + FT8_LATE_MS)
    {
      mmdFtxDetectDecode(mode, F, F.next, periodMs);
      F.next += periodMs;
    }
  }
}

// The period starting at start out of the ring, to the worker
function mmdFtxDetectDecode(mode, F, start, periodMs)
{
  const H = FTX.host;
  const first = F.total - Math.round(((F.endWall - start) / 1000) * H.rate12);
  const count = Math.round((periodMs / 1000) * H.rate12);
  if (first < 0 || first < F.total - F.ring.length) return;
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) samples[i] = F.ring[(first + i) % F.ring.length];
  const ft4 = mode == "ft4";
  F.worker.postMessage({ type: "decode", start: start, samples: samples, more: false, myCall: H.myCall(), focus: 0, shift: 0, deadline: Date.now() + (ft4 ? FT4_BUDGET_MS : FT8_FULL_BUDGET_MS), plain: true, ft4: ft4 }, [samples.buffer]);
}

// A period's messages: each a station found ([dB, DT, audio Hz of its lowest tone, message]), at its middle
function mmdFtxDetectDecoded(mode, data)
{
  const H = FTX.host;
  if (!H.detectOn() || data.type != "decoded") return;
  const label = mode.toUpperCase();
  for (const line of data.text.split("\n").filter(Boolean))
  {
    const [snr, , freq, message] = line.split("\t");
    if (!message) continue;
    H.detectFound(mode, label, Number(freq) + FTX_DETECT[mode].width / 2, Number(snr), message);
  }
}

function mmdFtxDetectReset()
{
  for (const mode in FTX.detect) FTX.detect[mode].total = 0;
}

// ---- Settings, Decoders: its two boxes

function mmdFtxSettings()
{
  const H = FTX.host;
  if (!H) return;
  ft8DepthSelect.value = H.get("ft8Depth") == "deep" ? "deep" : "normal";
  ft8SetModeValue.checked = H.get("ft8SetMode") === true;
  ft4SetModeValue.checked = H.get("ft4SetMode") === true;
  for (const mode of ["ft8", "ft4"])
  {
    const on = H.get(mode + "SendDecodes") === true;
    window[mode + "SendDecodesValue"].checked = on;
    // Its note, while it is on but its decodes can't go yet: Rig Control isn't reading that mode's VFO's dial
    window[mode + "InstanceNoteTr"].style.display = on && !H.vfoRead(mode) ? "" : "none";
  }
}

// The FT8 Decoder's Depth: read as each period is sent to decode
function mmdFtxSetDepth()
{
  FTX.host.set("ft8Depth", ft8DepthSelect.value == "deep" ? "deep" : "normal");
}

// FT8's or FT4's Send Decodes To Call Roster (mode "ft8" or "ft4"): on, in that mode its decodes go into the Call Roster too, not only
// the map (GridTracker's instance "MMD", services/mmDecoder.js)
function mmdFtxSetSendDecodes(mode)
{
  FTX.host.set(mode + "SendDecodes", window[mode + "SendDecodesValue"].checked);
  mmdFtxSettings();
}

// ---- Set up: a click on a row puts the focus on its signal (its lowest tone is its Freq; centered on its middle), not when the mouse
// selected text in it (to copy); the list's virtual scrolling, its slice redrawn as it scrolls or the window changes size
function mmdFtxInit(host)
{
  FTX.host = host;
  ftxRows.addEventListener("click", (event) => host.guard(() =>
  {
    const row = event.target.closest("tr[data-freq]");
    if (row && String(window.getSelection()).length == 0) host.bandFocusSet(Number(row.dataset.freq) + mmdFtxWidth() / 2);
  }));
  ftxList.addEventListener("scroll", mmdFtxScrolled, { passive: true });
  window.addEventListener("resize", mmdFtxScrolled);
  mmdFtxSlotReset();
}

// What was heard is let go (the periods decoded stay listed)
function mmdFtxStop()
{
  if (FTX.F) FTX.F.total = 0;
}

mmdRegisterMode({
  id: "ftx",
  name: "FT8 / FT4",
  modes: ["ft8", "ft4"],
  input: "audio12",
  skew: true,
  focusHalf: FTX_FOCUS_HALF,
  scaleMinorHz: 100,
  instance: true,
  detect: FTX_DETECT,
  init: (host) => mmdFtxInit(host),
  periodMs: () => mmdFtxPeriodMs(),
  periodShift: () => (FTX.host ? FTX.host.skew() : 0),
  audio: (data) => mmdFtxAudio(data),
  // Its list and Slot Finder's box (Slot Finder the mode's own)
  shown: (on) =>
  {
    if (!FTX.host) return;
    ftxList.style.display = on ? "" : "none";
    ftxSlotBox.style.display = on ? "" : "none";
    if (on) ftxSlot.checked = FTX.host.get(FTX.host.mode() + "SlotFinder") === true;
  },
  // Listened for afresh (its list kept): the periods from the next
  entered: () => mmdFtxStop(),
  stop: () => mmdFtxStop(),
  clear: () =>
  {
    if (!FTX.host) return;
    FTX.lines = [];
    ftxList.scrollTop = 0;
    mmdFtxRender();
  },
  // The rig moved: the audio heard so far isn't decoded with what comes after (a period heard partly on 20m and partly on 40m would give
  // 20m's signals as 40m's): the period under way is decoded from here on only (mmdFtxDecode). Slot Finder starts again on what is heard
  // here
  retune: () =>
  {
    if (!FTX.host) return;
    const F = FTX.F;
    if (F && F.total > 0)
    {
      F.cutTotal = F.total;
      // An early decode of the period under way was of the old frequency: the full one is a fresh decode, not more of it
      if (F.early == F.next) F.early = null;
    }
    mmdFtxSlotReset();
  },
  skewAlign: (back) => mmdFtxSkewAlign(back),
  fallRow: (row) => mmdFtxSlotRow(row),
  draw: (ctx, x, ratio, w, h) => mmdFtxDrawSlots(ctx, x, ratio, w, h),
  drawScale: (ctx, x, ratio, w, h) => mmdFtxDrawScale(ctx, x, ratio, w, h),
  tick: () => mmdFtxTick(),
  detectAudio: (data) => mmdFtxDetectAudio(data),
  detectReset: () => mmdFtxDetectReset(),
  settingsRender: () => mmdFtxSettings()
});
