// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Multi-Mode Decoder's Test Signals (the button beside the levels): recordings in resources/test-signals (listed in its index.json,
// made by tools/make_test_signals.js) of the mode's signals, often several at once and some with an RSID first, played into the decoder's
// own input while it listens (the Input Device silenced meanwhile and a noise floor played in its place, so it's heard alone, as on a
// band: mmdTestNoise), everything decoded before cleared first. FT8's and FT4's start on a period's boundary.
// What they decode stays in the window: FT8's and FT4's periods heard while one played aren't passed to GridTracker's instance, and
// SSTV's pictures aren't saved by themselves (mmdTestHeard)

const TEST = {
  list: null,      // index.json's signals, read once
  source: null,    // the one playing (an AudioBufferSourceNode), or waiting for its period
  file: "",        // its file
  startAt: 0,      // when it starts and ends (ms, the clock's)
  endAt: 0,
  heardFrom: 0,    // what was heard from and to while one played (ms): decodes of this are kept in the window
  heardTo: 0,
  timer: null,
  oliviaSaved: null, // Olivia's submode and centre before one played, put back after
  noise: null        // the noise floor played with it (mmdTestNoise)
};
// After one ends, what the decoders still hear of it (FT8's period decoded after its end ...): kept in the window this long too (ms)
const TEST_AFTER_MS = 20000;
// The noise floor played with each in place of the Input Device (silenced meanwhile): white noise this many dB re full scale per Hz, up to
// TEST_NOISE_TOP_HZ (the recordings are at 12000 Hz: nothing above 6 kHz). A recording with less noise of its own is heard with this one;
// one with more (FT8's) is barely changed
const TEST_NOISE_DB_HZ = -70;
const TEST_NOISE_TOP_HZ = 5500;

// index.json's list (none: an empty one)
function mmdTestList()
{
  if (!TEST.list)
  {
    try
    {
      TEST.list = JSON.parse(fs.readFileSync(path.join(resourcesPath, "test-signals", "index.json"), "utf8")).signals || [];
    }
    catch (e)
    {
      TEST.list = [];
    }
  }
  return TEST.list;
}

// The mode's test signals
function mmdTestFor(mode = DEC.mode)
{
  return mmdTestList().filter((t) => Array.isArray(t.modes) && t.modes.includes(mode));
}

// The button: shown while the decoder listens and the mode has some; while one plays (or waits for its period) it stops it, with the
// seconds left on it
function mmdTestRender()
{
  const show = !!DEC.node && (TEST.source || mmdTestFor().length > 0);
  cwTestButton.style.display = show ? "" : "none";
  if (!show) return;
  let text = I18N("cwViewer.test.label");
  if (TEST.source)
  {
    const now = Date.now();
    const left = Math.max(0, Math.ceil(((now < TEST.startAt ? TEST.startAt : TEST.endAt) - now) / 1000));
    text = I18N(now < TEST.startAt ? "cwViewer.test.waiting" : "cwViewer.test.stop").replace("{seconds}", left);
  }
  if (cwTestButton.textContent != text) cwTestButton.textContent = text;
  cwTestButton.classList.toggle("cwTestOn", !!TEST.source);
}

// A click: stops the one playing, else the mode's menu
function mmdTestClick()
{
  if (TEST.source)
  {
    mmdTestStop();
    return;
  }
  const list = mmdTestFor();
  if (!list.length) return;
  const remote = window.require("@electron/remote");
  const menu = remote.Menu.buildFromTemplate(list.map((t) => ({ label: mmdTestLabel(t), click: () => mmdTestPlay(t) })));
  const at = cwTestButton.getBoundingClientRect();
  menu.popup({ window: remote.getCurrentWindow(), x: Math.round(at.left), y: Math.round(at.bottom) });
}

// A test signal in the menu: its name (the modes' and submodes', as they are everywhere), how many signals, RSID, a recording off the air
function mmdTestLabel(t)
{
  const signals = Number(t.signals) || 1;
  let label = (t.name ? t.name + "  ·  " : "") + (signals == 1 ? I18N("cwViewer.test.one") : I18N("cwViewer.test.many").replace("{count}", signals));
  if (t.rsid) label += " + RSID";
  if (t.source && t.source != "generated") label += "  ·  " + I18N("cwViewer.test.recording");
  return label;
}

// Played into the decoder: read, made the decoder's rate, and started now (FT8 and FT4: on the next period's boundary, at least half a
// second away)
async function mmdTestPlay(t)
{
  mmdTestStop();
  const ctx = DEC.ctx, node = DEC.node;
  if (!ctx || !node) return;
  let buffer;
  try
  {
    const file = fs.readFileSync(path.join(resourcesPath, "test-signals", t.file));
    buffer = await ctx.decodeAudioData(file.buffer.slice(file.byteOffset, file.byteOffset + file.length));
  }
  catch (e)
  {
    mmdStatus(I18N("cwViewer.test.failed") + " " + ((e && e.message) || String(e)), true);
    return;
  }
  // Stopped or started again meanwhile
  if (DEC.ctx != ctx || DEC.node != node || TEST.source) return;
  mmdTestStart(t, buffer, true);
}

// A signal (t: { file, sync, olivia } as index.json's; buffer: at the decoder's context's rate) played into the decoder as a test signal
// is, everything decoded before cleared first when clear is true (SSTV's Simulate Rx keeps the pictures received). False when the decoder
// isn't listening
function mmdTestStart(t, buffer, clear)
{
  mmdTestStop();
  const ctx = DEC.ctx, node = DEC.node;
  if (!ctx || !node) return false;
  // Olivia: your submode and centre kept, put back when it ends (an RSID in it, or the recording's own, moves them meanwhile)
  if (mmdOliviaMode())
  {
    const S = GT.settings.MMD;
    TEST.oliviaSaved = { submode: S.oliviaSubmode, center: S.oliviaCenter };
    if (t.olivia)
    {
      S.oliviaSubmode = t.olivia.submode;
      S.oliviaCenter = t.olivia.center;
      mmdOliviaMenu();
      mmdOliviaRestart();
    }
  }
  let delay = 0;
  const period = t.sync == "ft8" ? 15000 : t.sync == "ft4" ? 7500 : 0;
  if (period)
  {
    const now = Date.now();
    delay = period - (now % period);
    if (delay < 500) delay += period;
  }
  // Everything decoded before it cleared (as Clear does), so what's listed is the test's
  if (clear) mmdClear();
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  source.connect(gain);
  gain.connect(node);
  source.onended = () =>
  {
    if (TEST.source != source) return;
    TEST.source = null;
    mmdTestDone();
  };
  source.start(ctx.currentTime + delay / 1000);
  TEST.source = source;
  // The noise floor, from now (the wait for FT8's period too) until it ends
  TEST.noise = mmdTestNoise(ctx, node);
  // The Input Device silenced meanwhile (its SW level back when it ends: mmdSwApply), so the test isn't mixed with what's on the air
  mmdSwApply();
  TEST.file = t.file;
  TEST.startAt = Date.now() + delay;
  TEST.endAt = TEST.startAt + buffer.duration * 1000;
  TEST.heardFrom = TEST.startAt;
  TEST.heardTo = TEST.endAt + TEST_AFTER_MS;
  nodeTimers.clearInterval(TEST.timer);
  TEST.timer = nodeTimers.setInterval(mmdTestRender, 500);
  mmdTestRender();
  return true;
}

// Stopped (the button, another mode without it, the decoder stopping): what was heard of it still kept in the window a while
function mmdTestStop()
{
  const source = TEST.source;
  if (!source) return;
  TEST.source = null;
  try
  {
    source.onended = null;
    source.stop();
    source.disconnect();
  }
  catch (e)
  {
    // Its context closed already
  }
  TEST.heardTo = Math.min(TEST.heardTo, Date.now() + TEST_AFTER_MS);
  mmdTestDone();
}

// The noise floor: two seconds of white noise looped, low passed, at TEST_NOISE_DB_HZ (its RMS over the context's whole band: the density
// times half its rate), into the decoder
function mmdTestNoise(ctx, node)
{
  const seconds = 2;
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const s = buffer.getChannelData(0);
  const rms = Math.sqrt(Math.pow(10, TEST_NOISE_DB_HZ / 10) * (ctx.sampleRate / 2));
  for (let i = 0; i < s.length; i += 2)
  {
    // Gaussian, two at a time (Box-Muller)
    const r = Math.sqrt(-2 * Math.log(Math.random() || 1e-12)) * rms;
    const t = 2 * Math.PI * Math.random();
    s[i] = r * Math.cos(t);
    if (i + 1 < s.length) s[i + 1] = r * Math.sin(t);
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = Math.min(TEST_NOISE_TOP_HZ, ctx.sampleRate / 2 - 100);
  source.connect(filter);
  filter.connect(node);
  source.start();
  return source;
}

function mmdTestDone()
{
  TEST.file = "";
  // The noise floor stopped
  if (TEST.noise)
  {
    try
    {
      TEST.noise.stop();
      TEST.noise.disconnect();
    }
    catch (e)
    {
      // Its context closed already
    }
    TEST.noise = null;
  }
  // The Input Device heard again
  mmdSwApply();
  // Olivia's submode and centre as they were before it
  const saved = TEST.oliviaSaved;
  TEST.oliviaSaved = null;
  if (saved)
  {
    const S = GT.settings.MMD;
    const moved = S.oliviaSubmode != saved.submode || S.oliviaCenter != saved.center;
    S.oliviaSubmode = saved.submode;
    S.oliviaCenter = saved.center;
    if (moved && mmdOliviaMode())
    {
      mmdOliviaMenu();
      mmdOliviaRestart();
    }
  }
  nodeTimers.clearInterval(TEST.timer);
  TEST.timer = null;
  mmdTestRender();
  // SSTV Send's Simulate Rx back from Abort (mmdSstvTx.js)
  mmdSstvTxButtons();
}

// The mode changed: one playing goes on only where it's one of this mode's
function mmdTestModeChanged()
{
  if (TEST.source && !mmdTestFor().some((t) => t.file == TEST.file)) mmdTestStop();
  mmdTestRender();
}

// Whether what was heard from (and to) these times (ms) was while a test signal played, or just after
function mmdTestHeard(from, to = from)
{
  return TEST.heardTo > 0 && to >= TEST.heardFrom && from <= TEST.heardTo;
}
